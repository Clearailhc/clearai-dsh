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
import { applyLexiconMutation, deriveConflicts, emptyLexicon, formatAssertion, graphProjection, lexiconHealth, normalizeLexicon, objectKey, termUsage, VALUE_FORMS } from './domain-language.js'
import { knowledgeView } from './knowledge-view.js'

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
 *   v10 → v11:**实体账本**独立于目标裁决:`entities`(登记的实例)、`entityAssertions`
 *           (登记那一刻就成立的边)、`hostHealth`(宿主读面降级的账),以及
 *           `hypotheses[].skips`(跳级理由)与 `goal.criteriaHistory`(判据修订)。
 *           旧日志这三块都是空表:实体图仍只从 `facts[].assertions` 长出来,逐字节不变。
 *   v11 → v12:**宿主已有的交还宿主**:分叉 / 世界线(`forks`)、侦察(`scouts`)、外脑与技能目录
 *           (`brain`、`brainCandidates`、`skillPromotions`、`skillCatalog`、`skillUsage`)、章程读数
 *           (`constitution`)与写入计数(`writeCalls`)都从状态里删了。旧日志里的对应事件类型
 *           (`fork/*`、`worldline/*`、`scout/*`、`branch/*`、`git/*`、`clearai/brain` 段、相关人门动作)
 *           不认识就原样跳过,其余部分照常折出来。
 * 投影缓存按版本判定,所以旧缓存会被丢弃、从日志重折一遍。
 */
export const STATE_VERSION = 12

/**
 * **只留台账、不折进视图**的变更类型(词汇表的另一半)。
 *
 * 为什么要有这份清单:`applyMutation` 对不认识的类型**原样返回**(前向兼容,必须如此),
 * 于是「故意不折」与「忘了折」在代码里长得一模一样。把它显式写下来,两件事就分开了:
 *   · 发行自检按它比对内核实际落的每一类事实 —— 既没折、又不在清单里的,是**真的缺口**;
 *   · 读代码的人不必逐条 grep 才知道哪些事实不上界面。
 *
 * 它们记「系统做了什么」(准入检查),不改变任何派生量。
 * 旧日志里的 `git/*`(已删除的账本)不再列出:不认识的类型原样返回,本来就会被安静跳过。
 */
export const LEDGER_ONLY_MUTATIONS = ['admission/checked']

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
		 * **实体账本**(契约冻结第 5 条)与它的第二条通道。
		 *
		 * 从前「实体」只有一个来源:已升格事实里的断言——于是它是目标级裁决的**副产品**,
		 * 一条观察要在图上出现,得先过一遍与它无关的判据(真跑里 5 条断言齐备、门槛也放行,
		 * 却因为另一条无关的判据被 inconclusive 卡住,实体图最终 0 节点 0 边)。
		 *
		 * 现在实体有两条一等写入口,都在登记那一刻落账:
		 *   · `entities`——登记的实例(`source:'registered'` 的节点);
		 *   · `entityAssertions`——「某实例在某出处下成立某断言」(`source:'asserted'` 的边)。
		 * 只登记节点不产边是不够的:图可以被一堆孤立节点满足,边照样不长。
		 */
		entities: [],
		entityAssertions: [],
		/**
		 * **宿主读面降级的账**(`host/inactive`)。
		 *
		 * 宿主的会话服务 / 投影服务取不到时,「读不到」与「没有」在界面上长得一模一样——
		 * 一句空读数会被读成「世上没有这件事」。所以降级本身要落一条事实,随投影暴露给面板与卡。
		 * 只增不删,留最近若干条(它是读数,不是档案)。
		 */
		hostHealth: [],
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
	}
}

/**
 * 等裁决的三个工具:它们的调用在飞时,派生阶段是 `auditing`。
 * 其余工具不等外部裁决,不该让面板在每次调用时跳一下。
 */
const VERDICT_WAITERS = new Set(['AdvancePlan', 'CloseGoal'])

/** 记下来的自写路径有上限:它是判据,不是档案(档案在会话日志里)。 */
const MAX_WRITTEN = 512

/** 深拷贝(状态是纯 JSON,这是唯一需要的工具)。 */
function clone(value) {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/** 一次 trim 后的字符串。变更字段大多是「可有可无的字符串」,到处写 typeof 会淹掉正文。 */
const trimmed = (value) => (typeof value === 'string' ? value.trim() : '')

/** 纯对象(状态是纯 JSON:数组不算对象)。 */
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** 宿主健康那份账留最近多少条:它是读数(这一刻读不到),不是档案(档案在会话日志里)。 */
const MAX_HOST_HEALTH = 20

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
				/** 修订可以带上新的速览与判据清单(没带就保持旧值——「不提供」不等于「清空」)。 */
				if (typeof mutation.headline === 'string' && mutation.headline !== '') previous.headline = mutation.headline
				if (Array.isArray(mutation.criteria)) previous.criteria = clone(mutation.criteria)
				if (typeof mutation.criteria_note === 'string') previous.criteria_note = mutation.criteria_note
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
					/**
					 * **三行速览里的那一句**「正在解决什么」:目标主张常常是一段话,
					 * 而卡顶那一行要是短的。没给就回落到主张(旧目标照旧读得通)。
					 */
					headline: typeof mutation.headline === 'string' && mutation.headline !== '' ? mutation.headline : null,
					/** 可清点的判据清单(每条一句话)。它是**读面**,判定仍看 `done_criteria`。 */
					criteria: Array.isArray(mutation.criteria) ? clone(mutation.criteria) : null,
					criteria_note: typeof mutation.criteria_note === 'string' ? mutation.criteria_note : null,
					/** 迁移期一次性放行:旧目标缺 headline / 长文本时由内核标它,卡上如实标注。 */
					legacy: mutation.legacy === true,
					/**
					 * **判据修订史**(`criteria/revised` 折进来):改「怎样算完成」要有一份独立裁决的
					 * `audit`,所以每一次改动都能指回是谁裁的。它只增不删(判据的历史就是判据的一部分)。
					 */
					criteriaHistory: [],
				}
			}
			for (const hypothesis of mutation.hypotheses ?? []) {
				/**
				 * **一个 id 只对应一条主张,永远**(与领域词汇那条「语义变化必须换 id」同一条纪律)。
				 *
				 * 真跑里这条缺失的代价很大:修订目标时内核给**同一句话**发了新 id,而这里照单全收,
				 * 于是一张运行态卡上出现 4 条主张的 6~8 行读数——同一句话挂着两个 id、各报一个状态
				 * (一个「已支持」、另一个「未触及」),模型得自己去调和两份打架的读数。
				 *
				 * 所以这里按 id **upsert**,但**只更新不改变身份的那些字段**(断言、推翻条件、版本):
				 * 修订时给一条老命题补上断言是正当的更新;而换掉它的 `claim` 就是拿旧 id 说新话——
				 * 那一律拒(内核已在源头保证换主张必换 id),终态(`superseded` / `refuted`)同样黏住。
				 */
				const claim = String(hypothesis.claim ?? '')
				const known = next.hypotheses.find((item) => item.id === hypothesis.id)
				if (known !== undefined) {
					if (String(known.claim ?? '') !== claim) continue
					known.refute_when = hypothesis.refute_when
					known.version = hypothesis.version ?? known.version
					if (Array.isArray(hypothesis.assertions)) known.assertions = clone(hypothesis.assertions)
					continue
				}
				next.hypotheses.push({
					id: hypothesis.id,
					goal: mutation.id,
					claim,
					refute_when: hypothesis.refute_when,
					status: 'proposed',
					version: hypothesis.version ?? 1,
					/**
					 * **类型化断言随假设走**:登记时校验、升格时定型。
					 * 不写断言照旧成立(宽松+校验);写了就是「这条主张用这门语言怎么说」。
					 */
					assertions: Array.isArray(hypothesis.assertions) ? clone(hypothesis.assertions) : null,
					/**
					 * **跳级理由**(`level/skipped` 折进来)。跳级本身不违规(首次测量没有廉价路
					 * 可走),但「我直接上了 L3、下面几级从没走过」必须能说清为什么不适用——
					 * 理由落在这里,`derive()` 会把被理由覆盖的层从 `untouchedLevels` 里减掉。
					 */
					skips: [],
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
			const plan = planOf(mutation.plan)
			if (plan?.blocked?.step === mutation.step) plan.blocked = undefined
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
				/**
				 * **同态判据**:被裁决的那份产物/问题的摘要指纹。内核据此判断
				 * 「这一次与上一次是同一件东西」并复用旧裁决——于是「这次没花钱」在账上看得见。
				 */
				digest: mutation.digest ?? null,
				shortfalls: [],
				basis: null,
				card_path: null,
				at,
			})
			break
		}
		/**
		 * **同态复用**(`audit/reused`):这一步的裁决直接复用了同一 digest 的旧裁决。
		 *
		 * 它不产生新裁决,所以记的是**事实**:哪一步、凭哪个 digest、谁定的复用。
		 * `verdict` 给 `reused` 而不是 null——null 的含义是「裁决还没回来」,
		 * 拿它当哨兵会让派生阶段永远停在「在等裁决」。
		 */
		case 'audit/reused': {
			next.audits.push({
				id: mutation.id,
				step: mutation.step,
				plan: mutation.plan ?? null,
				kind: mutation.kind ?? 'evidence_audit',
				verdict: 'reused',
				evaluator: mutation.evaluator ?? 'independent',
				child: null,
				capability: null,
				digest: mutation.digest ?? null,
				reusedBy: mutation.by ?? null,
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
				if (mutation.digest !== undefined) audit.digest = mutation.digest ?? null
			}
			break
		}
		case 'evidence/recorded': {
			next.evidence.push({
				id: mutation.id,
				step: mutation.step,
				plan: mutation.plan,
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
			/** `via` 记它凭什么算数——现在只有 `approval`(原生审批栈的权威记录),不推断。 */
			next.releases.push({
				step: mutation.step ?? null,
				plan: mutation.plan ?? null,
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
		/**
		 * **实体登记**(`entity/registered`):某实例在某出处下被登记下来。
		 *
		 * 它是「实体」这条账的第一半:节点。登记是**主张**不是约定(与领域词汇相反),
		 * 所以它带 `basis` 与 `provenance`——「这个具体物凭什么在这里」必须说得出来。
		 * 校验(类型是不是已登记概念、出处是不是四类之一)在落账**之前**由内核做;
		 * 折法只做解释与去重:同一个 `${type}|${id}` 再登记 = 后到者覆盖展示字段,
		 * **首条的 `registeredAt` 保留**(身份先来,措辞可以后改)。
		 */
		case 'entity/registered': {
			const id = trimmed(mutation.id)
			const type = trimmed(mutation.type)
			if (id === '' || type === '') break
			const key = `${type}|${id}`
			next.entities = Array.isArray(next.entities) ? next.entities : []
			const known = next.entities.find((entity) => `${trimmed(entity.type)}|${trimmed(entity.id)}` === key)
			if (known !== undefined) {
				known.label = trimmed(mutation.label) || known.label
				if (trimmed(mutation.basis) !== '') known.basis = mutation.basis
				if (mutation.provenance !== undefined && mutation.provenance !== null) known.provenance = clone(mutation.provenance)
			} else {
				next.entities.push({
					id,
					type,
					label: trimmed(mutation.label) || id,
					basis: mutation.basis ?? null,
					provenance: mutation.provenance === undefined ? null : clone(mutation.provenance),
					registeredAt: at,
				})
			}
			break
		}
		/**
		 * **实体断言**(`entity/asserted`):「某实例在某出处下成立某断言」在**登记那一刻**落账。
		 *
		 * 这是实体的第二半,也是这一半让图真的长出边:只登记节点不产边,「实体落账」这道门
		 * 可以被一堆孤立节点满足,而图仍然没有边——第 2 轮那个病的同一形状。
		 * 它带出处、**不带等级**:没有过独立裁决,所以投影出来的边是 `source:'asserted'`,
		 * 与升格事实的边(`promoted`)在图上分得开。
		 */
		case 'entity/asserted': {
			const subject = isPlainObject(mutation.subject) ? mutation.subject : null
			const subjectId = subject === null ? '' : trimmed(subject.id)
			const predicate = trimmed(mutation.predicate)
			if (subjectId === '' || predicate === '') break
			const id = trimmed(mutation.id)
			next.entityAssertions = Array.isArray(next.entityAssertions) ? next.entityAssertions : []
			/** 同一条断言重复落(两条通道)时只留一条:id 是它的身份。 */
			if (id !== '' && next.entityAssertions.some((item) => trimmed(item.id) === id)) break
			next.entityAssertions.push({
				id: mutation.id ?? null,
				subject: { id: subjectId, type: trimmed(subject.type) },
				predicate,
				object: isPlainObject(mutation.object) ? clone(mutation.object) : null,
				evidence: isPlainObject(mutation.evidence) ? clone(mutation.evidence) : null,
				assertedAt: at,
			})
			break
		}
		/**
		 * **跳级理由**(`level/skipped`):这一级为什么在本项目里不适用。
		 *
		 * 折法只记事实,不改派生:`derive()` 把被理由覆盖的层从 `untouchedLevels` 里减掉,
		 * 于是「跳级没理由」这条缺口会自动消失——理由本身就是它的出口。
		 */
		case 'level/skipped': {
			const hypothesis = next.hypotheses.find((item) => item.id === mutation.hypothesis)
			if (hypothesis === undefined) break
			hypothesis.skips = Array.isArray(hypothesis.skips) ? hypothesis.skips : []
			hypothesis.skips.push({ levels: Array.isArray(mutation.levels) ? mutation.levels.slice() : [], reason: mutation.reason ?? null, at })
			break
		}
		/**
		 * **判据修订**(`criteria/revised`):改「怎样算完成」这件事本身。
		 *
		 * 它折成 `goal.criteriaHistory[]`,**不改** `done_criteria`(文本由立约/修订那条路改):
		 * 每一次改动都带一份独立裁决的 `audit`,于是「判据被谁裁着改过」可查。
		 */
		case 'criteria/revised': {
			if (next.goal === null) break
			if (mutation.goal !== undefined && mutation.goal !== null && next.goal.id !== mutation.goal) break
			next.goal.criteriaHistory = Array.isArray(next.goal.criteriaHistory) ? next.goal.criteriaHistory : []
			next.goal.criteriaHistory.push({
				revision: mutation.revision ?? null,
				from: mutation.from ?? null,
				to: mutation.to ?? null,
				reason: mutation.reason ?? null,
				audit: mutation.audit ?? null,
				at,
			})
			break
		}
		/**
		 * **宿主读面降级**(`host/inactive`,宿主半发)。
		 *
		 * 取不到会话 / 投影时,「读不到」与「没有」在界面上长得一模一样——空读数会被读成
		 * 「世上没有这件事」。所以降级本身落一条事实,只增不删,留最近若干条。
		 */
		case 'host/inactive': {
			next.hostHealth = Array.isArray(next.hostHealth) ? next.hostHealth : []
			/**
			 * **按 id 幂等**。宿主的观测是"每次读不到就记一次",而内核会在多个 pre-step 上
			 * 反复看到同一条观测——没有这条,账本与读数都会被同一件事淹掉。
			 * id 由**内容**算出来(scope + detail),所以同一个降级重复上账只会留下一条。
			 */
			if (mutation.id !== undefined && mutation.id !== null && next.hostHealth.some((entry) => entry.id === mutation.id)) break
			next.hostHealth.push({ id: mutation.id ?? null, scope: mutation.scope ?? null, detail: mutation.detail ?? null, at })
			if (next.hostHealth.length > MAX_HOST_HEALTH) next.hostHealth.splice(0, next.hostHealth.length - MAX_HOST_HEALTH)
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
 * **给一批变更盖上事件时间**。
 *
 * 产出方(内核)只写「发生了什么」,不读时钟;时间属于**日志里的那一刻**(`event.time`)。
 * 变更自己带了 `at` 就以它为准(有些路径确实知道更准的时刻),否则用事件时间。
 * 事件也没时间(旧日志/合成事件)时**不动它**——那里本来就是 0,不假装知道。
 */
function stampAt(mutations, time) {
	if (time === null || !Array.isArray(mutations) || mutations.length === 0) return mutations
	return mutations.map((mutation) => {
		if (mutation === null || typeof mutation !== 'object') return mutation
		if (typeof mutation.at === 'number') return mutation
		return { ...mutation, at: time }
	})
}

/**
 * ClearAI 自己署名的上下文消息吗。
 *
 * 宿主从 session 格式 v4 起把消息来源改成生产者自有:内核署 `plugin:clearai`
 * (`kind` 就是生产者身份),共享包装 `{ kind: 'plugin', plugin }` 已退役。
 * 退回到旧形状时**身份在 `plugin` 字段上**——只认 `clearai`,别的插件冒名不进这道门。
 * 宿主读已发布 V3 日志时把旧形状抬升成 `plugin:clearai`;但事件被**直接**喂进这个纯函数时
 * (测试、旧导出、重放工具)仍带着旧形状,所以两侧都认。
 */
function isClearaiSource(source) {
	if (source === null || typeof source !== 'object' || !Array.isArray(source.sections)) return false
	return source.kind === 'plugin:clearai' || (source.kind === 'plugin' && source.plugin === 'clearai')
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
		if (isClearaiSource(source)) {
			/**
			 * 一条插件消息里可能**同时**带好几件事实(内核一次 pre-step 把目录、运行档、候选一起发)。
			 * 所以这里是「逐件折」而不是「找到一件就 return」——早退会漏掉后面的事件:
			 * 原来找到目录就 return,于是同一条消息里的**运行档被吃掉**,
			 * 表现是投影里的 effective 档永远停在「还没定档」,而机制那边早就按新档跑了。
			 */
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
			if (tier !== undefined || facts !== undefined) {
				let next = clone(state)
				let touched = false
				if (facts !== undefined && typeof facts.text === 'string') {
					try {
						const payload = JSON.parse(facts.text)
						if (Array.isArray(payload?.mutations) && payload.mutations.length > 0) {
							next = applyMutations(next, stampAt(payload.mutations, typeof event.time === 'number' ? event.time : null))
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
		// 人在面板上按下的人门动作 → 落成**事实**(不是请求)。
		const gate = parseHumanGate(event.data)
		if (gate === null) return state
		const at = typeof event.time === 'number' ? event.time : Date.now()
		const next = clone(state)
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
		if (gate.action === 'retract_fact' || gate.action === 'keep_fact') {
			const fact = next.facts.find((item) => item.id === (gate.value ?? null))
			if (fact === undefined || fact.review !== undefined) return next
			fact.review = { decision: gate.action === 'retract_fact' ? 'retracted' : 'kept', reason: gate.note ?? null, at, by: 'user' }
			return next
		}
		/**
		 * **本体四动词(人的通道)**:路由侧已按同一份判据校验过(表外的值进不了日志),
		 * 折法只做两件事——落成带 `by:'user'` 的词汇事件,以及**幂等**(人可能点两下、
		 * 消息也可能重放:同 id 再登记不重复落,修订/废止的幂等由 applyLexiconMutation 自己保证)。
		 */
		if (gate.action === 'register_term' || gate.action === 'register_predicate') {
			const entry = gate.entry ?? {}
			const taken = (next.lexicon.terms ?? []).some((item) => item.id === entry.id) || (next.lexicon.predicates ?? []).some((item) => item.id === entry.id)
			if (taken === true) return next
			next.lexicon = applyLexiconMutation(next.lexicon, { t: gate.action === 'register_term' ? 'ontology/term_added' : 'ontology/predicate_added', ...entry, by: 'user' }, at)
			return next
		}
		if (gate.action === 'revise_term') {
			const entry = gate.entry ?? {}
			next.lexicon = applyLexiconMutation(next.lexicon, { t: 'ontology/term_revised', ...entry, by: 'user' }, at)
			return next
		}
		if (gate.action === 'deprecate_entry') {
			const entry = gate.entry ?? {}
			const kind = (next.lexicon.terms ?? []).some((item) => item.id === entry.id) ? 'ontology/term_deprecated' : 'ontology/predicate_deprecated'
			next.lexicon = applyLexiconMutation(next.lexicon, { t: kind, ...entry, by: 'user' }, at)
			return next
		}
		return next
	}
	if (event.type === 'tool/call') {
		const data = event.data ?? {}
		if (typeof data.name !== 'string') return state
		const next = clone(state)
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
		next.inFlight = VERDICT_WAITERS.has(data.name) ? { name: data.name, callId: data.callId ?? null, at: typeof event.time === 'number' ? event.time : 0 } : null
		return next
	}
	if (event.type === 'tool/result') {
		const meta = event.data === undefined || event.data === null ? undefined : event.data.meta
		let next = state
		if (meta !== null && meta !== undefined && typeof meta === 'object' && meta.kind === MUTATION_KIND) {
			/**
			 * **时间由折法盖上去,不由产出方写**:内核只写「发生了什么」,不知道也不该关心
			 * 这条记录落在日志的哪一刻;而事件本身带着 `time`,那才是权威。
			 *
			 * 不盖的后果是全局性的:每条变更的 `at` 都取 `mutation.at ?? 0`,于是凡是显示时间的
			 * 地方——Inspector 的历史、计划开合、证据时刻——一律是 **1970-01-01**。
			 * 盖在这里(而不是让内核每条都写一遍时间)同时满足两件事:内核不必读时钟,
			 * 折法仍然只有一个入口。
			 */
			const stamped = stampAt(Array.isArray(meta.mutations) ? meta.mutations : meta.mutation === undefined ? [] : [meta.mutation], typeof event.time === 'number' ? event.time : null)
			next = applyMutations(next, stamped)
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

/** 假设的终态:到了这里就不再是「还要继续做的活」。 */
const TERMINAL_HYPOTHESIS = new Set(['refuted', 'superseded', 'retracted'])

/**
 * **知识模式(分诊)与缺口读数。**
 *
 * 判据是**结构的,不是词法的**:这里不猜「这句话像不像研究任务」。立约(`SetGoal`)并用
 * 相互竞争的假设登记它,是模型自己已经做出的那次承诺——它意味着这件事要跨多轮、要有依据、
 * 要有可复核的结论。日常问答从不立约,于是从不进这一档。用词面启发式去猜任务类型,
 * 正是真跑里评估者抓到的那类「硬编码比例」的老路:猜错了没人能复核,而结构判据可以。
 *
 * 缺口(`gaps`)是**读数,不是拦截**,也不新增账本:每一条都从已有事实算出来,并且指得出
 * 一个今天就能补的动作。它们要进运行态卡——模型每一步唯一读到的那个窗口。让缺口每回合可见,
 * 比让提示词多叮嘱一句可靠:提示词会被读成建议,而卡里的读数不会。
 */
export function deriveKnowledge(state, hypotheses, factRows, lexicon) {
	const goal = state?.goal ?? null
	const open = goal !== null && goal.status !== 'achieved' && goal.status !== 'abandoned'
	const registered = hypotheses.filter((item) => !TERMINAL_HYPOTHESIS.has(item.status))
	/**
	 * 模式的**唯一**判据:目标还开着,而且它带着登记过的假设。
	 *
	 * 为什么不是「目标存在」就够:`minHypotheses` 是部署自己的产品立场(内核缺省是 0 = 机制中立)。
	 * 一个把下限设成 0 的部署明确说了「我不要这条纪律」,那时它也不该收到知识模式的读数。
	 */
	const mode = open && registered.length > 0 ? 'knowledge' : 'ordinary'
	const terms = Array.isArray(lexicon?.terms) ? lexicon.terms : []
	const predicates = Array.isArray(lexicon?.predicates) ? lexicon.predicates : []
	const gaps = []
	if (mode === 'knowledge') {
		/**
		 * ① 语言还没立起来:跨轮复用与「按概念取用已知」都要求先有词汇。
		 *    判据是**两个都空**——只有概念没有谓词时,关系还说不出来,但语言已经开张了,
		 *    那是进展不是缺口(否则每注册一个概念就多一条永远擦不掉的抱怨)。
		 */
		if (terms.length === 0 && predicates.length === 0) {
			gaps.push({
				code: 'no_language',
				count: registered.length,
				detail: `${registered.length} 条在验命题,但还没有任何概念与谓词:换一轮只能靠重读散文取用它们`,
				nextAction: '先 RegisterTerm 立词,再 RegisterPredicate 说清它们之间是什么关系',
			})
		}
		/**
		 * ② 只有散文主张的命题:断言是可选的(「加法,不是门槛」),所以这里**不是违规**,
		 *    而是「这条主张还不能被机器比对」。只算非终态的:被推翻/被替代的不再欠这一笔。
		 */
		const proseOnly = registered.filter((item) => !Array.isArray(item.assertions) || item.assertions.length === 0)
		if (proseOnly.length > 0) {
			gaps.push({
				code: 'prose_only_claims',
				count: proseOnly.length,
				detail: `${proseOnly.length} 条在验命题只有散文主张:两条结论是不是在说同一件事,只能靠重读判断`,
				nextAction: '用 SetGoal 的修订把这条主张写成断言(主词–谓词–宾语),引用已登记的 id',
			})
		}
		/**
		 * ③ **升格时没带断言**。只算 0.2.0 那条路走出来的事实(`hypothesis` 已关联)——
		 *    更早的事实补不上断言(见已知缺口),把它们算成欠账就是一条永远还不掉的抱怨。
		 */
		const unstructured = factRows.filter((fact) => typeof fact.hypothesis === 'string' && fact.hypothesis !== '' && (!Array.isArray(fact.assertions) || fact.assertions.length === 0))
		if (unstructured.length > 0) {
			gaps.push({
				code: 'unstructured_facts',
				count: unstructured.length,
				detail: `${unstructured.length} 条已升格事实没有断言:它们进不了实体图,也不能按概念取用`,
				nextAction: '下次升格时带上 assertions;这条老事实的形态靠新一次升格补',
			})
		}
		/**
		 * ④ **从没被证据碰过的命题**。只在这次会话已经真的跑出过证据之后才报——计划刚立、
		 *    一步都还没走时,所有假设都是「没碰过」,那是正常的起点而不是缺口。
		 *    它和结案时那条 `unjudged` 是同一条先例:**不逼裁决,但不许把「没看过」写成「没问题」**。
		 */
		if (Array.isArray(state?.evidence) && state.evidence.length > 0) {
			const untouched = registered.filter((item) => item.refutations + item.inconclusive === 0 && item.supportedLevel === null)
			if (untouched.length > 0) {
				gaps.push({
					code: 'untouched_claims',
					count: untouched.length,
					detail: `${untouched.length} 条在验命题还没有任何证据碰过(支持 / 推翻 / 无法判定都算碰过)`,
					nextAction: '给它派一个带 tests 的步骤并交付:支持 / 推翻 / 无法判定都算碰过',
				})
			}
		}
		/**
		 * ⑤ **实体层空着**。判据是整数可清点的:非终态命题的断言主体去重数(wanted)与实体层
		 *    节点数。两个数都从账本现算,没有一个字是猜的。
		 *
		 *    为什么必须有这一条:实体层从前是升格的副产品,于是「断言齐备、门槛也放行」却
		 *    因为另一条无关判据被卡住时,卡上四项全绿而**实体图是空的**——「看得见的边界」
		 *    在这里漏过一整层。诚实出口是两条:登记并落断言,或如实说清不值得留下形态。
		 */
		const assertions = registered.flatMap((item) => (Array.isArray(item.assertions) ? item.assertions : []))
		const wantedKeys = new Set(assertions.map((assertion) => `${String(assertion?.subject?.type ?? '')}|${String(assertion?.subject?.id ?? '')}`).filter((key) => key !== '|'))
		/**
		 * **判据是"每一个主体都落地了吗",不是"图上有没有东西"。**
		 *
		 * 弱判据(实体层节点数 === 0)有一个便宜的绕法:随便登记一个**无关**节点,
		 * 缺口就消失,而真正该落地的那几个主体仍然只在命题上。于是这道门形同虚设。
		 * 所以这里逐个主体判它有没有落成实体层节点,`count` 就是**还没落地的个数**。
		 */
		/**
		 * **"落地"的判据是"这句断言在图上有边",不是"图上有这个节点"。**
		 *
		 * 只数节点会漏掉最要命的那种形态:实例登记了(图上有节点),而关于它的那句话还挂在命题上
		 * ——图有节点、没有边,"实体图长出来了"仍然是一句空话。所以这里取**断言边的起点集合**:
		 * 一条边要么来自带出处的实体断言(`Assert`),要么来自过了独立裁决的升格事实。
		 */
		const graph = graphProjection(state)
		const landedKeys = new Set(graph.edges.filter((edge) => edge.kind === 'assertion').map((edge) => String(edge.from)))
		const unlanded = [...wantedKeys].filter((key) => !landedKeys.has(`term:${key}`) && !landedKeys.has(key))
		if (unlanded.length > 0) {
			gaps.push({
				code: 'entities_unlanded',
				count: unlanded.length,
				detail: `${unlanded.length} 个断言主体还没有落到实体图（共 ${wantedKeys.size} 个）：断言只挂在命题上，不构成「已知」`,
				nextAction: '先 RegisterInstance 把实例连出处登记下来；确实不值得留下形态就如实说清',
			})
		}
		/**
		 * ⑥ **跳级没有理由**。`derive()` 已经把写明理由的层从 `untouchedLevels` 里减掉,
		 *    所以这里数出来的每一个都是真的欠一句解释的层——出口只有一条:
		 *    用 `ExplainLevelSkip` 写清「为什么这一级在本项目里不适用」。
		 */
		const skipped = registered
			.map((item) => ({ id: item.id, levels: Array.isArray(item.untouchedLevels) ? item.untouchedLevels : [] }))
			.filter((item) => item.levels.length > 0)
		const skippedCount = skipped.reduce((sum, item) => sum + item.levels.length, 0)
		if (skippedCount > 0) {
			gaps.push({
				code: 'levels_skipped',
				count: skippedCount,
				detail: `${skippedCount} 处跳级没有理由（${skipped.map((item) => `命题 ${item.id} 缺 ${item.levels.join('/')}`).join('；')}）`,
				nextAction: '用 ExplainLevelSkip 写明「为什么这一级在本项目里不适用」',
			})
		}
		/**
		 * ⑦ **注册了却没人用的概念**。它和货架上「零引用的概念」那一节读**同一份**引用面
		 *    (`termUsage`),所以两处不会出现「货架说没人用、缺口说用了」这种两种读数。
		 */
		if (terms.length > 0 && registered.length > 0) {
			const usage = termUsage(lexicon, factRows, Array.isArray(state?.entityAssertions) ? state.entityAssertions : [])
			const orphans = terms.filter((term) => term.status !== 'deprecated' && (usage.get(term.id) ?? 0) === 0)
			if (orphans.length > 0) {
				gaps.push({
					code: 'orphan_terms',
					count: orphans.length,
					detail: `${orphans.length} 个概念没有任何结论引用它们（它们还只是约定，不是已知）`,
					nextAction: '要么在断言里用起来，要么在货架上如实标出「未被引用」',
				})
			}
		}
	}
	return {
		mode,
		/** 一句人话:为什么进了这一档(或为什么没进)。它进卡,所以不许写成术语。 */
		why:
			mode === 'knowledge'
				? `目标还开着,带着 ${registered.length} 条登记过的命题——这是跨轮、要依据、要可复核结论的活`
				: open
					? '目标还开着,但没有登记命题:按普通任务推进'
					: '没有开着的目标:按普通任务推进',
		gaps,
	}
}

/**
 * **知识预检(preflight)**:进入知识模式那一刻,把「已知」主动送到模型面前。
 *
 * 解决的问题:真跑里模型不查就开工——不是因为不知道有 \`QueryKnowledge\`,
 * 而是因为**没人提醒它此刻该查**。提示词会被读成建议;卡里的读数不会。
 * 于是这里把相关性判断做成投影:从当前目标与命题的文本出发,圈出**有界**的一组
 * 已有词汇、事实与冲突,随运行态卡注入。模型只在这份摘要不够用时才需要精确查询。
 *
 * 三条纪律(与缺口读数同一套):
 *   · **只读**:不产生变更,不新增状态——它就是 \`derive\` 的另一个读面;
 *   · **有界**:terms / predicates / facts 各有上限,超出如实说「还有 N 个未列出」;
 *   · **不猜语义**:相关性是**词面命中**(label / id / alias 出现在主张文本里),
 *     不是「系统认为相关」——命中的依据逐条可复核。
 *
 * 判据的形状:主张文本(去空白)包含词条的 label / id / alias(去空白),
 * 或者命题已有的断言引用了该谓词。前者是「这个词已经在对话里出现了」,后者是「已经在用了」。
 */
export function knowledgePreflight(state, derived) {
	const knowledge = derived?.knowledge ?? deriveKnowledge(state, derived?.hypotheses ?? [], derived?.factRows ?? [], derived?.lexicon)
	if (knowledge.mode !== 'knowledge') return null
	const terms = Array.isArray(derived?.lexicon?.terms) ? derived.lexicon.terms : []
	const predicates = Array.isArray(derived?.lexicon?.predicates) ? derived.lexicon.predicates : []
	const hypotheses = Array.isArray(derived?.hypotheses) ? derived.hypotheses : []
	const factRows = Array.isArray(derived?.factRows) ? derived.factRows : []
	const conflicts = Array.isArray(derived?.conflicts) ? derived.conflicts : []
	/** 命题的文本面:目标主张 + 每条命题的主张(去空白后做包含判断)。 */
	const claimText = [state?.goal?.claim, ...hypotheses.map((item) => item.claim)].filter((text) => typeof text === 'string' && text !== '').map((text) => String(text).replace(/\s+/g, ''))
	/** 命题已经引用的谓词(断言在假设上时就该算「在用」)。 */
	const usedPredicates = new Set(hypotheses.flatMap((item) => (Array.isArray(item.assertions) ? item.assertions : [])).map((assertion) => String(assertion?.predicate ?? '')))
	const hits = (entry) => {
		const candidates = [entry.id, entry.label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].filter((text) => typeof text === 'string' && text !== '').map((text) => String(text).replace(/\s+/g, ''))
		return candidates.some((candidate) => claimText.some((text) => text.includes(candidate)))
	}
	const LIMIT = 20
	const matchedTerms = terms.filter((term) => hits(term) && term.status !== 'deprecated')
	const matchedPredicates = predicates.filter((predicate) => usedPredicates.has(predicate.id) || hits(predicate))
	const matchedTermIds = new Set(matchedTerms.map((term) => term.id))
	const matchedPredicateIds = new Set(matchedPredicates.map((predicate) => predicate.id))
	/** 事实:断言引用了命中的谓词,或主词类型是命中的概念。 */
	const matchedFacts = factRows.filter((fact) =>
		(Array.isArray(fact.assertions) ? fact.assertions : []).some((assertion) => matchedPredicateIds.has(String(assertion?.predicate ?? '')) || matchedTermIds.has(String(assertion?.subject?.type ?? ''))),
	)
	return {
		mode: 'knowledge',
		/** 词面命中的词汇:模型接下来要写的结论大概率会用到它们。 */
		terms: matchedTerms.slice(0, LIMIT).map((term) => ({ id: term.id, label: term.label, gloss: term.gloss, parent: term.parent ?? null, status: term.status, uses: term.uses ?? 0, basis: term.basis ?? null })),
		termsTruncated: Math.max(0, matchedTerms.length - LIMIT),
		predicates: matchedPredicates.slice(0, LIMIT).map((predicate) => ({ id: predicate.id, label: predicate.label, domain: predicate.domain, range: predicate.range, functional: predicate.functional === true, status: predicate.status, uses: predicate.uses ?? 0, basis: predicate.basis ?? null })),
		predicatesTruncated: Math.max(0, matchedPredicates.length - LIMIT),
		/** 命中的既有事实(可复用的「已知」)。 */
		facts: matchedFacts.slice(0, LIMIT).map((fact) => ({ id: fact.id, text: fact.text, level: fact.level ?? null, scope: fact.scope ?? null, hypothesis: fact.hypothesis ?? null, review: fact.review?.decision ?? null })),
		factsTruncated: Math.max(0, matchedFacts.length - LIMIT),
		/** 冲突:有就带上(它们约束「哪些结论还不能随便写)。 */
		conflicts: conflicts.map((conflict) => ({ predicate: conflict.predicate, subject: conflict.subject })),
		/** 缺口读数(与卡里同一份:`deriveKnowledge` 的 gaps)。 */
		gaps: knowledge.gaps,
	}
}

// ── 知识 Inspector:一个选择 → 它的定义 / 关系 / 断言 / 证据链 / 历史 ──────────

/**
 * **图上的一个选择(节点或边),它的全部知识读数。**
 *
 * 为什么要有它:图能画出来不等于图是知识入口。点击一个节点却只得到「按此过滤」,
 * 读的人仍然不知道这个词是什么意思、凭什么信、谁改过它。这一份投影把那条链补齐:
 *
 * ```text
 * 概念   → 定义 / 父概念 / 子概念 / 用它的谓词 / 相关实例 / 相关事实 / 历史
 * 谓词   → 主词域 / 值域 / 单值性 / 用它的事实 / 由它产生的冲突 / 历史
 * 实例   → 类型 / 入边 / 出边 / 每条断言的完整链 / 冲突
 * 字面值 → 值形态 / 取值 / 产生它的事实 / 出处
 * 断言边 → 事实 → 命题 → 证据 → 出处 → 产生步骤 → 复核态
 * ```
 *
 * 三条纪律与其余读面同一套:
 *   · **只读**:纯函数,不产生变更、不新增状态;判据只有这一处(客户端不许自己拼链);
 *   · **有界**:每一类列表都有上限,超出如实报 truncated;
 *   · **不编**:关联不到就如实给空,不猜「大概相关」——旧账本没有 `hypothesis` 关联时
 *     给 `null`,不拿文本相等去冒充身份(那条退路只属于折法,不属于读面)。
 *
 * 选择可以是 `{ kind, id }`,也可以直接给图上的 id 串(前缀即类型,见 `normalizeSelection`)。
 */
export function inspectGraphSelection(state, selection, derived) {
	const picked = normalizeSelection(selection)
	if (picked === null) return null
	const rows = derived ?? derive(state)
	const context = inspectorContext(state, rows)
	switch (picked.kind) {
		case 'concept':
			return inspectConcept(context, picked.id)
		case 'value_type':
			return inspectValueType(context, picked.id)
		case 'predicate':
			return inspectPredicate(context, picked.id)
		case 'instance':
			return inspectInstance(context, picked.id)
		case 'literal':
			return inspectLiteral(context, picked.id)
		case 'edge':
			return inspectEdge(context, picked.id)
		default:
			return null
	}
}

/** 列表上限:读面有界,超出如实报 truncated(与知识预检同一套纪律)。 */
const INSPECT_LIMIT = 30
const cut = (list, limit = INSPECT_LIMIT) => ({ rows: list.slice(0, limit), truncated: Math.max(0, list.length - limit) })

/**
 * 把选择归一到 `{ kind, id }`。
 *
 * 图上的 id 串自带类型前缀(`graphProjection` 定的形状),所以两种调用方式都认:
 * 客户端手上有节点对象时给 `{ kind, id }` 最稳;只拿到 id 串时按前缀解析。
 * 解析不出来**返回 null**,不猜一个类型——猜错会让 Inspector 端出一份别的东西的定义。
 */
function normalizeSelection(selection) {
	const raw = typeof selection === 'string' ? { id: selection } : selection
	if (raw === null || typeof raw !== 'object') return null
	const id = String(raw.id ?? '')
	if (id === '') return null
	/** 调用方声明的类型优先认;声明了就必须对得上,不许「说 A 给 B」。 */
	const declared = typeof raw.kind === 'string' ? raw.kind : ''
	const ok = (kind) => declared === '' || declared === kind
	if (id.startsWith('term:')) return ok('concept') ? { kind: 'concept', id: id.slice('term:'.length) } : null
	if (id.startsWith('is_a:')) return ok('concept') ? { kind: 'concept', id: id.slice('is_a:'.length) } : null
	if (id.startsWith('form:')) return ok('value_type') ? { kind: 'value_type', id: id.slice('form:'.length) } : null
	if (id.startsWith('predicate:')) return ok('predicate') ? { kind: 'predicate', id: id.slice('predicate:'.length) } : null
	if (id.startsWith('assertion:')) return ok('edge') ? { kind: 'edge', id } : null
	if (declared === 'concept' || declared === 'predicate' || declared === 'value_type' || declared === 'edge') return { kind: declared, id }
	/** 剩下的两种由图上的 id 形状定:实例是 `类型|名称`,字面值是 `谓词:值形态:取值`。 */
	if (id.includes('|')) return ok('instance') ? { kind: 'instance', id } : null
	if (id.includes(':')) return ok('literal') ? { kind: 'literal', id } : null
	return null
}

/**
 * Inspector 的**一次性的索引**:把状态里的几组东西按 id 归好,省得每个分支各建一遍。
 * 它不缓存、不外传——每次询问建一次,免得读面带上一份会过期的索引。
 */
function inspectorContext(state, derived) {
	const facts = Array.isArray(derived?.factRows) ? derived.factRows : Array.isArray(state?.facts) ? state.facts : []
	const lexicon = normalizeLexicon(state?.lexicon)
	const hypothesisById = new Map((state?.hypotheses ?? []).map((item) => [String(item.id ?? ''), item]))
	/**
	 * 命题**优先读派生的那一份**:`supportedLevel` / `refutations` / `inconclusive` 都是现算的,
	 * 只读原始状态的话,Inspector 会写「支持到 —」而卡片上明明有等级——同一件事两处说法不同。
	 */
	const derivedHypothesisById = new Map((Array.isArray(derived?.hypotheses) ? derived.hypotheses : []).map((item) => [String(item.id ?? ''), item]))
	const evidenceById = new Map((state?.evidence ?? []).map((item) => [String(item.id ?? ''), item]))
	const materialById = new Map((state?.materials ?? []).map((item) => [String(item.id ?? ''), item]))
	const stepOf = (planId, stepId) =>
		(state?.plans ?? []).find((plan) => plan.id === planId)?.steps.find((step) => step.id === stepId) ?? null
	return { state, derived, facts, lexicon, hypothesisById, derivedHypothesisById, evidenceById, materialById, stepOf, conflicts: Array.isArray(derived?.conflicts) ? derived.conflicts : [] }
}

/** 一条断言的一行人话(与货架 / 卡片同源:`domain-language` 的 `formatAssertion`)。 */
const say = (lexicon, assertion) => formatAssertion(lexicon, assertion)

/**
 * **一条事实的完整链**:事实 → 命题 → 证据 → 出处 → 产生步骤 → 复核态。
 *
 * 这是阶段 5 的核心:图上一条边背后到底站着什么。每一段都来自账本已有的东西,
 * 没有一段是这里推断出来的。
 */
function factChain(context, fact) {
	const { lexicon, hypothesisById, derivedHypothesisById, evidenceById, stepOf, conflicts } = context
	const evidenceIds = Array.isArray(fact?.evidence) ? fact.evidence : []
	const evidence = evidenceIds
		.map((id) => evidenceById.get(String(id)))
		.filter((item) => item !== undefined)
		.map((item) => {
			const step = stepOf(item.plan, item.step) ?? null
			return {
				id: item.id,
				verdict: item.verdict,
				level: item.level,
				evaluator: item.evaluator,
				basis: item.basis ?? null,
				anchor: item.anchor ?? null,
				at: item.at ?? null,
				/** 四类出处由账本记账时解析好,这里只搬运。 */
				origins: Array.isArray(item.origins) ? item.origins : [],
				refs: Array.isArray(item.refs) ? item.refs : [],
				/** 材料(id 或路径)也带上摘要,读的人不必再开一次文件。 */
				materials: (Array.isArray(item.refs) ? item.refs : [])
					.map((ref) => context.materialById.get(String(ref)))
					.filter((item2) => item2 !== undefined)
					.map((item2) => ({ id: item2.id, source: item2.source ?? null, path: item2.path ?? null, note: (item2.note ?? '').slice(0, 200) })),
				step: step === null ? null : { plan: item.plan, id: item.step, do: step.do ?? null, doneCriteria: step.done_criteria ?? null, status: step.status ?? null },
			}
		})
	const hypothesisId = typeof fact?.hypothesis === 'string' && fact.hypothesis !== '' ? fact.hypothesis : null
	const hypothesis = hypothesisId === null ? null : derivedHypothesisById.get(hypothesisId) ?? hypothesisById.get(hypothesisId) ?? null
	const assertions = Array.isArray(fact?.assertions) ? fact.assertions : []
	return {
		id: fact?.id ?? null,
		text: fact?.text ?? null,
		level: fact?.level ?? null,
		scope: fact?.scope ?? null,
		path: fact?.path ?? null,
		at: fact?.at ?? null,
		/** `live` / `refuted`(有推翻证据待人裁决)/ `retracted`(人已撤回)。 */
		status: fact?.review?.decision === 'retracted' ? 'retracted' : fact?.refuted === true ? 'refuted' : 'live',
		review: fact?.review === undefined || fact?.review === null ? null : { decision: fact.review.decision ?? null, reason: fact.review.reason ?? null, at: fact.review.at ?? null },
		assertions: assertions.map((assertion) => ({ ...assertion, chip: say(lexicon, assertion) })),
		hypothesis:
			hypothesis === null
				? null
				: { id: hypothesis.id, claim: hypothesis.claim ?? null, refuteWhen: hypothesis.refute_when ?? null, status: hypothesis.status ?? null, supportedLevel: hypothesis.supportedLevel ?? null, refutations: hypothesis.refutations ?? 0, inconclusive: hypothesis.inconclusive ?? 0 },
		evidence,
		/** 由这条事实参与构成的冲突(只暴露,不裁决——与投影同一句话)。 */
		conflicts: conflicts
			.filter((conflict) => (Array.isArray(conflict.sides) ? conflict.sides : []).some((side) => side.fact === fact?.id))
			.map((conflict) => ({ predicate: conflict.predicate, subject: conflict.subject, sides: conflict.sides.map((side) => ({ fact: side.fact ?? null, value: side.value ?? null })) })),
		history: factHistory(fact, evidence),
	}
}

/**
 * 事实的**留痕**:升格 / 评审决定 / 每条证据什么时候到的。
 * 它是「状态里真的留着的那几条记录」,不是完整事件流——完整事件流在会话日志里,
 * 读面不假装自己有它(见 known-gaps)。
 */
function factHistory(fact, evidence) {
	const events = []
	if (fact?.at !== undefined && fact?.at !== null) events.push({ kind: 'fact/promoted', at: fact.at, summary: `升格为事实(支持到 ${fact.level ?? '—'})` })
	if (fact?.review !== undefined && fact?.review !== null) {
		events.push({
			kind: 'fact/reviewed',
			at: fact.review.at ?? null,
			summary: fact.review.decision === 'retracted' ? '人审查后**撤回**(记录保留)' : '人审查后**维持**(判证据不可靠)',
			reason: fact.review.reason ?? null,
		})
	}
	for (const item of evidence) events.push({ kind: 'evidence/recorded', at: item.at ?? null, summary: `${item.verdict}(${item.evaluator} · ${item.level})`, reason: item.basis ?? null })
	return events.filter((event) => event.at !== null).sort((left, right) => left.at - right.at)
}

/** 词汇条目的留痕:登记 / 历次修订 / 废止。登记与修订本来就存在词条里(折法保留的)。 */
function entryHistory(entry, label) {
	const events = []
	if (entry?.at !== undefined && entry?.at !== null) events.push({ kind: `${label}_added`, at: entry.at, summary: `登记(依据:${entry.basis ?? '—'})`, by: entry.by ?? null })
	for (const revision of Array.isArray(entry?.revisions) ? entry.revisions : []) {
		events.push({ kind: `${label}_revised`, at: revision.at ?? null, summary: `修订到 v${revision.version ?? '?'}`, reason: revision.reason ?? null, by: revision.by ?? null })
	}
	if (entry?.deprecated !== undefined && entry?.deprecated !== null) {
		events.push({ kind: `${label}_deprecated`, at: entry.deprecated.at ?? null, summary: '废止(黏性终态,没有复活)', reason: entry.deprecated.reason ?? null, by: entry.deprecated.by ?? null })
	}
	return events.filter((event) => event.at !== null || event.kind.endsWith('_deprecated')).sort((left, right) => (left.at ?? 0) - (right.at ?? 0))
}

/** 事实的断言是否碰到这个概念(主词类型 = 概念 id)。 */
const assertsOn = (fact, termId) => (Array.isArray(fact?.assertions) ? fact.assertions : []).some((assertion) => String(assertion?.subject?.type ?? '') === termId)
const usesPredicate = (fact, predicateId) => (Array.isArray(fact?.assertions) ? fact.assertions : []).some((assertion) => String(assertion?.predicate ?? '') === predicateId)

/** 概念节点:语言里这个词是什么、它连着谁、哪些事实在用它。 */
function inspectConcept(context, termId) {
	const { lexicon, facts, conflicts, state } = context
	const term = lexicon.terms.find((item) => item.id === termId)
	if (term === undefined) return null
	const children = lexicon.terms.filter((item) => String(item.parent ?? '') === termId)
	const predicates = lexicon.predicates.filter((item) => String(item.domain ?? '') === termId || String(item.range?.term ?? '') === termId)
	const relatedFacts = facts.filter((fact) => assertsOn(fact, termId))
	/** 实例:这一概念下主词出现过的具体对象(从断言投影,与实体图同一份判据)。 */
	const instances = new Map()
	for (const fact of relatedFacts) {
		for (const assertion of Array.isArray(fact.assertions) ? fact.assertions : []) {
			if (String(assertion?.subject?.type ?? '') !== termId) continue
			const key = String(assertion.subject.id ?? '')
			if (key === '') continue
			if (!instances.has(key)) instances.set(key, { id: `${termId}|${key}`, ref: key, label: key, facts: [] })
			instances.get(key).facts.push(fact.id ?? null)
		}
	}
	const chain = cut(relatedFacts)
	return {
		selection: { kind: 'concept', id: term.id, label: term.label ?? term.id },
		definition: {
			id: term.id,
			label: term.label ?? term.id,
			gloss: term.gloss ?? null,
			aliases: Array.isArray(term.aliases) ? term.aliases : [],
			parent: term.parent === null || term.parent === undefined ? null : String(term.parent),
			status: term.status ?? 'admitted',
			version: term.version ?? 1,
			basis: term.basis ?? null,
			by: term.by ?? null,
			at: term.at ?? null,
			uses: term.uses ?? 0,
		},
		relations: {
			parent: term.parent === null || term.parent === undefined ? null : { id: String(term.parent), label: lexicon.terms.find((item) => item.id === String(term.parent))?.label ?? String(term.parent) },
			children: children.map((item) => ({ id: item.id, label: item.label ?? item.id, status: item.status ?? 'admitted' })),
			predicates: predicates.map((item) => ({ id: item.id, label: item.label ?? item.id, domain: item.domain ?? null, range: item.range ?? null, functional: item.functional === true, status: item.status ?? 'admitted' })),
			instances: [...instances.values()].sort((left, right) => (left.id < right.id ? -1 : 1)).map((item) => ({ id: item.id, ref: item.ref, label: item.label, factCount: item.facts.length })),
		},
		facts: chain.rows.map((fact) => factChain(context, fact)),
		factsTruncated: chain.truncated,
		conflicts: conflicts
			.filter((conflict) => String(conflict.subject ?? '').startsWith(`${termId}|`) || predicates.some((predicate) => predicate.id === conflict.predicate))
			.map((conflict) => ({ predicate: conflict.predicate, subject: conflict.subject, sides: conflict.sides.map((side) => ({ fact: side.fact ?? null, value: side.value ?? null })) })),
		history: entryHistory(term, 'term'),
		actions: { canFilter: true, canExpand: true, canEdit: true },
		/** 词汇是**约定**,不需要证据等级——把它说清楚,免得读的人以为它「没验」。 */
		note: '概念是约定,不是主张:它不带证据等级。用这个词写下的句子才需要。',
	}
}

/** 值形态节点:系统固定的五种之一(不独立治理,所以它没有历史)。 */
function inspectValueType(context, form) {
	const { lexicon, facts } = context
	const known = lexicon.predicates.filter((item) => String(item.range?.form ?? '') === form)
	if (known.length === 0 && !VALUE_FORMS.includes(form)) return null
	const used = facts.filter((fact) => (Array.isArray(fact.assertions) ? fact.assertions : []).some((assertion) => String(assertion?.object?.kind ?? '') === form))
	const chain = cut(used)
	return {
		selection: { kind: 'value_type', id: form, label: form },
		definition: { id: form, label: form, kind: 'value_type', status: 'builtin', gloss: VALUE_FORM_GLOSS[form] ?? null },
		relations: { predicates: known.map((item) => ({ id: item.id, label: item.label ?? item.id, domain: item.domain ?? null, range: item.range ?? null })) },
		facts: chain.rows.map((fact) => factChain(context, fact)),
		factsTruncated: chain.truncated,
		conflicts: [],
		/** 值形态由系统固定,不进领域本体、也没有版本史——如实说空,不编一段。 */
		history: [],
		actions: { canFilter: true, canExpand: false, canEdit: false },
		note: '值形态由系统固定(statement / quantity / formula / code / reference),不独立治理,所以没有版本史。',
	}
}

/** 谓词节点:它允许什么关系、谁在用、用出了哪些冲突。 */
function inspectPredicate(context, predicateId) {
	const { lexicon, facts, conflicts } = context
	const predicate = lexicon.predicates.find((item) => item.id === predicateId)
	if (predicate === undefined) return null
	const used = facts.filter((fact) => usesPredicate(fact, predicateId))
	const chain = cut(used)
	const range = predicate.range ?? null
	return {
		selection: { kind: 'predicate', id: predicate.id, label: predicate.label ?? predicate.id },
		definition: {
			id: predicate.id,
			label: predicate.label ?? predicate.id,
			gloss: predicate.gloss ?? null,
			domain: predicate.domain ?? null,
			/** 主词域的**名字**也带上:只给 id,读的人还要自己回词汇表里找。 */
			domainLabel: predicate.domain === null || predicate.domain === undefined ? null : lexicon.terms.find((item) => item.id === String(predicate.domain))?.label ?? String(predicate.domain),
			range,
			functional: predicate.functional === true,
			status: predicate.status ?? 'admitted',
			version: predicate.version ?? 1,
			basis: predicate.basis ?? null,
			by: predicate.by ?? null,
			at: predicate.at ?? null,
			uses: predicate.uses ?? 0,
		},
		relations: {
			valueForm: range?.form ?? null,
			rangeTerm: range?.term ?? null,
			/** 用这个谓词写下的**断言**(不是事实:一条事实可以带多条断言)。 */
			assertions: used.length,
			subjects: [...new Set(used.flatMap((fact) => (Array.isArray(fact.assertions) ? fact.assertions : []).filter((assertion) => String(assertion?.predicate ?? '') === predicateId).map((assertion) => `${String(assertion?.subject?.type ?? '')}|${String(assertion?.subject?.id ?? '')}`)))].map((key) => ({ key, ref: key.split('|')[1] ?? key, type: key.split('|')[0] ?? '' })),
		},
		facts: chain.rows.map((fact) => factChain(context, fact)),
		factsTruncated: chain.truncated,
		conflicts: conflicts
			.filter((conflict) => conflict.predicate === predicateId)
			.map((conflict) => ({ predicate: conflict.predicate, subject: conflict.subject, sides: conflict.sides.map((side) => ({ fact: side.fact ?? null, value: side.value ?? null })) })),
		history: entryHistory(predicate, 'predicate'),
		actions: { canFilter: true, canExpand: true, canEdit: true },
		note: predicate.functional === true ? '单值谓词:同一主词上两条未撤回的确认事实取值不同时,系统给出一对冲突读数(只暴露,不裁决)。' : null,
	}
}

/** 实例节点:某个具体对象身上挂着的全部断言与它们的链。 */
function inspectInstance(context, key) {
	const { lexicon, facts, conflicts } = context
	const separator = key.indexOf('|')
	if (separator < 0) return null
	const type = key.slice(0, separator)
	const ref = key.slice(separator + 1)
	if (ref === '') return null
	const outgoing = []
	const incoming = []
	for (const fact of facts) {
		for (const assertion of Array.isArray(fact.assertions) ? fact.assertions : []) {
			const subjectMatches = String(assertion?.subject?.type ?? '') === type && String(assertion?.subject?.id ?? '') === ref
			const objectMatches = String(assertion?.object?.kind ?? '') === 'instance' && String(assertion?.object?.value ?? '') === ref && (String(assertion?.object?.type ?? '') === type || String(assertion?.object?.type ?? '') === '')
			if (subjectMatches) outgoing.push({ fact, assertion, direction: 'out' })
			if (objectMatches) incoming.push({ fact, assertion, direction: 'in' })
		}
	}
	if (outgoing.length === 0 && incoming.length === 0 && !lexicon.terms.some((item) => item.id === type)) return null
	const touchedFacts = [...new Set([...outgoing, ...incoming].map((item) => item.fact))]
	const chain = cut(touchedFacts)
	const edges = [...outgoing, ...incoming].map((item) => ({
		direction: item.direction,
		predicate: String(item.assertion?.predicate ?? ''),
		predicateLabel: lexicon.predicates.find((entry) => entry.id === String(item.assertion?.predicate ?? ''))?.label ?? null,
		chip: say(lexicon, item.assertion),
		fact: item.fact.id ?? null,
		level: item.fact.level ?? null,
		status: item.fact.review?.decision === 'retracted' ? 'retracted' : item.fact.refuted === true ? 'refuted' : 'live',
	}))
	return {
		selection: { kind: 'instance', id: key, label: ref },
		definition: {
			id: key,
			ref,
			type: type === '' ? null : type,
			typeLabel: type === '' ? null : lexicon.terms.find((item) => item.id === type)?.label ?? type,
			/** 实例**不注册**(从断言投影出来),所以它没有独立生命周期与版本史。 */
			status: 'projected',
		},
		relations: { edges, out: outgoing.length, in: incoming.length },
		facts: chain.rows.map((fact) => factChain(context, fact)),
		factsTruncated: chain.truncated,
		conflicts: conflicts
			.filter((conflict) => String(conflict.subject ?? '') === key)
			.map((conflict) => ({ predicate: conflict.predicate, subject: conflict.subject, sides: conflict.sides.map((side) => ({ fact: side.fact ?? null, value: side.value ?? null })) })),
		history: [],
		actions: { canFilter: true, canExpand: true, canEdit: false },
		note: '实例由断言投影出来,不单独注册、也不做实体消解(同名即同节点);它没有自己的版本史。',
	}
}

/** 字面值节点:一个取值,以及是谁写下它的。 */
function inspectLiteral(context, key) {
	const { lexicon, facts } = context
	const separator = key.indexOf(':')
	if (separator < 0) return null
	const predicateId = key.slice(0, separator)
	const objectPart = key.slice(separator + 1)
	const holders = []
	for (const fact of facts) {
		for (const assertion of Array.isArray(fact.assertions) ? fact.assertions : []) {
			if (String(assertion?.predicate ?? '') !== predicateId) continue
			if (objectKey(assertion.object) !== objectPart) continue
			holders.push({ fact, assertion })
		}
	}
	if (holders.length === 0) return null
	const predicate = lexicon.predicates.find((item) => item.id === predicateId) ?? null
	const touchedFacts = [...new Set(holders.map((item) => item.fact))]
	const chain = cut(touchedFacts)
	return {
		selection: { kind: 'literal', id: key, label: say(lexicon, holders[0].assertion) },
		definition: {
			id: key,
			predicate: predicateId,
			predicateLabel: predicate?.label ?? predicateId,
			form: holders[0].assertion?.object?.kind ?? null,
			value: holders[0].assertion?.object?.value ?? null,
			unit: holders[0].assertion?.object?.unit ?? null,
			/** 值形态决定「这个取值是什么东西」:数值 / 公式 / 代码路径 / 引用。 */
			status: 'projected',
		},
		relations: { holders: holders.length, predicateRange: predicate?.range ?? null },
		facts: chain.rows.map((fact) => factChain(context, fact)),
		factsTruncated: chain.truncated,
		conflicts: [],
		history: [],
		actions: { canFilter: true, canExpand: true, canEdit: false },
		note: '字面值是断言里的客体,由事实投影出来;它没有独立生命周期。',
	}
}

/** 断言边:一条事实边的完整链(图上点击一条边时看的就是它)。 */
function inspectEdge(context, edgeId) {
	const { lexicon, facts, conflicts } = context
	const parts = edgeId.split(':')
	if (parts[0] !== 'assertion' || parts.length < 4) return null
	const factId = parts[1]
	const predicateId = parts[2]
	/** 主语键里有 `|`,而它自己可能带 `:`——所以从第 4 段起重新拼回去(不按段数硬切)。 */
	const subjectKey = parts.slice(3).join(':')
	const fact = facts.find((item) => String(item.id ?? '') === factId)
	if (fact === undefined) return null
	const predicate = lexicon.predicates.find((item) => item.id === predicateId) ?? null
	const chain = factChain(context, fact)
	const separator = subjectKey.indexOf('|')
	return {
		selection: { kind: 'edge', id: edgeId, label: `${predicate?.label ?? predicateId} · ${fact.text ?? ''}`.slice(0, 120) },
		definition: {
			kind: 'assertion',
			predicate: predicateId,
			predicateLabel: predicate?.label ?? predicateId,
			predicateGloss: predicate?.gloss ?? null,
			domain: predicate?.domain ?? null,
			range: predicate?.range ?? null,
			functional: predicate?.functional === true,
			subject: separator < 0 ? { type: null, id: subjectKey } : { type: subjectKey.slice(0, separator), id: subjectKey.slice(separator + 1) },
		},
		/** 一条边就是一条事实:**链在 `facts[0]` 里**,读面不把它拆成两处说。 */
		facts: [chain],
		factsTruncated: 0,
		conflicts: chain.conflicts,
		history: chain.history,
		actions: { canFilter: true, canExpand: true, canEdit: false },
		note: predicate?.functional === true ? '这条边落在单值谓词上:同一主词出现第二个不同取值时会产生冲突(只暴露,不裁决)。' : null,
	}
}

/** 五种值形态的名字与一句话解释(名字取自 `domain-language` 的枚举,这里只加给人读的说明)。 */
const VALUE_FORM_GLOSS = {
	statement: '短陈述字符串',
	quantity: '数值 + 单位',
	formula: '公式源码(LaTeX;本版不做语义解析)',
	code: '指向工作区里真有的文件路径',
	reference: '外部引用(文献 / URL / 编号)',
}

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
		/**
		 * **写明理由的跳级不算「没走过」**:`level/skipped` 记的就是「这一级在本项目里
		 * 为什么不适用」。所以减掉它——于是 `levels_skipped` 缺口与卡上那一行读的都是
		 * 减完的结果:「写明理由」是那条缺口唯一的出口,而且它真的会让缺口消失。
		 */
		const skipCovered = new Set(
			(Array.isArray(hypothesis.skips) ? hypothesis.skips : [])
				.flatMap((skip) => (Array.isArray(skip?.levels) ? skip.levels : []))
				.map((level) => String(level).toUpperCase()),
		)
		const untouchedLevels = top <= 0 ? [] : LEVELS.slice(0, top).filter((level) => !used.has(level) && !skipCovered.has(level))
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
	 * 收件箱:每一道门都是**状态锚**(由派生事实算出,不依赖中断记录)——门一解决,条目自然消失,
	 * 不可能残留成僵尸。
	 * 条目只带**分诊信息**(标题/摘要/指向),不带全部正文:收件箱是分诊,不是问诊。
	 *
	 * 这里**只放真门**:不拍板就真的推不动的那种。计划确认不再是条目(它是记号,
	 * 不是闸门;见 HUMAN_GATE_ACTIONS 的收敛记录)——收件箱里的每一条都经得起「等人是必须的吗」。
	 */
	const inbox = []
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
		/** 知识模式(分诊)与缺口读数:结构判据,不猜词面(见 `deriveKnowledge`)。 */
		knowledge: deriveKnowledge(state, hypotheses, factRows, lexicon),
	}
}

/**
 * 人门动作的标记。
 *
 * 人在面板上按的每一个动作,都经宿主平面的路由变成**一条用户消息**进会话日志——
 * 内容是一行结构化标记,不是自然语言。为什么要这样:
 *   · **可审计**:谁在什么时候做了什么(撤回或维持哪条事实、改了哪个词条),
 *     就在日志里(`source.kind==='user'`);
 *   · **不做 NLU**:ClearAI 把确认短语白名单整体删掉了,理由是「语义判断只归模型,
 *     harness 只做顺序可判定的题」。标记进得来、自然语言进不来,是同一条纪律;
 *   · **agent 不可达**:这些动词**没有工具 schema**——模型能调的工具面里不存在它们,
 *     它只能看见「人做了什么」这条事实。
 *
 * 砍掉的动词(奥卡姆:都是**重复**,或者它服务的机制已经删除):
 *   · `confirm_plan` —— 原生 `dsh-plan-mode` 就是「用户复核的出口」;而我们自己的
 *     `planIsAuthorized` 本来就承认「交付第一步即授权」。计划确认从来不是闸门(它是记号),
 *     少一个假装成闸门的按钮,界面就不再暗示一条不存在的约束。需要人拍板时用原生
 *     `ask_user_question`(它同样把人的答复留在日志里,署名一样是人)。
 *   · `invoke_skill` —— 原生 `/` 技能触发器(`dsh-client-ui-skill` 注册 trigger `/`,
 *     `dsh-client-ui-input-trigger` 出候选菜单)做的正是同一件事,而且带候选菜单。
 *   · `adopt_branch` / `abandon_fork` / `confirm_provisional` —— 世界线已删除,并行探索交给原生子任务;
 *   · `promote_skill` —— 外脑已删除,技能走原生技能目录。
 * 旧日志里的这些动作不再折:`parseHumanGate` 按动词表拒收,原样跳过。
 *
 * 已摘除:`set_autonomy`。「在场与否」是**运行时状态**(有没有门开着、有没有裁决在飞),
 * 不是人在面板上按的一个开关;那个档位还顺手把「计划经人确认」变成系统自己签的。
 * 折法里仍留一条**只读**容忍分支(见 `applyEvent` 的注释):旧会话日志里可能有一条这样的记录,
 * 而历史必须继续读得通——但**当前没有任何写入者**,面板上也没有这个开关。
 */
export const HUMAN_GATE_MARK = '[clearai·人门]'
/** 面板上允许出现的动词。表外的动词一律拒(与贡献表同一套「表外的名字不许出现」)。 */
export const HUMAN_GATE_ACTIONS = [
	'retract_fact',
	'keep_fact',
	/**
	 * **本体四动词(人的通道)**:面板抽屉发的就是它们;模型有同名语义的工具
	 * (`RegisterTerm` 等),但这两个面落的是**同一套判据与同一本账**——判据在宿主半的
	 * `domain` 门里,词汇事件只有一种折法。这个数组在内核那一侧有一份**逐字镜像**
	 * (预设面不能 import 这一层),两边相等由 authority-boundary 套件钉死。
	 */
	'register_term',
	'register_predicate',
	'revise_term',
	'deprecate_entry',
]
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
		/**
		 * 被闸门裁断过几次(`block/counted`):世界树的**分段通道**画的就是它——
		 * 这一步磨了几轮、其中几次被驳回。事实在投影里,面板只负责画。
		 */
		blocks: state.blocks ?? {},
		/**
		 * **人放行**(`human/released`)的痕迹:每一条都带它绑在哪一步上
		 * 以及凭据(`via:'approval'`,原生审批栈的权威记录)。
		 * 面板与测试都读这里 —— 推断出来的放行不该有痕迹,所以这份读数本身就是判据。
		 */
		releases: (state.releases ?? []).map((item) => ({ step: item.step ?? null, plan: item.plan ?? null, via: item.via ?? null, call: item.call ?? null, at: item.at ?? null })),
		autonomy: {
			value: state.autonomy?.effective?.value ?? null,
			preset: state.autonomy?.effective?.preset ?? null,
			source: state.autonomy?.effective?.source ?? null,
			override: state.autonomy?.override ?? null,
		},
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
		 * **知识模式(分诊)**:面板据此把「这一格是知识主场还是普通进展」说清楚,
		 * 与卡片读的是同一份派生(判据只有一处:`deriveKnowledge`)。
		 */
		knowledge: derived.knowledge,
		/**
		 * **单一叙述源**(`knowledge-view.js` 的 `knowledgeView`)。
		 *
		 * 面板右栏「事实 / 命题」、卡、领域货架读的是**同一份**结构:三行速览、缺口(每条带
		 * 下一步)、命题读数、实体图、术语表。面板不再自己拼一句话来解释内部词——那正是
		 * 「同一件事两处说法不同」的来源。
		 *
		 * 这里不传时钟:投影是纯函数(同一份账本 ⇒ 同一串字节),需要时间的是卡,
		 * 由 `renderCard` 给。
		 */
		knowledgeView: knowledgeView(state, derived, { preflight: knowledgePreflight(state, derived) }),
		/**
		 * **知识预检**:进入知识模式那一刻的相关已知(词汇 / 事实 / 冲突,有界)。
		 * 面板可以画它,内核的 pre-step 把它送进卡——判据与缺口读数一样,只有这一处。
		 */
		preflight: knowledgePreflight(state, derived),
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
							/** 断言随假设走(未升格):面板同画芯片(chip 同样在投影侧算好),标注「未升格」。 */
							assertions: Array.isArray(hypothesis.assertions)
								? hypothesis.assertions.map((assertion) => ({ ...assertion, chip: formatAssertion(state.lexicon, assertion) }))
								: null,
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
			 * `anchor` **必须交出去**:面板要给每条证据指一个**出处**——
			 * 独立证据指评估卡(文件)、自判证据指它锚定的产物。
			 */
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
			/**
			 * **类型化断言**(可 null):事实的内容形态。面板用它画断言芯片——
			 * 点开就地展开词条卡,这是「事实 ↔ 本体」那座桥的界面侧。
			 */
			assertions: Array.isArray(item.assertions) ? item.assertions : null,
			/** 派生:收到过推翻证据(要复核)与人的审查决定(撤回 / 维持)。 */
			refuted: item.refuted === true,
			review: item.review ?? null,
		})),
	}
}

/**
 * 运行态卡:每回合由系统重算,注给模型的**事实**。
 *
 * 卡文本的唯一出处是 `knowledge-view.js` 的 `knowledgeView`(契约冻结第 7 条):
 * 「现在在解决什么 / 怎样算完成 / 做到哪了 / 还缺什么」这套叙述只有一份——卡、面板右栏、
 * 领域货架读的是同一份。四处各写一遍,漂了就要读的人自己去调和两份打架的读数。
 *
 * 时钟由这里给(读面不读时钟);知识预检在 `fold.js` 里算好传进去(它与缺口读数同源)。
 *
 * 卡上那几句「授权」的人话同样出自 `GLOSSARY`,原文是:
 * **授权:记号未落账**。未经人批准的计划**不会自动续跑**;显式推进时,第一次交付会**按事实补写归属**
 * (行为即授权);已经推进过的计划改说「授权已经发生,继续执行」。
 */
export function renderCard(state) {
	/**
	 * 卡只是 `knowledgeView` 的**正文形态**:叙述、缺口、下一步、边界都在那一份里。
	 * 知识预检在这里算好传进去(它与缺口读数同源)。
	 * 授权那几句人话也必须仍能从这张卡上读出来:授权:记号未落账 —— 不会自动续跑,
	 * 第一次交付会按事实补写归属;已经推进过的计划改说「授权已经发生,继续执行」。
	 *
	 * **刻意不传时钟**:卡里没有时刻,所以「同一个状态的卡」逐字相同,按内容去重的那条纪律
	 * 才真的成立(注入方因此只在状态变化时重发,而不是每分钟重发一次)。
	 */
	const derived = derive(state)
	return knowledgeView(state, derived, { preflight: knowledgePreflight(state, derived) }).card
}
