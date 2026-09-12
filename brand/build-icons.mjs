/**
 * build-icons —— 从 `brand/logo.svg`(唯一主源)**生成品牌位图**。
 *
 * 为什么要有这个脚本(而不是手动导一遍图):
 *   手导一次 = 下次改主源时位图不会跟着变,而没人会发现 —— 典型的第二本账。
 *   这里把「主源 → 每一个尺寸/每一种底色」写成一条可复跑的命令。
 *
 * 栅格化用 **headless Chrome**(这台机器上唯一可靠的 SVG 光栅器):
 *   每个产物一页 HTML(背景可控、前景色可控)→ `--screenshot` 出那张 PNG。
 *   `--default-background-color=00000000` 让标记那几张**透明**。
 *
 * 产出:
 *   brand/logo-512.png          512,透明底,墨色     (README 浅色主题)
 *   brand/logo-512-dark.png     512,透明底,反白     (README 深色主题)
 *   brand/logo-lockup.png       横向组合标,墨色
 *   brand/logo-lockup-dark.png  横向组合标,反白
 *
 * 跑法:node brand/build-icons.mjs        (需要 PATH 上有 google-chrome)
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHROME = process.env.CHROME ?? 'google-chrome'

/** 品牌两套底色(与主题契约同源:浅 = 暖纸,深 = 暖墨)。 */
const INK_ON_PAPER = '#1C1A18'
const PAPER_ON_INK = '#F2EFE8'

const strip = (svg) => svg.replace(/<!--[\s\S]*?-->/g, '').trim()
const mark = strip(readFileSync(join(HERE, 'logo.svg'), 'utf8'))
const lockup = strip(readFileSync(join(HERE, 'logo-lockup.svg'), 'utf8'))

/** 把一份 SVG 放进一页 HTML:尺寸、前景色、是否透明底都由参数定。 */
const page = ({ width, height, color, background, svg }) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden}
body{background:${background ?? 'transparent'};display:flex;align-items:center;justify-content:center;color:${color}}
svg{width:100%;height:100%;display:block}</style>
${svg}`

const work = mkdtempSync(join(tmpdir(), 'clearai-brand-'))
const render = (out, spec) => {
	const file = join(work, `${out.replace(/[^\w.-]/g, '_')}.html`)
	writeFileSync(file, page(spec), 'utf8')
	mkdirSync(dirname(out), { recursive: true })
	try {
		execFileSync(
			CHROME,
			['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1',
			 `--window-size=${spec.width},${spec.height}`, '--default-background-color=00000000', `--screenshot=${out}`, `file://${file}`],
			{ stdio: 'pipe', timeout: 120000 },
		)
	} catch (error) {
		console.error(`✗ ${out}: ${String(error?.stderr ?? error?.message ?? error).slice(0, 200)}`)
		process.exitCode = 1
		return false
	}
	return true
}

const jobs = [
	[join(HERE, 'logo-512.png'), { width: 512, height: 512, color: INK_ON_PAPER, svg: mark }],
	[join(HERE, 'logo-512-dark.png'), { width: 512, height: 512, color: PAPER_ON_INK, svg: mark }],
	[join(HERE, 'logo-lockup.png'), { width: 1088, height: 240, color: INK_ON_PAPER, svg: lockup }],
	[join(HERE, 'logo-lockup-dark.png'), { width: 1088, height: 240, color: PAPER_ON_INK, svg: lockup }],
]
console.log(`【生成品牌位图】主源 brand/logo.svg → ${jobs.length} 个文件`)
let ok = 0
for (const [out, spec] of jobs) {
	if (render(out, spec)) {
		ok += 1
		console.log(`  ✓ ${out.slice(HERE.length + 1)}  ${spec.width}×${spec.height}`)
	}
}
rmSync(work, { recursive: true, force: true })
console.log(`  完成 ${ok}/${jobs.length}`)
if (ok !== jobs.length) process.exit(1)
