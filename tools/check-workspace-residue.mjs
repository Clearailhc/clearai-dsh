#!/usr/bin/env node
/**
 * 工作区残留闸:本仓库**不许**带着 ClearAI 工作区的产物与账本提交出去。
 *
 * 为什么要有这道闸(2026-10 清理时查清的):有人在本仓库里开过 ClearAI 会话。工作区是 git 仓库时,
 * 内核的账本**直接用这个仓库**——回合边界上 `git add -A` 再以 `clearai <clearai@local>` 提交到
 * **当前分支**(`snapshotWorkspace` / `commitLedger`)。于是模型按技能约定写的 `lab/`、`products/`、
 * 排查用的 `.tmp-*`,连同开发者手上没写完的改动,一起成了几十条「探索期快照」,被 push 上了主线。
 *
 * 两条检查,各挡一种来路:
 *   · **跟踪了不该跟踪的路径**:工作区约定的目录(`lab/` `products/` `input/` `clear/`)、`.tmp-*`、
 *     Python 缓存。`.gitignore` 已经挡住新增,这条挡的是 `git add -f` 与忽略规则被改掉。
 *   · **范围里有账本提交**(给了 `--since <ref>` 才查):作者是 `clearai@local` 的提交。
 *     它比路径检查更早发现问题——账本提交里混着的往往是正常源码改动,路径检查看不出来。
 *     主线历史里已有的那一串不追溯,所以只查 `<ref>..HEAD`。
 *
 * 跑法:node tools/check-workspace-residue.mjs [--since <ref>]
 */
import { execFileSync } from 'node:child_process'

const LEDGER_AUTHOR = 'clearai@local'
const RESIDUE = [/^(lab|products|input|clear)\//, /^\.tmp-[^/]+\//, /(^|\/)__pycache__\//, /\.pyc$/]

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })

const sinceAt = process.argv.indexOf('--since')
const since = sinceAt === -1 ? null : process.argv[sinceAt + 1]
if (sinceAt !== -1 && (since === undefined || since === '')) {
	console.error('用法:node tools/check-workspace-residue.mjs [--since <ref>]')
	process.exit(2)
}

const problems = []

const tracked = git('ls-files', '-z')
	.split('\0')
	.filter((path) => path !== '' && RESIDUE.some((pattern) => pattern.test(path)))
if (tracked.length > 0) {
	problems.push(`跟踪了 ${tracked.length} 个工作区产物(应删掉,它们不属于插件源码):\n${tracked.slice(0, 20).map((path) => `    ${path}`).join('\n')}${tracked.length > 20 ? `\n    …还有 ${tracked.length - 20} 个` : ''}`)
}

if (since !== null) {
	const commits = git('log', '--format=%h %s', `--author=${LEDGER_AUTHOR}`, `${since}..HEAD`).trim()
	if (commits !== '') {
		const lines = commits.split('\n')
		problems.push(`${since}..HEAD 里有 ${lines.length} 条 ClearAI 账本提交(作者 ${LEDGER_AUTHOR}):\n${lines.slice(0, 20).map((line) => `    ${line}`).join('\n')}\n  它们是在本仓库里跑 ClearAI 会话时内核自动落的;把其中真正的改动重新整理成正常提交,再丢掉这些。`)
	}
}

if (problems.length > 0) {
	console.error(`工作区残留闸:未通过\n\n${problems.map((problem) => `  ✗ ${problem}`).join('\n\n')}`)
	process.exit(1)
}
console.log(`工作区残留闸:通过${since === null ? '' : `(含 ${since}..HEAD 的账本提交检查)`}`)
