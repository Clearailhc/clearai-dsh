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
import { graphProjection } from './domain-language.js'
import { bilingual, tr } from './lang.js'

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
export const GLOSSARY = bilingual({
	// ── 认识论等级(「这条结论多大程度只能靠信任做的人」) ──
	L0: {
		plain: ['推理自检:结论只是自己推了一遍,没有引入任何外部输入', 'Reasoning check: the conclusion was only reasoned through, with no outside input'],
		where: ['docs/verification-loop.md 的等级表', 'the level table in docs/verification-loop.md'],
		nextAction: ['把这一级要检查的对象过一遍,或写明这一级在本项目里为什么不适用', 'Go through what this level checks, or write down why it does not apply in this project'],
	},
	L1: {
		plain: ['已有知识:引用自己或别人手上已有的材料', 'Existing knowledge: cites material already at hand'],
		where: ['docs/verification-loop.md 的等级表', 'the level table in docs/verification-loop.md'],
		nextAction: ['指出引用的具体材料;没有就升级到能验的等级', 'Point to the material cited; without it, move up to a level that can be checked'],
	},
	L2: {
		plain: ['可复算:照一份能重跑的步骤自己算一遍', 'Reproducible: computed by following steps anyone can rerun'],
		where: ['docs/verification-loop.md 的等级表', 'the level table in docs/verification-loop.md'],
		nextAction: ['把复算步骤与产物落成文件,让下一个人能重跑', 'Save the steps and outputs as files so the next person can rerun them'],
	},
	L3: {
		plain: ['独立裁决:由另一个评估者读产物后给结论', 'Independent verdict: another evaluator reads the outputs and decides'],
		where: ['docs/verification-loop.md 的等级表', 'the level table in docs/verification-loop.md'],
		nextAction: ['派一次独立评估,把评估卡作为出处', 'Get one independent evaluation and cite its evaluation card'],
	},
	L4: {
		plain: ['人工批准:交付前已有人审阅并批准', 'Released by a person: someone looked at it and approved before delivery'],
		where: ['docs/verification-loop.md 的等级表', 'the level table in docs/verification-loop.md'],
		nextAction: ['等一次人的放行记录;没有人就不要声称到过这一级', 'Wait for a person to release it; without one, do not claim this level'],
	},
	// ── 阶段(派生读数) ──
	planning: {
		plain: ['还没建计划:先想清楚要怎么回答', 'No plan yet: first work out how to answer'],
		where: ['运行态卡 · 当前计划', 'runtime card · current plan'],
		nextAction: ['用 CreatePlan 把回答拆成可交付的步骤', 'Use CreatePlan to split the answer into deliverable steps'],
	},
	executing: {
		plain: ['执行中:有活动计划且还有未落定的步', 'Executing: there is an active plan with unsettled steps'],
		where: ['运行态卡 · 当前计划', 'runtime card · current plan'],
		nextAction: ['推进第一个未落定步,交付落在它上面', 'Work on the first unsettled step and deliver it'],
	},
	stage_boundary: {
		plain: ['阶段边界:当前计划的步都落定了,该结案或起新计划', 'Stage boundary: every step of the current plan is settled; conclude or start a new plan'],
		where: ['运行态卡 · 当前计划', 'runtime card · current plan'],
		nextAction: ['结案(Conclude)或起下一阶段计划', 'Conclude, or plan the next stage'],
	},
	auditing: {
		plain: ['在等裁决:有交付/结案在飞,或上一次裁决还没回来', 'Waiting for a verdict: a delivery or conclusion is in flight, or the last verdict has not returned'],
		where: ['运行态卡 · 阶段(派生)', 'runtime card · phase (derived)'],
		nextAction: ['等评估者回灌;不要重复派同一个裁决', 'Wait for the evaluator; do not request the same verdict again'],
	},
	stalled: {
		plain: ['卡住了:连续几次没通过观测准入,停下等人', 'Stuck: observation admission failed several times in a row; waiting for a person'],
		where: ['运行态卡 · 计划被拦', 'runtime card · plan blocked'],
		nextAction: ['说一句怎么改(改计划或补判据)', 'Say how to change it (revise the plan or the criteria)'],
	},
	achieved: {
		plain: ['目标已达成(终局)', 'Goal achieved (final)'],
		where: ['运行态卡 · 当前目标', 'runtime card · current goal'],
		nextAction: ['没有待办:要做新事就立新目标', 'Nothing to do: set a new goal for new work'],
	},
	abandoned: {
		plain: ['目标已如实放弃(终局)', 'Goal honestly abandoned (final)'],
		where: ['运行态卡 · 当前目标', 'runtime card · current goal'],
		nextAction: ['没有待办:放弃也是结论,记录保留', 'Nothing to do: abandoning is a conclusion too, and the record stays'],
	},
	// ── 实体图的三个来源 ──
	registered: {
		plain: ['已登记:某实例在某出处下被登记下来(一等写入口)', 'Registered: an instance recorded with its source (first-class entry)'],
		where: ['本体面板 · 实体图节点', 'ontology panel · entity graph node'],
		nextAction: ['在它的实体文件里写 relations(每条带出处),图才长出边', 'Write relations (each with a source) in its entity file so the graph grows edges'],
	},
	promoted: {
		plain: ['已升格:来自过了独立裁决的事实断言', 'Promoted: from a fact assertion that passed an independent verdict'],
		where: ['本体面板 · 实体图边', 'ontology panel · entity graph edge'],
		nextAction: ['它已经带等级与边界;要改就去改那条事实', 'It already carries a level and a boundary; to change it, change that fact'],
	},
	asserted: {
		plain: ['实体断言:登记那一刻就成立的边,有出处但未经独立裁决', 'Entity assertion: an edge recorded with a source but no independent verdict'],
		where: ['本体面板 · 实体图虚线边', 'ontology panel · dashed entity graph edge'],
		nextAction: ['要让它进「已知」就把它升格成事实(走独立裁决)', 'To make it "known", promote it to a fact (through an independent verdict)'],
	},
	// ── 派生读数 ──
	supportedLevel: {
		plain: ['支持到哪一级:所有支持证据里最高的那一级', 'Supported level: the highest level among all supporting evidence'],
		where: ['运行态卡 · 假设状态', 'runtime card · judgment status'],
		nextAction: ['等级不够就补更硬的那一档证据', 'If the level is too low, add harder evidence'],
	},
	refutations: {
		plain: ['被推翻次数:收到过几条推翻证据', 'Refutations: how many pieces of refuting evidence arrived'],
		where: ['运行态卡 · 假设状态', 'runtime card · judgment status'],
		nextAction: ['被推翻是终态:要么改主张换 id,要么如实放弃', 'Refuted is final: either restate the claim under a new id, or honestly give it up'],
	},
	inconclusive: {
		plain: ['无法判定次数:判过但判不出来', 'Inconclusive: judged but could not be decided'],
		where: ['运行态卡 · 假设状态', 'runtime card · judgment status'],
		nextAction: ['补判据或补产物,让下一次判得出结果', 'Add criteria or outputs so the next judgment can decide'],
	},
	// ── 缺口 code(与 deriveKnowledge 一一对应) ──
	prose_only_claims: {
		plain: ['命题只有散文主张:两条结论是不是在说同一件事只能靠重读判断', 'Prose-only claims: whether two conclusions say the same thing can only be judged by rereading'],
		where: ['运行态卡 · 缺口', 'runtime card · gaps'],
		nextAction: [
			'可选:用 Frame 修订在 ontology 里补上概念与关系,再把主张写成断言(主词–谓词–宾语)',
			'Optional: revise with Frame to add the concepts and relations in ontology, then write the claim as assertions (subject–predicate–object)',
		],
	},
	untouched_claims: {
		plain: ['有命题一条证据都没碰过:没看过不等于没问题', 'Some propositions were never touched by evidence: not looked at is not the same as fine'],
		where: ['运行态卡 · 缺口 / 结案留痕', 'runtime card · gaps / closing record'],
		nextAction: ['给它派一个带 tests 的步骤并交付:支持 / 推翻 / 无法判定都算碰过', 'Give it a step with tests and deliver it: support, refute and inconclusive all count'],
	},
	entities_unlanded: {
		plain: ['断言的主体还没有落到实体图上:句子只挂在命题上,不构成「已知」', 'Assertion subjects are not on the entity graph: the sentences hang on the proposition only and are not "known"'],
		where: ['运行态卡 · 缺口 / 本体面板 · 实体图', 'runtime card · gaps / ontology panel · entity graph'],
		nextAction: [
			'给这些主体各写一个实体文件(clear/ontology/entities/<id>.json,带类型与出处);确实不值得留下形态就把断言从判断上拿掉(Frame 修订)',
			'Write an entity file for each subject (clear/ontology/entities/<id>.json, with type and source); if one is really not worth keeping, drop the assertion from the judgment (Frame revision)',
		],
	},
	// ── 判据 ──
	done_criteria: {
		plain: ['判据没改过:它还是立约时那一份(要原文读账本里的 done_criteria)', 'The criteria are unchanged since framing (read done_criteria in the ledger for the full text)'],
		where: ['运行态卡 · 当前目标 / 账本', 'runtime card · current goal / ledger'],
		nextAction: ['要改判据就走修订,并带一份独立裁决的 auditKey', 'To change the criteria, revise them with the auditKey of an independent verdict'],
	},
	criteria_verdict: {
		plain: ['判据改动要有一份独立裁决:改「怎样算完成」不能被顺手做掉', 'Changing the criteria needs an independent verdict: "what counts as done" cannot be changed in passing'],
		where: ['账本 · goal.criteriaHistory', 'ledger · goal.criteriaHistory'],
		nextAction: ['拿独立裁决的 auditKey 再改判据文本', 'Get an independent verdict auditKey, then change the criteria text'],
	},
	// ── 宿主读面降级(宿主健康) ──
	sessions: {
		plain: ['宿主会话服务读不到:这一刻拿不到会话,写盘可能写到错地方', 'The host session service is unavailable: no session right now, and writes may land in the wrong place'],
		where: ['运行态卡 · 宿主读面降级 / 面板', 'runtime card · host read degraded / panel'],
		nextAction: ['不要写盘:等宿主服务可用,或如实说这一步没做', 'Do not write files: wait for the host service, or say plainly this step was not done'],
	},
	sessionProjections: {
		plain: ['投影服务读不到:这一刻的读数是空的,不是「没有」', 'The projection service is unavailable: the reading is empty, not "nothing"'],
		where: ['运行态卡 · 宿主读面降级 / 面板', 'runtime card · host read degraded / panel'],
		nextAction: ['不要把空读数当成事实;等投影可用再读一次', 'Do not treat an empty reading as a fact; read again once projections are available'],
	},
})

/** 等级那五个(`levels` 是给消费方一个不用过滤的入口,与 `GLOSSARY` 同源)。 */
export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4']

/**
 * **说人话的三张小表**(第六阶段)。内部名不改;卡、工具结果与面板上一律写右边那一列。
 * 模型读到什么就会照着说什么——所以卡先说人话,答复才说得出人话。
 */
/** 等级只说三档:L0–L2 合并成「自行检验」(旧账里的 L0 / L1 也这么读),L3 独立评估,L4 人工批准。 */
export const LEVEL_WORD = bilingual({ L0: ['自行检验', 'self-tested'], L1: ['自行检验', 'self-tested'], L2: ['自行检验', 'self-tested'], L3: ['独立核验', 'independent check'], L4: ['人工批准', 'approved by a person'] })
export const VERDICT_WORD = bilingual({ support: ['支持', 'support'], refute: ['推翻', 'refute'], inconclusive: ['不确定', 'inconclusive'] })
/** 判断短名的上限(汉字);没起名时取主张开头这么宽。与内核同一个数。 */
export const HANDLE_LIMIT = 12
/**
 * 短名按**显示宽度**算:中日韩字算 2,其余算 1。上限是 `HANDLE_LIMIT` 个汉字的宽度,
 * 所以中文仍是十二字,英文约二十四个字母——按字数一刀切会让英文短名短得没法用。
 */
const wideChar = (char) => /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char)
const textWidth = (text) => [...text].reduce((sum, char) => sum + (wideChar(char) ? 2 : 1), 0)
function clipWidth(text, limit) {
	if (textWidth(text) <= limit) return text
	let out = ''
	let width = 0
	for (const char of text) {
		width += wideChar(char) ? 2 : 1
		if (width > limit) break
		out += char
	}
	return `${out.trimEnd()}…`
}
/** 一条判断的短名:模型起的名字;旧日志没有,就取主张开头。 */
export function handleOf(hypothesis) {
	const name = typeof hypothesis?.name === 'string' ? hypothesis.name.trim() : ''
	if (name !== '') return name
	const claim = String(hypothesis?.claim ?? '').replace(/\s+/g, ' ').trim()
	return clipWidth(claim, HANDLE_LIMIT * 2)
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
const PHASE_SHORT = bilingual({ stage_boundary: ['这份计划做完了,该结案或起新计划', 'this plan is done; conclude or start a new plan'] })
const phasePlain = (phase) => (phase === null || phase === undefined ? tr('阶段还没算出来', 'phase not derived yet') : (PHASE_SHORT[phase] ?? String(GLOSSARY[phase]?.plain ?? phase).split(':')[0]))

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
		const note = tr(`- …(卡片为 ${limit} 字符上限省去 ${dropped} 行细节:完整读数在面板「运行态」里)`, `- … (${dropped} detail lines left out to fit the ${limit}-character card limit; the full reading is in the panel)`)
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
		const note = tr(`- …(卡片到达 ${limit} 字符上限,后面的行没有展开:完整读数在面板「运行态」里)`, `- … (the card reached its ${limit}-character limit; the remaining lines are not shown; the full reading is in the panel)`)
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
export const TRUST_LABEL = bilingual({
	credible: ['已验证', 'Verified'],
	pending: ['待核验', 'Awaiting check'],
	testing: ['验证中', 'Testing'],
	unclear: ['不确定', 'Uncertain'],
	refuted: ['已推翻', 'Refuted'],
	replaced: ['已替换', 'Replaced'],
})
export const TRUST = ['credible', 'pending', 'testing', 'unclear', 'refuted', 'replaced'].map((key) => ({
	key,
	get label() {
		return TRUST_LABEL[key]
	},
}))
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
	if (level !== null && level !== undefined) parts.push(tr(`支持(${LEVEL_WORD[level] ?? level})`, `supported (${LEVEL_WORD[level] ?? level})`))
	if ((hypothesis?.refutations ?? 0) > 0) parts.push(tr(`推翻 ${hypothesis.refutations} 次`, `refuted ${hypothesis.refutations}×`))
	if ((hypothesis?.inconclusive ?? 0) > 0) parts.push(tr(`不确定 ${hypothesis.inconclusive} 次`, `inconclusive ${hypothesis.inconclusive}×`))
	return parts.length === 0 ? tr('还没检验', 'not tested yet') : parts.join(' · ')
}

/** 步骤状态的人话。 */
const STEP_WORD = bilingual({ open: ['待做', 'to do'], advanced: ['已交付', 'delivered'], void: ['已作废', 'voided'] })

/** 一条事实在卡上的一行:原话、适用范围、等级;来自别的会话的标出来。 */
/** 有开着的未解释项点名这条事实:它回到「待核验」,直到那些未解释项有了去处。 */
function questionedNote(fact, language) {
	const ids = Array.isArray(fact?.questioned) ? fact.questioned : []
	if (ids.length === 0) return ''
	return language === 'en' ? ` · pending re-check (unexplained ${ids.join(', ')})` : ` · 待核验(未解释项 ${ids.join('、')})`
}

function factLine(fact) {
	const scope = oneLine(fact?.scope ?? '')
	return tr(
		`  · 「${clamp(fact?.text, 100)}」 — 适用范围:${scope === '' ? '未声明' : clamp(scope, 80)}${fact?.level ? ` · ${fact.level}` : ''}${fact?.foreign === true ? ' · 以前的会话' : ''}${questionedNote(fact, 'zh')}`,
		`  · "${clamp(fact?.text, 100)}" — scope: ${scope === '' ? 'not declared' : clamp(scope, 80)}${fact?.level ? ` · ${fact.level}` : ''}${fact?.foreign === true ? ' · earlier session' : ''}${questionedNote(fact, 'en')}`,
	)
}

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
	const promotedIds = new Set(facts.map((fact) => fact?.hypothesis).filter((id) => typeof id === 'string'))
	const byId = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]))
	const nameOf = (id) => (byId.has(id) ? tr(`「${handleOf(byId.get(id))}」`, `"${handleOf(byId.get(id))}"`) : tr('一条已不在账上的判断', 'a judgment no longer on record'))
	const lines = []
	const push = (value, tier = 0) => lines.push({ text: value, tier })
	push(tr('【现在的状态】', '[Current state]'))
	push(tr(`- 在回答:${view.headline.now}`, `- Answering: ${view.headline.now}`))
	if (goal === null) push(tr('- 怎样算答完:还没定(用 Frame 写下判据与判断)', '- Done when: not set yet (write criteria and judgments with Frame)'))
	else {
		/**
		 * **判据逐条**,每行 80 字封顶、最多 6 条;全文的家在目标文档里。
		 * 判据正文只在这里出现一次:它是尺子,不是叙述。
		 */
		const criteriaLines = Array.isArray(view.goal.criteriaLines) ? view.goal.criteriaLines : []
		const criteriaTotal = typeof view.goal.criteriaTotal === 'number' ? view.goal.criteriaTotal : criteriaLines.length
		const criteriaDoc = view.goal.docPath ?? `clear/goals/${goal.id}.md`
		if (criteriaLines.length > 0) {
			push(tr(`- 怎样算答完(${criteriaTotal} 条):`, `- Done when (${criteriaTotal} criteria):`))
			const shown = criteriaLines.slice(0, CRITERIA_ROWS_MAX)
			for (let index = 0; index < shown.length; index += 1) push(`  ${index + 1}. ${clamp(shown[index], CRITERIA_LINE_LIMIT)}`)
			if (criteriaTotal > shown.length) push(tr(`  · 还有 ${criteriaTotal - shown.length} 条,全文在 ${criteriaDoc}`, `  · ${criteriaTotal - shown.length} more; full text in ${criteriaDoc}`), 1)
		} else {
			const full = String(goal.done_criteria ?? '')
			push(tr(`- 怎样算答完:${clamp(full, 140) || GLOSSARY.done_criteria.plain}${oneLine(full).length > 140 ? `(全文在 ${criteriaDoc})` : ''}`, `- Done when: ${clamp(full, 140) || GLOSSARY.done_criteria.plain}${oneLine(full).length > 140 ? ` (full text in ${criteriaDoc})` : ''}`))
		}
		if (view.goal.criteriaChanged) push(tr(`  · 判据改过 ${view.goal.criteriaHistory.length} 次(每次都有独立裁决),全文在 ${criteriaDoc}`, `  · criteria changed ${view.goal.criteriaHistory.length}× (each with an independent verdict); full text in ${criteriaDoc}`), 1)
		const steps = plan === null ? null : plan.steps.filter((step) => step.status !== 'void')
		const stepNote = steps === null ? '' : tr(` · 计划做到第 ${steps.filter((step) => step.status === 'advanced').length} / ${steps.length} 步`, ` · plan at step ${steps.filter((step) => step.status === 'advanced').length} / ${steps.length}`)
		push(tr(`- 进度:${phasePlain(derived?.phase)}${stepNote}`, `- Progress: ${phasePlain(derived?.phase)}${stepNote}`))
	}
	if (hostHealth.length > 0) {
		const last = hostHealth[hostHealth.length - 1]
		push(tr(`- 读不到宿主 ${hostHealth.length} 次(最近:${clamp(last?.detail, 100)})——${GLOSSARY[String(last?.scope)]?.plain ?? GLOSSARY.sessions.plain}`, `- Host unreadable ${hostHealth.length}× (latest: ${clamp(last?.detail, 100)}): ${GLOSSARY[String(last?.scope)]?.plain ?? GLOSSARY.sessions.plain}`))
	}
	if (hypotheses.length > 0) {
		push(tr('- 判断:', '- Judgments:'))
		const shown = hypotheses.slice(0, 10)
		for (const group of TRUST) {
			const rows = shown.filter((hypothesis) => trustOf(hypothesis, promotedIds.has(hypothesis.id)) === group.key)
			if (rows.length === 0) continue
			push(`  ${group.label}:`)
			for (const hypothesis of rows) {
				const terminal = group.key === 'refuted' || group.key === 'replaced'
				const named = typeof hypothesis.name === 'string' && hypothesis.name.trim() !== ''
				const head = tr(named ? `「${hypothesis.name.trim()}」${clamp(hypothesis.claim, 120)}` : `「${clamp(hypothesis.claim, 120)}」`, named ? `"${hypothesis.name.trim()}" ${clamp(hypothesis.claim, 120)}` : `"${clamp(hypothesis.claim, 120)}"`)
				const refute = terminal ? '' : tr(` — 推翻条件:${clamp(hypothesis.refute_when, 100)}`, ` — wrong if: ${clamp(hypothesis.refute_when, 100)}`)
				push(`    · ${head}${refute} · ${readingOf(hypothesis)}`, terminal ? 1 : 0)
			}
		}
		if (hypotheses.length > 10) push(tr(`  · 还有 ${hypotheses.length - 10} 条判断没展开(「探索」货架里有全部)`, `  · ${hypotheses.length - 10} more judgments not shown (all are in the Explore shelf)`), 2)
	}
	/**
	 * **当前位置**:问题 → 候选假设(或调研板块)的计数,与探索货架同一份派生(`derived.exploration`)。
	 * 只在目标开着时给;没列问题的目标就是一个问题,这一行省掉(上面的判断列表已经说清)。
	 */
	const exploration = isPlainObject(derived?.exploration) ? derived.exploration : null
	if (exploration !== null && goal !== null && String(goal.status) === 'open') {
		const STATE_WORD = { examining: tr('考察中', 'being examined'), excluded: tr('已排除', 'excluded'), adopted: tr('已采纳', 'adopted'), set_aside: tr('暂不考察', 'set aside') }
		const AREA_WORD = { not_started: tr('未开始', 'not started'), in_progress: tr('调研中', 'in progress'), clear: tr('已厘清', 'clear') }
		const declared = (exploration.questions ?? []).filter((question) => !question.implicit)
		if (declared.length > 0 || (exploration.areas ?? []).length > 0) {
			push(tr('- 当前位置:', '- Where things stand:'))
			for (const area of (exploration.areas ?? []).slice(0, 8)) push(tr(`  板块「${clamp(area.name, 30)}」${AREA_WORD[area.state] ?? area.state} · 判断 ${area.judgments} 条,已采纳 ${area.verified} 条${area.openAnomalies > 0 ? ` · 未解释 ${area.openAnomalies} 条` : ''}`, `  Area "${clamp(area.name, 30)}" ${AREA_WORD[area.state] ?? area.state} · ${area.judgments} judgments, ${area.verified} adopted${area.openAnomalies > 0 ? ` · ${area.openAnomalies} unexplained` : ''}`), 1)
			for (const question of declared.slice(0, 8)) {
				const counts = Object.entries({ examining: question.counts?.examining, excluded: question.counts?.excluded, adopted: question.counts?.adopted }).filter(([, value]) => value > 0).map(([key, value]) => tr(`${STATE_WORD[key]} ${value}`, `${STATE_WORD[key]} ${value}`))
				const status = question.status === 'answered' ? tr('已作答', 'answered') : question.status === 'emergent' ? tr('新发现,待人决定是否立为问题', 'newly found, awaiting a decision') : question.status === 'parked' ? tr('暂缓', 'parked') : counts.length > 0 ? tr(`候选假设 ${counts.join(' / ')}`, `candidates ${counts.join(' / ')}`) : tr('还没有候选假设', 'no candidates yet')
				push(`  ${question.id === exploration.current ? '▸' : '·'} ${question.id}「${clamp(question.text, 60)}」${status}`, question.id === exploration.current ? 0 : 1)
			}
		}
		/** 本体里带形状、还没有候选由它提出的影响关系:只列出,不强制(不为竞争而竞争)。 */
		const untapped = Array.isArray(exploration.untapped) ? exploration.untapped : []
		if (untapped.length > 0) {
			const SHAPE = { increasing: tr('单调升', 'increasing'), decreasing: tr('单调降', 'decreasing'), peak: tr('有峰', 'has a peak'), threshold: tr('有阈值', 'has a threshold'), coupled: tr('耦合', 'coupled') }
			push(tr(`- 本体中尚无候选假设引用的影响关系:${untapped.slice(0, 5).map((item) => `${item.label}(${SHAPE[item.shape] ?? item.shape})`).join('、')}——若它们可能改变结论,可据此提出候选(\`from\` 写关系 id)`, `- Affects relations in the ontology no candidate cites yet: ${untapped.slice(0, 5).map((item) => `${item.label} (${SHAPE[item.shape] ?? item.shape})`).join(', ')}; if they could change the conclusion, propose candidates from them (\`from\` = the relation id)`), 1)
		}
	}
	if (plan === null) {
		if (goal !== null && String(goal.status) === 'open') push(tr('- 计划:还没有(用 CreatePlan 把检验拆成步骤)', '- Plan: none yet (use CreatePlan to split the tests into steps)'), 1)
	} else {
		push(tr('- 计划:', '- Plan:'), 1)
		for (const step of plan.steps.slice(0, 12)) {
			const tested = Array.isArray(step.tests?.hypotheses) ? step.tests.hypotheses : typeof step.tests?.hypothesis === 'string' ? [step.tests.hypothesis] : []
			const level = LEVEL_WORD[step.tests?.level] ?? step.tests?.level ?? tr('未定', 'unset')
			const tests = tested.length === 0 ? '' : tr(` · 检验 ${tested.map(nameOf).join('、')}(${level})`, ` · tests ${tested.map(nameOf).join(', ')} (${level})`)
			push(tr(`  第 ${step.ordinal} 步(${step.id})${clamp(step.do, 60)} · ${STEP_WORD[step.status] ?? step.status}${tests}`, `  Step ${step.ordinal} (${step.id}) ${clamp(step.do, 60)} · ${STEP_WORD[step.status] ?? step.status}${tests}`), 2)
		}
		if (plan.steps.length > 12) push(tr(`  · 还有 ${plan.steps.length - 12} 步没展开(「探索」货架里有全部)`, `  · ${plan.steps.length - 12} more steps not shown (all are in the Explore shelf)`), 2)
		const first = plan.steps.find((step) => step.status === 'open')
		if (first !== undefined) {
			push(tr(`- 下一步:交付第 ${first.ordinal} 步(${first.id})——只能交付第一个没做完的步`, `- Next: deliver step ${first.ordinal} (${first.id}); only the first unfinished step can be delivered`))
			/** 预期可选,但卡上提醒:没写下来的预期,落空了也看不见。 */
			const next = exploration?.next ?? null
			const predictions = next !== null && next.step === first.id && Array.isArray(next.predictions) ? next.predictions : []
			if (predictions.length > 0) {
				push(tr('  各候选的预测:', '  Predictions per candidate:'))
				for (const item of predictions.slice(0, 5)) push(tr(`    · 若「${item.name}」成立:${clamp(item.expect, 120)}`, `    · If "${item.name}" holds: ${clamp(item.expect, 120)}`))
				if (next.indistinct === true) push(tr('  注意:各候选的预测相同,这一步区分不了它们;应改用能区分的检验(RevisePlan)', '  Warning: every candidate predicts the same, so this step cannot tell them apart; switch to a test that can (RevisePlan)'))
				else push(tr('  结果与预测不符的地方写进 anomalies,不要解释过去', '  Whatever contradicts the predictions goes in anomalies; do not explain it away'), 1)
			}
			if (typeof first.expect === 'string' && first.expect !== '') push(tr(`  预测:${clamp(first.expect, 160)}。结果与预测不符之处写入 anomalies,不要强行解释`, `  Expected: ${clamp(first.expect, 160)}; whatever does not match goes in anomalies, do not explain it away`))
			else if (predictions.length === 0) push(tr('  动手前写下预测(RevisePlan action="expect":按候选分别写 predictions,或写 expect 并注明来自哪条关系或经验),落空才看得见', '  Before acting, write predictions (RevisePlan action="expect": predictions per candidate, or expect with the relation or lesson it comes from), so a miss is visible'), 1)
		}
		else if (goal !== null && String(goal.status) === 'open') push(tr('- 下一步:计划的步都做完了,ClosePlan 收尾,然后 Conclude 结案(answers 按问题写结论、依据、尚未确定的事项、待您决策)或开下一阶段', '- Next: every step is done; ClosePlan, then Conclude (answers per question: conclusion, basis, open points, decisions for the user) or start the next stage'))
		if (plan.blocked !== undefined && plan.blocked !== null) push(tr(`- 计划停下等人:${plan.blocked.reason}(连续 ${plan.blocked.attempts} 次没过,已经问人怎么办;没人答就等着)`, `- Plan stopped, waiting for a person: ${plan.blocked.reason} (failed ${plan.blocked.attempts}× in a row; a person has been asked; wait if nobody answers)`))
	}
	/**
	 * **未解释项**:卡上最不能省的一格。开着的逐条摆出来,直到被解释、写明理由排除、或交给人;
	 * 评估者报的标出来(那是做的人自己没看见的)。
	 */
	const anomalies = Array.isArray(state?.anomalies) ? state.anomalies : []
	const openAnomalies = anomalies.filter((item) => item?.status === 'open')
	if (openAnomalies.length > 0) {
		push(tr(`- 未解释(${openAnomalies.length} 条开着;用 Anomaly 解释、排除或交给人,不要解释过去):`, `- Unexplained (${openAnomalies.length} open; explain, rule out or hand to a person with Anomaly; do not explain them away):`))
		for (const item of openAnomalies.slice(0, 8)) push(tr(`  · ${item.id}${item.by === 'evaluator' ? '(评估者发现)' : ''}:${clamp(item.what, 140)}${item.anchor ? ` · 在 ${clamp(item.anchor, 30)}` : ''}${(item.touches ?? []).length > 0 ? ` · 涉及 ${item.touches.slice(0, 4).join('、')}` : ''}`, `  · ${item.id}${item.by === 'evaluator' ? ' (found by the evaluator)' : ''}: ${clamp(item.what, 140)}${item.anchor ? ` · on ${clamp(item.anchor, 30)}` : ''}${(item.touches ?? []).length > 0 ? ` · touches ${item.touches.slice(0, 4).join(', ')}` : ''}`))
		if (openAnomalies.length > 8) push(tr(`  · 还有 ${openAnomalies.length - 8} 条`, `  · ${openAnomalies.length - 8} more`), 1)
	}
	const settledAnomalies = anomalies.length - openAnomalies.length
	if (settledAnomalies > 0) {
		const escalated = anomalies.filter((item) => item?.status === 'escalated').length
		push(tr(`- 已处理的未解释:${settledAnomalies} 条${escalated > 0 ? `(${escalated} 条交给人)` : ''},结案时随交付交给评估者`, `- Unexplained items handled: ${settledAnomalies}${escalated > 0 ? ` (${escalated} handed to a person)` : ''}; they go to the evaluator with the delivery`), 2)
	}
	if (evidence.length > 0) {
		const last = evidence[evidence.length - 1]
		const who = last.evaluator === 'independent' ? LEVEL_WORD.L3 : LEVEL_WORD[last.level] ?? tr('自己判的', 'self-judged')
		const target = last.hypothesis === null || last.hypothesis === undefined ? tr('目标判据', 'goal criteria') : nameOf(last.hypothesis)
		push(tr(`- 最近一次结果:${target}${VERDICT_WORD[last.verdict] ?? last.verdict}(${who})`, `- Latest result: ${target} ${VERDICT_WORD[last.verdict] ?? last.verdict} (${who})`), 1)
	}
	/**
	 * **经验**:以前结案时核过的「下次怎么做」。只在要做决定的时候摆出来:立题前、定计划前、
	 * 下一步动手而还没写预期时。与眼下目标和下一步提到同一装置或量的排在前面。
	 */
	const lessonRows = Array.isArray(derived?.lessonRows) ? derived.lessonRows : []
	const nextStep = plan === null ? null : (plan.steps.find((step) => step.status === 'open') ?? null)
	const deciding = goal === null || String(goal.status) !== 'open' || plan === null || (nextStep !== null && (typeof nextStep.expect !== 'string' || nextStep.expect === ''))
	if (lessonRows.length > 0 && deciding) {
		const context = `${goal?.claim ?? ''}\n${nextStep?.do ?? ''}`.toLowerCase()
		const score = (lesson) => (lesson.about ?? []).filter((item) => item !== '' && context.includes(String(item).toLowerCase())).length
		const ranked = lessonRows.map((lesson, index) => ({ lesson, index, score: score(lesson) })).sort((a, b) => b.score - a.score || a.index - b.index)
		const kindWord = { trap: tr('常见误区', 'common pitfall'), check: tr('前置核查', 'check first'), shortcut: tr('不可取的捷径', 'misleading shortcut'), prior: tr('先验知识', 'prior') }
		push(tr(`- 以前留下的经验(${lessonRows.length} 条;制定计划、写预测前先阅读,引用时在预测中注明来自哪条):`, `- Lessons left earlier (${lessonRows.length}; read before planning or writing an expectation, and name the one you use in the expectation):`), 1)
		for (const { lesson } of ranked.slice(0, 6)) push(`  · ${lesson.id} · ${kindWord[lesson.kind] ?? lesson.kind} · ${clamp(lesson.text, 160)}${lesson.boundary ? tr(`(不适用:${clamp(lesson.boundary, 80)})`, ` (does not apply: ${clamp(lesson.boundary, 80)})`) : ''}`, 1)
		if (lessonRows.length > 6) push(tr(`  · 还有 ${lessonRows.length - 6} 条(clear/knowledge/lessons/)`, `  · ${lessonRows.length - 6} more (clear/knowledge/lessons/)`), 2)
	}
	/** 事实行含别的会话留下的(`foreign`):攒下来的东西从这里开始被看见。 */
	const factRows = Array.isArray(derived?.factRows) ? derived.factRows : facts
	if (factRows.length > 0) {
		const foreign = factRows.filter((fact) => fact?.foreign === true).length
		const changed = factRows.filter((fact) => Array.isArray(fact?.definitionsChanged) && fact.definitionsChanged.length > 0 && fact?.review?.decision !== 'retracted').length
		push(
			tr(
				`- 已写进长期知识:${factRows.length} 条${foreign > 0 ? `(${foreign} 条来自以前的会话)` : ''},总览在 clear/knowledge/facts/INDEX.md${changed > 0 ? `;其中 ${changed} 条用到的定义后来改过,需复核` : ''}`,
				`- In long-term knowledge: ${factRows.length}${foreign > 0 ? ` (${foreign} from earlier sessions)` : ''}, overview in clear/knowledge/facts/INDEX.md${changed > 0 ? `; ${changed} use definitions that changed since and need review` : ''}`,
			),
			1,
		)
	}
	/**
	 * **立题之前**(或上一个目标已结):以前留下的事实原话与边界直接摆出来(最多 5 条)。立题是最该看已知的时刻,
	 * 这时还没有判断可以拿来做词面命中,所以按新近给。
	 */
	if (goal === null || String(goal.status) !== 'open') {
		const usable = factRows.filter((fact) => fact?.review?.decision !== 'retracted' && fact?.refuted !== true)
		if (usable.length > 0) {
			push(tr('- 以前留下的事实(立题前先看;要复检哪条,就在判断上写 retests,claim 照抄原话):', '- Facts left earlier (read before framing; to re-test one, put retests on a judgment with the original statement as the claim):'), 1)
			for (const fact of usable.slice(-5).reverse()) push(factLine(fact), 1)
		}
	}
	/**
	 * 本体提纲与计数不上卡(它从没改变过下一步):卡上只出现被判断引用到的本体项(见下面的预检)。
	 * 跨文件问题照旧报——那是要修的东西。
	 */
	const ontologyProblems = Array.isArray(state?.ontologyProblems) ? state.ontologyProblems : []
	if (ontologyProblems.length > 0) {
		push(tr(`- 本体文件有 ${ontologyProblems.length} 处问题(有问题的节点或关系没进图):`, `- Ontology files have ${ontologyProblems.length} problems (the affected nodes or relations stay off the graph):`), 1)
		for (const item of ontologyProblems.slice(0, 5)) push(`  · ${item.path}: ${clamp(item.detail, 160)}`, 1)
		if (ontologyProblems.length > 5) push(tr(`  · 还有 ${ontologyProblems.length - 5} 处(面板「本体」里有全部)`, `  · ${ontologyProblems.length - 5} more (all are in the Ontology pane)`), 2)
	} else if (issues.some((issue) => issue.severity === 'warning')) {
		const count = issues.filter((issue) => issue.severity === 'warning').length
		push(tr(`- 词汇里有 ${count} 处要看(引用了不存在的词,或绕成了环)`, `- The vocabulary has ${count} things to check (references to missing terms, or cycles)`), 1)
	}
	if (knowledge.mode === 'knowledge') {
		const preflight = view.deliver.preflight
		if (preflight !== null && (preflight.terms.length > 0 || preflight.predicates.length > 0 || preflight.facts.length > 0)) {
			/**
			 * **递原文,不递名单**:命中的概念给它的释义(度量就是口径),命中的事实给原话与边界。
			 * 只给名字,模型得自己去翻文件——真跑里它从不去翻,本体于是从没影响过一次判断。
			 */
			const more = (count) => (count > 0 ? tr(`(还有 ${count} 个)`, ` (${count} more)`) : '')
			const named = (entry) => (entry.label === entry.id ? entry.id : `${entry.label}(${entry.id})`)
			if (preflight.terms.length > 0) {
				push(tr(`- 这些判断用到的概念(释义就是口径,算法变了先改它)${more(preflight.termsTruncated)}:`, `- Concepts these judgments use (the gloss is the definition; if how it is computed changes, update it first)${more(preflight.termsTruncated)}:`), 1)
				for (const term of preflight.terms.slice(0, 4)) push(`  · ${named(term)}:${clamp(term.gloss, 100) || tr('(没写释义)', '(no gloss)')}${term.unit ? tr(`(单位 ${term.unit})`, ` (unit ${term.unit})`) : ''}`, 1)
			}
			/** 带形状或核对办法的关系逐条给(预期从这里来);其余只给名字。 */
			const SHAPE_WORD = { increasing: tr('单调升', 'increasing'), decreasing: tr('单调降', 'decreasing'), peak: tr('有峰', 'has a peak'), threshold: tr('有阈值', 'has a threshold'), coupled: tr('与别的量耦合', 'coupled with another quantity') }
			const telling = preflight.predicates.filter((predicate) => predicate.shape || predicate.check)
			const plain = preflight.predicates.filter((predicate) => !(predicate.shape || predicate.check))
			if (telling.length > 0) {
				push(tr('- 用到的关系(预测的来源):', '- Relations in use (expectations come from these):'), 1)
				for (const predicate of telling.slice(0, 4)) push(`  · ${named(predicate)}${predicate.shape ? tr(`:${SHAPE_WORD[predicate.shape] ?? predicate.shape}`, `: ${SHAPE_WORD[predicate.shape] ?? predicate.shape}`) : ''}${predicate.gloss ? tr(`(${clamp(predicate.gloss, 80)})`, ` (${clamp(predicate.gloss, 80)})`) : ''}${predicate.check ? tr(` · 读数这样核:${clamp(predicate.check, 80)}`, ` · check readings by: ${clamp(predicate.check, 80)}`) : ''}`, 1)
			}
			if (plain.length > 0) push(tr(`- 用到的关系:${plain.slice(0, 6).map(named).join('、')}${more(preflight.predicatesTruncated)}`, `- Relations in use: ${plain.slice(0, 6).map(named).join(', ')}${more(preflight.predicatesTruncated)}`), 2)
			if (preflight.facts.length > 0) {
				push(tr(`- 和这些判断有关的已知${more(preflight.factsTruncated)}(引用前看边界;要复检就在判断上写 retests):`, `- Known facts related to these judgments${more(preflight.factsTruncated)} (check the boundary before citing; to re-test, put retests on a judgment):`), 1)
				for (const fact of preflight.facts.slice(0, 3)) push(factLine(fact), 1)
			}
		}
		if (gaps.length === 0) push(tr('- 结构完整:判断都写成了断言、都检验过、主体都在实体图上', '- Structure complete: every judgment has assertions, has been tested, and its subjects are on the entity graph'))
		/** 缺口只给模型(人看不到):说清欠什么、下一步做什么,不写 code。 */
		/** 只有散文的判断不上卡(它是可选的加法,重复提醒从没改变过下一步);面板照旧列出。 */
		for (const gap of gaps.filter((item) => item.code !== 'prose_only_claims')) push(tr(`- 还欠的:${gap.detail} → ${gap.nextAction}`, `- Still owed: ${gap.detail} → ${gap.nextAction}`))
	}
	for (const conflict of conflicts.slice(0, 3)) {
		push(
			tr(
				`- **矛盾**(${conflict.subject} 的 ${conflict.predicate}):${conflict.sides.map((side) => `「${side.value}」`).join(' 对 ')}。系统不替你选:用证据推翻一边,或请人定。`,
				`- **Conflict** (${conflict.predicate} of ${conflict.subject}): ${conflict.sides.map((side) => `"${side.value}"`).join(' vs ')}. The system does not pick: refute one side with evidence, or ask a person.`,
			),
		)
	}
	if (conflicts.length > 3) push(tr(`- 还有 ${conflicts.length - 3} 处矛盾没展开(面板「本体」里有全部)`, `- ${conflicts.length - 3} more conflicts not shown (all are in the Ontology pane)`), 2)
	if (goal !== null && Array.isArray(goal.unjudged) && goal.unjudged.length > 0) push(tr(`- 结案时没检验过的判断:${goal.unjudged.map(nameOf).join('、')}`, `- Judgments never tested at close: ${goal.unjudged.map(nameOf).join(', ')}`))
	push(tr('- 进度和可信度由系统按证据算,你只能通过交付推进。对人说起时用短名和这里的词,不写编号。', '- Progress and trust are computed by the system from evidence; you move them only by delivering. When talking to people, use the short names and the words here, not ids.'))
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
			? tr('还没有立约:没有「怎样算完成」可算——Frame 要一份可核对的判据', 'Nothing framed yet: there is no "done when" to measure; Frame needs checkable criteria')
			: Array.isArray(goal.criteria) && goal.criteria.length > 0
				? tr(`${goal.criteria.length} 条:${clamp(goal.criteria.join(' / '), 140)}`, `${goal.criteria.length} criteria: ${clamp(goal.criteria.join(' / '), 140)}`)
				: clamp(String(goal.done_criteria ?? ''), 140) || GLOSSARY.done_criteria.plain
	const entityCounts = { registered: 0, promoted: 0, asserted: 0 }
	for (const node of entityNodes) if (entityCounts[node.source] !== undefined) entityCounts[node.source] += 1
	const preflight = isPlainObject(options?.preflight) ? options.preflight : null
	const view = {
		headline: {
			now: goal === null ? tr('还没有立目标(Frame 需要一份「怎样算回答了」的判据)', 'No goal yet (Frame needs criteria for "answered")') : clamp(goal.headline ?? goal.claim, 160),
			done: doneText,
			where:
				goal === null
					? tr('还没开始:立约之后才有进度可算', 'Not started: progress exists once the goal is framed')
					: tr(
							`${phasePlain(phase)} · 完成度 ${progress === null ? '无法计算' : `${Math.round(progress * 100)}%`}${live.length > 0 ? ` · ${live.length} 条判断验证中` : ''}${gaps.length > 0 ? ` · ${gaps.length} 条缺口` : ''}`,
							`${phasePlain(phase)} · completion ${progress === null ? 'not computable' : `${Math.round(progress * 100)}%`}${live.length > 0 ? ` · ${live.length} judgments under test` : ''}${gaps.length > 0 ? ` · ${gaps.length} gaps` : ''}`,
						),
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
			readings: (hypothesis.supportedLevel === null || hypothesis.supportedLevel === undefined) && (hypothesis.refutations ?? 0) === 0 && (hypothesis.inconclusive ?? 0) === 0 ? tr('未触及', 'untouched') : tr(`支持到 ${hypothesis.supportedLevel ?? '—'}`, `supported to ${hypothesis.supportedLevel ?? '—'}`),
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
			tr('进度、阶段、假设状态都是系统算出来的:模型不能声明它们,只能通过交付与裁决推进。', 'Progress, phase and judgment status are computed by the system: the model cannot declare them, only move them through delivery and verdicts.'),
			tr('冲突只暴露不裁决:系统不替你选哪一侧为真。', 'Conflicts are surfaced, not resolved: the system does not pick a side.'),
			tr('实体断言有出处但未经独立裁决:它进图,但还不是「已知」。', 'Entity assertions have a source but no independent verdict: they are on the graph but not yet "known".'),
			tr('读面降级(读不到会话 / 投影)时给的是空读数,不是「没有」——不要把读不到当成不存在。', 'When reads are degraded (no session or projection), the reading is empty, not "nothing": unreadable does not mean absent.'),
		],
		/** 术语表按此刻的语言取一份平的拷贝(表本身按读的那一刻取语言,投影要的是定下来的字)。 */
		glossary: JSON.parse(JSON.stringify(GLOSSARY)),
		levels: Object.fromEntries(LEVELS.map((level) => [level, JSON.parse(JSON.stringify(GLOSSARY[level]))])),
		card: '',
	}
	view.card = fitLines(cardLines(state, d, options, view), CARD_LIMIT)
	return view
}
