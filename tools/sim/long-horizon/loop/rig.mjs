/**
 * 同一现场的小试装置:模型只能经命令行用它,看不到这份源码。
 *
 *   node rig.mjs <状态文件> run '{"T":..,...}'   小试,预算见各题(`budget`)
 *   node rig.mjs <状态文件> log                   已做的全部记录
 *
 * 状态文件第一次由剧本准备,写明是哪一题(`variant`)。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { VARIANTS } from './surface.mjs'

function gauss(seed) {
	let x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
	const u1 = x - Math.floor(x)
	x = Math.sin((seed + 0.5) * 39.3468 + 11.135) * 24634.6345
	const u2 = x - Math.floor(x)
	return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2)
}

const [stateFile, command, argJson] = process.argv.slice(2)
if (stateFile === undefined || !['run', 'log'].includes(command)) {
	console.error('用法:node rig.mjs <状态文件> run|log [\'{...}\']')
	process.exit(2)
}
const state = JSON.parse(readFileSync(stateFile, 'utf8'))
const variant = VARIANTS[state.variant]
const BUDGET = variant.budget
if (command === 'log') {
	console.log(JSON.stringify({ runs: state.runs }, null, 2))
	process.exit(0)
}
let input
try {
	input = JSON.parse(argJson ?? '')
} catch {
	console.error(`参数要是 JSON,各量:${Object.keys(variant.factors).join('、')}`)
	process.exit(2)
}
for (const [key, [low, high]] of Object.entries(variant.factors)) {
	if (typeof input[key] !== 'number' || input[key] < low || input[key] > high) {
		console.error(`${key} 超出可操作范围 [${low}, ${high}]`)
		process.exit(2)
	}
}
if (state.runs.length >= BUDGET) {
	console.error(`小试预算 ${BUDGET} 次已用完。`)
	process.exit(3)
}
const n = state.runs.length + 1
const actualT = n > variant.drift.after ? input.T - variant.drift.delta : input.T
const real = variant.truth({ ...input, T: actualT })
const seed = n + 100 * Object.keys(VARIANTS).indexOf(state.variant)
const record = {
	run: n,
	setpoint: Object.fromEntries(Object.keys(variant.factors).map((key) => [key, input[key]])),
	yield_pct: +(real.yieldPct + 0.7 * gauss(seed)).toFixed(2),
	impurity_pct: +Math.max(0.01, real.impurity + 0.015 * gauss(seed + 1000)).toFixed(3),
	T_controller: input.T,
}
if (n % variant.refEvery === 0) record.T_ref = +(actualT + 0.3 * gauss(seed + 2000)).toFixed(1)
state.runs.push(record)
writeFileSync(stateFile, JSON.stringify(state, null, 2))
console.log(JSON.stringify({ ...record, budget_left: BUDGET - n }, null, 2))
