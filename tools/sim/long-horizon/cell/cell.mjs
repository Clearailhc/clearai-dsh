/**
 * 任务六的电池测试台模拟器:模型只能经命令行用它,看不到这份源码(任务书只给命令)。
 *
 *   node cell.mjs <状态文件> quick '{"c":1.2,"a":1,"b":1,"Tf":40}'   快测:100 圈,花 1 个预算
 *   node cell.mjs <状态文件> long  '{"c":1.2,"a":1,"b":1,"Tf":40}'   长测:跑到 80%,花 8 个预算
 *   node cell.mjs <状态文件> log                                     已做的全部记录
 *
 * 埋的坑(答案见 answer-key.md):
 *   1. 快测给的「外推寿命」只看前 100 圈的线性衰减。添加剂 B 让线性衰减变慢,外推寿命一路上涨;
 *      但 B 多了会提前耗尽,第 100 圈之后出现拐点,真实寿命反而很短。快测看不到拐点。
 *   2. 只有 B 与 A 大致按 0.4 的比例搭配,拐点才会推后:A×B 强交互,一次只动一个量找不到。
 *   3. 快测里有一项早期征兆:第 100 圈的内阻增长。比例偏离越远、B 越多,它涨得越快。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { capacityAt, dcirRise, truth } from './surface.mjs'

const RANGES = { c: [0.8, 1.6], a: [0, 5], b: [0, 3], Tf: [25, 55] }
const BUDGET = 40
const COST = { quick: 1, long: 8 }

/** 确定性的伪随机:同一状态下同一次测试结果可复现(种子 = 测试序号)。 */
function gauss(seed) {
	let x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
	const u1 = x - Math.floor(x)
	x = Math.sin((seed + 0.5) * 39.3468 + 11.135) * 24634.6345
	const u2 = x - Math.floor(x)
	return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2)
}

const [stateFile, command, argJson] = process.argv.slice(2)
if (stateFile === undefined || !['quick', 'long', 'log'].includes(command)) {
	console.error('用法:node cell.mjs <状态文件> quick|long|log [\'{"c":..,"a":..,"b":..,"Tf":..}\']')
	process.exit(2)
}
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { tests: [], spent: 0 }
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2))

if (command === 'log') {
	console.log(JSON.stringify(state, null, 2))
	process.exit(0)
}
let input
try {
	input = JSON.parse(argJson ?? '')
} catch {
	console.error('参数要是 JSON:{"c":锂盐浓度 M,"a":添加剂A wt%,"b":添加剂B wt%,"Tf":化成温度 °C}')
	process.exit(2)
}
for (const [key, [low, high]] of Object.entries(RANGES)) {
	if (typeof input[key] !== 'number' || input[key] < low || input[key] > high) {
		console.error(`${key} 超出可配范围 [${low}, ${high}]`)
		process.exit(2)
	}
}
if (state.spent + COST[command] > BUDGET) {
	console.error(`预算不够:已花 ${state.spent},${command === 'long' ? '长测' : '快测'}要 ${COST[command]},总预算 ${BUDGET}。`)
	process.exit(3)
}
const n = state.tests.length + 1
state.spent += COST[command]
const recipe = { c: input.c, a: input.a, b: input.b, Tf: input.Tf }
if (command === 'quick') {
	const retention = capacityAt(input, 100) + 0.12 * gauss(n)
	const measuredRate = (100 - retention) / 100
	const record = {
		test: n,
		kind: 'quick',
		recipe,
		retention_100_pct: +retention.toFixed(2),
		dcir_rise_100_pct: +(dcirRise(input) + 0.8 * gauss(n + 500)).toFixed(1),
		extrapolated_life_cycles: Math.round(20 / measuredRate),
	}
	state.tests.push(record)
	save()
	console.log(JSON.stringify({ ...record, budget_left: BUDGET - state.spent }, null, 2))
} else {
	const real = truth(input)
	const scale = 1 + 0.03 * gauss(n + 1000)
	const checkpoints = {}
	for (let cycle = 200; cycle <= Math.min(real.life + 200, 3000); cycle += 200) checkpoints[cycle] = +Math.max(0, capacityAt(input, cycle / scale) + 0.15 * gauss(n * 31 + cycle)).toFixed(2)
	const record = { test: n, kind: 'long', recipe, life_cycles: Math.round(real.life * scale), retention_pct_at: checkpoints }
	state.tests.push(record)
	save()
	console.log(JSON.stringify({ ...record, budget_left: BUDGET - state.spent }, null, 2))
}

