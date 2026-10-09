/**
 * verify-truth-table —— 真值表的交叉校验。
 *
 * 这份检查存在的理由：**「落进机制的约束」和「以为落进机制的约束」在代码里长得一模一样**。
 * 唯一能把两者分开的是机械核对——拿声明去问代码，而不是拿文档去问文档。
 *
 * 检查项：
 *   ① 代码定义的工具 ↔ MECHANISM_TOOLS（双向：多一个、少一个都红）
 *   ② CONFIG_KEYS ↔ preset 里 clearai-kernel 行**实际写的**配置键
 *   ③ 提示词段 ↔ 装配缺省（SECTION_TABLE）
 *   ④ 真值表里 status=implemented 的条目必须给得出代码位置
 *   ⑤ 真值表里 status=removed 的条目不许仍出现在工具目录里
 *   ⑥ 交还原生的那几行，必须真的挂在 preset 里
 *   ⑦ 原生 goal 只能经 Conclude 完成（守卫在），ClearAI 不自设续跑额度
 *   ⑧ 已摘除的 set_autonomy 不许重新出现在工具目录里
 *   ⑨ 真值表声称的计数与代码常量一致
 *   ⑩ 文档/注释里写下的「N 件工具 / N 段提示词」与代码算出来的数一致
 *   ⑪ 仓库根没有孤儿副本(旧内核拷贝、重复测试)——那是第二本账
 *   ⑫ 假设数量下限 = 2（preset 立产品立场,内核有 hypotheses_too_few 那道门）
 *   ⑬ source.code 可被证伪（文件在、符号在、没有行号）
 *   ⑭ 非 implemented 必须交代归宿；known_mismatch 只写当下的不符
 *   ⑮/⑯ **反向**(代码 → 表):代码里写下的变更类型必须都在 `events` 里登记,
 *       而 `events` 里每条又必须指得到真机制、真的出现在代码里
 *
 * 跑法：node tools/verify-truth-table.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_KEYS, MECHANISM_TOOLS, apply } from '../preset/plugins/clearai-kernel.js'
import { SECTIONS, SECTION_TABLE } from '../preset/plugins/prompts.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const read = (rel) => readFileSync(join(PORT, rel), 'utf8')

const KERNEL = read('preset/plugins/clearai-kernel.js')
const PRESET = read('preset/agent.cordis.yml')
const PROMPTS = read('preset/plugins/prompts.js')
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
check(
	SECTION_TABLE.size === SECTIONS.length && SECTIONS.every((section) => SECTION_TABLE.get(section.name) === section),
	'③ 段表与段清单逐条一致(没有槽位,每段都在场)',
	`SECTIONS=${SECTIONS.length} 段表=${SECTION_TABLE.size}`,
)

// ── ④ implemented 条目必须给得出代码位置 ─────────────────────────────────────
const withoutCode = TABLE.mechanisms.filter((m) => m.status === 'implemented' && (m.source.code === null || m.source.code === undefined))
check(withoutCode.length === 0, '④ status=implemented 的条目都给了代码位置', `缺:[${withoutCode.map((m) => m.id).join(' ')}]`)

// ── ⑤ status=removed 的条目不许仍在工具目录里 ────────────────────────────────
const removedStillLive = TABLE.mechanisms.filter((m) => m.status === 'removed' && declaredTools.has(m.id))
check(removedStillLive.length === 0, '⑤ 已删除的机制没有仍留在工具目录里', `仍活着:[${removedStillLive.map((m) => m.id).join(' ')}]`)

// ── ⑥ 原生行该挂的都挂着 ─────────────────────────────────────────────────
const presetPluginNames = new Set([...PRESET.matchAll(/name:\s*'(@deepseek-ai\/[^']+)'/g)].map((match) => match[1]))
// 工作方式(todo/subagent/workflow/ralph)阶段 5 起挂回来;goal 工具/命令与 plan-mode 第三阶段起挂上——
// 目标层挂在原生 goal 上,动手前给人看计划交给原生 /plan。防的是哪天被手滑摘掉而没人发现。
const mustBePresent = [
	'@deepseek-ai/dsh-tool-todo',
	'@deepseek-ai/dsh-tool-subagent',
	'@deepseek-ai/dsh-tool-workflow',
	'@deepseek-ai/dsh-tool-ralph',
	'@deepseek-ai/dsh-tool-goal',
	'@deepseek-ai/dsh-command-goal',
	'@deepseek-ai/dsh-plan-mode',
]
const missing = mustBePresent.filter((name) => !presetPluginNames.has(name))
check(missing.length === 0, '⑥ 交还原生的那几行确实挂着(防手滑摘除)', `意外缺席:[${missing.join(' ')}]`)

// ── ⑦ 原生 goal 只能经 Conclude 完成:守卫在 ──────────────────────────────────
check(/update_goal/.test(KERNEL) && /'complete'/.test(KERNEL) && /kind: 'deny'/.test(KERNEL), '⑦ 内核守卫拦住原生 update_goal 直接完成')
check(!/DEFAULT_MAX_AUTO_TURNS|maxAutoTurns/.test(KERNEL), '⑦ ClearAI 不再自设续跑额度(归原生 goal)')

// ── ⑧ set_autonomy 不许重新出现 ──────────────────────────────────────────────
check(!declaredTools.has('set_autonomy'), '⑧ 已摘除的 set_autonomy 没有回到工具目录')

// ── ⑨ 真值表声称的计数 ↔ 代码常量 ────────────────────────────────────────────
const toolEntry = TABLE.mechanisms.find((m) => m.id === 'tool-trimming')
check(toolEntry !== undefined && toolEntry.source.code.includes('MECHANISM_TOOLS'), '⑨ 真值表把工具目录指向 MECHANISM_TOOLS')
// 表只写现行机制:删掉的机制连条目一起删,不留记录。
check(TABLE.mechanisms.every((m) => m.status !== 'removed'), '⑨ 真值表只收现行机制(没有 status=removed 的条目)')
check(!CONFIG_KEYS.includes('autonomy') && !CONFIG_KEYS.includes('maxAutoTurns'), '⑨ 配置白名单里没有 autonomy / maxAutoTurns')

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

// ── ⑫ 假设数量下限:0.5.2 起 preset 不再设下限 ─────────────────────────────────
// 「至少两条候选」在 0.5.1 里催生了凑数的候选。门仍在内核(机制中立,缺省 0),preset 不打开它,
// 提示词也不再要求条数。
check(!/minHypotheses:\s*[1-9]/.test(PRESET), '⑫ preset 不设假设数量下限')
check(/hypotheses_too_few/.test(KERNEL), '⑫ 内核仍有 hypotheses_too_few 这道门(配置打开时生效)')
check(!/(假设|判断)至少两条/.test(PROMPTS), '⑫ 循环段不再要求候选条数')

// ── ⑬ source.code 必须**可被证伪**:文件在、符号在、没有行号 ─────────────────
/**
 * `source.code` 是「这条机制落在哪」的声明。它原来是一段带**行号**的散文
 * (`clearai-kernel.js-3178`),而行号随每次编辑腐烂——真值表于是长期指着不存在的位置,
 * 谁也没发现。这里把它变成**可以被机器证伪**的东西:
 *   · 出现的每个文件路径必须真的存在;
 *   · 出现的每个标识符必须在**它所属的那一段**里真的出现(按 `;` 切段,段首的路径即归属);
 *   · 不许出现行号(它必烂;要指位置就指符号)。
 * 这不是风格检查:一条「已实现」的机制指不出真实的落点,它就该红。
 */
const CODE_STOPWORDS = new Set(['case', 'the', 'and', 'file', 'group', 'js', 'mjs', 'yml', 'json', 'md'])
const codeProblems = []
for (const mechanism of TABLE.mechanisms) {
	const code = mechanism.source?.code
	if (typeof code !== 'string' || code === '') continue
	if (/(?:\.js|\.mjs|\.yml|\.json|\.md)[-:]\d+/.test(code)) {
		codeProblems.push(`${mechanism.id}: source.code 里还有行号(行号必烂,请指符号)`)
		continue
	}
	let owner = null
	for (const segment of code.split(';')) {
		const trimmed = segment.trim()
		if (trimmed === '') continue
		const path = /[\w./-]+\.(?:js|mjs|yml|json|md)/.exec(trimmed)
		if (path !== null) {
			owner = path[0]
			if (!existsSync(join(PORT, owner))) codeProblems.push(`${mechanism.id}: source.code 指向不存在的文件 ${owner}`)
		}
		if (owner === null) continue
		let body = null
		try {
			body = readFileSync(join(PORT, owner), 'utf8')
		} catch {
			continue
		}
		// 路径本身会被标识符正则切碎(`preset`/`plugins`/`kernel`),先把它整段挖掉再认符号。
		const symbols = (path === null ? trimmed : trimmed.replace(path[0], ' ')).match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []
		for (const identifier of symbols) {
			if (CODE_STOPWORDS.has(identifier)) continue
			if (!body.includes(identifier)) codeProblems.push(`${mechanism.id}: ${owner} 里找不到符号 ${identifier}`)
		}
	}
}
check(codeProblems.length === 0, '⑬ 每条机制的 source.code 都能被证伪(文件在、符号在、没有行号)', codeProblems.slice(0, 6).join(' ;; '))

// ── ⑭ 非 implemented 的条目必须交代归宿；不符字段不许再写计划 ────────────────
/**
 * coverage §5 立了三分法:**变成机制 / 保持设计目标 / 已删除并记账**。没有这一栏,
 * 「还没做」与「决定不做」在表里长得一模一样,读的人会一直把设计目标当待办。
 * 同时:`known_mismatch` 是**不符**字段——它描述的是文档/注释与代码当下的矛盾,
 * 不是「阶段 N 计划做什么」。行号与计划措辞都不许再出现(行号必烂,计划会落地)。
 */
const DESTINATIONS = new Set(['become-mechanism', 'stay-design-only', 'deleted'])
const destinationProblems = []
const mismatchProblems = []
for (const mechanism of TABLE.mechanisms) {
	if (mechanism.status !== 'implemented') {
		if (!DESTINATIONS.has(mechanism.destination)) destinationProblems.push(`${mechanism.id}: status=${mechanism.status} 却没有归宿(${String(mechanism.destination)})`)
	}
	const mismatch = mechanism.known_mismatch
	if (typeof mismatch !== 'string') continue
	if (/(?:kernel|fold|index|client|brain|prompts)\.js[-:]\d+/.test(mismatch)) mismatchProblems.push(`${mechanism.id}: known_mismatch 里还有行号`)
	if (/阶段\s*\d+\s*(计划|待|实现)|留给阶段|to be done in phase/i.test(mismatch)) mismatchProblems.push(`${mechanism.id}: known_mismatch 里写的是计划,不是当下的不符`)
}
check(destinationProblems.length === 0, '⑭ 每条非 implemented 的机制都交代了归宿', destinationProblems.slice(0, 4).join(' ;; '))
check(mismatchProblems.length === 0, '⑭ known_mismatch 只写当下的不符(不写行号、不写计划)', mismatchProblems.slice(0, 4).join(' ;; '))

// ── ⑮/⑯ 反向(代码 → 表)：代码里写下的变更类型必须在表里登记 ─────────────────
/**
 * 上面 ①–⑭ 只走**一个方向**：拿表里的条目去问代码。于是「代码里新长了一条机制、
 * 表里没登记」这种漏登记永远不会红——本轮就有三条机制(A2 独立落账通道 / A3 digest 复用 /
 * A6 宿主读面降级)在表外活了一整轮，谁也没发现。这里补上反方向。
 *
 * 抽取规则**只认语法位置**，不认「长得像事件名的字符串」：
 *   · `t: '<字面量>'`（含 `t: cond ? 'a' : 'b'` 这种三元写法）；
 *   · fold.js 的 `case '<字面量>'`（折法认得的 kind）；
 *   · fold.js 的 `LEDGER_ONLY_MUTATIONS`（只留台账、不折视图的那一组）。
 * 为什么不扫「所有形如 a/b 的字符串」：`ctx.on('agent/pre-step')`、`ctx.emit('clearai/brain')`、
 * `internal/status`、`tool/result` 也都是那个形状，但它们不是账本变更——按语法位置抽，
 * 这批假阳性自动出局；注释里的示例由 stripComments 先抹掉（等长替换，便于回原文取上下文）。
 * 已知边界：`t: \`...\`` 这种模板拼接抽不到，所以下面先把「有没有模板拼接」单独钉成判据——
 * 否则「反向检查是完整的」这句话是空的。
 */
/** 把注释换成等长空白（字符串内容保留，因为事件名就住在字符串里）。 */
function stripComments(text) {
	let out = ''
	let state = null // null | "'" | '"' | '`' | '//' | '/*'
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index]
		const next = text[index + 1]
		if (state === null) {
			if (char === '/' && next === '/') {
				state = '//'
				out += '  '
				index += 1
				continue
			}
			if (char === '/' && next === '*') {
				state = '/*'
				out += '  '
				index += 1
				continue
			}
			if (char === "'" || char === '"' || char === '`') state = char
			out += char
			continue
		}
		if (state === '//') {
			if (char === '\n') {
				state = null
				out += char
			} else out += ' '
			continue
		}
		if (state === '/*') {
			if (char === '*' && next === '/') {
				state = null
				out += '  '
				index += 1
				continue
			}
			out += char === '\n' ? '\n' : ' '
			continue
		}
		if (char === '\\') {
			out += char + (next ?? '')
			index += 1
			continue
		}
		if (char === state) state = null
		out += char
	}
	return out
}

const MUTATION_SHAPE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9_-]*$/
const SCANNED_FILES = ['preset/plugins/clearai-kernel.js', 'ui/lib/index.js', 'ui/lib/fold.js']
const SCANNED_TEXT = Object.fromEntries(SCANNED_FILES.map((rel) => [rel, stripComments(read(rel))]))
/** `t:` 位置上的字面量（三元 `t: cond ? 'a' : 'b'` 也算：`t:` 之后到行尾/逗号之间的字面量都收）。 */
function tLiterals(text) {
	const found = new Set([...text.matchAll(/\bt:\s*'([^'\\\n]+)'/g)].map((match) => match[1]).filter((value) => MUTATION_SHAPE.test(value)))
	for (const statement of text.matchAll(/\bt:\s*([^,\n]*(?:'[^'\n]*'[^,\n]*)+)/g)) {
		for (const literal of statement[1].matchAll(/'([^'\\\n]+)'/g)) if (MUTATION_SHAPE.test(literal[1])) found.add(literal[1])
	}
	return found
}
/** 折法的 `case '<字面量>'`：它认得的事件类型。 */
const caseLiterals = (text) => new Set([...text.matchAll(/case\s+'([^'\\\n]+)'/g)].map((match) => match[1]).filter((value) => MUTATION_SHAPE.test(value)))

const FOLD_TEXT = SCANNED_TEXT['ui/lib/fold.js']
const kernelWritten = tLiterals(SCANNED_TEXT['preset/plugins/clearai-kernel.js'])
const hostWritten = tLiterals(SCANNED_TEXT['ui/lib/index.js'])
const foldKnown = caseLiterals(FOLD_TEXT)
const ledgerOnlyInCode = [...(/export const LEDGER_ONLY_MUTATIONS = \[([^\]]*)\]/.exec(FOLD_TEXT)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
/** 代码里出现的全部变更类型（生产者 ∪ 折法认得的 ∪ 只留台账那组）。 */
const codeEvents = new Set([...kernelWritten, ...hostWritten, ...foldKnown, ...ledgerOnlyInCode])

const templateBuilt = SCANNED_FILES.filter((rel) => /\bt:\s*`/.test(SCANNED_TEXT[rel]))
check(
	templateBuilt.length === 0,
	'⑮ 反向抽取的完整性前提:代码里没有模板拼接出来的变更类型',
	`以下文件把事件名拼在模板串里,反向抽取会漏:[${templateBuilt.join(' ')}]`,
)

const tableEvents = Array.isArray(TABLE.events) ? TABLE.events : []
const declaredEvents = new Map(tableEvents.map((entry) => [String(entry?.t ?? ''), String(entry?.by ?? '')]))
const missingInTable = [...codeEvents].filter((type) => !declaredEvents.has(type)).sort()
check(
	missingInTable.length === 0,
	'⑮ 反向:代码里的每个变更类型都在真值表 events 里(漏登记 ⇒ 红)',
	`代码里有、表里没登记:[${missingInTable.join(' ')}]`,
)

/**
 * 反方向也要红：凭空登记一个代码里不存在的事件、或把 `by` 指向一个不存在的机制，
 * 都会让这张表变成第四本账。`ledger-only` 是唯一允许的非机制取值（它就指
 * `LEDGER_ONLY_MUTATIONS` 那一组），而且要**逐字相等**——不然「登记成 ledger-only」
 * 就成了把新事件塞进白名单让检查变绿的后门。
 */
const mechanismIds = new Set(TABLE.mechanisms.map((m) => m.id))
const eventProblems = []
const seenEventTypes = new Set()
for (const entry of tableEvents) {
	const type = String(entry?.t ?? '')
	const by = String(entry?.by ?? '')
	if (seenEventTypes.has(type)) eventProblems.push(`${type}: events 里重复登记`)
	seenEventTypes.add(type)
	if (by !== 'ledger-only' && !mechanismIds.has(by)) eventProblems.push(`${type}: by='${by}' 指不到任何机制`)
	if (!codeEvents.has(type)) eventProblems.push(`${type}: 代码里没有这个变更类型(凭空登记)`)
}
check(
	eventProblems.length === 0,
	'⑯ 反向:events 里每条都指得到存在的机制,且真的在代码里出现(凭空登记 ⇒ 红)',
	eventProblems.slice(0, 6).join(' ;; '),
)
const declaredLedgerOnly = tableEvents.filter((entry) => entry?.by === 'ledger-only').map((entry) => String(entry?.t)).sort()
const ledgerOnlyProblems = []
if (JSON.stringify(declaredLedgerOnly) !== JSON.stringify([...ledgerOnlyInCode].sort())) {
	ledgerOnlyProblems.push(`表里 ledger-only=[${declaredLedgerOnly.join(' ')}] 代码里 LEDGER_ONLY_MUTATIONS=[${[...ledgerOnlyInCode].join(' ')}]`)
}
// 两条例外的理由：只留台账的那组必须是**内核写的事实**，而且折法不许认得它（认得就该折进视图）。
for (const type of ledgerOnlyInCode) {
	if (foldKnown.has(type)) ledgerOnlyProblems.push(`${type}: 折法认得它,却把它标成只留台账`)
	if (!kernelWritten.has(type)) ledgerOnlyProblems.push(`${type}: 内核不写它,却把它标成只留台账`)
}
check(
	ledgerOnlyProblems.length === 0,
	'⑯ events 里 ledger-only 那一组与 LEDGER_ONLY_MUTATIONS 逐字一致(不是让检查变绿的后门)',
	ledgerOnlyProblems.slice(0, 4).join(' ;; '),
)

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
