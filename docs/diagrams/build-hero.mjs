/**
 * build-hero —— 产品主图「从循环长出本体」的唯一生成器。
 *
 * 画的是什么:
 *   · 左:认识论循环本身——品牌 c 环 + 七段刻度 + **七个阶段名与注解**(与
 *     `docs/epistemic-loop.md` 逐字一致),就是原来那张主图的左半,缩小搬过来。
 *   · 右:一个抽象本体图——**全部是实心圆**,与那颗事实点同一外观,只靠颜色分语义:
 *       深墨 = 概念(这门语言有哪些词)
 *       浅墨 = 值形态(一个词取值的样子)
 *       emerald 亮 = 事实点;emerald 柔 = 实例
 *     结构:循环的产出(事实点)长出第一个概念;概念分出子概念(继承)与实例(归属);
 *     子概念经谓词连到值形态;实例经两条断言连到两个不同的值——**那两个取值染 amber,冲突靠颜色说话**。
 *   · 桥:**品牌那颗 emerald 事实点就是本体图的第一个节点**。它坐在 c 的开口延长线上
 *     (开口朝 -35° 是品牌几何,不许掰直),一条真实的边从它连到第一个概念。
 *
 * 少即是多:六个节点,每个都一眼认得出;宁可少画,不靠缩小挤进来。
 * 统一:一种形状(圆)、三档笔画(1.8 / 1.4 / 1.6)、唯二彩色(emerald / amber)。
 *
 * 跑法:node docs/diagrams/build-hero.mjs   (需要 PATH 上有 google-chrome)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHROME = process.env.CHROME ?? 'google-chrome'
const W = 1600
const H = 900

const EMERALD = '#10B981'
const WARN = '#D97706'
/** 暗色底上 #D97706 发浊;同一族里换亮一档,语义不变(冲突色)。 */
const WARN_DARK = '#F59E0B'

const THEMES = {
	light: { bg: '#FBFAF7', ink: '#1C1A18', warn: WARN },
	dark: { bg: '#1C1A18', ink: '#FBFAF7', warn: WARN_DARK },
}
const FONT = 'Inter,"Noto Sans SC","Source Han Sans SC","PingFang SC",Helvetica,Arial,sans-serif'

// ── 左:认识论循环 ──────────────────────────────────────────────────────
const RING = { cx: 400, cy: 450, r: 205, stroke: 15, bezel: 173, openAt: -35, openHalf: 45 }
/**
 * 事实点的位置**照抄品牌主标的比例**:logo 里环心线 R=326、点心距环心 346.4(=1.0626R)、
 * 点 r=104(=0.319R)、开口朝 -35°。主图里只按比例缩放——点因此在开口的角平分线上,
 * 且贴着环(而不是飘在环外一截),这正是 logo 里那颗点的"相对位置"。
 */
const SEED_RATIO = 1.0626
/** 阶段名与注解逐字取自 docs/epistemic-loop.md / .zh-CN.md——改文案先改那里。 */
const STAGES = {
	zh: {
		items: [
			['界定', '问题与边界'],
			['提出假设', '一个命题'],
			['规划', '先写判据'],
			['观测', '实际发生'],
			['验证', '对照判据'],
			['评估', '评估证据'],
			['记录并行动', '留存、再走一步'],
		],
		size: 15.5,
		subSize: 10,
	},
	en: {
		items: [
			['Frame', 'bound the question'],
			['Hypothesize', 'a proposition'],
			['Plan', 'criteria first'],
			['Observe', 'what happened'],
			['Verify', 'against criteria'],
			['Evaluate', 'the evidence'],
			['Record and act', 'keep, then move'],
		],
		size: 15,
		subSize: 10,
	},
}
/** 事实点:坐在开口的角平分线上、环外一点——既是环的产出,又是本体图的第一个节点。 */
const SEED = {
	x: RING.cx + RING.r * SEED_RATIO * Math.cos((RING.openAt * Math.PI) / 180),
	y: RING.cy + RING.r * SEED_RATIO * Math.sin((RING.openAt * Math.PI) / 180),
	r: 20,
}

// ── 右:本体图(六个圆;深墨=概念,浅墨=值形态,emerald=实例)────────────
const R = { concept: 26, value: 17, instance: 21 }

const NODES = {
	seed: { x: SEED.x, y: SEED.y, r: SEED.r, fill: 'emerald', strength: 1 },
	hub: { x: 855, y: 425, r: R.concept, fill: 'ink', strength: 0.85 },
	conceptA: { x: 1075, y: 285, r: R.concept, fill: 'ink', strength: 0.85 },
	instance: { x: 1062, y: 580, r: R.instance, fill: 'emerald', strength: 0.55 },
	pillA: { x: 1292, y: 285, r: R.value, fill: 'ink', strength: 0.27 },
	/** 这两个取值就是那对冲突读数:染成 amber——产品里冲突用的就是这一族颜色。 */
	pillC: { x: 1300, y: 462, r: R.value, fill: 'warn', strength: 0.5 },
	pillD: { x: 1300, y: 665, r: R.value, fill: 'warn', strength: 0.5 },
}

const EDGES = [
	// 主脊:事实点 → 第一个概念(循环的产出落成本体的第一个词)
	{ id: 'birth', from: 'seed', to: 'hub', kind: 'birth' },
	// 概念继承(虚)
	{ id: 'isaA', from: 'hub', to: 'conceptA', kind: 'isa' },
	// 实例归属(轻虚)
	{ id: 'instOf', from: 'hub', to: 'instance', kind: 'instOf' },
	// 谓词:概念 → 值形态(实线箭头)
	{ id: 'predA', from: 'conceptA', to: 'pillA', kind: 'predicate' },
	// 断言:实例 → 两个不同的值(冲突;amber)
	{ id: 'assertC', from: 'instance', to: 'pillC', kind: 'assertion' },
	{ id: 'assertD', from: 'instance', to: 'pillD', kind: 'assertion' },
]

// ── 几何 ───────────────────────────────────────────────────────────────
const rad = (d) => (d * Math.PI) / 180
const n = (v) => (Math.round(v * 100) / 100).toString()

/** 两个圆之间的连线端点:沿心线各自让出半径 + 留白,箭头永远落在圆外侧。 */
function edgePoint(from, to, pad = 9) {
	const dx = to.x - from.x
	const dy = to.y - from.y
	const len = Math.hypot(dx, dy) || 1
	return { x: from.x + (dx / len) * (from.r + pad), y: from.y + (dy / len) * (from.r + pad) }
}

const segmentOf = (edge) => ({ start: edgePoint(NODES[edge.from], NODES[edge.to]), end: edgePoint(NODES[edge.to], NODES[edge.from]) })

// ── 绘制 ───────────────────────────────────────────────────────────────
const EDGE_STYLE = {
	birth: { width: 2.4, opacity: 0.5, marker: true, dash: null },
	predicate: { width: 2.2, opacity: 0.46, marker: true, dash: null },
	isa: { width: 1.9, opacity: 0.3, marker: false, dash: '7 5' },
	instOf: { width: 1.9, opacity: 0.26, marker: false, dash: '7 5' },
	assertion: { width: 2, opacity: 0.55, marker: false, dash: null, color: 'warn' },
}

function edgeSvg(theme, edge) {
	const st = EDGE_STYLE[edge.kind]
	const { start, end } = segmentOf(edge)
	const color = st.color === 'warn' ? theme.warn : (st.color ?? theme.ink)
	return `<line x1="${n(start.x)}" y1="${n(start.y)}" x2="${n(end.x)}" y2="${n(end.y)}" stroke="${color}" stroke-opacity="${st.opacity}" stroke-width="${st.width}"${st.dash === null ? '' : ` stroke-dasharray="${st.dash}"`}${st.marker ? ' marker-end="url(#arrow)"' : ''}/>`
}

/**
 * 节点:一个实心圆,没有描边、没有内部装饰——与品牌那颗事实点同一个外观。
 * 颜色即语义:`ink` 是这门语言(概念深、值形态浅),`emerald` 是已经落定的事实与实例。
 */
function nodeSvg(theme, node) {
	const color = node.fill === 'emerald' ? EMERALD : node.fill === 'warn' ? theme.warn : theme.ink
	return `<circle cx="${n(node.x)}" cy="${n(node.y)}" r="${node.r}" fill="${color}" fill-opacity="${node.strength}"/>`
}


/**
 * **点阵底纹**:旧主图在环内铺了一层方格纸,那是"仪器图"的质感来源。
 * 这一版把同一层质感铺在图区背后——只是一层肌理,不参与任何语义。
 */
function dotGridSvg(theme) {
	const dots = []
	const x0 = 700
	const x1 = 1560
	const y0 = 110
	const y1 = 810
	const step = 30
	for (let x = x0; x <= x1; x += step) {
		for (let y = y0; y <= y1; y += step) {
			dots.push(`<circle cx="${x}" cy="${y}" r="1.2"/>`)
		}
	}
	/** 径向淡出:硬边矩形会读成"一块补丁",渐隐之后才是环境肌理。 */
	return `<g fill="${theme.ink}" fill-opacity="0.13" mask="url(#gridFade)">${dots.join('')}</g>`
}

// ── 左:循环 ───────────────────────────────────────────────────────────
function ringSvg(theme, lang) {
	const stages = STAGES[lang]
	const arcStart = RING.openAt + RING.openHalf
	const SEG = 270 / 7
	const arc = (r, deg) => ({ x: RING.cx + r * Math.cos(rad(deg)), y: RING.cy + r * Math.sin(rad(deg)) })
	const a = arc(RING.r, arcStart)
	const b = arc(RING.r, arcStart + 270)
	const bz1 = arc(RING.bezel, arcStart)
	const bz2 = arc(RING.bezel, arcStart + 270)

	// 七段刻度(段界)
	const ticks = Array.from({ length: 6 }, (_, i) => {
		const deg = arcStart + SEG * (i + 1)
		const p1 = arc(RING.r - 9, deg)
		const p2 = arc(RING.r + 9, deg)
		return `<line x1="${n(p1.x)}" y1="${n(p1.y)}" x2="${n(p2.x)}" y2="${n(p2.y)}" stroke="${theme.ink}" stroke-opacity="0.3" stroke-width="2"/>`
	}).join('\n\t\t')

	/**
	 * 阶段名:段中点、环外。**name 与 sub 用同一个半径,靠垂直偏移错开**——
	 * 只按半径差错开的话,在环的正左/正右两侧两者会落在同一 y 上挤成一团(实测踩过)。
	 */
	const labels = stages.items
		.map(([name, sub], i) => {
			const deg = arcStart + SEG * (i + 0.5)
			const p = arc(RING.r + 34, deg)
			const c = Math.cos(rad(deg))
			const anchor = c > 0.35 ? 'start' : c < -0.35 ? 'end' : 'middle'
			return [
				`<text x="${n(p.x)}" y="${n(p.y)}" font-family="${FONT}" font-size="${stages.size}" font-weight="600" fill="${theme.ink}" fill-opacity="0.88" text-anchor="${anchor}">${name}</text>`,
				`<text x="${n(p.x)}" y="${n(p.y + 15)}" font-family="${FONT}" font-size="${stages.subSize}" fill="${theme.ink}" fill-opacity="0.42" text-anchor="${anchor}">${sub}</text>`,
			].join('\n\t\t')
		})
		.join('\n\t\t')

	return `<g>
		<path d="M${n(a.x)} ${n(a.y)} A ${RING.r} ${RING.r} 0 1 1 ${n(b.x)} ${n(b.y)}" fill="none" stroke="${theme.ink}" stroke-width="${RING.stroke}" stroke-linecap="round"/>
		<path d="M${n(bz1.x)} ${n(bz1.y)} A ${RING.bezel} ${RING.bezel} 0 1 1 ${n(bz2.x)} ${n(bz2.y)}" fill="none" stroke="${theme.ink}" stroke-opacity="0.1" stroke-width="1"/>
		${ticks}
		${labels}
	</g>`
}

// ── 主图 ───────────────────────────────────────────────────────────────
function diagram(theme, lang) {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
	<title id="t">ClearAI · the loop grows an ontology</title>
	<desc id="d">Left: the epistemic loop — the ClearAI mark as a ring with seven labelled stages. Its emerald fact dot, sitting in the opening, is also the first node of the domain ontology on the right: one circle shape throughout, differing only in colour — dark for concepts, light for value forms, emerald for the instance; the instance carries two conflicting assertion edges.</desc>
	<defs>
		<radialGradient id="gridGrad" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0%" stop-color="#fff" stop-opacity="1"/>
			<stop offset="45%" stop-color="#fff" stop-opacity="0.72"/>
			<stop offset="100%" stop-color="#fff" stop-opacity="0"/>
		</radialGradient>
		<mask id="gridFade">
			<rect x="700" y="110" width="860" height="700" fill="url(#gridGrad)"/>
		</mask>
		<marker id="arrow" markerWidth="8" markerHeight="8" refX="6.6" refY="3.4" orient="auto"><path d="M0,0 L6.6,3.4 L0,6.8 Z" fill="${theme.ink}"/></marker>
	</defs>
	<rect width="${W}" height="${H}" fill="${theme.bg}"/>
	${dotGridSvg(theme)}
	${ringSvg(theme, lang)}
	<g>
		${EDGES.map((e) => edgeSvg(theme, e)).join('\n\t\t')}
		${['hub', 'conceptA', 'pillA', 'pillC', 'pillD', 'instance', 'seed'].map((k) => nodeSvg(theme, NODES[k])).join('\n\t\t')}
	</g>
</svg>
`
}

// ── 输出 ───────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'clearai-hero-'))
const jobs = [
	['light', 'zh', 'ontology-hero.zh-CN'],
	['dark', 'zh', 'ontology-hero-dark.zh-CN'],
	['light', 'en', 'ontology-hero'],
	['dark', 'en', 'ontology-hero-dark'],
]
for (const [themeName, lang, out] of jobs) {
	const theme = THEMES[themeName]
	const svg = diagram(theme, lang)
	writeFileSync(join(HERE, `${out}.svg`), svg)
	const page = join(dir, `${out}.html`)
	writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden}svg{display:block;width:${W}px;height:${H}px}</style>${svg}`)
	execFileSync(
		CHROME,
		['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${W},${H}`, `--screenshot=${join(HERE, `${out}.png`)}`, pathToFileURL(page).href],
		{ stdio: 'pipe' },
	)
	console.log(`  ${out}.svg + .png  (${themeName}/${lang})`)
}
console.log(`完成:${W}×${H} · 循环(左)长出本体(右;统一圆点) · 明暗 × 中英。`)
