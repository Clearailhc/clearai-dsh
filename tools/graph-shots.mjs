/**
 * graph-shots —— 用**真实会话的投影**给图谱拍照(文档素材)。
 *
 * 为什么这么做,而不是拿一张手搭的假图:图谱的读面只有一个真值源
 * (`fold` → `view()` → `graphProjection()`),文档里的图必须是它的输出。
 * 这个工具把某一场真会话的日志折一遍,拿折出来的 `lexicon.graph` 喂给**真组件**,
 * 在真 Chrome 里渲染、截图;连 Inspector 的读数都由真的 `inspectGraphSelection` 回答
 * (起一个只读的 `/api/clearai/inspector` 路由指向它)。
 *
 * 于是素材与产品同源:投影变了、组件变了,重拍一次即可,不需要人去界面里手点。
 *
 * 跑法:
 *   node tools/graph-shots.mjs --session <id 前缀> [--out docs/shots/zh] [--prefix graph]
 *   node tools/graph-shots.mjs --list          列出可用会话(按本体规模排序)
 *   依赖:playwright(可选)+ 系统 Chrome;日志在 $DSH_HOME/sessions 下。
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
function foldSession(file) {
	const text = execFileSync('zstd', ['-dc', file], { encoding: 'utf8', maxBuffer: 1 << 30 })
	let state = emptyState()
	for (const line of text.split('\n')) {
		if (line.trim() === '') continue
		let event
		try {
			event = JSON.parse(line)
		} catch {
			continue
		}
		if (event.type === undefined) continue
		state = applyEvent(state, event)
	}
	return state
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
			/** 日志是紧凑 JSON(`{"t":"…"}`),所以按子串数,不按带空格的形状数。 */
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

const wanted = option('--session')
if (wanted === undefined) {
	console.log('用法:node tools/graph-shots.mjs --session <id 前缀> [--out docs/shots/zh] [--prefix graph]')
	console.log('      node tools/graph-shots.mjs --list')
	process.exit(2)
}
const match = listSessions().find((entry) => entry.sid.includes(wanted))
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

const state = foldSession(match.file)
const projection = view(state)
const graph = projection.lexicon.graph
const derived = derive(state)
const outDir = join(PORT, option('--out') ?? join('docs', 'shots', 'zh'))
const prefix = option('--prefix') ?? 'graph'
mkdirSync(outDir, { recursive: true })

const stage = mkdtempSync(join(tmpdir(), 'clearai-shots-'))
try {
	const entry = join(stage, 'runtime-entry.js')
	writeFileSync(entry, [`import * as React from 'react'`, `import * as jsx from 'react/jsx-runtime'`, `import { createRoot } from 'react-dom/client'`, `window.__SEEDS__ = { react: React, 'react/jsx-runtime': jsx }`, `window.__CREATE_ROOT__ = createRoot`].join('\n'))
	await build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', outfile: join(stage, 'runtime.js'), nodePaths: [join(PORT, 'node_modules')], logLevel: 'silent' })
	writeFileSync(join(stage, 'client.js'), readFileSync(CLIENT, 'utf8'))
	writeFileSync(
		join(stage, 'index.html'),
		`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}#root{padding:12px}
		/* 截图用:把面板底色交给页面,免得透明背景在 PNG 里发灰 */
		:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f8fa;--dsw-alias-label-primary:#1f2328;--dsw-alias-label-secondary:#5c6370;--dsw-alias-label-tertiary:#8b93a1;--dsw-alias-border-l1:#e6e8eb;--dsw-alias-border-l3:#d0d4d9}
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
	const GraphBand = exports.__components.GraphBand
	window.__MOUNT__ = (graph, layer, fullscreen) => {
		try {
			window.__ROOT__ = window.__ROOT__ ?? window.__CREATE_ROOT__(document.getElementById('root'))
			const noop = () => {}
			window.__ROOT__.render(React.createElement(GraphBand, {
				lexicon: { graph, conflicts: window.__CONFLICTS__ ?? [] },
				layer, fullscreen, sessionId: 'shot',
				onLayer: noop, onToggleFullscreen: noop, onFilter: noop,
			}))
			window.__MOUNT_ERROR__ = null
		} catch (error) {
			window.__MOUNT_ERROR__ = String(error?.message ?? error)
		}
	}
	window.__READY__ = true
})()`,
	)

	const server = createServer(async (request, reply) => {
		const url = new URL(request.url, 'http://127.0.0.1')
		/** Inspector 的读数由**真的**投影函数回答——素材里的证据链不是编的。 */
		if (url.pathname === '/api/clearai/inspector') {
			const selection = { kind: url.searchParams.get('kind') ?? '', id: url.searchParams.get('id') ?? '' }
			const found = inspectGraphSelection(state, selection, derived)
			reply.writeHead(200, { 'content-type': 'application/json' })
			reply.end(JSON.stringify(found === null ? { ok: true, found: false } : { ok: true, found: true, inspector: found }))
			return
		}
		const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
		try {
			const body = readFileSync(join(stage, file))
			reply.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' })
			reply.end(body)
		} catch {
			reply.writeHead(404)
			reply.end('not found')
		}
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const base = `http://127.0.0.1:${server.address().port}`

	const browser = await chromium.launch({ channel: 'chrome', headless: true })
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
	await page.addInitScript(() => {
		window.__pending = []
		window.__ModuleLoader__ = { mode: 'queue', pendingQueue: window.__pending, load: (registration) => window.__pending.push(registration) }
	})
	await page.goto(base, { waitUntil: 'load' })
	await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 })

	/**
	 * **每张图都从一次干净的加载开始**:同一个页面里连着换层、开抽屉、再点节点,
	 * 状态会互相串(试过:点的时候画布已经不在 DOM 里了)。
	 * 一次加载 → 挂载 → 等节点 → (可选)点一个 → 截图,是可复现的最小单元。
	 */
	const shot = async (name, { layer, fullscreen, click = false }) => {
		await page.goto(base, { waitUntil: 'load' })
		await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 })
		await page.evaluate(([g, l, f, c]) => {
			window.__CONFLICTS__ = c
			window.__MOUNT__(g, l, f)
		}, [graph, layer, fullscreen, projection.lexicon.conflicts])
		try {
			await page.waitForSelector('.react-flow__node', { timeout: 8000 })
		} catch (error) {
			const diag = await page.evaluate(() => ({
				canvas: document.querySelectorAll('.react-flow').length,
				root: document.getElementById('root')?.innerHTML.slice(0, 240) ?? '(no root)',
				registrations: (window.__pending ?? []).map((entry) => entry.id),
				ready: window.__READY__ === true,
				mountError: window.__MOUNT_ERROR__ ?? null,
			}))
			console.log(`  ! ${name} 画不出来:`, JSON.stringify(diag))
			throw error
		}
		await page.waitForTimeout(700)
		if (click) {
			const clicked = await page.evaluate(() => {
				const element = document.querySelector('.react-flow__node')
				if (element === null) return false
				element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
				return true
			})
			if (!clicked) console.log(`  · (${name}:节点没画出来,跳过)`)
			await page.waitForTimeout(1000)
		}
		await page.screenshot({ path: join(outDir, `${prefix}-${name}.png`), fullPage: false })
		console.log(`  · ${join(option('--out') ?? join('docs', 'shots', 'zh'), `${prefix}-${name}.png`)}`)
	}

	const ontologyNodes = graph.nodes.filter((node) => node.layer === 'ontology').length
	const entityNodes = graph.nodes.filter((node) => node.layer === 'entity').length
	console.log(`\n【图谱素材】会话 ${match.sid.slice(0, 12)} · 本体 ${ontologyNodes} 节点 / 实体 ${entityNodes} 节点 · 边 ${graph.edges.length}`)

	// ① 图带(事实格里的摘要形态)
	await shot('band', { layer: 'ontology', fullscreen: false })
	// ② 工作区 · 本体图
	await shot('ontology', { layer: 'ontology', fullscreen: true })
	// ③ 工作区 · 点一个概念 → Inspector(定义 / 子概念 / 相关谓词 / 历史)
	await shot('inspector', { layer: 'ontology', fullscreen: true, click: true })
	// ④ 实体图(有升格事实时才拍;没有就如实说明,不拍一张空的当素材)
	if (entityNodes > 0) {
		await shot('entity', { layer: 'entity', fullscreen: true, click: true })
	} else {
		console.log('  · 这场会话没有实体节点(没有升格事实),跳过实体图')
	}

	await browser.close()
	server.close()
} finally {
	rmSync(stage, { recursive: true, force: true })
}
