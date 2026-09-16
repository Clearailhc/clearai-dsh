/**
 * 并行长测驱动器:把若干剧本同时跑起来,**每一场各留一份完整现场与轨迹**。
 *
 * 为什么要有它:长测一场就是几分钟起步,串行跑五个剧本等于把一下午花在等上。
 * 并行跑要防的不是 CPU,而是**模型的并发上限**——每场自己还会派世界线执行者与独立评估者,
 * 一场最坏能拉起三四条模型流。所以并发上限默认 3,并且如实记进汇总。
 *
 * 为什么要**按场归档、永不覆盖**(这条是被吃过亏才加上的):
 *   · 同一个剧本复跑会覆盖同名日志 ⇒ 上一场的证据就没了,红绿变化无法分辨;
 *   · 现场落在 `/var/folders` 里 ⇒ 系统随时可能清掉,而定位问题恰恰要靠它;
 *   · 会话日志(轨迹)才是「模型到底做了什么」的权威记录,只留一行 `结果:N 通过` 等于没留。
 * 于是每场一个时间戳目录:stdout、结构化结果、出处、解码后的轨迹、会话日志原件、工作区现场。
 *
 * 用法:
 *   node tools/e2e-parallel.mjs                                  # 全部剧本,并发 3
 *   node tools/e2e-parallel.mjs --scenarios long-plan,scout-first
 *   node tools/e2e-parallel.mjs --concurrency 1 --timeout-min 45
 *
 * 产物:
 *   docs/optimization/e2e-logs/index.json                追加式索引(永不覆盖)
 *   docs/optimization/e2e-logs/<剧本>.log                  **最新一场**的 stdout 快照(便于顺手的习惯)
 *   docs/optimization/e2e-logs/<剧本>/<时间戳>/run.log     该场完整 stdout(断言与读数)
 *                                            /summary.json 该场结构化结果
 *                                            /meta.json    出处:commit、模型、任务书、路径
 *                                            /trajectory.txt 解码后的轨迹(一行一事件,可 grep)
 *                                            /session.jsonl.zstd 会话日志原件(轨迹的权威来源)
 *
 * 重型现场(工作区、会话日志原件)**落在 `~/.dsh/e2e-archive/`**,不放进仓库:
 * 工作区一旦位于某个 git 仓库内,内核会把交付提交进那个仓库(它的设计如此),
 * 跑测试就会污染宿主的项目仓库。
 */
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
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
/**
 * **重型现场放仓库之外**。为什么:`--workspace` 落在某个 git 仓库里时,内核会按设计
 * 把每次交付提交进**那个仓库**——跑测试时这会把宿主的项目仓库写进一串 `clearai: 交付 …`
 * 的无关提交(真发生过一次)。所以工作区与原始会话日志落在 `~/.dsh/e2e-archive/` 下,
 * 仓库里只留判读证据(轨迹/汇总/出处)。
 */
const archiveRoot = option('--archive', join(homedir(), '.dsh', 'e2e-archive'))
mkdirSync(outDir, { recursive: true })
mkdirSync(archiveRoot, { recursive: true })
const indexFile = join(outDir, 'index.json')

/** 时间戳目录名:本地时间、到秒,排序即时间序。 */
function stampOf(date = new Date()) {
	const pad = (n) => String(n).padStart(2, '0')
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** 这次跑的是哪一份代码(脏不脏都要记:红绿变化得能归因到代码或判据)。 */
function provenance() {
	try {
		const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PORT, encoding: 'utf8' }).trim()
		const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: PORT, encoding: 'utf8' }).trim() !== ''
		return { commit, dirty }
	} catch {
		return { commit: null, dirty: null }
	}
}

/**
 * 把会话日志解码成**一行一事件**的轨迹:定位问题时先 grep 它,不必每次解 zstd。
 * 只留判读需要的字段(类型、工具名、变更种类、文本首行),不是全文照搬。
 */
function trajectoryOf(sessionLogPath) {
	if (sessionLogPath === null || !existsSync(sessionLogPath)) return '(没有会话日志)'
	let text = ''
	try {
		text = sessionLogPath.endsWith('.zstd')
			? execFileSync('zstd', ['-d', '-c', sessionLogPath], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8')
			: readFileSync(sessionLogPath, 'utf8')
	} catch (error) {
		return `(会话日志解码失败:${String(error?.message ?? error).slice(0, 120)})`
	}
	const firstLine = (blocks) =>
		(Array.isArray(blocks) ? blocks : [])
			.flatMap((block) => {
				if (block?.type === 'text') return [String(block.text ?? '')]
				if (Array.isArray(block?.content)) return [String(block.content?.[0]?.text ?? '')]
				return []
			})
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 120)
	const lines = []
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
	for (const [index, event] of events.entries()) {
		const id = String(index + 1).padStart(4, '0')
		if (event.type === 'tool/call') {
			lines.push(`${id} tool/call        ${String(event.data?.name ?? '?')} ${JSON.stringify(event.data?.arguments ?? {}).slice(0, 100)}`)
			continue
		}
		if (event.type === 'tool/result') {
			const kinds = [...new Set((event.data?.meta?.mutations ?? []).map((mutation) => mutation.t))]
			lines.push(`${id} tool/result      ${String(event.data?.name ?? '?')}${kinds.length === 0 ? '' : `  变更=${kinds.join(',')}`}  ${firstLine(event.data?.message?.content)}`)
			continue
		}
		if (event.type === 'user/message') {
			lines.push(`${id} user/message     source=${String(event.data?.source?.kind ?? '?')}${event.data?.source?.plugin === undefined ? '' : `:${event.data.source.plugin}`}  ${firstLine(event.data?.content)}`)
			continue
		}
		if (event.type === 'assistant/message') {
			lines.push(`${id} assistant        ${firstLine(event.data?.message?.content ?? event.data?.content)}`)
			continue
		}
		lines.push(`${id} ${String(event.type ?? '?')}`)
	}
	return lines.join('\n')
}

console.log(`并行长测:${requested.length} 个剧本 · 并发 ${concurrency} · 单场上限 ${timeoutMs / 60000} 分钟`)
console.log(`日志目录:${outDir}(每场一个时间戳目录,永不覆盖)\n`)

/** 跑一个剧本:落日志、解析结论、**归档现场与轨迹**。 */
function runScenario(name) {
	return new Promise((resolve) => {
		const stamp = stampOf()
		// 轻档(入库):判读证据;重档(不入库):工作区现场与会话原件。
		const runDir = join(outDir, name, stamp)
		const heavyDir = join(archiveRoot, name, stamp)
		const workspaceDir = join(heavyDir, 'workspace')
		mkdirSync(runDir, { recursive: true })
		mkdirSync(workspaceDir, { recursive: true })
		const started = Date.now()
		/**
		 * `--workspace` 传的是**归档目录下的空工作区**:现场因此留在可预期、不会被系统清理的地方
		 * (临时目录里的现场会在定位问题之前消失,而我们恰恰要靠它)。`--keep` 再加上一层保险。
		 */
		const child = spawn('node', [join(HERE, 'e2e-run.mjs'), '--scenario', name, '--keep', '--workspace', workspaceDir], {
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
			const elapsedSec = Math.round((Date.now() - started) / 1000)
			const line = buffer.match(/结果:(\d+) 通过,(\d+) 失败/)
			const failures = [...buffer.matchAll(/^ {2}- (.+)$/gm)].map((match) => match[1])
			const sessionLog = buffer.match(/会话日志 (\S+)/)?.[1] ?? null
			const mutations = buffer.match(/变更记录:(\d+) 条\(([^)]*)\)/)
			const summary = {
				name,
				title: SCENARIOS[name].title,
				stamp,
				code,
				passed: line === null ? 0 : Number(line[1]),
				failed: line === null ? -1 : Number(line[2]),
				failures,
				elapsedSec,
				workspace: workspaceDir,
				sessionLog,
				mutationCount: mutations === null ? null : Number(mutations[1]),
				mutationKinds: mutations === null ? null : mutations[2],
			}
			writeFileSync(join(runDir, 'run.log'), buffer, 'utf8')
			writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
			writeFileSync(
				join(runDir, 'meta.json'),
				`${JSON.stringify({ ...summary, ...provenance(), model: 'deepseek-flash', concurrency, archive: heavyDir, task: SCENARIOS[name].task }, null, 2)}\n`,
				'utf8',
			)
			writeFileSync(join(runDir, 'trajectory.txt'), `${trajectoryOf(sessionLog)}\n`, 'utf8')
			// 会话日志原件:轨迹的权威来源,留着就能离线复算(`tools/e2e-replay.mjs`)。
			if (sessionLog !== null && existsSync(sessionLog)) {
				try {
					cpSync(sessionLog, join(heavyDir, 'session.jsonl.zstd'))
				} catch {
					/* 拷不动不影响结论:meta.json 里有原始路径 */
				}
			}
			// 顺手一份「最新一场」的快照(老习惯的引用不会断;归档目录才是权威)。
			writeFileSync(join(outDir, `${name}.log`), buffer, 'utf8')
			resolve(summary)
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
		process.stdout.write(`${verdict} ${name} 完成:${result.passed} 通过,${result.failed} 失败 · ${result.elapsedSec}s · 归档 ${join(result.name, result.stamp)}\n`)
	}
})
await Promise.all(workers)

results.sort((a, b) => requested.indexOf(a.name) - requested.indexOf(b.name))
const summary = {
	at: new Date().toISOString(),
	concurrency,
	timeoutMin: timeoutMs / 60000,
	...provenance(),
	scenarios: results.map(({ log, ...rest }) => rest),
}
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
// **追加式索引**:跨批次的可比读数都在这里(单个 summary.json 会被下一批覆盖)。
try {
	const previous = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : []
	const runs = Array.isArray(previous) ? previous : []
	for (const result of results) {
		runs.push({
			at: summary.at,
			commit: summary.commit,
			dirty: summary.dirty,
			name: result.name,
			stamp: result.stamp,
			passed: result.passed,
			failed: result.failed,
			elapsedSec: result.elapsedSec,
			failures: result.failures,
			dir: join(result.name, result.stamp),
		})
	}
	writeFileSync(indexFile, `${JSON.stringify(runs, null, 2)}\n`, 'utf8')
} catch (error) {
	console.warn(`(索引写入失败,不影响结论:${String(error?.message ?? error).slice(0, 120)})`)
}

console.log('\n══ 汇总 ══')
for (const result of results) {
	const mark = result.failed === 0 ? '✓' : '✗'
	console.log(`${mark} ${result.name}(${result.title})`)
	console.log(`    ${result.passed} 通过,${result.failed} 失败 · ${result.elapsedSec}s · 变更 ${result.mutationCount ?? '?'} 条(${result.mutationKinds ?? '—'})`)
	for (const failure of result.failures.slice(0, 6)) console.log(`      - ${failure}`)
	if (result.failures.length > 6) console.log(`      …还有 ${result.failures.length - 6} 条,见日志`)
	console.log(`    轻档(入库):${join(result.name, result.stamp)}(run.log / summary.json / meta.json / trajectory.txt)`)
	console.log(`    重档(现场):${join(archiveRoot, result.name, result.stamp)}(workspace / session.jsonl.zstd)`)
}
const bad = results.filter((result) => result.failed !== 0)
console.log(`\n合计:${results.length} 场 · 全绿 ${results.length - bad.length} · 有失败 ${bad.length}`)
console.log(`索引:${indexFile}`)
process.exit(bad.length === 0 ? 0 : 1)
