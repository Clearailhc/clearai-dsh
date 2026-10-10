import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
function rng(seed) { return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296 } }
const percentile = (values, p) => { const index = p * (values.length - 1), lo = Math.floor(index); return values[lo] + (values[Math.ceil(index)] - values[lo]) * (index - lo) }

// One row is a WHOLE paired four-task world, never four independent samples.
export function pairedAnalysis(pairs, { samples = 60000, seed = 52023 } = {}) {
	if (!pairs.length || pairs.some((row) => !['aQuality', 'cQuality', 'aExperiments', 'cExperiments'].every((key) => Number.isFinite(row[key])))) throw new Error('Complete paired world scores are required; failures must be recorded as zero/31/13')
	const effect = (rows) => ({ quality: mean(rows.map((row) => row.cQuality - row.aQuality)), savings: mean(rows.map((row) => row.aExperiments)) > 0 ? 1 - mean(rows.map((row) => row.cExperiments)) / mean(rows.map((row) => row.aExperiments)) : null })
	const point = effect(pairs), random = rng(seed), boot = { quality: [], savings: [] }
	for (let sample = 0; sample < samples; sample++) {
		const resampled = Array.from({ length: pairs.length }, () => pairs[Math.floor(random() * pairs.length)])
		const value = effect(resampled); boot.quality.push(value.quality); if (value.savings !== null) boot.savings.push(value.savings)
	}
	const ci = (values) => { values.sort((a, b) => a - b); return values.length ? [percentile(values, 0.0125), percentile(values, 0.9875)] : null }
	const intervals = { quality: pairs.length > 1 ? ci(boot.quality) : null, savings: pairs.length > 1 ? ci(boot.savings) : null }
	const decide = (value, interval, threshold) => value === null ? '证据不足' : value < threshold ? '未达到' : interval === null || interval[0] <= 0 ? '证据不足' : '达到'
	return { unit: 'paired-four-task-world', worlds: pairs.length, confidence: 0.975, bootstrap: { samples, seed }, point, intervals, verdicts: { sequenceQuality: decide(point.quality, intervals.quality, 0.5), experimentSavings: decide(point.savings, intervals.savings, 0.2) } }
}

export function sequenceCosts(tasks) {
	const second = tasks.find((row) => row.task === 't2'), fourth = tasks.find((row) => row.task === 't4')
	return { t2: second?.completed && Number.isInteger(second.firstQualifyingExperiment) ? second.firstQualifyingExperiment : 31, t4: fourth?.completed && fourth.correctDiagnosis ? fourth.totalExperiments : 13 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const data = JSON.parse(readFileSync(process.argv[2], 'utf8')), report = pairedAnalysis(data)
	writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n')
}
