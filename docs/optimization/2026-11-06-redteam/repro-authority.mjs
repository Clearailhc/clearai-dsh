
/**
 * clearai 机制测试 —— 证明机制真的在生效,而不是「以为落进了机制」。
 *
 * ClearAI 的 loop-philosophy.md §7 把「复杂度与测试密度不匹配」列为这套设计真实的内部张力:
 * 「机制越完备,越需要测试来证明机制真的在生效——否则『落进机制的约束』和『以为落进了机制
 * 的约束』在代码里长得一模一样」。这份测试就是那条张力的答复。
 *
 * 状态从「自建台账」改成「会话日志的投影」之后,测试的接线必须与生产**同形**:
 *   工具 execute → output.presentationMeta 取出变更记录 → 折进投影 → 下一次调用读到新状态。
 * 折的那一步直接复用宿主半的 fold.js(不复制一份),所以测试红了就是实现红了。
 *
 * 跑法:node test/kernel.test.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tempDir, trackTemp } from '../../../test/tmp.mjs'
import { execFileSync } from 'node:child_process'
import { CONFIG_KEYS, apply } from '../../../preset/plugins/clearai-kernel.js'
import { citeVerdict, exclusionStrength, negativeItems, relatedKnowledge, resolveAbout } from '../../../preset/plugins/knowledge-items.js'
import { HUMAN_GATE_MARK, applyEvent, applyMutations, derive, emptyState, parseHumanGate, renderCard, view } from '../../../ui/lib/fold.js'
import { ONTOLOGY_SCHEMA, checkOntologyFile, describeDomainShelf, fingerprintDefinitions, formatAssertion, graphProjection, validateAssertions, validatePredicate, validateTerm } from '../../../ui/lib/domain-language.js'
import { SECTIONS as BILINGUAL_SECTIONS, SECTION_TABLE } from '../../../preset/plugins/prompts.js'
import { detectLanguage } from '../../../ui/lib/lang.js'
/** 段有中英两版;这里的断言读中文那一版(英文那一版另有一组检查)。 */
const SECTIONS = BILINGUAL_SECTIONS.map((section) => ({ ...section, text: section.text.zh }))

// 测试用自己的数据区:世界线工作副本与旁路账本都按 DSH_HOME 落盘,
// 跑测试不该往用户真实的 ~/.dsh 里塞东西(之前一直塞了,已清理)。
process.env.DSH_HOME = tempDir('clearai-home-')

const WORKSPACE = tempDir('clearai-ws-')
const SESSION = 'session-test'
/** 这一遍用哪一代子代理入口(见 makeHost 的 `subagentApi`)。新一代里评估者的工具面由随包预设决定。 */
const SUBAGENT_API = process.env.CLEARAI_TEST_SUBAGENT_API ?? 'start'
const EVALUATOR_PRESET = readFileSync(new URL('../../../preset/evaluator.cordis.yml', import.meta.url), 'utf8')

// 工作区刻意是一个**用户自己的** git 仓库:账本与世界线都必须落在旁路账本里,
// 用户的分支、历史、ref 一个都不许碰(0.3.2 起;之前会直接在用户当前分支上提交)。
// 「用户仓库原样不动」那一段核对这个仓库在整场测试之后仍只有它自己的提交。
execFileSync('git', ['init', '-q'], { cwd: WORKSPACE })
execFileSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: WORKSPACE })
/**
 * 尺子的口径必须是**工作区里真有的文件**(一条可指认的引用,不是散文)。
 * 这里先放一份测量脚本占位,后面各场分叉的尺子都引用它。
 */
mkdirSync(join(WORKSPACE, 'lab'), { recursive: true })
writeFileSync(join(WORKSPACE, 'lab', 'probe.txt'), '# 测量脚本占位:各场分叉的尺子口径引用这个文件\n')

let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail = '') {
	if (condition) {
		passed += 1
		console.log(`  ✓ ${label}`)
	} else {
		failed += 1
		failures.push(label)
		console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`)
	}
}

/**
 * 用例里的评估者回执大多还写成一个 `verdict`——那时评估者用它说的是「交付成立吗」
 * (依据都写着「判据满足」「重复次数不足」)。这里按两项裁决读回来:
 * support→交付成立、refute→不成立、inconclusive→判不了;交付成立时,
 * 这一步检验的每条判断(从任务书里列出的 id 取)记为 support。新写法(带 `holds`)原样交回。
 */
function twoPartVerdict(verdict, request) {
	if (verdict === undefined || verdict === null || typeof verdict !== 'object' || verdict.holds !== undefined || verdict.verdict === undefined) return verdict
	const { verdict: legacy, reading: _reading, validity: _validity, ...rest } = verdict
	const holds = legacy === 'support' ? 'yes' : legacy === 'refute' ? 'no' : 'unclear'
	const prompt = typeof request?.prompt === 'string' ? request.prompt : (request?.prompt ?? []).map((block) => block?.text ?? '').join('\n')
	const tested = [...String(prompt).matchAll(/^\s+· (h-[a-z0-9]+):/gm)].map((match) => match[1])
	return { ...rest, holds, results: holds === 'yes' ? tested.map((hypothesis) => ({ hypothesis, verdict: 'support' })) : [] }
}

// ── 假的宿主:一个内存投影 + 几个服务存根 ──────────────────────────────────

function makeHost() {
	const tools = new Map()
	const warnings = []
	const listeners = new Map()
	const audits = []
	const sections = []
	const states = new Map()
	const journal = []
	const service = {
		/**
		 * `host.hostHealthExtra`:模拟宿主半**在进程内**观察到的读面降级(它随 `state()` 暴露,
		 * 由内核在生产侧落成 `host/inactive` 事实)。不给就与之前逐字段相同。
		 */
		state: (id) => {
			const base = states.get(id) ?? emptyState()
			const extra = host.hostHealthExtra
			if (!Array.isArray(extra) || extra.length === 0) return base
			return { ...base, hostHealth: [...(base.hostHealth ?? []), ...extra] }
		},
		derive: (id) => derive(service.state(id)),
		view: (id) => view(service.state(id)),
		// 与生产同形:人刚切过档的那一拍,卡片按**输入里那份当档**渲染(§17.5)。
		renderCard: (id, overrides = {}) => {
			const state = service.state(id)
			if (overrides.autonomy !== 'attended' && overrides.autonomy !== 'unattended') return renderCard(state)
			return renderCard({ ...state, autonomy: { ...(state.autonomy ?? {}), effective: { value: overrides.autonomy, source: 'session', preset: state.autonomy?.effective?.preset ?? null } } })
		},
		preview: (id, mutations) => {
			const next = applyMutations(service.state(id), mutations)
			return { state: next, derived: derive(next), card: renderCard(next), view: view(next) }
		},
		/**
		 * **领域判据的宿主门**(与生产半 `ui/lib/index.js` 的 facade 同形)。
		 * 判据本身来自纯函数模块——测试也不许自己写一份,否则「登记时放行、升格时拒绝」
		 * 这类漂移在测试里同样看不见。
		 */
		domain: {
			validateTerm: (id, draft) => validateTerm(service.state(id).lexicon, draft),
			validatePredicate: (id, draft) => validatePredicate(service.state(id).lexicon, draft),
			validateAssertions: (id, assertions, options = {}) => validateAssertions(applyMutations(service.state(id), Array.isArray(options?.mutations) ? options.mutations : []), assertions, options),
			checkFile: (path, content) => checkOntologyFile(path, content),
			schema: () => ONTOLOGY_SCHEMA,
			renderShelf: (id, mutations = []) => {
				const state = applyMutations(service.state(id), Array.isArray(mutations) ? mutations : [])
				const next = derive(state)
				return describeDomainShelf(state, next.factRows, next.hypotheses)
			},
			format: (id, assertion) => formatAssertion(service.state(id).lexicon, assertion),
			definitions: (id, assertions, mutations = [], said = '') => fingerprintDefinitions(applyMutations(service.state(id), Array.isArray(mutations) ? mutations : []).lexicon, assertions, { text: said }),
		},
	}
	// 宿主的 `goals` 服务桩:目标层挂在它上面。它记下每一次调用,测试据此断言
	// 「建 / 改 / 完成 / 报阻塞」真的发生了——而不是以为发生了。
	let hostGoal = null
	const goalCalls = []
	const goals = {
		get() {
			goalCalls.push(['get'])
			return hostGoal
		},
		create(agent, request) {
			goalCalls.push(['create', request.objective, request.maxGoalRounds])
			hostGoal = { id: 'hg-1', revision: 1, objective: request.objective, phase: 'active', maxGoalRounds: request.maxGoalRounds ?? 24, roundsStarted: 0, activation: 'armed' }
			return hostGoal
		},
		edit(agent, ref, request) {
			goalCalls.push(['edit', request.objective])
			hostGoal = { ...hostGoal, ...request, revision: hostGoal.revision + 1 }
			return hostGoal
		},
		resume() {
			goalCalls.push(['resume'])
			hostGoal = { ...hostGoal, phase: 'active', activation: 'armed', revision: hostGoal.revision + 1 }
			return hostGoal
		},
		pause() {
			goalCalls.push(['pause'])
			hostGoal = { ...hostGoal, phase: 'paused', activation: 'disarmed', revision: hostGoal.revision + 1 }
			return hostGoal
		},
		complete() {
			goalCalls.push(['complete'])
			hostGoal = { ...hostGoal, phase: 'complete', activation: 'disarmed', revision: hostGoal.revision + 1 }
			return hostGoal
		},
		block(agent, ref, reason) {
			if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(String(reason?.code ?? ''))) throw new Error('goal block reason requires a lower-kebab-case code and a non-empty message')
			goalCalls.push(['block', reason?.code])
			hostGoal = { ...hostGoal, phase: 'blocked', blockedReason: reason, activation: 'disarmed', revision: hostGoal.revision + 1 }
			return hostGoal
		},
		clear() {
			goalCalls.push(['clear'])
			const gone = hostGoal
			hostGoal = null
			return { id: gone?.id ?? 'hg-1', revision: (gone?.revision ?? 0) + 1 }
		},
	}
	const host = {
		tools,
		audits,
		listeners,
		sections,
		journal,
		service,
		states,
		warnings,
		goals,
		goalCalls,
		goalsAvailable: true,
		skillsAvailable: true,
		brainProvider: null,
		brainInvalidations: [],
		/** 宿主 skills 服务的合并目录(默认空:大多数用例不关心技能面)。 */
		skillSnapshot: { skills: [], complete: true },
		skillSnapshots: [],
		/**
		 * 子代理入口是哪一代(issue #38):`start` = 宿主 ≤0.2.1-alpha.1 的 `start(provider, request)`;
		 * `activation` = ≥0.2.1-alpha.2 的 `startActivation(spec)`;`none` = 两个都没有。
		 * 缺省读 `CLEARAI_TEST_SUBAGENT_API`:test/run.sh 用它把整套内核用例在新入口上再跑一遍。
		 */
		subagentApi: process.env.CLEARAI_TEST_SUBAGENT_API ?? 'start',
		get hostGoal() {
			return hostGoal
		},
		/** 每个评估者回什么裁决,由测试决定 */
		cwd: null, // 需要时切成别的目录(比如 B 层:不是 git 仓库的工作区)
		nextVerdict: { verdict: 'support', basis: '硬信号:三次重复齐备,均值差 6.2 个百分点', shortfalls: [] },
		auditFails: false,
		ctx: {
			logger: {
				info() {},
				// 内核的告警在测试里不能丢:输出越界那次就是「裁掉 + 告警」,
				// 而契约检查看不到被裁掉的字段——所以告警本身就是断言面。
				warn(message) {
					warnings.push(String(message))
				},
				error(message) {
					warnings.push(String(message))
				},
			},
			get(name) {
				if (name === 'clearai') return service
				if (name === 'agents') return { get: id => host.liveAgents?.[String(id)] }
				if (name === 'goals') return host.goalsAvailable ? goals : undefined
			/**
			 * 原生两条正门(§19):计划审阅(`userQuestions.ask`)与人放行(`approval.request`)。
			 * 默认**不存在**——那正是「这个形态没有通道」的形态(headless),于是现有那些断言
			 * 自动验的是**退回旧行为**那条路;要验借道,用例自己把 `host.userQuestions` /
			 * `host.approval` 装上(见 §19 那两组用例)。
			 */
			if (name === 'userQuestions') return host.userQuestions ?? undefined
			if (name === 'approval') return host.approval ?? undefined
			if (name === 'shell') return host.shell ?? undefined
			if (name === 'skills') {
				return host.skillsAvailable === false
					? undefined
					: {
							registerProvider(create) {
								host.brainProvider = create({ invalidate: () => host.brainInvalidations.push('invalidate') })
								return () => {
									host.brainProvider = null
								}
							},
							// 宿主原生的**合并目录**:内核每个 pre-step 取一次快照(见 publishCatalog)。
							// 形状照 `dsh-skill` 的 `snapshot()`:`{skills: SkillSummary[], complete}`。
							async snapshot(options) {
								host.skillSnapshots.push({ cwd: options?.cwd ?? null, scope: options?.scope ?? null })
								return host.skillSnapshot
							},
						}
			}
				// 工具注册表:`resolveToolFace` 问它「这个部署里到底有没有这件工具」。
				// 默认全认(与真实部署同形);用例可以设 host.toolNames 只认一部分,验「瘦部署」。
				if (name === 'tools') {
					return {
						get(toolName) {
							const known = host.toolNames
							if (known !== undefined && !known.includes(toolName)) return undefined
							return { name: toolName }
						},
					}
				}
				// 会话服务:`get(id)` 默认回一个「只知道工作目录」的壳(内核用它取 cwd);
				// 用例可以放真的会话桩进 `host.childSessions`(按 id)——回收执行者结论要走它。
				if (name === 'sessions') {
					// 每个会话都给一个 `ownEvents()`:内核读**权威记录**用得上
					// (执行者结论回收 `turn/end`、人放行审批对 `approval/asked`+`approval/decided`)。
					// 默认空数组 = 读不到 ⇒ fail closed(用例要放行就得自己把那一对事件放进去)。
					const shell = (id) => ({
						header: { cwd: host.cwd ?? WORKSPACE },
						ownEvents: () => host.sessionEvents?.[String(id)] ?? [],
						/**
						 * 内核的**回合收尾**会往会话日志里写一条 `clearai/turn-ended`
						 * (事件而不是消息:这一拍任何"追加消息"的路子都会把模型再叫起来)。
						 */
						append: (type, data, options) => {
							if (type === 'user/message' && options?.surfaceOp !== 'append') throw new Error('native message requires surfaceOp')
							if (host.appendFailure && type === 'hook/result' && data?.notice?.source?.kind === 'plugin:clearai') throw new Error('registered disk failure')
							host.appended = host.appended ?? []
							host.appended.push({ sessionId: String(id), type, data, ...(options ?? {}) })
						},
					})
					return {
						get: (id) => host.coldSessionId === String(id) ? undefined : host.childSessions?.[String(id)] ?? shell(id),
						list: () => Object.values(host.childSessions ?? {}),
					}
				}
				if (name === 'sessionQuery' && host.coldEvents) return { observeSession: async () => ({ events: host.coldEvents, [Symbol.dispose]: () => { host.coldDisposed = true } }) }
				if (name === 'subagents') {
					// `host.subagentsAvailable === false`:整个服务不在(用来验「拿不到目录就不猜」)。
					if (host.subagentsAvailable === false) return undefined
					const subagentService = {
						/**
						 * 子代理**目录**(§14-D):每项 `{kind:'child', id, activity:'running'|'inactive', mode}`。
						 * 默认空数组 = 「一个活的子会话都没有」——用例要模拟「还在跑」就自己放一条进去
						 * (`host.listing`)。
						 */
						async listChildren() {
							return host.listing ?? []
						},
						// 子 run 都必须用 start() 的一次性句柄;旧入口一旦触达就让测试失败。
						async startContinuable() {
							check('内核不得调用 startContinuable', false)
							throw new Error('unexpected startContinuable call')
						},
						async start(provider, request) {
							if (host.auditFails) throw new Error('provider unavailable')
							const stopOf = (kind) => host[`stopReason${kind}`] ?? host.stopReason ?? 'completed'
							if (host.capabilityRefusals !== undefined && host.capabilityRefusals.some((capability) => String(request.label ?? '') !== '' && capability === 'all')) {
								throw new Error('provider refuses every variant')
							}
							audits.push({ provider, request })
							// `onAudit`:评估者「运行」的那一刻(查副本在不在、模拟评估者动了产物)。
							host.onAudit?.(request)
							// `auditNeverSettles` / `auditDelayMs`:让评估者**晚一点**（或永不）落定——
							// 「回合结束时它还在飞」这件事才测得到。
							/**
							 * `nextVerdictText`:模拟**评估者只写了 markdown 评估卡、没走结构化通道**
							 * (真跑里发生过,而那时目标永远结不了案)。它给出 `output` 文本、`structured` 为空,
							 * 用来钉住内核的正文兜底。
							 */
							const evaluatorSettle = {
								output: host.nextVerdictText === undefined ? [] : [{ type: 'text', text: String(host.nextVerdictText) }],
								structured: host.nextVerdictText === undefined ? twoPartVerdict(host.nextVerdict, request) : undefined,
								stopReason: stopOf('Evaluator'),
							}
							const evaluatorDelay = Number(host.auditDelayMs ?? 0)
							const evaluatorResult =
								host.auditNeverSettles === true
									? new Promise(() => {})
									: evaluatorDelay > 0
										? new Promise((resolve) => setTimeout(() => resolve(evaluatorSettle), evaluatorDelay))
										: Promise.resolve(evaluatorSettle)
							return {
								id: `child-${audits.length}`,
								localAgent: undefined,
								result: evaluatorResult,
								dispose: async () => { host.auditDisposals = (host.auditDisposals ?? 0) + 1 },
							}
						},
					}
					if (host.subagentApi === 'start') return subagentService
					const { start: launch, ...rest } = subagentService
					if (host.subagentApi === 'none') return rest
					return {
						...rest,
						/**
						 * 宿主 ≥0.2.1-alpha.2 的形状:`{ provider, label, delivery, signal, request }`,
						 * 回包是 `{ childId, result, dispose }`。真宿主把请求里的 persona / toolFilter **静默丢掉**,
						 * 这里照样不认它们:记进 `audits` 的就是平台真正看得见的那一份。
						 */
						async startActivation(spec) {
							if (typeof spec?.provider !== 'string' || typeof spec?.label !== 'string' || !(spec?.signal instanceof AbortSignal) || !['parent', 'caller'].includes(spec?.delivery)) throw new Error('invalid SubagentActivationSpec')
							if (spec.request?.parent === undefined || !Array.isArray(spec.request?.prompt)) throw new Error('startActivation request requires parent and prompt blocks')
							const { persona: _persona, toolFilter: _toolFilter, ...request } = spec.request
							const run = await launch(spec.provider, { ...request, label: spec.label, signal: spec.signal, spec })
							return { childId: run.id, result: run.result, dispose: run.dispose }
						},
					}
				}
				return undefined
			},
			on(event, handler) {
				listeners.set(event, handler)
				return () => {}
			},
			effect(callback) {
				callback()
				return () => {}
			},
			tools: {
				async execute(exec) {
					if (!host.shell) return { isError: true }
					if (!exec.arguments.description?.trim() || !Number.isFinite(exec.arguments.timeoutMs) || 'timeout' in exec.arguments) return { isError: true, error: { message: 'DSH rc.2 shell contract requires description and timeoutMs' } }
					const run = await host.shell.execute({ command: exec.arguments.command, cwd: exec.arguments.workdir, signal: exec.signal })
					return { value: await run.result() }
				},
				register(definition) {
					tools.set(definition.name, definition)
					return () => {}
				},
			},
			systemPrompt: {
				section(section) {
					// 段文本是一个函数(按会话的语言挑一版);没有会话时是中文。
					sections.push({ ...section, text: typeof section.text === 'function' ? section.text({}) : section.text, render: section.text })
					return () => {}
				},
			},
		},
	}
	return host
}


const host = makeHost(); apply(host.ctx, {});
const pre = host.listeners.get('tools/pre-execute');
const commands = [
  `echo '{}' > clear/evidence/forged.json`,
  `python3 -c "open('clear/evidence/forged.json','w').write('{}')"`,
  `node -e "require('fs').writeFileSync('clear/evidence/forged.json','{}')"`,
  `p=clear; echo '{}' > "$p/evidence/forged.json"`
];
for (const command of commands) {
 const r = await pre({name:'bash', arguments:{command}, agent:{id:SESSION}, callId:'redteam'}, async()=>({kind:'allow'}));
 if(r.kind==='allow') {
 mkdirSync(join(WORKSPACE,'clear','evidence'),{recursive:true});
 execFileSync('bash',['-c',command],{cwd:WORKSPACE});
}
console.log(JSON.stringify({command,kind:r.kind,written:existsSync(join(WORKSPACE,'clear','evidence','forged.json'))}));
}
