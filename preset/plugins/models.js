/**
 * models —— 可重跑的核算:登记、判断要不要重跑、比对前后两次的输出。
 *
 * 模型把可复用的计算登记成 `clear/models/<id>.json`(这一格归模型,内核只读):
 *   `command`  在工作区里跑的命令;
 *   `inputs`   它读的数据文件(相对路径);任一内容摘要改变,引用时就重跑;
 *   `output`   它写出的 JSON(顶层的数值字段参与比对);
 *   `tolerance` 允许的偏差:一个数(所有字段共用)或按字段给;
 *   `baseline` 可选:建立结论时输出;接受时固化到事实的 calculation,观测不覆盖它。
 * 判断用 `use` 指向它,升格时随事实写进文件。下一次有判断引用这条事实、而输入变了,
 * 系统先重跑:偏差超出容差,事实就判为待核验并登记一条未解释项——反常不依赖模型自己留意。
 *
 * 运行记录归系统,写在 `clear/evidence/models/<id>.json`。这里只有纯函数,内核与测试共用。
 */

export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/
const RUNS_KEPT = 10

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value) => typeof value === 'number' && Number.isFinite(value)

/** 登记文件的问题(空数组 = 可用)。 */
export function checkModelSpec(data, id) {
	const problems = []
	if (!isPlainObject(data)) return ['不是 JSON 对象']
	if (typeof data.command !== 'string' || data.command.trim() === '') problems.push('要有 command(在工作区里运行的命令)')
	if (!Array.isArray(data.inputs) || data.inputs.length === 0 || data.inputs.some((item) => typeof item !== 'string' || item.trim() === '')) problems.push('要有 inputs(读的数据文件,相对路径的数组)')
	if (typeof data.output !== 'string' || data.output.trim() === '') problems.push('要有 output(命令写出的 JSON 路径)')
	const tolerance = data.tolerance
	if (!(finite(tolerance) && tolerance >= 0) && !(isPlainObject(tolerance) && Object.values(tolerance).every((value) => finite(value) && value >= 0))) problems.push('要有 tolerance(非负数,或按字段给的非负数)')
	if (data.baseline !== undefined && !isPlainObject(data.baseline)) problems.push('baseline 只能是对象(字段 → 数值)')
	if (data.scripts !== undefined && (!Array.isArray(data.scripts) || data.scripts.some((path) => typeof path !== 'string' || !path.trim()))) problems.push('scripts 要是脚本路径数组')
	if (data.id !== undefined && data.id !== id) problems.push(`id 要与文件名相同(${id})`)
	return problems
}

/** 输出 JSON 的数值字段(只取顶层;嵌套与非数值不比)。 */
export function numericOutputs(data) {
	const out = {}
	if (!isPlainObject(data)) return out
	for (const [key, value] of Object.entries(data)) if (finite(value)) out[key] = value
	return out
}

/** 要不要重跑:从没跑过,或任一输入文件的内容摘要与上次运行时不同。 */
export function needsRerun(lastRun, stamp) {
	if (!isPlainObject(lastRun) || !isPlainObject(lastRun.inputs)) return true
	if (Object.keys(lastRun.inputs).length !== Object.keys(stamp).length) return true
	return Object.entries(stamp).some(([path, digest]) => lastRun.inputs[path] !== digest)
}

/** 前后两次输出的偏差:超出容差的字段,以及上次有、这次没有的字段。 */
export function compareOutputs(reference, current, tolerance) {
	const deviations = []
	if (!isPlainObject(reference)) return deviations
	for (const [key, before] of Object.entries(reference)) {
		if (!finite(before)) continue
		const limit = finite(tolerance) ? tolerance : isPlainObject(tolerance) && finite(tolerance[key]) ? tolerance[key] : 0
		const after = current[key]
		if (!finite(after)) deviations.push({ key, before, after: null, limit })
		else if (Math.abs(after - before) > limit) deviations.push({ key, before, after, limit })
	}
	return deviations
}

/** 运行记录加一次(只留最近几次)。 */
export function appendRun(record, run) {
	const runs = Array.isArray(record?.runs) ? record.runs : []
	return { runs: [...runs, run].slice(-RUNS_KEPT) }
}

/** 偏差的一行读法。 */
export function deviationText(deviations, lang = 'zh') {
	return deviations
		.map((item) => (item.after === null ? (lang === 'zh' ? `${item.key} 这次没有输出(上次 ${item.before})` : `${item.key} missing this time (was ${item.before})`) : lang === 'zh' ? `${item.key} ${item.before} → ${item.after}(容差 ${item.limit})` : `${item.key} ${item.before} → ${item.after} (tolerance ${item.limit})`))
		.join(lang === 'zh' ? ';' : '; ')
}
