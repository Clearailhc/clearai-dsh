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
