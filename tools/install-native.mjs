/**
 * install-native —— 用 DSH 自己的那条路把包装进一个 profile(S3)。
 *
 *   dsh plugin --profile <p> add <spec>      ← 唯一的原生安装动作
 *
 * 它做四件事,每一步都如实报出走了哪条路:
 *   ① profile 不在就用官方模板建一个(`--from-default-profile <tpl>`);
 *   ② 安装:pnpm 在就交给 CLI(真·原生);**不在就手工对账**并明确标注这是降级路径
 *      (把包放进 profile 的 node_modules,再把包名追加进 `dsh.profile.bundles` ——
 *       这正是 CLI 内部 reconcile 的结果,少了 pnpm 自己的那一步);
 *   ③ `--migrate`:摘掉开发形态的残留(旧的宿主包行与目录、旧 preset 拷贝),
 *      **只搬不删**:旧 preset 改名挪出扫描根,留着可查;
 *   ④ 打印结果:bundles 列表、我们的行、名册 root、以及 `bin doctor` 的读数。
 *
 * 为什么需要它:E2E 的「装出来的包」那一场要在一个**一次性 DSH_HOME** 里跑,
 * 而 `dsh plugin` 需要 pnpm 在 PATH 上 —— 这个工具把「环境缺什么」变成一条**写明了的降级**,
 * 而不是让测试悄悄跑成另一件事。
 *
 * 跑法:
 *   node tools/install-native.mjs --home /tmp/x --profile web [--dist <dir>] [--tarball <tgz>] [--migrate]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => {
	const index = argv.indexOf(`--${name}`)
	return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}
const HOME = resolve(option('home', process.env.DSH_HOME ?? join(homedir(), '.dsh')))
const PROFILE = option('profile', 'web')
const TEMPLATE = option('from-default', PROFILE === 'web' ? 'web' : 'headless')
const DIST = resolve(option('dist', join(PORT, 'dist', 'clearai-dsh')))
const TARBALL = option('tarball', null)
const MIGRATE = argv.includes('--migrate')
const UNINSTALL = argv.includes('--uninstall')
/**
 * 迁移时要从补丁层与 node_modules 里摘掉的**旧包名**:用 `--remove-package <name>` 指定,可重复。
 * 刻意不写死任何历史名字 —— 那是开发期的私事,不该留在发行物旁边。
 */
const OLD_PACKAGES = argv.reduce((list, item, index) => (item === '--remove-package' && argv[index + 1] !== undefined ? [...list, argv[index + 1]] : list), [])
const PROFILE_DIR = join(HOME, 'profiles', PROFILE)
const PROFILE_PATCH = join(PROFILE_DIR, 'cordis.patch.yml')
const ENV = { ...process.env, DSH_HOME: HOME }

const say = (line) => console.log(`  ${line}`)
const dsh = (args, extra = {}) => spawnSync('npx', ['--no-install', '@deepseek-ai/dsh', ...args], { encoding: 'utf8', env: ENV, timeout: 900000, ...extra })

if (!existsSync(join(DIST, 'package.json'))) {
	console.error(`✗ 没有包:${DIST}\n  先跑 node tools/build-package.mjs`)
	process.exit(2)
}
const manifest = JSON.parse(readFileSync(join(DIST, 'package.json'), 'utf8'))
const NAME = manifest.name
/** 卸载:先把行与 bundles 摘掉,再删包目录 —— 顺序反了会留下指向不存在模块的行。 */
if (UNINSTALL) {
	const manifestPath = join(PROFILE_DIR, 'package.json')
	const profileManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
	if (profileManifest !== null) {
		delete profileManifest.dependencies?.[NAME]
		const bundles = (profileManifest.dsh?.profile?.bundles ?? []).filter((name) => name !== NAME)
		profileManifest.dsh = { ...(profileManifest.dsh ?? {}), profile: { ...(profileManifest.dsh?.profile ?? {}), bundles } }
		writeFileSync(manifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`, 'utf8')
		say(`已从 dependencies 与 dsh.profile.bundles 摘掉 ${NAME}`)
	}
	rmSync(join(PROFILE_DIR, 'node_modules', NAME), { recursive: true, force: true })
	say(`已删包目录:${join(PROFILE_DIR, 'node_modules', NAME)}`)
	const composed = dsh(['--profile', PROFILE, '--dump-config'])
	const leftover = /^- id: clearai-host$/m.test(String(composed.stdout ?? ''))
	say(`组合里还有 clearai-host 吗:${leftover ? '**还有(不该)**' : '没有了 ✓'}`)
	process.exit(leftover ? 1 : 0)
}
console.log(`【原生安装】${NAME}@${manifest.version} → DSH_HOME=${HOME} profile=${PROFILE}`)

// ── ① profile 在不在 ────────────────────────────────────────────────────────
if (!existsSync(PROFILE_PATCH)) {
	say(`profile 不存在,用官方模板建一个:--from-default-profile ${TEMPLATE} --profile ${PROFILE}`)
	const created = dsh(['--profile', PROFILE, '--from-default-profile', TEMPLATE, '--dump-config'])
	if (created.status !== 0) {
		console.error(`✗ 建 profile 失败:${String(created.stderr ?? '').slice(-400)}`)
		process.exit(1)
	}
}
say(`profile:${PROFILE_DIR}`)

// ── ② 安装:pnpm 在就走原生,不在就手工对账(如实标注)──────────────────────
const spec = TARBALL === null ? `file:${DIST}` : resolve(TARBALL)
const hasPnpm = spawnSync('bash', ['-lc', 'command -v pnpm'], { encoding: 'utf8' }).status === 0
if (hasPnpm) {
	say(`pnpm 在 PATH 上 → 走原生 CLI:dsh plugin --profile ${PROFILE} add ${spec}`)
	const added = dsh(['plugin', '--profile', PROFILE, 'add', spec])
	if (added.status !== 0) {
		console.error(`✗ dsh plugin add 失败:${String(added.stderr ?? '').slice(-400)}`)
		process.exit(1)
	}
	say('已交给 CLI 与 pnpm(bundles 由 CLI 自己对账)')
} else {
	/**
	 * 降级路径:把 CLI 内部那两步手工做一遍。**必须写明** —— 否则「装出来的包」这一场
	 * 会被读成「pnpm 那一步也验过了」,而它没有。
	 */
	say('⚠️ PATH 上没有 pnpm(降级路径):手工对账 = 拷进 node_modules + 追加 dsh.profile.bundles')
	say('   这一步少了 pnpm 自己的安装动作;包内容与 CLI 的 reconcile 结果一致。')
	const target = join(PROFILE_DIR, 'node_modules', NAME)
	rmSync(target, { recursive: true, force: true })
	mkdirSync(dirname(target), { recursive: true })
	cpSync(DIST, target, { recursive: true })
	const manifestPath = join(PROFILE_DIR, 'package.json')
	const profileManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
	profileManifest.dependencies = { ...(profileManifest.dependencies ?? {}), [NAME]: `file:${DIST}` }
	const bundles = profileManifest.dsh?.profile?.bundles ?? []
	if (!bundles.includes(NAME)) bundles.push(NAME)
	profileManifest.dsh = { ...(profileManifest.dsh ?? {}), profile: { ...(profileManifest.dsh?.profile ?? {}), bundles } }
	writeFileSync(manifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`, 'utf8')
	say(`   包已就位:${target}`)
}

// ── ③ 迁移:摘掉开发形态的残留(只搬不删)──────────────────────────────────
if (MIGRATE) {
	let patchText = existsSync(PROFILE_PATCH) ? readFileSync(PROFILE_PATCH, 'utf8') : ''
	for (const old of OLD_PACKAGES) {
		if (!patchText.includes(old)) continue
		/**
		 * 摘的是**整条插入项**,不是含旧包名的那一行。
		 *
		 * 2026-09-12 的教训(在真实 home 上撞到的):开发形态插进去的是
		 * `- insert:` + `- id: clearai-host` + `name: '@clearai/dsh'` 三行;
		 * 按行过滤只会删掉 `name:` 那行,留下一条**没有 name 的悬挂行**——
		 * 它和被删掉的包一起消失了还好,偏偏它还在,于是组合里出现两个同 id 的行,
		 * 而补丁文件本身仍然"合法 YAML",要等到 dump-config 才炸。
		 * 所以这里按块删:从 `- insert:` 起,删到下一个顶层 `- ` 或文件末尾,
		 * 且只有当块里真的提到旧包名时才删。
		 */
		const lines = patchText.split('\n')
		const kept = []
		let removed = 0
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]
			if (!/^- /.test(line)) {
				kept.push(line)
				continue
			}
			// 收集这一块(直到下一个顶层 `- `)
			let end = index + 1
			while (end < lines.length && !/^- /.test(lines[end])) end += 1
			const block = lines.slice(index, end)
			if (block.some((item) => item.includes(old))) {
				removed += 1
			} else {
				kept.push(...block)
			}
			index = end - 1
		}
		patchText = kept.join('\n')
		say(`① 已从补丁层摘掉提到 ${old} 的插入项:${removed} 条`)
		rmSync(join(PROFILE_DIR, 'node_modules', old), { recursive: true, force: true })
	}
	// 补丁层必须仍是**顶层 YAML 数组**:只剩注释就补一个 `[]`(空文件会让 profile 打不开)。
	if (!patchText.split('\n').some((line) => /^\s*(\[\]|- )/.test(line))) {
		patchText = `${patchText.replace(/\n*$/, '')}\n[]\n`
		say('① 补丁层已空:补了一行 [] 保持它是合法的顶层数组')
	}
	writeFileSync(PROFILE_PATCH, patchText.endsWith('\n') ? patchText : `${patchText}\n`, 'utf8')
	const legacyPreset = join(HOME, '.agent-presets', 'clearai')
	if (existsSync(legacyPreset)) {
		const aside = join(HOME, `.clearai-dev-backup-${new Date().toISOString().slice(0, 10)}`, 'clearai')
		mkdirSync(dirname(aside), { recursive: true })
		renameSync(legacyPreset, aside)
		say(`① 旧 preset 拷贝挪出扫描根(不删):${aside}`)
	}
}

// ── ④ 结果读数 ──────────────────────────────────────────────────────────────
const profileManifest = JSON.parse(readFileSync(join(PROFILE_DIR, 'package.json'), 'utf8'))
say(`bundles:${(profileManifest.dsh?.profile?.bundles ?? []).join(' · ')}`)
const composed = dsh(['--profile', PROFILE, '--dump-config'])
const rows = [...String(composed.stdout ?? '').matchAll(/^- id: (\S+)$/gm)].map((match) => match[1])
say(`组合里的我们的行:${rows.filter((row) => row.startsWith('clearai')).join(', ') || '(没有!)'}`)
say(`名册 root(补丁层算出来的):${(String(composed.stdout ?? '').match(/node_modules\/[^'"\s]*presets\//) ?? ['(没看到)'])[0]}`)
const bin = join(PROFILE_DIR, 'node_modules', NAME, 'bin', 'clearai.mjs')
if (existsSync(bin)) {
	const doctor = spawnSync('node', [bin, 'doctor', '--profile', PROFILE], { encoding: 'utf8', env: ENV })
	console.log(String(doctor.stdout ?? '').split('\n').map((line) => `    ${line}`).join('\n'))
}
