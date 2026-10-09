/**
 * knowledge-items —— 负向知识条目:从账本生成「已排除」「未解」「缺陷」三类条目。
 *
 * 正向知识(事实、经验)要过独立评估才写;负向知识在发生的那一刻就该落盘:判断被证据推翻、
 * 反常被登记或被解释为测量缺陷。会话因预算或 token 限制中断时,这些信息往往是失败里最有价值的部分,
 * 只在结案时写就会丢。所以这里从**当前状态**(折好的账本加派生读数)算出全部负向条目,
 * 内核每一拍按文件内容比对后落盘(`clear/knowledge/negatives/<id>.json`)。
 *
 * 条目与取用同形:`about` 写涉及的实体或量(文件查找的入口),`scope` 写适用范围,
 * 下一次引用时据此判断是否适用。
 *
 * 只有纯函数,内核与测试共用。
 */

import { mergeScope } from './scope.js'

const WIDTH = { about: 80, statement: 400, reason: 600, basis: 300 }
const MAX_ABOUT = 12

/** 文件名里只留字母、数字、下划线与短横(评估者登记的未解释项 id 带 `#`)。 */
export function itemFileId(id) {
	return String(id ?? '')
		.replace(/[^A-Za-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
}

/** 合并若干个 `about` 来源:去空、去重、截长。 */
export function mergeAbout(...lists) {
	const out = []
	for (const list of lists) {
		for (const raw of Array.isArray(list) ? list : typeof list === 'string' ? [list] : []) {
			const text = String(raw ?? '').trim().slice(0, WIDTH.about)
			if (text !== '' && !out.includes(text)) out.push(text)
			if (out.length >= MAX_ABOUT) return out
		}
	}
	return out
}

/**
 * 排除的强度:有独立核验或人给出的推翻、或自行检验推翻过两次及以上 → 已排除;
 * 只有一次自行检验 → 初步排除。初步排除不阻止重新检验,只提示「曾经排除过,依据较弱」。
 */
export function exclusionStrength(refutations) {
	const rows = Array.isArray(refutations) ? refutations : []
	const independent = rows.filter((item) => item?.evaluator === 'independent' || item?.evaluator === 'human').length
	const preliminary = independent === 0 && rows.length < 2
	return { count: rows.length, independent, preliminary }
}

/** 反常的去处 → 条目的状态。 */
const ANOMALY_STATUS = { open: 'unresolved', explained: 'explained', ruled_out: 'ruled_out', escalated: 'escalated' }

/**
 * 从状态算出全部负向条目(本会话的)。
 *
 * - 已排除:被证据推翻的判断(复检旧事实的判断除外——那条走事实自己的撤回或维持);
 * - 未解 / 缺陷:登记的未解释项(评估者判为不影响结论的除外),被解释为测量或方法缺陷的记为缺陷。
 *
 * `derived` 给出带推翻计数的判断(fold 的 `derive`);没有就按状态里的证据现算。
 */
export function negativeItems(state, derived = null, { session = null } = {}) {
	const goal = state?.goal ?? null
	const conditions = goal?.conditions ?? {}
	const goalAbout = goal?.about ?? []
	const evidence = Array.isArray(state?.evidence) ? state.evidence : []
	const hypotheses = Array.isArray(derived?.hypotheses) ? derived.hypotheses : Array.isArray(state?.hypotheses) ? state.hypotheses : []
	const items = []

	for (const hypothesis of hypotheses) {
		if (typeof hypothesis?.retests === 'string' && hypothesis.retests !== '') continue
		if (hypothesis?.status === 'retracted') continue
		const refutations = evidence.filter((item) => item?.hypothesis === hypothesis.id && item?.verdict === 'refute')
		if (refutations.length === 0) continue
		const strength = exclusionStrength(refutations)
		const sameGoal = goal !== null && hypothesis.goal === goal.id
		items.push({
			id: itemFileId(`x-${hypothesis.id}`),
			kind: 'excluded',
			status: strength.preliminary ? 'preliminary_excluded' : 'excluded',
			statement: String(hypothesis.claim ?? '').slice(0, WIDTH.statement),
			about: mergeAbout(hypothesis.about, sameGoal ? goalAbout : []),
			scope: mergeScope(hypothesis.scope, { conditions: sameGoal ? conditions : {} }),
			strength,
			evidence: refutations.map((item) => ({ id: item.id, level: item.level ?? null, evaluator: item.evaluator ?? null, basis: String(item.basis ?? '').slice(0, WIDTH.basis) })),
			source: { session, goal: hypothesis.goal ?? null, hypothesis: hypothesis.id },
		})
	}

	for (const anomaly of Array.isArray(state?.anomalies) ? state.anomalies : []) {
		if (anomaly?.by === 'evaluator' && anomaly?.matters === 'no') continue
		const what = String(anomaly?.what ?? '').trim()
		if (what === '') continue
		const defect = anomaly.status === 'explained' && anomaly.defect === true
		items.push({
			id: itemFileId(`n-${anomaly.id}`),
			kind: defect ? 'defect' : 'unresolved',
			status: defect ? 'defect' : (ANOMALY_STATUS[anomaly.status] ?? 'unresolved'),
			statement: what.slice(0, WIDTH.statement),
			about: mergeAbout(anomaly.anchor, anomaly.touches, goalAbout),
			scope: mergeScope({ conditions }, null),
			...(anomaly.status !== 'open' ? { resolution: { outcome: anomaly.status, reason: String(anomaly.reason ?? '').slice(0, WIDTH.reason), by: anomaly.explainedBy ?? null } } : {}),
			source: { session, goal: goal?.id ?? null, anomaly: anomaly.id, by: anomaly.by ?? 'model' },
		})
	}
	return items
}
