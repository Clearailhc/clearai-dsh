/**
 * git 世界线的**可行性探针**。
 *
 * 讨论稿里"世界线长在 git 上"这个提议,压着几个没验过的假设。这个脚本把它们逐条跑出来,
 * 而不是靠猜:
 *   ① worktree 真能给出互不污染的独立工作副本吗?
 *   ② 工作区**有未提交改动**时,分支合并还能进行吗?(研究型文件夹几乎总是脏的)
 *   ③ 删掉 worktree 之后,分支 ref 还能永久读取吗?(P5:落选的世界线必须留痕)
 *   ④ 冲突时会发生什么?(采纳绝不能"悄悄合上")
 *
 * 全部在 /tmp 的临时仓库里做,不碰任何真实工作区。
 *
 * 跑法:node tools/spike-git-worldlines.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'clearai-git-spike-'))
const REPO = join(ROOT, 'workspace')
mkdirSync(REPO, { recursive: true })

function git(args, cwd = REPO) {
	try {
		const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
		return { ok: true, out: out.trim(), code: 0 }
	} catch (error) {
		return { ok: false, out: String(error.stdout ?? '').trim(), err: String(error.stderr ?? '').trim(), code: error.status ?? -1 }
	}
}

const results = []
function record(label, value, detail = '') {
	results.push({ label, value, detail })
	console.log(`${value === '可' || value === true ? '✓' : value === '不可' ? '✗' : '·'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

console.log(`临时仓库:${REPO}\n`)

// ── 搭一个像"研究工作区"的仓库:有数据、有脚本,并且**有未提交改动** ─────────
git(['init', '-q'])
git(['config', 'user.email', 'spike@local'])
git(['config', 'user.name', 'spike'])
writeFileSync(join(REPO, 'data.csv'), 'run,yield\n1,60\n2,61\n')
writeFileSync(join(REPO, 'README.md'), '# 研究\n')
git(['add', '-A'])
git(['commit', '-qm', 'base'])
record('git 可用', git(['--version']).out)

// ② 的先决条件:让工作区"脏"起来(未提交改动)
writeFileSync(join(REPO, 'README.md'), '# 研究(我改了一半)\n')
writeFileSync(join(REPO, 'scratch.tmp'), '未跟踪的草稿\n')

// ── ① worktree:两条世界线各一份独立工作副本 ────────────────────────────────
const wtA = join(ROOT, 'worldlines', 'jia')
const wtB = join(ROOT, 'worldlines', 'yi')
mkdirSync(join(ROOT, 'worldlines'), { recursive: true })
const addA = git(['worktree', 'add', wtA, '-b', 'clearai/k1/jia'])
const addB = git(['worktree', 'add', wtB, '-b', 'clearai/k1/yi'])
record('① worktree 建立(两条世界线各一份副本)', addA.ok && addB.ok, addA.ok ? addB.err || '两个 worktree 就绪' : addA.err)

if (addA.ok && addB.ok) {
	// 隔离:两条线各自改同一个文件,互不影响
	writeFileSync(join(wtA, 'data.csv'), 'run,yield\n1,62\n2,63\n3,64\n')
	writeFileSync(join(wtB, 'data.csv'), 'run,yield\n1,55\n2,56\n3,57\n')
	const a = readFileSync(join(wtA, 'data.csv'), 'utf8')
	const b = readFileSync(join(wtB, 'data.csv'), 'utf8')
	const main = readFileSync(join(REPO, 'data.csv'), 'utf8')
	record('① 隔离:两条世界线互不污染,主线不动', a !== b && main === 'run,yield\n1,60\n2,61\n')
	for (const [dir, label, content] of [[wtA, 'jia', 'run,yield\n1,62\n2,63\n3,64\n'], [wtB, 'yi', 'run,yield\n1,55\n2,56\n3,57\n']]) {
		writeFileSync(join(dir, 'data.csv'), content)
		git(['add', '-A'], dir)
		git(['-c', 'user.email=x@y', '-c', 'user.name=x', 'commit', '-qm', `worldline ${label}`], dir)
	}

	// ③ 采纳 = 合并。先测"主线是脏的"这一现实情形
	const mergeDirty = git(['merge', '--no-ff', '-m', 'adopt jia', 'clearai/k1/jia'])
	record(
		'② 主线有未提交改动时直接合并',
		mergeDirty.ok ? '可' : '不可',
		mergeDirty.ok ? '' : (mergeDirty.err.split('\n')[0] ?? '').slice(0, 120),
	)

	if (!mergeDirty.ok) {
		git(['merge', '--abort'])
		// 现实解法:先把手上的改动提交进账本,再合并
		git(['add', '-A'])
		const autoCommit = git(['-c', 'user.email=x@y', '-c', 'user.name=x', 'commit', '-qm', '账本:采纳前的工作区快照'])
		record('② 兜底:先自动提交当前状态,再合并', autoCommit.ok, autoCommit.ok ? '可行(代价:用户会看到一条自动提交)' : autoCommit.err.slice(0, 100))
		const mergeClean = git(['merge', '--no-ff', '-m', 'adopt jia', 'clearai/k1/jia'])
		record('② 干净树上合并', mergeClean.ok ? '可' : '不可', mergeClean.ok ? '' : mergeClean.err.slice(0, 120))
		record('② 合并后主线拿到赢家产物', readFileSync(join(REPO, 'data.csv'), 'utf8').includes('62'))
	}

	// ②b 最危险的脏工作区:用户手上改的文件,正好也是世界线要合进来的那个
	writeFileSync(join(REPO, 'data.csv'), readFileSync(join(REPO, 'data.csv'), 'utf8') + '4,65\n') // 用户又加了一行,未提交
	const overlap = git(['merge', '--no-ff', '-m', 'adopt yi', 'clearai/k1/yi'])
	record(
		'②b 用户未提交改动与世界线改动**重叠**时合并',
		overlap.ok ? '可' : '不可(必须显式处理)',
		overlap.ok ? '' : (overlap.err.split('\n').find((line) => line.includes('local changes')) ?? overlap.err.split('\n')[0] ?? '').slice(0, 120),
	)
	if (!overlap.ok) {
		record('②b 系统该怎么做', '先提交用户手上的快照再合并(account 账本里留一条)', '不能让用户的工作凭空消失,也不能静默丢弃世界线')
		git(['add', '-A'])
		git(['-c', 'user.email=x@y', '-c', 'user.name=x', 'commit', '-qm', '账本:采纳前的用户快照'])
		git(['merge', '--abort'])
	}

	// ③b 落选的世界线里还有未提交的活:直接删 worktree 会丢东西吗?
	writeFileSync(join(wtB, 'draft.md'), '# 还没提交的草稿\n')
	const removeDirty = git(['worktree', 'remove', wtB])
	record(
		'③b worktree 里还有未提交的活时直接删',
		removeDirty.ok ? '可(危险:会丢东西)' : '不可(安全:git 挡住了)',
		removeDirty.ok ? '' : (removeDirty.err.split('\n')[0] ?? '').slice(0, 120),
	)
	if (!removeDirty.ok) {
		// P5 的正确做法:先把这条世界线的活提交到它自己的分支,再删工作副本
		git(['add', '-A'], wtB)
		git(['-c', 'user.email=x@y', '-c', 'user.name=x', 'commit', '-qm', 'worldline yi: 落选前的最后状态'], wtB)
		const removed = git(['worktree', 'remove', wtB])
		const kept = git(['show', 'clearai/k1/yi:draft.md'])
		record('③b 先提交再删 → 落选世界线的活仍在 ref 里', removed.ok && kept.ok, kept.ok ? `git show clearai/k1/yi:draft.md → ${kept.out.split('\n')[1] ?? ''}` : kept.err.slice(0, 80))
	}

	// ④ 冲突:两条线改同一个文件,合并必须报冲突而不是悄悄选一边
	git(['merge', '--no-ff', '-m', 'adopt yi', 'clearai/k1/yi'])
	const conflicted = git(['status', '--porcelain=v1'])
	record('④ 互斥改动合并会冲突(不会被悄悄合上)', conflicted.out.includes('UU') || conflicted.out.includes('AA'), conflicted.out.split('\n')[0] ?? '')
	git(['merge', '--abort'])

	// ③ 落选:删 worktree,保留 branch ref
	const removeB = git(['worktree', 'remove', wtB])
	const showB = git(['show', 'clearai/k1/yi:data.csv'])
	record('③ 删掉 worktree 后,落选世界线仍可读(branch ref 保留)', removeB.ok && showB.ok && showB.out.includes('55'), showB.ok ? `git show clearai/k1/yi:data.csv → ${showB.out.replace(/\n/g, ' / ')}` : showB.err.slice(0, 100))
	const branchList = git(['branch', '--list', 'clearai/*'])
	record('③ 分支清单可枚举(世界树的数据来源之一是它)', branchList.ok, branchList.out.replace(/\n/g, ' '))
	const wtList = git(['worktree', 'list', '--porcelain'])
	record('⑤ 在飞的世界线可枚举(git worktree list)', wtList.ok, `${wtList.out.split('\n').filter((line) => line.startsWith('worktree ')).length} 个工作副本`)
}

// ── ⑤ 成本:worktree 是不是"复制整个仓库" ──────────────────────────────────
const du = execFileSync('du', ['-sh', wtA], { encoding: 'utf8' }).trim()
record('⑤ worktree 的空间成本(小仓库)', du)

console.log('\n结论要点:')
for (const item of results) console.log(`  · ${item.label} → ${item.value}${item.detail === '' ? '' : `(${item.detail})`}`)
console.log(`\n临时仓库留在:${ROOT}(可删)`)
rmSync(ROOT, { recursive: true, force: true })
console.log('已清理。')
