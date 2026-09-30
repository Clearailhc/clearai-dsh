/**
 * panel-shots —— 用**真会话的投影**给面板拍照(营销与文档素材)。
 *
 * 与 `graph-shots.mjs` 同一条纪律,只是拍的面更多:折一份真会话日志 → 同一份 `view()`
 * → 把**真组件**(构建出来的那一份客户端)挂进真 Chrome 渲染 → 截图。
 * 面板里的每个数字都来自投影或盘上真有的文件,没有一处是手写的。
 *
 * 两条读面在浏览器里是 fetch(`/api/clearai/deliverables`、`/api/clearai/brain`),
 * 这里按 `ui/lib/index.js` 的**同一形状**在 Node 侧算好、注入页面 —— 算的依据同样是
 * 投影 + 工作区盘上的文件;字段映射不另立一套(改读面时这里要跟着改,注释里指得出出处)。
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
import { dirname, join, relative, resolve, sep } from 'node:path'
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

const wanted = option('--session')
if (wanted === undefined) {
	console.log('用法:node tools/panel-shots.mjs --session <id 前缀> [--out docs/marketing/zhihu/images] [--prefix panel]')
	console.log('      node tools/panel-shots.mjs --list')
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

const { state, header } = foldSession(match.file)
const cwd = typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : null
const sessionId = match.sid
const projection = view(state, sessionId)
const derived = derive(state)
const outDir = join(PORT, option('--out') ?? join('docs', 'marketing', 'zhihu', 'images'))
const prefix = option('--prefix') ?? 'panel'
mkdirSync(outDir, { recursive: true })

/**
 * ── 交付物读面的数据面(镜像 `ui/lib/index.js` 的 `/api/clearai/deliverables`)──
 * 形状逐字段对齐,面板因此能走同一套行渲染;存在性来自盘上的 stat,不是投影里的声明。
 *
 * 吃的是**原始账本状态**(`state`),不是 `view()` 的投影 —— 宿主那条读面就是
 * `ctx.sessionProjections.stateOf(session,'clearai')`,字段是 snake_case
 * (`done_criteria` / `confirmed_at`),产物是字符串路径。
 */
const pathAreaOf = (path) => {
	const clean = String(path ?? '').replace(/^\.\//, '')
	if (clean === 'PROJECT.md' || clean === 'project.md') return { key: 'constitution', label: '章程' }
	if (clean.startsWith('input/')) return { key: 'input', label: '项目资料' }
	if (clean.startsWith('lab/')) return { key: 'process', label: '分析过程' }
	if (clean.startsWith('products/')) return { key: 'output', label: '输出成果' }
	if (clean.startsWith('clear/')) return { key: 'brain', label: '外脑' }
	return { key: 'other', label: '未分类' }
}
const resolveInside = (base, candidate) => {
	if (typeof candidate !== 'string' || candidate === '') return null
	const root = resolve(base)
	const target = resolve(root, candidate)
	if (target !== root && !target.startsWith(`${root}${sep}`)) return null
	return target
}
const OUTPUT_MAX_DEPTH = 5
const OUTPUT_MAX_SCAN = 2000
const OUTPUT_MAX_FILES = 200
const listWorkspaceOutputs = (base) => {
	const root = resolveInside(base, 'products')
	if (root === null) return []
	const workspaceRoot = resolve(base)
	const found = []
	let scanned = 0
	const walk = (dir, depth) => {
		if (depth > OUTPUT_MAX_DEPTH || scanned >= OUTPUT_MAX_SCAN) return
		let entries = []
		try {
			entries = readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (scanned >= OUTPUT_MAX_SCAN) return
			if (entry.name.startsWith('.')) continue
			const absolute = join(dir, entry.name)
			if (entry.isDirectory()) {
				walk(absolute, depth + 1)
				continue
			}
			if (!entry.isFile()) continue
			scanned += 1
			try {
				const info = statSync(absolute)
				found.push({ relative: relative(workspaceRoot, absolute), bytes: info.size, modifiedAt: info.mtimeMs })
			} catch {
				continue
			}
		}
	}
	walk(root, 1)
	return found.sort((left, right) => right.modifiedAt - left.modifiedAt).slice(0, OUTPUT_MAX_FILES)
}
const deliverablesPayload = (base, raw) => {
	if (base === null) return { ok: false, error: 'no_live_session' }
	const stages = (raw.plans ?? []).map((plan) => ({
		plan: plan.id,
		status: plan.status,
		brief: plan.brief ?? '',
		confirmedAt: plan.confirmed_at ?? null,
		openedAt: plan.at ?? null,
		closedAt: plan.closedAt ?? null,
		summary: plan.summary ?? null,
		steps: (plan.steps ?? []).map((step) => ({
			id: step.id,
			ordinal: step.ordinal,
			do: step.do,
			status: step.status,
			doneCriteria: step.done_criteria,
			level: step.tests?.level ?? null,
			advancedAt: step.advancedAt ?? null,
			voidReason: step.voidReason ?? null,
			artifacts: (step.artifacts ?? []).map((entry) => {
				/**
				 * 投影里的产物是 `{ path, exists }`(声明,不读盘);宿主读面吃的是原始账本里的
				 * 字符串路径。这里统一取路径 —— 盘上真不真的问题由下面的 stat 回答。
				 */
				const artifact = typeof entry === 'string' ? entry : String(entry?.path ?? '')
				const absolute = resolveInside(base, artifact)
				let info = null
				try {
					info = absolute === null ? null : statSync(absolute)
				} catch {
					info = null
				}
				const isFile = info !== null && info.isFile()
				return {
					path: artifact,
					area: pathAreaOf(artifact),
					exists: isFile,
					directory: info !== null && info.isDirectory(),
					bytes: isFile ? info.size : null,
					modifiedAt: isFile ? info.mtimeMs : null,
				}
			}),
		})),
	}))
	const declared = new Set(stages.flatMap((stage) => stage.steps.flatMap((step) => step.artifacts.map((artifact) => artifact.path))))
	const outputs = listWorkspaceOutputs(base)
		.filter((item) => !declared.has(item.relative))
		.map((item) => ({ path: item.relative, area: pathAreaOf(item.relative), exists: true, bytes: item.bytes, modifiedAt: item.modifiedAt, declared: false }))
	return { ok: true, stages, outputs }
}

/**
 * 默认三面:**本体格 / 产物 / 世界树**。
 * 「外脑」(`--panels brain`)不默认拍:它列的是这台机器上**个人**的技能目录
 * (`~/.agents/skills/...`),素材要发出去,路径不该跟着走。
 */
const PANELS = (option('--panels') ?? 'ontology,deliverables,worldlines').split(',').map((item) => item.trim()).filter((item) => item !== '')
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
		:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f8fa;--dsw-alias-label-primary:#1f2328;--dsw-alias-label-secondary:#5c6370;--dsw-alias-label-tertiary:#8b93a1;--dsw-alias-border-l1:#e6e8eb;--dsw-alias-border-l2:#dfe2e6;--dsw-alias-border-l3:#d0d4d9;--dsw-alias-state-warn-primary:#d9822b}
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
		deliverables: { useProjection: () => projection, useSessions, sessionId, openRail: noop, openPreview: () => true },
		worldlines: { useSessions, sessionId, openPreview: () => true, openSpectator: noop },
		brain: { useProjection: () => projection, useSessions, sessionId, openRail: noop, openPreview: () => true },
	}
	const component = { ontology: C.Facts, deliverables: C.Deliverables, worldlines: C.WorldTree, brain: C.BrainTab }
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
	/** 两条读面在浏览器里走 fetch;这里按宿主同一形状注入(数据在 Node 侧由投影 + 盘上文件算出)。 */
	const json = (payload) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }))
	const real = window.fetch.bind(window)
	window.fetch = (input, init) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? ''))
		if (url.includes('/api/clearai/deliverables')) return json(window.__DELIVERABLES__)
		if (url.includes('/api/clearai/inspector')) return json(window.__INSPECTOR__ ?? { ok: true, found: false })
		if (url.includes('/api/clearai/')) return json({ ok: false, error: 'shot_stub' })
		return real(input, init)
	}
})()`,
	)
	// prefetch 必须在客户端 bundle 之前跑(它要拦住面板的 fetch)。
	const html = readFileSync(join(stage, 'index.html'), 'utf8').replace('<script src="/runtime.js">', '<script src="/prefetch.js"></script><script src="/runtime.js">')
	writeFileSync(join(stage, 'index.html'), html)

	const deliverables = deliverablesPayload(cwd, state)
	const inspector = (() => {
		const node = (projection.lexicon?.graph?.nodes ?? []).find((item) => item.layer === 'ontology')
		if (node === undefined) return { ok: true, found: false }
		const found = inspectGraphSelection(state, { kind: 'node', id: node.id }, derived)
		return found === null ? { ok: true, found: false } : { ok: true, found: true, inspector: found }
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

	const browser = await chromium.launch({ channel: 'chrome', headless: true })
	const page = await browser.newPage({ viewport: { width: 780, height: 940 }, deviceScaleFactor: 2 })
	await page.addInitScript(() => {
		window.__pending = []
		window.__ModuleLoader__ = { mode: 'queue', pendingQueue: window.__pending, load: (registration) => window.__pending.push(registration) }
	})
	await page.addInitScript(
		(payloads) => {
			window.__PROJECTION__ = payloads.projection
			window.__SID__ = payloads.sessionId
			window.__DELIVERABLES__ = payloads.deliverables
			window.__INSPECTOR__ = payloads.inspector
		},
		{ projection, sessionId, deliverables, inspector },
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
