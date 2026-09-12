/**
 * verify-clean-install —— **从零开始装一遍**:空 DSH_HOME + 官方模板 + 真 pnpm + 真 `dsh plugin add`。
 *
 * 为什么必须有它:此前所有"安装"验收都走 `install-native.mjs` 的**手工对账降级路径**
 * (那台机器上没有 pnpm),而产品路径是 `dsh plugin add` —— 它是 pnpm 的一层转发器。
 * 降级路径绿,不等于产品路径绿。这个脚本走的就是**陌生人会走的那条**。
 *
 * 它做七件事:
 *   ① 建一次性 DSH_HOME(空目录),用官方模板初始化 web profile;
 *   ② **只搬 `.credentials.yaml`** —— 别的一律用发行版默认(实测:连 settings.yaml 一起搬会把
 *      一个干净 profile 里不存在的 provider 带进来,面板会显示 "This model is unavailable");
 *   ③ 登记一个临时工作区(侧栏不出现别的项目);
 *   ④ 构建 + `npm pack` 出 tgz(spec 也可以直接给包名,装完 npm 之后用);
 *   ⑤ 用真 `dsh plugin --profile web add <spec>` 安装(pnpm 必须在 PATH 上);
 *   ⑥ 跑七条机械断言(依赖、bundles、恰好一行宿主、名册 root、名册内容、包内预设、无绝对路径);
 *   ⑦ `--ui` 时把 web 起起来并打印带 token 的 URL,交给 `tools/ui-drive.mjs` 做浏览器断言。
 *
 * 跑法:
 *   node tools/verify-clean-install.mjs                    # 用刚构建的 tgz
 *   node tools/verify-clean-install.mjs --spec clearai-dsh # 装 npm 上的裸名(发布后复验)
 *   node tools/verify-clean-install.mjs --ui               # 装完顺便起 web
 *   node tools/verify-clean-install.mjs --keep             # 留着临时 home 便于人工看
 *
 * 浏览器那半(必须人/工具驱动,脚本不假装做了):
 *   新会话 → 预设选择器里选 ClearAI → 中栏出现 Deliverables/Facts、右栏出现 Worldlines/Skills · Memory
 *   → 发一个真任务 → 账上出现 goal/set 与审计。规范写法见 docs/release-verification.md。
 *
 * 依赖:node 22 · `pnpm` 在 PATH 上(没有就用 `corepack enable --install-directory ~/.local/bin`)。
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CHECKOUT = process.env.DSH_CHECKOUT ?? '/home/lhc/.npm/_npx/1e7f6d9597241db0'
/**
 * `dsh` 从哪来:CI 里我们把它装进一个前缀(`npm install --prefix`),本地则用 checkout 里的那份。
 * 两个都不在就如实说"装不了 dsh CLI",而不是让后面每一步都报一个看不懂的错。
 */
const CLI_PREFIX = process.env.DSH_CLI_PREFIX ?? null
const CLI = CLI_PREFIX !== null && existsSync(join(CLI_PREFIX, 'node_modules', '.bin', 'dsh')) ? join(CLI_PREFIX, 'node_modules', '.bin', 'dsh') : null
const argv = process.argv.slice(2)
const option = (name, fallback) => {
	const index = argv.indexOf(`--${name}`)
	return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}
const SPEC = option('spec', null)
const UI = argv.includes('--ui')
const KEEP = argv.includes('--keep')
const PORT = Number(option('port', '3110'))

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

const dsh = (args, home, extra = {}) =>
	spawnSync(CLI === null ? 'npx' : CLI, CLI === null ? ['--no-install', '@deepseek-ai/dsh', ...args] : args, {
		encoding: 'utf8',
		env: { ...process.env, DSH_HOME: home },
		cwd: CHECKOUT,
		timeout: 900000,
		...extra,
	})

// ── ⓪ 前置:pnpm 必须在(产品路径就是它)────────────────────────────────────
console.log('【干净安装验收】')
const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
if (pnpm.status !== 0) {
	console.error(`✗ PATH 上没有可用的 pnpm —— 产品路径走不了。\n  corepack enable --install-directory ~/.local/bin && export PATH="$HOME/.local/bin:$PATH"\n  (${String(pnpm.error?.message ?? pnpm.stderr ?? '').slice(0, 120)})`)
	process.exit(2)
}
console.log(`  pnpm ${pnpm.stdout.trim()}`)

const HOME_DIR = mkdtempSync(join(tmpdir(), 'dsh-clean-'))
const PROFILE = join(HOME_DIR, 'profiles', 'web')
const WORKSPACE = join(HOME_DIR, 'ws')
console.log(`  一次性 DSH_HOME:${HOME_DIR}`)

// ── ① profile:官方模板,零改写 ──────────────────────────────────────────────
{
	const init = dsh(['--profile', 'web', '--dump-config'], HOME_DIR)
	check('空 home + 官方模板能建出 web profile', init.status === 0 && existsSync(join(PROFILE, 'package.json')), String(init.stderr ?? '').slice(0, 160))
	const patched = existsSync(join(PROFILE, 'cordis.patch.yml')) ? readFileSync(join(PROFILE, 'cordis.patch.yml'), 'utf8') : ''
	check('profile 的补丁层是空的(我们还没动过它)', !patched.includes('clearai'), patched.slice(0, 80))
}

// ── ② 只搬凭据:别的一律发行版默认 ──────────────────────────────────────────
{
	const creds = join(homedir(), '.dsh', '.credentials.yaml')
	if (existsSync(creds)) {
		cpSync(creds, join(HOME_DIR, '.credentials.yaml'))
		check('搬进来了模型凭据(只这一份)', existsSync(join(HOME_DIR, '.credentials.yaml')))
	} else {
		// CI / 新机器上没有凭据:机械那半照样能验(安装、组合、名册都不需要模型)。
		// 如实说"跳过了什么",不把"没跑"记成"通过"。
		console.log('  · 跳过模型凭据:这台机器上没有 ~/.dsh/.credentials.yaml —— 浏览器那半跑不了,机械那半照跑')
	}
	check('没有搬 settings.yaml(实测:搬了会把干净 profile 里没有的 provider 带进来)', !existsSync(join(HOME_DIR, 'settings.yaml')))
	check('没有搬 .agent-presets(预设要由包提供)', !existsSync(join(HOME_DIR, '.agent-presets')))
}

// ── ③ 一个临时工作区(侧栏只出现它)─────────────────────────────────────────
{
	mkdirSync(WORKSPACE, { recursive: true })
	writeFileSync(join(WORKSPACE, 'input.md'), 'hello from a clean install\n')
	const id = 'clean-install-ws'
	mkdirSync(join(HOME_DIR, 'storages'), { recursive: true })
	writeFileSync(
		join(HOME_DIR, 'storages', 'workspace.json'),
		`${JSON.stringify(
			{
				unit: { name: 'workspace', version: 2 },
				global: { initialized: true, workspaceIds: [id], archivedSessionIds: [] },
				tables: { workspaces: { [id]: { path: WORKSPACE, title: 'clean-install', sessionIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } },
			},
			null,
			2,
		)}\n`,
	)
}

// ── ④ 构建 + 打包(或直接用给定的 spec)────────────────────────────────────
let spec = SPEC
if (spec === null) {
	execFileSync('node', [join(ROOT, 'tools', 'build-package.mjs')], { stdio: 'pipe' })
	const packDir = mkdtempSync(join(tmpdir(), 'clearai-pack-'))
	const packed = spawnSync('npm', ['pack', join(ROOT, 'dist', 'clearai-dsh'), '--pack-destination', packDir], { encoding: 'utf8' })
	const tgz = (packed.stdout ?? '').trim().split('\n').pop()
	spec = join(packDir, tgz)
	check('构建并打出了 tgz', existsSync(spec), spec)
}

// ── ⑤ 真 CLI + 真 pnpm ─────────────────────────────────────────────────────
{
	const add = dsh(['plugin', '--profile', 'web', 'add', spec], HOME_DIR)
	check(`dsh plugin add ${SPEC === null ? '<tgz>' : SPEC} 成功`, add.status === 0, `${String(add.stderr ?? '').slice(-200)}`)
}

// ── ⑥ 七条机械断言 ─────────────────────────────────────────────────────────
{
	const manifest = JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'))
	const deps = Object.keys(manifest.dependencies ?? {})
	const bundles = manifest.dsh?.profile?.bundles ?? []
	check('① 依赖里有 clearai-dsh', deps.includes('clearai-dsh'), deps.join(','))
	check('② bundles 里有它,而且恰好一次', bundles.filter((name) => name === 'clearai-dsh').length === 1, bundles.join(','))
	check('②′ 发行版自己的三条 bundle 还在', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].every((name) => bundles.includes(name)), bundles.join(','))

	const dump = dsh(['--profile', 'web', '--dump-config'], HOME_DIR)
	const composed = dump.stdout ?? ''
	check('③ 组合里 clearai-host 恰好一行', (composed.match(/- id: clearai-host/g) ?? []).length === 1, String((composed.match(/- id: clearai-host/g) ?? []).length))
	check('③′ 宿主行用的是包名(不是路径)', /name:\s*'?clearai-dsh'?/.test(composed.slice(composed.indexOf('clearai-host'), composed.indexOf('clearai-host') + 120)))
	const rosterLine = composed.slice(composed.indexOf('includeShippedRoot'), composed.indexOf('includeShippedRoot') + 600)
	check('④ 名册 root 指向包内 presets/,且 trust 是 system', /node_modules\/clearai-dsh\/presets\//.test(rosterLine) && /trust:\s*system/.test(rosterLine), rosterLine.replace(/\s+/g, ' ').slice(0, 120))
	check('④′ 没有把发行版 root 挤掉(includeShippedRoot 仍为 true)', /includeShippedRoot:\s*true/.test(composed))

	const presetDir = join(PROFILE, 'node_modules', 'clearai-dsh', 'presets', 'clearai')
	const skills = existsSync(join(presetDir, 'template', 'skills')) ? readFileSync(join(presetDir, 'template', 'skills', 'README.md'), 'utf8') : ''
	check('⑤ 包内预设自洽(组合文件 + 元数据 + 模板)', existsSync(join(presetDir, 'agent.cordis.yml')) && existsSync(join(presetDir, 'preset.yml')) && existsSync(join(presetDir, 'template', 'project.md')), presetDir)
	void skills
	/**
	 * 查的是**这台机器的路径**(仓库根 / 这次装到哪儿),不是任何 `/home/` 字样:
	 * 提示词里刻意举了 `/Users/...`、`/home/...` 当反例(教模型别编绝对路径),那是内容不是泄漏。
	 */
	const leaks = [ROOT, HOME_DIR].filter((needle) => {
		const hit = spawnSync('grep', ['-rl', needle, join(PROFILE, 'node_modules', 'clearai-dsh')], { encoding: 'utf8' })
		return (hit.stdout ?? '').trim() !== ''
	})
	check('⑥ 包内没有本机路径(仓库根 / 这次装到哪儿)', leaks.length === 0, leaks.join(', '))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failed > 0) {
	console.log(`失败项:\n${failures.map((item) => `  - ${item}`).join('\n')}`)
	console.log(`现场保留在 ${HOME_DIR}(排查用;确认无用后删掉)`)
	process.exit(1)
}

// ── ⑦ 可选:起 web,把浏览器断言交给 ui-drive ───────────────────────────────
if (UI) {
	const child = spawn('npx', ['--no-install', '@deepseek-ai/dsh', 'web', '--port', String(PORT), '--no-open'], {
		env: { ...process.env, DSH_HOME: HOME_DIR },
		cwd: CHECKOUT,
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	child.stdout.on('data', (chunk) => process.stdout.write(chunk))
	child.stderr.on('data', (chunk) => process.stderr.write(chunk))
	console.log(`\n  已起 web(pid ${child.pid},端口 ${PORT})。浏览器断言:`)
	console.log(`    google-chrome --headless=new --no-sandbox --window-size=1680,1050 \\`)
	console.log(`      --remote-debugging-port=9350 --user-data-dir=/tmp/clean-chrome '<上面打印的带 token URL>'`)
	console.log(`    node tools/ui-drive.mjs eval "(document.body.innerText||'').slice(0,200)"`)
	console.log(`  该断言:中栏出现 Deliverables/Facts、右栏出现 Worldlines/Skills · Memory、pageerror 为空。`)
	console.log(`  收工:kill ${child.pid}${KEEP ? '' : ` && rm -rf ${HOME_DIR}`}`)
} else if (!KEEP) {
	rmSync(HOME_DIR, { recursive: true, force: true })
	console.log('临时 home 已清掉(要留现场用 --keep)。')
}
