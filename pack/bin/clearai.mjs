#!/usr/bin/env node
/**
 * clearai-dsh 的安装侧工具。**只有一个动词会动 profile(`install`),而它动的方式是把活交给宿主**。
 *
 * 分包的三样东西落在三个平面:
 *   · 宿主半(`lib/host.js`)—— 由包自带的 `cordis.patch.yml` 在 profile 层插一行,`dsh plugin add` 自动生效;
 *   · 浏览器半(`lib/client.js`)—— 同一份清单里的 `dsh.client`,浏览器 Loader 自己扫;
 *   · agent 预设(`presets/clearai/`)—— **名册(roster)只从 root 目录扫**,包没法直接声明,
 *     所以要么把 root 指进包里,要么把它播种到用户根。这一件就是本工具存在的理由。
 *
 * 处理方式(前四个默认只**打印**不改;默认动词仍是 `doctor` —— 一个安装侧工具不该在
 * 你没说要装的时候动你的部署):
 *   doctor      看现状:包在哪、预设在哪、名册能不能看见它、探测到的 dsh / profile 是什么
 *   install     把包装进 profile —— `dsh plugin --profile <p> add <spec>` 的一层**前置解析**
 *               (读者不必知道 profile 叫什么、CLI 从哪来、包名怎么写),装完给读数与下一步
 *   root-yaml   打印**可以直接粘进 profile 的 `cordis.patch.yml`** 的那一行(路径已算成绝对路径)
 *   seed        把预设**播种**到用户根 `~/.dsh/.agent-presets/<id>`(带哈希记账:改过的不覆盖)
 *   unseed      撤掉播种:只删「我们播的、且没被改过」的文件;用户 fork 的 id 一律不碰
 *
 * 纪律(与内核播种模板技能同一条):**改过的东西不覆盖,只如实报漂移**;删东西之前先看哈希。
 * 不改用户的 `cordis.patch.yml` —— 那一行的内容由人自己粘(工具只负责把绝对路径算对)。
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(HERE, '..')
const PRESET_ID = 'clearai'
const PRESET_SRC = join(PKG_DIR, 'presets', PRESET_ID)
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const LEDGER = join(DSH_HOME, '.clearai-dsh.json')

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
		presetOk: '(agent.cordis.yml ✓)',
		presetMissing: '(缺 agent.cordis.yml ✗)',
		dshHome: 'DSH_HOME      ',
		userRoot: '用户根        ',
		rosterVisible: '✓ 名册看得见',
		rosterAbsent: '✗ 还没有(用 seed 播种,或把 root-yaml 那一行粘进 profile)',
		shadowCopy: '  ⚠️ 影子副本     {path} 与包里的那份**不一致**,而它被包的 root 遮住、永远不会被读到(自检却会优先读它)。删掉它,或用它来承载你自己的改动并换一个 id。',
		profileRow: 'profile       ',
		profileAbsent: '(不存在:先跑一次 dsh --profile {profile})',
		composeRow: '组合          ',
		composeUnreachable: '(问不到:dsh 不可用或超时 —— 下面两条无法判定)',
		hostRow: '宿主行        ',
		hostIn: '在组合里 ✓',
		hostOut: '不在组合里(先 dsh plugin --profile {profile} add <本包>)',
		rosterRootRow: '名册 root     ',
		rosterNoRoots: '组合里没看到 roots(这个部署可能不挂名册)',
		rosterExpr: '{expr}(dump 打的是表达式原文,求值在装载时)',
		seedLedgerRow: '播种记账      ',
		ledgerEmpty: '(空)',
		ledgerCount: '{count} 个条目 · {path}',
		doctorHint: '\n提示:doctor 只读;它不会替你改 profile,也不会替你播种。',
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
		rootYamlComment1: '# ClearAI 预设的 root(由 clearai-dsh 的 bin 打印,路径已算成绝对路径)',
		rootYamlComment2: '    # ⚠️ 补丁层会**替换整份 config**:下面这些键必须与你部署里那份一致,否则会丢。',
		rootYamlComment3: '    #    先 `dsh --profile <p> --dump-config | grep -A 20 agent-presets` 看一眼当前值再粘。',
		noPresetInPackage: '✗ 包里没有预设:{path}',
		seededTo: '  播种到        {dest}',
		seedCounts: '  新增 {seeded} · 刷新 {refreshed}',
		seedDrifted: ' · **你改过、没覆盖** {count}({list})',
		seedNext: '  下一步:重启 dsh(或刷新页面)后,预设选择器里应出现「ClearAI」。',
		noSeedLedger: '  没有播种记账:什么都不做(不知道哪些是我们播的,就不删)。',
		unseedRemoved: '  删掉 {count} 个「我们播的、没被改过」的文件',
		unseedKept: '  **保留** {count} 个你改过的文件(它们现在是你的):{list}',
		unknownCommand: 'unknown command: {command}',
		usage: '用法:clearai-dsh [doctor|install|root-yaml|seed|unseed] [--profile web] [--home <dir>] [--lang zh|en]\n     install 还可以:--dist <dir> | --tarball <tgz> | --spec <spec>',
	},
	en: {
		pkgDir: 'package       ',
		presetSrc: 'preset src    ',
		presetOk: '(agent.cordis.yml ✓)',
		presetMissing: '(no agent.cordis.yml ✗)',
		dshHome: 'DSH_HOME      ',
		userRoot: 'user root     ',
		rosterVisible: '✓ visible to the roster',
		rosterAbsent: '✗ not there yet (seed it, or paste the root-yaml line into the profile)',
		shadowCopy: '  ⚠️ shadow copy  {path} differs from the copy in the package, and the package root shadows it — it will never be read (while the self-check reads it first). Delete it, or keep your changes there under a different id.',
		profileRow: 'profile       ',
		profileAbsent: '(does not exist yet: run dsh --profile {profile} once)',
		composeRow: 'composition   ',
		composeUnreachable: '(could not ask: dsh unavailable or timed out — the next two rows cannot be decided)',
		hostRow: 'host row      ',
		hostIn: 'is in the composition ✓',
		hostOut: 'is NOT in the composition (run dsh plugin --profile {profile} add <this package>)',
		rosterRootRow: 'roster root   ',
		rosterNoRoots: 'no roots in the composition (this deployment may not mount the roster)',
		rosterExpr: '{expr}(the dump prints the expression verbatim; it is evaluated at load time)',
		seedLedgerRow: 'seed ledger   ',
		ledgerEmpty: '(empty)',
		ledgerCount: '{count} entries · {path}',
		doctorHint: '\ndoctor only reads. It will not change your profile and will not seed anything for you.',
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
		rootYamlComment1: '# ClearAI preset root (printed by clearai-dsh; the path is already absolute)',
		rootYamlComment2: '    # ⚠️ a patch layer **replaces the whole config**: these keys must match the ones in your deployment, or they are lost.',
		rootYamlComment3: '    #    Run `dsh --profile <p> --dump-config | grep -A 20 agent-presets` first and paste over the current values.',
		noPresetInPackage: '✗ no preset in the package: {path}',
		seededTo: '  seeded to   {dest}',
		seedCounts: '  added {seeded} · refreshed {refreshed}',
		seedDrifted: ' · **kept your edits** {count}({list})',
		seedNext: '  next: restart dsh (or refresh the page) — ClearAI should now appear in the preset picker.',
		noSeedLedger: '  nothing was seeded: doing nothing (without the ledger there is no way to tell which files are ours, so nothing is deleted).',
		unseedRemoved: '  removed {count} file(s) we seeded and you did not edit',
		unseedKept: '  **kept** {count} file(s) you edited (they are yours now): {list}',
		unknownCommand: 'unknown command: {command}',
		usage: 'usage: clearai-dsh [doctor|install|root-yaml|seed|unseed] [--profile web] [--home <dir>] [--lang zh|en]\n       install also takes: --dist <dir> | --tarball <tgz> | --spec <spec>',
	},
}

/** `{name}` 是占位符;需要拼计数与列表的句子写成函数(见 doctor / seed / unseed)。 */
function t(key, params) {
	const text = TEXT[lang][key] ?? TEXT.zh[key]
	if (text === undefined) throw new Error(`missing text: ${key}`)
	return typeof text === 'function' ? text(params ?? {}) : text.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))
}

/** 递归列出文件(相对路径 → sha256 前 16 位)。只为记账,不为校验完整性。 */
function hashTree(root) {
	const out = {}
	const walk = (dir) => {
		let entries = []
		try {
			entries = readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			const full = join(dir, entry.name)
			if (entry.isDirectory()) walk(full)
			else if (entry.isFile()) out[relative(root, full)] = createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 16)
		}
	}
	walk(root)
	return out
}

function readLedger() {
	try {
		const parsed = JSON.parse(readFileSync(LEDGER, 'utf8'))
		return parsed !== null && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

function writeLedger(next) {
	try {
		mkdirSync(dirname(LEDGER), { recursive: true })
		writeFileSync(LEDGER, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
		return true
	} catch {
		return false
	}
}

/** 名册会扫哪些 root —— 与 `@deepseek-ai/dsh-agent-presets` 的规则同形(自带 → 配置 → 用户根)。 */
function rosterRoots() {
	return [join(DSH_HOME, '.agent-presets')]
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
	rows.push(`${t('presetSrc')}${PRESET_SRC}${existsSync(join(PRESET_SRC, 'agent.cordis.yml')) ? t('presetOk') : t('presetMissing')}`)
	rows.push(`${t('dshHome')}${DSH_HOME}`)
	const roots = rosterRoots()
	for (const root of roots) {
		const dir = join(root, PRESET_ID)
		const present = existsSync(join(dir, 'agent.cordis.yml'))
		rows.push(`${t('userRoot')}${dir} ${present ? t('rosterVisible') : t('rosterAbsent')}`)
		/**
		 * 用户根里那份**会不会被包的 root 遮住**。
		 *
		 * 名册按 root 顺序先到先得(自带 root → 配置 root → 用户根),所以包一装,用户根里
		 * 同 id 的那份副本就**再也读不到**——它会安静地烂在那里,还会把「部署出去的那份」的
		 * 自检引到你手改过的旧副本上。判据只取事实:两份 `preset.yml` 的字节是否一致。
		 */
		const mine = join(PRESET_SRC, 'preset.yml')
		const theirs = join(dir, 'preset.yml')
		if (!present || !existsSync(mine) || !existsSync(theirs)) continue
		let same = false
		try {
			same = readFileSync(mine).equals(readFileSync(theirs))
		} catch {
			same = false
		}
		if (!same) rows.push(t('shadowCopy', { path: theirs }))
	}
	const profileDir = join(DSH_HOME, 'profiles', profile)
	rows.push(`${t('profileRow')}${profileDir}${existsSync(profileDir) ? '' : t('profileAbsent', { profile })}`)
	/**
	 * 宿主行与名册 root **问组合**,不问某个文件(2026-09-11 修:装出来的形态下这两行来自
	 * **包的补丁层**,不在 profile 的 cordis.patch.yml 里 —— 读文件的写法会误报「还没挂」)。
	 * 事实在组合里;问不到就如实说问不到,不猜。
	 */
	const composed = composeQuery(profile, { ...process.env, DSH_HOME })
	if (composed === null) {
		rows.push(`${t('composeRow')}${t('composeUnreachable')}`)
	} else {
		const rowIds = [...composed.matchAll(/^- id: (\S+)$/gm)].map((match) => match[1])
		rows.push(`${t('hostRow')}${rowIds.includes('clearai-host') ? t('hostIn') : t('hostOut', { profile })}`)
		const roster = /- id: agent-presets[\s\S]{0,600}?\n\s*- path:[^\n]*/.exec(composed)
		const expr = roster === null ? null : roster[0].split('\n').pop().trim()
		rows.push(`${t('rosterRootRow')}${expr === null ? t('rosterNoRoots') : t('rosterExpr', { expr })}`)
	}
	const ledger = readLedger()
	rows.push(`${t('seedLedgerRow')}${Object.keys(ledger).length === 0 ? t('ledgerEmpty') : t('ledgerCount', { count: Object.keys(ledger).length, path: LEDGER })}`)
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

function rootYaml() {
	const line = [
		t('rootYamlComment1'),
		'- id: \'@deepseek-ai/dsh-agent-presets\'',
		'  config:',
		t('rootYamlComment2'),
		t('rootYamlComment3'),
		'    default: standard',
		'    includeShippedRoot: true',
		'    includeUserRoot: true',
		'    roots:',
		`      - path: '${join(PKG_DIR, 'presets')}'`,
		'        trust: system',
	].join('\n')
	console.log(line)
}

function seed() {
	if (!existsSync(join(PRESET_SRC, 'agent.cordis.yml'))) {
		console.error(t('noPresetInPackage', { path: PRESET_SRC }))
		process.exit(1)
	}
	const root = value('root', rosterRoots()[0])
	const dest = join(root, PRESET_ID)
	const next = hashTree(PRESET_SRC)
	const before = readLedger()
	const previous = before[PRESET_ID]?.files ?? {}
	const seeded = []
	const refreshed = []
	const drifted = []
	for (const [rel, hash] of Object.entries(next)) {
		const target = join(dest, rel)
		const onDisk = existsSync(target) ? createHash('sha256').update(readFileSync(target)).digest('hex').slice(0, 16) : null
		if (onDisk === null) {
			mkdirSync(dirname(target), { recursive: true })
			cpSync(join(PRESET_SRC, rel), target)
			seeded.push(rel)
			continue
		}
		if (onDisk === hash) continue
		// 改过的不覆盖:与内核播种模板技能同一条纪律
		if (previous[rel] !== undefined && onDisk !== previous[rel]) {
			drifted.push(rel)
			continue
		}
		cpSync(join(PRESET_SRC, rel), target)
		refreshed.push(rel)
	}
	before[PRESET_ID] = { files: next, at: new Date().toISOString(), dest }
	writeLedger(before)
	console.log(t('seededTo', { dest }))
	console.log(`${t('seedCounts', { seeded: seeded.length, refreshed: refreshed.length })}${drifted.length === 0 ? '' : t('seedDrifted', { count: drifted.length, list: drifted.slice(0, 5).join(lang === 'zh' ? '、' : ', ') })}`)
	console.log(t('seedNext'))
}

function unseed() {
	const ledger = readLedger()
	const entry = ledger[PRESET_ID]
	if (entry === undefined) {
		console.log(t('noSeedLedger'))
		return
	}
	const dest = entry.dest ?? join(rosterRoots()[0], PRESET_ID)
	const removed = []
	const kept = []
	for (const [rel, hash] of Object.entries(entry.files ?? {})) {
		const target = join(dest, rel)
		if (!existsSync(target)) continue
		const onDisk = createHash('sha256').update(readFileSync(target)).digest('hex').slice(0, 16)
		if (onDisk === hash) {
			rmSync(target)
			removed.push(rel)
		} else {
			kept.push(rel)
		}
	}
	delete ledger[PRESET_ID]
	writeLedger(ledger)
	console.log(t('unseedRemoved', { count: removed.length }))
	if (kept.length > 0) console.log(t('unseedKept', { count: kept.length, list: kept.slice(0, 5).join(lang === 'zh' ? '、' : ', ') }))
	// 空目录收掉(只收我们知道的那些;非空绝不动)
	try {
		if (existsSync(dest) && readdirSync(dest).length === 0) rmSync(dest, { recursive: true })
	} catch {
		/* 收不掉就算了,不影响判定 */
	}
}

if (command === 'doctor') doctor()
else if (command === 'install') install()
else if (command === 'root-yaml') rootYaml()
else if (command === 'seed') seed()
else if (command === 'unseed') unseed()
else if (command === 'version' || flag('version')) console.log(JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version)
else {
	console.error(`${t('unknownCommand', { command })}\n${t('usage')}`)
	process.exit(2)
}
