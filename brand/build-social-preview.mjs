/**
 * build-social-preview —— 生成**仓库卡片的社交预览图**(唯一生成器)。
 *
 * 为什么必须有这张图:
 *   GitHub 的 topic / 搜索结果卡片只显示仓库的 **social preview**(仓库设置里上传的那张),
 *   它不读 README、不读 git,也不会用 GitHub 自动生成的 `opengraph.githubassets.com` 灰底卡。
 *   没有它,卡片就是一段没图的光秃秃文字——topic 里有图的仓库全部 `usesCustomOpenGraphImage=true`。
 *
 * 尺寸与体积按 GitHub 文档:`1280×640`(最佳显示)、PNG/JPG/GIF、**必须 < 1MB**。
 *
 * 为什么关键内容都压在顶部 275px 内:
 *   列表卡片把图**按容器宽度缩放**,再裁到 `max-height:275px`(见卡片 HTML 的
 *   `<a style="max-height:275px" class="overflow-hidden">`)。按 1280 宽的容器算,
 *   可见的只有最上面 275/640 ≈ 43%。所以 logo、中文标题、英文副题全部落在 0–275 之间,
 *   下半部分只放装饰性的本体图与循环六节拍——**被裁掉也不丢信息**。
 *
 * 画的是什么(与 docs/diagrams/ 的主图同一套语义):
 *   · 左:组合标 + 「你的研究，长成一个本体」+ 英文副题。
 *   · 右:一个抽象本体图,全是实心圆,只靠颜色分语义——深墨 = 概念,浅墨 = 值形态,
 *        emerald = 实例;实例上挂着两条 amber 断言,「两条读数对不上」。
 *   · 下:认识论循环的六节拍(它是这张图的来路;文案逐字取自 README.zh-CN.md,改文案先改那里)。
 *
 * 产物:brand/social-preview.svg + brand/social-preview.png(上传到 GitHub 的就是后者)
 * 跑法:CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node brand/build-social-preview.mjs
 *
 * 栅格化这一步的写法是**踩过坑写下来的**,别顺手改回去:
 *   · `--user-data-dir` 指到临时目录:默认用户目录在受限环境下建不出来,Chrome 会直接报
 *     "Failed to create a unique user data directory for headless" 然后不截图。
 *   · `--virtual-time-budget`:没有它,new headless 出图后更不肯退。
 *   · 出图后**主动 SIGKILL**,成功与否只认产物(见文件末尾的长注释)。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHROME = process.env.CHROME ?? 'google-chrome'
const W = 1280
const H = 640

/** 与品牌/主题契约同源:暖纸、暖墨、品牌青;emerald 是产品语义色(落定的事实)。 */
const BG = '#FBFAF7'
const INK = '#1C1A18'
const TEAL = '#3E8E7A'
const EMERALD = '#10B981'
const WARN = '#D97706'
const FONT = 'Inter,"Noto Sans SC","Source Han Sans SC","PingFang SC",Helvetica,Arial,sans-serif'

const n = (v) => (Math.round(v * 100) / 100).toString()

// ── 组合标:直接内联主源,不另导一份(第二本账)────────────────────────
const lockup = readFileSync(join(HERE, 'logo-lockup.svg'), 'utf8')
	.replace(/<!--[\s\S]*?-->/g, '')
	.replace(/^[\s\S]*?<svg[^>]*>/, '')
	.replace(/<\/svg>\s*$/, '')
	.trim()

// ── 右:本体图(六个圆;深墨=概念,浅墨=值形态,emerald=实例)───────────
const NODES = {
	seed: { x: 765, y: 435, r: 25, fill: 'emerald', strength: 1 },
	hub: { x: 905, y: 345, r: 36, fill: 'ink', strength: 0.85 },
	conceptA: { x: 1085, y: 205, r: 30, fill: 'ink', strength: 0.85 },
	valueA: { x: 1165, y: 330, r: 17, fill: 'ink', strength: 0.27 },
	instance: { x: 1040, y: 525, r: 25, fill: 'emerald', strength: 0.55 },
	/** 这两个取值就是那对冲突读数:染成 amber——产品里冲突用的就是这一族颜色。 */
	pillC: { x: 1150, y: 450, r: 16, fill: 'warn', strength: 0.5 },
	pillD: { x: 935, y: 570, r: 16, fill: 'warn', strength: 0.5 },
}

const EDGES = [
	{ from: 'seed', to: 'hub', kind: 'birth' },
	{ from: 'hub', to: 'conceptA', kind: 'isa' },
	{ from: 'conceptA', to: 'valueA', kind: 'predicate' },
	{ from: 'hub', to: 'instance', kind: 'instOf' },
	{ from: 'instance', to: 'pillC', kind: 'assertion' },
	{ from: 'instance', to: 'pillD', kind: 'assertion' },
]

const EDGE_STYLE = {
	birth: { width: 2.6, opacity: 0.5, marker: true, dash: null },
	predicate: { width: 2.4, opacity: 0.46, marker: true, dash: null },
	isa: { width: 2, opacity: 0.3, marker: false, dash: '7 5' },
	instOf: { width: 2, opacity: 0.26, marker: false, dash: '7 5' },
	assertion: { width: 2.2, opacity: 0.55, marker: false, dash: null, color: 'warn' },
}

/** 两个圆之间的连线端点:沿心线各自让出半径 + 留白,箭头永远落在圆外侧。 */
function edgePoint(from, to, pad = 9) {
	const dx = to.x - from.x
	const dy = to.y - from.y
	const len = Math.hypot(dx, dy) || 1
	return { x: from.x + (dx / len) * (from.r + pad), y: from.y + (dy / len) * (from.r + pad) }
}

function edgeSvg(edge) {
	const st = EDGE_STYLE[edge.kind]
	const start = edgePoint(NODES[edge.from], NODES[edge.to])
	const end = edgePoint(NODES[edge.to], NODES[edge.from])
	const color = st.color === 'warn' ? WARN : INK
	return `<line x1="${n(start.x)}" y1="${n(start.y)}" x2="${n(end.x)}" y2="${n(end.y)}" stroke="${color}" stroke-opacity="${st.opacity}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}${st.marker ? ' marker-end="url(#arrow)"' : ''}/>`
}

/** 节点:一个实心圆,没有描边、没有内部装饰——与品牌那颗事实点同一个外观。 */
function nodeSvg(node) {
	const color = node.fill === 'emerald' ? EMERALD : node.fill === 'warn' ? WARN : INK
	return `<circle cx="${n(node.x)}" cy="${n(node.y)}" r="${node.r}" fill="${color}" fill-opacity="${node.strength}"/>`
}

/** 点阵底纹:同一层「仪器图」质感,只是肌理,不参与语义;向右渐显,左侧留给文字。 */
function dotGridSvg() {
	const dots = []
	for (let x = 700; x <= W; x += 26) {
		for (let y = 0; y <= H; y += 26) dots.push(`<circle cx="${x}" cy="${y}" r="1.2"/>`)
	}
	return `<g fill="${INK}" fill-opacity="0.13" mask="url(#gridFade)">${dots.join('')}</g>`
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
	<title id="t">ClearAI — 你的研究,长成一个本体</title>
	<desc id="d">ClearAI lockup and title. Right: an abstract ontology — plain circles only — dark for concepts, light for value forms, emerald for the instance, which carries two conflicting assertions drawn in amber. Bottom: the seven stages of the epistemic loop.</desc>
	<defs>
		<radialGradient id="gridGrad" cx="0.5" cy="0.5" r="0.5">
			<stop offset="0%" stop-color="#fff" stop-opacity="1"/>
			<stop offset="45%" stop-color="#fff" stop-opacity="0.7"/>
			<stop offset="100%" stop-color="#fff" stop-opacity="0"/>
		</radialGradient>
		<mask id="gridFade"><rect x="700" y="0" width="580" height="${H}" fill="url(#gridGrad)"/></mask>
		<marker id="arrow" markerWidth="8" markerHeight="8" refX="6.6" refY="3.4" orient="auto"><path d="M0,0 L6.6,3.4 L0,6.8 Z" fill="${INK}"/></marker>
	</defs>

	<rect width="${W}" height="${H}" fill="${BG}"/>
	${dotGridSvg()}

	<!-- 顶部 275px 是卡片的可见区,品牌与主张全在这里 -->
	<svg x="84" y="52" width="288" height="63.5" viewBox="0 0 1088 240" fill="none" style="color:${INK}">${lockup}</svg>
	<text x="84" y="205" font-family='${FONT}' font-size="54" font-weight="700" fill="${INK}" letter-spacing="0.5">你的研究，长成一个本体</text>
	<text x="84" y="254" font-family='${FONT}' font-size="27" fill="${INK}" fill-opacity="0.55">Your research, grown into an ontology.</text>

	<!-- 右:本体图 -->
	<g>
		${EDGES.map(edgeSvg).join('\n\t\t')}
		${['hub', 'conceptA', 'valueA', 'pillC', 'pillD', 'instance', 'seed'].map((k) => nodeSvg(NODES[k])).join('\n\t\t')}
	</g>

	<!-- 右上的图说:这张图与左边那句话的关系 -->
	<text x="1196" y="104" font-family='${FONT}' font-size="22" font-weight="600" fill="${TEAL}" text-anchor="end">认识论循环 → 领域本体</text>
	<text x="1196" y="134" font-family='${FONT}' font-size="16" fill="${INK}" fill-opacity="0.38" text-anchor="end">Epistemic Loop → Domain Ontology</text>

	<!-- 下:循环本身(装饰;卡片裁掉也不丢信息)。文案与 README.zh-CN.md 的六节拍逐字一致 -->
	<text x="84" y="520" font-family='${FONT}' font-size="20" font-weight="600" fill="${INK}" fill-opacity="0.55">问题 → 判断（写明怎样算错）→ 一次可能失败的检验 → 证据 → 带范围的结论 → 长进本体</text>
	<text x="84" y="560" font-family='${FONT}' font-size="19" fill="${INK}" fill-opacity="0.38">github.com/Clearailhc/clearai-dsh</text>
</svg>
`

const outSvg = join(HERE, 'social-preview.svg')
const outPng = join(HERE, 'social-preview.png')
writeFileSync(outSvg, svg, 'utf8')

const work = mkdtempSync(join(tmpdir(), 'clearai-social-'))
const page = join(work, 'social-preview.html')
writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden}svg{display:block;width:${W}px;height:${H}px}</style>${svg}`, 'utf8')

/**
 * 出图这一步**不看 Chrome 的退出码,只等产物**,然后主动收工。为什么:
 *   · 受限环境里 crashpad 写不了 `~/Library/...`,Chrome 会带非 0 退出(图其实已经好了);
 *   · 更麻烦的是它有时**根本不休**,helper 进程一直活着(实测能挂满 2 分钟)。
 * 所以:轮询 PNG,等它出现且大小连续两次不变(写完),再 SIGKILL 掉 Chrome。
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** 先删旧图:否则轮询会立刻"看见"上一轮的产物,秒退成假成功(实测踩过)。 */
rmSync(outPng, { force: true })
const startedAt = Date.now()
const child = spawn(
	CHROME,
	['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter', '--no-first-run',
	 '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=4000',
	 `--user-data-dir=${join(work, 'chrome-profile')}`,
	 `--window-size=${W},${H}`, `--screenshot=${outPng}`, pathToFileURL(page).href],
	{ stdio: 'ignore' },
)

const deadline = Date.now() + 60000
let lastSize = 0
let stable = 0
while (Date.now() < deadline) {
	await sleep(150)
	if (existsSync(outPng)) {
		const { size, mtimeMs } = statSync(outPng)
		const fresh = mtimeMs >= startedAt - 1000
		stable = fresh && size > 0 && size === lastSize ? stable + 1 : 0
		lastSize = fresh ? size : 0
		if (stable >= 2) break
	}
	if (child.exitCode !== null && lastSize === 0) break
}
child.kill('SIGKILL')
rmSync(work, { recursive: true, force: true })

if (lastSize === 0) {
	console.error(`✗ ${outPng} 未生成(60s 内没等到产物;CHROME=${CHROME})`)
	process.exit(1)
}
console.log(`✓ brand/social-preview.svg + .png  ${W}×${H} · ${Math.round(lastSize / 1024)}KB(上传 GitHub 的是 .png,需 <1MB)`)
