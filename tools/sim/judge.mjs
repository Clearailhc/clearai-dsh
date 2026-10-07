/**
 * 判一场模拟运行:读 `<运行目录>/events.jsonl`,用与长测**同一个**判官(`evaluateLog`:
 * 跨机制不变量 + 剧本断言)重放判分,结果写进 `<运行目录>/result.json`。
 *
 *   node tools/sim/judge.mjs <运行目录> <剧本名>
 *
 * 判官不碰模拟宿主的内存:它只读日志与工作区——同一份日志换台机器重判,结论一样。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MUTATION_KIND } from '../../ui/lib/fold.js'
import { SCENARIOS, evaluateLog } from '../e2e-scenarios.mjs'
import { LONG_HORIZON } from './long-horizon/scenarios.mjs'
import { artifactExists } from '../e2e-workspace.mjs'

const [runArg, scenarioName] = process.argv.slice(2)
if (runArg === undefined || scenarioName === undefined) {
	console.error('用法:node tools/sim/judge.mjs <运行目录> <剧本名>')
	process.exit(2)
}
const runDir = resolve(runArg)
const scenario = SCENARIOS[scenarioName] ?? LONG_HORIZON[scenarioName]
if (scenario === undefined) {
	console.error(`没有这个剧本:${scenarioName}`)
	process.exit(2)
}
const workspace = String(JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')).workspace)
const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
	.split('\n')
	.filter((line) => line.trim() !== '')
	.map((line) => JSON.parse(line))
/** 变更有两条通道:工具结果的 meta,与回合之间注入消息里的 `clearai/mutations` 段(例如拦在命令上的放行)。 */
const noticeMutations = (event) => {
	const section = (event.data?.source?.sections ?? []).find((item) => item?.name === 'clearai/mutations')
	if (section === undefined) return []
	try {
		return JSON.parse(section.text).mutations ?? []
	} catch {
		return []
	}
}
const mutations = events.flatMap((event) => (event.type === 'tool/result' && event.data?.meta?.kind === MUTATION_KIND ? event.data.meta.mutations ?? [] : event.type === 'user/message' ? noticeMutations(event) : []))
const toolCalls = events.filter((event) => event.type === 'tool/call')

const evaluated = await evaluateLog({
	scenario,
	events,
	mutations,
	workspace,
	exists: (rel) => artifactExists(workspace, rel),
	called: (name) => toolCalls.some((event) => event.data?.name === name),
})

const failedChecks = evaluated.checks.filter((check) => !check.ok)
const result = {
	scenario: scenarioName,
	judgedAt: new Date().toISOString(),
	toolCalls: toolCalls.length,
	toolHistogram: Object.fromEntries([...new Set(toolCalls.map((event) => event.data?.name))].map((name) => [name, toolCalls.filter((event) => event.data?.name === name).length])),
	mutationHistogram: evaluated.stats.histogram,
	goalStatus: evaluated.stats.goalStatus,
	projectedSteps: evaluated.stats.projectedSteps,
	openSteps: evaluated.stats.openSteps,
	passed: evaluated.checks.length - failedChecks.length,
	failed: failedChecks.length,
	checks: evaluated.checks,
}
writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 2))

console.log(`【${scenarioName} · ${scenario.title}】`)
console.log(`  工具调用 ${toolCalls.length} 次:${Object.entries(result.toolHistogram).map(([name, count]) => `${name}×${count}`).join(' ')}`)
console.log(`  变更:${result.mutationHistogram || '(空)'}`)
console.log(`  目标:${result.goalStatus} · 计划 ${result.projectedSteps} 步 · 未落定 ${result.openSteps.join(',') || '(无)'}`)
for (const check of evaluated.checks) console.log(`  ${check.ok ? '✓' : '✗'} [${check.kind === 'invariant' ? '不变量' : '剧本'}] ${check.label}${check.ok || check.detail === '' ? '' : ` — ${check.detail}`}`)
console.log(`  结果:${result.passed} 通过,${result.failed} 失败`)
