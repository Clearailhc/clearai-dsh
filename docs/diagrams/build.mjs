/**
 * build —— 认识论循环主图的**唯一生成器**(docs/diagrams)。
 *
 * 为什么要有它:品牌规范那条纪律是「位图绝不手改,否则就是第二本账」。
 * 之前的 hero 没有生成器,于是 SVG 与 PNG 各自漂移(改了一边、另一边还是旧的)。
 * 这里把两件事收成一条命令:**源 = 这一份模板,位图 = 纯函数产物**。
 *
 * 画的是什么(A 内容 + C 外壳):
 *   · 外壳是品牌字形。**结构照抄 brand/logo.svg**:开口 90°、以 −35° 为中心(斜朝右上,不许掰直)、
 *     事实点坐在开口的角平分线上、点固定 emerald。按用途只调**笔画权重**——主标把笔画做成字重
 *     (118/326),那是「标记」的比例;主图里环内要装证据图,笔画降到发丝级。
 *   · **七个阶段是结构**:环的 270° 弧等分成七段,段界一枚刻度、段中各一个阶段名(用规范名逐字)。
 *     循环从右侧起,向下、向左、绕上,收在「记录并行动」;再往前就是开口——事实在那里落定。
 *   · **证据是内容**:环内是 L0–L4 分级轴、事先登记进判据(虚线)、带误差棒的观测、
 *     被推翻但保留在原位的那一条(斜杠)、以及越过判据的那一条;它由引导线穿过开口连到事实点。
 *   · 全图只有一个彩色元素(emerald 事实点);其余是暖墨/暖纸的发丝线。
 *
 * 阶段名逐字取自 docs/epistemic-loop.md 与 docs/epistemic-loop.zh-CN.md——
 * **改主图之前先改那里**;这里是它的渲染,不是第二份定义。
 *
 * 跑法:node docs/diagrams/build.mjs        (需要 PATH 上有 google-chrome;可用 CHROME=… 覆盖)
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

/** 品牌语义色:事实点永远是 emerald,不跟主题走(brand/README.md)。 */
const EMERALD = '#10B981'

/** 两套主题 = brand/README.md 规定的暖纸 / 暖墨。 */
const THEMES = {
	light: { bg: '#FBFAF7', ink: '#1C1A18', muted: 0.5, hair: 0.15, grid: 0.05, zone: 0.055 },
	dark: { bg: '#1C1A18', ink: '#FBFAF7', muted: 0.53, hair: 0.16, grid: 0.055, zone: 0.06 },
}

/**
 * 七个阶段——**规范名,逐字**,顺序即 docs/epistemic-loop.md 的顺序。
 * `sub` 只是同一阶段的一句话注解,不是第二个名字。
 */
const STAGES = {
	en: {
		font: 'Inter,Helvetica Neue,Helvetica,Arial,sans-serif',
		items: [
			{ name: 'Frame', sub: 'bound the question' },
			{ name: 'Hypothesize', sub: 'a proposition' },
			{ name: 'Plan', sub: 'criteria first' },
			{ name: 'Observe', sub: 'what happened' },
			{ name: 'Verify', sub: 'against criteria' },
			{ name: 'Evaluate', sub: 'the evidence' },
			{ name: 'Record and act', sub: 'keep, then move' },
		],
	},
	zh: {
		font: 'Inter,"Noto Sans SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",Helvetica,Arial,sans-serif',
		items: [
			{ name: '界定', sub: '问题与边界' },
			{ name: '提出假设', sub: '一个命题' },
			{ name: '规划', sub: '先写判据' },
			{ name: '观测', sub: '实际发生' },
			{ name: '验证', sub: '对照判据' },
			{ name: '评估', sub: '评估证据' },
			{ name: '记录并行动', sub: '留存、再走一步' },
		],
	},
}

const G = {
	cx: 800,
	cy: 450,
	rRing: 336, // 主环半径
	stroke: 20, // 笔画权重(按用途调整,见文件头)
	rBezel: 300, // 内圈发丝线(表盘),与主环同开口
	openAt: -35, // 开口中心:朝右上(brand/logo.svg)
	openHalf: 45, // 开口半宽 → 90° 开口(brand/logo.svg)
	dot: 22, // 事实点半径
	rLabel: 388, // 阶段名的落点半径
	plot: { left: 620, right: 980, base: 630, top: 300 },
	threshold: 462, // 事先登记进判据的那条线
	levels: [638, 717, 796, 875, 954],
}

const rad = (deg) => (deg * Math.PI) / 180
const at = (deg, r = G.rRing) => [G.cx + r * Math.cos(rad(deg)), G.cy + r * Math.sin(rad(deg))]
const n = (v) => (Math.round(v * 100) / 100).toString()

// 环的 270° 弧(= 360° − 90° 开口)等分成七段:段界与段中
const ARC_START = G.openAt + G.openHalf // +10°
const SEG = 270 / 7
const segBounds = Array.from({ length: 8 }, (_, i) => ARC_START + SEG * i)
const segMids = Array.from({ length: 7 }, (_, i) => ARC_START + SEG * (i + 0.5))

/**
 * 五条观测,一条一句处境:
 *   weak          低等级弱证据(误差棒整段在判据之下)
 *   inconclusive  误差棒跨过判据 → 无法判定
 *   refuted       明确落空 → 被推翻,**但保留在原位**(P5:什么都不删)
 *   supported     整段越过判据 → 被接纳;它是唯一连到开口那颗事实点的观测
 */
const OBSERVATIONS = [
	{ level: 0, y: 566, err: 42, kind: 'weak' },
	{ level: 1, y: 528, err: 38, kind: 'weak' },
	{ level: 2, y: 450, err: 56, kind: 'inconclusive' },
	{ level: 3, y: 588, err: 26, kind: 'refuted' },
	{ level: 4, y: 396, err: 24, kind: 'supported' },
]

function errorBar(theme, x, y, err, kind) {
	const cap = 11
	const top = y - err
	const bottom = y + err
	const width = kind === 'supported' ? 4 : 3
	const opacity = kind === 'refuted' ? 0.4 : kind === 'inconclusive' ? 0.5 : 0.78
	const paint = `stroke="${theme.ink}" stroke-opacity="${opacity}" stroke-width="${width}"`
	return [
		`<line x1="${n(x)}" y1="${n(top)}" x2="${n(x)}" y2="${n(bottom)}" ${paint}/>`,
		`<line x1="${n(x - cap)}" y1="${n(top)}" x2="${n(x + cap)}" y2="${n(top)}" ${paint}/>`,
		`<line x1="${n(x - cap)}" y1="${n(bottom)}" x2="${n(x + cap)}" y2="${n(bottom)}" ${paint}/>`,
	].join('\n\t\t')
}

function marker(theme, x, y, kind) {
	// 被接纳的那一条:实心墨点(彩色留给开口里那颗事实点,不在这里重复强调)
	if (kind === 'supported') return `<circle cx="${n(x)}" cy="${n(y)}" r="14" fill="${theme.ink}"/>`
	// 被推翻:点留在原位,一道斜杠表示它的处境——不是删掉,是记下来
	if (kind === 'refuted') {
		const s = 15
		return [
			`<circle cx="${n(x)}" cy="${n(y)}" r="12" fill="none" stroke="${theme.ink}" stroke-opacity="0.4" stroke-width="3"/>`,
			`<line x1="${n(x - s)}" y1="${n(y + s)}" x2="${n(x + s)}" y2="${n(y - s)}" stroke="${theme.ink}" stroke-opacity="0.4" stroke-width="3"/>`,
		].join('\n\t\t')
	}
	if (kind === 'inconclusive') {
		return `<circle cx="${n(x)}" cy="${n(y)}" r="12" fill="none" stroke="${theme.ink}" stroke-opacity="0.7" stroke-width="3" stroke-dasharray="7 6"/>`
	}
	return `<circle cx="${n(x)}" cy="${n(y)}" r="12" fill="none" stroke="${theme.ink}" stroke-opacity="0.78" stroke-width="3"/>`
}

function grid(theme) {
	const step = 30
	const r = G.rBezel - 24
	const lines = []
	for (let x = G.cx - r + step; x < G.cx + r; x += step) {
		if (Math.abs(x - G.cx) < 1) continue
		lines.push(`<line x1="${n(x)}" y1="${G.cy - r}" x2="${n(x)}" y2="${G.cy + r}"/>`)
	}
	for (let y = G.cy - r + step; y < G.cy + r; y += step) {
		if (Math.abs(y - G.cy) < 1) continue
		lines.push(`<line x1="${G.cx - r}" y1="${n(y)}" x2="${G.cx + r}" y2="${n(y)}"/>`)
	}
	return lines.join('')
}

/** 阶段名落在环外:按角度选锚点,免得文字压到环上。 */
function labelAnchor(deg) {
	const c = Math.cos(rad(deg))
	if (c > 0.35) return 'start'
	if (c < -0.35) return 'end'
	return 'middle'
}

function diagram(theme, lang) {
	const stages = STAGES[lang]
	const p = G.plot
	const [sx, sy] = at(segBounds[0])
	const [ex, ey] = at(segBounds[7])
	const [dx, dy] = at(G.openAt)
	const [bx, by] = at(segBounds[0], G.rBezel)
	const [bex, bey] = at(segBounds[7], G.rBezel)

	// 段界刻度:把环读成一把有七个刻度的尺
	const bounds = segBounds
		.slice(1, 7)
		.map((deg) => {
			const [x1, y1] = at(deg, G.rRing - 20)
			const [x2, y2] = at(deg, G.rRing + 20)
			return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${theme.ink}" stroke-opacity="0.45" stroke-width="3"/>`
		})
		.join('\n\t\t')

	// 段中引线:从环指向自己的名字,免得七个名字只靠"邻近"归位
	const pointers = segMids
		.map((deg) => {
			const [x1, y1] = at(deg, G.rRing + 26)
			const [x2, y2] = at(deg, G.rRing + 50)
			return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${theme.ink}" stroke-opacity="0.3" stroke-width="3"/>`
		})
		.join('\n\t\t')

	// 七个阶段名(规范名逐字)+ 一句注解
	const labels = segMids
		.map((deg, i) => {
			const [x, y] = at(deg, G.rLabel)
			const anchor = labelAnchor(deg)
			// 顶端/底端的名字沿径向让开一点,避免压到刻度
			const shift = anchor === 'middle' ? (Math.sin(rad(deg)) > 0 ? 26 : -12) : -6
			return [
				`<text x="${n(x)}" y="${n(y + shift)}" text-anchor="${anchor}">${stages.items[i].name}</text>`,
				`<text x="${n(x)}" y="${n(y + shift + 27)}" text-anchor="${anchor}" font-size="19" font-weight="400" fill-opacity="${theme.muted}">${stages.items[i].sub}</text>`,
			].join('\n\t\t')
		})
		.join('\n\t\t')

	const ticks = G.levels
		.map((x, i) =>
			[
				`<line x1="${n(x)}" y1="${p.base}" x2="${n(x)}" y2="${p.base + 10}"/>`,
				`<text x="${n(x)}" y="${p.base + 38}">L${i}</text>`,
			].join(''),
		)
		.join('\n\t\t')

	const observations = OBSERVATIONS.map((o) => {
		const x = G.levels[o.level]
		return `${errorBar(theme, x, o.y, o.err, o.kind)}\n\t\t${marker(theme, x, o.y, o.kind)}`
	}).join('\n\t\t')

	// 被接纳的观测 → 穿过开口 → 事实点:图里挣到的东西就是那颗点
	const accepted = OBSERVATIONS.find((o) => o.kind === 'supported')
	const [ax, ay] = [G.levels[accepted.level], accepted.y]
	const len = Math.hypot(dx - ax, dy - ay)
	const ux = (dx - ax) / len
	const uy = (dy - ay) / len

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
\t<title id="t">ClearAI · the Epistemic Loop</title>
\t<desc id="d">The ClearAI mark as the loop itself: its c is divided into seven segments, one per stage — Frame, Hypothesize, Plan, Observe, Verify, Evaluate, Record and act. Inside sits an evidence chart: five observations with error bars across levels L0 to L4, one pre-registered criterion line, one observation refuted and kept in place, one inconclusive, one that clears the criterion. A leader line carries that accepted observation through the opening of the c, where it becomes the single emerald fact dot.</desc>

\t<defs>
\t\t<clipPath id="plate"><circle cx="${G.cx}" cy="${G.cy}" r="${G.rBezel - 24}"/></clipPath>
\t\t<linearGradient id="zone" gradientUnits="userSpaceOnUse" x1="0" y1="${G.threshold}" x2="0" y2="${p.top}">
\t\t\t<stop offset="0%" stop-color="${theme.ink}" stop-opacity="${theme.zone}"/>
\t\t\t<stop offset="100%" stop-color="${theme.ink}" stop-opacity="0"/>
\t\t</linearGradient>
\t\t<linearGradient id="zoneFade" gradientUnits="userSpaceOnUse" x1="${p.left}" y1="0" x2="${p.right}" y2="0">
\t\t\t<stop offset="0%" stop-color="#000"/>
\t\t\t<stop offset="14%" stop-color="#fff"/>
\t\t\t<stop offset="86%" stop-color="#fff"/>
\t\t\t<stop offset="100%" stop-color="#000"/>
\t\t</linearGradient>
\t\t<mask id="zoneMask"><rect x="${p.left}" y="${p.top}" width="${p.right - p.left}" height="${G.threshold - p.top}" fill="url(#zoneFade)"/></mask>
\t</defs>

\t<rect width="${W}" height="${H}" fill="${theme.bg}"/>

\t<!-- 环内:方格纸 + 达标区 -->
\t<g clip-path="url(#plate)">
\t\t<g stroke="${theme.ink}" stroke-opacity="${theme.grid}" stroke-width="1.4">${grid(theme)}</g>
\t\t<rect x="${p.left}" y="${p.top}" width="${p.right - p.left}" height="${G.threshold - p.top}" fill="url(#zone)" mask="url(#zoneMask)"/>
\t</g>

\t<!-- 事先登记进判据的那条线:先写后做 -->
\t<line x1="${p.left}" y1="${G.threshold}" x2="${p.right}" y2="${G.threshold}" stroke="${theme.ink}" stroke-opacity="0.55" stroke-width="2.4" stroke-dasharray="14 11"/>

\t<!-- 横轴是证据等级;纵轴只给框 -->
\t<g stroke="${theme.ink}" stroke-opacity="${theme.hair}" stroke-width="2">
\t\t<line x1="${p.left}" y1="${p.base}" x2="${p.right}" y2="${p.base}"/>
\t\t<line x1="${p.left}" y1="${p.top}" x2="${p.left}" y2="${p.base}"/>
\t</g>
\t<g font-family="${stages.font}" font-size="23" font-weight="600" letter-spacing="1.4" text-anchor="middle" fill="${theme.ink}" fill-opacity="${theme.muted}">
\t\t${ticks}
\t</g>

\t<!-- 观测与误差棒 -->
\t<g stroke-linecap="butt">
\t\t${observations}
\t</g>

\t<!-- 引导线:被接纳的那条观测穿过开口,落成事实点 -->
\t<line x1="${n(ax + ux * 30)}" y1="${n(ay + uy * 30)}" x2="${n(dx - ux * 16)}" y2="${n(dy - uy * 16)}" stroke="${theme.ink}" stroke-opacity="0.3" stroke-width="2" stroke-dasharray="4 8"/>

\t<!-- 内圈发丝线:表盘,与主环同开口 -->
\t<path d="M${n(bx)} ${n(by)} A ${G.rBezel} ${G.rBezel} 0 1 1 ${n(bex)} ${n(bey)}" fill="none" stroke="${theme.ink}" stroke-opacity="0.16" stroke-width="1.6" stroke-linecap="round"/>

\t<!-- 品牌字形:开口的 c;七个段界刻度 = 七个阶段 -->
\t<path d="M${n(sx)} ${n(sy)} A ${G.rRing} ${G.rRing} 0 1 1 ${n(ex)} ${n(ey)}" fill="none" stroke="${theme.ink}" stroke-width="${G.stroke}" stroke-linecap="round"/>
\t<g stroke-linecap="round">
\t\t${bounds}
\t</g>

\t<!-- 七个阶段(规范名逐字) -->
\t<g font-family="${stages.font}" font-size="27" font-weight="600" fill="${theme.ink}">
\t\t${labels}
\t</g>

\t<!-- 开口里那颗事实点 -->
\t<circle cx="${n(dx)}" cy="${n(dy)}" r="${G.dot}" fill="${EMERALD}"/>
</svg>
`
}

const dir = mkdtempSync(join(tmpdir(), 'clearai-diagram-'))
const jobs = [
	['light', 'en', 'epistemic-loop-hero'],
	['dark', 'en', 'epistemic-loop-hero-dark'],
	['light', 'zh', 'epistemic-loop-hero.zh-CN'],
	['dark', 'zh', 'epistemic-loop-hero-dark.zh-CN'],
]
for (const [themeName, lang, out] of jobs) {
	const theme = THEMES[themeName]
	const svg = diagram(theme, lang)
	writeFileSync(join(HERE, `${out}.svg`), svg)
	const page = join(dir, `${out}.html`)
	writeFileSync(
		page,
		`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden}svg{display:block;width:${W}px;height:${H}px}</style>${svg}`,
	)
	execFileSync(
		CHROME,
		[
			'--headless=new',
			'--no-sandbox',
			'--disable-gpu',
			'--hide-scrollbars',
			'--force-device-scale-factor=1',
			`--window-size=${W},${H}`,
			`--screenshot=${join(HERE, `${out}.png`)}`,
			pathToFileURL(page).href,
		],
		{ stdio: 'pipe' },
	)
	console.log(`  ${out}.svg + .png  (${themeName}/${lang})`)
}
console.log(`完成:${W}×${H} · 七阶段逐字 + 环内证据图 · 明暗 × 中英 四版。`)
