/**
 * verify-truth-table —— 真值表的交叉校验。
 *
 * 这份检查存在的理由：**「落进机制的约束」和「以为落进机制的约束」在代码里长得一模一样**。
 * 唯一能把两者分开的是机械核对——拿声明去问代码，而不是拿文档去问文档。
 *
 * 检查项：
 *   ① 代码定义的工具 ↔ MECHANISM_TOOLS（双向：多一个、少一个都红）
 *   ② CONFIG_KEYS ↔ preset 里 clearai-kernel 行**实际写的**配置键
 *   ③ 提示词段 ↔ 装配缺省（SECTION_TABLE / SECTION_SLOTS）
 *   ④ 真值表里 status=implemented 的条目必须给得出代码位置
 *   ⑤ 真值表里 status=removed 的条目不许仍出现在工具目录里
 *   ⑥ 刻意不挂的原生行，必须真的不在 preset 里
 *   ⑦ 续跑默认额度 = 128，且布防点回落到这个常量
 *   ⑧ 已摘除的 set_autonomy 不许重新出现在工具目录里
 *   ⑨ 真值表声称的计数与代码常量一致
 *   ⑩ 文档/注释里写下的「N 件工具 / N 段提示词」与代码算出来的数一致
 *   ⑪ 仓库根没有孤儿副本(旧内核拷贝、重复测试)——那是第二本账
 *
 * 跑法：node tools/verify-truth-table.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_KEYS, MECHANISM_TOOLS, apply } from '../preset/plugins/clearai-kernel.js'
import { SECTIONS, SECTION_SLOTS, SECTION_TABLE } from '../preset/plugins/prompts.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const read = (rel) => readFileSync(join(PORT, rel), 'utf8')

const KERNEL = read('preset/plugins/clearai-kernel.js')
const PRESET = read('preset/agent.cordis.yml')
const TABLE = JSON.parse(read('docs/optimization/truth-table.json'))

const problems = []
const checked = []
const check = (ok, label, detail = '') => {
	checked.push({ ok, label })
	if (!ok) problems.push(detail === '' ? label : `${label} —— ${detail}`)
}

// ── ① 工具目录 ↔ 代码里 defineTool 的定义 ────────────────────────────────────
const declaredTools = new Set(Object.values(MECHANISM_TOOLS).flat())
const definedTools = new Set([...KERNEL.matchAll(/^\s+name: '([A-Z][A-Za-z]+)',$/gm)].map((match) => match[1]))
const missingInCode = [...declaredTools].filter((name) => !definedTools.has(name))
const missingInCatalog = [...definedTools].filter((name) => !declaredTools.has(name))
check(
	missingInCode.length === 0 && missingInCatalog.length === 0,
	'① 工具目录 ↔ defineTool 双向一致',
	`目录有而代码无:[${missingInCode.join(' ')}] 代码有而目录无:[${missingInCatalog.join(' ')}]`,
)

// ── ② CONFIG_KEYS ↔ preset 实际写的键 ────────────────────────────────────────
function presetKernelKeys() {
	const lines = PRESET.split('\n')
	const start = lines.findIndex((line) => /^-\s+id:\s*clearai-kernel\s*$/.test(line))
	if (start < 0) return null
	const keys = []
	let inConfig = false
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i]
		if (/^-\s+id:/.test(line)) break
		if (/^\s{2}config:\s*$/.test(line)) {
			inConfig = true
			continue
		}
		if (!inConfig) continue
		const match = /^ {4}([A-Za-z_][\w]*):/.exec(line)
		if (match !== null) keys.push(match[1])
	}
	return keys
}
const presetKeys = presetKernelKeys()
check(presetKeys !== null, '② preset 里找得到 clearai-kernel 行')
if (presetKeys !== null) {
	const unknownInPreset = presetKeys.filter((key) => !CONFIG_KEYS.includes(key))
	check(unknownInPreset.length === 0, '② preset 配置键都在 CONFIG_KEYS 白名单里', `越界键:[${unknownInPreset.join(' ')}]`)
}

// ── ③ 提示词段 ↔ 装配缺省 ────────────────────────────────────────────────────
const slotVariants = new Set(Object.values(SECTION_SLOTS).flatMap((variants) => Object.values(variants)))
const expectedMounted = [...SECTION_TABLE.keys()].filter((name) => !slotVariants.has(name))
const mounted = [...expectedMounted, ...Object.keys(SECTION_SLOTS)]
check(
	mounted.length === SECTIONS.length - slotVariants.size + Object.keys(SECTION_SLOTS).length,
	'③ 提示词段在常数与槽位之间自洽',
	`SECTIONS=${SECTIONS.length} 槽位变体=${slotVariants.size} 在场=${mounted.length}`,
)
for (const [slot, variants] of Object.entries(SECTION_SLOTS)) {
	check(
		Object.values(variants).every((name) => SECTION_TABLE.has(name)),
		`③ 槽位 ${slot} 的两个变体都在段表里`,
	)
}

// ── ④ implemented 条目必须给得出代码位置 ─────────────────────────────────────
const withoutCode = TABLE.mechanisms.filter((m) => m.status === 'implemented' && (m.source.code === null || m.source.code === undefined))
check(withoutCode.length === 0, '④ status=implemented 的条目都给了代码位置', `缺:[${withoutCode.map((m) => m.id).join(' ')}]`)

// ── ⑤ status=removed 的条目不许仍在工具目录里 ────────────────────────────────
const removedStillLive = TABLE.mechanisms.filter((m) => m.status === 'removed' && declaredTools.has(m.id))
check(removedStillLive.length === 0, '⑤ 已删除的机制没有仍留在工具目录里', `仍活着:[${removedStillLive.map((m) => m.id).join(' ')}]`)

// ── ⑥ 刻意不挂的原生行必须真的不在 preset 里 ─────────────────────────────────
const presetPluginNames = new Set([...PRESET.matchAll(/name:\s*'(@deepseek-ai\/[^']+)'/g)].map((match) => match[1]))
const mustBeAbsent = [
	'@deepseek-ai/dsh-tool-goal',
	'@deepseek-ai/dsh-command-goal',
	'@deepseek-ai/dsh-plan-mode',
	'@deepseek-ai/dsh-tool-todo',
	'@deepseek-ai/dsh-tool-subagent',
	'@deepseek-ai/dsh-tool-workflow',
	'@deepseek-ai/dsh-tool-ralph',
]
const present = mustBeAbsent.filter((name) => presetPluginNames.has(name))
check(present.length === 0, '⑥ 刻意不挂的原生行确实没有挂载', `意外在场:[${present.join(' ')}]`)

// ── ⑦ 续跑默认额度 = 128，且布防点真的回落到这个常量 ─────────────────────────
const budgetMatch = /const DEFAULT_MAX_AUTO_TURNS = (\d+)/.exec(KERNEL)
check(budgetMatch !== null && Number(budgetMatch[1]) === 128, '⑦ 默认续跑额度是 128', `实际:${budgetMatch?.[1] ?? '(找不到常量)'}`)
check(
	/const maxGoalRounds = CFG\.maxAutoTurns \?\? DEFAULT_MAX_AUTO_TURNS/.test(KERNEL),
	'⑦ 布防点回落到 DEFAULT_MAX_AUTO_TURNS（CFG.maxAutoTurns 只记「人写没写」）',
)

// ── ⑧ set_autonomy 不许重新出现 ──────────────────────────────────────────────
check(!declaredTools.has('set_autonomy'), '⑧ 已摘除的 set_autonomy 没有回到工具目录')

// ── ⑨ 真值表声称的计数 ↔ 代码常量 ────────────────────────────────────────────
const toolEntry = TABLE.mechanisms.find((m) => m.id === 'tool-trimming')
check(toolEntry !== undefined && toolEntry.source.code.includes('MECHANISM_TOOLS'), '⑨ 真值表把工具目录指向 MECHANISM_TOOLS')
check(
	TABLE.mechanisms.some((m) => m.id === 'max-auto-turns' && m.source.code.includes('DEFAULT_MAX_AUTO_TURNS')),
	'⑨ 真值表把续跑额度指向 DEFAULT_MAX_AUTO_TURNS',
)
check(
	TABLE.mechanisms.some((m) => m.id === 'autonomy-config' && m.status === 'partial'),
	'⑨ autonomy 在真值表里被标为 partial（它不再是完整的模式系统）',
)

// ── ⑩ 文档与注释里的数字必须与代码一致 ──────────────────────────────────────
// 「22 件工具」这类数字在几个地方各写了一遍,而它们都漂过:
// 曾经写着「18 件意图工具」「20 件意图工具、22 段提示词」。靠人眼对齐数字必错,
// 所以这里把**代码算出来的数**拿去比对**文档里写下的数**。
const mentionedTools = [...PRESET.matchAll(/(\d+)\s*件意图工具/g)].map((match) => Number(match[1]))
const mentionedSections = [...PRESET.matchAll(/(\d+)\s*段提示词/g)].map((match) => Number(match[1]))
check(
	mentionedTools.every((value) => value === declaredTools.size),
	'⑩ preset 里写的意图工具数与 MECHANISM_TOOLS 一致',
	`实际 ${declaredTools.size},文里写了 [${mentionedTools.join(' ')}]`,
)
check(
	mentionedSections.every((value) => value === SECTIONS.length),
	'⑩ preset 里写的提示词段数与 SECTIONS 一致',
	`实际 ${SECTIONS.length},文里写了 [${mentionedSections.join(' ')}]`,
)

// ── ⑪ 仓库根不许有孤儿副本(第二本账) ───────────────────────────────────────
// 仓库根曾经各留了一份旧拷贝:`clearai-kernel.js` 还带着已删的 autoConfirmed / set_autonomy /
// 6-512 预算,`kernel.test.mjs` 与 test/ 下那份逐字节相同。没有任何东西 import 它们,
// 但 grep 与阅读会撞上——「哪一份才是真的」这种问题本身就是缺陷。
for (const orphan of ['clearai-kernel.js', 'kernel.test.mjs']) {
	check(!existsSync(join(PORT, orphan)), `⑪ 仓库根没有孤儿副本 ${orphan}`)
}

// ── 结果 ─────────────────────────────────────────────────────────────────────
void apply // 保留导入以便将来做装配期探针；当前校验走文本级核对

for (const item of checked) console.log(`${item.ok ? '✓' : '✗'} ${item.label}`)
console.log('')
if (problems.length > 0) {
	console.log(`真值表校验：${problems.length} 处不符`)
	for (const problem of problems) console.log(`  · ${problem}`)
	process.exit(1)
}
console.log(`真值表校验：${checked.length} 项全过（${TABLE.mechanisms.length} 条机制）`)
