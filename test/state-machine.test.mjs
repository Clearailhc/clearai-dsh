/**
 * 状态机文档的交叉校验:**图里画的每一条边,折法必须真认识;折法认识的类型,图里必须有交代**。
 *
 * 这一份测试的意义与 ontology 那份同源——`docs/optimization/state-machines.zh-CN.md` 是给人读的,
 * 而人读的图最容易悄悄长出「其实没有这条边」。所以把图里出现的 event 名抓出来,拿去问 `fold.js`:
 *   ① 图里每个 `xxx/yyy` 形式的 event,必须能在 `applyMutation` 的 case 里找到,
 *      或者属于 `LEDGER_ONLY_MUTATIONS`(只留台账、不折视图的那几类);
 *   ② 折法里每一个 case,必须在文档里出现过——多一个少一个都红,免得图慢慢变成残图;
 *   ③ 中英两份文档的 event 集合必须一致(不然一份在讲旧语义);
 *   ④ 序位与棘轮这类**不变量**必须在文档里写明(它们是「不可表示」那条哲学的落点)。
 *
 * 跑法:node test/state-machine.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const read = (rel) => readFileSync(join(PORT, rel), 'utf8')

const foldSource = read('ui/lib/fold.js')
const zh = read('docs/optimization/state-machines.zh-CN.md')
const en = read('docs/optimization/state-machines.md')
const timingZh = read('docs/optimization/timing-diagrams.zh-CN.md')
const timingEn = read('docs/optimization/timing-diagrams.md')

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

/** 折法真认识的变更类型(词汇表)。 */
const foldKinds = new Set([...foldSource.matchAll(/case '([a-z]+\/[a-z_]+)':/g)].map((match) => match[1]))
/** 只留台账、不折进视图的那几类:它们同样是合法词汇。 */
const ledgerOnly = new Set([...foldSource.matchAll(/LEDGER_ONLY_MUTATIONS = \[([^\]]+)\]/g)].flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])))
const vocabulary = new Set([...foldKinds, ...ledgerOnly])
/**
 * 文档里的「event 名」= 首段是折法真用过的命名空间的 `xxx/yyy`。
 * 为什么要这一层过滤:文档里还有 `ui/lib`、`clear/knowledge`、`docs/verification` 这类**路径**,
 * 它们的形状与 event 名一样。只按形状抓会把路径误判成事件,于是这条检查要么天天红、
 * 要么被人用豁免名单糊过去——两种结局都等于没有这条检查。
 */
const NAMESPACES = new Set([...vocabulary].map((kind) => kind.split('/')[0]))
const docKinds = (text) =>
	new Set([...text.matchAll(/\b([a-z]+\/[a-z_]+)\b/g)].map((match) => match[1]).filter((kind) => NAMESPACES.has(kind.split('/')[0])))

console.log('\n【词汇表:折法认识哪些变更】')
{
	check('折法词汇表读得到(不是空集)', foldKinds.size > 20, `${foldKinds.size} 个`)
	check('台账专用清单读得到', ledgerOnly.size > 0, [...ledgerOnly].join(' '))
}

console.log('\n【① 图里的每条边,折法必须认识】')
{
	const inDoc = docKinds(zh)
	const unknown = [...inDoc].filter((kind) => !vocabulary.has(kind))
	check('状态机文档里出现的 event 都在折法词汇表里', unknown.length === 0, unknown.join(' '))
	check('文档确实引用了 event(不是纯散文)', inDoc.size >= 20, `${inDoc.size} 个`)
}

console.log('\n【② 折法认识的类型,文档必须交代】')
{
	const inDoc = docKinds(zh)
	/**
	 * 折法认识的每一个变更类型,文档都必须交代——**豁免的那一组由代码算出来**,
	 * 不是手写的名字:它就是 `LEDGER_ONLY_MUTATIONS`(内核内部记账,不进状态机图是对的)。
	 *
	 * 为什么要这样:手写豁免名单是这条检查自己的假话。名单上曾经多出两个
	 * **没有任何生产者**的类型,于是「折法认识的东西文档必须交代」对它们静默失效。
	 */
	const missing = [...vocabulary].filter((kind) => !inDoc.has(kind) && !ledgerOnly.has(kind))
	check('折法认识的变更类型都在状态机文档里(或属于台账那一组)', missing.length === 0, missing.join(' '))
	// 反向:文档里标成「只留台账」的那些行,必须与代码里的 `LEDGER_ONLY_MUTATIONS` 逐字一致。
	const docLedgerOnly = new Set([...zh.matchAll(/^\|\s*`([a-z]+\/[a-z_]+)`\s*\|\s*\*\*只留台账\*\*\s*\|/gm)].map((match) => match[1]))
	check(
		'文档里的「只留台账」行与 LEDGER_ONLY_MUTATIONS 逐字一致',
		docLedgerOnly.size === ledgerOnly.size && [...ledgerOnly].every((kind) => docLedgerOnly.has(kind)),
		`文档:${[...docLedgerOnly].join(' ')} · 代码:${[...ledgerOnly].join(' ')}`,
	)
}

console.log('\n【③ 中英两份文档的 event 集合一致】')
{
	const a = docKinds(zh)
	const b = docKinds(en)
	const onlyZh = [...a].filter((kind) => !b.has(kind))
	const onlyEn = [...b].filter((kind) => !a.has(kind))
	check('中文版没有英文版缺失的 event', onlyZh.length === 0, onlyZh.join(' '))
	check('英文版没有中文版缺失的 event', onlyEn.length === 0, onlyEn.join(' '))
}

console.log('\n【④ 不变量必须写在文档里,而不只在代码里】')
{
	check('秩(RANK)与「降级不可表示」写明', zh.includes('降级不可表示') && zh.includes('RANK'))
	check('世界线分支秩 BRANCH_RANK 写明', zh.includes('BRANCH_RANK'))
	check('序位不变量 out_of_order 写明', zh.includes('out_of_order'))
	check('授权不是硬阻断这件事写明', zh.includes('授权不是硬阻断') && zh.includes("by='progress'"))
	check('turnDemand 的判定顺序写明且不含 autonomy', zh.includes('turnDemand') && /这条链里没有 autonomy/.test(zh))
	check('默认续跑额度 128 写明', zh.includes('DEFAULT_MAX_AUTO_TURNS = 128'))
	check('「不是落选」的三种派生状态写明', zh.includes('failed') && zh.includes('orphaned') && zh.includes('unreturned'))
	check('retracted 的生产者写明(人的 fact/reviewed,不再声称没有生产者)', zh.includes('fact/reviewed') && !/retracted[^\n]{0,60}没有(任何)?生产者/.test(zh))
}

console.log('\n【⑤ 时序图:四条主路径与关键边界】')
{
	for (const [name, text] of [['中文', timingZh], ['英文', timingEn]]) {
		check(`${name}时序图含轻量探索路径`, /轻量探索路径|Light exploration path/.test(text))
		check(`${name}时序图含正式认识论路径`, /正式认识论路径|Formal epistemic path/.test(text))
		check(`${name}时序图含失败恢复路径`, /失败与恢复路径|Failure and recovery path/.test(text))
		check(`${name}时序图含世界线路径`, /世界线路径|Worldline path/.test(text))
		check(`${name}时序图写明准入不裁决`, /准入不裁决|Admission does not judge/.test(text))
		check(`${name}时序图写明 L3+ 拒绝自判 verdict`, /verdict_not_accepted/.test(text))
		check(`${name}时序图写明算术排序与人工采纳分离`, /算术只负责\*\*排序\*\*|Arithmetic only \*\*ranks\*\*/.test(text))
	}
}

console.log('\n【⑤b 时序图:固定角色表,不许退回模糊角色】')
{
	// 这次重写的动机:读者分不清「内核」「Agent」「投影」各是什么。
	// 纪律:八位角色在图例里定义一次,每张图只用这套名字;「Agent」作为参与者被拆成
	// 「模型」(发出意图)与「DSH 宿主」(执行回合),不许作为 mermaid 参与者回归。
	for (const [name, text] of [['中文', timingZh], ['英文', timingEn]]) {
		check(`${name}时序图有固定角色表`, /固定角色表|fixed cast/i.test(text))
		check(
			`${name}角色表覆盖八个角色`,
			[/人|Human/, /模型|Model/, /DSH 宿主|DSH host/, /ClearAI 内核|ClearAI kernel/, /事实账本|Fact ledger/, /投影|Projection/, /独立评估者|Independent evaluator/, /世界线执行者|Worldline executor/].every((pattern) =>
				pattern.test(text),
			),
		)
		check(`${name}没有 Agent 作为 mermaid 参与者(它已被拆成模型+宿主)`, !/participant\s+\w+\s+as\s+Agent/.test(text))
		check(`${name}事实账本写明「内容是我们的,载体是宿主的」`, /内容是我们的|content is ours/.test(text))
		check(`${name}保留了旧名词对照(老读者找得回来)`, /旧名词对照|Old-name mapping/.test(text))
	}
}

console.log('\n【⑥ 状态机文档与真值表互相指认】')
{
	const table = JSON.parse(read('docs/optimization/truth-table.json'))
	check('状态机文档指向真值表', zh.includes('truth-table.zh-CN.md'))
	check('真值表指向状态机文档或计划', table.mechanisms.every((m) => m.source !== undefined))
	check('计划里登记了这两份文档', read('docs/optimization/plan.zh-CN.md').includes('state-machines.zh-CN.md'))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
