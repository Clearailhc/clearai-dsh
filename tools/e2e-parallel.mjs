/**
 * 并行长测驱动器:把若干剧本同时跑起来,各自落一份完整日志与一份汇总。
 *
 * 为什么要有它:长测一场就是几分钟起步,串行跑五个剧本等于把一下午花在等上。
 * 并行跑要防的不是 CPU,而是**模型的并发上限**——每场自己还会派世界线执行者与独立评估者,
 * 一场最坏能拉起三四条模型流。所以并发上限默认 3,并且如实记进汇总。
 *
 * 用法:
 *   node tools/e2e-parallel.mjs                                  # 全部剧本,并发 3
 *   node tools/e2e-parallel.mjs --scenarios long-plan,scout-first
 *   node tools/e2e-parallel.mjs --concurrency 1 --timeout-min 45
 *
 * 产物(gitignore 不覆盖,便于取证):
 *   docs/optimization/e2e-logs/<剧本>.log      每场完整 stdout
 *   docs/optimization/e2e-logs/summary.json    结构化汇总(含失败项与用时)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const argv = process.argv.slice(2)
const option = (flag, fallback) => {
	const index = argv.indexOf(flag)
	return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

const { SCENARIOS } = await import(new URL('./e2e-scenarios.mjs', import.meta.url))
const requested = option('--scenarios', Object.keys(SCENARIOS).join(','))
	.split(',')
	.map((name) => name.trim())
	.filter((name) => name !== '')
const unknown = requested.filter((name) => SCENARIOS[name] === undefined)
if (unknown.length > 0) {
	console.error(`✗ 不认识的剧本:${unknown.join(', ')}\n  可选:${Object.keys(SCENARIOS).join(', ')}`)
	process.exit(2)
}
const concurrency = Math.max(1, Number(option('--concurrency', '3')))
const timeoutMs = Math.max(1, Number(option('--timeout-min', '40'))) * 60 * 1000
const outDir = option('--out', join(PORT, 'docs', 'optimization', 'e2e-logs'))
mkdirSync(outDir, { recursive: true })

console.log(`并行长测:${requested.length} 个剧本 · 并发 ${concurrency} · 单场上限 ${timeoutMs / 60000} 分钟`)
console.log(`日志目录:${outDir}\n`)

/** 跑一个剧本:落日志、解析结论、收现场路径。 */
function runScenario(name) {
	return new Promise((resolve) => {
		const logPath = join(outDir, `${name}.log`)
		const started = Date.now()
		const child = spawn('node', [join(HERE, 'e2e-run.mjs'), '--scenario', name, '--keep'], {
			cwd: PORT,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let buffer = ''
		child.stdout.on('data', (chunk) => {
			buffer += chunk
		})
		child.stderr.on('data', (chunk) => {
			buffer += chunk
		})
		const timer = setTimeout(() => {
			child.kill('SIGKILL')
			buffer += `\n(超过 ${timeoutMs / 60000} 分钟上限,已杀)\n`
		}, timeoutMs)
		child.on('close', (code) => {
			clearTimeout(timer)
			writeFileSync(logPath, buffer, 'utf8')
			const elapsedSec = Math.round((Date.now() - started) / 1000)
			const line = buffer.match(/结果:(\d+) 通过,(\d+) 失败/)
			const failures = [...buffer.matchAll(/^ {2}- (.+)$/gm)].map((match) => match[1])
			const workspace = buffer.match(/保留现场:工作区 (\S+)/)?.[1] ?? null
			const sessionLog = buffer.match(/会话日志 (\S+)/)?.[1] ?? null
			const mutations = buffer.match(/变更记录:(\d+) 条\(([^)]*)\)/)
			resolve({
				name,
				title: SCENARIOS[name].title,
				code,
				passed: line === null ? 0 : Number(line[1]),
				failed: line === null ? -1 : Number(line[2]),
				failures,
				elapsedSec,
				logPath,
				workspace,
				sessionLog,
				mutationCount: mutations === null ? null : Number(mutations[1]),
				mutationKinds: mutations === null ? null : mutations[2],
				log: buffer,
			})
		})
	})
}

const results = []
let cursor = 0
const workers = Array.from({ length: Math.min(concurrency, requested.length) }, async () => {
	while (cursor < requested.length) {
		const name = requested[cursor]
		cursor += 1
		process.stdout.write(`▶ ${name} 开跑…\n`)
		const result = await runScenario(name)
		results.push(result)
		const verdict = result.failed === 0 ? '✓' : '✗'
		process.stdout.write(`${verdict} ${name} 完成:${result.passed} 通过,${result.failed} 失败 · ${result.elapsedSec}s\n`)
	}
})
await Promise.all(workers)

results.sort((a, b) => requested.indexOf(a.name) - requested.indexOf(b.name))
const summary = {
	at: new Date().toISOString(),
	concurrency,
	timeoutMin: timeoutMs / 60000,
	scenarios: results.map(({ log, ...rest }) => rest),
}
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

console.log('\n══ 汇总 ══')
for (const result of results) {
	const mark = result.failed === 0 ? '✓' : '✗'
	console.log(`${mark} ${result.name}(${result.title})`)
	console.log(`    ${result.passed} 通过,${result.failed} 失败 · ${result.elapsedSec}s · 变更 ${result.mutationCount ?? '?'} 条(${result.mutationKinds ?? '—'})`)
	for (const failure of result.failures.slice(0, 6)) console.log(`      - ${failure}`)
	if (result.failures.length > 6) console.log(`      …还有 ${result.failures.length - 6} 条,见日志`)
	console.log(`    日志:${result.logPath}`)
	if (result.workspace !== null) console.log(`    现场:${result.workspace}`)
}
const bad = results.filter((result) => result.failed !== 0)
console.log(`\n合计:${results.length} 场 · 全绿 ${results.length - bad.length} · 有失败 ${bad.length}`)
console.log(`汇总:${join(outDir, 'summary.json')}`)
process.exit(bad.length === 0 ? 0 : 1)
