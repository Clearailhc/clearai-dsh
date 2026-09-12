#!/usr/bin/env node
/**
 * 发布前 recheck(机械面)。对应 `docs/pre-release-recheck.md`。
 *
 * 它做三件事:
 *   ① 跑**全部单测**(五套)与**装机自检**——功能面;
 *   ② 用一场**真会话**在 node 里渲染**每一块面**的真组件,量出**字数**,与预算比 —— 信息面;
 *   ③ 列出**机器验不了**的人工项,提醒去点一遍。
 *
 * 为什么要有「字数预算」这一节:信息堆积不会让任何断言变红 ✗ ——
 * 它是本项目反复吃到的亏(世界树 1794 字、技能页 4741 字都是**量出来**才发现的)。
 * 预算不是审美洁癖:它是"默认少而准、细节靠点开"这条纪律的可执行判据。
 *
 * 用法:
 *   node tools/recheck.mjs [--log <session.v3.jsonl[.zstd]>] [--skip-suites]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEvent, emptyState, view } from '../ui/lib/fold.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = resolve(HERE, '..')

const argv = process.argv.slice(2)
const flagValue = (name) => {
	const at = argv.indexOf(name)
	return at === -1 ? null : (argv[at + 1] ?? null)
}
const LOG = flagValue('--log')
const SKIP_SUITES = argv.includes('--skip-suites')

/** 每一块面的**字数预算**(拿真数据渲染出来的可见文字数)。 */
const BUDGETS = [
	// §35:输入框下那条(StatusStrip)与档位开关(TierControl)都删了 ⇒ 预算表跟着它们走
	{ surface: '计划面(工具行)', limit: 40, pick: (C, props) => C.PlanChip(props) },
	{ surface: '续跑注(工具行,只在有话时说)', limit: 40, pick: (C, props) => C.ContinuationNote(props) },
	{ surface: '事实(默认)', limit: 1500, pick: (C, props) => C.Facts(props) },
	{ surface: '命题展开(一条)', limit: 1600, pick: (C, props, data) => C.PropositionShelf({ data, open: (data.goal?.hypotheses ?? []).find((h) => h.status !== 'confirmed')?.id ?? null, onToggle: () => {} }) },
	{ surface: '世界树', limit: 900, pick: (C, props) => C.WorldTree(props) },
	{ surface: '技能 · 记忆', limit: 2600, pick: (C, props) => C.BrainTab(props) },
]

let failed = 0
const line = (text = '') => console.log(text)
const section = (title) => line(`\n=== ${title} ===`)

// ── ① 单测与装机自检 ────────────────────────────────────────────────────────
if (!SKIP_SUITES) {
	section('① 单测(五套)')
	try {
		const out = execFileSync('bash', [join(PORT, 'test', 'run.sh')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
		const summary = out.split('\n').find((row) => row.includes('通过,')) ?? '(没有结果行)'
		line(`  ${summary.trim()}`)
		if (!/,0 失败/.test(summary)) failed += 1
	} catch (error) {
		failed += 1
		line(`  ✗ 测试没过:${String(error?.message ?? error).slice(0, 200)}`)
	}
	section('② 装机自检(部署的文件与配置自洽)')
	try {
		const out = execFileSync('node', [join(PORT, 'tools', 'verify-deploy.mjs')], { encoding: 'utf8' })
		line(`  ${out.trim().split('\n').slice(-1)[0]}`)
	} catch (error) {
		failed += 1
		line(`  ✗ 自检没过:${String(error?.message ?? error).slice(0, 200)}`)
	}
}

// ── ③ 逐面字数(信息堆积的唯一可执行判据)──────────────────────────────────
section('③ 逐面字数(预算 = 反堆积)')
if (LOG === null || !existsSync(LOG)) {
	line('  (没给 --log,跳过:拿一场有内容的真会话再量)')
} else {
	const raw = LOG.endsWith('.zstd') ? execFileSync('zstd', ['-dc', LOG], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }) : readFileSync(LOG, 'utf8')
	let state = emptyState()
	for (const row of raw.split('\n')) {
		if (row.trim() === '') continue
		try {
			state = applyEvent(state, JSON.parse(row))
		} catch {
			/* 坏行跳过 */
		}
	}
	const projected = view(state)
	// 用**部署的**客户端 bundle(与真机同一份),而不是源文件
	const client = readFileSync(join(PORT, 'ui', 'lib', 'client.js'), 'utf8')
	let registration = null
	globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
	const React = {
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
		useState: (value) => [value, () => {}],
		useEffect: () => {},
		useRef: () => ({ current: null }),
		useMemo: (factory) => factory(),
		useCallback: (factory) => factory,
	}
	const require = (name) => {
		if (name === 'react') return React
		if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconBranchOutline16: () => null, IconSkillOutline16: () => null }
		throw new Error(`不该 require ${name}`)
	}
	new Function('window', 'require', 'console', client)(globalThis.window, require, console)
	const C = registration.factory(require).__components
	const data = { ...projected, openPreview: () => {}, openRail: () => {}, openSpectator: () => {} }
	const props = { useProjection: () => data, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: data } } } }), sessionId: 's1', openPreview: () => {}, openRail: () => {}, openSpectator: () => {} }
	const texts = []
	const visit = (node) => {
		if (node === null || node === undefined || node === false || node === true) return
		if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return }
		if (Array.isArray(node)) { node.forEach(visit); return }
		if (typeof node !== 'object') return
		if (typeof node.type === 'function') { visit(node.type({ ...(node.props ?? {}), children: node.children })); return }
		visit(node.children ?? [])
	}
	line(`  会话:目标 ${projected.goal === null ? '无' : '有'} · 计划 ${(projected.plans ?? []).length} 份 · 命题 ${(projected.goal?.hypotheses ?? []).length} 条 · 事实 ${(projected.facts ?? []).length} 条`)
	for (const budget of BUDGETS) {
		texts.length = 0
		try {
			visit(budget.pick(C, props, data))
		} catch (error) {
			failed += 1
			line(`  ✗ ${budget.surface}:渲染就炸了 — ${String(error?.message ?? error).slice(0, 120)}`)
			continue
		}
		const chars = texts.join(' · ').replace(/\s+/g, ' ').trim().length
		const over = chars > budget.limit
		if (over) failed += 1
		line(`  ${over ? '✗' : '✓'} ${budget.surface}:${chars} 字(预算 ${budget.limit})${over ? ' — 超预算,先问"哪一行该挪进 tooltip / 哪两条在说同一件事"' : ''}`)
	}
}

// ── ④ 人工项(机器验不了)─────────────────────────────────────────────────
section('④ 人工闸(在隔离家里点一遍,见 docs/pre-release-recheck.md)')
for (const item of [
	'新建对话 → 发一句话 → 模型回话(证明没把 app 拖垮)',
	'中栏有「产物 / 事实」;右栏「+」里有「世界树 / 技能 · 记忆」',
	'命题展开:走过那跳有证据 id;点证据出处开得出预览',
	'点「在世界树里看这一步」⇒ 树打开且那一行被选中',
	'树详情「看这一步的证据」⇒ 切回事实并展开对应命题',
	'步骤详情的产物显示真实路径、没查过的不写「缺」',
	'多份计划的会话:下拉能切到旧世界树',
	'工具行没有档位开关(§34);计划 chip 上「需要你 N」一点直达世界树(§35)',
	'输入框下**没有**我们那一行(§35);续跑停着/已撤回只在有话时出现在工具行',
]) line(`  · ${item}`)

section(failed === 0 ? '结果:机械面全过(人工闸还要点)' : `结果:${failed} 项没过`)
process.exit(failed === 0 ? 0 : 1)
