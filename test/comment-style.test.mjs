/**
 * 注释风格棘轮:四类"流水账"反模式的配额只能降不能升。
 *
 * 判据写在 `docs/optimization/comment-style.zh-CN.md`。这一份测试只做一件事:
 * 把当前**还没清完的债**记在册上,并且**不许它变大**。
 *
 * 为什么用棘轮而不是一刀切禁止:注释质量没法机械判定,但"日期戳 / 章节号 / 事故叙事 /
 * 变更流水"这四类是**可数**的。可数的部分做成配额,不可数的部分(理由是否说清楚)
 * 留给阶段 9 的人审——两者分工明确,不会出现"测试绿了就以为注释没问题"。
 *
 * 清理做法:改注释 → 把下面 BASELINE 里对应的数字调小 → 跑这一份测试。
 * 目标是把四个数字都降到 0。
 *
 * 跑法:node test/comment-style.test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')

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

/**
 * 配额:**只能降**。
 * 每清掉一处就把对应数字调小;出现新的反模式注释会让测试红——那正是它存在的意义。
 * 阶段 9 的终点是四个 0。
 */
const BASELINE = {
	dateStamp: 0,
	sectionRef: 0,
	incidentTag: 0,
}

/** 四类反模式。只统计注释行,不统计字符串字面量里的同形文本。 */
const PATTERNS = {
	/** 日期戳:读者不需要知道这件事发生在哪天。 */
	dateStamp: /20\d{2}-\d{2}-\d{2}/,
	/** 内部章节号:本仓库没有对照表,读者查不到。 */
	sectionRef: /§\s?\d/,
	/** 事故叙事:把注释变成事故报告,而失效模式本身才是有用的信息。 */
	incidentTag: /长测|实测|现场|用户抓到/,
}

const files = [
	...readdirSync(join(PORT, 'preset', 'plugins')).filter((name) => name.endsWith('.js')).map((name) => join(PORT, 'preset', 'plugins', name)),
	...readdirSync(join(PORT, 'ui', 'lib')).filter((name) => name.endsWith('.js')).map((name) => join(PORT, 'ui', 'lib', name)),
]

/** 只取注释行:`//` 行、块注释行(`*` 开头或 `/**`)。 */
function commentLines(text) {
	const lines = []
	let inBlock = false
	for (const line of text.split('\n')) {
		const trimmed = line.trim()
		if (trimmed.startsWith('/*')) inBlock = true
		const isComment = inBlock || trimmed.startsWith('//') || trimmed.startsWith('*')
		if (isComment) lines.push(trimmed)
		if (inBlock && trimmed.includes('*/')) inBlock = false
	}
	return lines
}

const counts = { dateStamp: 0, sectionRef: 0, incidentTag: 0 }
const perFile = {}
let scannedCommentLines = 0
for (const file of files) {
	const lines = commentLines(readFileSync(file, 'utf8'))
	scannedCommentLines += lines.length
	const local = { dateStamp: 0, sectionRef: 0, incidentTag: 0 }
	for (const line of lines) {
		for (const [key, pattern] of Object.entries(PATTERNS)) {
			if (pattern.test(line)) {
				counts[key] += 1
				local[key] += 1
			}
		}
	}
	perFile[relative(PORT, file)] = local
}

console.log('\n【统计面:确实扫到了代码注释】')
{
	const total = Object.values(perFile).reduce((sum, local) => sum + local.dateStamp + local.sectionRef + local.incidentTag, 0)
	check('扫到了 preset 插件与 ui 库', files.length >= 6, `${files.length} 个文件`)
	// 欠账已清到 0:「非空跑」的证明不再是「还有欠账」,而是「真的解析到了注释行」。
	check('注释解析不是空跑(扫到的注释行数以百计)', scannedCommentLines > 500, `${scannedCommentLines} 行注释,${total} 处反模式`)
	check('判据文档存在且可引用', readFileSync(join(PORT, 'docs', 'optimization', 'comment-style.zh-CN.md'), 'utf8').includes('棘轮'))
}

console.log('\n【棘轮:配额只能降不能升】')
for (const [key, label] of [['dateStamp', '日期戳'], ['sectionRef', '内部章节号 §'], ['incidentTag', '事故叙事(长测/实测/现场)']]) {
	const actual = counts[key]
	const quota = BASELINE[key]
	check(
		`${label}:${actual} ≤ 配额 ${quota}`,
		actual <= quota,
		actual > quota ? `涨了 ${actual - quota} 处 —— 新注释里不要再写这一类;顺手把配额调小才是正确方向` : '',
	)
}

console.log('\n【分布:欠账按文件列(应常年为空)】')
{
	const rows = Object.entries(perFile)
		.map(([file, local]) => [file, local.dateStamp + local.sectionRef + local.incidentTag])
		.filter(([, total]) => total > 0)
		.sort((a, b) => b[1] - a[1])
	for (const [file, total] of rows) console.log(`  · ${file}: ${total} 处`)
	// 配额已收到 0:任何一处新欠账都让这份测试红,不需要再找「下一个该清谁」。
	check('没有任何文件欠账(配额 0 之后,这就是全部断言)', rows.length === 0, rows.map(([file, total]) => `${file}:${total}`).join(','))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
