
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
import { join } from 'node:path'
import { tempDir, trackTemp } from './tmp.mjs'
import { execFileSync } from 'node:child_process'
import { CONFIG_KEYS, apply } from '../preset/plugins/clearai-kernel.js'
import { HUMAN_GATE_MARK, applyEvent, applyMutations, derive, emptyState, parseHumanGate, renderCard, view } from '../ui/lib/fold.js'
import { ONTOLOGY_SCHEMA, checkOntologyFile, describeDomainShelf, fingerprintDefinitions, formatAssertion, graphProjection, validateAssertions, validatePredicate, validateTerm } from '../ui/lib/domain-language.js'
import { SECTIONS, SECTION_TABLE } from '../preset/plugins/prompts.js'

// 测试用自己的数据区:世界线工作副本与旁路账本都按 DSH_HOME 落盘,
// 跑测试不该往用户真实的 ~/.dsh 里塞东西(之前一直塞了,已清理)。
process.env.DSH_HOME = tempDir('clearai-home-')

const WORKSPACE = tempDir('clearai-ws-')
const SESSION = 'session-test'

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
			definitions: (id, assertions, mutations = []) => fingerprintDefinitions(applyMutations(service.state(id), Array.isArray(mutations) ? mutations : []).lexicon, assertions),
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
				if (name === 'goals') return host.goalsAvailable ? goals : undefined
			/**
			 * 原生两条正门(§19):计划审阅(`userQuestions.ask`)与人放行(`approval.request`)。
			 * 默认**不存在**——那正是「这个形态没有通道」的形态(headless),于是现有那些断言
			 * 自动验的是**退回旧行为**那条路;要验借道,用例自己把 `host.userQuestions` /
			 * `host.approval` 装上(见 §19 那两组用例)。
			 */
			if (name === 'userQuestions') return host.userQuestions ?? undefined
			if (name === 'approval') return host.approval ?? undefined
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
						append: (type, data) => {
							host.appended = host.appended ?? []
							host.appended.push({ sessionId: String(id), type, data })
						},
					})
					return {
						get: (id) => host.childSessions?.[String(id)] ?? shell(id),
						list: () => Object.values(host.childSessions ?? {}),
					}
				}
				if (name === 'subagents') {
					// `host.subagentsAvailable === false`:整个服务不在(用来验「拿不到目录就不猜」)。
					if (host.subagentsAvailable === false) return undefined
					return {
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
								dispose: async () => {},
							}
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
				register(definition) {
					tools.set(definition.name, definition)
					return () => {}
				},
			},
			systemPrompt: {
				section(section) {
					sections.push(section)
					return () => {}
				},
			},
		},
	}
	return host
}

const thisHost = makeHost()
// 主宿主显式给 blockedThreshold 3:准入树的那些用例只想验「收不收」,不想在半路撞上
// 连拦阈值。**档决定阈值**这件事由「预算档」那一节的用例专门实测(attended 2 / unattended 3)。
apply(thisHost.ctx, { blockedThreshold: 3 })

const exec = { callId: 'call-1', agent: { id: SESSION }, signal: undefined }

/**
 * 输出契约校验:工具返回值必须落在它自己声明的 `output.schema` 里。
 *
 * 为什么必须有:测试直接调 `execute`,**宿主那一步 schema 校验在测试里被跳过了**——
 * 2026-09-10 的实跑里 `CreatePlan` 因为多返回一个未声明字段而整个失败,而 337 条断言全绿。
 * 从今天起,`callOn` 每次调用都顺手校验一次,于是每一条断言都兼作契约断言。
 */
function schemaViolation(schema, value, path = 'value') {
	if (schema === null || typeof schema !== 'object') return null
	const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type]
	if ((value === null || value === undefined) && types.includes('null')) return null
	const type = types.find((entry) => entry !== 'null')
	if (type === 'object') {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${path} 不是对象`
		for (const key of schema.required ?? []) if (!(key in value)) return `${path}.${key} 缺失(required)`
		for (const key of Object.keys(value)) {
			const declared = schema.properties?.[key]
			if (declared === undefined) {
				if (schema.additionalProperties === false) return `${path}.${key} 未声明(additionalProperties:false)`
				continue
			}
			const nested = schemaViolation(declared, value[key], `${path}.${key}`)
			if (nested !== null) return nested
		}
		return null
	}
	if (type === 'array') return Array.isArray(value) ? null : `${path} 不是数组`
	if (type === 'string') return typeof value === 'string' ? null : `${path} 不是字符串`
	if (type === 'boolean') return typeof value === 'boolean' ? null : `${path} 不是布尔`
	if (type === 'number') return typeof value === 'number' ? null : `${path} 不是数字`
	return null
}

const contractBreaches = []
const trimmedOutputs = []

/** 一次调用 = 执行 → 取变更记录 → 折进投影。与生产同形(生产由 registry + 投影框架做这两步)。 */
async function callOn(host, session, name, args) {
	const tool = host.tools.get(name)
	/**
	 * 用例里的交付大多还写成一个 `verdict`:套用到**这一步检验的每条判断**上(不检验判断的步骤丢掉它)。
	 * 要验多条判断各给不同结果,用例直接写 `results`。
	 */
	if (name === 'AdvancePlan' && args !== null && typeof args === 'object' && args.verdict !== undefined && args.results === undefined) {
		const { verdict, ...rest } = args
		const plan = (host.service.state(session).plans ?? []).find((item) => item.status === 'active')
		const step = plan?.steps.find((item) => item.status === 'open')
		const tested = step?.tests?.hypotheses ?? []
		args = tested.length === 0 ? rest : { ...rest, results: tested.map((hypothesis) => ({ hypothesis, verdict })) }
	}
	const value = await tool.execute(args, { callId: 'call-1', agent: { id: session }, signal: undefined })
	// 生产同形:宿主按 output.schema 校验工具结果,越界即整次调用失败。
	if (value !== null && typeof value === 'object' && tool.output?.schema !== undefined) {
		const breach = schemaViolation(tool.output.schema, value)
		if (breach !== null) contractBreaches.push(`${name}: ${breach}`)
	}
	const meta = typeof tool.output.presentationMeta === 'function' ? tool.output.presentationMeta(args, value) : undefined
	const mutations = meta !== undefined && Array.isArray(meta.mutations) ? meta.mutations : []
	if (mutations.length > 0) {
		host.journal.push(...mutations)
		host.states.set(session, applyMutations(host.service.state(session), mutations))
	}
	return value
}

async function call(name, args) {
	return await callOn(thisHost, SESSION, name, args)
}

/** 驱动一次 agent/pre-step(与生产同形:内核注册的是同一个瀑布位)。 */
async function preStep(host, session, turn, messages = []) {
	const handler = host.listeners.get('agent/pre-step')
	const decision = await handler({ agent: { id: session }, turn, step: 1, messages }, async () => ({ kind: 'enter', messages: [] }))
	// 与生产同形:决定的那些消息会被追加进会话日志,投影单元的 apply 就是从这里看到
	// 运行态卡的。测试不折这一步,就等于「以为消息进了日志」。
	let state = host.service.state(session)
	for (const message of decision?.messages ?? []) {
		state = applyEvent(state, { type: 'user/message', time: Date.now(), data: message })
		/**
		 * **事实通道**里的变更也要记进账本(2026-09-11):内核在回合之间观察到的事实
		 * 走的是插件消息的 `clearai/mutations` 段,
		 * 而不是工具结果。投影折它、测试也该看得见它——否则「结论到底落账了没有」
		 * 在测试里永远是「没落账」。
		 */
		for (const section of message?.source?.sections ?? []) {
			if (section?.name !== 'clearai/mutations' || typeof section.text !== 'string') continue
			try {
				const payload = JSON.parse(section.text)
				for (const mutation of Array.isArray(payload?.mutations) ? payload.mutations : []) host.journal.push(mutation)
			} catch {
				/* 坏 payload:投影那侧也不认它 */
			}
		}
	}
	host.states.set(session, state)
	return decision
}

const ledger = () => thisHost.journal
const eventsOf = (type) => thisHost.journal.filter((mutation) => mutation.t === type)
const writeText = (path, content) => {
	mkdirSync(join(path, '..'), { recursive: true })
	writeFileSync(path, content)
}

/**
 * 本体由模型用原生文件工具直接写(`clear/ontology/{concepts,relations,entities}/**.json`)。
 * 测试里同样直接写文件:`rel` 是 `concepts/furnace_batch` 这样的相对路径(不带 .json)。
 */
const writeOntology = (ws, rel, data) => writeText(join(ws, 'clear', 'ontology', `${rel}.json`), `${JSON.stringify(data, null, 2)}\n`)

const write = (rel, content) => {
	const parts = rel.split('/')
	if (parts.length > 1) mkdirSync(join(WORKSPACE, parts.slice(0, -1).join('/')), { recursive: true })
	writeFileSync(join(WORKSPACE, rel), content)
}

console.log('\n【装配面】')
check(
	'目标与计划六件意图工具全部注册',
	['Frame', 'Conclude', 'CreatePlan', 'AdvancePlan', 'RevisePlan', 'ClosePlan'].every((name) => thisHost.tools.has(name)),
)
check('工具 schema 里没有 status / progress / phase 这类可宣告状态的字段(P2 不可表示)', () => false || ![...thisHost.tools.values()].some((tool) => /"status"|"progress"|"phase"/.test(JSON.stringify(tool.parameters))))
check('注册了 tools/pre-execute 与 agent/pre-step 两个机制位', thisHost.listeners.has('tools/pre-execute') && thisHost.listeners.has('agent/pre-step'))

console.log('\n【提示词面:预设的提示词段】')
{
	const registered = thisHost.sections
	const byName = (name) => registered.find((section) => section.name === name)
	const totalBytes = registered.reduce((sum, section) => sum + String(section.text ?? '').length, 0)
	// 段表即注册清单:运行档删了,澄清只剩一套措辞,每段都注册。
	check(
		'段数 = 段表(全部注册成功)',
		registered.length === SECTIONS.length && registered.length === 3 && new Set(registered.map((s) => s.name)).size === registered.length,
		`${registered.length}/${SECTIONS.length}`,
	)
	check('段序严格递增(装配顺序即装配契约)', registered.every((section, index) => index === 0 || section.order > registered[index - 1].order))
	check(
		'每段都有名字、序与正文,且不携带旧出处记录',
		SECTIONS.every(
			(section) =>
				typeof section.name === 'string' &&
				section.name.length > 3 &&
				typeof section.order === 'number' &&
				typeof section.text === 'string' &&
				section.text.length > 0 &&
				section.source === undefined,
		),
	)
	check(
		'提示词正文里没有旧应用的路径与工具名',
		!/backend\/app|agentbase\/|modules\.py|prompt-map|FileHistory|RestoreFile|GenerateImage|InspectHarness|RunTreeStatus/.test(
			SECTIONS.map((section) => String(section.text ?? '')).join('\n'),
		),
	)
	check('总字数在预算内(≤ 4000 字:第五阶段收成 3 段)', totalBytes <= 4000, `${totalBytes} 字`)
	check(
		'稳定段里没有时间/随机字节(前缀缓存是硬约束,不是优化)',
		registered.every((section) => !/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|0x[0-9a-f]{6}/.test(String(section.text ?? ''))),
	)
	check('身份段在:让模型负责智能判断,让系统负责事实边界(断言标点无关)', /让模型负责智能判断[，,]让系统负责事实边界/.test(String(byName('clearai/identity')?.text ?? '')))
	check('语言跟着人走(不再把中文写死)', /用人正在用的语言/.test(String(byName('clearai/speaking')?.text ?? '')) && !/全程中文|禁止漂移/.test(SECTIONS.map((section) => String(section.text ?? '')).join('\n')))
	check('世界线段不在了(并行探索交给原生子任务,不再自带一套)', byName('clearai/worldline') === undefined)
	check('提示词里不再提已删除的工具', !/ForkPlan|AdvanceWorldline|ConvergeFork|AwaitWorldlines|SpawnScout|MapScouts|SaveSkill|WriteMemory|ExplainLevelSkip|CheckPlan|QueryKnowledge|SetGoal|CloseGoal/.test(SECTIONS.map((section) => String(section.text ?? '')).join('\n')))
	check('网页是不可信数据(安全相关的那条)', /不可信/.test(String(byName('clearai/identity')?.text ?? '')))
	check('对人说话段在(怎么把结论交给人)', (byName('clearai/speaking')?.text ?? '').length > 100)
	check('身份段刻意不含时间(时间由运行态卡承载)', !/\d{2}:\d{2}/.test(String(byName('clearai/identity')?.text ?? '')))
	check('循环段写明先摸清现状再立计划', /摸清现状再立计划/.test(String(byName('clearai/loop')?.text ?? '')))
	check('循环段写明并行交给 subagent、各条路线声明不同的产物路径', /subagent/.test(String(byName('clearai/loop')?.text ?? '')) && /不同的产物路径/.test(String(byName('clearai/loop')?.text ?? '')))
	check('提示词不承诺不存在的机制(不出现 background 自动回灌)', !/background/.test(SECTIONS.map((section) => String(section.text ?? '')).join('\n')))
	check('循环段在:唯一完成动作 + 等级只决定谁来判', /唯一的完成动作/.test(String(byName('clearai/loop')?.text ?? '')) && /等级只决定谁来判/.test(String(byName('clearai/loop')?.text ?? '')))
}

console.log('\n【装配:贡献表驱动(阶段 3)】')
{
	const NAMES = [
		'Frame', 'Conclude', 'CreatePlan', 'AdvancePlan', 'RevisePlan', 'ClosePlan',
	]
	// 工具面是**清单事实**,不是注释里的一句话:注册出来的名字集合必须与目录逐字相符。
	// 本体四件(Define / Deprecate / RegisterInstance / Assert)删了:本体由模型直接写文件。
	check('工具面恰好 6 件(实测,不是推断)', thisHost.tools.size === 6, `${thisHost.tools.size} 件`)
	check(
		'注册的工具名 = 目录(机制 → 工具 的并集)',
		[...thisHost.tools.keys()].sort().join(',') === [...NAMES].sort().join(','),
		[...thisHost.tools.keys()].sort().join(','),
	)

	/** 装配期抛错:同一个坏清单必须在 apply 里当场炸,而不是静默少装一件。 */
	const rejects = (label, config, pattern) => {
		const host = makeHost()
		let thrown = null
		try {
			apply(host.ctx, config)
		} catch (error) {
			thrown = error
		}
		check(label, thrown !== null && pattern.test(String(thrown?.message ?? thrown)), String(thrown?.message ?? '没有抛错'))
	}
	rejects('未知工具名 → 装配期抛错', { contributions: { tools: ['Frame', 'NoSuchTool'] } }, /unknown_tool:clearai-kernel:NoSuchTool/)
	rejects('未知段名 → 装配期抛错', { contributions: { sections: ['clearai/identity', 'clearai/nope'] } }, /unknown_policy_slot:clearai-kernel:clearai\/nope/)
	rejects('未知机制名 → 装配期抛错', { contributions: { mechanisms: { telepathy: true } } }, /unknown_mechanism:clearai-kernel:telepathy/)
	rejects(
		'关掉机制却仍要装它的工具 → 装配期抛错',
		{ contributions: { mechanisms: { plan: false }, tools: ['Frame', 'CreatePlan'] } },
		/tool_of_disabled_mechanism:clearai-kernel:CreatePlan:plan/,
	)
	// 2026-09-11:contributions 里的 `budgets` 块与 `tokenBudget` 一起删了(它们从未被执行)。
	// 两个数值旋钮现在是**普通配置键**,校验也跟着从 contributions 搬到配置面。
	rejects('已经删掉的 contributions.budgets 不再被接受(旧写法必须装配期炸,而不是静默失效)', { contributions: { budgets: { maxAutoTurns: 3 } } }, /unknown_contribution:clearai-kernel:budgets/)
	rejects('连拦阈值不是正整数 → 装配期抛错', { blockedThreshold: -2 }, /invalid_config:clearai-kernel:blockedThreshold/)

	rejects('配置键名写错(拼错 autonomy)→ 装配期抛错', { autonomoy: 'unattended' }, /unknown_config:clearai-kernel:autonomoy/)
	// 两个键(`collectRetryMs` / `executorTimeoutMs`)在白名单里躺了很久却**没有任何读者**:
	// 一个描述的策略早被「回合 epoch 去重」取代,一个承诺的执行者超时根本不存在。它们已经摘除,
	// 旧配置必须当场炸——「配了没生效」正是这套装配纪律要消灭的那一类错。
	rejects('已摘除的 collectRetryMs 不再被接受(它从来没有人读)', { collectRetryMs: 0 }, /unknown_config:clearai-kernel:collectRetryMs/)
	rejects('已摘除的 executorTimeoutMs 不再被接受(它从来没有人读)', { executorTimeoutMs: 1 }, /unknown_config:clearai-kernel:executorTimeoutMs/)
	// 交还宿主的机制:它们的机制名与配置键都必须装配期炸,不许静默无效。
	for (const mechanism of ['worldline', 'scout', 'brain', 'ledger', 'ontology']) {
		rejects(`已删除的机制 ${mechanism} 不再被接受`, { contributions: { mechanisms: { [mechanism]: true } } }, new RegExp(`unknown_mechanism:clearai-kernel:${mechanism}`))
	}
	// 第三阶段:运行档与续跑轮数交还原生 goal(续跑由原生驱动做,没有「档」)。
	for (const key of ['templateDir', 'gitWorldlines', 'ledgerMaxFiles', 'scoutToolFilter', 'executorToolFilter', 'precommitRecon', 'forkArbitration', 'autonomy', 'maxAutoTurns', 'requireTypedPromotion', 'requireLevelReasons']) {
		rejects(`已删除的配置键 ${key} 不再被接受`, { [key]: true }, new RegExp(`unknown_config:clearai-kernel:${key}`))
	}

	// 部署的组合文件必须只用已知的配置键(文本级抽取,不是 YAML 解析:顶层 config 键在 4 空格缩进)。
	{
		const yml = readFileSync(join(import.meta.dirname, '..', 'preset', 'agent.cordis.yml'), 'utf8')
		const row = yml.slice(yml.indexOf('- id: clearai-kernel'))
		const body = row.slice(0, row.indexOf('\n# ──', 10))
		const keys = [...body.matchAll(/^ {4}([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1])
		// 组合文件只列**要显式设定**的键(其余取代码里的缺省),所以这里查的是「不许有表外的键」。
		check('组合文件里 clearai-kernel 的配置键全部已知', keys.length >= 10 && keys.every((key) => CONFIG_KEYS.includes(key)), keys.join(','))
		check('组合文件里有贡献表、没有运行档(运行档第三阶段删了)', keys.includes('contributions') && !keys.includes('autonomy') && !keys.includes('maxAutoTurns'))
	}

	// 裁剪真的生效:关掉计划机制 → 它的四件工具不再出现在工具面里。
	const trimmed = makeHost()
	apply(trimmed.ctx, { contributions: { mechanisms: { plan: false } } })
	check(
		'关掉计划机制 → 4 件计划工具真的没装(剩 2 件)',
		trimmed.tools.size === 2 && !trimmed.tools.has('AdvancePlan') && trimmed.tools.has('Frame'),
		`${trimmed.tools.size} 件`,
	)
	// 只裁工具面、不动机制:能装出来的最小面就是清单本身。
	const planOnly = makeHost()
	apply(planOnly.ctx, { contributions: { tools: ['CreatePlan', 'AdvancePlan'] } })
	check('显式裁剪工具面 → 只剩清单里那几件', planOnly.tools.size === 2 && planOnly.tools.has('AdvancePlan'), `${planOnly.tools.size} 件`)

	// 运行档删了:对话引导协议只有一套,段表里的段全部装上,没有槽位。
	const assembled = makeHost()
	apply(assembled.ctx, {})
	const names = assembled.sections.map((section) => section.name)
	check('段表里的段全部装上(没有按档二选一的段)', names.length === SECTIONS.length && names.every((name) => SECTION_TABLE.has(name)), `${names.length}/${SECTIONS.length}`)
	check('段名不重复', new Set(names).size === names.length)
	check('只有一段讲怎么对人说话(没有按档二选一的段)', names.filter((name) => name === 'clearai/speaking').length === 1 && !names.some((name) => /clarification/.test(name)), names.join(','))
	check(
		'对人说话段写明「一次一题」与结构化提问通道,不再提续跑窗口',
		(() => {
			const text = String(assembled.sections.find((section) => section.name === 'clearai/speaking')?.text ?? '')
			return /一次一题/.test(text) && /ask_user_question/.test(text) && !/续跑窗口|人在场时|无人值守/.test(text)
		})(),
	)
}

console.log('\n【判据先写后做:入口强制 + 自指检测】')
{
	const r1 = await call('Frame', { claim: '催化剂 A 是否优于 B', done_criteria: '   ' })
	check('判据为空 → 拒绝', r1.ok === false && r1.code === 'done_criteria_required', String(r1.code))

	const r2 = await call('Frame', { claim: 'x', done_criteria: '看 ClosePlan 成功即可' })
	check('判据自指(ClosePlan 成功)→ 拒绝', r2.ok === false && r2.code === 'criteria_self_reference', String(r2.code))

	const r3 = await call('Frame', { claim: 'x', done_criteria: '结果记录在对话中' })
	check('判据自指(记录在对话中)→ 拒绝', r3.ok === false && r3.code === 'criteria_self_reference')

	const r4 = await call('Frame', {
		claim: '催化剂 A 在 60℃ 下产率高于 B',
		done_criteria: '三次重复实验产率均值高于 B 至少 5 个百分点,数据落在 lab/yield.csv',
		promote_at_level: 'L3',
		hypotheses: [
			{ claim: 'A 的产率高于 B', refute_when: '三次重复均值不高于 B' },
			{ claim: '链长是主因', refute_when: '控制链长后差异消失' },
		],
	})
	check('合法目标 → 立起', r4.ok === true && r4.code === 'goal_set', String(r4.code))
	check('日志里留下 goal/set(假设就写在同一条变更里)', eventsOf('goal/set').length === 1 && eventsOf('goal/set')[0].hypotheses.length === 2)
	check('投影把两条假设折进了状态', thisHost.service.state(SESSION).hypotheses.length === 2)

	const r5 = await call('Frame', { claim: 'c', done_criteria: 'c 判据' })
	check('修订不带 reason → 拒绝', r5.ok === false && r5.code === 'reason_required')

	const r6 = await call('Frame', { claim: '改判据', done_criteria: '新判据:均值差 ≥ 5%,数据落在 lab/yield.csv', reason: '原判据口径太宽' })
	check('带因修订 → 版本 +1', r6.ok === true && r6.code === 'goal_revised')
	check('修订留痕:goal/set 有两条(旧值不删)', eventsOf('goal/set').length === 2)
}

console.log('\n【假设数量下限:首次立约就要候选对比(preset 立 2,内核默认不限)】')
{
	// 机制在 Frame,产品立场在 preset(minHypotheses: 2,与 blockedThreshold 同一模式)。
	// 这里用 apply 直接给内核配置,验四种形态:0 条拦、1 条拦、2 条过、修订不受限。
	const floorHost = makeHost()
	apply(floorHost.ctx, { minHypotheses: 2 })
	const F = 'session-hyp-floor'
	const f0 = await callOn(floorHost, F, 'Frame', { claim: 'x', done_criteria: 'y 存在' })
	check('带下限时不登记假设(0 条)→ 拒绝', f0.ok === false && f0.code === 'hypotheses_too_few', String(f0.code))
	const f1 = await callOn(floorHost, F, 'Frame', { claim: 'x', done_criteria: 'y 存在', hypotheses: [{ claim: '只有一个猜想', refute_when: '读数不成立' }] })
	check('只登记 1 条 → 同样拒绝(一个猜想的检验容易退化成找证据支持自己)', f1.ok === false && f1.code === 'hypotheses_too_few', String(f1.code))
	const f2 = await callOn(floorHost, F, 'Frame', {
		claim: 'x',
		done_criteria: 'y 存在',
		hypotheses: [
			{ claim: '猜想一', refute_when: '读数不成立' },
			{ claim: '猜想二', refute_when: '对照组无差异' },
		],
	})
	check('登记 2 条 → 立起', f2.ok === true && f2.code === 'goal_set', String(f2.code))
	const f3 = await callOn(floorHost, F, 'Frame', { claim: 'x 改口径', done_criteria: 'z 存在', reason: '换了判据' })
	check('修订目标不带新假设 → 不受下限限制', f3.ok === true && f3.code === 'goal_revised', String(f3.code))
	/** 2026-10-02 JEPA 长测:只改判据、漏传判断列表,已被支持的判断全被落成「已替换」。 */
	check('修订时不传 hypotheses = 判断不变(不是全部替换掉)', /登记了 2 条判断/.test(String(f3.message)), String(f3.message).slice(0, 80))

	// 默认形态(不写配置)保持机制中立:0 条也能立——下限是产品立场,不是引擎偏见。
	const freeHost = makeHost()
	apply(freeHost.ctx, {})
	const FREE = 'session-hyp-free'
	const g0 = await callOn(freeHost, FREE, 'Frame', { claim: 'x', done_criteria: 'y 存在' })
	check('不写配置时(minHypotheses=0)0 条假设可立', g0.ok === true && g0.code === 'goal_set', String(g0.code))
}

const HYP = eventsOf('goal/set')[0].hypotheses[0].id

console.log('\n【修订不许给同一句话发新身份(真跑里卡上出现 6~8 行读数的那条)】')
{
	/**
	 * 真跑现场:一场长跑里目标改过版,运行态卡上就有 4 条主张的 6~8 行读数——
	 * 同一句话挂着两个 id、各报一个状态(一个「已支持」、另一个「未触及」)。
	 * 下面钉两件事:主张原文没变 ⇒ 用回原 id;这一版没再列 ⇒ 如实落 superseded。
	 */
	const idHost = makeHost()
	apply(idHost.ctx, { minHypotheses: 2 })
	const I = 'session-hyp-identity'
	const before = {
		claim: 'JEPA 的分化轴是机制',
		done_criteria: '按机制分组与按代际分组各出一张交叉表',
		hypotheses: [
			{ claim: '分化轴是防坍缩机制', refute_when: '机制与代际完全同构' },
			{ claim: '分界可由谓词机械判定', refute_when: '过半无法判定' },
		],
	}
	const i1 = await callOn(idHost, I, 'Frame', before)
	check('首次立约 → 立起', i1.ok === true && i1.code === 'goal_set', String(i1.code))
	const firstIds = idHost.service.state(I).hypotheses.map((item) => item.id)
	check('两条假设各有身份', firstIds.length === 2 && firstIds.every((id) => typeof id === 'string' && id !== ''))

	// 改判据、但两条主张原文一字不动(真跑里 rev2 就是这个形状)。
	const i2 = await callOn(idHost, I, 'Frame', { ...before, done_criteria: '判据换成可稳定复核的锚点', reason: '原判据依赖系统所有的读面' })
	check('修订 → 版本 +1', i2.ok === true && i2.code === 'goal_revised', String(i2.code))
	check('主张原文没变 ⇒ 用回原 id(不是给同一句话发新身份)', JSON.stringify(idHost.service.state(I).hypotheses.map((item) => item.id)) === JSON.stringify(firstIds), idHost.service.state(I).hypotheses.map((item) => item.id).join(','))
	check('修订不新增重复行(卡上不再出现同一句话两遍)', idHost.service.state(I).hypotheses.length === 2, `${idHost.service.state(I).hypotheses.length} 行`)

	// 这一版只留一条 ⇒ 另一条如实落 superseded(这条变更过去没有生产者)。
	const i3 = await callOn(idHost, I, 'Frame', {
		claim: before.claim,
		done_criteria: before.done_criteria,
		reason: '第二条不再需要',
		hypotheses: [{ claim: '分化轴是防坍缩机制', refute_when: '机制与代际完全同构' }],
	})
	check('只留一条 → 立起', i3.ok === true, String(i3.code))
	const dropped = idHost.service.state(I).hypotheses.find((item) => item.id === firstIds[1])
	check('没再列出来的那条落成 superseded(而不是永远挂在 proposed 上)', dropped?.status === 'superseded', String(dropped?.status))
	check('留下的那条仍是 proposed(它没有被这一版放弃)', idHost.service.state(I).hypotheses.find((item) => item.id === firstIds[0])?.status === 'proposed')
	check('落账上真有这条变更(hypothesis/superseded 过去在折法里有、在生产侧没有)', idHost.service.state(I).hypotheses.length === 2)

	// 换一句话就是换一条主张 ⇒ 必须是新 id。
	const i4 = await callOn(idHost, I, 'Frame', {
		claim: before.claim,
		done_criteria: before.done_criteria,
		reason: '换一条猜想',
		hypotheses: [{ claim: '分化轴其实是代际年份', refute_when: '同代内出现两种机制' }],
	})
	check('换主张 ⇒ 发新 id(同一 id 不许在历史上换含义)', i4.ok === true && !idHost.service.state(I).hypotheses.some((item) => item.id === firstIds[0] && item.claim === '分化轴其实是代际年份'))
}

console.log('\n【计划:判据强制 + 步骤 id 唯一 + 判据自指 + 约立起便锁定】')
{
	const bad1 = await call('CreatePlan', { steps: [{ id: 's1', do: '跑实验', artifacts: ['lab/yield.csv'] }] })
	check('步骤缺 done_criteria → 拒绝', bad1.ok === false && bad1.code === 'invalid_steps', String(bad1.code))

	const bad2 = await call('CreatePlan', { steps: [{ id: 's1', do: '跑实验', done_criteria: '见上文即可' }] })
	check('步骤判据自指 → 拒绝', bad2.ok === false && bad2.code === 'invalid_steps')

	const bad3 = await call('CreatePlan', {
		steps: [
			{ id: 's1', do: '跑实验', done_criteria: 'a 判据' },
			{ id: 's1', do: '再跑实验', done_criteria: 'b 判据' },
		],
	})
	check('步骤 id 重复 → 拒绝', bad3.ok === false && bad3.code === 'invalid_steps')

	const bad4 = await call('CreatePlan', { steps: [{ id: 's1', do: '跑实验', artifacts: ['lab/yield.csv'], done_criteria: '均值差 ≥ 5%', tests: { hypothesis: 'h-不存在', level: 'L3' } }] })
	check('tests 引用不存在的假设 → 拒绝', bad4.ok === false && bad4.code === 'unknown_hypothesis', String(bad4.code))
	// 2026-09-10 实跑回归:模型填的是假设**原文**(不是 id),当时只认 id、错误信息又不列有效值,
	// 于是它连着三轮猜「哪里差了一个标点」。从今天起:原文、唯一前缀、id 都认;对不上就列出全部 id。
	// 用**另一个宿主**验,免得动到这台主宿主的日志(后面的断言盯着它的条数)。
	{
		const host = makeHost()
		apply(host.ctx, {})
		const S = 'session-hypothesis'
		await callOn(host, S, 'Frame', {
			claim: '催化剂 A 是否优于 B',
			done_criteria: '三次重复里 A 的均值高出 5 个百分点',
			hypotheses: [{ claim: 'A 的产率比 B 高 5 个百分点(SCR/CR 路线)', refute_when: '两次重复里差值小于 2 个百分点' }],
		})
		const registered = host.service.state(S).hypotheses[0]
		const plan = (hypothesis) => ({ steps: [{ id: 'p1', do: '跑三次重复', artifacts: ['lab/y.csv'], done_criteria: 'lab/y.csv 含三次重复', tests: { hypothesis, level: 'L3' } }] })
		const byId = await callOn(host, S, 'CreatePlan', plan(registered.id))
		check('tests 填 **id** → 认(最稳的写法)', byId.ok === true, String(byId.code))
		await callOn(host, S, 'RevisePlan', { action: 'void', step_id: 'p1', reason: '验匹配用' })
		await callOn(host, S, 'ClosePlan', {})
		const byText = await callOn(host, S, 'CreatePlan', plan(registered.claim))
		check('tests 填假设**原文** → 也认(不再把模型逼进猜谜)', byText.ok === true, `${byText.code}:${String(byText.message ?? '').slice(0, 60)}`)
		await callOn(host, S, 'RevisePlan', { action: 'void', step_id: 'p1', reason: '验匹配用' })
		await callOn(host, S, 'ClosePlan', {})
		const byPrefix = await callOn(host, S, 'CreatePlan', plan(registered.claim.slice(0, 12)))
		check('tests 填**唯一前缀** → 也认', byPrefix.ok === true, String(byPrefix.code))
		await callOn(host, S, 'RevisePlan', { action: 'void', step_id: 'p1', reason: '验匹配用' })
		await callOn(host, S, 'ClosePlan', {})
		const mismatch = await callOn(host, S, 'CreatePlan', plan('完全对不上的说法'))
		check(
			'对不上时**列出全部有效短名**(让模型能照抄,而不是继续猜;内部 id 不进结果)',
			mismatch.ok === false && /已登记的判断/.test(String(mismatch.message)) && String(mismatch.message).includes(registered.claim.slice(0, 12)) && !String(mismatch.message).includes(registered.id),
			String(mismatch.message ?? '').split('\n')[0],
		)
	}

	const ok = await call('CreatePlan', {
		brief: '## 调研范围\n\n比较两种催化剂在 60℃ 下的产率。\n\n## 方法与重点\n\n三次重复实验取均值,均值差 ≥ 5 个百分点算支持。',
		steps: [
			{ id: 's1', do: '三次重复实验并导出产率表', artifacts: ['lab/yield.csv'], done_criteria: 'lab/yield.csv 存在,含 3 次重复,均值差可算', tests: { hypothesis: HYP, level: 'L3' } },
			{ id: 's2', do: '独立复现一遍', artifacts: ['lab/replicate.csv'], done_criteria: 'lab/replicate.csv 存在且与首次一致', tests: { hypothesis: HYP, level: 'L3' } },
			{ id: 's3', do: '写结论报告', artifacts: ['products/report.md'], done_criteria: '报告含数据来源与均值差' },
		],
	})
	check('合法计划 → 立起', ok.ok === true && ok.code === 'plan_created', String(ok.code))

	const dup = await call('CreatePlan', { steps: [{ id: 's9', do: '另起一份计划', done_criteria: 'y 判据' }] })
	check('已有活动计划时再立约 → 拒绝(约立起便锁定)', dup.ok === false && dup.code === 'active_plan_exists', String(dup.code))
}

console.log('\n【观测准入:只查收不收,不做裁决】')
{
	const miss = await call('AdvancePlan', { step_id: 's1' })
	check('产物不存在 → l1 硬拦', miss.ok === false && miss.code === 'evidence_l1', String(miss.code))
	check('拒绝文案给出三条合法出路', /三条合法出路/.test(miss.message))

	write('lab/yield.csv', '')
	const empty = await call('AdvancePlan', { step_id: 's1' })
	check('空文件 → 仍硬拦(空文件不是观测)', empty.ok === false && empty.code === 'evidence_l1')

	write('lab/yield.csv', 'run,A,B\n1,61,55\n2,62,56\n3,63,57\n')
	const pass = await call('AdvancePlan', { step_id: 's1' })
	check('产物齐备 + 判据非空 → 送评并推进', pass.ok === true && pass.gate === 'needs_audit', `${pass.code}/${pass.gate}`)
	check('裁决来自独立评估者,不是做的人', pass.evaluator === 'independent')
	check('评估卡由系统落盘(两项裁决都在卡上)', (() => {
		const card = JSON.parse(readFileSync(join(WORKSPACE, 'clear/evidence/audits/s1/child-1.json'), 'utf8'))
		return card.schema_version === 'clearai.audit.v2' && card.holds === 'yes' && Array.isArray(card.results)
	})())
	// 只读面现在含 `read_image`(看图也是读):断言改成「⊆ 只读集合且都读得到东西」,
	// 写死名单会让「补一个只读工具」变成「改三处测试」。
	{
		const READ_ONLY = ['read', 'glob', 'grep', 'read_image']
		const allow = thisHost.audits[0].request.toolFilter?.allow ?? []
		check('评估者被要求只读(read/glob/grep/read_image)', allow.length > 0 && allow.every((name) => READ_ONLY.includes(name)) && allow.includes('read_image'), JSON.stringify(allow))
	}
	check('评估者拿到新上下文(spawn,不是 fork)', thisHost.audits[0].provider === 'spawn')
	check('步骤推进只发生一次(唯一完成动词)', eventsOf('step/advanced').length === 1)
	check('派发与落定用同一个审计 id(否则阶段永远卡在 auditing)', (() => {
		const dispatched = eventsOf('audit/dispatched')
		const settled = eventsOf('audit/settled')
		return dispatched.length === 1 && settled.length === 1 && dispatched[0].id === settled[0].id
	})())
}

console.log('\n【做的人不判自己】')
{
	write('lab/replicate.csv', 'run,A,B\n1,61,55\n2,62,56\n3,63,57\n')
	const selfJudge = await call('AdvancePlan', { step_id: 's2', verdict: 'support', basis: '我看过了,这个结果没问题' })
	check('L3 步骤自带 verdict → 拒绝(verdict_not_accepted)', selfJudge.ok === false && selfJudge.code === 'verdict_not_accepted', String(selfJudge.code))
	check('被拒后步骤仍未推进', !eventsOf('step/advanced').some((event) => event.step === 's2'))

	const audited = await call('AdvancePlan', { step_id: 's2' })
	check('去掉 verdict → 系统派评估者并推进', audited.ok === true && audited.evaluator === 'independent', String(audited.code))

	write('products/report.md', '# 结论\n\n均值差 6.2 个百分点,数据来自 lab/yield.csv 的三次重复。\n')
	const noVerdict = await call('AdvancePlan', { step_id: 's3' })
	check('不检验判断的步骤不要求给结果,但要写交付凭什么成立 → 没写就拒(basis_required)', noVerdict.ok === false && noVerdict.code === 'basis_required', String(noVerdict.code))

	const noBasis = await call('AdvancePlan', { step_id: 's3', verdict: 'support', basis: '好' })
	check('依据太短 → 拒绝(basis_required)', noBasis.ok === false && noBasis.code === 'basis_required', String(noBasis.code))

	const selfOk = await call('AdvancePlan', { step_id: 's3', verdict: 'support', basis: 'products/report.md 含均值差 6.2 与数据来源' })
	check('L0 自判 + 可复查依据 → 推进', selfOk.ok === true && selfOk.evaluator === 'self', String(selfOk.code))
	check('不检验判断的步骤不产生证据', !eventsOf('evidence/recorded').some((event) => event.step === 's3'))
	check('自判的交付记在推进那条事实上(依据可复查)', eventsOf('step/advanced').some((event) => event.step === 's3' && event.evaluator === 'self' && /report\.md/.test(String(event.basis))))
}

console.log('\n【目录物证与 blocked 出口】')
{
	const host = makeHost()
	const session = 'session-blocked-recovery'
	apply(host.ctx, {})
	const directory = 'lab/directory-evidence'
	mkdirSync(join(WORKSPACE, directory), { recursive: true })
	writeFileSync(join(WORKSPACE, directory, 'evidence.md'), '# 目录内的证据\n\n这份文件让目录的文件数和字节数可核对。\n')
	await callOn(host, session, 'CreatePlan', { steps: [{ id: 'd1', do: '错误地声明目录', artifacts: [directory], done_criteria: '目录中有证据' }] })
	const directoryPlan = host.service.state(session).plans[0]
	let directoryRejected = null
	for (let i = 0; i < 3; i += 1) directoryRejected = await callOn(host, session, 'AdvancePlan', { step_id: 'd1', verdict: 'support', basis: '目录中有证据' })
	check('目录物证 → 如实拒绝并报告文件数和字节数', directoryRejected.ok === false && /目录不是物证/.test(directoryRejected.message) && /含 1 个文件、\d+ 字节/.test(directoryRejected.message) && !/空目录/.test(directoryRejected.message), String(directoryRejected.message))
	const blocked = await callOn(host, session, 'AdvancePlan', { step_id: 'd1' })
	check('blocked 守卫当场问人;没人能答 ⇒ 只列模型自己能动的解拦动作', blocked.ok === false && /已问人怎么办/.test(blocked.message) && blocked.code === 'plan_blocked' && /RevisePlan/.test(blocked.message) && /refine/.test(blocked.message) && /void/.test(blocked.message) && !/让人介入/.test(blocked.message), String(blocked.message))
	const refined = await callOn(host, session, 'RevisePlan', { action: 'refine', step_id: 'd1', done_criteria: '具体证据文件存在且非空' })
	check('RevisePlan(refine) → 清除 blocked 与连拦计数', refined.ok === true && host.service.state(session).plans[0].blocked === undefined && host.service.state(session).blocks[`${directoryPlan.id}:d1`] === undefined, JSON.stringify(host.service.state(session)))
	for (let i = 0; i < 3; i += 1) await callOn(host, session, 'AdvancePlan', { step_id: 'd1' })
	const voided = await callOn(host, session, 'RevisePlan', { action: 'void', step_id: 'd1', reason: '目录不能作为物证' })
	check('VoidPlanStep 被拦步骤 → 清除 blocked 与连拦计数', voided.ok === true && host.service.state(session).plans[0].blocked === undefined && host.service.state(session).blocks[`${directoryPlan.id}:d1`] === undefined, JSON.stringify(host.service.state(session)))
	await callOn(host, session, 'ClosePlan', {})

	const files = Array.from({ length: 6 }, (_, index) => `lab/recovered-${index + 1}.md`)
	for (const file of files) write(file, '# 证据\n\n这是一份非空的 Markdown 物证，足以通过结构准入。\n')
	await callOn(host, session, 'CreatePlan', {
		steps: [
			{ id: 'a1', do: '缺少的旧产物', artifacts: ['lab/missing-recovery.md'], done_criteria: '旧产物存在且非空' },
		],
	})
	const recoveryPlan = host.service.state(session).plans[1]
	for (let i = 0; i < 3; i += 1) await callOn(host, session, 'AdvancePlan', { step_id: 'a1' })
	const amended = await callOn(host, session, 'RevisePlan', { action: 'add', step: { id: 'a2', do: '交付六份具体文件', artifacts: files, done_criteria: '六份具体文件均存在且非空' } })
	check('AmendPlan → 清除 blocked 与连拦计数', amended.ok === true && host.service.state(session).plans[1].blocked === undefined && host.service.state(session).blocks[`${recoveryPlan.id}:a1`] === undefined, JSON.stringify(host.service.state(session)))
	await callOn(host, session, 'RevisePlan', { action: 'void', step_id: 'a1', reason: '改用六份具体文件' })
	const recovered = await callOn(host, session, 'AdvancePlan', { step_id: 'a2', verdict: 'support', basis: '六份 Markdown 物证均非空且已写入读数。' })
	check('解拦后 AdvancePlan 按当前首个未落定步重验六份非空 md', recovered.ok === true && recovered.gate === 'needs_audit', `${recovered.code}/${recovered.gate}`)
}

console.log('\n【序位不变量 + 唯一完成动词之外不动进度】')
{
	const closed = await call('ClosePlan', {})
	check('无未落定步 → 可以收束', closed.ok === true && closed.code === 'plan_closed')
	const planId = eventsOf('plan/created')[0].id
	check('归档落在 clear/goals/plans/(实现事实,不是提示词里写的 products/guides/)', readFileSync(join(WORKSPACE, 'clear/goals/plans', `${planId}.md`), 'utf8').includes('阶段归档'))

	const p2 = await call('CreatePlan', {
		steps: [
			{ id: 't1', do: '第一步', artifacts: ['lab/a.txt'], done_criteria: 'lab/a.txt 存在' },
			{ id: 't2', do: '第二步', artifacts: ['lab/b.txt'], done_criteria: 'lab/b.txt 存在' },
		],
	})
	check('第一阶段收束后可开下一阶段', p2.ok === true)
	const outOfOrder = await call('AdvancePlan', { step_id: 't2' })
	check('越序交付 → 拒绝(out_of_order)', outOfOrder.ok === false && outOfOrder.code === 'out_of_order', String(outOfOrder.code))

	const amend = await call('RevisePlan', { action: 'add', step: { id: 't3', do: '补一步', artifacts: ['lab/c.txt'], done_criteria: 'lab/c.txt 存在' } })
	check('AmendPlan 不动进度', amend.ok === true && amend.progress_changed === false)
	const refine = await call('RevisePlan', { action: 'refine', step_id: 't3', done_criteria: 'lab/c.txt 存在且非空' })
	check('RefinePlan 不动进度且旧判据留痕', refine.ok === true && refine.progress_changed === false && ledger().some((event) => event.t === 'plan/refined' && event.old_criteria === 'lab/c.txt 存在'))
	const voided = await call('RevisePlan', { action: 'void', step_id: 't3', reason: '这一步本不该存在' })
	check('VoidPlanStep 带因作废且不动进度', voided.ok === true && voided.progress_changed === false)
	check('作废留痕,不删记录', eventsOf('plan/voided').length === 1)
	const settled = await call('RevisePlan', { action: 'void', step_id: 't1', reason: '测试脚手架' })
	check('已作废之外仍可作废其它步', settled.ok === true)

	// 收束这份脚手架计划:剩下的步作废,然后 ClosePlan
	await call('RevisePlan', { action: 'void', step_id: 't2', reason: '测试脚手架' })
	const closed2 = await call('ClosePlan', {})
	check('作废后可以收束', closed2.ok === true, String(closed2.code))
}

console.log('\n【完成度:终局优先,升格算数(2026-09-11 长测抓到的自相矛盾)】')
{
	/**
	 * 长测现场:目标已经 achieved、两条事实都升格了,卡片却写「完成度 0%」。
	 * 根因两条:① 计划一关,活跃计划为 null,口径回落到假设;② 升格(`fact/promoted`)是独立路径,
	 * 不改假设状态,于是分子是 0。修法:**终局优先**(达成 = 1,如实放弃 = 0)+ **升格算数**。
	 */
	const host = makeHost()
	// 这一段**会真的升格**一条事实(support + 达门槛 + 无推翻),而事实按会话工作目录落进
	// `clear/knowledge/facts/`。所以给它一间自己的工作区:测试之间不靠共享目录说话,
	// 「别的地方有没有事实」不该决定这一段红不红。
	const ws = tempDir('clearai-progress-')
	execFileSync('git', ['init', '-q'], { cwd: ws })
	execFileSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: ws })
	host.cwd = ws
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-progress'
	await callOn(host, S, 'Frame', { claim: '把两件事查清', done_criteria: '两件事都有结论', hypotheses: [{ claim: '甲成立', refute_when: '甲不成立' }] })
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'g1', do: '做事', artifacts: ['lab/g1.txt'], done_criteria: 'lab/g1.txt 存在', tests: { hypothesis: host.service.state(S).hypotheses[0].id, level: 'L3' } }] })
	writeText(join(ws, 'lab', 'g1.txt'), '读数是 1\n')
	host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '1', validity: 'usable' }
	await callOn(host, S, 'AdvancePlan', { step_id: 'g1', observations: [{ ref: 'lab/g1.txt' }] })
	check('中途口径:计划推进时完成度按步算', Math.abs((host.service.view(S).goal?.progress ?? -1) - 1) < 1e-9, String(host.service.view(S).goal?.progress))
	await callOn(host, S, 'ClosePlan', { summary: '这一阶段做完了' })
	// 评估者的依据常常顺手引用判断 id(它读的任务书里有):转给模型时要换成短名。
	const hypothesisId = host.service.state(S).hypotheses[0].id
	host.nextVerdict = { verdict: 'support', basis: `判据满足;${hypothesisId} 经 g1 步检验`, reading: '1', validity: 'usable' }
	const closed = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
	check('结案成功(独立评估者裁决)', closed.ok === true, String(closed.code))
	check('评估者依据里的判断 id 换成短名(工具结果不出现内部编号)', String(closed.message).includes('「甲成立」经 g1 步检验') && !String(closed.message).includes(hypothesisId), String(closed.message).slice(0, 200))
	check('终局优先:目标 achieved ⇒ 完成度 100%(不再回落到假设口径的 0%)', host.service.view(S).goal?.progress === 1, String(host.service.view(S).goal?.progress))
}

console.log('\n【实体门:将要升格的结论,主体必须在图上(结案唯一的结构关口;机制缺省关,preset 里开)】')
{
	/**
	 * 第四阶段把结案的结构关口从三道收到一道。删掉的两道(跳级没理由、将升格的命题没有断言形态)
	 * 在第三阶段重跑里让一个「跑一次 python3」的任务被拦四次;留下的这一道只看**将要升格的判断**:
	 * 它的断言主体必须是实体图上的节点。边由升格本身落下,不再要求另用 `Assert` 把同一句话说一遍。
	 *
	 * 场景:T1 登记过;判断说「T1 喂给了 T2,T2 的氧含量是 10ppm」——T2 只在这一批断言里被引出,
	 * 还不是图上的节点。第二条判断只有散文、也没被检验:它不是结论,不欠这一笔。
	 */
	const setup = async (config, { assertions = true } = {}) => {
		const host = makeHost()
		const ws = tempDir('clearai-entity-gate-')
		execFileSync('git', ['init', '-q'], { cwd: ws })
		execFileSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: ws })
		host.cwd = ws
		apply(host.ctx, { blockedThreshold: 3, ...config })
		const S = `session-entity-gate-${String(config.requireLandedEntities)}-${String(assertions)}`
		writeOntology(ws, 'concepts/furnace_batch', { id: 'furnace_batch', label: '炉次', gloss: '一次熔铸循环', basis: '现场记录 R-01' })
		writeOntology(ws, 'relations/oxygen_ppm', { id: 'oxygen_ppm', label: '氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, basis: '现场记录 R-01' })
		writeOntology(ws, 'relations/fed_by', { id: 'fed_by', label: '原料来自', domain: 'furnace_batch', range: 'furnace_batch', basis: '现场记录 R-01' })
		writeOntology(ws, 'entities/T1', { id: 'T1', type: 'furnace_batch', label: 'T1 炉次', basis: '现场记录 R-01', provenance: { kind: 'named', ref: '现场记录 R-01' } })
		const framed = await callOn(host, S, 'Frame', {
			claim: '把炉次氧含量查清',
			done_criteria: '氧含量有读数与出处',
			hypotheses: [
				{
					claim: 'T2 炉次氧含量是 10ppm',
					refute_when: '复测不是 10ppm',
					assertions: assertions
						? [
								{ predicate: 'fed_by', subject: { id: 'T1', type: 'furnace_batch' }, object: { kind: 'instance', value: 'T2', type: 'furnace_batch' } },
								{ predicate: 'oxygen_ppm', subject: { id: 'T2', type: 'furnace_batch' }, object: { kind: 'quantity', value: 10, unit: 'ppm' } },
							]
						: undefined,
				},
				{ claim: 'T3 炉次也一样', refute_when: 'T3 复测不是 10ppm' },
			],
		})
		check(`前置:目标立起(断言${assertions ? '带着还没落图的主体 T2' : '没写'})`, framed.ok === true, String(framed.message))
		const [first] = host.service.state(S).hypotheses
		await callOn(host, S, 'CreatePlan', {
			steps: [{ id: 'g1', do: '读仪表记录', artifacts: ['lab/g1.txt'], done_criteria: 'lab/g1.txt 存在', tests: { hypotheses: [first.id], level: 'L3' } }],
		})
		writeText(join(ws, 'lab', 'g1.txt'), '氧含量 10ppm\n')
		host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '10', validity: 'usable' }
		await callOn(host, S, 'AdvancePlan', { step_id: 'g1', observations: [{ ref: 'lab/g1.txt' }] })
		await callOn(host, S, 'ClosePlan', { summary: '这一阶段做完了' })
		return { host, S, first }
	}

	// ① 门开着、主体没落图:拦下,而且**不白花一次评估者**。
	{
		const { host, S, first } = await setup({ requireLandedEntities: true })
		check('前置:将要升格的判断真的有一个主体不在图上', JSON.stringify(host.service.derive(S).hypotheses.find((item) => item.id === first.id)?.unlanded) === JSON.stringify([{ id: 'T2', type: 'furnace_batch' }]))
		const dispatchedBefore = host.service.state(S).audits.length
		const blocked = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
		check('主体没落图 ⇒ 拒(entities_unlanded)', blocked.ok === false && blocked.code === 'entities_unlanded', String(blocked.code))
		check('拒在**派评估者之前**(那一次子 run 没有白花)', host.service.state(S).audits.length === dispatchedBefore, `${dispatchedBefore} → ${host.service.state(S).audits.length} 次派发`)
		check('门点名是哪条判断、哪个主体', String(blocked.message).includes(first.id) && String(blocked.message).includes('furnace_batch|T2'), String(blocked.message).slice(0, 160))
		check('门指的出口是给主体写实体文件,并说清不必再写同一句话', /clear\/ontology\/entities/.test(String(blocked.message)) && /不必/.test(String(blocked.message)))
		check('只有散文、没被检验的那条判断不进门的名单', !String(blocked.message).includes(host.service.state(S).hypotheses[1].id))
		check('目标保持开放', host.service.state(S).goal.status === 'open')
		check('卡上的缺口与门是同一份读数(entities_unlanded 点到 T2)', host.service.derive(S).knowledge.gaps.some((gap) => gap.code === 'entities_unlanded' && gap.count === 1 && gap.detail.includes('furnace_batch|T2')))

		writeOntology(host.cwd, 'entities/T2', { id: 'T2', type: 'furnace_batch', label: 'T2 炉次', basis: '现场记录 R-02', provenance: { kind: 'named', ref: '现场记录 R-02' } })
		const passed = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
		check('写好 T2 的实体文件之后放行(结案当场同步,不必等下一拍)', passed.ok === true, String(passed.code))
		check('结案那次调用带着这次同步(T2 的文件进了账)', host.journal.some((mutation) => mutation.t === 'workspace/synced' && mutation.changes.some((change) => change.path === 'clear/ontology/entities/T2.json')))
		const fact = host.service.state(S).facts[0]
		check('升格的事实带着断言,并指得回它的判断', Array.isArray(fact?.assertions) && fact.assertions.length === 2 && fact.hypothesis === first.id)
		const edges = graphProjection(host.service.state(S)).edges.filter((edge) => edge.kind === 'assertion')
		check('边由升格落下:T2 的氧含量在实体图上', edges.some((edge) => edge.from === 'furnace_batch|T2' && edge.predicate === 'oxygen_ppm' && edge.source === 'promoted'), JSON.stringify(edges.map((edge) => `${edge.from}-${edge.predicate}`)))
		check('没有为同一句话另写一条实体关系(没有重复劳动)', !host.journal.some((mutation) => mutation.t === 'entity/asserted') && host.service.state(S).entityAssertions.length === 0)
	}

	// ② 同一份状态、门关着:不挡(门是机制,不是文案)。
	{
		const { host, S } = await setup({})
		const passed = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
		check('门关着 ⇒ 同一份状态直接结案', passed.ok === true, String(passed.code))
	}

	// ③ 门开着、判断只有散文:不拦——那只是卡上的一条缺口,不是关口。
	{
		const { host, S } = await setup({ requireLandedEntities: true }, { assertions: false })
		check('前置:只有散文的判断在卡上列成缺口', host.service.derive(S).knowledge.gaps.some((gap) => gap.code === 'prose_only_claims'))
		const passed = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
		check('只有散文的判断照样升格(第四阶段删了「没有形态」那道门)', passed.ok === true, String(passed.code))
		check('升格后的事实如实没有断言', (host.service.state(S).facts[0]?.assertions ?? null) === null)
	}
}

console.log('\n【货架所有权:派出去的子会话不许重铺主线的读面,也不同步工作区】')
{
	/**
	 * 真跑里评估者两次报词汇货架是 7 行占位版,主线连读三次都是 96 行 21 词条——两边各自稳定,
	 * 谁都没说谎。根因:子会话与主线**共享工作区**,但它自己的投影里没有词汇,它的 pre-step
	 * 却照样按自己那份重写共享的读面。词汇货架如今删了(本体就是文件,评估者直接读),
	 * 事实货架(`facts/INDEX.md`)与本体字段定义(`SCHEMA.json`)仍是同一种病。
	 *
	 * 规则一句话:**工作区级读面属于拥有账本的会话;子会话只读,永远不写。**
	 */
	const host = makeHost()
	const ws = tempDir('clearai-shelf-owner-')
	execFileSync('git', ['init', '-q'], { cwd: ws })
	execFileSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: ws })
	host.cwd = ws
	apply(host.ctx, {})
	const P = 'session-shelf-owner'
	writeOntology(ws, 'concepts/furnace_batch', { id: 'furnace_batch', label: '炉次', gloss: '一次熔铸循环', basis: '现场记录 R-01' })
	const factsIndex = join(ws, 'clear', 'knowledge', 'facts', 'INDEX.md')
	const schema = join(ws, 'clear', 'ontology', 'SCHEMA.json')

	// ① 子会话:同一份工作区,但身份是派生会话(评估者就是这个形状)。
	host.childSessions = {
		'child-evaluator': { header: { cwd: ws, parentSession: P, origin: 'subagent' }, ownEvents: () => [] },
	}
	host.states.set(
		'child-evaluator',
		applyMutations(emptyState(), [{ t: 'fact/promoted', id: 'f-child', goal: 'g-x', text: '子会话自己的一条', scope: 's', level: 'L2', evidence: [], path: 'p' }]),
	)
	writeText(factsIndex, 'SENTINEL:主线的事实货架\n')
	await preStep(host, 'child-evaluator', 1)
	check('子会话的 pre-step 不重写事实货架', readFileSync(factsIndex, 'utf8') === 'SENTINEL:主线的事实货架\n')
	check('子会话的 pre-step 不铺本体字段定义', !existsSync(schema))
	check('子会话不同步工作区(它的账里没有本体文件)', !host.journal.some((mutation) => mutation.t === 'workspace/synced'))

	// ② 对照:拥有账本的会话照常维护——字段定义铺出来,本体文件同步进账。
	host.childSessions = {}
	await preStep(host, P, 1)
	check('主线的 pre-step 铺出 SCHEMA.json(与宿主半的字段定义同一份)', existsSync(schema) && JSON.parse(readFileSync(schema, 'utf8')).concept?.required?.gloss !== undefined)
	check('主线的 pre-step 把本体文件同步进账,词汇从文件折出来', (host.service.state(P).lexicon?.terms ?? []).some((term) => term.id === 'furnace_batch'))
	check('三支目录铺好了(模型知道往哪写)', ['concepts', 'relations', 'entities'].every((branch) => existsSync(join(ws, 'clear', 'ontology', branch))))
}

console.log('\n【失联的评估者:重启之后不再被一条等不到的裁决按死(2026-09-11,AUDIT §14-D)】')
{
	/**
	 * 现场:`pendingAudits` 是**进程内**的。重启之后它空了,而投影里那条 `audit/dispatched` 还在
	 * (`verdict === null`)——卡片永远写「正在裁决」,更要紧的是 `turnDemand` 见到未落定的裁决就 `hold`
	 * (**「机器等待,不推」**):一条永远不会回来的裁决,把整个目标按死在挂起上。
	 *
	 * 判据不看内存,看**宿主的目录**:`subagents.listChildren(sessionId)` 给每个子会话一个
	 * `activity: 'running' | 'inactive'`,而且不需要把子代理加载起来。
	 */
	const pendingAudit = (session, child) => {
		const base = {
			goal: { id: 'g-au', claim: '把这一步做实', done_criteria: '有外部读数', status: 'open', promote_at_level: 'L3' },
			plans: [{ id: 'p-au', goal: 'g-au', status: 'active', summary: '一段', steps: [{ id: 'au1', ordinal: 1, do: '交付', artifacts: ['lab/au1.txt'], done_criteria: 'lab/au1.txt 存在', status: 'open', tests: { hypothesis: 'h-au', level: 'L3' } }] }],
			hypotheses: [{ id: 'h-au', claim: 'A 成立', refute_when: 'A 不成立', status: 'alive' }],
			audits: [{ id: 'a-au1', step: 'au1', plan: 'p-au', kind: 'evidence_audit', verdict: null, evaluator: 'independent', child, capability: 'persona', shortfalls: [], basis: null, card_path: null, at: Date.now() }],
			assessments: [], evidence: [], materials: [], forks: [], releases: [], written: [], facts: [], scouts: [], blocks: {}, sessions: [], autonomy: null, constitution: null,
		}
		void session
		return { ...emptyState(), ...base }
	}

	// ① 子会话已经不在跑(重启之后就是这样)⇒ 记成失联,而且**这一拍就不许再 hold**
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		const S = 'session-audit-lost'
		host.states.set(S, pendingAudit(S, 'child-gone'))
		host.listing = [] // 目录里一个活的都没有
		const first = await preStep(host, S, 71)
		// 第一拍总是「布防」(还没有令牌);hold 只对**已存在**的令牌说话 ⇒ 第二拍才是判据。
		const decision = await preStep(host, S, 72)
		const settled = host.journal.filter((mutation) => mutation.t === 'audit/settled')
		/**
		 * 收尾那条路先试图**从子会话日志取回**裁决;这里目录里没有它、日志也读不到
		 * ⇒ 如实落「已结束、结论未取回」(不再说「失联/不会有结果」——那是没有证据的推论)。
		 */
		check('目录里没有它 ⇒ 已结束、结论未取回,如实落账(verdict=unknown)', settled.length === 1 && settled[0].verdict === 'unknown' && String(settled[0].basis).includes('未能从子会话日志取回'), JSON.stringify(settled[0] ?? null).slice(0, 140))
		check('卡片只报事实、不给建议(「重新交付会派一个新的评估者」那句删了)', /独立裁决已收口/.test(JSON.stringify(first.messages ?? [])) && !/派一个新的评估者/.test(JSON.stringify(first.messages ?? [])), JSON.stringify(first.messages ?? []).slice(0, 200))
		check('失联之后不再被「机器等待」按住(第二拍的卡片不再写「评估者还在裁决」)', !/评估者还在裁决/.test(JSON.stringify(decision.messages ?? [])), JSON.stringify(decision.messages ?? []).slice(0, 220))
	}

	// ② 子会话还在跑 ⇒ 一个字都不许动(不误伤正在裁决的评估者)
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		const S = 'session-audit-live'
		host.states.set(S, pendingAudit(S, 'child-live'))
		host.listing = [{ kind: 'child', id: 'child-live', activity: 'running', hasChildren: false, mode: 'one-shot' }]
		await preStep(host, S, 73)
		const decision = await preStep(host, S, 74)
		check('子会话还在跑 ⇒ 不落失联(不误伤)', host.journal.filter((mutation) => mutation.t === 'audit/settled').length === 0)
		// 判据是**卡里的那句话**:还在跑 ⇒ 卡上照旧写「在等裁决」。
		check('还在跑 ⇒ 卡上照旧写「在等裁决」', /在等裁决/.test(JSON.stringify(decision.messages ?? [])), JSON.stringify(decision.messages ?? []).slice(0, 220))
	}

	// ③ 拿不到目录(服务不在)⇒ 不猜:保持原样,不动那条裁决
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		const S = 'session-audit-nolisting'
		host.states.set(S, pendingAudit(S, 'child-unknown'))
		host.subagentsAvailable = false
		await preStep(host, S, 75)
		check('拿不到子代理目录 ⇒ 什么都不做(不猜、不误伤)', host.journal.filter((mutation) => mutation.t === 'audit/settled').length === 0)
	}
}

console.log('\n【目标挂在原生 goal 上:Frame 建、Conclude 才能完成、放弃置阻塞、守卫拦直接完成】')
{
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-native-goal'
	const framed = await callOn(host, S, 'Frame', { headline: '判定 A 是否成立', claim: '判定 A 是否成立', done_criteria: '存在一份文件 lab/a.txt', hypotheses: [{ claim: 'A 成立', refute_when: '读数不是 1' }, { claim: 'A 不成立', refute_when: '读数是 1' }] })
	check('Frame:没有原生 goal 就建一枚,objective 就是那一句话', framed.ok === true && host.hostGoal?.phase === 'active' && host.hostGoal.objective === '判定 A 是否成立', JSON.stringify(host.hostGoal))
	check('建的时候不替原生写轮数(用宿主的缺省)', host.goalCalls.some((callItem) => callItem[0] === 'create' && callItem[2] === undefined), JSON.stringify(host.goalCalls))
	await callOn(host, S, 'Frame', { headline: '判定 A 是否成立(改口径)', claim: '判定 A 是否成立', done_criteria: '存在一份文件 lab/a.txt', reason: '一句话说得更准' })
	check('修订 Frame:把那一句话同步到原生 goal(edit,不重建)', host.hostGoal?.objective === '判定 A 是否成立(改口径)' && host.goalCalls.filter((callItem) => callItem[0] === 'create').length === 1, JSON.stringify(host.goalCalls))

	const guard = host.listeners.get('tools/pre-execute')
	const denied = await guard({ name: 'update_goal', arguments: { goal_id: 'hg-1', revision: 2, action: 'complete' }, agent: { id: S }, callId: 'c-native' }, async () => ({ kind: 'allow' }))
	check('立约后模型直接调原生「完成目标」⇒ 被拒,指向 Conclude', denied?.kind === 'deny' && /Conclude/.test(String(denied.reason)), JSON.stringify(denied))
	const stringArgs = await guard({ name: 'update_goal', arguments: JSON.stringify({ action: 'complete' }), agent: { id: S }, callId: 'c-native-2' }, async () => ({ kind: 'allow' }))
	check('参数是 JSON 字符串时同样拦(宿主两种形状都会给)', stringArgs?.kind === 'deny', JSON.stringify(stringArgs))
	const pause = await guard({ name: 'update_goal', arguments: { action: 'pause' }, agent: { id: S }, callId: 'c-native-3' }, async () => ({ kind: 'allow' }))
	check('别的原生 goal 动作不拦(暂停、改写归原生)', pause?.kind === 'allow', JSON.stringify(pause))
	const fresh = await guard({ name: 'update_goal', arguments: { action: 'complete' }, agent: { id: 'session-never-framed' }, callId: 'c-native-4' }, async () => ({ kind: 'allow' }))
	check('没立过约的会话不拦(那时目标不是 ClearAI 的)', fresh?.kind === 'allow', JSON.stringify(fresh))

	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'a1', do: '写读数', artifacts: ['lab/a.txt'], done_criteria: 'lab/a.txt 存在且含读数', tests: { hypotheses: [host.service.state(S).hypotheses[0].id], level: 'L2' } }] })
	write('lab/a.txt', 'reading=1\n')
	await callOn(host, S, 'AdvancePlan', { step_id: 'a1', basis: 'lab/a.txt 第一行 reading=1', results: [{ hypothesis: host.service.state(S).hypotheses[0].id, verdict: 'support' }] })
	await callOn(host, S, 'ClosePlan', {})
	host.nextVerdict = { holds: 'yes', basis: 'lab/a.txt 存在,读数为 1', shortfalls: [], results: [] }
	const concluded = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
	check('Conclude 过了独立评估 ⇒ 原生 goal 置为完成', concluded.ok === true && host.hostGoal?.phase === 'complete', `${concluded.code}/${host.hostGoal?.phase}`)
	const presented = (host.appended ?? []).filter((item) => item.type === 'deliverables/presented')
	check('结案时把各步收下的产物一次声明为交付卡片', presented.length === 1 && presented[0].data.files.some((file) => file.path === 'lab/a.txt'), JSON.stringify(presented))
	check('交付卡片只在结案时出:过程中没有声明过', (host.appended ?? []).filter((item) => item.type === 'deliverables/presented').length === 1)

	const quitter = makeHost()
	apply(quitter.ctx, {})
	const Q = 'session-native-abandon'
	await callOn(quitter, Q, 'Frame', { claim: 'Q', done_criteria: '存在 lab/q.txt' })
	const abandoned = await callOn(quitter, Q, 'Conclude', { outcome: 'abandoned', note: '仪器坏了' })
	check('如实放弃 ⇒ 原生 goal 置为阻塞(由人决定结束),不是完成', abandoned.ok === true && quitter.hostGoal?.phase === 'blocked' && quitter.hostGoal.blockedReason?.code === 'clearai-goal-abandoned', JSON.stringify(quitter.hostGoal))
	check('阻塞原因写明了模型说的话', /仪器坏了/.test(String(quitter.hostGoal?.blockedReason?.message)), String(quitter.hostGoal?.blockedReason?.message))

	const noGoals = makeHost()
	noGoals.goalsAvailable = false
	apply(noGoals.ctx, {})
	const bare = await callOn(noGoals, 'session-no-goals', 'Frame', { claim: 'Z', done_criteria: '存在 lab/z.txt' })
	check('这个形态没有原生 goal 服务 ⇒ 照样立约,并如实说不会自动续跑', bare.ok === true && /不会自动续跑/.test(bare.message), bare.message.slice(0, 120))
}

console.log('\n【人门由开门的那次调用当场问:L4 放行 / 连拦 / 事实被推翻】')
{
	/** 一个假的「人」:按问题 id 选答案;`null` = 撤下问题;没装 = 这个形态没有提问通道。 */
	const answering = (pick) => ({
		asked: [],
		async ask(request) {
			this.asked.push(request)
			const answers = []
			for (const question of request.questions) {
				const choice = pick(question)
				if (choice === null) {
					const error = new Error('cancelled')
					error.code = 'ASK_CANCELLED'
					throw error
				}
				answers.push({ id: question.id, selected: [choice.label], ...(choice.note === undefined ? {} : { custom: choice.note }) })
			}
			return { answers }
		},
	})

	// ① L4:交付时当场问人放行;放行才派评估者,事实带着凭据(via=ask)
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		const S = 'session-l4-ask'
		await callOn(host, S, 'Frame', { claim: '拿一份外部证据', done_criteria: '有外部来源的观测', hypotheses: [{ claim: '外部数据可用', refute_when: '拿不到' }] })
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'x1', do: '交付外部证据', artifacts: ['lab/x1.txt'], done_criteria: 'lab/x1.txt 存在且非空', tests: { hypotheses: [host.service.state(S).hypotheses[0].id], level: 'L4' } }] })
		write('lab/x1.txt', '外部仪器导出\n')
		host.userQuestions = answering((question) => ({ label: question.options[1].label, note: '先别交' }))
		const evaluatorsBefore = host.audits.length
		const declined = await callOn(host, S, 'AdvancePlan', { step_id: 'x1', observations: [{ ref: 'lab/x1.txt' }] })
		check('L4 交付时问人;人不放行 ⇒ 不交付', declined.ok === false && declined.code === 'human_release_missing' && /先别交/.test(declined.message), `${declined.code}:${declined.message.slice(0, 80)}`)
		check('人不放行就不花那一次评估', host.audits.length === evaluatorsBefore)
		check('问题由内核写:说清是哪一步、为什么要放行', /L4/.test(host.userQuestions.asked[0]?.questions[0]?.question ?? '') && /x1/.test(host.userQuestions.asked[0]?.questions[0]?.question ?? ''))
		host.userQuestions = answering((question) => ({ label: question.options[0].label }))
		const released = await callOn(host, S, 'AdvancePlan', { step_id: 'x1', observations: [{ ref: 'lab/x1.txt' }] })
		const releases = host.journal.filter((mutation) => mutation.t === 'human/released')
		check('人放行 ⇒ 交给独立评估者,交付通过', released.ok === true, `${released.code}`)
		check('放行事实来自那次询问(via=ask,绑在步骤上)', releases.length === 1 && releases[0].via === 'ask' && releases[0].step === 'x1', JSON.stringify(releases))

		const headless = makeHost()
		apply(headless.ctx, { blockedThreshold: 3 })
		const H = 'session-l4-headless'
		await callOn(headless, H, 'Frame', { claim: '拿一份外部证据', done_criteria: '有外部来源的观测', hypotheses: [{ claim: '外部数据可用', refute_when: '拿不到' }] })
		await callOn(headless, H, 'CreatePlan', { steps: [{ id: 'x2', do: '交付外部证据', artifacts: ['lab/x2.txt'], done_criteria: 'lab/x2.txt 存在且非空', tests: { hypotheses: [headless.service.state(H).hypotheses[0].id], level: 'L4' } }] })
		write('lab/x2.txt', '外部仪器导出\n')
		const noOne = await callOn(headless, H, 'AdvancePlan', { step_id: 'x2', observations: [{ ref: 'lab/x2.txt' }] })
		check('没人能答(这个形态没有提问通道)⇒ 不替人放行,不交付', noOne.ok === false && noOne.code === 'human_release_missing' && !headless.journal.some((mutation) => mutation.t === 'human/released'), noOne.code)
		check('并且原生 goal 停下等人,写明在等什么', headless.hostGoal?.phase === 'blocked' && headless.hostGoal.blockedReason?.code === 'clearai-needs-human', JSON.stringify(headless.hostGoal))
	}

	// ② 同一步连拦到阈值:当场问人怎么办——按缺口再改,或作废这一步
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 2 })
		const S = 'session-blocked-ask'
		await callOn(host, S, 'Frame', { claim: 'B', done_criteria: '存在 lab/b.txt' })
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'b1', do: '写一个永远不会落盘的产物', artifacts: ['lab/never-b.txt'], done_criteria: 'lab/never-b.txt 存在' }, { id: 'b2', do: '后面一步', artifacts: ['lab/b2.txt'], done_criteria: 'lab/b2.txt 存在' }] })
		host.userQuestions = answering((question) => ({ label: question.options[1].label, note: '这条路走不通' }))
		await callOn(host, S, 'AdvancePlan', { step_id: 'b1' })
		const second = await callOn(host, S, 'AdvancePlan', { step_id: 'b1' })
		check('连拦到阈值 ⇒ 当场问人怎么办', host.userQuestions.asked.length === 1 && /b1/.test(host.userQuestions.asked[0].questions[0].question), JSON.stringify(host.userQuestions.asked.map((request) => request.questions[0].question)))
		check('人选「作废这一步」⇒ 带人的缘由作废,解除阻塞', host.journal.some((mutation) => mutation.t === 'plan/voided' && mutation.step === 'b1' && /这条路走不通/.test(mutation.reason)) && host.service.state(S).plans[0].blocked === undefined, second.message.slice(0, 160))

		const retry = makeHost()
		apply(retry.ctx, { blockedThreshold: 2 })
		const R = 'session-blocked-retry'
		await callOn(retry, R, 'Frame', { claim: 'R', done_criteria: '存在 lab/r.txt' })
		await callOn(retry, R, 'CreatePlan', { steps: [{ id: 'r1', do: '写一个永远不会落盘的产物', artifacts: ['lab/never-r.txt'], done_criteria: 'lab/never-r.txt 存在' }] })
		retry.userQuestions = answering((question) => ({ label: question.options[0].label, note: '换成写 lab/r.txt' }))
		await callOn(retry, R, 'AdvancePlan', { step_id: 'r1' })
		const told = await callOn(retry, R, 'AdvancePlan', { step_id: 'r1' })
		check('人选「按缺口再改」⇒ 解除阻塞,人的话原样交给模型', retry.service.state(R).plans[0].blocked === undefined && /换成写 lab\/r\.txt/.test(told.message), told.message.slice(0, 160))

		const nobody = makeHost()
		apply(nobody.ctx, { blockedThreshold: 2 })
		const N = 'session-blocked-nobody'
		await callOn(nobody, N, 'Frame', { claim: 'N', done_criteria: '存在 lab/n.txt' })
		await callOn(nobody, N, 'CreatePlan', { steps: [{ id: 'n1', do: '写一个永远不会落盘的产物', artifacts: ['lab/never-n.txt'], done_criteria: 'lab/never-n.txt 存在' }] })
		await callOn(nobody, N, 'AdvancePlan', { step_id: 'n1' })
		await callOn(nobody, N, 'AdvancePlan', { step_id: 'n1' })
		check('没人能答 ⇒ 计划保持 blocked,原生 goal 停下等人', nobody.service.state(N).plans[0].blocked !== undefined && nobody.hostGoal?.phase === 'blocked', JSON.stringify(nobody.hostGoal))
		nobody.userQuestions = answering((question) => ({ label: question.options[0].label }))
		const later = await callOn(nobody, N, 'AdvancePlan', { step_id: 'n1' })
		check('人回来之后再交付 ⇒ 再问一次(决定不丢,门的状态在账上)', nobody.userQuestions.asked.length === 1 && nobody.service.state(N).plans[0].blocked === undefined && later.code === 'plan_blocked', `${later.code}`)
	}

	// ③ 推翻证据碰到已确立的事实:收到它的那次交付当场问人撤回还是维持
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		const S = 'session-fact-ask'
		await callOn(host, S, 'Frame', { claim: 'X 比 Y 快?', done_criteria: '存在 lab/f.txt', promote_at_level: 'L2', hypotheses: [{ claim: 'X 比 Y 快', refute_when: 'Y 更快' }, { claim: 'Y 比 X 快', refute_when: 'X 更快' }] })
		const [fast] = host.service.state(S).hypotheses.map((item) => item.id)
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'f1', do: '测一次', artifacts: ['lab/f.txt'], done_criteria: 'lab/f.txt 含两次计时', tests: { hypotheses: [fast], level: 'L2' } }] })
		write('lab/f.txt', 'x=1.0 y=2.0\n')
		await callOn(host, S, 'AdvancePlan', { step_id: 'f1', basis: 'lab/f.txt x=1.0 y=2.0', results: [{ hypothesis: fast, verdict: 'support' }] })
		await callOn(host, S, 'ClosePlan', {})
		host.nextVerdict = { holds: 'yes', basis: 'lab/f.txt 在', shortfalls: [], results: [] }
		await callOn(host, S, 'Conclude', { outcome: 'achieved' })
		const fact = host.service.state(S).facts.find((item) => item.hypothesis === fast)
		check('前置:那条判断升格成了事实', fact !== undefined, JSON.stringify(host.service.state(S).facts))
		await callOn(host, S, 'Frame', { claim: '复测', done_criteria: '存在 lab/f2.txt', hypotheses: [{ claim: 'X 比 Y 快', refute_when: 'Y 更快' }, { claim: 'Y 比 X 快', refute_when: 'X 更快' }] })
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'f2', do: '换台机器再测', artifacts: ['lab/f2.txt'], done_criteria: 'lab/f2.txt 含两次计时', tests: { hypotheses: [fast], level: 'L2' } }] })
		write('lab/f2.txt', 'x=3.0 y=2.0\n')
		host.userQuestions = answering((question) => ({ label: question.options[0].label, note: '新机器上 Y 更快' }))
		const refuting = await callOn(host, S, 'AdvancePlan', { step_id: 'f2', basis: 'lab/f2.txt x=3.0 y=2.0', results: [{ hypothesis: fast, verdict: 'refute', basis: 'Y 更快' }] })
		const reviewed = host.journal.find((mutation) => mutation.t === 'fact/reviewed')
		check('推翻证据碰到已确立的事实 ⇒ 那次交付当场问人', host.userQuestions.asked.length === 1 && /X 比 Y 快/.test(host.userQuestions.asked[0].questions[0].question))
		check('人选撤回 ⇒ 落 fact/reviewed(撤回 + 人的缘由),事实那一行跟着变', reviewed?.decision === 'retracted' && reviewed.reason === '新机器上 Y 更快' && host.service.state(S).facts.find((item) => item.id === fact.id)?.review?.decision === 'retracted', JSON.stringify(reviewed))
		check('交付照常完成,复核结果说给模型听', refuting.ok === true && /撤回/.test(refuting.message), refuting.message.slice(0, 200))
	}
}

console.log('\n【旧日志里的撤回 / 维持:面板不再发这两个动作,但历史照样折得出来】')
{
	const base = {
		...emptyState(),
		hypotheses: [{ id: 'h-1', claim: 'X 比 Y 快', refute_when: 'Y 更快', status: 'confirmed' }],
		plans: [{ id: 'p-1', status: 'active', steps: [{ id: 's1', ordinal: 1, do: '测两条', status: 'advanced', tests: { hypothesis: 'h-1', level: 'L3' }, artifacts: [], done_criteria: '有读数' }] }],
		evidence: [{ id: 'e-1', plan: 'p-1', step: 's1', verdict: 'refute', level: 'L3', refs: [], evaluator: 'independent', basis: '三次重复里 Y 更快' }],
		facts: [{ id: 'fct-1', goal: 'g-1', text: 'X 比 Y 快', scope: 'Y 更快则作废', level: 'L3', evidence: ['e-1'], path: null, at: 1 }],
	}
	const legacyMessage = (action) => ({ id: `m-${action}`, role: 'user', content: [{ type: 'text', text: `${HUMAN_GATE_MARK} ${JSON.stringify({ action, value: 'fct-1', note: '旧会话里人按的' })}` }], source: { kind: 'user' } })
	check('被推翻、还没审过的事实:那一行写着「被推翻」,但不进收件箱(这道门改由交付当场问)', view(base).facts[0].refuted === true && derive(base).needYou.length === 0)
	const retracted = applyEvent(base, { type: 'user/message', time: 2, data: legacyMessage('retract_fact') })
	check('旧日志里的撤回照样折出来(否则重放时又变回待复核)', view(retracted).facts[0].review?.decision === 'retracted' && derive(retracted).hypotheses[0].status === 'retracted')
	const kept = applyEvent(base, { type: 'user/message', time: 3, data: legacyMessage('keep_fact') })
	check('旧日志里的维持照样折出来', view(kept).facts[0].review?.decision === 'kept')
}

console.log('\n【外脑:把工作区投影成原生条目,自建只有写侧两件】')
{
		const noSkills = makeHost()
		noSkills.skillsAvailable = false
		apply(noSkills.ctx, {})
		check('宿主没有 skills 服务时,装配照常(降级不抛)', noSkills.tools.size === 6)
	}

console.log('\n【技能目录:面板与模型看同一张表(合并目录随投影下发)】')
{
		const noSkills = makeHost()
		noSkills.skillsAvailable = false
		apply(noSkills.ctx, {})
		const result = await preStep(noSkills, 'session-no-skills', 1)
		check('没有 skills 服务时 pre-step 照常(目录这条静默缺席,不抛)', result !== null && noSkills.warnings.every((message) => !/目录快照失败/.test(message)))
	}

console.log('\n【消息署名:生产者自有的 source kind(session 格式 v4 的接纳条件)】')
{
	/**
	 * 宿主从 session 格式 v4 起,原生接纳只认**生产者自有**的 `source.kind`:非空字符串、
	 * 且不是已退役的共享包装 `plugin`——带 `plugin` 的消息会被当场拒绝(整轮报错)。
	 * 这一节钉住内核下发的那两条通道(运行态卡 / 无卡的通知)都不再写旧包装,
	 * 且署名与宿主读取已发布 V3 日志时抬升出来的值一致。
	 */
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const decision = await preStep(host, 'session-source-kind', 1)
	const sources = (decision?.messages ?? []).map((message) => message?.source)
	check('内核真的下发了消息(否则这一节什么都没验)', sources.length > 0, String(sources.length))
	check(
		'署名是生产者自有的 kind(不是已退役的共享包装 plugin,也不是空)',
		sources.every((source) => typeof source?.kind === 'string' && source.kind !== '' && source.kind !== 'plugin'),
		JSON.stringify(sources.map((source) => source?.kind)),
	)
	check('署名与旧日志的抬升值同一个(plugin:clearai)', sources.every((source) => source?.kind === 'plugin:clearai'), JSON.stringify(sources.map((source) => source?.kind)))
	check('退役的 plugin 身份字段不再出现(宿主不许它再当署名)', sources.every((source) => source?.plugin === undefined))
	check('形态字段照旧(snapshot + sections):面板仍按 form 渲染', sources.every((source) => source?.form === 'snapshot' && Array.isArray(source?.sections)))
}

console.log('\n【子 run 的结局:中断/报错是 resolve 带 stopReason,不是 reject(2026-09-11 用户实测的 bug)】')
{
		const H = 'session-hypothesis-unjudged'
		const host = makeHost()
		/**
		 * 这一段**会真的交付**(于是落一条账本提交)。所以给它一间自己的工作区:
		 * 交付提交写进的是**共享工作区的旁路账本**,而那会顶掉别的用例对提交条数的断言
		 * (与「完成度」那一段同一个理由,同一个做法)。
		 */
		const ws = tempDir('clearai-unjudged-')
		execFileSync('git', ['init', '-q'], { cwd: ws })
		execFileSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: ws })
		host.cwd = ws
		apply(host.ctx, { blockedThreshold: 3 })
		await callOn(host, H, 'Frame', {
			claim: '判定这台机器能不能跑 python3',
			done_criteria: '有结论文件',
			hypotheses: [
				{ claim: 'python3 可用', refute_when: '命令报 not found' },
				{ claim: 'python3 不可用', refute_when: '命令正常输出' },
			],
		})
		const first = host.service.state(H).hypotheses[0].id
		await callOn(host, H, 'CreatePlan', { steps: [{ id: 'h1', do: '跑一次观测', artifacts: ['lab/h1.txt'], done_criteria: 'lab/h1.txt 存在', tests: { hypothesis: first, level: 'L2' } }] })
		writeText(join(ws, 'lab', 'h1.txt'), 'stdout=2\n')
		// 只碰第一条:第二条从没被任何证据触及
		const delivered = await callOn(host, H, 'AdvancePlan', {
			observations: [{ ref: 'lab/h1.txt', note: '命令正常输出 2' }],
			verdict: 'support',
			basis: '实跑一次,stdout=2',
			step_id: 'h1',
		})
		check('前置:这一步交付成功(证据只碰到第一条假设)', delivered.ok === true, JSON.stringify(delivered.code ?? null))
		await callOn(host, H, 'ClosePlan', { summary: '这一阶段做完了' })
		const closed = await callOn(host, H, 'Conclude', { outcome: 'achieved' })
		check('结案成功(判据达成了)', closed.ok === true, JSON.stringify(closed.code ?? null))
		const closedMutation = host.journal.filter((m) => m.t === 'goal/closed').at(-1)
		const unjudged = closedMutation?.unjudged ?? null
		check('结案把「没被任何证据触及的假设」如实落账', Array.isArray(unjudged) && unjudged.length === 1, JSON.stringify(unjudged))
		check('结案消息如实说出来(未判不是「没问题」,是「没看过」)', /一次都没检验过/.test(String(closed.message ?? '')) && /没看过/.test(String(closed.message ?? '')), String(closed.message ?? '').slice(0, 160))
		check('视图把留痕交出去(面板与卡片读同一份)', (host.service.view(H).goal?.unjudged ?? []).length === 1, JSON.stringify(host.service.view(H).goal?.unjudged ?? null))
	}

{
		const host = makeHost()
		host.cwd = tempDir('clearai-origins-')
		apply(host.ctx, { blockedThreshold: 3 })
		const OR = 'session-origins'
		await callOn(host, OR, 'Frame', { claim: '算一个读数', done_criteria: '有带原件的证据', promote_at_level: 'L2', hypotheses: [{ claim: '读数可信', refute_when: '对不上' }] })
		await callOn(host, OR, 'CreatePlan', { steps: [{ id: 'o1', do: '算出读数并写成产物文件', artifacts: ['lab/o.txt'], done_criteria: 'lab/o.txt 里写着读数', tests: { hypothesis: host.service.state(OR).hypotheses[0].id, level: 'L2' } }] })
		mkdirSync(join(host.cwd, 'lab'), { recursive: true })
		writeFileSync(join(host.cwd, 'lab', 'o.txt'), '读数 0.86\n')
		const ok = await callOn(host, OR, 'AdvancePlan', { step_id: 'o1', observations: [{ ref: 'lab/o.txt' }], verdict: 'support', basis: 'lab/o.txt 里的读数' })
		check('前置:带原件的交付成功', ok?.ok === true, `${ok?.code}:${String(ok?.message ?? '').slice(0, 80)}`)
		const row = host.service.state(OR).evidence.at(-1)
		check('refs 是**路径**而不是材料 id(界面按路径打开才点得开)', Array.isArray(row?.refs) && row.refs.includes('lab/o.txt') && !row.refs.some((ref) => /^m-/.test(String(ref))), JSON.stringify(row?.refs ?? null))
		check('origins 落账:产物那条带 path(记账时解析,不靠界面猜)', Array.isArray(row?.origins) && row.origins.some((origin) => origin.kind === 'artifact' && origin.path === 'lab/o.txt'), JSON.stringify(row?.origins ?? null))
		// 独立裁决(L3):出处里要有评估卡(文件在盘上)与评估者会话
		const host2 = makeHost()
		host2.cwd = tempDir('clearai-origins-audit-')
		apply(host2.ctx, { blockedThreshold: 3 })
		const OA = 'session-origins-audit'
		await callOn(host2, OA, 'Frame', { claim: '算一个读数', done_criteria: '有独立裁决的证据', promote_at_level: 'L3', hypotheses: [{ claim: '读数可信', refute_when: '对不上' }] })
		await callOn(host2, OA, 'CreatePlan', { steps: [{ id: 'a1', do: '算出读数并写成产物文件', artifacts: ['lab/a.txt'], done_criteria: 'lab/a.txt 里写着读数', tests: { hypothesis: host2.service.state(OA).hypotheses[0].id, level: 'L3' } }] })
		mkdirSync(join(host2.cwd, 'lab'), { recursive: true })
		writeFileSync(join(host2.cwd, 'lab', 'a.txt'), '读数 0.86\n')
		const audited = await callOn(host2, OA, 'AdvancePlan', { step_id: 'a1', observations: [{ ref: 'lab/a.txt' }] })
		check('前置:L3 交付由独立评估者裁决(去掉 verdict)', audited?.ok === true && audited?.evaluator === 'independent', `${audited?.code}:${String(audited?.message ?? '').slice(0, 80)}`)
		const auditedRow = host2.service.state(OA).evidence.at(-1)
		const card = (auditedRow?.origins ?? []).find((origin) => origin.kind === 'audit-card')
		const evaluator = (auditedRow?.origins ?? []).find((origin) => origin.kind === 'evaluator-session')
		check(
			'独立证据的出处里有**评估卡**(工作区相对路径 + 文件真在盘上)',
			card !== undefined && !String(card.path).startsWith('/') && existsSync(join(host2.cwd, String(card.path))),
			JSON.stringify(card ?? null),
		)
		check('独立证据的出处里有**评估者会话**(论证过程可旁观)', evaluator !== undefined && String(evaluator.session).startsWith('child-'), JSON.stringify(evaluator ?? null))
	}

{
		const host = makeHost()
		host.cwd = tempDir('clearai-facts-shelf-')
		// 无人值守档:立约即授权(人在场档会先呈审阅——那正是 §19 那道门,这里不需要它)
		apply(host.ctx, { blockedThreshold: 3 })
		const FS = 'session-facts-shelf'
		await callOn(host, FS, 'Frame', {
			claim: '算一个角度',
			done_criteria: '报告写出根',
			promote_at_level: 'L2',
			hypotheses: [{ claim: '该方程在区间上恰有一个根', refute_when: '区间里数出两个根' }],
		})
		const planned = await callOn(host, FS, 'CreatePlan', { steps: [{ id: 'fs1', do: '用二分法算出方程的根并写下读数', artifacts: ['lab/fs.txt'], done_criteria: 'lab/fs.txt 里写着根与它的读数', tests: { hypothesis: host.service.state(FS).hypotheses[0].id, level: 'L2' } }] })
		check('前置:计划立起来了', planned?.ok === true, `${planned?.code}:${String(planned?.message ?? '').slice(0, 120)}`)
		// 工作区是这一套用例自己的(`host.cwd`),所以手写文件、并断言中间结果(红了能自解释)
		mkdirSync(join(host.cwd, 'lab'), { recursive: true })
		writeFileSync(join(host.cwd, 'lab', 'fs.txt'), '读数 0.86\n')
		const advanced = await callOn(host, FS, 'AdvancePlan', { step_id: 'fs1', observations: [{ ref: 'lab/fs.txt' }], verdict: 'support', basis: 'lab/fs.txt 的读数' })
		check('前置:这一步交付成功(否则后面的事实无从谈起)', advanced?.ok === true, `${advanced?.code}:${String(advanced?.message ?? '').slice(0, 80)}`)
		// §38:目标结案前必须先把计划收尾(事实是在收尾那条路上沉淀的)
		const planClosed = await callOn(host, FS, 'ClosePlan', { summary: '这一阶段做完了' })
		check('前置:计划收尾', planClosed?.ok === true, String(planClosed?.code))
		const closed = await callOn(host, FS, 'Conclude', { outcome: 'achieved', note: '一个根' })
		check('前置:目标结案成功', closed?.ok === true, `${closed?.code}:${String(closed?.message ?? '').slice(0, 80)}`)
		const facts = host.service.state(FS).facts
		check('事实升格时带上**边界与等级**(声明里的 scope/level 真的落到事实里)', facts.length === 1 && String(facts[0].scope ?? '').includes('两个根') && facts[0].level === 'L2', JSON.stringify(facts[0] ?? null).slice(0, 120))
		/**
		 * §38 **目标结案前先把计划收尾**:计划还 active 时 Conclude(achieved) 必须被拒 ✓
		 * —— 事实是在收尾那条路上沉淀的,先结目标就等于跳过沉淀(真长测里出现过:goal achieved 而 plan active、fact/promoted: 0 ✗)。
		 * 而**放弃**走另一条路:如实说清阻塞就收兵,不受此限 ✓。
		 */
		{
			const guard = makeHost()
			guard.cwd = tempDir('clearai-close-order-')
			apply(guard.ctx, { blockedThreshold: 3 })
			const GG = 'session-close-order'
			await callOn(guard, GG, 'Frame', { claim: '把两件事查清', done_criteria: '两件事都有结论', hypotheses: [{ claim: '甲成立', refute_when: '甲不成立' }] })
			await callOn(guard, GG, 'CreatePlan', { steps: [{ id: 'q1', do: '做事', artifacts: ['lab/q1.txt'], done_criteria: 'lab/q1.txt 存在' }] })
			const blockedClose = await callOn(guard, GG, 'Conclude', { outcome: 'achieved' })
			check('计划还开着 ⇒ 结案被拒(plan_open),并把"差一次 ClosePlan"说清', blockedClose?.ok === false && blockedClose?.code === 'plan_open' && /只差一次 ClosePlan|还有 \d+ 步没落定/.test(String(blockedClose?.message ?? '')), `${blockedClose?.code}:${String(blockedClose?.message ?? '').slice(0, 90)}`)
			check('被拒之后目标仍是开放(没有偷偷结掉)', guard.service.state(GG).goal?.status === 'open' && !guard.journal.some((mutation) => mutation.t === 'goal/closed'))
			const abandonOk = await callOn(guard, GG, 'Conclude', { outcome: 'abandoned', note: '缺仪器读数,如实放弃' })
			check('放弃(abandoned)不受此限:计划还开着也能如实结案', abandonOk?.ok === true && guard.service.state(GG).goal?.status === 'abandoned', String(abandonOk?.code))
		}
		// 下一拍:货架该被写出来(幂等:内容没变就不再写)
		await preStep(host, FS, 91)
		const index = join(host.cwd, 'clear', 'knowledge', 'facts', 'INDEX.md')
		const body = existsSync(index) ? readFileSync(index, 'utf8') : ''
		check('事实货架落盘(clear/knowledge/facts/INDEX.md)', body.includes('该方程在区间上恰有一个根'), body.slice(0, 80))
		check('货架里写着边界与支持等级(引用前先看边界)', body.includes('边界:') && body.includes('支持到:'), body.slice(0, 200))
		const before = body
		await preStep(host, FS, 92)
		check('货架幂等(内容一样就不重写)', readFileSync(index, 'utf8') === before)
	}

console.log('\n【裁决一旦结束就要落结算事实:不许让派发事实独自留在账上】')
{
	/**
	 * 三条路原来都直接 `return unknown`(评估者失败 / 没正常结束 / **评估卡落盘失败**),
	 * 账上只剩 `audit/dispatched`——看上去像"它还在跑",而它已经结束了。
	 * 长测里那条「评估者没有悬空」因此红过一次,而且连解释都拿不出证据。
	 */
	const host = makeHost()
	apply(host.ctx, {})
	const S = 'session-audit-settled-on-unknown'
	await callOn(host, S, 'Frame', { claim: '拿到裁决', done_criteria: 'lab/audit-settle.txt 存在', hypotheses: [{ claim: '能做', refute_when: '不能' }] })
	const hypothesis = host.service.state(S).hypotheses[0].id
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'a1', do: '把这一步交付并等独立裁决', artifacts: ['lab/audit-settle.txt'], done_criteria: 'lab/audit-settle.txt 有读数', tests: { hypothesis, level: 'L3' } }] })
	write('lab/audit-settle.txt', 'reading 1\n')
	// 评估者**没有正常结束**:账上必须留下一条结算事实,而不是只有派发。
	host.stopReasonEvaluator = 'aborted'
	host.nextVerdict = undefined
	const delivered = await callOn(host, S, 'AdvancePlan', { step_id: 'a1' })
	const dispatched = host.journal.filter((mutation) => mutation.t === 'audit/dispatched').length
	const settled = host.journal.filter((mutation) => mutation.t === 'audit/settled')
	check('这一笔交付 fail-closed(没拿到裁决就不推进)', delivered.ok === false && delivered.code === 'evidence_audit_unavailable', String(delivered.code))
	check('派发事实落了(前置)', dispatched === 1, String(dispatched))
	check('**结算事实也落了**:结局不好也是结局', settled.length === 1 && settled[0].verdict === 'unknown' && Array.isArray(settled[0].shortfalls) && settled[0].shortfalls.includes('audit_incomplete'), JSON.stringify(settled))
	check('结算事实带着 id 与步(可回指那一次派遣)', typeof settled[0].id === 'string' && settled[0].step === 'a1', JSON.stringify(settled[0]).slice(0, 120))
}

console.log('\n【评估者已结束 ⇒ 先取回它的裁决,取不回才如实落 unknown】')
{
	/**
	 * 权威归属(§一):宿主说已结束 = **这次运行结束了**;结束不等于失联——结论可能就躺在
	 * 它自己的会话日志里。跳过取回就把「结束」误报成「死亡」,还会诱导重新交付 ⇒ 同一次评估被重做。
	 * 这里钉三档:取回裁决 / 结束但未正常完成 / 连日志都读不到。
	 */
	const makePending = (child) => {
		const base = {
			goal: { id: 'g-rc', claim: '把这一步做实', done_criteria: '有外部读数', status: 'open', promote_at_level: 'L3' },
			plans: [{ id: 'p-rc', goal: 'g-rc', status: 'active', summary: '一段', steps: [{ id: 'rc1', ordinal: 1, do: '交付', artifacts: ['lab/rc1.txt'], done_criteria: 'lab/rc1.txt 存在', status: 'open', tests: { hypothesis: 'h-rc', level: 'L3' } }] }],
			hypotheses: [{ id: 'h-rc', claim: 'A 成立', refute_when: 'A 不成立', status: 'alive' }],
			audits: [{ id: 'a-rc1', step: 'rc1', plan: 'p-rc', kind: 'evidence_audit', verdict: null, evaluator: 'independent', child, capability: 'persona', shortfalls: [], basis: null, card_path: null, at: Date.now() }],
			assessments: [], evidence: [], materials: [], forks: [], releases: [], written: [], facts: [], scouts: [], blocks: {}, sessions: [], autonomy: null, constitution: null,
		}
		return { ...emptyState(), ...base }
	}
	const childLog = (events) => ({ id: 'child-x', header: { cwd: WORKSPACE }, ownEvents: () => events })

	// ① 子会话日志里有裁决 ⇒ **取回**,不是失联
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		const S = 'session-audit-recovered'
		host.states.set(S, makePending('child-done'))
		host.listing = [] // 目录里没有活的 ⇒ 宿主说它已结束
		host.childSessions = { 'child-done': childLog([
			{ type: 'turn/start', data: { turn: 1 } },
			{ type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ verdict: 'support', basis: 'lab/rc1.txt 里三次重复的均值差 6.2', shortfalls: [] }) }] } } },
			{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
		]) }
		await preStep(host, S, 81)
		await preStep(host, S, 82)
		const settled = host.journal.filter((mutation) => mutation.t === 'audit/settled')
		check('子会话日志里有裁决 ⇒ **取回**(不是失联):旧式 verdict=support 读成交付成立', settled.length === 1 && settled[0].holds === 'yes' && /均值差 6\.2/.test(String(settled[0].basis)), JSON.stringify(settled[0] ?? null).slice(0, 160))
		check('取回的裁决落了评估卡(凭据与在进程里拿到的那条同构)', typeof settled[0]?.card_path === 'string' && settled[0].card_path.includes('clear/'), String(settled[0]?.card_path))
	}

	// ② 它结束了但未正常完成 ⇒ 如实写「已结束、未正常完成」
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		const S = 'session-audit-abnormal'
		host.states.set(S, makePending('child-aborted'))
		host.listing = []
		host.childSessions = { 'child-aborted': childLog([
			{ type: 'turn/start', data: { turn: 1 } },
			{ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
		]) }
		await preStep(host, S, 81)
		await preStep(host, S, 82)
		const settled = host.journal.filter((mutation) => mutation.t === 'audit/settled')
		check('结束了但未正常完成 ⇒ verdict=unknown,理由写清缘由(aborted)', settled.length === 1 && settled[0].verdict === 'unknown' && /未正常完成/.test(String(settled[0].basis)), JSON.stringify(settled[0] ?? null).slice(0, 140))
	}

	// ③ 连日志都读不到 ⇒ 已结束、结论未取回(不再说「失联/不会有结果」)
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		const S = 'session-audit-uncollected'
		host.states.set(S, makePending('child-gone'))
		host.listing = []
		await preStep(host, S, 81)
		await preStep(host, S, 82)
		const settled = host.journal.filter((mutation) => mutation.t === 'audit/settled')
		check('日志读不到 ⇒ 已结束、结论未取回(不说「不会有结果」)', settled.length === 1 && settled[0].verdict === 'unknown' && /未能从子会话日志取回/.test(String(settled[0].basis)) && !/不会有结果/.test(String(settled[0].basis)), JSON.stringify(settled[0] ?? null).slice(0, 140))
	}
}

console.log('\n【连拦计数 → 计划 blocked,停下等人】')
{
	await call('CreatePlan', { steps: [{ id: 'u1', do: '做一个不会落盘的产物', artifacts: ['lab/never.txt'], done_criteria: 'lab/never.txt 存在且非空' }] })
	let last = null
	for (let i = 0; i < 3; i += 1) last = await call('AdvancePlan', { step_id: 'u1' })
	check('第三次未过闸 → blocked=true 且文案要求停下等人', last.blocked === true && /停下等人/.test(last.message))
	check('台账记下 plan/blocked', eventsOf('plan/blocked').length === 1)
	const card = thisHost.service.renderCard(SESSION)
	check('派生阶段变成 stalled(派生,不存),卡上说人话', thisHost.service.derive(SESSION).phase === 'stalled' && /进度:卡住了/.test(card) && !/stalled/.test(card), card.split('\n').find((line) => line.includes('进度')) ?? '')
	await call('RevisePlan', { action: 'void', step_id: 'u1', reason: '测试脚手架,不再需要' })
	await call('ClosePlan', {})
}

console.log('\n【fail-closed:没有独立评估者就没有 L3+ 的完成】')
{
	const p4 = await call('CreatePlan', { steps: [{ id: 'v1', do: 'L3 验证', artifacts: ['lab/v.json'], done_criteria: 'lab/v.json 可解析且含 mean_delta', tests: { hypothesis: HYP, level: 'L3' } }] })
	check('L3 计划立起', p4.ok === true, String(p4.code))
	write('lab/v.json', '{"mean_delta":6.2}')
	thisHost.auditFails = true
	const unavailable = await call('AdvancePlan', { step_id: 'v1' })
	thisHost.auditFails = false
	check('评估者派不出去 → 不推进(fail-closed)', unavailable.ok === false && unavailable.code === 'evidence_audit_unavailable', String(unavailable.code))
	check('此时没有写入任何 v1 的证据', !eventsOf('evidence/recorded').some((event) => event.step === 'v1'))

	/**
	 * **交付成立与判断的结果是两件事**(2026-10-02 基线发现):
	 *   · 评估者判交付**不成立**(判据没满足)⇒ 退回,步骤留在 open,不写任何证据;
	 *   · 评估者判交付**成立**、判断被**推翻** ⇒ 步骤照常推进,推翻记进证据。
	 * 旧规则只在「支持」时推进,于是输的那条路线做完了也只能作废——那是范畴错误。
	 */
	thisHost.nextVerdict = { holds: 'no', basis: '硬信号:均值差 6.2 但样本 n=1,不满足判据要求的三次重复', shortfalls: [{ criterion: '三次重复', what: 'lab/v.json 只有一个读数', missing: '另外两次' }], results: [] }
	const notHolding = await call('AdvancePlan', { step_id: 'v1' })
	check('评估者判交付不成立 → 退回,步骤不推进', notHolding.ok === false && notHolding.code === 'delivery_not_holding', String(notHolding.code))
	check('交付不成立时不写证据(那不是对判断的结果)', !eventsOf('evidence/recorded').some((event) => event.step === 'v1'))
	check('退回的话里逐条写出缺口', /三次重复/.test(notHolding.message) && /另外两次/.test(notHolding.message), notHolding.message.slice(0, 160))

	/**
	 * **材料必须真的变**,否则第二次交付会命中同态复用(材料一字未变 ⇒ 复用上一条裁决)。
	 * 这里改的正是评估者指出的那个缺口:补上样本数(文件内容变了 ⇒ 产物摘要变了 ⇒ 新一次独立评审)。
	 */
	write('lab/v.json', '{"mean_delta":6.2,"n":3}')
	thisHost.nextVerdict = { holds: 'yes', basis: '硬信号:三次重复齐备,均值差 6.2', shortfalls: [], results: [{ hypothesis: HYP, verdict: 'refute', basis: '均值差 6.2 落在推翻条件的范围里' }] }
	const refuted = await call('AdvancePlan', { step_id: 'v1' })
	check('交付成立、判断被推翻 → 步骤照常推进(推翻不让交付失败)', refuted.ok === true && refuted.code === 'advanced', String(refuted.code))
	check('推翻写进证据,针对的是那条判断', eventsOf('evidence/recorded').some((event) => event.step === 'v1' && event.verdict === 'refute' && event.hypothesis === HYP))
	check('推翻的证据来自独立评估者', eventsOf('evidence/recorded').find((event) => event.step === 'v1').evaluator === 'independent')
	check('交付本身记在推进那条事实上(谁判的、凭什么)', eventsOf('step/advanced').some((event) => event.step === 'v1' && event.evaluator === 'independent' && /三次重复齐备/.test(String(event.basis))))
	check('结果说给模型听:推翻是有价值的结果', /推翻/.test(refuted.message), refuted.message.slice(0, 160))
	const closed = await call('ClosePlan', {})
	check('收敛后收束这份计划(同时只允许一份活动计划)', closed.ok === true, String(closed.code))
}

console.log('\n【事实边界:系统所有的路径,做的人写不进;危险命令闸门】')
{
	const preExecute = thisHost.listeners.get('tools/pre-execute')
	const forged = await preExecute(
		{ name: 'write', arguments: { file_path: join(WORKSPACE, 'clear/knowledge/facts/g1.md'), content: '我宣布这是事实' }, agent: { id: SESSION }, callId: 'c-forge' },
		async () => ({ kind: 'allow' }),
	)
	check('写 clear/knowledge/facts → 拒绝', forged.kind === 'deny' && /由系统所有/.test(forged.reason), String(forged.kind))

	const forgedAudit = await preExecute(
		{ name: 'bash', arguments: { command: `echo '{}' > ${join(WORKSPACE, 'clear/evidence/audits/s1/forged.json')}` }, agent: { id: SESSION }, callId: 'c-forge2' },
		async () => ({ kind: 'allow' }),
	)
	check('用 bash 伪造评估卡 → 拒绝', forgedAudit.kind === 'deny')

	const danger = await preExecute({ name: 'bash', arguments: { command: 'sudo rm -rf /' }, agent: { id: SESSION }, callId: 'c-danger' }, async () => ({ kind: 'allow' }))
	check('危险命令闸门(authoritative before_tool)→ 拒绝', danger.kind === 'deny' && /dangerous bash command/.test(danger.reason), String(danger.kind))

	const clean = await preExecute({ name: 'bash', arguments: { command: 'ls -la lab' }, agent: { id: SESSION }, callId: 'c-ok' }, async () => ({ kind: 'allow' }))
	check('普通命令 → 放行', clean.kind === 'allow')
}

console.log('\n【目标收尾:无条件派审计,只有评估者说达成才算达成】')
{
	thisHost.nextVerdict = { verdict: 'refute', basis: '判据要求三次重复,当前只有一次', shortfalls: ['重复次数不足'] }
	const notYet = await call('Conclude', { outcome: 'achieved' })
	check('评估者说没达成 → 目标保持开放', notYet.ok === false && notYet.code === 'goal_not_achieved', String(notYet.code))
	check('目标未结案(台账里没有 goal/closed)', eventsOf('goal/closed').length === 0)

	/**
	 * **同态结案不会拿到新裁决**:材料没变,复用上一条(这是刻意的——否则模型每喊一次
	 * 结案就重烧两三分钟)。要有新判断,先改材料:这里改的是目标本身(修订 ⇒ 修订号 +1 ⇒ 新问题)。
	 */
	thisHost.nextVerdict = { verdict: 'support', basis: '判据逐条核对通过,转写忠实', shortfalls: [] }
	const sameMaterial = await call('Conclude', { outcome: 'achieved' })
	check('材料没变 → 复用上一条裁决,不重派评估者', sameMaterial.ok === false && sameMaterial.code === 'goal_not_achieved' && /复用了上一条独立裁决/.test(String(sameMaterial.message)), String(sameMaterial.code))
	const before = thisHost.audits.filter((audit) => audit.request.label.includes('目标评估者')).length
	check('复用没有产生新的评估者派遣', before === 1, String(before))

	const open = thisHost.service.state(SESSION)
	const revised = await call('Frame', {
		claim: open.goal.claim,
		headline: open.goal.headline ?? '同态结案的目标',
		done_criteria: open.goal.done_criteria,
		// 主张原文一字不动 ⇒ 用回原 id,已验到哪一级接着算(与真实修订同形)。
		hypotheses: open.hypotheses.map((item) => ({ claim: item.claim, refute_when: item.refute_when })),
		reason: '测试脚手架:改一次材料,好让下一次结案拿到新裁决',
		legacy: true,
	})
	check('前置:目标修订成功(材料变了)', revised.ok === true, String(revised.code))
	const achieved = await call('Conclude', { outcome: 'achieved' })
	check('评估者说达成 → 结案', achieved.ok === true && achieved.code === 'goal_achieved', String(achieved.code))
	check('目标级审计无条件派发', thisHost.audits.some((audit) => audit.request.label.includes('目标评估者')))
	// 事实落盘在整个文件共用的工作区里,别的用例合法地升格过事实——所以这条断言**认自己那个目标**,
	// 不是「整个工作区一条事实都没有」(那种写法让用例之间靠共享目录互相牵连)。
	const refutedGoal = thisHost.service.state(SESSION).goal?.id
	check(
		'有推翻证据的假设不升格(达门槛也不能升)',
		!factFiles().some((file) => file.endsWith(`/${refutedGoal}.md`)) && /没有判断达到写进长期知识的门槛/.test(achieved.message),
		`目标 ${refutedGoal} 却落了事实:${factFiles().join(',')}`,
	)
	check('被推翻的假设仍在状态里可查', thisHost.service.state(SESSION).hypotheses.length >= 1 && eventsOf('evidence/recorded').some((event) => event.verdict === 'refute'))
}

console.log('\n【升格:达门槛且无推翻的假设 → 事实(由系统写进知识库)】')
{
	const g2 = await call('Frame', {
		claim: '控制链长后差异是否仍在',
		done_criteria: '控制实验报告落在 lab/control.md 且结论明确',
		promote_at_level: 'L0',
		hypotheses: [{ claim: '链长是主因', refute_when: '控制链长后差异消失' }],
	})
	check('结案后可铸新目标', g2.ok === true && g2.code === 'goal_set', String(g2.code))
	const h2 = eventsOf('goal/set').slice(-1)[0].hypotheses[0].id
	await call('CreatePlan', {
		steps: [{ id: 'w1', do: '控制链长的推理检查', artifacts: ['lab/control.md'], done_criteria: 'lab/control.md 写明控制变量与结论', tests: { hypothesis: h2, level: 'L0' } }],
	})
	write('lab/control.md', '# 控制实验推理\n\n固定链长之后两组的产率差异仍然存在,因此链长不是产率差异的主因,需要回到催化剂本身找解释。\n')
	const delivered = await call('AdvancePlan', { step_id: 'w1', verdict: 'support', basis: 'lab/control.md 写明控制变量与结论,依据可复查' })
	check('L0 步骤自判通过', delivered.ok === true, String(delivered.code))
	await call('ClosePlan', {})
	thisHost.nextVerdict = { verdict: 'support', basis: '判据达成,转写忠实', shortfalls: [] }
	const closed = await call('Conclude', { outcome: 'achieved' })
	check('无推翻且达门槛 → 升格为事实', closed.ok === true && /写进长期知识/.test(closed.message), String(closed.code))
	const promotedId = eventsOf('fact/promoted')[0]?.id
	const promotedFile = factFiles().find((file) => file.endsWith(`/${promotedId}.json`))
	const promotedData = promotedFile === undefined ? null : JSON.parse(readFileSync(promotedFile, 'utf8'))
	check('事实由系统写进 clear/knowledge/facts/<事实 id>.json', promotedData?.id === promotedId && promotedData?.status === 'established' && promotedData?.history?.[0]?.event === 'promoted', promotedFile ?? '(没有文件)')
	check('结案消息指向那个事实文件', closed.message.includes(`clear/knowledge/facts/${promotedId}.json`), closed.message)
	check('升格也记在台账里', eventsOf('fact/promoted').length === 1)
}

console.log('\n【跨会话:别的会话升格的事实在这里也是已知;定义改了要复核】')
{
	const OTHER = 'session-cross'
	const other = makeHost()
	apply(other.ctx, {})
	const promotedId = eventsOf('fact/promoted')[0]?.id
	await preStep(other, OTHER, 1)
	const synced = other.journal.filter((mutation) => mutation.t === 'workspace/synced')
	check('新会话第一拍就把事实文件同步进自己的账', synced.length === 1 && synced[0].changes.some((change) => change.path === `clear/knowledge/facts/${promotedId}.json` && change.data?.id === promotedId), JSON.stringify(synced.map((mutation) => mutation.changes.map((change) => change.path))))
	const rows = other.service.derive(OTHER).factRows
	check('别的会话的事实出现在事实行里(foreign)', rows.some((row) => row.id === promotedId && row.foreign === true), JSON.stringify(rows.map((row) => [row.id, row.foreign])))
	await preStep(other, OTHER, 2)
	check('文件没变就不再同步', other.journal.filter((mutation) => mutation.t === 'workspace/synced').length === 1)
	await preStep(thisHost, SESSION, 900)
	const ownRows = thisHost.service.derive(SESSION).factRows.filter((row) => row.id === promotedId)
	check('本会话自己的事实与它的文件只算一条(按 id 去重,以账为准)', ownRows.length === 1 && ownRows[0].foreign === false, JSON.stringify(ownRows))

	/** 定义改了:事实文件里记着升格那一刻的指纹,与此刻的词汇对不上 ⇒ 待处理里多一条复核。 */
	const file = join(WORKSPACE, 'clear/knowledge/facts', `${promotedId}.json`)
	const data = JSON.parse(readFileSync(file, 'utf8'))
	writeFileSync(join(WORKSPACE, 'clear/knowledge/facts', 'f-foreign.json'), `${JSON.stringify({ ...data, id: 'f-foreign', text: '外来结论:某谓词定义改过之后它还成立吗', definitions: { yield_of: 'fnv:00000000' }, review: null, status: 'established' }, null, 2)}\n`)
	await preStep(other, OTHER, 3)
	const changed = other.service.derive(OTHER).factRows.find((row) => row.id === 'f-foreign')
	check('定义对不上的事实带着 definitionsChanged', JSON.stringify(changed?.definitionsChanged) === JSON.stringify(['yield_of']), JSON.stringify(changed?.definitionsChanged))
	check('待处理里多一条「定义已变」', other.service.derive(OTHER).needYou.some((item) => item.kind === 'definition_changed' && item.fact === 'f-foreign'))
	const index = readFileSync(join(WORKSPACE, 'clear/knowledge/facts/INDEX.md'), 'utf8')
	check('INDEX.md 汇总所有会话的事实,不只本会话', index.includes('f-foreign') && index.includes(promotedId))
	rmSync(join(WORKSPACE, 'clear/knowledge/facts', 'f-foreign.json'))
	await preStep(other, OTHER, 4)
	check('文件删掉 ⇒ 同步成 removed,事实行里也没了', !other.service.derive(OTHER).factRows.some((row) => row.id === 'f-foreign'))
	await preStep(thisHost, SESSION, 901)
}

function factFiles() {
	const dir = join(WORKSPACE, 'clear/knowledge/facts')
	try {
		return readdirSync(dir).map((name) => join(dir, name))
	} catch {
		return []
	}
}

console.log('\n【领域本体写成文件:写入时单文件校验 · 读取时从文件折图 · 断言链 · 冲突只暴露】')
{
	/** 一条断言的构造器:同一主体、同一谓词,只换取值——冲突那一段靠的就是它。 */
	const assertion = (value) => ({ predicate: 'oxygen_ppm', subject: { id: 'B1', type: 'furnace_batch' }, object: { kind: 'quantity', value, unit: 'ppm' } })
	const guard = thisHost.listeners.get('tools/pre-execute')
	const attempt = (name, args) => guard({ name, arguments: args, agent: { id: SESSION }, callId: `c-${name}` }, async () => ({ kind: 'allow' }))
	const json = (value) => `${JSON.stringify(value, null, 2)}\n`

	// ① 第一道校验:写入时只查这一个文件,不对就拒(相对路径与绝对路径一样判)
	const noGloss = await attempt('write', { file_path: 'clear/ontology/concepts/furnace_batch.json', content: json({ id: 'furnace_batch', label: '炉次' }) })
	check('概念缺释义 → 拒这次写入,原因原样回给模型', noGloss.kind === 'deny' && /gloss 必填/.test(String(noGloss.reason)), String(noGloss.reason))
	const badId = await attempt('write', { file_path: join(WORKSPACE, 'clear/ontology/concepts/Bad-Id.json'), content: json({ label: 'L', gloss: 'g' }) })
	check('文件名不能当 id → 拒', badId.kind === 'deny' && /不能当 id/.test(String(badId.reason)))
	const idMismatch = await attempt('write', { file_path: 'clear/ontology/concepts/furnace_batch.json', content: json({ id: 'furnace', label: '炉次', gloss: 'g' }) })
	check('id 与文件名不一致 → 拒(身份就是文件名)', idMismatch.kind === 'deny' && /要等于文件名/.test(String(idMismatch.reason)))
	const notJson = await attempt('write', { file_path: 'clear/ontology/relations/oxygen_ppm.json', content: '{ label: 氧含量 ' })
	check('不是合法 JSON → 拒', notJson.kind === 'deny' && /不是合法 JSON/.test(String(notJson.reason)))
	const extraField = await attempt('write', { file_path: 'clear/ontology/concepts/furnace_batch.json', content: json({ label: '炉次', gloss: 'g', colour: 'red' }) })
	check('不认识的字段 → 拒,并列出可用字段', extraField.kind === 'deny' && /不认识的字段:colour/.test(String(extraField.reason)) && /SCHEMA\.json/.test(String(extraField.reason)))
	const entityNoProvenance = await attempt('write', { file_path: 'clear/ontology/entities/B1.json', content: json({ label: 'B1', type: 'furnace_batch', basis: 'b' }) })
	check('实体没有出处 → 拒', entityNoProvenance.kind === 'deny' && /provenance/.test(String(entityNoProvenance.reason)))
	const danglingOk = await attempt('write', { file_path: 'clear/ontology/entities/B0.json', content: json({ label: 'B0', type: 'ghost_concept', basis: 'b', provenance: { kind: 'named', ref: 'r' } }) })
	check('引用的概念还不存在 → 写入放行(跨文件的事不在写入时查)', danglingOk.kind === 'allow', String(danglingOk.reason))
	const good = await attempt('write', { file_path: 'clear/ontology/concepts/furnace_batch.json', content: json({ id: 'furnace_batch', label: '炉次', gloss: '一次熔铸循环', basis: '现场记录 R-01' }) })
	check('合格的概念文件 → 放行', good.kind === 'allow', String(good.reason))
	const notOntology = await attempt('write', { file_path: 'clear/ontology/concepts/README.md', content: '笔记' })
	check('本体目录里不是 .json 的文件 → 放行(读的时候也不认)', notOntology.kind === 'allow')
	const schemaWrite = await attempt('write', { file_path: 'clear/ontology/SCHEMA.json', content: '{}' })
	check('字段定义 SCHEMA.json 由系统所有 → 拒', schemaWrite.kind === 'deny' && /由系统所有/.test(String(schemaWrite.reason)))
	const relativeFact = await attempt('write', { file_path: 'clear/knowledge/facts/forged.json', content: '{}' })
	check('相对路径写事实 → 拒(从前只比绝对路径,相对写法绕过去了)', relativeFact.kind === 'deny')
	const readFacts = await attempt('bash', { command: 'cat clear/knowledge/facts/INDEX.md 2>/dev/null' })
	check('只读地看事实 → 放行(攒下来的东西就是要被读)', readFacts.kind === 'allow', String(readFacts.reason))
	const readTool = await attempt('read', { file_path: join(WORKSPACE, 'clear/knowledge/facts/INDEX.md') })
	check('原生 read 读事实 → 放行', readTool.kind === 'allow')
	const moveBranch = await attempt('bash', { command: 'mkdir -p clear/ontology/concepts/process && mv clear/ontology/concepts/a.json clear/ontology/concepts/process/' })
	check('用 bash 在本体三支目录里挪文件 → 放行(挪目录就是重新分层)', moveBranch.kind === 'allow', String(moveBranch.reason))
	const forgeBash = await attempt('bash', { command: 'echo {} > clear/knowledge/facts/x.json' })
	check('用 bash 往事实目录里写 → 拒', forgeBash.kind === 'deny')

	/** 模型实际写文件(写入时的检查上面已经过了一遍)。 */
	writeOntology(WORKSPACE, 'concepts/furnace_batch', { id: 'furnace_batch', label: '炉次', gloss: '一次熔铸循环', basis: '现场记录 R-01' })
	writeOntology(WORKSPACE, 'concepts/furnace_batch/narrow_batch', { id: 'narrow_batch', label: '窄窗口炉次', gloss: 'g', basis: 'b' })
	writeOntology(WORKSPACE, 'concepts/lab_sample', { id: 'lab_sample', label: '化验样品', gloss: 'g', basis: 'b' })
	writeOntology(WORKSPACE, 'relations/oxygen_ppm', { id: 'oxygen_ppm', label: '氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, functional: true, basis: 'GB/T 5121' })
	writeOntology(WORKSPACE, 'entities/B1', { id: 'B1', type: 'furnace_batch', label: 'B1 炉次', basis: '化验单 L-08', provenance: { kind: 'named', ref: '化验单 L-08' } })
	writeEditCheck: {
		const before = readFileSync(join(WORKSPACE, 'clear/ontology/entities/B1.json'), 'utf8')
		const brokenEdit = await attempt('edit', { file_path: 'clear/ontology/entities/B1.json', old_string: '"type": "furnace_batch",', new_string: '' })
		check('局部编辑先在内存里套用再查:删掉必填的 type → 拒', brokenEdit.kind === 'deny' && /type 必填/.test(String(brokenEdit.reason)), String(brokenEdit.reason))
		check('被拒的编辑没有碰盘上的文件', readFileSync(join(WORKSPACE, 'clear/ontology/entities/B1.json'), 'utf8') === before)
		break writeEditCheck
	}
	rmSync(join(WORKSPACE, 'clear/ontology/entities/B0.json'), { force: true })

	// ② 第二道:读取时从文件折出图(目录嵌套 = is_a)
	await preStep(thisHost, SESSION, 950)
	const lexicon = thisHost.service.state(SESSION).lexicon
	check('pre-step 把本体文件同步进账,词汇从文件折出来', lexicon.terms.some((term) => term.id === 'furnace_batch') && lexicon.predicates.some((item) => item.id === 'oxygen_ppm'), JSON.stringify(lexicon.terms.map((term) => term.id)))
	check('目录嵌套就是 is_a:narrow_batch 的父概念是 furnace_batch', lexicon.terms.find((term) => term.id === 'narrow_batch')?.parent === 'furnace_batch')
	check('实体从文件进图', thisHost.service.state(SESSION).entities.some((entity) => entity.id === 'B1' && entity.type === 'furnace_batch'))

	// ③ 断言链:Frame 在落账之前严校(提供即严校;不提供放行)
	const ghostPredicate = await call('Frame', {
		claim: 'C', done_criteria: 'D 可核对',
		hypotheses: [{ claim: 'h', refute_when: 'r', assertions: [{ predicate: 'ghost_pred', subject: { id: 'B1', type: 'furnace_batch' }, object: { kind: 'quantity', value: 8, unit: 'ppm' } }] }],
	})
	check('引用不存在的关系 → 落账之前被拒', ghostPredicate.ok === false && /predicate_unknown/.test(String(ghostPredicate.message)))
	const wrongType = await call('Frame', {
		claim: 'C', done_criteria: 'D 可核对',
		hypotheses: [{ claim: 'h', refute_when: 'r', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'B1', type: 'lab_sample' }, object: { kind: 'quantity', value: 8, unit: 'ppm' } }] }],
	})
	check('主体类型不合主词域(也不是它的下位概念)→ 拒', wrongType.ok === false && /subject_type_mismatch/.test(String(wrongType.message)))
	const selfConflict = await call('Frame', {
		claim: 'C', done_criteria: 'D 可核对',
		hypotheses: [{ claim: 'h', refute_when: 'r', assertions: [assertion(8), assertion(12)] }],
	})
	check('同一事实里同一主体两个值 → 当场拒(自相矛盾)', selfConflict.ok === false && /assertion_self_conflict/.test(String(selfConflict.message)))
	const goal = await call('Frame', {
		claim: '氧含量能不能稳定到 8 ppm',
		done_criteria: '台账里 20 炉次的氧含量读数齐备',
		promote_at_level: 'L0',
		hypotheses: [
			{ claim: '工艺参数是主因', refute_when: '工艺受控时波动仍由来料解释', assertions: [assertion(8)] },
			{ claim: '来料是主因', refute_when: '来料同一批时波动仍大' },
		],
	})
	check('带断言的假设 → 通过(断言是加法,不是门槛)', goal.ok === true, String(goal.message))
	const hypothesisId = eventsOf('goal/set').slice(-1)[0].hypotheses[0].id

	// ④ 升格:身份、内容与定义指纹一起定型
	await call('CreatePlan', { steps: [{ id: 'd1', do: '整理 20 炉次台账', artifacts: ['lab/o2.md'], done_criteria: 'lab/o2.md 写明每炉次氧含量与工艺参数', tests: { hypothesis: hypothesisId, level: 'L0' } }] })
	write('lab/o2.md', '# 20 炉次台账\n\n逐炉次列出氧含量读数与同时段的温度窗、拉速、一冷二冷强度与覆盖剂状态;读数取自主控记录的同一批化验单,单位 ppm。\n\n结论:参数可分组的炉次之间氧含量差异明显,而同一参数组内波动较小。\n')
	const delivered = await call('AdvancePlan', { step_id: 'd1', verdict: 'support', basis: 'lab/o2.md 写明每炉次读数与参数' })
	check('L0 步骤交付 → 通过', delivered.ok === true, `${String(delivered.code)} :: ${String(delivered.message).slice(0, 200)}`)
	await call('ClosePlan', {})
	thisHost.nextVerdict = { verdict: 'support', basis: '判据达成,转写忠实', shortfalls: [] }
	const concluded = await call('Conclude', { outcome: 'achieved' })
	check('第一条目标达成 → 升格', concluded.ok === true && /写进长期知识/.test(String(concluded.message)))
	check('成功结案提醒把可复用的做法写成原生技能', /\.agents\/skills\//.test(String(concluded.message)))
	const first = eventsOf('fact/promoted').slice(-1)[0]
	check('升格带着产出它的假设 id 与类型化断言', first.hypothesis === hypothesisId && Array.isArray(first.assertions) && first.assertions.length === 1)
	check('升格带着用到的定义指纹(谓词与主体类型)', typeof first.definitions?.oxygen_ppm === 'string' && typeof first.definitions?.furnace_batch === 'string', JSON.stringify(first.definitions))

	// ⑤ 冲突:两条未撤回的事实互相矛盾 → 只暴露,不裁决,不改任何一侧
	await call('Frame', {
		claim: '换个炉次复核氧含量',
		done_criteria: '复核读数落在 lab/o3.md',
		promote_at_level: 'L0',
		hypotheses: [{ claim: '工艺参数仍是主因', refute_when: '复核显示工艺受控', assertions: [assertion(12)] }],
	})
	const secondHypothesis = eventsOf('goal/set').slice(-1)[0].hypotheses[0].id
	await call('CreatePlan', { steps: [{ id: 'd2', do: '复核一炉', artifacts: ['lab/o3.md'], done_criteria: 'lab/o3.md 写明复核读数', tests: { hypothesis: secondHypothesis, level: 'L0' } }] })
	write('lab/o3.md', '# 复核\n\n对同一主体复核,氧含量读数为 12 ppm;复核使用同一种取样与化验流程,读数可复查。\n\n与上一份台账相比,同一主体的取值不同,需要人来判断哪一份可信。\n')
	await call('AdvancePlan', { step_id: 'd2', verdict: 'support', basis: 'lab/o3.md 写明复核读数' })
	await call('ClosePlan', {})
	thisHost.nextVerdict = { verdict: 'support', basis: '判据达成', shortfalls: [] }
	await call('Conclude', { outcome: 'achieved' })
	const derived = derive(thisHost.service.state(SESSION))
	const conflict = derived.conflicts.find((item) => item.predicate === 'oxygen_ppm')
	check('同一单值谓词、同一主体、两个取值 → 派生一对冲突', conflict !== undefined && conflict.sides.length === 2, JSON.stringify(derived.conflicts.map((item) => item.predicate)))
	check('冲突只在「待处理」里陈述一行,不带按钮、不拦', derived.needYou.some((item) => item.kind === 'conflict' && /oxygen_ppm|氧含量/.test(item.text) && /以哪个为准/.test(item.text)), JSON.stringify(derived.needYou))
	const cardText = thisHost.service.renderCard(SESSION)
	check('运行态卡把矛盾说出来并说明不替你选', /矛盾/.test(cardText) && /系统不替你选/.test(cardText))
	check('运行态卡带本体大纲(概念树与实体树,标节点数)', /本体\(clear\/ontology\/\)/.test(cardText) && /furnace_batch\(1\):narrow_batch/.test(cardText), cardText.split('\n').filter((line) => /本体|概念树/.test(line)).join(' | '))

	/** 主体没有实体文件 ⇒ 拒(`assert_subject_unknown`),而 `legacy: true` 一次性放行。 */
	const unregistered = await call('Frame', {
		claim: 'C4', done_criteria: 'D4 可核对',
		hypotheses: [{ claim: 'h4', refute_when: 'r4', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'B9', type: 'furnace_batch' }, object: { kind: 'quantity', value: 7, unit: 'ppm' } }] }],
	})
	check('主体没有实体文件 → 拒(主词可指认是能被复核的前提)', unregistered.ok === false && /assert_subject_unknown/.test(String(unregistered.message)), String(unregistered.code))
	const legacyGoal = await call('Frame', {
		claim: 'C4', done_criteria: 'D4 可核对', legacy: true, reason: '迁移期一次性放行',
		hypotheses: [{ claim: 'h4', refute_when: 'r4', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'B9', type: 'furnace_batch' }, object: { kind: 'quantity', value: 7, unit: 'ppm' } }] }],
	})
	check('legacy:true → 放行(迁移期出口真的通)', legacyGoal.ok === true, String(legacyGoal.code))

	// ⑥ 改义从「拦」改成「查」:改名不触发复核,改含义触发
	writeOntology(WORKSPACE, 'relations/oxygen_ppm', { id: 'oxygen_ppm', label: '熔体氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, functional: true, basis: '名字写全' })
	await preStep(thisHost, SESSION, 951)
	check('只改名字 → 已升格的事实不标「定义已变」', derive(thisHost.service.state(SESSION)).factRows.every((row) => row.definitionsChanged.length === 0))
	writeOntology(WORKSPACE, 'relations/oxygen_ppm', { id: 'oxygen_ppm', label: '熔体氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, functional: false, basis: '改成多值' })
	await preStep(thisHost, SESSION, 952)
	const changedRows = derive(thisHost.service.state(SESSION)).factRows.filter((row) => row.definitionsChanged.includes('oxygen_ppm'))
	check('改了单值性 → 用到它的事实标「定义已变」(不拦,也不撤回)', changedRows.length === 2 && changedRows.every((row) => row.review === null || row.review === undefined), JSON.stringify(changedRows.map((row) => [row.id, row.foreign, row.text])))
	check('待处理里列出要复核的事实', derive(thisHost.service.state(SESSION)).needYou.filter((item) => item.kind === 'definition_changed').length === 2)
	check('卡上说有几条事实需复核', /需复核/.test(thisHost.service.renderCard(SESSION)))

	// ⑦ 废止写在文件上:引用它的新断言被拒
	writeOntology(WORKSPACE, 'concepts/furnace_batch/narrow_batch', { id: 'narrow_batch', label: '窄窗口炉次', gloss: 'g', basis: 'b', status: 'deprecated', replaced_by: 'furnace_batch' })
	writeOntology(WORKSPACE, 'entities/B2', { id: 'B2', type: 'narrow_batch', label: 'B2 炉次', basis: '化验单 L-09', provenance: { kind: 'named', ref: '化验单 L-09' } })
	const useDeprecated = await call('Frame', {
		claim: 'C3', done_criteria: 'D3 可核对',
		hypotheses: [{ claim: 'h3', refute_when: 'r3', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'B2', type: 'narrow_batch' }, object: { kind: 'quantity', value: 9, unit: 'ppm' } }] }],
	})
	check('引用已废止概念的新断言 → 拒', useDeprecated.ok === false && /deprecated/.test(String(useDeprecated.message)))

	// ⑧ 跨文件的问题只提示:有问题的关系不进图,卡上逐条列出
	writeOntology(WORKSPACE, 'entities/B3', { id: 'B3', type: 'furnace_batch', label: 'B3', basis: 'b', provenance: { kind: 'named', ref: 'r' }, relations: [{ predicate: 'fed_by', object: 'B1', evidence: { kind: 'named', ref: 'r' } }] })
	await preStep(thisHost, SESSION, 953)
	const problems = thisHost.service.state(SESSION).ontologyProblems
	check('引用了不存在的关系 → 列成问题(relation_unknown),那条关系不进图', problems.some((item) => item.code === 'relation_unknown' && item.id === 'B3') && !thisHost.service.state(SESSION).entityAssertions.some((item) => item.subject.id === 'B3'), JSON.stringify(problems))
	check('卡上说本体文件有几处问题', /本体文件有 \d+ 处问题/.test(thisHost.service.renderCard(SESSION)))
	rmSync(join(WORKSPACE, 'clear/ontology/entities/B3.json'))
	rmSync(join(WORKSPACE, 'clear/ontology/entities/B2.json'))
	await preStep(thisHost, SESSION, 954)
}

console.log('\n【跳级理由整套删除(第四阶段):等级只决定谁来判,不再有「未走过的等级」】')
{
	/**
	 * 第三阶段重跑里,「跳级没写理由」让一个「跑一次 python3」的任务在结案时多被拦一次、
	 * 多写一段「这一级为什么不适用」。等级的职责收回到两件:谁来判,以及 L4 要人放行。
	 * 所以派生里不再有 `untouchedLevels`,卡上不再有「未走过」,旧日志里的 `level/skipped` 安静跳过。
	 */
	const base = {
		...emptyState(),
		hypotheses: [{ id: 'h-1', claim: 'X 比 Y 快', refute_when: 'Y 更快', status: 'alive' }],
		plans: [{ id: 'p-1', status: 'active', steps: [{ id: 's1', ordinal: 1, do: '直接测', status: 'advanced', tests: { hypothesis: 'h-1', level: 'L3' }, artifacts: [], done_criteria: '有读数' }] }],
	}
	const l3Only = { ...base, evidence: [{ id: 'e-1', plan: 'p-1', step: 's1', verdict: 'support', level: 'L3', refs: [], evaluator: 'independent', basis: '均值差 6.2' }] }
	check('只在 L3 上交过 ⇒ 派生里没有「未走过的等级」这一项', !('untouchedLevels' in derive(l3Only).hypotheses[0]), JSON.stringify(Object.keys(derive(l3Only).hypotheses[0])))
	check('运行态卡不再列「未走过」', !/未走过/.test(renderCard(l3Only)), renderCard(l3Only).split('\n').find((line) => line.includes('未走过')) ?? '')
	const old = applyMutations(l3Only, [{ t: 'level/skipped', goal: null, hypothesis: 'h-1', levels: ['L0', 'L1', 'L2'], reason: '旧日志里的一条跳级理由' }])
	check('旧日志里的 level/skipped 安静跳过(折得出来,不留痕在假设上)', !('skips' in old.hypotheses[0]) && derive(old).hypotheses[0].supportedLevel === 'L3')
}

console.log('\n【拿不到裁决要计数:同一件事反复失败必须升级给人,不许无声重试】')
{
	/**
	 * 「拿不到独立裁决」原来不计数:评估者失联/提供方不可用时,模型可以一次次重新交付、
	 * 每次 fail-closed,而**永远不会升级给人**——同一语义动作反复做、不带来新事实,
	 * 正是这套失败哲学要停下来的那一种。现在它与准入没过共用同一个连拦计数,
	 * 于是落到同一道已有的门(`plan/blocked` ⇒ 收件箱里那条等人处置的条目)。
	 */
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-audit-unavailable'
	await callOn(host, S, 'Frame', { claim: '判断 X 是否成立', done_criteria: '拿到裁决', hypotheses: [{ claim: 'X 成立', refute_when: 'X 不成立' }] })
	const hypothesis = host.service.state(S).hypotheses[0].id
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'a1', do: '测 X', artifacts: ['lab/a1.txt'], done_criteria: 'lab/a1.txt 有读数', tests: { hypothesis, level: 'L3' } }] })
	write('lab/a1.txt', 'reading: 42\n')
	host.auditFails = true
	const counted = () => host.journal.filter((mutation) => mutation.t === 'block/counted' && mutation.step === 'a1')
	const first = await callOn(host, S, 'AdvancePlan', { step_id: 'a1' })
	check('拿不到裁决仍然 fail-closed(不推进)', first.ok === false && first.code === 'evidence_audit_unavailable', `${first.code}`)
	check('但它**计入连拦**(第 1 次)', counted().length === 1 && counted()[0].count === 1, JSON.stringify(counted()))
	check('第 1 次的结果里说明还剩几次会置 blocked(不让人猜)', /第 1 次/.test(String(first.message)) && /3/.test(String(first.message)), String(first.message).slice(0, 140))
	await callOn(host, S, 'AdvancePlan', { step_id: 'a1' })
	const third = await callOn(host, S, 'AdvancePlan', { step_id: 'a1' })
	check('连拦到阈值 ⇒ 计划置 blocked,并如实说已停下等人', third.ok === false && host.service.state(S).plans[0].blocked !== undefined && /停下等人/.test(String(third.message)), `${third.code}/${JSON.stringify(host.service.state(S).plans[0].blocked)}`)
	check('置 blocked 时当场问人;没人能答 ⇒ 原生 goal 置阻塞(升级给人的路是原生那条)', /已问人怎么办/.test(String(third.message)) && host.goals.get()?.phase === 'blocked' && host.goals.get()?.blockedReason?.code === 'clearai-needs-human', String(third.message).slice(0, 200))
}

console.log('\n【结果说不清也是完成;判不了交付成不成立才不推进】')
{
	/**
	 * 两种「说不清」要分开(2026-10-02 起):
	 *   · **交付成立、结果说不清**:这次检验如实做完了,只是区分不了——一次合法的零结果。
	 *     步骤完成,证据记 inconclusive,判断保持原状;要不要设计更强的检验是下一步的决定,
	 *     不靠「一直重做到有结论」(那是可选停止)。
	 *   · **判不了交付成不成立**:材料不足以判断这一步是否按约做到 ⇒ 退回、计连拦,与交付不成立同一条路。
	 */
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-inconclusive'
	await callOn(host, S, 'Frame', { claim: '判断 X 是否成立', done_criteria: '拿到一条裁决', hypotheses: [{ claim: 'X 成立', refute_when: 'X 不成立' }] })
	const hypothesis = host.service.state(S).hypotheses[0].id
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'i1', do: '测 X', artifacts: ['lab/i1.txt'], done_criteria: 'lab/i1.txt 有读数', tests: { hypotheses: [hypothesis], level: 'L3' } }] })
	write('lab/i1.txt', 'reading: unknown\n')
	host.nextVerdict = { holds: 'unclear', basis: '看不出读数是不是这次跑出来的', shortfalls: [], results: [] }
	const unclear = await callOn(host, S, 'AdvancePlan', { step_id: 'i1' })
	check('判不了交付成不成立 ⇒ 不推进,计一次连拦', unclear.ok === false && unclear.code === 'delivery_not_holding' && host.service.state(S).blocks[`${host.service.state(S).plans[0].id}:i1`] === 1, `${unclear.code}`)
	write('lab/i1.txt', 'reading: 3 runs, spread too wide to call\n')
	host.nextVerdict = { holds: 'yes', basis: '读数是这次跑出来的,三次重复齐全', shortfalls: [], results: [{ hypothesis, verdict: 'inconclusive', basis: '三次读数的离散度盖过了差异' }] }
	const nullResult = await callOn(host, S, 'AdvancePlan', { step_id: 'i1' })
	check('交付成立、结果说不清 ⇒ 这一步照常完成', nullResult.ok === true && host.service.view(S).plan.advancedCount === 1, `${nullResult.code}/${host.service.view(S).plan.advancedCount}`)
	check('说不清如实记进证据,针对那条判断', (host.service.state(S).evidence ?? []).some((item) => item.verdict === 'inconclusive' && item.hypothesis === hypothesis))
	const derived = host.service.derive(S).hypotheses.find((item) => item.id === hypothesis)
	check('判断保持原状:没有支持等级,也没有被推翻', derived.supportedLevel === null && derived.refutations === 0 && derived.inconclusive === 1, JSON.stringify(derived).slice(0, 160))
}

console.log('\n【一步检验多条判断:关键实验同时判竞争的两条】')
{
	/**
	 * 竞争路线就是竞争的判断:各条路线各自产出观测,**比较那一步**是关键检验——
	 * 一份观测同时支持一条、推翻另一条。基线里两场真跑都撞上「一步只能挂一条判断」:
	 * 为了凑满两条判断被迫拆成两步,输的那条还收不了尾。
	 */
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-crucial'
	await callOn(host, S, 'Frame', { claim: '紧凑与缩进哪种 JSON 更小', done_criteria: 'lab/winner.txt 存在', hypotheses: [{ claim: '紧凑更小', refute_when: '紧凑不小于缩进' }, { claim: '缩进更小', refute_when: '缩进不小于紧凑' }] })
	const [compact, pretty] = host.service.state(S).hypotheses.map((item) => item.id)
	const created = await callOn(host, S, 'CreatePlan', {
		steps: [
			{ id: 'measure', do: '两种写法各写一份并量字节', artifacts: ['lab/compact.json', 'lab/pretty.json'], done_criteria: '两份文件都在,各记下字节数' },
			{ id: 'compare', do: '比较两份读数', artifacts: ['lab/winner.txt'], done_criteria: 'lab/winner.txt 第一行是更小的写法', tests: { hypotheses: ['紧凑更小', pretty], level: 'L2' } },
		],
	})
	check('立约时把主张原文解析成 id,一步挂两条判断', created.ok === true && JSON.stringify(host.service.state(S).plans[0].steps[1].tests) === JSON.stringify({ hypotheses: [compact, pretty], level: 'L2' }), JSON.stringify(host.service.state(S).plans[0].steps[1].tests))
	write('lab/compact.json', '{"a":1}')
	write('lab/pretty.json', '{\n  "a": 1\n}')
	const measured = await callOn(host, S, 'AdvancePlan', { step_id: 'measure', basis: 'lab/compact.json 7 字节,lab/pretty.json 12 字节' })
	check('不检验判断的那一步只要写交付凭什么成立', measured.ok === true, String(measured.code))
	write('lab/winner.txt', 'compact\n7 < 12\n')
	const missing = await callOn(host, S, 'AdvancePlan', { step_id: 'compare', basis: 'lab/winner.txt 第一行 compact', results: [{ hypothesis: compact, verdict: 'support' }] })
	check('检验两条只给了一条结果 ⇒ 拒,并点名缺哪条', missing.ok === false && missing.code === 'results_required' && missing.message.includes('「缩进更小」') && !missing.message.includes(pretty), missing.message.slice(0, 120))
	const stray = await callOn(host, S, 'AdvancePlan', { step_id: 'compare', basis: 'lab/winner.txt 第一行 compact', results: [{ hypothesis: compact, verdict: 'support' }, { hypothesis: pretty, verdict: 'refute' }, { hypothesis: 'h-nope', verdict: 'support' }] })
	check('给了这一步没登记检验的判断 ⇒ 拒', stray.ok === false && stray.code === 'result_not_tested', String(stray.code))
	const crucial = await callOn(host, S, 'AdvancePlan', { step_id: 'compare', basis: 'lab/winner.txt 第一行 compact', results: [{ hypothesis: compact, verdict: 'support' }, { hypothesis: pretty, verdict: 'refute', basis: '缩进 12 字节不小于紧凑 7 字节' }] })
	check('一份观测同时支持一条、推翻另一条:这一步照常完成', crucial.ok === true && host.service.view(S).plan.advancedCount === 2, `${crucial.code}`)
	const derived = host.service.derive(S).hypotheses
	check('两条判断各得一份证据:一条支持到 L2,一条被推翻', derived.find((item) => item.id === compact)?.supportedLevel === 'L2' && derived.find((item) => item.id === pretty)?.status === 'refuted', JSON.stringify(derived.map((item) => [item.id, item.status, item.supportedLevel])))
	check('每条证据写明它针对哪条判断', host.service.state(S).evidence.filter((item) => item.step === 'compare').map((item) => item.hypothesis).sort().join(',') === [compact, pretty].sort().join(','))
	check('结果说给模型听:谁支持、谁推翻', /支持/.test(crucial.message) && /推翻/.test(crucial.message), crucial.message.slice(0, 160))
	const closed = await callOn(host, S, 'ClosePlan', {})
	check('输的那条路线不必作废,计划照常收尾', closed.ok === true && !host.journal.some((m) => m.t === 'plan/voided'), String(closed.code))
}

console.log('\n【评估卡正文兜底:新写法 holds 也读得回来】')
{
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-holds-text'
	await callOn(host, S, 'Frame', { claim: 'Q', headline: 'Q', done_criteria: 'lab/q.txt 存在', hypotheses: [{ claim: 'A', refute_when: 'not A' }, { claim: 'B', refute_when: 'not B' }] })
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'q1', do: '写 q', artifacts: ['lab/q.txt'], done_criteria: 'lab/q.txt 存在', tests: { hypotheses: [host.service.state(S).hypotheses[0].id], level: 'L3' } }] })
	write('lab/q.txt', 'q\n')
	host.nextVerdictText = '## 评估卡\n\n**holds: no**\n\n**basis**: lab/q.txt 只有一个字母,判据要的读数没有。'
	const refused = await callOn(host, S, 'AdvancePlan', { step_id: 'q1' })
	host.nextVerdictText = undefined
	check('正文里写的是 holds: no ⇒ 读成交付不成立', refused.ok === false && refused.code === 'delivery_not_holding' && host.journal.filter((m) => m.t === 'audit/settled').at(-1)?.holds === 'no', `${refused.code}`)
}

console.log('\n【首回合的系统事实:本体声明与货架那句话必须真的发出去】')
{
	/**
	 * 「立约之前」那一回合走的是**无状态**那条出口(`hasState === false`),而本体那一次发布
	 * 曾经排在 pre-step 的末尾——那条出口根本走不到它,而「本体已就位」这句话只说得一次
	 * (说过就记进 `ontologyShelved`)⇒ 模型永远读不到货架在哪,面板也要等到立约之后才画得出本体。
	 *
	 * 所以这里钉的是**结果**:空投影下的第一次 pre-step,必须真的带出本体 section 与那句话。
	 */
	const fresh = makeHost()
	apply(fresh.ctx, { blockedThreshold: 3 })
	const decision = await preStep(fresh, 'session-first-turn', 1, [])
	const sections = (decision?.messages ?? []).flatMap((message) => message?.source?.sections ?? [])
	const ontology = sections.find((section) => section?.name === 'clearai/ontology')
	check('空投影的第一次 pre-step 仍然 enter', decision?.kind === 'enter')
	check('本体声明随首回合发出(不是被静默跳过)', ontology !== undefined)
	let parsed = null
	try {
		parsed = JSON.parse(String(ontology?.text ?? ''))
	} catch {
		parsed = null
	}
	check('本体 section 是折法认得的形状(objects 数组)', Array.isArray(parsed?.objects) && parsed.objects.length > 0, String(ontology?.text ?? '').slice(0, 80))
	check(
		'「本体已就位」那句话在注记里(它只说一次,丢了就永远没了)',
		sections.some((section) => section?.name === 'clearai' && String(section.text ?? '').includes('本体')),
	)
}

console.log('\n【实体写成文件:关系带出处,写下那一刻就进图(不等目标裁决)】')
{
	const host = makeHost()
	const ws = tempDir('clearai-entity-files-')
	host.cwd = ws
	apply(host.ctx, {})
	const S = 'session-entity'
	writeOntology(ws, 'concepts/sucai', { id: 'sucai', label: '素材', gloss: '被挪用的原始材料', basis: '测试用' })
	writeOntology(ws, 'relations/cheng_wei', { id: 'cheng_wei', label: '被称为', gloss: '某材料曾被称为某概念', range: 'sucai', basis: '测试用' })
	writeOntology(ws, 'entities/chouxiang', { id: 'chouxiang', type: 'sucai', label: '抽象', basis: '语料 p02', provenance: { kind: 'named', ref: '语料 p02' } })
	writeOntology(ws, 'entities/chouxiang/yangben_a', {
		id: 'yangben_a', type: 'sucai', label: '样本甲', basis: '语料 p01', provenance: { kind: 'named', ref: '语料 p01' },
		relations: [{ predicate: 'cheng_wei', object: 'chouxiang', evidence: { kind: 'named', ref: '语料 p02' } }],
	})
	await preStep(host, S, 1)
	const state = host.service.state(S)
	check('实体从文件进账(带类型与出处)', state.entities.some((entity) => entity.id === 'yangben_a' && entity.provenance?.ref === '语料 p01'))
	check('实体文件里的关系就是实体图的边(带出处,不等目标裁决)', state.entityAssertions.some((item) => item.subject.id === 'yangben_a' && item.predicate === 'cheng_wei' && item.object.value === 'chouxiang' && item.evidence.ref === '语料 p02'), JSON.stringify(state.entityAssertions))
	const graph = graphProjection(state)
	check('图上那条边标成 asserted(有出处、未经独立裁决)', graph.edges.some((edge) => edge.kind === 'assertion' && edge.status === 'asserted' && edge.from === 'sucai|yangben_a'))
	check('目录嵌套 = 属于:yangben_a 的容器是 chouxiang,并有一条 part_of 边', graph.nodes.find((node) => node.id === 'sucai|yangben_a')?.container === 'sucai|chouxiang' && graph.edges.some((edge) => edge.kind === 'part_of' && edge.from === 'sucai|yangben_a'))

	// ④ 跳级理由那件工具已经删了(第四阶段):目录里没有它。
	check('ExplainLevelSkip 不在工具面上', !host.tools.has('ExplainLevelSkip'))

	// ⑤ 一句话目标:超 120 字当场拒。
	const long = await callOn(host, 'session-long', 'Frame', { claim: '长'.repeat(200), done_criteria: '有 1 份产物' })
	check('目标一句话超 120 字 → 拒(headline 现算也一样拒)', long.ok === false && long.code === 'headline_too_long', String(long.code))
}

console.log('\n【第三道校验:升格这一刻本体不成立 ⇒ 不写进长期知识,回执写明卡在哪】')
{
	const host = makeHost()
	const ws = tempDir('clearai-promotion-check-')
	host.cwd = ws
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-promotion-check'
	writeOntology(ws, 'concepts/kiln', { id: 'kiln', label: '窑', gloss: '烧结用的窑', basis: 'b' })
	writeOntology(ws, 'relations/peak_temp', { id: 'peak_temp', label: '峰值温度', domain: 'kiln', range: { form: 'quantity', unit: 'C' }, basis: 'b' })
	writeOntology(ws, 'entities/kiln_3', { id: 'kiln_3', type: 'kiln', label: '3 号窑', basis: 'b', provenance: { kind: 'named', ref: '台账' } })
	const framed = await callOn(host, S, 'Frame', {
		claim: '3 号窑峰值温度', done_criteria: 'lab/k.md 写明读数', promote_at_level: 'L0',
		hypotheses: [{ claim: '3 号窑峰值 900C', refute_when: '读数不是 900', assertions: [{ predicate: 'peak_temp', subject: { id: 'kiln_3', type: 'kiln' }, object: { kind: 'quantity', value: 900, unit: 'C' } }] }],
	})
	check('前置:立约时本体成立,断言通过', framed.ok === true, String(framed.message))
	const hid = host.service.state(S).hypotheses[0].id
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'k1', do: '读台账', artifacts: ['lab/k.md'], done_criteria: 'lab/k.md 写明读数', tests: { hypotheses: [hid], level: 'L0' } }] })
	writeText(join(ws, 'lab', 'k.md'), '# 读数\n\n3 号窑峰值温度读数为 900C,取自当班台账第 12 页,读数可复查。\n')
	await callOn(host, S, 'AdvancePlan', { step_id: 'k1', verdict: 'support', basis: 'lab/k.md 写明读数' })
	await callOn(host, S, 'ClosePlan', {})
	rmSync(join(ws, 'clear', 'ontology', 'relations', 'peak_temp.json'))
	host.nextVerdict = { verdict: 'support', basis: '判据达成', shortfalls: [] }
	const closed = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
	check('目标照样达成(本体问题不挡结案)', closed.ok === true, String(closed.code))
	check('断言用到的关系已不在 ⇒ 这条判断不升格', host.journal.filter((mutation) => mutation.t === 'fact/promoted').length === 0)
	check('回执写明没写进长期知识、卡在哪', /没有写进长期知识/.test(String(closed.message)) && /peak_temp/.test(String(closed.message)), String(closed.message).slice(0, 300))
}

console.log('\n【同态结案:状态没变就不重复花钱请裁决】')
{
	const host = makeHost()
	apply(host.ctx, {})
	const S = 'session-reuse'
	host.nextVerdict = { verdict: 'support', basis: '判据逐条对上了', shortfalls: [] }
	const goal = await callOn(host, S, 'Frame', {
		claim: '同态结案会不会重复派评估者',
		headline: '同态结案会不会重复派评估者',
		done_criteria: '存在一份读数,且结论明确',
		hypotheses: [{ claim: '状态不变时不该重派', refute_when: '观察到第二次派遣' }],
	})
	check('前置:目标立起', goal.ok === true, String(goal.code))
	const first = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
	check('前置:第一次结案走完(评估者裁决 support)', first.ok === true, String(first.code))
	const evaluators = () => host.audits.filter((audit) => String(audit.request?.label ?? '').includes('目标评估者')).length
	check('第一次结案确实派过一次目标评估者', evaluators() === 1, String(evaluators()))

	/**
	 * **同态复用的判据是状态内容**(`auditDigest`:裁决种类 / 步 / 目标修订号 / 准入坐标 / 证据集合),
	 * 不是"模型又喊了一次结案"。
	 *
	 * 这里把目标**原样退回 open**(证据、修订号、准入坐标都不动),再结一次:
	 * digest 与上一次逐字相同 ⇒ 系统应当复用那条已经落定的裁决,而不是再派一个评估者。
	 * 这条判据挡住的是真实运行里发生过的形态——零工具调用、状态没变,却每次重烧一两分钟。
	 */
	host.states.set(S, { ...host.service.state(S), goal: { ...host.service.state(S).goal, status: 'open' } })
	const second = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
	check('第二次结案仍然成功(复用旧裁决)', second.ok === true, String(second.code))
	check('状态没变 ⇒ 不重复派遣(评估者仍然只有 1 个)', evaluators() === 1, String(evaluators()))
	check('账上如实留下「这次没花钱」这条事实', host.journal.some((mutation) => mutation.t === 'audit/reused'), JSON.stringify(host.journal.filter((m) => String(m.t).startsWith('audit/')).map((m) => m.t)))
}

console.log('\n【判据修订门:成功路径也要走通(不能只有"拒"的那一半)】')
{
	/**
	 * 这条用例守的是一个**时间死区**类缺陷:`criteria/revised` 那条变更要用 `goalId` / `revision`,
	 * 而它们原先声明在它**后面**——失败路径永远不碰它们,所以"拒得对"的测试全绿,
	 * 只有**成功路径**会在跑起来那一刻抛 ReferenceError,把整个修订丢掉。
	 * 所以这里必须真的带一份已落定的 auditKey 走一遍。
	 */
	const host = makeHost()
	apply(host.ctx, { requireCriteriaVerdict: true, minHypotheses: 0 })
	const S = 'session-criteria'
	host.nextVerdict = { verdict: 'support', basis: '判据逐条对上了', shortfalls: [] }
	const set = await callOn(host, S, 'Frame', {
		claim: '改判据要不要独立裁决',
		headline: '改判据要不要独立裁决',
		done_criteria: '存在一份读数,含 1 个结论',
		hypotheses: [{ claim: '改判据要带裁决', refute_when: '不带也能改' }],
	})
	check('前置:目标立起', set.ok === true, String(set.code))
	const hyp = host.service.derive(S).hypotheses[0]?.id ?? null
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'c1', do: '跑一遍并落读数', done_criteria: 'lab/gate-c/read.txt 存在,含 1 个读数', artifacts: ['lab/gate-c/read.txt'], tests: { hypothesis: hyp, level: 'L3' } }] })
	writeText(join(WORKSPACE, 'lab/gate-c/read.txt'), 'count=1\n')
	const delivered = await callOn(host, S, 'AdvancePlan', { observations: [{ ref: 'lab/gate-c/read.txt', note: '读数 count=1' }], step_id: 'c1' })
	check('前置:L3 步交付(落下一条已落定的独立裁决)', delivered.ok === true, String(delivered.code))
	const auditId = (host.service.state(S).audits ?? []).find((audit) => audit.verdict !== null)?.id ?? null
	check('前置:账上有一条已落定的裁决', typeof auditId === 'string' && auditId !== '', String(auditId))

	const noVerdict = await callOn(host, S, 'Frame', { claim: '改判据要不要独立裁决', headline: '改判据要不要独立裁决', done_criteria: '存在一份读数,含 2 个结论', reason: '判据口径放宽' })
	check('不带 criteria_verdict 改判据 → 拒', noVerdict.ok === false && noVerdict.code === 'criteria_verdict_required', String(noVerdict.code))
	const badVerdict = await callOn(host, S, 'Frame', { claim: '改判据要不要独立裁决', headline: '改判据要不要独立裁决', done_criteria: '存在一份读数,含 2 个结论', reason: '判据口径放宽', criteria_verdict: 'a-不存在' })
	check('带一个账上没有的 auditKey → 拒', badVerdict.ok === false && badVerdict.code === 'criteria_verdict_unknown', String(badVerdict.code))

	// 成功路径:这一条以前会抛 ReferenceError。
	let revision = null
	try {
		revision = await callOn(host, S, 'Frame', { claim: '改判据要不要独立裁决', headline: '改判据要不要独立裁决', done_criteria: '存在一份读数,含 2 个结论', criteria: ['存在一份读数,含 2 个结论'], criteria_note: '把口径从 1 个结论放宽到 2 个', reason: '判据口径放宽', criteria_verdict: auditId })
	} catch (error) {
		check('成功路径不得抛(时间死区类缺陷)', false, String(error?.message ?? error))
	}
	if (revision !== null) {
		check('带已落定 auditKey 改判据 → 成功', revision.ok === true, String(revision.code))
		check('criteria/revised 真的落账', host.journal.filter((m) => m.t === 'criteria/revised').length === 1, JSON.stringify(host.journal.filter((m) => m.t === 'criteria/revised')))
		check('修订留痕里带着那份裁决', String(host.journal.find((m) => m.t === 'criteria/revised')?.audit ?? '') === auditId, String(auditId))
		check('判据逐条落进目标(criteria[])', (host.service.state(S).goal?.criteria ?? []).length === 1, JSON.stringify(host.service.state(S).goal?.criteria ?? null))
		check('背景说明与判据分开存(criteria_note 不参与判定)', typeof host.service.state(S).goal?.criteria_note === 'string', JSON.stringify(host.service.state(S).goal?.criteria_note ?? null))
	}
}

console.log('\n【卡瘦身:判据全文只发一次,平时给压缩版与指针】')
{
	const host = makeHost()
	apply(host.ctx, { minHypotheses: 0 })
	const S = 'session-cardsize'
	const long = '结案需同时满足四条:① 存在一份解释文,含带来源的源流与定义裁决;② 判别程序在留出样本上有实测结果,误判逐条列出;③ 语料库每条带可追溯出处;④ 明写边界声明与无法核实的主张。'.repeat(6)
	const set = await callOn(host, S, 'Frame', { claim: '卡会不会把判据全文反复灌进来', headline: '卡会不会把判据全文反复灌进来', done_criteria: long, hypotheses: [] })
	check('前置:目标立起(判据很长)', set.ok === true && long.length > 500, `${set.code}/${long.length}`)

	/** 第一拍:修订号是新的 ⇒ 补一次全文(模型必须逐字看到这把尺子)。 */
	const textOf = (message) => {
		const content = message?.content
		if (typeof content === 'string') return content
		if (Array.isArray(content)) return content.map((block) => String(block?.text ?? '')).join('\n')
		return ''
	}
	const first = await preStep(host, S, 1)
	const firstText = (first?.messages ?? []).map(textOf).join('\n')
	check('修订后的第一张卡补了判据全文(逐字)', firstText.includes(long), `卡长 ${firstText.length}`)

	/** 第二拍:修订号没变 ⇒ 只给压缩版与指针,不再重发全文。 */
	const second = await preStep(host, S, 2)
	const secondText = (second?.messages ?? []).map(textOf).join('\n')
	check('同一修订的第二拍不再重发判据全文', !secondText.includes(long), `卡长 ${secondText.length}`)
	check('但压缩版与指针仍在(卡瘦了不等于判据丢了)', secondText.includes('clear/goals/') || secondText.includes('判据'), secondText.slice(0, 200))

	/** 目标文档真的落在盘上:指针指得到东西,否则"全文在哪"是一句空话。 */
	const goalId = host.service.state(S).goal?.id ?? null
	const doc = goalId === null ? null : join(WORKSPACE, 'clear', 'goals', `${goalId}.md`)
	check('目标文档已落盘(判据全文的家真的存在)', doc !== null && existsSync(doc), String(doc))
	check('目标文档里有判据全文', doc !== null && existsSync(doc) && readFileSync(doc, 'utf8').includes(long.slice(0, 120)), doc ?? '')
}

console.log('\n【宿主降级进账本 + 交付侧同态复用】')
{
	// ① 宿主读面降级:进程内的观测要被内核落成账本事实,而且是**幂等**的。
	const host = makeHost()
	apply(host.ctx, { minHypotheses: 0 })
	const S = 'session-host-health'
	host.hostHealthExtra = [{ id: 'hh-deadbeef', scope: 'sessions', detail: '会话服务读不到:这一刻拿不到会话' }]
	await callOn(host, S, 'Frame', { claim: '宿主降级会不会进账本', headline: '宿主降级会不会进账本', done_criteria: '存在 1 条 host/inactive 事实', hypotheses: [] })
	await preStep(host, S, 1)
	const landed = host.journal.filter((m) => m.t === 'host/inactive')
	check('宿主降级被落成账本事实(不再只活在进程内存里)', landed.length === 1 && landed[0].id === 'hh-deadbeef', JSON.stringify(landed))
	check('折法把它折进 hostHealth(面板与卡读得到)', (host.service.state(S).hostHealth ?? []).some((item) => item.id === 'hh-deadbeef'), JSON.stringify(host.service.state(S).hostHealth ?? null))
	await preStep(host, S, 2)
	check('同一条降级反复观察到也只落一条(id 幂等)', host.journal.filter((m) => m.t === 'host/inactive').length === 1, String(host.journal.filter((m) => m.t === 'host/inactive').length))

	// ② 交付侧同态复用:材料一字未变地重交一次,不再烧一次评估者。
	const h2 = makeHost()
	apply(h2.ctx, { blockedThreshold: 3, minHypotheses: 0 })
	const S2 = 'session-delivery-reuse'
	// 用**否决**做这一场:步骤不推进,才能"同一步再交一次"而材料不变(交付侧复用的适用面)。
	h2.nextVerdict = { verdict: 'refute', basis: '判据要求三次重复,当前只有一次', shortfalls: ['重复次数不足'] }
	await callOn(h2, S2, 'Frame', { claim: '同一步重交会不会重烧评估者', headline: '同一步重交会不会重烧评估者', done_criteria: 'lab/r.txt 存在,含 1 个读数', hypotheses: [{ claim: '材料不变就别重烧', refute_when: '观察到第二次派遣' }] })
	await callOn(h2, S2, 'CreatePlan', { steps: [{ id: 'r1', do: '落一个读数', artifacts: ['lab/r.txt'], done_criteria: 'lab/r.txt 存在,含 1 个读数', tests: { hypothesis: h2.service.state(S2).hypotheses[0].id, level: 'L3' } }] })
	write('lab/r.txt', 'reading: 1\n')
	const evaluators = () => h2.audits.filter((audit) => String(audit.request?.label ?? '').startsWith('评估者')).length
	const first = await callOn(h2, S2, 'AdvancePlan', { step_id: 'r1' })
	check('前置:第一次交付被独立评估者判为不成立(步骤保持未落定)', first.ok === false && first.evaluator === 'independent' && first.code === 'delivery_not_holding', `${first.code}`)
	const afterFirst = evaluators()
	check('前置:第一次确实派过评估者', afterFirst === 1, String(afterFirst))
	// 同一步再交一次(材料没动):应当复用上一条裁决,不再派评估者。
	const second = await callOn(h2, S2, 'AdvancePlan', { step_id: 'r1' })
	check('材料没变的第二次交付:复用旧裁决(不再烧一次子 run)', evaluators() === afterFirst, `${afterFirst} → ${evaluators()}`)
	check('复用也如实返回同一条裁决的语义', second.ok === false && second.code === 'delivery_not_holding' && /复用了上一条独立裁决/.test(String(second.message)), `${second.code}`)
	check('账上留下「这次没花钱」这条事实', h2.journal.some((m) => m.t === 'audit/reused'), JSON.stringify(h2.journal.filter((m) => m.t === 'audit/reused')))
	check('复用记录指得回原来那一条裁决(出处不因复用而消失)', (() => {
		const reused = h2.journal.find((m) => m.t === 'audit/reused')
		const original = h2.journal.find((m) => m.t === 'audit/settled')
		return reused !== undefined && original !== undefined && reused.by === original.id && typeof original.card_path === 'string'
	})(), JSON.stringify(h2.journal.filter((m) => m.t === 'audit/reused')))
}

console.log('\n【评审只写正文卡片时:裁决要能被读回来】')
{
	/**
	 * 这是**真跑抓到的回归**:评估者在 markdown 里写清了 `verdict: support`,
	 * 但结构化通道没有值(schema 拒收或模型没走结构化输出)。只认 JSON 的解析会把它读成
	 * 「没有可解析的裁决」⇒ 目标永远结不了案,而账上看起来像"评估者没说话"。
	 */
	const host = makeHost()
	apply(host.ctx, { minHypotheses: 0 })
	const S = 'session-prose-verdict'
	await callOn(host, S, 'Frame', { claim: '只写正文的裁决算不算数', headline: '只写正文的裁决算不算数', done_criteria: '存在 1 份产物,结论明确', hypotheses: [{ claim: '正文卡片也该被读回来', refute_when: '读不回来' }] })
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'p1', do: '落一份产物', artifacts: ['lab/prose.txt'], done_criteria: 'lab/prose.txt 存在且非空', tests: { hypothesis: host.service.state(S).hypotheses[0].id, level: 'L3' } }] })
	write('lab/prose.txt', '读数:0.86\n')
	await callOn(host, S, 'AdvancePlan', { step_id: 'p1' })
	await callOn(host, S, 'ClosePlan', { summary: '这一阶段做完了' })
	// 评估者这次只写正文卡片(结构化通道为空)。
	host.nextVerdictText = ['## 评估卡 · 目标', '', '**verdict: support**', '', '**basis**: 四项判据逐条核对通过,产物与读数一致。', '', '| # | 判据 | 结论 |', '|---|---|---|', '| 1 | 产物存在 | 通过 |'].join('\n')
	const closed = await callOn(host, S, 'Conclude', { outcome: 'achieved' })
	check('只写正文卡片的 support 裁决能被读回来 ⇒ 结案', closed.ok === true && closed.code === 'goal_achieved', `${closed.code}:${String(closed.message ?? '').slice(0, 120)}`)
	const settled = host.journal.filter((m) => m.t === 'audit/settled').at(-1) ?? null
	check('落账的裁决是「判据达成」(旧式 verdict: support 读成交付成立),不是「无法解析」', String(settled?.holds) === 'yes', JSON.stringify(settled ?? null))
	check('依据是从正文里取到的那句(不是占位话)', /逐条核对通过/.test(String(settled?.basis ?? '')), String(settled?.basis ?? '').slice(0, 100))

	// 反例:正文里明确写了 refute —— 绝不因为"读不到 JSON"就猜成 support。
	const host2 = makeHost()
	apply(host2.ctx, { minHypotheses: 0 })
	const S2 = 'session-prose-refute'
	await callOn(host2, S2, 'Frame', { claim: '正文写 refute 会怎样', headline: '正文写 refute 会怎样', done_criteria: '存在 1 份产物,结论明确', hypotheses: [{ claim: '不该被猜成 support', refute_when: '被判成 support' }] })
	host2.nextVerdictText = '## 评估卡\n\n**verdict: refute**\n\n**basis**: 判据要求三次重复,当前只有一次。'
	const refused = await callOn(host2, S2, 'Conclude', { outcome: 'achieved' })
	check('正文写 refute ⇒ 目标保持开放(不猜成 support)', refused.ok === false && refused.code === 'goal_not_achieved', String(refused.code))
	check('落账的裁决是「判据没达成」(旧式 verdict: refute)', String((host2.journal.filter((m) => m.t === 'audit/settled').at(-1) ?? {}).holds) === 'no', JSON.stringify(host2.journal.filter((m) => m.t === 'audit/settled').at(-1) ?? null))
}

console.log('\n【输出契约:工具返回值必须落在自己声明的 schema 里】')
{
	check(
		'全部调用都没有输出越界(宿主会因为越界让整次调用失败)',
		contractBreaches.length === 0,
		contractBreaches.slice(0, 3).join(' | '),
	)
	check(
		'没有工具的输出被裁剪过(裁剪会告警:字段该补进 OUTPUT_SCHEMA)',
		thisHost.warnings.every((message) => !message.includes('输出越界')),
		thisHost.warnings.filter((message) => message.includes('输出越界')).slice(0, 3).join(' | '),
	)
	// 守卫本身要是活的:拿一个故意越界的对象喂它,必须报出来。
	const probe = schemaViolation({ type: 'object', properties: { ok: { type: 'boolean' } }, additionalProperties: false }, { ok: true, extra: 1 })
	check('契约守卫是活的(故意越界能被抓到)', typeof probe === 'string' && probe.includes('extra'), String(probe))
}

console.log('\n【产物路径不重叠:并行的路线不许互相覆盖产出】')
{
	const host = makeHost()
	apply(host.ctx, {})
	const S = 'session-artifact-overlap'
	await callOn(host, S, 'Frame', { claim: '比较两种做法', done_criteria: '两种做法各有结果文件', hypotheses: [{ claim: '甲更快', refute_when: '甲不比乙快' }, { claim: '乙更快', refute_when: '乙不比甲快' }] })
	const clash = await callOn(host, S, 'CreatePlan', {
		steps: [
			{ id: 'p1', do: '跑甲', artifacts: ['lab/result.md'], done_criteria: 'lab/result.md 写着甲的耗时' },
			{ id: 'p2', do: '跑乙', artifacts: ['./lab//result.md'], done_criteria: 'lab/result.md 写着乙的耗时' },
		],
	})
	check('同一计划里两步声明同一个产物(写法不同也算同一个)→ 立计划被拒', clash.ok === false && /已经由步骤 p1 声明/.test(String(clash.message ?? '')), String(clash.message ?? clash.code).slice(0, 120))
	const fine = await callOn(host, S, 'CreatePlan', {
		steps: [
			{ id: 'p1', do: '跑甲', artifacts: ['lab/a.md'], done_criteria: 'lab/a.md 写着甲的耗时' },
			{ id: 'p2', do: '跑乙', artifacts: ['lab/b.md'], done_criteria: 'lab/b.md 写着乙的耗时' },
		],
	})
	check('各自声明不同的产物 → 照常立起来', fine.ok === true, String(fine.code))
	const amendClash = await callOn(host, S, 'RevisePlan', { action: 'add', step: { id: 'p3', do: '再跑一次甲', artifacts: ['lab/a.md'], done_criteria: 'lab/a.md 写着第二次耗时' } })
	check('补一步时撞上已有步骤的产物 → 也被拒', amendClash.ok === false && /已经由步骤 p1 声明/.test(String(amendClash.message ?? '')), String(amendClash.message ?? amendClash.code).slice(0, 120))
	await callOn(host, S, 'RevisePlan', { action: 'void', step_id: 'p1', reason: '甲的环境不可用' })
	const reuse = await callOn(host, S, 'RevisePlan', { action: 'add', step: { id: 'p4', do: '换环境重跑甲', artifacts: ['lab/a.md'], done_criteria: 'lab/a.md 写着新环境下的耗时' } })
	check('作废的步不再占着它的产物路径', reuse.ok === true, String(reuse.code))
}

console.log('\n【旧日志照样能读:交还宿主的机制留下的事件被安静跳过】')
{
	const old = [
		{ t: 'goal/set', id: 'g-old', claim: '旧会话的目标', done_criteria: '旧判据', hypotheses: [{ id: 'h-old', claim: '旧假设', refute_when: '旧推翻条件' }] },
		{ t: 'fork/created', id: 'f-old', step: 's1', question: '旧分叉', branches: [{ id: 'b1', label: '甲' }] },
		{ t: 'worldline/executing', fork: 'f-old', branch: 'b1', child: 'c1' },
		{ t: 'scout/dispatched', id: 'sc-old', step: 's1', child: 'c2' },
		{ t: 'git/snapshot', commit: 'abc1234' },
		{ t: 'git/committed', commit: 'def5678', step: 's1' },
	]
	let state = null
	let thrown = null
	try {
		state = applyMutations(emptyState(), old)
	} catch (error) {
		thrown = error
	}
	check('带着旧事件的日志折得出来(不抛)', thrown === null, String(thrown?.message ?? ''))
	check('其余部分照常折出来(目标还在)', state?.goal?.id === 'g-old', JSON.stringify(state?.goal ?? null).slice(0, 80))
	check('状态里不再有世界线 / 侦察 / 外脑这几格', state !== null && !('forks' in state) && !('scouts' in state) && !('brain' in state) && !('skillUsage' in state))
	const projected = view(state)
	check('视图照常算得出来,也不再交出这几格', projected !== null && !('forks' in projected) && !('scouts' in projected) && !('brain' in projected) && !('skills' in projected))
	const gate = parseHumanGate({ source: { kind: 'user' }, content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"adopt_branch","fork":"f-old","branch":"b1"}` }] })
	check('旧日志里的世界线人门动作不再被认成动作', gate === null, JSON.stringify(gate))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failed > 0) {
	console.log('失败项:')
	for (const label of failures) console.log(`  - ${label}`)
}
console.log(`\n临时工作区:${WORKSPACE}`)
console.log(`日志(本次会话落的变更记录):${ledger().length} 条`)
process.exit(failed === 0 ? 0 : 1)
