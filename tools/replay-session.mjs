/**
 * 真实会话日志 → 投影重放器。
 *
 * 合成事件能证明逻辑,真实日志才能证明**事件形状**对得上。这个脚本把 DSH 的会话日志
 * (zstd 压缩的 JSONL)解出来,逐条喂给宿主半的 fold,再把结果与在线投影对照。
 *
 * 用法:node tools/replay-session.mjs <session 目录或 .jsonl.zstd 文件>
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { applyEvent, emptyState, renderCard, view } from '../ui/lib/fold.js'

const target = process.argv[2]
if (target === undefined) {
	console.error('用法:node replay-session.mjs <session 目录 | session.v3.jsonl.zstd>')
	process.exit(2)
}

const file = statSync(target).isDirectory() ? join(target, readdirSync(target).find((name) => name.endsWith('.jsonl.zstd'))) : target

/**
 * 会话日志是**多帧拼接**的 zstd(每次 flush 一帧)。Node 的 `zstdDecompressSync` 与
 * `createZstdDecompress` 都只解第一帧(实测:10MB 的日志只解出 1 条事件),
 * 所以这里用系统的 zstd(它按帧迭代)。
 */
function decompress(path) {
	try {
		return execFileSync('zstd', ['-d', '-c', path], { maxBuffer: 1 << 30 }).toString('utf8')
	} catch (error) {
		throw new Error(`需要系统 zstd(或多帧解压能力):${String(error?.message ?? error)}`)
	}
}

const text = decompress(file)
const events = []
for (const line of text.split('\n')) {
	const trimmed = line.trim()
	if (trimmed === '') continue
	try {
		events.push(JSON.parse(trimmed))
	} catch {
		/* 坏行跳过:这里只做形状验证 */
	}
}

const kinds = new Map()
for (const event of events) kinds.set(event.type, (kinds.get(event.type) ?? 0) + 1)

const header = events.find((event) => event.type === 'session')
let state = header === undefined ? emptyState() : { ...emptyState(), sessionId: String(header.id) }
let surprising = 0
const notes = []
for (const event of events) {
	if (event.type === 'tool/call') {
		const args = event.data?.arguments
		if (args !== undefined && typeof args !== 'string' && typeof args !== 'object') {
			surprising += 1
			notes.push(`tool/call 的 arguments 形状意外:${typeof args}`)
		}
	}
	state = applyEvent(state, event)
}

const derived = view(state)
console.log(`日志:${file}`)
console.log(`事件:${events.length} 条`)
console.log(`类型:${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type}×${count}`).join(' · ')}`)
console.log('')
console.log('重放出的状态:')
console.log(`  goal=${state.goal === null ? 'none' : `${state.goal.id}(${state.goal.status})`} 假设=${state.hypotheses.length} 计划=${state.plans.length} 证据=${state.evidence.length} 世界线=${state.forks.length}`)
console.log(`  在飞=${state.inFlight === null ? 'no' : state.inFlight.name} 自写路径=${state.written.length} 材料=${state.materials.length}`)
console.log(`  wire 视图:sessionId=${String(derived.sessionId)} phase=${derived.goal === null ? '-' : derived.goal.phase}`)
console.log(`  运行态卡:${renderCard(state).length} 字节`)
console.log('')
console.log(`形状意外:${surprising}${notes.length > 0 ? ` — ${notes.slice(0, 3).join(' / ')}` : ''}`)
console.log(`折叠出的变更记录:${kinds.get('tool/result') ?? 0} 条工具结果中,带 clearai meta 的会被折进来(本会话预期 0:内核还没在跑)`)
