/**
 * FFD(首次适应降序)基线。
 *
 *   node ffd.mjs <实例文件.json>   → 每个实例的箱子数(JSON)
 */
import { readFileSync } from 'node:fs'

export function ffd(items, capacity) {
	const bins = []
	for (const item of [...items].sort((a, b) => b - a)) {
		const index = bins.findIndex((load) => load + item <= capacity)
		if (index === -1) bins.push(item)
		else bins[index] += item
	}
	return bins.length
}

if (process.argv[1] && process.argv[1].endsWith('ffd.mjs') && process.argv[2]) {
	const instances = JSON.parse(readFileSync(process.argv[2], 'utf8'))
	console.log(JSON.stringify(Object.fromEntries(instances.map((it) => [it.id, ffd(it.items, it.capacity)])), null, 1))
}
