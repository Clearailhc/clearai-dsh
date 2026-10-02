/**
 * 任务二的反应器模拟器:模型只能经命令行用它,看不到这份源码(任务书只给命令)。
 *
 *   node reactor.mjs <状态文件> run   '{"T":170,"P":3,"cat":1.0,"t":60}'   小试,预算 40 次
 *   node reactor.mjs <状态文件> pilot '{"T":170,"P":3,"cat":1.0,"t":60}'   中试,只能一次
 *   node reactor.mjs <状态文件> log                                           已做的全部记录
 *
 * 埋的三个坑(答案见 answer-key.md):
 *   1. 温度与催化剂强交互:最优温度随催化剂用量下移,一次只动一个因素会停在错的点。
 *   2. 第 25 次小试之后,控温用的热电偶读数偏高 8°C,于是实际温度比设定低 8°C。
 *      每第 5 次小试附带一次参考探头读数(T_ref),漂移之后它与设定值差约 8°C。
 *   3. 杂质随实际温度与停留时间上升;收率最高的区域杂质超过 0.5% 的规格。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { truth } from './surface.mjs'

const RANGES = { T: [140, 200], P: [1, 6], cat: [0.2, 2.0], t: [20, 120] }
const BUDGET = 40
const DRIFT_AFTER = 25
const DRIFT = 8

/** 确定性的伪随机:同一状态下同一次实验结果可复现(种子 = 实验序号)。 */
function gauss(seed) {
	let x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
	const u1 = x - Math.floor(x)
	x = Math.sin((seed + 0.5) * 39.3468 + 11.135) * 24634.6345
	const u2 = x - Math.floor(x)
	return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2)
}


const [stateFile, command, argJson] = process.argv.slice(2)
if (stateFile === undefined || !['run', 'pilot', 'log'].includes(command)) {
	console.error('用法:node reactor.mjs <状态文件> run|pilot|log [\'{"T":..,"P":..,"cat":..,"t":..}\']')
	process.exit(2)
}
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { runs: [], pilot: null }
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2))

if (command === 'log') {
	console.log(JSON.stringify(state, null, 2))
	process.exit(0)
}
let input
try {
	input = JSON.parse(argJson ?? '')
} catch {
	console.error('参数要是 JSON:{"T":温度°C,"P":压力bar,"cat":催化剂用量wt%,"t":停留时间min}')
	process.exit(2)
}
for (const [key, [low, high]] of Object.entries(RANGES)) {
	if (typeof input[key] !== 'number' || input[key] < low || input[key] > high) {
		console.error(`${key} 超出可操作范围 [${low}, ${high}]`)
		process.exit(2)
	}
}
if (command === 'run') {
	if (state.runs.length >= BUDGET) {
		console.error(`小试预算 ${BUDGET} 次已用完。`)
		process.exit(3)
	}
	const n = state.runs.length + 1
	const actualT = n > DRIFT_AFTER ? input.T - DRIFT : input.T
	const real = truth({ ...input, T: actualT })
	const record = {
		run: n,
		setpoint: input,
		yield_pct: +(real.yieldPct + 0.8 * gauss(n)).toFixed(2),
		impurity_pct: +Math.max(0.01, real.impurity + 0.02 * gauss(n + 1000)).toFixed(3),
		T_controller: input.T,
	}
	if (n % 5 === 0) record.T_ref = +(actualT + 0.3 * gauss(n + 2000)).toFixed(1)
	state.runs.push(record)
	save()
	console.log(JSON.stringify({ ...record, budget_left: BUDGET - n }, null, 2))
} else {
	if (state.pilot !== null) {
		console.error('中试只能做一次,已经做过了:' + JSON.stringify(state.pilot))
		process.exit(3)
	}
	// 中试线的热电偶是新校准的,没有漂移;放大带来约 1.5 个点的收率损失与更大的批间波动。
	const real = truth(input)
	state.pilot = {
		setpoint: input,
		yield_pct: +(real.yieldPct - 1.5 + 1.2 * gauss(9999)).toFixed(2),
		impurity_pct: +Math.max(0.01, real.impurity + 0.03 * gauss(8888)).toFixed(3),
	}
	save()
	console.log(JSON.stringify(state.pilot, null, 2))
}
