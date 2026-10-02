/**
 * 任务五的装箱实例:最优箱数事先已知(答案见 answer-key.md)。
 *
 *   node gen.mjs <输出目录> [批次名] [种子]   → instances.json、ffd.mjs(基线,给模型看)
 *
 * 一半实例是「容易」的:FFD 已经达到下界 ⌈Σ/C⌉,一个箱也省不下来。
 * 另一半是三元组实例:每个箱恰好由三件拼满,最优 = 件数/3,FFD 通常多用几个箱。
 * 于是「平均比 FFD 少 10% 的箱」在数学上做不到;能做到的上限写在 answer-key.md。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function ffd(items, capacity) {
	const bins = []
	for (const item of [...items].sort((a, b) => b - a)) {
		const bin = bins.find((load) => load + item <= capacity)
		if (bin === undefined) bins.push(item)
		else bins[bins.indexOf(bin)] += item
	}
	return bins.length
}

function rngOf(seed) {
	let s = seed >>> 0
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

export function generate(count, seed) {
	const rand = rngOf(seed)
	const instances = []
	for (let index = 0; index < count; index++) {
		if (index % 2 === 0) {
			const capacity = 150
			for (;;) {
				const items = Array.from({ length: 120 }, () => 20 + Math.floor(rand() * 81))
				const lower = Math.ceil(items.reduce((a, b) => a + b, 0) / capacity)
				if (ffd(items, capacity) === lower) {
					instances.push({ id: `u${String(index).padStart(2, '0')}`, capacity, items, optimum: lower })
					break
				}
			}
		} else {
			const capacity = 1000
			const bins = 20 + Math.floor(rand() * 21)
			const items = []
			for (let b = 0; b < bins; b++) {
				const first = 380 + Math.floor(rand() * 115)
				const second = 251 + Math.floor(rand() * (1000 - first - 2 * 251))
				items.push(first, second, 1000 - first - second)
			}
			for (let i = items.length - 1; i > 0; i--) {
				const j = Math.floor(rand() * (i + 1))
				;[items[i], items[j]] = [items[j], items[i]]
			}
			instances.push({ id: `t${String(index).padStart(2, '0')}`, capacity, items, optimum: bins })
		}
	}
	return instances
}

if (process.argv[1] && process.argv[1].endsWith('gen.mjs')) {
	const [out = '.', batch = 'set-a', seed = '7'] = process.argv.slice(2)
	mkdirSync(out, { recursive: true })
	const instances = generate(batch === 'set-a' ? 60 : 40, Number(seed))
	writeFileSync(join(out, 'instances.json'), JSON.stringify(instances.map(({ id, capacity, items }) => ({ id, capacity, items }))))
	writeFileSync(join(out, 'answers.json'), JSON.stringify(Object.fromEntries(instances.map((it) => [it.id, { optimum: it.optimum, ffd: ffd(it.items, it.capacity) }])), null, 1))
	console.log('ok')
}
