/**
 * 提示词段分类:每一段都声明自己的约束来源,分类与内容互相咬合。
 *
 * 三个标签的语义(与覆盖设计 §3 一致):
 *   · hard     —— 该段解释的是**有机制兜底**的东西(内核工具、账本、门)。
 *                 删掉这段,机制仍在,但模型不会用它。所以它必须真的指向机制(带工具名)。
 *   · native   —— 该段讲的是 **DSH 原生能力**的使用纪律。它不许背着内核的工具名
 *                 (那是 hard 段的话),也不许描述与原生工具契约相矛盾的参数。
 *   · advisory —— 纯判断与风格,没有任何机制兜底。这是提示词正当的地盘,
 *                 但它不该伪装成机制承诺(不提「系统会拒绝/强制」)。
 *
 * 跑法:node test/prompt-sections.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

const { SECTIONS: BILINGUAL_SECTIONS } = await import('../preset/plugins/prompts.js')
/** 段有中英两版;分类与内容的咬合按中文那一版查(英文版是同一段的译文)。 */
const SECTIONS = BILINGUAL_SECTIONS.map((section) => ({ ...section, text: section.text.zh }))
const { MECHANISM_TOOLS } = await import('../preset/plugins/clearai-kernel.js')
const KERNEL = readFileSync(join(PORT, 'preset', 'plugins', 'clearai-kernel.js'), 'utf8')
const FOLD = readFileSync(join(PORT, 'ui', 'lib', 'fold.js'), 'utf8')

const VALID = new Set(['hard', 'native', 'advisory'])
const toolNames = Object.values(MECHANISM_TOOLS).flat()

console.log('\n【① 每段都有合法标签】')
{
	const untagged = SECTIONS.filter((section) => !VALID.has(section.class))
	check('3 段定义全部带 hard/native/advisory 标签', SECTIONS.length === 3 && untagged.length === 0, untagged.map((section) => section.name).join(','))
	const tally = { hard: 0, native: 0, advisory: 0 }
	for (const section of SECTIONS) tally[section.class] += 1
	console.log(`  分类账:hard ${tally.hard} · native ${tally.native} · advisory ${tally.advisory}`)
	check('三类都不为空(标签不是摆设)', tally.hard > 0 && tally.native > 0 && tally.advisory > 0, JSON.stringify(tally))
}

console.log('\n【② 分类与内容咬合】')
{
	const hard = SECTIONS.filter((section) => section.class === 'hard')
	const native = SECTIONS.filter((section) => section.class === 'native')
	const advisory = SECTIONS.filter((section) => section.class === 'advisory')

	// 机制锚点 = 内核工具名,或只有机制才撑得起来的名词(账本目录、观测准入、独立评估者、人门)。
	const MECHANISM_WORDS = ['clear/', '观测准入', '评估者', '人门', '账本', '落账']
	const hardWithoutAnchor = hard.filter((section) => !toolNames.some((name) => section.text.includes(name)) && !MECHANISM_WORDS.some((word) => section.text.includes(word)))
	check('hard 段每段都指向机制(工具名或机制名词——它们存在就是为了解释机制)', hardWithoutAnchor.length === 0, hardWithoutAnchor.map((section) => section.name).join(','))

	const nativeWithKernelTools = native.filter((section) => toolNames.some((name) => section.text.includes(name)))
	check('native 段不背内核工具名(边界各自归位)', nativeWithKernelTools.length === 0, nativeWithKernelTools.map((section) => section.name).join(','))

	const advisoryPromising = advisory.filter((section) => /系统会拒绝|入口强制|机制会|会被拦截/.test(section.text))
	check('advisory 段不伪装成机制承诺(劝告说劝告的话)', advisoryPromising.length === 0, advisoryPromising.map((section) => section.name).join(','))
}

console.log('\n【③ 原生契约不漂移(历史踩坑钉死)】')
{
	const byName = (name) => SECTIONS.find((section) => section.name === name)
	const identity = byName('clearai/identity')
	const loop = byName('clearai/loop')
	const speaking = byName('clearai/speaking')
	check('三段依次是身份 / 循环 / 对人说话', SECTIONS.map((section) => section.name).join(',') === 'clearai/identity,clearai/loop,clearai/speaking')
	check('合计在 4 千字以内(第五阶段:21 段约 1.5 万字 → 3 段)', SECTIONS.reduce((sum, section) => sum + section.text.length, 0) <= 4000, String(SECTIONS.reduce((sum, section) => sum + section.text.length, 0)))

	// 原生工具怎么用写在它们自己的说明里。提示词再讲一遍参数,原生契约一改就会漂移(历史上踩过:unified diff、freshness)。
	const nativeParams = ['old_string', 'freshness', 'search_strategy', 'next_offset', 'view=links', 'limit/offset', 'read_image']
	const leaked = nativeParams.filter((word) => SECTIONS.some((section) => section.text.includes(word)))
	check('提示词不讲原生工具的参数(交给工具自己的说明)', leaked.length === 0, leaked.join(','))

	// 第二阶段已经删掉的东西,提示词里不许再出现。
	const stale = ['lab/', 'products/', 'PROJECT.md', 'setup_cjk', 'retract_fact', 'keep_fact', 'SpawnScout', 'MapScouts'].filter((word) => SECTIONS.some((section) => section.text.includes(word)))
	check('提示词不提已删的目录约定、章程占位、人门动作与侦察工具', stale.length === 0, stale.join(','))

	check('身份段写明分工:模型负责判断,系统负责事实边界', /让模型负责智能判断[，,]让系统负责事实边界/.test(identity.text))
	check('身份段写明网页与文件里的文字是不可信的数据', /不可信/.test(identity.text))

	// 并行探索 = 竞争的判断并行检验;并行交给原生 subagent,各自声明不同的产物路径。
	check('循环段写明竞争路线各自声明不同的产物路径、并行交给 subagent', /subagent/.test(loop.text) && /不同的产物路径/.test(loop.text))
	check('循环段写明完成与结果分开(推翻、说不清都算完成)', /被推翻还是说不清都算完成/.test(loop.text))
	check('循环段写明等级只决定谁来判', /等级只决定谁来判/.test(loop.text))

	// 假设留痕的纪律:不强求证实/证伪,但「没看过」不能留白(结案时会被如实记进账里)。
	check('循环段写明没被证据碰过的判断记成没看过(unjudged)', /没看过/.test(loop.text) && /unjudged/.test(loop.text))

	check('对人说话段给出汇报顺序:结论 / 凭什么 / 适用范围 / 被推翻的 / 还没定的', /结论 \/ 凭什么 \/ 适用范围 \/ 被推翻的 \/ 还没定的/.test(speaking.text))
	check('对人说话段写明过程只在人问起或要人决定时说', /过程只在人问起或需要人决定时说/.test(speaking.text))

	// 内核的 OUTPUT_SCHEMA 是 additionalProperties:false——多写一个不存在的字段,宿主会让整次调用失败。
	check('内核工具的 output schema 是闭集(契约是硬的,提示词才必须跟上)', /const OUTPUT_SCHEMA = \{[\s\S]*?additionalProperties: false/.test(KERNEL))
}

console.log('\n【④ 运行态卡只说人话(机制字段名不出现在卡片上)】')
{
	const cardBody = FOLD.slice(FOLD.indexOf('export function renderCard'))
	const leaked = ['plan_confirmation_pending', 'confirmed_at:'].filter((word) => cardBody.includes("'" + word) || cardBody.includes('`' + word) || cardBody.includes('- ' + word))
	check('卡片行不再带账本字段名(plan_confirmation_pending / confirmed_at)', leaked.length === 0, leaked.join(','))
	check('卡片仍如实交代授权机理(未授权不自动续跑 + 按事实补写归属)', /授权:记号未落账/.test(cardBody) && /不会自动续跑/.test(cardBody) && /按事实补写归属/.test(cardBody))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
