/**
 * panel-preview —— **终端版的面板预览**:把一份真会话日志折成投影,再把面板要画的东西
 * 按同一条数据路径打印出来。
 *
 * 为什么需要它(2026-09-11 做长测时写的):面板那几页(世界树 / 产物 / 外脑 / 状态条)
 * 平时只能在浏览器里看,而「跑完之后到底显示什么」是每次改完都要回答的问题。
 * 真跑是 headless 的、没有客户端;靠肉眼看浏览器又不可重复、也没法进 CI。
 * 于是把**数据面**这一段抽出来:同一份 fold、同一批纯函数(客户端包导出的 `__topology`
 * 与 `fold.js` 的 view),在终端里打印成文字版。
 *
 * 它验的是「面板拿到的数据对不对」,不验渲染(渲染由 client.test.mjs 的冒烟与 SVG 断言盯)。
 *
 * 跑法:
 *   node tools/panel-preview.mjs <工作区目录> [会话序号]
 *   node tools/panel-preview.mjs --log <session.v3.jsonl[.zstd]>
 * 不给会话序号就取最近一个会话(mtime 最新)。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 会话目录名是工作区路径的 slug(与 DSH 自己那一套一致)。 */
function sessionDirFor(workspaceDir) {
	const slug = `--${workspaceDir.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/, '')}--`
	return join(DSH_HOME, 'sessions', slug)
}

function sessionsIn(dir) {
	if (!existsSync(dir)) return []
	const found = []
	for (const entry of readdirSync(dir)) {
		const inner = join(dir, entry)
		let files = []
		try {
			files = readdirSync(inner)
		} catch {
			continue
		}
		const log = files.find((name) => name.startsWith('session') && (name.endsWith('.jsonl') || name.endsWith('.jsonl.zstd')))
		if (log === undefined) continue
		const full = join(inner, log)
		found.push({ id: entry, log: full, mtime: statSync(full).mtimeMs })
	}
	return found.sort((left, right) => right.mtime - left.mtime)
}

/** 多帧 zstd:node 自带的解压只解第一帧,所以用系统的 zstd(与 e2e-run 同一条路)。 */
function readEvents(logPath) {
	const raw = logPath.endsWith('.zstd')
		? execFileSync('zstd', ['-dc', logPath], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
		: readFileSync(logPath, 'utf8')
	const events = []
	for (const line of raw.split('\n')) {
		const trimmed = line.trim()
		if (trimmed === '') continue
		try {
			events.push(JSON.parse(trimmed))
		} catch {
			/* 坏行跳过:预览工具不该因为一行坏数据什么都不显示 */
		}
	}
	return events
}

const argv = process.argv.slice(2)
/** 带值的旗标:`--旗舰 值`。位置参数(工作区、会话号)要把它们和它们的值都摘出去。 */
const VALUE_FLAGS = new Set(['--log', '--card-lines'])
const positional = argv.filter((item, index) => !item.startsWith('--') && !VALUE_FLAGS.has(argv[index - 1] ?? ''))
/** `--card-lines N`:卡片(模型每回合看到的那份事实)打印多少行。默认 12(节选),0 = 全打。 */
const cardLinesFlag = argv.indexOf('--card-lines')
const cardLines = cardLinesFlag >= 0 ? Number(argv[cardLinesFlag + 1] ?? 12) : 12
const logFlag = argv.indexOf('--log')
let logPath = null
let label = ''
if (logFlag >= 0) {
	logPath = argv[logFlag + 1] ?? null
	label = String(logPath)
} else {
	const workspace = resolve(positional[0] ?? process.cwd())
	const dir = sessionDirFor(workspace)
	const sessions = sessionsIn(dir)
	const wanted = positional[1]
	// 会话目录名有 `session-<uuid>` 与 `<uuid>` 两种(不同版本留下的),所以按**子串**找。
	const picked = wanted === undefined ? sessions[0] : (sessions.find((item) => item.id.includes(wanted)) ?? null)
	if (picked === null || picked === undefined) {
		console.log(`找不到会话。工作区:${workspace}\n会话目录:${dir}\n(那里有 ${sessions.length} 个会话)`)
		process.exit(1)
	}
	logPath = picked.log
	// 会话目录名有 `session-<uuid>` 与 `<uuid>` 两种:显示 uuid 那一段,别显示成 "session-"。
	const shortId = (picked.id.replace(/^session-/, '') || picked.id).slice(0, 8)
	label = `${workspace} · 会话 ${shortId}`
}

const events = readEvents(logPath)
const { applyEvent, emptyState, view, derive, renderCard } = await import(join(PORT, 'ui', 'lib', 'fold.js'))
let state = emptyState()
for (const event of events) state = applyEvent(state, event)
const projected = view(state)
const derived = derive(state)

// 客户端的**纯函数**(与浏览器里跑的是同一份代码):树的行与四条通道从这里来。
const clientSource = readFileSync(join(PORT, 'ui', 'lib', 'client.js'), 'utf8')
let topology = null
try {
	let registration = null
	globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
	const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), useState: (v) => [v, () => {}], useEffect() {}, useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f }
	const requireStub = (name) => {
		if (name === 'react') return react
		throw new Error(`client bundle 不该 require "${name}"`)
	}
	new Function('window', 'require', 'console', clientSource)(globalThis.window, requireStub, console)
	delete globalThis.window
	topology = registration.factory(requireStub).__topology
} catch (error) {
	console.log(`(客户端包加载失败,树那一页跳过:${String(error?.message ?? error).slice(0, 120)})`)
}

const line = (text = '') => console.log(text)
line(`══ 面板预览 · ${label}`)
line(`事件 ${events.length} 条 · 工具调用 ${events.filter((e) => e.type === 'tool/call').length} 次`)

// ── 三块面各说各的话(§17 的分工)────────────────────────────────────────────
//
//   · 原生 plan 座位(`conversation.input.plan`,本模式里原生那个控件不渲染)= **我们的计划芯片**;
//   · 原生 goal dock(输入框上方)= 平台自己的对象:续跑窗口的相位与轮数;
//   · 输入框下那条 = 门与运行态,以及**平台说不出来的那句话**(为什么停 / 撤回了)。
// 一个事实只在一块面上说,所以这里也照这个分工打印——预览与界面同一条数据路径。
line('')
line('【工具行(能点的东西)】')
{
	// §18:控制归工具行,事实归输入框下方。tooltip 里的内部 id 不上界面。
	const tierValue = (projected.autonomy ?? {}).value
	line(`  续跑档:${tierValue === 'unattended' ? '自己拿主意' : tierValue === 'attended' ? '多问我' : '(还没定档)'}(文档里叫${tierValue === 'unattended' ? '无人值守' : '在场/无人值守'})`)
	if (projected.plan === null) line('  计划:(还没有计划,原生 plan 座位空着)')
	else {
		const p = projected.plan
		const label =
			p.confirmationPending === true ? '计划 · 等你确认' : p.blocked == null ? (p.status === 'closed' ? '计划 · 已收尾' : `计划 · ${p.advancedCount}/${p.totalCount} 步`) : '计划 · 受阻'
		line(`  ${label}   tooltip: ${p.id}${p.brief ? ` · ${p.brief}` : ''}`)
	}
}

line('')
line('【输入框下那条】')
const autonomy = projected.autonomy ?? {}
const holdWhy = { audit: '等独立裁决', plan_confirm: '计划待确认', gate: '有人在等你', goal_boundary: '一阶段收尾,下一阶段由人给' }
const cont = projected.continuation ?? null
const contNote = cont === null ? '' : cont.state === 'paused' ? ` · 续跑停着:${holdWhy[cont.why] ?? cont.why ?? '策略暂停'}` : cont.state === 'withdrawn' ? ' · 续跑已撤回(面板上被清空)' : ''
{
	// 只放事实:门、阶段、进度、第几步、待评估、续跑为什么停(档位与计划都在工具行)。
	const openStep = (projected.plan?.steps ?? []).find((step) => step.status === 'open') ?? null
	const stepText = openStep === null ? '' : ` · 第 ${openStep.ordinal} 步 ${String(openStep.do ?? '').trim().slice(0, 12)}`
	const auditWait = (projected.audits ?? []).filter((audit) => audit.verdict == null).length
	line(`  需要你 ${projected.inbox.length} · 阶段 ${derived.phase ?? '—'} · 完成度 ${projected.goal?.progress == null ? '—' : `${Math.round(projected.goal.progress * 100)}%`}${stepText}${auditWait > 0 ? ` · 待评估 ${auditWait}` : ''}${contNote}`)
	if (projected.goal === null) line('  (没有目标:这条整条不渲染——它是事实面,此刻没有事实)')
}
void autonomy

// ── 续跑窗口:平台那个对象 + 我们对它说过的账 ─────────────────────────────────
line('')
line('【续跑窗口(§17)】')
{
	// 平台那一侧的事实只在会话日志里(`goal/change`),不在我们的投影里——那是**别人的**账。
	const goalChanges = events.filter((event) => event.type === 'goal/change')
	const lastGoal = goalChanges.map((event) => event.data).filter((data) => data?.goal !== undefined).slice(-1)[0]
	const cleared = goalChanges.map((event) => event.data).filter((data) => data?.operation === 'clear')
	if (goalChanges.length === 0) line('  (平台目标一次都没动过:本会话没有布防过续跑窗口)')
	else {
		line(`  平台对象:${goalChanges.length} 次变更 · ${cleared.length} 次清空`)
		if (lastGoal === undefined) line('  当前:没有目标(被清空过)')
		else line(`  当前:${lastGoal.goal.phase} · 第 ${lastGoal.roundsStarted}/${lastGoal.goal.maxGoalRounds} 轮 · objective=「${lastGoal.goal.objective}」`)
	}
	line(`  我们的账:${cont === null ? '(还没有:本会话没布过防)' : `${cont.state}${cont.why === null ? '' : `(${cont.why})`} · 服务 ${cont.target ?? '—'} · 令牌 ${cont.goal ?? '—'}`}`)
}

// ── 世界树 ──────────────────────────────────────────────────────────────────
line('')
line('【世界树】')
if (topology === null) {
	line('  (跳过)')
} else if (projected.plan === null) {
	line('  还没有计划。')
} else {
	const rows = topology.treeRows(projected.plan, projected.forks)
	const context = { blocks: projected.blocks ?? null, audits: projected.audits ?? [], planId: projected.plan.id }
	const gutter = Math.max(...rows.map((row) => row.lane), 0) + 1
	for (const [index, row] of rows.entries()) {
		const marks = topology.treeMarks(row, context)
		const arcs = topology.treeArcs(marks)
		// 一条通道一个记号:实心/空心、颜色名、光环、弧数——与画布上那四条通道一一对应。
		const fill = marks.settled ? '●' : '○'
		const color = Object.entries(topology.TREE_COLOR).find(([, value]) => value === marks.color)?.[0] ?? '?'
		const halo = marks.auditing ? '虚线环' : marks.live ? '呼吸' : '—'
		const trail = `${' '.repeat(row.lane)}${fill}`
		const what =
			row.kind === 'branch'
				? `车道 ${row.branch.label}`
				: row.kind === 'converge'
					? `收敛(${row.fork.phase})`
					: row.kind === 'abandoned'
						? `放弃的分叉(${row.fork.abandonReason ?? '无缘由'})`
						: row.kind === 'fork'
							? `分叉点 ${row.step.id}`
							: `步 ${row.step.id}`
		const flags = [marks.greyed ? '变灰' : null, marks.done ? '划线' : null].filter(Boolean).join('/')
		line(`  ${String(index).padStart(2)} ${trail.padEnd(gutter + 1)} ${what.padEnd(28)} 色=${color.padEnd(9)} 光环=${halo.padEnd(6)} 弧=${arcs.length}${arcs.some((arc) => arc.fail) ? `(驳回 ${arcs.filter((arc) => arc.fail).length})` : ''} ${flags}`)
	}
	line(`  车道宽 ${gutter} · 连接 ${topology.treeConns(rows).length} 条(扇出/扇入都在里面)`)
}

// ── 事实那一格(§24):上架=已确认事实,下架=命题(按本体状态分组)────────────
{
	line('\n【事实那一格(货架:上架=已确认事实 · 下架=命题)】')
	const facts = projected.facts ?? []
	const rows = (projected.goal?.hypotheses ?? []).filter((row) => row.status !== 'confirmed')
	const evidence = projected.evidence ?? []
	// 与界面同一条链:走**跨计划**的步骤索引(命题的验证步常在已收尾的旧计划里)
	const index = projected.stepIndex ?? {}
	const evidenceOf = (id) => evidence.filter((item) => index[item.stepId]?.tests?.hypothesis === id).slice().sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
	line(`  已确认事实 · ${facts.length}`)
	for (const row of facts) line(`    · ${row.text}\n      边界:${row.scope ?? '(未写)'} · 支持到 ${row.level ?? '—'} · 货架 file clear/knowledge/facts/INDEX.md`)
	line(`  命题 · ${rows.length}`)
	for (const group of [['proposed', '已提出'], ['alive', '验证中'], ['refuted', '已推翻'], ['superseded', '已替代'], ['retracted', '已撤回']]) {
		const inGroup = rows.filter((row) => row.status === group[0])
		if (inGroup.length === 0) continue
		line(`    ${group[1]} ${inGroup.length}`)
		for (const row of inGroup) {
			const own = evidenceOf(row.id)
			const best = own.slice().sort((a, b) => String(b.level ?? '').localeCompare(String(a.level ?? '')))[0]
			line(`      · ${row.claim}`)
			// 处境一句话与组件同源:先判终态,再说等级(与 whereOf 同一顺序,别在两处说两套)
			const refute = own.find((item) => item.verdict === 'refute')
			// 与界面同一条规矩:列表只放摘要(依据常常是几百字的一整段,原样内联会把一行撑爆)
			const clip = (value, max) => {
				const text = String(value ?? '').replace(/\s+/g, ' ').trim()
				return text.length <= max ? text : `${text.slice(0, max)}…`
			}
			const where = row.status === 'refuted' ? (refute === undefined ? '出现推翻证据(终态,记录保留)' : `被 ${refute.id} 推翻:${clip(refute.basis, 56)}`) : row.supportedLevel === null || row.supportedLevel === undefined ? '还没有证据:先登记判据,再验证' : `支持到 ${row.supportedLevel}`
			line(`        处境:${where} · 证据 ${own.length} 条${best === undefined ? '' : ` · 最有力 ${best.level} ${best.evaluator}`}`)
			// 流转(只在读面上画:走过的那一跳 + 当前态;未走的不画)
			const path = []
			if (own.length > 0) path.push(`已提出 ──有了第一条证据(${own[0].id} · ${own[0].level} ${own[0].verdict})──▶ 验证中`)
			if (row.status === 'refuted') path.push(refute === undefined ? '──出现推翻证据──▶ 已推翻' : `──出现推翻证据(${refute.id} · ${refute.evaluator})──▶ 已推翻`)
			if (row.status === 'superseded') path.push('──被下一版改写──▶ 已替代')
			if (path.length > 0) line(`        流转:${path.join(' ')}${row.status === 'refuted' ? ' · 当前:已推翻' : row.status === 'alive' ? ' · 当前:验证中' : ''}`)
		}
	}
}

// ── 产物(声明 vs 实际的前一半;盘上那一半由宿主路由现场 stat)────────────────
line('')
line('【产物】')
const steps = projected.plan?.steps ?? []
line(`  阶段 1 · 交付 ${steps.filter((step) => step.status === 'advanced').length}/${steps.length}`)
for (const step of steps) {
	for (const artifact of step.artifacts ?? []) {
		line(`  ${step.id} ${artifact}`)
	}
}
if (steps.every((step) => (step.artifacts ?? []).length === 0)) line('  (没有声明过产物)')

// ── 外脑(章程 + 技能 + 记忆)────────────────────────────────────────────────
line('')
line('【外脑】')
const constitution = projected.constitution
if (constitution === null || constitution === undefined) {
	line('  章程:还没有读数(内核下一次 pre-step 会发)')
} else {
	// 只有文件系统事实(2026-09-11 砍掉了「占位 X/Y 条」与 §1 解析:改一个标点「事实」就变)。
	line(`  章程:${constitution.legacy === true ? 'clear/project.md' : 'PROJECT.md'} · 最后改动 ${new Date(constitution.modifiedAt).toISOString().slice(0, 16).replace('T', ' ')} · ${constitution.bytes} 字节`)
}
const catalog = projected.skills?.catalog?.entries ?? []
line(`  技能目录:${catalog.length} 条(模板/本项目/我的/记忆索引)`)
const usage = projected.skills?.usage ?? []
line(`  本会话用量:${usage.length === 0 ? '(无)' : usage.map((item) => `${item.name}(模型${item.model}/人${item.human})`).join('、')}`)
line(`  候选技能:${(projected.brain?.skills ?? []).filter((skill) => skill.status === 'candidate').length} 条`)

// ── 运行态卡(模型每一回合看到的那份事实)────────────────────────────────────
line('')
const cardRows = renderCard(state).split('\n')
line(cardLines > 0 && cardRows.length > cardLines ? `【运行态卡(节选 ${cardLines}/${cardRows.length} 行;--card-lines 0 看全)】` : '【运行态卡(全)】')
for (const row of cardLines > 0 ? cardRows.slice(0, cardLines) : cardRows) line(`  ${row}`)

// ── 读数小结(给长测报告用)──────────────────────────────────────────────────
line('')
line('【读数】')
const mutationEvents = events.filter((event) => event.data?.meta?.kind === 'clearai')
line(`  变更记录 ${mutationEvents.length} 次 · 工具调用 ${events.filter((e) => e.type === 'tool/call').length} 次 · 分叉 ${projected.forks.length} 个 · 证据 ${projected.evidence.length} 条 · 侦察 ${projected.scouts.length} 次`)
line(`  闸门轮次:${Object.entries(projected.blocks ?? {}).flatMap(([plan, steps]) => Object.entries(steps ?? {}).map(([step, count]) => `${plan}/${step}=${count}`)).join('、') || '(无)'}`)
