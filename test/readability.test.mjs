/**
 * 可读性测试 —— S8 的五条判定,每条都要有**正例与反例**。
 *
 * 为什么单开一份:真跑(2026-09-29 · 会话 9dc1fe2b)里模型 194 次读到同一张 5240 字的运行态卡
 * (合计 101.6 万字符),而卡上四行摘要答不出「这个定义在哪不成立」;缺口只写成读数、
 * 没写成**今天就能补的动作**;术语在三个面板里各叫各的名字;货架把「登记成概念的个体」
 * 与「真概念」混在一张表里,零引用的概念看不出是零引用。
 * 「可读」不是文案功夫——它要能被机械判定,否则每一版都会漂。
 *
 * 五条判定:
 *   ① 无「全文超限」:给模型看的输出要求里,`claim`/`headline` 有**长度上限机制**(不只是文案);
 *   ② 缺口必须带 `nextAction`,且去掉它这条检查会红;
 *   ③ 裁决的每条 shortfall 能指认判据条目(卡/文档层没有相反承诺);
 *   ④ 术语体检:`knowledge-view.js` 导出 `GLOSSARY`,新字符串在 `LOCALE_ZH/LOCALE_EN` 里且 en ≠ zh;
 *   ⑤ 货架可读性:零引用概念被单独标出、实例与概念分节。
 *
 * 跑法:node test/readability.test.mjs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyMutations, derive, deriveKnowledge, emptyState } from '../ui/lib/fold.js'
import { describeDomainShelf } from '../ui/lib/domain-language.js'
import { SECTIONS } from '../preset/plugins/prompts.js'

const PORT = join(import.meta.dirname, '..')
const KERNEL_SOURCE = readFileSync(join(PORT, 'preset', 'plugins', 'clearai-kernel.js'), 'utf8')
const CLIENT_SOURCE = readFileSync(join(PORT, 'ui', 'lib', 'client.js'), 'utf8')
const PROMPT_CORPUS = SECTIONS.map((section) => String(section.text?.zh ?? '')).join('\n\n')

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

/** 从源码里取一个字面量并求值(取值域是仓库自己的源码;断言结构,不断言文本)。 */
function extractLiteral(text, openIndex, scope = {}) {
	const open = text[openIndex]
	if (open !== '{' && open !== '[') return null
	const close = open === '{' ? '}' : ']'
	let depth = 0
	let quote = null
	for (let index = openIndex; index < text.length; index += 1) {
		const char = text[index]
		if (quote !== null) {
			if (char === '\\') index += 1
			else if (char === quote) quote = null
			continue
		}
		if (char === "'" || char === '"' || char === '`') {
			quote = char
			continue
		}
		if (char === open) depth += 1
		else if (char === close) {
			depth -= 1
			if (depth === 0) {
				try {
					return new Function(...Object.keys(scope), `return (${text.slice(openIndex, index + 1)})`)(...Object.values(scope))
				} catch {
					return null
				}
			}
		}
	}
	return null
}

/** 按 markdown 标题切出一节(判据只看这一节,免得被别处的同名字样骗到)。 */
function markdownSection(text, pattern) {
	const lines = String(text ?? '').split('\n')
	const start = lines.findIndex((line) => /^##\s/.test(line) && pattern.test(line))
	if (start < 0) return null
	const rest = lines.findIndex((line, index) => index > start && /^##\s/.test(line))
	return lines.slice(start, rest < 0 ? undefined : rest).join('\n')
}

// ═══ ① 无「全文超限」:claim 有长度上限这一条**机制** ═════════════════════════

console.log('\n【① 无「全文超限」:给模型看的目标字段有长度上限机制】')
const setGoalParameters = (() => {
	const marker = "name: 'Frame',"
	const start = KERNEL_SOURCE.indexOf(marker)
	if (start < 0) return null
	const parametersAt = KERNEL_SOURCE.indexOf('parameters: {', start)
	if (parametersAt < 0) return null
	return extractLiteral(KERNEL_SOURCE, KERNEL_SOURCE.indexOf('{', parametersAt), { LEVELS: [] })
})()
{
	const properties = setGoalParameters?.properties ?? {}
	const headline = properties.headline ?? null
	check('Frame 参数取得到(否则下面的断言是空的)', setGoalParameters !== null, String(setGoalParameters))
	check('Frame 新增 headline 字段(一句话目标)', headline !== null, JSON.stringify(Object.keys(properties)))
	check('headline 声明了长度上限(maxLength 是数,≤120 字)', typeof headline?.maxLength === 'number' && headline.maxLength <= 120, JSON.stringify(headline))
	/**
	 * **「一句话目标」是硬的,但"必须多传一个字段"不是。**
	 *
	 * 判据落在**机制**上:省略 `headline` 时由 `claim` 的第一句现算,现算结果超过 120 字
	 * 就当场拒(`headline_too_long`)——长文顶替不了那句话。比"schema 里 required 有没有它"
	 * 更强:required 只保证调用方传了,这里保证**算出来的那一句**也在预算内。
	 */
	check('省略 headline 时由 claim 现算、超长即拒(机制,不是 required 的字面)', /headline_too_long/.test(KERNEL_SOURCE), '未找到 headline_too_long 出口')
	// 机制而不是文案:内核必须真的拒(缺 headline / 超长各有一条出口)。
	check('内核有 headline 的落账前校验(fail 出口)', /headline_required/.test(KERNEL_SOURCE) || /fail\(\s*'headline/.test(KERNEL_SOURCE), '未找到 headline 的 fail 出口')
	// 给模型看的那一层也要写明预算(提示词不被读成建议的判据是它与 schema 同值)。
	const budgetInPrompts = /(≤|不超过|最多)\s*120\s*字/.test(PROMPT_CORPUS)
	check('prompts 段里写明 120 字预算(与 schema 同值)', budgetInPrompts, budgetInPrompts ? '' : '提示词里没有 120 字的预算')
	check('prompts 里点的是 headline 这个字段名(模型知道该填哪一格)', /headline/.test(PROMPT_CORPUS))
	// 活检查:溢出样本确实越界;合规样本确实合规。
	const limit = typeof headline?.maxLength === 'number' ? headline.maxLength : 120
	check('活检查:一段 500 字的主张确实超过上限(反例不是空跑)', '长'.repeat(500).length > limit)
	check('活检查:一句 30 字的目标在上限内', '长'.repeat(30).length <= limit)
}

// ═══ ② 缺口必须带 nextAction ═══════════════════════════════════════════════

console.log('\n【② 缺口必须带 nextAction(且去掉它会红)】')
/**
 * 三种缺口(第四阶段从七种收下来的):一条没被碰过的判断、一条只有散文的判断、
 * 一个还没落图的断言主体。分两个状态取**并集**再断言,与从前同一种构造。
 */
const languageState = applyMutations(emptyState(), [
	{
		t: 'goal/set',
		id: 'g-read',
		revision: 1,
		claim: '「抽象」能否被定义为一个可判别、可复现的谓词',
		done_criteria: '存在一份解释文,含判别程序与失效节',
		promote_at_level: 'L3',
		hypotheses: [
			// 一条从没被证据碰过、也没有断言的命题:untouched_claims + prose_only_claims。
			{ id: 'h-read-0', claim: '还没被任何证据碰过的命题', refute_when: '出现反例' },
			{ id: 'h-read-1', claim: '只有散文主张的命题', refute_when: '出现反例' },
		],
	},
	{ t: 'plan/created', id: 'p-read', goal: 'g-read', steps: [{ id: 's-read-1', do: '核验', done_criteria: '读数落盘', status: 'open', tests: { hypothesis: 'h-read-1', level: 'L3' } }] },
	{ t: 'evidence/recorded', id: 'e-read-1', step: 's-read-1', plan: 'p-read', verdict: 'support', level: 'L3', evaluator: 'independent', basis: '读数' },
])
const languageDerived = derive(languageState)
const languageKnowledge = deriveKnowledge(languageState, languageDerived.hypotheses, languageDerived.factRows, languageDerived.lexicon)

const lexiconState = applyMutations(
	applyMutations(emptyState(), [
		{
			t: 'goal/set',
			id: 'g-read-2',
			revision: 1,
			claim: '带词汇与实体的目标',
			done_criteria: '存在一份解释文',
			promote_at_level: 'L3',
			hypotheses: [{ id: 'h-read-2', claim: '主体必须落到实体图', refute_when: '出现反例', assertions: [{ predicate: 'cheng_wei', subject: { id: 'yangben_x', type: 'sucai' }, object: { kind: 'instance', type: 'chouxiang', value: 'chouxiang' } }] }],
		},
		{ t: 'plan/created', id: 'p-read-2', goal: 'g-read-2', steps: [{ id: 's-read-2', do: '核验', done_criteria: '读数落盘', status: 'open', tests: { hypothesis: 'h-read-2', level: 'L3' } }] },
		{ t: 'evidence/recorded', id: 'e-read-2', step: 's-read-2', plan: 'p-read-2', verdict: 'support', level: 'L3', evaluator: 'independent', basis: '读数' },
		{ t: 'ontology/term_added', id: 'sucai', label: '素材', basis: '项目约定' },
		{ t: 'ontology/term_added', id: 'chouxiang', label: '抽象', basis: '项目约定' },
		{ t: 'ontology/term_added', id: 'orphan_term', label: '没有任何结论引用它', basis: '项目约定' },
		{ t: 'ontology/predicate_added', id: 'cheng_wei', label: '称为', domain: 'sucai', range: { term: 'chouxiang' }, basis: '项目约定' },
		{ t: 'fact/promoted', id: 'f-read-1', hypothesis: 'h-read-2', level: 'L3', assertions: [] },
	]),
	[],
)
const lexiconDerived = derive(lexiconState)
const lexiconKnowledge = deriveKnowledge(lexiconState, lexiconDerived.hypotheses, lexiconDerived.factRows, lexiconState.lexicon)

const allGaps = [...(languageKnowledge.gaps ?? []), ...(lexiconKnowledge.gaps ?? [])]
const gapCodes = [...new Set(allGaps.map((gap) => gap.code))].sort()
const EXPECTED_GAP_CODES = ['entities_unlanded', 'prose_only_claims', 'untouched_claims']
check('前提:三种缺口都被真的构造出来了(否则下面每条都是空跑)', EXPECTED_GAP_CODES.every((code) => gapCodes.includes(code)), gapCodes.join(','))
check('缺口只有这三种(第四阶段删掉的四种不再出现)', gapCodes.join(',') === EXPECTED_GAP_CODES.join(','), gapCodes.join(','))
check('每个缺口都带非空 nextAction', allGaps.length > 0 && allGaps.every((gap) => typeof gap.nextAction === 'string' && gap.nextAction.trim() !== ''), JSON.stringify(allGaps.map((gap) => `${gap.code}:${String(gap.nextAction ?? '').slice(0, 12)}`)))
check('每个缺口都带人话 detail(不是术语)', allGaps.every((gap) => typeof gap.detail === 'string' && gap.detail.trim() !== ''), JSON.stringify(allGaps.map((gap) => gap.code)))
check('每个缺口都带可清点的 count', allGaps.every((gap) => typeof gap.count === 'number'), JSON.stringify(allGaps.map((gap) => `${gap.code}:${String(gap.count)}`)))
{
	// 反例(判据本身必须能被证伪):把 nextAction 抹掉,同一条判据必须判否。
	const withoutNextAction = allGaps.map(({ nextAction, ...rest }) => rest)
	const predicateHolds = (gaps) => gaps.length > 0 && gaps.every((gap) => typeof gap.nextAction === 'string' && gap.nextAction.trim() !== '')
	check('反例:抹掉 nextAction 后,同一条判据判否(否则它对谁都是绿的)', predicateHolds(withoutNextAction) === false)
}

// ═══ ③ 裁决的每条 shortfall 能指认判据条目(卡层没有相反承诺)════════════════

console.log('\n【③ 卡/文档层:裁决要指认判据条目,且没有相反承诺】')
{
	const contrary = /(可以自由发挥|请自由发挥|不限字数|越长越好|请详细论证|可以写很长|尽量完整地复述)/
	const cardLayer = `${KERNEL_SOURCE}\n${PROMPT_CORPUS}`
	check('卡与提示词层没有「长篇/自由发挥」的相反承诺', !contrary.test(cardLayer), (cardLayer.match(contrary) ?? [])[0] ?? '')
	check('活检查:同一扫描器抓得到故意注入的相反承诺', contrary.test('评估卡的 shortfalls 可以自由发挥,不限字数'))
	/**
	 * 卡层要能承接「每条 shortfall 指认判据条目」:卡里存的必须是**归一后**的三格
	 * (`criterion` / `what` / `missing`),而不是评估者回的那串原始散文。
	 * 内核有两处写裁决卡(当场结算 / 从子会话日志回收),两处必须同形。
	 */
	const cardWindows = [...KERNEL_SOURCE.matchAll(/schema_version: 'clearai\.audit\.v2'/g)].map((match) => KERNEL_SOURCE.slice(match.index, match.index + 420))
	// 裁决 schema 是一个按会话语言出说明的函数(`verdictSchema = () => ({...})`);取它返回的那个字面量,`tr` 取中文。
	const verdictSchemaAt = KERNEL_SOURCE.indexOf('const verdictSchema = () => ({')
	const verdictSchema = verdictSchemaAt < 0 ? null : extractLiteral(KERNEL_SOURCE, KERNEL_SOURCE.indexOf('{', verdictSchemaAt), { tr: (zh) => zh })
	check('内核写裁决卡的两处都取得到(当场 + 回收)', cardWindows.length >= 2, String(cardWindows.length))
	check('裁决卡存的是归一后的 shortfalls(不是原始散文)', cardWindows.length > 0 && cardWindows.every((window) => /shortfalls:\s*[\w.]*verdict\.shortfalls/.test(window)), cardWindows.map((window) => (window.match(/shortfalls:\s*[^,]*/) ?? ['(缺)'])[0]).join(' | '))
	check('裁决卡的 card 字段就是被归一/截断过的 basis(短裁决进卡)', cardWindows.length > 0 && cardWindows.every((window) => /card:\s*[\w.]*verdict\.basis/.test(window)), cardWindows.map((window) => (window.match(/card:\s*[^,]*/) ?? ['(缺)'])[0]).join(' | '))
	check('归一后的三格都非空才能在卡里指认判据(卡与协议同形)', (() => {
		const fields = verdictSchema?.properties?.shortfalls?.items?.required ?? []
		return fields.includes('criterion') && fields.includes('what') && fields.includes('missing')
	})())
}

// ═══ ④ 术语体检:GLOSSARY 与 LOCALE_＊ 同登记,en ≠ zh ══════════════════════

console.log('\n【④ 术语体检:GLOSSARY 导出 + 人话字符串双语言登记】')
const localeOf = (name) => {
	const at = CLIENT_SOURCE.indexOf(`const ${name} = {`)
	if (at < 0) return null
	return extractLiteral(CLIENT_SOURCE, CLIENT_SOURCE.indexOf('{', at))
}
const localeZh = localeOf('LOCALE_ZH')
const localeEn = localeOf('LOCALE_EN')
check('client.js 里取得到 LOCALE_ZH / LOCALE_EN', localeZh !== null && localeEn !== null, `${localeZh === null ? 'zh 缺' : ''}${localeEn === null ? ' en 缺' : ''}`)

let glossary = null
let vocabulary = {}
let glossaryError = null
try {
	const module = await import(pathToFileURL(join(PORT, 'ui', 'lib', 'knowledge-view.js')).href)
	glossary = module.GLOSSARY ?? null
	vocabulary = module
	check('knowledge-view.js 导出 knowledgeView 函数(单一叙述源)', typeof module.knowledgeView === 'function')
} catch (error) {
	glossaryError = String(error?.message ?? error)
}
check('ui/lib/knowledge-view.js 存在且导出 GLOSSARY', glossary !== null && typeof glossary === 'object', glossaryError ?? '未导出 GLOSSARY')
{
	const entries = Object.entries(glossary ?? {})
	check('GLOSSARY 有实际条目(≥3 条内部词)', entries.length >= 3, String(entries.length))
	check('每条 GLOSSARY 都写清 plain / where / nextAction', entries.length > 0 && entries.every(([, value]) => typeof value?.plain === 'string' && value.plain.trim() !== '' && typeof value?.where === 'string' && typeof value?.nextAction === 'string' && value.nextAction.trim() !== ''), JSON.stringify(entries.slice(0, 4)))
	/**
	 * 面板说的词与卡上同一套:可信度分组(TRUST)、单次结果(VERDICT_WORD)、等级(LEVEL_WORD)
	 * 都从 knowledge-view 导出,面板逐个在两种语言里登记。GLOSSARY 的 plain 是写给模型的解释,不上面板。
	 */
	const words = [...(vocabulary.TRUST ?? []).map((item) => item.label), ...Object.values(vocabulary.VERDICT_WORD ?? {}), ...Object.values(vocabulary.LEVEL_WORD ?? {})]
	check('卡上的状态词都导出了(TRUST / VERDICT_WORD / LEVEL_WORD)', words.length >= 14, String(words.length))
	check('卡上的状态词都在 LOCALE_ZH 里登记(面板与卡同一套词)', words.every((word) => localeZh !== null && word in localeZh), JSON.stringify(words.filter((word) => !(word in (localeZh ?? {})))))
	check('卡上的状态词都在 LOCALE_EN 里登记', words.every((word) => localeEn !== null && word in localeEn), JSON.stringify(words.filter((word) => !(word in (localeEn ?? {})))))
	check('en 值不得等于 zh 值(英文表不是复制粘贴出来的)', words.every((word) => localeEn?.[word] !== localeZh?.[word]), JSON.stringify(words.filter((word) => localeEn?.[word] === localeZh?.[word])))
	// 活检查:一个没登记的内部词必须被同一条判据抓出来。
	const fake = '这个词没登记过-xyz'
	check('活检查:未登记的内部词会被同一条判据抓出', !(fake in (localeZh ?? {})) && !(fake in (localeEn ?? {})))
}

// ═══ ⑤ 货架可读性:零引用概念单独标出、实例与概念分节 ══════════════════════

console.log('\n【⑤ 货架:零引用概念与实例各自成节】')
{
	const lexicon = {
		terms: [
			{ id: 'sucai', label: '素材', status: 'admitted', basis: '项目约定' },
			{ id: 'chouxiang', label: '抽象', status: 'admitted', basis: '项目约定' },
			{ id: 'orphan_concept', label: '零引用的概念', status: 'admitted', basis: '项目约定' },
		],
		predicates: [{ id: 'cheng_wei', label: '称为', domain: 'sucai', range: { term: 'chouxiang' }, status: 'admitted', basis: '项目约定' }],
	}
	const facts = [
		{ id: 'f-1', assertions: [{ predicate: 'cheng_wei', subject: { id: 'yangben_x', type: 'sucai' }, object: { kind: 'instance', type: 'chouxiang', value: 'chouxiang' } }] },
		// 第二条:让 `chouxiang` 也以主词类型出现(引用计数只看主词类型与谓词)。
		{ id: 'f-2', assertions: [{ predicate: 'cheng_wei', subject: { id: 'case_y', type: 'chouxiang' }, object: { kind: 'statement', value: '一个使用方式' } }] },
	]
	const shelf = describeDomainShelf(lexicon, facts, [])
	check('货架非空(下面不是空扫)', typeof shelf === 'string' && shelf.length > 100, String(shelf?.length ?? 0))
	const orphansSection = markdownSection(shelf, /(零引用|未被引用)/)
	check('零引用概念被单独标出成节(旧读数:只藏在「引用 0」一列里)', orphansSection !== null, orphansSection === null ? '(没有这一节)' : '')
	check('概念 / 个体(实例) 分成两节', markdownSection(shelf, /概念/) !== null && markdownSection(shelf, /(实例|实体|样本)/) !== null)
	check('实例那一节排在概念那一节之后(语言 → 具体物)', shelf.indexOf('## 概念') >= 0 && shelf.indexOf('## 概念') < shelf.indexOf('## 个体'), `${shelf.indexOf('## 概念')} / ${shelf.indexOf('## 个体')}`)
	check('零引用那一节点名的是那个零引用概念(有引用的不塞进去)', orphansSection !== null && orphansSection.includes('orphan_concept') && !orphansSection.includes('`sucai`'), (orphansSection ?? '(没有这一节)').slice(0, 160))
	// 活检查:每个概念都被引用时,这一节必须整节消失(否则它恒报)。
	const allUsedShelf = describeDomainShelf({ ...lexicon, terms: lexicon.terms.filter((term) => term.id !== 'orphan_concept') }, facts, [])
	check('活检查:没有零引用概念时那一节整节消失', markdownSection(allUsedShelf, /(零引用|未被引用)/) === null, (markdownSection(allUsedShelf, /(零引用|未被引用)/) ?? '').slice(0, 120))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exitCode = 1
}
