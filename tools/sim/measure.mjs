/**
 * 输入构成的度量:模型每次请求读到的东西,哪一块有多大。
 *
 *   node tools/sim/measure.mjs static            → 系统提示词段与 ClearAI 工具说明(中文会话,即缺省语言)
 *   node tools/sim/measure.mjs run <运行目录>     → 一场模拟运行里注入的运行态卡与各工具结果(读 events.jsonl)
 *   加 --json 输出机器可读的结果
 *
 * token 是估算:汉字(含全角标点)按 1 个计,其余字符按 4 个计 1 个。只用于前后对比,不是计费口径。
 * 模型自己的输出与对话历史不在宿主的日志里,这里量不到;长测记录里如实写明。
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSimHost, textOf } from './host.mjs'
import { readKernelConfig } from './config.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const [mode, runArg] = argv.filter((item) => item !== '--json')

/** 估算 token:宽字符 1 个,其余每 4 个字符 1 个。 */
export function estimateTokens(text) {
	const value = String(text ?? '')
	let wide = 0
	for (const char of value) if (/[⺀-￯]/.test(char)) wide += 1
	return wide + Math.ceil((value.length - wide) / 4)
}

const size = (text) => ({ chars: String(text ?? '').length, tokens: estimateTokens(text) })

async function staticSizes() {
	const workspace = mkdtempSync(join(tmpdir(), 'clearai-measure-'))
	process.env.DSH_HOME = join(workspace, '.dsh-home')
	const config = readKernelConfig(join(ROOT, 'preset', 'agent.cordis.yml'))
	const { apply } = await import(join(ROOT, 'preset', 'plugins', 'clearai-kernel.js'))
	const host = makeSimHost({ workspace, runDir: workspace })
	apply(host.ctx, config)
	const sections = [...host.sections].sort((left, right) => left.order - right.order).map((section) => ({ name: section.name, ...size(typeof section.text === 'function' ? section.text() : section.text) }))
	const tools = [...host.tools.values()].map((tool) => ({ name: tool.name, ...size(`${tool.description ?? ''}\n${JSON.stringify(tool.parameters ?? null)}`) }))
	const total = (rows) => rows.reduce((sum, row) => ({ chars: sum.chars + row.chars, tokens: sum.tokens + row.tokens }), { chars: 0, tokens: 0 })
	return { sections, tools, totals: { prompt: total(sections), tools: total(tools), all: total([...sections, ...tools]) } }
}

function runSizes(runDir) {
	const lines = readFileSync(join(runDir, 'events.jsonl'), 'utf8').split('\n').filter((line) => line.trim() !== '')
	const byTool = {}
	const injected = { count: 0, chars: 0, tokens: 0 }
	for (const line of lines) {
		const event = JSON.parse(line)
		if (event.type === 'tool/result') {
			const name = String(event.data?.name ?? event.data?.tool ?? '?')
			const text = textOf(event.data?.content ?? event.data?.output ?? '')
			const row = (byTool[name] ??= { count: 0, chars: 0, tokens: 0 })
			row.count += 1
			row.chars += text.length
			row.tokens += estimateTokens(text)
		} else if (event.type === 'user/message') {
			const text = textOf(event.data?.content)
			injected.count += 1
			injected.chars += text.length
			injected.tokens += estimateTokens(text)
		}
	}
	return { runDir, injected, byTool }
}

if (mode === 'static') {
	const item = await staticSizes()
	if (asJson) console.log(JSON.stringify(item, null, 2))
	else {
		console.log(`提示词段 ${item.totals.prompt.tokens} · 工具说明 ${item.totals.tools.tokens} · 合计 ${item.totals.all.tokens}(估算 token)`)
			for (const row of [...item.sections, ...item.tools]) console.log(`  ${row.name.padEnd(28)} ${String(row.tokens).padStart(6)}  (${row.chars} 字符)`)
		}
} else if (mode === 'run' && runArg !== undefined) {
	const result = runSizes(resolve(runArg))
	if (asJson) console.log(JSON.stringify(result, null, 2))
	else {
		console.log(`注入的消息(运行态卡等):${result.injected.count} 条 · ${result.injected.tokens} token`)
		for (const [name, row] of Object.entries(result.byTool).sort((a, b) => b[1].tokens - a[1].tokens)) console.log(`  ${name.padEnd(20)} ${String(row.count).padStart(4)} 次 · ${String(row.tokens).padStart(7)} token`)
	}
} else {
	console.error('用法:node tools/sim/measure.mjs static | run <运行目录> [--json]')
	process.exit(2)
}
