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

const { SECTIONS } = await import('../preset/plugins/prompts.js')
const { MECHANISM_TOOLS } = await import('../preset/plugins/clearai-kernel.js')
const KERNEL = readFileSync(join(PORT, 'preset', 'plugins', 'clearai-kernel.js'), 'utf8')
const FOLD = readFileSync(join(PORT, 'ui', 'lib', 'fold.js'), 'utf8')

const VALID = new Set(['hard', 'native', 'advisory'])
const toolNames = Object.values(MECHANISM_TOOLS).flat()

console.log('\n【① 每段都有合法标签】')
{
	const untagged = SECTIONS.filter((section) => !VALID.has(section.class))
	check('23 段定义全部带 hard/native/advisory 标签', SECTIONS.length === 23 && untagged.length === 0, untagged.map((section) => section.name).join(','))
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
	const builder = SECTIONS.find((section) => section.name === 'clearai/builder-tools')
	const web = SECTIONS.find((section) => section.name === 'clearai/web-research')
	// 原生 edit 是字面替换;unified-diff 的写法是旧契约的残留,模型照做会当场失败。
	check('builder-tools 按字面替换讲 edit(不是 unified diff)', /old_string/.test(builder.text) && !/unified hunk|@@/.test(builder.text))
	// 原生 web_search/web_fetch 没有这些参数(核验过 dsh-tool-web 的 schema)。
	const stale = ['freshness', 'search_strategy', 'next_offset', 'view=links'].filter((word) => web.text.includes(word))
	check('web-research 不提不存在的原生参数(freshness/search_strategy/next_offset/view=links)', stale.length === 0, stale.join(','))
	// 侦察是**异步**的(内核的实现与注释都写明了为什么:阻塞等待会在跑动中断时丢掉「派过侦察」这条事实)。
	// 提示词若把它说成「同步、派出就等它回来」,模型就会去等一个不存在的返回值——长测里正是这么卡住的。
	const delegation = SECTIONS.find((section) => section.name === 'clearai/delegation')
	check(
		'delegation 按异步讲侦察(与内核契约一致,不说「同步」)',
		/派出去就不等/.test(delegation.text) && !/同步,派出就等它回来/.test(delegation.text),
		delegation.text.match(/SpawnScout[^|]*\|[^|]*/)?.[0]?.slice(0, 90) ?? '(没找到那一行)',
	)

	// 假设留痕的纪律:不强求证实/证伪,但「没看过」不能留白(结案时会被如实记进账里)。
	const loop = SECTIONS.find((section) => section.name === 'clearai/loop-contract')
	check(
		'loop-contract 写明「要么被证据碰到、要么留痕」(不逼 verdict,但不留白)',
		/没看过/.test(loop.text) && /unjudged/.test(loop.text),
		loop.text.match(/每条假设[^。]*。/)?.[0]?.slice(0, 90) ?? '(没找到那一条)',
	)

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
