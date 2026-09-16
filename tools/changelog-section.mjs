/**
 * changelog-section —— 打出 `CHANGELOG.md` 里某个版本那一段(不含 `## [x.y.z] — 日期` 标题)。
 *
 * 为什么要有它:GitHub Release 的说明**从唯一账本里抽**,而不是让 `--generate-notes`
 * 拿 commit 列表自己编一份 —— 那会变成第二本账(这个项目明确不要的东西),而且两边的
 * 说法会随 commit 数漂移。发布流水线的 "Create the GitHub Release" 与人工回填都用它,
 * 所以两边印出来的话永远一致。
 *
 * 跑法:node tools/changelog-section.mjs 0.1.4
 *   → 0.1.4 那一段的正文;版本不存在时退出码 1 并写明。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (version === undefined || version === '') {
	console.error('用法:node tools/changelog-section.mjs <x.y.z>')
	process.exit(2)
}
const changelog = join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md')
const lines = readFileSync(changelog, 'utf8').split('\n')
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))
if (start === -1) {
	console.error(`CHANGELOG.md 里没有 ${version} 那一段`)
	process.exit(1)
}
/** 下一段 `## [` 就是边界;没有下一段就取到文件末尾。 */
let end = lines.length
for (let index = start + 1; index < lines.length; index += 1) {
	if (lines[index].startsWith('## [')) {
		end = index
		break
	}
}
process.stdout.write(`${lines.slice(start + 1, end).join('\n').trim()}\n`)
