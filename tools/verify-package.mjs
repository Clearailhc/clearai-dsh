/**
 * verify-package —— 发行物的**机械判据**(S0 的五条不变量,条条落成可执行的检查)。
 *
 * 为什么不是「看一眼」:包这东西的失效方式是**静默**的——多带了一个测试目录没人发现,
 * 少带了一个模板文件要到用户第一次开空工作区才炸,仓库绝对路径更是只有换台机器才暴露。
 * 所以每条不变量都写成断言,失败即退出码非 0。
 *
 *   ① 平面三分      宿主半 / 浏览器半 / 预设 三样都在包里,出口与清单一致
 *   ② 发行物干净    files 白名单里的东西都在;测试、工具、recon、会话日志、.env 一个都不在
 *   ③ 内容归属      预设目录自洽(agent.cordis.yml + plugins + skills + template)
 *   ④ 无仓库路径    包内**任何文件**不含本仓库绝对路径,也不含已删的那条 dev fallback 片段
 *   ⑤ 只增不改      内核的变更类型表 ⊇ 已发布的那批(fold 有对应 case);工具目录与预设清单一致
 *
 * 另外两条工程判据:
 *   · **可重建**:现场跑一次 build 到临时目录,与 dist 逐字节比对(手改 dist 当场红)
 *   · **可打包**:`npm pack --dry-run --json` 的文件清单 ⊆ files 白名单
 *
 * 跑法:node tools/verify-package.mjs
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = resolve(HERE, '..')
const REPO = PORT
const DIST = join(PORT, 'dist', 'clearai-dsh')

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

if (!existsSync(DIST)) {
	console.error(`✗ 没有产物:${DIST}\n  先跑 node tools/build-package.mjs`)
	process.exit(2)
}

const manifest = JSON.parse(readFileSync(join(DIST, 'package.json'), 'utf8'))
const inventory = existsSync(join(DIST, 'INVENTORY.txt'))
	? readFileSync(join(DIST, 'INVENTORY.txt'), 'utf8').split('\n').filter((line) => line !== '')
	: []
const has = (rel) => existsSync(join(DIST, rel))

console.log(`【发行物自检】${manifest.name}@${manifest.version} · ${inventory.length} 个文件 · ${DIST}`)

// ── ① 平面三分 ──────────────────────────────────────────────────────────────
console.log('\n① 平面三分:同一个包,三样东西各落到自己的平面')
check('清单声明了宿主 bundle(patch)', typeof manifest.dsh?.bundle?.patch === 'string' && manifest.dsh.bundle.patch !== '', JSON.stringify(manifest.dsh?.bundle ?? null))
check('清单声明了浏览器半(platform + inject)', manifest.dsh?.client?.platform === 'web' && Array.isArray(manifest.dsh.client.inject) && manifest.dsh.client.inject.length > 0, JSON.stringify(manifest.dsh?.client ?? null))
check('出口齐:宿主半 / 浏览器半 / 补丁 / 清单', ['exports', 'main', 'bin'].every((key) => manifest[key] !== undefined) && manifest.exports['./client'] !== undefined && manifest.exports['./cordis.patch.yml'] !== undefined, Object.keys(manifest.exports ?? {}).join(','))
check('宿主半与浏览器半都真的在包里', has('lib/host.js') && has('lib/client.js') && has('lib/fold.js'))
// 伴生件在包里、也有出口:声明了 `./invariant` 却没有那个文件,等于文档说了一句做不到的话。
check('宿主不变量伴生件在包里,且清单里有它的出口', has('lib/invariant.js') && manifest.exports['./invariant'] === './lib/invariant.js')
check('补丁层文件在包里,且插的是**包名**行(不是路径)', has('cordis.patch.yml') && /name:\s*'clearai-dsh'/.test(readFileSync(join(DIST, 'cordis.patch.yml'), 'utf8')))
check('随包带上 README(中英)、LICENSE 与品牌位图(npm 页面靠它们)', has('README.md') && has('README.zh-CN.md') && has('LICENSE') && has('brand/logo-lockup.png'))
/**
 * **声明与接线必须一致**:README 的安装段第一位写的是 `npx clearai-dsh install`,
 * 那随包的 bin 就必须真的有这个动词 —— 否则文档说的是一句读者做不到的话。
 * (与本体那条纪律同形:声明了却没接线,当场红。)
 */
const readmeText = readFileSync(join(DIST, 'README.md'), 'utf8')
const binText = readFileSync(join(DIST, 'bin', 'clearai.mjs'), 'utf8')
check('README 的安装入口与 bin 的动词对得上(npx clearai-dsh install)', readmeText.includes('npx clearai-dsh install') && binText.includes("command === 'install'"), `README 提到:${readmeText.includes('npx clearai-dsh install')} · bin 有 install 动词:${binText.includes("command === 'install'")}`)
/**
 * 发布要用的两条 manifest 事实 —— 都是 2026-09-15 发布时**撞出来**的:
 *   · **provenance 校验要求 `repository.url` 与来源仓库一致**。缺了它,registry 直接 422
 *     (`Failed to validate repository information`)。而这条**只在 CI 发布时**才会撞到 ——
 *     手工 `npm publish` 不带 provenance,永远看不见。
 *   · `bin` 的值不能带 `./`:npm 发布时会**自动改写**它,于是"发出去的那一份"与"我们构建的
 *     那一份"就不是同一份了(下面那道 registry 逐文件核对会红)。
 * 两条都是"本地全绿、发布才炸"的类型,所以放在这里。
 */
const repoUrl = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
check('manifest 声明了 repository(provenance 校验要它)', typeof repoUrl === 'string' && /github\.com\/Clearailhc\/clearai-dsh/.test(repoUrl), String(repoUrl))
const binValues = Object.values(manifest.bin ?? {})
check('bin 的值是 npm 规范化过的写法(不带 ./)', binValues.every((value) => !String(value).startsWith('./')), binValues.join(', '))

// ── ② 发行物干净 ────────────────────────────────────────────────────────────
console.log('\n② 发行物干净:只带该带的')
const allowedRoots = ['package.json', 'cordis.patch.yml', 'INVENTORY.txt', 'README.md', 'README.zh-CN.md', 'LICENSE', 'CHANGELOG.md', 'brand', 'lib', 'presets', 'bin']
const stray = inventory.filter((rel) => !allowedRoots.some((root) => rel === root || rel.startsWith(`${root}/`)))
check('包内没有白名单之外的文件', stray.length === 0, stray.slice(0, 5).join(', '))
const forbidden = /(^|\/)(\.env|\.git|node_modules|coverage|__pycache__|\.pytest_cache)(\/|$)|\.(zst|tgz|log)$/
const dirty = inventory.filter((rel) => forbidden.test(rel))
check('没有测试/工具/recon/会话日志/密钥类文件', dirty.length === 0, dirty.slice(0, 5).join(', '))
check('没有把 test/ 或 tools/ 带进来', !inventory.some((rel) => rel.startsWith('test/') || rel.startsWith('tools/') || rel.startsWith('recon/')))

// ── ③ 内容归属:预设自洽 ────────────────────────────────────────────────────
console.log('\n③ 内容归属:预设是**厂商内容**,随包走,且自洽')
const presetBase = 'presets/clearai'
check('预设组合文件在', has(`${presetBase}/agent.cordis.yml`))
check('名册要的两份元数据在(agent.cordis.yml + preset.yml)', has(`${presetBase}/preset.yml`))
/**
 * **显示元数据必须真能解析出来。** 这条门是 2026-09-16 踩出来的:
 *
 * 名册(@deepseek-ai/dsh-agent-presets)对 `preset.yml` 读失败的处理是**静默降级成
 * 「没有元数据」**(它的原话:"Every read failure degrades to no metadata"),于是预设卡片
 * 显示成**目录名 + 「暂无描述」**,而宿主和我们两边都不报错。最容易踩的形态是:
 * description 写成普通标量,里面又有 `English: state` 这种「冒号 + 空格」→ YAML 读不了。
 * 0.1.2 与 0.1.3 就是带着这个 bug 发出去的(卡片上写着 `clearai / 暂无描述`)。
 *
 * `yaml` 不是本仓库的依赖(仓库里没有 node_modules),所以**从宿主 CLI 的位置**解析它 ——
 * 与 verify-deploy 同一招,而且正是名册自己用的那个库。宿主不在就退化成形态检查,并如实说明。
 */
function loadHostYaml() {
	const root = join(process.env.HOME ?? homedir(), '.npm', '_npx')
	for (const entry of existsSync(root) ? readdirSync(root) : []) {
		const dshPkg = join(root, entry, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
		if (existsSync(dshPkg)) return createRequire(dshPkg)('yaml')
	}
	return null
}
const presetMetadata = readFileSync(join(DIST, `${presetBase}/preset.yml`), 'utf8')
const hostYaml = loadHostYaml()
if (hostYaml === null) {
	check(
		'preset.yml 的 description 是块标量或引号(拿不到宿主的 yaml 包,退化成形态检查)',
		/^name:\s*\S/m.test(presetMetadata) && /^description:\s*[>|"']/m.test(presetMetadata),
	)
} else {
	let parsedMetadata = null
	let metadataProblem = ''
	try {
		parsedMetadata = hostYaml.parse(presetMetadata)
	} catch (error) {
		metadataProblem = String(error?.message ?? error).split('\n')[0]
	}
	check('preset.yml 是合法 YAML(读不了它,卡片就只显示目录名 + 暂无描述)', parsedMetadata !== null, metadataProblem)
	check(
		'preset.yml 给了卡片要显示的 name 与 description',
		typeof parsedMetadata?.name === 'string' && parsedMetadata.name.trim() !== '' && typeof parsedMetadata?.description === 'string' && parsedMetadata.description.trim() !== '',
		JSON.stringify({ name: parsedMetadata?.name ?? null, description: `${String(parsedMetadata?.description ?? '').slice(0, 30)}…` }),
	)
}
check('内核随预设走(./plugins/clearai-kernel.js)', has(`${presetBase}/plugins/clearai-kernel.js`))
check('提示词段随预设走(./plugins/prompts.js)', has(`${presetBase}/plugins/prompts.js`))
check('预设自己的技能在(skills/ 走 baseUrl,所以必须同目录)', inventory.some((rel) => rel.startsWith(`${presetBase}/skills/`)))
check('工作区模板在预设旁边(内核缺省读 ../template)', has(`${presetBase}/template/project.md`) && inventory.some((rel) => rel.startsWith(`${presetBase}/template/skills/`)))
const presetSkills = inventory.filter((rel) => rel.startsWith(`${presetBase}/template/skills/`) && rel.endsWith('SKILL.md')).length
check('模板技能齐(18 条)', presetSkills === 18, `${presetSkills} 条`)

// ── ④ 无仓库路径(纪律④) ───────────────────────────────────────────────────
console.log('\n④ 无仓库路径:发行物不假设自己长在哪个目录树里')
const texts = inventory.filter((rel) => !/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$/i.test(rel)).map((rel) => ({ rel, text: readFileSync(join(DIST, rel), 'utf8') }))
const withRepo = texts.filter((item) => item.text.includes(REPO))
check(`包内没有本仓库的绝对路径(${REPO})`, withRepo.length === 0, withRepo.slice(0, 3).map((item) => item.rel).join(', '))
const withFallback = texts.filter((item) => /(['\"])\.\.\/.*template\1/.test(item.text) && item.rel.startsWith('lib/'))
check('发行物不靠相对路径指回仓库找模板(模板随包走)', withFallback.length === 0, withFallback.slice(0, 3).map((item) => item.rel).join(', '))
const withAbsHome = texts.filter((item) => /['"]\/(home|Users)\/[^'"]*['"]/.test(item.text) && !item.rel.startsWith('bin/'))
check('除 bin(安装侧要算路径)外,代码里不写死绝对路径', withAbsHome.length === 0, withAbsHome.slice(0, 3).map((item) => item.rel).join(', '))

// ── ⑤ 只增不改:目录面与已发布事实一致 ─────────────────────────────────────
console.log('\n⑤ 只增不改:目录面与 fold 的既有词汇表对得上')
const kernelSource = readFileSync(join(DIST, `${presetBase}/plugins/clearai-kernel.js`), 'utf8')
const mechanismMatch = /export const MECHANISM_TOOLS = \{([\s\S]*?)\n\}/.exec(kernelSource)
const toolNames = mechanismMatch === null ? [] : [...mechanismMatch[1].matchAll(/'([A-Z][A-Za-z]+)'/g)].map((match) => match[1])
check('工具目录读得出来(29 件)', toolNames.length === 29, `${toolNames.length} 件`)
const presetText = readFileSync(join(DIST, `${presetBase}/agent.cordis.yml`), 'utf8')
const kernelRow = /- id: clearai-kernel[\s\S]*?(?=\n- id: |\n# ──)/.exec(presetText)?.[0] ?? ''
const declaredTools = [...kernelRow.matchAll(/^\s{6,}([A-Z][A-Za-z]+):\s*true$/gm)].map((match) => match[1])
check('预设里没有手写的 tools 清单(缺省 = 目录全量,不造第二本账)', declaredTools.length === 0, declaredTools.join(', '))
const foldSource = readFileSync(join(DIST, 'lib', 'fold.js'), 'utf8')
const mutationTypes = [...new Set([...kernelSource.matchAll(/t: '([a-z]+\/[a-z-]+)'/g)].map((match) => match[1]))].sort()
/**
 * 词汇表的两半:**折进视图的**(fold 里有 case)+ **只留台账的**(fold 显式列出的
 * `LEDGER_ONLY_MUTATIONS`)。两半都不在 = 真的缺口(而不是「故意不折」)。
 * 这样写是因为 `applyMutation` 对不认识的类型原样返回(前向兼容),不比对就分不出漏与不折。
 */
const ledgerOnly = [...(/export const LEDGER_ONLY_MUTATIONS = \[([^\]]*)\]/.exec(foldSource)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
check(`fold 声明了「只留台账」的那几类事实(${ledgerOnly.length} 类)`, ledgerOnly.length > 0, ledgerOnly.join(', '))
const unfolded = mutationTypes.filter((type) => !foldSource.includes(`case '${type}'`) && !ledgerOnly.includes(type))
check(`内核落的 ${mutationTypes.length} 类事实,要么折进视图、要么在台账清单里(没有第三态)`, unfolded.length === 0, unfolded.join(', '))

// ── 工程判据一:可重建(手改 dist 当场红) ──────────────────────────────────
console.log('\n⑥ 可重建:包 = 源的纯函数')
const rebuildDir = mkdtempSync(join(tmpdir(), 'clearai-rebuild-'))
try {
	execFileSync('node', [join(PORT, 'tools', 'build-package.mjs'), '--out', rebuildDir], { stdio: 'pipe' })
	const hashOf = (root) => {
		const out = {}
		const walk = (dir) => {
			for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
				const full = join(dir, entry.name)
				if (entry.isDirectory()) walk(full)
				else out[relative(root, full)] = createHash('sha256').update(readFileSync(full)).digest('hex')
			}
		}
		walk(root)
		return out
	}
	const now = hashOf(DIST)
	const rebuilt = hashOf(rebuildDir)
	const onlyNow = Object.keys(now).filter((rel) => rebuilt[rel] === undefined)
	const onlyNew = Object.keys(rebuilt).filter((rel) => now[rel] === undefined)
	const differing = Object.keys(now).filter((rel) => rebuilt[rel] !== undefined && rebuilt[rel] !== now[rel])
	check('现场重建与 dist 逐字节相同(手改 dist 会被抓)', onlyNow.length === 0 && onlyNew.length === 0 && differing.length === 0, JSON.stringify({ 只在dist: onlyNow.slice(0, 3), 只在重建: onlyNew.slice(0, 3), 内容不同: differing.slice(0, 3) }))
} catch (error) {
	check('现场重建与 dist 逐字节相同(手改 dist 会被抓)', false, String(error?.message ?? error).slice(0, 200))
} finally {
	rmSync(rebuildDir, { recursive: true, force: true })
}

// ── 工程判据二:可打包(npm 的文件清单 ⊆ 白名单) ───────────────────────────
console.log('\n⑦ 可打包:npm 实际会带走的文件')
try {
	const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: DIST, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
	const files = JSON.parse(out)[0].files.map((item) => item.path)
	const outside = files.filter((rel) => !allowedRoots.some((root) => rel === root || rel.startsWith(`${root}/`)))
	check(`npm 会带走 ${files.length} 个文件,全在白名单内`, outside.length === 0, outside.slice(0, 5).join(', '))
	check('npm 会带走预设与模板(不是只有 lib)', files.some((rel) => rel.startsWith('presets/clearai/template/')) && files.some((rel) => rel.endsWith('agent.cordis.yml')))
} catch (error) {
	check('npm pack 能跑通', false, String(error?.message ?? error).slice(0, 200))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
const bytes = inventory.reduce((sum, rel) => sum + statSync(join(DIST, rel)).size, 0)
console.log(`发行物:${inventory.length} 个文件 · ${(bytes / 1024).toFixed(0)} KiB`)
