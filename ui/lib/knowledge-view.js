/**
 * **可读性单一叙述源**(契约第 7 条)。
 *
 * 要解决的问题:同一件事——现在在解决什么、怎样算完成、做到哪了、还缺什么——从前在四处各写
 * 一遍(运行态卡、面板右栏、领域货架、提示词)。四处一旦漂,读的人就要自己调和两份打架的读数,
 * 而「调和」正是这套系统本该替模型省下来的那件事。
 *
 * 于是这里只留一份:**纯函数**,吃 `(state, derived)`,出来的是给人读的结构 + 一张卡的正文。
 *   · `fold.js:renderCard` 只经它生成卡文本(`return knowledgeView(...).card`);
 *   · 宿主 `view()` 把同一份交给面板;
 *   · 领域货架的「使用」一节读它(由宿主把这一份传进 `describeDomainShelf`)。
 *
 * 三条纪律与其余读面同一套:
 *   · **只读**:不落盘、不改状态、不产生变更;
 *   · **有界**:卡文本有**硬上限**(超了如实说省了多少行,不静默截断);
 *   · **不猜**:缺的字段给 null / 空数组,不编一个看起来合理的值。
 *
 * 面向人的新字符串一律先落在 `GLOSSARY`(内部词 → 一句 plain + 在哪看 + 下一步做什么);
 * `client.js` 的 `LOCALE_ZH/LOCALE_EN` 与它同源登记。
 */
import { graphProjection, ontologyOutline } from './domain-language.js'

/** 卡文本上限。模型每一步只读这一张卡,而卡是**每回合**重算的:它必须小到能进预算。 */
const CARD_LIMIT = 3000

/**
 * **判据逐条进卡的三个界**。判据是**多条**的(`Frame` 收 `criteria: string[]`,每条一句话),
 * 挤成一行会把「第 3 条没做到」抹平;而整段重发又会把卡撑爆、断前缀缓存。
 * 每个界都对得上一条纪律:每行有上限(一条千字判据不占满一行)、条数有上限(判据条数不能
 * 决定卡大小)、超出**如实说**(写清还有几条、全文在哪,不静默丢)。
 */
const CRITERIA_LINE_LIMIT = 80
const CRITERIA_ROWS_MAX = 6
/** 交给面板那一份每条的上限:面板能滚动,但不该被一条千字判据撑爆一行(全文在目标文档里)。 */
const CRITERIA_DISPLAY_LIMIT = 160

/** 终态的命题不再是「待办的活」——展示分组用它,与折法的终态同一组。 */
const TERMINAL_STATUS = new Set(['refuted', 'superseded', 'retracted'])

/**
 * **术语表:内部词 → 一句人话 / 在哪看 / 下一步做什么。**
 *
 * 为什么要三格:只说「未走过 L0」是术语;说了「L0 是什么、这次为什么没走、下一步走不走」
 * 才是一句据以行动的话。缺口 code、等级、实体来源、阶段名都在这里。
 */
export const GLOSSARY = {
	// ── 认识论等级(「这条结论多大程度只能靠信任做的人」) ──
	L0: { plain: '推理自检:结论只是自己推了一遍,没有引入任何外部输入', where: 'docs/verification-loop.md 的等级表', nextAction: '把这一级要检查的对象过一遍,或写明这一级在本项目里为什么不适用' },
	L1: { plain: '已有知识:引用自己或别人手上已有的材料', where: 'docs/verification-loop.md 的等级表', nextAction: '指出引用的具体材料;没有就升级到能验的等级' },
	L2: { plain: '可复算:照一份能重跑的步骤自己算一遍', where: 'docs/verification-loop.md 的等级表', nextAction: '把复算步骤与产物落成文件,让下一个人能重跑' },
	L3: { plain: '独立裁决:由另一个评估者读产物后给结论', where: 'docs/verification-loop.md 的等级表', nextAction: '派一次独立评估,把评估卡作为出处' },
	L4: { plain: '人放行:交付前有人看过并批准', where: 'docs/verification-loop.md 的等级表', nextAction: '等一次人的放行记录;没有人就不要声称到过这一级' },
	// ── 阶段(派生读数) ──
	planning: { plain: '还没建计划:先想清楚要怎么回答', where: '运行态卡 · 当前计划', nextAction: '用 CreatePlan 把回答拆成可交付的步骤' },
	executing: { plain: '执行中:有活动计划且还有未落定的步', where: '运行态卡 · 当前计划', nextAction: '推进第一个未落定步,交付落在它上面' },
	stage_boundary: { plain: '阶段边界:当前计划的步都落定了,该结案或起新计划', where: '运行态卡 · 当前计划', nextAction: '结案(Conclude)或起下一阶段计划' },
	auditing: { plain: '在等裁决:有交付/结案在飞,或上一次裁决还没回来', where: '运行态卡 · 阶段(派生)', nextAction: '等评估者回灌;不要重复派同一个裁决' },
	stalled: { plain: '卡住了:连续几次没通过观测准入,停下等人', where: '运行态卡 · 计划被拦', nextAction: '说一句怎么改(改计划或补判据)' },
	achieved: { plain: '目标已达成(终局)', where: '运行态卡 · 当前目标', nextAction: '没有待办:要做新事就立新目标' },
	abandoned: { plain: '目标已如实放弃(终局)', where: '运行态卡 · 当前目标', nextAction: '没有待办:放弃也是结论,记录保留' },
	// ── 实体图的三个来源 ──
	registered: { plain: '已登记:某实例在某出处下被登记下来(一等写入口)', where: '本体面板 · 实体图节点', nextAction: '在它的实体文件里写 relations(每条带出处),图才长出边' },
	promoted: { plain: '已升格:来自过了独立裁决的事实断言', where: '本体面板 · 实体图边', nextAction: '它已经带等级与边界;要改就去改那条事实' },
	asserted: { plain: '实体断言:登记那一刻就成立的边,有出处但未经独立裁决', where: '本体面板 · 实体图虚线边', nextAction: '要让它进「已知」就把它升格成事实(走独立裁决)' },
	// ── 派生读数 ──
	supportedLevel: { plain: '支持到哪一级:所有支持证据里最高的那一级', where: '运行态卡 · 假设状态', nextAction: '等级不够就补更硬的那一档证据' },
	refutations: { plain: '被推翻次数:收到过几条推翻证据', where: '运行态卡 · 假设状态', nextAction: '被推翻是终态:要么改主张换 id,要么如实放弃' },
	inconclusive: { plain: '无法判定次数:判过但判不出来', where: '运行态卡 · 假设状态', nextAction: '补判据或补产物,让下一次判得出结果' },
	// ── 缺口 code(与 deriveKnowledge 一一对应) ──
	prose_only_claims: { plain: '命题只有散文主张:两条结论是不是在说同一件事只能靠重读判断', where: '运行态卡 · 缺口', nextAction: '先在 clear/ontology/ 下写概念、关系与主体的实体文件,再用 Frame 修订把主张写成断言(主词–谓词–宾语)' },
	untouched_claims: { plain: '有命题一条证据都没碰过:没看过不等于没问题', where: '运行态卡 · 缺口 / 结案留痕', nextAction: '给它派一个带 tests 的步骤并交付:支持 / 推翻 / 无法判定都算碰过' },
	entities_unlanded: { plain: '断言的主体还没有落到实体图上:句子只挂在命题上,不构成「已知」', where: '运行态卡 · 缺口 / 本体面板 · 实体图', nextAction: '给这些主体各写一个实体文件(clear/ontology/entities/<id>.json,带类型与出处);确实不值得留下形态就把断言从判断上拿掉(Frame 修订)' },
	// ── 判据 ──
	done_criteria: { plain: '判据没改过:它还是立约时那一份(要原文读账本里的 done_criteria)', where: '运行态卡 · 当前目标 / 账本', nextAction: '要改判据就走修订,并带一份独立裁决的 auditKey' },
	criteria_verdict: { plain: '判据改动要有一份独立裁决:改「怎样算完成」不能被顺手做掉', where: '账本 · goal.criteriaHistory', nextAction: '拿独立裁决的 auditKey 再改判据文本' },
	// ── 宿主读面降级(宿主健康) ──
	sessions: { plain: '宿主会话服务读不到:这一刻拿不到会话,写盘可能写到错地方', where: '运行态卡 · 宿主读面降级 / 面板', nextAction: '不要写盘:等宿主服务可用,或如实说这一步没做' },
	sessionProjections: { plain: '投影服务读不到:这一刻的读数是空的,不是「没有」', where: '运行态卡 · 宿主读面降级 / 面板', nextAction: '不要把空读数当成事实;等投影可用再读一次' },
}

/** 等级那五个(`levels` 是给消费方一个不用过滤的入口,与 `GLOSSARY` 同源)。 */
export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4']

/**
 * **说人话的三张小表**(第六阶段)。内部名不改;卡、工具结果与面板上一律写右边那一列。
 * 模型读到什么就会照着说什么——所以卡先说人话,答复才说得出人话。
 */
export const LEVEL_WORD = { L0: '自己推了一遍', L1: '引用已有材料', L2: '可复算', L3: '独立核验', L4: '人放行' }
export const VERDICT_WORD = { support: '支持', refute: '推翻', inconclusive: '不确定' }
/** 判断短名的上限(字);没起名时取主张开头这么多字。与内核同一个数。 */
export const HANDLE_LIMIT = 12
/** 一条判断的短名:模型起的名字;旧日志没有,就取主张开头。 */
export function handleOf(hypothesis) {
	const name = typeof hypothesis?.name === 'string' ? hypothesis.name.trim() : ''
	if (name !== '') return name
	const claim = String(hypothesis?.claim ?? '').replace(/\s+/g, ' ').trim()
	return claim.length <= HANDLE_LIMIT ? claim : `${claim.slice(0, HANDLE_LIMIT)}…`
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const clamp = (value, max) => {
	const line = oneLine(value)
	return line.length <= max ? line : `${line.slice(0, max)}…`
}

/** 卡上的时间由调用方给(读面不读时钟);给了毫秒数就按本地时间格式化。 */

/** 人话的阶段名;表外的阶段原样给(不猜)。 */
/**
 * 进度那一格只放一个短语:词汇表里的 plain 是「词:解释」,卡上取冒号前那半句。
 * 「阶段边界」本身是内部词,换成它要人做的那件事。
 */
const PHASE_SHORT = { stage_boundary: '这份计划做完了,该结案或起新计划' }
const phasePlain = (phase) => (phase === null || phase === undefined ? '阶段还没算出来' : (PHASE_SHORT[phase] ?? String(GLOSSARY[phase]?.plain ?? phase).split(':')[0]))

/**
 * **卡文本的行装配**(带优先级)。
 *
 * 为什么不是「写多少算多少」再截断:那会把最有用的行(缺口 / 下一步)交给运气。
 * 每条线自带一个档(`tier`):0 不许丢,1 先丢,2 最先丢。超上限时**如实**说省了几行,
 * 而不是静默砍掉——读的人必须知道这张卡不是全部。
 */
function fitLines(lines, limit = CARD_LIMIT) {
	const measure = (list) => list.reduce((sum, item) => sum + item.text.length + 1, 0)
	const kept = lines.slice()
	let dropped = 0
	for (const tier of [2, 1]) {
		for (let index = kept.length - 1; index >= 0 && measure(kept) > limit; index -= 1) {
			if (kept[index].tier !== tier) continue
			kept.splice(index, 1)
			dropped += 1
		}
	}
	if (dropped > 0) {
		const note = `- …(卡片为 ${limit} 字符上限省去 ${dropped} 行细节:完整读数在面板「运行态」里)`
		/** 给这句提示**留出位置**:丢了行却不说,读的人会把这张卡当成全部。 */
		while (measure(kept) + note.length + 1 > limit) {
			let index = -1
			for (let cursor = kept.length - 1; cursor >= 0; cursor -= 1) {
				if (kept[cursor].tier > 0) {
					index = cursor
					break
				}
			}
			if (index < 0) break
			kept.splice(index, 1)
			dropped += 1
		}
		if (measure(kept) + note.length + 1 <= limit) kept.push({ text: note, tier: 0 })
	}
	if (measure(kept) > limit) {
		const note = `- …(卡片到达 ${limit} 字符上限,后面的行没有展开:完整读数在面板「运行态」里)`
		const out = []
		let total = 0
		for (const item of kept) {
			if (total + item.text.length + 1 + note.length + 1 > limit) break
			out.push(item.text)
			total += item.text.length + 1
		}
		out.push(note)
		return out.join('\n')
	}
	return kept.map((item) => item.text).join('\n')
}

/**
 * **可信度分组**(第六阶段):一条判断此刻落在哪一组。面板的清单、卡上的判断、图上的颜色读同一份。
 *
 *   · 已验证——独立核验过(或已写进长期知识),而且没被推翻;
 *   · 待核验——有支持的结果,但都是做的人自己判的;
 *   · 不确定——检验过,但只得到「不确定」;
 *   · 验证中——还没有任何结果;
 *   · 已推翻 / 已替换 / 已撤回——终态,留着不删。
 */
export const TRUST = [
	{ key: 'credible', label: '已验证' },
	{ key: 'pending', label: '待核验' },
	{ key: 'testing', label: '验证中' },
	{ key: 'unclear', label: '不确定' },
	{ key: 'refuted', label: '已推翻' },
	{ key: 'replaced', label: '已替换' },
]
export const TRUST_LABEL = Object.fromEntries(TRUST.map((item) => [item.key, item.label]))
const levelRank = (level) => LEVELS.indexOf(String(level ?? ''))
export function trustOf(hypothesis, promoted = false) {
	const status = String(hypothesis?.status ?? '')
	if (status === 'refuted' || (hypothesis?.refutations ?? 0) > 0) return 'refuted'
	if (status === 'superseded' || status === 'retracted') return 'replaced'
	if (promoted === true || status === 'confirmed') return 'credible'
	const level = levelRank(hypothesis?.supportedLevel)
	if (level >= 3) return 'credible'
	if (level >= 0) return 'pending'
	if ((hypothesis?.inconclusive ?? 0) > 0) return 'unclear'
	return 'testing'
}

/** 一条判断的读数,一句人话(卡上与面板同一句)。 */
export function readingOf(hypothesis) {
	const parts = []
	const level = hypothesis?.supportedLevel
	if (level !== null && level !== undefined) parts.push(`支持(${LEVEL_WORD[level] ?? level})`)
	if ((hypothesis?.refutations ?? 0) > 0) parts.push(`推翻 ${hypothesis.refutations} 次`)
	if ((hypothesis?.inconclusive ?? 0) > 0) parts.push(`不确定 ${hypothesis.inconclusive} 次`)
	return parts.length === 0 ? '还没检验' : parts.join(' · ')
}

/** 步骤状态的人话。 */
const STEP_WORD = { open: '待做', advanced: '已交付', void: '已作废' }

/**
 * **卡的正文**。它只读已经算好的 `view` 与 `(state, derived)`,不重算任何判据——
 * 同一份账本永远给出同一串字节:卡里**不带时刻**——时间戳会让同一个状态的卡每分钟变一次,
 * 按内容去重的那条纪律因此失效。要看「什么时候发生」,账本里有事件时间。
 *
 * **第六阶段起只说人话**:没有目标 id、修订号、阶段码、命题状态码、证据 id、缺口 code。
 * 判断用短名(模型起的,没起就取主张开头),结果用「支持 / 推翻 / 不确定」,
 * 等级用「自己推了一遍 … 人放行」。模型读到什么就会照着说什么。
 */
function cardLines(state, derived, options, view) {
	const goal = isPlainObject(state?.goal) ? state.goal : null
	const hypotheses = Array.isArray(derived?.hypotheses) ? derived.hypotheses : []
	const knowledge = isPlainObject(derived?.knowledge) ? derived.knowledge : { mode: 'ordinary', gaps: [], why: '' }
	const gaps = Array.isArray(knowledge.gaps) ? knowledge.gaps : []
	const conflicts = Array.isArray(derived?.conflicts) ? derived.conflicts : []
	const issues = Array.isArray(derived?.lexiconIssues) ? derived.lexiconIssues : []
	const lexicon = isPlainObject(derived?.lexicon) ? derived.lexicon : { terms: [], predicates: [] }
	const plan = isPlainObject(derived?.activePlan) ? derived.activePlan : null
	const evidence = Array.isArray(state?.evidence) ? state.evidence : []
	const facts = Array.isArray(state?.facts) ? state.facts : []
	const hostHealth = Array.isArray(state?.hostHealth) ? state.hostHealth : []
	const graph = graphProjection(state)
	const entityNodes = graph.nodes.filter((node) => node.layer === 'entity')
	const promotedIds = new Set(facts.map((fact) => fact?.hypothesis).filter((id) => typeof id === 'string'))
	const byId = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]))
	const nameOf = (id) => (byId.has(id) ? `「${handleOf(byId.get(id))}」` : '一条已不在账上的判断')
	const lines = []
	const push = (value, tier = 0) => lines.push({ text: value, tier })
	push('【现在的状态】')
	push(`- 在回答:${view.headline.now}`)
	if (goal === null) push('- 怎样算答完:还没定(用 Frame 写下判据与判断)')
	else {
		/**
		 * **判据逐条**,每行 80 字封顶、最多 6 条;全文的家在目标文档里。
		 * 判据正文只在这里出现一次:它是尺子,不是叙述。
		 */
		const criteriaLines = Array.isArray(view.goal.criteriaLines) ? view.goal.criteriaLines : []
		const criteriaTotal = typeof view.goal.criteriaTotal === 'number' ? view.goal.criteriaTotal : criteriaLines.length
		const criteriaDoc = view.goal.docPath ?? `clear/goals/${goal.id}.md`
		if (criteriaLines.length > 0) {
			push(`- 怎样算答完(${criteriaTotal} 条):`)
			const shown = criteriaLines.slice(0, CRITERIA_ROWS_MAX)
			for (let index = 0; index < shown.length; index += 1) push(`  ${index + 1}. ${clamp(shown[index], CRITERIA_LINE_LIMIT)}`)
			if (criteriaTotal > shown.length) push(`  · 还有 ${criteriaTotal - shown.length} 条,全文在 ${criteriaDoc}`, 1)
		} else {
			const full = String(goal.done_criteria ?? '')
			push(`- 怎样算答完:${clamp(full, 140) || GLOSSARY.done_criteria.plain}${oneLine(full).length > 140 ? `(全文在 ${criteriaDoc})` : ''}`)
		}
		if (view.goal.criteriaChanged) push(`  · 判据改过 ${view.goal.criteriaHistory.length} 次(每次都有独立裁决),全文在 ${criteriaDoc}`, 1)
		const steps = plan === null ? null : plan.steps.filter((step) => step.status !== 'void')
		const stepNote = steps === null ? '' : ` · 计划做到第 ${steps.filter((step) => step.status === 'advanced').length} / ${steps.length} 步`
		push(`- 进度:${phasePlain(derived?.phase)}${stepNote}`)
	}
	if (hostHealth.length > 0) {
		const last = hostHealth[hostHealth.length - 1]
		push(`- 读不到宿主 ${hostHealth.length} 次(最近:${clamp(last?.detail, 100)})——${GLOSSARY[String(last?.scope)]?.plain ?? GLOSSARY.sessions.plain}`)
	}
	if (hypotheses.length > 0) {
		push('- 判断:')
		const shown = hypotheses.slice(0, 10)
		for (const group of TRUST) {
			const rows = shown.filter((hypothesis) => trustOf(hypothesis, promotedIds.has(hypothesis.id)) === group.key)
			if (rows.length === 0) continue
			push(`  ${group.label}:`)
			for (const hypothesis of rows) {
				const terminal = group.key === 'refuted' || group.key === 'replaced'
				push(`    · ${typeof hypothesis.name === 'string' && hypothesis.name.trim() !== '' ? `「${hypothesis.name.trim()}」${clamp(hypothesis.claim, 120)}` : `「${clamp(hypothesis.claim, 120)}」`}${terminal ? '' : ` — 算错的条件:${clamp(hypothesis.refute_when, 100)}`} · ${readingOf(hypothesis)}`, terminal ? 1 : 0)
			}
		}
		if (hypotheses.length > 10) push(`  · 还有 ${hypotheses.length - 10} 条判断没展开(面板「本体」里有全部)`, 2)
	}
	if (plan === null) {
		if (goal !== null && String(goal.status) === 'open') push('- 计划:还没有(用 CreatePlan 把检验拆成步骤)', 1)
	} else {
		push('- 计划:', 1)
		for (const step of plan.steps.slice(0, 12)) {
			const tested = Array.isArray(step.tests?.hypotheses) ? step.tests.hypotheses : typeof step.tests?.hypothesis === 'string' ? [step.tests.hypothesis] : []
			const tests = tested.length === 0 ? '' : ` · 检验 ${tested.map(nameOf).join('、')}(${LEVEL_WORD[step.tests.level] ?? step.tests.level ?? '未定'})`
			push(`  第 ${step.ordinal} 步(${step.id})${clamp(step.do, 60)} · ${STEP_WORD[step.status] ?? step.status}${tests}`, 2)
		}
		if (plan.steps.length > 12) push(`  · 还有 ${plan.steps.length - 12} 步没展开(右栏「世界树」里有全部)`, 2)
		const first = plan.steps.find((step) => step.status === 'open')
		if (first !== undefined) push(`- 下一步:交付第 ${first.ordinal} 步(${first.id})——只能交付第一个没做完的步`)
		else if (goal !== null && String(goal.status) === 'open') push('- 下一步:计划的步都做完了,ClosePlan 收尾,然后 Conclude 结案或开下一阶段')
		if (plan.blocked !== undefined && plan.blocked !== null) push(`- 计划停下等人:${plan.blocked.reason}(连续 ${plan.blocked.attempts} 次没过,已经问人怎么办;没人答就等着)`)
	}
	if (evidence.length > 0) {
		const last = evidence[evidence.length - 1]
		const who = last.evaluator === 'independent' ? '独立核验' : LEVEL_WORD[last.level] ?? '自己判的'
		push(`- 最近一次结果:${last.hypothesis === null || last.hypothesis === undefined ? '目标判据' : nameOf(last.hypothesis)}${VERDICT_WORD[last.verdict] ?? last.verdict}(${who})`, 1)
	}
	/** 事实行含别的会话留下的(`foreign`):攒下来的东西从这里开始被看见。 */
	const factRows = Array.isArray(derived?.factRows) ? derived.factRows : facts
	if (factRows.length > 0) {
		const foreign = factRows.filter((fact) => fact?.foreign === true).length
		const changed = factRows.filter((fact) => Array.isArray(fact?.definitionsChanged) && fact.definitionsChanged.length > 0 && fact?.review?.decision !== 'retracted').length
		push(`- 已写进长期知识:${factRows.length} 条${foreign > 0 ? `(${foreign} 条来自以前的会话)` : ''},总览在 clear/knowledge/facts/INDEX.md${changed > 0 ? `;其中 ${changed} 条用到的定义后来改过,需复核` : ''}`, 1)
	}
	/**
	 * **本体大纲**:概念树与实体树的前两层(每支标节点数)、关系总数、跨文件问题。
	 * 细节在 clear/ontology/ 下的文件里,模型自己去读。
	 */
	const outline = ontologyOutline(state)
	const ontologyProblems = Array.isArray(state?.ontologyProblems) ? state.ontologyProblems : []
	if (outline.concepts.total > 0 || outline.entities.total > 0 || outline.relations > 0) {
		push(`- 本体(clear/ontology/):${outline.concepts.total} 个概念 · ${outline.relations} 种关系 · ${outline.entities.total} 个实体 · ${Array.isArray(state?.entityAssertions) ? state.entityAssertions.length : 0} 条实体关系`, 1)
		if (outline.concepts.lines.length > 0) push(`  · 概念树:${outline.concepts.lines.join(';')}${outline.concepts.more > 0 ? `;顶层还有 ${outline.concepts.more} 个` : ''}`, 1)
		if (outline.entities.lines.length > 0) push(`  · 实体树:${outline.entities.lines.join(';')}${outline.entities.more > 0 ? `;顶层还有 ${outline.entities.more} 个` : ''}`, 1)
	} else if (entityNodes.length > 0) push(`- 实体图上 ${entityNodes.length} 个实例`, 1)
	if (ontologyProblems.length > 0) {
		push(`- 本体文件有 ${ontologyProblems.length} 处问题(有问题的节点或关系没进图):`, 1)
		for (const item of ontologyProblems.slice(0, 5)) push(`  · ${item.path}:${clamp(item.detail, 160)}`, 1)
		if (ontologyProblems.length > 5) push(`  · 还有 ${ontologyProblems.length - 5} 处(面板「本体」里有全部)`, 2)
	} else if (issues.some((issue) => issue.severity === 'warning')) push(`- 词汇里有 ${issues.filter((issue) => issue.severity === 'warning').length} 处要看(引用了不存在的词,或绕成了环)`, 1)
	if (knowledge.mode === 'knowledge') {
		const preflight = view.deliver.preflight
		if (preflight !== null && (preflight.terms.length > 0 || preflight.predicates.length > 0)) {
			const more = (count) => (count > 0 ? `(还有 ${count} 个)` : '')
			const named = (entry) => (entry.label === entry.id ? entry.id : `${entry.label}(${entry.id})`)
			push(`- 已有的词,可直接用:概念 ${preflight.terms.map(named).join('、') || '无'}${more(preflight.termsTruncated)};关系 ${preflight.predicates.map(named).join('、') || '无'}${more(preflight.predicatesTruncated)}`, 1)
			if (preflight.facts.length > 0) push(`  · 能复用的已知 ${preflight.facts.length} 条${preflight.factsTruncated > 0 ? `(还有 ${preflight.factsTruncated} 条)` : ''}`, 1)
		} else push('- 已有的词里没有命中这些判断的:要写「主体 · 关系 · 对象」就先在 clear/ontology/ 下写概念与关系文件(字段见 SCHEMA.json);查不到不等于不存在', 1)
		if (gaps.length === 0) push('- 结构完整:判断都写成了断言、都检验过、主体都在实体图上')
		/** 缺口只给模型(人看不到):说清欠什么、下一步做什么,不写 code。 */
		for (const gap of gaps) push(`- 还欠的:${gap.detail} → ${gap.nextAction}`)
	}
	for (const conflict of conflicts.slice(0, 3)) {
		const sides = conflict.sides.map((side) => `「${side.value}」`).join(' 对 ')
		push(`- **矛盾**(${conflict.subject} 的 ${conflict.predicate}):${sides}。系统不替你选:用证据推翻一边,或请人定。`)
	}
	if (conflicts.length > 3) push(`- 还有 ${conflicts.length - 3} 处矛盾没展开(面板「本体」里有全部)`, 2)
	if (goal !== null && Array.isArray(goal.unjudged) && goal.unjudged.length > 0) push(`- 结案时没检验过的判断:${goal.unjudged.map(nameOf).join('、')}`)
	push('- 进度和可信度由系统按证据算,你只能通过交付推进。对人说起时用短名和这里的词,不写编号。')
	return lines
}

/**
 * **单一叙述源**:把一份账本读成给人看的东西。
 *
 * 返回的每个字段都是**投影**,不是存储;`card` 是同一份数据的正文形态,卡文本的上限由它保证。
 * `options.preflight` 是宿主算好的知识预检
 * (`knowledgePreflight` 住在 `fold.js`,宿主与卡传的是**同一份**)。
 */
export function knowledgeView(state, derived, options = {}) {
	const d = isPlainObject(derived) ? derived : {}
	const goal = isPlainObject(state?.goal) ? state.goal : null
	const hypotheses = Array.isArray(d.hypotheses) ? d.hypotheses : []
	const knowledge = isPlainObject(d.knowledge) ? d.knowledge : { mode: 'ordinary', gaps: [], why: '' }
	const gaps = Array.isArray(knowledge.gaps) ? knowledge.gaps : []
	const factRows = Array.isArray(d.factRows) ? d.factRows : []
	const conflicts = Array.isArray(d.conflicts) ? d.conflicts : []
	const graph = graphProjection(state)
	const entityNodes = graph.nodes.filter((node) => node.layer === 'entity')
	const live = hypotheses.filter((hypothesis) => !TERMINAL_STATUS.has(String(hypothesis.status)))
	const progress = typeof d.progress === 'number' ? d.progress : null
	const phase = d.phase ?? null
	const criteriaHistory = goal !== null && Array.isArray(goal.criteriaHistory) ? goal.criteriaHistory : []
	/** 判据的**全文只在改过时注入**:没改过就给一句 plain(见 `GLOSSARY.done_criteria`)。 */
	const criteriaChanged = criteriaHistory.length > 0
	/**
	 * 判据逐条的一份(面板与卡读的就是它):`criteria` 是**读面**,判定仍看 `done_criteria` 原文。
	 * 空行去掉、每行归一成一行;面板那一侧的上限在这里给,卡那一侧的上限(`80 字 / 最多 6 条`)
	 * 由卡自己再收——两个介质各自的界分开,别让面板的宽度决定卡的大小。
	 */
	const criteriaLines = goal !== null && Array.isArray(goal.criteria) ? goal.criteria.map((line) => oneLine(line)).filter((line) => line !== '') : []
	/** 全文的家:内核每次目标变更后幂等落盘的那份文档(面板的链接与卡的指针都用它)。 */
	const criteriaDoc = goal === null || goal.id === null || goal.id === undefined ? null : `clear/goals/${goal.id}.md`
	/**
	 * 「怎样算完成」就是**压缩版判据**——不必再包一层"判据没改过/改过"的元叙述:
	 * 读的人要的是尺子本身。改过没有由 `criteriaChanged` 那行正文说(它带修订号与裁决),
	 * 这里只回答"尺子上刻的是什么"。
	 */
	const doneText =
		goal === null
			? '还没有立约:没有「怎样算完成」可算——Frame 要一份可核对的判据'
			: Array.isArray(goal.criteria) && goal.criteria.length > 0
				? `${goal.criteria.length} 条:${clamp(goal.criteria.join(' / '), 140)}`
				: clamp(String(goal.done_criteria ?? ''), 140) || GLOSSARY.done_criteria.plain
	const entityCounts = { registered: 0, promoted: 0, asserted: 0 }
	for (const node of entityNodes) if (entityCounts[node.source] !== undefined) entityCounts[node.source] += 1
	const preflight = isPlainObject(options?.preflight) ? options.preflight : null
	const view = {
		headline: {
			now: goal === null ? '还没有立目标(Frame 需要一份「怎样算回答了」的判据)' : clamp(goal.headline ?? goal.claim, 160),
			done: doneText,
			where:
				goal === null
					? '还没开始:立约之后才有进度可算'
					: `${phasePlain(phase)} · 完成度 ${progress === null ? '无法计算' : `${Math.round(progress * 100)}%`}${live.length > 0 ? ` · ${live.length} 条判断验证中` : ''}${gaps.length > 0 ? ` · ${gaps.length} 条缺口` : ''}`,
		},
		goal:
			goal === null
				? null
				: {
						id: goal.id ?? null,
						revision: goal.revision ?? null,
						status: goal.status ?? null,
						headline: goal.headline ?? null,
						claim: goal.claim ?? null,
						doneCriteria: goal.done_criteria ?? null,
						criteria: Array.isArray(goal.criteria) ? goal.criteria : null,
						/** 逐条判据(面板按序号列;卡按同一份逐条渲染,只是收得更紧)。 */
						criteriaLines: criteriaLines.map((line) => clamp(line, CRITERIA_DISPLAY_LIMIT)),
						criteriaTotal: criteriaLines.length,
						criteriaNote: goal.criteria_note ?? null,
						/** 全文那一份落在哪(面板的链接与卡的指针读同一个路径,不各自拼)。 */
						docPath: criteriaDoc,
						criteriaChanged,
						criteriaHistory: criteriaHistory.map((entry) => ({ revision: entry?.revision ?? null, from: entry?.from ?? null, to: entry?.to ?? null, reason: entry?.reason ?? null, audit: entry?.audit ?? null, at: entry?.at ?? null })),
						promoteAtLevel: goal.promote_at_level ?? null,
						unjudged: Array.isArray(goal.unjudged) ? goal.unjudged : [],
						closeVerdict: goal.closeVerdict ?? null,
						legacy: goal.legacy === true,
					},
		progress,
		claims: hypotheses.map((hypothesis) => ({
			id: hypothesis.id,
			status: hypothesis.status ?? null,
			claim: hypothesis.claim ?? null,
			refuteWhen: hypothesis.refute_when ?? null,
			supportedLevel: hypothesis.supportedLevel ?? null,
			refutations: hypothesis.refutations ?? 0,
			inconclusive: hypothesis.inconclusive ?? 0,
			/** 一句读数(与卡上同一句):`未触及` 与「无法判定」分得开。 */
			readings: (hypothesis.supportedLevel === null || hypothesis.supportedLevel === undefined) && (hypothesis.refutations ?? 0) === 0 && (hypothesis.inconclusive ?? 0) === 0 ? '未触及' : `支持到 ${hypothesis.supportedLevel ?? '—'}`,
			/** 已带断言的条数(断言的人话芯片在投影侧算好,这里只报数)。 */
			assertions: Array.isArray(hypothesis.assertions) ? hypothesis.assertions.length : 0,
		})),
		gaps: gaps.map((gap) => ({ code: gap.code, count: gap.count, detail: gap.detail, nextAction: gap.nextAction })),
		facts: factRows.slice(0, 20).map((fact) => ({ id: fact.id ?? null, text: fact.text ?? null, level: fact.level ?? null, scope: fact.scope ?? null, typed: Array.isArray(fact.assertions) && fact.assertions.length > 0, refuted: fact.refuted === true })),
		factsTruncated: Math.max(0, factRows.length - 20),
		entities: entityNodes.map((node) => ({
			id: node.id,
			ref: node.ref ?? null,
			label: node.label ?? null,
			type: node.type ?? null,
			source: node.source ?? null,
			basis: node.basis ?? null,
			provenance: node.provenance ?? null,
			facts: Array.isArray(node.facts) ? node.facts : [],
		})),
		entityCounts,
		entityAssertions: (Array.isArray(state?.entityAssertions) ? state.entityAssertions : []).map((item) => ({ id: item?.id ?? null, subject: item?.subject ?? null, predicate: item?.predicate ?? null, object: item?.object ?? null, evidence: item?.evidence ?? null })),
		evidence: (() => {
			const rows = Array.isArray(state?.evidence) ? state.evidence : []
			const last = rows.length === 0 ? null : rows[rows.length - 1]
			return { total: rows.length, last: last === null ? null : { id: last.id ?? null, verdict: last.verdict ?? null, level: last.level ?? null, evaluator: last.evaluator ?? null, at: last.at ?? null } }
		})(),
		deliver: {
			plan: isPlainObject(d.activePlan) ? { id: d.activePlan.id, status: d.activePlan.status, brief: d.activePlan.brief ?? '' } : null,
			steps: isPlainObject(d.activePlan) ? (d.activePlan.steps ?? []).map((step) => ({ id: step.id, ordinal: step.ordinal, do: step.do, status: step.status, artifacts: step.artifacts ?? [] })) : [],
			next: isPlainObject(d.activePlan) ? ((d.activePlan.steps ?? []).find((step) => step.status === 'open')?.id ?? null) : null,
			/** 知识预检(宿主算好的那一份):进了知识模式才有,否则 null。 */
			preflight,
		},
		hostHealth: (Array.isArray(state?.hostHealth) ? state.hostHealth : []).map((entry) => ({ scope: entry?.scope ?? null, detail: entry?.detail ?? null, at: entry?.at ?? null })),
		conflicts: conflicts.map((conflict) => ({ predicate: conflict.predicate, subject: conflict.subject, sides: conflict.sides.map((side) => ({ fact: side.fact ?? null, value: side.value ?? null })) })),
		/** **这张卡不声称什么**:边界与卡放在一起,读的人不必去别处找。 */
		boundaries: [
			'进度、阶段、假设状态都是系统算出来的:模型不能声明它们,只能通过交付与裁决推进。',
			'冲突只暴露不裁决:系统不替你选哪一侧为真。',
			'实体断言有出处但未经独立裁决:它进图,但还不是「已知」。',
			'读面降级(读不到会话 / 投影)时给的是空读数,不是「没有」——不要把读不到当成不存在。',
		],
		glossary: GLOSSARY,
		levels: Object.fromEntries(LEVELS.map((level) => [level, GLOSSARY[level]])),
		card: '',
	}
	view.card = fitLines(cardLines(state, d, options, view), CARD_LIMIT)
	return view
}
