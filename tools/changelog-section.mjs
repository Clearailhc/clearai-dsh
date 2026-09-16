/**
 * changelog-section —— 从 `CHANGELOG.md` 里取出某个版本那一段,给它两种用法。
 *
 *   node tools/changelog-section.mjs 0.1.4            # 正文(不含 `## [x.y.z] — 日期` 标题)
 *   node tools/changelog-section.mjs 0.1.4 --title    # Release 标题:clearai-dsh 0.1.4 — <短语>
 *
 * 为什么要有它:GitHub Release 的**说明与标题都从唯一账本里抽**,而不是让 `--generate-notes`
 * 拿 commit 列表自己编一份 —— 那会变成第二本账,而且两边的说法会随 commit 数漂移。
 * 发布流水线的 "Create the GitHub Release" 与人工回填都用它,所以两边印出来的话永远一致。
 *
 * **短语的约定**:段落开头若是一整行黑体(`**……**`),那一行就是这句短语 ——
 * 它既是正文的第一行,也是 Release 标题里 `—` 后面那句(0.1.2 手工版就是这个形状:
 * `clearai-dsh 0.1.2 — the gate opens, and the goal reads as a sentence`)。
 * 段首不是黑体就没有短语,标题就是朴素的一句 `clearai-dsh <版本>`。
 * 短语**原样取用**,不做任何加工(不加、不删、不改标点)。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const wantTitle = args.includes('--title')
const version = args.find((arg) => !arg.startsWith('--'))
if (version === undefined || version === '') {
	console.error('用法:node tools/changelog-section.mjs <x.y.z> [--title]')
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
const body = lines.slice(start + 1, end).join('\n').trim()

if (wantTitle) {
	/** 段首那段黑体就是短语;后面接着写正文也算(0.1.4 就是这样:`**短语。** 正文…`)。 */
	const bold = /^\*\*(.+?)\*\*/.exec(body)
	process.stdout.write(bold === null ? `clearai-dsh ${version}\n` : `clearai-dsh ${version} — ${bold[1]}\n`)
} else {
	process.stdout.write(`${body}\n`)
}
