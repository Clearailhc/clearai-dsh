/**
 * build-truth-table —— 由 `docs/optimization/truth-table.json` 生成两份 markdown。
 *
 * 为什么要生成而不是手写两份：
 *   手写两份 = 第二本账。中文一份、英文一份、JSON 一份，三份迟早漂移。
 *   这里只有一份**权威源**（JSON），markdown 是它的纯函数输出：
 *   同一个 commit 跑两次，产物逐字节相同。
 *
 * 生成物里会附上**代码常量快照**（机制数、工具数、配置键数、段数、默认续跑额度），
 * 让读表的人一眼看出「表里写的」与「代码里有的」是不是同一件事。
 * 交叉校验由 `tools/verify-truth-table.mjs` 负责——本脚本只负责渲染。
 *
 * 跑法：node tools/build-truth-table.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_KEYS, MECHANISM_TOOLS } from '../preset/plugins/clearai-kernel.js'
import { SECTIONS, SECTION_SLOTS } from '../preset/plugins/prompts.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const DOCS = join(PORT, 'docs', 'optimization')
const SOURCE = join(DOCS, 'truth-table.json')

/** 渲染时用的中文标签。 */
const ZH = {
	layer: { epistemic: '认识论', harness: 'Harness', host: '宿主', ux: '交互', policy: '策略' },
	status: { implemented: '已实现', partial: '部分实现', 'design-only': '设计目标', removed: '已删除' },
	hardness: { hard: '硬边界', advisory: '建议', native: '原生', 'prompt-only': '仅提示词', deprecated: '废弃' },
	authority: { authoritative: '权威', 'non-authoritative': '非权威', none: '无' },
}

/** 渲染时用的英文标签。 */
const EN = {
	layer: { epistemic: 'Epistemic', harness: 'Harness', host: 'Host', ux: 'UX', policy: 'Policy' },
	status: { implemented: 'Implemented', partial: 'Partial', 'design-only': 'Design only', removed: 'Removed' },
	hardness: { hard: 'Hard boundary', advisory: 'Advisory', native: 'Native', 'prompt-only': 'Prompt only', deprecated: 'Deprecated' },
	authority: { authoritative: 'Authoritative', 'non-authoritative': 'Non-authoritative', none: 'None' },
}

const STATUS_ORDER = ['implemented', 'partial', 'design-only', 'removed']
const HARDNESS_ORDER = ['hard', 'advisory', 'native', 'prompt-only', 'deprecated']
/**
 * 非 implemented 的条目必须交代**归宿**(coverage §5 的三分法:变成机制 / 保持设计目标 /
 * 已删除并记账)。没有它,「还没做」与「决定不做」在表里长得一模一样,读的人会一直当待办。
 */
const DESTINATION = {
	'become-mechanism': { zh: '变成机制', en: 'becomes a mechanism' },
	'stay-design-only': { zh: '保持设计目标', en: 'stays design-only' },
	deleted: { zh: '已删除并记账', en: 'deleted and accounted' },
}
const LAYER_ORDER = ['epistemic', 'harness', 'host', 'ux', 'policy']

function load() {
	return JSON.parse(readFileSync(SOURCE, 'utf8'))
}

/** 代码常量快照：真值表说的事，代码里到底有多少。 */
function codeSnapshot() {
	const tools = Object.values(MECHANISM_TOOLS).flat()
	const slotVariants = Object.values(SECTION_SLOTS).flatMap((variants) => Object.values(variants))
	return {
		mechanisms: Object.keys(MECHANISM_TOOLS),
		tools,
		configKeys: CONFIG_KEYS,
		sectionsDefined: SECTIONS.length,
		sectionsMounted: SECTIONS.length - slotVariants.length + Object.keys(SECTION_SLOTS).length,
		slots: SECTION_SLOTS,
	}
}

/** 一句可读的 counts 行。 */
function countsLine(table, labels) {
	/**
	 * 每个键有**自己的**取值序:`status` 与 `hardness` 是两套词表,拿同一份序去过滤
	 * 只会得到空串——这正是「按强度」那一行长期空着的原因。序按枚举声明,不按印象。
	 */
	const by = (key, order) =>
		order
			.filter((value) => table.mechanisms.some((m) => m[key] === value))
			.map((value) => `${labels[key][value]} ${table.mechanisms.filter((m) => m[key] === value).length}`)
			.join(' · ')
	const byDestination = Object.keys(DESTINATION)
		.filter((value) => table.mechanisms.some((m) => m.destination === value))
		.map((value) => `${labels === ZH ? DESTINATION[value].zh : DESTINATION[value].en} ${table.mechanisms.filter((m) => m.destination === value).length}`)
		.join(' · ')
	return { status: by('status', STATUS_ORDER), hardness: by('hardness', HARDNESS_ORDER), destination: byDestination }
}

function tableRows(table, labels, lang) {
	const lines = []
	const head =
		lang === 'zh'
			? '| id | 机制 | 层 | 状态 | 强度 | 权威 | 责任方 | 阻断执行 | 受 autonomy 影响 | 代码位置 |'
			: '| id | Mechanism | Layer | Status | Strength | Authority | Actor | Blocks | autonomy | Code |'
	lines.push(head)
	lines.push('|---|---|---|---|---|---|---|---|---|---|')
	for (const layer of LAYER_ORDER) {
		for (const m of table.mechanisms.filter((entry) => entry.layer === layer)) {
			const code = m.source.code === null ? '—' : `\`${String(m.source.code).split(';')[0].trim()}\``
			lines.push(
				[
					`\`${m.id}\``,
					lang === 'zh' ? m.name : m.name_en,
					labels.layer[m.layer],
					labels.status[m.status],
					labels.hardness[m.hardness],
					labels.authority[m.authority],
					m.actor,
					m.blocks_execution ? (lang === 'zh' ? '是' : 'yes') : (lang === 'zh' ? '否' : 'no'),
					m.affected_by_autonomy ? (lang === 'zh' ? '**是**' : '**yes**') : (lang === 'zh' ? '否' : 'no'),
					code,
				].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
			)
		}
	}
	return lines
}

function detailSections(table, lang) {
	const lines = []
	for (const m of table.mechanisms) {
		const title = lang === 'zh' ? m.name : m.name_en
		lines.push(`### \`${m.id}\` · ${title}`, '')
		lines.push(lang === 'zh'
			? `- **层**：${ZH.layer[m.layer]} · **状态**：${ZH.status[m.status]} · **强度**：${ZH.hardness[m.hardness]} · **权威**：${ZH.authority[m.authority]} · **责任方**：${m.actor}`
			: `- **Layer**: ${EN.layer[m.layer]} · **Status**: ${EN.status[m.status]} · **Strength**: ${EN.hardness[m.hardness]} · **Authority**: ${EN.authority[m.authority]} · **Actor**: ${m.actor}`)
		if (lang === 'zh') {
			lines.push(`- **触发**：${m.trigger}`)
			if (m.input && m.input !== '—') lines.push(`- **输入**：${m.input}`)
			if (m.output && m.output !== '—') lines.push(`- **输出**：${m.output}`)
			lines.push(`- **阻断执行**：${m.blocks_execution ? '是' : '否'} · **受 autonomy 影响**：${m.affected_by_autonomy ? '是' : '否'}`)
			lines.push(`- **原生替代**：${m.native_dsh_alternative ?? '无'}`)
			lines.push(`- **理由**：${m.rationale}`)
			if (m.destination !== undefined) lines.push(`- **归宿**：${DESTINATION[m.destination]?.zh ?? m.destination}`)
			lines.push(`- **代码**：${m.source.code ?? '—'}`)
			lines.push(`- **测试**：${m.source.tests ?? '—'} · **配置**：${m.source.config ?? '—'}`)
			lines.push(`- **提示词**：${m.source.prompt ?? '—'} · **文档**：${m.source.docs ?? '—'}`)
			if (m.known_mismatch !== null) lines.push(`- **已知不符**：${m.known_mismatch}`)
		} else {
			lines.push(`- **Trigger**: ${m.trigger}`)
			if (m.input && m.input !== '—') lines.push(`- **Input**: ${m.input}`)
			if (m.output && m.output !== '—') lines.push(`- **Output**: ${m.output}`)
			lines.push(`- **Blocks execution**: ${m.blocks_execution ? 'yes' : 'no'} · **Affected by autonomy**: ${m.affected_by_autonomy ? 'yes' : 'no'}`)
			lines.push(`- **Native alternative**: ${m.native_dsh_alternative ?? 'none'}`)
			lines.push(`- **Rationale**: ${m.rationale}`)
			if (m.destination !== undefined) lines.push(`- **Destination**: ${DESTINATION[m.destination]?.en ?? m.destination}`)
			lines.push(`- **Code**: ${m.source.code ?? '—'}`)
			lines.push(`- **Tests**: ${m.source.tests ?? '—'} · **Config**: ${m.source.config ?? '—'}`)
			lines.push(`- **Prompt**: ${m.source.prompt ?? '—'} · **Docs**: ${m.source.docs ?? '—'}`)
			if (m.known_mismatch !== null) lines.push(`- **Known mismatch**: ${m.known_mismatch}`)
		}
		lines.push('')
	}
	return lines
}

function renderZh(table) {
	const snap = codeSnapshot()
	const counts = countsLine(table, ZH)
	const lines = []
	lines.push('# ClearAI 机制真值表', '')
	lines.push('> **本文件由 `truth-table.json` 生成，不要手工编辑。**')
	lines.push('> 权威源是 `docs/optimization/truth-table.json`；改内容改那里，然后跑 `node tools/build-truth-table.mjs`。')
	lines.push('> 交叉校验见 `node tools/verify-truth-table.mjs`。', '')
	lines.push('这份表回答一个问题：**当前代码真正保证的是什么**。它不描述愿望——`设计目标` 与 `已删除` 就是字面意思。', '')
	lines.push('## 计数', '')
	lines.push(`- 机制条目：**${table.mechanisms.length}**`)
	lines.push(`- 按状态：${counts.status}`)
	lines.push(`- 按强度：${counts.hardness}`)
	lines.push(`- 按归宿：${counts.destination}`)
	lines.push(`- 真正阻断执行的：**${table.mechanisms.filter((m) => m.blocks_execution).length}**`)
	lines.push(`- 受 autonomy 影响的：**${table.mechanisms.filter((m) => m.affected_by_autonomy).length}**`)
	lines.push(`- 存在已知不符（文档 / 注释与代码不一致）的：**${table.mechanisms.filter((m) => m.known_mismatch !== null).length}**`, '')
	lines.push('## 代码常量快照', '')
	lines.push('这一节由代码导出，不是手写：')
	lines.push('')
	lines.push(`- 机制：${snap.mechanisms.length} 个（${snap.mechanisms.join(' / ')}）`)
	lines.push(`- 意图工具：${snap.tools.length} 件（${snap.tools.join(' ')}）`)
	lines.push(`- 配置键：${snap.configKeys.length} 个`)
	lines.push(`- 提示词段：定义 ${snap.sectionsDefined} 段，同一时刻在场 ${snap.sectionsMounted} 段（槽位 ${Object.keys(snap.slots).join(' / ')} 二选一）`, '')
	lines.push('## 总表', '')
	lines.push(...tableRows(table, ZH, 'zh'), '')
	lines.push('## 逐条明细', '')
	lines.push(...detailSections(table, 'zh'))
	lines.push('---', '')
	lines.push('生成物：本文件与 `truth-table.md` 都来自 `truth-table.json`；两份内容等价，语言不同。')
	return `${lines.join('\n')}\n`
}

function renderEn(table) {
	const snap = codeSnapshot()
	const counts = countsLine(table, EN)
	const lines = []
	lines.push('# ClearAI Mechanism Truth Table', '')
	lines.push('> **This file is generated from `truth-table.json`; do not edit by hand.**')
	lines.push('> The source of record is `docs/optimization/truth-table.json`; edit it and run `node tools/build-truth-table.mjs`.')
	lines.push('> Cross-checking lives in `node tools/verify-truth-table.mjs`.', '')
	lines.push('This table answers one question: **what the current code actually guarantees**. It does not describe wishes — `Design only` and `Removed` mean exactly that.', '')
	lines.push('## Counts', '')
	lines.push(`- Mechanisms: **${table.mechanisms.length}**`)
	lines.push(`- By status: ${counts.status}`)
	lines.push(`- By strength: ${counts.hardness}`)
	lines.push(`- By destination: ${counts.destination}`)
	lines.push(`- Actually blocking execution: **${table.mechanisms.filter((m) => m.blocks_execution).length}**`)
	lines.push(`- Affected by autonomy: **${table.mechanisms.filter((m) => m.affected_by_autonomy).length}**`)
	lines.push(`- Carrying a known mismatch between docs/comments and code: **${table.mechanisms.filter((m) => m.known_mismatch !== null).length}**`, '')
	lines.push('## Code constant snapshot', '')
	lines.push('This section is exported from code, not written by hand:', '')
	lines.push(`- Mechanisms: ${snap.mechanisms.length} (${snap.mechanisms.join(' / ')})`)
	lines.push(`- Intent tools: ${snap.tools.length} (${snap.tools.join(' ')})`)
	lines.push(`- Config keys: ${snap.configKeys.length}`)
	lines.push(`- Prompt sections: ${snap.sectionsDefined} defined, ${snap.sectionsMounted} mounted at any moment (the ${Object.keys(snap.slots).join(' / ')} slot picks one of two)`, '')
	lines.push('## Summary', '')
	lines.push(...tableRows(table, EN, 'en'), '')
	lines.push('## Detail', '')
	lines.push(...detailSections(table, 'en'))
	lines.push('---', '')
	lines.push('Generated: this file and `truth-table.zh-CN.md` both come from `truth-table.json`; equivalent content, two languages.')
	return `${lines.join('\n')}\n`
}

const table = load()
writeFileSync(join(DOCS, 'truth-table.zh-CN.md'), renderZh(table), 'utf8')
writeFileSync(join(DOCS, 'truth-table.md'), renderEn(table), 'utf8')

const snap = codeSnapshot()
console.log(`【真值表】${table.mechanisms.length} 条机制 → truth-table.zh-CN.md / truth-table.md`)
console.log(`  代码快照: ${Object.keys(MECHANISM_TOOLS).length} 机制 / ${snap.tools.length} 工具 / ${snap.configKeys.length} 配置键 / ${snap.sectionsMounted} 段在场`)
console.log(`  状态分布: ${STATUS_ORDER.map((s) => `${s}=${table.mechanisms.filter((m) => m.status === s).length}`).join(' ')}`)
console.log('  下一步:node tools/verify-truth-table.mjs')
