/**
 * 领域语言层的测试:**值形态 / 词条 / 断言 / 冲突 / 图投影**的判据只有一份,
 * 这一份测试就是它的机械面。
 *
 * 为什么要有它(而不是靠内核测试顺带覆盖):
 *   · 校验函数被三处消费(落账前的工具与路由、折法、只读读面),**漂了最难发现**——
 *     「登记时放行、升格时拒绝」在界面上与「这条还没验」长得一模一样;
 *   · 图与冲突是**派生读数**,没有存储可比对,只能钉住「同一份账本 ⇒ 同一张图」;
 *   · 旧账本(没有本体事件、没有断言)必须折得出与从前一样的事实——这一条最容易在
 *     加字段时被悄悄破坏,破坏之后没有任何界面会报错。
 *
 * 跑法:node test/domain-language.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')

const {
	VALUE_FORMS,
	OBJECT_KINDS,
	LEXICON_KINDS,
	emptyLexicon,
	applyLexiconMutation,
	findEntry,
	termChain,
	validateTerm,
	validatePredicate,
	validateAssertion,
	validateAssertions,
	objectKey,
	subjectKey,
	deriveConflicts,
	lexiconHealth,
	graphProjection,
	describeDomainShelf,
	formatAssertion,
	formatObject,
} = await import(join(PORT, 'ui', 'lib', 'domain-language.js'))
const { knowledgeView, GLOSSARY } = await import(join(PORT, 'ui', 'lib', 'knowledge-view.js'))
const fold = await import(join(PORT, 'ui', 'lib', 'fold.js'))
const foldSource = readFileSync(join(PORT, 'ui', 'lib', 'fold.js'), 'utf8')
const suiteSource = readFileSync(join(PORT, 'test', 'run.sh'), 'utf8')

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

/** 一份最小的词汇:两个概念(一条 is_a)、一个单值量谓词、一个关系谓词。 */
function seeded() {
	let lexicon = emptyLexicon()
	lexicon = applyLexiconMutation(lexicon, { t: 'ontology/term_added', id: 'numerical_scheme', label: '数值格式', gloss: '数值方法的类别', basis: 'b' }, 1)
	lexicon = applyLexiconMutation(lexicon, { t: 'ontology/term_added', id: 'weno_scheme', label: 'WENO格式', gloss: '一类重构格式', parent: 'numerical_scheme', basis: 'b' }, 2)
	lexicon = applyLexiconMutation(lexicon, { t: 'ontology/term_added', id: 'test_case', label: '测试算例', gloss: '一次具体计算', basis: 'b' }, 3)
	lexicon = applyLexiconMutation(lexicon, { t: 'ontology/predicate_added', id: 'convergence_order', label: '收敛阶', domain: 'numerical_scheme', range: { form: 'quantity', unit: 'order' }, functional: true, basis: 'b' }, 4)
	lexicon = applyLexiconMutation(lexicon, { t: 'ontology/predicate_added', id: 'tested_by', label: '被算例检验', domain: 'numerical_scheme', range: { term: 'test_case' }, basis: 'b' }, 5)
	return lexicon
}

const quantity = (value, unit = 'order') => ({ kind: 'quantity', value, unit })

console.log('\n【形状:值形态与对象形态是固定的枚举,不是自由字符串】')
{
	check('值形态就是五种(statement/quantity/formula/code/reference)', VALUE_FORMS.length === 5 && VALUE_FORMS.every((form) => typeof form === 'string'), VALUE_FORMS.join(','))
	check('对象形态 = 值形态 + 关系宾语 instance', OBJECT_KINDS.length === 6 && OBJECT_KINDS.includes('instance'))
	check('宾语的可比形状把单位算进去(5 order 与 5 pct 不是同一个值)', objectKey(quantity(5, 'order')) !== objectKey(quantity(5, 'pct')))
	check('宾语人话把单位写出来', formatObject(quantity(5, 'order')) === '5 order')
	check('主体的可比形状带类型(同名不同类不是同一主体)', subjectKey({ subject: { id: 'x', type: 'a' } }) !== subjectKey({ subject: { id: 'x', type: 'b' } }))
}

console.log('\n【增:带依据的注册——少一样就拒】')
{
	const lexicon = emptyLexicon()
	check('空词汇可注册', validateTerm(lexicon, { id: 'good_term', label: 'L', gloss: 'G', basis: 'B' }).length === 0)
	check('id 形状不对要拒', validateTerm(lexicon, { id: 'Bad-Id', label: 'L', gloss: 'G', basis: 'B' }).some((item) => item.startsWith('id_shape')))
	check('释义缺失要拒(不然引用它的人各读各的)', validateTerm(lexicon, { id: 'good_term', label: 'L', gloss: '', basis: 'B' }).some((item) => item.startsWith('gloss_required')))
	check('依据缺失要拒(约定可以自愿,不能无来由)', validateTerm(lexicon, { id: 'good_term', label: 'L', gloss: 'G', basis: '' }).some((item) => item.startsWith('basis_required')))
	const seededLexicon = seeded()
	check('id 已被占用要拒(概念与谓词共用一个命名空间)', validateTerm(seededLexicon, { id: 'convergence_order', label: 'L', gloss: 'G', basis: 'B' }).some((item) => item.startsWith('id_taken')))
	check('父概念不存在要拒', validateTerm(seededLexicon, { id: 'new_term', label: 'L', gloss: 'G', basis: 'B', parent: 'nope' }).some((item) => item.startsWith('parent_unknown')))
	check('父概念是谓词要拒(is_a 只能连概念)', validateTerm(seededLexicon, { id: 'new_term', label: 'L', gloss: 'G', basis: 'B', parent: 'convergence_order' }).some((item) => item.startsWith('parent_not_term')))
	check('谓词必须登记值域', validatePredicate(seededLexicon, { id: 'new_pred', label: 'L', basis: 'B' }).some((item) => item.startsWith('range_required')))
	check('值域二选一:同时给 term 与 form 要拒', validatePredicate(seededLexicon, { id: 'new_pred', label: 'L', basis: 'B', range: { term: 'test_case', form: 'quantity' } }).some((item) => item.startsWith('range_ambiguous')))
	check('值形态不认识要拒', validatePredicate(seededLexicon, { id: 'new_pred', label: 'L', basis: 'B', range: { form: 'table' } }).some((item) => item.startsWith('range_form_unknown')))
	check('主词域不存在要拒', validatePredicate(seededLexicon, { id: 'new_pred', label: 'L', basis: 'B', domain: 'nope', range: { form: 'statement' } }).some((item) => item.startsWith('domain_unknown')))
	check('functional 非布尔要拒', validatePredicate(seededLexicon, { id: 'new_pred', label: 'L', basis: 'B', range: { form: 'statement' }, functional: 'yes' }).some((item) => item.startsWith('functional_shape')))
}

console.log('\n【改:语义变化不许走修订】')
{
	const lexicon = seeded()
	const revised = applyLexiconMutation(lexicon, { t: 'ontology/predicate_revised', id: 'convergence_order', gloss: '新释义', range: { form: 'statement' }, reason: '想改值域' }, 9)
	const entry = revised.predicates.find((item) => item.id === 'convergence_order')
	check('修订只改展示信息:值域原地不动(改语义要换 id)', entry.range.form === 'quantity')
	check('修订 +1 版本并留旧值', entry.version === 2 && entry.revisions.length === 1 && entry.revisions[0].gloss !== '新释义')
	const termRevised = applyLexiconMutation(lexicon, { t: 'ontology/term_revised', id: 'weno_scheme', gloss: '新释义', parent: 'test_case', reason: 'r' }, 9)
	check('概念的父链不因修订而改(层级是语义)', termRevised.terms.find((item) => item.id === 'weno_scheme').parent === 'numerical_scheme')
}

console.log('\n【删:没有删除,只有黏性废止】')
{
	const lexicon = seeded()
	const deprecated = applyLexiconMutation(lexicon, { t: 'ontology/term_deprecated', id: 'weno_scheme', reason: '合并进数值格式' }, 9)
	const entry = deprecated.terms.find((item) => item.id === 'weno_scheme')
	check('废止保留条目本身(记录不删)', entry !== undefined && entry.status === 'deprecated' && entry.deprecated.reason === '合并进数值格式')
	const twice = applyLexiconMutation(deprecated, { t: 'ontology/term_deprecated', id: 'weno_scheme', reason: '改主意了' }, 10)
	check('废止是黏性终态:第二次不覆盖第一次(没有复活这条路)', twice.terms.find((item) => item.id === 'weno_scheme').deprecated.reason === '合并进数值格式')
	const afterRevise = applyLexiconMutation(deprecated, { t: 'ontology/term_revised', id: 'weno_scheme', gloss: 'x', reason: 'r' }, 11)
	check('废止的条目不接受修订', afterRevise.terms.find((item) => item.id === 'weno_scheme').gloss !== 'x')
	check('不认识的事件名不改变词汇', applyLexiconMutation(lexicon, { t: 'ontology/something-else', id: 'weno_scheme' }, 12).terms.length === lexicon.terms.length)
	check('事件名带不带命名空间都认(折法给的是带前缀的那一种)', applyLexiconMutation(lexicon, { t: 'term_added', id: 'bare_term', label: 'L', gloss: 'G', basis: 'B' }, 13).terms.some((item) => item.id === 'bare_term'))
	/**
	 * 多词事件名用下划线,不是连字符——这不是风格偏好:仓库里两套交叉校验用 `[a-z_]+`
	 * 抓事件名,连字符会让新事件在**声明侧与文档侧同时**抓不到,于是「声明了却没人查」
	 * 静默成立(这套词汇第一次落地时正是这么差点漏过去的)。
	 */
	check('事件名与全仓词汇表同一条命名(下划线,不是连字符)', !/case 'ontology\/[a-z]+-/.test(foldSource))
}

console.log('\n【断言:宽松+校验——不提供放行,提供即严校】')
{
	const lexicon = seeded()
	/**
	 * 五种值形态各注册一个谓词,逐个验过——形态校验是「提供即严校」的主干,
	 * 只覆盖其中两种会让另外三种的判据常年没人跑。
	 */
	let forms = lexicon
	for (const [index, form] of VALUE_FORMS.entries()) forms = applyLexiconMutation(forms, { t: 'ontology/predicate_added', id: `has_${form}`, label: form, domain: 'numerical_scheme', range: { form }, basis: 'b' }, 20 + index)
	const subject = { id: 'WENO5', type: 'numerical_scheme' }
	const withForm = (form, object) => validateAssertions(forms, [{ predicate: `has_${form}`, subject, object }])
	check('不提供断言 = 没有意见(旧账本照旧升格)', validateAssertions(lexicon, null).length === 0 && validateAssertions(lexicon, undefined).length === 0)
	check('合法量断言通过', validateAssertions(lexicon, [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }]).length === 0)
	check('合法关系断言通过(宾语是另一个概念的实例)', validateAssertions(lexicon, [{ predicate: 'tested_by', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: { kind: 'instance', value: 'smooth-case' } }]).length === 0)
	check('statement 形态通过(非空即可)', withForm('statement', { kind: 'statement', value: '光滑区达到设计阶' }).length === 0)
	check('formula 形态通过(存的是 LaTeX 源码)', withForm('formula', { kind: 'formula', value: '\\lVert u-u_h\\rVert = C h^5' }).length === 0)
	check('code 形态通过(工作区里的相对路径)', withForm('code', { kind: 'code', value: 'lab/check_order.py' }).length === 0)
	check('reference 形态通过', withForm('reference', { kind: 'reference', value: 'f-123' }).length === 0)
	check('未登记的谓词要拒', validateAssertions(lexicon, [{ predicate: 'nope', subject: { id: 'x' }, object: { kind: 'statement', value: 'v' } }]).some((item) => item.includes('predicate_unknown')))
	check('把概念当谓词用要拒', validateAssertions(lexicon, [{ predicate: 'weno_scheme', subject: { id: 'x' }, object: { kind: 'statement', value: 'v' } }]).some((item) => item.includes('predicate_not_predicate')))
	check('主体类型不合主词域要拒', validateAssertions(lexicon, [{ predicate: 'convergence_order', subject: { id: 'x', type: 'test_case' }, object: quantity(5) }]).some((item) => item.includes('subject_type_mismatch')))
	check('声明了主词域却漏写主体类型要拒', validateAssertions(lexicon, [{ predicate: 'convergence_order', subject: { id: 'x' }, object: quantity(5) }]).some((item) => item.includes('subject_type_required')))
	check('主体类型没登记要拒', validateAssertions(lexicon, [{ predicate: 'convergence_order', subject: { id: 'x', type: 'ghost_type' }, object: quantity(5) }]).some((item) => item.includes('subject_type_unknown')))
	check('宾语形态与值域不符要拒', validateAssertions(lexicon, [{ predicate: 'convergence_order', subject: { id: 'x', type: 'numerical_scheme' }, object: { kind: 'statement', value: 'v' } }]).some((item) => item.includes('object_form_mismatch')))
	check('量缺单位要拒(没有单位的数不是量)', validateAssertions(lexicon, [{ predicate: 'convergence_order', subject: { id: 'x', type: 'numerical_scheme' }, object: { kind: 'quantity', value: 5 } }]).some((item) => item.includes('object_unit_required')))
	check('量不是数值要拒', validateAssertions(lexicon, [{ predicate: 'convergence_order', subject: { id: 'x', type: 'numerical_scheme' }, object: { kind: 'quantity', value: '五', unit: 'order' } }]).some((item) => item.includes('object_quantity_shape')))
	check('code 形态不许用绝对路径(换工作区就没了)', withForm('code', { kind: 'code', value: '/tmp/check.py' }).some((item) => item.includes('object_code_absolute')))
	check('code 形态不许越出工作区', withForm('code', { kind: 'code', value: '../escape.py' }).some((item) => item.includes('object_code_escape')))
	check('statement 超过上限要拒(长文该进证据,不该进断言)', withForm('statement', { kind: 'statement', value: 'x'.repeat(2001) }).some((item) => item.includes('object_value_too_long')))
	check('关系谓词的宾语给成字面值要拒', validateAssertions(lexicon, [{ predicate: 'tested_by', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: { kind: 'statement', value: 'v' } }]).some((item) => item.includes('object_form_mismatch')))
	check('同一事实里同一主体同一谓词两个值 = 自相矛盾,当场拒', validateAssertions(lexicon, [
		{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) },
		{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(2) },
	]).some((item) => item.includes('assertion_self_conflict')))
	check('断言不是数组要拒', validateAssertions(lexicon, { predicate: 'x' }).some((item) => item.includes('assertions_shape')))
}

console.log('\n【冲突:派生读数,不是裁决】')
{
	const lexicon = seeded()
	const fact = (id, value, extra = {}) => ({ id, text: `claim ${id}`, level: 'L3', review: null, assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(value) }], ...extra })
	const two = deriveConflicts([fact('f1', 5), fact('f2', 2)], lexicon)
	check('单值谓词上两个不同值 = 一对冲突', two.length === 1 && two[0].sides.length === 2, JSON.stringify(two))
	check('冲突两侧各给一条代表事实(面板要成对打开)', two[0].sides.every((side) => typeof side.fact === 'string'))
	check('同一个值不构成冲突', deriveConflicts([fact('f1', 5), fact('f2', 5)], lexicon).length === 0)
	check('撤回一侧,冲突消失(撤回是人的动作,冲突只是读数)', deriveConflicts([fact('f1', 5, { review: { decision: 'retracted' } }), fact('f2', 2)], lexicon).length === 0)
	check('不同主体不构成冲突', deriveConflicts([fact('f1', 5), { ...fact('f2', 2), assertions: [{ predicate: 'convergence_order', subject: { id: 'OTHER', type: 'numerical_scheme' }, object: quantity(2) }] }], lexicon).length === 0)
	const nonFunctional = applyLexiconMutation(lexicon, { t: 'ontology/predicate_added', id: 'note', label: '备注', domain: 'numerical_scheme', range: { form: 'statement' }, basis: 'b' }, 6)
	const note = (id, value) => ({ id, text: id, level: 'L3', review: null, assertions: [{ predicate: 'note', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: { kind: 'statement', value } }] })
	check('非单值谓词上多值不算冲突(它不是约束)', deriveConflicts([note('f1', 'a'), note('f2', 'b')], nonFunctional).length === 0)
	check('没有断言的事实不参与(旧账本零影响)', deriveConflicts([{ id: 'f1', text: 'x', review: null }, fact('f2', 5)], lexicon).length === 0)
	check('结果排序确定(同一份输入两次调用逐字节相同)', JSON.stringify(deriveConflicts([fact('f1', 5), fact('f2', 2)], lexicon)) === JSON.stringify(two))
}

console.log('\n【健康度:悬空 / 成环 / 没人用 / 已废止仍在用】')
{
	const lexicon = seeded()
	check('父链成环读得出来', termChain(applyLexiconMutation(applyLexiconMutation(lexicon, { t: 'ontology/term_added', id: 'a_term', label: 'A', gloss: 'g', parent: 'b_term', basis: 'b' }, 7), { t: 'ontology/term_added', id: 'b_term', label: 'B', gloss: 'g', parent: 'a_term', basis: 'b' }, 8), 'a_term').cycle !== null)
	const healthy = lexiconHealth(lexicon, [])
	check('没人用的条目报 info(提示,不拦操作)', healthy.some((issue) => issue.kind === 'unused' && issue.severity === 'info'))
	const conflicted = lexiconHealth(applyLexiconMutation(lexicon, { t: 'ontology/predicate_deprecated', id: 'convergence_order', reason: 'r' }, 9), [
		{ id: 'f1', review: null, assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] },
	])
	check('引用了已废止谓词的事实要看得见(记录保留,不再新增)', conflicted.some((issue) => issue.kind === 'deprecated_in_use'))
	const unknown = lexiconHealth(lexicon, [{ id: 'f2', review: null, assertions: [{ predicate: 'ghost_pred', subject: { id: 'x' }, object: { kind: 'statement', value: 'v' } }] }])
	check('事实里用了没登记的谓词要报', unknown.some((issue) => issue.kind === 'unknown_predicate_in_fact'))
	const dangling = lexiconHealth({ terms: [{ id: 't', label: 'T', status: 'admitted', parent: 'missing_term' }], predicates: [] }, [])
	check('父概念不在词汇里要报', dangling.some((issue) => issue.kind === 'dangling_parent' || issue.kind === 'cycle'))
}

console.log('\n【图投影:同一份账本 ⇒ 同一张图,坐标也确定】')
{
	const lexicon = seeded()
	const facts = [
		{ id: 'f1', text: 'a', level: 'L3', review: null, assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] },
		{ id: 'f2', text: 'b', level: 'L3', review: null, assertions: [{ predicate: 'tested_by', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: { kind: 'instance', value: 'smooth-case' } }] },
	]
	const state = { lexicon, facts }
	const first = graphProjection(state)
	const second = graphProjection(state)
	check('两次投影逐字节相同(布局是纯函数)', JSON.stringify(first) === JSON.stringify(second))
	check('本体层与实体层都画出来了', first.nodes.some((node) => node.kind === 'concept') && first.nodes.some((node) => node.kind === 'instance'))
	check('is_a 与谓词都在边上', first.edges.some((edge) => edge.kind === 'is_a') && first.edges.some((edge) => edge.kind === 'predicate'))
	check('每条事实边带认识论读数(等级 + 事实 id)', first.edges.filter((edge) => edge.kind === 'assertion').every((edge) => edge.level !== undefined && edge.fact !== null))
	check('概念按 is_a 深度分层(子比父深一行)', first.nodes.find((node) => node.ref === 'weno_scheme').y > first.nodes.find((node) => node.ref === 'numerical_scheme').y)
	check('所有节点都有坐标(布局没有漏项)', first.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)))
	check('包围盒算得出来', first.bounds.width > 0 && first.bounds.height > 0)
	check('空词汇投影为空图而不是崩', graphProjection({}).nodes.length === 0)

	/**
	 * 图 DTO 的三件:层次、连接度、命题身份。
	 *
	 * 它们都是为了**让客户端不再自己猜**——旧写法客户端按 `kind` 数组重推一遍「这一层画不画」,
	 * 按数组前 N 截断(于是出现没有端点的边),而事实指不回命题(同一句话挂两个 id 的账本
	 * 更让它指不回)。判据只有一处:投影。
	 */
	check('每个节点都说出自己在哪一层(客户端不再按 kind 猜)', first.nodes.every((node) => node.layer === 'ontology' || node.layer === 'entity'))
	check('本体层节点是概念与值形态,实体层是实例与字面值', first.nodes.filter((node) => node.layer === 'ontology').every((node) => node.kind === 'concept' || node.kind === 'value_type') && first.nodes.filter((node) => node.layer === 'entity').every((node) => node.kind === 'instance' || node.kind === 'literal'))
	check('每条边说得出自己在哪一层', first.edges.every((edge) => edge.layer === 'ontology' || edge.layer === 'entity'))
	check('层次与边种一致(is_a/谓词在本体层,断言在实体层)', first.edges.filter((edge) => edge.kind === 'assertion').every((edge) => edge.layer === 'entity') && first.edges.filter((edge) => edge.kind === 'is_a' || edge.kind === 'predicate').every((edge) => edge.layer === 'ontology'))
	/**
	 * `degree`(连接度)**没有进投影**:它当初是给手写 SVG 的「先画谁」用的,
	 * 那个轮子已经还给 React Flow(视口/可见性归库),所以这里不再产出无消费者的派生字段。
	 * 「不为不存在的消费方引入机制」——这条断言就是那个删除的机械面。
	 */
	check('投影只给纯语义(节点 / 边 / 包围盒),不替渲染层排名', first.nodes.every((node) => node.degree === undefined))

	check('事实边带着命题身份(事实指得回产出它的那条命题)', first.edges.filter((edge) => edge.kind === 'assertion').every((edge) => edge.claim === null || typeof edge.claim === 'string'))
	check('没有命题关联的旧事实如实给 null,不编一个', graphProjection({ lexicon, facts: [{ id: 'old', text: 'x', level: 'L3', review: null, assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] }] }).edges.find((edge) => edge.kind === 'assertion').claim === null)
	check('有命题关联的事实把它带出来', graphProjection({ lexicon, facts: [{ id: 'f9', hypothesis: 'h-9', text: 'x', level: 'L3', review: null, assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] }] }).edges.find((edge) => edge.kind === 'assertion').claim === 'h-9')
	check('一条事实人话读得出来', formatAssertion(lexicon, facts[0].assertions[0]) === 'WENO5 · 收敛阶 = 5 order', formatAssertion(lexicon, facts[0].assertions[0]))
}

console.log('\n【折法:六个本体事件折进 lexicon(旧账本没有它也不崩)】')
{
	check('状态版本已 +1(v14:缺口与关口收窄,跳级理由整套删除)', fold.STATE_VERSION === 14, String(fold.STATE_VERSION))
	const empty = fold.emptyState()
	check('空状态的词汇是空表(不是 undefined)', Array.isArray(empty.lexicon?.terms) && Array.isArray(empty.lexicon?.predicates))
	const lexicon = seeded()
	const state = fold.applyMutations(empty, [
		{ t: 'ontology/term_added', id: 'numerical_scheme', label: '数值格式', gloss: 'g', basis: 'b' },
		{ t: 'ontology/term_added', id: 'weno_scheme', label: 'WENO格式', gloss: 'g', parent: 'numerical_scheme', basis: 'b' },
		{ t: 'ontology/predicate_added', id: 'convergence_order', label: '收敛阶', domain: 'numerical_scheme', range: { form: 'quantity' }, functional: true, basis: 'b' },
		{ t: 'ontology/term_revised', id: 'weno_scheme', gloss: 'g2', reason: 'r' },
		{ t: 'ontology/term_deprecated', id: 'numerical_scheme', reason: 'too broad' },
	])
	check('六个事件折法都认识', foldSource.includes("case 'ontology/term_added'") && foldSource.includes("case 'ontology/predicate_added'") && foldSource.includes("case 'ontology/term_revised'") && foldSource.includes("case 'ontology/predicate_revised'") && foldSource.includes("case 'ontology/term_deprecated'") && foldSource.includes("case 'ontology/predicate_deprecated'"))
	check('概念折进来了', state.lexicon.terms.map((item) => item.id).join(',') === 'numerical_scheme,weno_scheme')
	check('谓词折进来了', state.lexicon.predicates.length === 1 && state.lexicon.predicates[0].range.form === 'quantity')
	check('修订与废止都落在折出来的词汇上', state.lexicon.terms.find((item) => item.id === 'weno_scheme').version === 2 && state.lexicon.terms.find((item) => item.id === 'numerical_scheme').status === 'deprecated')
	check('词汇与过程本体是两个字段(权威不同,不能挤在一格)', foldSource.includes('lexicon: emptyLexicon()') && foldSource.includes('ontology: null'))
}

console.log('\n【折法:事实带上假设 id 与断言,并按 id 关联】')
{
	const state = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [{ id: 'h1', claim: 'wording one', refute_when: 'rw', version: 1 }] },
		{ t: 'fact/promoted', id: 'f1', goal: 'g1', hypothesis: 'h1', text: 'wording two (改过措辞)', scope: 'sc', level: 'L3', evidence: ['e1'], path: 'p', assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] },
	])
	const fact = state.facts[0]
	check('升格带着产出它的假设 id', fact.hypothesis === 'h1')
	check('升格带着类型化断言', Array.isArray(fact.assertions) && fact.assertions.length === 1)
	const derived = fold.derive(state)
	check('按 id 关联:措辞变了也认得出这条假设的出处(推翻标记落在它身上)', derived.factRows[0].refuted === false)
	check('按 id 关联:升格算进完成度', derived.progress === 1)
	const retracted = fold.applyMutations(state, [{ t: 'fact/reviewed', fact: 'f1', decision: 'retracted', reason: 'bad' }])
	check('按 id 撤回:措辞不同也能把假设读成 retracted(黏性终态)', fold.derive(retracted).hypotheses[0].status === 'retracted')
	const legacy = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [{ id: 'h1', claim: 'same wording', refute_when: 'rw', version: 1 }] },
		{ t: 'fact/promoted', id: 'f1', goal: 'g1', text: 'same wording', scope: 'sc', level: 'L3', evidence: ['e1'], path: 'p' },
	])
	check('旧账本(无 hypothesis / 无断言)仍按主张文本关联', fold.derive(legacy).progress === 1)
	check('旧账本的事实没有断言 = null(宽松+校验:不提供放行)', legacy.facts[0].assertions === null && legacy.facts[0].hypothesis === null)
	/**
	 * **形状钉死**:状态的键与事实的键**逐字列出来**。加字段不是错,但必须是被意识到的
	 * 一次决定(改这一行 + 改 STATE_VERSION 的说明),而不是顺手长出来的——
	 * 「旧账本逐字段不变」这句话只有在这种对照下才可核对。
	 */
	const STATE_KEYS = ['goal', 'hypotheses', 'plans', 'evidence', 'audits', 'materials', 'facts', 'blocks', 'releases', 'ontology', 'lexicon', 'entities', 'entityAssertions', 'hostHealth', 'inFlight', 'written']
	const FACT_KEYS = ['id', 'goal', 'hypothesis', 'text', 'scope', 'level', 'evidence', 'path', 'assertions', 'at']
	check('状态键集合与清单逐字一致(加字段要改这一行)', JSON.stringify(Object.keys(fold.emptyState()).sort()) === JSON.stringify([...STATE_KEYS].sort()), Object.keys(fold.emptyState()).filter((key) => !STATE_KEYS.includes(key)).join(','))
	check('事实键集合与清单逐字一致', JSON.stringify(Object.keys(legacy.facts[0]).sort()) === JSON.stringify([...FACT_KEYS].sort()), Object.keys(legacy.facts[0]).filter((key) => !FACT_KEYS.includes(key)).join(','))
}

console.log('\n【折法:冲突与健康度是派生读数,进读面不进闸门】')
{
	const lexicon = seeded()
	const push = (state, mutation) => fold.applyMutations(state, [mutation])
	let state = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [{ id: 'h1', claim: 'c1', refute_when: 'rw', version: 1 }] },
		{ t: 'fact/promoted', id: 'f1', goal: 'g1', hypothesis: 'h1', text: 'c1', scope: 's', level: 'L3', evidence: [], path: 'p', assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] },
		{ t: 'fact/promoted', id: 'f2', goal: 'g1', hypothesis: 'h1', text: 'c2', scope: 's', level: 'L3', evidence: [], path: 'p', assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(2) }] },
	])
	for (const entry of [...lexicon.terms, ...lexicon.predicates]) {
		state = push(state, entry.parent !== undefined && entry.parent !== null ? { t: 'ontology/term_added', ...entry } : { t: 'ontology/predicate_added', ...entry })
	}
	const derived = fold.derive(state)
	check('冲突在派生里出现(不必等界面)', derived.conflicts.length === 1, JSON.stringify(derived.conflicts))
	check('冲突不拦任何动作,只在「需要你」里陈述一行(以哪个为准)', !('hasOpenGate' in derived) && derived.needYou.some((item) => item.kind === 'conflict' && /以哪个为准/.test(item.text) && /WENO5/.test(item.text)), JSON.stringify(derived.needYou))
	check('冲突两侧的事实都没被改动(系统不替你选)', state.facts.length === 2 && state.facts.every((fact) => fact.review === null || fact.review === undefined))
	const view = fold.view(state, 'session')
	check('读面带出词汇 / 冲突 / 健康度 / 图', view.lexicon !== undefined && Array.isArray(view.lexicon.conflicts) && Array.isArray(view.lexicon.health) && view.lexicon.graph.nodes.length > 0)
	check('卡片把冲突说出来并说明「不替你选」', fold.renderCard(state).includes('矛盾') && fold.renderCard(state).includes('系统不替你选'))
	check('撤回一侧之后冲突消失', fold.derive(fold.applyMutations(state, [{ t: 'fact/reviewed', fact: 'f2', decision: 'retracted', reason: 'bad' }])).conflicts.length === 0)
}

console.log('\n【知识模式:结构判据 + 缺口是读数,不是拦截】')
{
	/**
	 * 这一组的判据只有一条:**分诊不猜词面**。
	 * 立约并用相互竞争的假设登记它,是模型自己已经做出的承诺;词面启发式猜错了没人能复核。
	 * 缺口四条各自只算**今天还补得上**的那些(旧事实补不上断言,就不算欠账)。
	 */
	const labelled = (state) => fold.derive(state).knowledge
	const codes = (state) => labelled(state).gaps.map((gap) => gap.code)
	const goalOnly = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [{ id: 'h1', claim: 'c1', refute_when: 'rw', version: 1 }, { id: 'h2', claim: 'c2', refute_when: 'rw', version: 1 }] },
	])

	check('没有目标 ⇒ 普通任务(也没有缺口)', labelled(fold.emptyState()).mode === 'ordinary' && labelled(fold.emptyState()).gaps.length === 0)
	check('普通任务的卡片里不出现「知识模式」', !fold.renderCard(fold.emptyState()).includes('知识模式'))
	check('目标开着且有登记命题 ⇒ 知识模式', labelled(goalOnly).mode === 'knowledge', JSON.stringify(labelled(goalOnly)))
	check(
		'一个部署不要求假设(minHypotheses=0)时,光有目标不算知识模式',
		labelled(fold.applyMutations(fold.emptyState(), [{ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [] }])).mode === 'ordinary',
	)
	check(
		'目标结了 ⇒ 回到普通任务(报告期不再催结构)',
		labelled(fold.applyMutations(goalOnly, [{ t: 'goal/closed', id: 'g1', status: 'achieved', verdict: 'achieved' }])).mode === 'ordinary',
	)

	const withLanguage = fold.applyMutations(goalOnly, [
		{ t: 'ontology/term_added', id: 'numerical_scheme', label: '数值格式', basis: 'b', version: 1 },
		{ t: 'ontology/predicate_added', id: 'convergence_order', label: '收敛阶', domain: 'numerical_scheme', range: { form: 'quantity' }, basis: 'b' },
	])
	check('缺口只留三种:没有词汇不再单列一条(第四阶段删了 no_language)', !codes(goalOnly).includes('no_language') && !codes(withLanguage).includes('no_language'))
	check('只有散文主张 ⇒ 报 prose_only_claims', codes(goalOnly).includes('prose_only_claims'))

	const typed = fold.applyMutations(withLanguage, [
		{
			t: 'goal/set',
			id: 'g1',
			claim: 'C',
			done_criteria: 'D',
			promote_at_level: 'L3',
			revision: 2,
			hypotheses: [
				{ id: 'h1', claim: 'c1', refute_when: 'rw', version: 1, assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] },
				{ id: 'h2', claim: 'c2', refute_when: 'rw', version: 1, assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(2) }] },
			],
		},
	])
	check('两条命题都带上断言 ⇒ prose_only_claims 消失', !codes(typed).includes('prose_only_claims'), JSON.stringify(labelled(typed).gaps))

	// ③ 升格时没带断言的事实:第四阶段起不再单列缺口(它已经是结论,欠的是下一轮的形态,不是这一轮的动作)。
	const promoted = fold.applyMutations(typed, [
		{ t: 'fact/promoted', id: 'f1', goal: 'g1', hypothesis: 'h1', text: 'c1', scope: 's', level: 'L3', evidence: [], path: 'p', assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] },
	])
	const bare = fold.applyMutations(typed, [{ t: 'fact/promoted', id: 'f9', goal: 'g1', hypothesis: 'h1', text: 'c1', scope: 's', level: 'L3', evidence: [], path: 'p', assertions: null }])
	check('升格没带断言 ⇒ 不再报 unstructured_facts(缺口只留三种)', !codes(bare).includes('unstructured_facts'))

	// ④ 从没被证据碰过:只在这次会话真的跑出过证据之后才报(计划刚立不是缺口)。
	check('一步都还没走 ⇒ 不报 untouched_claims(那是起点,不是缺口)', !codes(typed).includes('untouched_claims'))
	const worked = fold.applyMutations(typed, [
		{
			t: 'plan/created',
			id: 'p1',
			goal: 'g1',
			brief: 'x'.repeat(300),
			steps: [
				{ id: 's1', do: 'r', done_criteria: 'd', tests: { hypothesis: 'h1', level: 'L2' } },
				{ id: 's2', do: 'r2', done_criteria: 'd2' },
			],
		},
		{ t: 'evidence/recorded', id: 'e1', plan: 'p1', step: 's1', verdict: 'support', level: 'L2', evaluator: 'self', basis: 'b', refs: [], origins: [] },
	])
	check('已经跑出证据、而有命题没被碰过 ⇒ 报 untouched_claims', codes(worked).includes('untouched_claims'), JSON.stringify(labelled(worked).gaps))
	check('被碰过的命题不算在内(只剩没碰过的那条)', labelled(worked).gaps.find((gap) => gap.code === 'untouched_claims')?.count === 1)

	check('缺口是读数:一条也不拦,也不进「需要你」', fold.derive(goalOnly).needYou.length === 0)
	check('读面带出知识模式(与卡片同一份派生)', fold.view(goalOnly, 's').knowledge.mode === 'knowledge')
	check('卡片把缺口逐条说出来(人话,不带 code)', fold.renderCard(goalOnly).includes('还欠的') && !/prose_only_claims|untouched_claims|entities_unlanded/.test(fold.renderCard(goalOnly)))
	check('结构完整时如实说不欠,而不是沉默', fold.renderCard(promoted).includes('结构完整') || fold.renderCard(promoted).includes('还欠的'), fold.renderCard(promoted).split('\n').filter((line) => line.includes('结构') || line.includes('还欠')).join('|'))
}

console.log('\n【假设身份:一个 id 只对应一条主张(真跑里卡上出现 6~8 行读数的那条)】')
{
	/**
	 * 真跑现场:目标改过一次版,运行态卡上就有 4 条主张的 6~8 行读数——同一句话挂着两个 id、
	 * 各报一个状态。判据是**身份**:id 不变则主张不许换,主张不变则 id 不许换。
	 */
	const set = (hypotheses, revision = 1) => ({ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D', promote_at_level: 'L3', revision, hypotheses })
	const line = { predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }
	const first = fold.applyMutations(fold.emptyState(), [set([{ id: 'h1', claim: 'c1', refute_when: 'rw', version: 1 }])])
	const restated = fold.applyMutations(first, [set([{ id: 'h1', claim: 'c1', refute_when: 'rw 改过', version: 1, assertions: [line] }], 2)])

	check('再一次 goal/set 同一 id + 同一主张 ⇒ 不新增行(id 是身份)', restated.hypotheses.length === 1, `${restated.hypotheses.length} 行`)
	check('补上的断言当真落进那条老命题(修订加断言是正当的更新)', Array.isArray(restated.hypotheses[0].assertions) && restated.hypotheses[0].assertions.length === 1)
	check('推翻条件也按新版更新', restated.hypotheses[0].refute_when === 'rw 改过')

	const rewritten = fold.applyMutations(first, [set([{ id: 'h1', claim: '完全另一句话', refute_when: 'rw', version: 1 }], 2)])
	check('同一个 id 换主张 ⇒ 拒(拿旧 id 说新话是对所有旧读数说假话)', rewritten.hypotheses.length === 1 && rewritten.hypotheses[0].claim === 'c1', JSON.stringify(rewritten.hypotheses.map((h) => h.claim)))

	const refuted = fold.applyMutations(first, [{ t: 'hypothesis/superseded', goal: 'g1', id: 'h1', claim: 'c1', by: 'rev2' }])
	check('hypothesis/superseded 折得出终态(这条变更过去没有生产者)', refuted.hypotheses[0].status === 'superseded')
	const sticky = fold.applyMutations(refuted, [set([{ id: 'h1', claim: 'c1', refute_when: 'rw', version: 1, assertions: [line] }], 3)])
	check('终态黏住:被替代过的命题不会因为再被列出而复活', sticky.hypotheses[0].status === 'superseded' && sticky.hypotheses.length === 1)
}

console.log('\n【知识预检:相关已知自动到面前,普通任务零成本】')
{
	/**
	 * 预检解决的是「模型不查就开工」:相关性判断在投影里做完(词面命中,逐条可复核),
	 * 模型拿到的是**可直接引用的 id 清单**,不是一句「去查 QueryKnowledge」。
	 * 三条纪律与缺口读数同一套:只读、有界、不猜语义。
	 */
	const seededState = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: '查清炉次氧含量', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [{ id: 'h1', claim: '炉次氧含量是 10ppm', refute_when: 'rw' }] },
		{ t: 'ontology/term_added', id: 'furnace_batch', label: '炉次', gloss: '熔铸循环', basis: 'R-01' },
		{ t: 'ontology/term_added', id: 'unrelated', label: '无关概念', gloss: 'g', basis: 'b' },
		{ t: 'ontology/predicate_added', id: 'oxygen_ppm', label: '氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, basis: 'R-01' },
	])

	// ① 普通任务:一个字节都不加。
	check('普通任务 preflight = null(零成本契约)', fold.knowledgePreflight(fold.emptyState(), fold.derive(fold.emptyState())) === null)
	check('普通任务的卡里不出现「相关已知」', !fold.renderCard(fold.emptyState()).includes('相关已知'))

	// ② 知识模式:命中的进、不命中的不进。
	const pf = fold.knowledgePreflight(seededState, fold.derive(seededState))
	check('知识模式给出预检', pf !== null && pf.mode === 'knowledge')
	check('主张文本命中的概念进预检(炉次)', pf.terms.some((term) => term.id === 'furnace_batch'))
	check('没命中的概念不进(无关概念不在清单里)', !pf.terms.some((term) => term.id === 'unrelated'))
	check('命中的谓词进预检(氧含量)', pf.predicates.some((predicate) => predicate.id === 'oxygen_ppm'))

	// ③ 断言已引用的谓词即使词面不命中也算「在用」。
	const withAssertions = fold.applyMutations(seededState, [
		{
			t: 'goal/set',
			id: 'g1',
			claim: '查清炉次氧含量',
			done_criteria: 'D',
			promote_at_level: 'L3',
			revision: 2,
			hypotheses: [{ id: 'h1', claim: '炉次氧含量是 10ppm', refute_when: 'rw', assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'T2', type: 'furnace_batch' }, object: { kind: 'quantity', value: 10, unit: 'ppm' } }] }],
		},
	])
	const pf2 = fold.knowledgePreflight(withAssertions, fold.derive(withAssertions))
	check('断言引用的谓词算「在用」(即使词面不命中)', pf2.predicates.some((predicate) => predicate.id === 'oxygen_ppm'))

	// ④ 卡里真的说出来。
	const card = fold.renderCard(seededState)
	check('卡里有「已有的词」一行,带可直接引用的 id', card.includes('已有的词') && card.includes('furnace_batch') && card.includes('oxygen_ppm'))

	// ⑤ 没命中时如实说,不把空读数写成「世上没有」。
	const noVocab = fold.applyMutations(fold.emptyState(), [{ t: 'goal/set', id: 'g1', claim: '全新领域', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [{ id: 'h1', claim: '全新主张', refute_when: 'rw' }] }])
	const pf3 = fold.knowledgePreflight(noVocab, fold.derive(noVocab))
	check('没有命中时 terms/predicates 为空数组(不是 null,不是 undefined)', Array.isArray(pf3.terms) && pf3.terms.length === 0 && Array.isArray(pf3.predicates) && pf3.predicates.length === 0)
	check('卡里如实说「没命中」并指出动作', fold.renderCard(noVocab).includes('没有命中') && fold.renderCard(noVocab).includes('先立词'))

	// ⑥ 废止的词条不进预检。
	const deprecated = fold.applyMutations(seededState, [{ t: 'ontology/term_deprecated', id: 'furnace_batch', reason: '不再用' }])
	const pf4 = fold.knowledgePreflight(deprecated, fold.derive(deprecated))
	check('废止的概念不进预检(新断言不许再引用它)', !pf4.terms.some((term) => term.id === 'furnace_batch'))

	// ⑦ 有界:超出上限如实报 truncated。
	check('预检带 truncated 读数(有界,不假装这就是全部)', typeof pf.termsTruncated === 'number' && typeof pf.predicatesTruncated === 'number')

	// ⑧ 读面(view)也带出同一份。
	check('view().preflight 与判据同源', fold.view(seededState, 's').preflight?.terms.some((term) => term.id === 'furnace_batch'))
}

console.log('\n【知识 Inspector:一个选择 → 定义 / 关系 / 断言 / 证据链 / 历史】')
{
	/**
	 * 这一组钉的是阶段 5 的核心主张:**图上的对象是知识入口**。
	 * 判据是「链真的串起来了」——事实 → 命题 → 证据 → 出处 → 产生步骤,
	 * 每一段都指得出来源,而没有的东西如实给 null(不拿文本相等冒充身份)。
	 */
	const state = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: '查清炉次氧含量', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [{ id: 'h1', claim: 'T2 炉次氧含量是 10ppm', refute_when: '复测不是 10ppm' }] },
		{ t: 'ontology/term_added', id: 'furnace_batch', label: '炉次', gloss: '一次熔铸循环', basis: '现场记录 R-01' },
		{ t: 'ontology/predicate_added', id: 'oxygen_ppm', label: '氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, functional: true, basis: 'GB/T 5121' },
		{ t: 'plan/created', id: 'p1', goal: 'g1', brief: 'x'.repeat(300), steps: [{ id: 's1', do: '读仪表记录', done_criteria: 'lab/g1.txt 存在', artifacts: ['lab/g1.txt'], tests: { hypothesis: 'h1', level: 'L3' } }] },
		{ t: 'evidence/recorded', id: 'e1', plan: 'p1', step: 's1', verdict: 'support', level: 'L3', evaluator: 'independent', basis: '读过产物', refs: ['lab/g1.txt'], origins: [{ kind: 'artifact', path: 'lab/g1.txt' }, { kind: 'audit-card', path: 'clear/evidence/audits/s1/a.json' }], at: 30 },
		{
			t: 'fact/promoted',
			id: 'f1',
			goal: 'g1',
			hypothesis: 'h1',
			text: 'T2 炉次氧含量是 10ppm',
			scope: '复测不是 10ppm',
			level: 'L3',
			evidence: ['e1'],
			path: 'clear/knowledge/facts/g1.md',
			at: 40,
			assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'T2', type: 'furnace_batch' }, object: { kind: 'quantity', value: 10, unit: 'ppm' } }],
		},
	])
	const inspect = (selection) => fold.inspectGraphSelection(state, selection)

	// ① 概念:定义 + 关系 + 相关事实 + 历史。
	const concept = inspect({ kind: 'concept', id: 'furnace_batch' })
	check('概念:给得出定义(名字 / 释义 / 依据)', concept?.definition.label === '炉次' && concept.definition.gloss === '一次熔铸循环' && concept.definition.basis === '现场记录 R-01')
	check('概念:说明它是**约定**,不带证据等级', typeof concept.note === 'string' && concept.note.includes('约定'))
	check('概念:连出用它的谓词(带域)', concept.relations.predicates.some((item) => item.id === 'oxygen_ppm' && item.domain === 'furnace_batch'))
	check('概念:连出它下面的实例', concept.relations.instances.some((item) => item.ref === 'T2'))
	check('概念:相关事实带完整链', concept.facts.length === 1 && concept.facts[0].id === 'f1')
	check('概念:历史有登记事件', concept.history.some((event) => event.kind === 'term_added'))

	// ② 谓词:主词域给**名字**,不只给 id。
	const predicate = inspect({ kind: 'predicate', id: 'oxygen_ppm' })
	check('谓词:域给得出标签(读的人不必回词汇表里找)', predicate.definition.domain === 'furnace_batch' && predicate.definition.domainLabel === '炉次')
	check('谓词:值域与单值性都在', predicate.definition.range?.form === 'quantity' && predicate.definition.functional === true)
	check('谓词:说明单值谓词的冲突语义', typeof predicate.note === 'string' && predicate.note.includes('冲突'))
	check('谓词:列出用到它的事实与主词', predicate.facts.length === 1 && predicate.relations.subjects.some((item) => item.ref === 'T2'))

	// ③ 实例:入边 / 出边。
	const instance = inspect('furnace_batch|T2')
	check('实例:给得出类型与它的概念标签', instance.definition.type === 'furnace_batch' && instance.definition.typeLabel === '炉次')
	check('实例:出边指向谓词', instance.relations.edges.some((edge) => edge.direction === 'out' && edge.predicate === 'oxygen_ppm'))
	check('实例:边带事实读数(等级 / 状态)', instance.relations.edges[0].level === 'L3' && instance.relations.edges[0].status === 'live')
	check('实例:如实说它由投影产生、没有版本史', instance.history.length === 0 && String(instance.note).includes('不单独注册'))

	// ④ 字面值:值形态与取值。
	const literal = inspect('oxygen_ppm:quantity:10:ppm')
	check('字面值:给得出形态 / 取值 / 单位', literal.definition.form === 'quantity' && literal.definition.value === 10 && literal.definition.unit === 'ppm')
	check('字面值:指得出写它的事实', literal.facts.length === 1 && literal.facts[0].id === 'f1')

	// ⑤ 值形态:系统固定、没有版本史。
	const form = inspect({ kind: 'value_type', id: 'quantity' })
	check('值形态:说明是系统固定的内置形态', form.definition.status === 'builtin' && form.definition.gloss !== null)
	check('值形态:如实说没有版本史', Array.isArray(form.history) && form.history.length === 0)

	// ⑥ 断言边:**完整链**——这一步是阶段 5 的核心主张。
	const edge = inspect({ kind: 'edge', id: 'assertion:f1:oxygen_ppm:furnace_batch|T2' })
	const chain = edge.facts[0]
	check('边:链到事实(带边界与等级)', chain.id === 'f1' && chain.level === 'L3' && chain.scope === '复测不是 10ppm')
	check('边:事实指得回命题(按 id,不是按文本)', chain.hypothesis.id === 'h1' && chain.hypothesis.claim === 'T2 炉次氧含量是 10ppm')
	check('边:命题带着推翻条件与已支持等级', chain.hypothesis.refuteWhen === '复测不是 10ppm' && chain.hypothesis.supportedLevel === 'L3')
	check('边:链到证据(裁决 / 等级 / 判者)', chain.evidence.length === 1 && chain.evidence[0].verdict === 'support' && chain.evidence[0].evaluator === 'independent')
	check('边:证据带四类出处', chain.evidence[0].origins.some((item) => item.kind === 'artifact') && chain.evidence[0].origins.some((item) => item.kind === 'audit-card'))
	check('边:证据指得回产生它的步骤与判据', chain.evidence[0].step?.id === 's1' && chain.evidence[0].step?.doneCriteria === 'lab/g1.txt 存在')
	check('边:历史按时间排出升格与证据', chain.history.map((event) => event.kind).join(',') === 'evidence/recorded,fact/promoted')
	check('边:断言带一行人话芯片(与货架同一句)', chain.assertions[0].chip.includes('T2') && chain.assertions[0].chip.includes('10'))

	// ⑦ 不编:关联不到就如实空,且旧事实不冒充身份。
	const legacy = fold.applyMutations(state, [{ t: 'fact/promoted', id: 'f9', goal: 'g1', text: '旧事实', scope: 's', level: 'L2', evidence: [], path: 'p', at: 50, assertions: [{ predicate: 'oxygen_ppm', subject: { id: 'T2', type: 'furnace_batch' }, object: { kind: 'quantity', value: 10, unit: 'ppm' } }] }])
	const legacyConcept = fold.inspectGraphSelection(legacy, { kind: 'concept', id: 'furnace_batch' })
	const legacyFact = legacyConcept.facts.find((item) => item.id === 'f9')
	check('旧事实没有 hypothesis 关联时如实给 null(不拿文本相等冒充身份)', legacyFact.hypothesis === null)
	check('旧事实没有证据时如实给空数组', Array.isArray(legacyFact.evidence) && legacyFact.evidence.length === 0)

	// ⑧ 未知对象与错配声明:返回 null,不编一份空的。
	check('不存在的概念 → null', inspect({ kind: 'concept', id: 'no_such_term' }) === null)
	check('声明与 id 前缀矛盾 → null(说 A 给 B 一律拒)', inspect({ kind: 'predicate', id: 'term:furnace_batch' }) === null)
	check('解析不出类型的 id → null', inspect({ kind: 'concept', id: 'no_type_hint_at_all' }) === null)
	check('空选择 → null', fold.inspectGraphSelection(state, null) === null && fold.inspectGraphSelection(state, { id: '' }) === null)

	// ⑨ 有界与只读。
	check('列表带 truncated 读数(有界,不假装这就是全部)', typeof concept.factsTruncated === 'number')
	check('Inspector 是只读的:问一遍状态不变', JSON.stringify(fold.inspectGraphSelection(state, { kind: 'concept', id: 'furnace_batch' })) === JSON.stringify(fold.inspectGraphSelection(state, { kind: 'concept', id: 'furnace_batch' })))
	check('Inspector 不往状态里加东西(还是那一条事实)', state.facts.length === 1 && state.hypotheses.length === 1)
}

console.log('\n【新折法:实体账本 / 跳级理由 / 判据修订史 / 宿主健康】')
{
	/**
	 * 这一组钉的是契约冻结第 1 条的四条新变更 + 实体断言那一条(v2)。
	 * 判据的形状都一样:**它就是一条纯投影**——同一批变更折两次,结果逐字节相同;
	 * 而且旧变更一条都不许因此不认识。
	 */
	const base = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D', promote_at_level: 'L3', revision: 1, headline: '一句速览', criteria: ['c1'], hypotheses: [{ id: 'h1', claim: 'c1', refute_when: 'rw', version: 1 }] },
		{ t: 'ontology/term_added', id: 'sucai', label: '素材', gloss: 'g', basis: 'b' },
		{ t: 'ontology/predicate_added', id: 'cheng_wei', label: '称为', domain: 'sucai', range: { term: 'sucai' }, basis: 'b' },
	])
	check('新目标带上速览与判据清单(读面字段;判定仍看判据原文)', base.goal.headline === '一句速览' && base.goal.criteria.join(',') === 'c1' && base.goal.legacy === false)
	check('空状态的三块新账都是空表(旧日志折出来与从前同形)', Array.isArray(base.entities) && base.entities.length === 0 && Array.isArray(base.entityAssertions) && base.entityAssertions.length === 0 && Array.isArray(base.hostHealth) && base.hostHealth.length === 0)
	check('命题上不再有 skips(跳级理由第四阶段整套删了)', !('skips' in base.hypotheses[0]))

	const registered = fold.applyMutations(base, [{ t: 'entity/registered', id: 'yangben_a', type: 'sucai', label: '样本甲', basis: 'R-01', provenance: { kind: 'url', ref: 'https://x' }, at: 10 }])
	const again = fold.applyMutations(registered, [{ t: 'entity/registered', id: 'yangben_a', type: 'sucai', label: '样本甲(改)', basis: 'R-02', provenance: { kind: 'named', ref: '人' }, at: 20 }])
	check('实体登记折成一条记录(带类型 / 依据 / 出处 / 登记时刻)', registered.entities.length === 1 && registered.entities[0].type === 'sucai' && registered.entities[0].provenance.ref === 'https://x' && registered.entities[0].registeredAt === 10)
	check('重复登记 = 后到者覆盖展示字段,首条登记时刻保留', again.entities.length === 1 && again.entities[0].label === '样本甲(改)' && again.entities[0].basis === 'R-02' && again.entities[0].registeredAt === 10)

	const asserted = fold.applyMutations(registered, [{ t: 'entity/asserted', id: 'ea1', subject: { id: 'yangben_a', type: 'sucai' }, predicate: 'cheng_wei', object: { kind: 'instance', value: 'yangben_a', type: 'sucai' }, evidence: { kind: 'url', ref: 'https://x' } }])
	check('实体断言折成一条记录(主体 / 谓词 / 宾语 / 出处)', asserted.entityAssertions.length === 1 && asserted.entityAssertions[0].predicate === 'cheng_wei' && asserted.entityAssertions[0].evidence.ref === 'https://x')
	check('同 id 的实体断言只落一条(两条落账通道不许落两遍)', fold.applyMutations(asserted, [{ t: 'entity/asserted', id: 'ea1', subject: { id: 'yangben_a', type: 'sucai' }, predicate: 'cheng_wei', object: { kind: 'instance', value: 'yangben_a' }, evidence: { kind: 'named', ref: 'x' } }]).entityAssertions.length === 1)

	const skipped = fold.applyMutations(base, [{ t: 'level/skipped', goal: 'g1', hypothesis: 'h1', levels: ['L0', 'L1'], reason: '本项目 L0/L1 没有可检查的对象' }])
	check('旧日志里的 level/skipped 安静跳过(不抛,也不留在命题上)', skipped.hypotheses.length === 1 && !('skips' in skipped.hypotheses[0]))
	const revised = fold.applyMutations(base, [{ t: 'criteria/revised', goal: 'g1', revision: 2, from: 'D', to: 'D2', reason: '口径改窄', audit: 'audit-9' }])
	check('判据修订折成 goal.criteriaHistory[](带独立裁决,不改判据原文)', revised.goal.criteriaHistory.length === 1 && revised.goal.criteriaHistory[0].audit === 'audit-9' && revised.goal.done_criteria === 'D')
	const host = fold.applyMutations(base, [{ t: 'host/inactive', scope: 'sessions', detail: '取不到会话服务' }])
	check('宿主读面降级落一条 hostHealth(只增)', host.hostHealth.length === 1 && host.hostHealth[0].scope === 'sessions' && host.hostHealth[0].detail === '取不到会话服务')
	const many = fold.applyMutations(base, Array.from({ length: 30 }, (_, index) => ({ t: 'host/inactive', scope: index % 2 === 0 ? 'sessions' : 'sessionProjections', detail: `第 ${index} 次` })))
	check('hostHealth 是有界的读数(留最近若干条,不是档案)', many.hostHealth.length === 20 && many.hostHealth[many.hostHealth.length - 1].detail === '第 29 次')
	check('不认识的新变更不抛(旧折法上运行时静默忽略)', fold.applyMutations(base, [{ t: 'no/such', id: 'x' }]).goal.id === 'g1')
	const audited = fold.applyMutations(base, [
		{ t: 'audit/dispatched', id: 'a1', step: 's1', plan: 'p1', digest: 'd-1', evaluator_session: 'child-1' },
		{ t: 'audit/reused', id: 'a2', step: 's2', plan: 'p1', kind: 'evidence_audit', digest: 'd-1', by: 'kernel' },
	])
	check('裁决派发带 digest(同态复用的判据)', audited.audits.find((item) => item.id === 'a1').digest === 'd-1')
	check('裁决复用也进账(「这次没花钱」看得见,而且不算「等裁决」)', audited.audits.find((item) => item.id === 'a2').verdict === 'reused' && audited.audits.find((item) => item.id === 'a2').digest === 'd-1')
}

console.log('\n【缺口:每条都有 code / count / detail / nextAction 四格】')
{
	const state = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [{ id: 'h1', claim: 'c1', refute_when: 'rw', version: 1, assertions: [{ predicate: 'cheng_wei', subject: { id: 'yangben_a', type: 'sucai' }, object: { kind: 'instance', value: 'yangben_b', type: 'sucai' } }] }] },
		{ t: 'ontology/term_added', id: 'sucai', label: '素材', gloss: 'g', basis: 'b' },
		{ t: 'ontology/term_added', id: 'meiyong', label: '没人用的概念', gloss: 'g', basis: 'b' },
		{ t: 'ontology/predicate_added', id: 'cheng_wei', label: '称为', domain: 'sucai', range: { term: 'sucai' }, basis: 'b' },
	])
	const gaps = fold.derive(state).knowledge.gaps
	check('每一条缺口都有 code / count / detail / nextAction 四格', gaps.length > 0 && gaps.every((gap) => typeof gap.code === 'string' && typeof gap.count === 'number' && typeof gap.detail === 'string' && typeof gap.nextAction === 'string' && gap.nextAction !== ''), JSON.stringify(gaps))
	const unlanded = gaps.find((gap) => gap.code === 'entities_unlanded')
	check('断言主体没落图 ⇒ entities_unlanded(数的是去重的主体数)', unlanded !== undefined && unlanded.count === 1 && unlanded.detail.includes('sucai|yangben_a'), JSON.stringify(gaps.map((gap) => gap.code)))
	check('读数挂在判断上(与结案的实体门同一份)', JSON.stringify(fold.derive(state).hypotheses[0].unlanded) === JSON.stringify([{ id: 'yangben_a', type: 'sucai' }]))
	/**
	 * **判据是「主体是图上的节点」**:登记实例就够了,不必再用 Assert 把同一句话说一遍——
	 * 第三阶段重跑里,旧判据(要有边)让模型登记完实例还被拦一次,只好再 Assert 一句一字不差的话。
	 */
	const registered = fold.applyMutations(state, [{ t: 'entity/registered', id: 'yangben_a', type: 'sucai', label: '样本甲', basis: 'R-01', provenance: { kind: 'named', ref: '人' } }])
	check('登记实例 ⇒ entities_unlanded 消失(出口就是缺口里写的那一个动作)', !fold.derive(registered).knowledge.gaps.some((gap) => gap.code === 'entities_unlanded'))
	check('nextAction 指的正是 RegisterInstance', /RegisterInstance/.test(unlanded?.nextAction ?? ''))
	const asserted = fold.applyMutations(state, [{ t: 'entity/asserted', id: 'ea1', subject: { id: 'yangben_a', type: 'sucai' }, predicate: 'cheng_wei', object: { kind: 'instance', value: 'yangben_b', type: 'sucai' }, evidence: { kind: 'named', ref: '人' } }])
	check('带出处的 Assert 也把主体落成节点 ⇒ 缺口同样消失', !fold.derive(asserted).knowledge.gaps.some((gap) => gap.code === 'entities_unlanded'))
	const unrelated = fold.applyMutations(state, [{ t: 'entity/registered', id: 'yangben_z', type: 'sucai', label: '无关样本', basis: 'R-09', provenance: { kind: 'named', ref: '人' } }])
	check('登记一个无关节点不会让缺口消失(逐个主体判)', fold.derive(unrelated).knowledge.gaps.some((gap) => gap.code === 'entities_unlanded'))
	check('缺口只留三种:没人引用的概念不再单列(第四阶段删了 orphan_terms)', !gaps.some((gap) => gap.code === 'orphan_terms'))

	const l3 = fold.applyMutations(state, [
		{ t: 'plan/created', id: 'p1', goal: 'g1', brief: 'b', steps: [{ id: 's1', do: 'r', done_criteria: 'd', tests: { hypothesis: 'h1', level: 'L3' } }] },
		{ t: 'evidence/recorded', id: 'e1', plan: 'p1', step: 's1', verdict: 'support', level: 'L3', evaluator: 'independent', basis: 'b', refs: [], origins: [] },
	])
	check('走过 L3 而 L0–L2 没走 ⇒ 不再报 levels_skipped(等级只决定谁来判)', !fold.derive(l3).knowledge.gaps.some((gap) => gap.code === 'levels_skipped'))
}

console.log('\n【投影合并:登记 / 升格 / 实体断言三个来源,键去重】')
{
	const lexicon = seeded()
	const facts = [{ id: 'f1', text: 'a', level: 'L3', review: null, assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] }]
	const plain = graphProjection({ lexicon, facts })
	check('两个新来源都为空时,节点与边不带 source(旧账本的图逐字节不变)', plain.nodes.filter((node) => node.layer === 'entity').every((node) => node.source === undefined) && plain.edges.filter((edge) => edge.kind === 'assertion').every((edge) => edge.source === undefined))
	const entities = [
		{ id: 'WENO5', type: 'numerical_scheme', label: 'WENO5 实例', basis: 'R-01', provenance: { kind: 'url', ref: 'u' }, registeredAt: 1 },
		{ id: 'OTHER', type: 'numerical_scheme', label: '另一个', basis: 'R-02', provenance: { kind: 'named', ref: '人' }, registeredAt: 2 },
	]
	const entityAssertions = [
		{ id: 'ea1', subject: { id: 'WENO5', type: 'numerical_scheme' }, predicate: 'convergence_order', object: quantity(5), evidence: { kind: 'url', ref: 'u' } },
		{ id: 'ea2', subject: { id: 'OTHER', type: 'numerical_scheme' }, predicate: 'convergence_order', object: quantity(9), evidence: { kind: 'named', ref: '人' } },
	]
	const merged = graphProjection({ lexicon, facts, entities, entityAssertions })
	const entityNodes = merged.nodes.filter((node) => node.layer === 'entity')
	const entityEdges = merged.edges.filter((edge) => edge.kind === 'assertion')
	check('登记与升格同键 ⇒ 只留一条节点,登记那条是身份来源', entityNodes.filter((node) => node.id === 'numerical_scheme|WENO5').length === 1 && entityNodes.find((node) => node.id === 'numerical_scheme|WENO5').source === 'registered' && entityNodes.find((node) => node.id === 'numerical_scheme|WENO5').label === 'WENO5 实例')
	check('实体断言也产边(只登记节点不产边,图仍然长不出来)', entityEdges.some((edge) => edge.source === 'asserted') && entityEdges.some((edge) => edge.source === 'promoted'))
	check('两条来源的边形状同形、都在实体层、靠 source 分得开', entityEdges.every((edge) => edge.layer === 'entity' && typeof edge.from === 'string' && typeof edge.to === 'string'))
	check('登记的节点带着出处(凭什么在这里)', entityNodes.find((node) => node.id === 'numerical_scheme|OTHER').provenance.ref === '人')
	check('实体断言每条都产一条边,实例节点只来自登记的那两个', entityEdges.filter((edge) => edge.source === 'asserted').length === 2 && entityNodes.filter((node) => node.kind === 'instance').length === 2)
	check('投影是纯函数:同一份账本两次调用逐字节相同', JSON.stringify(merged) === JSON.stringify(graphProjection({ lexicon, facts, entities, entityAssertions })))
}

console.log('\n【断言主体可指认:词汇三种条目,主体要么已登记要么同批引出】')
{
	const lexicon = seeded()
	const line = { predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }
	check('LEXICON_KINDS 认第三种条目:实例', LEXICON_KINDS.includes('instance') && LEXICON_KINDS.includes('term') && LEXICON_KINDS.includes('predicate'))
	check('实例不许有父概念(is_a 只连概念)', validateTerm(lexicon, { id: 'yangben_a', kind: 'instance', label: '样本甲', gloss: 'g', basis: 'b', parent: 'numerical_scheme' }).some((item) => item.startsWith('instance_no_parent')))
	check('没登记的断言主体要拒;旧调用点(只递词汇)照旧放行——迁移期一次', validateAssertions({ lexicon, entities: [] }, [line]).some((item) => String(item).includes('assert_subject_unknown')) && validateAssertions(lexicon, [line]).length === 0)
	const problem = validateAssertions({ lexicon, entities: [] }, [line]).find((item) => String(item).includes('assert_subject_unknown'))
	check('这条问题两种读法都成立(文本 + code/subject 字段,内核把它当文本拼)', problem !== undefined && problem.code === 'assert_subject_unknown' && typeof problem.subject === 'string')
	check('登记过的断言主体放行', validateAssertions({ lexicon, entities: [{ id: 'WENO5', type: 'numerical_scheme' }] }, [line]).length === 0)
	check('legacy:true 一次性放行', validateAssertions({ lexicon, entities: [] }, [line], { legacy: true }).length === 0)
	const state = { lexicon, entities: [{ id: 'WENO5', type: 'numerical_scheme' }] }
	const introduced = [
		{ predicate: 'tested_by', subject: { id: 'smooth', type: 'test_case' }, object: { kind: 'statement', value: 'v' } },
		{ predicate: 'tested_by', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: { kind: 'instance', value: 'smooth', type: 'test_case' } },
	]
	check('同一批里以 instance 形态引出过 ⇒ 主体可指认', !validateAssertions(state, introduced).some((item) => String(item).includes('assert_subject_unknown')), JSON.stringify(validateAssertions(state, introduced).map(String)))
}

console.log('\n【货架:概念 / 个体(实例)/ 谓词三节分开,零引用单独一节】')
{
	const state = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D', promote_at_level: 'L3', revision: 1, hypotheses: [{ id: 'h1', claim: 'c1', refute_when: 'rw' }] },
		{ t: 'ontology/term_added', id: 'sucai', label: '素材', gloss: 'g', basis: 'b' },
		{ t: 'ontology/term_added', id: 'meiyong', label: '没人用的概念', gloss: 'g', basis: 'b' },
		{ t: 'ontology/predicate_added', id: 'cheng_wei', label: '称为', domain: 'sucai', range: { term: 'sucai' }, basis: 'b' },
		{ t: 'entity/registered', id: 'yangben_a', type: 'sucai', label: '样本甲', basis: 'R-01', provenance: { kind: 'url', ref: 'https://x' } },
	])
	const derived = fold.derive(state)
	const shelf = describeDomainShelf(state, derived.factRows, derived.hypotheses)
	check('三节都在,而且每节开头一句「这一节是什么」', /## 概念\(\d+\)[\s\S]*这一节是/.test(shelf) && /## 个体\(实例\)\(\d+\)[\s\S]*这一节是/.test(shelf) && /## 谓词\(\d+\)[\s\S]*这一节是/.test(shelf))
	check('个体那一节把登记的实例与它的出处写出来', /## 个体\(实例\)\(1\)/.test(shelf) && shelf.includes('yangben_a') && shelf.includes('已登记'))
	check('零引用的概念单独一节(它还是约定,不是已知)', /## 零引用的概念\(1\)/.test(shelf) && shelf.includes('meiyong'))
	check('旧的词汇入口照旧可用(缺实体面时如实说没有,不编)', describeDomainShelf(state.lexicon, [], []).includes('## 概念(2)'))
	const view = knowledgeView(state, derived, { preflight: null })
	const wired = describeDomainShelf(state, derived.factRows, derived.hypotheses, { view })
	check('货架的「使用」一节读 knowledgeView 那一份(同一句速览 / 缺口带下一步)', wired.includes(view.headline.now) && (view.gaps.length === 0 || wired.includes(view.gaps[0].nextAction)))
}

console.log('\n【单一叙述源:knowledgeView 的形状与卡上限】')
{
	/**
	 * 卡是模型每一步唯一读到的窗口,而它是**每回合**重算的:上限必须是保证,不是希望。
	 * 三条:三行速览齐备、契约字段齐备、卡文本有硬上限(超了如实说省了几行)。
	 */
	const state = fold.applyMutations(fold.emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: 'C', done_criteria: 'D'.repeat(400), promote_at_level: 'L3', revision: 1, hypotheses: Array.from({ length: 12 }, (_, index) => ({ id: `h${index}`, claim: `主张 ${index} ${'x'.repeat(120)}`, refute_when: 'rw' })) },
	])
	const derived = fold.derive(state)
	const view = knowledgeView(state, derived)
	check('三行速览齐备(正在解决 / 怎样算完成 / 我做到哪了)', typeof view.headline.now === 'string' && typeof view.headline.done === 'string' && typeof view.headline.where === 'string')
	check('契约字段都在', ['headline', 'goal', 'progress', 'claims', 'gaps', 'facts', 'entities', 'evidence', 'deliver', 'boundaries'].every((key) => key in view), Object.keys(view).join(','))
	check('术语表每一项都是三格(plain / where / nextAction)', Object.values(GLOSSARY).every((item) => typeof item.plain === 'string' && typeof item.where === 'string' && typeof item.nextAction === 'string'))
	check('等级表能直接取(L0–L4)', ['L0', 'L1', 'L2', 'L3', 'L4'].every((level) => typeof view.levels[level]?.plain === 'string'))
	check('卡文本有硬上限(≤3000 字符)', view.card.length <= 3000, String(view.card.length))
	check('超上限时如实说省了几行,不静默截断', view.card.length <= 3000 && (/省去 \d+ 行|没有展开/.test(view.card) || view.card.length < 3000))
	/**
	 * **判据正文在卡里只出现一次,且是压缩版**:全文的家是 `clear/goals/{id}.md`。
	 * 修订后的**第一张卡**会由内核 pre-step 补一次全文(逐字看到新尺子),之后各拍只留压缩版。
	 */
	check('卡里不带判据全文(压缩版 + 指针)', !fold.renderCard(state).includes('D'.repeat(400)) && fold.renderCard(state).includes('clear/goals/g1.md'))
	const revised = fold.applyMutations(state, [{ t: 'criteria/revised', goal: 'g1', revision: 2, from: 'D'.repeat(400), to: 'D'.repeat(400), reason: 'r', audit: 'a-1' }])
	check('判据改过 ⇒ 卡里写明改过几次、全文在哪(裁决编号不上卡)', fold.renderCard(revised).includes('判据改过 1 次') && !fold.renderCard(revised).includes('a-1') && fold.renderCard(revised).includes('clear/goals/g1.md') && !fold.renderCard(revised).includes('D'.repeat(400)))
	check('view() 把同一份交给面板(宿主经它暴露)', fold.view(state, 's').knowledgeView.headline.now === view.headline.now)

	/**
	 * **判据逐条**(`Frame` 收 `criteria: string[]`,每条一句话、每条可清点)。
	 * 挤成一行会把「第 3 条没做到」抹平,整段重发又会把卡撑爆 ⇒ 三条界都要在:
	 * 逐条一行(带序号)、每行有上限、条数有上限且超出**如实说**(还有几条 + 全文在哪)。
	 */
	const listed = fold.applyMutations(fold.emptyState(), [
		{
			t: 'goal/set',
			id: 'g2',
			claim: 'C',
			done_criteria: 'D'.repeat(400),
			headline: '一句速览',
			criteria_note: '口径可随复核改',
			promote_at_level: 'L3',
			revision: 1,
			criteria: ['第一条:留出集实测误差 < 5%', '第二条:语料每条带可追溯出处', `第三条:${'x'.repeat(200)}`, '第四条', '第五条', '第六条', '第七条', '第八条'],
			hypotheses: [],
		},
	])
	const listedView = knowledgeView(listed, fold.derive(listed))
	check('判据逐条进读面(条数 / 每条一行 / 注解 / 文档指针同一处)', listedView.goal.criteriaTotal === 8 && listedView.goal.criteriaLines.length === 8 && listedView.goal.criteriaNote === '口径可随复核改' && listedView.goal.docPath === 'clear/goals/g2.md')
	check('面板那一份每条也有上限(一条千字判据不占满一行)', listedView.goal.criteriaLines[2].length <= 161 && listedView.goal.criteriaLines[2].endsWith('…'))
	const listedCard = fold.renderCard(listed)
	const listedRows = listedCard.split('\n').filter((line) => /^\s+\d+\. /.test(line))
	check('卡里判据逐条一行、带序号(不是压成一句)', listedRows.length === 6 && listedRows[0].includes('第一条') && listedRows[5].includes('第六条'))
	check('每行 80 字封顶(逐条 ≠ 重发整段)', listedRows.every((line) => line.length <= 86) && !listedCard.includes('x'.repeat(200)) && !listedCard.includes('D'.repeat(400)))
	check('超出 6 条如实说还有几条 + 全文在哪', listedCard.includes('还有 2 条') && listedCard.includes('clear/goals/g2.md'))
	check('逐条之后卡仍守住硬上限(≤3000)', listedCard.length <= 3000, String(listedCard.length))
	check('面板与卡读同一份(卡里的行就是读面里那一行)', listedView.goal.criteriaLines[0] === '第一条:留出集实测误差 < 5%' && listedCard.includes(listedView.goal.criteriaLines[0]))
	/** 改过判据:逐条照列,留痕在同一张卡上(第几次修订 + 谁裁的)。 */
	const listedRevised = fold.applyMutations(listed, [{ t: 'criteria/revised', goal: 'g2', revision: 2, from: 'D', to: 'D2', reason: 'r', audit: 'audit-9' }])
	const revisedListedCard = fold.renderCard(listedRevised)
	check('改过判据:逐条仍在,留痕写清第几次修订与独立裁决', /^\s+1\. 第一条/m.test(revisedListedCard) && revisedListedCard.includes('判据改过 1 次') && !revisedListedCard.includes('audit-9'))
	/** 清单是空数组 ⇒ 与「没有清单」同一处置:退回压缩版 + 指针,不出现一个「判据(0 条)」小节。 */
	const emptyList = fold.applyMutations(fold.emptyState(), [{ t: 'goal/set', id: 'g3', claim: 'C', done_criteria: 'D'.repeat(400), promote_at_level: 'L3', revision: 1, criteria: [], hypotheses: [] }])
	const emptyListCard = fold.renderCard(emptyList)
	check('判据清单空数组 ⇒ 压缩版 + 指针(不写「0 条」小节)', emptyListCard.includes('clear/goals/g3.md') && !emptyListCard.includes('(0 条'))
}


{
	/**
	 * 病灶:每条变更的 `at` 都取 `mutation.at ?? 0`,而内核**不写** `at`——于是凡是显示时间的
	 * 地方(Inspector 的历史、计划开合、证据时刻)一律 **1970-01-01**。
	 * 修法:时间属于**日志里的那一刻**(`event.time`),由折法在入口盖上去;内核不必读时钟。
	 */
	const viaTool = fold.applyEvent(fold.emptyState(), {
		type: 'tool/result',
		time: 1789698592175,
		data: { meta: { kind: 'clearai', mutations: [{ t: 'ontology/term_added', id: 'x', label: 'X', gloss: 'g', basis: 'b' }] } },
	})
	check('变更自己不带时间 ⇒ 用事件时间(不再是 1970)', viaTool.lexicon.terms[0].at === 1789698592175, String(viaTool.lexicon.terms[0].at))

	const explicit = fold.applyEvent(fold.emptyState(), {
		type: 'tool/result',
		time: 111,
		data: { meta: { kind: 'clearai', mutations: [{ t: 'ontology/term_added', id: 'y', label: 'Y', gloss: 'g', basis: 'b', at: 222 }] } },
	})
	check('变更自己带了时间 ⇒ 以它为准(有些路径知道更准的时刻)', explicit.lexicon.terms[0].at === 222)

	const oldLog = fold.applyEvent(fold.emptyState(), {
		type: 'tool/result',
		data: { meta: { kind: 'clearai', mutations: [{ t: 'ontology/term_added', id: 'z', label: 'Z', gloss: 'g', basis: 'b' }] } },
	})
	check('事件也没时间(旧日志)⇒ 保持原样,不假装知道', oldLog.lexicon.terms[0].at === 0)

	/** 插件消息那条路(世界线结论回灌)同样要盖。 */
	const viaPlugin = fold.applyEvent(fold.emptyState(), {
		type: 'user/message',
		time: 333,
		data: { source: { kind: 'plugin:clearai', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [{ t: 'goal/set', id: 'g1', claim: 'c', done_criteria: 'd', promote_at_level: 'L3', revision: 1, hypotheses: [] }] }) }] } },
	})
	check('插件消息里的变更也盖上时间(同一条规矩,两个入口)', viaPlugin.goal.openedAt === 333, String(viaPlugin.goal.openedAt))
}

console.log('\n【测试面:这一份测试进了 run.sh(否则它只是本地脚本)】')
{
	check('run.sh 里登记了领域语言这一套', suiteSource.includes('domain-language.test.mjs'))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
