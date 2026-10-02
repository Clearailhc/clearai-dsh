
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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir, trackTemp } from './tmp.mjs'
import { execFileSync } from 'node:child_process'
import { CONFIG_KEYS, HUMAN_GATE_MARK, apply } from '../preset/plugins/clearai-kernel.js'
import { applyEvent, applyMutations, derive, emptyState, parseHumanGate, renderCard, view } from '../ui/lib/fold.js'
import { describeDomainShelf, formatAssertion, validateAssertions, validatePredicate, validateTerm } from '../ui/lib/domain-language.js'
import { SECTIONS, SECTION_SLOTS, SECTION_TABLE } from '../preset/plugins/prompts.js'

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
			return { state: next, card: renderCard(next), view: view(next) }
		},
		/**
		 * **领域判据的宿主门**(与生产半 `ui/lib/index.js` 的 facade 同形)。
		 * 判据本身来自纯函数模块——测试也不许自己写一份,否则「登记时放行、升格时拒绝」
		 * 这类漂移在测试里同样看不见。
		 */
		domain: {
			validateTerm: (id, draft) => validateTerm(service.state(id).lexicon, draft),
			validatePredicate: (id, draft) => validatePredicate(service.state(id).lexicon, draft),
			validateAssertions: (id, assertions, options = {}) => validateAssertions(service.state(id), assertions, options),
			renderShelf: (id, mutations = []) => {
				const state = applyMutations(service.state(id), Array.isArray(mutations) ? mutations : [])
				const next = derive(state)
				return describeDomainShelf(state.lexicon, next.factRows, next.hypotheses)
			},
			format: (id, assertion) => formatAssertion(service.state(id).lexicon, assertion),
		},
	}
	// 宿主的 `goals` 服务桩:续跑窗口用的就是它。它记下每一次调用,测试据此断言
	// 「布防 / 对齐 / 收兵 / 报阻塞 / 重启补防」真的发生了——而不是以为发生了。
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

const write = (rel, content) => {
	const parts = rel.split('/')
	if (parts.length > 1) mkdirSync(join(WORKSPACE, parts.slice(0, -1).join('/')), { recursive: true })
	writeFileSync(join(WORKSPACE, rel), content)
}

console.log('\n【装配面】')
check(
	'九件意图工具全部注册',
	['SetGoal', 'CloseGoal', 'CreatePlan', 'CheckPlan', 'AdvancePlan', 'AmendPlan', 'RefinePlan', 'VoidPlanStep', 'ClosePlan'].every((name) => thisHost.tools.has(name)),
)
check('工具 schema 里没有 status / progress / phase 这类可宣告状态的字段(P2 不可表示)', () => false || ![...thisHost.tools.values()].some((tool) => /"status"|"progress"|"phase"/.test(JSON.stringify(tool.parameters))))
check('注册了 tools/pre-execute 与 agent/pre-step 两个机制位', thisHost.listeners.has('tools/pre-execute') && thisHost.listeners.has('agent/pre-step'))

console.log('\n【提示词面:预设的提示词段】')
{
	const registered = thisHost.sections
	const byName = (name) => registered.find((section) => section.name === name)
	const totalBytes = registered.reduce((sum, section) => sum + String(section.text ?? '').length, 0)
	// 段表是目录(21 段),实际注册的是其中一套澄清措辞(SECTIONS.length - 1):
	// 两套互斥措辞由 autonomy 收敛,不会同时在场(见「装配:贡献表驱动」一节)。
	check(
		'段数 = 段表 − 另一套澄清措辞(全部注册成功)',
		registered.length === SECTIONS.length - 1 && registered.length >= 17 && new Set(registered.map((s) => s.name)).size === registered.length,
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
	check('总字节在预算内(< 24KB,别把上下文挤爆)', totalBytes < 24000, `${totalBytes} 字节`)
	check(
		'稳定段里没有时间/随机字节(前缀缓存是硬约束,不是优化)',
		registered.every((section) => !/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|0x[0-9a-f]{6}/.test(String(section.text ?? ''))),
	)
	check('公理段在:让模型负责智能判断,让系统负责事实边界(原文全角标点,断言标点无关)', /让模型负责智能判断[，,]让系统负责事实边界/.test(String(byName('clearai/foundation')?.text ?? '')))
	check('语言跟着人走(不再把中文写死)', /跟着人走/.test(String(byName('clearai/foundation')?.text ?? '')) && !/全程中文|禁止漂移/.test(String(byName('clearai/foundation')?.text ?? '')))
	check('世界线段不在了(并行探索交给原生子任务,不再自带一套)', byName('clearai/worldline') === undefined)
	check('提示词里不再提已删除的工具', !/ForkPlan|AdvanceWorldline|ConvergeFork|AwaitWorldlines|SpawnScout|MapScouts|SaveSkill|WriteMemory/.test(SECTIONS.map((section) => String(section.text ?? '')).join('\n')))
	check('网页是不可信数据(安全相关的那条)', /untrusted|不可信/.test(String(byName('clearai/web-research')?.text ?? '')))
	check('交付协议在(怎么把交付物呈现给人)', (byName('clearai/delivery')?.text ?? '').length > 100)
	check('环境段刻意不含时间(时间由运行态卡承载)', !/\d{2}:\d{2}/.test(String(byName('clearai/environment')?.text ?? '')))
	check('子任务意识段在:开工先摸清地形再立约 + 任务必须自包含', /先摸清地形,再立约/.test(String(byName('clearai/delegation')?.text ?? '')) && /自包含/.test(String(byName('clearai/delegation')?.text ?? '')))
	check('委派段写明并行探索 = 竞争的假设,各自声明不同的产物路径', /并行探索就是并行检验/.test(String(byName('clearai/delegation')?.text ?? '')) && /不同的/.test(String(byName('clearai/delegation')?.text ?? '')))
	check('委派段不承诺不存在的机制(不出现 background 自动回灌)', !/background/.test(String(byName('clearai/delegation')?.text ?? '')))
	check('循环契约段在:四拍 + 唯一完成动词 + 准入不裁决', /唯一完成动词/.test(String(byName('clearai/loop-contract')?.text ?? '')) || /唯一.*动词/.test(String(byName('clearai/loop-contract')?.text ?? '')))
}

console.log('\n【装配:贡献表驱动(阶段 3)】')
{
	const NAMES = [
		'SetGoal', 'CloseGoal', 'CreatePlan', 'CheckPlan', 'RequestPlanReview', 'AmendPlan', 'RefinePlan', 'VoidPlanStep', 'ClosePlan', 'AdvancePlan',
		'RegisterTerm', 'RegisterPredicate', 'ReviseTerm', 'RevisePredicate', 'DeprecateTerm', 'DeprecatePredicate', 'RegisterInstance', 'Assert', 'ExplainLevelSkip', 'QueryKnowledge',
	]
	// 工具面是**清单事实**,不是注释里的一句话:注册出来的名字集合必须与目录逐字相符。
	check('工具面恰好 20 件(实测,不是推断)', thisHost.tools.size === 20, `${thisHost.tools.size} 件`)
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
	rejects('未知工具名 → 装配期抛错', { contributions: { tools: ['SetGoal', 'NoSuchTool'] } }, /unknown_tool:clearai-kernel:NoSuchTool/)
	rejects('未知段名 → 装配期抛错', { contributions: { sections: ['clearai/foundation', 'clearai/nope'] } }, /unknown_policy_slot:clearai-kernel:clearai\/nope/)
	rejects('未知机制名 → 装配期抛错', { contributions: { mechanisms: { telepathy: true } } }, /unknown_mechanism:clearai-kernel:telepathy/)
	rejects(
		'关掉机制却仍要装它的工具 → 装配期抛错',
		{ contributions: { mechanisms: { ontology: false }, tools: ['Assert'] } },
		/tool_of_disabled_mechanism:clearai-kernel:Assert:ontology/,
	)
	// 2026-09-11:contributions 里的 `budgets` 块与 `tokenBudget` 一起删了(它们从未被执行)。
	// 两个数值旋钮现在是**普通配置键**,校验也跟着从 contributions 搬到配置面。
	rejects('已经删掉的 contributions.budgets 不再被接受(旧写法必须装配期炸,而不是静默失效)', { contributions: { budgets: { maxAutoTurns: 3 } } }, /unknown_contribution:clearai-kernel:budgets/)
	rejects('轮数上限不是正整数 → 装配期抛错', { maxAutoTurns: 0 }, /invalid_config:clearai-kernel:maxAutoTurns/)
	rejects('连拦阈值不是正整数 → 装配期抛错', { blockedThreshold: -2 }, /invalid_config:clearai-kernel:blockedThreshold/)
	rejects(
		'互斥的两套澄清措辞不许按字面装(只能经槽位)',
		{ contributions: { sections: ['clearai/clarification-attended'] } },
		/autonomy_section_must_use_slot:clearai-kernel:clearai\/clarification-attended/,
	)

	rejects('配置键名写错(拼错 autonomy)→ 装配期抛错', { autonomoy: 'unattended' }, /unknown_config:clearai-kernel:autonomoy/)
	// 两个键(`collectRetryMs` / `executorTimeoutMs`)在白名单里躺了很久却**没有任何读者**:
	// 一个描述的策略早被「回合 epoch 去重」取代,一个承诺的执行者超时根本不存在。它们已经摘除,
	// 旧配置必须当场炸——「配了没生效」正是这套装配纪律要消灭的那一类错。
	rejects('已摘除的 collectRetryMs 不再被接受(它从来没有人读)', { collectRetryMs: 0 }, /unknown_config:clearai-kernel:collectRetryMs/)
	rejects('已摘除的 executorTimeoutMs 不再被接受(它从来没有人读)', { executorTimeoutMs: 1 }, /unknown_config:clearai-kernel:executorTimeoutMs/)
	// 交还宿主的机制:它们的机制名与配置键都必须装配期炸,不许静默无效。
	for (const mechanism of ['worldline', 'scout', 'brain', 'ledger']) {
		rejects(`已删除的机制 ${mechanism} 不再被接受`, { contributions: { mechanisms: { [mechanism]: true } } }, new RegExp(`unknown_mechanism:clearai-kernel:${mechanism}`))
	}
	for (const key of ['templateDir', 'gitWorldlines', 'ledgerMaxFiles', 'scoutToolFilter', 'executorToolFilter', 'precommitRecon', 'forkArbitration']) {
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
		check('组合文件里两个新键都在(autonomy / contributions)', keys.includes('autonomy') && keys.includes('contributions'))
	}

	// 裁剪真的生效:关掉领域语言机制 → 它的十件工具不再出现在工具面里。
	const trimmed = makeHost()
	apply(trimmed.ctx, { contributions: { mechanisms: { ontology: false } } })
	check(
		'关掉领域语言机制 → 10 件词汇工具真的没装(10 件)',
		trimmed.tools.size === 10 && !trimmed.tools.has('Assert') && !trimmed.tools.has('RegisterTerm') && trimmed.tools.has('AdvancePlan'),
		`${trimmed.tools.size} 件`,
	)
	// 只裁工具面、不动机制:能装出来的最小面就是清单本身。
	const planOnly = makeHost()
	apply(planOnly.ctx, { contributions: { tools: ['CreatePlan', 'AdvancePlan'] } })
	check('显式裁剪工具面 → 只剩清单里那几件', planOnly.tools.size === 2 && planOnly.tools.has('AdvancePlan'), `${planOnly.tools.size} 件`)

	// autonomy:两档各装一段,互斥,段数相同(开关只换措辞,不增删段)。
	const attended = makeHost()
	apply(attended.ctx, {})
	const unattended = makeHost()
	apply(unattended.ctx, { autonomy: 'unattended' })
	const names = (host) => host.sections.map((section) => section.name)
	check('autonomy=attended(缺省)→ 装「人在场」那套引导协议', names(attended).includes('clearai/clarification-attended'))
	check('autonomy=attended → 「人不在场」那套不在场(互斥)', !names(attended).includes('clearai/clarification-unattended'))
	check('autonomy=unattended → 装「无人值守澄清门」', names(unattended).includes('clearai/clarification-unattended'))
	check('autonomy=unattended → 「人在场」那套不在场', !names(unattended).includes('clearai/clarification-attended'))
	check(
		'两档段数相同(开关只换措辞,不增删段)',
		attended.sections.length === unattended.sections.length && attended.sections.length === SECTIONS.length - 1,
		`${attended.sections.length}/${unattended.sections.length}`,
	)
	check('段名不重复(槽位不会把同一段装两次)', new Set(names(attended)).size === names(attended).length)
	check('注册的段名都在段表里', names(attended).every((name) => SECTION_TABLE.has(name)))
	check(
		'段槽位确实收敛成段表里的段(不是槽位名本身)',
		Object.values(SECTION_SLOTS).every((variants) => Object.values(variants).every((name) => SECTION_TABLE.has(name))) &&
			!names(attended).some((name) => name === 'clarification'),
	)
	// 澄清协议两套措辞各自的机制落点(内容面,不是名字面)。
	check(
		'两套澄清协议都写明「单次一题」与结构化提问通道',
		/单次一题/.test(String(attended.sections.find((s) => s.name === 'clearai/clarification-attended')?.text ?? '')) &&
			/ask_user_question/.test(String(unattended.sections.find((s) => s.name === 'clearai/clarification-unattended')?.text ?? '')),
	)
	check(
		'人在场那一档不提续跑(那一档不设窗口,提了就是空话)',
		!/自动续跑|续跑窗口/.test(String(attended.sections.find((s) => s.name === 'clearai/clarification-attended')?.text ?? '')),
	)
	check(
		'无人值守那一档写明续跑这件事(机制已落地,才敢写)',
		/续跑窗口/.test(String(unattended.sections.find((s) => s.name === 'clearai/clarification-unattended')?.text ?? '')),
	)
}

console.log('\n【判据先写后做:入口强制 + 自指检测】')
{
	const r1 = await call('SetGoal', { claim: '催化剂 A 是否优于 B', done_criteria: '   ' })
	check('判据为空 → 拒绝', r1.ok === false && r1.code === 'done_criteria_required', String(r1.code))

	const r2 = await call('SetGoal', { claim: 'x', done_criteria: '看 ClosePlan 成功即可' })
	check('判据自指(ClosePlan 成功)→ 拒绝', r2.ok === false && r2.code === 'criteria_self_reference', String(r2.code))

	const r3 = await call('SetGoal', { claim: 'x', done_criteria: '结果记录在对话中' })
	check('判据自指(记录在对话中)→ 拒绝', r3.ok === false && r3.code === 'criteria_self_reference')

	const r4 = await call('SetGoal', {
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

	const r5 = await call('SetGoal', { claim: 'c', done_criteria: 'c 判据' })
	check('修订不带 reason → 拒绝', r5.ok === false && r5.code === 'reason_required')

	const r6 = await call('SetGoal', { claim: '改判据', done_criteria: '新判据:均值差 ≥ 5%,数据落在 lab/yield.csv', reason: '原判据口径太宽' })
	check('带因修订 → 版本 +1', r6.ok === true && r6.code === 'goal_revised')
	check('修订留痕:goal/set 有两条(旧值不删)', eventsOf('goal/set').length === 2)
}

console.log('\n【假设数量下限:首次立约就要候选对比(preset 立 2,内核默认不限)】')
{
	// 机制在 SetGoal,产品立场在 preset(minHypotheses: 2,与 blockedThreshold 同一模式)。
	// 这里用 apply 直接给内核配置,验四种形态:0 条拦、1 条拦、2 条过、修订不受限。
	const floorHost = makeHost()
	apply(floorHost.ctx, { minHypotheses: 2 })
	const F = 'session-hyp-floor'
	const f0 = await callOn(floorHost, F, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
	check('带下限时不登记假设(0 条)→ 拒绝', f0.ok === false && f0.code === 'hypotheses_too_few', String(f0.code))
	const f1 = await callOn(floorHost, F, 'SetGoal', { claim: 'x', done_criteria: 'y 存在', hypotheses: [{ claim: '只有一个猜想', refute_when: '读数不成立' }] })
	check('只登记 1 条 → 同样拒绝(一个猜想的检验容易退化成找证据支持自己)', f1.ok === false && f1.code === 'hypotheses_too_few', String(f1.code))
	const f2 = await callOn(floorHost, F, 'SetGoal', {
		claim: 'x',
		done_criteria: 'y 存在',
		hypotheses: [
			{ claim: '猜想一', refute_when: '读数不成立' },
			{ claim: '猜想二', refute_when: '对照组无差异' },
		],
	})
	check('登记 2 条 → 立起', f2.ok === true && f2.code === 'goal_set', String(f2.code))
	const f3 = await callOn(floorHost, F, 'SetGoal', { claim: 'x 改口径', done_criteria: 'z 存在', reason: '换了判据' })
	check('修订目标不带新假设 → 不受下限限制', f3.ok === true && f3.code === 'goal_revised', String(f3.code))

	// 默认形态(不写配置)保持机制中立:0 条也能立——下限是产品立场,不是引擎偏见。
	const freeHost = makeHost()
	apply(freeHost.ctx, {})
	const FREE = 'session-hyp-free'
	const g0 = await callOn(freeHost, FREE, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
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
	const i1 = await callOn(idHost, I, 'SetGoal', before)
	check('首次立约 → 立起', i1.ok === true && i1.code === 'goal_set', String(i1.code))
	const firstIds = idHost.service.state(I).hypotheses.map((item) => item.id)
	check('两条假设各有身份', firstIds.length === 2 && firstIds.every((id) => typeof id === 'string' && id !== ''))

	// 改判据、但两条主张原文一字不动(真跑里 rev2 就是这个形状)。
	const i2 = await callOn(idHost, I, 'SetGoal', { ...before, done_criteria: '判据换成可稳定复核的锚点', reason: '原判据依赖系统所有的读面' })
	check('修订 → 版本 +1', i2.ok === true && i2.code === 'goal_revised', String(i2.code))
	check('主张原文没变 ⇒ 用回原 id(不是给同一句话发新身份)', JSON.stringify(idHost.service.state(I).hypotheses.map((item) => item.id)) === JSON.stringify(firstIds), idHost.service.state(I).hypotheses.map((item) => item.id).join(','))
	check('修订不新增重复行(卡上不再出现同一句话两遍)', idHost.service.state(I).hypotheses.length === 2, `${idHost.service.state(I).hypotheses.length} 行`)

	// 这一版只留一条 ⇒ 另一条如实落 superseded(这条变更过去没有生产者)。
	const i3 = await callOn(idHost, I, 'SetGoal', {
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
	const i4 = await callOn(idHost, I, 'SetGoal', {
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
		await callOn(host, S, 'SetGoal', {
			claim: '催化剂 A 是否优于 B',
			done_criteria: '三次重复里 A 的均值高出 5 个百分点',
			hypotheses: [{ claim: 'A 的产率比 B 高 5 个百分点(SCR/CR 路线)', refute_when: '两次重复里差值小于 2 个百分点' }],
		})
		const registered = host.service.state(S).hypotheses[0]
		const plan = (hypothesis) => ({ steps: [{ id: 'p1', do: '跑三次重复', artifacts: ['lab/y.csv'], done_criteria: 'lab/y.csv 含三次重复', tests: { hypothesis, level: 'L3' } }] })
		const byId = await callOn(host, S, 'CreatePlan', plan(registered.id))
		check('tests 填 **id** → 认(最稳的写法)', byId.ok === true, String(byId.code))
		await callOn(host, S, 'VoidPlanStep', { step_id: 'p1', reason: '验匹配用' })
		await callOn(host, S, 'ClosePlan', {})
		const byText = await callOn(host, S, 'CreatePlan', plan(registered.claim))
		check('tests 填假设**原文** → 也认(不再把模型逼进猜谜)', byText.ok === true, `${byText.code}:${String(byText.message ?? '').slice(0, 60)}`)
		await callOn(host, S, 'VoidPlanStep', { step_id: 'p1', reason: '验匹配用' })
		await callOn(host, S, 'ClosePlan', {})
		const byPrefix = await callOn(host, S, 'CreatePlan', plan(registered.claim.slice(0, 12)))
		check('tests 填**唯一前缀** → 也认', byPrefix.ok === true, String(byPrefix.code))
		await callOn(host, S, 'VoidPlanStep', { step_id: 'p1', reason: '验匹配用' })
		await callOn(host, S, 'ClosePlan', {})
		const mismatch = await callOn(host, S, 'CreatePlan', plan('完全对不上的说法'))
		check(
			'对不上时**列出全部有效 id**(让模型能照抄,而不是继续猜)',
			mismatch.ok === false && /已登记的假设/.test(String(mismatch.message)) && String(mismatch.message).includes(registered.id),
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
	check('blocked 守卫只列可执行的解拦动作', blocked.ok === false && blocked.code === 'plan_blocked' && /AmendPlan/.test(blocked.message) && /RefinePlan/.test(blocked.message) && /VoidPlanStep/.test(blocked.message) && !/让人介入/.test(blocked.message), String(blocked.message))
	const refined = await callOn(host, session, 'RefinePlan', { step_id: 'd1', done_criteria: '具体证据文件存在且非空' })
	check('RefinePlan → 清除 blocked 与连拦计数', refined.ok === true && host.service.state(session).plans[0].blocked === undefined && host.service.state(session).blocks[`${directoryPlan.id}:d1`] === undefined, JSON.stringify(host.service.state(session)))
	for (let i = 0; i < 3; i += 1) await callOn(host, session, 'AdvancePlan', { step_id: 'd1' })
	const voided = await callOn(host, session, 'VoidPlanStep', { step_id: 'd1', reason: '目录不能作为物证' })
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
	const amended = await callOn(host, session, 'AmendPlan', { step: { id: 'a2', do: '交付六份具体文件', artifacts: files, done_criteria: '六份具体文件均存在且非空' } })
	check('AmendPlan → 清除 blocked 与连拦计数', amended.ok === true && host.service.state(session).plans[1].blocked === undefined && host.service.state(session).blocks[`${recoveryPlan.id}:a1`] === undefined, JSON.stringify(host.service.state(session)))
	await callOn(host, session, 'VoidPlanStep', { step_id: 'a1', reason: '改用六份具体文件' })
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

	const amend = await call('AmendPlan', { step: { id: 't3', do: '补一步', artifacts: ['lab/c.txt'], done_criteria: 'lab/c.txt 存在' } })
	check('AmendPlan 不动进度', amend.ok === true && amend.progress_changed === false)
	const refine = await call('RefinePlan', { step_id: 't3', done_criteria: 'lab/c.txt 存在且非空' })
	check('RefinePlan 不动进度且旧判据留痕', refine.ok === true && refine.progress_changed === false && ledger().some((event) => event.t === 'plan/refined' && event.old_criteria === 'lab/c.txt 存在'))
	const voided = await call('VoidPlanStep', { step_id: 't3', reason: '这一步本不该存在' })
	check('VoidPlanStep 带因作废且不动进度', voided.ok === true && voided.progress_changed === false)
	check('作废留痕,不删记录', eventsOf('plan/voided').length === 1)
	const settled = await call('VoidPlanStep', { step_id: 't1', reason: '测试脚手架' })
	check('已作废之外仍可作废其它步', settled.ok === true)

	// 收束这份脚手架计划:剩下的步作废,然后 ClosePlan
	await call('VoidPlanStep', { step_id: 't2', reason: '测试脚手架' })
	const closed2 = await call('ClosePlan', {})
	check('作废后可以收束', closed2.ok === true, String(closed2.code))
}

console.log('\n【无人值守续跑:宿主目标只当驱动器,不当事实源】')
{
	const U = 'session-unattended'
	const unattended = makeHost()
	apply(unattended.ctx, { autonomy: 'unattended' })
	const calls = () => unattended.goalCalls.map((entry) => entry[0])

	/**
	 * §34:额度是**一个保险丝**,不是用户的档位 ——「多问我 / 自己跑」那个开关已经删掉。
	 * 立目标照旧布防(两档配置都是同一套驱动),只是不再有"6 轮 vs 512 轮"这种由用户选出来的差。
	 */
	{
		const attendedHost = makeHost()
		apply(attendedHost.ctx, {})
		const attend = await callOn(attendedHost, 'session-attended', 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
		check(
			'立目标即布防,额度是唯一的保险丝(默认 128 轮)',
			attend.ok === true && attendedHost.hostGoal?.maxGoalRounds === 128,
			String(attendedHost.hostGoal?.maxGoalRounds),
		)
		check('卡片如实说明窗口额度(不再分档说人话档位词)', /128 轮自动续跑/.test(String(attend.message)), String(attend.message).split('\n').find((line) => line.includes('窗口')) ?? '')
	}

	const g1 = await callOn(unattended, U, 'SetGoal', { claim: '催化剂 A 是否优于 B', done_criteria: '三次重复里 A 的均值高出 5 个百分点以上' })
	check('unattended → 立目标即布防续跑窗口', g1.ok === true && calls().includes('create'), calls().join(','))
	/**
	 * 窗口的文本是它的**身份**(服务对象 + 档位),不是目标内容(§17.1)。
	 * 为什么把这条钉死:宿主那句 objective 面板上给人看,所以它冒充「用户的目标」
	 * 就会在界面上长出第二个目标;内容(主张、判据)在我们自己的账上,由运行态卡逐回合喂给模型。
	 */
	/**
	 * 2026-09-12 改过一次:**这句话是印在平台面板上给人看的**。
	 * 原来它是 `ClearAI 续跑窗口 · 目标 g-…` —— 机制词叠机器 id,人看到的是我们的内部称呼。
	 * 现在它是人话:说的是"在做什么",而且**不写 id**;身份不再靠文本相等判
	 * (改文本走 `goals.edit`,不动轮数 ⇒ 反复修订刷不出预算)。
	 */
	check(
		'续跑窗口上那句是人话(说在做什么),不写机制词、不写机器 id',
		/^继续做完:/.test(String(unattended.hostGoal?.objective ?? '')) && !/g-[a-z0-9]{6,}/.test(String(unattended.hostGoal?.objective ?? '')) && !/续跑窗口/.test(String(unattended.hostGoal?.objective ?? '')),
		String(unattended.hostGoal?.objective ?? ''),
	)
	check('无人值守配置下额度也是同一个保险丝(128)', unattended.hostGoal?.maxGoalRounds === 128, String(unattended.hostGoal?.maxGoalRounds))
	check(
		'机制词不进人看的界面(窗口身份只有"服务对象")',
		!/无人值守|人在场|自己拿主意|多问我/.test(String(unattended.hostGoal?.objective ?? '')),
		String(unattended.hostGoal?.objective ?? ''),
	)
	check('卡片如实说明窗口状态', /续跑窗口已布防/.test(String(g1.message)), String(g1.message).split('\n').find((line) => line.includes('窗口')) ?? '')
	// 布防这件事**落进了账**(§17.2):投影里读得到它,重启与分叉之后才说得清。
	check(
		'布防落账:投影里有 continuation=armed,而且记的是**人话**(在做什么,不是机器 id)',
		unattended.service.state(U).continuation?.state === 'armed' &&
			/^继续做完:/.test(String(unattended.service.state(U).continuation?.target ?? '')) &&
			!/g-[a-z0-9]{6,}/.test(String(unattended.service.state(U).continuation?.target ?? '')),
		JSON.stringify(unattended.service.state(U).continuation),
	)

	/**
	 * 修订目标:窗口**不换**(不 clear、不 create),轮数**不动** —— 这是防"反复修订刷预算"的那条线。
	 *
	 * 2026-09-12 起允许一种动:**`edit` 台上那句话**(它现在说的是目标当前的口径)。
	 * 尺度没松:真正要护住的是「额度不因修订而重置」,而 `edit` 不碰 `roundsStarted`。
	 */
	const before = calls().length
	const roundsBefore = unattended.hostGoal?.roundsStarted
	const g2 = await callOn(unattended, U, 'SetGoal', { claim: '催化剂 A 是否优于 B(改口径)', done_criteria: '五次重复里 A 的均值高出 3 个百分点以上', reason: '加了重复次数' })
	check(
		'修订目标 → 不换窗口(不 clear、不 create),轮数也不动',
		g2.ok === true && calls().slice(before).every((name) => name === 'get' || name === 'edit') && unattended.hostGoal?.roundsStarted === roundsBefore,
		calls().slice(before).join(','),
	)
	check('修订目标也不重置轮数预算(不能靠反复修订刷窗口)', unattended.hostGoal?.roundsStarted === roundsBefore && unattended.hostGoal?.maxGoalRounds === 128, `${roundsBefore} → ${unattended.hostGoal?.roundsStarted}`)

	// 计划触礁 → 令牌置阻塞(无人值守这一档不能一边报阻塞一边让系统继续叫醒自己)
	await callOn(unattended, U, 'CreatePlan', { steps: [{ id: 'w1', do: '做一个不会落盘的产物', artifacts: ['lab/never.txt'], done_criteria: 'lab/never.txt 存在且非空' }] })
	let stalled = null
	for (let i = 0; i < 3; i += 1) stalled = await callOn(unattended, U, 'AdvancePlan', { step_id: 'w1' })
	check('连拦达阈值 → 令牌置阻塞(clearai-loop-stalled)', stalled.blocked === true && calls().includes('block'), calls().join(','))
	check('阻塞码是策略自有的合法 kebab-case 码', unattended.hostGoal?.blockedReason?.code === 'clearai-loop-stalled', String(unattended.hostGoal?.blockedReason?.code))
	check('合法阻塞码成功收回续跑窗口', !/续跑窗口收回失败/.test(String(stalled.message)), String(stalled.message))
	check('卡片里如实说了窗口被置阻塞', /续跑窗口已置阻塞/.test(String(stalled.message)))

	// 目标达成 → 收回令牌(不再叫醒一个已经收尾的目标)。用一枚干净的令牌走这条路径:
	// 上面那枚已经在触礁时被置阻塞了,而「已阻塞」本来就不该再被收回成 complete。
	const closing = makeHost()
	apply(closing.ctx, { autonomy: 'unattended' })
	const C = 'session-closing'
	await callOn(closing, C, 'SetGoal', { claim: '把三条路线跑完', done_criteria: '三条路线各有读数与结论' })
	const achieved = await callOn(closing, C, 'CloseGoal', { outcome: 'achieved' })
	check(
		'目标达成 → 窗口收回(complete)',
		achieved.ok === true && closing.goalCalls.map((entry) => entry[0]).includes('complete'),
		closing.goalCalls.map((entry) => entry[0]).join(','),
	)
	check('收回后宿主目标是 complete 且已解除续跑', closing.hostGoal?.phase === 'complete' && closing.hostGoal?.activation === 'disarmed')
	check('达成时卡片如实说明窗口收回', /续跑窗口已收回/.test(String(achieved.message)))
	check('收兵落账:投影里记的是「我们收的」(stopped),不是「外部的」', closing.service.state(C).continuation?.state === 'stopped', JSON.stringify(closing.service.state(C).continuation))

	// 如实放弃 → 令牌置阻塞(需要人),不是 complete
	const givingUp = makeHost()
	apply(givingUp.ctx, { autonomy: 'unattended' })
	await callOn(givingUp, 'session-giveup', 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
	const abandoned = await callOn(givingUp, 'session-giveup', 'CloseGoal', { outcome: 'abandoned', note: '缺仪器读数' })
	check(
		'abandoned 结案 → 令牌置阻塞(clearai-loop-abandoned),而不是 complete',
		givingUp.hostGoal?.phase === 'blocked' && givingUp.hostGoal?.blockedReason?.code === 'clearai-loop-abandoned',
		String(givingUp.hostGoal?.phase),
	)

	// 重启/分叉:宿主把 activation 解锁 → 无人值守这一档补回来
	const restarted = makeHost()
	apply(restarted.ctx, { autonomy: 'unattended' })
	const R = 'session-restart'
	await callOn(restarted, R, 'SetGoal', { claim: '隔夜跑完三条候选路线', done_criteria: '三条路线各有读数与结论' })
	restarted.hostGoal.activation = 'disarmed' // 模拟会话载入后的解锁(宿主的 activation 是进程本地的)
	const beforeResume = restarted.goalCalls.length
	const decision = await preStep(restarted, R, 2)
	check('重启后第一次 pre-step → 自动重新布防(resume)', restarted.goalCalls.slice(beforeResume).some((entry) => entry[0] === 'resume'), restarted.goalCalls.slice(beforeResume).map((e) => e[0]).join(','))
	check('补防这件事写进了这一回合注入的卡里(不是悄悄做的)', /重新布防/.test(JSON.stringify(decision.messages ?? [])))
	const mutating = (host, from) => host.goalCalls.slice(from).filter((entry) => entry[0] !== 'get').map((entry) => entry[0])
	const afterResume = restarted.goalCalls.length
	await preStep(restarted, R, 3)
	check('已布防就不再改动令牌(幂等:只读不写)', mutating(restarted, afterResume).length === 0, mutating(restarted, afterResume).join(','))

	// 人按下的暂停是人的意思:不覆盖
	const pausedHost = makeHost()
	apply(pausedHost.ctx, { autonomy: 'unattended' })
	const P = 'session-paused'
	await callOn(pausedHost, P, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
	pausedHost.hostGoal.phase = 'paused'
	pausedHost.hostGoal.activation = 'disarmed'
	const pausedCalls = pausedHost.goalCalls.length
	const pausedNote = await preStep(pausedHost, P, 2)
	check('宿主目标被暂停时 → 不 resume(尊重人的暂停)', !pausedHost.goalCalls.slice(pausedCalls).some((entry) => entry[0] === 'resume'))
	check(
		'暂停时也不重复布防(不刷屏:只读不写)',
		pausedHost.goalCalls.slice(pausedCalls).filter((entry) => entry[0] !== 'get').length === 0,
		pausedHost.goalCalls.slice(pausedCalls).map((e) => e[0]).join(','),
	)
	check('并且把「这一档现在是停着的」如实写进卡里', /停在 paused/.test(JSON.stringify(pausedNote.messages ?? [])))

	/**
	 * §17.2 人的动作**即刻为真**:人在面板上按了「清空」。
	 *
	 * 我们自己每次清除都与建**同拍**(先清后建),所以「我们记过一枚活着的窗口、此刻它不在」
	 * 在证据上只可能是外部清的。这条以前是反的:下一拍静默 create,把人的动作撤销掉——
	 * 机制跟人抢方向盘。现在的不变量:不重建、落一条账(只说「不是我们」,不说「是谁」)、
	 * 如实说明后果,而且**撤销一直有效**直到人再开口(人开口本来就是重新授权)。
	 */
	const goalNames = (host, from) => host.goalCalls.slice(from).map((entry) => entry[0])
	const cleared = makeHost()
	apply(cleared.ctx, { autonomy: 'unattended' })
	const CL = 'session-cleared'
	await callOn(cleared, CL, 'SetGoal', { claim: '隔夜把三条路线跑完', done_criteria: '三条路线各有读数' })
	check('清空前:窗口活着,且账上说得出「是我们布的」', cleared.service.state(CL).continuation?.state === 'armed', JSON.stringify(cleared.service.state(CL).continuation))
	cleared.goals.clear({ id: 'hg-1', revision: 1 }) // 平台那个动作本身:人在面板上按的「清空」
	const beforeCleared = cleared.goalCalls.length
	const clearedNote = await preStep(cleared, CL, 2)
	check('外部清空 → 我们**不重建**(人的动作即刻为真)', !goalNames(cleared, beforeCleared).includes('create'), goalNames(cleared, beforeCleared).join(','))
	check(
		'外部清空 → 落账 withdrawn,而且不说「谁」按的(我们只证明得了「不是我们」)',
		cleared.service.state(CL).continuation?.state === 'withdrawn' && cleared.service.state(CL).continuation?.why === 'external',
		JSON.stringify(cleared.service.state(CL).continuation),
	)
	check('外部清空 → 如实说明后果(这一回合之后没人来叫醒你)', /已被外部清掉/.test(JSON.stringify(clearedNote.messages ?? [])))
	const beforeStill = cleared.goalCalls.length
	await preStep(cleared, CL, 3)
	check('撤销**一直有效**(只挡一拍的话,下一拍又把它建回来了)', !goalNames(cleared, beforeStill).includes('create'), goalNames(cleared, beforeStill).join(','))
	const beforeSpeak = cleared.goalCalls.length
	await preStep(cleared, CL, 4, [{ source: { kind: 'user' } }])
	check('人再开口 = 重新授权 → 重新布防', goalNames(cleared, beforeSpeak).includes('create'), goalNames(cleared, beforeSpeak).join(','))
	check('重新布防之后账也回到 armed', cleared.service.state(CL).continuation?.state === 'armed', JSON.stringify(cleared.service.state(CL).continuation))

	/**
	 * §17.2 我们**自己**按下的暂停,重启之后还认得出来。
	 *
	 * 旧写法把它记在内核的进程内存里:换一个内核实例(重启、或分叉出去的一条世界线)
	 * 就认不出来,于是我们自己的暂停被误报成「人按的暂停」——那是一句不实的话。
	 * 这里用**一个新的宿主实例**(新的内核闭包 = 空内存)读同一份投影来钉住它:
	 * 只有账能解释这次恢复。
	 */
	/**
	 * §34:窗口停下的理由 = **真的有人的事**。
	 *
	 * 原来这条用例靠「人在场 + 一阶段收尾」触发暂停 —— 那是**档位**的表达,档删了它就不该存在 ✗。
	 * 现在用一道**真的人门**触发:计划立起来但**没得到人的批准**(审阅被撤下/先改再交)⇒ 未授权 ⇒ 停。
	 * 这样测到的还是同一套机制(暂停落账 + 重启后由**投影**解释它),只是触发它的是人的事,不是档。
	 */
	const beforeRestart = makeHost()
	apply(beforeRestart.ctx, { autonomy: 'unattended' }) // 档已经不影响这件事了:两档都停
	beforeRestart.userQuestions = { async ask() { return { answers: [] } } } // 人撤下了审阅卡 ⇒ 未授权
	const RP = 'session-hold-record'
	await callOn(beforeRestart, RP, 'SetGoal', { claim: '把三条路线跑完', done_criteria: '三条路线各有读数与结论' })
	await callOn(beforeRestart, RP, 'CreatePlan', { steps: [{ id: 'r1', do: '跑第一条路线', artifacts: ['lab/r1.txt'], done_criteria: 'lab/r1.txt 存在' }] })
	await preStep(beforeRestart, RP, 2)
	check(
		'策略暂停落账(paused + **真实理由**:计划未获人批准),不是「谁都不知道为什么停的」',
		beforeRestart.service.state(RP).continuation?.state === 'paused' && beforeRestart.service.state(RP).continuation?.why === 'plan_confirm',
		JSON.stringify(beforeRestart.service.state(RP).continuation),
	)
	const afterRestart = makeHost()
	apply(afterRestart.ctx, { autonomy: 'unattended' })
	afterRestart.states.set(RP, beforeRestart.service.state(RP)) // 同一份投影:会话日志重折出来的事实
	afterRestart.goals.create({ id: RP }, { objective: 'ClearAI 续跑窗口 · 目标 g-1', maxGoalRounds: 128 })
	afterRestart.hostGoal.phase = 'paused'
	afterRestart.hostGoal.activation = 'disarmed'
	const restartCalls = afterRestart.goalCalls.length
	await preStep(afterRestart, RP, 3)
	check(
		'重启后仍认得出「那次暂停是我们按的」⇒ 门没开,**不擅自恢复**(恢复由人那一下带走)',
		!goalNames(afterRestart, restartCalls).includes('resume') && afterRestart.service.state(RP).continuation?.why === 'plan_confirm',
		`${goalNames(afterRestart, restartCalls).join(',')} · ${JSON.stringify(afterRestart.service.state(RP).continuation)}`,
	)

	/**
	 * §34 **删掉了「多问我 / 自己跑」这个开关**,所以原来那一整块「人切档那一拍」的用例也删掉了
	 * (它测的是已删的能力 ✗)。留在这里的是它的**新契约**:
	 *   · `set_autonomy` 已进不了动词白名单(见 host 侧的路由用例);
	 *   · 立约**永远**请人确认(见上面那条关键回归);
	 *   · 而「本回合的机制参数只从输入读」这条纪律(ROADMAP #9)本身没变 —— 它由别的门动词继续守着。
	 */
	const rewritten = makeHost()
	apply(rewritten.ctx, { autonomy: 'attended' })
	const RW = 'session-rewritten'
	await callOn(rewritten, RW, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
	rewritten.hostGoal.objective = '我自己改的:盯着 lab/probe.txt' // 人在面板上改写的
	rewritten.hostGoal.revision += 1
	const beforeRewrite = rewritten.goalCalls.length
	await preStep(rewritten, RW, 2)
	check(
		'人改写过的窗口:我们一个字都不动(以人为准;身份没变时连对齐都不做)',
		!goalNames(rewritten, beforeRewrite).includes('clear') && !goalNames(rewritten, beforeRewrite).includes('create') && rewritten.hostGoal?.objective === '我自己改的:盯着 lab/probe.txt',
		`${goalNames(rewritten, beforeRewrite).join(',')} · ${String(rewritten.hostGoal?.objective)}`,
	)
	/**
	 * 而**人开口换窗口**是既定语义(`reset_goal_loop`):新窗口说新身份。
	 * 这与上一条不矛盾——改写作用于**当前这枚**窗口;换窗口是把这一枚整个换掉,账上会如实说「已换新」。
	 */
	/** 人门消息用**通用**的一条(不再依赖已删的切档动词):人开口这件事本身就换新窗口。 */
	const gateMessage = {
		id: 'clearai-gate-test',
		role: 'user',
		content: [
			{
				type: 'text',
				text: `${HUMAN_GATE_MARK} ${JSON.stringify({ action: 'adopt_branch', plan: null, fork: null, branch: 'b-1', skill: null, value: null, note: null })}\n人在面板上裁决:采纳这条世界线(b-1)。`,
			},
		],
		source: { kind: 'user' },
	}
	const beforeTurnover = rewritten.goalCalls.length
	await preStep(rewritten, RW, 3, [gateMessage])
	check(
		'人开口 ⇒ 换一枚新窗口(额度重新计),台上那句是人话',
		goalNames(rewritten, beforeTurnover).includes('clear') &&
			goalNames(rewritten, beforeTurnover).includes('create') &&
			/^继续做完:/.test(String(rewritten.hostGoal?.objective)) &&
			!/g-[a-z0-9]{6,}/.test(String(rewritten.hostGoal?.objective)),
		`${goalNames(rewritten, beforeTurnover).join(',')} · ${String(rewritten.hostGoal?.objective)}`,
	)

	/**
	 * §19-A 计划确认门走**原生审阅**(借界面,不借账)。
	 *
	 * 这一组的桩把 `userQuestions` 装上:断言内核**自己**去问(而不是靠提示词让模型去问)、
	 * 问的是原生 `plan-review` 意图、`detail` 里是完整计划;并且**只有批准才落授权记号**——
	 * 其余三种结局一个字都不落(宁可停着等人,也不擅自开工)。
	 */
	{
		const planHost = makeHost()
		apply(planHost.ctx, { autonomy: 'attended' })
		const asked = []
		planHost.userQuestions = {
			async ask(request) {
				asked.push(request)
				return { answers: [{ id: 'plan-review', selected: ['批准,开始执行'] }] }
			},
		}
		const P = 'session-plan-review'
		const created = await callOn(planHost, P, 'CreatePlan', { brief: '两步把探针交付掉', steps: [{ id: 'a1', do: '造 lab/a.txt', artifacts: ['lab/a.txt'], done_criteria: 'lab/a.txt 存在' }] })
		check('人在场:计划立起来时**内核自己去请人审阅**(不再靠提示词让模型问)', asked.length === 1, String(asked.length))
		check('走的是原生 plan-review 意图(客户端为它做了专门的整屏审阅)', asked[0]?.questions?.[0]?.intent?.kind === 'plan-review', JSON.stringify(asked[0]?.questions?.[0]?.intent ?? null))
		check('审阅正文是完整计划(markdown:步骤 + 判据)', /## 步骤/.test(String(asked[0]?.questions?.[0]?.detail ?? '')) && /lab\/a\.txt/.test(String(asked[0]?.questions?.[0]?.detail ?? '')), String(asked[0]?.questions?.[0]?.detail ?? '').slice(0, 80))
		check('批准 ⇒ 授权记号落账,而且是**人**批的', planHost.service.state(P).plans[0]?.confirmed_by === 'user' && planHost.service.state(P).plans[0]?.confirmed_at !== null, JSON.stringify({ by: planHost.service.state(P).plans[0]?.confirmed_by }))
		check('批准 ⇒ 回执里不再要确认', created.confirmation_required === false, String(created.confirmation_required))

		// 人选择「先改再交」(+ 反馈):一个字都不落
		const reviseHost = makeHost()
		apply(reviseHost.ctx, { autonomy: 'attended' })
		reviseHost.userQuestions = { async ask() { return { answers: [{ id: 'plan-review', selected: [], custom: '第二步判据太松' }] } } }
		const R = 'session-plan-revise'
		const revised = await callOn(reviseHost, R, 'CreatePlan', { steps: [{ id: 'a1', do: '造 lab/a.txt', artifacts: ['lab/a.txt'], done_criteria: 'lab/a.txt 存在' }] })
		check('人选择「先改再交」⇒ **不落授权**(计划仍未授权)', reviseHost.service.state(R).plans[0]?.confirmed_at === null && revised.confirmation_required === true, JSON.stringify({ at: reviseHost.service.state(R).plans[0]?.confirmed_at, need: revised.confirmation_required }))

		/**
		 * 2026-09-12 实测的死胡同:人点了「先改再交」之后,模型照意见改了计划,
		 * 而**没有任何入口**能再呈一次 —— 计划永远停在未授权,内核又如实拒绝开工。
		 * 门打不开比没有门更糟。两条出口都要在:
		 *   ① 改完**自动**再呈一次(审阅卡上承诺的就是这句);
		 *   ② 一个显式入口 `RequestPlanReview`(模型随时能再呈)。
		 */
		{
			// ① AmendPlan:未授权的计划补一步 ⇒ 自动再呈;人这次批准 ⇒ 记号落账
			reviseHost.userQuestions = { async ask() { return { answers: [{ id: 'plan-review', selected: ['批准,开始执行'] }] } } }
			const amended = await callOn(reviseHost, R, 'AmendPlan', { step: { id: 'extra', do: '补一步交付 lab/extra.txt', artifacts: ['lab/extra.txt'], done_criteria: 'lab/extra.txt 存在' } })
			check('未授权的计划:补一步之后**自动再呈**一次,人批准即落账', amended.ok === true && reviseHost.service.state(R).plans[0]?.confirmed_at !== null && /批准/.test(String(amended.message)), `${amended.code} ${String(amended.message).slice(-80)}`)

			// ② 换个会话:精化判据也会再呈;这次人仍然不批,记号一个字都不落
			const refineHost = makeHost()
			refineHost.userQuestions = { async ask() { return { answers: [{ id: 'plan-review', selected: [], custom: '判据太松' }] } } }
			apply(refineHost.ctx, {})
			const R2 = 'session-plan-refine'
			await callOn(refineHost, R2, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
			const created2 = await callOn(refineHost, R2, 'CreatePlan', { steps: [{ id: 'r1', do: '造 lab/r.txt 探针', artifacts: ['lab/r.txt'], done_criteria: 'lab/r.txt 存在' }] })
			check('前置:审阅被拒 ⇒ 未授权', created2.confirmation_required === true && refineHost.service.state(R2).plans[0]?.confirmed_at === null, `${created2.code} ${String(created2.message).slice(0,120)}`)
			refineHost.userQuestions = { async ask() { return { answers: [{ id: 'plan-review', selected: ['批准,开始执行'] }] } } }
			const refined2 = await callOn(refineHost, R2, 'RefinePlan', { step_id: 'r1', done_criteria: 'lab/r.txt 存在且非空', reason: '按人的意见收紧' })
			check('未授权的计划:精化判据之后**自动再呈**', refined2.ok === true && /批准/.test(String(refined2.message)) && refineHost.service.state(R2).plans[0]?.confirmed_at !== null, `${refined2.code} ${String(refined2.message).slice(-80)}`)

			// ③ 显式入口:已经授权就不再打扰人
			const again = await callOn(refineHost, R2, 'RequestPlanReview', {})
			check('已授权的计划:RequestPlanReview 如实说「不必再问」,不再弹卡', again.ok === true && again.code === 'already_confirmed', String(again.code))

			// ④ 显式入口:没授权时能再呈,而且只有批准才落记号
			const orphanHost = makeHost()
			orphanHost.userQuestions = { async ask() { return { answers: [] } } }
			apply(orphanHost.ctx, {})
			const R3 = 'session-plan-request'
			await callOn(orphanHost, R3, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
			await callOn(orphanHost, R3, 'CreatePlan', { steps: [{ id: 'q1', do: '造 lab/q.txt 探针', artifacts: ['lab/q.txt'], done_criteria: 'lab/q.txt 存在' }] })
			const stillNil = await callOn(orphanHost, R3, 'RequestPlanReview', {})
			check('人又一次撤下审阅:仍不落授权,如实说仍未授权', stillNil.ok === true && stillNil.code === 'plan_review_pending' && orphanHost.service.state(R3).plans[0]?.confirmed_at === null, String(stillNil.code))
			orphanHost.userQuestions = { async ask() { return { answers: [{ id: 'plan-review', selected: ['批准,开始执行'] }] } } }
			const nowOk = await callOn(orphanHost, R3, 'RequestPlanReview', {})
			check('再由人批准 ⇒ 记号落账(借界面,不借账)', nowOk.ok === true && nowOk.code === 'plan_confirmed' && orphanHost.service.state(R3).plans[0]?.confirmed_at !== null, String(nowOk.code))
		}
		check('并且把他的意见如实交回模型', /第二步判据太松/.test(String(revised.message ?? '')), String(revised.message ?? '').slice(0, 120))

		// 没有审阅通道(headless):记号不落,并如实交代机理——不自动续跑、显式推进记归属、可再呈审。
		const bare = makeHost()
		apply(bare.ctx, { autonomy: 'attended' })
		const B = 'session-plan-nochannel'
		const bareCreated = await callOn(bare, B, 'CreatePlan', { steps: [{ id: 'a1', do: '造 lab/a.txt', artifacts: ['lab/a.txt'], done_criteria: 'lab/a.txt 存在' }] })
		check('没有审阅通道的形态:不落授权记号(确认仍要求)', bare.service.state(B).plans[0]?.confirmed_at === null && bareCreated.confirmation_required === true)
		check('并且如实告诉他:不自动续跑、显式推进记归属、可再呈审', /不会自动续跑/.test(String(bareCreated.message ?? '')) && /RequestPlanReview/.test(String(bareCreated.message ?? '')), String(bareCreated.message ?? '').slice(0, 160))

		/**
		 * §34:**计划永远要人确认**,无人值守配置也不例外。
		 *
		 * 原先那一档「立约即授权」✗ —— 那会把「计划经人确认」这条证据变成**系统自己签的**,
		 * 和 L4「人放行」是同一类病:门的意义就在"这一下是人按的"。
		 * 人不在时正确行为是**停在那道门**,不是替他签字。
		 */
		const auto = makeHost()
		apply(auto.ctx, { autonomy: 'unattended' })
		let askedAuto = 0
		auto.userQuestions = { async ask() { askedAuto += 1; return { answers: [] } } }
		const AU = 'session-plan-auto'
		const createdAuto = await callOn(auto, AU, 'CreatePlan', { steps: [{ id: 'a1', do: '造 lab/a.txt', artifacts: ['lab/a.txt'], done_criteria: 'lab/a.txt 存在' }] })
		check('无人值守配置下**照样请人审阅**(不替人签字)', askedAuto === 1, `${askedAuto} 次询问`)
		check(
			'没得到批准 ⇒ 授权记号一个字都不落(未授权,不许开工)',
			auto.service.state(AU).plans[0]?.confirmed_at === null && auto.service.state(AU).plans[0]?.confirmed_by === null && createdAuto?.confirmation_required === true,
			JSON.stringify({ at: auto.service.state(AU).plans[0]?.confirmed_at, by: auto.service.state(AU).plans[0]?.confirmed_by }),
		)
	}

	// 轮数上限:显式写死的值真的传给宿主目标
	const budgeted = makeHost()
	apply(budgeted.ctx, { autonomy: 'unattended', maxAutoTurns: 3 })
	await callOn(budgeted, 'session-budget', 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
	check('配置里的 maxAutoTurns 真的传给宿主目标(maxGoalRounds)', budgeted.hostGoal?.maxGoalRounds === 3, String(budgeted.hostGoal?.maxGoalRounds))
	// 不写就**按当档**取:人在场 6 轮,无人值守 512 轮(数字是 ClearAI 的两档原值)。
	for (const [autonomy, expected] of [
		['attended', 128],
		['unattended', 128],
	]) {
		const tiered = makeHost()
		apply(tiered.ctx, { autonomy })
		await callOn(tiered, `session-tier-${autonomy}`, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
		check(`不写 maxAutoTurns 时取同一个保险丝(${autonomy} → ${expected} 轮)`, tiered.hostGoal?.maxGoalRounds === expected, String(tiered.hostGoal?.maxGoalRounds))
	}

	/**
	 * 连拦阈值:2026-09-11 从「预算档」里拿出来(它是质量闸,不是预算),
	 * 因此它**不再随档变**——两档都要 N 次才拦。这里把这条新语义钉住:
	 * 同一个阈值下,人在场与无人值守的表现必须一致(曾经 2 vs 3)。
	 */
	for (const autonomy of ['attended', 'unattended']) {
		const host = makeHost()
		apply(host.ctx, { autonomy, blockedThreshold: 2 })
		const S = `session-threshold-${autonomy}`
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'z1', do: '做一个不会落盘的产物', artifacts: ['lab/never.txt'], done_criteria: 'lab/never.txt 存在且非空' }] })
		let last = null
		for (let i = 0; i < 2; i += 1) last = await callOn(host, S, 'AdvancePlan', { step_id: 'z1' })
		check(`${autonomy}:连拦阈值 2(与档无关,它是质量闸)`, last?.blocked === true, JSON.stringify(last?.blocked))
		// 计划已经如实停下等人之后,再交付不是「更努力」,而是绕过那道开着的门。
		const after = await callOn(host, S, 'AdvancePlan', { step_id: 'z1' })
		check(`${autonomy}:计划置 blocked 后不再接受交付`, after.ok === false && after.code === 'plan_blocked', String(after.code))
	}

	// 服务不在:如实说,不假装布防了,也不阻断事实侧
	const noGoals = makeHost()
	noGoals.goalsAvailable = false
	apply(noGoals.ctx, { autonomy: 'unattended' })
	const degraded = await callOn(noGoals, 'session-nogoals', 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
	check('goals 服务不可用 → 立目标照样成功(驱动器坏了不挡事实)', degraded.ok === true)
	check('并且如实说明窗口没布上', /续跑窗口未布防:goals 服务不可用/.test(String(degraded.message)))
	/**
	 * 令牌不在时,连**后果**一起说清(R3 长测:一次性形态根本没有令牌,而提示词里
	 * 「分叉成功即让出本轮」那句在那种场合不成立)。只说事实与含义,不劝。
	 */
	check('并且把含义说清:回合结束后不会被叫醒(一次性形态的实话)', /不会有下一轮来叫醒你/.test(String(degraded.message)), String(degraded.message).split('\n').slice(0, 3).join(' / '))
}

console.log('\n【分层续跑:计划层驱动,目标层只在无人值守接管】')
{
	const S = 'session-layers'
	const calls = (host) => host.goalCalls.map((entry) => entry[0])
	const fresh = (autonomy) => {
		const host = makeHost()
		apply(host.ctx, { autonomy })
		/**
		 * §34 之后**计划永远要人批** ⇒ 这里装一个「人在审阅里批准了」的桩(生产里的正常路径)。
		 * 没有通道的 headless 形态另有用例专门验:计划会停在未授权那道门上,而不是被系统自己签掉。
		 */
		host.userQuestions = { async ask() { return { answers: [{ id: 'plan-review', selected: ['批准,开始执行'] }] } } }
		return host
	}

	// ① 计划层有未落定步 → drive(ClearAI:`plan_turn_demand` 先答)。
	//    无人值守那一档立约即授权,所以这里直接就是 drive;
	//    人在场那一档立约后**有门**(计划待确认),按 ClearAI 的 `PLAN_AWAITING_CONFIRM` 不驱动
	//    ——那条路径由下面「计划确认门」一节专门验。
	{
		const host = fresh('unattended')
		await callOn(host, S, 'SetGoal', { claim: '把三条路线跑完', done_criteria: '三条路线各有读数与结论' })
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'a1', do: '跑第一条路线', artifacts: ['lab/a1.txt'], done_criteria: 'lab/a1.txt 存在' }] })
		await preStep(host, S, 2)
		check(
			'unattended:计划层有活 → 窗口开着(armed/active)',
			host.hostGoal?.phase === 'active' && host.hostGoal?.activation === 'armed',
			`${host.hostGoal?.phase}/${host.hostGoal?.activation}`,
		)
	}

	// ② 计划收尾 + 目标还开着:两档分道。
	//    ClearAI「dialogue+open goal = **挂起可恢复**的合法态:不驱动、run 空闲等人」;
	//    目标档则接管:`GOAL_WANTS_TURN`。
	{
		const host = fresh('attended')
		await callOn(host, S, 'SetGoal', { claim: '把三条路线跑完', done_criteria: '三条路线各有读数与结论' })
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'b1', do: '跑第一条路线', artifacts: ['lab/b1.txt'], done_criteria: 'lab/b1.txt 存在' }] })
		await callOn(host, S, 'VoidPlanStep', { step_id: 'b1', reason: '这一轮只验分层策略' })
		// 作废不掉「未授权」这件事:先按事实补一次授权(交付即授权),把门关掉再验分层。
		check('作废步骤不改变已落账的授权来源(记号仍是人批的)', host.service.state(S).plans[0]?.confirmed_by === 'user', String(host.service.state(S).plans[0]?.confirmed_by))
		const before = host.goalCalls.length
		const decision = await preStep(host, S, 3)
		check(
			/**
			 * §34 **取消了「人在场 ⇒ 一阶段收尾就停下等人」**(那是档位的表达 ✗):
			 * 目标还开着、门都关着 ⇒ 继续往下走。真需要人的地方是**门**,不是阶段边界。
			 */
			'计划收尾 + 目标还开着 + 门都关着 → **继续**(不再按档挂起等人)',
			host.hostGoal?.phase === 'active' && !calls(host).slice(before).includes('pause'),
			calls(host).slice(before).join(','),
		)
		check('并且不再说「下一阶段由人给」(那句话随档一起删了)', !/下一阶段由人给/.test(JSON.stringify(decision.messages ?? [])))
	}
	{
		const host = fresh('unattended')
		await callOn(host, S, 'SetGoal', { claim: '把三条路线跑完', done_criteria: '三条路线各有读数与结论' })
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'c1', do: '跑第一条路线', artifacts: ['lab/c1.txt'], done_criteria: 'lab/c1.txt 存在' }] })
		await callOn(host, S, 'VoidPlanStep', { step_id: 'c1', reason: '这一轮只验分层策略' })
		const before = host.goalCalls.length
		await preStep(host, S, 3)
		check(
			'无人值守 + 计划收尾 + 目标还开着 → 目标层接管(不暂停)',
			host.hostGoal?.phase === 'active' && host.hostGoal?.activation === 'armed' && !calls(host).slice(before).includes('pause'),
			calls(host).slice(before).join(','),
		)
	}

	// ③ 人开口 = 换新窗口(ClearAI `reset_goal_loop`:人工输入即重置目标循环、换 window_id)。
	{
		const host = fresh('attended')
		await callOn(host, S, 'SetGoal', { claim: '把三条路线跑完', done_criteria: '三条路线各有读数与结论' })
		host.hostGoal.roundsStarted = 5 // 上一窗口已经烧掉 5 轮
		const before = host.goalCalls.length
		await preStep(host, S, 4, [{ source: { kind: 'user' } }])
		check(
			'人开口 → 先清后建换新窗口(轮数重新计)',
			calls(host).slice(before).includes('clear') && calls(host).slice(before).includes('create'),
			calls(host).slice(before).join(','),
		)
		check('新窗口的轮数是空的', host.hostGoal?.roundsStarted === 0, String(host.hostGoal?.roundsStarted))
	}

	// ④ 自动续跑回合:模型是被叫醒的,得知道为什么 + 现在的事实。
	{
		const host = fresh('unattended')
		await callOn(host, S, 'SetGoal', { claim: '把三条路线跑完', done_criteria: '三条路线各有读数与结论' })
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'd1', do: '跑第一条路线', artifacts: ['lab/d1.txt'], done_criteria: 'lab/d1.txt 存在' }] })
		const planRound = await preStep(host, S, 5, [{ source: { kind: 'goal', round: 1 } }])
		const planText = JSON.stringify(planRound.messages ?? [])
		check('自动续跑回合注入 ClearAI 的计划层续跑文案', /【自动续跑】/.test(planText) && /先 CheckPlan 核对当前真实步骤/.test(planText))
		check('并且带上轮次(第 N/M 轮)', /第 0\/128 轮/.test(planText), planText.slice(0, 120))
		// 同一状态再叫醒一次:仍然注入(自动续跑回合不走去重——那是这一回合的全部由来)
		const again = await preStep(host, S, 6, [{ source: { kind: 'goal', round: 2 } }])
		check('自动续跑回合即使状态没变也注入(否则模型这一轮没有事实可依)', (again.messages ?? []).length === 1)
		// 目标层:计划已收尾而目标未达成
		await callOn(host, S, 'VoidPlanStep', { step_id: 'd1', reason: '这一轮只验续跑文案' })
		const goalRound = await preStep(host, S, 7, [{ source: { kind: 'goal', round: 2 } }])
		check('计划收尾后 → 目标层续跑文案(开下一阶段 / 交验收)', /【自动续跑·目标未达成】/.test(JSON.stringify(goalRound.messages ?? [])))
		check('文案不提不存在的阶段蓝图', !/蓝图/.test(JSON.stringify(goalRound.messages ?? [])))

		// ⑤ 窗口最后一个回合:门只能由模型自己开,所以提示它开(逐字移植 ClearAI 的 _LAST_TURN_HINT 主旨)
		host.hostGoal.roundsStarted = 511
		const lastRound = await preStep(host, S, 8, [{ source: { kind: 'goal', round: 512 } }])
		check('窗口最后一个回合 → 提示它自己开一道具体的人门', /最后一个回合/.test(JSON.stringify(lastRound.messages ?? [])))

		// ⑥ 额度用尽是机器事实,照实说(ClearAI 的 plan 状态 budget_limited:「窗口 token 或续跑回合数用尽:等人」)。
		//    宿主的回合驱动在 roundsStarted >= maxGoalRounds 时自己会 block(code='round-limit')。
		host.hostGoal.phase = 'blocked'
		host.hostGoal.activation = 'disarmed'
		host.hostGoal.blockedReason = { code: 'round-limit', message: 'reached limit' }
		const exhausted = await preStep(host, S, 9, [{ source: { kind: 'tool' } }])
		check(
			'额度用尽 → 卡片说清是额度、不是故障',
			/额度已用尽/.test(JSON.stringify(exhausted.messages ?? [])) && !/令牌已阻塞\(round-limit\)/.test(JSON.stringify(exhausted.messages ?? [])),
			JSON.stringify(exhausted.messages ?? []).slice(-200),
		)
		// 而「人开口 = 重新授权」:人一句话就把额度重置(逐条对齐 ClearAI 的 reset_goal_loop,
		// 它连 GOAL_BUDGET_EXHAUSTED_KEY 一起清)。没有这一条,额度用尽就是死局。
		const before = host.goalCalls.length
		await preStep(host, S, 10, [{ source: { kind: 'user' } }])
		check(
			'人开口 → 额度重置(先清后建新窗口,blocked 不再是终点)',
			calls(host).slice(before).includes('clear') && calls(host).slice(before).includes('create') && host.hostGoal?.phase === 'active',
			calls(host).slice(before).join(','),
		)
	}
}

console.log('\n【计划确认门:两条授权通道 + 收件箱(阶段 4)】')
{
	const S = 'session-gate'
	const fresh = (autonomy) => {
		const host = makeHost()
		apply(host.ctx, { autonomy })
		/**
		 * §34 之后**计划永远要人批** ⇒ 这里装一个「人在审阅里批准了」的桩(生产里的正常路径)。
		 * 没有通道的 headless 形态另有用例专门验:计划会停在未授权那道门上,而不是被系统自己签掉。
		 */
		host.userQuestions = { async ask() { return { answers: [{ id: 'plan-review', selected: ['批准,开始执行'] }] } } }
		return host
	}
	/** 立目标 + 取回假设 id:计划步骤的 tests 必须引用本 run 真实存在的假设。 */
	const setup = async (autonomy) => {
		const host = fresh(autonomy)
		await callOn(host, S, 'SetGoal', {
			claim: '把三条路线跑完',
			done_criteria: '三条路线各有读数与结论',
			hypotheses: [{ claim: '三条路线里有一条最省时', refute_when: '三条耗时相同' }],
		})
		const hypothesis = host.service.state(S).hypotheses[0].id
		return { host, hypothesis }
	}
	const stepsOf = (hypothesis) => [{ id: 'g1', do: '跑出第一份读数', artifacts: ['lab/g1.csv'], done_criteria: 'lab/g1.csv 存在且含一行数据', tests: { hypothesis, level: 'L3' } }]

	// ⓪ 不可达保证:人门动词**没有工具 schema**——模型的工具面里不存在它们。
	// 这是 D2「只给人」这句承诺在机制上的落点:不是「模型不该调」,是「模型调不到」。
	

	/**
	 * §34 **这一节整体删掉了**:它验的是「面板上切一下档,机制立刻跟着走」——
	 * 而那个开关已经不存在了 ✗。留着的是它的**新契约**:
	 *
	 *   · 档位只是**部署预设写的初值**,随投影下发(供面板显示"这是怎么配的");
	 *   · 它**不再**决定任何门:计划**永远**请人确认(无人值守配置也一样);
	 *   · 额度是**一个保险丝**(128 轮),不随档变;
	 *   · 「我要不要在场」由**门**表达:计划待确认 / 等裁决 / 有人在等 ⇒ 停;都关着 ⇒ 继续。
	 */
	{
		const host = makeHost()
		apply(host.ctx, { autonomy: 'attended' })
		await preStep(host, S, 1)
		check(
			'档位只是预设初值,随投影下发(面板据此说明"这是怎么配的")',
			host.service.view(S).autonomy?.value === 'attended' && host.service.view(S).autonomy?.source === 'preset',
			JSON.stringify(host.service.view(S).autonomy),
		)
		check(
			'卡片如实说这是预设写的,且**不再承诺面板可切**',
			/运行档:人在场\(部署预设写的/.test(host.service.renderCard(S)) && !/面板上可切/.test(host.service.renderCard(S)),
			host.service.renderCard(S).split('\n').find((line) => line.includes('运行档')) ?? '',
		)
	}

	/**
	 * ⓪″ 两份人门标记解析器必须同格式。
	 *
	 * 内核有自己的一份(预设平面不 import 宿主模块),宿主 fold 也有自己的一份。
	 * 这两份曾经各写各的——直到 2026-09-11 才发现内核那份是抄在闭包里的私本。
	 * 现在靠这条断言钉住:任何一边改了格式,这里立刻红。
	 */
	

	/**
	 * ① §34 **计划永远要人确认**,两档配置一致。
	 *
	 * 旧的两条(无人值守「立约即授权」/ 人在场「记号等人」)是**档位**的表达,随开关一起删了 ✗。
	 * 现在钉住的是单一一套语义:
	 *   · 有审阅通道且人批准了 ⇒ 记号由**人**批(`by=user`)、回执不再要确认、续跑照常驱动;
	 *   · 通道不在(或人把卡撤下/先改再交)⇒ 记号一个字都不落 —— 这是**一道真门**:
	 *     计划未授权 ⇒ **不驱动续跑**,如实停在等人(而不是替人签字 ✗)。
	 */
	{
		const { host, hypothesis } = await setup('attended')
		const asked = []
		host.userQuestions = { async ask(request) { asked.push(request); return { answers: [{ id: 'plan-review', selected: ['批准,开始执行'] }] } } }
		const created = await callOn(host, S, 'CreatePlan', { steps: stepsOf(hypothesis) })
		const view = host.service.view(S)
		check('内核自己去请人审阅(不是靠提示词让模型问)', asked.length === 1, String(asked.length))
		check('批准 ⇒ 记号由**人**批,回执不再要确认', view.plan?.confirmedAt !== null && view.plan?.confirmedBy === 'user' && created.confirmation_required === false, JSON.stringify({ by: view.plan?.confirmedBy, need: created.confirmation_required }))
		check('收件箱里没有凭空多出来的门(记号是账,不是门)', view.inbox.every((item) => item.kind !== 'plan_confirm') && view.hasOpenGate === false, JSON.stringify(view.inbox))
		await preStep(host, S, 2)
		check('已授权 + 有开着的步 ⇒ 驱动续跑', host.hostGoal?.phase === 'active' && host.hostGoal?.activation === 'armed', `${host.hostGoal?.phase}/${host.hostGoal?.activation}`)
	}
	{
		const { host, hypothesis } = await setup('unattended')
		/** `fresh()` 默认装了批准桩(正常路径)⇒ 这一例要的是**通道不在**的形态:摘掉它。 */
		delete host.userQuestions
		/** 通道不在(headless 形态):内核照样请人,只是请不到 ⇒ 未授权 ⇒ 停。 */
		const created = await callOn(host, S, 'CreatePlan', { steps: stepsOf(hypothesis) })
		const view = host.service.view(S)
		check('通道不在 ⇒ 记号一个字都不落(不替人签字,无人值守配置也一样)', view.plan?.confirmedAt === null && view.plan?.confirmedBy === null && created.confirmation_required === true, JSON.stringify({ by: view.plan?.confirmedBy, need: created.confirmation_required }))
		const card = host.service.renderCard(S)
		check('卡片如实说授权记号未落账(人话,不带账本字段名)', /授权:记号未落账/.test(card) && !/plan_confirmation_pending|confirmed_at/.test(card))
		check('卡片不再劝人去「引导确认」(那是已经砍掉的动作)', !/先引导确认/.test(card) && /第一次交付会按事实补写/.test(card))
		await preStep(host, S, 2)
		check(
			'未授权的计划**不驱动续跑**(这正是那枚记号挡住的东西:一道真门,等人)',
			host.hostGoal?.phase === 'paused' && host.service.state(S).continuation?.why === 'plan_confirm',
			`${host.hostGoal?.phase}/${host.hostGoal?.activation} · ${JSON.stringify(host.service.state(S).continuation)}`,
		)
	}

	// ③ 交付一步 = 授权已经发生(ClearAI `stamp_confirmed_by_progress`:事实与意图冲突时以事实为准)
	{
		const { host, hypothesis } = await setup('attended')
		/** 交付即授权要验的是「记号还空着」这条路径 ⇒ 同样摘掉批准桩。 */
		delete host.userQuestions
		await callOn(host, S, 'CreatePlan', { steps: stepsOf(hypothesis) })
		write('lab/g1.csv', 'run,value\n1,61\n')
		const advanced = await callOn(host, S, 'AdvancePlan', { step_id: 'g1' })
		check('交付照常推进(记号不是闸门,是账)', advanced.ok === true, String(advanced.code))
		check('同一批变更里补写 plan/confirmed(by=progress)', host.journal.some((mutation) => mutation.t === 'plan/confirmed' && mutation.by === 'progress'))
		const view = host.service.view(S)
		check('门随之消失(状态锚:门一解决条目自然消失,不留僵尸)', view.inbox.every((item) => item.kind !== 'plan_confirm') && view.hasOpenGate === false)
		check('卡片改说「授权已经发生,继续执行」', /授权已经发生/.test(host.service.renderCard(S)) || /据推进事实补写/.test(host.service.renderCard(S)))
	}

	// ④ 第一次授权为准:已有的记号不被后面的通道改写(幂等)
	{
		const { host, hypothesis } = await setup('attended')
		/** 「第一次授权为准」要验的是**补写**那条路(未授权 → 交付补写)⇒ 摘掉批准桩。 */
		delete host.userQuestions
		await callOn(host, S, 'CreatePlan', { steps: stepsOf(hypothesis) })
		write('lab/g1.csv', 'run,value\n1,61\n')
		await callOn(host, S, 'AdvancePlan', { step_id: 'g1' })
		const first = host.service.view(S).plan?.confirmedBy
		await callOn(host, S, 'AdvancePlan', { step_id: 'g1' })
		check('授权记号只写一次(第一次授权为准)', host.journal.filter((mutation) => mutation.t === 'plan/confirmed').length === 1 && host.service.view(S).plan?.confirmedBy === first, String(first))
	}

	// ⑤ 世界线:算不出 → 收件箱等人;人裁决 → 内核真的按它采纳(by:'user',正式)
	

	// ⑤′ 采纳了但要合并的对象**已经不在**(2026-09-12 案例 A 实测):不许卡住,登记采纳 + 不合并
	

	// ⑥ 并列**不是**算不出(另一枚干净的令牌走这条):照常收敛,但记为临时采纳 + 待复核
	
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
	await callOn(host, S, 'SetGoal', { claim: '把两件事查清', done_criteria: '两件事都有结论', hypotheses: [{ claim: '甲成立', refute_when: '甲不成立' }] })
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'g1', do: '做事', artifacts: ['lab/g1.txt'], done_criteria: 'lab/g1.txt 存在', tests: { hypothesis: host.service.state(S).hypotheses[0].id, level: 'L3' } }] })
	writeText(join(ws, 'lab', 'g1.txt'), '读数是 1\n')
	host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '1', validity: 'usable' }
	await callOn(host, S, 'AdvancePlan', { step_id: 'g1', observations: [{ ref: 'lab/g1.txt' }] })
	check('中途口径:计划推进时完成度按步算', Math.abs((host.service.view(S).goal?.progress ?? -1) - 1) < 1e-9, String(host.service.view(S).goal?.progress))
	await callOn(host, S, 'ClosePlan', { summary: '这一阶段做完了' })
	const closed = await callOn(host, S, 'CloseGoal', { outcome: 'achieved' })
	check('结案成功(独立评估者裁决)', closed.ok === true, String(closed.code))
	check('终局优先:目标 achieved ⇒ 完成度 100%(不再回落到假设口径的 0%)', host.service.view(S).goal?.progress === 1, String(host.service.view(S).goal?.progress))
}

console.log('\n【知识门:核心结论不许以纯散文升格(机制缺省关,preset 里开)】')
{
	/**
	 * 为什么要有这道门:断言一直是「加法,不是门槛」,于是模型的最优策略就是
	 * 「检索 → 总结 → 写报告」——本体图、实体图、认识论三张图都长不出来,因为**完成函数里没有它们**。
	 * 让缺口进卡只解决「看得见」;这一道解决「绕不过」。
	 *
	 * 两个形态都要验:**缺省关**(机制中立,断言始终是加法 ⇒ 老账本照旧结案)
	 * 和**开了之后**(将要升格的命题没形态就拦,而且**在派评估者之前**就拦)。
	 */
	const setup = async (config) => {
		const host = makeHost()
		const ws = tempDir('clearai-typed-gate-')
		execFileSync('git', ['init', '-q'], { cwd: ws })
		execFileSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: ws })
		host.cwd = ws
		apply(host.ctx, { blockedThreshold: 3, ...config })
		const S = `session-typed-${String(config.requireTypedPromotion)}`
		await callOn(host, S, 'SetGoal', {
			claim: '把炉次氧含量查清',
			done_criteria: '氧含量有读数与出处',
			hypotheses: [{ claim: 'T2 炉次氧含量是 10ppm', refute_when: '复测不是 10ppm' }],
		})
		await callOn(host, S, 'CreatePlan', {
			steps: [{ id: 'g1', do: '读仪表记录', artifacts: ['lab/g1.txt'], done_criteria: 'lab/g1.txt 存在', tests: { hypothesis: host.service.state(S).hypotheses[0].id, level: 'L3' } }],
		})
		writeText(join(ws, 'lab', 'g1.txt'), '氧含量 10ppm\n')
		host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '10', validity: 'usable' }
		await callOn(host, S, 'AdvancePlan', { step_id: 'g1', observations: [{ ref: 'lab/g1.txt' }] })
		await callOn(host, S, 'ClosePlan', { summary: '这一阶段做完了' })
		return { host, S }
	}

	// ① 缺省(=机制中立):没形态照旧结案。
	{
		const { host, S } = await setup({})
		const closed = await callOn(host, S, 'CloseGoal', { outcome: 'achieved' })
		check('缺省不装知识门 ⇒ 无断言的命题照旧升格(断言始终是加法)', closed.ok === true, String(closed.code))
		check('升格后事实真的没有断言(那条缺口如实留在读数里)', (host.service.state(S).facts[0]?.assertions ?? null) === null)
	}

	// ② 装了门:拦下,而且**不白花一次评估者**。
	{
		const { host, S } = await setup({ requireTypedPromotion: true })
		/** 交付到 L3 那一步已经派过一次评估者——数的增量,不是总数。 */
		const dispatchedBefore = host.service.state(S).audits.length
		const blocked = await callOn(host, S, 'CloseGoal', { outcome: 'achieved' })
		check('将升格的命题没有形态 ⇒ 拒', blocked.ok === false && blocked.code === 'claims_untyped', String(blocked.code))
		check('拒在**派评估者之前**(那一次子 run 没有白花)', host.service.state(S).audits.length === dispatchedBefore, `${dispatchedBefore} → ${host.service.state(S).audits.length} 次派发`)
		check('门说清了是哪几条命题、也给了两条出路', /补形态再结/.test(String(blocked.message)) && /abandoned/.test(String(blocked.message)), String(blocked.message).slice(0, 120))
		check('目标保持开放(不许靠改判据绕过)', host.service.state(S).goal.status === 'open')

		// 补形态:词汇 + 修订目标(主张原文一字不动 ⇒ 用回原 id,验到哪一级接着算)。
		const term = await callOn(host, S, 'RegisterTerm', { id: 'furnace_batch', label: '炉次', gloss: '一次熔铸循环', basis: '现场记录 R-01' })
		const pred = await callOn(host, S, 'RegisterPredicate', { id: 'oxygen_ppm', label: '氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, basis: '现场记录 R-01' })
		/**
		 * **实例也得先登记**:断言的**主体必须可指认**——`T2` 是具体的一次炉次(观测),
		 * 不是概念(约定)。只立词不立实例的话,那句断言读得出、却没人能核。
		 */
		const inst = await callOn(host, S, 'RegisterInstance', { id: 'T2', type: 'furnace_batch', label: 'T2 炉次', basis: '现场记录 R-01', provenance: { kind: 'named', ref: '现场记录 R-01' } })
		check('先立词汇与实例(没有它们就写不出可核的断言)', term.ok === true && pred.ok === true && inst.ok === true, `${term.code}/${pred.code}/${inst.code}`)
		const hypothesisId = host.service.state(S).hypotheses[0].id
		const revised = await callOn(host, S, 'SetGoal', {
			claim: '把炉次氧含量查清',
			done_criteria: '氧含量有读数与出处',
			reason: '补上断言的形态',
			hypotheses: [{ claim: 'T2 炉次氧含量是 10ppm', refute_when: '复测不是 10ppm', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'T2', type: 'furnace_batch' }, object: { kind: 'quantity', value: 10, unit: 'ppm' } }] }],
		})
		check('修订目标 → 立起', revised.ok === true, String(revised.code))
		check('补上的断言落在**原来那条**命题上(不是新开一条)', host.service.state(S).hypotheses.length === 1 && host.service.state(S).hypotheses[0].id === hypothesisId)
		check('验到哪一级接着算(修订没有抹掉已支持等级)', host.service.derive(S).hypotheses[0].supportedLevel === 'L3')

		const passed = await callOn(host, S, 'CloseGoal', { outcome: 'achieved' })
		check('补上形态之后放行', passed.ok === true, String(passed.code))
		check('升格的事实带着断言(这一次本体真的长出来了)', Array.isArray(host.service.state(S).facts[0]?.assertions) && host.service.state(S).facts[0].assertions.length === 1)
		check('事实仍然指得回它的命题(身份与内容一起定型)', host.service.state(S).facts[0].hypothesis === hypothesisId)
		check('结案后缺口读数清空(它不再是欠账)', !host.service.derive(S).knowledge.gaps.some((gap) => gap.code === 'unstructured_facts'))
	}
}

console.log('\n【货架所有权:派出去的子会话不许重铺主线的读面】')
{
	/**
	 * 真跑里评估者两次报 `clear/ontology/domain.md` 是 7 行占位版,主线连读三次都是
	 * 96 行 21 词条、md5 稳定——两边各自稳定,谁都没说谎。根因:子会话与主线**共享工作区**,
	 * 但它自己的投影里没有词汇;它的 pre-step 也走 `ensureDomainShelf`,
	 * `renderShelf(子会话)` 渲染出的正是「(还没有词条…)」占位版,于是把共享货架重写掉。
	 * 文件在「谁最后铺了一拍」之间摆动。事实货架(`facts/INDEX.md`)是同一种病。
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
	const term = await callOn(host, P, 'RegisterTerm', { id: 'furnace_batch', label: '炉次', gloss: '一次熔铸循环', basis: '现场记录 R-01' })
	const pred = await callOn(host, P, 'RegisterPredicate', { id: 'oxygen_ppm', label: '氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, basis: 'GB/T 5121' })
	check('前置:词汇真的立起来了', term.ok === true && pred.ok === true, `${term.code}/${pred.code}`)
	const domain = join(ws, 'clear', 'ontology', 'domain.md')
	const factsIndex = join(ws, 'clear', 'knowledge', 'facts', 'INDEX.md')
	const domainBefore = readFileSync(domain, 'utf8')
	check('前置:主线的词汇货架真有内容(不是占位版)', domainBefore.includes('furnace_batch') && !domainBefore.includes('还没有词条'), domainBefore.slice(0, 60))

	// ① 子会话:同一份工作区,但身份是派生会话(评估者就是这个形状)。
	//    给它自己的投影塞一条事实、事实货架放一个哨兵:没有护栏时,它会按**自己的**
	//    投影重写这两份读面(词汇 → 占位版;事实 → 它那条)。
	host.childSessions = {
		'child-evaluator': { header: { cwd: ws, parentSession: P, origin: 'subagent' }, ownEvents: () => [] },
	}
	host.states.set(
		'child-evaluator',
		applyMutations(emptyState(), [{ t: 'fact/promoted', id: 'f-child', goal: 'g-x', text: '子会话自己的一条', scope: 's', level: 'L2', evidence: [], path: 'p' }]),
	)
	writeText(factsIndex, 'SENTINEL:主线的事实货架\n')
	await preStep(host, 'child-evaluator', 1)
	check('子会话的 pre-step **不重写**词汇货架', readFileSync(domain, 'utf8') === domainBefore)
	check('子会话的 pre-step 也不重写事实货架(同一条所有权规则)', readFileSync(factsIndex, 'utf8') === 'SENTINEL:主线的事实货架\n')

	// ② 对照:拥有账本的会话照常维护——词汇变了,货架跟着长。
	host.childSessions = {}
	await callOn(host, P, 'RegisterTerm', { id: 'heating_rate', label: '升温速率', gloss: 'g', basis: 'b' })
	await preStep(host, P, 1)
	check('主线自己的 pre-step 照常维护货架(新词条长出来了)', readFileSync(domain, 'utf8').includes('heating_rate') && readFileSync(domain, 'utf8') !== domainBefore)

	// ③ 反例自检:护栏拦的是真实会发生的重写(子会话的投影里确实另有内容)。
	check('子会话的投影里没有主线的词汇(不带护栏时它会写出占位版)', (host.service.state('child-evaluator').lexicon?.terms ?? []).length === 0)
	check('子会话的投影里有它自己的事实(不带护栏时它会重写事实货架)', host.service.state('child-evaluator').facts.length === 1)
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
		apply(host.ctx, { autonomy: 'unattended', blockedThreshold: 3 })
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
		apply(host.ctx, { autonomy: 'unattended', blockedThreshold: 3 })
		const S = 'session-audit-live'
		host.states.set(S, pendingAudit(S, 'child-live'))
		host.listing = [{ kind: 'child', id: 'child-live', activity: 'running', hasChildren: false, mode: 'one-shot' }]
		await preStep(host, S, 73)
		const decision = await preStep(host, S, 74)
		check('子会话还在跑 ⇒ 不落失联(不误伤)', host.journal.filter((mutation) => mutation.t === 'audit/settled').length === 0)
		// 判据是**卡里的那句话**:还在跑 ⇒ 令牌已经在手,照旧写「机器等待,不推」。
		check('还在跑 ⇒ 照旧「机器等待,不推」(卡片写明原因)', /评估者还在裁决/.test(JSON.stringify(decision.messages ?? [])), JSON.stringify(decision.messages ?? []).slice(0, 220))
	}

	// ③ 拿不到目录(服务不在)⇒ 不猜:保持原样,不动那条裁决
	{
		const host = makeHost()
		apply(host.ctx, { autonomy: 'unattended', blockedThreshold: 3 })
		const S = 'session-audit-nolisting'
		host.states.set(S, pendingAudit(S, 'child-unknown'))
		host.subagentsAvailable = false
		await preStep(host, S, 75)
		check('拿不到子代理目录 ⇒ 什么都不做(不猜、不误伤)', host.journal.filter((mutation) => mutation.t === 'audit/settled').length === 0)
	}
}

console.log('\n【L4:门挂在等级上,放行读权威记录(2026-09-11,AUDIT §14-A/B)】')
{
	/**
	 * 改之前有两处缺陷,而且**一条测试都没有**:
	 *   ① 门挂错轴:`l4RequiresHumanRelease`/`l4RejectSelfWritten` 只写在 `AdvancePlan` 里,
	 *      `AdvanceWorldline` 那条路两样都没有 —— 同一个 `level:'L4'`,走世界线就不用放过行、也不查来源;
	 *   ② 放行是**推断**的:走到工具体里就无条件写一条 `human/released`
	 *      (策略自动放行、审批档 never、ask 压根没触发时,都会留下一条「人放行」的假事实)。
	 * 现在:两条路同一道门(按步骤等级/分支等级),放行**读**原生审批栈的
	 * `approval/asked{id,toolName,callId}` + `approval/decided{id,outcome=allowed-once}` 一对事件。
	 */
	const approvalPair = (callId, outcome) => [
		{ type: 'approval/asked', data: { id: 'ap-1', toolName: 'AdvancePlan', callId } },
		{ type: 'approval/decided', data: { id: 'ap-1', outcome } },
	]

	// ① 主线:没有放行记录 ⇒ 交付被拒(不写「人放行」这条假事实)
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		const S = 'session-l4-main'
		await callOn(host, S, 'SetGoal', { claim: '拿一份外部证据', done_criteria: '有外部来源的观测', hypotheses: [{ claim: '外部数据可用', refute_when: '拿不到' }] })
		await callOn(host, S, 'CreatePlan', { steps: [{ id: 'x1', do: '交付外部证据', artifacts: ['lab/x1.txt'], done_criteria: 'lab/x1.txt 存在且非空', tests: { hypothesis: host.service.state(S).hypotheses[0].id, level: 'L4' } }] })
		write('lab/x1.txt', '外部仪器导出\n')
		host.nextVerdict = { verdict: 'support', basis: '硬信号:外部导出可核对', reading: '1', validity: 'usable' }
		const noWitness = await callOn(host, S, 'AdvancePlan', { step_id: 'x1', observations: [{ ref: 'lab/x1.txt' }] })
		check('L4 没有放行记录 ⇒ 交付被拒(人放行不能推断)', noWitness.ok === false && noWitness.code === 'human_release_missing', `${noWitness.code}:${String(noWitness.message ?? '').slice(0, 80)}`)
		check('被拒时**没有**落「人放行」这条事实', host.journal.filter((mutation) => mutation.t === 'human/released').length === 0)

		// ② 有权威记录(approval/decided=allowed-once)⇒ 放行,并且**记下它凭什么算数**
		host.sessionEvents = { [S]: approvalPair('call-1', 'allowed-once') }
		const released = await callOn(host, S, 'AdvancePlan', { step_id: 'x1', observations: [{ ref: 'lab/x1.txt' }] })
		check('L4 拿到了权威放行记录 ⇒ 交付通过', released.ok === true, `${released.code}:${String(released.message ?? '').slice(0, 80)}`)
		const releases = host.journal.filter((mutation) => mutation.t === 'human/released')
		check('放行事实来自审批记录(via=approval,带 callId)', releases.length === 1 && releases[0].via === 'approval' && releases[0].call === 'call-1', JSON.stringify(releases[0] ?? null))
		check('放行绑在**步骤**这条轴上(主线)', releases[0]?.step === 'x1' && (releases[0]?.branch ?? null) === null, JSON.stringify(releases[0] ?? null))

		// ③ 放行被拒(approval/decided=rejected)⇒ 同样不许交付,也不写事实
		const rejectedHost = makeHost()
		apply(rejectedHost.ctx, { blockedThreshold: 3 })
		const S2 = 'session-l4-rejected'
	/**
	 * §19-B(**修正后**的语义):发起者是 `tools/pre-execute` 瀑布(AUDIT §14-B 早就这么设计),
	 * AdvancePlan 只**读**那条权威记录。真跑暴露的缺陷是**放行事实的时点**:
	 * 旧写法把 `human/released` 留在交付成功之后 ⇒ 「人放行了,可这一交付栽在来源分离门上」时
	 * 那条事实随失败消失,同一步重试**又问人一遍**。现在放行先落账,失败也带着它回去。
	 */
	{
		// ① 放行拿到了,但交付栽在来源分离门 ⇒ 人的放行**照样落账**
		const lateHost = makeHost()
		apply(lateHost.ctx, { blockedThreshold: 3 })
		const LS = 'session-l4-release-then-fail'
		await callOn(lateHost, LS, 'SetGoal', { claim: '拿一份外部证据', done_criteria: '有外部来源的观测', hypotheses: [{ claim: '外部数据可用', refute_when: '拿不到' }] })
		await callOn(lateHost, LS, 'CreatePlan', { steps: [{ id: 'x9', do: '交付外部证据', artifacts: ['lab/x9.txt'], done_criteria: 'lab/x9.txt 存在且非空', tests: { hypothesis: lateHost.service.state(LS).hypotheses[0].id, level: 'L4' } }] })
		write('lab/x9.txt', '外部仪器导出\n')
		// 人放行过这次调用(pre-execute 瀑布发起、宿主记的审计对),而观测里混进了**自己写过的**文件
		lateHost.sessionEvents = { [LS]: [{ type: 'approval/asked', data: { id: 'ap-late', toolName: 'AdvancePlan', callId: 'call-1' } }, { type: 'approval/decided', data: { id: 'ap-late', outcome: 'allowed-once' } }] }
		const lateFailed = await callOn(lateHost, LS, 'AdvancePlan', { step_id: 'x9', observations: [{ ref: 'lab/x9.txt' }] })
		check('放行之后栽在别的门上时,「人放行」这条事实**照样落账**(人的动作不因后来的失败消失)', lateHost.journal.some((mutation) => mutation.t === 'human/released' && mutation.step === 'x9'), `${lateFailed.code}:${JSON.stringify(lateHost.journal.filter((m) => m.t === 'human/released'))}`)

		// ② 那一步从此**不再问人**:pre-execute 的 L4 门看的就是这条事实
		const gate = lateHost.listeners.get('tools/pre-execute')
		const asked = await gate({ name: 'AdvancePlan', args: { step_id: 'x9' }, agent: { id: LS }, session: { id: LS } }, async () => ({ kind: 'allow' }))
		check('同一步重试时不再向人发问(门看的是**步**的放行事实,不是这一次调用)', asked === null || asked === undefined || asked.kind !== 'ask', JSON.stringify(asked ?? null))
	}

		await callOn(rejectedHost, S2, 'SetGoal', { claim: '拿一份外部证据', done_criteria: '有外部来源的观测', hypotheses: [{ claim: '外部数据可用', refute_when: '拿不到' }] })
		await callOn(rejectedHost, S2, 'CreatePlan', { steps: [{ id: 'x2', do: '交付外部证据', artifacts: ['lab/x2.txt'], done_criteria: 'lab/x2.txt 存在且非空', tests: { hypothesis: rejectedHost.service.state(S2).hypotheses[0].id, level: 'L4' } }] })
		write('lab/x2.txt', '外部仪器导出\n')
		// callId 必须与这次工具调用的一致(`callOn` 固定用 `call-1`)——审批是按**调用**授权的
		rejectedHost.sessionEvents = { [S2]: approvalPair('call-1', 'rejected') }
		const rejected = await callOn(rejectedHost, S2, 'AdvancePlan', { step_id: 'x2', observations: [{ ref: 'lab/x2.txt' }] })
		check('放行被拒(approval/decided=rejected)⇒ 交付被拒,理由里写明审批结果', rejected.ok === false && rejected.code === 'human_release_missing' && /rejected/.test(String(rejected.message)), `${rejected.code}:${String(rejected.message ?? '').slice(0, 90)}`)
		check('被拒时同样不落「人放行」', rejectedHost.journal.filter((mutation) => mutation.t === 'human/released').length === 0)
	}

	// ④ 世界线:同一个 L4,走世界线也要过这两道门(改之前两样都没有)
	
}

console.log('\n【外脑:把工作区投影成原生条目,自建只有写侧两件】')
{
		const noSkills = makeHost()
		noSkills.skillsAvailable = false
		apply(noSkills.ctx, {})
		check('宿主没有 skills 服务时,装配照常(降级不抛)', noSkills.tools.size === 20)
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
		await callOn(host, H, 'SetGoal', {
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
		const closed = await callOn(host, H, 'CloseGoal', { outcome: 'achieved' })
		check('结案成功(判据达成了)', closed.ok === true, JSON.stringify(closed.code ?? null))
		const closedMutation = host.journal.filter((m) => m.t === 'goal/closed').at(-1)
		const unjudged = closedMutation?.unjudged ?? null
		check('结案把「没被任何证据触及的假设」如实落账', Array.isArray(unjudged) && unjudged.length === 1, JSON.stringify(unjudged))
		check('结案消息如实说出来(未判不是「没问题」,是「没看过」)', /没有被任何证据触及/.test(String(closed.message ?? '')) && /没看过/.test(String(closed.message ?? '')), String(closed.message ?? '').slice(0, 160))
		check('视图把留痕交出去(面板与卡片读同一份)', (host.service.view(H).goal?.unjudged ?? []).length === 1, JSON.stringify(host.service.view(H).goal?.unjudged ?? null))
	}

{
		const host = makeHost()
		host.cwd = tempDir('clearai-origins-')
		apply(host.ctx, { blockedThreshold: 3, autonomy: 'unattended' })
		const OR = 'session-origins'
		await callOn(host, OR, 'SetGoal', { claim: '算一个读数', done_criteria: '有带原件的证据', promote_at_level: 'L2', hypotheses: [{ claim: '读数可信', refute_when: '对不上' }] })
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
		apply(host2.ctx, { blockedThreshold: 3, autonomy: 'unattended' })
		const OA = 'session-origins-audit'
		await callOn(host2, OA, 'SetGoal', { claim: '算一个读数', done_criteria: '有独立裁决的证据', promote_at_level: 'L3', hypotheses: [{ claim: '读数可信', refute_when: '对不上' }] })
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
		apply(host.ctx, { blockedThreshold: 3, autonomy: 'unattended' })
		const FS = 'session-facts-shelf'
		await callOn(host, FS, 'SetGoal', {
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
		const closed = await callOn(host, FS, 'CloseGoal', { outcome: 'achieved', note: '一个根' })
		check('前置:目标结案成功', closed?.ok === true, `${closed?.code}:${String(closed?.message ?? '').slice(0, 80)}`)
		const facts = host.service.state(FS).facts
		check('事实升格时带上**边界与等级**(声明里的 scope/level 真的落到事实里)', facts.length === 1 && String(facts[0].scope ?? '').includes('两个根') && facts[0].level === 'L2', JSON.stringify(facts[0] ?? null).slice(0, 120))
		/**
		 * §38 **目标结案前先把计划收尾**:计划还 active 时 CloseGoal(achieved) 必须被拒 ✓
		 * —— 事实是在收尾那条路上沉淀的,先结目标就等于跳过沉淀(真长测里出现过:goal achieved 而 plan active、fact/promoted: 0 ✗)。
		 * 而**放弃**走另一条路:如实说清阻塞就收兵,不受此限 ✓。
		 */
		{
			const guard = makeHost()
			guard.cwd = tempDir('clearai-close-order-')
			apply(guard.ctx, { blockedThreshold: 3 })
			const GG = 'session-close-order'
			guard.userQuestions = { async ask() { return { answers: [{ id: 'plan-review', selected: ['批准,开始执行'] }] } } }
			await callOn(guard, GG, 'SetGoal', { claim: '把两件事查清', done_criteria: '两件事都有结论', hypotheses: [{ claim: '甲成立', refute_when: '甲不成立' }] })
			await callOn(guard, GG, 'CreatePlan', { steps: [{ id: 'q1', do: '做事', artifacts: ['lab/q1.txt'], done_criteria: 'lab/q1.txt 存在' }] })
			const blockedClose = await callOn(guard, GG, 'CloseGoal', { outcome: 'achieved' })
			check('计划还开着 ⇒ 结案被拒(plan_open),并把"差一次 ClosePlan"说清', blockedClose?.ok === false && blockedClose?.code === 'plan_open' && /只差一次 ClosePlan|还有 \d+ 步没落定/.test(String(blockedClose?.message ?? '')), `${blockedClose?.code}:${String(blockedClose?.message ?? '').slice(0, 90)}`)
			check('被拒之后目标仍是开放(没有偷偷结掉)', guard.service.state(GG).goal?.status === 'open' && !guard.journal.some((mutation) => mutation.t === 'goal/closed'))
			const abandonOk = await callOn(guard, GG, 'CloseGoal', { outcome: 'abandoned', note: '缺仪器读数,如实放弃' })
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
	await callOn(host, S, 'SetGoal', { claim: '拿到裁决', done_criteria: 'lab/audit-settle.txt 存在', hypotheses: [{ claim: '能做', refute_when: '不能' }] })
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
		apply(host.ctx, { autonomy: 'unattended', blockedThreshold: 3 })
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
		apply(host.ctx, { autonomy: 'unattended', blockedThreshold: 3 })
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
		apply(host.ctx, { autonomy: 'unattended', blockedThreshold: 3 })
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
	const card = (await call('CheckPlan', {})).card
	check('派生阶段变成 stalled(派生,不存)', /阶段\(派生\):stalled/.test(card), card.split('\n').find((line) => line.includes('阶段')) ?? '')
	await call('VoidPlanStep', { step_id: 'u1', reason: '测试脚手架,不再需要' })
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
	const notYet = await call('CloseGoal', { outcome: 'achieved' })
	check('评估者说没达成 → 目标保持开放', notYet.ok === false && notYet.code === 'goal_not_achieved', String(notYet.code))
	check('目标未结案(台账里没有 goal/closed)', eventsOf('goal/closed').length === 0)

	/**
	 * **同态结案不会拿到新裁决**:材料没变,复用上一条(这是刻意的——否则模型每喊一次
	 * 结案就重烧两三分钟)。要有新判断,先改材料:这里改的是目标本身(修订 ⇒ 修订号 +1 ⇒ 新问题)。
	 */
	thisHost.nextVerdict = { verdict: 'support', basis: '判据逐条核对通过,转写忠实', shortfalls: [] }
	const sameMaterial = await call('CloseGoal', { outcome: 'achieved' })
	check('材料没变 → 复用上一条裁决,不重派评估者', sameMaterial.ok === false && sameMaterial.code === 'goal_not_achieved' && /复用了上一条独立裁决/.test(String(sameMaterial.message)), String(sameMaterial.code))
	const before = thisHost.audits.filter((audit) => audit.request.label.includes('目标评估者')).length
	check('复用没有产生新的评估者派遣', before === 1, String(before))

	const open = thisHost.service.state(SESSION)
	const revised = await call('SetGoal', {
		claim: open.goal.claim,
		headline: open.goal.headline ?? '同态结案的目标',
		done_criteria: open.goal.done_criteria,
		// 主张原文一字不动 ⇒ 用回原 id,已验到哪一级接着算(与真实修订同形)。
		hypotheses: open.hypotheses.map((item) => ({ claim: item.claim, refute_when: item.refute_when })),
		reason: '测试脚手架:改一次材料,好让下一次结案拿到新裁决',
		legacy: true,
	})
	check('前置:目标修订成功(材料变了)', revised.ok === true, String(revised.code))
	const achieved = await call('CloseGoal', { outcome: 'achieved' })
	check('评估者说达成 → 结案', achieved.ok === true && achieved.code === 'goal_achieved', String(achieved.code))
	check('目标级审计无条件派发', thisHost.audits.some((audit) => audit.request.label.includes('目标评估者')))
	// 事实落盘在整个文件共用的工作区里,别的用例合法地升格过事实——所以这条断言**认自己那个目标**,
	// 不是「整个工作区一条事实都没有」(那种写法让用例之间靠共享目录互相牵连)。
	const refutedGoal = thisHost.service.state(SESSION).goal?.id
	check(
		'有推翻证据的假设不升格(达门槛也不能升)',
		!factFiles().some((file) => file.endsWith(`/${refutedGoal}.md`)) && /没有达到升格门槛/.test(achieved.message),
		`目标 ${refutedGoal} 却落了事实:${factFiles().join(',')}`,
	)
	check('被推翻的假设仍在状态里可查', thisHost.service.state(SESSION).hypotheses.length >= 1 && eventsOf('evidence/recorded').some((event) => event.verdict === 'refute'))
}

console.log('\n【升格:达门槛且无推翻的假设 → 事实(由系统写进知识库)】')
{
	const g2 = await call('SetGoal', {
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
	const closed = await call('CloseGoal', { outcome: 'achieved' })
	check('无推翻且达门槛 → 升格为事实', closed.ok === true && /升格为事实/.test(closed.message), String(closed.code))
	const promotedGoal = thisHost.service.state(SESSION).goal?.id
	check(
		'事实由系统写进 clear/knowledge/facts/',
		factFiles().some((file) => file.endsWith(`/${promotedGoal}.md`) && readFileSync(file, 'utf8').includes('升格时间')),
	)
	check('升格也记在台账里', eventsOf('fact/promoted').length === 1)
}

function factFiles() {
	const dir = join(WORKSPACE, 'clear/knowledge/facts')
	try {
		return readdirSync(dir).map((name) => join(dir, name))
	} catch {
		return []
	}
}

console.log('\n【领域语言:词汇动词 · 断言链 · 冲突只暴露】')
{
	/** 一条断言的构造器:同一主体、同一谓词,只换取值——冲突那一段靠的就是它。 */
	const assertion = (value) => ({ predicate: 'oxygen_ppm', subject: { id: 'B1', type: 'furnace_batch' }, object: { kind: 'quantity', value, unit: 'ppm' } })

	// ① 词汇动词:判据与折法同源,拒绝都发生在**落账之前**
	const noBasis = await call('RegisterTerm', { id: 'no_basis_term', label: '无依据概念', gloss: 'g', basis: '' })
	check('概念缺依据 → 拒(约定可以自愿,不能无来由)', noBasis.ok === false && /basis_required/.test(String(noBasis.message)), String(noBasis.code))
	const badId = await call('RegisterTerm', { id: 'Bad-Id', label: 'L', gloss: 'g', basis: 'b' })
	check('概念 id 形状不对 → 拒', badId.ok === false && /id_shape/.test(String(badId.message)))
	const registered = await call('RegisterTerm', { id: 'furnace_batch', label: '炉次', gloss: '一次熔铸循环', basis: '现场记录 R-01' })
	check('登记概念 → 通过', registered.ok === true && registered.code === 'term_registered', String(registered.code))
	check('概念落进货架(读面由系统写)', readFileSync(join(WORKSPACE, 'clear/ontology/domain.md'), 'utf8').includes('furnace_batch'))
	const duplicate = await call('RegisterTerm', { id: 'furnace_batch', label: '炉次', gloss: 'again', basis: 'b' })
	check('同一 id 再登记 → 拒(概念与谓词共用一个命名空间)', duplicate.ok === false && /id_taken/.test(String(duplicate.message)))
	const ghostParent = await call('RegisterTerm', { id: 'narrow_batch', label: 'N', gloss: 'g', basis: 'b', parent: 'ghost_concept' })
	check('父概念不存在 → 拒', ghostParent.ok === false && /parent_unknown/.test(String(ghostParent.message)))
	check('登记子概念(is_a 边)→ 通过', (await call('RegisterTerm', { id: 'narrow_batch', label: '窄窗口炉次', gloss: 'g', basis: 'b', parent: 'furnace_batch' })).ok === true)
	const ambiguous = await call('RegisterPredicate', { id: 'oxygen_ppm', label: '氧含量', range: { term: 'furnace_batch', form: 'quantity' }, basis: 'b' })
	check('值域二选一:同时给 term 与 form → 拒', ambiguous.ok === false && /range_ambiguous/.test(String(ambiguous.message)))
	const ghostDomain = await call('RegisterPredicate', { id: 'oxygen_ppm', label: '氧含量', domain: 'ghost_concept', range: { form: 'quantity' }, basis: 'b' })
	check('主词域不存在 → 拒', ghostDomain.ok === false && /domain_unknown/.test(String(ghostDomain.message)))
	const predicate = await call('RegisterPredicate', { id: 'oxygen_ppm', label: '氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, functional: true, basis: 'GB/T 5121' })
	check('登记谓词(量形态 · 单值)→ 通过', predicate.ok === true && predicate.code === 'predicate_registered', String(predicate.code))

	/**
	 * **实例要先登记**(契约:断言的主体必须可指认)。
	 * B1 是具体的一次炉次(观测),不是概念——只立词不立实例,那句断言读得出、没人能核。
	 */
	const b1 = await call('RegisterInstance', { id: 'B1', type: 'furnace_batch', label: 'B1 炉次', basis: '化验单 L-08', provenance: { kind: 'named', ref: '化验单 L-08' } })
	check('登记实例(带出处)→ 通过', b1.ok === true && b1.code === 'instance_registered', String(b1.code))

	// ② 断言链:SetGoal 在落账之前严校(提供即严校;不提供放行)
	const ghostPredicate = await call('SetGoal', {
		claim: 'C', done_criteria: 'D 可核对',
		hypotheses: [{ claim: 'h', refute_when: 'r', assertions: [{ predicate: 'ghost_pred', subject: { id: 'B1', type: 'furnace_batch' }, object: { kind: 'quantity', value: 8, unit: 'ppm' } }] }],
	})
	check('引用未登记谓词的断言 → 落账之前被拒', ghostPredicate.ok === false && /predicate_unknown/.test(String(ghostPredicate.message)))
	const wrongType = await call('SetGoal', {
		claim: 'C', done_criteria: 'D 可核对',
		hypotheses: [{ claim: 'h', refute_when: 'r', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'B1', type: 'narrow_batch' }, object: { kind: 'quantity', value: 8, unit: 'ppm' } }] }],
	})
	check('主体类型不合主词域 → 拒', wrongType.ok === false && /subject_type_mismatch/.test(String(wrongType.message)))
	const selfConflict = await call('SetGoal', {
		claim: 'C', done_criteria: 'D 可核对',
		hypotheses: [{ claim: 'h', refute_when: 'r', assertions: [assertion(8), assertion(12)] }],
	})
	check('同一事实里同一主体两个值 → 当场拒(自相矛盾)', selfConflict.ok === false && /assertion_self_conflict/.test(String(selfConflict.message)))
	const goal = await call('SetGoal', {
		claim: '氧含量能不能稳定到 8 ppm',
		done_criteria: '台账里 20 炉次的氧含量读数齐备',
		promote_at_level: 'L0',
		hypotheses: [
			{ claim: '工艺参数是主因', refute_when: '工艺受控时波动仍由来料解释', assertions: [assertion(8)] },
			{ claim: '来料是主因', refute_when: '来料同一批时波动仍大' },
		],
	})
	check('带断言的假设 → 通过(断言是加法,不是门槛)', goal.ok === true, String(goal.code))
	const hypothesisId = eventsOf('goal/set').slice(-1)[0].hypotheses[0].id
	check('断言随假设落账(折法里读得到)', Array.isArray(thisHost.service.state(SESSION).hypotheses.find((item) => item.id === hypothesisId)?.assertions))

	// ③ 升格:身份与内容一起定型
	await call('CreatePlan', { steps: [{ id: 'd1', do: '整理 20 炉次台账', artifacts: ['lab/o2.md'], done_criteria: 'lab/o2.md 写明每炉次氧含量与工艺参数', tests: { hypothesis: hypothesisId, level: 'L0' } }] })
	write('lab/o2.md', '# 20 炉次台账\n\n逐炉次列出氧含量读数与同时段的温度窗、拉速、一冷二冷强度与覆盖剂状态;读数取自主控记录的同一批化验单,单位 ppm。\n\n结论:参数可分组的炉次之间氧含量差异明显,而同一参数组内波动较小。\n')
	const delivered = await call('AdvancePlan', { step_id: 'd1', verdict: 'support', basis: 'lab/o2.md 写明每炉次读数与参数' })
	check('L0 步骤交付 → 通过', delivered.ok === true, `${String(delivered.code)} :: ${String(delivered.message).slice(0, 200)}`)
	await call('ClosePlan', {})
	thisHost.nextVerdict = { verdict: 'support', basis: '判据达成,转写忠实', shortfalls: [] }
	check('第一条目标达成 → 升格', (await call('CloseGoal', { outcome: 'achieved' })).ok === true)
	const first = eventsOf('fact/promoted').slice(-1)[0]
	check('升格带着产出它的假设 id(按 id 关联,不是按文本)', first.hypothesis === hypothesisId, String(first.hypothesis))
	check('升格带着类型化断言', Array.isArray(first.assertions) && first.assertions.length === 1)

	// ④ 冲突:两条未撤回的事实互相矛盾 → 只暴露,不裁决,不改任何一侧
	const before = derive(thisHost.service.state(SESSION)).inbox.length
	await call('SetGoal', {
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
	await call('CloseGoal', { outcome: 'achieved' })
	const derived = derive(thisHost.service.state(SESSION))
	const conflict = derived.conflicts.find((item) => item.predicate === 'oxygen_ppm')
	check('同一单值谓词、同一主体、两个取值 → 派生一对冲突', conflict !== undefined && conflict.sides.length === 2, JSON.stringify(derived.conflicts.map((item) => item.predicate)))
	check('冲突不进闸门(它是读数,不是等人处置的门)', derived.inbox.length === before && derived.inbox.every((item) => item.kind !== 'conflict'))
	check('冲突不改任何一侧(两条事实都在,都没被撤回)', derived.factRows.filter((item) => item.predicate === undefined && Array.isArray(item.assertions) && item.assertions.some((row) => row.predicate === 'oxygen_ppm')).every((item) => item.review === null || item.review === undefined))
	const cardText = thisHost.service.renderCard(SESSION)
	check('运行态卡把冲突说出来并说明不替你选', /冲突/.test(cardText) && /系统不替你选/.test(cardText))

	// ⑤ 查已知:按条件取用,查不到如实说
	const found = await call('QueryKnowledge', { term: 'furnace_batch' })
	check('按概念取已知 → 返回带断言的事实', found.ok === true && /已知/.test(String(found.message)), String(found.code))
	const empty = await call('QueryKnowledge', { predicate: 'ghost_pred' })
	check('查不到也如实说(不把「查不到」写成「不存在」)', empty.ok === true && empty.code === 'knowledge_empty' && /不要/.test(String(empty.message)), String(empty.code))
	check('一个条件都不给 → 拒', (await call('QueryKnowledge', {})).ok === false)

	/**
	 * **主体没登记过 ⇒ 拒**(`assert_subject_unknown`),而 `legacy: true` 一次性放行。
	 * 这一对是契约 §4 的正反两面:门要真的在,迁移开关也要真的有出口。
	 */
	const unregistered = await call('SetGoal', {
		claim: 'C4', done_criteria: 'D4 可核对',
		hypotheses: [{ claim: 'h4', refute_when: 'r4', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'B9', type: 'furnace_batch' }, object: { kind: 'quantity', value: 7, unit: 'ppm' } }] }],
	})
	check('主体没登记过 → 拒(主词可指认是能被复核的前提)', unregistered.ok === false && /assert_subject_unknown/.test(String(unregistered.message)), String(unregistered.code))
	const legacyGoal = await call('SetGoal', {
		claim: 'C4', done_criteria: 'D4 可核对', legacy: true, reason: '迁移期一次性放行',
		hypotheses: [{ claim: 'h4', refute_when: 'r4', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'B9', type: 'furnace_batch' }, object: { kind: 'quantity', value: 7, unit: 'ppm' } }] }],
	})
	check('legacy:true → 放行(迁移期出口真的通)', legacyGoal.ok === true, String(legacyGoal.code))

	// ⑥ 修订 / 废止:展示信息可改,语义不可;废止黏性且挡住新断言
	check('修订展示信息 → 通过', (await call('ReviseTerm', { id: 'furnace_batch', gloss: '一次熔铸循环(含熔炼与铸造)', reason: '把释义写全' })).ok === true)
	const revised = thisHost.service.state(SESSION).lexicon.terms.find((item) => item.id === 'furnace_batch')
	check('修订只动展示信息:版本 +1,父链不动', revised.version === 2 && (revised.parent ?? null) === null)
	check('废止概念 → 通过(记录保留)', (await call('DeprecateTerm', { id: 'narrow_batch', reason: '与父概念无法区分' })).ok === true)
	check('废止是黏性终态:第二次不记账', (await call('DeprecateTerm', { id: 'narrow_batch', reason: 'again' })).code === 'already_deprecated')
	await call('RegisterInstance', { id: 'B2', type: 'narrow_batch', label: 'B2 炉次', basis: '化验单 L-09', provenance: { kind: 'named', ref: '化验单 L-09' } })
	const useDeprecated = await call('SetGoal', {
		claim: 'C3', done_criteria: 'D3 可核对',
		hypotheses: [{ claim: 'h3', refute_when: 'r3', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'B2', type: 'narrow_batch' }, object: { kind: 'quantity', value: 9, unit: 'ppm' } }] }],
	})
	check('引用已废止概念的新断言 → 拒', useDeprecated.ok === false && /deprecated/.test(String(useDeprecated.message)))

	// ⑦ 词汇货架是系统所有:做的人写不进
	const preExecuteShelf = thisHost.listeners.get('tools/pre-execute')
	const forgedShelf = await preExecuteShelf(
		{ name: 'write', arguments: { file_path: join(WORKSPACE, 'clear/ontology/domain.md'), content: '我宣布这就是词汇' }, agent: { id: SESSION }, callId: 'c-forge-shelf' },
		async () => ({ kind: 'allow' }),
	)
	check('直接写词汇货架 → 拒(词条只能经动词落账)', forgedShelf.kind === 'deny' && /clear\/ontology/.test(String(forgedShelf.reason)), String(forgedShelf.kind))
}

console.log('\n【跳级要看得见(但不必许可):从没被走过的等级是一条派生读数】')
{
	/**
	 * 等级衡量的是「这条结论有多大程度只能靠信任做的人」,逐级上升的补偿是独立裁决与人放行。
	 * 「直接在 L3 上交付、L0–L2 从没走过」本身**不是违规**——首次测量没有廉价路可走;
	 * 但它必须看得见,与「假设从没被证据碰过」记成 `unjudged` 是同一条先例。
	 * 这里刻意**不设闸门、不加必填字段**:「为什么没走便宜的路」是不可校验的领域判断,
	 * 强制它只会造一个看起来像机制、其实核不了的字段。
	 */
	const base = {
		...emptyState(),
		hypotheses: [{ id: 'h-1', claim: 'X 比 Y 快', refute_when: 'Y 更快', status: 'alive' }],
		plans: [{ id: 'p-1', status: 'active', steps: [{ id: 's1', ordinal: 1, do: '直接测', status: 'advanced', tests: { hypothesis: 'h-1', level: 'L3' }, artifacts: [], done_criteria: '有读数' }] }],
	}
	const l3Only = { ...base, evidence: [{ id: 'e-1', plan: 'p-1', step: 's1', verdict: 'support', level: 'L3', refs: [], evaluator: 'independent', basis: '均值差 6.2' }] }
	check('只在 L3 上交过 ⇒ 如实列出 L0/L1/L2 从没走过', JSON.stringify(derive(l3Only).hypotheses[0].untouchedLevels) === JSON.stringify(['L0', 'L1', 'L2']), JSON.stringify(derive(l3Only).hypotheses[0].untouchedLevels))
	check('运行态卡里说得出这件事(模型据此交代「为什么更便宜的路不通」)', /未走过 L0\/L1\/L2/.test(renderCard(l3Only)), renderCard(l3Only).split('\n').find((line) => line.includes('未走过')) ?? '(卡片里没有这一行)')
	const withL0 = { ...base, evidence: [...l3Only.evidence, { id: 'e-0', plan: 'p-1', step: 's1', verdict: 'support', level: 'L0', refs: [], evaluator: 'self', basis: '量纲检查' }] }
	check('走过 L0 之后,读数只剩真正没走过的那些', JSON.stringify(derive(withL0).hypotheses[0].untouchedLevels) === JSON.stringify(['L1', 'L2']), JSON.stringify(derive(withL0).hypotheses[0].untouchedLevels))
	check('一条证据都没有的假设不报这个读数(还没有声明可谈)', (derive(base).hypotheses[0].untouchedLevels ?? []).length === 0)
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
	await callOn(host, S, 'SetGoal', { claim: '判断 X 是否成立', done_criteria: '拿到裁决', hypotheses: [{ claim: 'X 成立', refute_when: 'X 不成立' }] })
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
	check('收件箱里出现等人处置的那条门(升级给人的路是已有的那条)', host.service.view(S).inbox.some((item) => item.kind === 'plan_blocked'), JSON.stringify(host.service.view(S).inbox.map((item) => item.kind)))
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
	await callOn(host, S, 'SetGoal', { claim: '判断 X 是否成立', done_criteria: '拿到一条裁决', hypotheses: [{ claim: 'X 成立', refute_when: 'X 不成立' }] })
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
	await callOn(host, S, 'SetGoal', { claim: '紧凑与缩进哪种 JSON 更小', done_criteria: 'lab/winner.txt 存在', hypotheses: [{ claim: '紧凑更小', refute_when: '紧凑不小于缩进' }, { claim: '缩进更小', refute_when: '缩进不小于紧凑' }] })
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
	check('检验两条只给了一条结果 ⇒ 拒,并点名缺哪条', missing.ok === false && missing.code === 'results_required' && missing.message.includes(pretty), missing.message.slice(0, 120))
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
	await callOn(host, S, 'SetGoal', { claim: 'Q', headline: 'Q', done_criteria: 'lab/q.txt 存在', hypotheses: [{ claim: 'A', refute_when: 'not A' }, { claim: 'B', refute_when: 'not B' }] })
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'q1', do: '写 q', artifacts: ['lab/q.txt'], done_criteria: 'lab/q.txt 存在', tests: { hypotheses: [host.service.state(S).hypotheses[0].id], level: 'L3' } }] })
	write('lab/q.txt', 'q\n')
	host.nextVerdictText = '## 评估卡\n\n**holds: no**\n\n**basis**: lab/q.txt 只有一个字母,判据要的读数没有。'
	const refused = await callOn(host, S, 'AdvancePlan', { step_id: 'q1' })
	host.nextVerdictText = undefined
	check('正文里写的是 holds: no ⇒ 读成交付不成立', refused.ok === false && refused.code === 'delivery_not_holding' && host.journal.filter((m) => m.t === 'audit/settled').at(-1)?.holds === 'no', `${refused.code}`)
}

console.log('\n【事实撤回:推翻证据只标记,撤不撤由人定】')
{
	/**
	 * 设计里这一层是「新证据只**标记**事实并起一条收件箱条目;人决定撤回,或判证据不可靠、
	 * 维持原事实」。此前 `retracted` 只有声明、没有生产者(而文档还说 ontology 声明了它,
	 * 实际并没有)。这里钉:门起得来、两个结局都能落地、撤回让假设状态跟着变且黏住、审过门就消失。
	 */
	const base = {
		...emptyState(),
		hypotheses: [{ id: 'h-1', claim: 'X 比 Y 快', refute_when: 'Y 更快', status: 'confirmed' }],
		plans: [{ id: 'p-1', status: 'active', steps: [{ id: 's1', ordinal: 1, do: '测两条', status: 'advanced', tests: { hypothesis: 'h-1', level: 'L3' }, artifacts: [], done_criteria: '有读数' }] }],
		evidence: [{ id: 'e-1', plan: 'p-1', step: 's1', verdict: 'refute', level: 'L3', refs: [], evaluator: 'independent', basis: '三次重复里 Y 更快' }],
		facts: [{ id: 'fct-1', goal: 'g-1', text: 'X 比 Y 快', scope: 'Y 更快则作废', level: 'L3', evidence: ['e-1'], path: null, at: 1 }],
	}
	const gateMessage = (action, extra = {}) => ({
		id: `m-${action}-${Math.random().toString(36).slice(2, 6)}`,
		role: 'user',
		content: [{ type: 'text', text: `${HUMAN_GATE_MARK} ${JSON.stringify({ action, plan: null, fork: null, branch: null, skill: null, value: 'fct-1', note: null, ...extra })}` }],
		source: { kind: 'user' },
	})
	const opened = derive(base)
	check('被推翻的事实起一道门,要人决定撤不撤(设计里的正门)', opened.inbox.some((item) => item.kind === 'fact_refutation' && item.value === 'fct-1' && item.human_action === 'retract_fact'), JSON.stringify(opened.inbox.map((item) => item.kind)))
	check('事实那一行同时给出「被推翻」这个派生读数', view(base).facts[0].refuted === true)
	const retracted = applyEvent(base, { type: 'user/message', time: 2, data: gateMessage('retract_fact', { note: '外部数据更正' }) })
	check('撤回落账:事实带上人的审查决定与缘由', view(retracted).facts[0].review.decision === 'retracted' && view(retracted).facts[0].review.reason === '外部数据更正', JSON.stringify(view(retracted).facts[0].review))
	check('假设状态跟着变 retracted(人的裁决落在事实那一侧)', derive(retracted).hypotheses[0].status === 'retracted')
	check('撤过之后那道门消失(状态锚:条目自然消失,不留僵尸)', !derive(retracted).inbox.some((item) => item.kind === 'fact_refutation'))
	const kept = applyEvent(base, { type: 'user/message', time: 3, data: gateMessage('keep_fact', { note: '样本量太小' }) })
	check('「维持原事实」同样落账——没决定与决定维持必须分得开,否则系统会一直等', view(kept).facts[0].review.decision === 'kept' && !derive(kept).inbox.some((item) => item.kind === 'fact_refutation'))
	/**
	 * 「维持」判的是**证据可不可靠**,不是改写证据:账本里那条推翻裁决仍在,所以假设照样算
	 * `refuted`,而事实留在货架上。两处不一致正是这条记录要存在的原因(它写着谁、什么时候、
	 * 为什么判它不可靠)——把假设也一起改回 confirmed 才是编。
	 */
	check('维持不动证据:假设仍由证据算 refuted,而事实留在货架上', derive(kept).hypotheses[0].status === 'refuted' && view(kept).facts[0].review.decision === 'kept')
	check('第一次决定为准(再审不改写)', view(applyEvent(retracted, { type: 'user/message', time: 4, data: gateMessage('keep_fact') })).facts[0].review.decision === 'retracted')

	// 货架:模型读的那一面也要写上这次复核(不写,下一轮它会照旧引用一条已作废的事实)
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-fact-review'
	write('clear/knowledge/facts/g-1.md', '## fct-1 · X 比 Y 快\n')
	host.states.set(S, { ...emptyState(), facts: [{ id: 'fct-1', goal: 'g-1', text: 'X 比 Y 快', scope: null, level: 'L3', evidence: [], path: null, at: 1 }] })
	await preStep(host, S, 2, [gateMessage('retract_fact', { note: '外部数据更正' })])
	const file = readFileSync(join(WORKSPACE, 'clear/knowledge/facts/g-1.md'), 'utf8')
	check('撤回记录写进那份事实文件(追加,不删旧行)', /撤回记录/.test(file) && /fct-1/.test(file) && /外部数据更正/.test(file), file.slice(-220))
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

console.log('\n【实体两件与跳级理由:新机制必须有行为证据,不是只有声明】')
{
	const host = makeHost()
	apply(host.ctx, {})
	const S = 'session-entity'

	// ① 概念先立起来(实例要有 type)。
	const term = await callOn(host, S, 'RegisterTerm', { id: 'sucai', label: '素材', gloss: '被挪用的原始材料', basis: '测试用' })
	check('前置:概念登记成功', term.ok === true, String(term.code))
	const pred = await callOn(host, S, 'RegisterPredicate', { id: 'cheng_wei', label: '被称为', gloss: '某材料曾被称为某概念', range: { term: 'sucai' }, basis: '测试用' })
	check('前置:谓词登记成功', pred.ok === true, String(pred.code))

	// ② 实例:出处必填、type 必须是已登记概念。
	const noProv = await callOn(host, S, 'RegisterInstance', { id: 'yangben_a', type: 'sucai', label: '样本甲', basis: '语料 p01' })
	check('实例没有出处 → 拒(实例是观测,不是约定)', noProv.ok === false && noProv.code === 'instance_provenance_required', String(noProv.code))
	const badType = await callOn(host, S, 'RegisterInstance', { id: 'yangben_a', type: 'meiyou_zhege', label: '样本甲', basis: '语料 p01', provenance: { kind: 'named', ref: '语料 p01' } })
	check('实例的类型不是已登记概念 → 拒', badType.ok === false && badType.code === 'instance_type_unknown', String(badType.code))
	const inst = await callOn(host, S, 'RegisterInstance', { id: 'yangben_a', type: 'sucai', label: '样本甲', basis: '语料 p01', provenance: { kind: 'named', ref: '语料 p01' } })
	check('实例登记成功(带出处)', inst.ok === true && inst.code === 'instance_registered', String(inst.code))
	check('实例登记真的落进了账本', host.journal.filter((m) => m.t === 'entity/registered').length === 1, JSON.stringify(host.journal.filter((m) => m.t === 'entity/registered').length))

	// ③ 断言:主体必须已登记;未登记 → 拒;登记 → 落边。
	const ghost = await callOn(host, S, 'Assert', { subject: { id: 'yangben_b', type: 'sucai' }, predicate: 'cheng_wei', object: { kind: 'instance', value: 'chouxiang', type: 'sucai' }, evidence: { kind: 'named', ref: '语料 p02' } })
	check('断言主体没登记过 → 拒(主词可指认是能被复核的前提)', ghost.ok === false && ghost.code === 'assert_subject_not_registered', String(ghost.code))
	const noEvidence = await callOn(host, S, 'Assert', { subject: { id: 'yangben_a', type: 'sucai' }, predicate: 'cheng_wei', object: { kind: 'instance', value: 'chouxiang', type: 'sucai' }, evidence: { kind: 'named', ref: '' } })
	check('断言没有出处 → 拒(没有出处的话是意见,不是观测)', noEvidence.ok === false && noEvidence.code === 'assert_evidence_required', String(noEvidence.code))
	const asserted = await callOn(host, S, 'Assert', { subject: { id: 'yangben_a', type: 'sucai' }, predicate: 'cheng_wei', object: { kind: 'instance', value: 'chouxiang', type: 'sucai' }, evidence: { kind: 'named', ref: '语料 p02' } })
	check('断言落账(带出处即成立,不等目标裁决)', asserted.ok === true && asserted.code === 'entity_asserted', String(asserted.code))
	check('实体断言真的落进了账本(边在登记那一刻成立)', host.journal.filter((m) => m.t === 'entity/asserted').length === 1, JSON.stringify(host.journal.filter((m) => m.t === 'entity/asserted').length))

	// ④ 跳级理由:levels 必须是"未走过"的,理由必须点到对象名。
	const goal = await callOn(host, S, 'SetGoal', {
		claim: '样本甲能不能被判为抽象',
		headline: '样本甲能不能被判为抽象',
		done_criteria: '存在一份判定记录,并列出 1 个反例',
		hypotheses: [{ claim: '样本甲属于抽象', refute_when: '出现反例', assertions: [{ predicate: 'cheng_wei', subject: { id: 'yangben_a', type: 'sucai' }, object: { kind: 'instance', value: 'chouxiang', type: 'sucai' } }] }],
	})
	check('前置:目标立起(带 headline)', goal.ok === true, String(goal.code))
	/**
	 * `untouchedLevels` 只在「已经用到过某一级」之后才有意义(没走过任何等级时它是空的,
	 * 那是"还没有声明可谈",不是缺口)。所以这里先交付一个 L3 步——真实运行里也是这条路径。
	 */
	const hypId = host.service.derive(S).hypotheses[0]?.id ?? null
	const plan = await callOn(host, S, 'CreatePlan', { steps: [{ id: 'v1', do: '跑一遍并落读数', done_criteria: 'lab/gate-a/read.txt 存在,含 1 个读数', artifacts: ['lab/gate-a/read.txt'], tests: { hypothesis: hypId, level: 'L2' } }] })
	check('前置:计划建起来', plan.ok === true, String(plan.code))
	writeText(join(WORKSPACE, 'lab/gate-a/read.txt'), 'count=1\n')
	const delivered = await callOn(host, S, 'AdvancePlan', { observations: [{ ref: 'lab/gate-a/read.txt', note: '读数 count=1' }], verdict: 'support', basis: 'lab/gate-a/read.txt 里有 count=1 这一个读数', step_id: 'v1' })
	check('前置:L2 步交付成功(于是"已用到 L2、L0–L1 没走过"这件事才存在)', delivered.ok === true, String(delivered.code ?? JSON.stringify(Object.keys(delivered))))
	const derived = host.service.derive(S)
	const hyp = derived.hypotheses.find((item) => Array.isArray(item.untouchedLevels) && item.untouchedLevels.length > 0) ?? null
	if (hyp === null) {
		check('前置:存在一条"有未走过等级"的命题(否则下面的断言是空跑)', false, JSON.stringify(derived.hypotheses.map((item) => item.untouchedLevels)))
	} else {
		const wrongLevel = await callOn(host, S, 'ExplainLevelSkip', { hypothesis: hyp.id, levels: ['L4'], reason: '这一级要检查的对象是 L4 要人放行,本项目没有外部仪器读数' })
		check('给"已走过"的等级写理由 → 拒', wrongLevel.ok === false && wrongLevel.code === 'levels_not_untouched', String(wrongLevel.code))
		const vague = await callOn(host, S, 'ExplainLevelSkip', { hypothesis: hyp.id, levels: hyp.untouchedLevels, reason: '这一层的检查在本项目里不适用,没必要为它单独花一次检查的时间' })
		check('理由够长但不点对象名 → 拒(一句"不适用"过不了门)', vague.ok === false && vague.code === 'skip_reason_missing_object', String(vague.code))
		const shortReason = await callOn(host, S, 'ExplainLevelSkip', { hypothesis: hyp.id, levels: hyp.untouchedLevels, reason: '时间不够' })
		check('理由太短 → 拒', shortReason.ok === false && shortReason.code === 'skip_reason_too_short', String(shortReason.code))
		const ok = await callOn(host, S, 'ExplainLevelSkip', { hypothesis: hyp.id, levels: hyp.untouchedLevels, reason: `这一级要检查的对象是 ${hyp.assertions?.[0]?.object?.value ?? '样本甲'}:它的来源正当性在本项目里没有可比的对照材料,所以这一层的检查不适用` })
		check('写明对象名 → 落账', ok.ok === true && ok.code === 'level_skip_recorded', String(ok.code))
		check('跳级理由真的折进账本', host.journal.filter((m) => m.t === 'level/skipped').length === 1, JSON.stringify(host.journal.filter((m) => m.t === 'level/skipped').length))
		const after = host.service.derive(S).hypotheses.find((item) => item.id === hyp.id)
		check('写完理由后 untouchedLevels 少掉那几层(缺口真的消失)', after === undefined || (after.untouchedLevels ?? []).length === 0, JSON.stringify(after?.untouchedLevels))
	}

	// ⑤ 一句话目标:超 120 字当场拒。
	const long = await callOn(host, 'session-long', 'SetGoal', { claim: '长'.repeat(200), done_criteria: '有 1 份产物' })
	check('目标一句话超 120 字 → 拒(headline 现算也一样拒)', long.ok === false && long.code === 'headline_too_long', String(long.code))
}

console.log('\n【同态结案:状态没变就不重复花钱请裁决】')
{
	const host = makeHost()
	apply(host.ctx, {})
	const S = 'session-reuse'
	host.nextVerdict = { verdict: 'support', basis: '判据逐条对上了', shortfalls: [] }
	const goal = await callOn(host, S, 'SetGoal', {
		claim: '同态结案会不会重复派评估者',
		headline: '同态结案会不会重复派评估者',
		done_criteria: '存在一份读数,且结论明确',
		hypotheses: [{ claim: '状态不变时不该重派', refute_when: '观察到第二次派遣' }],
	})
	check('前置:目标立起', goal.ok === true, String(goal.code))
	const first = await callOn(host, S, 'CloseGoal', { outcome: 'achieved' })
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
	const second = await callOn(host, S, 'CloseGoal', { outcome: 'achieved' })
	check('第二次结案仍然成功(复用旧裁决)', second.ok === true, String(second.code))
	check('状态没变 ⇒ 不重复派遣(评估者仍然只有 1 个)', evaluators() === 1, String(evaluators()))
	check('账上如实留下「这次没花钱」这条事实', host.journal.some((mutation) => mutation.t === 'audit/reused'), JSON.stringify(host.journal.filter((m) => String(m.t).startsWith('audit/')).map((m) => m.t)))
}

console.log('\n【两道新门:实体未落账 / 跳级无理由,结案时真的会被挡】')
{
	/**
	 * 门是**机制**:同一份状态,开门就拒、关门就放。所以这里同时跑两个宿主,
	 * 配置只差那两个键——结论因此不可能来自别处的差别。
	 */
	const build = async (host) => {
		const S = 'session-gate'
		host.nextVerdict = { verdict: 'support', basis: '判据逐条对上了', shortfalls: [] }
		await callOn(host, S, 'RegisterTerm', { id: 'sucai', label: '素材', gloss: '被挪用的原始材料', basis: '测试用' })
		await callOn(host, S, 'RegisterPredicate', { id: 'cheng_wei', label: '被称为', gloss: '某材料曾被称为某概念', range: { term: 'sucai' }, basis: '测试用' })
		// 实例先登记(契约要求主体可指认);但关于它的那句话**只挂在命题上** ⇒ 图上有节点、没有边。
		await callOn(host, S, 'RegisterInstance', { id: 'yangben_x', type: 'sucai', label: '样本X', basis: '语料 p99', provenance: { kind: 'named', ref: '语料 p99' } })
		const goal = await callOn(host, S, 'SetGoal', {
			claim: '未落账的实体主体会不会挡住结案',
			headline: '未落账的实体主体会不会挡住结案',
			done_criteria: '存在一份读数,含 1 个结论',
			hypotheses: [{ claim: '主体没登记就该被挡', refute_when: '结案通过', assertions: [{ predicate: 'cheng_wei', subject: { id: 'yangben_x', type: 'sucai' }, object: { kind: 'instance', value: 'chouxiang', type: 'sucai' } }] }],
		})
		check('前置:目标立起(断言主体 yangben_x 还没登记)', goal.ok === true, String(goal.code))
		return S
	}

	const gated = makeHost()
	apply(gated.ctx, { requireLandedEntities: true, requireLevelReasons: true, minHypotheses: 0 })
	const S1 = await build(gated)
	const blocked = await callOn(gated, S1, 'CloseGoal', { outcome: 'achieved' })
	check('实体没落账 ⇒ 结案被挡(entities_unlanded)', blocked.ok === false && blocked.code === 'entities_unlanded', String(blocked.code))
	check('挡下来的话里给了下一步(不是一句"不行")', /RegisterInstance|Assert/.test(String(blocked.message ?? '')), String(blocked.message ?? '').slice(0, 120))
	/**
	 * 出口是 `Assert`(把这句话连出处落成边),**不是**再登记一个节点——
	 * 这正是这道门要逼出来的那个动作。
	 */
	const asserted = await callOn(gated, S1, 'Assert', { subject: { id: 'yangben_x', type: 'sucai' }, predicate: 'cheng_wei', object: { kind: 'instance', value: 'chouxiang', type: 'sucai' }, evidence: { kind: 'named', ref: '语料 p99' } })
	check('前置:用 Assert 把这句话落成边', asserted.ok === true, String(asserted.code))
	const next = await callOn(gated, S1, 'CloseGoal', { outcome: 'achieved' })
	check('断言落到图上之后不再因为这道门被挡(换一道或通过)', next.code !== 'entities_unlanded', String(next.code))

	const free = makeHost()
	apply(free.ctx, { minHypotheses: 0 })
	const S2 = await build(free)
	const passed = await callOn(free, S2, 'CloseGoal', { outcome: 'achieved' })
	check('同一份状态、门关着 ⇒ 不挡(门是机制,不是文案)', passed.code !== 'entities_unlanded', String(passed.code))

	/**
	 * 第二道门:`levels_skipped`。构造"已用到 L2、L0/L1 从没走过"的状态——
	 * 那正是真实运行里 4/4 命题的读数形态。门开则拒,理由是"跳级要写理由"。
	 */
	const skipHost = makeHost()
	apply(skipHost.ctx, { requireLandedEntities: true, requireLevelReasons: true, minHypotheses: 0 })
	const S3 = 'session-skip-gate'
	skipHost.nextVerdict = { verdict: 'support', basis: '判据逐条对上了', shortfalls: [] }
	const g3 = await callOn(skipHost, S3, 'SetGoal', {
		claim: '跳级没写理由会不会挡住结案',
		headline: '跳级没写理由会不会挡住结案',
		done_criteria: '存在一份读数,含 1 个结论',
		hypotheses: [{ claim: '没写理由就该被挡', refute_when: '结案通过' }],
	})
	check('前置:skip 门的目标立起', g3.ok === true, String(g3.code))
	const h3 = skipHost.service.derive(S3).hypotheses[0]?.id ?? null
	await callOn(skipHost, S3, 'CreatePlan', { steps: [{ id: 'v1', do: '跑一遍并落读数', done_criteria: 'lab/gate-b/skip.txt 存在,含 1 个读数', artifacts: ['lab/gate-b/skip.txt'], tests: { hypothesis: h3, level: 'L2' } }] })
	writeText(join(WORKSPACE, 'lab/gate-b/skip.txt'), 'count=1\n')
	const d3 = await callOn(skipHost, S3, 'AdvancePlan', { observations: [{ ref: 'lab/gate-b/skip.txt', note: '读数 count=1' }], verdict: 'support', basis: 'lab/gate-b/skip.txt 里有 count=1 这一个读数', step_id: 'v1' })
	check('前置:L2 步交付(于是 L0/L1 是"没走过")', d3.ok === true, String(d3.code))
	await callOn(skipHost, S3, 'ClosePlan', { summary: '这一阶段的读数已经拿到了' })
	const skipBlocked = await callOn(skipHost, S3, 'CloseGoal', { outcome: 'achieved' })
	check('跳级没理由 ⇒ 结案被挡(levels_skipped)', skipBlocked.ok === false && skipBlocked.code === 'levels_skipped', String(skipBlocked.code))
	const skipOk = await callOn(skipHost, S3, 'ExplainLevelSkip', { hypothesis: h3, levels: skipHost.service.derive(S3).hypotheses[0]?.untouchedLevels ?? [], reason: '这一层的检查在本项目里没有可比对照材料,所以不适用' })
	check('写明理由后可以继续(出口是通的)', skipOk.ok === true, String(skipOk.code))
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
	const set = await callOn(host, S, 'SetGoal', {
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

	const noVerdict = await callOn(host, S, 'SetGoal', { claim: '改判据要不要独立裁决', headline: '改判据要不要独立裁决', done_criteria: '存在一份读数,含 2 个结论', reason: '判据口径放宽' })
	check('不带 criteria_verdict 改判据 → 拒', noVerdict.ok === false && noVerdict.code === 'criteria_verdict_required', String(noVerdict.code))
	const badVerdict = await callOn(host, S, 'SetGoal', { claim: '改判据要不要独立裁决', headline: '改判据要不要独立裁决', done_criteria: '存在一份读数,含 2 个结论', reason: '判据口径放宽', criteria_verdict: 'a-不存在' })
	check('带一个账上没有的 auditKey → 拒', badVerdict.ok === false && badVerdict.code === 'criteria_verdict_unknown', String(badVerdict.code))

	// 成功路径:这一条以前会抛 ReferenceError。
	let revision = null
	try {
		revision = await callOn(host, S, 'SetGoal', { claim: '改判据要不要独立裁决', headline: '改判据要不要独立裁决', done_criteria: '存在一份读数,含 2 个结论', criteria: ['存在一份读数,含 2 个结论'], criteria_note: '把口径从 1 个结论放宽到 2 个', reason: '判据口径放宽', criteria_verdict: auditId })
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
	const set = await callOn(host, S, 'SetGoal', { claim: '卡会不会把判据全文反复灌进来', headline: '卡会不会把判据全文反复灌进来', done_criteria: long, hypotheses: [] })
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
	await callOn(host, S, 'SetGoal', { claim: '宿主降级会不会进账本', headline: '宿主降级会不会进账本', done_criteria: '存在 1 条 host/inactive 事实', hypotheses: [] })
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
	await callOn(h2, S2, 'SetGoal', { claim: '同一步重交会不会重烧评估者', headline: '同一步重交会不会重烧评估者', done_criteria: 'lab/r.txt 存在,含 1 个读数', hypotheses: [{ claim: '材料不变就别重烧', refute_when: '观察到第二次派遣' }] })
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
	await callOn(host, S, 'SetGoal', { claim: '只写正文的裁决算不算数', headline: '只写正文的裁决算不算数', done_criteria: '存在 1 份产物,结论明确', hypotheses: [{ claim: '正文卡片也该被读回来', refute_when: '读不回来' }] })
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'p1', do: '落一份产物', artifacts: ['lab/prose.txt'], done_criteria: 'lab/prose.txt 存在且非空', tests: { hypothesis: host.service.state(S).hypotheses[0].id, level: 'L3' } }] })
	write('lab/prose.txt', '读数:0.86\n')
	await callOn(host, S, 'AdvancePlan', { step_id: 'p1' })
	await callOn(host, S, 'ClosePlan', { summary: '这一阶段做完了' })
	// 评估者这次只写正文卡片(结构化通道为空)。
	host.nextVerdictText = ['## 评估卡 · 目标', '', '**verdict: support**', '', '**basis**: 四项判据逐条核对通过,产物与读数一致。', '', '| # | 判据 | 结论 |', '|---|---|---|', '| 1 | 产物存在 | 通过 |'].join('\n')
	const closed = await callOn(host, S, 'CloseGoal', { outcome: 'achieved' })
	check('只写正文卡片的 support 裁决能被读回来 ⇒ 结案', closed.ok === true && closed.code === 'goal_achieved', `${closed.code}:${String(closed.message ?? '').slice(0, 120)}`)
	const settled = host.journal.filter((m) => m.t === 'audit/settled').at(-1) ?? null
	check('落账的裁决是「判据达成」(旧式 verdict: support 读成交付成立),不是「无法解析」', String(settled?.holds) === 'yes', JSON.stringify(settled ?? null))
	check('依据是从正文里取到的那句(不是占位话)', /逐条核对通过/.test(String(settled?.basis ?? '')), String(settled?.basis ?? '').slice(0, 100))

	// 反例:正文里明确写了 refute —— 绝不因为"读不到 JSON"就猜成 support。
	const host2 = makeHost()
	apply(host2.ctx, { minHypotheses: 0 })
	const S2 = 'session-prose-refute'
	await callOn(host2, S2, 'SetGoal', { claim: '正文写 refute 会怎样', headline: '正文写 refute 会怎样', done_criteria: '存在 1 份产物,结论明确', hypotheses: [{ claim: '不该被猜成 support', refute_when: '被判成 support' }] })
	host2.nextVerdictText = '## 评估卡\n\n**verdict: refute**\n\n**basis**: 判据要求三次重复,当前只有一次。'
	const refused = await callOn(host2, S2, 'CloseGoal', { outcome: 'achieved' })
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
	await callOn(host, S, 'SetGoal', { claim: '比较两种做法', done_criteria: '两种做法各有结果文件', hypotheses: [{ claim: '甲更快', refute_when: '甲不比乙快' }, { claim: '乙更快', refute_when: '乙不比甲快' }] })
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
	const amendClash = await callOn(host, S, 'AmendPlan', { step: { id: 'p3', do: '再跑一次甲', artifacts: ['lab/a.md'], done_criteria: 'lab/a.md 写着第二次耗时' } })
	check('补一步时撞上已有步骤的产物 → 也被拒', amendClash.ok === false && /已经由步骤 p1 声明/.test(String(amendClash.message ?? '')), String(amendClash.message ?? amendClash.code).slice(0, 120))
	await callOn(host, S, 'VoidPlanStep', { step_id: 'p1', reason: '甲的环境不可用' })
	const reuse = await callOn(host, S, 'AmendPlan', { step: { id: 'p4', do: '换环境重跑甲', artifacts: ['lab/a.md'], done_criteria: 'lab/a.md 写着新环境下的耗时' } })
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
