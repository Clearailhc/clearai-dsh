/**
 * 离线复算:拿一份**已经跑过的**会话日志,重新判一遍。
 *
 * 为什么要有它:长测的结论必须可复核。判据(不变量 + 剧本断言)抽在
 * `tools/e2e-scenarios.mjs` 的 `evaluateLog()` 里,e2e-run 与它共用**同一份实现**——
 * 于是「跑一场」与「重判一场」永远不会漂移,别人也不必花 token 重跑就能检查我们的结论。
 *
 * 用法:
 *   node tools/e2e-replay.mjs --scenario scout-first \\
 *     --log ~/.dsh/sessions/<slug>/session-xxxx/session.v3.jsonl.zstd \\
 *     --workspace /var/folders/.../clearai-e2e-ws-XXXX
 *
 * `--workspace` 用来判「声明的物证真的在盘上」;不传就只判与文件无关的那些
 * (那时物证类断言会如实报缺,不会假装通过)。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { artifactExists, countMemoryEntries } from './e2e-workspace.mjs'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const argv = process.argv.slice(2)
const option = (flag) => {
	const index = argv.indexOf(flag)
	return index === -1 ? undefined : argv[index + 1]
}

const scenarioName = option('--scenario')
const logPath = option('--log')
const workspace = option('--workspace')
if (logPath === undefined) {
	console.error('用法:node tools/e2e-replay.mjs --scenario <name> --log <session.v3.jsonl.zstd> [--workspace <dir>]')
	process.exit(2)
}

const { SCENARIOS, evaluateLog } = await import(new URL('./e2e-scenarios.mjs', import.meta.url))
const scenario = scenarioName === undefined ? null : (SCENARIOS[scenarioName] ?? null)
if (scenarioName !== undefined && scenario === null) {
	console.error(`✗ 没有这个剧本:${scenarioName}\n  可选:${Object.keys(SCENARIOS).join(', ')}`)
	process.exit(2)
}

// zstd 是多帧的,node 自带的解压只吃第一帧——与 e2e-run 一样用系统 zstd。
const text = logPath.endsWith('.zstd') ? execFileSync('zstd', ['-d', '-c', logPath], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8') : readFileSync(logPath, 'utf8')
const events = text
	.split('\n')
	.filter((line) => line.trim() !== '')
	.map((line) => {
		try {
			return JSON.parse(line)
		} catch {
			return null
		}
	})
	.filter((event) => event !== null)
const toolCalls = events.filter((event) => event.type === 'tool/call')
const mutations = events.filter((event) => event.type === 'tool/result').flatMap((event) => event.data?.meta?.mutations ?? [])

const evaluated = await evaluateLog({
	scenario,
	events,
	mutations,
	workspace: workspace ?? '(未给)',
	exists: (rel) => (workspace === undefined ? false : artifactExists(workspace, rel)),
	memoryEntries: workspace === undefined ? 0 : countMemoryEntries(workspace),
	called: (name) => toolCalls.some((event) => event.data?.name === name),
})

console.log(`复算:${logPath}`)
console.log(`  事件 ${events.length} 条 · 变更 ${mutations.length} 条 · 直方图:${evaluated.stats.histogram || '(空)'}`)
console.log(`  投影:目标 ${evaluated.stats.goalStatus} · 计划 ${evaluated.stats.projectedSteps} 步 · 未落定 ${evaluated.stats.openSteps.join(',') || '(无)'}`)
if (workspace === undefined) console.log('  (没给 --workspace:物证类断言按「盘上找不到」判,别把它读成缺陷)')

let passed = 0
let failed = 0
for (const [title, kind] of [
	['跨机制不变量', 'invariant'],
	[scenario === null ? '剧本断言(未指定剧本)' : `剧本断言:${scenario.title}`, 'scenario'],
]) {
	const items = evaluated.checks.filter((entry) => entry.kind === kind)
	if (items.length === 0) continue
	console.log(`\n【${title}】`)
	for (const item of items) {
		if (item.ok) passed += 1
		else failed += 1
		console.log(`  ${item.ok ? '✓' : '✗'} ${item.label}${item.detail === '' ? '' : ` — ${item.detail}`}`)
	}
}
console.log(`\n结果:${passed} 通过,${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
