/**
 * 模拟宿主的常驻进程:装真内核,在本机端口上收三类请求——
 *   · 模型的工具调用(`tools/sim/call.mjs`);
 *   · 编排者取挂起的子代理请求、交回评估者裁决;
 *   · 编排者取「交给模型的那份说明」(提示词段 + 工具目录)。
 *
 * 用法:
 *   node tools/sim/server.mjs --run <运行目录> --workspace <工作区> [--answers '{"plan-review":"approve"}'] [--audit-timeout 900000]
 *
 * 起来之后在 `<运行目录>/port` 写下端口号;会话日志落在 `<运行目录>/events.jsonl`。
 * 走 HTTP 而不是一次性子进程:评估者在飞时,内核的那次调用要**一直挂着**等裁决,
 * 进程不能随一次命令退出。
 */
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSimHost } from './host.mjs'
import { readKernelConfig } from './config.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PORT_ROOT = resolve(HERE, '..', '..')

const argv = process.argv.slice(2)
const option = (name) => {
	const index = argv.indexOf(name)
	return index === -1 ? undefined : argv[index + 1]
}
const runDir = resolve(option('--run') ?? '')
const workspace = resolve(option('--workspace') ?? '')
if (option('--run') === undefined || option('--workspace') === undefined) {
	console.error('用法:node tools/sim/server.mjs --run <运行目录> --workspace <工作区>')
	process.exit(2)
}
mkdirSync(runDir, { recursive: true })
mkdirSync(workspace, { recursive: true })
// 内核按 DSH_HOME 落它自己的数据:放进运行目录,不碰真实的 ~/.dsh。
process.env.DSH_HOME = join(runDir, 'dsh-home')

const answers = option('--answers') === undefined ? {} : JSON.parse(option('--answers'))
const config = readKernelConfig(join(PORT_ROOT, 'preset', 'agent.cordis.yml'))
/**
 * 评估者由编排者派另一个子代理来判,比生产里多一段「发现它挂起了」的延迟;
 * 缺省把等待放宽到 15 分钟,免得每次都落进「评估者仍在跑」那条路。要验那条路就显式给小值。
 */
config.auditTimeoutMs = Number(option('--audit-timeout') ?? 900000)

const { apply } = await import(join(PORT_ROOT, 'preset', 'plugins', 'clearai-kernel.js'))
const host = makeSimHost({ workspace, runDir, answers })
apply(host.ctx, config)

/** 交给模型的说明:注册的提示词段(按序)+ 每件工具的说明与参数 schema。 */
function brief() {
	const sections = [...host.sections].sort((left, right) => left.order - right.order)
	const prompt = sections.map((section) => `<!-- ${section.name} -->\n${String(section.text ?? '')}`).join('\n\n')
	const tools = [...host.tools.values()].map((tool) => ({ name: tool.name, description: tool.description ?? '', parameters: tool.parameters ?? null }))
	return { prompt, tools, sections: sections.map((section) => section.name) }
}

const calls = new Map()
let callSeq = 0

const readBody = (request) =>
	new Promise((done, reject) => {
		const chunks = []
		request.on('data', (chunk) => chunks.push(chunk))
		request.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8')
			try {
				done(raw === '' ? {} : JSON.parse(raw))
			} catch (error) {
				reject(error)
			}
		})
	})

/** 等一次调用落定,最多等 `ms`;超时返回 null(调用照样在跑,稍后可再取)。 */
const awaitCall = (entry, ms) => Promise.race([entry.promise, new Promise((done) => setTimeout(() => done(null), ms))])

const server = createServer(async (request, reply) => {
	const send = (status, payload) => {
		reply.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
		reply.end(JSON.stringify(payload))
	}
	try {
		const url = new URL(request.url, 'http://local')
		if (request.method === 'GET' && url.pathname === '/brief') {
			// 第一拍的注入(本体货架、运行档……)也是模型开场就读到的东西。
			const opening = host.events.length === 0 ? await host.preStep() : ''
			return send(200, { ...brief(), opening })
		}
		if (request.method === 'POST' && url.pathname === '/call') {
			const body = await readBody(request)
			callSeq += 1
			const id = `c${callSeq}`
			const entry = { id, tool: body.tool, promise: host.call(String(body.tool ?? ''), body.args ?? {}) }
			entry.promise.then(() => {
				entry.done = true
			})
			calls.set(id, entry)
			const outcome = await awaitCall(entry, Number(body.waitMs ?? 540000))
			return send(200, outcome === null ? { id, pending: true } : { id, ...outcome })
		}
		if (request.method === 'GET' && url.pathname === '/result') {
			const entry = calls.get(url.searchParams.get('id') ?? '')
			if (entry === undefined) return send(404, { error: 'no such call' })
			const outcome = await awaitCall(entry, Number(url.searchParams.get('waitMs') ?? 540000))
			return send(200, outcome === null ? { id: entry.id, pending: true } : { id: entry.id, ...outcome })
		}
		if (request.method === 'GET' && url.pathname === '/pending') {
			const items = [...host.pending.values()]
				.filter((entry) => entry.settled === false)
				.map(({ id, label, persona, prompt, outputSchema, toolFilter }) => ({ id, label, persona, prompt, outputSchema, toolFilter }))
			return send(200, { items })
		}
		if (request.method === 'POST' && url.pathname === '/settle') {
			const body = await readBody(request)
			return send(200, { ok: host.settle(String(body.id ?? ''), body) })
		}
		if (request.method === 'GET' && url.pathname === '/status') {
			const inFlight = [...calls.values()].filter((entry) => entry.done !== true).length
			return send(200, { events: host.events.length, mutations: host.mutations().length, pending: [...host.pending.values()].filter((entry) => !entry.settled).length, inFlight, goal: host.goal(), humanAnswers: host.humanAnswers, warnings: host.warnings.slice(-10) })
		}
		if (request.method === 'POST' && url.pathname === '/stop') {
			send(200, { ok: true })
			server.close()
			setTimeout(() => process.exit(0), 50)
			return undefined
		}
		return send(404, { error: 'unknown endpoint' })
	} catch (error) {
		return send(500, { error: String(error?.stack ?? error) })
	}
})

server.listen(0, '127.0.0.1', () => {
	const { port } = server.address()
	writeFileSync(join(runDir, 'port'), String(port))
	writeFileSync(join(runDir, 'meta.json'), JSON.stringify({ workspace, port, startedAt: new Date().toISOString(), answers, auditTimeoutMs: config.auditTimeoutMs }, null, 2))
	console.log(`模拟宿主就绪:127.0.0.1:${port} · 工作区 ${workspace} · 工具 ${host.tools.size} 件 · 提示词 ${host.sections.length} 段`)
})
