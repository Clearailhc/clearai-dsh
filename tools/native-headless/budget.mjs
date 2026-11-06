import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

// Official peak USD rates checked 2026-11-06. Reserve a full 1M prompt plus
// 384K output for every request; disable adapter retries in the test profile.
export const PRICE = Object.freeze({ input: 0.3, cached: 0.006, output: 1.2, source: 'https://api-docs.deepseek.com/quick_start/pricing/', checked: '2026-11-06' })
export const REQUEST_RESERVE = 0.8
export function initializeBudget(file) {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, JSON.stringify({ version: 2, limitUsd: 30, testLimitUsd: 5, price: PRICE, requests: {} }), { flag: 'wx', mode: 0o600 })
}
export function campaignBudget(file) {
	if (!file || !existsSync(file)) throw new Error('Initialize CLEARAI_TEST_BUDGET_FILE before any paid run')
	const transact = operation => {
		const lock = file + '.lock'; mkdirSync(lock)
		try {
			const data = JSON.parse(readFileSync(file))
			if (data.version !== 2 || data.limitUsd !== 30 || data.testLimitUsd !== 5 || JSON.stringify(data.price) !== JSON.stringify(PRICE)) throw new Error('Budget policy mismatch')
			const result = operation(data), temporary = file + '.' + randomUUID()
			writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 }); renameSync(temporary, file)
			return result
		} finally { rmSync(lock, { recursive: true, force: true }) }
	}
	return {
		reserve(meta = {}) { return transact(data => {
			if (typeof meta.testId !== 'string' || !meta.testId.trim()) throw new Error('Stable testId required for per-test budget')
			if (Object.values(data.requests).some(row => row.status === 'unknown')) throw new Error('Unverifiable paid usage: campaign stopped')
			const used = Object.values(data.requests).reduce((sum, row) => sum + row.reservedUsd, 0)
			if (used + REQUEST_RESERVE > data.limitUsd) throw new Error('Campaign budget exhausted')
			const testUsed = Object.values(data.requests).filter(row => row.testId === meta.testId).reduce((sum, row) => sum + row.reservedUsd, 0)
			if (testUsed + REQUEST_RESERVE > data.testLimitUsd) throw new Error('Per-test budget exhausted')
			const id = randomUUID(); data.requests[id] = { ...meta, startedAt: Date.now(), reservedUsd: REQUEST_RESERVE, status: 'pending' }; return id
		}) },
		settle(id, usage) { return transact(data => {
			const row = data.requests[id]; if (!row || row.status !== 'pending') throw new Error('Unknown or already settled request')
			if (!usage || ![usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0].every(value => Number.isFinite(value) && value >= 0)) { row.status = 'unknown'; return }
			const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
			const bound = (input * PRICE.input + usage.outputTokens * PRICE.output) / 1e6
			if (!Number.isFinite(bound) || bound < 0 || bound > REQUEST_RESERVE) { row.status = 'unknown'; row.error = 'Usage exceeded reserved model capacity'; return }
			Object.assign(row, { usage, status: 'verified', finishedAt: Date.now(), reservedUsd: bound, costUpperBoundUsd: bound })
		}) },
	}
}
