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
	formatAssertion,
	formatObject,
} = await import(join(PORT, 'ui', 'lib', 'domain-language.js'))
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
	check('状态版本已 +1(v10:多了领域词汇与类型化事实)', fold.STATE_VERSION === 10, String(fold.STATE_VERSION))
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
	const STATE_KEYS = ['goal', 'hypotheses', 'plans', 'evidence', 'audits', 'materials', 'facts', 'forks', 'scouts', 'brainCandidates', 'skillPromotions', 'brain', 'skillCatalog', 'skillUsage', 'blocks', 'releases', 'autonomy', 'constitution', 'ontology', 'lexicon', 'continuation', 'inFlight', 'written', 'writeCalls']
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
	check('冲突不产生闸门(它是读数,不是等人处置的门)', derived.hasOpenGate === false)
	check('冲突两侧的事实都没被改动(系统不替你选)', state.facts.length === 2 && state.facts.every((fact) => fact.review === null || fact.review === undefined))
	const view = fold.view(state, 'session')
	check('读面带出词汇 / 冲突 / 健康度 / 图', view.lexicon !== undefined && Array.isArray(view.lexicon.conflicts) && Array.isArray(view.lexicon.health) && view.lexicon.graph.nodes.length > 0)
	check('卡片把冲突说出来并说明「不替你选」', fold.renderCard(state).includes('冲突') && fold.renderCard(state).includes('系统不替你选'))
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
	check('语言还没立起来 ⇒ 报 no_language', codes(goalOnly).includes('no_language'))
	check('立了概念与谓词 ⇒ no_language 消失(否则它是一条永远擦不掉的抱怨)', !codes(withLanguage).includes('no_language'))
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

	// ③ 升格时没带断言:只算 0.2.0 那条路(有 hypothesis 关联)的,旧事实不算欠账。
	const promoted = fold.applyMutations(typed, [
		{ t: 'fact/promoted', id: 'f1', goal: 'g1', hypothesis: 'h1', text: 'c1', scope: 's', level: 'L3', evidence: [], path: 'p', assertions: [{ predicate: 'convergence_order', subject: { id: 'WENO5', type: 'numerical_scheme' }, object: quantity(5) }] },
	])
	check('升格带了断言 ⇒ 不报 unstructured_facts', !codes(promoted).includes('unstructured_facts'))
	const bare = fold.applyMutations(typed, [{ t: 'fact/promoted', id: 'f9', goal: 'g1', hypothesis: 'h1', text: 'c1', scope: 's', level: 'L3', evidence: [], path: 'p', assertions: null }])
	check('升格没带断言(0.2.0 那条路)⇒ 报 unstructured_facts', codes(bare).includes('unstructured_facts'))
	const legacy = fold.applyMutations(typed, [{ t: 'fact/promoted', id: 'f0', goal: 'g1', text: '旧事实', scope: 's', level: 'L3', evidence: [], path: 'p' }])
	check('更早的事实(没有 hypothesis 关联)补不上断言 ⇒ 不算欠账', !codes(legacy).includes('unstructured_facts'))

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

	check('缺口是读数:一条也不拦(没有闸门)', fold.derive(goalOnly).hasOpenGate === false)
	check('读面带出知识模式(与卡片同一份派生)', fold.view(goalOnly, 's').knowledge.mode === 'knowledge')
	check('卡片把缺口逐条说出来', fold.renderCard(goalOnly).includes('知识模式') && fold.renderCard(goalOnly).includes('缺口'))
	check('结构完整时如实说不欠,而不是沉默', fold.renderCard(promoted).includes('结构完整') || fold.renderCard(promoted).includes('缺口'), fold.renderCard(promoted).split('\n').filter((line) => line.includes('知识模式')).join('|'))
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
	check('卡里有「相关已知」一行,带可直接引用的 id', card.includes('相关已知') && card.includes('furnace_batch') && card.includes('oxygen_ppm'))

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
