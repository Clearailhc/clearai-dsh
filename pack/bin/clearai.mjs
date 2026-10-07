#!/usr/bin/env node
/**
 * clearai-dsh 的安装侧工具。**只有一个动词会动 profile(`install`),而它动的方式是把活交给宿主**。
 *
 * 分包的三样东西落在三个平面:
 *   · 宿主半(`lib/host.js`)—— 由包自带的 `cordis.patch.yml` 在 profile 层插一行,`dsh plugin add` 自动生效;
 *   · 浏览器半(`lib/client.js`)—— 同一份清单里的 `dsh.client`,浏览器 Loader 自己扫;
 *   · agent 预设(`presets/clearai/clearai.patch.yml`)—— 一条 `- id: preset-clearai` 声明行,
 *     经清单的 `dsh.bundle.patch` 挂进组合;名册(`agent-preset-registry`)读的就是它。
 *
 * 宿主 ≥0.2.0 的名册**不扫目录、不收预设路径**(`@deepseek-ai/dsh-agent-preset-registry` 的 README:
 * "the registry neither scans directories nor accepts preset paths"),所以旧的 root 目录那几个动词
 * (`root-yaml` / `seed` / `unseed`)已经删掉:它们写出去的东西在这些宿主上没人读。
 *
 * 两个动词(默认是 `doctor` —— 一个安装侧工具不该在你没说要装的时候动你的部署):
 *   doctor      看现状:包在哪、预设在哪、组合里有没有宿主行与预设声明行、探测到的 dsh / profile 是什么
 *   install     把包装进 profile —— `dsh plugin --profile <p> add <spec>` 的一层**前置解析**
 *               (读者不必知道 profile 叫什么、CLI 从哪来、包名怎么写),装完给读数与下一步
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(HERE, '..')
const PRESET_ID = 'clearai'
const PRESET_SRC = join(PKG_DIR, 'presets', PRESET_ID)
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

const argv = process.argv.slice(2)
const command = argv[0] ?? 'doctor'
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
	const index = argv.indexOf(`--${name}`)
	return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}
const profile = value('profile', 'web')

/**
 * 语言:**跟系统走,不猜**。
 *
 * 判据顺序:`--lang zh|en` > `CLEARAI_LANG` > `LC_ALL` / `LC_MESSAGES` / `LANG` > ICU 的默认 locale。
 * `C` / `POSIX` 是「没有语言信息」,按英文处理(它们是 CI 与最小容器的默认值,不代表中文)。
 * 为什么认不出来时说英文:这是发给陌生人的第一条命令输出,不该假设对方读中文。
 * 两边的文案**并排放在一张表里**——同一句话的两个版本挨着,改的时候不会只改一边。
 */
const lang = (() => {
	const candidates = [value('lang', null), process.env.CLEARAI_LANG, process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG, Intl.DateTimeFormat().resolvedOptions().locale]
	for (const candidate of candidates) {
		if (typeof candidate !== 'string' || candidate === '') continue
		const tag = candidate.toLowerCase()
		if (tag.startsWith('zh')) return 'zh'
		if (tag === 'c' || tag === 'posix' || tag.startsWith('en')) return 'en'
	}
	return 'en'
})()

const TEXT = {
	zh: {
		pkgDir: '包目录        ',
		presetSrc: '预设源        ',
		presetOk: '(clearai.patch.yml ✓)',
		presetMissing: '(缺 clearai.patch.yml ✗)',
		dshHome: 'DSH_HOME      ',
		profileRow: 'profile       ',
		profileAbsent: '(不存在:先跑一次 dsh --profile {profile})',
		composeRow: '组合          ',
		composeUnreachable: '(问不到:dsh 不可用或超时 —— 下面两条无法判定)',
		hostRow: '宿主行        ',
		hostIn: '在组合里 ✓',
		hostOut: '不在组合里(先 dsh plugin --profile {profile} add <本包>)',
		presetRow: '预设声明行    ',
		presetIn: '在组合里 ✓(preset-clearai)',
		presetOut: '不在组合里:名册里不会有 ClearAI(这个 profile 可能没挂 agent-preset-registry,或宿主早于 0.2.0)',
		doctorHint: '\n提示:doctor 只读;它不会替你改 profile。',
		installHeader: '【安装】{name}@{version}',
		installWhat: '装什么      ',
		installWhere: '装到哪      ',
		installWho: '谁来跑      ',
		hostRowShort: '宿主行      ',
		sourceSpec: '你给的 spec',
		sourceTarball: '本地 tarball',
		sourceDir: '本地目录',
		sourceRegistry: 'registry',
		routeNpx: 'npx --yes @deepseek-ai/dsh(PATH 上没有 dsh)',
		pnpmMissing: '\n✗ PATH 上没有 pnpm,而 DSH 管理一个 profile 就是靠它:`dsh plugin …` 把参数转发给 pnpm。\n  装一个再来:npm install -g pnpm(或用系统包管理器,如 brew install pnpm)。\n  别用 corepack enable 抄近路 —— 它装的是版本**转发器**而不是 pnpm,而当前 Node 自带的\n  那份 corepack 可能下载一个它自己启动不了的 pnpm。\n  这里刻意不手工改 profile:那等于把宿主的 reconcile 抄成第二份实现,与宿主漂移时坏的是你的部署。',
		installFailed: '\n✗ 安装失败:见上面的输出。',
		hostUnknown: '(问不到组合:CLI 不可用或超时 —— 装没装进去,从这里确认不了;用 doctor 再看)',
		hostAbsent: '**不在组合里** —— 装是装上了,但组合里没看到它(用 doctor 查)',
		nextStep: '\n  下一步      重启 dsh web(两半都在进程里按模块 URL 缓存,只刷新浏览器不够),然后在预设选择器里选 ClearAI。',
		uninstall: '  卸载        dsh plugin --profile {profile} remove {name}(同样可以冠 npx)',
		unknownCommand: 'unknown command: {command}',
		usage: '用法:clearai-dsh [doctor|install|version] [--profile web] [--home <dir>] [--lang zh|en]\n     install 还可以:--dist <dir> | --tarball <tgz> | --spec <spec>',
	},
	en: {
		pkgDir: 'package       ',
		presetSrc: 'preset src    ',
		presetOk: '(clearai.patch.yml ✓)',
		presetMissing: '(no clearai.patch.yml ✗)',
		dshHome: 'DSH_HOME      ',
		profileRow: 'profile       ',
		profileAbsent: '(does not exist yet: run dsh --profile {profile} once)',
		composeRow: 'composition   ',
		composeUnreachable: '(could not ask: dsh unavailable or timed out — the next two rows cannot be decided)',
		hostRow: 'host row      ',
		hostIn: 'is in the composition ✓',
		hostOut: 'is NOT in the composition (run dsh plugin --profile {profile} add <this package>)',
		presetRow: 'preset row    ',
		presetIn: 'is in the composition ✓ (preset-clearai)',
		presetOut: 'is NOT in the composition: the roster will not offer ClearAI (this profile may not mount agent-preset-registry, or the host predates 0.2.0)',
		doctorHint: '\ndoctor only reads. It will not change your profile.',
		installHeader: '[install] {name}@{version}',
		installWhat: 'what        ',
		installWhere: 'where       ',
		installWho: 'who runs it ',
		hostRowShort: 'host row    ',
		sourceSpec: 'the spec you gave',
		sourceTarball: 'local tarball',
		sourceDir: 'local directory',
		sourceRegistry: 'registry',
		routeNpx: 'npx --yes @deepseek-ai/dsh (no dsh on PATH)',
		pnpmMissing: '\n✗ pnpm is not on PATH, and it is how DSH manages a profile: `dsh plugin …` forwards to it.\n  Install one and come back: npm install -g pnpm (or your package manager, e.g. brew install pnpm).\n  Do not take the corepack enable shortcut — that installs a version *forwarder*, not pnpm, and the\n  corepack bundled with current Node may fetch a pnpm it is unable to launch.\n  This verb deliberately does not edit the profile by hand: that would be a second implementation of the host\'s reconcile, and yours is the deployment that breaks when it drifts.',
		installFailed: '\n✗ install failed: see the output above.',
		hostUnknown: '(could not ask the composition: CLI unavailable or timed out — whether it landed cannot be decided here; run doctor)',
		hostAbsent: '**NOT in the composition** — it installed, but the composition does not show it (run doctor)',
		nextStep: '\n  next        restart dsh web (both halves are cached in the running process by module URL, so a browser refresh is not enough), then pick ClearAI in the preset picker.',
		uninstall: '  uninstall   dsh plugin --profile {profile} remove {name}(npx works too)',
		unknownCommand: 'unknown command: {command}',
		usage: 'usage: clearai-dsh [doctor|install|version] [--profile web] [--home <dir>] [--lang zh|en]\n       install also takes: --dist <dir> | --tarball <tgz> | --spec <spec>',
	},
}

/** `{name}` 是占位符。 */
function t(key, params) {
	const text = TEXT[lang][key] ?? TEXT.zh[key]
	if (text === undefined) throw new Error(`missing text: ${key}`)
	return typeof text === 'function' ? text(params ?? {}) : text.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))
}

/**
 * 在 PATH 上找一个可执行文件,找到就返回全路径。
 *
 * 为什么不用 `bash -lc 'command -v pnpm'`(tools/install-native.mjs 的写法):
 * 这里要能在 Windows 上跑,而 `command -v` 是 shell 内建;另外**只查文件、不执行它** ——
 * 执行一个 pnpm 可能是别的东西(比如 corepack 的转发器)在跑,那会引出网络与副作用。
 */
function findOnPath(name) {
	const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat'] : ['']
	for (const dir of (process.env.PATH ?? '').split(delimiter)) {
		if (dir === '') continue
		for (const ext of exts) {
			const candidate = join(dir, `${name}${ext}`)
			try {
				if (statSync(candidate).isFile()) return candidate
			} catch {
				/* 这个目录里没有 */
			}
		}
	}
	return null
}

/**
 * 问组合:宿主行到底有没有真的进组合。
 *
 * 优先用 PATH 上**真正的** `dsh`(以前一律走 `npx --no-install`,于是 PATH 上有 CLI 的机器
 * 也会报「问不到」);没有 CLI 才退回 npx,且仍然 `--no-install` —— 诊断动作不该顺手下载东西。
 */
function composeQuery(profileName, env) {
	const onPath = findOnPath('dsh')
	const args = ['--profile', profileName, '--dump-config']
	const run = onPath === null
		? spawnSync('npx', ['--no-install', '@deepseek-ai/dsh', ...args], { encoding: 'utf8', env, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] })
		: spawnSync(onPath, args, { encoding: 'utf8', env, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] })
	return run.status === 0 ? String(run.stdout ?? '') : null
}

function doctor() {
	const rows = []
	rows.push(`${t('pkgDir')}${PKG_DIR}`)
	rows.push(`${t('presetSrc')}${PRESET_SRC}${existsSync(join(PRESET_SRC, 'clearai.patch.yml')) ? t('presetOk') : t('presetMissing')}`)
	rows.push(`${t('dshHome')}${DSH_HOME}`)
	const profileDir = join(DSH_HOME, 'profiles', profile)
	rows.push(`${t('profileRow')}${profileDir}${existsSync(profileDir) ? '' : t('profileAbsent', { profile })}`)
	/**
	 * 宿主行与预设声明行**问组合**,不问某个文件(2026-09-11 修:装出来的形态下这两行来自
	 * **包的补丁层**,不在 profile 的 cordis.patch.yml 里 —— 读文件的写法会误报「还没挂」)。
	 * 事实在组合里;问不到就如实说问不到,不猜。
	 */
	const composed = composeQuery(profile, { ...process.env, DSH_HOME })
	if (composed === null) {
		rows.push(`${t('composeRow')}${t('composeUnreachable')}`)
	} else {
		const rowIds = [...composed.matchAll(/^- id: (\S+)$/gm)].map((match) => match[1])
		rows.push(`${t('hostRow')}${rowIds.includes('clearai-host') ? t('hostIn') : t('hostOut', { profile })}`)
		/** 名册读的是组合里的 `preset-clearai` 声明行(由包的 `dsh.bundle.patch` 挂进来),不是某个目录。 */
		rows.push(`${t('presetRow')}${rowIds.includes('preset-clearai') ? t('presetIn') : t('presetOut')}`)
	}
	for (const row of rows) console.log(`  ${row}`)
	console.log(t('doctorHint'))
}

/**
 * install —— 把包装进一个 profile。
 *
 * 真正干活的**永远是宿主的 CLI**(`dsh plugin --profile <p> add <spec>`):它自己会初始化
 * profile、在 profile 目录里跑 pnpm、再对账 `dsh.profile.bundles`。这里只解析三件事 ——
 * 装什么、装到哪、谁来跑 —— 于是读者不必先读过别的文档。
 *
 * 两条纪律:
 *   · **不偷偷降级**。没有 pnpm 就停下来把话说清楚:pnpm 是 DSH 的前置,不是本插件的。
 *     在 profile 里手工摆文件等于把宿主的 reconcile 抄成第二份实现,而它一旦与宿主漂移,
 *     坏的是用户的部署。(降级只保留在 `tools/install-native.mjs` —— 那是一次性 DSH_HOME 上的
 *     E2E 需要,而且它如实标注自己是降级。)
 *   · **装完给读数**。不靠一句「成功」交差:再问一次组合,看宿主行是不是真的进去了。
 */
function install() {
	const home = resolve(value('home', DSH_HOME))
	const env = { ...process.env, DSH_HOME: home }
	const profileDir = join(home, 'profiles', profile)
	const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
	const explicit = value('spec', null)
	const dist = value('dist', null)
	const tarball = value('tarball', null)
	/**
	 * 缺省装 **registry 上的这一版**:profile 从此真正拥有它(能升级、能卸载),也不依赖
	 * npx 缓存还在。`--dist` / `--tarball` / `--spec` 是给开发与 E2E 用的另一条入口。
	 */
	const spec = explicit ?? (tarball !== null ? resolve(tarball) : dist !== null ? `file:${resolve(dist)}` : `${manifest.name}@${manifest.version}`)
	const source = explicit !== null ? t('sourceSpec') : tarball !== null ? t('sourceTarball') : dist !== null ? t('sourceDir') : t('sourceRegistry')
	/** PATH 上有 `dsh` 就用它;没有就用 npx 取官方 CLI(`--yes`:一键安装不该卡在一个确认提示上)。 */
	const dshPath = findOnPath('dsh')
	const route = dshPath === null ? t('routeNpx') : dshPath
	/**
	 * 子进程**继承 stdio**:安装进度、以及 CLI 那句 `initialized profile …` 都如实流到用户眼前;
	 * 失败时他看到的也是真实报错,而不是我截出来的尾巴。
	 */
	const dsh = (args) => (dshPath === null ? spawnSync('npx', ['--yes', '@deepseek-ai/dsh', ...args], { env, stdio: 'inherit', timeout: 900000 }) : spawnSync(dshPath, args, { env, stdio: 'inherit', timeout: 900000 }))

	console.log(t('installHeader', { name: manifest.name, version: manifest.version }))
	console.log(`  ${t('installWhat')}${spec}(${source})`)
	console.log(`  ${t('installWhere')}${profileDir}`)
	console.log(`  ${t('installWho')}${route}`)

	const pnpmPath = findOnPath('pnpm')
	if (pnpmPath === null) {
		console.error(t('pnpmMissing'))
		process.exit(1)
	}

	/**
	 * **刻意不做 profile bootstrap**:CLI 第一次用到某个 profile 时自己就会初始化它
	 * (实测输出 `dsh: initialized profile web at …`),那本来就是宿主的不变量,抄一遍只会
	 * 多一个会漂移的实现。顺带说:`--from-default-profile` 只接受**自定义目标**,把 shipped
	 * 名字传给它会被 CLI 直接拒 —— `profile "web" is shipped and cannot be a custom profile
	 * target`。所以这里连那个开关都不提供。
	 */
	const added = dsh(['plugin', '--profile', profile, 'add', spec])
	if (added.status !== 0) {
		console.error(t('installFailed'))
		process.exit(1)
	}

	const composed = composeQuery(profile, env)
	if (composed === null) {
		console.log(`  ${t('hostRowShort')}${t('hostUnknown')}`)
	} else {
		const inCompose = /^- id: clearai-host$/m.test(composed)
		console.log(`  ${t('hostRowShort')}${inCompose ? t('hostIn') : t('hostAbsent')}`)
	}
	console.log(t('nextStep'))
	console.log(t('uninstall', { profile, name: manifest.name }))
}

if (command === 'doctor') doctor()
else if (command === 'install') install()
else if (command === 'version' || flag('version')) console.log(JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version)
else {
	console.error(`${t('unknownCommand', { command })}\n${t('usage')}`)
	process.exit(2)
}
