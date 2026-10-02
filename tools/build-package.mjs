/**
 * build-package —— 把仓库里的源**纯函数式**装配成一个可发行的包(S1)。
 *
 * 为什么要有它(而不是「发行时手抄一份」):
 *   · 手抄 = 第二本账。源改了、包没跟上,而两边的测试都绿 —— 这类漂移最难查。
 *   · 所以规则是硬的:**包 = 源的一个纯函数**。同一个 commit 构两次,产物逐字节相同;
 *     `verify-package.mjs` 会现场重建一遍再比对,手改 `dist/` 当场红。
 *
 * 装配表(源 → 包里):
 *   package.json                 → package.json            (清单:唯一一份,就在仓库根)
 *   pack/cordis.patch.yml        → cordis.patch.yml        (宿主行)
 *   pack/bin/clearai.mjs         → bin/clearai.mjs         (安装侧:doctor / root-yaml / seed)
 *   preset/                      → presets/clearai/        (agent.cordis.yml + plugins/ + skills/ + preset.yml)
 *   ui/lib/index.js              → lib/host.js             (宿主半:投影单元 + 路由)
 *   ui/lib/fold.js               → lib/fold.js             (纯 fold,宿主半 import 它)
 *   ui/lib/invariant.js          → lib/invariant.js        (宿主不变量伴生件;宿主那侧 import 它)
 *   ui/lib/client.js             → lib/client.js           (浏览器半)
 *   locale/                      → locale/                  (插件列表的显示文案:标题 + 一句话介绍,按语言分文件)
 *   brand/                       → brand/                   (README 位图 + 插件列表图标 brand/icon.svg)
 *                                  (工作区模板:随包走,内核缺省从这里找)
 *
 * 模板是插件源的一部分,发行物不依赖任何外部仓库路径。
 *
 * 跑法:node tools/build-package.mjs [--out dist/clearai-dsh]
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = resolve(HERE, '..')
const OUT = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(PORT, 'dist', 'clearai-dsh'))
/**
 * `--version x.y.z`:构建期覆盖版本号(源仍是唯一的源,版本是**参数**)。
 * 为什么需要:生命周期验收要构两个版本才谈得上「升级」;真实发版也应该由 CI 传版本,
 * 而不是让构建脚本去改源文件。
 */
const VERSION_OVERRIDE = process.argv.includes('--version') ? process.argv[process.argv.indexOf('--version') + 1] : null
/** 残渣不进模板。 */
const TRANSIENT = new Set(['node_modules', 'dist', '.vite', 'coverage', '.pytest_cache', '__pycache__', '.git'])

/** 清单里的版本可按参数覆盖(其余字段原样)。 */
function writeManifest(from, to) {
	const manifest = JSON.parse(readFileSync(from, 'utf8'))
	if (VERSION_OVERRIDE !== null && VERSION_OVERRIDE !== '') manifest.version = VERSION_OVERRIDE
	mkdirSync(dirname(to), { recursive: true })
	writeFileSync(to, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
	copied.push(relative(OUT, to))
}

const copied = []
function copy(from, to) {
	if (!existsSync(from)) throw new Error(`源不存在:${from}`)
	mkdirSync(dirname(to), { recursive: true })
	cpSync(from, to, { recursive: true, filter: (src) => !TRANSIENT.has(src.split('/').pop()) })
	copied.push(relative(OUT, to))
}

console.log(`【打包】out=${OUT}`)
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// ── ① 包自己的部分(清单 / 补丁 / bin) ──────────────────────────────────────
writeManifest(join(PORT, 'package.json'), join(OUT, 'package.json'))
copy(join(PORT, 'pack', 'cordis.patch.yml'), join(OUT, 'cordis.patch.yml'))
copy(join(PORT, 'pack', 'bin'), join(OUT, 'bin'))

// ── ①′ 包里也要有 README 与 LICENSE ─────────────────────────────────────────
// npm 会把包根的同名文件带上;源在仓库根,不拷就发出去一个没有说明、没有许可证的包。
for (const name of ['README.md', 'README.zh-CN.md', 'LICENSE', 'CHANGELOG.md']) {
	if (existsSync(join(PORT, name))) copy(join(PORT, name), join(OUT, name))
}
// 品牌位图随包走:README 里那张组合标要在 npm 页面上也认得出来。
// 只带**资产与说明**:生成器是开发工具,不进发行物(纪律②:发行物只带该带的)。
if (existsSync(join(PORT, 'brand'))) {
	mkdirSync(join(OUT, 'brand'), { recursive: true })
	for (const name of readdirSync(join(PORT, 'brand'))) {
		if (name === 'build-icons.mjs') continue
		copy(join(PORT, 'brand', name), join(OUT, 'brand', name))
	}
}
// 插件列表的显示文案随包走:宿主按 `<包名>/locale/<语言>.json` 读 `meta.title` / `meta.description`,
// 缺了才回退到清单的 name / description(那时列表里显示的是包名 —— 也就是「没写介绍」)。
// 语言由文件名决定,所以整目录拷,不在构建期挑语言。
if (existsSync(join(PORT, 'locale'))) copy(join(PORT, 'locale'), join(OUT, 'locale'))

// ── ② 预设:整份随包走(skills 走 baseUrl,所以自洽) ─────────────────────────
for (const name of readdirSync(join(PORT, 'preset'))) {
	copy(join(PORT, 'preset', name), join(OUT, 'presets', 'clearai', name))
}

// ── ②′ 预设声明行:宿主 ≥0.1.7-alpha.1 的注册形态 ───────────────────────────
/**
 * 同一个预设从此有**两个消费者、一份源**:
 *   · 旧机制(≤0.1.6-alpha.2)读 `presets/clearai/agent.cordis.yml`(名册扫 root 目录);
 *   · 新机制(≥0.1.7-alpha.1)读**这里生成的** `presets/clearai/clearai.patch.yml` ——
 *     一条 `- id: preset-clearai` 声明行,`config.plugins` 里放整份插件列表。
 * 两者都由 `preset/agent.cordis.yml` 派生,不手抄第二份(手抄就是第二本账)。
 *
 * 为什么声明行文件放在 `presets/clearai/` 里:声明行 plugins 里的**相对基准**
 * (`name: './plugins/*.js'` 与 `!!js` 的 `baseUrl`)以该补丁文件所在目录为准。
 * 放在与 `agent.cordis.yml` 同一目录,两类相对写法都不用改一个字。
 * 依据与实测:CHANGELOG 的 [0.2.4] 一节;原设计稿 `lab/adapter/0.2.4-design.md` 已随工作区残留
 * 一起移出仓库,要看全文用 `git show 7b8a48d:lab/adapter/0.2.4-design.md`。
 */
const readPresetMeta = (file) => {
	// 不引 YAML 依赖:`preset.yml` 只有两个键,而 description 必须是块标量
	// (里面有「冒号 + 空格」,写成普通标量会被读成嵌套映射,而名册对读失败是静默降级)。
	const lines = readFileSync(file, 'utf8').split('\n')
	let name = 'ClearAI'
	const description = []
	let inDescription = false
	for (const line of lines) {
		if (inDescription) {
			if (/^\S/.test(line)) break // 下一个顶层键
			description.push(line.replace(/^\s{2}/, '').replace(/\s+$/, ''))
			continue
		}
		const named = /^name:\s*(.+?)\s*$/.exec(line)
		if (named !== null) {
			name = named[1]
			continue
		}
		if (/^description:\s*\|-?\s*$/.test(line)) inDescription = true
	}
	while (description.length > 0 && description[description.length - 1] === '') description.pop()
	if (description.length === 0) throw new Error(`preset.yml 里没读到块标量 description:${file}`)
	return { name, description }
}

{
	const PRESET_DIR = join(PORT, 'preset')
	const meta = readPresetMeta(join(PRESET_DIR, 'preset.yml'))
	const rows = readFileSync(join(PRESET_DIR, 'agent.cordis.yml'), 'utf8').replace(/\n+$/, '').split('\n')
	// `plugins:` 在 8 格,其下的列表项在 10 格 —— 整份组合平移过来,注释一并留下。
	const row = (line) => (line.trim() === '' ? '' : `          ${line}`)
	// 生成物进仓库(与 ui/vendor/*.js 同一条纪律):源是 preset/agent.cordis.yml,
	// 这份是它的派生件,**手改会在下次构建被覆盖**。它同时是发行物里那一份的来源。
	const packPath = join(PORT, 'pack', 'presets', 'clearai.patch.yml')
	mkdirSync(dirname(packPath), { recursive: true })
	writeFileSync(
		packPath,
		[
			'# 自动生成,不要手改 —— 源是 preset/agent.cordis.yml 与 preset/preset.yml,',
			'# 由 tools/build-package.mjs 装配(包 = 源的纯函数;verify-package 会现场重建再比对)。',
			'#',
			'# 宿主 ≥0.1.7-alpha.1 的 agent-preset-registry 读的就是它:',
			'# 预设 = 组合里的一条声明行,plugins 是下面这份插件列表。',
			'# 0.2.3 及以前靠 root 目录扫描,那条路在新宿主上已经不存在了。',
			'',
			'- insert:',
			'    - id: preset-clearai',
			"      name: '@deepseek-ai/dsh-agent-preset'",
			'      config:',
			'        id: clearai',
			`        name: ${meta.name}`,
			'        description: |-',
			...meta.description.map((line) => `          ${line}`),
			'        order: 10',
			'        plugins:',
			...rows.map(row),
			'',
		].join('\n'),
		'utf8',
	)
	copy(packPath, join(OUT, 'presets', 'clearai', 'clearai.patch.yml'))
	console.log(`  预设声明行:preset-clearai(${rows.filter((line) => /^- id:/.test(line)).length} 个顶层行)`)
}

// ── ④ 宿主半 / 浏览器半:同一份源,两个出口 ─────────────────────────────────
copy(join(PORT, 'ui', 'lib', 'index.js'), join(OUT, 'lib', 'host.js'))
copy(join(PORT, 'ui', 'lib', 'fold.js'), join(OUT, 'lib', 'fold.js'))
// 领域语言层的纯函数:折法与宿主路由都 import 它,所以它必须跟着走
// (少拷这一个文件,包里的 fold 会在 import 那一刻就报模块找不到)。
copy(join(PORT, 'ui', 'lib', 'domain-language.js'), join(OUT, 'lib', 'domain-language.js'))
// 叙述的单一来源:卡 / 右栏面板 / 货架读的是同一份投影。折法 import 它,
// 所以它必须跟着走(少拷这一个文件,包里的 fold 会在 import 那一刻报模块找不到)。
copy(join(PORT, 'ui', 'lib', 'knowledge-view.js'), join(OUT, 'lib', 'knowledge-view.js'))
// 宿主不变量的伴生件:单独一个文件,按名字可挂(`clearai-dsh/invariant`)。
copy(join(PORT, 'ui', 'lib', 'invariant.js'), join(OUT, 'lib', 'invariant.js'))
/**
 * 客户端半 = vendor 行(@xyflow/react,esbuild 打的) + 主文件,按序拼成**一份** client.js。
 *
 * 为什么拼而不是分两个文件:插件清单只认一个 `exports["./client"]`,模块系统也只装一行。
 * 拼接顺序是 vendor 在前——它注册 `@xyflow/react` 那一行,主文件的
 * `require('@xyflow/react')` 在工厂执行那一刻才解析,顺序是对的。
 */
const vendorBuild = await import('./build-vendor.mjs')
await vendorBuild.buildVendor()
await vendorBuild.buildForceVendor()
const vendorXyflow = readFileSync(join(PORT, 'ui', 'vendor', 'xyflow.js'), 'utf8')
const vendorForce = readFileSync(join(PORT, 'ui', 'vendor', 'force.js'), 'utf8')
const clientSource = readFileSync(join(PORT, 'ui', 'lib', 'client.js'), 'utf8')
writeFileSync(join(OUT, 'lib', 'client.js'), `${vendorXyflow}\n${vendorForce}\n${clientSource}`)

// ── ⑤ 产物清单:让人一眼看出包里有什么(也是 verify 的输入) ─────────────────
const inventory = []
const walk = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) walk(full)
		else inventory.push(relative(OUT, full))
	}
}
walk(OUT)
writeFileSync(join(OUT, 'INVENTORY.txt'), `${inventory.join('\n')}\n`, 'utf8')

const manifest = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8'))
console.log(`  清单:${manifest.name}@${manifest.version} · ${inventory.length} 个文件`)
console.log(`  关键出口:${Object.entries(manifest.exports).map(([key, value]) => `${key}→${value}`).join(' ')}`)
console.log('  完成。下一步:node tools/verify-package.mjs(会现场重建一遍再逐字节比对)')
