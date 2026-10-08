/**
 * verify-lifecycle —— preset 与包的**生命周期**验收(S4):升级 / 卸载 / 随包的 install 动词。
 *
 * 为什么单开一个工具:升级与卸载都不是「装一次能不能用」,而是**时间轴上的行为**——
 *   · 升级:换版本重装,层栈不能重复、组合不能丢行、预设归属不能断;
 *   · 卸载:行、bundles、node_modules、预设归属四处都要回到装之前,不留悬空引用;
 *   (原来的第三件「用户 fork:播种到用户根」随 `seed` / `unseed` 一起删了:宿主 ≥0.2.0 的名册
 *    不扫目录,播种出去的副本没人读。想改预设,复制声明行换一个 id,作为自己的 bundle patch 装。)
 *
 * 判据全部是机械的(文件哈希、bundles 列表、组合里的行、预设归属行/表达式),
 * 全部在一个**一次性 DSH_HOME** 里跑,不碰真实部署。
 *
 * 跑法:node tools/verify-lifecycle.mjs [--keep]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = resolve(HERE, '..')
const KEEP = process.argv.includes('--keep')
let passed = 0
let failed = 0
const failures = []
const check = (label, condition, detail = '') => {
	if (condition) {
		passed += 1
		console.log(`  ✓ ${label}`)
	} else {
		failed += 1
		failures.push(label)
		console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`)
	}
}
const sha = (file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16) : null)

const HOME = mkdtempSync(join(tmpdir(), 'clearai-life-'))
const V1 = mkdtempSync(join(tmpdir(), 'clearai-v1-'))
const V2 = mkdtempSync(join(tmpdir(), 'clearai-v2-'))
const ENV = { ...process.env, DSH_HOME: HOME }
const realHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
for (const name of ['.credentials.yaml', 'settings.yaml']) {
	if (existsSync(join(realHome, name))) cpSync(join(realHome, name), join(HOME, name))
}
console.log(`【生命周期验收】DSH_HOME=${HOME}(profile 用官方 **web** 模板:预设归属只在挂它的部署里存在,`)
console.log('                       而 S4 要验的正是「预设归属在升级/卸载后还在不在」)')
console.log(`  v1=${V1}\n  v2=${V2}`)

const build = (out, version) => {
	const run = spawnSync('node', [join(PORT, 'tools', 'build-package.mjs'), '--out', out, '--version', version], { encoding: 'utf8' })
	if (run.status !== 0) throw new Error(`build ${version} 失败:${String(run.stderr ?? '').slice(-300)}`)
}
const install = (dist, extra = []) =>
	spawnSync('node', [join(PORT, 'tools', 'install-native.mjs'), '--home', HOME, '--profile', 'life', '--from-default', 'web', '--dist', dist, ...extra], { encoding: 'utf8', env: ENV, timeout: 900000 })
/** 在 PATH 上找一个可执行文件(只查文件、不执行它)。 */
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
const DSH_ON_PATH = findOnPath('dsh')
const composedRows = () => {
	/**
	 * 优先 PATH 上真正的 `dsh`(与随包 bin 的 `install`、`install-native.mjs` 同一套判据)。
	 * 以前一律 `npx --no-install`:在 npx 跑不起来的环境里它会**静默返回空串**,
	 * 于是下面两条正向断言红、而"组合里没有 clearai-host"那条**假通过** —— 空输出骗过负向断言。
	 */
	const run = DSH_ON_PATH === null
		? spawnSync('npx', ['--no-install', '@deepseek-ai/dsh', '--profile', 'life', '--dump-config'], { encoding: 'utf8', env: ENV, timeout: 300000 })
		: spawnSync(DSH_ON_PATH, ['--profile', 'life', '--dump-config'], { encoding: 'utf8', env: ENV, timeout: 300000 })
	return String(run.stdout ?? '')
}
const profileManifest = () => JSON.parse(readFileSync(join(HOME, 'profiles', 'life', 'package.json'), 'utf8'))
/**
 * 预设的**归属**在组合里(装上了/还在/已经没了,看的就是它)。
 *
 * 宿主 ≥0.2.0 的名册只认**组合里的声明行**(`agent-preset-registry` + `preset-clearai`),
 * 不扫目录;判据与 `tools/verify-clean-install.mjs` 的 ④/④′ 同一套读法。
 */
const presetAnchored = (rows) => {
	if (!rows.includes('- id: agent-preset-registry')) return false
	const at = rows.indexOf('- id: preset-clearai')
	return at >= 0 && /name:\s*'@deepseek-ai\/dsh-agent-preset'/.test(rows.slice(at, at + 600)) && rows.includes('clearai-dsh/presets/')
}
const pkgDir = join(HOME, 'profiles', 'life', 'node_modules', 'clearai-dsh')

// ── ① 升级:换版本重装,层栈/行/预设归属都不许坏 ────────────────────────────
console.log('\n① 升级(0.1.0 → 0.1.1 重装)')
build(V1, '0.1.0')
const v1 = install(V1)
check('0.1.0 装上了', v1.status === 0, String(v1.stderr ?? '').slice(-200))
const beforeBundles = profileManifest().dsh?.profile?.bundles ?? []
const beforeRows = composedRows()
/** 逐字节比一棵目录树(判定「盘上那份就是这次构建的产物」)。 */
const hashTree = (root) => {
	const out = {}
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const full = join(dir, entry.name)
			if (entry.isDirectory()) walk(full)
			else out[full.slice(root.length + 1)] = sha(full)
		}
	}
	walk(root)
	return out
}
check('层栈里有 clearai-dsh(且只一次)', beforeBundles.filter((name) => name === 'clearai-dsh').length === 1, beforeBundles.join(' · '))
check('组合里有 clearai-host 行', /^- id: clearai-host$/m.test(beforeRows))
check('预设归属在组合里(preset-clearai 声明行)', presetAnchored(beforeRows))

build(V2, '0.1.1')
const v2 = install(V2)
check('0.1.1 覆盖装上', v2.status === 0, String(v2.stderr ?? '').slice(-200))
const afterBundles = profileManifest().dsh?.profile?.bundles ?? []
const afterRows = composedRows()
const installedTree = hashTree(pkgDir)
const builtTree = hashTree(V2)
/**
 * `INVENTORY.txt` 是**构建自己的文件清单**,不在清单的 `files` 白名单里,所以 pnpm 打包时
 * 不带它 —— 于是「盘上那份 vs 构建产物」这条比对必须把它排除,否则这闸门**永远打不开**。
 * (2026-09-15 实测:它一直红着;verify-lifecycle 不在 CI 里跑,所以没人看见。一道打不开的
 * 闸门比没有闸门更坏 —— 它会让人以为验过了。)
 */
delete builtTree['INVENTORY.txt']
check('层栈没有重复(升级后仍只有一次)', afterBundles.filter((name) => name === 'clearai-dsh').length === 1, afterBundles.join(' · '))
check('组合里 clearai-host 行仍在', /^- id: clearai-host$/m.test(afterRows))
check('升级后预设归属仍在(同一条判据)', presetAnchored(afterRows))
{
	const differing = Object.keys(builtTree).filter((rel) => installedTree[rel] !== builtTree[rel])
	const missing = Object.keys(builtTree).filter((rel) => installedTree[rel] === undefined)
	check(
		'盘上那份就是这次构建的产物(逐字节相同 —— 版本变了但源没变,内核哈希本来就不该变)',
		differing.length === 0 && missing.length === 0,
		JSON.stringify({ 内容不同: differing.slice(0, 3), 缺: missing.slice(0, 3) }),
	)
}
check('包内清单版本是新的', JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version === '0.1.1')

// ── ② 卸载:四处都要回到装之前 ──────────────────────────────────────────────
console.log('\n② 卸载(行 / bundles / node_modules / 预设归属)')
const removed = install(V2, ['--uninstall'])
const finalBundles = profileManifest().dsh?.profile?.bundles ?? []
const finalRows = composedRows()
check('卸载命令成功退出', removed.status === 0, String(removed.stdout ?? '').slice(-160))
check('bundles 里没有它了', !finalBundles.includes('clearai-dsh'), finalBundles.join(' · '))
check('dependencies 里也没有了', profileManifest().dependencies?.['clearai-dsh'] === undefined)
check('组合里没有 clearai-host 行(不留悬空引用)', !/^- id: clearai-host$/m.test(finalRows))
check('包目录已删', !existsSync(pkgDir))
check('预设归属也随包一起没了(不留悬空引用)', !presetAnchored(finalRows) && !/node_modules\/clearai-dsh\/presets\//.test(finalRows))

// ── ③ 随包的 install 动词:读者会敲的那一条命令,走的是同一条原生路 ───────────
console.log('\n③ 随包的 install 动词(node bin/clearai.mjs install)')
const HOME2 = mkdtempSync(join(tmpdir(), 'clearai-verb-'))
for (const name of ['.credentials.yaml', 'settings.yaml']) {
	if (existsSync(join(realHome, name))) cpSync(join(realHome, name), join(HOME2, name))
}
/**
 * `--lang zh` 是**刻意**的:下面两条断言读的是中文文案,而安装侧输出从 0.2.2 起跟系统语言走
 * (CI runner 的 locale 是 C.UTF-8 ⇒ 默认英文)。语言判据本身在 ③′ 单独验,两条各管一件事。
 */
const verb = spawnSync('node', [join(V2, 'bin', 'clearai.mjs'), 'install', '--home', HOME2, '--profile', 'web', '--dist', V2, '--lang', 'zh'], { encoding: 'utf8', env: { ...process.env, DSH_HOME: HOME2 }, timeout: 900000 })
check('install 动词成功退出', verb.status === 0, String(verb.stderr ?? '').slice(-200))
const verbProfile = join(HOME2, 'profiles', 'web', 'package.json')
const verbManifest = existsSync(verbProfile) ? JSON.parse(readFileSync(verbProfile, 'utf8')) : null
check('包进了 profile 的 node_modules', existsSync(join(HOME2, 'profiles', 'web', 'node_modules', 'clearai-dsh', 'package.json')))
check('bundles 里有它(宿主自己对的账)', (verbManifest?.dsh?.profile?.bundles ?? []).includes('clearai-dsh'), JSON.stringify(verbManifest?.dsh?.profile?.bundles ?? null))
/** 两件事分开验:它给了**读数**(宿主行进了组合),也给了**下一步**(重启),不是只说一句成功。 */
check('它报出宿主行真的进了组合(读数,不是断言)', /宿主行\s+在组合里/.test(String(verb.stdout)), String(verb.stdout ?? '').split('\n').filter((line) => line.includes('宿主行')).join(' '))
check('它报出下一步(重启)', /下一步/.test(String(verb.stdout)))

/**
 * ③′ 安装侧输出**跟系统语言走**。0.2.1 的 CLI 无论系统是什么都说中文;这里钉住判据的优先级:
 * `--lang` > 环境变量;`C` / `POSIX` 是「没有语言信息」,按英文。
 * 用 `doctor` 验(只读,不改 profile),不为了验一句话再装一遍。
 */
const langOut = (args, env) => String(spawnSync('node', [join(V2, 'bin', 'clearai.mjs'), 'doctor', '--profile', 'web', ...args], { encoding: 'utf8', env: { ...process.env, DSH_HOME: HOME2, ...env }, timeout: 300000 }).stdout ?? '')
check('--lang zh 说中文(系统是 C 也一样)', /包目录/.test(langOut(['--lang', 'zh'], { LC_ALL: 'C' })), langOut(['--lang', 'zh'], { LC_ALL: 'C' }))
check('--lang en 说英文(系统是中文也一样)', /doctor only reads/.test(langOut(['--lang', 'en'], { LC_ALL: 'zh_CN.UTF-8' })), langOut(['--lang', 'en'], { LC_ALL: 'zh_CN.UTF-8' }))
check('LC_ALL=zh_CN.UTF-8 ⇒ 自动中文', /包目录/.test(langOut([], { LC_ALL: 'zh_CN.UTF-8' })), langOut([], { LC_ALL: 'zh_CN.UTF-8' }))
check('LC_ALL=C ⇒ 自动英文(没有语言信息)', /doctor only reads/.test(langOut([], { LC_ALL: 'C' })), langOut([], { LC_ALL: 'C' }))
/** doctor 读的是组合里的预设声明行(宿主 ≥0.2.0 的名册不扫目录)。 */
check('doctor 报出预设声明行在组合里', /预设声明行\s+在组合里/.test(langOut(['--lang', 'zh'], {})), langOut(['--lang', 'zh'], {}))
rmSync(HOME2, { recursive: true, force: true })

// ── 收尾 ────────────────────────────────────────────────────────────────────
console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
}
if (KEEP) {
	console.log(`\n保留现场:${HOME}`)
} else {
	rmSync(HOME, { recursive: true, force: true })
	rmSync(V1, { recursive: true, force: true })
	rmSync(V2, { recursive: true, force: true })
	console.log('现场已收掉(要留着看就加 --keep)')
}
process.exit(failed === 0 ? 0 : 1)
