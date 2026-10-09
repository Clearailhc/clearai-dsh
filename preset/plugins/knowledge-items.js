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

import { compareScope, mergeScope } from './scope.js'

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

// ═══ 取用:立题时的定位与引用时的适用性判定 ═══════════════════════════════════════

/** 名称比对用的规整:去空白、短横、下划线,小写。 */
export function nameKey(raw) {
	return String(raw ?? '')
		.replace(/[\s_-]+/g, '')
		.toLowerCase()
}

/**
 * `about` 里的每个名字对到实体与概念上:
 * - 与某个实体或概念的 id、名称或别名完全相同 → 认作它(`match`);
 * - 否则,一方包含另一方(至少两个字符)→ 列为「可能是同一个」(`similar`),由模型确认;
 * - 都没有 → 新名字。
 */
export function resolveAbout(names, entries) {
	const known = (Array.isArray(entries) ? entries : [])
		.filter((entry) => typeof entry?.id === 'string' && entry.id !== '')
		.map((entry) => ({ id: entry.id, keys: [entry.id, entry.label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].map(nameKey).filter((key) => key.length >= 2) }))
	return mergeAbout(names).map((name) => {
		const key = nameKey(name)
		const exact = known.find((entry) => entry.keys.includes(key))
		if (exact !== undefined) return { name, match: exact.id, similar: [] }
		const similar = key.length < 2 ? [] : known.filter((entry) => entry.keys.some((other) => other.includes(key) || key.includes(other))).map((entry) => entry.id)
		return { name, match: null, similar: [...new Set(similar)].slice(0, 3) }
	})
}

/**
 * 与 `about` 相关的已有条目:只数数、给位置,不给内容(内容由模型用文件查找去读)。
 * `rows` 是 `{kind: 'fact'|'lesson'|'negative', status, about, path}` 的列表。
 */
export function relatedKnowledge(rows, aboutIds) {
	const keys = new Set(mergeAbout(aboutIds).map(nameKey))
	const counts = {}
	const dirs = new Set()
	let total = 0
	if (keys.size === 0) return { total, counts, dirs: [] }
	for (const row of Array.isArray(rows) ? rows : []) {
		if (!(Array.isArray(row?.about) ? row.about : []).some((name) => keys.has(nameKey(name)))) continue
		total += 1
		const bucket = `${row.kind}:${row.status ?? ''}`
		counts[bucket] = (counts[bucket] ?? 0) + 1
		if (typeof row.path === 'string' && row.path.includes('/')) dirs.add(row.path.slice(0, row.path.lastIndexOf('/') + 1))
	}
	return { total, counts, dirs: [...dirs].sort() }
}

/**
 * 引用一条已有条目时,它放到这次的情形里还适用吗。先看条目自己的状态,再比范围:
 *   已撤回 → retracted;口径(用到的定义)变了 → definition_changed;有推翻证据或开着的疑问 → pending;
 *   否则按适用范围比:applies / out_of_scope / out_of_range / undeclared / unscoped(见 `compareScope`)。
 * 负向条目另带它自己的种类与状态(已排除、未解、缺陷)。
 */
export function citeVerdict(row, current) {
	if (row === null || row === undefined) return { verdict: 'unknown', reasons: [] }
	if (row.kind === 'fact') {
		if (row.review?.decision === 'retracted') return { verdict: 'retracted', reasons: [] }
		if (Array.isArray(row.definitionsChanged) && row.definitionsChanged.length > 0) return { verdict: 'definition_changed', reasons: row.definitionsChanged.map((key) => ({ key })) }
		if ((row.refuted === true && row.review === null) || (Array.isArray(row.questioned) && row.questioned.length > 0)) return { verdict: 'pending', reasons: [] }
	}
	return compareScope(row.scope_spec ?? null, current)
}
