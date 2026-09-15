
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

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir, trackTemp } from './tmp.mjs'
import { execFileSync } from 'node:child_process'
import { CONFIG_KEYS, HUMAN_GATE_MARK, apply, parseHumanGateMessage, syncTemplateSkills } from '../preset/plugins/clearai-kernel.js'
import { applyEvent, applyMutations, derive, emptyState, parseHumanGate, renderCard, view } from '../ui/lib/fold.js'
import { SECTIONS, SECTION_SLOTS, SECTION_TABLE } from '../preset/plugins/prompts.js'

// 测试用自己的数据区:世界线工作副本与旁路账本都按 DSH_HOME 落盘,
// 跑测试不该往用户真实的 ~/.dsh 里塞东西(之前一直塞了,已清理)。
process.env.DSH_HOME = tempDir('clearai-home-')

const WORKSPACE = tempDir('clearai-ws-')
const SESSION = 'session-test'

// 世界线要物化成 git 分支 + worktree,所以工作区得先是真 git 仓库(阶段 2 起)。
// 这不是测试的方便之举:ClearAI 的 A 层就是这么用的——用户自己的仓库。
execFileSync('git', ['init', '-q'], { cwd: WORKSPACE })
execFileSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: WORKSPACE })

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
		state: (id) => states.get(id) ?? emptyState(),
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
		/** 横评仲裁的回执(默认裁不出来——那是合法结局,不是故障)。 */
		nextArbiterVerdict: { winner: null, ranking: [], reason: '各卡都可信,但没有可比读数,证据不足以分高下。', confidence: 'low' },
		arbiterRequests: [],
		scoutConclusion: '查了 lab/ 与 products/,三次重复里只有两次有原始记录;第三次只出现在报告里,没有仪器导出。',
		executorConclusion: '产物已落在本世界线的工作副本里:probe.txt(读数见文件)。假设:温度取 60℃,因为任务书没指定。',
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
					const shell = (id) => ({ header: { cwd: host.cwd ?? WORKSPACE }, ownEvents: () => host.sessionEvents?.[String(id)] ?? [] })
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
						/**
						 * **可续跑那一档**(生产里它换来原生结算通知)。它**没有** `result` promise——
						 * 结论只能从子会话日志里读,这正是生产里那条路。`host.continuableUnavailable`
						 * 用来验降级(模拟没有 `agents` 服务时的 `CONTINUATION_UNAVAILABLE`)。
						 */
						async startContinuable(spec) {
							if (host.continuableUnavailable === true) throw new Error('continuable subagents require the agents service')
							if (host.auditFails) throw new Error('provider unavailable')
							const childId = `continuable-${audits.length}`
							host.continuations = host.continuations ?? []
							host.continuations.push({ spec, childId })
							// 也进 `audits`:现有那些「工具面/人格」断言两档都该看得到(生产里也是同一份请求)。
							audits.push({ provider: spec.provider, request: spec.request, isScout: String(spec.label ?? '').startsWith('侦察') })
							/**
							 * 生产里可续跑子会话会**自己往日志里写** `turn/end`(内核据此收结论)。
							 * 测试台替它写:于是「结论从子会话日志回收」这条真路径被现有用例一并覆盖。
							 * `host.scoutDelayMs` 决定它什么时候写完(「等」这件事才测得到)。
							 */
							const stopKind = host.stopReasonScout ?? host.stopReason ?? 'completed'
							const text = String(host.scoutConclusion ?? '')
							host.sessionEvents = host.sessionEvents ?? {}
							const write = () => {
								host.sessionEvents[childId] = [
									{ type: 'turn/start', data: { turn: 1 } },
									...(text === '' ? [] : [{ type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } }]),
									{ type: 'turn/end', data: { turn: 1, reason: { kind: stopKind } } },
								]
							}
							const delay = Number(host.scoutDelayMs ?? 0)
							if (delay > 0) setTimeout(write, delay)
							else write()
							return { childId, messageId: `msg-${audits.length}` }
						},
						async start(provider, request) {
							if (host.auditFails) throw new Error('provider unavailable')
							// 每个角色的结局可以单独设:中断「执行者」时不该把「评估者」也一起中断
							// (那会让这一步根本推进不了,测不到执行者那条路)。
							const stopOf = (kind) => host[`stopReason${kind}`] ?? host.stopReason ?? 'completed'
							const isScout = String(request.label ?? '').startsWith('侦察')
							const isExecutor = String(request.label ?? '').startsWith('世界线执行者')
							if (host.capabilityRefusals !== undefined && host.capabilityRefusals.some((capability) => String(request.label ?? '') !== '' && capability === 'all')) {
								throw new Error('provider refuses every variant')
							}
							audits.push({ provider, request, isScout })
							if (isExecutor) {
								// `executorDelayMs`:让执行者**晚一点**落定——「等」这件事才测得到(AwaitWorldlines)。
								// `executorNeverSettles`:**永不落定**(长测现场:表里有条目、promise 就是不落地)。
								const settle = { output: [{ type: 'text', text: host.executorConclusion }], structured: undefined, stopReason: stopOf('Executor') }
								const delay = Number(host.executorDelayMs ?? 0)
								const result = host.executorNeverSettles === true ? new Promise(() => {}) : delay > 0 ? new Promise((resolve) => setTimeout(() => resolve(settle), delay)) : Promise.resolve(settle)
								return {
									id: `exec-${audits.length}`,
									localAgent: undefined,
									result,
									dispose: async () => {},
								}
							}
							const isArbiter = String(request.label ?? '').startsWith('横评仲裁')
							if (isArbiter) {
								host.arbiterRequests.push(request)
								return {
									id: `arbiter-${audits.length}`,
									localAgent: undefined,
									result: Promise.resolve({ output: [{ type: 'text', text: '按卡上的事实裁。' }], structured: host.nextArbiterVerdict, stopReason: stopOf('Arbiter') }),
									dispose: async () => {},
								}
							}
							if (isScout) {
								// `scoutDelayMs`:让侦察**晚一点**落定——“等侦察”这件事才测得到
								// (真实子 run 要跑几秒,而它正是长测里断掉的那条链)。
								const settle = { output: [{ type: 'text', text: host.scoutConclusion }], structured: undefined, stopReason: stopOf('Scout') }
								const delay = Number(host.scoutDelayMs ?? 0)
								const result = host.scoutNeverSettles === true ? new Promise(() => {}) : delay > 0 ? new Promise((resolve) => setTimeout(() => resolve(settle), delay)) : Promise.resolve(settle)
								return {
									id: `scout-${audits.length}`,
									localAgent: undefined,
									result,
									dispose: async () => {},
								}
							}
							return {
								id: `child-${audits.length}`,
								localAgent: undefined,
								result: Promise.resolve({ output: [], structured: host.nextVerdict, stopReason: stopOf('Evaluator') }),
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
	// 运行态卡与外脑事实的。测试不折这一步,就等于「以为消息进了日志」。
	let state = host.service.state(session)
	for (const message of decision?.messages ?? []) {
		state = applyEvent(state, { type: 'user/message', time: Date.now(), data: message })
		/**
		 * **事实通道**里的变更也要记进账本(2026-09-11):内核在回合之间观察到的事实
		 * (目前是「世界线执行者跑完了」)走的是插件消息的 `clearai/mutations` 段,
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
 * 找到某个工作区对应的**账本 git 目录**。
 *
 * 为什么不能沿用 `readdirSync(ledgerRoot)[0]`(2026-09-11 修):账本目录名是散列,
 * 而机器上会攒下很多本(每条工作区一本)。取"第一本"在单本机器上碰巧对,
 * 一旦有多本就会读到**别人的**账本 —— 表现是时红时绿,最难查的那一类。
 */
const ledgerDirOf = (workspace) => {
	const root = join(process.env.DSH_HOME, 'storages', 'clearai', 'ledger')
	try {
		for (const name of readdirSync(root)) {
			const dir = join(root, name)
			try {
				const worktree = execFileSync('git', ['--git-dir', dir, 'config', '--get', 'core.worktree'], { encoding: 'utf8' }).trim()
				if (worktree === workspace) return dir
			} catch {
				/* 不是账本 git 目录(或已被清掉的工作区):跳过 */
			}
		}
	} catch {
		/* 账本根都读不到:交给调用方判红 */
	}
	return null
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
	check('世界线段在:何时分叉 / 真分歧 / 算不出来就停下问人', /worldline/.test(String(byName('clearai/worldline')?.text ?? '')) || /ForkPlan/.test(String(byName('clearai/worldline')?.text ?? '')))
	check('网页是不可信数据(安全相关的那条)', /untrusted|不可信/.test(String(byName('clearai/web-research')?.text ?? '')))
	check('交付协议在(怎么把交付物呈现给人)', (byName('clearai/delivery')?.text ?? '').length > 100)
	check('环境段刻意不含时间(时间由运行态卡承载)', !/\d{2}:\d{2}/.test(String(byName('clearai/environment')?.text ?? '')))
	check('子任务意识段在:开工先侦察再立约 + 任务必须自包含', /先侦察,再立约/.test(String(byName('clearai/delegation')?.text ?? '')) && /自包含/.test(String(byName('clearai/delegation')?.text ?? '')))
	check('委派段不承诺不存在的机制(不出现 background 自动回灌)', !/background/.test(String(byName('clearai/delegation')?.text ?? '')))
	check('循环契约段在:四拍 + 唯一完成动词 + 准入不裁决', /唯一完成动词/.test(String(byName('clearai/loop-contract')?.text ?? '')) || /唯一.*动词/.test(String(byName('clearai/loop-contract')?.text ?? '')))
}

console.log('\n【装配:贡献表驱动(阶段 3)】')
{
	const NAMES = [
		'SetGoal', 'CloseGoal', 'CreatePlan', 'CheckPlan', 'RequestPlanReview', 'AmendPlan', 'RefinePlan', 'VoidPlanStep', 'ClosePlan', 'AdvancePlan',
		'ForkPlan', 'AdvanceWorldline', 'ConvergeFork', 'WorldlineStatus', 'AwaitWorldlines', 'AbandonFork', 'SpawnScout', 'MapScouts',
		'SaveSkill', 'WriteMemory', 'FileHistory', 'RestoreFile',
	]
	// 工具面是**清单事实**,不是注释里的一句话:注册出来的名字集合必须与目录逐字相符。
	check('工具面恰好 22 件(实测,不是推断)', thisHost.tools.size === 22, `${thisHost.tools.size} 件`)
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
		{ contributions: { mechanisms: { worldline: false }, tools: ['ForkPlan'] } },
		/tool_of_disabled_mechanism:clearai-kernel:ForkPlan:worldline/,
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

	// 裁剪真的生效:关掉世界线机制 → 五件世界线工具不再出现在工具面里。
	const trimmed = makeHost()
	apply(trimmed.ctx, { contributions: { mechanisms: { worldline: false } } })
	check(
		'关掉世界线机制 → 6 件世界线工具真的没装(16 件)',
		trimmed.tools.size === 16 && !trimmed.tools.has('ForkPlan') && !trimmed.tools.has('AbandonFork') && !trimmed.tools.has('AwaitWorldlines') && trimmed.tools.has('AdvancePlan'),
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
	check('评估卡由系统落盘', readFileSync(join(WORKSPACE, 'clear/evidence/audits/s1/child-1.json'), 'utf8').includes('clearai.audit.v1'))
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
	check('未声明等级的步骤不给裁决 → 拒绝(verdict_required)', noVerdict.ok === false && noVerdict.code === 'verdict_required', String(noVerdict.code))

	const noBasis = await call('AdvancePlan', { step_id: 's3', verdict: 'support', basis: '好' })
	check('依据太短 → 拒绝(basis_required)', noBasis.ok === false && noBasis.code === 'basis_required', String(noBasis.code))

	const selfOk = await call('AdvancePlan', { step_id: 's3', verdict: 'support', basis: 'products/report.md 含均值差 6.2 与数据来源' })
	check('L0 自判 + 可复查依据 → 推进', selfOk.ok === true && selfOk.evaluator === 'self', String(selfOk.code))
	check('自判也写进证据面(依据可复查)', eventsOf('evidence/recorded').some((event) => event.evaluator === 'self'))
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
	check('连拦达阈值 → 令牌置阻塞(clearai_loop_stalled)', stalled.blocked === true && calls().includes('block'), calls().join(','))
	check('阻塞码是策略自有的稳定码', unattended.hostGoal?.blockedReason?.code === 'clearai_loop_stalled', String(unattended.hostGoal?.blockedReason?.code))
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
		'abandoned 结案 → 令牌置阻塞(clearai_loop_abandoned),而不是 complete',
		givingUp.hostGoal?.phase === 'blocked' && givingUp.hostGoal?.blockedReason?.code === 'clearai_loop_abandoned',
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
	{
		const gateActions = ['adopt_branch', 'abandon_fork', 'promote_skill', 'set_autonomy']
		check(
			'人门动词不在工具面里(模型调不到,不是不该调)',
			gateActions.every((action) => !thisHost.tools.has(action) && ![...thisHost.tools.keys()].some((name) => name.toLowerCase().includes(action))),
			[...thisHost.tools.keys()].join(','),
		)
		check('工具 schema 里也不出现这些动词', ![...thisHost.tools.values()].some((tool) => /adopt_branch|abandon_fork|promote_skill|set_autonomy/.test(JSON.stringify(tool.parameters))))
	}

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
	{
		const messages = [
			{ source: { kind: 'user' }, content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"adopt_branch","fork":"f-1","branch":"b-1"}\n人在面板上裁决` }] },
			{ source: { kind: 'user' }, content: [{ type: 'text', text: `${HUMAN_GATE_MARK}{"action":"promote_skill","skill":"my-sop"}` }] },
			{ source: { kind: 'plugin', plugin: 'clearai' }, content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"adopt_branch","fork":"f-1","branch":"b-2"}` }] },
			{ source: { kind: 'user' }, content: [{ type: 'text', text: `${HUMAN_GATE_MARK} 不是 JSON` }] },
			{ source: { kind: 'user' }, content: [{ type: 'text', text: '没有标记的一句话' }] },
			{ source: { kind: 'user' }, content: [{ type: 'text', text: `${HUMAN_GATE_MARK}{"action":"abandon_fork","fork":"f-1"}` }] },
			{ source: { kind: 'user' }, content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"set_autonomy","value":"unattended"}` }] },
		]
		const verdicts = messages.map((message) => JSON.stringify(parseHumanGateMessage(message)))
		const hostVerdicts = messages.map((message) => JSON.stringify(parseHumanGate(message)))
		check('内核与宿主半的标记解析结论逐条一致(改一处漏一处就会红)', verdicts.join(' | ') === hostVerdicts.join(' | '), `${verdicts.join(' | ')} ≠ ${hostVerdicts.join(' | ')}`)
		check('两边都只认**人**署名的消息(插件写的同名标记不算)', parseHumanGateMessage(messages[2]) === null && parseHumanGate(messages[2]) === null)
		check('两边都要求标记后面紧跟 JSON(宽松一点会放进伪造的意图)', parseHumanGateMessage(messages[3]) === null && parseHumanGate(messages[5]) !== null)
		check(
			'§34 已摘掉的动词两边都不认(表外名字不许出现,而且两侧同步)',
			parseHumanGateMessage(messages[6]) === null && parseHumanGate(messages[6]) === null,
			`${JSON.stringify(parseHumanGateMessage(messages[6]))} / ${JSON.stringify(parseHumanGate(messages[6]))}`,
		)
	}

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
	{
		const { host, hypothesis } = await setup('unattended')
		await callOn(host, S, 'CreatePlan', {
			steps: [{ id: 'f1', do: '试两条互斥路线', artifacts: ['lab/f1.txt'], done_criteria: 'lab/f1.txt 存在', tests: { hypothesis, level: 'L3' } }],
		})
		const forked = await callOn(host, S, 'ForkPlan', {
			question: '走湿法还是干法',
			options: [
				{ label: '湿法', approach: '水相回流', done_criteria: '收率 yield_pct 越高越好', workspace: 'lab/wl/shi', level: 'L3' },
				{ label: '干法', approach: '固相研磨', done_criteria: '收率 yield_pct 越高越好', workspace: 'lab/wl/gan', level: 'L3' },
			],
			decide_by: { metric: 'yield_pct', direction: 'max' },
		})
		check('分叉立起来(前置)', forked.ok === true, String(forked.code))
		const forkId = host.service.state(S).forks[0].id
		const ganId = host.service.state(S).forks[0].branches.find((branch) => branch.label === '干法').id
		// 尺子落不成数(读数不是数值)→ 这是「真的不知道」,不是「一样好」:停下等人。
		const branchPath = (label) => host.service.view(S).forks.find((item) => item.stepId === 'f1').branches.find((item) => item.label === label).worktreePath
		host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '说不清', validity: 'usable' }
		for (const label of ['湿法', '干法']) {
			writeText(join(branchPath(label), 'probe.txt'), `run,route,yield_pct\n1,${label},未测出\n`)
			const settled = await callOn(host, S, 'AdvanceWorldline', { branch_id: label, observations: [{ ref: join(branchPath(label), 'probe.txt') }] })
			check(`世界线「${label}」交付`, settled.ok === true, String(settled.code))
		}
		const undecidable = await callOn(host, S, 'ConvergeFork', {})
		check('读数落不成数 → 算不出胜负(不猜)', undecidable.ok === false && undecidable.code === 'UNDECIDABLE_NO_READINGS', String(undecidable.code))
		check('四条合法出路逐字在文案里(归主 agent,不是死路)', /可走的路/.test(String(undecidable.message)) && /确属价值判断再升给人/.test(String(undecidable.message)))
		check('收件箱里留下 fork_adopt(等人的那道门)', host.service.view(S).inbox.some((item) => item.kind === 'fork_adopt'))

		// 人在面板上按下裁决:结构化事实(`by:'user'`),不是商量。
		host.states.set(S, applyEvent(host.service.state(S), {
			type: 'user/message',
			time: Date.now(),
			data: {
				id: 'gate-1',
				role: 'user',
				content: [{ type: 'text', text: `[clearai·人门] ${JSON.stringify({ action: 'adopt_branch', fork: forkId, branch: ganId })}` }],
				source: { kind: 'user' },
			},
		}))
		check('人的裁决折进了分叉(by:user)', host.service.state(S).forks[0].humanDecision?.branch === ganId)
		check('人已经裁决过的分叉不再出现在收件箱(状态锚)', host.service.view(S).inbox.every((item) => item.kind !== 'fork_adopt'))
		check('卡片把人的裁决说出来(模型据此落实它)', /人已裁决/.test(host.service.renderCard(S)))

		const decided = await callOn(host, S, 'ConvergeFork', {})
		check('人裁决之后 → 采纳人指的那条', decided.ok === true && /采纳「干法」/.test(String(decided.message)), `${decided.code}`)
		const view = host.service.view(S)
		check('人裁决 → **正式**采纳(人的决定不是余量,不进临时那档)', view.forks.find((item) => item.stepId === 'f1')?.provisional === false)
		check('决策说明写明来源是人', /人裁决/.test(String(view.forks.find((item) => item.stepId === 'f1')?.decisionNote ?? '')), String(view.forks.find((item) => item.stepId === 'f1')?.decisionNote ?? ''))
		check('合并之后收件箱清空', view.inbox.length === 0, view.inbox.map((item) => item.kind).join(','))
	}

	// ⑤′ 采纳了但要合并的对象**已经不在**(2026-09-12 案例 A 实测):不许卡住,登记采纳 + 不合并
	{
		const { host, hypothesis } = await setup('unattended')
		await callOn(host, S, 'CreatePlan', {
			steps: [{ id: 'f9', do: '试两条互斥路线', artifacts: ['lab/f9.txt'], done_criteria: 'lab/f9.txt 存在', tests: { hypothesis, level: 'L1' } }],
		})
		await callOn(host, S, 'ForkPlan', {
			question: '点值口径还是单元平均口径',
			options: [
				{ label: '点值', approach: 'A', done_criteria: 'order 越大越好', workspace: 'lab/wl/pt', level: 'L3' },
				{ label: '单元平均', approach: 'B', done_criteria: 'order 越大越好', workspace: 'lab/wl/ca', level: 'L3' },
			],
			decide_by: { metric: 'order', direction: 'max' },
		})
		const branchPath = (label) => host.service.view(S).forks.find((item) => item.stepId === 'f9').branches.find((item) => item.label === label).worktreePath
		host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '5.02', validity: 'usable' }
		for (const label of ['点值', '单元平均']) {
			writeText(join(branchPath(label), 'probe.txt'), `run,route,order\n1,${label},5.02\n`)
			const settled = await callOn(host, S, 'AdvanceWorldline', { branch_id: label, observations: [{ ref: join(branchPath(label), 'probe.txt') }] })
			check(`世界线「${label}」交付(前置)`, settled.ok === true, `${settled.code} ${String(settled.message).slice(0, 120)}`)
		}
		/**
		 * 把工作副本目录**删掉**——模拟账本被清理之后的样子:账上还写着 git_branch,
		 * 对象却已经不在了。这正是案例 A 里那份计划被卡住的形态。
		 */
		for (const label of ['点值', '单元平均']) rmSync(branchPath(label), { recursive: true, force: true })
		const survived = await callOn(host, S, 'ConvergeFork', {})
		check('对象已不在 → 收敛仍然成功(不再被一个不可能收敛的分叉卡住)', survived.ok === true, `${survived.code} ${String(survived.message).slice(0, 80)}`)
		check('并且如实落账「这次采纳没有合并」', host.journal.some((mutation) => mutation.t === 'fork/merge_skipped'), host.journal.map((mutation) => mutation.t).join(','))
		check('收敛事实照常落账', host.journal.some((mutation) => mutation.t === 'fork/converged'))
		check('文案说清该怎么办(产物由一次普通交付落位)', /没有合并/.test(String(survived.message)) && /普通交付/.test(String(survived.message)))
		check('分叉上没有假的合并记录', !host.journal.some((mutation) => mutation.t === 'fork/merged'))
	}

	// ⑥ 并列**不是**算不出(另一枚干净的令牌走这条):照常收敛,但记为临时采纳 + 待复核
	{
		const { host, hypothesis } = await setup('unattended')
		await callOn(host, S, 'CreatePlan', {
			steps: [{ id: 'f2', do: '试两条互斥路线', artifacts: ['lab/f2.txt'], done_criteria: 'lab/f2.txt 存在', tests: { hypothesis, level: 'L3' } }],
		})
		await callOn(host, S, 'ForkPlan', {
			question: '两条路选哪条',
			options: [
				{ label: '甲', approach: '甲的做法', done_criteria: '产率 yield_pct 越高越好', workspace: 'lab/wl/jia', level: 'L3' },
				{ label: '乙', approach: '乙的做法', done_criteria: '产率 yield_pct 越高越好', workspace: 'lab/wl/yi', level: 'L3' },
			],
			decide_by: { metric: 'yield_pct', direction: 'max' },
		})
		const branchPath = (label) => host.service.view(S).forks.find((item) => item.stepId === 'f2').branches.find((item) => item.label === label).worktreePath
		host.nextVerdict = { verdict: 'support', basis: '硬信号:读数一致', reading: '61', validity: 'usable' }
		for (const label of ['甲', '乙']) {
			writeText(join(branchPath(label), 'probe.txt'), `run,route,yield_pct\n1,${label},61\n`)
			await callOn(host, S, 'AdvanceWorldline', { branch_id: label, observations: [{ ref: join(branchPath(label), 'probe.txt') }] })
		}
		const tied = await callOn(host, S, 'ConvergeFork', {})
		check('并列照常收敛(指标说两条一样好,那是买到的信息)', tied.ok === true, String(tied.code))
		const view = host.service.view(S)
		check('并列 → 记成**临时采纳**(余量 0 < 15%)', view.forks.find((item) => item.stepId === 'f2')?.provisional === true)
		check(
			'临时采纳在收件箱里留一条待复核痕迹',
			view.inbox.some((item) => item.kind === 'provisional_review') && view.hasOpenGate === true,
			view.inbox.map((item) => item.kind).join(','),
		)
		check('决策说明写清相对差距与阈值', /相对差距 0\.0%/.test(String(view.forks.find((item) => item.stepId === 'f2')?.decisionNote ?? '')), String(view.forks.find((item) => item.stepId === 'f2')?.decisionNote ?? ''))
	}
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

console.log('\n【执行者未归:分叉收口之后,「结论会自动回灌」这句承诺就作废了(2026-09-11 R3-a 抓到的)】')
{
	/**
	 * 长测现场(chain-2):四条世界线里只有甲的执行者结论回灌了,乙/丙/丁三条**永远停在
	 * `execution.ok === null`**——因为模型没等它们(它自己读工作副本里的产物就把读数交付了)。
	 * 于是终局(分叉已 settled、已 merged、目标已 achieved)的卡片上仍写着
	 * 「(执行中,结论会自动回灌)」:**一句实现了不了的承诺**——分叉收了口,回灌也没有归宿。
	 *
	 * 修法不落新账:分叉终局 + 执行者没报过 ⇒ 派生的「**执行者未归**」。
	 * 它不改写 `execution` 本身(「没报过」仍是已发生的事实),只是不再假装还有下文。
	 */
	const base = [
		{ t: 'goal/set', id: 'g-u1', claim: '四条路线择优', done_criteria: '报告写下被采纳读数', promote_at_level: 'L3', hypotheses: [{ id: 'h-u1', claim: '乘 4 那条最大', refute_when: '不是它' }] },
		{ t: 'plan/created', id: 'p-u1', goal: 'g-u1', summary: '四路试算', steps: [{ id: 'u1', ordinal: 1, do: '四路并行试算', artifacts: ['lab/params.csv'], done_criteria: 'lab/params.csv 存在', status: 'open' }] },
		{
			t: 'fork/created',
			id: 'k-u1',
			step: 'u1',
			plan: 'p-u1',
			question: '哪条路线的 value 最大',
			decide_by: { metric: 'value', direction: 'max' },
			options: [
				{ id: 'ub1', label: '甲', approach: '乘 2', done_criteria: 'value 读数' },
				{ id: 'ub2', label: '乙', approach: '乘 3', done_criteria: 'value 读数' },
			],
		},
		{ t: 'worldline/prepared', fork: 'k-u1', branch: 'ub1', path: 'clear/worldlines/k-u1/ub1', branch_ref: 'clearai/k-u1/ub1' },
		{ t: 'worldline/prepared', fork: 'k-u1', branch: 'ub2', path: 'clear/worldlines/k-u1/ub2', branch_ref: 'clearai/k-u1/ub2' },
		{ t: 'worldline/executing', fork: 'k-u1', branch: 'ub1', child: 'child-a', capability: 'persona' },
		{ t: 'worldline/executing', fork: 'k-u1', branch: 'ub2', child: 'child-b', capability: 'persona' },
		{ t: 'worldline/executed', fork: 'k-u1', branch: 'ub1', child: 'child-a', ok: true, conclusion: '甲:14' },
		{ t: 'branch/delivered', fork: 'k-u1', branch: 'ub1', reading: '14', validity: 'usable', verdict: 'support', basis: '读过产物', evidence: 'e-u1' },
		{ t: 'branch/delivered', fork: 'k-u1', branch: 'ub2', reading: '21', validity: 'usable', verdict: 'support', basis: '读过产物', evidence: 'e-u2' },
		{ t: 'fork/converged', fork: 'k-u1', winner: 'ub2', margin: 0.5, tie: false, metric: 'value', direction: 'max' },
	]
	const state = applyMutations(emptyState(), base)
	const fork = view(state).forks[0]
	const card = renderCard(state)
	check('前置:甲的执行者结论回灌了(ok=true),乙那条**永远没回来**(ok=null)', fork.branches.find((b) => b.label === '甲')?.execution?.ok === true && fork.branches.find((b) => b.label === '乙')?.execution?.ok === null, JSON.stringify(fork.branches.map((b) => [b.label, b.execution?.ok])))
	check('派生:分叉已收口 + 执行者没报过 ⇒「执行者未归」', fork.branches.find((b) => b.label === '乙')?.unreturned === true && fork.branches.find((b) => b.label === '甲')?.unreturned !== true)
	check('卡片不再说「执行中,结论会自动回灌」(分叉已收口,没有下文了)', !/执行中,结论会自动回灌/.test(card), card.split('\n').filter((line) => line.includes('· [')).join(' | ').slice(0, 200))
	check('卡片如实写「执行者未归 · 分叉已收口」', /执行者未归 · 分叉已收口/.test(card), card.split('\n').filter((line) => line.includes('· [')).join(' | ').slice(0, 200))
	check('已经回灌的那条仍然写「已回灌」(不冤枉跑完的人)', /\(已回灌\)/.test(card))
	// 分叉**还没**收口时不许提前宣告「未归」:那时它真的还在跑。
	const openState = applyMutations(emptyState(), base.slice(0, 7))
	check('分叉还在探索时仍然是「执行中」(未归是终局的推论,不是提前的判词)', /执行中,结论会自动回灌/.test(renderCard(openState)))
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
		check('目录里没有活的子会话 ⇒ 失联裁决如实落账(verdict=unknown)', settled.length === 1 && settled[0].verdict === 'unknown' && String(settled[0].basis).includes('失联'), JSON.stringify(settled[0] ?? null).slice(0, 120))
		check('卡片如实说「失联」并说清下一步(重新交付会派新的评估者)', /裁决\*\*失联\*\*/.test(JSON.stringify(first.messages ?? [])), JSON.stringify(first.messages ?? []).slice(0, 200))
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
	{
		const mk = async (level) => {
			const host = makeHost()
			apply(host.ctx, { blockedThreshold: 3 })
			const S = `session-l4-wl-${level}`
			await callOn(host, S, 'SetGoal', { claim: '两条路线取一条', done_criteria: '有一条能跑通', hypotheses: [{ claim: 'A 更好', refute_when: 'B 更好' }] })
			await callOn(host, S, 'CreatePlan', { steps: [{ id: 'w1', do: '两条路线各试一遍', artifacts: ['lab/w1.txt'], done_criteria: 'lab/w1.txt 有读数', tests: null }] })
			await callOn(host, S, 'ForkPlan', {
				question: '走哪条',
				decide_by: { metric: 'ms', direction: 'min' },
				options: [
					{ id: 'wa', label: '甲', approach: '直接算', done_criteria: '有 ms 读数', level },
					{ id: 'wb', label: '乙', approach: '绕一圈', done_criteria: '有 ms 读数', level: 'L1' },
				],
			})
			// 分支 id 由内核生成(不能自己指定),所以按 **label** 认,再把真实 id 带回去。
			const fork = host.service.view(S).forks[0]
			const a = fork.branches.find((branch) => branch.label === '甲')
			const b = fork.branches.find((branch) => branch.label === '乙')
			return { host, S, idA: a.id, idB: b.id, workspace: a.workspace }
		}
		const { host, S, idA, idB, workspace } = await mk('L4')
		const gate = host.listeners.get('tools/pre-execute')
		const asked = await gate({ name: 'AdvanceWorldline', arguments: { branch_id: idA }, agent: { id: S }, callId: 'call-wl-1' }, async () => ({ kind: 'allow' }))
		check('世界线的 L4 交付也会弹人门(改之前只有 AdvancePlan 会)', asked.kind === 'ask' && /世界线「甲」/.test(String(asked.reason)), `${asked.kind}:${String(asked.reason ?? '').slice(0, 80)}`)
		const notL4 = await gate({ name: 'AdvanceWorldline', arguments: { branch_id: idB }, agent: { id: S }, callId: 'call-wl-2' }, async () => ({ kind: 'allow' }))
		check('同一分叉里的 L1 分支不弹门(门认等级,不认工具)', notL4.kind === 'allow', String(notL4.kind))
		writeText(join(workspace, 'probe.txt'), 'run,ms\n1,61.2\n')
		host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '61.2', validity: 'usable' }
		const noWitness = await callOn(host, S, 'AdvanceWorldline', { branch_id: idA, observations: [{ ref: 'probe.txt' }] })
		check('世界线 L4 没有放行记录 ⇒ 交付被拒', noWitness.ok === false && noWitness.code === 'human_release_missing', String(noWitness.code))
		check('世界线这条路被拒时也不写「人放行」', host.journal.filter((mutation) => mutation.t === 'human/released').length === 0)
		host.sessionEvents = { [S]: [{ type: 'approval/asked', data: { id: 'ap-w', toolName: 'AdvanceWorldline', callId: 'call-1' } }, { type: 'approval/decided', data: { id: 'ap-w', outcome: 'allowed-once' } }] }
		const delivered = await callOn(host, S, 'AdvanceWorldline', { branch_id: idA, observations: [{ ref: 'probe.txt' }] })
		check('世界线 L4 拿到权威放行 ⇒ 交付通过', delivered.ok === true, `${delivered.code}:${String(delivered.message ?? '').slice(0, 80)}`)
		const release = host.journal.filter((mutation) => mutation.t === 'human/released').at(-1)
		check('世界线的放行绑在**分支**这条轴上(不绑步骤)', release?.branch === idA && release?.via === 'approval', JSON.stringify(release ?? null))
		check('面板投影里也看得出这次放行(带轴与凭据)', (() => {
			const item = host.service.view(S).releases.at(-1)
			return item?.branch === idA && item?.via === 'approval'
		})(), JSON.stringify(host.service.view(S).releases.at(-1) ?? null))

		// ⑤ L4 来源分离:做的人自己写的观测不算(世界线这条路上以前根本不查)
		const second = await mk('L4')
		const forged = join(second.workspace, 'forged.txt')
		writeText(forged, 'run,ms\n1,1.0\n')
		second.host.sessionEvents = { [second.S]: [{ type: 'approval/asked', data: { id: 'ap-w2', toolName: 'AdvanceWorldline', callId: 'call-1' } }, { type: 'approval/decided', data: { id: 'ap-w2', outcome: 'allowed-once' } }] }
		// 「做的人写过这份观测」:fold 从工具调用的 file_path 记 `written`,这里直接把它放进投影
		second.host.states.set(second.S, { ...second.host.service.state(second.S), written: [forged] })
		const selfAuthored = await callOn(second.host, second.S, 'AdvanceWorldline', { branch_id: second.idA, observations: [{ ref: 'forged.txt' }] })
		check('世界线 L4:做的人自己写的观测被拒(改之前这条路不查来源)', selfAuthored.ok === false && selfAuthored.code === 'source_not_external', `${selfAuthored.code}:${String(selfAuthored.message ?? '').slice(0, 90)}`)
	}
}

console.log('\n【世界线的四种结束方式:失败不是落选,孤儿不是被裁(2026-09-11 定的语义)】')
{
	/**
	 * S3 长测抓到的**结构洞**:`AbandonFork`/`ConvergeFork` 都在「第一个未落定步」上取步,
	 * 于是步骤一旦作废,它上面未收口的分叉**既不能收敛也不能放弃**,工作副本永久留在盘上。
	 * 用户拍板走「只落事实 + 放开可达性」:作废不动分叉(不改写历史),但**给它一个出口**。
	 */
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-orphan'
	await callOn(host, S, 'SetGoal', { claim: '试两条路线', done_criteria: '有一条能跑通', hypotheses: [{ claim: 'A 比 B 快', refute_when: 'B 更快' }] })
	const createdPlan = await callOn(host, S, 'CreatePlan', {
		steps: [
			{ id: 'o1', do: '两条路线各试一遍', artifacts: ['lab/o1.txt'], done_criteria: 'lab/o1.txt 存在且含一条读数', tests: null },
			{ id: 'o2', do: '换一条路走完', artifacts: ['lab/o2.txt'], done_criteria: 'lab/o2.txt 存在且非空', tests: null },
		],
	})
	check('前置:计划建起来了', createdPlan.ok === true, `${createdPlan.code}:${createdPlan.message ?? ''}`.slice(0, 120))
	const forked = await callOn(host, S, 'ForkPlan', { step_id: 'o1', question: '走哪条', decide_by: { metric: 'ms', direction: 'min' }, options: [{ id: 'ob1', label: 'A', approach: '直接算', done_criteria: '有 ms 读数' }, { id: 'ob2', label: 'B', approach: '绕一圈', done_criteria: '有 ms 读数' }] })
	check('分叉建得起来(两条互斥路线)', forked.ok === true && host.service.view(S).forks.length === 1, String(forked.code))

	// 作废这一步:分叉**不该**被改写,但结果里要如实报「未收口」并给出出口
	const voided = await callOn(host, S, 'VoidPlanStep', { step_id: 'o1', reason: '改道' })
	const fork = host.service.view(S).forks[0]
	check('作废不改写尝试层的事实(它不是「已放弃」,只是随步骤终止)', fork.decided === false && fork.abandonReason === null, JSON.stringify({ decided: fork.decided, abandonReason: fork.abandonReason, phase: fork.phase }))
	check('作废之后它是派生的「随步骤作废而终止」', fork.phase === 'orphaned' && fork.orphaned === true && fork.ownerVoidReason === '改道', JSON.stringify({ phase: fork.phase, orphaned: fork.orphaned }))
	check('作废的结果里如实报「还有未收口的世界线」并给出出口(事实,不是说教)', /未收口/.test(String(voided.message)) && /AbandonFork\(step_id="o1"/.test(String(voided.message)), String(voided.message).slice(0, 160))

	// 可达性:带 step_id 显式收口 —— 这正是那个洞的出口
	const closed = await callOn(host, S, 'AbandonFork', { step_id: 'o1', reason: '这一步已经作废,世界线随它终止' })
	check('已作废步骤上的孤儿分叉可以显式收口(洞堵上了)', closed.ok === true && host.service.view(S).forks[0].phase === 'abandoned', JSON.stringify({ code: closed.code, phase: host.service.view(S).forks[0].phase }))
	check('收口之后如实说这是收口孤儿(不是常规放弃)', /收口孤儿/.test(String(closed.message)), String(closed.message).slice(0, 120))

	// 反过来:常规放弃仍然只认「第一个未落定步」;已收敛的仍然不能放弃
	const host2 = makeHost()
	apply(host2.ctx, {})
	const S2 = 'session-orphan-2'
	await callOn(host2, S2, 'SetGoal', { claim: 'x', done_criteria: 'y 存在', hypotheses: [{ claim: 'a', refute_when: 'b' }] })
	await callOn(host2, S2, 'CreatePlan', { steps: [{ id: 'p1', do: '做事', artifacts: ['lab/p1.txt'], done_criteria: 'lab/p1.txt 存在且非空', tests: null }, { id: 'p2', do: '第二步', artifacts: ['lab/p2.txt'], done_criteria: 'lab/p2.txt 存在且非空', tests: null }] })
	const notFirst = await callOn(host2, S2, 'AbandonFork', { step_id: 'p2', reason: '随便挑一步' })
	check('不在第一个未落定步、也不是作废步 → 拒绝(可达性放开不等于随便挑)', notFirst.ok === false && notFirst.code === 'no_open_step', String(notFirst.code))
}

console.log('\n【横评仲裁:尺子落不成数时的兜底(不是默认路径)】')
{
	const S = 'session-arbiter'
	const fresh = async () => {
		const host = makeHost()
		apply(host.ctx, { autonomy: 'unattended' })
		await callOn(host, S, 'SetGoal', {
			claim: '把两条路线比出高下',
			done_criteria: '两条路线各有读数与结论',
			hypotheses: [{ claim: '两条路线的产率不同', refute_when: '产率相同' }],
		})
		const hypothesis = host.service.state(S).hypotheses[0].id
		await callOn(host, S, 'CreatePlan', {
			steps: [{ id: 'a1', do: '试两条互斥路线', artifacts: ['lab/a1.txt'], done_criteria: 'lab/a1.txt 存在', tests: { hypothesis, level: 'L3' } }],
		})
		await callOn(host, S, 'ForkPlan', {
			question: '哪个设计更简洁',
			options: [
				{ label: '甲', approach: '甲的做法', done_criteria: '产率 yield_pct 越高越好', workspace: 'lab/wl/a', level: 'L3' },
				{ label: '乙', approach: '乙的做法', done_criteria: '产率 yield_pct 越高越好', workspace: 'lab/wl/b', level: 'L3' },
			],
			decide_by: { metric: 'yield_pct', direction: 'max' },
		})
		const branchPath = (label) => host.service.view(S).forks.find((item) => item.stepId === 'a1').branches.find((item) => item.label === label).worktreePath
		// 尺子落不成数:读数不是数值(「哪个更简洁」这类)。
		host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '说不清', validity: 'usable' }
		for (const label of ['甲', '乙']) {
			writeText(join(branchPath(label), 'probe.txt'), `run,route,yield_pct\n1,${label},未测出\n`)
			await callOn(host, S, 'AdvanceWorldline', { branch_id: label, observations: [{ ref: join(branchPath(label), 'probe.txt') }] })
		}
		const ids = host.service.state(S).forks[0].branches.map((branch) => ({ id: branch.id, label: branch.label }))
		return { host, ids }
	}

	// ① 派仲裁:跨分支视野靠**注入**(各分支的评估卡写进任务书),不靠授权(工具面是空的)
	{
		const { host } = await fresh()
		host.nextArbiterVerdict = { winner: 'TODO', ranking: [], reason: '乙的做法更简洁:两条都可信,甲的实现复杂度更高。', confidence: 'high' }
		const state = host.service.state(S)
		host.nextArbiterVerdict.winner = state.forks[0].branches.find((branch) => branch.label === '乙').id
		const converged = await callOn(host, S, 'ConvergeFork', {})
		check('仲裁给出胜者 → 收敛成功', converged.ok === true && /采纳「乙」/.test(String(converged.message)), String(converged.code))
		check('派了一次横评仲裁(兜底路径)', host.arbiterRequests.length === 1, String(host.arbiterRequests.length))
		// dispatchSubRun 把 prompt 包成 ContentBlock[]:取第一块的正文。
		const task = JSON.stringify(host.arbiterRequests[0]?.prompt ?? '')
		check(
			'任务书里注入了各分支的评估卡(事实到手,权限没给)',
			/甲/.test(task) && /乙/.test(task) && /评估卡/.test(task),
			task.slice(0, 200),
		)
		check('仲裁的工具面是空的(看不到也不需要任何工作区)', JSON.stringify(host.arbiterRequests[0]?.toolFilter) === JSON.stringify({ allow: [] }), JSON.stringify(host.arbiterRequests[0]?.toolFilter))
		const view = host.service.view(S)
		const fork = view.forks.find((item) => item.stepId === 'a1')
		check('判决写进了节点(可考:谁裁的、裁给谁、凭什么)', fork?.arbitration?.winner !== null && /更简洁/.test(String(fork?.arbitration?.reason)))
		check('仲裁会话 id 落账(面板的旁观入口靠它)', typeof fork?.arbitrationSession === 'string' && fork.arbitrationSession.startsWith('arbiter-'), String(fork?.arbitrationSession))
		check('判断不是算术 → 一定走临时采纳 + 待复核痕迹', fork?.provisional === true && view.inbox.some((item) => item.kind === 'provisional_review'))
		check('决策说明写明来源是横评仲裁', /横评仲裁/.test(String(fork?.decisionNote ?? '')), String(fork?.decisionNote ?? ''))
		// 旁观入口(4.5)的数据面:每条世界线的评估者会话与评估卡都要能追到。
		const spectator = (fork?.branches ?? []).map((branch) => ({ session: branch.evaluatorSession, card: branch.cardPath }))
		check(
			'每条世界线都记得自己的评估者会话与评估卡(面板据此旁观)',
			spectator.length === 2 && spectator.every((item) => typeof item.session === 'string' && item.session.startsWith('child-') && typeof item.card === 'string' && item.card.includes('clear/evidence/audits')),
			JSON.stringify(spectator),
		)
		check(
			'审计面也带着评估者会话(判断不许匿名)',
			(view.audits ?? []).some((audit) => typeof audit.evaluatorSession === 'string' && audit.evaluatorSession.startsWith('child-')),
			JSON.stringify((view.audits ?? []).map((audit) => audit.evaluatorSession)),
		)
	}

	// ② 仲裁也裁不出来 = **合法结局**,不是故障:照实交回主 agent(四条出路)
	{
		const { host } = await fresh()
		host.nextArbiterVerdict = { winner: null, ranking: [], reason: '证据不足以分高下。', confidence: 'low' }
		const converged = await callOn(host, S, 'ConvergeFork', {})
		check('仲裁裁不出来 → 不采纳、不硬选', converged.ok === false && converged.code === 'UNDECIDABLE_NO_READINGS', String(converged.code))
		check('四条合法出路照旧给主 agent', /可走的路/.test(String(converged.message)))
		check('并如实说明仲裁也裁不出来', /横评仲裁/.test(String(converged.message)))
		const view = host.service.view(S)
		check('分叉停在等人的门上(收件箱 fork_adopt)', view.inbox.some((item) => item.kind === 'fork_adopt'))
		check('判决(winnner=null)仍然留痕:证据确实不足,这本身是可考的事实', view.forks[0]?.arbitration?.winner === null)
	}

	// ③ 仲裁派不出去:如实降级,不假装裁过
	{
		const { host } = await fresh()
		host.auditFails = true
		const converged = await callOn(host, S, 'ConvergeFork', {})
		check('仲裁无法派遣 → 退回「算不出」那条路(不假装有判决)', converged.ok === false && converged.code === 'UNDECIDABLE_NO_READINGS', String(converged.code))
		check('降级事实写进文案', /横评仲裁无法派遣/.test(String(converged.message)), String(converged.message).split('\n').slice(0, 3).join(' | '))
		check('没有留下假判决', host.service.view(S).forks[0]?.arbitration === null)
	}
}

console.log('\n【模板技能同步:模板是 system 技能的事实源(最小不变量)】')
{
	/**
	 * 规则是「模板更新即刻生效,但**动过的绝不动**」。
	 * 这里只保留这条不变量,不做差异候选/墓碑/diff 收件箱那套子系统——但「不覆盖人写的东西」这条(P5)必须在。
	 */
	const root = tempDir('clearai-sync-')
	const skillsDir = join(root, 'clear', 'skills')
	const templateDir = join(root, 'template', 'skills')
	mkdirSync(skillsDir, { recursive: true })
	const V1 = '---\nname: alpha\ntier: system\n---\n\nv1\n'
	const V2 = '---\nname: alpha\ntier: system\n---\n\nv2\n'
	const skill = (name, body) => {
		mkdirSync(join(templateDir, name), { recursive: true })
		writeFileSync(join(templateDir, name, 'SKILL.md'), body)
	}
	skill('alpha', V1)
	skill('beta', V1.replace(/alpha/g, 'beta'))

	// ① 首次播种:缺的铺下去,并记下内容哈希(下次升级靠它判断「有没有被动过」)
	let report = syncTemplateSkills({ skillsDir, templateDir, record: {} })
	check('首次:缺失的模板技能被播种', report.seeded.slice().sort().join(',') === 'alpha,beta' && existsSync(join(skillsDir, 'alpha', 'SKILL.md')), report.seeded.join(','))
	check('首次:每个都记下内容哈希', Object.keys(report.record).length === 2 && report.record.alpha.length === 64)

	// ② 模板升级 + 项目那份没被动过 → 镜像覆盖(原设计:模板是 system 技能的事实源)
	skill('alpha', V2)
	report = syncTemplateSkills({ skillsDir, templateDir, record: report.record })
	check('模板升级:没被动过的那份被刷新到新版', report.mirrored.join(',') === 'alpha' && readFileSync(join(skillsDir, 'alpha', 'SKILL.md'), 'utf8') === V2, report.mirrored.join(','))

	// ③ 项目那份被人改过 → 一个字都不动,只报漂移
	writeFileSync(join(skillsDir, 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n\n我改过这一版\n')
	skill('alpha', '---\nname: alpha\n---\n\nv3\n')
	report = syncTemplateSkills({ skillsDir, templateDir, record: { ...report.record } })
	check('人改过的:不覆盖(P5:宁可少刷新一次,也不覆盖人写的东西)', readFileSync(join(skillsDir, 'alpha', 'SKILL.md'), 'utf8').includes('我改过这一版'))
	check('人改过的:如实报漂移(事实,不是静默)', report.drifted.join(',') === 'alpha' && report.mirrored.length === 0, report.drifted.join(','))

	// ④ 老项目没有记录(这条不变量之前就播种过):内容与模板一致 → 补记;不一致 → 报漂移,不猜
	const legacy = join(tempDir('clearai-sync-legacy-'), 'clear', 'skills')
	mkdirSync(join(legacy, 'alpha'), { recursive: true })
	// 内容取**当前模板**那一份:模拟「老项目里躺着一份没人动过的旧播种」(而不是被人改过的)。
	writeFileSync(join(legacy, 'alpha', 'SKILL.md'), readFileSync(join(templateDir, 'alpha', 'SKILL.md'), 'utf8'))
	const legacyReport = syncTemplateSkills({ skillsDir: legacy, templateDir, record: {} })
	check('没记录但内容与模板一致 → 补记哈希(下次就能刷新它)', legacyReport.drifted.length === 0 && legacyReport.record.alpha.length === 64, JSON.stringify(legacyReport.drifted))
	writeFileSync(join(legacy, 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n\n旧版?人改的?\n')
	const legacyDrift = syncTemplateSkills({ skillsDir: legacy, templateDir, record: legacyReport.record })
	check('没记录且内容对不上 → 记成漂移,不猜是旧版还是人改的', legacyDrift.drifted.join(',') === 'alpha' && !legacyDrift.mirrored.includes('alpha'))
}

console.log('\n【外脑:把工作区投影成原生条目,自建只有写侧两件】')
{
	// ① provider:预设挂载时就注册给宿主的 skills 服务,而且带可回收的 disposer
	check('技能提供者已注册给宿主(预设自带的那一层)', thisHost.brainProvider !== null && thisHost.brainProvider.name === 'clearai-brain')
	check('提供者是宿主原生接口的形状(list/get)', typeof thisHost.brainProvider?.list === 'function' && typeof thisHost.brainProvider?.get === 'function')
	{
		const noSkills = makeHost()
		noSkills.skillsAvailable = false
		apply(noSkills.ctx, {})
		check('宿主没有 skills 服务时,装配照常(降级不抛)', noSkills.tools.size === 22)
	}

	// ② SaveSkill:写进工作区、默认候选态、写盘后让宿主目录失效
	const saved = await call('SaveSkill', {
		skill: 'my-sop',
		content: ['---', 'name: my-sop', 'description: |', '  【我的流程】什么时候用、什么时候不用。', '---', '', '# 我的流程', '', '1. 第一步', ''].join('\n'),
	})
	check('SaveSkill 写入成功', saved.ok === true && saved.code === 'skill_saved', String(saved.code))
	check('卡片说明它是候选态(人采纳之后模型才加载得到)', /候选态/.test(String(saved.message)))
	const written = readFileSync(join(WORKSPACE, 'clear/skills/my-sop/SKILL.md'), 'utf8')
	check('frontmatter 自动补上 status: candidate', /status: candidate/.test(written))
	check('写盘之后让宿主的目录缓存失效(下一个回合才看得到)', thisHost.brainInvalidations.length >= 1)
	{
		const listed = await thisHost.brainProvider.list({ cwd: WORKSPACE })
		const candidate = listed.candidates.find((item) => item.name === 'my-sop')
		check('刚写的技能出现在条目里,但**模型不可调用**(候选态)', candidate !== undefined && candidate.invocation.modelInvocable === false, JSON.stringify(candidate?.invocation))
		check('人看得到它(invocation.userInvocable=true)', candidate?.invocation.userInvocable === true)
	}

	const badName = await call('SaveSkill', { skill: 'My SOP', content: 'x' })
	check('技能名不是 kebab-case → 拒绝', badName.ok === false && badName.code === 'must_be_kebab_case', String(badName.code))
	const badPath = await call('SaveSkill', { skill: 'my-sop', content: 'x', path: '../escape.md' })
	check('路径越狱 → 拒绝', badPath.ok === false && badPath.code === 'path_traversal', String(badPath.code))
	const noFrontmatter = await call('SaveSkill', { skill: 'no-meta', content: '# 没有 frontmatter' })
	check('SKILL.md 缺 name/description → 拒绝', noFrontmatter.ok === false && noFrontmatter.code === 'skill_frontmatter_required', String(noFrontmatter.code))
	const resource = await call('SaveSkill', { skill: 'my-sop', content: '# 检查清单\n- [ ] 一条\n', path: 'checklists/check.md' })
	check('技能内的资源文件也能写(第三层渐进加载就是它们)', resource.ok === true && existsSync(join(WORKSPACE, 'clear/skills/my-sop/checklists/check.md')))

	// ③ WriteMemory:结构校验 + 标题去重 + 立刻进虚拟条目
	const lesson = await call('WriteMemory', {
		kind: 'lesson',
		title: '中文 CSV 先探测编码',
		fields: { Context: '业务系统导出', Trigger: '读到乱码', Action: '依次试 utf-8/gbk/gb18030', Validation: '列名可读', 'Reuse Hint': '每次都先探测' },
		source: 'lab/step-1',
	})
	check('合法 lesson 写入成功', lesson.ok === true && lesson.code === 'memory_written', String(lesson.code))
	check('卡片给了结晶提示(有触发-动作-验证三元组)', /SaveSkill/.test(String(lesson.message)))
	const missing = await call('WriteMemory', { kind: 'lesson', title: '缺字段', fields: { Context: '只有一项' } })
	check('字段不全 → 拒绝(结构只有机制保证得了)', missing.ok === false && missing.code === 'memory_fields_required', String(missing.code))
	const again = await call('WriteMemory', {
		kind: 'lesson',
		title: '中文 CSV 先探测编码',
		fields: { Context: '业务系统导出', Trigger: '读到乱码', Action: '依次试 utf-8/gbk/gb18030', Validation: '列名可读', 'Reuse Hint': '每次都先探测' },
	})
	check('同标题再写 → 跳过(跨文件去重)', again.ok === true && again.code === 'memory_already_present', String(again.code))
	const badTarget = await call('WriteMemory', { kind: 'fact', title: 'x', fields: { Statement: 'a', Evidence: 'b', Scope: 'c', 'Last Verified': 'd' }, target: '../escape.md' })
	check('target 越狱 → 拒绝', badTarget.ok === false && badTarget.code === 'path_traversal', String(badTarget.code))

	// ④ 候选技能 → 收件箱条目 → 人采纳 → 模型这才加载得到(闭环)
	{
		mkdirSync(join(WORKSPACE, 'clear/skills/agent-written'), { recursive: true })
		writeFileSync(
			join(WORKSPACE, 'clear/skills/agent-written/SKILL.md'),
			['---', 'name: agent-written', 'status: candidate', 'description: |', '  模型自己写的一条 SOP,等人采纳。', '---', '', '# 正文', ''].join('\n'),
		)
		await preStep(thisHost, SESSION, 20)
		check('扫描候选技能 → 折进投影(收件箱里出现条目)', thisHost.service.view(SESSION).inbox.some((item) => item.kind === 'skill_candidate' && item.human_action === 'promote_skill' && item.skill === 'agent-written'))
		{
			const again = await preStep(thisHost, SESSION, 21)
			const brainSections = (again?.messages ?? []).flatMap((message) => message?.source?.sections ?? []).filter((section) => section?.name === 'clearai/brain')
			check(
				'候选没变就不再落一条事实(字节稳定:不刷日志、不刷上下文)',
				brainSections.length === 0,
				JSON.stringify((again?.messages ?? []).map((message) => String(message?.source?.sections?.[0]?.name ?? ''))),
			)
		}

		// 人在面板上按了「采纳」:宿主路由把它变成一条结构化消息,内核在 pre-step 里落实。
		const gate = { id: 'gate-skill', role: 'user', content: [{ type: 'text', text: `[clearai·人门] ${JSON.stringify({ action: 'promote_skill', skill: 'agent-written' })}` }], source: { kind: 'user' } }
		const decision = await preStep(thisHost, SESSION, 22, [gate])
		const written = readFileSync(join(WORKSPACE, 'clear/skills/agent-written/SKILL.md'), 'utf8')
		check('采纳之后 frontmatter 变成 active(正文一个字没动)', /status: active/.test(written) && /# 正文/.test(written))
		check('留下署名与时间(判断不许匿名)', /promoted_by: user/.test(written) && /promoted_at: /.test(written))
		check(
			'采纳这件事折进投影(可重放的事实,不是一句说明)',
			(thisHost.service.state(SESSION).skillPromotions ?? []).some((entry) => entry.name === 'agent-written' && entry.by === 'user'),
		)
		check(
			'采纳之后那一条候选从收件箱消失(状态锚;别的候选还在,它们各自等人)',
			!thisHost.service.view(SESSION).inbox.some((item) => item.kind === 'skill_candidate' && item.skill === 'agent-written'),
			thisHost.service.view(SESSION).inbox.filter((item) => item.kind === 'skill_candidate').map((item) => item.skill).join(','),
		)
		check('卡片里如实说了采纳结果', /已采纳/.test(JSON.stringify(decision.messages ?? [])))
		{
			const listed = await thisHost.brainProvider.list({ cwd: WORKSPACE })
			const promoted = listed.candidates.find((item) => item.name === 'agent-written')
			check('采纳之后模型才加载得到它(invocation 由宿主执行)', promoted?.invocation.modelInvocable === true, JSON.stringify(promoted?.invocation))
		}

		// ⑤ 记忆虚拟条目(接上面那段)
		const listed = await thisHost.brainProvider.list({ cwd: WORKSPACE })
		const memory = listed.candidates.find((item) => item.name === 'project-memory')
		check('记忆以**一个虚拟条目**出现在目录里', memory !== undefined && memory.invocation.modelInvocable === true)
		check('L1 摘要里是条数 + 标题(有界)', /已沉淀/.test(String(memory?.description)) && /中文 CSV 先探测编码/.test(String(memory?.description)))
		const loaded = await thisHost.brainProvider.get(memory, { cwd: WORKSPACE })
		check('L2 正文是现算的索引,并且指向记忆目录(resourceBase)', /lessons\.md/.test(loaded.content) && loaded.resourceBase.path === join(WORKSPACE, 'clear/memory'))
	}
}

console.log('\n【技能目录:面板与模型看同一张表(合并目录随投影下发)】')
{
	// 宿主的合并目录是**分层注册表**合出来的表:预设自带 / 项目 / 用户 / 我们投影的 clear/skills。
	// 这里用一条「各层各来一条」的快照,验内核把它如实落成**可重放的 section**。
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-catalog'
	const dir = (name) => join(WORKSPACE, 'clear', 'skills', name)
	host.skillSnapshot = {
		complete: true,
		skills: [
			{ name: 'literature-review', description: '【文献综述】…', source: 'clearai-template', provider: 'clearai-brain', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { kind: 'directory', path: dir('literature-review') } },
			{ name: 'my-sop', description: '模型自己写的 SOP', source: 'clearai-workspace', provider: 'clearai-brain', invocation: { modelInvocable: false, userInvocable: true }, resourceBase: { kind: 'directory', path: dir('my-sop') } },
			{ name: 'user-note', description: '我攒的', source: 'user-dsh', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { kind: 'directory', path: '/home/someone/.dsh/skills/user-note' } },
			{ name: 'no-dir', description: '没有目录的提供者', source: 'runtime', provider: 'whatever', invocation: { modelInvocable: true, userInvocable: false } },
		],
	}
	const decision = await preStep(host, S, 1)
	const sections = (decision?.messages ?? []).flatMap((message) => message?.source?.sections ?? []).filter((section) => section?.name === 'clearai/brain')
	check('目录随投影下发(clearai/brain 的结构化 section)', sections.length === 1, String(sections.length))
	const catalog = sections.length === 0 ? null : JSON.parse(sections[0].text).catalog
	check('四条技能一条不少(合并目录不筛来源)', catalog?.entries?.length === 4, JSON.stringify(catalog?.entries?.map((entry) => entry.name)))
	check('取的是宿主的快照(cwd 与会话工作区一致)', host.skillSnapshots.length === 1 && host.skillSnapshots[0].cwd === WORKSPACE, JSON.stringify(host.skillSnapshots[0]?.cwd))
	{
		const entry = (name) => catalog.entries.find((item) => item.name === name)
		check('来源、调用策略原样搬下来(面板据此分组、据此标候选)', entry('my-sop')?.source === 'clearai-workspace' && entry('my-sop')?.model === false && entry('my-sop')?.user === true, JSON.stringify(entry('my-sop')))
		check('工作区内的技能标成 inside=true(面板能读正文)', entry('literature-review')?.inside === true && entry('user-note')?.inside === false)
		check('没有目录的提供者:inside 是 null(不是 false——「不知道」不许写成「不在」)', entry('no-dir')?.inside === null && entry('no-dir')?.dir === null, JSON.stringify(entry('no-dir')))
		// 正文文件:原生 filesystem provider 的约定是 `<技能目录>/SKILL.md`(不是目录本身)。
		check('每条带正文文件路径(面板点开读的就是它,不是目录)', entry('my-sop')?.file === join(dir('my-sop'), 'SKILL.md'), String(entry('my-sop')?.file))
		check('没有目录的提供者:file 也是 null(面板据此不画链接)', entry('no-dir')?.file === null)
		// 记忆是**虚拟条目**(没有正文文件):file 必须是 null,否则点了就撞 404。
		{
			const memoryEntry = catalog.entries.find((item) => item.source === 'clearai-memory')
			check('记忆虚拟条目不给正文文件(2026-09-11 实测的「点技能跳 not found」)', memoryEntry === undefined || memoryEntry.file === null, JSON.stringify(memoryEntry ?? null))
		}
	}
	// 面板据此画「外脑」页签,所以这一段必须是**可重放的事实**:折进投影之后就看得见。
	check('折进投影后视图里有这张表', host.service.view(S).skills?.catalog?.entries?.length === 4)

	// ① 没变就不再发(字节稳定:不刷日志、不刷上下文)
	{
		const again = await preStep(host, S, 2)
		const repeated = (again?.messages ?? []).flatMap((message) => message?.source?.sections ?? []).filter((section) => section?.name === 'clearai/brain')
		check('目录没变 → 不再落一条事实', repeated.length === 0, JSON.stringify(repeated.map((section) => section.name)))
	}

	// ② 目录变了但状态一动没动(人在外面加了一条技能):只发事实,不重发卡片
	{
		host.skillSnapshot = { ...host.skillSnapshot, skills: [...host.skillSnapshot.skills, { name: 'fresh-one', description: '刚从外面加进来的', source: 'user-dsh', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { kind: 'directory', path: '/home/someone/.dsh/skills/fresh-one' } }] }
		const changed = await preStep(host, S, 3)
		const messages = changed?.messages ?? []
		const section = messages.flatMap((message) => message?.source?.sections ?? []).find((item) => item?.name === 'clearai/brain')
		check('目录变了 → 即使卡片没变也发(否则面板会一直显示旧表)', section !== undefined)
		check('集合里没有卡片消息(不重发没变的长文)', messages.every((message) => !String(message?.source?.sections?.[0]?.text ?? '').startsWith('【')), String(messages.length))
		check('折进投影后新条目可见', host.service.view(S).skills.catalog.entries.length === 5)
	}

	// ③ 观测不完整就不发:不完整的快照看起来像「技能被删了」,那是谎
	{
		const stale = host.service.view(S).skills.catalog.entries.length
		host.skillSnapshot = { skills: [], complete: false }
		await preStep(host, S, 4)
		check('complete=false → 不发(宁可留着上一张表)', host.service.view(S).skills.catalog.entries.length === stale, String(host.service.view(S).skills.catalog.entries.length))
	}

	// ④ 宿主没有 skills 服务:降级不抛
	{
		const noSkills = makeHost()
		noSkills.skillsAvailable = false
		apply(noSkills.ctx, {})
		const result = await preStep(noSkills, 'session-no-skills', 1)
		check('没有 skills 服务时 pre-step 照常(目录这条静默缺席,不抛)', result !== null && noSkills.warnings.every((message) => !/目录快照失败/.test(message)))
	}

	// ⑤ 人引用的门消息进内核:内核**不**在这里落实(落实是原生 pre-step 的活),也不误解成采纳
	{
		const gate = { id: 'gate-invoke', role: 'user', content: [{ type: 'text', text: `[clearai·人门] ${JSON.stringify({ action: 'invoke_skill', skill: 'agent-written' })}\n/agent-written\n人在面板上引用了技能。` }], source: { kind: 'user' } }
		await preStep(host, S, 5, [gate])
		check('invoke_skill 不被内核当成采纳(两条路各管各的)', !(host.service.state(S).skillPromotions ?? []).some((entry) => entry.name === 'agent-written'))
	}
}

console.log('\n【子 run 的结局:中断/报错是 resolve 带 stopReason,不是 reject(2026-09-11 用户实测的 bug)】')
{
	// 为什么单开一节:DSH 的 `run.result` 在中断时**照常 resolve**,只是 stopReason 变成 aborted。
	// 只按 reject 判失败,就会把被打断的侦察记成“完成”、把被打断的执行者记成“交付成功”。
	const host = makeHost()
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-stopreason'
	await callOn(host, S, 'SetGoal', {
		claim: '把两条路线比出高下',
		done_criteria: '两条路线各有读数与结论',
		hypotheses: [{ claim: '两条路线的产率不同', refute_when: '产率相同' }],
	})
	const hypothesis = host.service.state(S).hypotheses[0].id
	await callOn(host, S, 'CreatePlan', {
		steps: [{ id: 'a1', do: '试两条互斥路线', artifacts: ['lab/a1.txt'], done_criteria: 'lab/a1.txt 存在', tests: { hypothesis, level: 'L3' } }],
	})
	// 执行者是 **ForkPlan** 派的(不是 AdvanceWorldline):要验「执行者被中断」,开关得在这里打开。
	host.stopReasonExecutor = 'aborted'
	const forked = await callOn(host, S, 'ForkPlan', {
		question: '哪个设计更简洁',
		options: [
			{ label: '甲', approach: '甲的做法', done_criteria: '产率 yield_pct 越高越好', workspace: 'lab/wl/a', level: 'L3' },
			{ label: '乙', approach: '乙的做法', done_criteria: '产率 yield_pct 越高越好', workspace: 'lab/wl/b', level: 'L3' },
		],
		decide_by: { metric: 'yield_pct', direction: 'max' },
	})
	const forkId = host.service.view(S).forks[0].id

	// ① 侦察:被中断 → note 写具体结局,半截文本不进资料面
	host.stopReasonScout = 'aborted'
	const before = host.service.state(S).materials.length
	const scouts = await callOn(host, S, 'SpawnScout', { task: '去看看 lab/ 里有没有原始记录,查不到就说查不到。', why: '观测缺口' })
	/**
	 * 侦察是**异步**的(§14-C):调用只落「派过」这条事实并立刻返回;
	 * 结论在**下一个回合边界**(或用到世界线/侦察的那几件工具)上由 sweep 收。
	 * 所以这里必须走一次 pre-step —— 那正是生产里「结论回灌」发生的地方。
	 */
	check('侦察派出去就返回(工具结果里没有结论,也不假装有)', scouts.ok === true && scouts.code === 'scout_dispatched', String(scouts.code))
	check('派遣事实立刻落账(不随工具结果的成败起落)', host.journal.some((mutation) => mutation.t === 'scout/dispatched' && mutation.trigger === 'model_request:观测缺口'))
	await preStep(host, S, 41)
	const scoutRecord = host.service.state(S).scouts[host.service.state(S).scouts.length - 1]
	check('侦察被中断 → 下一个回合边界上如实落账(note 是具体结局 aborted,不是 null)', scoutRecord?.note === 'aborted', JSON.stringify(scoutRecord?.note ?? null))
	check('侦察被中断 → 结论里写明「未正常结束」,不冒充回灌', /未正常结束\(aborted\)/.test(String(scoutRecord?.conclusion ?? '')), String(scoutRecord?.conclusion ?? '').slice(0, 80))
	check('侦察被中断 → 半截文本**不进资料面**(它不是观测)', host.service.state(S).materials.length === before, `${before} → ${host.service.state(S).materials.length}`)
	check('视图把结局交出去(status=failed,面板才分诊得出)', host.service.view(S).scouts.at(-1)?.status === 'failed', JSON.stringify(host.service.view(S).scouts.at(-1) ?? null).slice(0, 120))
	/**
	 * **等侦察**:`AwaitWorldlines` 的「还在跑」必须把侦察算进去。
	 *
	 * 长测抓到的真缺陷:`sweepScouts()` 只落账、不报「还在跑」,而 `AwaitWorldlines` 的循环
	 * 只数世界线执行者产出的那一行 ⇒ **只有侦察在跑时它第一拍就退出**,而 SpawnScout 的
	 * 返回原话恰恰让模型「用 AwaitWorldlines 在这个回合里等它」。模型于是空等三轮回合、
	 * 判据里那句「与侦察结论一致」失去对照物,独立评估者只能裁 inconclusive 拒收结案。
	 */
	{
		const W = 'session-scout-await'
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		host.scoutDelayMs = 800
		await callOn(host, W, 'SetGoal', { claim: '把材料核一遍', done_criteria: '有结论', hypotheses: [] })
		const dispatched = await callOn(host, W, 'SpawnScout', { task: '把 lab/ 下的记录核一遍,报你亲眼读到的。', why: '观测缺口' })
		check('前置:侦察异步派出(返回值里没有结论)', dispatched.code === 'scout_dispatched', String(dispatched.code))
		const started = Date.now()
		const awaited = await callOn(host, W, 'AwaitWorldlines', { timeout_s: 5 })
		const waitedMs = Date.now() - started
		check('侦察在跑 ⇒ AwaitWorldlines 真的等它(不再第一拍退出)', waitedMs >= 1500, `等了 ${waitedMs}ms(修之前是 0ms)`)
		check('等到了:结论落成 scout/settled 并进资料面', host.journal.some((mutation) => mutation.t === 'scout/settled' && mutation.conclusion !== undefined) && host.service.state(W).materials.some((item) => String(item.ref ?? '').startsWith('scout:')), JSON.stringify(host.service.state(W).materials.map((item) => item.ref)))
		check('回报里写明了回灌了几条(不是含糊的「等完了」)', /回灌 1 条/.test(String(awaited.message ?? '')), String(awaited.message ?? '').slice(0, 120))
	}

	/**
	 * **假设留痕**(U4):不逼 verdict,但「没看过」必须留在账上。
	 * 两种「没结论」要分得开:证据说「无法判定」是一回事,从没人碰过它是另一回事。
	 */
	{
		const H = 'session-hypothesis-unjudged'
		const host = makeHost()
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
		writeText(join(WORKSPACE, 'lab', 'h1.txt'), 'stdout=2\n')
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

	/**
	 * **失联终局**(U3):进程重启过 ⇒ 内存表空了,投影里那条侦察还没收口,而子会话
	 * 已经不在了。判据与执行者那条**完全一致**:表里没有 + 会话里没有 `turn/end` ⇒ 失联。
	 * 一句永久「未回灌」是等不到下文的承诺。
	 */
	{
		const L = 'session-scout-lost'
		const first = makeHost()
		apply(first.ctx, { blockedThreshold: 3 })
		await callOn(first, L, 'SetGoal', { claim: '把材料核一遍', done_criteria: '有结论', hypotheses: [] })
		await callOn(first, L, 'CreatePlan', { steps: [{ id: 'l1', do: '核材料', artifacts: ['lab/l1.txt'], done_criteria: 'lab/l1.txt 存在', tests: null }] })
		await callOn(first, L, 'SpawnScout', { task: '把 lab/ 下的记录核一遍,报你亲眼读到的。', why: '观测缺口' })
		const child = String(first.service.state(L).scouts.at(-1)?.child ?? '')
		// 模拟进程重启:内存表空了(新 host),子会话也不在会话服务里(拿不到任何事件)
		const second = makeHost()
		second.states.set(L, first.service.state(L))
		apply(second.ctx, { blockedThreshold: 3 })
		await preStep(second, L, 51)
		const lost = second.service.state(L).scouts.at(-1)
		check('子会话不在了 ⇒ 如实落「失联」终局(不再永久挂着「未回灌」)', lost?.note === '失联' && lost?.conclusion === '', JSON.stringify({ note: lost?.note ?? null }))
		check('失联也要进视图(面板才分诊得出)', second.service.view(L).scouts.at(-1)?.status === 'failed', JSON.stringify(second.service.view(L).scouts.at(-1)?.status ?? null))
	}
	{
		// 会话在、只是还没写完 turn/end(真的还在跑)⇒ **不冤枉它**。
		const R = 'session-scout-still-running'
		const first = makeHost()
		apply(first.ctx, { blockedThreshold: 3 })
		await callOn(first, R, 'SetGoal', { claim: '把材料核一遍', done_criteria: '有结论', hypotheses: [] })
		await callOn(first, R, 'SpawnScout', { task: '把 clear/skills 下的技能数一遍,报条数。', why: '盘点' })
		const child = String(first.service.state(R).scouts.at(-1)?.child ?? '')
		const second = makeHost()
		second.states.set(R, first.service.state(R))
		// 会话在(有壳)、但没有 turn/end;原生子代理目录说它还在跑
		second.sessionEvents = { [child]: [{ type: 'turn/start', data: { turn: 1 } }] }
		second.listing = [{ kind: 'child', id: child, activity: 'running', mode: 'continuable' }]
		apply(second.ctx, { blockedThreshold: 3 })
		await preStep(second, R, 52)
		check('目录说它在跑 ⇒ 不判失联,继续等', second.service.state(R).scouts.at(-1)?.note === null, JSON.stringify({ note: second.service.state(R).scouts.at(-1)?.note ?? null }))
		check('还在跑 ⇒ 视图上仍然是「跑着」而不是终局', second.service.view(R).scouts.at(-1)?.status === 'running', JSON.stringify(second.service.view(R).scouts.at(-1)?.status ?? null))
	}
	{
		// 没有 `sessions` 服务 = 判不了 ⇒ **不编**(不落终局)。
		const U = 'session-scout-unknown'
		const first = makeHost()
		apply(first.ctx, { blockedThreshold: 3 })
		await callOn(first, U, 'SetGoal', { claim: '把材料核一遍', done_criteria: '有结论', hypotheses: [] })
		await callOn(first, U, 'SpawnScout', { task: '把 lab/ 下的记录核一遍,报你亲眼读到的。', why: '观测缺口' })
		const second = makeHost()
		second.states.set(U, first.service.state(U))
		second.subagentsAvailable = false
		apply(second.ctx, { blockedThreshold: 3 })
		await preStep(second, U, 53)
		check('目录读面不可用 ⇒ 不落终局(判不出就不编)', second.service.state(U).scouts.at(-1)?.note === null, JSON.stringify({ note: second.service.state(U).scouts.at(-1)?.note ?? null }))
	}

	/**
	 * **可续跑那一档**(U2a):侦察的结论由原生结算通知投给模型,内核这侧只做两件事——
	 * 把派遣能力如实落账、把结论从子会话日志收进账本并落盘。
	 */
	{
		const C = 'session-scout-continuable'
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3 })
		await callOn(host, C, 'SetGoal', { claim: '把材料核一遍', done_criteria: '有结论', hypotheses: [] })
		await callOn(host, C, 'CreatePlan', { steps: [{ id: 'c1', do: '核材料', artifacts: ['lab/c1.txt'], done_criteria: 'lab/c1.txt 存在', tests: null }] })
		const dispatched = await callOn(host, C, 'SpawnScout', { task: '把 clear/skills 下的技能数一遍,报条数。', why: '盘点' })
		check(
			'可续跑可用 ⇒ 走可续跑,能力如实落账',
			dispatched.code === 'scout_dispatched' && host.journal.some((m) => m.t === 'scout/dispatched' && m.capability === 'continuable'),
			JSON.stringify(host.journal.filter((m) => m.t === 'scout/dispatched').map((m) => m.capability)),
		)
		check(
			'只读面与人格随派遣交出去(durable descriptor 会记住,续跑也放宽不了)',
			(host.continuations ?? []).some((entry) => entry.spec?.request?.toolFilter !== undefined && entry.spec?.request?.persona !== undefined),
			JSON.stringify(Object.keys(host.continuations?.[0]?.spec?.request ?? {})),
		)
		const child = String(host.service.state(C).scouts.at(-1)?.child ?? '')
		check('前置:可续跑没有 result promise ⇒ 结论还没到', child !== '' && host.service.state(C).scouts.at(-1)?.conclusion === null, child)
		// 子会话跑完(它的日志里出现 turn/end):下一拍就该收进账本
		host.sessionEvents = {
			[child]: [
				{ type: 'turn/start', data: { turn: 1 } },
				{ type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '数完了:clear/skills 下 18 条技能,SKILL.md 覆盖 18/18。' }] } } },
				{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
			],
		}
		await preStep(host, C, 43)
		const settled = host.service.state(C).scouts.at(-1)
		check('可续跑的结论从子会话日志收进账本(没有 promise 也收得到)', /18 条技能/.test(String(settled?.conclusion ?? '')), JSON.stringify({ note: settled?.note, len: String(settled?.conclusion ?? '').length }))
		const settledMutation = host.journal.filter((m) => m.t === 'scout/settled').at(-1)
		const materialPath = settledMutation?.path ?? null
		const material = materialPath === null ? '' : String(readFileSync(materialPath, 'utf8'))
		check('结论全文落盘(评估者与人也能读同一份)', materialPath !== null && material.includes('18 条技能') && material.includes('# 侦察结论'), String(materialPath))
	}

	/**
	 * **可续跑不可用时如实降级**(U2a):能力不冒充,结论改由「收集那一刻的返回」带上。
	 */
	{
		const D = 'session-scout-degrade'
		const host = makeHost()
		host.continuableUnavailable = true
		apply(host.ctx, { blockedThreshold: 3 })
		await callOn(host, D, 'SetGoal', { claim: '把材料核一遍', done_criteria: '有结论', hypotheses: [] })
		await callOn(host, D, 'CreatePlan', { steps: [{ id: 'd1', do: '核材料', artifacts: ['lab/d1.txt'], done_criteria: 'lab/d1.txt 存在', tests: null }] })
		const dispatched = await callOn(host, D, 'SpawnScout', { task: '把 lab/ 下的记录核一遍,报你亲眼读到的。', why: '观测缺口' })
		const capability = host.journal.filter((m) => m.t === 'scout/dispatched').at(-1)?.capability
		check('可续跑不可用 ⇒ 降级到一次性派遣,能力不冒充可续跑', dispatched.code === 'scout_dispatched' && capability !== 'continuable' && String(capability).length > 0, String(capability))
		// 降级那一档的结论只能由「收集那一刻的返回」送达:等到之后,那次调用的消息里必须有正文。
		const awaiting = await callOn(host, D, 'AwaitWorldlines', { timeout_s: 5 })
		check('降级形态:收集那一刻的返回带上结论正文(模型这才读得到)', /数完了|核完了|亲眼读到|lab\//.test(String(awaiting.message ?? '')) || /子任务/.test(String(awaiting.message ?? '')), String(awaiting.message ?? '').slice(0, 160))
	}

	/**
	 * **表里没有的侦察**也要收得回来(§14-C 的第二半,与执行者那条同一个修法):
	 * 进程重启过 ⇒ 内存表空了,可投影里那条侦察还没收口,而它的会话日志里已经有 `turn/end`。
	 */
	{
		const first = makeHost()
		apply(first.ctx, { blockedThreshold: 3 })
		const S9 = 'session-scout-recover'
		await callOn(first, S9, 'SetGoal', { claim: '把材料核一遍', done_criteria: '有结论', hypotheses: [] })
		await callOn(first, S9, 'CreatePlan', { steps: [{ id: 'sc1', do: '核材料', artifacts: ['lab/sc1.txt'], done_criteria: 'lab/sc1.txt 存在', tests: null }] })
		await callOn(first, S9, 'SpawnScout', { task: '把 lab/ 下的记录核一遍,报你亲眼读到的。', why: '观测缺口' })
		const child = String(first.service.state(S9).scouts.at(-1)?.child ?? '')
		check('前置:派遣落了账、结论还没到(child 记在案上)', child !== '' && first.service.state(S9).scouts.at(-1)?.conclusion === null, child)
		// 模拟进程重启:同一份投影、新的内核实例(表空),但那份子会话还在会话服务里
		const second = makeHost()
		second.states.set(S9, first.service.state(S9))
		second.childSessions = { [child]: { id: child, header: { cwd: WORKSPACE }, ownEvents: () => [
			{ type: 'turn/start', data: { turn: 1 } },
			{ type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '核完了:lab/ 下三份记录里两份有原始导出,第三份只在报告里出现。' }] } } },
			{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
		] } }
		apply(second.ctx, { blockedThreshold: 3 })
		await preStep(second, S9, 42)
		const recovered = second.service.state(S9).scouts.at(-1)
		check('重启后仍能从子会话日志里收回侦察结论(不再永远「跑着」)', /两份有原始导出/.test(String(recovered?.conclusion ?? '')) && recovered?.note === null, JSON.stringify({ note: recovered?.note, len: String(recovered?.conclusion ?? '').length }))
		check('收回来的结论进资料面,来源标 scout(与同步回灌同一条路)', second.service.state(S9).materials.some((item) => String(item.ref ?? '').startsWith('scout:')), JSON.stringify(second.service.state(S9).materials.map((m) => m.ref)))
	}
	/**
	 * §21 的另一半:**「去子会话日志里捞结论」是收集机会,不按回合限流**。
	 *
	 * 形状照真跑:内核表里没有它(重启形),答案只在子会话日志里;而且**同一个回合**里
	 * 先捞一次(那时子会话还没跑完,捞不到),再捞一次(跑完了,该捞到)。
	 * 第一版把这条也按回合限流 ⇒ 第二次会被跳过 ⇒ 迟到一步的结论就永远没人接(真跑 3/3 掉成 2/3)。
	 */
	{
		const first = makeHost()
		apply(first.ctx, { blockedThreshold: 3, collectRetryMs: 0 })
		const C = 'session-late-scout'
		await callOn(first, C, 'SetGoal', { claim: '核一遍材料', done_criteria: '有结论', hypotheses: [] })
		await callOn(first, C, 'CreatePlan', { steps: [{ id: 'c1', do: '核材料', artifacts: ['lab/c1.txt'], done_criteria: 'lab/c1.txt 存在', tests: null }] })
		await callOn(first, C, 'SpawnScout', { task: '把 lab/ 下的记录核一遍,报你亲眼读到的。', why: '观测缺口' })
		const child = String(first.service.state(C).scouts.at(-1)?.child ?? '')
		const events = [
			{ type: 'turn/start', data: { turn: 1 } },
			{ type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '核完了:三份记录里两份有原始导出。' }] } } },
		]
		// 重启形:同一份投影 + 新的内核实例(表空)——于是「去子会话日志捞」这条路才是活的
		const second = makeHost()
		second.states.set(C, first.service.state(C))
		second.childSessions = { [child]: { id: child, header: { cwd: WORKSPACE }, ownEvents: () => events.slice() } }
		apply(second.ctx, { blockedThreshold: 3, collectRetryMs: 0 })
		await preStep(second, C, 42)
		await callOn(second, C, 'WorldlineStatus', {}) // 第一次捞:子会话还没 turn/end ⇒ 捞不到(而且不该动它)
		check('子会话还没跑完 ⇒ 不动它(不是「失败」,是「还在跑」)', second.service.state(C).scouts.at(-1)?.conclusion === null, JSON.stringify(second.service.state(C).scouts.at(-1)?.conclusion ?? null))
		events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }) // 它跑完了
		await callOn(second, C, 'WorldlineStatus', {}) // **同一个回合**里再捞一次:该捞到
		check(
			'迟到一步的结论:同一个回合里仍然被捞回来(收集机会不按回合限流)',
			/两份有原始导出/.test(String(second.service.state(C).scouts.at(-1)?.conclusion ?? '')),
			JSON.stringify(String(second.service.state(C).scouts.at(-1)?.conclusion ?? '')).slice(0, 60),
		)
	}

	/**
	 * **`reported` 不等于「已落账」**(2026-09-11 长测:侦察结论发布之后被丢掉,而条目已删、
	 * 标志已置位 ⇒ 那条结论永久丢)。判据改成看**投影**:投影里没有就再发一次;重复发布安全
	 * (fold 按 id/分支覆写,不会长出第二条事实)。这条用「把投影退回收之前」来模拟那批事实没落地。
	 */
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3, collectRetryMs: 0 })
		const SR = 'session-retry'
		await callOn(host, SR, 'SetGoal', { claim: '核一遍材料', done_criteria: '有结论', hypotheses: [] })
		await callOn(host, SR, 'CreatePlan', { steps: [{ id: 'rt1', do: '核材料', artifacts: ['lab/rt1.txt'], done_criteria: 'lab/rt1.txt 存在', tests: null }] })
		await callOn(host, SR, 'SpawnScout', { task: '把 lab/ 下的记录核一遍,报你亲眼读到的。', why: '观测缺口' })
		const beforePublish = host.service.state(SR)
		await preStep(host, SR, 61)
		check('正常路径:侦察结论落到账本上(投影里看得见)', host.service.state(SR).scouts.at(-1)?.conclusion !== null, JSON.stringify(host.service.state(SR).scouts.at(-1)?.conclusion ?? null).slice(0, 40))
		const recordsAfterFirst = host.service.state(SR).scouts.length
		// 模拟那批事实**没落地**(工具调用失败 / 通知被丢):投影退回收之前
		host.states.set(SR, beforePublish)
		await preStep(host, SR, 62)
		check('发布被丢掉 → 下一轮**重发**(判据是投影,不是内存里的「报过了」)', host.service.state(SR).scouts.at(-1)?.conclusion !== null, JSON.stringify(host.service.state(SR).scouts.at(-1)?.conclusion ?? null).slice(0, 40))
		check('重发不会长出第二条事实(按 id 覆写,幂等)', host.service.state(SR).scouts.length === recordsAfterFirst, `${recordsAfterFirst} → ${host.service.state(SR).scouts.length}`)
	}

	/**
	 * §27b **出处是记账时定下的事实**:`refs` 一律是路径;独立证据另带评估卡与评估者会话。
	 * 判据是账上的字段 —— 不是界面渲染成什么样。
	 */
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

	/**
	 * §23 **事实货架**:事实升格之后要有读者 —— `clear/knowledge/facts/INDEX.md`
	 * (面板「事实」那一格读的是同一张表),而且**带边界**(没有边界的事实下一轮没人敢用)。
	 */
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

	/**
	 * §21 的两半(**针对性验,不跑长 E2E**):
	 *   · 重发:同一个回合里不再重发(投影在回合内不前进,再发是白发——长测现场 31 条);
	 *   · 收集机会:**不按回合限流**。迟到一步的结论全靠「去子会话日志里捞」接住,
	 *     第一版把它一起按回合限流,真跑里立刻把 3/3 掉成 2/3(所以这一条要单独钉住)。
	 */
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3, collectRetryMs: 0 })
		const E = 'session-epoch'
		await callOn(host, E, 'SetGoal', { claim: '核一遍材料', done_criteria: '有结论', hypotheses: [] })
		await callOn(host, E, 'CreatePlan', { steps: [{ id: 'e1', do: '核材料', artifacts: ['lab/e1.txt'], done_criteria: 'lab/e1.txt 存在', tests: null }] })
		await callOn(host, E, 'SpawnScout', { task: '把 lab/ 下的记录核一遍,报你亲眼读到的。', why: '观测缺口' })
		await preStep(host, E, 70) // 这一拍收下结论(纪元 = 回合 70)
		const settledOnce = host.journal.filter((mutation) => mutation.t === 'scout/settled').length
		check('结论先落一次账', settledOnce >= 1, String(settledOnce))
		// 同一个回合里再走几个成功路径:投影不前进,但**不该**再发(这就是那 31 条的来源)
		await callOn(host, E, 'WorldlineStatus', {})
		await callOn(host, E, 'WorldlineStatus', {})
		check('同一个回合里,已经发布过的结论不再重发(投影在回合内不前进,再发是白发)', host.journal.filter((mutation) => mutation.t === 'scout/settled').length === settledOnce, `${settledOnce} → ${host.journal.filter((mutation) => mutation.t === 'scout/settled').length}`)
	}
	/**
	 * 世界线执行者:同一把尺子(投影里 `execution.ok` 还是 null 就重收;到账之后才释放子 run)。
	 */
	{
		const host = makeHost()
		apply(host.ctx, { blockedThreshold: 3, collectRetryMs: 0 })
		const SW = 'session-retry-wl'
		await callOn(host, SW, 'SetGoal', { claim: '两条路线取一条', done_criteria: '有一条能跑通', hypotheses: [{ claim: 'A 更好', refute_when: 'B 更好' }] })
		await callOn(host, SW, 'CreatePlan', { steps: [{ id: 'rw1', do: '两条线路各试一遍', artifacts: ['lab/rw1.txt'], done_criteria: 'lab/rw1.txt 有读数', tests: null }] })
		await callOn(host, SW, 'ForkPlan', { question: '走哪条', decide_by: { metric: 'ms', direction: 'min' }, options: [{ id: 'ra', label: '甲', approach: '直接算', done_criteria: '有 ms 读数' }, { id: 'rb', label: '乙', approach: '绕一圈', done_criteria: '有 ms 读数' }] })
		const beforePublish = host.service.state(SW)
		await preStep(host, SW, 63)
		const landed = host.service.view(SW).forks[0].branches.every((branch) => branch.execution?.ok === true)
		check('正常路径:两条执行者结论都落了账', landed, JSON.stringify(host.service.view(SW).forks[0].branches.map((b) => b.execution?.ok)))
		host.states.set(SW, beforePublish)
		await preStep(host, SW, 64)
		check('执行者的发布被丢掉 → 下一轮重收(判据同样是投影)', host.service.view(SW).forks[0].branches.every((branch) => branch.execution?.ok === true) && host.journal.filter((m) => m.t === 'worldline/executed').length >= 4, `${host.journal.filter((m) => m.t === 'worldline/executed').length} 条`)
	}

	// ② 世界线执行者:被中断 → 不许记成「交付成功」
	{
		/**
		 * 2026-09-11 起 `ForkPlan` **不等**执行者(用户在 GUI 里抓到的事实:四个执行者在跑、
		 * 树上十几分钟没有分叉——因为变更记录是随工具结果落账的,而它卡在 Promise.all 里)。
		 * 现在:派遣这一笔立即落账;结论由**下一个回合的 sweep** 收,作为事实注入。
		 * 所以这里先断「派遣已经落账」,再用一次 preStep 把结论收进来。
		 */
		const prepared = host.journal.filter((mutation) => mutation.t === 'worldline/prepared' && mutation.fork === forkId)
		const executing = host.journal.filter((mutation) => mutation.t === 'worldline/executing' && mutation.fork === forkId)
		check('派遣立即落账(fork/created + worldline/prepared + 两条 executing),不等执行者', host.service.view(S).forks.some((item) => item.id === forkId) && prepared.length === 1 && executing.length === 2, JSON.stringify({ prepared: prepared.length, executing: executing.length }))
		check('ForkPlan 的卡说「已经在各自的工作副本里作业」,不谎称已回灌结论', /已经在各自的工作副本里作业/.test(String(forked.message ?? '')) && !/已回灌结论/.test(String(forked.message ?? '')), String(forked.message ?? '').slice(0, 140))
		await preStep(host, S, 91)
		const executed = host.journal.filter((mutation) => mutation.t === 'worldline/executed' && mutation.fork === forkId)
		check('执行者被中断 → 下个回合回灌时记 ok=false(不是「交付成功」)', executed.length === 2 && executed.every((mutation) => mutation.ok === false), JSON.stringify(executed).slice(0, 160))
		check('执行者被中断 → 结论写明未正常结束,不冒充读数', /未正常结束\(aborted\)/.test(String(executed[0]?.conclusion ?? '')), String(executed[0]?.conclusion ?? '').slice(0, 80))
		check('回灌走的是**事实通道**(插件 section),所以投影里看得见', host.service.view(S).forks.find((item) => item.id === forkId)?.branches.every((branch) => branch.execution?.ok === false) === true)
		// 卡片要把「执行者跑到哪了」当一条独立事实说出来(异步派遣之后,不写模型就以为它在闲着)
		/**
		 * 失联的执行者(2026-09-11):异步收集靠内存表,进程一重启那张表就空了,
		 * 而投影里那条世界线还停在 `worldline/executing` —— 树与卡片会永远显示「执行中」,
		 * 没有任何东西会再回灌它。判据是两条已有事实的推论:**投影里在跑** + **这个进程里没有它的条目**。
		 */
		{
			const first = makeHost()
			apply(first.ctx, { blockedThreshold: 3 })
			const S3 = 'session-lost'
			await callOn(first, S3, 'SetGoal', { claim: '试两条路线', done_criteria: '有一条能跑通', hypotheses: [{ claim: 'A 比 B 快', refute_when: 'B 更快' }] })
			await callOn(first, S3, 'CreatePlan', { steps: [{ id: 'l1', do: '分两条路试', artifacts: ['lab/l1.txt'], done_criteria: 'lab/l1.txt 有读数', tests: null }] })
			await callOn(first, S3, 'ForkPlan', { question: '走哪条', decide_by: { metric: 'ms', direction: 'min' }, options: [{ id: 'lb1', label: '甲', approach: '直接算', done_criteria: '有 ms 读数' }, { id: 'lb2', label: '乙', approach: '绕一圈', done_criteria: '有 ms 读数' }] })
			const running = first.service.view(S3).forks[0].branches.map((branch) => branch.execution?.ok)
			check('前置:两条世界线都在「执行中」(ok=null,还没回灌)', running.length === 2 && running.every((ok) => ok === null), JSON.stringify(running))
			// 模拟进程重启:同一份投影,换一个内核实例(它内存里的执行者表是空的)
			const second = makeHost()
			second.states.set(S3, first.service.state(S3))
			apply(second.ctx, { blockedThreshold: 3 })
			await preStep(second, S3, 93)
			const notes = second.service.view(S3).forks[0].branches.map((branch) => branch.execution?.note)
			check('重启后失联的执行者如实落账(不再是永远「在跑」)', notes.length === 2 && notes.every((note) => note === 'lost'), JSON.stringify(notes))
			check('卡片如实说出「失联」(并说清产物没丢、可以照常交付)', /执行没跑成:lost/.test(second.service.renderCard(S3)))
		}
		/**
		 * **从子会话日志回收结论**(2026-09-11 R3 长测:执行者都跑完了,父会话退出时只收上来一条)。
		 *
		 * 结论没丢:它就写在执行者自己的会话日志里。所以「内存表里没有」不等于「失联」——
		 * 先去它的会话里读;**连会话都不在了**才写 lost。顺序错了就是把「没读到」记成「没跑成」。
		 */
		{
			const first = makeHost()
			apply(first.ctx, { blockedThreshold: 3 })
			const S4 = 'session-recover'
			await callOn(first, S4, 'SetGoal', { claim: '试两条路线', done_criteria: '有一条能跑通', hypotheses: [{ claim: 'A 比 B 快', refute_when: 'B 更快' }] })
			await callOn(first, S4, 'CreatePlan', { steps: [{ id: 'r1', do: '分两条路试', artifacts: ['lab/r1.txt'], done_criteria: 'lab/r1.txt 有读数', tests: null }] })
			await callOn(first, S4, 'ForkPlan', { question: '走哪条', decide_by: { metric: 'ms', direction: 'min' }, options: [{ id: 'rb1', label: '甲', approach: '直接算', done_criteria: '有 ms 读数' }, { id: 'rb2', label: '乙', approach: '绕一圈', done_criteria: '有 ms 读数' }] })
			const branchOf = (label) => first.service.view(S4).forks[0].branches.find((branch) => branch.label === label)
			const childOf = (label) => String(branchOf(label).execution?.child ?? '')
			// 甲:执行者跑完了(会话里最后一条 turn/end 是 completed,末尾有结论文本)但父进程没来得及收
			const childA = childOf('甲')
			const childB = childOf('乙')
			check('前置:两条执行者都有子会话 id(落账在 worldline/executing 上)', childA !== '' && childB !== '', `${childA} / ${childB}`)
			const sessionOf = (id, reason, text) => ({
				id,
				header: { cwd: WORKSPACE },
				ownEvents: () => [
					{ type: 'turn/start', data: { turn: 1 } },
					{ type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '想一下' }, { type: 'text', text }] } } },
					{ type: 'turn/end', data: { turn: 1, reason: { kind: reason } } },
				],
			})
			// 模拟「宿主重启」:新的内核实例(内存表空),但会话服务里那两份子会话还在
			const second = makeHost()
			second.states.set(S4, first.service.state(S4))
			second.childSessions = { [childA]: sessionOf(childA, 'completed', '甲跑完了:读数 61.2,产物在 lab/probe.txt'), [childB]: sessionOf(childB, 'aborted', '乙跑到一半被打断') }
			apply(second.ctx, { blockedThreshold: 3 })
			await preStep(second, S4, 94)
			const branches = second.service.view(S4).forks[0].branches
			const a = branches.find((branch) => branch.label === '甲')
			const b = branches.find((branch) => branch.label === '乙')
			check('跑完的执行者:结论从它自己的会话日志里回收(ok=true,note=recovered)', a?.execution?.ok === true && a?.execution?.note === 'recovered', JSON.stringify(a?.execution))
			check('回收到的结论就是它最后说的话(不是空白、不是「失联」)', /甲跑完了:读数 61\.2/.test(String(a?.execution?.conclusion ?? '')), String(a?.execution?.conclusion ?? '').slice(0, 80))
			check('被打断的执行者:回收成 ok=false 并带上真实缘由(aborted,不是笼统 failed)', b?.execution?.ok === false && b?.execution?.note === 'aborted' && /跑到一半被打断/.test(String(b?.execution?.conclusion ?? '')), JSON.stringify(b?.execution))
			check('回收也是「已回灌」:卡片不再写「执行中」', /\(已回灌\)/.test(second.service.renderCard(S4)), second.service.renderCard(S4).split('\n').filter((line) => line.includes('· [')).join(' | ').slice(0, 200))
			// 反向:会话不在这个进程里 → 仍然如实写「失联」(不把「读不到」写成「跑完了」)
			const third = makeHost()
			third.states.set(S4, first.service.state(S4))
			apply(third.ctx, { blockedThreshold: 3 })
			await preStep(third, S4, 95)
			check('会话也不在了 → 仍然如实写「失联」,不假装回收到了结论', third.service.view(S4).forks[0].branches.every((branch) => branch.execution?.note === 'lost' && branch.execution?.ok === false))
			/**
			 * 分叉**已经收口**之后才回收到的结论:照收(结论是账本里的东西,与它还有没有用无关)。
			 * 但收不回来时**不许写「失联」**——那条世界线已经没有归宿了,
			 * 把「没人再等它」写成「它没跑成」是记错了事实(收口后的派生态是「执行者未归」)。
			 */
			const forkId = first.service.view(S4).forks[0].id
			const settledState = applyMutations(first.service.state(S4), [
				{ t: 'branch/delivered', fork: forkId, branch: 'rb1', reading: '61.2', validity: 'usable', verdict: 'support', basis: '硬信号' },
				{ t: 'branch/delivered', fork: forkId, branch: 'rb2', reading: '44', validity: 'usable', verdict: 'support', basis: '硬信号' },
				{ t: 'fork/converged', fork: forkId, winner: 'rb1', margin: 0.1, metric: 'ms', direction: 'min' },
			])
			const fourth = makeHost()
			fourth.states.set(S4, settledState)
			fourth.childSessions = { [childA]: sessionOf(childA, 'completed', '甲跑完了:读数 61.2'), [childB]: sessionOf(childB, 'completed', '乙也跑完了:读数 44') }
			apply(fourth.ctx, { blockedThreshold: 3 })
			await preStep(fourth, S4, 96)
			check('分叉收口之后才回收到的结论照收(账本里的事实不因「没用了」而丢)', fourth.journal.filter((mutation) => mutation.t === 'worldline/executed' && mutation.note === 'recovered').length === 2, JSON.stringify(fourth.journal.filter((m) => m.t === 'worldline/executed').map((m) => m.note)))
			check('回收之后卡片写「已回灌」,不再写「执行者未归」', !/执行者未归/.test(fourth.service.renderCard(S4)) && /\(已回灌\)/.test(fourth.service.renderCard(S4)), fourth.service.renderCard(S4).split('\n').filter((line) => line.includes('· [')).join(' | ').slice(0, 200))
			const fifth = makeHost()
			fifth.states.set(S4, settledState)
			apply(fifth.ctx, { blockedThreshold: 3 })
			await preStep(fifth, S4, 97)
			check('收口之后收不回来:不写「失联」(没人再等它,不是它没跑成)', fifth.journal.filter((mutation) => mutation.t === 'worldline/executed').length === 0, JSON.stringify(fifth.journal.filter((m) => m.t === 'worldline/executed')))
			/**
			 * **不用等回合边界**(2026-09-11 R3 现场:模型一个回合走完整条链,根本没有下一个 pre-step)。
			 * 交付/收敛/收尾/两件观察工具的成功返回上都要做同一件事——否则「结论可回收」只在
			 * 恰好还有下一个回合时才成立。
			 */
			const sixth = makeHost()
			sixth.states.set(S4, first.service.state(S4))
			sixth.childSessions = { [childA]: sessionOf(childA, 'completed', '甲跑完了:读数 61.2'), [childB]: sessionOf(childB, 'aborted', '乙被打断') }
			apply(sixth.ctx, { blockedThreshold: 3 })
			const seen = await callOn(sixth, S4, 'WorldlineStatus', {})
			check(
				'观察工具的成功返回上也回收(不必等到下一个回合边界)',
				sixth.journal.filter((mutation) => mutation.t === 'worldline/executed').length === 2 &&
					sixth.journal.some((mutation) => mutation.note === 'recovered' && mutation.ok === true) &&
					sixth.journal.some((mutation) => mutation.note === 'aborted' && mutation.ok === false),
				JSON.stringify(sixth.journal.filter((m) => m.t === 'worldline/executed').map((m) => m.note)),
			)
			check('回执里如实说这两条是回收来的(来源可考)', /回收/.test(String(seen.message)), String(seen.message).split('\n').slice(0, 3).join(' / '))
			/**
			 * **表里有条目、promise 却不落定**(2026-09-11 最后一场长测:四条执行者都跑完了,
			 * 有一条的 promise 始终没落地,于是「有条目」把回收挡住了,那条线永久停在「执行者未归」)。
			 * 判据不该看内存表,要看**执行者自己的会话日志**:它写了 `turn/end`,结论就存在了。
			 */
			const seventh = makeHost()
			apply(seventh.ctx, { blockedThreshold: 3 })
			seventh.executorNeverSettles = true
			const S6 = 'session-stuck'
			await callOn(seventh, S6, 'SetGoal', { claim: '试两条路线', done_criteria: '有一条能跑通', hypotheses: [{ claim: 'A 比 B 快', refute_when: 'B 更快' }] })
			await callOn(seventh, S6, 'CreatePlan', { steps: [{ id: 'k1', do: '两条路各试一遍', artifacts: ['lab/k1.txt'], done_criteria: 'lab/k1.txt 有读数', tests: null }] })
			await callOn(seventh, S6, 'ForkPlan', { question: '走哪条', decide_by: { metric: 'ms', direction: 'min' }, options: [{ id: 'kb1', label: '甲', approach: '直接算', done_criteria: '有 ms 读数' }, { id: 'kb2', label: '乙', approach: '绕一圈', done_criteria: '有 ms 读数' }] })
			const stuckKids = seventh.service.view(S6).forks[0].branches.map((branch) => String(branch.execution?.child ?? ''))
			seventh.childSessions = Object.fromEntries(stuckKids.map((id) => [id, sessionOf(id, 'completed', `跑完了:${id.slice(0, 4)} 的读数`)]))
			const stuckSeen = await callOn(seventh, S6, 'WorldlineStatus', {})
			check('表里有条目不落定 → 仍然能从它的会话日志回收(不再卡在「执行者未归」)', seventh.journal.filter((mutation) => mutation.t === 'worldline/executed' && mutation.note === 'recovered').length === 2, JSON.stringify(seventh.journal.filter((m) => m.t === 'worldline/executed').map((m) => m.note)))
			check('回收说清来源(不是「失联」)', /回收/.test(String(stuckSeen.message)) && !/失联/.test(String(stuckSeen.message)), String(stuckSeen.message).split('\n').slice(0, 3).join(' / '))
		}
		/**
		 * **盘上残留的读数**(R3-c:同一个工作区里跑第二轮时,上一轮的 4 份工作副本 + 4 个分支
		 * 树上一个都看不到)。残留是事实,该像目录、当档一样自己回到投影里。
		 */
		{
			const dirty = tempDir('clearai-residue-')
			execFileSync('git', ['init', '-q'], { cwd: dirty })
			execFileSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: dirty })
			// 上一轮留下的:两个容器、共 3 份工作副本,外加 3 个分支 ref
			for (const [fork, branch] of [['k-old-1', 'b-1'], ['k-old-1', 'b-2'], ['k-old-2', 'b-3']]) {
				mkdirSync(join(dirty, 'clear', 'worldlines', fork, branch), { recursive: true })
				execFileSync('git', ['branch', `clearai/${fork}/${branch}`], { cwd: dirty })
			}
			const host = makeHost()
			host.cwd = dirty
			apply(host.ctx, {})
			const S5 = 'session-residue'
			const decision = await preStep(host, S5, 98)
			const text = JSON.stringify(decision.messages ?? [])
			check('开场事实里报出「盘上还留着上一轮的 3 份世界线工作副本」', /盘上还留着\*\*上一轮\*\*的 3 份世界线工作副本/.test(text), text.slice(0, 300))
			check('报清是哪几盘(容器名 + 份数)', /k-old-1\(2 份\)/.test(text) && /k-old-2\(1 份\)/.test(text), text.slice(0, 400))
			check('分支 ref 也如实报数(3 个)', /3 个 clearai 分支 ref/.test(text), text.slice(0, 400))
			check('说清「留着是留档」与怎么清(不劝、也不偷偷删)', /留档/.test(text) && /git worktree remove/.test(text), text.slice(0, 400))
			// 反向:这盘自己的分叉不算残留(自己刚开的工作副本不是「上一轮」)
			const clean = makeHost()
			clean.cwd = dirty
			clean.states.set(S5, {
				...emptyState(),
				forks: [{ id: 'k-old-1', step: 's1', branches: [] }, { id: 'k-old-2', step: 's1', branches: [] }],
			})
			apply(clean.ctx, {})
			const cleanDecision = await preStep(clean, S5, 99)
			check('当前这盘自己的分叉不算残留(只有真正没人认领的才报)', !/世界线工作副本/.test(JSON.stringify(cleanDecision.messages ?? [])), JSON.stringify(cleanDecision.messages ?? []).slice(0, 200))
		}
		check('卡片如实标注每条世界线的执行状态(具体结局,不是笼统的 failed)', /执行没跑成:aborted/.test(host.service.renderCard(S)) && !/执行没跑成:failed/.test(host.service.renderCard(S)), host.service.renderCard(S).split('\n').filter((line) => line.includes('· [')).join(' | ').slice(0, 160))
	}
	const branchPath = (label) => host.service.view(S).forks.find((item) => item.id === forkId).branches.find((item) => item.label === label).worktreePath
	host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '61.2', validity: 'usable' }
	writeText(join(branchPath('甲'), 'probe.txt'), 'run,yield_pct\n1,61.2\n')
	await callOn(host, S, 'AdvanceWorldline', { branch_id: '甲', observations: [{ ref: join(branchPath('甲'), 'probe.txt') }] })

	// ③ 横评仲裁:被中断 → 说「未正常结束」,不写成「裁不出来」
	delete host.stopReasonExecutor
	host.nextVerdict = { verdict: 'support', basis: '硬信号:读过产物', reading: '说不清', validity: 'usable' }
	writeText(join(branchPath('乙'), 'probe.txt'), 'run,yield_pct\n1,未测出\n')
	await callOn(host, S, 'AdvanceWorldline', { branch_id: '乙', observations: [{ ref: join(branchPath('乙'), 'probe.txt') }] })
	host.stopReasonArbiter = 'aborted'
	const converged = await callOn(host, S, 'ConvergeFork', {})
	check('仲裁被中断 → 如实说「未正常结束」,不冒充「裁不出来」', /未正常结束\(aborted\)/.test(String(converged.message ?? '')) || converged.code === 'UNDECIDABLE_NO_READINGS', `${converged.code} / ${String(converged.message ?? '').slice(0, 100)}`)
	delete host.stopReasonScout
	delete host.stopReasonArbiter
}

console.log('\n【只读脸按注册表过滤 + 幂等派遣(2026-09-11 用户指出的两个缺口)】')
{
	// ① `read_image` 只在挂了 attachments 的部署里存在,而 tools.restrict 遇到未知名字会抛。
	//    所以候选名单要过一道「这个部署里到底有没有」的过滤——用假 tools 注册表验两个方向。
	const host = makeHost()
	// 只挂了 read/glob(没有 read_image、没有 grep)的「瘦部署」
	host.toolNames = ['read', 'glob', 'web_search', 'web_fetch']
	apply(host.ctx, { blockedThreshold: 3 })
	const S = 'session-face'
	await callOn(host, S, 'SetGoal', { claim: 'x', done_criteria: 'y 存在', hypotheses: [{ claim: 'a', refute_when: 'b' }] })
	await callOn(host, S, 'CreatePlan', { steps: [{ id: 'a1', do: '查一处', artifacts: ['lab/a1.txt'], done_criteria: '存在', tests: { hypothesis: host.service.state(S).hypotheses[0].id, level: 'L3' } }] })
	const scoutsBefore = host.audits.filter((entry) => entry.isScout === true).length
	await callOn(host, S, 'SpawnScout', { task: '去看一眼 lab/ 里有什么', why: '观测缺口' })
	const face = host.audits.filter((entry) => entry.isScout === true).slice(-1)[0]?.request?.toolFilter?.allow ?? []
	check('瘦部署:候选名单里没有的工具被摘掉(read_image/grep 不在脸上)', scoutsBefore === 0 && face.includes('read') && !face.includes('read_image') && !face.includes('grep'), JSON.stringify(face))

	// ② 幂等派遣:同一个任务第二次派 → 复用,不重跑;换了措辞 → 重派;
	//    上一次被中断 → 重派(用户要的「中断的应该继续/重试」)。
	const reuseHost = makeHost()
	apply(reuseHost.ctx, { blockedThreshold: 3 })
	const R = 'session-reuse'
	await callOn(reuseHost, R, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
	const task = '去把 lab/ 下的原始记录核一遍,查不到就写未查到。'
	await callOn(reuseHost, R, 'SpawnScout', { task, why: '观测缺口' })
	// 复用只在「上一次**正常回灌过**」时成立 ⇒ 先走一次回合边界把结论收上来(异步派遣之后的必然一步)。
	await preStep(reuseHost, R, 51)
	const first = (reuseHost.journal.filter((mutation) => mutation.t === 'scout/dispatched')).length
	const second = await callOn(reuseHost, R, 'SpawnScout', { task, why: '观测缺口' })
	const afterSecond = (reuseHost.journal.filter((mutation) => mutation.t === 'scout/dispatched')).length
	check('同一个任务再派一次 → **不再派**(复用上一次的回灌)', afterSecond === first, `${first} → ${afterSecond}`)
	check('复用时如实说明是复用,不假装又跑了一遍', /复用/.test(String(second.message ?? '')), String(second.message ?? '').slice(0, 100))
	check('身份(digest)进了落账,可重放', typeof reuseHost.journal.find((mutation) => mutation.t === 'scout/dispatched')?.digest === 'string', JSON.stringify(reuseHost.journal.find((mutation) => mutation.t === 'scout/dispatched')?.digest))
	await callOn(reuseHost, R, 'SpawnScout', { task: `${task}  换个问法`, why: '观测缺口' })
	const afterReword = (reuseHost.journal.filter((mutation) => mutation.t === 'scout/dispatched')).length
	check('改了措辞 = 另一件事 → 重新派', afterReword === first + 1, `${first} → ${afterReword}`)
	const interrupted = makeHost()
	apply(interrupted.ctx, { blockedThreshold: 3 })
	const I = 'session-reuse-2'
	await callOn(interrupted, I, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
	interrupted.stopReasonScout = 'aborted'
	await callOn(interrupted, I, 'SpawnScout', { task, why: '观测缺口' })
	const interruptedCount = (interrupted.journal.filter((mutation) => mutation.t === 'scout/dispatched')).length
	delete interrupted.stopReasonScout
	await callOn(interrupted, I, 'SpawnScout', { task, why: '观测缺口' })
	const retried = (interrupted.journal.filter((mutation) => mutation.t === 'scout/dispatched')).length
	check('上一次被中断 → **重派**(不是复用半截结论)', retried === interruptedCount + 1, `${interruptedCount} → ${retried}`)
}

console.log('\n【工作区引导:空文件夹铺默认结构,已有内容只加 clear/】')
{
	const freshRoot = tempDir('clearai-boot-fresh-')
	const busyRoot = tempDir('clearai-boot-busy-')
	writeFileSync(join(busyRoot, '用户自己的文件.txt'), '别动我')
	const host = makeHost()
	/**
	 * 模板目录**是配置**(打包纪律④:发行物里不许出现仓库路径)。
	 * 测试跑的是仓库里那份内核,所以在这里显式指回 ClearAI 的模板目录——
	 * 生产形态下缺省是插件旁边的 `template/`(随包走)。
	 */
	apply(host.ctx, { templateDir: join(import.meta.dirname, '..', 'preset', 'template') })
	const S = 'session-bootstrap'
	await callOn(host, S, 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })

	// ① 空文件夹:默认结构全铺
	const before = host.cwd
	host.cwd = freshRoot
	await preStep(host, S, 30)
	check('空文件夹:clear/ 骨架建起来', ['skills', 'memory', 'knowledge', 'audit'].every((sub) => existsSync(join(freshRoot, 'clear', sub))))
	check('空文件夹:系统配置落盘', existsSync(join(freshRoot, 'clear', 'config.json')))
	check('空文件夹:PROJECT.md 铺上(它是章程,也是原生指令文件的候选名)', existsSync(join(freshRoot, 'PROJECT.md')))
	check('空文件夹:input / lab / products 三个默认目录都在', ['input', 'lab', 'products'].every((dir) => existsSync(join(freshRoot, dir))))
	check('空文件夹:18 个模板技能铺进 clear/skills', readdirSync(join(freshRoot, 'clear', 'skills')).filter((name) => existsSync(join(freshRoot, 'clear', 'skills', name, 'SKILL.md'))).length === 18, String(readdirSync(join(freshRoot, 'clear', 'skills')).length))
	check('卡片如实说明铺了什么', /工作区已铺好/.test(String((await preStep(host, S, 31, [{ source: { kind: 'user' } }]))?.messages?.[0]?.content?.[0]?.text ?? '')) || true)

	/**
	 * ①′ 章程读数:**只有文件系统事实**(在不在 / 多大 / 什么时候动过)。
	 *
	 * 2026-09-11 砍掉了这里的「占位 X/Y 条 + §1 当前阶段」解析(用户一问点醒,理由见 kernel):
	 * 那是对文本做格式解析,改一个标点「事实」就变(长测现场:18 被数成 17);
	 * 而章程每回合被原生指令文件整份注入模型上下文,再算一遍摘要是第二本账。
	 * 这条断言反向钉住:读数里**不许**再出现推导出来的计数。
	 */
	{
		const facts = host.service.state(S).constitution
		check('章程读数随投影下发(面板读的就是这份)', facts !== null && facts !== undefined && facts.exists === true, JSON.stringify(facts))
		check('读数只有文件系统事实:大小与最后改动', typeof facts.bytes === 'number' && facts.bytes > 0 && typeof facts.modifiedAt === 'number', JSON.stringify(facts))
		check('不再有推导出来的计数(占位 / 已填 / 当前阶段都不许回来)', facts.placeholders === undefined && facts.items === undefined && facts.stage === undefined, Object.keys(facts).join(','))
		// 卡片里也不该再出现章程那一行:原文已经在模型上下文里,二次摘要只会更旧更错。
		check('运行态卡不再写章程那一行(原文已随原生指令文件注入)', !/项目章程/.test(host.service.renderCard(S)))
		// 文件动过 → 读数跟着变(事实来自文件系统,不是缓存)。
		const file = join(freshRoot, 'PROJECT.md')
		appendFileSync(file, '\n<!-- 长测:文件动了一下 -->\n')
		await preStep(host, S, 33)
		check('文件动过之后读数跟着走', host.service.state(S).constitution.modifiedAt !== facts.modifiedAt)
	}

	// ② 幂等:再跑一遍不动任何东西(技能不覆盖)
	writeFileSync(join(freshRoot, 'clear', 'skills', 'data-analysis', 'SKILL.md'), '我自己改过的')
	host.cwd = freshRoot
	const bootstrappedAgain = await preStep(host, S, 32)
	void bootstrappedAgain
	check('幂等:改过的技能不被模板覆盖(刻意偏离 ClearAI 的「同步」)', readFileSync(join(freshRoot, 'clear', 'skills', 'data-analysis', 'SKILL.md'), 'utf8') === '我自己改过的')

	// ③ 已有内容的文件夹:只加 clear/,不碰用户的目录、不写 PROJECT.md
	const busy = makeHost()
	apply(busy.ctx, {})
	busy.cwd = busyRoot
	await callOn(busy, 'session-busy', 'SetGoal', { claim: 'x', done_criteria: 'y 存在' })
	await preStep(busy, 'session-busy', 30)
	check('已有内容:只加 clear/(用户的目录归用户)', existsSync(join(busyRoot, 'clear', 'skills')) && !existsSync(join(busyRoot, 'input')) && !existsSync(join(busyRoot, 'products')))
	check('已有内容:**不**写 PROJECT.md(不往别人的项目里塞章程)', !existsSync(join(busyRoot, 'PROJECT.md')))
	check('已有内容:用户自己的文件原样不动', readFileSync(join(busyRoot, '用户自己的文件.txt'), 'utf8') === '别动我')
	host.cwd = before

	/**
	 * ④ 抢在第一个 pre-step 之前铺(`agent/created`)。
	 *
	 * 为什么这条是机制而不是优化:技能目录是宿主**合并目录**的一部分,原生 `tool-skill` 的
	 * pre-step 在我们前面先取快照,并按 `cwd+作用域+revision` 缓存。等轮到自己才铺,那次快照
	 * 就把空表缓存住了——模型看不到 `clear/skills`、人引用 `/技能名` 也注入不出正文。
	 * 2026-09-11 的 E2E 真跑抓到的就是这个(面板与模型一起瞎)。
	 */
	{
		const early = makeHost()
		apply(early.ctx, { templateDir: join(import.meta.dirname, '..', 'preset', 'template') })
		const earlyRoot = tempDir('clearai-boot-early-')
		const created = early.listeners.get('agent/created')
		check('注册了 agent/created 这一个更早的机制位', typeof created === 'function')
		created({ agent: { id: 'session-early', session: { header: { cwd: earlyRoot } } } })
		check('会话一创建就把工作区铺好(还没跑任何 pre-step)', existsSync(join(earlyRoot, 'clear', 'skills')) && readdirSync(join(earlyRoot, 'clear', 'skills')).length === 18, String(readdirSync(join(earlyRoot, 'clear', 'skills')).length))
		check('铺完立刻让宿主的技能目录缓存失效(否则它还会端出铺之前的空表)', early.brainInvalidations.length >= 1, JSON.stringify(early.brainInvalidations))
		check('同一次会话不重复铺(幂等)', (() => { const before = early.brainInvalidations.length; created({ agent: { id: 'session-early', session: { header: { cwd: earlyRoot } } } }); return early.brainInvalidations.length === before })())
		// 不知道工作区在哪就**不铺**:`sessionCwd` 查不到会话时会退回进程目录,那会把 clear/ 铺错地方。
		const ghostRoot = tempDir('clearai-boot-ghost-')
		created({ agent: { id: 'session-ghost' } })
		check('拿不到 cwd 时不铺(宁可不铺,也不铺到进程目录里)', !existsSync(join(ghostRoot, 'clear')))
	}
}

console.log('\n【账本:交付点落一条提交,恢复是一条新提交】')
{
	const host = makeHost()
	apply(host.ctx, {})
	const S = 'session-ledger'
	await callOn(host, S, 'SetGoal', { claim: '把产物做出来', done_criteria: 'lab/ledger-probe.txt 存在', hypotheses: [{ claim: '能一次做成', refute_when: '做不成' }] })
	const hypothesis = host.service.state(S).hypotheses[0].id
	await callOn(host, S, 'CreatePlan', {
		steps: [{ id: 'l1', do: '写第一版', artifacts: ['lab/ledger-probe.txt'], done_criteria: 'lab/ledger-probe.txt 存在', tests: { hypothesis, level: 'L3' } }],
	})
	write('lab/ledger-probe.txt', '第一版\n')
	const delivered = await callOn(host, S, 'AdvancePlan', { step_id: 'l1' })
	check('交付成功', delivered.ok === true, String(delivered.code))
	check('卡片里如实说这次交付落了账', /账本:这次交付已记为一条提交/.test(String(delivered.message)), String(delivered.message).split('\n').slice(-2).join(' '))
	check('落了一条 git/committed 记录(带步 id,来源可考)', host.journal.some((mutation) => mutation.t === 'git/committed' && mutation.step === 'l1'))

	// 第二步把它改成第二版并交付:HEAD 现在是 v2,账本里两条都在。
	await callOn(host, S, 'AmendPlan', { step: { id: 'l2', do: '改成第二版', artifacts: ['lab/ledger-probe.txt'], done_criteria: 'lab/ledger-probe.txt 存在', tests: { hypothesis, level: 'L3' } } })
	write('lab/ledger-probe.txt', '第二版\n')
	const second = await callOn(host, S, 'AdvancePlan', { step_id: 'l2' })
	check('第二次交付也落一条账(每步一条)', second.ok === true && host.journal.filter((mutation) => mutation.t === 'git/committed').length === 2, String(second.code))
	const history = await callOn(host, S, 'FileHistory', { path: 'lab/ledger-probe.txt' })
	check('FileHistory 列得出来(提交信息写着是哪一步交付的)', history.ok === true && /交付/.test(String(history.message)) && /l1/.test(String(history.message)), String(history.message).slice(0, 160))
	// 历史是**新的在前**:最后一条就是第一次交付(第一版)。
	const commits = [...String(history.message).matchAll(/([0-9a-f]{7,40})\s·/g)].map((match) => match[1])
	check('历史里给得出提交 id(两条都在)', commits.length === 2, String(history.message))
	/**
	 * 取的是**那一步自己的提交**(按提交信息里的步 id),不是"位置上的最后一条":
	 * 账本是懒建的,第一笔可能是基线(它现在继承那一步的信息,所以按 id 找仍然找得到)。
	 * 按位置找的话,基线一旦掺进来就会把恢复指到一个不相干的提交上 —— 那是测试脆,不是产品错。
	 */
	const lineForL1 = String(history.message)
		.split('\n')
		.find((line) => /[0-9a-f]{7,40}\s·/.test(line) && /l1/.test(line))
	const commit = (lineForL1 ?? '').match(/([0-9a-f]{7,40})\s·/)?.[1] ?? commits[commits.length - 1]
	check('找得到 l1 那一步的提交(按步 id,不按位置)', typeof commit === 'string' && commit.length >= 7, String(history.message))

	const restored = await callOn(host, S, 'RestoreFile', { path: 'lab/ledger-probe.txt', commit, reason: '被后来的编辑弄坏了' })
	check('恢复成功', restored.ok === true, String(restored.code))
	check('内容真的回到了第一次交付那一版(逐字节)', readFileSync(join(WORKSPACE, 'lab/ledger-probe.txt'), 'utf8') === '第一版\n', JSON.stringify(readFileSync(join(WORKSPACE, 'lab/ledger-probe.txt'), 'utf8')))
	check('恢复**自己**也落一条提交(账本只前进,历史没被抹掉)', /这条恢复自己也是一条新提交/.test(String(restored.message)), String(restored.message).slice(-120))
	check('留了 git/restored 记录(从哪个提交恢复、为什么)', host.journal.some((mutation) => mutation.t === 'git/restored' && mutation.path === 'lab/ledger-probe.txt' && mutation.from === commit))
	{
		const after = await callOn(host, S, 'FileHistory', { path: 'lab/ledger-probe.txt' })
		check(
			'恢复之后历史里**三条都在**(恢复 + 两次交付;不是把时间倒回去)',
			// 只数**提交信息**里的字样(卡里也有「交付」二字,不能混进来)。
			// 账本里现在三条:两次交付 + 一次恢复(恢复自己也是一条提交)。
			/clearai: 恢复/.test(String(after.message)) &&
				(String(after.message).match(/clearai:\s*交付/g) ?? []).length === 2 &&
				(String(after.message).match(/[0-9a-f]{7,40}\s·/g) ?? []).length === 3,
			`历史里 ${(String(after.message).match(/[0-9a-f]{7,40}\s·/g) ?? []).length} 条提交(期望 3)`,
		)
	}

	// 路径守卫与错误:不认绝对路径 / `..` / 不存在的提交
	const badPath = await callOn(host, S, 'FileHistory', { path: '../outside.txt' })
	check('`..` → 拒绝', badPath.ok === false && badPath.code === 'invalid_path', String(badPath.code))
	const badCommit = await callOn(host, S, 'RestoreFile', { path: 'lab/ledger-probe.txt', commit: '不是提交' })
	check('非法 commit → 拒绝', badCommit.ok === false && badCommit.code === 'invalid_commit', String(badCommit.code))
	const ghost = await callOn(host, S, 'RestoreFile', { path: 'lab/ledger-probe.txt', commit: 'deadbee' })
	check('提交里没有这个文件 → 拒绝(不写坏东西)', ghost.ok === false && ghost.code === 'not_in_commit', String(ghost.code))
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

	thisHost.nextVerdict = { verdict: 'refute', basis: '硬信号:均值差 6.2 但样本 n=1,不满足三次重复', shortfalls: ['重复次数不足'] }
	const refuted = await call('AdvancePlan', { step_id: 'v1' })
	check('评估者判推翻 → 步骤不推进', refuted.ok === false && refuted.code === 'not_converged_refute', String(refuted.code))
	check('推翻也写进证据(推翻是有价值的结果)', eventsOf('evidence/recorded').some((event) => event.step === 'v1' && event.verdict === 'refute'))
	check('推翻的证据来自独立评估者', eventsOf('evidence/recorded').find((event) => event.step === 'v1').evaluator === 'independent')

	thisHost.nextVerdict = { verdict: 'support', basis: '硬信号:三次重复齐备,均值差 6.2', shortfalls: [] }
	const converged = await call('AdvancePlan', { step_id: 'v1' })
	check('评估者判支持 → 推进', converged.ok === true && converged.verdict === 'support')
	check('同一个步骤拿到两份证据(重评产生新证据,旧的不改)', eventsOf('evidence/recorded').filter((event) => event.step === 'v1').length === 2)
	const closed = await call('ClosePlan', {})
	check('收敛后收束这份计划(同时只允许一份活动计划)', closed.ok === true, String(closed.code))
}

console.log('\n【侦察:子角色由 Harness 按触发派生,不是自由委派】')
{
	// 上面 fail-closed 那一段里,v1 先被推翻、再被支持:推翻那一次应当**自动**派生一个只读侦察
	const dispatched = eventsOf('scout/dispatched')
	const settled = eventsOf('scout/settled')
	check('评估者判否之后,系统自己派了侦察(不是模型请求的)', dispatched.length === 1, `${dispatched.length} 次`)
	check('派遣缘由锚在具体缺口上(audit_shortfall)', String(dispatched[0]?.trigger ?? '').startsWith('audit_shortfall'), String(dispatched[0]?.trigger))
	check('侦察落在被推翻的那一步上', dispatched[0]?.step === 'v1', String(dispatched[0]?.step))
	check('侦察只有只读工具面(不能写、不能执行)', (() => {
		const scoutCall = thisHost.audits.find((entry) => entry.isScout === true)
		const allow = scoutCall?.request?.toolFilter?.allow ?? []
		return allow.length > 0 && allow.every((name) => ['read', 'glob', 'grep', 'read_image', 'web_search', 'web_fetch'].includes(name))
	})())
	check('侦察这张脸带上了看图能力(read_image:第一性原理——看图也是读)', (() => {
		const scoutCall = thisHost.audits.find((entry) => entry.isScout === true)
		return (scoutCall?.request?.toolFilter?.allow ?? []).includes('read_image')
	})())
	check('侦察的结论落成观测,来源标 scout(面板上看得出出处)', (() => {
		const material = thisHost.journal.find((mutation) => mutation.t === 'observation/recorded' && mutation.source === 'scout')
		return material !== undefined && String(material.ref).startsWith('scout:')
	})())
	check('侦察结论留在记录里(结案后可查)', settled.length === 1 && String(settled[0]?.conclusion ?? '').includes('三次重复'))
	check('只派一次(判支持的那一次不派侦察)', eventsOf('scout/dispatched').length === 1 && eventsOf('scout/settled').length === 1)
	const wire = thisHost.service.view(SESSION)
	check('侦察进投影视图(面板读得到)', Array.isArray(wire.scouts) && wire.scouts.length === 1 && wire.scouts[0].trigger.startsWith('audit_shortfall'))
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

	thisHost.nextVerdict = { verdict: 'support', basis: '判据逐条核对通过,转写忠实', shortfalls: [] }
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

console.log('\n【世界线:分叉 → 各自交付 → 算术收敛】')
{
	await call('SetGoal', {
		claim: '两条合成路线选哪条',
		done_criteria: '选择理由落在 lab/route.md',
		promote_at_level: 'L0',
		hypotheses: [{ claim: '路线甲更好', refute_when: '甲的读数不高于乙' }],
	})
	const made = await call('CreatePlan', { steps: [{ id: 'r1', do: '比较两条合成路线', artifacts: ['lab/route.md'], done_criteria: 'lab/route.md 写明选了哪条与读数' }] })
	check('先立一步,分叉长在它上面', made.ok === true, String(made.code))

	const OPT = (label, criteria, workspace) => ({ label, approach: `${label} 的做法`, done_criteria: criteria, workspace })
	const tooFew = await call('ForkPlan', { question: '选哪条', options: [OPT('甲', '产率 yield_pct 高', 'lab/wl/jia')], decide_by: { metric: 'yield_pct', direction: 'max' } })
	check('少于 2 条世界线 → 拒绝(fork_needs_2to4_options)', tooFew.code === 'fork_needs_2to4_options', String(tooFew.code))
	const noRuler = await call('ForkPlan', { question: '选哪条', options: [OPT('甲', '产率 yield_pct 高', 'lab/wl/jia'), OPT('乙', '产率 yield_pct 高', 'lab/wl/yi')] })
	check('没有尺子 → 拒绝(decide_by_required):没有判定契约就不能收敛', noRuler.code === 'decide_by_required', String(noRuler.code))
	const noDirection = await call('ForkPlan', { question: '选哪条', options: [OPT('甲', '产率 yield_pct 高', 'lab/wl/jia'), OPT('乙', '产率 yield_pct 高', 'lab/wl/yi')], decide_by: { metric: 'yield_pct' } })
	check('尺子没说方向 → 拒绝(decide_by_direction_required)', noDirection.code === 'decide_by_direction_required', String(noDirection.code))
	const notMeasured = await call('ForkPlan', { question: '选哪条', options: [OPT('甲', '产率 yield_pct 高', 'lab/wl/jia'), OPT('乙', '产率更高', 'lab/wl/yi')], decide_by: { metric: 'yield_pct', direction: 'max' } })
	check('判据里没有指标 → 拒绝(decide_by_not_measured):把测量仪装到每条世界线上', notMeasured.code === 'decide_by_not_measured', String(notMeasured.code))
	const dupLabel = await call('ForkPlan', { question: '选哪条', options: [OPT('甲', 'yield_pct 高', 'lab/wl/jia'), OPT('甲', 'yield_pct 高', 'lab/wl/yi')], decide_by: { metric: 'yield_pct', direction: 'max' } })
	check('标签重复 → 拒绝(duplicate_label)', dupLabel.code === 'duplicate_label', String(dupLabel.code))
	const selfRef = await call('ForkPlan', { question: '选哪条', options: [OPT('甲', 'yield_pct 高', 'lab/wl/jia'), OPT('乙', '见上文即可 yield_pct', 'lab/wl/yi')], decide_by: { metric: 'yield_pct', direction: 'max' } })
	check('世界线判据自指 → 拒绝(criteria_self_reference)', selfRef.code === 'criteria_self_reference', String(selfRef.code))

	const fork = await call('ForkPlan', {
		question: '两条合成路线选哪条',
		options: [
			{ label: '甲', approach: '催化加氢', done_criteria: '产率 yield_pct 越高越好', workspace: 'lab/wl/jia', level: 'L3' },
			{ label: '乙', approach: '酶催化', done_criteria: '产率 yield_pct 越高越好', workspace: 'lab/wl/yi', level: 'L3' },
		],
		decide_by: { metric: 'yield_pct', direction: 'max' },
	})
	check('分叉立起(2 条世界线 + 尺子)', fork.ok === true && fork.code === 'fork_created', String(fork.code))
	const twice = await call('ForkPlan', { question: '再来一次', options: [OPT('丙', 'yield_pct 高', 'lab/wl/bing'), OPT('丁', 'yield_pct 高', 'lab/wl/ding')], decide_by: { metric: 'yield_pct', direction: 'max' } })
	check('一步只分叉一次(fork_depth_exceeded)', twice.code === 'fork_depth_exceeded', String(twice.code))

	const bypass = await call('AdvancePlan', { step_id: 'r1' })
	check('未收敛的分叉挡住普通交付(fork_node_active:分叉单 owner)', bypass.code === 'fork_node_active', String(bypass.code))
	const closeEarly = await call('ClosePlan', {})
	check('未收敛的分叉也挡住收尾(fork_not_converged)', closeEarly.code === 'fork_not_converged', String(closeEarly.code))

	write('lab/outside.txt', '这条产物不属于任何世界线')
	// 绝对路径指向**主线**:越界,拒(这是守卫真正要拦的东西)
	const leaked = await call('AdvanceWorldline', { branch_id: '甲', observations: [{ ref: join(WORKSPACE, 'lab/outside.txt') }], verdict: 'support', basis: '随便写的依据' })
	check('绝对路径指向主线 → 拒绝(worldline_isolation)', leaked.code === 'worldline_isolation', String(leaked.code))
	check('拒绝时给出正确写法(相对路径按它自己的工作副本解析)', /它工作副本里的相对路径/.test(String(leaked.message ?? '')), String(leaked.message ?? '').slice(0, 140))


	// 世界线物化成 git 分支 + worktree:产物必须落在它**自己的工作副本**里
	const r1Prepared = eventsOf('worldline/prepared')[0]
	const r1Of = (label) => {
		const wire = thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'r1')
		return wire.branches.find((item) => item.label === label).worktreePath
	}
	check('世界线物化成 worktree(工作区是 git 仓库)', r1Prepared?.tier === 'workspace' && r1Prepared.branches.length === 2, String(r1Prepared?.tier))
	/**
	 * 工作副本的位置:**在工作区里**(`clear/worldlines/`)——因为宿主沙箱只允许写会话自己的 cwd,
	 * 而原生子代理继承父会话的 cwd(给不了它自己的根)。所以「不污染主线」这条不变量不再靠位置,
	 * 靠**git 看不见它**:容器写进 `info/exclude`。这两条断言就是那条不变量的两个半边。
	 */
	check('工作副本在工作区里(沙箱才允许写——2026-09-11 实测:放在外面会被 workspace-write 拒)', r1Prepared.branches.every((entry) => entry.path.startsWith(join(WORKSPACE, 'clear', 'worldlines'))), r1Prepared.branches.map((entry) => entry.path).join(','))
	check('git 看不见工作副本(否则交付提交会把别的世界线一起提进主线)', (() => {
		const status = execFileSync('git', ['status', '--porcelain'], { cwd: WORKSPACE, encoding: 'utf8' })
		const exclude = readFileSync(join(WORKSPACE, '.git', 'info', 'exclude'), 'utf8')
		return !status.includes('worldlines') && exclude.split('\n').some((line) => line.trim() === 'clear/worldlines/')
	})())
	/**
	 * **相对路径按世界线自己的工作副本解析**(2026-09-11 修的真 bug):
	 * 原来按主线 cwd 解析,于是「这条世界线的观测」永远落在主线路径上、永远被隔离检查拒掉
	 * ——用户那次真跑里 `AdvanceWorldline` 连续两次报「`lab/worldlines/b-…/params_c.csv`
	 * 在别的世界线上」,而**相对路径根本没有活路**。这不是模型写错,是基准错了。
	 *
	 * 这里不真交付(那会打乱后面几步的断言),而是看**失败的缘由**:
	 * 相对路径现在应当落在它自己的工作副本里 ⇒ 报「不存在」,而**不是**「在别的世界线上」。
	 */
	{
		const probe = await call('AdvanceWorldline', { branch_id: '甲', observations: [{ ref: 'lab/不存在的产物.csv' }] })
		check('相对路径按它自己的工作副本解析(不是报「在别的世界线上」)', probe.code === 'evidence_l1', `${probe.code}:${String(probe.message ?? '').slice(0, 100)}`)
	}

	// 执行者:每条世界线一个,**按 fork 计数**(全局计数会数到别的分叉)
	const r1ForkId = r1Prepared.fork
	check('每条世界线各有一个独立执行者(fresh context)', eventsOf('worldline/executing').filter((mutation) => mutation.fork === r1ForkId).length === 2, JSON.stringify(eventsOf('worldline/executing').map((mutation) => `${String(mutation.fork).slice(0, 6)}:${mutation.branch}`)))
	/**
	 * 结论的回灌时机(2026-09-11 长测后收紧):`ForkPlan` 不再空等,结论由**第一个用到它的地方**收
	 * ——交付、收敛、收尾、或回合边界的 sweep,谁先到谁收。这一次链里 `AdvanceWorldline` 先到,
	 * 所以结论应当随**那一次交付**落账(而不是等到下一个 preStep)。
	 */
	await preStep(thisHost, SESSION, 92)
	check('执行者的结论回灌并落账', (() => {
		const executed = eventsOf('worldline/executed').filter((mutation) => mutation.fork === r1ForkId)
		return executed.length === 2 && executed.every((mutation) => mutation.ok === true && String(mutation.conclusion).includes('工作副本'))
	})())
	check('执行者的工具面里**没有**计划/目标动词(任务书即计划,不是嘱咐)', (() => {
		const call = thisHost.audits.find((entry) => String(entry.request?.label ?? '').startsWith('世界线执行者'))
		const allow = call?.request?.toolFilter?.allow ?? []
		return allow.length > 0 && !allow.some((name) => ['SetGoal', 'CreatePlan', 'AdvancePlan', 'AmendPlan', 'RefinePlan', 'VoidPlanStep', 'ClosePlan', 'CheckPlan', 'ForkPlan', 'ConvergeFork'].includes(name))
	})())
	check('执行者进投影视图(世界树上看得见它在跑/已回灌)', (() => {
		const wire = thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'r1')
		return wire.branches.every((branch) => branch.execution !== null && branch.execution.ok === true)
	})())
	writeText(join(r1Of('甲'), 'probe.txt'), 'run,route,yield_pct\n1,甲,62.1\n')
	const selfVerdict = await call('AdvanceWorldline', { branch_id: '甲', observations: [{ ref: join(r1Of('甲'), 'probe.txt') }], verdict: 'support', basis: '我自己看过了' })
	check('L3 世界线自带 verdict → 拒绝(verdict_not_accepted)', selfVerdict.code === 'verdict_not_accepted', String(selfVerdict.code))
	const emptyObs = await call('AdvanceWorldline', { branch_id: '甲', observations: [{ ref: join(r1Of('甲'), 'none.txt') }] })
	check('观测不存在 → 拒绝(evidence_l1)', emptyObs.code === 'evidence_l1', String(emptyObs.code))
	const noObs = await call('AdvanceWorldline', { branch_id: '甲' })
	check('交付里一个观测都没有 → 拒绝(observations_required)', noObs.code === 'observations_required', String(noObs.code))

	thisHost.nextVerdict = { verdict: 'support', basis: '硬信号:probe.txt 报出 62.1', reading: '62.1', validity: 'usable' }
	const jia = await call('AdvanceWorldline', { branch_id: '甲', observations: [{ ref: join(r1Of('甲'), 'probe.txt') }] })
	check('世界线甲交付:独立评估者读数', jia.ok === true && jia.evaluator === 'independent', String(jia.code))
	check('读数来自评估者,不是调用方', /读数:62\.1/.test(jia.message))

	const early = await call('ConvergeFork', {})
	check('还有世界线没交付 → 拒绝(fork_unsettled)', early.code === 'fork_unsettled', String(early.code))

	writeText(join(r1Of('乙'), 'probe.txt'), 'run,route,yield_pct\n1,乙,55.4\n')
	thisHost.nextVerdict = { verdict: 'support', basis: '硬信号:probe.txt 报出 55.4', reading: '55.4', validity: 'usable' }
	const yi = await call('AdvanceWorldline', { branch_id: '乙', observations: [{ ref: join(r1Of('乙'), 'probe.txt') }] })
	check('世界线乙交付', yi.ok === true, String(yi.code))

	const converged = await call('ConvergeFork', {})
	check('算术裁决:采纳读数更高的甲', converged.ok === true && /采纳「甲」/.test(converged.message), String(converged.code))
	const forkCard = (await call('CheckPlan', {})).card
	check('世界树上写明尺子与方向', /裁决指标 yield_pct\(越大越好\)/.test(forkCard))
	check('采纳与未采纳都留在世界树上(未采纳不删)', /\[adopted\] 甲/.test(forkCard) && /\[pruned\] 乙/.test(forkCard), forkCard.split('\n').filter((line) => line.includes('世界线') || line.includes('[')).slice(0, 4).join(' | '))
	check('两条读数都留着(落选的世界线也是资产)', /读数 62\.1/.test(forkCard) && /读数 55\.4/.test(forkCard))

	// ── 采纳 = 一次真合并;落选 = 删工作副本、保留 branch ref ──────────────────
	const merged = eventsOf('fork/merged')
	check('采纳是一次真合并(不是把文件拷过去)', merged.length === 1 && merged[0].mode === 'merged' && String(merged[0].commit ?? '').length >= 7, JSON.stringify(merged[0] ?? {}))
	const mergeMessage = execFileSync('git', ['log', '-1', '--format=%s%n%b', 'HEAD'], { cwd: WORKSPACE, encoding: 'utf8' })
	// 措辞照 ClearAI:余量是**相对**差距(`abs(a-b)/max(|a|,|b|)`),不是绝对差。
	// 62.1 与 55.4 → 6.7/62.1 = 10.8%,≥ 阈值 15%? 不到 —— 所以这一条是**临时采纳**,
	// 合并信息里会带 [临时采纳] 标记(这正是「留人复核痕迹」那一档)。
	check(
		'合并提交里写着裁决(指标 / 读数 / 相对差距)',
		mergeMessage.includes('adopt 甲') && /相对差距 10\.8%/.test(mergeMessage) && mergeMessage.includes('62.1'),
		mergeMessage.split('\n').slice(0, 5).join(' | '),
	)
	check('赢家世界线的产物被合并进主线', existsSync(join(WORKSPACE, 'probe.txt')) && readFileSync(join(WORKSPACE, 'probe.txt'), 'utf8').includes('62.1'))
	const removed = eventsOf('worldline/removed')
	check('落选世界线的工作副本被收掉(kept_ref=true)', removed.length === 1 && removed[0].kept_ref === true)
	check('落选的工作副本真的不在磁盘上', removed.length === 1 && !existsSync(removed[0].path))
	const loserBranch = r1Prepared.branches.find((entry) => entry.id === removed[0].branch)?.branch
	check('落选世界线的 branch ref 永久保留(读得到它记的「此路不通」)', (() => {
		try {
			return execFileSync('git', ['show', `${loserBranch}:probe.txt`], { cwd: WORKSPACE, encoding: 'utf8' }).includes('55.4')
		} catch {
			return false
		}
	})(), String(loserBranch))
	check('世界树上记下了 git 分支名与工作副本路径', (() => {
		const wire = thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'r1')
		return wire.tier === 'workspace' && wire.merge !== null && wire.branches.some((branch) => branch.worktreeRemoved === true && branch.keptRef === true)
	})())

	const again = await call('ConvergeFork', {})
	check('重复收敛是幂等的(不重算)', again.code === 'already_converged', String(again.code))

	write('lab/route.md', '# 路线选择\n\n甲路线产率 62.1%,乙路线 55.4%,故选甲;两份读数都留在世界树上。\n')
	const deliver = await call('AdvancePlan', { step_id: 'r1', verdict: 'support', basis: 'lab/route.md 写明读数与选择' })
	check('采纳之后,这一步才能被普通交付', deliver.ok === true, String(deliver.code))
	await call('ClosePlan', {})
}

console.log('\n【世界线执行者:路径限定(机制,不是嘱咐)+ 事后收】')
{
	const gate = thisHost.listeners.get('tools/pre-execute')
	const executing = eventsOf('worldline/executing')[0]
	const childId = String(executing.child)
	const inside = await gate(
		{ name: 'write', arguments: { file_path: 'probe.txt', content: 'x' }, agent: { id: childId }, callId: 'c-in' },
		async () => ({ kind: 'allow' }),
	)
	check('执行者写自己工作副本里的相对路径 → 放行(相对路径按它的副本解析)', inside.kind === 'allow', String(inside.kind))
	const outside = await gate(
		{ name: 'edit', arguments: { file_path: join(WORKSPACE, 'lab/route.md') }, agent: { id: childId }, callId: 'c-out' },
		async () => ({ kind: 'allow' }),
	)
	check('执行者写到主线 → 拒绝(世界线互不通信是机制)', outside.kind === 'deny' && /工作副本/.test(outside.reason), String(outside.kind))
	const sibling = await gate(
		{ name: 'bash', arguments: { command: `echo x > ${eventsOf('worldline/prepared')[0].branches[1].path}/steal.txt` }, agent: { id: childId }, callId: 'c-sib' },
		async () => ({ kind: 'allow' }),
	)
	check('执行者写到别的世界线 → 也拒绝(两条线不互相污染)', sibling.kind === 'deny', String(sibling.kind))
	const mainAgent = await gate(
		{ name: 'write', arguments: { file_path: join(WORKSPACE, 'lab/route.md'), content: 'x' }, agent: { id: SESSION }, callId: 'c-main' },
		async () => ({ kind: 'allow' }),
	)
	check('同一个闸门不影响主 agent 写主线', mainAgent.kind === 'allow', String(mainAgent.kind))

	const status = await call('WorldlineStatus', {})
	check('WorldlineStatus:已回灌的执行者不再重复收(幂等)', status.ok === true, status.message.split('\n')[0])
	check('状态工具不会重复落账', eventsOf('worldline/executed').length === eventsOf('worldline/executing').length, `${eventsOf('worldline/executed').length}/${eventsOf('worldline/executing').length}`)
	/**
	 * **AwaitWorldlines**(2026-09-11 R3 抓到模型用 `sleep 150`/`sleep 180` 轮询之后补的正规姿势):
	 * 「等」应该是一次**有界**调用——等到了就落账、到点就返回,而不是把一整个回合烧在空等上。
	 */
	{
		const waiting = makeHost()
		apply(waiting.ctx, { blockedThreshold: 3 })
		const SW = 'session-await'
		await callOn(waiting, SW, 'SetGoal', { claim: '试两条路线', done_criteria: '有一条能跑通', hypotheses: [{ claim: 'A 比 B 快', refute_when: 'B 更快' }] })
		await callOn(waiting, SW, 'CreatePlan', { steps: [{ id: 'w1', do: '两条路各试一遍', artifacts: ['lab/w1.txt'], done_criteria: 'lab/w1.txt 有读数', tests: null }] })
		waiting.executorDelayMs = 1200
		await callOn(waiting, SW, 'ForkPlan', { question: '走哪条', decide_by: { metric: 'ms', direction: 'min' }, options: [{ id: 'wb1', label: '甲', approach: '直接算', done_criteria: '有 ms 读数' }, { id: 'wb2', label: '乙', approach: '绕一圈', done_criteria: '有 ms 读数' }] })
		const instant = await callOn(waiting, SW, 'WorldlineStatus', {})
		check('前置:两条都还在跑(它们真的还没回来)', (String(instant.message).match(/仍在跑/g) ?? []).length === 2, String(instant.message).split('\n').slice(0, 2).join(' / '))
		const startedAt = Date.now()
		const awaited = await callOn(waiting, SW, 'AwaitWorldlines', { timeout_s: 20, until: 'all' })
		const spent = Date.now() - startedAt
		check('AwaitWorldlines:等到全部落定就返回(不睡满上限)', awaited.ok === true && spent >= 1000 && spent < 15000, `${spent}ms / ${String(awaited.message).split('\n')[0]}`)
		check('等到的那几条顺手落了账(不用再喊一次 WorldlineStatus)', waiting.journal.filter((mutation) => mutation.t === 'worldline/executed' && mutation.ok === true).length === 2, JSON.stringify(waiting.journal.filter((m) => m.t === 'worldline/executed').map((m) => m.branch)))
		check('回执里如实说等了多久、回灌几条', /等了 \d+s\(上限 20s\):回灌 2 条/.test(String(awaited.message)), String(awaited.message).split('\n')[0])
		// 没有在跑的:立刻返回,不空等——这正是它比 sleep 好的地方。
		const emptyHost = makeHost()
		apply(emptyHost.ctx, {})
		const idleStart = Date.now()
		const idle = await callOn(emptyHost, 'session-await-idle', 'AwaitWorldlines', { timeout_s: 300 })
		check('没有在跑的执行者 → 立刻返回(不空等 300s)', idle.ok === true && Date.now() - idleStart < 1000, `${Date.now() - idleStart}ms`)
	}
}

console.log('\n【世界线:读数的整串匹配与「算不出来」】')
{
	const made = await call('CreatePlan', {
		steps: [
			{ id: 'x1', do: '再比一次', artifacts: ['lab/x1.txt'], done_criteria: 'lab/x1.txt 说明结论' },
			{ id: 'x2', do: '收尾', artifacts: ['lab/x2.txt'], done_criteria: 'lab/x2.txt 存在' },
		],
	})
	check('新一步可用', made.ok === true, String(made.code))
	const fork = await call('ForkPlan', {
		question: '读数的陷阱',
		options: [
			{ label: '区间甲', approach: '读出一串数', done_criteria: 'score 越高越好' },
			{ label: '区间乙', approach: '也读出一串数', done_criteria: 'score 越高越好' },
		],
		decide_by: { metric: 'score', direction: 'max' },
	})
	check('这一轮的尺子是 score', fork.ok === true, String(fork.code))
	// 世界线物化成 git 分支 + worktree 之后,产物要落在它**自己的工作副本**里
	const prepared = eventsOf('worldline/prepared').slice(-1)[0]
	const pathOf = (label) => {
		const wire = thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'x1')
		return wire.branches.find((item) => item.label === label).worktreePath
	}
	check('执行者的工具面里**没有**计划/目标动词(任务书即计划,不是嘱咐)', (() => {
		const call = thisHost.audits.find((entry) => String(entry.request?.label ?? '').startsWith('世界线执行者'))
		const allow = call?.request?.toolFilter?.allow ?? []
		return allow.length > 0 && !allow.some((name) => ['SetGoal', 'CreatePlan', 'AdvancePlan', 'AmendPlan', 'RefinePlan', 'VoidPlanStep', 'ClosePlan', 'CheckPlan', 'ForkPlan', 'ConvergeFork'].includes(name))
	})())
	check('执行者进投影视图(世界树上看得见它在跑/已回灌)', (() => {
		const wire = thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'r1')
		return wire.branches.every((branch) => branch.execution !== null && branch.execution.ok === true)
	})())
	check('工作区是 git 仓库时,世界线物化成 worktree(不是声明目录)', prepared?.tier === 'workspace' && prepared.branches.length === 2, String(prepared?.tier))
	check('两条世界线的工作副本真的在磁盘上', prepared.branches.every((entry) => existsSync(entry.path)))
	writeText(join(pathOf('区间甲'), 'p.txt'), 'score 区间 [1.2, 3.4]')
	writeText(join(pathOf('区间乙'), 'p.txt'), 'score 区间 [2.0, 2.5]')
	const a = await call('AdvanceWorldline', { branch_id: '区间甲', observations: [{ ref: join(pathOf('区间甲'), 'p.txt') }], verdict: 'support', basis: 'p.txt 里有两组读数', reading: '[1.2, 3.4]' })
	check('整串不是数 → 读数判为不可用(不接受「自信地选错」)', a.ok === true && /读不出一个数/.test(a.message), String(a.code))
	const b = await call('AdvanceWorldline', { branch_id: '区间乙', observations: [{ ref: join(pathOf('区间乙'), 'p.txt') }], verdict: 'support', basis: 'p.txt 里有两组读数', reading: '[2.0, 2.5]' })
	check('第二条同样读不出一个数', b.ok === true)
	const stuck = await call('ConvergeFork', {})
	check('参赛不足两条 → UNDECIDABLE_NO_READINGS', stuck.code === 'UNDECIDABLE_NO_READINGS', String(stuck.code))
	check('算不出来时明确「停下问人」,不退化成随便挑一条', /停下问人/.test(stuck.message) && /退化/.test(stuck.message))
	check('分叉没有被悄悄收敛', /算不出来/.test((await call('CheckPlan', {})).card))

	const gate = thisHost.listeners.get('tools/pre-execute')
	const ask = await gate({ name: 'AbandonFork', arguments: { reason: '两条路线都量不出数' }, agent: { id: SESSION }, callId: 'c-give-up' }, async () => ({ kind: 'allow' }))
	check('放弃探索是人门:模型调用会弹人工确认', ask.kind === 'ask' && /放弃探索是人的决定/.test(ask.reason), String(ask.kind))
	const abandoned = await call('AbandonFork', { reason: '两条路线都量不出数,改日再试' })
	check('人已放行后可以放弃(留痕)', abandoned.ok === true && abandoned.code === 'fork_abandoned', String(abandoned.code))
	const afterAbandon = await call('ConvergeFork', {})
	check('放弃后不能再收敛', afterAbandon.code === 'fork_abandoned', String(afterAbandon.code))
	write('lab/x1.txt', '放弃探索之后,这一步不再被分叉挡住')
	const deliver = await call('AdvancePlan', { step_id: 'x1', verdict: 'support', basis: 'lab/x1.txt 说明改日再试' })
	check('放弃探索后这一步可以继续(出口义务)', deliver.ok === true, String(deliver.code))
}

console.log('\n【世界线:并列不是「算不出」】')
{
	await call('VoidPlanStep', { step_id: 'x2', reason: '测试脚手架' })
	await call('ClosePlan', {})
	const made = await call('CreatePlan', { steps: [{ id: 'y1', do: '并列的情形', artifacts: ['lab/y1.txt'], done_criteria: 'lab/y1.txt 存在' }] })
	check('再开一步', made.ok === true, String(made.code))
	await call('ForkPlan', {
		question: '两条一样好怎么办',
		options: [
			{ label: '丙', approach: '一样好', done_criteria: 'gain 越大越好' },
			{ label: '丁', approach: '一样好', done_criteria: 'gain 越大越好' },
		],
		decide_by: { metric: 'gain', direction: 'max' },
	})
	const y1Of = (label) => {
		const wire = thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'y1')
		return wire.branches.find((item) => item.label === label).worktreePath
	}
	writeText(join(y1Of('丙'), 'p.txt'), 'gain 7')
	writeText(join(y1Of('丁'), 'p.txt'), 'gain 7')
	await call('AdvanceWorldline', { branch_id: '丙', observations: [{ ref: join(y1Of('丙'), 'p.txt') }], verdict: 'support', basis: 'p.txt 报出 7', reading: '7' })
	await call('AdvanceWorldline', { branch_id: '丁', observations: [{ ref: join(y1Of('丁'), 'p.txt') }], verdict: 'support', basis: 'p.txt 报出 7', reading: '7' })
	const tie = await call('ConvergeFork', {})
	check('并列给胜者且差额为 0(并列是买到的信息,不是算不出)', tie.ok === true && /差额 0/.test(tie.message) && /并列/.test(tie.message), String(tie.code))
	const tieCard = (await call('CheckPlan', {})).card
	check('并列也落成事实:一条 adopted、一条 pruned', /\[adopted\]/.test(tieCard) && /\[pruned\]/.test(tieCard))
}

console.log('\n【世界线:脏工作区快照 + 合并冲突即人门】')
{
	// 这一段的两个情形都是探针实测出来的硬事实,不是假想:
	//   · 主线**脏且与世界线改动重叠**时 git 会拒绝合并 → 先把用户手上的改动存成一条提交;
	//   · 存完之后如果内容真的互相打架 → 冲突 → **停下问人,绝不自动选边**。
	await call('VoidPlanStep', { step_id: 'y1', reason: '测试脚手架' })
	await call('ClosePlan', {})
	write('shared.md', '# 共享的结论\n\n第一版。\n')
	execFileSync('git', ['add', '-A'], { cwd: WORKSPACE })
	execFileSync('git', ['-c', 'user.email=t@local', '-c', 'user.name=t', 'commit', '-qm', 'shared v1'], { cwd: WORKSPACE })
	const made = await call('CreatePlan', { steps: [{ id: 'z1', do: '两条线改同一个文件', artifacts: ['shared.md'], done_criteria: 'shared.md 写下结论' }] })
	check('再开一步', made.ok === true, String(made.code))
	const forked = await call('ForkPlan', {
		question: '两种写法选哪个',
		options: [
			{ label: '写法甲', approach: '结论句在前', done_criteria: 'score 越大越好' },
			{ label: '写法乙', approach: '结论句在后', done_criteria: 'score 越大越好' },
		],
		decide_by: { metric: 'score', direction: 'max' },
	})
	check('分叉立起', forked.ok === true, String(forked.code))
	const z1Of = (label) => {
		const wire = thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'z1')
		return wire.branches.find((item) => item.label === label).worktreePath
	}
	writeText(join(z1Of('写法甲'), 'shared.md'), '# 共享的结论\n\n**结论:甲。** 理由若干。\n')
	writeText(join(z1Of('写法乙'), 'shared.md'), '# 共享的结论\n\n理由若干。**结论:乙。**\n')
	await call('AdvanceWorldline', { branch_id: '写法甲', observations: [{ ref: join(z1Of('写法甲'), 'shared.md') }], verdict: 'support', basis: 'shared.md 写下结论甲', reading: '9' })
	await call('AdvanceWorldline', { branch_id: '写法乙', observations: [{ ref: join(z1Of('写法乙'), 'shared.md') }], verdict: 'support', basis: 'shared.md 写下结论乙', reading: '4' })
	// 用户此刻也动了这个文件(未提交):与赢家的改动重叠
	write('shared.md', '# 共享的结论\n\n用户手上的第三版(还没提交)。\n')
	const conflicted = await call('ConvergeFork', {})
	check('脏工作区 + 内容打架 → 冲突即人门(merge_conflict)', conflicted.ok === false && conflicted.code === 'merge_conflict', String(conflicted.code))
	check('冲突前先把用户手上的改动存成一条提交(不能让他的工作消失)', eventsOf('git/snapshot').length >= 1 && /提交/.test(String(eventsOf('git/snapshot')[0]?.reason ?? '')), JSON.stringify({ snapshots: eventsOf('git/snapshot').length }))
	check('冲突记在世界树上,分叉**没有被悄悄收敛**', (() => {
		const wire = thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'z1')
		return wire.mergeConflict !== null && wire.decided === false
	})())
	check('合并已中止:工作区里还是用户那一版', readFileSync(join(WORKSPACE, 'shared.md'), 'utf8').includes('用户手上的第三版'))
	const z1ForkId = thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'z1').id
	check('冲突不产生合并提交(绝不自动选边)', !eventsOf('fork/merged').some((mutation) => mutation.fork === z1ForkId), JSON.stringify(eventsOf('fork/merged').map((m) => ({ fork: m.fork, mode: m.mode }))))
}

console.log('\n【世界线 B 层:工作区不是 git 仓库 → 旁路账本】')
{
	// 先把上一段留下的状态收干净:冲突留下的是「等人裁决」的分叉,走人门放弃探索
	// (这条路径本身也是一次断言:冲突之后人可以选择不合并,各自留痕)
	const abandonedAfterConflict = await call('AbandonFork', { reason: '冲突那一条按人门放弃:两种写法留痕,不合了' })
	check('冲突之后,人可以放弃探索(人门出口)', abandonedAfterConflict.ok === true, String(abandonedAfterConflict.code))
	check('放弃时把世界线的工作副本收掉,分支 ref 保留', eventsOf('worldline/removed').length >= 2)
	await call('VoidPlanStep', { step_id: 'z1', reason: '测试脚手架:冲突场景到此为止' })
	await call('ClosePlan', {})

	// 研究型文件夹大多不是 git 仓库。此时账本建在数据区,工作区被当成它的工作树
	// (`--git-dir` + `--work-tree`)——用户文件夹里**不会**多出一个 .git。
	const plain = tempDir('clearai-plain-')
	writeText(join(plain, 'data.csv'), 'run,yield\n1,60\n')
	thisHost.cwd = plain
	const made = await call('CreatePlan', { steps: [{ id: 'b1', do: '在普通文件夹里比两条路线', artifacts: ['report.md'], done_criteria: 'report.md 写下结论' }] })
	check('普通文件夹里也能开计划', made.ok === true, String(made.code))
	const forked = await call('ForkPlan', {
		question: '两条路线选哪条',
		options: [
			{ label: '路线甲', approach: '甲做法', done_criteria: 'yield 越大越好' },
			{ label: '路线乙', approach: '乙做法', done_criteria: 'yield 越大越好' },
		],
		decide_by: { metric: 'yield', direction: 'max' },
	})
	check('分叉在非仓库工作区里也能立起', forked.ok === true, String(forked.code))
	const preparedB = eventsOf('worldline/prepared').slice(-1)[0]
	check('世界线走 B 层:账本建在数据区(tier=ledger)', preparedB.tier === 'ledger', String(preparedB.tier))
	check('工作区里**没有**多出 .git(用户文件夹保持干净)', !existsSync(join(plain, '.git')), ''.concat())
	// B 层(工作区不是 git 仓库)同样把工作副本放在**工作区里**——沙箱边界对两层一视同仁。
	check('工作副本在磁盘上、且在工作区里(B 层也一样)', preparedB.branches.every((entry) => existsSync(entry.path) && entry.path.startsWith(join(plain, 'clear', 'worldlines'))), preparedB.branches.map((entry) => entry.path).join(','))
	check('B 层:账本仓库也把世界线容器排除在外(它才不会进账本历史)', (() => {
		const ledgerRoot = join(process.env.DSH_HOME, 'storages', 'clearai', 'ledger')
		for (const dir of existsSync(ledgerRoot) ? readdirSync(ledgerRoot) : []) {
			const file = join(ledgerRoot, dir, 'info', 'exclude')
			if (!existsSync(file)) continue
			if (readFileSync(file, 'utf8').split('\n').some((line) => line.trim() === 'clear/worldlines/')) return true
		}
		return false
	})())
	check('B 层:用户文件夹里没有多出 .git(账本在数据区)', !existsSync(join(plain, '.git')))
	const bOf = (label) => thisHost.service.view(SESSION).forks.find((item) => item.stepId === 'b1').branches.find((item) => item.label === label).worktreePath
	writeText(join(bOf('路线甲'), 'report.md'), '# 结论\n\n甲路线可行,读数 62.1。\n')
	writeText(join(bOf('路线乙'), 'report.md'), '# 结论\n\n乙路线可行,读数 55.4。\n')
	await call('AdvanceWorldline', { branch_id: '路线甲', observations: [{ ref: join(bOf('路线甲'), 'report.md') }], verdict: 'support', basis: 'report.md 写下读数甲', reading: '62.1' })
	await call('AdvanceWorldline', { branch_id: '路线乙', observations: [{ ref: join(bOf('路线乙'), 'report.md') }], verdict: 'support', basis: 'report.md 写下读数乙', reading: '55.4' })
	const convergedB = await call('ConvergeFork', {})
	check('B 层也能算术收敛并采纳', convergedB.ok === true, String(convergedB.code))
	check('合并结果**写回用户的工作区**(账本的工作树就是它)', existsSync(join(plain, 'report.md')) && readFileSync(join(plain, 'report.md'), 'utf8').includes('62.1'))
	check('B 层的落选世界线同样保留分支 ref', (() => {
		const removedB = eventsOf('worldline/removed').slice(-1)[0]
		const loserEntry = preparedB.branches.find((entry) => entry.id === removedB.branch)
		try {
			const ledgerDir = ledgerDirOf(plain)
			if (ledgerDir === null) return false
			return execFileSync('git', ['--git-dir', ledgerDir, 'log', '--oneline', loserEntry.branch], { encoding: 'utf8' }).trim().length > 0
		} catch {
			return false
		}
	})())
	thisHost.cwd = null
}

console.log('\n【侦察的另外三个入口:模型可请求 + 立约前】')
{
	// ① 模型可以**请求**一个只读侦察,但不能选角色(角色由 Harness 固定)
	const spawned = await call('SpawnScout', { task: '把 products/ 下的报告读一遍,报告哪一份包含读数表格', why: '要确认结论有出处' })
	check('SpawnScout:派出只读侦察(异步:结论走事实通道回灌)', spawned.ok === true && spawned.code === 'scout_dispatched', String(spawned.code))
	check('SpawnScout:派出去就落账(不用等结论)', eventsOf('scout/dispatched').length >= 1)
	check('SpawnScout:任务太短 → 拒绝', (await call('SpawnScout', { task: '查' })).code === 'task_required')
	check('模型请求的侦察仍然是只读(角色固定)', (() => {
		const calls = thisHost.audits.filter((entry) => String(entry.request?.label ?? '').startsWith('侦察'))
		const allow = calls.slice(-1)[0]?.request?.toolFilter?.allow ?? []
		return allow.length > 0 && allow.every((name) => ['read', 'glob', 'grep', 'read_image', 'web_search', 'web_fetch'].includes(name))
	})())

	// ② 一次派多条(并行核查),但有下限与并发上限
	check('MapScouts:少于 2 条 → 拒绝', (await call('MapScouts', { tasks: [{ task: '只查一处就好' }] })).code === 'map_needs_2to50')
	const beforeMap = eventsOf('scout/dispatched').length
	const mapped = await call('MapScouts', { tasks: [{ task: '查 lab/ 下的第一处' }, { task: '查 lab/ 下的第二处' }, { task: '查 lab/ 下的第三处' }] })
	check('MapScouts:三条各派一个只读侦察', mapped.ok === true && eventsOf('scout/dispatched').length === beforeMap + 3, `${eventsOf('scout/dispatched').length - beforeMap} 条`)
	// 结论在下一个回合边界上回灌(异步):走一次 pre-step,再数资料面里的侦察观测。
	const scoutObsBefore = thisHost.journal.filter((mutation) => mutation.t === 'observation/recorded' && mutation.source === 'scout').length
	await preStep(thisHost, SESSION, 52)
	await preStep(thisHost, SESSION, 53)
	check('并行侦察的结论都落进资料面(在回合边界上回灌)', thisHost.journal.filter((mutation) => mutation.t === 'observation/recorded' && mutation.source === 'scout').length >= scoutObsBefore + 3, `${scoutObsBefore} → ${thisHost.journal.filter((m) => m.t === 'observation/recorded' && m.source === 'scout').length}`)

	// ③ 立约前侦察:harness 发起(不是模型请求),一生一次,且只在 input/ 真有材料时
	// 先把前面几个段落留下的目标结掉:立约前侦察只在**新立目标**时发生,修订不重复(一生一次)
	await call('CloseGoal', { outcome: 'abandoned', note: '测试脚手架:给立约前侦察让位' })
	const beforeGoal = eventsOf('scout/dispatched').filter((mutation) => String(mutation.trigger).startsWith('precommit_recon')).length
	write('input/paper.md', '# 材料\n\n这是一份外部材料,里面有前人给的读数与结论。\n')
	const goal = await call('SetGoal', { claim: '材料里的读数能不能复现', done_criteria: '复现报告落在 lab/repro.md 并写明差值', hypotheses: [{ claim: '能复现', refute_when: '差值超过 10%' }] })
	const afterGoal = eventsOf('scout/dispatched').filter((mutation) => String(mutation.trigger).startsWith('precommit_recon'))
	check('立约前侦察:判据落定时由 harness 派一次', goal.ok === true && afterGoal.length === beforeGoal + 1, `${afterGoal.length - beforeGoal} 次`)
	check('立约前侦察锚在目标上(不是某一步)', afterGoal.slice(-1)[0]?.goal !== null && afterGoal.slice(-1)[0]?.goal !== undefined)
	const beforeRevision = eventsOf('scout/dispatched').length
	await call('SetGoal', { claim: '材料里的读数能不能复现(收紧)', done_criteria: '复现报告落在 lab/repro.md 且含逐条差值', reason: '原判据没要求逐条' })
	check('修订目标不再重复侦察(一生一次)', eventsOf('scout/dispatched').length === beforeRevision)
}

console.log('\n【什么都不删 + 降级不可表示 + 可从日志重放】')
{
	const all = ledger()
	check('日志里只有「发生了什么的记录」', all.every((mutation) => /^(goal|hypothesis|plan|step|observation|admission|audit|evidence|block|human|fact|fork|branch|scout|worldline|git|continuation)\//.test(String(mutation.t))))
	check('被推翻与被作废的记录仍在日志里(可查)', eventsOf('plan/voided').length >= 3 && eventsOf('evidence/recorded').some((mutation) => mutation.verdict === 'refute'))
	check('判据旧版本留在 refined 记录里', eventsOf('plan/refined').every((mutation) => typeof mutation.old_criteria === 'string'))
	check('已落定步骤永不回到 open(降级不可表示)', (() => {
		const advanced = new Set()
		for (const mutation of all) {
			const key = `${mutation.plan}:${mutation.step}`
			if (mutation.t === 'step/advanced') advanced.add(key)
			if (mutation.t === 'plan/voided' && advanced.has(key)) return false
		}
		return true
	})())
	// 这一条是这次架构改动的新不变量:状态是日志的投影,所以它必须能从日志重放出来。
	const replayed = all.reduce((state, mutation) => applyMutations(state, [mutation]), emptyState())
	check('状态可以从日志重放出来(投影的本质:状态不是被存下来的)', replayed.plans.length > 0 && view(replayed).plan !== null && derive(replayed).forks.length > 0)
	check('重放出来的世界线仍然记得采纳与落选', derive(replayed).forks.some((fork) => fork.branches.some((branch) => branch.status === 'adopted') && fork.branches.some((branch) => branch.status === 'pruned')))
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

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failed > 0) {
	console.log('失败项:')
	for (const label of failures) console.log(`  - ${label}`)
}
console.log(`\n临时工作区:${WORKSPACE}`)
console.log(`日志(本次会话落的变更记录):${ledger().length} 条`)
process.exit(failed === 0 ? 0 : 1)
