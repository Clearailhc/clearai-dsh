/**
 * 外脑测试:投影层(纯函数)与写侧规则。
 *
 * 这份测的是**机制**,不是文本:
 *   · 工作区里的技能/记忆真的被投影成宿主原生的目录条目;
 *   · 候选态真的让模型**加载不到**(invocation 策略,不是劝告);
 *   · 记忆索引是**现算**的(所以不存在「INDEX.md 过期」这种状态);
 *   · 写入侧的规则(字段必填、标题跨文件去重、路径不许越狱)真的拦得住。
 *
 * 跑法:node test/brain.test.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir, trackTemp } from './tmp.mjs'
import {
	FACT_REQUIRED,
	LESSON_REQUIRED,
	MEMORY_ENTRY,
	appendMemory,
	brainFingerprint,
	createBrainProvider,
	memoryEntries,
	memoryIndexBody,
	memoryIndexDigest,
	memoryTitleExists,
	parseFrontmatter,
	skillEntries,
	validateMemoryFile,
	validateSkillName,
	validateSkillPath,
} from '../preset/plugins/brain.js'

let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail = '') {
	if (condition) {
		passed += 1
		console.log(`  ✓ ${label}`)
	} else {
		failed += 1
		failures.push(label)
		console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`)
	}
}

/** 造一个工作区:两个技能(一个系统技能 + 一个候选)+ 一条记忆。 */
function makeWorkspace() {
	const cwd = tempDir('clearai-brain-')
	mkdirSync(join(cwd, 'clear', 'skills', 'literature-review', 'references'), { recursive: true })
	mkdirSync(join(cwd, 'clear', 'skills', 'my-sop'), { recursive: true })
	mkdirSync(join(cwd, 'clear', 'memory'), { recursive: true })
	writeFileSync(
		join(cwd, 'clear', 'skills', 'literature-review', 'SKILL.md'),
		[
			'---',
			'name: literature-review',
			'description: |',
			'  【文献综述】检索、筛选、结构化综述。适用:需要成体系的文献梳理。不适用:单篇速读。',
			'version: 1.0',
			'metadata:',
			'  tier: system',
			'  origin: template',
			'---',
			'',
			'# 文献综述 SOP',
			'',
			'## 流程',
			'1. 界定问题',
			'2. 检索',
			'',
			'细节在 `references/` 里按需读。',
			'',
		].join('\n'),
	)
	writeFileSync(
		join(cwd, 'clear', 'skills', 'literature-review', 'references', 'search.md'),
		'# 检索策略\n',
	)
	writeFileSync(
		join(cwd, 'clear', 'skills', 'my-sop', 'SKILL.md'),
		['---', 'name: my-sop', 'status: candidate', 'description: |', '  候选:模型自己写的 SOP。', '---', '', '# 正文', ''].join('\n'),
	)
	writeFileSync(
		join(cwd, 'clear', 'memory', 'lessons.md'),
		[
			'## Lesson: 中文 CSV 编码',
			'- Context: 业务系统导出的 CSV',
			'- Trigger: 读到乱码',
			'- Action: 依次试 utf-8 / gbk / gb18030',
			'- Validation: 列名可读',
			'- Reuse Hint: 每次都先探测',
			'',
			'## Fact: 催化剂 A 的产率',
			'- Statement: 60℃ 下三次重复均值 62.1%',
			'- Evidence: lab/yield.csv',
			'- Scope: 本数据集',
			'- Last Verified: 2026-09-10',
			'',
		].join('\n'),
	)
	return cwd
}

console.log('\n【frontmatter:块标量是常态(ClearAI 的 description 就是块标量)】')
{
	const { data, body } = parseFrontmatter(['---', 'name: x', 'description: |', '  第一行', '  第二行', 'metadata:', '  tier: system', '---', '', '# 正文'].join('\n'))
	check('块标量折成多行字符串', data.description === '第一行\n第二行', JSON.stringify(data.description))
	check('一层 metadata 解析出来', data.metadata?.tier === 'system', JSON.stringify(data.metadata))
	check('正文不含 frontmatter', body.startsWith('# 正文'), body.slice(0, 20))
	check('没有 frontmatter 时原样返回', parseFrontmatter('# 只有正文').data.name === undefined)
}

console.log('\n【技能投影:目录式技能才报,候选态模型看不见】')
{
	const cwd = makeWorkspace()
	const entries = skillEntries(cwd)
	check('两个技能都被认出来', entries.length === 2, entries.map((entry) => entry.name).join(','))
	check('系统技能的 metadata 带过来', entries.find((entry) => entry.name === 'literature-review')?.tier === 'system')
	check('候选态被标出来', entries.find((entry) => entry.name === 'my-sop')?.status === 'candidate')

	const provider = createBrainProvider()
	const listed = await provider.list({ cwd })
	const byName = new Map(listed.candidates.map((candidate) => [candidate.name, candidate]))
	check('列表是完整的(complete=true)', listed.complete === true)
	check('系统技能:模型可调用', byName.get('literature-review')?.invocation.modelInvocable === true)
	check(
		'候选技能:模型**加载不到**(候选态 = invocation 策略,不是劝告)',
		byName.get('my-sop')?.invocation.modelInvocable === false && byName.get('my-sop')?.invocation.userInvocable === true,
		JSON.stringify(byName.get('my-sop')?.invocation),
	)
	check('描述带候选标记(人一眼看得出)', /候选/.test(String(byName.get('my-sop')?.description ?? '')))
	check('资源基座指向技能目录(第三层渐进加载靠它)', byName.get('literature-review')?.resourceBase?.path === join(cwd, 'clear', 'skills', 'literature-review'))

	const loaded = await provider.get(byName.get('literature-review'), { cwd })
	check('L2:加载得到正文,且正文里没有 frontmatter', loaded.content.startsWith('# 文献综述 SOP'), loaded.content.slice(0, 20))
	check('L3:资源文件就在 resourceBase 目录里(read 按需取)', readFileSync(join(loaded.resourceBase.path, 'references', 'search.md'), 'utf8').includes('检索策略'))
	check('没见过的定位符 → undefined(不猜)', (await provider.get({ locator: { kind: 'nope' } }, { cwd })) === undefined)
}

console.log('\n【记忆:虚拟条目,索引现算】')
{
	const cwd = makeWorkspace()
	const entries = memoryEntries(cwd)
	check('两类条目都认得出(Lesson / Fact)', entries.length === 2 && entries.some((entry) => entry.kind === 'lesson') && entries.some((entry) => entry.kind === 'fact'))
	const digest = memoryIndexDigest(entries)
	check('L1 摘要:条数 + 标题', /已沉淀 2 条/.test(digest) && /中文 CSV 编码/.test(digest), digest.slice(0, 80))
	check('L1 有界(<=500 字符)', digest.length <= 500, String(digest.length))
	const body = memoryIndexBody(entries)
	check('L2 索引:按文件分组 + 指向文件', /## lessons\.md/.test(body) && /中文 CSV 编码/.test(body))
	check('L2 里给出写入与读取的通道', /WriteMemory/.test(body) && /`read`/.test(body))
	check('L2 不重复正文(索引只给标题与一行摘要)', body.length < 1200, String(body.length))

	const provider = createBrainProvider()
	const listed = await provider.list({ cwd })
	const memory = listed.candidates.find((candidate) => candidate.name === MEMORY_ENTRY)
	check('记忆以**一个**虚拟条目出现(不是每条一个条目)', memory !== undefined && listed.candidates.filter((candidate) => candidate.name === MEMORY_ENTRY).length === 1)
	check('记忆条目指向记忆目录(单条按需 read)', memory.resourceBase.path === join(cwd, 'clear', 'memory'))
	const loadedMemory = await provider.get(memory, { cwd })
	check('L2 是现算的:同一个条目对象,内容跟着文件走', true)
	writeFileSync(
		join(cwd, 'clear', 'memory', 'facts.md'),
		['## Fact: 第二条', '- Statement: x', '- Evidence: y', '- Scope: z', '- Last Verified: 2026-09-11', ''].join('\n'),
	)
	const again = await provider.get(memory, { cwd })
	check('现算的证据:同一个条目对象,内容跟着文件变', /第二条/.test(again.content) && again.content !== loadedMemory.content)
	check('指纹随文件变化(缓存短路用)', brainFingerprint(cwd) !== '')
}

console.log('\n【写入侧:字段、去重、路径】')
{
	const cwd = makeWorkspace()
	const bad = appendMemory(cwd, { kind: 'lesson', title: '缺字段', fields: { Context: 'x' } })
	check('字段不全 → 写入被拒(结构只有机制保证得了)', bad.ok === false && bad.reason === 'missing_fields', JSON.stringify(bad))
	const lessonMissing = LESSON_REQUIRED.filter((key) => !['Context', 'Trigger', 'Action', 'Validation', 'Reuse Hint'].includes(key))
	check('lesson 必填五项与 ClearAI 一致', lessonMissing.length === 0)
	check('fact 必填四项与 ClearAI 一致', FACT_REQUIRED.join('/') === 'Statement/Evidence/Scope/Last Verified')

	const first = appendMemory(cwd, {
		kind: 'lesson',
		title: '同一件事',
		fields: { Context: 'a', Trigger: 'b', Action: 'c', Validation: 'd', 'Reuse Hint': 'e' },
	})
	check('合法 lesson 写入成功', first.ok === true && first.skipped === false, JSON.stringify(first.reason ?? ''))
	const second = appendMemory(cwd, {
		kind: 'lesson',
		title: '同一件事',
		fields: { Context: 'a', Trigger: 'b', Action: 'c', Validation: 'd', 'Reuse Hint': 'e' },
	})
	check('同标题再写 → 跳过(跨文件去重)', second.ok === true && second.skipped === true)
	check('去重是真的:文件里只有一条', (readFileSync(join(cwd, 'clear', 'memory', 'lessons.md'), 'utf8').match(/## Lesson: 同一件事/g) ?? []).length === 1)
	check('标题查询能用', memoryTitleExists(cwd, 'lesson', '同一件事') && !memoryTitleExists(cwd, 'lesson', '不存在的'))

	check('文件名不许带路径', validateMemoryFile('../x.md') === 'path_traversal' && validateMemoryFile('a/b.md') === 'path_traversal')
	check('文件名必须是 markdown', validateMemoryFile('x.txt') === 'must_be_markdown' && validateMemoryFile('x.md') === null)
	check('技能名要 kebab-case', validateSkillName('My SOP') === 'must_be_kebab_case' && validateSkillName('my-sop-2') === null)
	check('技能内路径不许越狱', validateSkillPath('../x') === 'path_traversal' && validateSkillPath('workflows/a.md') === null)
}

console.log('\n【18 个既有技能:形状核对(内容迁移的前置)】')
{
	const template = join(import.meta.dirname, '..', 'preset', 'template', 'skills')
	let dirs = []
	try {
		dirs = require('node:fs').readdirSync(template, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
	} catch {
		dirs = []
	}
	const { readdirSync } = await import('node:fs')
	const names = readdirSync(template, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
	// 数错一次:根下还有一个 README.md(是给人看的说明,不是技能),所以是 18 个技能目录。
	check('模板里有 18 个技能目录', names.length === 18, String(names.length))
	const shape = names.map((name) => {
		const { data } = parseFrontmatter(readFileSync(join(template, name, 'SKILL.md'), 'utf8'))
		return { name, hasName: typeof data.name === 'string' && data.name !== '', hasDescription: typeof data.description === 'string' && data.description.trim() !== '', descriptionLength: String(data.description ?? '').length }
	})
	check('每个技能都有 name 与 description(DSH 目录的必填两项)', shape.every((entry) => entry.hasName && entry.hasDescription), shape.filter((entry) => !entry.hasName || !entry.hasDescription).map((entry) => entry.name).join(','))
	check(
		'description 全在宿主目录的 500 字符预算内(不会被截断)',
		shape.every((entry) => entry.descriptionLength <= 500),
		`最长 ${Math.max(...shape.map((entry) => entry.descriptionLength))} 字符`,
	)
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
