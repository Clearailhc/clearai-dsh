/**
 * verify-deploy —— 用**部署出去的文件**做一次装配,而不是用仓库里的源。
 *
 * 为什么需要它:DSH 里 ESM 模块按 URL 缓存,内核改动**不会**让已加载的模块失效,而常驻挂载只在
 * 组合文件 mtime 变化时重建。于是装配检查会拿**缓存里的旧模块**去挂,报出来的错
 * 与磁盘上的新代码无关。这个脚本用 cache-busting 的 URL 导入**部署路径**上的内核,喂**部署的
 * 组合文件**里的 config,做一次真实 `apply`。
 *
 * 它证明的是:部署的文件本身能装配、清单与配置面与代码相符(工具数 / 段数 / autonomy / 机制)。
 * 工具与段数以部署那一刻的组合为准(真值表有权威计数;别在这里再抄一份会过期的数)。
 * 它**不**证明运行期行为:那需要重启宿主(见 ROADMAP 开发纪律 1)。
 *
 * 它**也验宿主包**:用部署的那一份 + 假 ctx 装配一次,数「面板的三条路由是否挂在
 * connection 的 exact fetch 表上」——挂错层,浏览器里一按就是 404。
 *
 * 跑法:node tools/verify-deploy.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/**
 * 预设与宿主半现在都来自**装出来的包**(产品形态):
 *   <profile>/node_modules/clearai-dsh/presets/clearai
 *   <profile>/node_modules/clearai-dsh/lib/host.js
 * 开发形态(install.sh 摊进 ~/.dsh)也仍然认:`~/.dsh/.agent-presets/clearai` 存在就用它。
 * 两者都不在 ⇒ 如实说没装,而不是拿一个不存在的路径去 import。
 */
const HOME_DIR = process.env.DSH_HOME ?? join(process.env.HOME, '.dsh')
const PROFILE = process.env.DSH_PROFILE ?? 'web'
const PACKAGE_DIR = join(HOME_DIR, 'profiles', PROFILE, 'node_modules', 'clearai-dsh')
const DEV_PRESET = join(HOME_DIR, '.agent-presets', 'clearai')
const PRESET = existsSync(join(DEV_PRESET, 'plugins', 'clearai-kernel.js')) ? DEV_PRESET : join(PACKAGE_DIR, 'presets', 'clearai')
if (!existsSync(join(PRESET, 'plugins', 'clearai-kernel.js'))) {
	console.log(`✗ 没找到装出来的预设(找过 ${DEV_PRESET} 与 ${PRESET})。先装:node tools/install-native.mjs --profile ${PROFILE}`)
	process.exit(2)
}

/** 从组合文件里抽出 clearai-kernel 那一行的 config(文本级抽取,不是 YAML 解析)。 */
function readKernelConfig(yml) {
	const row = yml.slice(yml.indexOf('- id: clearai-kernel'))
	const body = row.slice(0, row.indexOf('\n# ──', 10))
	const config = {}
	for (const match of body.matchAll(/^ {4}([A-Za-z][A-Za-z0-9]*): (.+)$/gm)) {
		const [, key, raw] = match
		config[key] = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw
	}
	const declared = body.match(/contributions:\n([\s\S]*)$/)
	const mechanisms = {}
	if (declared !== null) {
		for (const match of declared[1].matchAll(/^ {8}([a-z]+): (true|false)$/gm)) mechanisms[match[1]] = match[2] === 'true'
	}
	if (Object.keys(mechanisms).length > 0) config.contributions = { mechanisms }
	return config
}

const ymlText = readFileSync(join(PRESET, 'agent.cordis.yml'), 'utf8')

/**
 * ⓪ 组合文件先过一遍**严格 YAML**。
 *
 * 为什么必须在这里(2026-09-11 长测抓到的真 bug):`blockedThreshold` 一度在这个文件里
 * 出现了两次(把旋钮提到顶层时,下面还留着一份)。`yaml` 包对重复键是**硬错误**,
 * 而 **DSH 的加载器是静默取值**的——于是 `install.sh` 报「装配成功」,部署里却是另一个数。
 * 下面那份 config 是**文本级抽取**的(它取最后一个匹配),所以它也不会发现重复。
 * 两条一起用:严格解析负责「文件本身合法」,文本抽取负责「部署的那份与代码对得上」。
 */
/**
 * yaml 包不是本仓库的依赖,但一定是 DSH 宿主自己的依赖——从宿主 CLI 的位置解析它,
 * 而不是把某台机器上的绝对路径写死(那条旧路径在别的机器上就是「模块找不到」)。
 */
function loadYaml() {
	const roots = [join(process.env.HOME ?? homedir(), '.npm', '_npx')]
	for (const root of roots) {
		for (const entry of existsSync(root) ? readdirSync(root) : []) {
			const dshPkg = join(root, entry, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
			if (existsSync(dshPkg)) return createRequire(dshPkg)('yaml')
		}
	}
	throw new Error('找不到 DSH 宿主自带的 yaml 包(查过 ~/.npm/_npx/*)。宿主装了它就在。')
}
let strictRows = null
try {
	const { parse } = loadYaml()
	strictRows = parse(ymlText, {
		// 组合文件用 !!js 表达平台相关的 disabled;严格解析只为查重复键/缩进,
		// js 片段本身不求值——解析成原文本即可。
		customTags: [{ tag: 'tag:yaml.org,2002:js', identify: () => false, resolve: (source) => source }],
	})
} catch (error) {
	console.log(`✗ 组合文件不是合法 YAML(重复键 / 缩进 / 语法):${String(error?.message ?? error).split('\n')[0]}`)
	process.exit(1)
}

const yml = ymlText
const config = readKernelConfig(yml)

// 交叉核对:文本抽取出来的 config 必须与 YAML 解析出来的**同一行**逐键一致。
if (Array.isArray(strictRows)) {
	const kernelRow = strictRows.find((row) => row?.id === 'clearai-kernel')
	const parsedConfig = kernelRow?.config ?? {}
	const mismatched = Object.keys(config).filter((key) => key !== 'contributions' && JSON.stringify(config[key]) !== JSON.stringify(parsedConfig[key]))
	if (mismatched.length > 0) {
		console.log(`✗ 文本抽取的 config 与 YAML 解析不一致(多半是重复键):${mismatched.map((key) => `${key}=${JSON.stringify(config[key])}≠${JSON.stringify(parsedConfig[key])}`).join(', ')}`)
		process.exit(1)
	}
}
const module = await import(pathToFileURL(join(PRESET, 'plugins', 'clearai-kernel.js')).href + '?probe=' + Date.now())

const tools = new Map()
const sections = []
const ctx = {
	logger: { info() {}, warn() {}, error() {} },
	get: () => undefined,
	on: () => () => {},
	effect(callback) {
		callback()
		return () => {}
	},
	tools: { register: (definition) => tools.set(definition.name, definition) },
	systemPrompt: {
		section(section) {
			sections.push(section)
			return () => {}
		},
	},
}

console.log(`预设:${PRESET}`)
try {
	module.apply(ctx, config)
} catch (error) {
	console.log(`✗ 装配失败:${error?.message ?? error}`)
	process.exit(1)
}

const clarifications = sections.filter((section) => section.name.includes('clarification')).map((section) => section.name)
const mechanisms = Object.entries(config.contributions?.mechanisms ?? {}).filter(([, on]) => on).map(([key]) => key)
console.log('✓ 装配成功(部署的组合文件 + 部署的内核,绕开 ESM 缓存)')
console.log(`  工具面:${tools.size} 件`)
console.log(`  段:${sections.length} 段 · 澄清协议 = ${clarifications.join(',') || '(缺失!)'}`)
console.log(`  机制:${mechanisms.join('/')} · autonomy = ${config.autonomy ?? '(缺省 attended)'}`)

/**
 * 宿主包也一起验:它里面的**三条面板路由**必须挂在 connection 的 exact fetch 表上
 * (2026-09-11 踩过两次:挂 webServer 上浏览器永远轮不到;`ctx.get` 拿一次拿不到就静默不挂)。
 * 这里用部署出去的那一份 + 假 ctx 做一次真实装配,数路由。
 */
const home = homedir()
const HOST_PKG = join(HOME_DIR, 'profiles', PROFILE, 'node_modules', 'clearai-dsh', 'lib', 'host.js')
let hostOk = true
let hostNote = '(宿主包不存在,跳过)'
if (existsSync(HOST_PKG)) {
	const host = await import(pathToFileURL(HOST_PKG).href + '?probe=' + Date.now())
	const routes = []
	const provided = []
	const hostCtx = {
		sessionProjections: { register: () => () => {}, stateOf: () => undefined },
		sessions: { get: () => undefined, list: () => [] },
		connection: {
			fetch: {
				register(route) {
					routes.push(route)
					return () => {}
				},
			},
		},
		logger: { info() {}, warn() {}, error() {} },
		get: () => undefined,
		on: () => () => {},
		inject(deps, callback) {
			callback(hostCtx)
			return () => {}
		},
		effect(callback) {
			const disposer = callback()
			return typeof disposer === 'function' ? disposer : () => {}
		},
		provide(name) {
			provided.push(name)
			return () => {}
		},
	}
	try {
		host.apply(hostCtx)
	} catch (error) {
		hostOk = false
		hostNote = `装配失败:${error?.message ?? error}`
	}
	if (hostOk) {
		const paths = routes.map((route) => route.path)
		const expected = ['/api/clearai/gate', '/api/clearai/deliverables', '/api/clearai/brain']
		const missing = expected.filter((path) => !paths.includes(path))
		const grammar = /^[A-Za-z0-9_$.-]+$/
		const badPath = paths.find((path) => path.split('/').slice(2).some((segment) => !grammar.test(segment)))
		hostOk = missing.length === 0 && badPath === undefined && provided.includes('clearai')
		hostNote = `路由 ${paths.length} 条(${paths.join(' ') || '无'})· 服务 ${provided.join(',') || '(无)'}${missing.length > 0 ? ` · 缺:${missing.join(',')}` : ''}${badPath === undefined ? '' : ` · 路径不合平台语法:${badPath}`}`
	}
}
console.log(`  宿主包:${hostOk ? '✓' : '✗'} ${hostNote}`)

const ok = tools.size === 29 && sections.length === 23 && clarifications.length === 1 && hostOk
console.log(ok ? '\n部署自洽。(运行期验收仍需重启宿主:内核按 URL 缓存。)' : '\n✗ 实测数字与预期不符。')
process.exit(ok ? 0 : 1)
