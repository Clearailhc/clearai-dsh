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
import { applyLexiconMutation, changedDefinitions, materializeOntology, classifyWorkspacePath, deriveConflicts, emptyLexicon, factFromFile, formatAssertion, lessonFromFile, negativeFromFile, graphProjection, lexiconHealth, normalizeLexicon, objectKey, termUsage, VALUE_FORMS } from './domain-language.js'
import { handleOf, knowledgeView, trustOf } from './knowledge-view.js'
import { bilingual, detectLanguage, messageText, tr, withLanguage } from './lang.js'
import { compareScope } from './scope.js'

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
 *           `hypotheses[].skips`(跳级理由,v14 删)与 `goal.criteriaHistory`(判据修订)。
 *           旧日志这三块都是空表:实体图仍只从 `facts[].assertions` 长出来,逐字节不变。
 *   v11 → v12:**宿主已有的交还宿主**:分叉 / 世界线(`forks`)、侦察(`scouts`)、外脑与技能目录
 *           (`brain`、`brainCandidates`、`skillPromotions`、`skillCatalog`、`skillUsage`)、章程读数
 *           (`constitution`)与写入计数(`writeCalls`)都从状态里删了。旧日志里的对应事件类型
 *           (`fork/*`、`worldline/*`、`scout/*`、`branch/*`、`git/*`、`clearai/brain` 段、相关人门动作)
 *           不认识就原样跳过,其余部分照常折出来。
 *   v12 → v13:**步骤完成与结果分开**:步骤的 `tests` 折成 `{hypotheses: id[], level}`(旧账的单条
 *           `hypothesis` 照旧读);证据带上它针对的判断(`hypothesis`);`step/advanced` 带上交付本身
 *           (`delivery`:谁判的、凭什么、出处),`step.evidence` 变成 id 数组;结算事实带上两项裁决
 *           (`holds` / `results`)。
 *   v13 → v14:**缺口与关口收窄**:跳级理由整套删除——假设上不再有 `skips`,派生里不再有
 *           `untouchedLevels`;旧日志里的 `level/skipped` 不认识就原样跳过。缺口只留三种
 *           (`untouched_claims`、`prose_only_claims`、`entities_unlanded`)。
 *   v14 → v15:**攒下来的东西住在文件里**:多了 `workspace.files`(工作区里事实文件与本体文件
 *           的内容快照,由 `workspace/synced` 折进来);事实带上 `definitions`(升格那一刻用到的
 *           词条含义指纹)。派生的事实行合并其它会话留下的事实(`foreign`),并给出
 *           `definitionsChanged`。本体(词汇、实体、实体关系)改为从本体文件折出来,跨文件问题记在
 *           `ontologyProblems`。旧日志里没有这些,折出来就是空的。
 *   v15 → v16:多了 `language`(人说话用的语言,从人的消息折出来):系统写给人的话、面板里的读数都跟着它。
 *   v16 → v17:**预期与未解释**:步骤带 `expect`(`step/expected` 也能补写);多了 `anomalies`(未解释项,
 *           `anomaly/opened` / `anomaly/resolved` 折进来,评估者报的随 `audit/settled` 一起来);目标带
 *           `irreversible`(不可逆动作的命令特征);放行带 `action`。对手判断(`rival` / `split_by`)删了,
 *           旧账里的这两格不再读。
 *   v17 → v18:多了 `lessons`(经验:结案时经独立评估核过的「下次要留意什么」,`lesson/recorded` 折进来;
 *           别的会话留下的从 `clear/knowledge/lessons/<id>.json` 经 `workspace/synced` 进来)。
 *   v18 → v19:**探索的结构**:目标带 `mode`(广度调研 / 定向求解)、`questions`(问题)、`areas`(调研板块)
 *           与结案时的 `answers`(按问题的结论四部分);判断带 `question`(属于哪个问题或板块)与 `from`
 *           (由本体里哪条关系提出);步骤带 `serves` 与按候选分别写的 `predictions`;未解释项带 `touches`
 *           (涉及的量、判断或事实)。全部可选:旧日志折出来就是整个目标一个问题。
 *   v19 → v20:**适用范围与推翻条件分开**:目标带 `conditions`(本次所处的条件);判断带 `scope`
 *           (`{conditions, ranges, note}`);事实带 `scope_spec`、`refute_when` 与 `boundaries`
 *           (`fact/bounded`:检验落在适用范围之外时记下的边界,事实保持成立)。旧账的 `scope` 写的是推翻条件。
 *           同一版里目标、判断与事实还带 `about`(涉及的实体或量),未解释项带 `defect`(解释为测量或方法缺陷);
 *           派生多一份 `negativeRows`(`clear/knowledge/negatives/` 的负向条目)。
 *   v20 → v21:持久核算复核、最终实际引用、幂等审计派发;旧日志原样重放。
 * 投影缓存按版本判定,所以旧缓存会被丢弃、从日志重折一遍。
 */
export const STATE_VERSION = 21

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
		 * **未解释项**(认识论里的「反常」):和预期或本体对不上的观测。只有三个去处:
		 * 被解释(`explained`)、写明理由排除(`ruled_out`)、交给人(`escalated`);没去处的就是开着(`open`)。
		 */
		anomalies: [],
		/** **经验**:本会话结案写下的(别的会话的在工作区文件里,派生时合进来)。 */
		lessons: [],
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
		 * **工作区文件快照**(`workspace/synced`):路径 → `{ digest, data }` 或 `{ digest, error }`。
		 *
		 * 攒下来的东西(事实、本体)住在项目文件里,跨会话活着;而投影只吃账本。内核每一拍把
		 * 这两处的**变化**折成一条变更,于是文件内容也是账本里一条可重放的事实——重放、分叉、
		 * 离线复判读到的都是那一刻的文件,而不是此刻盘上的。
		 */
		workspace: { files: {} },
		/**
		 * **本体文件的跨文件问题**(第二道校验,只提示):引用断了、类型对不上、单值关系两个取值……
		 * 有问题的节点或边不进图,问题列在这里,卡片与本体页都读它。
		 */
		ontologyProblems: [],
		/**
		 * **人说话用的语言**('zh' / 'en';还没听到人说话时为 null)。从人的消息里折出来:
		 * 工具结果、运行态卡、面板读数都跟着它(见 `lang.js`)。
		 */
		language: null,
		/** 正在飞的工具调用(来自 tool/call):让「评估者在裁决」成为一条可看见的事实 */
		inFlight: null,
		/** 本会话自己写过的路径(来自 tool/call 的 write/edit):L4 来源分离的判据 */
		written: [],
	}
}

/**
 * 等裁决的工具:它们的调用在飞时,派生阶段是 `auditing`。`CloseGoal` 是 `Conclude` 的旧名,留着让旧日志照样折。
 * 其余工具不等外部裁决,不该让面板在每次调用时跳一下。
 */
const VERDICT_WAITERS = new Set(['AdvancePlan', 'Conclude', 'CloseGoal'])

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

/**
 * 步骤检验的判断一律折成 `{hypotheses: id[], level}`:新账写 `hypotheses`(可多条),
 * 旧账只有单条 `hypothesis`。读面只认这一种形状。
 */
export function normalizeTests(tests) {
	if (tests === undefined || tests === null || typeof tests !== 'object') return null
	const hypotheses = Array.isArray(tests.hypotheses) ? tests.hypotheses.map(String) : typeof tests.hypothesis === 'string' && tests.hypothesis !== '' ? [tests.hypothesis] : []
	return { hypotheses, level: tests.level ?? null }
}

/** 预测清单的唯一形状:`[{hypothesis, expect}]`,空的去掉。 */
/** 适用范围的形状:`{conditions?, ranges?, note?}`(内核已规整过,这里只认形状)。 */
function isScope(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) && (typeof value.conditions === 'object' || typeof value.ranges === 'object' || typeof value.note === 'string')
}

/** 涉及的实体或量:字符串数组。 */
function isAbout(value) {
	return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** 归知识库管、不进本体的工作区文件种类:事实、经验、负向条目。 */
const KNOWLEDGE_FILE_KINDS = ['fact', 'lesson', 'negative']

/** 立题的条件:`{维度: 值}`。 */
function isConditions(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'string')
}

export function normalizePredictions(raw) {
	if (!Array.isArray(raw)) return []
	return raw
		.map((item) => ({ hypothesis: String(item?.hypothesis ?? '').trim(), expect: String(item?.expect ?? '').trim() }))
		.filter((item) => item.hypothesis !== '' && item.expect !== '')
}

/** 问题与板块的唯一形状(目标上的读面):id、一句话、状态、所属板块。 */
const QUESTION_STATUS = ['open', 'emergent', 'parked']
function normalizeQuestions(raw) {
	if (!Array.isArray(raw)) return null
	return raw
		.map((item) => ({
			id: String(item?.id ?? '').trim(),
			text: String(item?.text ?? '').trim(),
			status: QUESTION_STATUS.includes(item?.status) ? item.status : 'open',
			area: typeof item?.area === 'string' && item.area.trim() !== '' ? item.area.trim() : null,
		}))
		.filter((item) => item.id !== '' && item.text !== '')
}
function normalizeAreas(raw) {
	if (!Array.isArray(raw)) return null
	return raw.map((item) => ({ id: String(item?.id ?? '').trim(), name: String(item?.name ?? '').trim() })).filter((item) => item.id !== '' && item.name !== '')
}

function appendSteps(plan, rawSteps) {
	for (const raw of rawSteps) {
		plan.steps.push({
			id: raw.id,
			ordinal: plan.steps.length + 1,
			do: raw.do,
			artifacts: raw.artifacts ?? [],
			done_criteria: raw.done_criteria,
			tests: normalizeTests(raw.tests),
			/** 动手前写下的预期(可选);落空的地方记成未解释项。 */
			expect: typeof raw.expect === 'string' && raw.expect !== '' ? raw.expect : null,
			/** 这一步服务哪个问题或板块(可选;不写就挂在当前问题下)。 */
			serves: typeof raw.serves === 'string' && raw.serves !== '' ? raw.serves : null,
			/** 按候选分别写的预测:`{hypothesis, expect}`。各候选预测相同的一步区分不了它们。 */
			predictions: normalizePredictions(raw.predictions),
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
	if (!Array.isArray(next.anomalies)) next.anomalies = []
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
				if (Array.isArray(mutation.irreversible)) previous.irreversible = clone(mutation.irreversible)
				/** 修订可以带上新的速览与判据清单(没带就保持旧值——「不提供」不等于「清空」)。 */
				if (typeof mutation.headline === 'string' && mutation.headline !== '') previous.headline = mutation.headline
				if (Array.isArray(mutation.criteria)) previous.criteria = clone(mutation.criteria)
				if (typeof mutation.criteria_note === 'string') previous.criteria_note = mutation.criteria_note
				if (typeof mutation.mode === 'string' && mutation.mode !== '') previous.mode = mutation.mode
				const questions = normalizeQuestions(mutation.questions)
				if (questions !== null) previous.questions = questions
				const areas = normalizeAreas(mutation.areas)
				if (areas !== null) previous.areas = areas
				if (isConditions(mutation.conditions)) previous.conditions = clone(mutation.conditions)
				if (isAbout(mutation.about)) previous.about = mutation.about.map(String)
				previous.reasons.push(mutation.reason ?? null)
			} else {
				if (previous !== null && previous.status === 'open') previous.status = 'superseded'
				next.goal = {
					id: mutation.id,
					claim: mutation.claim,
					done_criteria: mutation.done_criteria,
					promote_at_level: mutation.promote_at_level,
					/** 不可逆动作:`{action, command}`,命令里出现 `command` 那段原文就要人放行。 */
					irreversible: Array.isArray(mutation.irreversible) ? clone(mutation.irreversible) : [],
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
					/** 工作方式:`survey`(广度调研)/ `solve`(定向求解)/ `survey_then_solve`;没写就是 null。 */
					mode: typeof mutation.mode === 'string' && mutation.mode !== '' ? mutation.mode : null,
					/** 问题与调研板块(可选)。没有问题时,整个目标就是唯一的问题。 */
					questions: normalizeQuestions(mutation.questions) ?? [],
					areas: normalizeAreas(mutation.areas) ?? [],
					/** 这次问题所处的条件(如产线、月份):判断没写适用范围时的默认,引用已有知识时据此判是否适用。 */
					conditions: isConditions(mutation.conditions) ? clone(mutation.conditions) : {},
					/** 这次问题涉及的实体或量(id):留下的知识条目挂在它们上面。 */
					about: isAbout(mutation.about) ? mutation.about.map(String) : [],
					/** 结案时按问题写的结论四部分(`Conclude.answers`)。 */
					answers: [],
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
					if (typeof hypothesis.name === 'string' && hypothesis.name !== '') known.name = hypothesis.name
					if (typeof hypothesis.retests === 'string' && hypothesis.retests !== '') known.retests = hypothesis.retests
					if (Array.isArray(hypothesis.assertions)) known.assertions = clone(hypothesis.assertions)
					if (typeof hypothesis.question === 'string' && hypothesis.question !== '') known.question = hypothesis.question
					if (typeof hypothesis.from === 'string' && hypothesis.from !== '') known.from = hypothesis.from
					if (isScope(hypothesis.scope)) known.scope = clone(hypothesis.scope)
					if (isAbout(hypothesis.about)) known.about = hypothesis.about.map(String)
					if (Array.isArray(hypothesis.uses)) known.uses = clone(hypothesis.uses)
					if (typeof hypothesis.use === 'string' && hypothesis.use !== '') known.use = hypothesis.use
					continue
				}
				next.hypotheses.push({
					id: hypothesis.id,
					goal: mutation.id,
					/** 短名(第六阶段起,模型自己起);旧日志没有它,读的一侧取主张开头。 */
					...(typeof hypothesis.name === 'string' && hypothesis.name !== '' ? { name: hypothesis.name } : {}),
					claim,
					refute_when: hypothesis.refute_when,
					/** 复检的是哪条已有事实(事实 id;可以是别的会话留下的)。 */
					...(typeof hypothesis.retests === 'string' && hypothesis.retests !== '' ? { retests: hypothesis.retests } : {}),
					status: 'proposed',
					version: hypothesis.version ?? 1,
					/**
					 * **类型化断言随假设走**:登记时校验、升格时定型。
					 * 不写断言照旧成立(宽松+校验);写了就是「这条主张用这门语言怎么说」。
					 */
					assertions: Array.isArray(hypothesis.assertions) ? clone(hypothesis.assertions) : null,
					/** 属于哪个问题或板块(id);没写就归当前目标的第一个问题。 */
					...(typeof hypothesis.question === 'string' && hypothesis.question !== '' ? { question: hypothesis.question } : {}),
					/** 由本体里哪条关系提出(关系 id);没写或写「直觉」都如实显示。 */
					...(typeof hypothesis.from === 'string' && hypothesis.from !== '' ? { from: hypothesis.from } : {}),
					/** 适用范围(在哪里成立),与推翻条件分开:`{conditions, ranges, note}`。 */
					...(isScope(hypothesis.scope) ? { scope: clone(hypothesis.scope) } : {}),
					/** 涉及的实体或量(id);没写就用立题的 about。 */
					...(isAbout(hypothesis.about) ? { about: hypothesis.about.map(String) } : {}),
					/** 用到的已有条目与立题那一刻的适用性判定:`[{id, kind, verdict}]`。 */
					...(Array.isArray(hypothesis.uses) ? { uses: clone(hypothesis.uses) } : {}),
					...(typeof hypothesis.use === 'string' && hypothesis.use !== '' ? { use: hypothesis.use } : {}),
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
				if (Array.isArray(mutation.answers)) next.goal.answers = clone(mutation.answers)
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
				steps: [],
			}
			next.plans.push(plan)
			appendSteps(plan, mutation.steps ?? [])
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
		case 'step/expected': {
			const step = stepOf(mutation.plan, mutation.step)
			if (step === undefined || step.status !== 'open') break
			if (mutation.expect !== undefined) step.expect = String(mutation.expect ?? '') || null
			if (Array.isArray(mutation.predictions)) step.predictions = normalizePredictions(mutation.predictions)
			break
		}
		case 'anomaly/opened': {
			if (next.anomalies.some((item) => item.id === mutation.id)) break
			next.anomalies.push({ id: mutation.id, what: String(mutation.what ?? ''), anchor: mutation.anchor ?? null, touches: Array.isArray(mutation.touches) ? mutation.touches.map(String) : [], step: mutation.step ?? null, by: mutation.by ?? 'model', status: 'open', reason: null, explainedBy: null, at, resolvedAt: null })
			break
		}
		case 'lesson/recorded': {
			if (!Array.isArray(next.lessons)) next.lessons = []
			if (next.lessons.some((item) => item.id === mutation.id)) break
			next.lessons.push({
				id: mutation.id,
				goal: mutation.goal ?? null,
				text: String(mutation.text ?? ''),
				kind: mutation.kind ?? 'trap',
				about: Array.isArray(mutation.about) ? mutation.about.map(String) : [],
				evidence: mutation.evidence ?? null,
				boundary: mutation.boundary ?? null,
				status: 'active',
				path: mutation.path ?? null,
				at,
			})
			break
		}
		case 'anomaly/resolved': {
			const item = next.anomalies.find((entry) => entry.id === mutation.id)
			if (item === undefined || item.status !== 'open') break
			if (!['explained', 'ruled_out', 'escalated'].includes(mutation.outcome)) break
			item.status = mutation.outcome
			item.reason = mutation.reason ?? null
			item.explainedBy = mutation.by ?? null
			/** 解释为测量或方法的缺陷:回灌成实体上的「缺陷」条目。 */
			if (mutation.outcome === 'explained' && mutation.defect === true) item.defect = true
			item.resolvedAt = at
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
			const previous = next.audits.find((item) => item.id === mutation.id)
			if (previous !== undefined) {
				if (mutation.evaluator_session) previous.child = mutation.evaluator_session
				if (mutation.capability) previous.capability = mutation.capability
				break
			}
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
				/** 两项裁决:交付成立吗 + 每条判断的结果。旧账没有这两格,`verdict` 那时说的就是交付成立吗。 */
				audit.holds = mutation.holds ?? null
				audit.reuse = Array.isArray(mutation.reuse) ? clone(mutation.reuse) : []
				audit.results = Array.isArray(mutation.results) ? mutation.results : []
				audit.shortfalls = mutation.shortfalls ?? []
				audit.basis = mutation.basis ?? null
				audit.card_path = mutation.card_path ?? null
				if (mutation.digest !== undefined) audit.digest = mutation.digest ?? null
			}
			/** 评估者报的、做的人没登记的异常:记成未解释项(id 由裁决 id 派生,重放幂等)。 */
			const found = Array.isArray(mutation.anomalies) ? mutation.anomalies : []
			for (const [index, item] of found.entries()) {
				const id = `${mutation.id}#u${index + 1}`
				if (next.anomalies.some((entry) => entry.id === id || (entry.by === 'evaluator' && entry.step === mutation.step && entry.what === String(item?.what ?? '')))) continue
				next.anomalies.push({ id, what: String(item?.what ?? ''), anchor: null, step: mutation.step ?? null, by: 'evaluator', matters: item?.matters ?? null, status: 'open', reason: null, explainedBy: null, at, resolvedAt: null })
			}
			break
		}
		case 'evidence/recorded': {
			next.evidence.push({
				id: mutation.id,
				step: mutation.step,
				plan: mutation.plan,
				/** 针对哪条判断;旧账没有这一格(`undefined`),按步骤检验的判断找回来。 */
				hypothesis: mutation.hypothesis,
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
				/** 新账是证据 id 的数组(每条判断一份,不检验判断就是空数组);旧账是单个 id。 */
				step.evidence = Array.isArray(mutation.evidence) ? mutation.evidence : mutation.evidence === undefined || mutation.evidence === null ? [] : [mutation.evidence]
				/** 交付本身:谁判的、凭什么、出处。旧账没有,读面退回到证据。 */
				step.delivery =
					mutation.evaluator === undefined
						? null
						: { evaluator: mutation.evaluator, basis: mutation.basis ?? null, refs: Array.isArray(mutation.refs) ? mutation.refs : [], origins: Array.isArray(mutation.origins) ? mutation.origins : [] }
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
				/** 放行的是哪件不可逆动作(拦在命令上的那道门);步级放行没有这一格。 */
				...(typeof mutation.action === 'string' && mutation.action !== '' ? { action: mutation.action } : {}),
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
				/** 涉及的实体或量(id):文件查找按它们取到这条事实。 */
				about: isAbout(mutation.about) ? mutation.about.map(String) : [],
				scope: mutation.scope_spec === undefined && mutation.refute_when === undefined ? null : mutation.scope ?? null,
				/** 可比较的适用范围(`{conditions, ranges, note}`);旧账没有这一格,那时 `scope` 写的是推翻条件。 */
				scope_spec: isScope(mutation.scope_spec) ? clone(mutation.scope_spec) : null,
				refute_when: typeof mutation.refute_when === 'string' ? mutation.refute_when : mutation.scope_spec === undefined && typeof mutation.scope === 'string' ? mutation.scope : null,
				/** 已知不适用之处:检验落在适用范围之外时记下的边界(`fact/bounded`),事实本身保持成立。 */
				boundaries: [],
				level: mutation.level ?? null,
				evidence: mutation.evidence ?? [],
				path: mutation.path ?? null,
				assertions: Array.isArray(mutation.assertions) ? clone(mutation.assertions) : null,
				/** 升格那一刻,断言用到的词条各自的含义指纹:之后定义改了,这条事实要复核。 */
				definitions: mutation.definitions !== null && typeof mutation.definitions === 'object' && !Array.isArray(mutation.definitions) ? clone(mutation.definitions) : null,
				/** 支撑它的可重跑核算(`clear/models/<id>.json`);没有就是 null。 */
				use: typeof mutation.use === 'string' && mutation.use !== '' ? mutation.use : null,
				at,
			})
			break
		}
		/**
		 * **工作区同步**(`workspace/synced`,内核发):事实文件与本体文件这一拍的变化。
		 * 每条 change 是一个文件的新样子(`data` 或读不成时的 `error`),或 `removed`。
		 * 按路径覆盖,所以同一批变化折两遍结果一样。
		 */
		case 'workspace/synced': {
			const files = next.workspace !== null && typeof next.workspace === 'object' && next.workspace.files !== null && typeof next.workspace.files === 'object' ? next.workspace.files : {}
			next.workspace = { ...(next.workspace ?? {}), files }
			for (const change of Array.isArray(mutation.changes) ? mutation.changes : []) {
				const path = typeof change?.path === 'string' ? change.path : ''
				if (path === '') continue
				if (change.removed === true) {
					delete files[path]
					continue
				}
				files[path] = change.error !== undefined && change.error !== null ? { digest: change.digest ?? null, error: String(change.error) } : { digest: change.digest ?? null, data: change.data ?? null }
			}
			/**
			 * **本体从文件折出来**:词汇、实体、实体断言整份按文件重算——文件就是权威,
			 * 账本里只记「那一刻文件是什么样」。旧会话里工具写下的本体事件仍折得出来,
			 * 但一旦这个会话同步过本体文件,就以文件为准(旧会话不迁移)。
			 */
			const touchedOntology = (mutation.changes ?? []).some((change) => {
				const kind = classifyWorkspacePath(change?.path)?.kind
				return kind !== undefined && !KNOWLEDGE_FILE_KINDS.includes(kind)
			})
			if (touchedOntology || Object.keys(files).some((path) => !KNOWLEDGE_FILE_KINDS.includes(classifyWorkspacePath(path)?.kind))) {
				const ontology = materializeOntology(files)
				next.lexicon = ontology.lexicon
				next.entities = ontology.entities
				next.entityAssertions = ontology.entityAssertions
				next.ontologyProblems = ontology.problems
			}
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
		case 'fact/bounded': {
			/**
			 * **检验落在事实的适用范围之外**:不是推翻,是记下一处边界(在哪里不成立)。
			 * 事实保持成立,不问人撤回;0.5.1 里九月数据撤回八月事实,就是把这两件事混成了一件。
			 */
			const fact = next.facts.find((item) => item.id === mutation.fact)
			if (fact === undefined) break
			if (!Array.isArray(fact.boundaries)) fact.boundaries = []
			fact.boundaries.push({ verdict: mutation.verdict ?? 'out_of_scope', reasons: Array.isArray(mutation.reasons) ? clone(mutation.reasons) : [], hypothesis: mutation.hypothesis ?? null, basis: mutation.basis ?? null, at })
			break
		}
		case 'fact/questioned': {
			/**
			 * **引用过它的判断被推翻**,而推翻落在它的适用范围之内(或范围说不清):事实回到「待核验」,
			 * 不撤回、不问人——判断被推翻不等于它引用的事实错了,但它不能再照旧当已知用。
			 * 人复核过(`fact/reviewed`)或别的会话的文件上记了复核,疑问就算处理了。
			 */
			const fact = next.facts.find((item) => item.id === mutation.fact)
			if (fact === undefined) break
			if (!Array.isArray(fact.challenges)) fact.challenges = []
			fact.challenges.push({ hypothesis: mutation.hypothesis ?? null, verdict: mutation.verdict ?? null, basis: mutation.basis ?? null, at })
			break
		}
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
/** 人写的一条消息是哪种语言(插件消息、续跑提示不算)。 */
function humanLanguage(message) {
	if (message === null || typeof message !== 'object' || message.role !== 'user') return null
	const kind = message.source?.kind
	if (kind !== undefined && kind !== 'user') return null
	const text = messageText(message)
	if (text.startsWith(HUMAN_GATE_MARK)) return null
	return detectLanguage(text)
}

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
	// 人说话用的语言:每一条人写的消息都可能改判(没有信号就不改)。这一拍折出来的文字(本体问题等)也用它。
	const spoken = event.type === 'user/message' ? humanLanguage(event.data) : null
	const base = spoken !== null && spoken !== state?.language ? { ...state, language: spoken } : state
	return withLanguage(base?.language, () => foldEvent(base, event))
}

function foldEvent(state, event) {
	if (event.type === 'hook/result' && event.data?.point === 'ClearAIFact' && event.data?.handlerId?.startsWith('clearai-fact-') && isClearaiSource(event.data?.notice?.source)) return foldEvent(state, { ...event, type: 'user/message', data: event.data.notice })
	if (event.type === 'clearai/facts') return foldEvent(state, { ...event, type: 'user/message' })
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
			if (facts !== undefined) {
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
				if (touched) return next
			}
		}
		// 旧日志里人在面板上按下的人门动作 → 照旧落成**事实**(面板已不再发)。
		const gate = parseHumanGate(event.data)
		if (gate === null) return state
		const at = typeof event.time === 'number' ? event.time : Date.now()
		const next = clone(state)
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
 * **断言主体落图了吗**:一条判断的断言里,主体还不是实体图节点的那些(去重)。
 *
 * 节点有几种来路,都带出处或独立裁决:实体文件(`clear/ontology/entities/`)里的实体与它们的关系、升格事实里的主体,
 * 以及它们以 instance 形态引出的宾语。`derive()` 把读数挂在每条判断上(`unlanded`),
 * 缺口 ③ 与 `Conclude` 的实体门读的都是它——「卡上说落了」与「门说没落」不会出现两种读数。
 */
function subjectsOffGraph(hypothesis, nodes) {
	const seen = new Map()
	for (const assertion of Array.isArray(hypothesis?.assertions) ? hypothesis.assertions : []) {
		const id = String(assertion?.subject?.id ?? '').trim()
		const type = String(assertion?.subject?.type ?? '').trim()
		if (id === '' || type === '') continue
		const key = `${type}|${id}`
		if (seen.has(key) || nodes.has(key)) continue
		seen.set(key, { id, type })
	}
	return [...seen.values()]
}

/**
 * **知识模式(分诊)与缺口读数。**
 *
 * 判据是**结构的,不是词法的**:这里不猜「这句话像不像研究任务」。立约(`Frame`)并用
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
		 * 缺口只留三种,都是「这一轮的结论还不能被复用」的直接读数,每种都指得到今天就能补的动作。
		 *
		 * ① **从没被证据碰过的判断**。只在这次会话已经真的跑出过证据之后才报——计划刚立、
		 *    一步都还没走时,所有判断都是「没碰过」,那是正常的起点而不是缺口。
		 *    不逼裁决,但不许把「没看过」写成「没问题」。
		 */
		if (Array.isArray(state?.evidence) && state.evidence.length > 0) {
			const untouched = registered.filter((item) => item.refutations + item.inconclusive === 0 && item.supportedLevel === null)
			if (untouched.length > 0) {
				gaps.push({
					code: 'untouched_claims',
					count: untouched.length,
					detail: tr(`${untouched.length} 条验证中的判断还没有任何证据碰过(支持 / 推翻 / 不确定都算碰过)`, `${untouched.length} judgments under test have not been touched by any evidence (support, refute and inconclusive all count)`),
					nextAction: tr('给它派一个带 tests 的步骤并交付:支持 / 推翻 / 无法判定都算碰过', 'Give it a step with tests and deliver it: support, refute and inconclusive all count'),
				})
			}
		}
		/**
		 * ② 只有散文主张的判断:断言是可选的,所以这里**不是违规**,也不拦结案,
		 *    而是「这条主张还不能被机器比对、下一轮也按概念取不到」。只算非终态的。
		 */
		const proseOnly = registered.filter((item) => !Array.isArray(item.assertions) || item.assertions.length === 0)
		if (proseOnly.length > 0) {
			gaps.push({
				code: 'prose_only_claims',
				count: proseOnly.length,
				detail: tr(`${proseOnly.length} 条验证中的判断只有散文主张:两条结论是不是在说同一件事,只能靠重读判断`, `${proseOnly.length} judgments under test are prose only: whether two conclusions say the same thing can only be judged by rereading them`),
				nextAction: tr('先在 clear/ontology/ 下写概念、关系与主体的实体文件,再用 Frame 修订把主张写成断言(主词–谓词–宾语)', 'First write concept, relation and subject entity files under clear/ontology/, then revise with Frame to turn the claim into assertions (subject–predicate–object)'),
			})
		}
		/**
		 * ③ **断言主体没落图**。判据与 `Conclude` 的实体门是同一条(每条判断上的 `unlanded`):
		 *    断言的主体是不是实体图上带出处的节点。逐个主体判,`count` 就是还没落地的个数——
		 *    随便登记一个无关节点不会让它消失。
		 *
		 *    为什么看节点、不看边:边由升格本身落下(事实带着它的断言进图),
		 *    要求在升格之前另在实体文件里把同一句话再写一遍,只是让模型重复劳动。
		 */
		const unlanded = [...new Map(registered.flatMap((item) => item.unlanded ?? []).map((item) => [`${item.type}|${item.id}`, item])).values()]
		if (unlanded.length > 0) {
			gaps.push({
				code: 'entities_unlanded',
				count: unlanded.length,
				detail: tr(
					`${unlanded.length} 个断言主体还没有落到实体图(${unlanded.map((item) => `${item.type}|${item.id}`).join('、')}):断言只挂在命题上,不构成「已知」`,
					`${unlanded.length} assertion subjects are not on the entity graph yet (${unlanded.map((item) => `${item.type}|${item.id}`).join(', ')}): the assertions hang on the proposition only and are not "known"`,
				),
				nextAction: tr(
					'给这些主体各写一个实体文件(clear/ontology/entities/<id>.json,带类型与出处);确实不值得留下形态就把断言从判断上拿掉(Frame 修订)',
					'Write an entity file for each subject (clear/ontology/entities/<id>.json, with type and source); if one is really not worth keeping, drop the assertion from the judgment (Frame revision)',
				),
			})
		}
	}
	return {
		mode,
		/** 一句人话:为什么进了这一档(或为什么没进)。它进卡,所以不许写成术语。 */
		why:
			mode === 'knowledge'
				? tr(`目标还开着,带着 ${registered.length} 条登记过的命题——这是跨轮、要依据、要可复核结论的活`, `The goal is open with ${registered.length} registered propositions: work across turns that needs evidence and checkable conclusions`)
				: open
					? tr('目标还开着,但没有登记命题:按普通任务推进', 'The goal is open but has no registered propositions: proceed as an ordinary task')
					: tr('没有开着的目标:按普通任务推进', 'No open goal: proceed as an ordinary task'),
		gaps,
	}
}

/**
 * **知识预检(preflight)**:进入知识模式那一刻,把「已知」主动送到模型面前。
 *
 * 解决的问题:真跑里模型不查就开工——不是因为没有查询的入口,
 * 而是因为**没人提醒它此刻该查**。提示词会被读成建议;卡里的读数不会。
 * 于是这里把相关性判断做成投影:从当前目标与命题的文本出发,圈出**有界**的一组
 * 已有词汇、事实与冲突,随运行态卡注入。模型只在这份摘要不够用时才需要去读全文。
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
	/** 加上下一步要做什么与它的预期:预期引用的关系也要递到眼前。 */
	const nextStep = (derived?.activePlan?.steps ?? []).find((step) => step?.status === 'open') ?? null
	const claimText = [state?.goal?.claim, ...hypotheses.map((item) => item.claim), nextStep?.do, nextStep?.expect].filter((text) => typeof text === 'string' && text !== '').map((text) => String(text).replace(/\s+/g, ''))
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
	/**
	 * 事实:断言引用了命中的谓词或概念;**或**升格时按词面挂上的定义里有命中的词(真跑里事实几乎都没有断言,
	 * 只认断言等于从不命中);**或**有判断用 `retests` 指着它。撤回的不给。
	 */
	const retested = new Set(hypotheses.map((item) => item.retests).filter((id) => typeof id === 'string'))
	const matchedFacts = factRows.filter(
		(fact) =>
			fact.review?.decision !== 'retracted' &&
			(retested.has(fact.id) ||
				Object.keys(fact.definitions ?? {}).some((id) => matchedTermIds.has(id) || matchedPredicateIds.has(id)) ||
				(Array.isArray(fact.assertions) ? fact.assertions : []).some((assertion) => matchedPredicateIds.has(String(assertion?.predicate ?? '')) || matchedTermIds.has(String(assertion?.subject?.type ?? '')))),
	)
	return {
		mode: 'knowledge',
		/** 词面命中的词汇:模型接下来要写的结论大概率会用到它们。 */
		terms: matchedTerms.slice(0, LIMIT).map((term) => ({ id: term.id, label: term.label, gloss: term.gloss, kind: term.kind ?? null, unit: term.unit ?? null, parent: term.parent ?? null, status: term.status, uses: term.uses ?? 0, basis: term.basis ?? null })),
		termsTruncated: Math.max(0, matchedTerms.length - LIMIT),
		predicates: matchedPredicates.slice(0, LIMIT).map((predicate) => ({ id: predicate.id, label: predicate.label, gloss: predicate.gloss ?? '', kind: predicate.kind ?? null, shape: predicate.shape ?? null, check: predicate.check ?? null, domain: predicate.domain, range: predicate.range, functional: predicate.functional === true, status: predicate.status, uses: predicate.uses ?? 0, basis: predicate.basis ?? null })),
		predicatesTruncated: Math.max(0, matchedPredicates.length - LIMIT),
		/** 命中的既有事实(可复用的「已知」)。 */
		facts: matchedFacts.slice(0, LIMIT).map((fact) => ({ id: fact.id, text: fact.text, level: fact.level ?? null, scope: fact.scope ?? null, hypothesis: fact.hypothesis ?? null, review: fact.review?.decision ?? null, foreign: fact.foreign === true })),
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
	if (fact?.at !== undefined && fact?.at !== null) events.push({ kind: 'fact/promoted', at: fact.at, summary: tr(`升格为事实(支持到 ${fact.level ?? '—'})`, `Promoted to fact (supported to ${fact.level ?? '—'})`) })
	if (fact?.review !== undefined && fact?.review !== null) {
		events.push({
			kind: 'fact/reviewed',
			at: fact.review.at ?? null,
			summary: fact.review.decision === 'retracted' ? tr('人审查后**撤回**(记录保留)', 'A person reviewed it and **retracted** it (the record is kept)') : tr('人审查后**维持**(判证据不可靠)', 'A person reviewed it and **kept** it (the evidence was judged unreliable)'),
			reason: fact.review.reason ?? null,
		})
	}
	for (const bound of Array.isArray(fact?.boundaries) ? fact.boundaries : []) {
		events.push({ kind: 'fact/bounded', at: bound.at ?? null, summary: tr('检验落在适用范围之外:记下边界,事实保持成立', 'A test fell outside its scope: the boundary is recorded and the fact stays'), reason: bound.basis ?? null })
	}
	for (const item of evidence) events.push({ kind: 'evidence/recorded', at: item.at ?? null, summary: `${item.verdict}(${item.evaluator} · ${item.level})`, reason: item.basis ?? null })
	return events.filter((event) => event.at !== null).sort((left, right) => left.at - right.at)
}

/** 词汇条目的留痕:登记 / 历次修订 / 废止。登记与修订本来就存在词条里(折法保留的)。 */
function entryHistory(entry, label) {
	const events = []
	if (entry?.at !== undefined && entry?.at !== null) events.push({ kind: `${label}_added`, at: entry.at, summary: tr(`登记(依据:${entry.basis ?? '—'})`, `Registered (basis: ${entry.basis ?? '—'})`), by: entry.by ?? null })
	for (const revision of Array.isArray(entry?.revisions) ? entry.revisions : []) {
		events.push({ kind: `${label}_revised`, at: revision.at ?? null, summary: tr(`修订到 v${revision.version ?? '?'}`, `Revised to v${revision.version ?? '?'}`), reason: revision.reason ?? null, by: revision.by ?? null })
	}
	if (entry?.deprecated !== undefined && entry?.deprecated !== null) {
		events.push({ kind: `${label}_deprecated`, at: entry.deprecated.at ?? null, summary: tr('废止(黏性终态,没有复活)', 'Deprecated (final; it does not come back)'), reason: entry.deprecated.reason ?? null, by: entry.deprecated.by ?? null })
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
		note: tr('概念是约定,不是主张:它不带证据等级。用这个词写下的句子才需要。', 'A concept is a convention, not a claim: it carries no evidence level. Only sentences written with it do.'),
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
		note: tr('值形态由系统固定(statement / quantity / formula / code / reference),不独立治理,所以没有版本史。', 'Value forms are fixed by the system (statement / quantity / formula / code / reference); they are not governed separately, so they have no version history.'),
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
		note: predicate.functional === true ? tr('单值谓词:同一主词上两条未撤回的确认事实取值不同时,系统给出一对冲突读数(只暴露,不裁决)。', 'Single-valued predicate: when two unretracted confirmed facts give different values for the same subject, the system reports a conflict pair (surfaced, not resolved).') : null,
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
		note: tr('实例由断言投影出来,不单独注册、也不做实体消解(同名即同节点);它没有自己的版本史。', 'Instances are projected from assertions; they are not registered separately and not resolved (same name means same node); they have no version history of their own.'),
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
		note: tr('字面值是断言里的客体,由事实投影出来;它没有独立生命周期。', 'A literal value is the object of an assertion, projected from facts; it has no lifecycle of its own.'),
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
		note: predicate?.functional === true ? tr('这条边落在单值谓词上:同一主词出现第二个不同取值时会产生冲突(只暴露,不裁决)。', 'This edge uses a single-valued predicate: a second, different value for the same subject produces a conflict (surfaced, not resolved).') : null,
	}
}


/**
 * **可信度怎么变的**:按证据落账的先后重放一遍,每一笔记下「之前 → 之后」。
 * 面板「点开一条」的第二段读的就是它;分组判据仍只有 `trustOf` 一处,这里只是逐笔调用。
 * 升格(写进长期知识)和撤回不在这里——它们由读的一侧接在末尾(见 `view`)。
 */
function trustHistory(hypothesis, rows) {
	const history = [{ kind: 'proposed', at: hypothesis.at ?? null, to: 'testing' }]
	let replay = { status: 'proposed', supportedLevel: null, refutations: 0, inconclusive: 0 }
	const ordered = rows
		.map((item, index) => ({ item, index }))
		.sort((left, right) => (left.item.at ?? 0) - (right.item.at ?? 0) || left.index - right.index)
		.map(({ item }) => item)
	for (const item of ordered) {
		const from = trustOf(replay)
		if (item.verdict === 'refute') replay = { ...replay, refutations: replay.refutations + 1 }
		else if (item.verdict === 'inconclusive') replay = { ...replay, inconclusive: replay.inconclusive + 1 }
		else if (item.verdict === 'support' && LEVELS.indexOf(String(item.level ?? '').toUpperCase()) > LEVELS.indexOf(String(replay.supportedLevel ?? '').toUpperCase())) replay = { ...replay, supportedLevel: item.level }
		history.push({ kind: 'evidence', id: item.id ?? null, at: item.at ?? null, plan: item.plan ?? null, step: item.step ?? null, verdict: item.verdict, level: item.level ?? null, evaluator: item.evaluator ?? null, basis: item.basis ?? null, from, to: trustOf(replay) })
	}
	return history
}

/** 五种值形态的名字与一句话解释(名字取自 `domain-language` 的枚举,这里只加给人读的说明)。 */
const VALUE_FORM_GLOSS_TEXT = {
	statement: ['短陈述字符串', 'A short statement string'],
	quantity: ['数值 + 单位', 'A number plus a unit'],
	formula: ['公式源码(LaTeX;本版不做语义解析)', 'Formula source (LaTeX; its meaning is not parsed)'],
	code: ['指向工作区里真有的文件路径', 'A path to a file that exists in the workspace'],
	reference: ['外部引用(文献 / URL / 编号)', 'An external reference (paper / URL / identifier)'],
}
const VALUE_FORM_GLOSS = bilingual(VALUE_FORM_GLOSS_TEXT)

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
	const instanceNodes = new Set(graphProjection(state).nodes.filter((node) => node.kind === 'instance').map((node) => String(node.id)))
	const hypotheses = state.hypotheses.map((hypothesis) => {
		const rows = []
		for (const item of state.evidence) {
			if (item.hypothesis !== undefined) {
				if (item.hypothesis === hypothesis.id) rows.push(item)
				continue
			}
			const step = stepOf(item.plan, item.step)
			if ((normalizeTests(step?.tests)?.hypotheses ?? []).includes(hypothesis.id)) rows.push(item)
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
		return { ...hypothesis, status, supportedLevel: supportedLevel < 0 ? null : `L${supportedLevel}`, refutations, inconclusive, unlanded: subjectsOffGraph(hypothesis, instanceNodes), history: trustHistory(hypothesis, rows) }
	})

	/**
	 * `plan_is_authorized`:有记号 **或** 已经真的推进过(行为即授权)。
	 * 第二个分支在 ClearAI 那边是给存量文档用的;这里同样留着——事实与意图冲突时以事实为准。
	 */
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
	 * 事实那一行的**两个读数**(都派生,不另存):
	 *   · `refuted`——它的假设收到过推翻证据 ⇒ 这条事实要复核;
	 *   · `review` ——人已经审查过(撤回 / 维持),决定连缘由一起留着。
	 */
	const lexicon = normalizeLexicon(state.lexicon)
	/** 声明了 `retests` 的判断被推翻 ⇒ 它复检的那条事实也算被推翻(跨会话只认事实 id)。 */
	const retestRefuted = new Set(hypotheses.filter((item) => typeof item.retests === 'string' && (item.refutations ?? 0) > 0).map((item) => item.retests))
	const ownFacts = (state.facts ?? []).map((fact) => {
		const linked = typeof fact.hypothesis === 'string' && fact.hypothesis !== ''
		const owner = hypotheses.find((item) => (linked ? item.id === fact.hypothesis : String(item.claim ?? '') === String(fact.text ?? '')))
		return { ...fact, refuted: (owner?.refutations ?? 0) > 0 || retestRefuted.has(fact.id), review: fact.review ?? null, foreign: false }
	})
	/**
	 * **别的会话留下的事实**(住在 `clear/knowledge/facts/<id>.json`,经 `workspace/synced` 进账)。
	 * 同一个 id 本会话账上也有就以账上那条为准(它带着推翻读数);文件上的复核结论照样认。
	 * 它们的假设不在本会话,所以推翻要在这里重新检验一次才算:本会话的判断用 `retests` 指向它,
	 * 那条判断被推翻,这条事实就标「被推翻」。
	 */
	const ownIds = new Set(ownFacts.map((fact) => fact.id))
	const foreignFacts = []
	for (const [path, file] of Object.entries(state.workspace?.files ?? {})) {
		if (classifyWorkspacePath(path)?.kind !== 'fact' || file?.data === undefined) continue
		const row = factFromFile(file.data, path)
		if (row === null) continue
		if (ownIds.has(row.id)) {
			const own = ownFacts.find((fact) => fact.id === row.id)
			if (own.review === null && row.review !== null) own.review = row.review
			own.calculation = row.calculation
			own.rechecks = row.rechecks
			own.evidence_records = row.evidence_records
			own.challenges = row.challenges
			continue
		}
		foreignFacts.push({ ...row, refuted: retestRefuted.has(row.id), foreign: true })
	}
	foreignFacts.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
	/**
	 * `definitionsChanged`:升格那一刻用到的词条,**含义**此后改过或已不在的那些 id。
	 * 只是读数,不撤回事实:改了定义的人知道为什么改,复核交给人与证据。
	 */
	/**
	 * `questioned`:还开着、且点名涉及这条事实的未解释项(`touches` 里写了事实 id)。
	 * 有它,这条事实就回到「待核验」:写进长期知识的东西遇到说不通的读数,不能照旧当已知用。
	 */
	const openAnomalies = (state.anomalies ?? []).filter((item) => item?.status === 'open')
	const durableAnomalies = Object.entries(state.workspace?.files ?? {}).filter(([path]) => classifyWorkspacePath(path)?.kind === 'negative').map(([path, file]) => negativeFromFile(file?.data, path)).filter((row) => row && row.review?.decision !== 'retracted' && ['unresolved', 'defect', 'escalated'].includes(row.status))
	const questionedBy = (fact) => [
		...openAnomalies.filter((item) => (item.touches ?? []).includes(fact.id)).map((item) => item.id),
		...durableAnomalies.filter((row) => {
			if (!(row.touches.length ? row.touches : row.source?.anomaly ? row.about : []).includes(fact.id)) return false
			if (['out_of_scope', 'out_of_range'].includes(compareScope(fact.scope_spec, row.scope_spec).verdict)) return false
			if (fact.review?.decision === 'kept' && (fact.review.at ?? 0) >= (row.at ?? 0)) return false
			if ((fact.rechecks ?? []).some((reason) => reason.source === row.id && reason.status === 'resolved')) return false
			return true
		}).map((row) => row.id),
	]
	/** 引用过它的判断被推翻留下的疑问(`fact/questioned` 或文件上的 `challenges`),人复核之后的不再算。 */
	const challengedBy = (fact) => (Array.isArray(fact.challenges) ? fact.challenges : []).filter((item) => fact.review === null || fact.review === undefined || (fact.review.at ?? 0) < (item.at ?? 0)).map((item) => `challenge:${item.hypothesis ?? '?'}`)
	const factRows = [...foreignFacts, ...ownFacts].map((fact) => ({ ...fact, definitionsChanged: changedDefinitions(lexicon, fact.definitions), questioned: [...questionedBy(fact), ...challengedBy(fact), ...(fact.rechecks ?? []).filter((reason) => reason.status === 'pending').map((reason) => `recheck:${reason.id}`)] }))

	/**
	 * **领域词汇的派生读数**(两条,都不新存东西):
	 *   · `conflicts`——同一个单值谓词、同一主体、两个不同客体的**成对**事实。它是读数,
	 *     不是裁决:这里不撤回任何一侧,也不判断哪条为真(那是证据与人的事)。
	 *   · `lexiconHealth`——悬空引用、父链成环、没人用的条目、被废止条目仍在使用。
	 *     全是提示,不拦任何操作。
	 * 两者都吃 `factRows` 而不是 `state.facts`:事实的复核态与推翻标记是派生的,
	 * 在这里重算一遍就等于第二份判据。
	 */
	/**
	 * **经验行**:本会话写下的,加上别的会话留在 `clear/knowledge/lessons/` 的。同 id 以文件为准
	 * (人可以在文件上标 `status: "retracted"` 撤回);撤回的不再推送。新的在前。
	 */
	const lessonById = new Map()
	for (const item of state.lessons ?? []) lessonById.set(item.id, { ...item })
	for (const [path, file] of Object.entries(state.workspace?.files ?? {})) {
		if (classifyWorkspacePath(path)?.kind !== 'lesson' || file?.data === undefined) continue
		const row = lessonFromFile(file.data, path)
		if (row !== null) lessonById.set(row.id, { ...lessonById.get(row.id), ...row, at: row.at ?? lessonById.get(row.id)?.at ?? null })
	}
	const lessonRows = [...lessonById.values()].filter((item) => item.status !== 'retracted').sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
	/**
	 * **负向条目行**(已排除、未解、缺陷):只从 `clear/knowledge/negatives/` 读——内核随发生随写,
	 * 本会话的条目同步进来以后与别的会话的同样读法。人在文件上写 `review.decision: "retracted"` 的不再列出。新的在前。
	 */
	const negativeRows = []
	for (const [path, file] of Object.entries(state.workspace?.files ?? {})) {
		if (classifyWorkspacePath(path)?.kind !== 'negative' || file?.data === undefined) continue
		const row = negativeFromFile(file.data, path)
		if (row !== null && row.review?.decision !== 'retracted') negativeRows.push(row)
	}
	negativeRows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
	const conflicts = deriveConflicts(factRows, lexicon)
	const lexiconIssues = lexiconHealth(lexicon, factRows)
	/**
	 * **待处理**(第六阶段,取代空了的收件箱):只陈述、不放按钮——决定在对话里说,
	 * 或由开门的那次调用用原生提问卡问。两类:计划连拦停下了;已写进长期知识的结论互相矛盾。
	 * 都是派生读数:计划一解封、矛盾一方被推翻,条目自然消失。
	 */
	const needYou = []
	if (activePlan !== null && activePlan.blocked !== undefined) needYou.push({ kind: 'plan_blocked', text: tr(`计划停下了:${String(activePlan.blocked.reason ?? '连续没过')},怎么改?`, `The plan stopped: ${String(activePlan.blocked.reason ?? 'it kept failing')}. How should it change?`) })
	for (const conflict of conflicts) {
		const values = (conflict.sides ?? []).map((side) => String(side.value ?? '?'))
		needYou.push({
			kind: 'conflict',
			text: tr(
				`${String(conflict.subject ?? '')}的${String(conflict.predicate ?? '')}:${values.map((value) => `「${value}」`).join('和')}矛盾,以哪个为准?`,
				`${String(conflict.predicate ?? '')} of ${String(conflict.subject ?? '')}: ${values.map((value) => `"${value}"`).join(' and ')} conflict. Which one holds?`,
			),
		})
	}
	for (const fact of factRows) {
		if (fact.definitionsChanged.length === 0 || fact.review?.decision === 'retracted') continue
		const head = String(fact.text ?? '').replace(/\s+/g, ' ').trim()
		needYou.push({ kind: 'definition_changed', fact: fact.id, text: tr(`「${head.length > 40 ? `${head.slice(0, 39)}…` : head}」用到的 ${fact.definitionsChanged.join('、')} 定义已变,这条结论还成立吗?`, `The definitions of ${fact.definitionsChanged.join(', ')} used by "${head.length > 40 ? `${head.slice(0, 39)}…` : head}" changed. Does this conclusion still hold?`) })
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
		lessonRows,
		negativeRows,
		settlement,
		stepOf,
		needYou,
		/** 领域词汇与它的两条派生读数(见上面那段:冲突与健康度都只是读数)。 */
		lexicon,
		conflicts,
		lexiconIssues,
		/** 知识模式(分诊)与缺口读数:结构判据,不猜词面(见 `deriveKnowledge`)。 */
		knowledge: deriveKnowledge(state, hypotheses, factRows, lexicon),
		/** 探索的结构:问题 → 候选假设(或板块 → 新发现的问题)、下一步各候选的预测(见 `deriveExploration`)。 */
		exploration: deriveExploration(state, hypotheses, lexicon, activePlan),
	}
}

/** 候选假设的四种状态(界面:考察中 / 已排除 / 已采纳 / 暂不考察),由可信度分组算出,不另存。 */
const CANDIDATE_STATE = { credible: 'adopted', refuted: 'excluded', replaced: 'set_aside', pending: 'examining', testing: 'examining', unclear: 'examining' }

/**
 * **探索的结构**(派生,不存):课题 → 问题 → 候选假设 → 步骤;广度调研时课题 → 调研板块 → 问题。
 *
 * 问题与板块由模型立题时写(`Frame.questions` / `areas`),判断用 `question` 指明属于哪个问题或板块。
 * 没写问题的目标就是一个问题(旧会话照样读得通);没指明归属的判断归第一个问题。
 * 候选的状态只从证据来(可信度分组的另一种读法),界面与卡读同一份。
 *
 * `next.indistinct`:下一步给每个候选都写了预测,但预测全一样:这一步区分不了它们。
 */
export function deriveExploration(state, hypotheses, lexicon, activePlan) {
	const goal = state?.goal ?? null
	if (goal === null) return null
	const promoted = new Set((state.facts ?? []).map((fact) => fact?.hypothesis).filter((id) => typeof id === 'string'))
	const mine = hypotheses.filter((item) => typeof item.goal !== 'string' || item.goal === goal.id)
	const declared = Array.isArray(goal.questions) ? goal.questions : []
	const areas = Array.isArray(goal.areas) ? goal.areas : []
	const areaIds = new Set(areas.map((area) => area.id))
	const answers = Array.isArray(goal.answers) ? goal.answers : []
	const questions =
		declared.length > 0
			? declared.map((item) => ({ ...item, implicit: false }))
			: areas.length > 0
				? []
				: [{ id: 'goal', text: String(goal.headline ?? goal.claim ?? ''), status: 'open', area: null, implicit: true }]
	const fallback = questions.find((item) => item.status === 'open')?.id ?? questions[0]?.id ?? null
	const homeOf = (hypothesis) => {
		const wanted = typeof hypothesis.question === 'string' ? hypothesis.question : ''
		if (questions.some((item) => item.id === wanted) || areaIds.has(wanted)) return wanted
		return fallback
	}
	const candidateOf = (hypothesis) => ({
		id: hypothesis.id,
		name: handleOf(hypothesis),
		claim: hypothesis.claim ?? '',
		refuteWhen: hypothesis.refute_when ?? '',
		from: typeof hypothesis.from === 'string' && hypothesis.from !== '' ? hypothesis.from : null,
		state: CANDIDATE_STATE[trustOf(hypothesis, promoted.has(hypothesis.id))] ?? 'examining',
		supportedLevel: hypothesis.supportedLevel ?? null,
		refutations: hypothesis.refutations ?? 0,
		inconclusive: hypothesis.inconclusive ?? 0,
	})
	const count = (rows) => ({ examining: rows.filter((row) => row.state === 'examining').length, excluded: rows.filter((row) => row.state === 'excluded').length, adopted: rows.filter((row) => row.state === 'adopted').length, setAside: rows.filter((row) => row.state === 'set_aside').length })
	const questionRows = questions.map((question) => {
		const candidates = mine.filter((hypothesis) => homeOf(hypothesis) === question.id).map(candidateOf)
		const answer = answers.find((item) => item?.question === question.id) ?? (question.implicit ? (answers[0] ?? null) : null)
		return { ...question, status: answer !== null && answer !== undefined ? 'answered' : question.status, candidates, counts: count(candidates) }
	})
	const openAnomalies = (state.anomalies ?? []).filter((item) => item?.status === 'open')
	const steps = activePlan?.steps ?? []
	const areaRows = areas.map((area) => {
		const linked = mine.filter((hypothesis) => homeOf(hypothesis) === area.id || questions.some((question) => question.area === area.id && homeOf(hypothesis) === question.id)).map(candidateOf)
		const served = steps.some((step) => step.serves === area.id)
		const touched = openAnomalies.filter((item) => (item.touches ?? []).includes(area.id) || (item.touches ?? []).includes(area.name)).length
		const settled = linked.length > 0 && linked.every((row) => row.state === 'adopted' || row.state === 'excluded' || row.state === 'set_aside')
		const state = linked.length === 0 && !served ? 'not_started' : settled && touched === 0 ? 'clear' : 'in_progress'
		return { id: area.id, name: area.name, state, judgments: linked.length, verified: linked.filter((row) => row.state === 'adopted').length, openAnomalies: touched, questions: questionRows.filter((question) => question.area === area.id).map((question) => question.id) }
	})
	const current = questionRows.find((question) => question.status === 'open' && question.counts.examining > 0) ?? questionRows.find((question) => question.status === 'open') ?? null
	const first = steps.find((step) => step.status === 'open') ?? null
	let next = null
	if (first !== null) {
		const named = new Map(mine.map((hypothesis) => [hypothesis.id, hypothesis]))
		const byName = (key) => mine.find((hypothesis) => hypothesis.id === key || hypothesis.name === key) ?? null
		const predictions = (first.predictions ?? []).map((item) => {
			const hypothesis = byName(item.hypothesis)
			return { hypothesis: hypothesis?.id ?? null, name: hypothesis === null ? item.hypothesis : handleOf(named.get(hypothesis.id)), expect: item.expect }
		})
		const distinct = new Set(predictions.map((item) => item.expect.replace(/\s+/g, '')))
		next = { step: first.id, ordinal: first.ordinal, do: first.do, serves: first.serves ?? null, expect: first.expect ?? null, predictions, indistinct: predictions.length >= 2 && distinct.size === 1 }
	}
	return { mode: goal.mode ?? null, questions: questionRows, areas: areaRows, current: current?.id ?? null, next, answers }
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
 * 已摘除:`set_autonomy`(运行档整个删了,旧日志里的这条记录原样跳过);
 * `retract_fact` / `keep_fact`(这道门改由内核当场问人,见下面的 `LEGACY_GATE_ACTIONS`)。
 */
export const HUMAN_GATE_MARK = '[clearai·人门]'
/**
 * **只在读旧日志时认**的动词。面板早已没有写入口(第六阶段把 `/api/clearai/gate` 整条拿掉):
 * 撤回 / 维持事实从第三阶段起由内核在那次交付里当场问人;本体四动词随编辑抽屉一起删,
 * 要改词汇就在对话里说,模型去改 `clear/ontology/` 下的文件。
 * 但旧会话里人按过的决定必须照旧折出来,否则重放时一条审过的事实会变回「待复核」、
 * 人登记的词会凭空消失。
 */
const LEGACY_GATE_ACTIONS = ['retract_fact', 'keep_fact', 'register_term', 'register_predicate', 'revise_term', 'deprecate_entry']

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
		if (!LEGACY_GATE_ACTIONS.includes(String(parsed.action))) return null
		return parsed
	} catch {
		return null
	}
}

/** 一条判断升格成的事实(按 id 关联;旧账本按文本找回)。 */
function factOf(state, hypothesis) {
	return (state.facts ?? []).find((item) => item.hypothesis === hypothesis.id) ?? (state.facts ?? []).find((item) => item.hypothesis === undefined && String(item.text ?? '') === String(hypothesis.claim ?? '')) ?? null
}

function factRow(state, hypothesis) {
	const fact = factOf(state, hypothesis)
	return fact === null ? null : { id: fact.id, text: fact.text ?? null, scope: fact.scope ?? null, level: fact.level ?? null, at: fact.at ?? null, retracted: fact.review?.decision === 'retracted' }
}

/** 面板读的历程:步骤换成「第几步」,末尾接上升格与撤回(它们不是证据,但同样改了可信度)。 */
function historyRows(state, hypothesis) {
	const ordinalOf = (planId, stepId) => {
		const plan = state.plans.find((item) => item.id === planId)
		return plan?.steps?.find((step) => step.id === stepId)?.ordinal ?? null
	}
	const rows = (hypothesis.history ?? []).map((row) => (row.kind === 'evidence' ? { ...row, ordinal: ordinalOf(row.plan, row.step) } : { ...row }))
	const fact = factOf(state, hypothesis)
	const last = () => rows[rows.length - 1]?.to ?? 'testing'
	if (fact !== null) rows.push({ kind: 'promoted', at: fact.at ?? null, level: fact.level ?? null, from: last(), to: 'credible' })
	if (fact?.review?.decision === 'retracted') rows.push({ kind: 'retracted', at: fact.review.at ?? null, reason: fact.review.reason ?? null, from: last(), to: 'replaced' })
	return rows
}

/** 面板契约。浏览器读的就是这个,一字不改。 */
/** 名称比对用的规整(与内核取用时同一条规则):去空白、短横、下划线,小写。 */
const nameKey = (raw) =>
	String(raw ?? '')
		.replace(/[\s_-]+/g, '')
		.toLowerCase()

/** 适用范围的一行读法:条件、取值范围、补充说明。 */
function scopeLine(spec) {
	if (!isPlainObject(spec)) return null
	const parts = []
	for (const [key, value] of Object.entries(isPlainObject(spec.conditions) ? spec.conditions : {})) parts.push(`${key}=${Array.isArray(value) ? value.join('/') : String(value)}`)
	for (const [key, range] of Object.entries(isPlainObject(spec.ranges) ? spec.ranges : {})) {
		if (Array.isArray(range)) { parts.push(`${key} ${range[0]}–${range[1]}${spec.units?.[key] ? ` ${spec.units[key]}` : ''}`); continue }
		if (!isPlainObject(range)) continue
		const low = range.min ?? range.low ?? null
		const high = range.max ?? range.high ?? null
		parts.push(`${key} ${low ?? '…'}–${high ?? '…'}${range.unit ? ` ${range.unit}` : ''}`)
	}
	if (typeof spec.note === 'string' && spec.note.trim() !== '') parts.push(spec.note.trim())
	return parts.length === 0 ? null : parts.join(';')
}

/**
 * **沉淀下来的知识,按条目列一份**(本体货架的实体卡、图上的计数、探索货架的两节与结论卡的摘要读它)。
 *
 * 事实:已撤回的不列;有推翻证据、开着的疑问或口径已变的是「待核验」,其余「已确立」;收窄过范围的带 `boundaries`。
 * 负向条目照文件上的状态;经验照种类。每条带 `about`,界面按实体的 id、名称与别名把条目挂到实体上。
 */
function knowledgeItems(state, derived) {
	const items = []
	const evidencePaths = (rows) => [...new Set(rows.flatMap((row) => typeof row === 'string' ? [] : [row.ref, ...(row.refs ?? []), ...(row.origins ?? []).map((origin) => origin.path)]).filter((path) => typeof path === 'string' && /[/.]/.test(path)))]
	for (const fact of derived.factRows ?? []) {
		if (fact?.review?.decision === 'retracted') continue
		const pending = (fact.refuted === true && (fact.review === null || fact.review === undefined)) || (fact.questioned ?? []).length > 0 || (fact.definitionsChanged ?? []).length > 0
		items.push({
			id: fact.id,
			kind: 'fact',
			status: pending ? 'pending' : 'established',
			text: fact.text ?? '',
			about: Array.isArray(fact.about) ? fact.about : [],
			scope: scopeLine(fact.scope_spec),
			rechecks: (fact.rechecks ?? []).filter((row) => row.status === 'pending'),
			evidence: fact.evidence ?? [],
			evidencePaths: evidencePaths(fact.evidence_records ?? []),
			definitionsChanged: fact.definitionsChanged ?? [],
			recovery: '匹配范围的独立复检(retests)或人工明确裁决;其他未解决原因继续保留',
			boundaries: (Array.isArray(fact.boundaries) ? fact.boundaries : []).map((bound) => ({ verdict: bound.verdict ?? null, basis: bound.basis ?? null })),
			challenged: (fact.questioned ?? []).some((id) => String(id).startsWith('challenge:')),
			level: fact.level ?? null,
			goal: fact.goal ?? null,
			path: fact.path ?? null,
		})
	}
	for (const row of derived.negativeRows ?? []) {
		items.push({
			id: row.id,
			kind: 'negative',
			status: row.status,
			text: row.statement,
			about: row.about ?? [],
			scope: scopeLine(row.scope_spec),
			strength: row.strength ?? null,
			basis: row.resolution?.reason ?? null,
			evidencePaths: evidencePaths(row.evidence ?? []),
			goal: row.source?.goal ?? null,
			path: row.path ?? null,
		})
	}
	for (const lesson of derived.lessonRows ?? []) {
		items.push({ id: lesson.id, kind: 'lesson', status: lesson.kind ?? 'trap', text: lesson.text ?? '', about: Array.isArray(lesson.about) ? lesson.about : [], scope: lesson.boundary ?? scopeLine(lesson.scope_spec), evidencePaths: typeof lesson.evidence === 'string' && /[/.]/.test(lesson.evidence) ? [lesson.evidence] : [], goal: lesson.goal ?? null, path: lesson.path ?? null })
	}
	return items
}

/** 一条条目在实体上算哪一格计数(图上的小数字与实体卡的栏目同一套)。 */
const COUNT_BUCKET = { established: 'established', pending: 'pending', excluded: 'excluded', preliminary_excluded: 'excluded', unresolved: 'unresolved', escalated: 'unresolved' }

/** 实体图节点 → 挂在它上面的条目(按 id、名称、别名对 `about`)与各格计数。 */
function entityKnowledge(state, graph, items) {
	const aliasesOf = new Map((Array.isArray(state.entities) ? state.entities : []).map((entity) => [String(entity?.id ?? ''), Array.isArray(entity?.aliases) ? entity.aliases : []]))
	const out = {}
	for (const node of graph.nodes) {
		if (node.layer !== 'entity' || node.kind !== 'instance') continue
		const keys = new Set([node.ref, node.label, ...(aliasesOf.get(String(node.ref ?? '')) ?? [])].map(nameKey).filter((key) => key.length >= 2))
		const ids = []
		const counts = { established: 0, excluded: 0, bounded: 0, pending: 0, unresolved: 0 }
		for (const item of items) {
			if (!item.about.some((name) => keys.has(nameKey(name)))) continue
			ids.push(`${item.kind}:${item.id}`)
			const bucket = item.kind === 'lesson' ? null : COUNT_BUCKET[item.status]
			if (bucket !== undefined && bucket !== null) counts[bucket] += 1
			if (item.kind === 'fact' && item.boundaries.length > 0) counts.bounded += 1
		}
		if (ids.length > 0) out[node.id] = { items: ids, counts }
	}
	return out
}

/**
 * 探索货架的两节与结论卡的摘要:
 *   · `cited`——本次判断通过 `uses` 引用的条目与系统判定(不是「适用」的排前面);
 *   · `settling`——本目标已写下的负向条目,加上结案时待独立核验的判断;
 *   · `settled`——本目标已沉淀的条数(已确立 / 已排除 / 未解释 / 测量或方法缺陷 / 经验)。
 */
function knowledgeFlow(state, derived, items, promotedIds) {
	const goalId = state.goal?.id ?? null
	const byKey = new Map(items.map((item) => [item.id, item]))
	const cited = new Map()
	for (const hypothesis of derived.hypotheses ?? []) {
		for (const use of Array.isArray(hypothesis.uses) ? hypothesis.uses : []) {
			const key = `${use.id}|${use.verdict}`
			if (!cited.has(key)) cited.set(key, { id: use.id, kind: use.kind ?? byKey.get(use.id)?.kind ?? null, verdict: use.verdict ?? 'unknown', text: byKey.get(use.id)?.text ?? null, path: byKey.get(use.id)?.path ?? null, by: [] })
			cited.get(key).by.push(handleOf(hypothesis))
		}
	}
	const citedRows = [...cited.values()].sort((left, right) => (left.verdict === 'applies' ? 1 : 0) - (right.verdict === 'applies' ? 1 : 0))
	const mine = goalId === null ? [] : items.filter((item) => item.goal === goalId)
	const awaiting = (derived.hypotheses ?? []).filter((hypothesis) => !promotedIds.has(hypothesis.id) && ['credible', 'pending'].includes(trustOf(hypothesis, false))).map((hypothesis) => ({ id: hypothesis.id, name: handleOf(hypothesis), claim: hypothesis.claim ?? '' }))
	const count = (predicate) => mine.filter(predicate).length
	return {
		cited: citedRows,
		settling: { negatives: mine.filter((item) => item.kind === 'negative'), awaiting },
		settled:
			goalId === null
				? null
				: {
						established: count((item) => item.kind === 'fact' && item.status === 'established'),
						excluded: count((item) => item.kind === 'negative' && (item.status === 'excluded' || item.status === 'preliminary_excluded')),
						unresolved: count((item) => item.kind === 'negative' && (item.status === 'unresolved' || item.status === 'escalated')),
						defects: count((item) => item.kind === 'negative' && item.status === 'defect'),
						lessons: count((item) => item.kind === 'lesson'),
					},
	}
}

export function view(state, sessionId) {
	const derived = derive(state)
	const promotedIds = new Set((state.facts ?? []).map((fact) => fact?.hypothesis).filter((id) => typeof id === 'string'))
	const items = knowledgeItems(state, derived)
	const graph = graphProjection(state)
	const plan = derived.activePlan ?? derived.closedPlans[derived.closedPlans.length - 1] ?? null
	const sid = sessionId === undefined || sessionId === null ? (state.sessionId ?? null) : String(sessionId)
	return {
		ok: true,
		mounted: true,
		sessionId: sid,
		/** 待处理:只陈述的几行(计划停下、结论矛盾);面板顶上与输入框旁读同一份。 */
		needYou: derived.needYou,
		/**
		 * 被闸门裁断过几次(`block/counted`):世界树的**分段通道**画的就是它——
		 * 这一步磨了几轮、其中几次被驳回。事实在投影里,面板只负责画。
		 */
		blocks: state.blocks ?? {},
		/**
		 * **人放行**(`human/released`)的痕迹:每一条都带它绑在哪一步上
		 * 以及凭据(`via:'ask'`:内核那次交付当场问出来的;旧账里是 `approval`)。
		 * 面板与测试都读这里 —— 推断出来的放行不该有痕迹,所以这份读数本身就是判据。
		 */
		releases: (state.releases ?? []).map((item) => ({ step: item.step ?? null, plan: item.plan ?? null, via: item.via ?? null, call: item.call ?? null, at: item.at ?? null })),
		/** 本体形状(面板页眉据此生成,不手抄)。 */
		ontology: state.ontology ?? null,
		/** 探索的结构(探索货架读它;与卡上「你在哪」同一份派生)。 */
		exploration: derived.exploration,
		/** 未解释项(探索货架「过程记录」与本体货架的复核标记读它)。 */
		anomalies: (state.anomalies ?? []).map((item) => ({ id: item.id, what: item.what, anchor: item.anchor ?? null, touches: item.touches ?? [], step: item.step ?? null, by: item.by ?? 'model', status: item.status, reason: item.reason ?? null, explainedBy: item.explainedBy ?? null, at: item.at ?? null })),
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
			graph,
			/** 本体文件里的实体(带所在目录的容器)与跨文件问题:本体页的问题列表读它。 */
			entities: Array.isArray(state.entities) ? state.entities : [],
			problems: Array.isArray(state.ontologyProblems) ? state.ontologyProblems : [],
		},
		/**
		 * **知识模式(分诊)**:面板据此把「这一格是知识主场还是普通进展」说清楚,
		 * 与卡片读的是同一份派生(判据只有一处:`deriveKnowledge`)。
		 */
		knowledge: derived.knowledge,
		/**
		 * **沉淀下来的知识**(事实、负向条目、经验,一条一行)与它们在实体上的挂法:
		 * 实体卡与图上的计数读 `entityKnowledge`,探索货架的「引用的已有知识」「将沉淀的内容」
		 * 与结论卡的「本次沉淀」读 `knowledgeFlow`。
		 */
		knowledgeItems: items,
		entityKnowledge: entityKnowledge(state, graph, items),
		knowledgeFlow: knowledgeFlow(state, derived, items, promotedIds),
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
						headline: state.goal.headline ?? null,
						mode: state.goal.mode ?? null,
						/** 结案时按问题写的结论四部分(本体货架的结论卡读它)。 */
						answers: Array.isArray(state.goal.answers) ? state.goal.answers : [],
						hypotheses: derived.hypotheses.map((hypothesis) => ({
							id: hypothesis.id,
							name: handleOf(hypothesis),
							/** 可信度分组(已验证 / 待核验 / 验证中 / 不确定 / 已推翻 / 已替换),面板与卡同一份。 */
							trust: trustOf(hypothesis, promotedIds.has(hypothesis.id)),
							claim: hypothesis.claim,
							refuteWhen: hypothesis.refute_when,
							question: hypothesis.question ?? null,
							from: hypothesis.from ?? null,
							/** 引用的已有条目与系统当场的判定(`[{id, kind, verdict}]`)。 */
							uses: Array.isArray(hypothesis.uses) ? hypothesis.uses : [],
							status: hypothesis.status,
							supportedLevel: hypothesis.supportedLevel,
							refutations: hypothesis.refutations,
							inconclusive: hypothesis.inconclusive,
							version: hypothesis.version,
							/** 「可信度怎么变的」:逐笔的之前 → 之后,末尾接上写进长期知识 / 被撤回。 */
							history: historyRows(state, hypothesis),
							/** 写进长期知识的那条(没升格就是 null):补充段的「范围」读它。 */
							fact: factRow(state, hypothesis),
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
				expect: step.expect ?? null,
				serves: step.serves ?? null,
				predictions: step.predictions ?? [],
				status: step.status,
				evidenceIds: step.evidence ?? [],
				/** 交付本身(谁判的、凭什么、出处);旧账为 null。 */
				delivery: step.delivery ?? null,
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
							expect: step.expect ?? null,
							serves: step.serves ?? null,
							predictions: step.predictions ?? [],
							status: step.status,
							evidenceIds: step.evidence ?? [],
							/** 交付本身(谁判的、凭什么、出处);旧账为 null。 */
							delivery: step.delivery ?? null,
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
			/** 针对哪条判断(旧账为 null:由步骤检验的判断找回来)。 */
			hypothesis: item.hypothesis ?? null,
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
			/** 产出它的那条判断(旧账本没有,面板把这种事实单独列成一行)。 */
			hypothesis: item.hypothesis ?? null,
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
			/** 还开着、点名涉及它的未解释项:有就回到「待核验」。 */
			questioned: item.questioned ?? [],
		})),
		/** 经验(本体货架列出;与卡上同一份,含别的会话留下的)。 */
		lessons: (derived.lessonRows ?? []).map((item) => ({ id: item.id, kind: item.kind ?? 'trap', text: item.text ?? '', boundary: item.boundary ?? null, about: item.about ?? [] })),
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
