/**
 * publish —— 发布闸:装配 → 逐字节核 → **从对的目录**发出去。
 *
 * 为什么需要它:`package.json` 的 `files` 指的是 `lib/`、`presets/`、`bin/`,
 * 而仓库根目录**没有**这些目录(源在 `ui/lib/`、`preset/`)。在根目录跑 `npm publish`
 * 会打出一个 14 个文件、143 kB 的包——名字版本都对,内容却缺了内核与预设,
 * 而且 npm 照收不误。装机的人拿到的是一个装不起来的包。
 *
 * 所以发布只有一个入口:**先装配,再在 `dist/clearai-dsh` 里发**。
 * 这个工具把那三步钉在一起,并在动手之前挡住三种错误:
 *   ① 工作区不干净(发出去的应该是某个 commit 的样子,不是半成品);
 *   ② 版本已经在 npm 上(重复发布会失败,但更该在本地先说清);
 *   ③ 逐字节核不过(dist 与源不一致)。
 *
 * 跑法:
 *   node tools/publish.mjs --dry-run     # 只装配与核对,并打印包内容
 *   node tools/publish.mjs               # 真发布(需要 npm 凭据)
 *   node tools/publish.mjs --tag next    # 指定 dist-tag(默认 latest)
 *
 * 它**不**替你登录、不碰 git、不打 tag:那些是有凭据与有判断的人在别处做的动作。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const DIST = join(ROOT, 'dist', 'clearai-dsh')

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const tagIndex = argv.indexOf('--tag')
const distTag = tagIndex >= 0 ? argv[tagIndex + 1] : 'latest'

const run = (command, args, options = {}) =>
	execFileSync(command, args, { stdio: 'inherit', cwd: ROOT, ...options })

const capture = (command, args, options = {}) => execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', ...options }).trim()

console.log(`【发布闸】${dryRun ? 'dry-run' : `发布到 npm(dist-tag=${distTag})`}`)

// ① 工作区必须干净:发出去的是某个 commit 的样子,不是"我本地现在这样"
const dirty = capture('git', ['status', '--porcelain'])
if (dirty !== '') {
	console.error('✗ 工作区不干净——先提交或收起来,再发布。未提交的改动不会被装配进包里:')
	console.error(dirty.split('\n').map((line) => `    ${line}`).join('\n'))
	process.exit(2)
}
const commit = capture('git', ['rev-parse', '--short', 'HEAD'])
console.log(`  ✓ 工作区干净(HEAD ${commit})`)

// ② 装配
console.log('  · 装配 dist/ …')
run('node', [join('tools', 'build-package.mjs')])
if (!existsSync(join(DIST, 'package.json'))) {
	console.error('✗ 装配产物里没有 package.json——build-package 没跑成?')
	process.exit(2)
}
const pkg = JSON.parse(readFileSync(join(DIST, 'package.json'), 'utf8'))
console.log(`  ✓ dist/clearai-dsh@${pkg.version}`)

// ③ 逐字节核:dist 必须与源一致(它自己会现场重建一遍再比)
console.log('  · 逐字节核对 …')
run('node', [join('tools', 'verify-package.mjs')])

// ④ 版本不能在 npm 上已经有了
const exists = (() => {
	try {
		const versions = JSON.parse(capture('npm', ['view', pkg.name, 'versions', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] }))
		return Array.isArray(versions) ? versions : [versions]
	} catch {
		// 查不到(没网 / 包不存在 / 没凭据)不该冒充"没发布过"——但它是**警告**不是硬停:
		// 真发布会由 npm 自己拒掉重名版本,而没网时我们更该让人自己决定。
		return null
	}
})()
if (exists === null) console.log('  ! 查不到 npm 上的版本清单(没网或未登录);继续,真发布会由 npm 自己拦。')
else if (exists.includes(pkg.version)) {
	console.error(`✗ ${pkg.name}@${pkg.version} 已经在 npm 上——发布前先改版本号(改 package.json 后重跑 build)。`)
	process.exit(2)
} else console.log(`  ✓ ${pkg.name}@${pkg.version} 在 npm 上还没有(${exists.length} 个已发布版本)`)

// ⑤ 发布:**cwd 必须切到 dist/clearai-dsh**
console.log(`  · ${dryRun ? 'dry-run' : '发布'} …`)
try {
	execFileSync('npm', ['publish', ...(dryRun ? ['--dry-run'] : []), '--tag', distTag], { stdio: 'inherit', cwd: DIST })
} catch (error) {
	console.error('')
	console.error('✗ 发布失败。常见两种:没登录(`npm login`),或工作区根目录下误跑(本工具不会犯这条)。')
	console.error(String(error?.message ?? error).split('\n')[0])
	process.exit(1)
}

console.log('')
console.log(dryRun ? '完成(dry-run,什么都没发出去)。' : `已发布 ${pkg.name}@${pkg.version}(dist-tag=${distTag})。`)
if (!dryRun) console.log('记得把 tag 推上去:git push origin v' + pkg.version)
