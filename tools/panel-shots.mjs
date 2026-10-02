/**
 * panel-shots —— 用**真会话的投影**给面板拍照(营销与文档素材)。
 *
 * 与 `graph-shots.mjs` 同一条纪律,只是拍的面更多:折一份真会话日志 → 同一份 `view()`
 * → 把**真组件**(构建出来的那一份客户端)挂进真 Chrome 渲染 → 截图。
 * 面板里的每个数字都来自投影或盘上真有的文件,没有一处是手写的。
 *
 * 检视读面在浏览器里是 fetch(`/api/clearai/inspector`),
 * 这里按 `ui/lib/index.js` 的**同一形状**在 Node 侧算好、注入页面(改读面时这里要跟着改)。
 *
 * 跑法:
 *   node tools/panel-shots.mjs --session <id 前缀> [--out docs/marketing/zhihu/images] [--prefix panel]
 *   node tools/panel-shots.mjs --list
 *   依赖:playwright-core(devDependency)+ 系统 Chrome;日志在 $DSH_HOME/sessions 下。
 */
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CLIENT = join(PORT, 'dist', 'clearai-dsh', 'lib', 'client.js')

const argv = process.argv.slice(2)
const option = (flag) => {
	const index = argv.indexOf(flag)
	return index >= 0 ? argv[index + 1] : undefined
}

const { applyEvent, emptyState, inspectGraphSelection, derive, view } = await import(join(PORT, 'ui', 'lib', 'fold.js'))

/** 折一份会话日志(与宿主投影同一份 fold,不是另写一遍)。 */
function foldSession(file, plain = false) {
	const text = plain ? readFileSync(file, 'utf8') : execFileSync('zstd', ['-dc', file], { encoding: 'utf8', maxBuffer: 1 << 30 })
	let state = emptyState()
	let header = null
	for (const line of text.split('\n')) {
		if (line.trim() === '') continue
		let event
		try {
			event = JSON.parse(line)
		} catch {
			continue
		}
		if (event.type === undefined) continue
		if (event.type === 'session') header = event
		state = applyEvent(state, event)
	}
	return { state, header }
}

/** 列出可用的会话:按「本体规模」排序,让人一眼挑到有东西可拍的那几场。 */
function listSessions() {
	const root = join(DSH_HOME, 'sessions')
	if (!existsSync(root)) return []
	const found = []
	for (const slug of readdirSync(root)) {
		const dir = join(root, slug)
		if (!statSync(dir).isDirectory()) continue
		for (const sid of readdirSync(dir)) {
			const file = join(dir, sid, 'session.v3.jsonl.zstd')
			if (!existsSync(file)) continue
			let probe = ''
			try {
				probe = execFileSync('zstd', ['-dc', file], { encoding: 'utf8', maxBuffer: 1 << 30 })
			} catch {
				continue
			}
			const terms = (probe.match(/ontology\/term_added/g) ?? []).length
			const facts = (probe.match(/fact\/promoted/g) ?? []).length
			if (terms === 0) continue
			found.push({ sid, file, terms, facts })
		}
	}
	return found.sort((left, right) => right.terms + right.facts * 2 - (left.terms + left.facts * 2))
}

if (argv.includes('--list')) {
	for (const entry of listSessions().slice(0, 12)) console.log(`概念事件 ${String(entry.terms).padStart(3)} · 事实 ${String(entry.facts).padStart(3)} · ${entry.sid}`)
	process.exit(0)
}

/**
 * `--events <file.jsonl>`:不走 DSH_HOME,直接折一份明文事件日志(模拟宿主跑出来的 `events.jsonl` 就是这个形状)。
 */
const eventsFile = option('--events')
const wanted = option('--session') ?? (eventsFile === undefined ? undefined : '')
if (wanted === undefined) {
	console.log('用法:node tools/panel-shots.mjs --session <id 前缀> [--out docs/marketing/zhihu/images] [--prefix panel]')
	console.log('      node tools/panel-shots.mjs --list')
	process.exit(2)
}
const match = eventsFile !== undefined ? { sid: option('--sid') ?? 'session-1', file: eventsFile, plain: true } : listSessions().find((entry) => entry.sid.includes(wanted))
if (match === undefined) {
	console.log(`✗ 没找到含本体的会话:${wanted}(先用 --list 看有哪些)`)
	process.exit(1)
}
if (!existsSync(CLIENT)) {
	console.log('✗ 先跑 node tools/build-package.mjs(要的是装出去的那一份客户端)')
	process.exit(1)
}
let chromium = null
try {
	;({ chromium } = await import('playwright-core'))
} catch {
	console.log('· 跳过:没有 playwright(npm install(playwright-core 是 devDependency))。')
	process.exit(0)
}

const { state, header } = foldSession(match.file, match.plain === true)
const cwd = typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : null
const sessionId = match.sid
const projection = view(state, sessionId)
const derived = derive(state)
const outDir = join(PORT, option('--out') ?? join('docs', 'marketing', 'zhihu', 'images'))
const prefix = option('--prefix') ?? 'panel'
mkdirSync(outDir, { recursive: true })

/** 默认两面:**本体格 / 世界树**。 */
const PANELS = (option('--panels') ?? 'ontology,worldlines').split(',').map((item) => item.trim()).filter((item) => item !== '')
const stage = mkdtempSync(join(tmpdir(), 'clearai-panel-shots-'))
try {
	const entry = join(stage, 'runtime-entry.js')
	writeFileSync(entry, [`import * as React from 'react'`, `import * as jsx from 'react/jsx-runtime'`, `import { createRoot } from 'react-dom/client'`, `window.__SEEDS__ = { react: React, 'react/jsx-runtime': jsx }`, `window.__CREATE_ROOT__ = createRoot`].join('\n'))
	await build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', outfile: join(stage, 'runtime.js'), nodePaths: [join(PORT, 'node_modules')], logLevel: 'silent' })
	writeFileSync(join(stage, 'client.js'), readFileSync(CLIENT, 'utf8'))
	writeFileSync(
		join(stage, 'index.html'),
		`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;color-scheme:light}#root{padding:0}
		/* 截图用:把面板底色交给页面,免得透明背景在 PNG 里发灰(与 graph-shots 同一套变量) */
		:root{--dsw-alias-bg-base:#fff;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-state-error-primary:#d14343;--dsw-alias-brand-primary:#3b5bdb;--dsw-alias-interactive-bg-hover:#f0f1f3;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f8fa;--dsw-alias-label-primary:#1f2328;--dsw-alias-label-secondary:#5c6370;--dsw-alias-label-tertiary:#8b93a1;--dsw-alias-border-l1:#e6e8eb;--dsw-alias-border-l2:#dfe2e6;--dsw-alias-border-l3:#d0d4d9;--dsw-alias-state-warn-primary:#d9822b}
		</style></head><body><div id="root"></div>
<script src="/runtime.js"></script><script src="/client.js"></script><script src="/probe.js"></script></body></html>`,
	)
	writeFileSync(
		join(stage, 'probe.js'),
		`(() => {
	const registration = (window.__pending ?? []).find((entry) => entry.id === 'clearai-dsh')
	const require = (name) => {
		if (window.__SEEDS__[name] !== undefined) return window.__SEEDS__[name]
		throw new Error('require 解析不到:' + name)
	}
	const exports = registration.factory(require)
	const React = window.__SEEDS__.react
	const C = exports.__components
	const projection = window.__PROJECTION__
	const sessionId = window.__SID__
	const noop = () => {}
	/** 面板在真宿主里从插座拿会话投影;这里给同一形状的最小桩。 */
	const useSessions = (selector) => selector({ byId: { [sessionId]: { projectionValues: { clearai: projection } } } })
	const props = {
		ontology: { useProjection: () => projection, openPreview: () => true, openRail: noop, openSpectator: noop },
		worldlines: { useSessions, sessionId, openPreview: () => true, openSpectator: noop },
	}
	const component = { ontology: C.Atlas, worldlines: C.WorldTree }
	window.__MOUNT__ = (name) => {
		try {
			window.__ROOT__ = window.__ROOT__ ?? window.__CREATE_ROOT__(document.getElementById('root'))
			window.__ROOT__.render(React.createElement(component[name], props[name]))
			window.__MOUNT_ERROR__ = null
		} catch (error) {
			window.__MOUNT_ERROR__ = String(error?.message ?? error)
		}
	}
	window.__READY__ = true
})()`,
	)
	writeFileSync(
		join(stage, 'prefetch.js'),
		`(() => {
	/** 检视读面在浏览器里走 fetch;这里按宿主同一形状注入(数据在 Node 侧由投影算出)。 */
	const json = (payload) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }))
	const real = window.fetch.bind(window)
	window.fetch = (input, init) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? ''))
		if (url.includes('/api/clearai/inspector')) {
		const query = new URL(url, location.href).searchParams
		return json((window.__INSPECTOR__ ?? {})[query.get('kind') + ':' + query.get('id')] ?? { ok: true, found: false })
	}
		if (url.includes('/api/clearai/')) return json({ ok: false, error: 'shot_stub' })
		return real(input, init)
	}
})()`,
	)
	// prefetch 必须在客户端 bundle 之前跑(它要拦住面板的 fetch)。
	const html = readFileSync(join(stage, 'index.html'), 'utf8').replace('<script src="/runtime.js">', '<script src="/prefetch.js"></script><script src="/runtime.js">')
	writeFileSync(join(stage, 'index.html'), html)

	/**
	 * 每个点、每条边的读数都在 Node 侧按宿主同一个函数算好,按「kind:id」交给页面
	 * (与面板发出的查询同一种键:概念用词条 id,其余用图上的 id)。
	 */
	const inspector = (() => {
		const table = {}
		const put = (kind, id) => {
			const found = inspectGraphSelection(state, { kind, id }, derived)
			table[`${kind}:${id}`] = found === null ? { ok: true, found: false } : { ok: true, found: true, inspector: found }
		}
		for (const node of projection.lexicon?.graph?.nodes ?? []) put(node.kind, node.kind === 'concept' ? String(node.ref ?? '') : node.id)
		for (const edge of projection.lexicon?.graph?.edges ?? []) put('edge', edge.id)
		return table
	})()

	const server = createServer((request, reply) => {
		const file = request.url === '/' ? 'index.html' : request.url.slice(1)
		try {
			const body = readFileSync(join(stage, file))
			reply.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' })
			reply.end(body)
		} catch {
			reply.writeHead(404)
			reply.end('not found')
		}
	})
	await new Promise((resolve_) => server.listen(0, '127.0.0.1', resolve_))
	const base = `http://127.0.0.1:${server.address().port}`

	const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true })
	const page = await browser.newPage({ viewport: { width: Number(option('--width') ?? 780), height: Number(option('--height') ?? 940) }, deviceScaleFactor: 2 })
	await page.addInitScript(() => {
		window.__pending = []
		window.__ModuleLoader__ = { mode: 'queue', pendingQueue: window.__pending, load: (registration) => window.__pending.push(registration) }
	})
	await page.addInitScript(
		(payloads) => {
			window.__PROJECTION__ = payloads.projection
			window.__SID__ = payloads.sessionId
			window.__INSPECTOR__ = payloads.inspector
		},
		{ projection, sessionId, inspector },
	)

	/** 面板画不出来时,诊断信息比一张空图有用:把控制台/页面错误一并带出来。 */
	const noise = []
	page.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning') noise.push(`console.${message.type()}: ${message.text().slice(0, 300)}`)
	})
	page.on('pageerror', (error) => noise.push(`pageerror: ${String(error?.stack ?? error?.message ?? error).slice(0, 900)}`))

	const shot = async (name) => {
		noise.length = 0
		await page.goto(base, { waitUntil: 'load' })
		await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 })
		await page.evaluate((panel) => window.__MOUNT__(panel), name)
		await page.waitForTimeout(1400)
		/** `--click 文本`(可多次):挂好之后依次点一下,拍展开后的样子。 */
		for (let index = 0; index < argv.length; index += 1) {
			if (argv[index] !== '--click' || name !== PANELS[0]) continue
			await page.getByText(argv[index + 1], { exact: false }).first().click()
			await page.waitForTimeout(500)
		}
		const diag = await page.evaluate(() => ({
			html: document.getElementById('root')?.innerHTML.length ?? 0,
			mountError: window.__MOUNT_ERROR__ ?? null,
		}))
		if (diag.html === 0) {
			console.log(`  ! ${name} 画不出来:`, JSON.stringify(diag))
			for (const line of noise.slice(0, 6)) console.log(`      ${line}`)
		}
		await page.screenshot({ path: join(outDir, `${prefix}-${name}.png`), fullPage: false })
		console.log(`  · ${join(option('--out') ?? join('docs', 'marketing', 'zhihu', 'images'), `${prefix}-${name}.png`)}`)
	}

	console.log(`\n【面板素材】会话 ${sessionId.slice(0, 16)} · 工作区 ${cwd ?? '(日志里没有 cwd)'} · 本体 ${(projection.lexicon?.terms ?? []).length} 概念 / ${(projection.lexicon?.predicates ?? []).length} 谓词 · 计划 ${(projection.plans ?? []).length} · 事实 ${(projection.facts ?? []).length}`)
	for (const panel of PANELS) await shot(panel)

	await browser.close()
	server.close()
} finally {
	rmSync(stage, { recursive: true, force: true })
}
