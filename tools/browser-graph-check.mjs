/**
 * browser-graph-check —— **在真浏览器里**把图谱渲染一遍。
 *
 * 为什么需要它(两次真机翻车的教训):
 *   ① 图组件曾经整个不可用——原因不在图本身,而在**它怎么被装载**;
 *   ② 后来又不可用一次——原因是 `ReactFlow` 是 `forwardRef` **对象**,
 *      而守卫写成 `typeof === 'function'`,把一个合法组件判成了「没装上」。
 * 这两类错,**单元测试全绿也照样发生**:渲染桩里的组件是函数、宿主环境也不是浏览器。
 * 所以这一条住在真 Chrome + 真 React + 真 React Flow 上,只验一件事:
 *
 *   **部署件里的 GraphBand,在一个浏览器里到底画不画得出 `.react-flow`。**
 *
 * 它不复刻宿主(GUI 要鉴权、要一场真实会话)。它复刻的是**模块装载契约**那一步:
 * 按 `window.__ModuleLoader__.load({ id, factory })` 取到工厂、用宿主的 `require`
 * (react / react/jsx-runtime 两个种子字)调它,再拿 `__components.GraphBand` 挂到 DOM 上。
 * 装载契约一旦漂了,这里当场红——而不再由人去浏览器里肉眼发现。
 *
 * 跑法:node tools/browser-graph-check.mjs
 *   前置:node tools/build-package.mjs(它产出 dist/…/lib/client.js)
 *   依赖:playwright 与系统 Chrome(channel: 'chrome')
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const CLIENT = join(PORT, 'dist', 'clearai-dsh', 'lib', 'client.js')

if (!existsSync(CLIENT)) {
	console.log('· 跳过:还没有 dist/clearai-dsh/lib/client.js。先跑 node tools/build-package.mjs')
	process.exit(0)
}

let chromium = null
try {
	;({ chromium } = await import('playwright-core'))
} catch {
	console.log('· 跳过:没有 playwright(它是可选依赖,npm install(playwright-core 是 devDependency))。')
	process.exit(0)
}

const stage = mkdtempSync(join(tmpdir(), 'clearai-browser-'))
try {
	/**
	 * 把 react / react-dom / jsx-runtime 打成一个页面可用的全局包——它们是宿主的**种子字**,
	 * 在这里就得由我们提供,好让 client 工厂拿到的 `require` 与真宿主的形状一致。
	 */
	const runtimeEntry = join(stage, 'runtime-entry.js')
	writeFileSync(
		runtimeEntry,
		[
			`import * as React from 'react'`,
			`import * as jsx from 'react/jsx-runtime'`,
			`import { createRoot } from 'react-dom/client'`,
			`window.__SEEDS__ = { react: React, 'react/jsx-runtime': jsx }`,
			`window.__CREATE_ROOT__ = createRoot`,
			`window.__REACT_VERSION__ = React.version`,
		].join('\n'),
	)
	await build({
		entryPoints: [runtimeEntry],
		bundle: true,
		format: 'iife',
		platform: 'browser',
		outfile: join(stage, 'runtime.js'),
		/** 入口在临时目录里,依赖要从本仓库解析——否则 esbuild 从 /tmp 一路往上找不到 React。 */
		nodePaths: [join(PORT, 'node_modules')],
		logLevel: 'silent',
	})

	writeFileSync(join(stage, 'client.js'), readFileSync(CLIENT, 'utf8'))
	writeFileSync(
		join(stage, 'index.html'),
		`<!doctype html><html><head><meta charset="utf-8"><title>graph check</title>
<style>html,body{margin:0}#root{width:900px;height:600px}</style></head>
<body><div id="root"></div>
<script src="/runtime.js"></script>
<script src="/client.js"></script>
<script src="/probe.js"></script>
</body></html>`,
	)
	writeFileSync(
		join(stage, 'probe.js'),
		`(async () => {
	try {
		/** 就从装载门面的队列里取本插件那一行(与宿主 boot 时取行的方式同理)。 */
		const registration = (window.__pending ?? []).find((entry) => entry.id === 'clearai-dsh')
		if (registration === undefined) throw new Error('bundle 没有通过 __ModuleLoader__.load 登记工厂')
		const require = (name) => {
			if (window.__SEEDS__[name] !== undefined) return window.__SEEDS__[name]
			throw new Error('require 解析不到:' + name)
		}
		const exports = registration.factory(require)
		const GraphBand = exports.__components?.GraphBand
		if (typeof GraphBand !== 'function') throw new Error('__components.GraphBand 不在')
		const graph = {
			nodes: [
				{ id: 'term:a', kind: 'concept', layer: 'ontology', ref: 'a', label: '概念A', status: 'admitted', uses: 1, depth: 0, x: 0, y: 0 },
				{ id: 'term:b', kind: 'concept', layer: 'ontology', ref: 'b', label: '概念B', status: 'admitted', uses: 1, depth: 1, x: 240, y: 140 },
				{ id: 'a|X', kind: 'instance', layer: 'entity', ref: 'X', label: 'X', type: 'a', status: 'live', facts: ['f-1'], x: 0, y: 280 },
			],
			edges: [
				{ id: 'is_a:b', kind: 'is_a', layer: 'ontology', predicate: null, label: 'is_a', from: 'term:b', to: 'term:a', status: 'admitted' },
				{ id: 'assertion:f-1:p1:a|X', kind: 'assertion', layer: 'entity', predicate: 'p1', label: '谓词', from: 'a|X', to: 'term:a', status: 'live', level: 'L3', fact: 'f-1', scope: null, claim: 'h-1' },
			],
			bounds: { width: 480, height: 420 },
		}
		const React = window.__SEEDS__.react
		const root = window.__CREATE_ROOT__(document.getElementById('root'))
		const noop = () => {}
		root.render(React.createElement(GraphBand, {
			lexicon: { graph, conflicts: [] },
			layer: 'ontology',
			fullscreen: false,
			sessionId: 'probe',
			onLayer: noop, onToggleFullscreen: noop, onFilter: noop,
		}))
		await new Promise((resolve) => setTimeout(resolve, 800))
		window.__PROBE__ = {
			ok: true,
			reactVersion: window.__REACT_VERSION__,
			canvas: document.querySelectorAll('.react-flow').length,
			nodes: document.querySelectorAll('.react-flow__node').length,
			edges: document.querySelectorAll('.react-flow__edge').length,
			controls: document.querySelectorAll('.react-flow__controls').length,
			minimap: document.querySelectorAll('.react-flow__minimap').length,
			styleInjected: document.querySelector('style[data-clearai="xyflow"]') !== null,
			degraded: document.body.textContent.includes('图组件不可用'),
			reason: (document.body.textContent.match(/图组件不可用\\(([^)]*)\\)/) ?? [])[1] ?? null,
		}
	} catch (error) {
		window.__PROBE__ = { ok: false, error: String(error?.message ?? error) }
	}
})()`,
	)

	/** 页面里那个「队列式」装载门面:与宿主装的那一份同形(见 dsh-client-modules 的 bootInjections)。 */
	const server = createServer((request, reply) => {
		const url = new URL(request.url, 'http://127.0.0.1')
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
	const page = await browser.newPage()
	const consoleErrors = []
	page.on('pageerror', (error) => consoleErrors.push(String(error.message).slice(0, 200)))
	await page.addInitScript(() => {
		// 宿主在 <head> 里先装的就是这个门面:`load()` 只入队,boot 之后再物化。
		window.__pending = []
		window.__ModuleLoader__ = {
			mode: 'queue',
			pendingQueue: window.__pending,
			load(registration) {
				window.__pending.push(registration)
			},
		}
	})
	await page.goto(base, { waitUntil: 'load' })
	await page.waitForFunction(() => window.__PROBE__ !== undefined, { timeout: 15000 }).catch(() => {})
	const probe = await page.evaluate(() => window.__PROBE__ ?? null)

	/**
	 * **拖一次,用真实鼠标序列**。
	 * 为什么不能用合成事件:React Flow 的拖动走 d3-drag,它只认**真实输入序列**——
	 * 页面里 `dispatchEvent(new PointerEvent(...))` 它一概不理(试过:纹丝不动,
	 * 与「受控 nodes 没接 onNodesChange」的症状一模一样,分不清是哪个原因)。
	 * 所以这一段必须留在 Node 侧,由 Playwright 发真事件。
	 * 拖完再点另一个节点触发一次重渲染,确认界面状态**没被覆盖**。
	 */
	const drag = { before: null, moved: null, kept: null, error: null }
	try {
		const box = await page.locator('.react-flow__node').first().boundingBox()
		drag.before = await page.evaluate(() => document.querySelector('.react-flow__node').style.transform)
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 12 })
		await page.mouse.up()
		await page.waitForTimeout(350)
		drag.moved = await page.evaluate(() => document.querySelector('.react-flow__node').style.transform)
		await page.evaluate(() => {
			const other = document.querySelectorAll('.react-flow__node')[1]
			if (other !== undefined) other.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
		})
		await page.waitForTimeout(500)
		drag.kept = await page.evaluate(() => document.querySelector('.react-flow__node').style.transform)
	} catch (error) {
		drag.error = String(error?.message ?? error)
	}
	await browser.close()
	server.close()

	let failed = 0
	const check = (label, ok, detail = '') => {
		console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || detail === '' ? '' : ` — ${detail}`}`)
		if (!ok) failed += 1
	}

	console.log(`\n【真浏览器图谱检查 · Chrome · React ${probe?.reactVersion ?? '?'}】`)
	if (probe === null) {
		check('探针跑完了(页面没有静默死掉)', false, consoleErrors.join(' | ').slice(0, 200))
	} else if (probe.ok !== true) {
		check('导入与渲染没有抛错', false, String(probe.error))
	} else {
		check('客户端工厂能按宿主契约物化(require 只吃两个种子字)', true)
		check('没有退化成「图组件不可用」', probe.degraded === false, String(probe.reason ?? ''))
		check('React Flow 真的挂上了(.react-flow 在)', probe.canvas > 0, `canvas=${probe.canvas}`)
		check('节点画出来了', probe.nodes > 0, `nodes=${probe.nodes}`)
		check('边画出来了', probe.edges > 0, `edges=${probe.edges}`)
		check('控件与迷你地图都在(库的零件真的用上了)', probe.controls > 0 && probe.minimap > 0, `controls=${probe.controls} minimap=${probe.minimap}`)
		check('样式注入进去了(缺了布局会散)', probe.styleInjected === true)
		check('拖得动(受控 nodes 必须接住 onNodesChange)', drag.moved !== null && drag.moved !== drag.before, `${String(drag.before)} → ${String(drag.moved)}${drag.error === null ? '' : ` (${drag.error})`}`)
		check('拖完还在(重渲染不覆盖界面状态)', drag.kept === drag.moved, `${String(drag.moved)} → ${String(drag.kept)}`)
	}
	if (consoleErrors.length > 0) console.log(`  · 页面错误:${consoleErrors.slice(0, 3).join(' | ')}`)

	console.log(failed === 0 ? '\n浏览器图谱检查通过。' : `\n浏览器图谱检查失败:${failed} 项。`)
	process.exit(failed === 0 ? 0 : 1)
} finally {
	rmSync(stage, { recursive: true, force: true })
}
