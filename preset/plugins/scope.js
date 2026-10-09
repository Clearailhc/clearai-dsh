/**
 * scope —— 知识的**适用范围**:它在什么条件下、什么取值范围内成立。
 *
 * 适用范围与推翻条件是两回事。推翻条件说「什么结果会推翻它」;适用范围说「它在哪里成立」
 * (产线、月份、批次、工况,以及变量的取值范围)。0.5.1 把两者写在同一格里,于是九月的数据
 * 撤回了一条在八月范围内成立的事实:系统分不清「换了范围」与「被推翻」。
 *
 * 形状(都可选):
 *   { conditions: { 维度: 值 }, ranges: { 量: [下限, 上限] }, note: 一句补充 }
 *
 * 这里只有纯函数:规整、合并、写成一行字、比较两份范围。内核与测试共用。
 */

const WIDTH = { key: 60, value: 80, note: 200 }
const MAX_ENTRIES = 12

/** 规整一份范围;什么都没有就返回 null(「范围未声明」)。 */
export function normalizeScope(raw) {
	if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return null
	const conditions = {}
	for (const [key, value] of Object.entries(raw.conditions ?? {}).slice(0, MAX_ENTRIES)) {
		const name = String(key ?? '').trim().slice(0, WIDTH.key)
		const text = String(value ?? '').trim().slice(0, WIDTH.value)
		if (name !== '' && text !== '') conditions[name] = text
	}
	const ranges = {}
	for (const [key, value] of Object.entries(raw.ranges ?? {}).slice(0, MAX_ENTRIES)) {
		const name = String(key ?? '').trim().slice(0, WIDTH.key)
		if (name === '' || !Array.isArray(value) || value.length !== 2) continue
		const [low, high] = value.map(Number)
		if (!Number.isFinite(low) || !Number.isFinite(high)) continue
		ranges[name] = low <= high ? [low, high] : [high, low]
	}
	const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, WIDTH.note) : ''
	if (Object.keys(conditions).length === 0 && Object.keys(ranges).length === 0 && note === '') return null
	return { conditions, ranges, ...(note === '' ? {} : { note }) }
}

/** 合并:`primary` 的条目覆盖 `fallback` 的同名条目(判断自己写的优先于目标的默认条件)。 */
export function mergeScope(primary, fallback) {
	const first = normalizeScope(primary)
	const second = normalizeScope(fallback)
	if (first === null) return second
	if (second === null) return first
	return normalizeScope({
		conditions: { ...second.conditions, ...first.conditions },
		ranges: { ...second.ranges, ...first.ranges },
		note: first.note ?? second.note,
	})
}

/** 写成一行给人和模型读;没有范围返回 null。 */
export function scopeText(raw, language = 'zh') {
	const scope = normalizeScope(raw)
	if (scope === null) return null
	const en = language === 'en'
	const parts = []
	const conditions = Object.entries(scope.conditions).map(([key, value]) => `${key}=${value}`)
	if (conditions.length > 0) parts.push(en ? `conditions ${conditions.join(', ')}` : `条件 ${conditions.join('、')}`)
	const ranges = Object.entries(scope.ranges).map(([key, [low, high]]) => `${key} ${low}–${high}`)
	if (ranges.length > 0) parts.push(en ? `ranges ${ranges.join(', ')}` : `取值 ${ranges.join('、')}`)
	if (scope.note !== undefined) parts.push(scope.note)
	return parts.join(en ? '; ' : ';')
}

const same = (left, right) => String(left).trim().toLowerCase() === String(right).trim().toLowerCase()

/**
 * 一条知识(`item`)放到当前情形(`current`)里还适用吗。
 *
 * 只做确定性的比对,不判断语义:
 *   · item 有某个条件维度,current 写了不同的值 → out_of_scope(超出范围);
 *   · item 有某个量的取值范围,current 的取值落在外面 → out_of_range(超出取值范围);
 *   · item 有某个维度或量,current 没写 → undeclared(条件未声明,不当作适用);
 *   · item 本身没有范围 → unscoped(范围未声明);
 *   · 其余 → applies(适用)。
 * 同时出现几种时取最强的一种(超出范围 > 超出取值范围 > 条件未声明)。
 */
export function compareScope(item, current) {
	const scope = normalizeScope(item)
	if (scope === null) return { verdict: 'unscoped', reasons: [] }
	const here = normalizeScope(current) ?? { conditions: {}, ranges: {} }
	const outside = []
	const beyond = []
	const missing = []
	for (const [key, value] of Object.entries(scope.conditions)) {
		if (!(key in here.conditions)) missing.push(key)
		else if (!same(here.conditions[key], value)) outside.push({ key, expected: value, actual: here.conditions[key] })
	}
	for (const [key, [low, high]] of Object.entries(scope.ranges)) {
		if (!(key in here.ranges)) missing.push(key)
		else {
			const [from, to] = here.ranges[key]
			if (from < low || to > high) beyond.push({ key, expected: [low, high], actual: [from, to] })
		}
	}
	if (outside.length > 0) return { verdict: 'out_of_scope', reasons: outside }
	if (beyond.length > 0) return { verdict: 'out_of_range', reasons: beyond }
	if (missing.length > 0) return { verdict: 'undeclared', reasons: missing.map((key) => ({ key })) }
	return { verdict: 'applies', reasons: [] }
}

/** 比较结果写成一句话。 */
export function scopeVerdictText(result, language = 'zh') {
	const en = language === 'en'
	const reasons = Array.isArray(result?.reasons) ? result.reasons : []
	switch (result?.verdict) {
		case 'out_of_scope':
			return en
				? `out of scope (${reasons.map((item) => `${item.key}: holds for ${item.expected}, here ${item.actual}`).join('; ')})`
				: `超出范围(${reasons.map((item) => `${item.key}:原范围为 ${item.expected},本次为 ${item.actual}`).join(';')})`
		case 'out_of_range':
			return en
				? `out of range (${reasons.map((item) => `${item.key}: holds for ${item.expected.join('–')}, here ${item.actual.join('–')}`).join('; ')})`
				: `超出取值范围(${reasons.map((item) => `${item.key}:原范围为 ${item.expected.join('–')},本次为 ${item.actual.join('–')}`).join(';')})`
		case 'undeclared':
			return en ? `conditions not declared here (${reasons.map((item) => item.key).join(', ')})` : `条件未声明(本次未写明 ${reasons.map((item) => item.key).join('、')})`
		case 'unscoped':
			return en ? 'scope not declared' : '范围未声明'
		default:
			return en ? 'applies' : '适用'
	}
}
