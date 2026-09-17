/**
 * ClearAI 的状态机(宿主半)。
 *
 * 这是 ClearAI 认识论的**事实侧**:状态不是被存下来的,而是**会话日志的投影**——
 * 与 DSH 原生一致(`sessionProjections` 的纯同步 fold + 水印缓存 + fork 感知),
 * 也与 ClearAI 自己的原则一致:「系统的状态永远可以被重新计算,因此永远不会与事实不一致。
 * 凡是被存储的状态,都是潜在的谎言。」
 *
 * 两条不变量:
 *   1. **本文件只解释事实,不做判断。** 它吃的全是工具已经算完并记进日志的结论
 *      (`tool/result.meta.mutation`)——准入过没过、评估者裁了什么、算术选了谁。
 *      判断(读盘核产物、派评估者、算术排序)在预设侧的工具里,因为它们需要 I/O 与异步。
 *   2. **纯函数。** fold 不许有 I/O、不许读时钟、不许调服务。状态必须是纯 JSON
 *      (投影要求,也是它可以被缓存与重放的前提)。
 *
 * 与预设内核的契约:`meta = { kind: 'clearai', v: 1, mutation: { t, ... } }`。
 * 词汇表由本文件的 `applyMutation` 定义;预设侧只负责产出,不负责解释。
 */
import { applyLexiconMutation, deriveConflicts, emptyLexicon, graphProjection, lexiconHealth, normalizeLexicon } from './domain-language.js'

/** 世界线分支状态的秩。秩只增;一旦出现 adopted,整个分叉的分支状态冻结。 */
const BRANCH_RANK = { exploring: 0, evaluated: 1, adopted: 2, pruned: 2 }

/** 五个等级,由低到高。等级是「这条证据有多大程度只能靠信任做的人」的刻度(见 docs/verification-loop.md 的等级表)。 */
const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4']

export const MUTATION_KIND = 'clearai'
/**
 * 状态版本:形状一变就 +1。
 *   v2 → v3:多了「合并技能目录」与「本会话用了几次技能」两块(技能面)。
 *   v3 → v4:多了「运行档」(人在场 / 无人值守)这块。
 *          (更正:它**不是**"可被人切换的事实"而是部署预设的初值——面板那个开关已删。)
 *   v4 → v5:多了「项目章程」的读数(占位还有几条 / 章程的当前阶段填没填 / 最后改动)。
 *   v5 → v6:多了「续跑窗口」的账(`continuation`):我们**对宿主说过的话**——布防、暂停、收兵、
 *           以及「它不在了,而那不是我们干的」。它以前记在内核的进程内存里,重启或分叉就说不清了。
 *   v6 → v7:那条账多一个 `label`:我们最后一次在平台对象上写下的那句身份文本。
 *           它的用途只有一个:**分清「身份变了」与「人改写过了」**——前者我们换窗口,
 *           后者以人为准、一个字都不动。没有它,这两种情形在外部长得一模一样。
 *   v9 → v10:多了「领域词汇」(`lexicon`)与类型化事实:断言进 `fact.promoted`,
 *           事实与假设按 id 关联(旧账本仍按主张文本)。旧日志折出来的 `lexicon` 是空表,
 *           没有断言的事实照旧可读——形状变了才 +1,不是语义变了才 +1。
 * 投影缓存按版本判定,所以旧缓存会被丢弃、从日志重折一遍——用量是**从日志折出来的**,重折才完整。
 */
export const STATE_VERSION = 10

/**
 * **只留台账、不折进视图**的变更类型(词汇表的另一半)。
 *
 * 为什么要有这份清单:`applyMutation` 对不认识的类型**原样返回**(前向兼容,必须如此),
 * 于是「故意不折」与「忘了折」在代码里长得一模一样。把它显式写下来,两件事就分开了:
 *   · 发行自检按它比对内核实际落的每一类事实 —— 既没折、又不在清单里的,是**真的缺口**;
 *   · 读代码的人不必逐条 grep 才知道哪些事实不上界面。
 *
 * 这四类都是**账本事实**:它们记「系统/账本做了什么」,不改变任何派生量
 * (准入检查、提交流水、快照、恢复),面板只展示当前可读取的证据与记录,
 * 而不是从投影里再长一份。
 */
export const LEDGER_ONLY_MUTATIONS = ['admission/checked', 'git/committed', 'git/restored', 'git/snapshot']

/** 空状态。`init` 与「日志里还没有任何变更」都必须给出同一个形状。 */
export function emptyState() {
	return {
		goal: null,
		hypotheses: [],
		plans: [],
		evidence: [],
		audits: [],
		materials: [],
		facts: [],
		forks: [],
		/** 系统按触发派出去的侦察(子角色不是模型自由委派):结论进资料面,这里留一条记录 */
		scouts: [],
		/** 工作区里等人采纳的候选技能(内核扫描后落的事实)与已采纳的记录 */
		brainCandidates: [],
		skillPromotions: [],
		/**
		 * 外脑全景(技能清单 + 记忆索引)。**由内核扫描后随投影下发**——面板在浏览器里读不了盘,
		 * 而内核每个 pre-step 都在扫;清单走投影(变了才发),正文才走宿主路由(点开时才读)。
		 */
		brain: null,
		/**
		 * 宿主原生的**合并技能目录**(预设自带 / 项目 / 用户 / 我们投影的 `clear/skills` 合并后的表)。
		 * 内核每个 pre-step 调一次 `ctx.skills.snapshot`,变了才发——于是面板与模型看的是**同一张表**。
		 */
		skillCatalog: null,
		/**
		 * 本会话的技能加载记录。**纯派生,零新账**:
		 * 模型加载 = 日志里的 `tool/call name='skill'`;人引用 = 一条含 `/名字` 的用户消息。
		 */
		skillUsage: {},
		blocks: {},
		releases: [],
		/**
		 * 运行档(人在场 / 无人值守)。**它是部署预设的初值,不是可切换的开关**:
		 *   · 人门动词 `set_autonomy` 已摘除,面板上那个开关已经不存在;
		 *   · `effective` = 内核随投影下发的那一份(只有内核知道组合配置),**只用于展示**;
		 *   · `override`  = 历史日志里可能留下的人门记录。读取侧保留它只是为了旧会话仍然读得通,
		 *     当前**没有任何写入者**——不要据此认为现在还能切换档位。
		 *   · 它也不影响续跑:要不要继续由门状态算出来(见内核 turnDemand)。
		 */
		autonomy: { override: null, effective: null },
		/**
		 * 项目章程(`PROJECT.md`)的读数(内核扫描后随投影下发)。
		 * 为什么要有它:章程的**读**侧早就接在原生指令文件上了,但**写**侧只有一句提示词——
		 * 结果是跑完几轮、交付了产物,章程还是铺工作区那天的模板,谁也没发现——不提醒它就会一直漂着。
		 * 事实摆在这里,人与模型都看得见「它还是不是空壳」。
		 */
		constitution: null,
		/**
		 * **本体形状**:内核随投影下发的那份声明(对象/状态/边/等级)。
		 * 为什么进投影而不是在界面里手抄:面板那一格的页眉要从**声明**生成——
		 * 抄一份就会漂移,而漂移的界面比没有界面更坏。它与目录同一条纪律:变了才发。
		 */
		ontology: null,
		/**
		 * **领域词汇**(概念与谓词)与它的读面。
		 *
		 * 为什么它与上面的 `ontology` 是两个字段:`ontology` 是**过程本体**的形状
		 * (插件自己的后台流转结构,随版本走、不可编辑);`lexicon` 是**领域本体**的内容
		 * (项目自己的语言:概念、谓词、值形态),由账本里的本体事件折出来、可增删改。
		 * 名字分开,是因为权威不同——一个随发布变,一个随项目长。
		 */
		lexicon: emptyLexicon(),
		/**
		 * **续跑窗口的账**:我们向平台说过的那句话——「这个窗口归我布防 / 我按了暂停 /
		 * 我收兵了 / 它不在了而那不是我们干的」。形状见 `applyMutation` 的 `continuation/set`。
		 *
		 * 为什么它必须在投影里而不是内核内存里:宿主的 `paused` 相位分不清「人按的」与
		 * 「策略按的」,而这两者的处置正好相反(人按的绝不覆盖,自己按的要能恢复)。
		 * 只记在内存里,一次重启就把我们自己的暂停误报成人的暂停——那是一句**不实的话**;
		 * 而「我们说过的话要有账」本来就是这套设计的纪律(意图工具不能断言事实)。
		 */
		continuation: null,
		/** 正在飞的工具调用(来自 tool/call):让「评估者在裁决」成为一条可看见的事实 */
		inFlight: null,
		/** 本会话自己写过的路径(来自 tool/call 的 write/edit):L4 来源分离的判据 */
		written: [],
		/**
		 * **会改工作区的工具调用**的一次计数(来自 tool/call 的 write/edit/bash/pwsh)。
		 *
		 * 为什么要有它:`written` 只认 write/edit,而探索最常走 bash(脚本自己产出文件),
		 * 于是「这个会话到底动过工作区没有」用 `written` 答不全。内核在**回合边界**上要问的
		 * 正是这一句(是否值得记一次工作区快照),所以这里记一个只增的计数——
		 * 它是日志折出来的,可重放,不是第二本账。
		 */
		writeCalls: 0,
	}
}

/**
 * 等裁决的三个工具:它们的调用在飞时,派生阶段是 `auditing`。
 * 其余工具不等外部裁决,不该让面板在每次调用时跳一下。
 */
const VERDICT_WAITERS = new Set(['AdvancePlan', 'AdvanceWorldline', 'CloseGoal'])

/** 记下来的自写路径有上限:它是判据,不是档案(档案在会话日志里)。 */
const MAX_WRITTEN = 512
/**
 * 会**改工作区**的工具名。`bash`/`pwsh` 也算:脚本自己产出文件,内核分辨不了只读与写入,
 * 所以宁可偏保守——多记一笔快照,也不漏掉探索产出。
 */
const WRITE_CAPABLE_TOOLS = new Set(['write', 'edit', 'bash', 'pwsh'])

/**
 * 技能引用手势:与原生 `dsh-tool-skill` 的 `SKILL_GESTURE` **同一条正则**。
 *
 * 为什么不各写一条:这条正则是「技能正文会不会被注入」的**充要条件**
 * (`dsh-tool-skill/lib/index.js` 的 `invokedSkillNames`:只认 `source.kind === 'user'` 的
 * 文本块)。面板数出来的用法与原生真的做了什么必须是同一件事,否则读数就是编的。
 */
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g
/** 每条技能留最近几次记录(用量是判据不是档案;要全量去会话日志里查)。 */
const MAX_SKILL_EVENTS = 8
/** 最多跟踪多少条技能,免得一个失控的会话把投影撑大。 */
const MAX_SKILLS_TRACKED = 64

/** 从一条消息的文本块里取出被引用的技能名(与原生同一条正则、同一套去重)。 */
function invokedSkillNames(message) {
	const names = []
	for (const block of Array.isArray(message?.content) ? message.content : []) {
		if (block?.type !== 'text' || typeof block.text !== 'string') continue
		for (const match of block.text.matchAll(SKILL_GESTURE)) if (match[2] !== undefined && !names.includes(match[2])) names.push(match[2])
	}
	return names
}

/** 这一次加载落在哪一步上(「在第 3 步」这个指针的由来)。 */
function stepPointer(state) {
	const plan = state.plans.find((item) => item.status === 'active') ?? null
	if (plan === null) return { plan: null, step: null, ordinal: null }
	const step = plan.steps.find((item) => item.status === 'open') ?? null
	return { plan: plan.id, step: step === null ? null : step.id, ordinal: step === null ? null : step.ordinal }
}

function recordSkillUse(state, name, by, at, pointer) {
	const usage = state.skillUsage ?? (state.skillUsage = {})
	if (usage[name] === undefined && Object.keys(usage).length >= MAX_SKILLS_TRACKED) return
	const entry = usage[name] ?? { name, model: 0, human: 0, events: [], lastAt: null }
	if (by === 'model') entry.model += 1
	else entry.human += 1
	entry.events.push({ by, at, plan: pointer.plan, step: pointer.step, ordinal: pointer.ordinal })
	if (entry.events.length > MAX_SKILL_EVENTS) entry.events.splice(0, entry.events.length - MAX_SKILL_EVENTS)
	entry.lastAt = at
	usage[name] = entry
}

/** 深拷贝(状态是纯 JSON,这是唯一需要的工具)。 */
function clone(value) {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/**
 * 假设 ↔ 事实的关联:优先按 `hypothesis` id(新账本),旧账本按主张文本——
 * 那时的事实还没有那个字段。顺序不能反:id 是身份,文本只是当时的措辞,
 * 改一次措辞就断链的关联迟早会把「这条假设已被升格」读成「还没升格」。
 */
function factFromHypothesis(facts, goalId, hypothesisId, claim) {
	return (Array.isArray(facts) ? facts : []).some((fact) => {
		if (typeof fact?.hypothesis === 'string' && fact.hypothesis !== '') return fact.hypothesis === hypothesisId
		return fact?.goal === goalId && String(fact.text ?? '') === String(claim ?? '')
	})
}

function appendSteps(plan, rawSteps) {
	for (const raw of rawSteps) {
		plan.steps.push({
			id: raw.id,
			ordinal: plan.steps.length + 1,
			do: raw.do,
			artifacts: raw.artifacts ?? [],
			done_criteria: raw.done_criteria,
			tests: raw.tests ?? null,
			status: 'open',
			evidence: null,
			advancedAt: null,
			voidReason: null,
			criteria_versions: [raw.done_criteria],
		})
	}
}

/**
 * 把一条变更记录折进状态,返回**新状态**(不改传入的那个)。
 * 认不出来的 `t` 原样返回旧状态(投影的「不感兴趣就返回同一引用」语义)。
 *
 * @param state - 当前状态(纯 JSON)
 * @param mutation - 预设侧写进 `tool/result.meta.mutation` 的变更记录
 * @returns 新状态,或原状态(不关心这条)
 */
export function applyMutation(state, mutation) {
	if (mutation === null || typeof mutation !== 'object' || typeof mutation.t !== 'string') return state
	const at = typeof mutation.at === 'number' ? mutation.at : 0
	const next = clone(state)
	const RANK = { open: 0, blocked: 0, advanced: 1, void: 1 }
	const settle = (step, status) => {
		if (step === undefined || step === null) return
		if ((RANK[status] ?? 0) < (RANK[step.status] ?? 0)) return // 降级不可表示(事实棘轮)
		step.status = status
	}
	const planOf = (id) => next.plans.find((plan) => plan.id === id)
	const stepOf = (planId, stepId) => planOf(planId)?.steps.find((step) => step.id === stepId)

	switch (mutation.t) {
		case 'goal/set': {
			const previous = next.goal
			if (previous !== null && previous.id === mutation.id && mutation.revision > previous.revision) {
				previous.revision = mutation.revision
				previous.claim = mutation.claim
				previous.done_criteria = mutation.done_criteria
				previous.promote_at_level = mutation.promote_at_level
				previous.reasons.push(mutation.reason ?? null)
			} else {
				if (previous !== null && previous.status === 'open') previous.status = 'superseded'
				next.goal = {
					id: mutation.id,
					claim: mutation.claim,
					done_criteria: mutation.done_criteria,
					promote_at_level: mutation.promote_at_level,
					status: 'open',
					revision: mutation.revision ?? 1,
					reasons: [mutation.reason ?? null],
					openedAt: at,
					closedAt: null,
					closeVerdict: null,
				}
			}
			for (const hypothesis of mutation.hypotheses ?? []) {
				next.hypotheses.push({
					id: hypothesis.id,
					goal: mutation.id,
					claim: hypothesis.claim,
					refute_when: hypothesis.refute_when,
					status: 'proposed',
					version: hypothesis.version ?? 1,
					at,
				})
			}
			break
		}
		case 'goal/closed': {
			if (next.goal !== null && next.goal.id === mutation.id) {
				next.goal.status = mutation.status
				next.goal.closedAt = at
				next.goal.closeVerdict = mutation.verdict ?? null
				// 结案时如实记下「没被任何证据触及的假设」:未判不是「没问题」,是「没看过」。
				next.goal.unjudged = Array.isArray(mutation.unjudged) ? mutation.unjudged.slice() : []
			}
			break
		}
		case 'hypothesis/superseded': {
			/**
			 * **终态黏住**(与本体里「推翻不可撤销」同一条原则):
			 * 旧写法把任何还没被替代的行都改成 `superseded` —— 于是一条**已被推翻**的假设,
			 * 会因为下一版假设清单里没再列它而变成「已被替代」。而「被推翻」与「被替代」是两件事:
			 * 前者说这条猜想错了,后者说这条猜想不再被提。后者不该改写前者。
			 * 已经升格成事实的(`claim` 出现在 facts 里)同理:事实在,假设就不能被悄悄换掉。
			 */
			const promoted = factFromHypothesis(next.facts, mutation.goal, mutation.id, mutation.claim)
			const row = next.hypotheses.find((item) => item.id === mutation.id && item.status !== 'superseded' && item.status !== 'refuted' && !promoted)
			if (row !== undefined) {
				row.status = 'superseded'
				row.supersededBy = mutation.by
			}
			break
		}
		case 'plan/created': {
			// 重复 id 是上游 bug(比如两毫秒内建了两份计划)。忽略比污染旧计划好:
			// 忽略会让下一次调用明确报「没有活动计划」,污染则是静默地错。
			if (next.plans.some((plan) => plan.id === mutation.id)) break
			const plan = {
				id: mutation.id,
				goal: mutation.goal ?? null,
				phase_id: mutation.phase_id ?? null,
				brief: mutation.brief ?? '',
				status: 'active',
				at,
				closedAt: null,
				summary: null,
				blocked: undefined,
				/**
				 * 授权记号(ClearAI `plan.confirmed_at` / `confirmed_by`)。
				 * 两种取得方式,都可考:**显式动作**(人在原生审阅卡上批准 → `by:'user'`)与
				 * **行为**(交付过一步 → `by:'progress'`,见内核 AdvancePlan)。
				 * 第三种来源 `by:'autonomy'`(无人值守档在立约时自动确认)**已删除**:
				 * 那会让「计划经人确认」这条证据变成系统自己签的。读取侧不需要兼容它,
				 * 因为删除发生在写入侧,历史日志里最多出现 `user` 与 `progress`。
				 * 注意这是一个**记号**,不是闸门:没确认的计划照样能被交付推起来,那一刻记号按事实补写。
				 */
				confirmed_at: mutation.confirmed_at ?? null,
				confirmed_by: mutation.confirmed_by ?? null,
				steps: [],
			}
			next.plans.push(plan)
			appendSteps(plan, mutation.steps ?? [])
			break
		}
		case 'plan/confirmed': {
			// 第一次授权为准(`stamp_confirmed_by_progress` 同款幂等:已确认就不再改写)。
			const plan = planOf(mutation.plan)
			if (plan === undefined || plan.confirmed_at !== null) break
			plan.confirmed_at = mutation.at ?? new Date(at).toISOString()
			plan.confirmed_by = mutation.by ?? 'user'
			break
		}
		case 'plan/amended': {
			const plan = planOf(mutation.plan)
			if (plan === undefined || plan.status !== 'active') break
			appendSteps(plan, [mutation.step])
			break
		}
		case 'plan/refined': {
			const step = stepOf(mutation.plan, mutation.step)
			if (step === undefined || step.status !== 'open') break
			step.done_criteria = mutation.new_criteria
			step.criteria_versions.push(mutation.new_criteria) // 旧版本留着,什么都不删
			break
		}
		case 'plan/voided': {
			const step = stepOf(mutation.plan, mutation.step)
			if (step === undefined) break
			settle(step, 'void')
			if (step.status === 'void') step.voidReason = mutation.reason
			break
		}
		case 'plan/closed': {
			const plan = planOf(mutation.plan)
			if (plan !== undefined) {
				plan.status = 'closed'
				plan.closedAt = at
				plan.summary = mutation.summary ?? null
				plan.blocked = undefined
			}
			break
		}
		case 'plan/blocked': {
			const plan = planOf(mutation.plan)
			if (plan !== undefined) plan.blocked = { step: mutation.step, attempts: mutation.attempts, reason: mutation.reason }
			break
		}
		case 'block/counted': {
			next.blocks[`${mutation.plan}:${mutation.step}`] = mutation.count
			break
		}
		case 'block/cleared': {
			delete next.blocks[`${mutation.plan}:${mutation.step}`]
			break
		}
		case 'observation/recorded': {
			next.materials.push({
				id: mutation.id,
				ref: mutation.ref,
				source: mutation.source ?? 'self',
				digest: mutation.digest ?? null,
				bytes: mutation.bytes ?? null,
				note: mutation.note ?? null,
				path: mutation.path ?? null,
				step: mutation.step ?? null,
				branch: mutation.branch ?? null,
				at,
			})
			break
		}
		case 'audit/dispatched': {
			next.audits.push({
				id: mutation.id,
				step: mutation.step,
				plan: mutation.plan,
				kind: mutation.kind ?? 'evidence_audit',
				verdict: null,
				evaluator: 'independent',
				child: mutation.evaluator_session ?? null,
				capability: mutation.capability ?? null,
				shortfalls: [],
				basis: null,
				card_path: null,
				at,
			})
			break
		}
		case 'audit/settled': {
			const audit = next.audits.find((item) => item.id === mutation.id)
			if (audit !== undefined) {
				audit.verdict = mutation.verdict
				audit.shortfalls = mutation.shortfalls ?? []
				audit.basis = mutation.basis ?? null
				audit.card_path = mutation.card_path ?? null
			}
			break
		}
		case 'evidence/recorded': {
			next.evidence.push({
				id: mutation.id,
				step: mutation.step,
				plan: mutation.plan,
				branch: mutation.branch ?? null,
				verdict: mutation.verdict,
				level: mutation.level,
				evaluator: mutation.evaluator,
				basis: mutation.basis ?? null,
				refs: mutation.refs ?? [],
				/**
				 * **出处**:记账那一刻解析好的四类入口
				 * (`artifact` / `audit-card` / `evaluator-session` / `approval-record`)。
				 * 界面只渲染它,不再自己猜「这一串是路径还是材料 id」——
				 * 正是那种猜法让整排出处点不开(真数据踩过这个坑)。
				 */
				origins: Array.isArray(mutation.origins) ? mutation.origins : [],
				anchor: mutation.anchor ?? 'artifact',
				basis_reviewable: mutation.basis_reviewable !== false,
				at,
			})
			break
		}
		case 'step/advanced': {
			const step = stepOf(mutation.plan, mutation.step)
			if (step !== undefined) {
				settle(step, 'advanced')
				step.evidence = mutation.evidence
				step.advancedAt = at
			}
			break
		}
		case 'human/released': {
			/**
			 * 放行绑在**哪条轴**上要说清:主线绑步骤、世界线绑分支。
			 * `via` 记它凭什么算数——现在只有 `approval`(原生审批栈的权威记录),不推断。
			 */
			next.releases.push({
				step: mutation.step ?? null,
				plan: mutation.plan ?? null,
				fork: mutation.fork ?? null,
				branch: mutation.branch ?? null,
				via: mutation.via ?? null,
				at,
				call: mutation.call ?? null,
			})
			break
		}
		case 'fact/promoted': {
			/**
			 * 事实的字段:`scope` 是它的**边界**(推翻条件)——没有边界的事实下一轮没人敢用;
			 * `level` 是它被支持到哪一级(判者可查)。两者都来自升格那一刻的假设,不事后补。
			 * `hypothesis` 是产出它的那条假设(新账本才有),`assertions` 是类型化断言——
			 * 没提供就是 null:**不提供放行,提供即严校**(校验发生在落账之前)。
			 */
			next.facts.push({
				id: mutation.id,
				goal: mutation.goal,
				hypothesis: mutation.hypothesis ?? null,
				text: mutation.text,
				scope: mutation.scope ?? null,
				level: mutation.level ?? null,
				evidence: mutation.evidence ?? [],
				path: mutation.path ?? null,
				assertions: Array.isArray(mutation.assertions) ? clone(mutation.assertions) : null,
				at,
			})
			break
		}
		case 'fact/reviewed': {
			/**
			 * **人审查过一条被推翻标记的事实**:撤回它,或判证据不可靠、维持原事实。
			 *
			 * 两种结局都要落账——「没决定」与「决定维持」在别处长得一模一样,而后者正是
			 * 一次真实的价值判断(数据自己也可能错)。撤回是终态:记录留着,不再作为「已知」引用;
			 * 后来又出现支持证据也不复活,要复活就是新的一次升格。
			 */
			const fact = next.facts.find((item) => item.id === mutation.fact)
			if (fact === undefined) break
			fact.review = { decision: mutation.decision === 'retracted' ? 'retracted' : 'kept', reason: mutation.reason ?? null, at, by: mutation.by ?? 'user' }
			break
		}
		case 'worldline/prepared': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			fork.tier = mutation.tier
			fork.base = mutation.base ?? null
			fork.degradedReason = mutation.reason ?? null
			for (const entry of mutation.branches ?? []) {
				const branch = fork.branches.find((item) => item.id === entry.id)
				if (branch !== undefined) {
					branch.worktree_path = entry.path
					branch.git_branch = entry.branch
					branch.worktree_removed = false
				}
			}
			break
		}
		case 'fork/merge_skipped': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			fork.mergeSkipped = { branch: mutation.branch ?? null, reason: mutation.reason ?? null }
			break
		}
		case 'worldline/executing': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			const branch = fork?.branches.find((item) => item.id === mutation.branch)
			if (branch === undefined) break
			branch.execution = { child: mutation.child ?? null, capability: mutation.capability ?? null, ok: null, conclusion: null }
			break
		}
		case 'worldline/executed': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			const branch = fork?.branches.find((item) => item.id === mutation.branch)
			if (branch === undefined) break
			branch.execution = { ...(branch.execution ?? { child: mutation.child ?? null, capability: null }), ok: mutation.ok === true, conclusion: mutation.conclusion ?? null, note: mutation.note ?? null }
			break
		}
		case 'worldline/removed': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			const branch = fork?.branches.find((item) => item.id === mutation.branch)
			if (branch === undefined) break
			branch.worktree_removed = true
			branch.kept_ref = mutation.kept_ref !== false
			break
		}
		case 'fork/merged': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			fork.merge = {
				branch: mutation.branch,
				commit: mutation.commit ?? null,
				mode: mutation.mode ?? 'merged',
				snapshotCommit: mutation.snapshot_commit ?? null,
				// 临时采纳 = 分差不足以称结论(或由判断而来):它不是结论,是待复核的决定。
				provisional: mutation.provisional === true,
				by: mutation.by ?? 'metric',
				decisionNote: mutation.decision_note ?? null,
				margin: mutation.margin ?? null,
			}
			fork.mergeConflict = null
			break
		}
		case 'fork/merge_conflict': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			fork.mergeConflict = { branch: mutation.branch, winner: mutation.winner ?? null, margin: mutation.margin ?? null, detail: mutation.detail ?? null }
			break
		}
		case 'scout/dispatched': {
			next.scouts.push({
				id: mutation.id,
				step: mutation.step,
				plan: mutation.plan ?? null,
				trigger: mutation.trigger ?? null,
				child: mutation.child ?? null,
				capability: mutation.capability ?? null,
				// 任务身份:同一个身份已经正常回灌过的,再派时会被复用而不是重跑(幂等派遣)。
				digest: mutation.digest ?? null,
				conclusion: null,
				note: null,
				path: null,
				at,
			})
			break
		}
		case 'scout/settled': {
			const scout = next.scouts.find((item) => item.id === mutation.id)
			if (scout !== undefined) {
				scout.conclusion = mutation.conclusion ?? null
				scout.note = mutation.note ?? null
				scout.path = mutation.path ?? null
			}
			break
		}
		case 'fork/created': {
			if (next.forks.some((fork) => fork.step === mutation.step)) break // 一步只分叉一次
			next.forks.push({
				id: mutation.id,
				step: mutation.step,
				plan: mutation.plan,
				question: mutation.question,
				decide_by: mutation.decide_by,
				settled: false,
				abandoned: false,
				abandonReason: null,
				/** 横评仲裁的判决(`fork/arbitrated`)与它的会话 id(面板可旁观)。 */
				arbitration: null,
				arbitrationSession: null,
				/** 人在面板上的裁决(结构化记录,by:'user');null = 还没裁。 */
				humanDecision: null,
				verdict: null,
				undecidable: null,
				/**
				 * 算术算出来的推荐(`fork/recommended`):人裁决那条路上**唯一的输入**。
				 * 它是事实(系统算过),不是状态——分支秩不动,收敛仍然只走 ConvergeFork。
				 */
				recommended: null,
				recommendMargin: null,
				recommendProvisional: false,
				recommendBy: null,
				/**
				 * 采纳时**没能合并**的原因(`fork/merge_skipped`):面板据此说清「决定登记了,
				 * 赢家的产物要靠一次普通交付落位」。不转发它,这句话就永远说不出来。
				 */
				mergeSkipped: null,
				at,
				branches: (mutation.options ?? []).map((option) => ({
					id: option.id,
					label: option.label,
					approach: option.approach,
					done_criteria: option.done_criteria,
					workspace: option.workspace ?? null,
					artifacts: option.artifacts ?? [],
					level: option.level ?? 'L0',
					status: 'exploring',
					card_path: null,
					evaluator_session: null,
					humanDecision: null,
				reading: null,
					validity: null,
					verdict: null,
					basis: null,
					evaluator: null,
					evidence: null,
					at: null,
				})),
			})
			break
		}
		case 'branch/delivered': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			const branch = fork?.branches.find((item) => item.id === mutation.branch)
			if (branch === undefined) break
			if ((BRANCH_RANK[branch.status] ?? 0) < BRANCH_RANK.evaluated) branch.status = 'evaluated'
			branch.reading = mutation.reading ?? null
			branch.validity = mutation.validity ?? null
			branch.verdict = mutation.verdict ?? null
			branch.basis = mutation.basis ?? null
			branch.evaluator = mutation.evaluator ?? null
			branch.evidence = mutation.evidence ?? null
			// 评估卡与评估者会话:仲裁用卡(注入),面板用会话(旁观入口)。
			branch.card_path = mutation.card_path ?? null
			branch.evaluator_session = mutation.evaluator_session ?? null
			branch.at = at
			break
		}
		case 'fork/recommended': {
			/**
			 * 算术算出来的推荐。**只记事实,不动状态**:分支秩不变、`settled` 不变——
			 * 采纳永远还是要走 `ConvergeFork`(或人的一次裁决)。它存在的理由只有一个:
			 * 人门卡与面板读的是投影里的这个字段,不落账它们就只能写「推荐:无」。
			 */
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			fork.recommended = mutation.branch ?? null
			fork.recommendMargin = mutation.margin ?? null
			fork.recommendProvisional = mutation.provisional === true
			fork.recommendBy = mutation.by ?? null
			break
		}
		case 'fork/converged': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			fork.settled = true
			fork.undecidable = null
			fork.verdict = { winner: mutation.winner, margin: mutation.margin ?? null, tie: mutation.tie === true, metric: mutation.metric ?? null, direction: mutation.direction ?? null }
			for (const branch of fork.branches) {
				if ((BRANCH_RANK[branch.status] ?? 0) >= BRANCH_RANK.adopted) continue // 一旦采纳,状态冻结
				branch.status = branch.id === mutation.winner ? 'adopted' : 'pruned'
			}
			break
		}
		case 'fork/arbitration_dispatched': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			fork.arbitrationSession = mutation.arbiter_session ?? null
			break
		}
		case 'fork/arbitrated': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			// 判决写进节点(唯一真相仍是投影):采纳与否由内核重判一次决定,这里只记事实。
			fork.arbitration = {
				winner: mutation.winner ?? null,
				ranking: mutation.ranking ?? [],
				reason: mutation.reason ?? '',
				confidence: mutation.confidence ?? 'low',
				arbiter_session: mutation.arbiter_run_id ?? null,
			}
			break
		}
		case 'fork/undecidable': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			fork.undecidable = { code: mutation.code, reason: mutation.reason, readings: mutation.readings ?? [] }
			break
		}
		case 'fork/abandoned': {
			const fork = next.forks.find((item) => item.id === mutation.fork)
			if (fork === undefined) break
			fork.abandoned = true
			fork.abandonReason = mutation.reason ?? null
			break
		}
		case 'continuation/set': {
			/**
			 * 续跑窗口的账。四种状态就是「我们说过的话」的全部:
			 *   · `armed`     —— 我们布了防(或按策略恢复了它):此刻它在为我们跑。
			 *   · `paused`    —— **我们**按下的暂停,`why` 是真实理由(等裁决 / 等人门 / 阶段边界)。
			 *   · `stopped`   —— 我们收的兵(目标达成 / 如实放弃 / 计划触礁)。
			 *   · `withdrawn` —— 它不在了,而**不是我们清的**(我们的清除永远与建同拍):
			 *                    这是平台上唯一说得出口的解释,所以它也只说这些,不说「谁」干的。
			 * 一条记录:**窗口在会话里是单数**,所以后一条覆盖前一条,不留历史(历史在会话日志里)。
			 */
			next.continuation = {
				state: typeof mutation.state === 'string' ? mutation.state : 'unknown',
				goal: mutation.goal ?? null,
				target: mutation.target ?? null,
				why: mutation.why ?? null,
				/**
				 * 平台对象上那句身份文本的**最后一次观测值**:我们写下它时记我们的,
				 * 别人改写之后重记他的。判据是「平台上的文本 === 这条记录」⇒ 还是我们的。
				 */
				label: mutation.label ?? null,
				at,
			}
			break
		}
		/**
		 * **领域词汇的六个事件**:接纳 / 版本化修订 / 黏性废止(概念与谓词各三条)。
		 *
		 * 折法在这里只做解释:把事件折成 `lexicon`。校验(引用是否存在、形状对不对、
		 * 语义变化有没有偷偷走修订)全部发生在**落账之前**——预设侧的工具与宿主路由
		 * 用的是 `domain-language.js` 的同一份判据;折法不重复判一遍,否则两份判据必然漂。
		 */
		case 'ontology/term_added':
		case 'ontology/predicate_added':
		case 'ontology/term_revised':
		case 'ontology/predicate_revised':
		case 'ontology/term_deprecated':
		case 'ontology/predicate_deprecated': {
			next.lexicon = applyLexiconMutation(next.lexicon ?? emptyLexicon(), mutation, at)
			break
		}
		default: {
			return state // 不认识:不感兴趣,原样返回
		}
	}
	return next
}

/** 一次调用可能落多条事实(观测 → 准入 → 审计 → 证据 → 推进):按序折进去。 */
export function applyMutations(state, mutations) {
	if (!Array.isArray(mutations) || mutations.length === 0) return state
	let next = state
	for (const mutation of mutations) next = applyMutation(next, mutation)
	return next
}

/**
 * 会话日志事件 → 状态。这是投影的入口:除了工具结果里的变更记录,
 * 还吃三条**关于过程本身的事实**——
 *   · `tool/call` 在飞 → 「评估者在裁决」这个阶段(不用等结果就能看见)
 *   · `write`/`edit` 的自写路径 → L4 的「做的人自己写的不算观测」
 *   · `skill` 的加载与人的 `/名字` 引用 → 本会话的技能用量(没有第二本账)
 * 三者都来自日志,所以重挂载、重放、fork 之后都还对。
 */
export function applyEvent(state, event) {
	if (event === null || typeof event !== 'object') return state
	if (event.type === 'user/message') {
		// 内核观察到的事实(候选技能、采纳记录、合并目录)走**插件消息的结构化 section**——
		// 记在会话日志里,所以状态仍然可以从日志重放出来,而不是靠一句散文。
		const source = event.data?.source
		/**
		 * 原生**结算通知**(`source.kind === 'subagent-settled'`)**不进投影**。
		 *
		 * 它投给父会话时,模型已经在自己上下文里读到了那段文本;而账本侧的结算只认内核攥着的
		 * 那次 `run.result`(见内核的 `sweepScouts`)。这条通知是 best-effort,拿它当承重结构
		 * 在实跑里试过,收不到就是收不到(见 known-gaps)。所以折法对它**什么都不做**:
		 * 折它只会多出一个没有任何读者的字段。
		 *
		 * 将来真要消费它,记住一个坑:结论在「closing message:」之后——运行时前面那行摘要是
		 * **它自己写的**,不是子会话说的话。
		 */
		if (source !== null && typeof source === 'object' && source.kind === 'plugin' && Array.isArray(source.sections)) {
			/**
			 * 一条插件消息里可能**同时**带好几件事实(内核一次 pre-step 把目录、运行档、候选一起发)。
			 * 所以这里是「逐件折」而不是「找到一件就 return」——早退会漏掉后面的事件:
			 * 原来找到目录就 return,于是同一条消息里的**运行档被吃掉**,
			 * 表现是投影里的 effective 档永远停在「还没定档」,而机制那边早就按新档跑了。
			 */
			const brain = source.sections.find((section) => section?.name === 'clearai/brain')
			const tier = source.sections.find((section) => section?.name === 'clearai/autonomy')
			/**
			 * 内核在**回合之间**观察到的事实(目前:世界线执行者跑完)。
			 * 与工具结果里的 `meta.mutations` **同形**,所以直接走同一个 `applyMutations`——
			 * 事实只有一个折法,不管它是从工具结果来的还是从插件消息来的。
			 *
			 * 注意它必须**在同一道门里**折:一条插件消息可能同时带目录、当档与事实变更,
			 * 而 `next` 是这道门里才 clone 出来的。第一版把这段写在门**外**并引用了 `next`,
			 * 抛出的 ReferenceError 被自己的 try/catch 吞掉——于是它一直是空操作
			 * (失效模式:世界线结论回灌落账了,投影里却看不见)。
			 */
			const ontologySection = source.sections.find((section) => section?.name === 'clearai/ontology')
			if (ontologySection !== undefined && typeof ontologySection.text === 'string') {
				try {
					const payload = JSON.parse(ontologySection.text)
					if (payload !== null && typeof payload === 'object' && Array.isArray(payload.objects)) next.ontology = payload
				} catch {
					/* 坏 payload:不折(与目录同一条纪律,不猜) */
				}
			}
			const facts = source.sections.find((section) => section?.name === 'clearai/mutations')
			if (brain !== undefined || tier !== undefined || facts !== undefined) {
				let next = clone(state)
				let touched = false
				if (brain !== undefined && typeof brain.text === 'string') {
					try {
						const payload = JSON.parse(brain.text)
						if (Array.isArray(payload?.candidates)) next.brainCandidates = payload.candidates
						if (payload?.overview !== undefined) next.brain = payload.overview
						// 章程读数:只有真的变了才会出现在 payload 里(内核那侧按文件系统指纹去重)。
						if (payload?.constitution !== undefined) next.constitution = payload.constitution
						// 合并目录:内核从宿主的 skills 服务取的那张表(变了才发)。
						if (payload?.catalog !== null && typeof payload?.catalog === 'object' && Array.isArray(payload.catalog.entries)) {
							next.skillCatalog = { complete: payload.catalog.complete === true, entries: payload.catalog.entries, at: typeof event.time === 'number' ? event.time : null }
						}
						for (const name of Array.isArray(payload?.promoted) ? payload.promoted : []) {
							next.skillPromotions = [...(next.skillPromotions ?? []), { name, by: 'user', at: typeof event.time === 'number' ? event.time : Date.now() }]
						}
						touched = true
					} catch {
						// 坏 payload:如实少一条外脑事实,但不吞掉同一条消息里别的事实。
					}
				}
				if (facts !== undefined && typeof facts.text === 'string') {
					try {
						const payload = JSON.parse(facts.text)
						if (Array.isArray(payload?.mutations) && payload.mutations.length > 0) {
							next = applyMutations(next, payload.mutations)
							touched = true
						}
					} catch {
						// 同上:坏 payload 不当事实,也不影响别的。
					}
				}
				if (tier !== undefined && typeof tier.text === 'string') {
					try {
						const payload = JSON.parse(tier.text)
						const value = String(payload?.value ?? '')
						if (value === 'attended' || value === 'unattended') {
							next.autonomy = {
								...(next.autonomy ?? {}),
								effective: { value, preset: String(payload?.preset ?? value), source: payload?.source === 'session' ? 'session' : 'preset', at: typeof event.time === 'number' ? event.time : null },
							}
							touched = true
						}
					} catch {
						// 同上:坏 payload 不当事实,也不影响别的。
					}
				}
				if (touched) return next
			}
		}
		// 人在面板上按下的人门动作 → 落成**事实**(不是请求):确认计划就地生效;
		// 世界线的裁决记在分叉上,由内核的 ConvergeFork/AbandonFork 落实(合并与清理是内核的活)。
		const gate = parseHumanGate(event.data)
		// 人引用技能:一条含 `/名字` 的**用户消息**。这就是原生 pre-step 注入正文的判据,
		// 所以「人用过它」不是我们的推测,而是这条消息本身。插件与注入消息都不算(署名必须是人)。
		const quoted = source !== null && typeof source === 'object' && source.kind === 'user' ? invokedSkillNames(event.data) : []
		if (gate === null && quoted.length === 0) return state
		const at = typeof event.time === 'number' ? event.time : Date.now()
		const next = clone(state)
		for (const name of quoted) recordSkillUse(next, name, 'human', at, stepPointer(state))
		if (gate === null) return next
		// **旧日志容忍分支**(写入者已摘除,只有旧日志可能带着):人切运行档曾经是一条人门动作,旧会话里可能留着。
		// 读到它就照旧记成一条**人的事实**,让历史会话仍然读得通;当前面板上已经没有这个开关,
		// 新的会话不会再产生这一条。不要据此认为"现在还能切档"——要删这个分支得先确认没有旧日志。
		if (gate.action === 'set_autonomy') {
			const value = String(gate.value ?? '')
			if (!AUTONOMY_VALUES.includes(value)) return next
			next.autonomy = { ...(next.autonomy ?? {}), override: { value, at } }
			return next
		}
		/**
		 * 人审查一条事实:标的在 `value`(面板送出的是事实 id),缘由在 `note`。
		 * 已经审过的不再改(第一次决定为准,与计划授权那条同一条纪律)。
		 */
		/**
		 * 人认可一次**临时采纳**:它是那道门唯一的机械出口。
		 *
		 * 「临时采纳」的语义是「分差不足以称结论」;原来它只能靠人说话,而门开着会按住续跑
		 * ⇒ 什么都不做的话系统一直等。认可是**人的决定**,落一条 `by:'user'` 的确认留着痕迹;
		 * 「要改判据」那条路仍然在(说一句话,模型重做一条世界线)。
		 */
		if (gate.action === 'confirm_provisional') {
			const provisionalFork = next.forks.find((item) => item.id === (gate.fork ?? null))
			if (provisionalFork?.merge?.provisional !== true || provisionalFork.merge.confirmed !== undefined) return next
			provisionalFork.merge = { ...provisionalFork.merge, confirmed: { at, by: 'user' } }
			return next
		}
		if (gate.action === 'retract_fact' || gate.action === 'keep_fact') {
			const fact = next.facts.find((item) => item.id === (gate.value ?? null))
			if (fact === undefined || fact.review !== undefined) return next
			fact.review = { decision: gate.action === 'retract_fact' ? 'retracted' : 'kept', reason: gate.note ?? null, at, by: 'user' }
			return next
		}
		const fork = next.forks.find((item) => item.id === (gate.fork ?? null))
		if (fork === undefined) return next
		fork.humanDecision = {
			action: gate.action,
			branch: gate.branch ?? null,
			note: gate.note ?? null,
			at,
		}
		return next
	}
	if (event.type === 'tool/call') {
		const data = event.data ?? {}
		if (typeof data.name !== 'string') return state
		const next = clone(state)
		if (data.name === 'skill') {
			// 模型加载技能 = 原生 `skill` 工具的一次调用。工具名与参数形状照原样认,不猜别的写法。
			let args = null
			try {
				args = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments
			} catch {
				args = null
			}
			const name = args === null || typeof args !== 'object' || typeof args.name !== 'string' ? '' : args.name.trim()
			if (name !== '') recordSkillUse(next, name, 'model', typeof event.time === 'number' ? event.time : 0, stepPointer(state))
		}
		if (data.name === 'write' || data.name === 'edit') {
			let args = null
			try {
				args = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments
			} catch {
				args = null
			}
			const path = args === null || typeof args !== 'object' ? undefined : args.file_path
			if (typeof path === 'string' && path !== '' && !next.written.includes(path)) {
				next.written.push(path)
				if (next.written.length > MAX_WRITTEN) next.written.splice(0, next.written.length - MAX_WRITTEN)
			}
		}
		/**
		 * 会改工作区的那几件工具都记一笔:`write`/`edit` 是直接的,`bash`/`pwsh` 是间接的
		 * (脚本自己产出文件,内核看不见)。计数只增,判据留给用它的地方。
		 */
		if (WRITE_CAPABLE_TOOLS.has(data.name)) next.writeCalls = (next.writeCalls ?? 0) + 1
		next.inFlight = VERDICT_WAITERS.has(data.name) ? { name: data.name, callId: data.callId ?? null, at: typeof event.time === 'number' ? event.time : 0 } : null
		return next
	}
	if (event.type === 'tool/result') {
		const meta = event.data === undefined || event.data === null ? undefined : event.data.meta
		let next = state
		if (meta !== null && meta !== undefined && typeof meta === 'object' && meta.kind === MUTATION_KIND) {
			next = applyMutations(next, Array.isArray(meta.mutations) ? meta.mutations : meta.mutation === undefined ? [] : [meta.mutation])
		}
		if (next.inFlight !== null) {
			const cleared = next === state ? clone(state) : next
			cleared.inFlight = null
			return cleared
		}
		return next
	}
	return state
}

// ── 派生:阶段 / 完成度 / 假设状态 / 世界线阶段,全部现算,状态里不存 ──────────

export function derive(state) {
	const activePlan = state.plans.find((plan) => plan.status === 'active') ?? null
	const closedPlans = state.plans.filter((plan) => plan.status === 'closed')
	const pendingAudit = state.audits.some((audit) => audit.verdict === null)
	const stepOf = (planId, stepId) => state.plans.find((plan) => plan.id === planId)?.steps.find((step) => step.id === stepId) ?? null
	const levelIndex = (level) => LEVELS.indexOf(String(level ?? '').toUpperCase())

	/**
	 * 被**人**撤回的事实:它的主张在那条假设上落成 `retracted`(黏性终态)。
	 * 读的是事实上的 `review`——人的动作落在事实那一侧,facts 是唯一事实源。
	 */
	const retractedClaims = new Set((state.facts ?? []).filter((item) => item.review?.decision === 'retracted').map((item) => String(item.text ?? '')))
	/** 同一件事,新的关联方式:事实带 `hypothesis` 时按 id 撤(文本只是旧账本的退路)。 */
	const retractedHypotheses = new Set(
		(state.facts ?? [])
			.filter((item) => item.review?.decision === 'retracted')
			.map((item) => item.hypothesis)
			.filter((id) => typeof id === 'string' && id !== ''),
	)
	const hypotheses = state.hypotheses.map((hypothesis) => {
		const rows = []
		for (const item of state.evidence) {
			const step = stepOf(item.plan, item.step)
			if (step?.tests?.hypothesis === hypothesis.id) rows.push(item)
		}
		const refutations = rows.filter((item) => item.verdict === 'refute').length
		const inconclusive = rows.filter((item) => item.verdict === 'inconclusive').length
		const supportedLevel = rows
			.filter((item) => item.verdict === 'support')
			.reduce((best, item) => Math.max(best, levelIndex(item.level)), -1)
		let status = hypothesis.status
		// 撤回优先于一切:那是人对已升格事实的裁决,后来的支持证据不复活它。
		if (retractedHypotheses.has(hypothesis.id) || retractedClaims.has(String(hypothesis.claim ?? ''))) status = 'retracted'
		else if (status === 'proposed' && rows.length > 0) status = 'alive'
		// 被推翻是黏性终态:「已被替代」不该改写「已被推翻」——两件事。
		if (status !== 'superseded' && status !== 'refuted' && status !== 'retracted' && refutations > 0) status = 'refuted'
		/**
		 * **从没被走过的等级**(派生,零新账)。
		 *
		 * 等级衡量的是「这条结论在多大程度上只能靠信任做的人」,而它逐级上升的补偿是
		 * 独立裁决与人放行。所以「我直接在 L3 上交付、L0/L1/L2 从没走过」本身不是违规
		 * (首次测量没有廉价路可走),但**它必须看得见**——与「假设从没被证据碰过」记成
		 * `unjudged` 是同一条先例:不逼裁决,但不许把「没看过」写成「没问题」。
		 *
		 * 只列**低于已用到过的最高等级**、且一条证据都没有的那些级;没走过任何等级时为空
		 * (还没有声明可谈)。
		 */
		const used = new Set(rows.map((item) => String(item.level ?? '').toUpperCase()))
		const top = [...used].reduce((best, level) => Math.max(best, LEVELS.indexOf(level)), -1)
		const untouchedLevels = top <= 0 ? [] : LEVELS.slice(0, top).filter((level) => !used.has(level))
		return { ...hypothesis, status, supportedLevel: supportedLevel < 0 ? null : `L${supportedLevel}`, refutations, inconclusive, untouchedLevels }
	})

	/**
	 * `plan_is_authorized`:有记号 **或** 已经真的推进过(行为即授权)。
	 * 第二个分支在 ClearAI 那边是给存量文档用的;这里同样留着——事实与意图冲突时以事实为准。
	 */
	const planIsAuthorized = (plan) =>
		plan !== null && (plan.confirmed_at !== null || plan.steps.some((step) => step.status !== 'open'))
	const planConfirmationPending = activePlan !== null && activePlan.status === 'active' && !planIsAuthorized(activePlan)
	let phase = null
	let progress = null
	if (state.goal !== null) {
		if (state.goal.status === 'achieved' || state.goal.status === 'abandoned') phase = state.goal.status
		else if (state.inFlight !== null) phase = 'auditing' // 交付/结案在飞:正在等裁决
		else if (pendingAudit) phase = 'auditing' // 上一次派出去的裁决还没回来(超时留痕)
		else if (activePlan !== null && activePlan.blocked !== undefined) phase = 'stalled'
		else if (activePlan === null && closedPlans.length === 0) phase = 'planning'
		else if (activePlan !== null && activePlan.steps.every((step) => step.status !== 'open')) phase = 'stage_boundary'
		else if (activePlan !== null) phase = 'executing'
		else phase = 'stage_boundary'

		/**
		 * 完成度(派生,不存)。
		 *
		 * 一处自相矛盾的由来:目标已经 achieved、两条事实都升格了,卡片却写「完成度 0%」。
		 * 两个原因:① 计划一关,活跃计划为 null,口径回落到假设;② 而**升格**(`fact/promoted`)
		 * 是一条独立路径,它不改假设状态,于是分子是 0。
		 *
		 * 两条都修,而且顺序有意义:
		 *   · **终局优先**:目标已经有终局(achieved/abandoned)时,完成度就是终局该有的样子——
		 *     达成 = 1,如实放弃 = 0。中途口径不该覆盖终局,那是拿尺子量已经封箱的东西。
		 *   · **升格算数**:回落口径里,被升格成事实的假设也算「已确认」——升格本来就是它最硬的确认。
		 */
		const promotedClaims = new Set((state.facts ?? []).map((item) => String(item.text ?? '')))
		const promotedHypotheses = new Set(
			(state.facts ?? [])
				.map((item) => item.hypothesis)
				.filter((id) => typeof id === 'string' && id !== ''),
		)
		const live = activePlan?.steps.filter((step) => step.status !== 'void') ?? []
		if (state.goal?.status === 'achieved') progress = 1
		else if (state.goal?.status === 'abandoned') progress = 0
		else if (live.length > 0) progress = live.filter((step) => step.status === 'advanced').length / live.length
		else {
			const effective = hypotheses.filter((item) => item.status !== 'superseded' && item.status !== 'retracted')
			if (effective.length > 0) {
				const done = effective.filter((item) => item.status === 'confirmed' || promotedHypotheses.has(item.id) || promotedClaims.has(String(item.claim ?? ''))).length
				progress = done / effective.length
			}
		}
	}

	/**
	 * 世界线的**派生状态**(语义:见 recon 的「四条结束方式」):
	 *
	 *   · `failed`   —— 执行者没跑成(`worldline/executed{ok:false}`)。**它不是落选**:
	 *     落选意味着它跑完了、被尺子排到了后面;失败是「世界没给它机会」。原来的实现在这两件事上
	 *     共用一个状态(都还是 exploring),于是界面会一直为一条死掉的线呼吸——那是说假话。
	 *   · `orphaned` —— 承载它的**步骤被作废**了,而它还没收口。它既不是被人裁掉(没人做过这个决定),
	 *     也不是被算术排掉(没有尺子排过它):它是「随承诺撤回而终止」。这是两个已存在事实的**推论**,
	 *     不是第五种存储状态——零新账,也**不改写历史**(绝不把它写成「已放弃」)。
	 */
	const forks = state.forks.map((fork) => {
		const owner = (activePlan ?? closedPlans[closedPlans.length - 1] ?? null)?.steps.find((step) => step.id === fork.step) ?? null
		const ownerVoided = owner !== null && owner.status === 'void'
		return {
			...fork,
			ownerStatus: owner === null ? null : owner.status,
			ownerVoidReason: ownerVoided ? (owner.voidReason ?? null) : null,
			orphaned: ownerVoided && !fork.settled && !fork.abandoned,
			phase: fork.abandoned
				? 'abandoned'
				: fork.settled
					? 'settled'
					: ownerVoided
						? 'orphaned'
						: fork.branches.every((branch) => (BRANCH_RANK[branch.status] ?? 0) >= BRANCH_RANK.evaluated)
							? 'deciding'
							: 'exploring',
			branches: fork.branches.map((branch) => ({
				...branch,
				// 派生,不落库:执行没跑成,而状态还停在探索中。
				failed: branch.status === 'exploring' && branch.execution !== null && branch.execution !== undefined && branch.execution.ok === false,
				orphaned: ownerVoided && !fork.settled && !fork.abandoned && branch.status === 'exploring',
				/**
				 * **执行者未归**(与「失败」「孤儿」同一族的假话——不说破就会被当成还在跑):
				 *
				 * 执行者是异步派的,所以「它在跑」是一条会过期的状态。分叉一旦收口(收敛或放弃),
				 * 那条世界线就**没有归宿**了——回灌也进不了任何决定。可 `execution.ok` 仍是 `null`,
				 * 于是卡片会永远写「(执行中,结论会自动回灌)」:**一句实现了不了的承诺**。
				 *
				 * 两条已有事实的推论:分叉是终局 + 执行者没报过。零新账,也不改写 `execution` 本身
				 * (它仍然是「没报过」这个已发生的事实)。
				 */
				unreturned: (fork.settled === true || fork.abandoned === true) && branch.execution !== null && branch.execution !== undefined && branch.execution.ok === null,
			})),
		}
	})

	/**
	 * 收件箱:每一道门都是**状态锚**(由派生事实算出,不依赖中断记录)——门一解决,条目自然消失,
	 * 不可能残留成僵尸。
	 * 条目只带**分诊信息**(标题/摘要/指向),不带全部正文:收件箱是分诊,不是问诊。
	 *
	 * 这里**只放真门**:不拍板就真的推不动的那种。计划确认不再是条目(它是记号,
	 * 不是闸门;见 HUMAN_GATE_ACTIONS 的收敛记录)——收件箱里的每一条都经得起「等人是必须的吗」。
	 */
	const inbox = []
	for (const fork of forks) {
		// 人已经裁决过的不再等他(ClearAI 的条目是状态锚:状态一变,条目自然消失)。
		if (fork.phase !== 'deciding' || (fork.humanDecision ?? null) !== null) continue
		const label = fork.branches.find((branch) => branch.id === fork.recommended)?.label ?? null
		inbox.push({
			kind: 'fork_adopt',
			title: '世界线裁决',
			summary: `${fork.question} · ${fork.branches.length} 条世界线探索完毕,待采纳一条${label === null ? '' : ` · 推荐★${label}`}`,
			plan: fork.plan ?? null,
			step: fork.step,
			/** 条目要指得出**是哪一盘分叉**:界面那条「用提问卡决定」的手势按它去取题目与选项。 */
			fork: fork.id,
			human_action: 'adopt_branch',
			/** 门要什么:**点击**(有白名单动词)还是**一句话**(语义判断归模型)。 */
			needs: 'click',
		})
	}
	for (const fork of forks) {
		// 人已经认可过就不再等他(状态锚:状态一变,条目自然消失)。
		if (fork.merge?.provisional !== true || (fork.merge.confirmed ?? null) !== null) continue
		inbox.push({
			kind: 'provisional_review',
			title: '临时采纳待复核',
			summary: `${fork.question} · 已**临时**采纳「${fork.branches.find((branch) => branch.id === fork.merge.branch)?.label ?? fork.merge.branch}」:${fork.merge.decisionNote ?? '分差不足以称结论'}`,
			plan: fork.plan ?? null,
			step: fork.step,
			/** 标的:认可是对**哪一盘分叉**的认可。 */
			fork: fork.id,
			/** 认可是一个动作(一键);「要改判据」那条路仍然靠说一句话,由模型重做一条世界线。 */
			human_action: 'confirm_provisional',
			/**
			 * **一键认可**:它曾经是「要一句话」的门,而「认可就什么都不用做」有个洞——
			 * 门开着 ⇒ 续跑停着 ⇒ 什么都不做的话系统一直等,等一个永远不会来的动作。
			 * 认可是一次决定,决定就该有按钮;要改判据那条路仍然在(说一句话,模型重做一条世界线)。
			 */
			needs: 'click',
			ask: '要改判据就重做一条世界线(说一句即可)',
		})
	}
	for (const candidate of state.brainCandidates ?? []) {
		inbox.push({
			kind: 'skill_candidate',
			title: `候选技能:${candidate.name}`,
			summary: `${String(candidate.description ?? '').slice(0, 120)}——模型自己写的 SOP,采纳后才进它的技能目录。`,
			plan: null,
			step: null,
			human_action: 'promote_skill',
			skill: candidate.name,
			needs: 'click',
		})
	}
	if (activePlan !== null && activePlan.blocked !== undefined) {
		inbox.push({
			kind: 'plan_blocked',
			title: '计划被拦',
			summary: `连续 ${activePlan.blocked.attempts} 次未过观测准入:${activePlan.blocked.reason}`,
			plan: activePlan.id,
			step: activePlan.blocked.step ?? null,
			// 「解除阻塞」不是一次点击能表达的事(要改计划或改判据),所以它没有人门动作:
			// 人说一句「按 X 改」,语义判断归模型(ClearAI 删掉 NL 白名单的同一条理由)。
			human_action: null,
			needs: 'word',
			ask: '说一句怎么改(改计划 / 补判据),语义判断归模型',
		})
	}
	// `has_open_gate`:有一道门开着——调度侧据此不驱动(ClearAI:两个谓词同集)。
	const hasOpenGate = inbox.length > 0

	/**
	 * 事实那一行的**两个读数**(都派生,不另存):
	 *   · `refuted`——它的假设收到过推翻证据 ⇒ 这条事实要复核;
	 *   · `review` ——人已经审查过(撤回 / 维持),决定连缘由一起留着。
	 */
	const factRows = (state.facts ?? []).map((fact) => {
		const linked = typeof fact.hypothesis === 'string' && fact.hypothesis !== ''
		const owner = hypotheses.find((item) => (linked ? item.id === fact.hypothesis : String(item.claim ?? '') === String(fact.text ?? '')))
		return { ...fact, refuted: (owner?.refutations ?? 0) > 0, review: fact.review ?? null }
	})

	/**
	 * **领域词汇的派生读数**(两条,都不新存东西):
	 *   · `conflicts`——同一个单值谓词、同一主体、两个不同客体的**成对**事实。它是读数,
	 *     不是裁决:这里不撤回任何一侧,也不判断哪条为真(那是证据与人的事)。
	 *   · `lexiconHealth`——悬空引用、父链成环、没人用的条目、被废止条目仍在使用。
	 *     全是提示,不拦任何操作。
	 * 两者都吃 `factRows` 而不是 `state.facts`:事实的复核态与推翻标记是派生的,
	 * 在这里重算一遍就等于第二份判据。
	 */
	const lexicon = normalizeLexicon(state.lexicon)
	const conflicts = deriveConflicts(factRows, lexicon)
	const lexiconIssues = lexiconHealth(lexicon, factRows)
	for (const fact of factRows) {
		/**
		 * **推翻证据只标记事实,撤不撤由人定**(数据本身也可能是错的)。
		 * 两种结局都要能一键落地,否则这道门没有出口:维持也是一次决定,而且它必须落账,
		 * 不然「没决定」与「决定维持」在门的状态上长得一模一样,系统会一直等。
		 */
		if (fact.refuted !== true || fact.review !== null) continue
		inbox.push({
			kind: 'fact_refutation',
			title: '事实被推翻,等你决定',
			summary: `「${String(fact.text ?? '').slice(0, 90)}」出现了推翻证据:撤回它,或判证据不可靠、维持原事实。`,
			plan: null,
			step: null,
			/** 标的:面板把 `value` 原样写进人门动作,宿主据此核标的存在、fold 据此落账。 */
			value: fact.id,
			human_action: 'retract_fact',
			needs: 'click',
		})
	}

	const settlement = state.evidence.map((item) => {
		const step = stepOf(item.plan, item.step)
		const refs = state.materials.filter((material) => item.refs.includes(material.id)).map((material) => material.ref)
		const anchors = item.refs.filter((ref) => !ref.startsWith('m-'))
		return {
			stepId: item.step,
			intent: step?.done_criteria ?? '—',
			fact: [...refs, ...anchors].join(', ') || '—',
			evaluator: item.evaluator,
			delta: item.verdict === 'support' ? (item.basis ?? '—') : `${item.verdict}:${item.basis ?? '—'}`,
		}
	})

	return {
		phase,
		progress,
		hypotheses,
		activePlan,
		closedPlans,
		pendingAudit,
		forks,
		factRows,
		settlement,
		stepOf,
		inbox,
		hasOpenGate,
		planConfirmationPending,
		planIsAuthorized,
		/** 领域词汇与它的两条派生读数(见上面那段:冲突与健康度都只是读数)。 */
		lexicon,
		conflicts,
		lexiconIssues,
	}
}

/**
 * 人门动作的标记。
 *
 * 人在面板上按的每一个动作,都经宿主平面的路由变成**一条用户消息**进会话日志——
 * 内容是一行结构化标记,不是自然语言。为什么要这样:
 *   · **可审计**:谁在什么时候做了什么(采纳哪条世界线、扶正哪个技能、把档切成什么),
 *     就在日志里(`source.kind==='user'`);
 *   · **不做 NLU**:ClearAI 把确认短语白名单整体删掉了,理由是「语义判断只归模型,
 *     harness 只做顺序可判定的题」。标记进得来、自然语言进不来,是同一条纪律;
 *   · **agent 不可达**:这些动词**没有工具 schema**——模型能调的工具面里不存在它们,
 *     它只能看见「人做了什么」这条事实。
 *
 * 动词表只有 3 个(奥卡姆:另外砍掉的两个都是**重复**):
 *   · `confirm_plan` —— 原生 `dsh-plan-mode` 就是「用户复核的出口」;而我们自己的
 *     `planIsAuthorized` 本来就承认「交付第一步即授权」。计划确认从来不是闸门(它是记号),
 *     少一个假装成闸门的按钮,界面就不再暗示一条不存在的约束。需要人拍板时用原生
 *     `ask_user_question`(它同样把人的答复留在日志里,署名一样是人)。
 *   · `invoke_skill` —— 原生 `/` 技能触发器(`dsh-client-ui-skill` 注册 trigger `/`,
 *     `dsh-client-ui-input-trigger` 出候选菜单)做的正是同一件事,而且带候选菜单。
 * 留下的三个各有原生没有的职责:
 *   · `adopt_branch`/`abandon_fork` —— `ConvergeFork` 只认「算术」或「人门」两条路,
 *     算不出来时这是唯一的结构化人裁决通道(不做 NLU 是纪律,不是懒);
 *   · `promote_skill` —— 候选技能扶正是**只有人能触发**的写动作(模型不能自举)。
 *
 * 已摘除:`set_autonomy`。「在场与否」是**运行时状态**(有没有门开着、有没有裁决在飞),
 * 不是人在面板上按的一个开关;那个档位还顺手把「计划经人确认」变成系统自己签的。
 * 折法里仍留一条**只读**容忍分支(见 `applyEvent` 的注释):旧会话日志里可能有一条这样的记录,
 * 而历史必须继续读得通——但**当前没有任何写入者**,面板上也没有这个开关。
 */
export const HUMAN_GATE_MARK = '[clearai·人门]'
/** 面板上允许出现的动词。表外的动词一律拒(与贡献表同一套「表外的名字不许出现」)。 */
export const HUMAN_GATE_ACTIONS = ['adopt_branch', 'abandon_fork', 'promote_skill', 'retract_fact', 'keep_fact', 'confirm_provisional']
/** 运行档的两个取值。**只用于读取旧日志**里的 `set_autonomy` 记录;当前没有写入口。 */
export const AUTONOMY_VALUES = ['attended', 'unattended']

/** 从一条用户消息里认出人门标记;不是标记就返回 null。 */
export function parseHumanGate(message) {
	if (message === null || typeof message !== 'object') return null
	// 必须**署名是人**:插件/模型来源的同名标记不算人门动作。这条不是洁癖——
	// 内核也会往会话里写带 section 的插件消息,不区分来源就等于给了它一条伪造人意的路。
	if (message.source === null || typeof message.source !== 'object' || message.source.kind !== 'user') return null
	const blocks = Array.isArray(message.content) ? message.content : []
	const first = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string')
	if (first === undefined || !first.text.startsWith(HUMAN_GATE_MARK)) return null
	const rest = first.text.slice(HUMAN_GATE_MARK.length).trim()
	const line = rest.split('\n')[0].trim()
	try {
		const parsed = JSON.parse(line)
		if (parsed === null || typeof parsed !== 'object') return null
		if (!HUMAN_GATE_ACTIONS.includes(String(parsed.action))) return null
		return parsed
	} catch {
		return null
	}
}

/**
 * 技能面:合并目录(内核发的)+ 本会话用量(从日志折的)。
 *
 * 用量**不做跨会话统计**(第一性原理:判据混杂、没有决策者据此行动,
 * 更好的原语是「一次具体实例 + 可点开的指针」)。这里给的正是那个指针:谁在哪一步加载的、
 * 那一步**现在**是什么结果——现算,所以技能用完那一步后来又交付了,这里也跟着变。
 */
function skillUsageView(state) {
	const usage = state.skillUsage ?? {}
	return Object.values(usage)
		.map((entry) => {
			const events = Array.isArray(entry.events) ? entry.events : []
			const last = events.length === 0 ? null : events[events.length - 1]
			const plan = last === null ? null : (state.plans.find((item) => item.id === last.plan) ?? null)
			const step = plan === null || last.step === null ? null : (plan.steps.find((item) => item.id === last.step) ?? null)
			return {
				name: entry.name,
				model: entry.model ?? 0,
				human: entry.human ?? 0,
				lastAt: entry.lastAt ?? null,
				last:
					last === null
						? null
						: {
								by: last.by,
								at: last.at ?? null,
								plan: last.plan ?? null,
								step: last.step ?? null,
								ordinal: last.ordinal ?? null,
								// 指针落在的这一步现在的结果(现算):advanced / open / void
								outcome: step === null ? null : step.status,
								evidence: step === null ? null : (step.evidence ?? null),
								stepDo: step === null ? null : step.do,
							},
			}
		})
		.sort((left, right) => String(left.name).localeCompare(String(right.name)))
}

/** 面板契约。浏览器读的就是这个,一字不改。 */
export function view(state, sessionId) {
	const derived = derive(state)
	const plan = derived.activePlan ?? derived.closedPlans[derived.closedPlans.length - 1] ?? null
	const sid = sessionId === undefined || sessionId === null ? (state.sessionId ?? null) : String(sessionId)
	return {
		ok: true,
		mounted: true,
		sessionId: sid,
		/** 收件箱(面板「需要你 N」的数据面):只有分诊信息,正文在各自的视图里。 */
		inbox: derived.inbox,
		hasOpenGate: derived.hasOpenGate,
		/**
		 * 运行档:`value` = 当档(内核下发的那份)、`source` 说明它从哪来(部署预设 / 旧日志里的人门记录)。
		 * 面板与卡片都读这里 —— 投影是唯一真相。
		 * 注意**它不是可切换的开关**:`set_autonomy` 已摘除,现在只有部署预设会下发新值;
		 * `source === 'session'` 只可能来自旧日志。
		 */
		/** 项目章程的读数(面板「技能 · 记忆」页签顶部那一行;点开走原生预览)。 */
		constitution: state.constitution ?? null,
		/**
		 * 被闸门裁断过几次(`block/counted`):世界树的**分段通道**画的就是它——
		 * 这一步磨了几轮、其中几次被驳回。事实在投影里,面板只负责画。
		 */
		blocks: state.blocks ?? {},
		/**
		 * **人放行**(`human/released`)的痕迹:每一条都带它绑在哪条轴上
		 * (`step` / `branch`)以及凭据(`via:'approval'`,原生审批栈的权威记录)。
		 * 面板与测试都读这里 —— 推断出来的放行不该有痕迹,所以这份读数本身就是判据。
		 */
		releases: (state.releases ?? []).map((item) => ({ step: item.step ?? null, plan: item.plan ?? null, fork: item.fork ?? null, branch: item.branch ?? null, via: item.via ?? null, call: item.call ?? null, at: item.at ?? null })),
		autonomy: {
			value: state.autonomy?.effective?.value ?? null,
			preset: state.autonomy?.effective?.preset ?? null,
			source: state.autonomy?.effective?.source ?? null,
			override: state.autonomy?.override ?? null,
		},
		brain: state.brain ?? null,
		/** 本体形状(面板页眉据此生成,不手抄)。 */
		ontology: state.ontology ?? null,
		/**
		 * **领域词汇的读面**:概念、谓词、冲突、健康读数与图投影。
		 *
		 * 客户端不重算——它连折法都读不到(浏览器那半是独立模块),所以图在这里算好推下去。
		 * 于是「同一份账本 ⇒ 同一张图」是投影的性质,不是两处渲染约定出来的巧合。
		 */
		lexicon: {
			terms: derived.lexicon.terms,
			predicates: derived.lexicon.predicates,
			conflicts: derived.conflicts,
			health: derived.lexiconIssues,
			graph: graphProjection(state),
		},
		/**
		 * 续跑窗口的账:面板读它,于是「续跑停着——等裁决」这种**平台说不出来的话**
		 * 有地方说。轮数与相位仍然只在原生 dock 上出现(一个事实只在**一块**面上说),
		 * 这里交出去的只有:状态、它服务的事实对象、以及停下来的真实理由。
		 */
		continuation:
			state.continuation === null || state.continuation === undefined
				? null
				: {
						state: state.continuation.state,
						goal: state.continuation.goal ?? null,
						target: state.continuation.target ?? null,
						why: state.continuation.why ?? null,
						label: state.continuation.label ?? null,
					},
		/** 技能面:合并目录 + 本会话用量(「技能 · 记忆」页签的数据面)。 */
		skills: { catalog: state.skillCatalog ?? null, usage: skillUsageView(state) },
		goal:
			state.goal === null
				? null
				: {
						id: state.goal.id,
						claim: state.goal.claim,
						doneCriteria: state.goal.done_criteria,
						promoteAtLevel: state.goal.promote_at_level,
						status: state.goal.status,
						phase: derived.phase,
						progress: derived.progress,
						revision: state.goal.revision,
						// 结案留痕:没被任何证据触及的假设。未判不是「没问题」,是「没看过」。
						unjudged: Array.isArray(state.goal.unjudged) ? state.goal.unjudged.slice() : [],
						closeVerdict: state.goal.closeVerdict ?? null,
						hypotheses: derived.hypotheses.map((hypothesis) => ({
							id: hypothesis.id,
							claim: hypothesis.claim,
							refuteWhen: hypothesis.refute_when,
							status: hypothesis.status,
							supportedLevel: hypothesis.supportedLevel,
							refutations: hypothesis.refutations,
							inconclusive: hypothesis.inconclusive,
							/** 从没被走过的等级(派生):面板据此说清「这一级是跳上来的」。 */
							untouchedLevels: hypothesis.untouchedLevels,
							version: hypothesis.version,
						})),
					},
		/**
		 * **全部计划**:一个对话会有多个世界树。活动的那份照旧在 `plan` 里,
		 * 已收尾的留在这里 —— 它们没有被删(文档也归档在 `clear/goals/plans/<id>.md`),
		 * 只是原先**没有入口**切回去看 ✗。
		 */
		plans: state.plans.map((item) => ({
			id: item.id,
			status: item.status,
			brief: item.brief ?? '',
			closedAt: item.closedAt ?? null,
			stepCount: (item.steps ?? []).length,
			steps: (item.steps ?? []).map((step) => ({
				id: step.id,
				ordinal: step.ordinal,
				do: step.do,
				artifacts: (step.artifacts ?? []).map((artifact) => (typeof artifact === 'string' ? { path: artifact, exists: null } : artifact)),
				doneCriteria: step.done_criteria,
				tests: step.tests,
				status: step.status,
				evidenceId: step.evidence,
				advancedAt: step.advancedAt,
				voidReason: step.voidReason,
			})),
		})),
		plan:
			plan === null
				? null
				: {
						id: plan.id,
						status: plan.status,
						/** 计划自己的一句话(模型建计划时写的)。**给人看的名字**用它,内部 id 退回 tooltip。 */
						brief: plan.brief ?? '',
						blocked: plan.blocked ?? null,
						// 授权记号(ClearAI `plan.confirmed_at` / `confirmed_by`):面板据此显示计划门。
						confirmedAt: plan.confirmed_at ?? null,
						confirmedBy: plan.confirmed_by ?? null,
						confirmationPending: derived.planConfirmationPending && plan === derived.activePlan,
						steps: plan.steps.map((step) => ({
							id: step.id,
							ordinal: step.ordinal,
							do: step.do,
							/**
							 * **形状归一**:声明里 `artifacts` 是字符串(计划里写下的路径),
							 * 而面板按对象读 ⇒ 真数据里树详情显示 `undefined(缺)` ✗。
							 * `exists: null` 的意思是**没查过**(折法不碰盘);只有宿主路由 stat 过才会是 true/false。
							 */
							artifacts: (step.artifacts ?? []).map((artifact) => (typeof artifact === 'string' ? { path: artifact, exists: null } : artifact)),
							doneCriteria: step.done_criteria,
							tests: step.tests,
							status: step.status,
							evidenceId: step.evidence,
							advancedAt: step.advancedAt,
							voidReason: step.voidReason,
						})),
						advancedCount: plan.steps.filter((step) => step.status === 'advanced').length,
						totalCount: plan.steps.filter((step) => step.status !== 'void').length,
					},
		/**
		 * **跨计划的步骤索引**:步骤 id → 它的判据/归属。
		 *
		 * 为什么必须有它(真数据踩出来的):计划会改版、收尾、重开——**命题的验证步常常留在旧计划里**
		 * (成因:一场里多条计划,命题的 `tests` 可能在已收尾的那条上,而 `view.plan` 只交当前活动的那条)
		 * ⇒ 只查活动计划时,证据→步骤→命题这条链**全断**,面板上五个命题的证据与判者全显示「—」。
		 * 索引是纯派生,不新增存储。
		 */
		stepIndex: Object.fromEntries(
			state.plans.flatMap((item) =>
				item.steps.map((step) => [
					step.id,
					{ plan: item.id, planStatus: item.status, tests: step.tests ?? null, do: step.do, status: step.status },
				]),
			),
		),
		evidence: state.evidence.map((item) => ({
			id: item.id,
			stepId: item.step,
			planId: item.plan,
			/**
			 * `branch` 与 `anchor` **必须交出去**:面板要给每条证据指一个**出处**——
			 * 独立证据指评估卡(文件)、自判证据指它锚定的产物。少了这两个字段,
			 * 「评估卡」那一项永远出不来(成因:世界线证据的评估卡按 `分支` 归属,
			 * 与证据的 `stepId` 不是同一个 id,只看 stepId 会对不上)。
			 */
			branch: item.branch ?? null,
			anchor: item.anchor ?? 'artifact',
			/** 记账时定下的出处。旧日志没有这个字段 ⇒ 客户端走只读回退。 */
			origins: item.origins ?? [],
			basisReviewable: item.basis_reviewable !== false,
			verdict: item.verdict,
			level: item.level,
			evaluator: item.evaluator,
			basis: item.basis,
			refs: item.refs,
			at: item.at,
		})),
		audits: state.audits.map((item) => ({
			id: item.id,
			stepId: item.step,
			verdict: item.verdict,
			cardPath: item.card_path,
			evaluator: item.evaluator,
			// 评估者子会话:面板的**旁观入口**(只读旁观,不是接管)。
			evaluatorSession: item.child ?? null,
			capability: item.capability ?? null,
			at: item.at,
		})),
		materials: state.materials.map((item) => ({
			id: item.id,
			ref: item.ref,
			source: item.source,
			digest: item.digest,
			note: item.note ?? null,
			// 落盘路径:评估者与人靠它读全文(模型侧由卡片的资料面给出同一个指针)。
			path: item.path ?? null,
			bytes: item.bytes ?? null,
			step: item.step ?? null,
			at: item.at,
		})),
		facts: derived.factRows.map((item) => ({
			id: item.id,
			text: item.text,
			/** 边界(推翻条件)与支持等级:面板与货架都要显示它——「已知」必须带边界。 */
			scope: item.scope ?? null,
			level: item.level ?? null,
			evidenceIds: item.evidence,
			path: item.path,
			at: item.at,
			/** 派生:收到过推翻证据(要复核)与人的审查决定(撤回 / 维持)。 */
			refuted: item.refuted === true,
			review: item.review ?? null,
		})),
		/**
		 * 侦察记录:**结局要能看出来**。
		 *
		 * 失效模式:中断一次跑动之后「状态上全部显示执行完成」,而宿主其实报了失败。
		 * 两处都修了:内核改成按 `stopReason` 落账(aborted/error 不算完成),这里把 `note` 交出去
		 * 并派生成三态——跑着 / 正常回灌 / 没正常结束。面板与资料面据此分诊,而不是一律当"完成"。
		 */
		scouts: (state.scouts ?? []).map((item) => ({
			id: item.id,
			stepId: item.step,
			trigger: item.trigger,
			child: item.child,
			capability: item.capability,
			digest: item.digest ?? null,
			conclusion: item.conclusion,
			at: item.at,
			note: item.note ?? null,
			path: item.path ?? null,
			status: item.conclusion === null || item.conclusion === undefined ? 'running' : item.note === null || item.note === undefined ? 'settled' : 'failed',
		})),
		forks: derived.forks.map((fork) => ({
			tier: fork.tier ?? null,
			degradedReason: fork.degradedReason ?? null,
			merge: fork.merge ?? null,
			mergeConflict: fork.mergeConflict ?? null,
			/** 临时采纳:分差不足以称结论(或由判断而来)→ 面板要给「待复核」标记。 */
			provisional: fork.merge?.provisional === true,
			decisionNote: fork.merge?.decisionNote ?? null,
			/** 人在面板上的裁决(结构化记录,by:'user'):内核的工具据此落实它。 */
			humanDecision: fork.humanDecision ?? null,
			id: fork.id,
			stepId: fork.step,
			question: fork.question,
			phase: fork.phase,
			decided: fork.settled,
			abandonReason: fork.abandonReason,
			/** 承载它的步骤现在是什么状态(void = 承诺已撤回)——面板据此说「随步骤作废而终止」。 */
			ownerStatus: fork.ownerStatus ?? null,
			ownerVoidReason: fork.ownerVoidReason ?? null,
			/** 派生:步骤作废 + 还没收口。不是新状态,是两个事实的推论(见 derive 里的说明)。 */
			orphaned: fork.orphaned === true,
			decideBy: { metric: fork.decide_by?.metric ?? null, direction: fork.decide_by?.direction ?? null },
			verdict: fork.verdict,
			undecidable: fork.undecidable,
			/**
			 * 算术推荐(`fork/recommended`):人门卡与面板的「推荐★」读的就是它。
			 * 它只在分叉**还没收口**时才有意义——收口之后 `verdict.winner` 才是结论。
			 */
			recommended: fork.recommended ?? null,
			recommendMargin: fork.recommendMargin ?? null,
			recommendProvisional: fork.recommendProvisional === true,
			recommendBy: fork.recommendBy ?? null,
			/** 采纳时没能合并(以及为什么):决定登记了,产物靠一次普通交付落位。 */
			mergeSkipped: fork.mergeSkipped ?? null,
			arbitration: fork.arbitration ?? null,
			arbitrationSession: fork.arbitrationSession ?? null,
			branches: fork.branches.map((branch) => ({
				id: branch.id,
				label: branch.label,
				approach: branch.approach,
				doneCriteria: branch.done_criteria,
				workspace: branch.workspace,
				level: branch.level,
				status: branch.status,
				reading: branch.reading,
				validity: branch.validity,
				/** 派生:执行没跑成(`execution.ok === false`)。**它不是落选**——面板要分开说。 */
				failed: branch.failed === true,
				orphaned: branch.orphaned === true,
				/** 派生:分叉已收口而执行者没报过 ⇒ 那句「结论会自动回灌」作废(见 derive 里的说明)。 */
				unreturned: branch.unreturned === true,
				execution: branch.execution ?? null,
				verdict: branch.verdict,
				basis: branch.basis,
				evaluator: branch.evaluator,
				execution: branch.execution ?? null,
				cardPath: branch.card_path ?? null,
				evaluatorSession: branch.evaluator_session ?? null,
				gitBranch: branch.git_branch ?? null,
				worktreePath: branch.worktree_path ?? null,
				worktreeRemoved: branch.worktree_removed === true,
				keptRef: branch.kept_ref !== false,
				at: branch.at,
			})),
		})),
	}
}

/** 运行态卡:每回合由系统重算,注给模型的**事实**。 */
export function renderCard(state) {
	const derived = derive(state)
	const goal = state.goal
	const plan = derived.activePlan
	const time = (() => {
		const d = new Date()
		const pad = (n) => String(n).padStart(2, '0')
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
	})()
	const lines = ['【运行态卡 · Harness-owned state】', `- 时间:${time}(秒级对决策没有信息量,却会让缓存断裂——真需要精确时间用 bash date)`]
	/**
	 * 运行档:它是**人的处境**,不是模型的判断对象。写清楚它从哪来,模型就不必猜
	 * 「现在有没有人在旁边」——这一档决定续跑是驱动还是等人、立约是否即授权。
	 */
	const autonomy = state.autonomy?.effective ?? null
	if (autonomy !== null) {
		lines.push(
			/**
			 * 档位**不再是面板上的开关**:它只是部署预设写的初值。
			 * 所以卡片如实说"这件事是怎么配的",不再承诺"你可以在面板上切"(那是已删的能力 ✗)。
			 */
			`- 运行档:${autonomy.value === 'unattended' ? '无人值守' : '人在场'}(部署预设写的;它不是"要不要人参与"的开关——要不要人由**门**决定:计划待确认/等裁决/有人在等)`,
		)
	}
	if (goal === null) {
		lines.push('- 当前目标:未立(SetGoal 需要一份「怎样算回答了」的判据)')
	} else {
		const progress = derived.progress === null ? '无法计算' : `${Math.round(derived.progress * 100)}%`
		lines.push(`- 当前目标(${goal.id} · rev${goal.revision} · ${goal.status}):${goal.claim}`)
		lines.push(`- 判据:${goal.done_criteria}`)
		lines.push(`- 阶段(派生):${derived.phase} · 完成度(派生):${progress}`)
	}
	if (derived.hypotheses.length > 0) {
		lines.push('- 假设状态(由证据算出):')
		for (const hypothesis of derived.hypotheses) {
			/**
			 * 三样全零 = **没人碰过它**,与「判过但无法判定」是两回事:
			 * 前者要如实说「未触及」,后者本来就有「无法判定 n」这个读数。
			 * 不逼 verdict,但也不许把「没看过」写成「没问题」。
			 */
			const untouched = (hypothesis.supportedLevel === null || hypothesis.supportedLevel === undefined) && (hypothesis.refutations ?? 0) === 0 && (hypothesis.inconclusive ?? 0) === 0
			const skipped = (hypothesis.untouchedLevels ?? []).length === 0 ? '' : ` · 未走过 ${hypothesis.untouchedLevels.join('/')}`
			const readings = untouched ? '(未触及)' : `(支持到 ${hypothesis.supportedLevel ?? '—'} · 推翻 ${hypothesis.refutations} · 无法判定 ${hypothesis.inconclusive}${skipped})`
			lines.push(`  · ${hypothesis.id} [${hypothesis.status}] ${hypothesis.claim} — 推翻条件:${hypothesis.refute_when}${readings}`)
		}
	}
	if (plan === null) {
		lines.push('- 当前计划:无活动计划')
	} else {
		if (derived.planConfirmationPending) {
			/**
			 * 授权记号的语义:它是**归属**,不是闸门。
			 *
			 * 记号没落账时,自动续跑会 hold(turnDemand),但显式推进不被阻止——
			 * 第一次交付会在同一条变更里按事实补写 by='progress'(行为即授权)。
			 * 卡片只交代机理,不劝人走哪条路:劝告会让人(和模型)以为有一道必须走的门。
			 * 卡片不出现字段名(plan_confirmation_pending / confirmed_at 是账本词汇,
			 * 不是给人与模型读的语言)——事实用一句人话说。
			 */
			lines.push('- 授权:记号未落账。未经人批准的计划不会自动续跑;显式推进时,第一次交付会按事实补写归属(行为即授权)')
		} else if (plan.confirmed_at === null) {
			// 记号没落账,但计划事实上已经推进过:授权已经发生。照旧写「等人确认」会与上一行
			// 当场矛盾,而同一段里两句打架的话比一句错话更糟(ClearAI 的原话)。
			lines.push('- 授权:记号未落账,但本计划已推进过——授权已经发生(行为即授权),继续执行')
		} else {
			lines.push(`- 授权:已于 ${plan.confirmed_at} 落账(${plan.confirmed_by === 'user' ? '人显式批准' : plan.confirmed_by === 'progress' ? '据推进事实补写归属' : String(plan.confirmed_by)})`)
		}
		lines.push(`- 当前计划(${plan.id}${plan.goal === null ? '' : ` · 目标 ${plan.goal} 的一个阶段`})步骤:`)
		for (const step of plan.steps) {
			const tests = step.tests === null ? '' : ` 【验 ${step.tests.hypothesis} · ${step.tests.level}】`
			lines.push(`  ${step.ordinal}. [${step.status}] ${step.do}${tests} → 物证:${step.artifacts.join(', ') || '(未声明)'}`)
		}
		const first = plan.steps.find((step) => step.status === 'open')
		if (first !== undefined) lines.push(`- 下一个可交付步:${first.id}(交付只能落在第一个未落定步)`)
		if (plan.blocked !== undefined) lines.push(`- 计划被拦:${plan.blocked.reason}(连续 ${plan.blocked.attempts} 次未过闸,停下等人)`)
	}
	if (derived.hasOpenGate) {
		lines.push(`- 门(等人,${derived.inbox.length} 件):${derived.inbox.map((item) => `${item.kind}·${item.title}`).join(' / ')}`)
	}
	for (const fork of derived.forks) {
		const ruler = fork.decide_by === null || fork.decide_by === undefined ? '(无尺子)' : `${fork.decide_by.metric}(${fork.decide_by.direction === 'min' ? '越小越好' : '越大越好'})`
		lines.push(`- 世界线(步 ${fork.step} · ${fork.phase}):${fork.question} — 裁决指标 ${ruler}`)
		for (const branch of fork.branches) {
			const reading = branch.reading === null || branch.reading === undefined ? '未报读数' : `读数 ${branch.reading}${branch.validity === 'usable' ? '' : '(不可用)'}`
			/**
			 * 执行者是**异步**派的(ForkPlan 不空等结论),所以「它跑完了没有」是一条
			 * 独立的事实——不写出来,模型会以为分支在闲着,或者以为结论已经到手。
			 */
			const executing = branch.execution ?? null
			const runner =
				executing === null
					? '(执行者未派出)'
					: branch.unreturned === true
						? '(执行者未归 · 分叉已收口,结论不再回灌)'
						: executing.ok === null
							? '(执行中,结论会自动回灌)'
							: executing.ok === true
								? '(已回灌)'
								: `(执行没跑成:${executing.note ?? 'unknown'})`
			lines.push(`  · [${branch.status}] ${branch.label}:${branch.approach}(${reading})${runner}`)
		}
		if (fork.verdict !== null && fork.verdict !== undefined) {
			lines.push(`  → 已采纳 ${fork.verdict.winner},差额 ${fork.verdict.margin ?? '—'}${fork.verdict.tie === true ? ' · 并列' : ''}(算术裁决,不是谁说得响)`)
		}
		if (fork.undecidable !== null && fork.undecidable !== undefined) {
			lines.push(`  → 算不出来(${fork.undecidable.code}):${fork.undecidable.reason} 停下问人,不许退化成随便挑一条。`)
		}
		if (fork.abandoned === true) lines.push(`  → 已放弃探索:${fork.abandonReason ?? ''}(留痕)`)
		if (fork.phase === 'exploring' || fork.phase === 'deciding') lines.push('  · 这一步长着未收敛的分叉:先交付每条世界线,再 ConvergeFork;普通交付不能越过它。')
		if (fork.humanDecision !== null && fork.humanDecision !== undefined && !fork.settled) {
			const decision = fork.humanDecision
			lines.push(
				decision.action === 'adopt_branch'
					? `  · **人已裁决**:采纳「${fork.branches.find((branch) => branch.id === decision.branch)?.label ?? decision.branch}」——跑 ConvergeFork 落实它(合并是内核的活)。`
					: '  · **人已裁决**:放弃这条分叉——跑 AbandonFork 落实它(清理工作副本是内核的活)。',
			)
		}
		if (fork.merge?.provisional === true) {
			lines.push(`  · **临时采纳**(待复核):${fork.merge.decisionNote ?? '分差不足以称结论'}——它不是结论,是一个待复核的决定。`)
		}
	}
	if (state.evidence.length > 0) {
		const last = state.evidence[state.evidence.length - 1]
		lines.push(`- 最近一条证据:${last.id} ${last.verdict}(${last.evaluator} · ${last.level})`)
	}
	if (state.facts.length > 0) lines.push(`- 已升格事实:${state.facts.length} 条`)
	/**
	 * **领域词汇与类型化事实**的一句话读数。
	 *
	 * 为什么要进卡片:模型要靠它决定「这条结论能不能写成断言、要不要先登记词」。而**冲突**
	 * 必须说出来、但不许自动处置——卡片只报数并指向那两条事实,撤不撤由人(或由证据)定。
	 * 事实没有断言时也报一句:那是「这门语言还没用起来」的读数,不是错误。
	 */
	{
		const lexicon = derived.lexicon
		const typed = state.facts.filter((fact) => Array.isArray(fact.assertions) && fact.assertions.length > 0).length
		if (lexicon.terms.length > 0 || lexicon.predicates.length > 0) {
			lines.push(`- 领域词汇:${lexicon.terms.length} 个概念 · ${lexicon.predicates.length} 个谓词;已升格事实里 ${typed}/${state.facts.length} 条带类型化断言`)
			if (derived.lexiconIssues.some((issue) => issue.severity === 'warning')) lines.push(`  · 词汇健康度有 ${derived.lexiconIssues.filter((issue) => issue.severity === 'warning').length} 条待看(悬空引用 / 成环;在面板「本体」里)`)
		}
		if (derived.conflicts.length > 0) {
			for (const conflict of derived.conflicts) {
				const sides = conflict.sides.map((side) => `${side.fact ?? '?'}(${side.value})`).join(' 对 ')
				lines.push(`- **冲突(${conflict.predicate} · ${conflict.subject})**:${sides}——两条都还没被撤回。它是读数不是裁决:要么用证据推翻一侧,要么由人撤回一侧;系统不替你选。`)
			}
		}
	}
	// 结案时留的痕:未判的假设不是「没问题」,是「没看过」——结案之后也要看得见。
	if (Array.isArray(goal?.unjudged) && goal.unjudged.length > 0) lines.push(`- 结案留痕:有 ${goal.unjudged.length} 条假设没有被任何证据触及(${goal.unjudged.join(', ')})`)
	/**
	 * **资料面**:外脑送回来的观测(不是你写的那些)**与还在跑的侦察**。
	 *
	 * 为什么必须有它:模型每一步唯一读到的窗口就是这张卡。从前结论只进 `view()`
	 * (面板读得到、模型读不到),于是判据写成「与侦察结论一致」时,模型与独立评估者
	 * 都无处可读,只能裁 inconclusive。这里给**指针 + 摘要**:全文落在
	 * `clear/knowledge/materials/<id>.md`,要细节就 `read` 它——卡片不背长文。
	 */
	{
		const foreign = state.materials.filter((material) => material.source !== 'self')
		const flying = state.scouts.filter((scout) => scout.conclusion === null || scout.conclusion === undefined)
		if (foreign.length > 0 || flying.length > 0) {
			lines.push('- 资料面(外脑送来的观测 + 还在跑的侦察;全文在工作区文件里,要细节就 read):')
			for (const material of foreign.slice(-3)) {
				const note = String(material.note ?? '')
				const excerpt = note.replace(/\s+/g, ' ').slice(0, 120)
				const where = material.path === null || material.path === undefined ? `账本 ${material.ref}` : material.path
				lines.push(`  · [${material.source}] ${where}${material.bytes === null || material.bytes === undefined ? '' : `(${material.bytes} 字)`}:${excerpt}${note.length > 120 ? '…' : ''}`)
			}
			if (foreign.length > 3) lines.push(`  · (还有 ${foreign.length - 3} 条更早的,全在 clear/knowledge/materials/ 下)`)
			for (const scout of flying) {
				lines.push(`  · [在跑] 侦察 ${scout.id}${scout.trigger === null || scout.trigger === undefined ? '' : `(${scout.trigger})`}:结论回来时会作为观测送到你面前`)
			}
		}
	}
	lines.push('- 提醒:进度、阶段、假设状态都是系统算出来的;你不能声明它们,只能通过交付与裁决推进。')
	return lines.join('\n')
}
