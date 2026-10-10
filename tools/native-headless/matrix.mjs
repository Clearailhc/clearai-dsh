/** New preregistration; historical Sonnet and RC.4 results are never inputs. */
export const MODEL = Object.freeze({ provider: 'abhome', model: 'deepseek-flash', reasoningEffort: 'medium' })
export const BUDGETS = Object.freeze({ complex: { tokenBudget: 1600000, timeoutMs: 5400000 }, direct: { tokenBudget: 240000, timeoutMs: 1200000 }, experiments: [30, 30, 30, 12], auditTimeoutMs: 240000 })
export const REQUIRED_GATES = Object.freeze(['suites', 'package', 'windows-node24-audit', 'native-lifecycle', 'native-ui', 'preset-and-model', 'isolation-probes', 'cancel', 'disconnect', 'audit-timeout', 'process-recovery', 'smoke-six'])
export function sessions() {
	const rows = []
	for (const group of ['A', 'C']) {
		for (const task of ['additive', 'interaction', 'direct']) rows.push({ stage: 'smoke', group, world: 'smoke-1', task, mode: task === 'direct' ? 'default' : group === 'C' ? 'clearai' : 'default' })
		for (const [stage, count, prefix] of [['development', 3, 'dev'], ['formal', 6, 'formal']]) for (let world = 1; world <= count; world++) for (let task = 1; task <= 4; task++) rows.push({ stage, group, world: `${prefix}-${world}`, task: `t${task}`, mode: group === 'C' ? 'clearai' : 'default' })
		for (let world = 1; world <= 3; world++) {
			for (let task = 1; task <= 3; task++) rows.push({ stage: 'supplemental', group, world: `factory-${world}`, task: `factory-t${task}`, mode: group === 'C' ? 'clearai' : 'default' })
			for (const task of ['additive', 'interaction', 'drift']) rows.push({ stage: 'supplemental', group, world: `${task}-${world}`, task, mode: group === 'C' ? 'clearai' : 'default' })
		}
	}
	for (const group of ['C-no-applicability', 'C-no-negative']) for (let world = 1; world <= 6; world++) for (let task = 1; task <= 4; task++) rows.push({ stage: 'ablation', group, world: `formal-${world}`, task: `t${task}`, mode: 'clearai' })
	return rows
}
export function assertGates(receipts) {
	const missing = REQUIRED_GATES.filter((gate) => receipts?.[gate]?.passed !== true || !receipts[gate].evidence)
	if (missing.length) throw new Error(`Long test remains gated: ${missing.join(', ')}`)
}
export function stopReasons(result) {
	const reasons = []
	if (result.usage?.status !== 'verified') reasons.push('unverifiable_usage')
	if (Object.keys(MODEL).some((key) => result.installation?.model?.[key] !== MODEL[key])) reasons.push('model_mismatch')
	for (const [key, flag] of Object.entries(result.violations ?? {})) if (flag) reasons.push(key)
	return reasons
}
