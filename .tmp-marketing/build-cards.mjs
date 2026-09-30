/**
 * build-cards —— 生成小红书图文卡片(1080 × 1440)。
 *
 * 为什么要脚本而不是手做:卡片的第 4–6 张嵌的是**产品真机截图**
 * (`tools/panel-shots.mjs` / `tools/graph-shots.mjs` 的产物),那几张图会随产品重拍;
 * 卡片跟着重建,才能保证素材与产品同源、编号与 `docs/marketing/xiaohongshu/*.md`
 * 里的「配图顺序」对得上。
 *
 * 跑法:node .tmp-marketing/build-cards.mjs
 *   依赖:playwright-core(devDependency)+ 系统 Chrome。
 */
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const OUT = join(ROOT, 'docs', 'marketing', 'xiaohongshu', 'images')

/** 相对 `docs/marketing/xiaohongshu/_cards.html` 的路径。 */
const BRAND = '../../../brand'
const DIAGRAM = '../../../docs/diagrams'
const SHOT = '../zhihu/images'

const cards = [
	{ n: '01', kind: 'cover', title: '在 DeepSeek<br>Harness 上构建可信本体', version: 'clearai-dsh 0.2.1', hero: `${DIAGRAM}/ontology-hero.zh-CN.png`, footer: '认识论是路径 · 本体是结果' },
	{
		n: '02',
		pill: '先问一个问题',
		title: 'AI 的答案，为什么不敢直接用？',
		sub: '问题不在答案看起来像不像，而在证据能不能回放。',
		body: ['聊天记录里有结论，却不一定有判据。', '向量库里有文本，却不一定知道哪条关系可靠。', '研究做完了，下一轮仍然从头开始。'],
	},
	{
		n: '03',
		title: '两个概念，分工很简单',
		sub: '一个负责结果，一个负责过程。',
		shot: { src: `${DIAGRAM}/ontology-hero.zh-CN.png`, fit: 'landscape' },
		body: ['领域本体：概念、谓词、实例、关系。', '它是研究最终留下的知识结构。', '认识论循环：界定、假设、规划、观测、验证、评估、记录。', '它负责检查知识从哪里来。'],
	},
	{
		n: '04',
		title: '本体不是一张漂亮的关系图',
		sub: '它至少要回答三件事。',
		shot: { src: `${SHOT}/panel-ontology.png`, fit: 'crop' },
		body: ['① 每条关系从哪里来？ 有 basis，有证据链。', '② 两条结论冲突时怎么办？ 自动发现，交给人的裁决。', '③ 现在的状态能不能重放？ 事件账本 + 纯函数投影。'],
	},
	{
		n: '05',
		pill: '真机截图',
		title: '本体图长什么样',
		sub: '概念是节点，is_a 和谓词是边。',
		shot: { src: `${SHOT}/jepa-ontology.png`, fit: 'landscape' },
		body: ['一场真会话长出的本体：23 个节点、18 条边。', '同一份账本，永远折出同一张图。', '图不是装饰，是索引——点节点就按概念过滤。'],
	},
	{
		n: '06',
		pill: '真机截图',
		title: '点开一个概念，看它凭什么成立',
		titleClass: 'title-sm',
		sub: '每个词都有依据，每次修订都留痕。',
		shot: { src: `${SHOT}/jepa-inspector.png`, fit: 'landscape' },
		body: ['释义、依据、状态、子概念、相关谓词、登记与修订史。', '「按此筛选」是详情里的显式动作，不是猜你点它的意思。'],
	},
	{
		n: '07',
		title: '认识论，落在代码里是什么？',
		sub: '不是一张流程图，是几条不能绕开的约束。',
		shot: { src: `${DIAGRAM}/epistemic-loop-hero.zh-CN.png`, fit: 'landscape' },
		body: ['判据要在结果之前登记：refute_when / done_criteria。', '模型没有 status: done，推进必须带证据。', 'L3 以上需要独立评估者。', '被推翻的结论保留，不从历史里删除。'],
	},
	{
		n: '08',
		title: '它能做什么？',
		sub: '同一套机制，覆盖三类工作。',
		shot: { src: `${DIAGRAM}/loop-to-dsh-planes.zh-CN.png`, fit: 'landscape' },
		body: ['科研探索：管理假设、证据、复核与负知识。', '业务建模：概念与谓词成为业务契约，单值约束自动发现冲突。', '分析：按概念检索，沿证据链回溯，本体图导航。'],
	},
	{
		n: '09',
		pill: '开源项目',
		title: '现在可以开始',
		sub: '适合需要长期积累、需要复核、需要多人接续的项目。',
		body: ['安装：npx clearai-dsh install', '重启 dsh web，新建会话，点顶部模式名切到 ClearAI。', '从第一条概念开始，本体逐步建立。'],
	},
]

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')

const shotHTML = (shot) =>
	shot === undefined
		? ''
		: `<div class="shot ${shot.fit}"><img src="${shot.src}" alt=""></div>`

const bodyHTML = (body) => (body === undefined ? '' : `<div class="body">${body.map((line) => `<p>${esc(line)}</p>`).join('')}</div>`)

const cardHTML = (card) => {
	if (card.kind === 'cover') {
		return `<section class="card cover">
	<img class="cover-logo" src="${BRAND}/logo-lockup.png" alt="clearai-dsh">
	<div class="cover-title">${card.title}</div>
	<div class="cover-ver">${esc(card.version)}</div>
	<div class="cover-hero"><img src="${card.hero}" alt=""></div>
	<div class="footer">${esc(card.footer)}</div>
</section>`
	}
	return `<section class="card">
	<div class="index">${card.n}</div>
	${card.pill === undefined ? '' : `<div class="pill">${esc(card.pill)}</div>`}
	<h1 class="title ${card.titleClass ?? ''}">${esc(card.title)}</h1>
	<div class="sub">${esc(card.sub)}</div>
	${shotHTML(card.shot)}
	${bodyHTML(card.body)}
	<div class="footer">clearai-dsh · DeepSeek Harness</div>
</section>`
}

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
	* { box-sizing: border-box; margin: 0; padding: 0; }
	body { background: #d8d5cf; font-family: 'PingFang SC', 'Helvetica Neue', 'Hiragino Sans GB', sans-serif; -webkit-font-smoothing: antialiased; }
	.card { position: relative; width: 1080px; height: 1440px; background: #FBFAF7; color: #1C1A18; padding: 54px 72px 0; overflow: hidden; }
	.card + .card { margin-top: 40px; }
	.index { font-size: 30px; line-height: 30px; color: #10B981; }
	.pill { display: inline-block; margin-top: 24px; background: #10B981; color: #fff; border-radius: 999px; padding: 7px 24px; font-size: 30px; line-height: 32px; }
	.title { margin-top: 18px; font-size: 68px; line-height: 1.16; font-weight: 700; letter-spacing: -.01em; }
	.title-sm { font-size: 56px; }
	.sub { margin-top: 16px; font-size: 36px; line-height: 1.42; color: #6B6862; }
	.shot { margin-top: 44px; background: #fff; border: 1px solid #E7E4DC; border-radius: 16px; padding: 14px; overflow: hidden; }
	.shot.landscape img { display: block; width: 100%; border-radius: 8px; }
	.shot.crop { height: 560px; }
	.shot.crop img { display: block; width: 100%; object-fit: cover; object-position: top center; border-radius: 8px; }
	.body { margin-top: 40px; font-size: 40px; line-height: 1.55; }
	.body p + p { margin-top: 18px; }
	.footer { position: absolute; left: 72px; bottom: 42px; font-size: 28px; color: #A5A39E; }
	.cover-logo { display: block; width: 430px; margin: 60px auto 0; }
	.cover-title { margin-top: 104px; font-size: 74px; line-height: 1.18; font-weight: 700; letter-spacing: -.02em; }
	.cover-ver { margin-top: 34px; font-size: 40px; color: #10B981; }
	.cover-hero { margin-top: 56px; }
	.cover-hero img { display: block; width: 880px; margin: 0 auto; }
</style></head><body>
${cards.map(cardHTML).join('\n')}
</body></html>`

mkdirSync(OUT, { recursive: true })
const page_file = join(ROOT, 'docs', 'marketing', 'xiaohongshu', '_cards.html')
writeFileSync(page_file, html)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
	const page = await browser.newPage({ viewport: { width: 1080, height: 1440 }, deviceScaleFactor: 1 })
	await page.goto(`file://${page_file}`, { waitUntil: 'load' })
	await page.waitForTimeout(600)
	for (const [index, card] of cards.entries()) {
		const target = join(OUT, `${card.n}.png`)
		await page.locator('.card').nth(index).screenshot({ path: target })
		console.log(`  · docs/marketing/xiaohongshu/images/${card.n}.png`)
	}
} finally {
	await browser.close()
	unlinkSync(page_file)
}
