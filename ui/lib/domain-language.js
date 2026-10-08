/**
 * 领域语言层:**值形态、词条、断言的纯函数**。
 *
 * 为什么它必须是一份纯函数:同一批判据要被三处消费——
 *   · 折法(`fold.js`)把账本里的本体事件折成 `state.lexicon`,并派生冲突与图;
 *   · 宿主侧的路由与预设侧的工具在**落账之前**校验注册与断言(那里有 I/O);
 *   · 客户端只读投影,不重算。
 * 校验一旦有两份实现就会漂,而漂法最难发现:「登记时放行、升格时拒绝」在界面上
 * 长得和「这条还没验」一模一样。所以判据只有这一份。
 *
 * 三条边界:
 *   · **不碰 I/O**。`code` 形态指向的文件存不存在,由拥有文件系统的那一侧查;这里只判形状,
 *     于是同一份判据能在宿主与浏览器两侧跑出同一结果。
 *   · **不读时钟**。时间由调用方作为 `at` 传进来。
 *   · **不判真假**。这里只回答「这条断言合不合这门语言」,不回答「它对不对」——
 *     后者是认识论循环的事(等级、证据、评估、人门)。
 *
 * 名词:一个项目有一份**领域词汇**(`lexicon`),里面是两种条目——
 * **概念**(`term`,图上的节点)与**谓词**(`predicate`,图上的边)。两者共用一个 id 命名空间:
 * 断言里 `predicate` 与 `subject.type` 都是这个空间里的名字,分开两个空间只会让引用含混。
 */

import { bilingual, tr } from './lang.js'

/** 字面值的五种形态。断言客体如果是**值**,必是其中之一。 */
export const VALUE_FORMS = ['statement', 'quantity', 'formula', 'code', 'reference']

/**
 * 断言客体可以是**值**(上面五种),也可以是**另一个实例**(关系谓词的宾语,
 * 例如「A 是 B 的一部分」)。`instance` 因此不是第六种「值形态」,而是关系谓词的对象形态。
 */
export const OBJECT_KINDS = [...VALUE_FORMS, 'instance']

/**
 * 词条的三种角色。概念与谓词共用同一条生命周期(接纳 → 修订 → 黏性废止)。
 *
 * **实例**在表里,但不在 `lexicon` 里:它的家在账本的 `state.entities`(每条带类型与出处),
 * 因为「某个具体物在某出处下成立」是一条**主张**,而不是一次约定——它要能带依据被清点。
 * 它**没有 parent**:`is_a` 只连概念,实例与概念的关系用断言说(见 `validateTerm`)。
 */
export const LEXICON_KINDS = ['term', 'predicate', 'instance']

/** id 的形状:小写字母开头的 slug。中英文之外的类型名一律不认,免得同一个概念有两种写法。 */
const ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/

/** 空词汇。`emptyState()` 与「日志里还没有任何本体事件」必须给出同一个形状。 */
export function emptyLexicon() {
	return { terms: [], predicates: [] }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value) => (typeof value === 'string' ? value.trim() : '')
const clone = (value) => JSON.parse(JSON.stringify(value))

/**
 * 老账本里没有 `lexicon` 这个字段(那时还没有领域本体这回事),而且**将来还可能丢**——
 * 投影缓存的形状只保证同版本内一致。所以每个消费者入口都先过一次它,少一次 `?? {}` 的抄写。
 */
export function normalizeLexicon(raw) {
	const lexicon = isPlainObject(raw) ? raw : {}
	return {
		terms: Array.isArray(lexicon.terms) ? lexicon.terms : [],
		predicates: Array.isArray(lexicon.predicates) ? lexicon.predicates : [],
	}
}

/** 在共享命名空间里找一个条目(概念或谓词),返回 `{ kind, entry }` 或 null。 */
export function findEntry(lexicon, id) {
	const normalized = normalizeLexicon(lexicon)
	if (text(id) === '') return null
	const term = normalized.terms.find((item) => item.id === id)
	if (term !== undefined) return { kind: 'term', entry: term }
	const predicate = normalized.predicates.find((item) => item.id === id)
	if (predicate !== undefined) return { kind: 'predicate', entry: predicate }
	return null
}

/** 一个 id 是否已被占用(概念与谓词共用一个空间)。 */
function idTaken(lexicon, id) {
	return findEntry(lexicon, id) !== null
}

/** 条目今天能不能被**新的**断言/引用使用:已废止的不行(存量事实照旧可读)。 */
function isUsable(entry) {
	return isPlainObject(entry) && entry.status !== 'deprecated'
}

function problem(code, detail) {
	return `${code}:${detail}`
}

/** 概念之间的父链:返回值里带环就说明这份词汇已经不合法了(健康检查要说得出来)。 */
export function termChain(lexicon, id) {
	const normalized = normalizeLexicon(lexicon)
	const byId = new Map(normalized.terms.map((item) => [item.id, item]))
	const chain = []
	const seen = new Set()
	let cursor = text(id)
	while (cursor !== '') {
		if (seen.has(cursor)) return { chain, cycle: cursor }
		seen.add(cursor)
		const entry = byId.get(cursor)
		if (entry === undefined) return { chain, missing: cursor }
		chain.push(cursor)
		cursor = text(entry.parent)
	}
	return { chain, cycle: null, missing: null }
}

/**
 * 注册一个新概念要满足的条件。返回问题清单(空 = 通过)。
 * 为什么**依据**必填:约定可以自愿,但不能无来由。依据不是事实证明,而是「这个约定
 * 为什么被引入」;没有它,词汇表迟早变成模型的临时造词坊。
 */
export function validateTerm(lexicon, draft) {
	const problems = []
	const instance = isPlainObject(draft) && text(draft.kind) === 'instance'
	const at = instance ? '实例' : '概念'
	if (!isPlainObject(draft)) return [problem('term_shape', `${at}必须是一个对象`)]
	const id = text(draft.id)
	if (!ID_PATTERN.test(id)) problems.push(problem('id_shape', `${at} id 要小写字母开头的 slug(字母/数字/下划线,≤40):收到「${id}」`))
	else if (idTaken(lexicon, id)) problems.push(problem('id_taken', `id「${id}」已经被占用(概念与谓词共用一个命名空间)`))
	if (text(draft.label) === '') problems.push(problem('label_required', `${at}要有名字`))
	if (text(draft.gloss) === '') problems.push(problem('gloss_required', `${at}要有释义:一句话说清它指什么,不然引用它的人各读各的`))
	if (text(draft.basis) === '') problems.push(problem('basis_required', `${at}要写依据:哪份材料、哪条事实或人说的哪句话让这个词成立`))
	if (draft.aliases !== undefined && draft.aliases !== null) {
		if (!Array.isArray(draft.aliases) || draft.aliases.some((alias) => typeof alias !== 'string')) problems.push(problem('aliases_shape', 'aliases 只能是字符串数组'))
	}
	const parent = text(draft.parent)
	if (parent !== '') {
		const found = findEntry(lexicon, parent)
		if (found === null) problems.push(problem('parent_unknown', `父概念「${parent}」还没登记`))
		else if (found.kind !== 'term') problems.push(problem('parent_not_term', `父概念「${parent}」是个谓词,is_a 只能连概念`))
		else if (!isUsable(found.entry)) problems.push(problem('parent_deprecated', `父概念「${parent}」已废止`))
		else {
			const walk = termChain(lexicon, parent)
			if (walk.cycle !== null || walk.missing !== null) problems.push(problem('parent_cycle', `父概念「${parent}」的父链已经成环或指空,不能再往上接`))
		}
	}
	/**
	 * **实例不是概念**:它有类型与出处,没有父概念。`is_a` 是概念之间的事;
	 * 「这个样本属于哪一类」要用断言说——否则个体一多,本体层被具体物撑大,
	 * 而实体层仍然是空的(那正是这套词汇要给实例一个可写入口的原因)。
	 */
	if (instance && parent !== '') problems.push(problem('instance_no_parent', `实例「${id}」不许有父概念:is_a 只连概念,它属于哪一类要用断言说`))
	return problems
}

/**
 * 注册一个新谓词要满足的条件。
 *
 * 值域只有两种写法,没有第三种:`{ term }` 说宾语是**另一个概念的实例**,
 * `{ form }` 说宾语是**一个字面值**并且形态固定。含糊的值域等于没有值域——
 * 「什么都能填」的谓词,查询与冲突检查都拿它没办法。
 */
export function validatePredicate(lexicon, draft) {
	const problems = []
	const at = '谓词'
	if (!isPlainObject(draft)) return [problem('predicate_shape', `${at}必须是一个对象`)]
	const id = text(draft.id)
	if (!ID_PATTERN.test(id)) problems.push(problem('id_shape', `${at} id 要小写字母开头的 slug(字母/数字/下划线,≤40):收到「${id}」`))
	else if (idTaken(lexicon, id)) problems.push(problem('id_taken', `id「${id}」已经被占用(概念与谓词共用一个命名空间)`))
	if (text(draft.label) === '') problems.push(problem('label_required', `${at}要有名字`))
	if (text(draft.basis) === '') problems.push(problem('basis_required', `${at}要写依据`))
	const domain = text(draft.domain)
	if (domain !== '') {
		const found = findEntry(lexicon, domain)
		if (found === null) problems.push(problem('domain_unknown', `主词概念「${domain}」还没登记`))
		else if (found.kind !== 'term') problems.push(problem('domain_not_term', `主词「${domain}」是个谓词,主词域只能是概念`))
		else if (!isUsable(found.entry)) problems.push(problem('domain_deprecated', `主词概念「${domain}」已废止`))
	}
	const range = draft.range
	if (!isPlainObject(range)) problems.push(problem('range_required', '谓词必须登记值域:{term} 或 {form}'))
	else {
		const term = text(range.term)
		const form = text(range.form)
		if (term !== '' && form !== '') problems.push(problem('range_ambiguous', '值域只能二选一:{term} 或 {form}'))
		else if (term !== '') {
			const found = findEntry(lexicon, term)
			if (found === null) problems.push(problem('range_unknown', `宾语概念「${term}」还没登记`))
			else if (found.kind !== 'term') problems.push(problem('range_not_term', `宾语「${term}」是个谓词,宾语域只能是概念`))
			else if (!isUsable(found.entry)) problems.push(problem('range_deprecated', `宾语概念「${term}」已废止`))
		} else if (form !== '') {
			if (!VALUE_FORMS.includes(form)) problems.push(problem('range_form_unknown', `值形态「${form}」不认识(可用:${VALUE_FORMS.join(' / ')};关系谓词请用 {term})`))
			if (range.unit !== undefined && range.unit !== null && typeof range.unit !== 'string') problems.push(problem('range_unit_shape', 'unit 只能是字符串'))
		} else problems.push(problem('range_required', '值域要么给 {term},要么给 {form}'))
	}
	if (draft.functional !== undefined && draft.functional !== null && typeof draft.functional !== 'boolean') problems.push(problem('functional_shape', 'functional 只能是布尔值(单值=真)'))
	return problems
}

/** 客体值的可比形状:冲突检查与「同一件事」的判定都用它,而不是各写一套。 */
export function objectKey(object) {
	if (!isPlainObject(object)) return ''
	const kind = text(object.kind)
	const value = object.value
	if (kind === 'quantity') return `quantity:${Number(value)}:${text(object.unit)}`
	return `${kind}:${text(String(value ?? ''))}`
}

/** 主体的可比形状:类型 + 名称。类型缺失时只用名称——它照样能查出冲突,只是粗一档。 */
export function subjectKey(assertion) {
	const subject = isPlainObject(assertion?.subject) ? assertion.subject : {}
	return `${text(subject.type)}|${text(subject.id)}`
}

/**
 * 一个类型算不算某个概念:就是它,或它的父链上有它(`jepa` is_a … `method` ⇒ 算 `method`)。
 * 主词域与值域都按这一条判——只认字面相等,模型就得为每个子类另立一条谓词。
 */
function isKindOf(lexicon, type, ancestor) {
	return type === ancestor || termChain(lexicon, type).chain.includes(ancestor)
}

/** 客体形态与谓词值域是否相容。 */
function objectProblems(lexicon, predicate, object) {
	const problems = []
	if (!isPlainObject(object)) return [problem('object_required', tr('断言要有宾语', 'An assertion needs an object'))]
	const kind = text(object.kind)
	if (!OBJECT_KINDS.includes(kind)) return [problem('object_kind_unknown', tr(`宾语形态「${kind}」不认识(可用:${OBJECT_KINDS.join(' / ')})`, `Unknown object kind "${kind}" (allowed: ${OBJECT_KINDS.join(' / ')})`))]
	const range = isPlainObject(predicate.range) ? predicate.range : {}
	const rangeTerm = text(range.term)
	const rangeForm = text(range.form)
	if (rangeTerm !== '') {
		if (kind !== 'instance') return [problem('object_form_mismatch', tr(`谓词「${predicate.id}」的宾语是概念「${rangeTerm}」的实例,宾语形态应为 instance`, `The object of predicate "${predicate.id}" is an instance of concept "${rangeTerm}"; the object kind should be instance`))]
		const type = text(object.type)
		if (type !== '' && !isKindOf(lexicon, type, rangeTerm)) return [problem('object_type_mismatch', tr(`宾语实例的类型「${type}」既不是谓词值域「${rangeTerm}」,也不是它的下位概念`, `The object instance type "${type}" is neither the predicate range "${rangeTerm}" nor one of its subconcepts`))]
		if (text(object.value) === '') return [problem('object_value_required', tr('宾语实例要有名称', 'The object instance needs a name'))]
		return []
	}
	if (rangeForm !== '' && kind !== rangeForm) return [problem('object_form_mismatch', tr(`谓词「${predicate.id}」的值形态是 ${rangeForm},宾语却是 ${kind}`, `Predicate "${predicate.id}" takes ${rangeForm} values, but the object is ${kind}`))]
	switch (kind) {
		case 'statement':
			if (text(object.value) === '') problems.push(problem('object_value_required', tr('陈述不能为空', 'The statement cannot be empty')))
			else if (String(object.value).length > 2000) problems.push(problem('object_value_too_long', tr('陈述超过 2000 字:把它拆成断言,或把长文放证据里', 'The statement is over 2000 characters: split it into assertions, or put the long text in evidence')))
			break
		case 'quantity':
			if (typeof object.value !== 'number' || !Number.isFinite(object.value)) problems.push(problem('object_quantity_shape', tr('量形态的 value 必须是有限数值', 'A quantity value must be a finite number')))
			if (text(object.unit) === '') problems.push(problem('object_unit_required', tr('量形态要带单位:没有单位的数不是量', 'A quantity needs a unit: a number without a unit is not a quantity')))
			break
		case 'formula':
			if (text(object.value) === '') problems.push(problem('object_value_required', tr('公式不能为空', 'The formula cannot be empty')))
			break
		case 'code':
			if (text(object.value) === '') problems.push(problem('object_value_required', tr('code 形态要指向工作区里的一个文件,不能为空', 'A code value must point to a file in the workspace and cannot be empty')))
			else if (/^([/\\]|[A-Za-z]:[\\/])/.test(text(object.value))) problems.push(problem('object_code_absolute', tr('code 形态要写工作区内的相对路径:绝对路径换个工作区就没了', 'A code value must be a path relative to the workspace: an absolute path breaks in another workspace')))
			else if (text(object.value).split(/[/\\]/).includes('..')) problems.push(problem('object_code_escape', tr('code 形态不许越出工作区(路径里出现了 ..)', 'A code value cannot leave the workspace (the path contains ..)')))
			break
		case 'reference':
			if (text(object.value) === '') problems.push(problem('object_value_required', tr('引用不能为空', 'The reference cannot be empty')))
			break
		default:
			break
	}
	return problems
}

/**
 * 一条断言合不合这门语言。`lexicon` 是那一刻的词汇——**引用必须已经存在**(先登记后引用,
 * 没有「隐式建档」这条捷径:那样词汇表会长出一堆没人认领的条目)。
 */
export function validateAssertion(lexicon, assertion) {
	const problems = []
	if (!isPlainObject(assertion)) return [problem('assertion_shape', tr('断言必须是一个对象', 'An assertion must be an object'))]
	const predicateId = text(assertion.predicate)
	if (predicateId === '') return [problem('predicate_required', tr('断言要写谓词', 'An assertion needs a predicate'))]
	const found = findEntry(lexicon, predicateId)
	if (found === null) return [problem('predicate_unknown', tr(`谓词「${predicateId}」还没登记`, `Predicate "${predicateId}" does not exist yet`))]
	if (found.kind !== 'predicate') return [problem('predicate_not_predicate', tr(`「${predicateId}」是个概念,不能当谓词用`, `"${predicateId}" is a concept and cannot be used as a predicate`))]
	const predicate = found.entry
	if (!isUsable(predicate)) problems.push(problem('predicate_deprecated', tr(`谓词「${predicateId}」已废止:新断言不能再用它`, `Predicate "${predicateId}" is deprecated: new assertions cannot use it`)))
	const subject = assertion.subject
	if (!isPlainObject(subject) || text(subject.id) === '') problems.push(problem('subject_required', tr('断言要有主体(至少一个名称)', 'An assertion needs a subject (at least a name)')))
	else {
		const domain = text(predicate.domain)
		const type = text(subject.type)
		if (domain !== '') {
			if (type === '') problems.push(problem('subject_type_required', tr(`谓词「${predicateId}」声明了主词域「${domain}」,主体要写明 type`, `Predicate "${predicateId}" declares the domain "${domain}", so the subject needs a type`)))
			else if (!isKindOf(lexicon, type, domain)) problems.push(problem('subject_type_mismatch', tr(`主体类型「${type}」既不是主词域「${domain}」,也不是它的下位概念`, `Subject type "${type}" is neither the domain "${domain}" nor one of its subconcepts`)))
		}
		if (type !== '') {
			const typeEntry = findEntry(lexicon, type)
			if (typeEntry === null) problems.push(problem('subject_type_unknown', tr(`主体类型「${type}」还没登记`, `Subject type "${type}" does not exist yet`)))
			else if (typeEntry.kind !== 'term') problems.push(problem('subject_type_not_term', tr(`主体类型「${type}」是个谓词`, `Subject type "${type}" is a predicate`)))
			else if (!isUsable(typeEntry.entry)) problems.push(problem('subject_type_deprecated', tr(`主体类型「${type}」已废止`, `Subject type "${type}" is deprecated`)))
		}
	}
	problems.push(...objectProblems(lexicon, predicate, assertion.object))
	if (assertion.qualifiers !== undefined && assertion.qualifiers !== null && !isPlainObject(assertion.qualifiers)) problems.push(problem('qualifiers_shape', tr('qualifiers 只能是对象(限定条件:时间、工况、适用范围)', 'qualifiers must be an object (conditions: time, setting, scope)')))
	return problems
}

/**
 * 一条事实的**整组**断言是否自洽。除了逐条校验,还查「同一主体同一谓词给了两个值」——
 * 单值谓词上这已经是自相矛盾,不该等到与别的事实比才发现。
 *
 * **断言主体必须可指认**(契约冻结第 4 条):`subject.id` 要么已经在实体图上
 * (`state.entities` 里的 `${type}|${id}`),要么在**同一批**断言里以 `instance` 形态被引出过
 * (宾语形态 = instance,值/类型对上)。两者都不是 ⇒ `assert_subject_unknown`:
 * 断言只挂在命题上,图里没有那个对象,句子无法被机器比对。
 *
 * 两个入口都认,判据只有这一份:
 *   · 递**整份状态**(`{ lexicon, entities }`)—— 推荐,实体面在里面,这一条才真跑;
 *   · 递**词汇**(旧调用点)或 `options.legacy === true` —— 迁移期一次性放行(缺实体面时
 *     无法判「已登记」,如实跳过而不是拿猜测拒人)。
 */
export function validateAssertions(state, assertions, options = {}) {
	if (assertions === undefined || assertions === null) return []
	if (!Array.isArray(assertions)) return [problem('assertions_shape', tr('assertions 只能是数组', 'assertions must be an array'))]
	if (assertions.length === 0) return []
	const stateForm = isPlainObject(state) && isPlainObject(state.lexicon)
	const lexicon = stateForm ? state.lexicon : state
	const entities = stateForm && Array.isArray(state.entities) ? state.entities : null
	const legacy = options === true || (isPlainObject(options) && options.legacy === true)
	const registered = new Set(entities === null ? [] : entities.map((entry) => `${text(entry?.type)}|${text(entry?.id)}`))
	/** 这一批断言里被 `instance` 宾语**引出**的对象:值 + (给了类型就要求类型一致)。 */
	const introduced = new Map()
	for (const assertion of assertions) {
		if (text(assertion?.object?.kind) !== 'instance') continue
		const value = text(assertion.object.value)
		if (value !== '') introduced.set(value, text(assertion.object.type))
	}
	const problems = []
	const seen = new Map()
	for (const [index, assertion] of assertions.entries()) {
		for (const item of validateAssertion(lexicon, assertion)) problems.push(tr(`断言 ${index + 1} · ${item}`, `Assertion ${index + 1} · ${item}`))
		const key = `${text(assertion?.predicate)}\u0000${subjectKey(assertion)}`
		const value = objectKey(assertion?.object)
		if (seen.has(key) && seen.get(key) !== value) {
			problems.push(problem('assertion_self_conflict', tr(`同一事实里「${text(assertion?.predicate)}」在主体「${text(assertion?.subject?.id)}」上给了两个值:${seen.get(key)} 与 ${value}`, `Within one fact, "${text(assertion?.predicate)}" gives two values for subject "${text(assertion?.subject?.id)}": ${seen.get(key)} and ${value}`)))
		}
		seen.set(key, value)
		if (entities === null || legacy) continue
		const subjectId = text(assertion?.subject?.id)
		if (subjectId === '') continue
		const subjectType = text(assertion?.subject?.type)
		if (registered.has(`${subjectType}|${subjectId}`)) continue
		const introducedType = introduced.get(subjectId)
		if (introducedType !== undefined && (introducedType === '' || introducedType === subjectType)) continue
		problems.push(subjectUnknown(`${subjectType}|${subjectId}`))
	}
	return problems
}

/**
 * `assert_subject_unknown` 的**报告形状**。
 *
 * 契约要求这一条带 `code` 与 `subject`,而消费它的内核把 problems 当文本拼
 * (`` `- ${item}` ``)。所以这里给一个**两种读法都成立**的值:它是一段文本
 * (`String(item)` / `item.includes(...)` 照常),同时挂着 `code` 与 `subject` 两个字段。
 * 换成一个裸对象会让内核当场渲染出 `[object Object]`——那比不报更坏。
 */
function subjectUnknown(subject) {
	const message = new String(problem('assert_subject_unknown', tr(`主体「${subject}」还不在实体图上:先登记这个实例(带类型与出处),或在这一批断言里让某个宾语以 instance 形态引出它`, `Subject "${subject}" is not on the entity graph yet: write its entity file (with type and source) first, or introduce it as an instance object in this batch of assertions`)))
	message.code = 'assert_subject_unknown'
	message.subject = subject
	return message
}

/**
 * **冲突是派生读数,不是存储对象**:两条**未撤回**的已确认事实落在同一个单值谓词、
 * 同一主体、而客体不同,就是一对冲突。它只被**说出来**,不被裁决——哪条为真不是这里的事
 * (去问证据与人)。所以这个函数没有副作用,也只读事实与词汇。
 *
 * 已废止的谓词照样参与:约束在被废止之前对那批事实是生效的,今天不算才是说假话。
 */
export function deriveConflicts(facts, lexicon) {
	const normalized = normalizeLexicon(lexicon)
	const functional = new Set(normalized.predicates.filter((item) => item.functional === true).map((item) => item.id))
	if (functional.size === 0) return []
	const buckets = new Map()
	for (const fact of Array.isArray(facts) ? facts : []) {
		if (!isPlainObject(fact)) continue
		if (fact.review?.decision === 'retracted') continue
		for (const assertion of Array.isArray(fact.assertions) ? fact.assertions : []) {
			const predicate = text(assertion?.predicate)
			if (!functional.has(predicate)) continue
			const key = `${predicate}\u0000${subjectKey(assertion)}`
			const rows = buckets.get(key) ?? []
			rows.push({ fact: fact.id ?? null, value: objectKey(assertion.object), text: fact.text ?? null, level: fact.level ?? null })
			buckets.set(key, rows)
		}
	}
	const conflicts = []
	for (const [key, rows] of buckets) {
		const byValue = new Map()
		for (const row of rows) {
			if (!byValue.has(row.value)) byValue.set(row.value, [])
			byValue.get(row.value).push(row)
		}
		if (byValue.size < 2) continue
		const [predicate, subject] = key.split('\u0000')
		conflicts.push({
			predicate,
			subject,
			/** 每个取值给一条代表(第一个出现的那条事实),面板据此成对打开两侧。 */
			sides: [...byValue.entries()]
				.sort((a, b) => (a[0] < b[0] ? -1 : 1))
				.map(([value, list]) => ({ value, fact: list[0].fact, text: list[0].text, level: list[0].level, count: list.length })),
		})
	}
	return conflicts.sort((a, b) => (a.predicate === b.predicate ? (a.subject < b.subject ? -1 : 1) : a.predicate < b.predicate ? -1 : 1))
}

/**
 * 词汇健康度(派生读数,不拦任何操作):悬空引用、父链成环、没人用的条目、以及
 * **引用了已废止条目的事实**。最后一条要看得见——那些事实仍然有效(历史留着),
 * 但引用它的人该知道这门语言已经变了。
 */
export function lexiconHealth(lexicon, facts) {
	const normalized = normalizeLexicon(lexicon)
	const issues = []
	const usedTerms = new Set()
	const usedPredicates = new Set()
	for (const term of normalized.terms) {
		if (text(term.parent) !== '') usedTerms.add(text(term.parent))
		const walk = termChain(normalized, term.id)
		if (walk.cycle !== null) issues.push({ kind: 'cycle', severity: 'warning', id: term.id, detail: tr(`is_a 父链成环(回到「${walk.cycle}」)`, `The is_a chain loops (back to "${walk.cycle}")`) })
		else if (walk.missing !== null) issues.push({ kind: 'dangling_parent', severity: 'warning', id: term.id, detail: tr(`父概念「${walk.missing}」不在词汇里`, `Parent concept "${walk.missing}" is not in the vocabulary`) })
	}
	for (const predicate of normalized.predicates) {
		const domain = text(predicate.domain)
		const range = isPlainObject(predicate.range) ? predicate.range : {}
		if (domain !== '') {
			usedTerms.add(domain)
			if (findEntry(normalized, domain) === null) issues.push({ kind: 'dangling_domain', severity: 'warning', id: predicate.id, detail: tr(`主词域「${domain}」不在词汇里`, `Domain "${domain}" is not in the vocabulary`) })
		}
		const rangeTerm = text(range.term)
		if (rangeTerm !== '') {
			usedTerms.add(rangeTerm)
			if (findEntry(normalized, rangeTerm) === null) issues.push({ kind: 'dangling_range', severity: 'warning', id: predicate.id, detail: tr(`宾语域「${rangeTerm}」不在词汇里`, `Range "${rangeTerm}" is not in the vocabulary`) })
		}
	}
	for (const fact of Array.isArray(facts) ? facts : []) {
		const retracted = fact?.review?.decision === 'retracted'
		for (const assertion of Array.isArray(fact?.assertions) ? fact.assertions : []) {
			const predicateId = text(assertion?.predicate)
			if (predicateId === '') continue
			usedPredicates.add(predicateId)
			const type = text(assertion?.subject?.type)
			if (type !== '') usedTerms.add(type)
			const predicate = findEntry(normalized, predicateId)
			if (predicate === null) {
				if (!retracted) issues.push({ kind: 'unknown_predicate_in_fact', severity: 'warning', id: String(fact.id ?? ''), detail: tr(`事实里用了没登记的谓词「${predicateId}」`, `A fact uses the unknown predicate "${predicateId}"`) })
				continue
			}
			if (predicate.entry.status === 'deprecated' && !retracted) issues.push({ kind: 'deprecated_in_use', severity: 'info', id: predicateId, detail: tr(`已废止的「${predicateId}」仍被事实「${String(fact.id ?? '')}」引用(记录保留,不再新增)`, `The deprecated "${predicateId}" is still used by fact "${String(fact.id ?? '')}" (the record stays; no new uses)`) })
		}
	}
	for (const term of normalized.terms) {
		if (term.status === 'deprecated') continue
		if (!usedTerms.has(term.id) && !normalized.predicates.some((item) => text(item.domain) === term.id || text(item.range?.term) === term.id)) {
			issues.push({ kind: 'unused', severity: 'info', id: term.id, detail: tr('还没有任何谓词或事实引用它', 'No predicate or fact uses it yet') })
		}
	}
	for (const predicate of normalized.predicates) {
		if (predicate.status === 'deprecated') continue
		if (!usedPredicates.has(predicate.id)) issues.push({ kind: 'unused', severity: 'info', id: predicate.id, detail: tr('还没有任何事实用它', 'No fact uses it yet') })
	}
	return issues.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind < b.kind ? -1 : 1))
}

/**
 * **每个概念被引用了多少次**:断言主体的类型、谓词声明的主词域 / 值域、以及实体断言的类型。
 *
 * 为什么要单独一份判据:「零引用」这件事有两处读者——货架上「零引用的概念」那一节,
 * 与同一份货架里概念那一列的引用数。两处各算一遍,迟早会出现「引用 0 却没进零引用一节」这种
 * 同一件事两种读数;所以引用面只在这里定义一次,两边都读它。(第四阶段起它不再是缺口,只是货架读数。)
 */
export function termUsage(lexicon, facts, entityAssertions = []) {
	const normalized = normalizeLexicon(lexicon)
	const usage = new Map()
	const bump = (id) => {
		const key = text(id)
		if (key !== '') usage.set(key, (usage.get(key) ?? 0) + 1)
	}
	for (const predicate of normalized.predicates) {
		bump(predicate.domain)
		bump(isPlainObject(predicate.range) ? predicate.range.term : '')
	}
	for (const fact of Array.isArray(facts) ? facts : []) {
		for (const assertion of Array.isArray(fact?.assertions) ? fact.assertions : []) bump(assertion?.subject?.type)
	}
	for (const item of Array.isArray(entityAssertions) ? entityAssertions : []) bump(item?.subject?.type)
	return usage
}

/**
 * **图是投影,不是存储**:同一份账本,永远算出同一组节点、同一组边、同一套默认坐标。
 *
 * 两层分开画(设计里那条最主要的错误就是把它们画成同一种边):
 *   · 本体层:概念是节点、`is_a` 与谓词是边;
 *   · 实体层:实例是节点、断言是边,边上带那条事实的认识论读数(等级 / 复核态)。
 *
 * 坐标是**确定性布局**:按 `is_a` 深度分层,层内按 id 排序,实例排在最下面一行行铺开。
 * 用户临时拖拽只改当前界面——布局不是知识,不进账本。
 */
export function graphProjection(state) {
	const lexicon = normalizeLexicon(state?.lexicon)
	const facts = Array.isArray(state?.facts) ? state.facts : []
	/** 实体断言:登记那一刻就落账的「某实例在某出处下成立某断言」,不等目标裁决。 */
	const entityAssertions = Array.isArray(state?.entityAssertions) ? state.entityAssertions : []
	const nodes = []
	const edges = []
	const termById = new Map(lexicon.terms.map((item) => [item.id, item]))
	const predicateById = new Map(lexicon.predicates.map((item) => [item.id, item]))
	const uses = new Map()
	for (const fact of facts) {
		for (const assertion of Array.isArray(fact?.assertions) ? fact.assertions : []) {
			const type = text(assertion?.subject?.type)
			if (type !== '') uses.set(type, (uses.get(type) ?? 0) + 1)
			const predicateId = text(assertion?.predicate)
			if (predicateId !== '') uses.set(predicateId, (uses.get(predicateId) ?? 0) + 1)
		}
	}
	/** 实体断言的使用同样算「在用」:词被断言引用过,就不该报「没人用」。 */
	for (const item of entityAssertions) {
		const type = text(item?.subject?.type)
		if (type !== '') uses.set(type, (uses.get(type) ?? 0) + 1)
		const predicateId = text(item?.predicate)
		if (predicateId !== '') uses.set(predicateId, (uses.get(predicateId) ?? 0) + 1)
	}
	const depthOf = (term) => {
		let depth = 0
		let cursor = text(term.parent)
		const seen = new Set([term.id])
		while (cursor !== '' && !seen.has(cursor)) {
			seen.add(cursor)
			depth += 1
			cursor = text(termById.get(cursor)?.parent)
		}
		return depth
	}
	const terms = [...lexicon.terms].sort((a, b) => (a.id < b.id ? -1 : 1))
	const predicates = [...lexicon.predicates].sort((a, b) => (a.id < b.id ? -1 : 1))
	for (const term of terms) nodes.push({ id: `term:${term.id}`, kind: 'concept', layer: 'ontology', ref: term.id, label: term.label ?? term.id, status: term.status ?? 'admitted', parent: text(term.parent) === '' ? null : text(term.parent), uses: uses.get(term.id) ?? 0, depth: depthOf(term) })
	const formsUsed = VALUE_FORMS.filter((form) => predicates.some((item) => text(item.range?.form) === form))
	for (const [index, form] of formsUsed.entries()) nodes.push({ id: `form:${form}`, kind: 'value_type', layer: 'ontology', ref: form, label: form, status: 'admitted', uses: 0, depth: 0, formIndex: index })
	for (const term of terms) {
		if (text(term.parent) === '') continue
		if (!termById.has(text(term.parent))) continue
		edges.push({ id: `is_a:${term.id}`, kind: 'is_a', layer: 'ontology', predicate: null, label: 'is_a', from: `term:${term.id}`, to: `term:${term.parent}`, status: term.status ?? 'admitted' })
	}
	for (const predicate of predicates) {
		const range = isPlainObject(predicate.range) ? predicate.range : {}
		const rangeTerm = text(range.term)
		const form = text(range.form)
		const to = rangeTerm !== '' ? `term:${rangeTerm}` : form !== '' ? `form:${form}` : null
		if (to !== null) edges.push({ id: `predicate:${predicate.id}`, kind: 'predicate', layer: 'ontology', predicate: predicate.id, label: predicate.label ?? predicate.id, from: text(predicate.domain) === '' ? null : `term:${text(predicate.domain)}`, to, status: predicate.status ?? 'admitted', functional: predicate.functional === true })
	}
	/**
	 * **实体层的三个来源合一**(契约冻结第 5 条)。
	 *
	 * 从前实体只有一个来源:已升格事实里的断言。于是「实体」是目标级裁决的副产品——
	 * 一条观察要在图上出现,得先过一遍与它无关的判据;而只给实体一个**登记节点的**
	 * 写入口更糟:图可以被「一堆孤立节点」满足,边照样不长(第 2 轮那个病的同一形状)。
	 * 所以实体有两个一等写入口,都在登记那一刻落账:
	 *   · `entity/registered` → 节点(`source:'registered'`,带类型 / 依据 / 出处);
	 *   · `entity/asserted`   → **边**(`source:'asserted'`,有出处、未经独立裁决)。
	 *
	 * 合并规则:
	 *   · 键 `${type}|${id}`(与从前的实例键同形),同键去重,节点优先级
	 *     `registered > promoted > asserted`(先落的那种是这条节点的身份与展示来源);
	 *   · 边有两个来源:事实断言(`promoted`,带等级 / 边界 / 可点复核)与实体断言
	 *     (`asserted`,带出处);两者形状同形,靠 `source` 区分,UI 可分别画实线 / 虚线;
	 *   · `source` 只在**真有登记或实体断言**的图上出现:两个来源都为空时,这一段的输出
	 *     与改造前逐字节一致(旧账本的图不许因为加字段而变)。
	 */
	const merging = (Array.isArray(state?.entities) ? state.entities.length : 0) > 0 || entityAssertions.length > 0
	const instances = new Map()
	if (merging) {
		for (const entity of Array.isArray(state?.entities) ? state.entities : []) {
			const type = text(entity?.type)
			const entityId = text(entity?.id)
			if (type === '' || entityId === '') continue
			const key = `${type}|${entityId}`
			if (instances.has(key)) continue
			instances.set(key, {
				id: key,
				kind: 'instance',
				layer: 'entity',
				ref: entityId,
				label: text(entity.label) || entityId,
				type,
				source: 'registered',
				basis: entity.basis ?? null,
				provenance: entity.provenance ?? null,
				registeredAt: entity.registeredAt ?? null,
				facts: [],
			})
		}
		/**
		 * **组成 / 属于**:实体文件放在另一个实体的目录里(`line_a/kiln_3.json`)就是它的一部分。
		 * 节点带上 `container`(界面据此画可折叠的子图),同时出一条 `part_of` 边。
		 */
		const byRef = new Map([...instances.values()].map((node) => [node.ref, node]))
		for (const entity of Array.isArray(state?.entities) ? state.entities : []) {
			const parent = text(entity?.parent)
			if (parent === '' || !byRef.has(parent)) continue
			const node = instances.get(`${text(entity.type)}|${text(entity.id)}`)
			if (node === undefined) continue
			node.container = byRef.get(parent).id
			edges.push({ id: `part_of:${node.id}`, kind: 'part_of', layer: 'entity', source: 'registered', predicate: null, label: tr('属于', 'part of'), from: node.id, to: node.container, status: 'asserted', level: null, fact: null, scope: null, claim: null })
		}
	}
	for (const fact of facts) {
		const status = fact?.review?.decision === 'retracted' ? 'retracted' : fact?.refuted === true ? 'refuted' : 'live'
		for (const assertion of Array.isArray(fact?.assertions) ? fact.assertions : []) {
			const subject = isPlainObject(assertion?.subject) ? assertion.subject : {}
			const subjectId = text(subject.id)
			if (subjectId === '') continue
			const key = `${text(subject.type)}|${subjectId}`
			if (!instances.has(key)) instances.set(key, { id: key, kind: 'instance', layer: 'entity', ref: subjectId, label: subjectId, type: text(subject.type) === '' ? null : text(subject.type), facts: [] })
			instances.get(key).facts.push(fact.id ?? null)
			const predicateId = text(assertion?.predicate)
			const object = isPlainObject(assertion?.object) ? assertion.object : {}
			const objectKind = text(object.kind)
			let to = null
			if (objectKind === 'instance') {
				const objectLabel = text(object.value)
				const objectType = text(object.type) === '' ? text(predicateById.get(predicateId)?.range?.term) : text(object.type)
				const objectKeyId = `${objectType}|${objectLabel}`
				if (objectLabel !== '') {
					if (!instances.has(objectKeyId)) instances.set(objectKeyId, { id: objectKeyId, kind: 'instance', layer: 'entity', ref: objectLabel, label: objectLabel, type: objectType === '' ? null : objectType, facts: [] })
					instances.get(objectKeyId).facts.push(fact.id ?? null)
					to = objectKeyId
				}
			} else if (predicateId !== '') {
				const literalId = `${predicateId}:${objectKey(assertion.object)}`
				if (!instances.has(literalId)) instances.set(literalId, { id: literalId, kind: 'literal', layer: 'entity', ref: objectKey(assertion.object), label: formatObject(object), type: null, facts: [] })
				instances.get(literalId).facts.push(fact.id ?? null)
				to = literalId
			}
			if (to !== null) {
				const edge = { id: `assertion:${fact.id ?? ''}:${predicateId}:${subjectKey(assertion)}`, kind: 'assertion', layer: 'entity', predicate: predicateId, label: text(lexicon.predicates.find((item) => item.id === predicateId)?.label) || predicateId, from: key, to, status, level: fact.level ?? null, fact: fact.id ?? null, scope: fact.scope ?? null, claim: text(fact.hypothesis) === '' ? null : text(fact.hypothesis) }
				/** 加在末尾:两个来源都空时这条边的键序与从前逐字相同。 */
				if (merging) edge.source = 'promoted'
				edges.push(edge)
			}
		}
	}
	for (const item of entityAssertions) {
		const subject = isPlainObject(item?.subject) ? item.subject : {}
		const subjectId = text(subject.id)
		const predicateId = text(item?.predicate)
		if (subjectId === '' || predicateId === '') continue
		const subjectType = text(subject.type)
		const key = `${subjectType}|${subjectId}`
		if (!instances.has(key)) instances.set(key, { id: key, kind: 'instance', layer: 'entity', ref: subjectId, label: subjectId, type: subjectType === '' ? null : subjectType, source: 'asserted', facts: [] })
		const object = isPlainObject(item?.object) ? item.object : {}
		const objectKind = text(object.kind)
		let to = null
		if (objectKind === 'instance') {
			const objectLabel = text(object.value)
			if (objectLabel === '') continue
			const objectType = text(object.type) === '' ? text(predicateById.get(predicateId)?.range?.term) : text(object.type)
			const objectKeyId = `${objectType}|${objectLabel}`
			if (!instances.has(objectKeyId)) instances.set(objectKeyId, { id: objectKeyId, kind: 'instance', layer: 'entity', ref: objectLabel, label: objectLabel, type: objectType === '' ? null : objectType, source: 'asserted', facts: [] })
			to = objectKeyId
		} else if (objectKind !== '') {
			const literalId = `${predicateId}:${objectKey(item.object)}`
			if (!instances.has(literalId)) instances.set(literalId, { id: literalId, kind: 'literal', layer: 'entity', ref: objectKey(item.object), label: formatObject(object), type: null, source: 'asserted', facts: [] })
			to = literalId
		}
		if (to === null) continue
		edges.push({
			id: `assertion:${text(item.id)}:${predicateId}:${subjectKey(item)}`,
			kind: 'assertion',
			layer: 'entity',
			source: 'asserted',
			predicate: predicateId,
			label: text(lexicon.predicates.find((entry) => entry.id === predicateId)?.label) || predicateId,
			from: key,
			to,
			/**
			 * `status:'asserted'` 是**第三种边态**:有出处、登记那一刻就成立,但**没有**
			 * 过独立裁决,所以它既不是 `live`(已升格)也不是 `retracted`。画成虚线。
			 */
			status: 'asserted',
			level: null,
			fact: null,
			scope: null,
			claim: null,
			evidence: isPlainObject(item?.evidence) ? { kind: item.evidence.kind ?? null, ref: item.evidence.ref ?? null } : null,
			assertion: text(item.id) === '' ? null : text(item.id),
		})
	}
	/** 只从事实投影出来、又没被登记的节点:标成 `promoted`(只在合并的那张图上标,见上)。 */
	if (merging) for (const instance of instances.values()) if (instance.source === undefined) instance.source = 'promoted'
	for (const instance of [...instances.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) nodes.push(instance)
	/**
	 * **确定性布局:按层分段,层内折行。**
	 *
	 * 「层」= `is_a` 深度(概念)、值形态、实例/字面值各成一段,段与段依次向下排。
	 * 关键的一步是**折行**:早先每一层只铺一行,于是一堆没有父概念的根被排成一条
	 * 极宽极扁的带子(真数据:23 个节点铺出 3800×180),任何视口里都只能缩到看不清。
	 * 折行之后同一层在有限宽度内往下堆,整体接近屏幕比例,读得清。
	 *
	 * 它仍然是**纯函数、确定性**:同一份账本永远算出同一套坐标(层内按 id 排,不靠遍历顺序)。
	 */
	const COLUMN = 220
	const ROW = 132
	const PER_ROW = 6
	let cursorY = 0
	const band = (list) => {
		const top = cursorY
		cursorY += Math.max(1, Math.ceil(list.length / PER_ROW)) * ROW
		return top
	}
	const place = (list, top) => {
		list.forEach((node, index) => {
			node.x = (index % PER_ROW) * COLUMN
			node.y = top + Math.floor(index / PER_ROW) * ROW
		})
	}
	const byDepth = new Map()
	for (const node of nodes.filter((item) => item.kind === 'concept')) {
		const list = byDepth.get(node.depth) ?? []
		list.push(node)
		byDepth.set(node.depth, list)
	}
	/** 深度小的在上(父在上、子在下),同深度内按 id——两条都为了确定性。 */
	for (const depth of [...byDepth.keys()].sort((left, right) => left - right)) {
		const list = byDepth.get(depth)
		place(list, band(list))
	}
	const forms = nodes.filter((item) => item.kind === 'value_type')
	if (forms.length > 0) place(forms, band(forms))
	const leaves = nodes.filter((item) => item.kind === 'instance' || item.kind === 'literal')
	if (leaves.length > 0) place(leaves, band(leaves))
	const width = Math.max(...nodes.map((node) => (typeof node.x === 'number' ? node.x : 0)), 0) + COLUMN
	const height = Math.max(...nodes.map((node) => (typeof node.y === 'number' ? node.y : 0)), 0) + ROW
	/**
	 * 返回的是**纯语义**:节点、边、包围盒。视口该画哪一块、先画谁、怎么缩放,
	 * 都是渲染层的事(现在是 React Flow)——投影不再替渲染做决定。
	 */
	return { nodes, edges, bounds: { width, height } }
}

/** 宾语的一行人话(货架、面板、卡片共用同一句话,免得两处各写一套)。 */
export function formatObject(object) {
	if (!isPlainObject(object)) return ''
	const kind = text(object.kind)
	const value = object.value
	if (kind === 'quantity') return `${String(value)}${text(object.unit) === '' ? '' : ` ${text(object.unit)}`}`
	return String(value ?? '')
}

/** 一条断言的一行人话:`主体 · 谓词 = 宾语`。 */
export function formatAssertion(lexicon, assertion) {
	if (!isPlainObject(assertion)) return ''
	const predicate = findEntry(lexicon, text(assertion.predicate))
	const label = predicate === null ? text(assertion.predicate) : text(predicate.entry.label) || text(assertion.predicate)
	const subject = isPlainObject(assertion.subject) ? text(assertion.subject.id) : ''
	return `${subject} · ${label} = ${formatObject(assertion.object)}`
}

/**
 * 把一条本体事件折进词汇(返回**新**词汇;调用方通常是已经克隆过状态的折法)。
 *
 * 生命周期只有三个动作,和设计里那三条一一对应:
 *   · `term-added` / `predicate-added` —— 带依据接纳;
 *   · `term-revised` / `predicate-revised` —— **只许改展示信息**(名字、释义、别名)。
 *     语义变化(含义、主词域、值域、单值性)不许走这条路:换 id 重新注册。
 *     稳定 id 的含义在历史上悄悄改变,是对所有旧事实说假话。
 *   · `term-deprecated` / `predicate-deprecated` —— **黏性废止**:没有复活这条路,
 *     要恢复语义就注册新条目。存量事实继续读得通,新断言不许再引用。
 */
export function applyLexiconMutation(lexicon, mutation, at) {
	const next = normalizeLexicon(lexicon)
	const terms = next.terms.map((item) => ({ ...item }))
	const predicates = next.predicates.map((item) => ({ ...item }))
	const output = { terms, predicates }
	/**
	 * 事件名带命名空间(`ontology/term_added`),而这里只认动词本身——
	 * 归一放在一处,而不是让每个调用方各剥一次前缀(剥漏一处,那几个事件就会静默不生效)。
	 */
	const kind = text(mutation?.t).replace(/^ontology\//, '')
	const id = text(mutation?.id)
	const collection = kind === undefined ? [] : kind.startsWith('term') ? terms : kind.startsWith('predicate') ? predicates : []
	const setRevision = (entry, note) => {
		entry.revisions = Array.isArray(entry.revisions) ? entry.revisions.slice() : []
		entry.revisions.push({ version: entry.version ?? 1, label: entry.label ?? null, gloss: entry.gloss ?? null, aliases: Array.isArray(entry.aliases) ? entry.aliases.slice() : null, reason: note, at })
	}
	switch (kind) {
		case 'term_added': {
			terms.push({ id, label: mutation.label ?? id, gloss: mutation.gloss ?? '', aliases: Array.isArray(mutation.aliases) ? mutation.aliases.slice() : [], parent: text(mutation.parent) === '' ? null : text(mutation.parent), status: 'admitted', version: 1, at, basis: mutation.basis ?? null, by: mutation.by ?? null, revisions: [], deprecated: null })
			break
		}
		case 'predicate_added': {
			predicates.push({
				id,
				label: mutation.label ?? id,
				gloss: mutation.gloss ?? '',
				domain: text(mutation.domain) === '' ? null : text(mutation.domain),
				range: isPlainObject(mutation.range) ? clone(mutation.range) : null,
				functional: mutation.functional === true,
				status: 'admitted',
				version: 1,
				at,
				basis: mutation.basis ?? null,
				by: mutation.by ?? null,
				revisions: [],
				deprecated: null,
			})
			break
		}
		case 'term_revised': {
			const entry = terms.find((item) => item.id === id)
			if (entry === undefined || entry.status === 'deprecated') break
			setRevision(entry, mutation.reason ?? null)
			if (mutation.label !== undefined) entry.label = mutation.label
			if (mutation.gloss !== undefined) entry.gloss = mutation.gloss
			if (mutation.aliases !== undefined) entry.aliases = Array.isArray(mutation.aliases) ? mutation.aliases.slice() : []
			entry.version = (entry.version ?? 1) + 1
			entry.at = at
			break
		}
		case 'predicate_revised': {
			const entry = predicates.find((item) => item.id === id)
			if (entry === undefined || entry.status === 'deprecated') break
			setRevision(entry, mutation.reason ?? null)
			if (mutation.label !== undefined) entry.label = mutation.label
			if (mutation.gloss !== undefined) entry.gloss = mutation.gloss
			entry.version = (entry.version ?? 1) + 1
			entry.at = at
			break
		}
		case 'term_deprecated':
		case 'predicate_deprecated': {
			const entry = collection.find((item) => item.id === id)
			if (entry === undefined || entry.status === 'deprecated') break
			entry.status = 'deprecated'
			entry.deprecated = { reason: mutation.reason ?? null, at }
			break
		}
		default:
			return next
	}
	return output
}

/**
 * **领域词汇的货架**(`clear/ontology/domain.md` 的正文)。
 *
 * 为什么它必须是一份纯函数:同一份词汇与事实,谁渲染都得同一串字节——
 * 幂等写盘靠它(内容没变就不重写,文件时间戳是给人的读数),测试也靠它钉住。
 *
 * **三节分开说**(契约冻结第 7 条):概念 / 个体(实例)/ 谓词。从前它们挤在一张「词条」表里,
 * 于是「李赣」「狗熊哆嗦毛(样本)」这类**具体物**与「数值格式」这类**约定**长得一模一样——
 * 读的人分不出哪些是可复用的语言、哪些是一次具体的记录。每节开头一句「这一节是什么」。
 *
 * **零引用的概念单独一节**:注册了却没有任何结论引用它,那它还是约定、不是已知。
 * 这一节是这句话的可见面(只是货架读数,不是缺口)。
 *
 * 第一个参数收两种形状:整份**状态**(推荐,个体那一节要有实体面)或旧的**词汇**;
 * `options.view` 传 `knowledge-view.js` 的 `knowledgeView()` 输出时,「使用」一节读的就是
 * 那份**单一叙述源**(缺口与进度不再由这里各写一套)。
 */
export function describeDomainShelf(lexiconOrState, facts, hypotheses = [], options = {}) {
	const stateForm = isPlainObject(lexiconOrState) && isPlainObject(lexiconOrState.lexicon)
	const state = stateForm ? lexiconOrState : null
	const normalized = normalizeLexicon(stateForm ? state.lexicon : lexiconOrState)
	const rows = Array.isArray(facts) ? facts : []
	const view = isPlainObject(options) && isPlainObject(options.view) ? options.view : null
	const entityAssertions = stateForm && Array.isArray(state.entityAssertions) ? state.entityAssertions : []
	const terms = [...normalized.terms].sort((a, b) => (a.id < b.id ? -1 : 1))
	const predicates = [...normalized.predicates].sort((a, b) => (a.id < b.id ? -1 : 1))
	/**
	 * 实例那一节与图**同一份判据**:直接读投影,不在这里重数一遍。
	 * 没有状态(旧的词汇入口)时如实为空——不知道的事不编。
	 */
	const entityNodes = state === null ? [] : graphProjection(state).nodes.filter((node) => node.layer === 'entity' && node.kind === 'instance')
	/**
	 * **引用面读同一份判据**:概念那一列用 `termUsage`(断言主体 + 主词域 / 值域),
	 * 与零引用那一节完全同源——否则会出现「引用 0 却没进零引用一节」
	 * 这种同一张表里两种读数打架的形状。谓词那一列数的是断言条数。
	 */
	const termRefs = termUsage(normalized, rows, entityAssertions)
	const predicateRefs = new Map()
	for (const fact of rows) {
		for (const assertion of Array.isArray(fact?.assertions) ? fact.assertions : []) {
			const predicate = text(assertion?.predicate)
			if (predicate !== '') predicateRefs.set(predicate, (predicateRefs.get(predicate) ?? 0) + 1)
		}
	}
	for (const item of entityAssertions) {
		const predicate = text(item?.predicate)
		if (predicate !== '') predicateRefs.set(predicate, (predicateRefs.get(predicate) ?? 0) + 1)
	}
	const conflicts = deriveConflicts(rows, normalized)
	/** 零引用的概念:与概念那一列读**同一份**引用面。 */
	const orphans = terms.filter((term) => term.status !== 'deprecated' && (termRefs.get(term.id) ?? 0) === 0)
	const lines = [
		'# 领域本体(项目词汇)',
		'',
		'> 概念与谓词由账本里的本体事件折出来;**这一份是读面,不是权威**——改它不会改词汇。',
		'> 词条只能经具名动词增删改:注册要带依据、修订留版本、废止留缘由且**不会删除**。',
		'> 语义变化(含义、主词域、值域、单值性)必须**换 id**:稳定 id 的含义不许在历史上悄悄改变。',
		'',
	]
	if (terms.length === 0 && predicates.length === 0 && entityNodes.length === 0) {
		lines.push('(还没有词条。先注册概念与谓词,再让假设带上断言——引用不存在的词会在落账之前被拒。)', '')
		return `${lines.join('\n')}`
	}
	lines.push(`## 概念(${terms.length})`, '', '> 这一节是**语言**:可复用的类别与它们之间的 `is_a`。概念是约定,不带证据等级。', '')
	if (terms.length === 0) lines.push('(无)', '')
	else {
		lines.push('| id | 名称 | 释义 | 父概念 | 状态 | 引用 | 依据 |', '|---|---|---|---|---|---|---|')
		for (const term of terms) {
			lines.push(`| \`${term.id}\` | ${escapeCell(term.label ?? term.id)} | ${escapeCell(term.gloss ?? '')} | ${term.parent === null || term.parent === undefined ? '—' : `\`${term.parent}\``} | ${term.status === 'deprecated' ? '**已废止**' : '已接纳'} | ${termRefs.get(term.id) ?? 0} | ${escapeCell(term.basis ?? '—')} |`)
		}
		lines.push('')
	}
	lines.push(`## 个体(实例)(${entityNodes.length})`, '', '> 这一节是**具体物**:某个实例在某出处下成立——它带类型与出处,不是约定,也不能再当概念用。', '')
	if (entityNodes.length === 0) {
		lines.push('(没有实例。在 `clear/ontology/entities/` 下写一个实体文件,它的 `relations` 让它在图上长出边——只有节点没有边,图仍然是空的。)', '')
	} else {
		lines.push('| id | 名称 | 类型 | 来源 | 依据 / 出处 |', '|---|---|---|---|---|')
		for (const node of entityNodes) {
			const registered = node.source === 'registered'
			const evidence = registered ? [node.basis, isPlainObject(node.provenance) ? node.provenance.ref : null].filter((item) => typeof item === 'string' && item !== '').join(' · ') || '—' : node.source === 'asserted' ? '实体断言(有出处,未经独立裁决)' : '已升格事实的断言'
			const sourceText = registered ? '已登记' : node.source === 'asserted' ? '实体断言' : '已升格'
			lines.push(`| \`${node.id}\` | ${escapeCell(node.label ?? node.ref)} | ${text(node.type) === '' ? '—' : `\`${text(node.type)}\``} | ${sourceText} | ${escapeCell(evidence)} |`)
		}
		lines.push('')
	}
	lines.push(`## 谓词(${predicates.length})`, '', '> 这一节是**关系**:谓词说明两个概念/实例之间能说什么,以及它的主词域与值域。', '')
	if (predicates.length === 0) lines.push('(无)', '')
	else {
		lines.push('| id | 名称 | 主词域 | 值域 | 单值 | 状态 | 引用 | 依据 |', '|---|---|---|---|---|---|---|---|')
		for (const predicate of predicates) {
			const range = isPlainObject(predicate.range) ? predicate.range : {}
			const rangeText = text(range.term) !== '' ? `概念 \`${text(range.term)}\`` : `值形态 \`${text(range.form)}\`${text(range.unit) === '' ? '' : `(${text(range.unit)})`}`
			lines.push(`| \`${predicate.id}\` | ${escapeCell(predicate.label ?? predicate.id)} | ${text(predicate.domain) === '' ? '—' : `\`${text(predicate.domain)}\``} | ${rangeText} | ${predicate.functional === true ? '是' : '否'} | ${predicate.status === 'deprecated' ? '**已废止**' : '已接纳'} | ${predicateRefs.get(predicate.id) ?? 0} | ${escapeCell(predicate.basis ?? '—')} |`)
		}
		lines.push('')
	}
	const mermaid = describeDomainGraph(normalized)
	if (mermaid !== '') lines.push('## 图', '', mermaid, '')
	if (orphans.length > 0) {
		lines.push(`## 零引用的概念(${orphans.length})`, '', '> 这一节是**还没被用起来的约定**:没有任何结论引用它们,所以它们今天还不是「已知」。', '')
		for (const term of orphans) lines.push(`- \`${term.id}\`(${escapeCell(term.label ?? term.id)}):要么在断言里用起来,要么在这里如实标出它未被引用`)
		lines.push('')
	}
	const deprecated = [...terms, ...predicates].filter((entry) => entry.status === 'deprecated')
	if (deprecated.length > 0) {
		lines.push('## 已废止(记录保留,新断言不许再引用)', '')
		for (const entry of deprecated) lines.push(`- \`${entry.id}\`:${escapeCell(entry.deprecated?.reason ?? '(未写缘由)')}`)
		lines.push('')
	}
	const typed = rows.filter((fact) => Array.isArray(fact?.assertions) && fact.assertions.length > 0).length
	const propositions = Array.isArray(hypotheses) ? hypotheses : []
	const typedPropositions = propositions.filter((item) => Array.isArray(item?.assertions) && item.assertions.length > 0).length
	lines.push('## 使用', '')
	if (view !== null) {
		/** 单一叙述源:进度 / 缺口 / 下一步都读 `knowledgeView`,这里不再各写一套。 */
		lines.push(`- ${view.headline.now} · ${view.headline.where}`)
		if (Array.isArray(view.gaps) && view.gaps.length > 0) for (const gap of view.gaps) lines.push(`- **${gap.code}**(缺口 ${gap.count}):${gap.detail} → 下一步:${gap.nextAction}`)
		else lines.push('- 结构完整:今天没有欠账(语言 / 实体图 / 断言 / 证据覆盖都不缺)。')
	}
	lines.push(`- 已升格事实里 ${typed}/${rows.length} 条带类型化断言;流转中的命题里 ${typedPropositions}/${propositions.length} 条带断言(未升格,不计入「引用」列)。`)
	if (entityNodes.length > 0) {
		const bySource = { registered: 0, promoted: 0, asserted: 0 }
		for (const node of entityNodes) bySource[node.source] = (bySource[node.source] ?? 0) + 1
		lines.push(`- 实体图:${entityNodes.length} 个实例节点(已登记 ${bySource.registered ?? 0} · 已升格 ${bySource.promoted ?? 0} · 实体断言 ${bySource.asserted ?? 0});${entityAssertions.length} 条实体断言(有出处,未经独立裁决)。`)
	}
	if (conflicts.length > 0) {
		lines.push(`- **冲突 ${conflicts.length} 对**(只暴露,不裁决):`)
		for (const conflict of conflicts) {
			lines.push(`  - \`${conflict.predicate}\` · ${escapeCell(conflict.subject)}:${conflict.sides.map((side) => `${side.fact ?? '?'}(${side.value})`).join(' 对 ')}`)
		}
	}
	return `${lines.join('\n')}`
}

/** 一个表格单元格里的竖线与换行会毁掉整张表,先逃掉。 */
function escapeCell(value) {
	return String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

/**
 * 本体图的 Mermaid 文本(货架里那段)。刻意只画**本体层**:
 * 实体层(实例与断言)在面板上按事实逐条看更清楚,把它塞进一张 Mermaid 会把概念淹没。
 */
export function describeDomainGraph(lexicon) {
	const normalized = normalizeLexicon(lexicon)
	if (normalized.terms.length === 0 && normalized.predicates.length === 0) return ''
	const lines = ['```mermaid', 'flowchart LR']
	const conceptId = (id) => `c_${String(id).replace(/[^A-Za-z0-9_]/g, '_')}`
	const seen = new Set()
	for (const term of [...normalized.terms].sort((a, b) => (a.id < b.id ? -1 : 1))) {
		if (seen.has(conceptId(term.id))) continue
		seen.add(conceptId(term.id))
		lines.push(`    ${conceptId(term.id)}["${escapeCell(term.label ?? term.id)}"]`)
	}
	for (const predicate of [...normalized.predicates].sort((a, b) => (a.id < b.id ? -1 : 1))) {
		const range = isPlainObject(predicate.range) ? predicate.range : {}
		const target = text(range.term) !== '' ? conceptId(text(range.term)) : `v_${text(range.form)}`
		if (text(range.term) === '' && text(range.form) !== '' && !seen.has(`v_${text(range.form)}`)) {
			seen.add(`v_${text(range.form)}`)
			lines.push(`    v_${text(range.form)}(["${text(range.form)}"])`)
		}
		const source = text(predicate.domain) === '' ? null : conceptId(text(predicate.domain))
		if (source === null) {
			/** 没声明主词域的谓词没有源头可画:给一个显式的「任意主体」节点,别画成自环。 */
			if (!seen.has('v_any')) {
				seen.add('v_any')
				lines.push('    v_any(["任意主体"])')
			}
			lines.push(`    v_any -->|"${text(predicate.id)}"| ${target}`)
		} else {
			lines.push(`    ${source} -->|"${text(predicate.id)}${predicate.functional === true ? ' · 单值' : ''}"| ${target}`)
		}
	}
	for (const term of [...normalized.terms].sort((a, b) => (a.id < b.id ? -1 : 1))) {
		const parent = text(term.parent)
		if (parent === '') continue
		lines.push(`    ${conceptId(term.id)} -.->|is_a| ${conceptId(parent)}`)
	}
	lines.push('```', '')
	return lines.join('\n')
}

// ═══ 工作区文件:事实与本体住在项目里 ═══════════════════════════════════════
//
// 会话账本只活在一次会话里,而研究要跨会话攒下来。所以「攒下来的东西」住在工作区的文件里:
//   · `clear/knowledge/facts/<id>.json`:升格的事实,一条一个文件,只有系统写;
//   · `clear/knowledge/lessons/<id>.json`:结案时经独立评估核过的经验,一条一个文件,只有系统写;
//   · `clear/ontology/{concepts,relations,entities}/**.json`:本体,模型用原生文件工具直接写。
// 内核每一拍把这两处的变化折成一条 `workspace/synced` 变更,投影从文件内容派生词汇、实体与
// 事实——折法仍然只吃账本,文件是账本之外唯一的输入,而且进账本时就是一条可重放的事实。

/** 事实文件所在的目录(相对工作区)。 */
export const FACTS_DIR = 'clear/knowledge/facts'
/** 经验文件所在的目录(相对工作区)。 */
export const LESSONS_DIR = 'clear/knowledge/lessons'
/** 经验的四类:坑、要核的读数、会骗人的捷径、先验。 */
export const LESSON_KINDS = ['trap', 'check', 'shortcut', 'prior']
/** 本体文件树的根(相对工作区)。 */
export const ONTOLOGY_DIR = 'clear/ontology'
/** 本体文件树的三支:目录名 → 文件种类。 */
export const ONTOLOGY_BRANCHES = { concepts: 'concept', relations: 'relation', entities: 'entity' }
/** 读面有界:文件数与单个文件的字节数都有上限,超出的如实报成问题,不静默截断。 */
export const WORKSPACE_LIMITS = { files: 2000, bytes: 65536 }

/** FNV-1a(32 位):浏览器与宿主两侧都能算的同步散列,只用来比「变没变」。 */
function hashText(value) {
	let h = 0x811c9dc5
	const source = String(value)
	for (let index = 0; index < source.length; index += 1) {
		h ^= source.charCodeAt(index)
		h = Math.imul(h, 0x01000193) >>> 0
	}
	return h.toString(16).padStart(8, '0')
}

/**
 * 一个词条**含义**的指纹:概念看释义与父概念,谓词看主词域、值域与单值性。
 * 名字、别名、依据不进指纹——改名不改义,事实不必因此复核。
 */
export function definitionFingerprint(entry) {
	if (!isPlainObject(entry)) return null
	/** 单位与形状只在写了时进指纹:没写这两格的旧词条,指纹与从前逐字相同。 */
	const meaning =
		'range' in entry || 'domain' in entry
			? { domain: text(entry.domain), range: isPlainObject(entry.range) ? { term: text(entry.range.term), form: text(entry.range.form), unit: text(entry.range.unit) } : null, functional: entry.functional === true, ...(text(entry.shape) === '' ? {} : { shape: text(entry.shape) }) }
			: { gloss: text(entry.gloss), parent: text(entry.parent), ...(text(entry.unit) === '' ? {} : { unit: text(entry.unit) }) }
	return `fnv:${hashText(JSON.stringify(meaning))}`
}

/** 一组断言用到的词条(谓词、主体类型、宾语类型),各自此刻的含义指纹。 */
export function fingerprintDefinitions(lexicon, assertions, options = {}) {
	const normalized = normalizeLexicon(lexicon)
	const out = {}
	const take = (id) => {
		const key = text(id)
		if (key === '' || key in out) return
		const found = findEntry(normalized, key)
		if (found !== null) out[key] = definitionFingerprint(found.entry)
	}
	for (const assertion of Array.isArray(assertions) ? assertions : []) {
		take(assertion?.predicate)
		take(assertion?.subject?.type)
		take(assertion?.object?.type)
	}
	/**
	 * **按词面挂上**(`options.text`):真跑里模型几乎不给判断写结构化断言,
	 * 只靠断言的话事实与本体是两张互不引用的表,「定义已变」永远触发不了。
	 * 所以升格时也按主张原文里出现的词(id / 名字 / 别名,去空白、不分大小写、至少两个字)
	 * 把概念与关系挂上——与知识预检同一条词面规则,有界、可复核。
	 */
	const said = text(options?.text).replace(/\s+/g, '').toLowerCase()
	if (said !== '') {
		for (const entry of [...(normalized.terms ?? []), ...(normalized.predicates ?? [])]) {
			if (entry?.status === 'deprecated') continue
			const names = [entry?.id, entry?.label, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])].map((name) => text(name).replace(/\s+/g, '').toLowerCase()).filter((name) => name.length >= 2)
			if (names.some((name) => said.includes(name))) take(entry.id)
		}
	}
	return out
}

/** 事实升格以后,它用到的词条里**含义改过或已不在**的那些 id。 */
export function changedDefinitions(lexicon, definitions) {
	if (!isPlainObject(definitions)) return []
	const normalized = normalizeLexicon(lexicon)
	const changed = []
	for (const [id, fingerprint] of Object.entries(definitions)) {
		const found = findEntry(normalized, id)
		if (found === null || definitionFingerprint(found.entry) !== fingerprint) changed.push(id)
	}
	return changed
}

/**
 * 工作区路径 → 它是哪种文件。认不出的返回 null(不是本体也不是事实,不归投影管)。
 * `dirs` 是本体文件在它那一支里的上级目录(由近及远的反序:最后一个就是直接上级)。
 */
export function classifyWorkspacePath(path) {
	const parts = String(path ?? '').replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.')
	if (parts.length === 0 || !parts.at(-1).endsWith('.json')) return null
	const id = parts.at(-1).slice(0, -'.json'.length)
	const facts = FACTS_DIR.split('/')
	if (parts.length === facts.length + 1 && facts.every((part, index) => parts[index] === part)) return { kind: 'fact', id, dirs: [] }
	const lessons = LESSONS_DIR.split('/')
	if (parts.length === lessons.length + 1 && lessons.every((part, index) => parts[index] === part)) return { kind: 'lesson', id, dirs: [] }
	const root = ONTOLOGY_DIR.split('/')
	if (parts.length >= root.length + 2 && root.every((part, index) => parts[index] === part)) {
		const kind = ONTOLOGY_BRANCHES[parts[root.length]]
		if (kind === undefined) return null
		return { kind, id, dirs: parts.slice(root.length + 1, -1) }
	}
	return null
}

/**
 * 事实文件 → 事实行(与 `fact/promoted` 折出来的同形)。复核写在文件的 `status` / `review` 上。
 */
export function factFromFile(data, path) {
	if (!isPlainObject(data) || text(data.id) === '' || text(data.text) === '') return null
	const review = isPlainObject(data.review) ? { decision: data.review.decision === 'retracted' ? 'retracted' : 'kept', reason: data.review.reason ?? null, at: data.review.at ?? null, by: data.review.by ?? 'user' } : null
	return {
		id: text(data.id),
		goal: data.goal ?? null,
		hypothesis: data.hypothesis ?? null,
		text: String(data.text),
		scope: data.scope ?? null,
		level: data.level ?? null,
		evidence: Array.isArray(data.evidence) ? data.evidence : [],
		assertions: Array.isArray(data.assertions) ? clone(data.assertions) : null,
		definitions: isPlainObject(data.definitions) ? clone(data.definitions) : null,
		path: path ?? null,
		at: typeof data.at === 'number' ? data.at : null,
		review,
	}
}

/**
 * 经验文件 → 经验行(与 `lesson/recorded` 折出来的同形)。`status: "retracted"` 的不再推送。
 * 经验改变的是注意力与做法(「这台装置的温度要拿参考读数核」),事实改变的是信念。
 */
export function lessonFromFile(data, path) {
	if (!isPlainObject(data) || text(data.id) === '' || text(data.text) === '') return null
	return {
		id: text(data.id),
		goal: data.goal ?? null,
		text: String(data.text),
		kind: LESSON_KINDS.includes(data.kind) ? data.kind : 'trap',
		about: Array.isArray(data.about) ? data.about.map(String).filter((item) => item.trim() !== '').slice(0, 6) : [],
		evidence: typeof data.evidence === 'string' ? data.evidence : null,
		boundary: typeof data.boundary === 'string' ? data.boundary : null,
		status: data.status === 'retracted' ? 'retracted' : 'active',
		path: path ?? null,
		at: typeof data.at === 'number' ? data.at : null,
	}
}

// ═══ 本体文件树:字段、单文件校验、从文件折出词汇与实体 ═════════════════════════
//
// 本体由模型用原生文件工具直接写,住在 `clear/ontology/{concepts,relations,entities}/` 下:
//   · 命名规则只有一条:`X.json` 描述节点 X,它的子节点放在同级的 `X/` 目录里;
//   · 概念目录嵌套 = is_a,实体目录嵌套 = 组成 / 属于,关系目录只是分组;
//   · 身份是 id(= 文件名),位置是目录。引用只用 id,所以整支目录挪走就是重新分层,引用不断。
// 校验分三道:写入时查**单个文件**(这里的 `checkOntologyFile`,不过就拒写);读取时查**跨文件**
// (`materializeOntology` 的 problems,只提示、有问题的节点或边不进图);升格时把断言涉及的
// 节点全查一遍(就是 `validateAssertions`,不过就不升格)。

/** 实体 id 比概念宽:具体物的名字常带大写与短横(`V-JEPA_2`),但仍是一个文件名能装下的键。 */
const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/
const PROVENANCE_KINDS = ['url', 'named', 'backref']
const ONTOLOGY_STATUS = ['active', 'deprecated']

/**
 * 三种本体文件的字段定义。内核把它铺成 `clear/ontology/SCHEMA.json`(只读),
 * 写入时的校验与这份定义是同一份:字段在这里改,两边一起变。
 */
/**
 * **本体只留能产出预期的东西**:概念分三类,度量必须写单位(释义就是口径);关系分四类,
 * 「影响」带大致形状——预期就从这里来(「温度升,杂质单调升」);「测量」写清怎么核读数。
 */
export const CONCEPT_KINDS = ['category', 'measure', 'phenomenon']
export const RELATION_KINDS = ['affects', 'defines', 'measures', 'manifests_as']
export const RELATION_SHAPES = ['increasing', 'decreasing', 'peak', 'threshold', 'coupled']

export const ONTOLOGY_SCHEMA = bilingual({
	about: [
		'本体文件的字段定义(系统铺设,只读)。命名规则:X.json 描述节点 X,它的子节点放在同级的 X/ 目录里;id 必须等于文件名。概念目录嵌套 = is_a;实体目录嵌套 = 组成 / 属于;关系可以平铺,也可以分目录(只是分组)。引用一律只写 id,挪目录不断引用。写入时只查单个文件;引用断了、类型对不上等跨文件问题在卡片上提示,升格时才拦。',
		'Field definitions for ontology files (laid down by the system, read-only). Naming: X.json describes node X, and its children live in the sibling X/ directory; id must equal the file name. Nested concept directories mean is_a; nested entity directories mean part-of; relations can be flat or grouped in directories (grouping only). References use ids only, so moving directories never breaks them. Writes check a single file; cross-file problems such as broken references or type mismatches are flagged on the card and only block at promotion.',
	],
	concept: {
		where: 'clear/ontology/concepts/**/<id>.json',
		required: {
			id: ['slug:小写字母开头,字母/数字/下划线,≤40,等于文件名', 'slug: starts with a lowercase letter; letters, digits, underscores; ≤40; equals the file name'],
			label: ['给人看的名字', 'the human-readable name'],
			gloss: ['一句话释义:它指什么;度量(良率、收率……)写明口径,也就是怎么算', 'one-sentence gloss: what it refers to; for a measure (yield, conversion …) state its definition, that is, how it is computed'],
		},
		optional: {
			kind: ['category = 类别(反应器、催化剂);measure = 度量(收率、杂质,要写 unit);phenomenon = 现象(漂移、失活)', 'category (reactor, catalyst); measure (yield, impurity; needs unit); phenomenon (drift, deactivation)'],
			unit: ['单位(度量必填,无量纲写 "1")', 'unit (required for a measure; "1" if dimensionless)'],
			aliases: ['别名数组', 'array of aliases'],
			basis: ['依据:哪份材料让这个词成立', 'basis: which material establishes this term'],
			status: 'active | deprecated',
			replaced_by: ['废止后由哪个 id 接替', 'the id that replaces it once deprecated'],
			note: ['备注', 'note'],
		},
		example: {
			id: 'jepa',
			label: ['联合嵌入预测架构', 'Joint-embedding predictive architecture'],
			aliases: ['JEPA'],
			gloss: ['在表示空间里从上下文预测目标的表示,不还原像素', 'predicts the representation of a target from context in representation space, without reconstructing pixels'],
			basis: 'LeCun 2022',
		},
	},
	relation: {
		where: 'clear/ontology/relations/**/<id>.json',
		required: {
			id: ['slug,同概念(概念与关系共用一个 id 空间)', 'slug, as for concepts (concepts and relations share one id space)'],
			label: ['给人看的名字', 'the human-readable name'],
			range: [
				`宾语是哪种东西:一个概念 id(宾语是该概念的实体),或 {"form": ${VALUE_FORMS.map((form) => `"${form}"`).join(' | ')}, "unit"?: "..."}(宾语是字面值)`,
				`what the object is: a concept id (the object is an entity of that concept), or {"form": ${VALUE_FORMS.map((form) => `"${form}"`).join(' | ')}, "unit"?: "..."} (the object is a literal value)`,
			],
		},
		optional: {
			gloss: ['一句话释义', 'one-sentence gloss'],
			kind: ['affects = 影响(一个量怎样随另一个量变);defines = 定义(一个度量怎么算);measures = 测量(哪个仪器测哪个量);manifests_as = 表现为(一个现象在读数上什么样)', 'affects (how one quantity moves with another); defines (how a measure is computed); measures (which instrument reads which quantity); manifests_as (what a phenomenon looks like in the readings)'],
			shape: [`影响的大致形状:${RELATION_SHAPES.join(' | ')};预期从这里来`, `rough shape of an effect: ${RELATION_SHAPES.join(' | ')}; expectations come from it`],
			check: ['测量关系:读数怎么核(参考探头、标样、重复点)', 'for a measurement: how to check the reading (reference probe, standard, repeat point)'],
			domain: ['主语必须是哪个概念(下位概念也算)', 'which concept the subject must be (subconcepts count)'],
			functional: ['true = 单值:同一主语只能有一个取值,两个不同取值会被报成冲突', 'true = single-valued: one value per subject; two different values are reported as a conflict'],
			basis: ['依据', 'basis'],
			status: 'active | deprecated',
			replaced_by: ['接替的 id', 'the replacing id'],
			note: ['备注', 'note'],
		},
		example: { id: 'derived_from', label: ['衍生自', 'derived from'], domain: 'method', range: 'method', functional: false },
	},
	entity: {
		where: 'clear/ontology/entities/**/<id>.json',
		required: {
			id: ['字母或数字开头,字母/数字/下划线/短横,≤60,等于文件名', 'starts with a letter or digit; letters, digits, underscores, hyphens; ≤60; equals the file name'],
			label: ['给人看的名字', 'the human-readable name'],
			type: ['它是哪个概念的实体(概念 id)', 'which concept it is an entity of (concept id)'],
			basis: ['依据:哪份材料让它可以被指认', 'basis: which material lets it be identified'],
			provenance: [
				`出处 {"kind": ${PROVENANCE_KINDS.map((kind) => `"${kind}"`).join(' | ')}, "ref": "链接 / 文献名 / 工作区里的文件"}`,
				`source {"kind": ${PROVENANCE_KINDS.map((kind) => `"${kind}"`).join(' | ')}, "ref": "link / paper name / file in the workspace"}`,
			],
		},
		optional: {
			aliases: ['别名数组', 'array of aliases'],
			history: ['带日期的经历:[{"at": "YYYY-MM-DD", "what": "校准 / 更换 / 发现漂移", "evidence"?: {"kind", "ref"}}]', 'dated history: [{"at": "YYYY-MM-DD", "what": "calibrated / replaced / drift found", "evidence"?: {"kind", "ref"}}]'],
			relations: [
				'它对外的关系,每条一个出处:{"predicate": 关系 id, "object": 另一个实体的 id} 或 {"predicate": 关系 id, "value": 字面值, "unit"?: 单位};两种都要带 "evidence": {"kind", "ref"}',
				'its outgoing relations, each with a source: {"predicate": relation id, "object": another entity id} or {"predicate": relation id, "value": literal, "unit"?: unit}; both need "evidence": {"kind", "ref"}',
			],
			note: ['备注', 'note'],
		},
		example: {
			id: 'v_jepa_2_ac',
			label: 'V-JEPA 2-AC',
			type: 'world_model',
			basis: ['动作条件的 V-JEPA 2', 'action-conditioned V-JEPA 2'],
			provenance: { kind: 'named', ref: 'sources/vjepa2.md' },
			relations: [
				{ predicate: 'derived_from', object: 'v_jepa_2', evidence: { kind: 'named', ref: ['V-JEPA 2 论文', 'V-JEPA 2 paper'] } },
				{ predicate: 'released_year', value: 2025, evidence: { kind: 'named', ref: ['V-JEPA 2 论文', 'V-JEPA 2 paper'] } },
			],
		},
	},
})

const FIELDS = {
	concept: ['id', 'label', 'gloss', 'kind', 'unit', 'aliases', 'basis', 'status', 'replaced_by', 'note'],
	relation: ['id', 'label', 'gloss', 'kind', 'shape', 'check', 'domain', 'range', 'functional', 'basis', 'status', 'replaced_by', 'note'],
	entity: ['id', 'label', 'type', 'basis', 'provenance', 'aliases', 'relations', 'history', 'note'],
}

const RELATION_FIELDS = ['predicate', 'object', 'value', 'unit', 'evidence', 'note']

/** 一个出处对象的形状问题(没有就返回 null)。 */
function evidenceShape(value, at) {
	if (!isPlainObject(value)) return tr(`${at}要是 {"kind", "ref"} 对象`, `${at} must be a {"kind", "ref"} object`)
	if (!PROVENANCE_KINDS.includes(text(value.kind))) return tr(`${at}.kind 只能是 ${PROVENANCE_KINDS.join(' / ')}`, `${at}.kind must be ${PROVENANCE_KINDS.join(' / ')}`)
	if (text(value.ref) === '') return tr(`${at}.ref 不能为空`, `${at}.ref cannot be empty`)
	return null
}

/**
 * **第一道校验:单个文件**。给路径与解析好的内容(或原文),返回问题清单(空 = 通过)。
 * 只查这一个文件自己:JSON 能解析、字段齐且类型对、id 等于文件名、枚举取值合法。
 * 引用指向的东西在不在**不查**——模型改一组文件时中间状态必然暂时不一致,
 * 这时就查跨文件引用,等于逼它按固定顺序写。
 */
export function checkOntologyFile(path, content) {
	const place = classifyWorkspacePath(path)
	if (place === null || place.kind === 'fact' || place.kind === 'lesson') return [tr(`不是本体文件的位置:本体文件要放在 ${ONTOLOGY_DIR}/{concepts,relations,entities}/ 下,扩展名 .json`, `Not an ontology file location: ontology files go under ${ONTOLOGY_DIR}/{concepts,relations,entities}/ with a .json extension`)]
	let data = content
	if (typeof content === 'string') {
		try {
			data = JSON.parse(content)
		} catch (error) {
			return [tr(`不是合法 JSON:${String(error?.message ?? error).slice(0, 160)}`, `Not valid JSON: ${String(error?.message ?? error).slice(0, 160)}`)]
		}
	}
	if (!isPlainObject(data)) return [tr('文件内容要是一个 JSON 对象', 'The file content must be a JSON object')]
	const kind = place.kind
	const problems = []
	const pattern = kind === 'entity' ? ENTITY_ID_PATTERN : ID_PATTERN
	if (!pattern.test(place.id)) problems.push(
			kind === 'entity'
				? tr(`文件名「${place.id}」不能当实体 id:字母或数字开头,只用字母/数字/下划线/短横,≤60`, `File name "${place.id}" cannot be an entity id: start with a letter or digit; letters, digits, underscores, hyphens only; ≤60`)
				: tr(`文件名「${place.id}」不能当 id:小写字母开头,只用小写字母/数字/下划线,≤40`, `File name "${place.id}" cannot be an id: start with a lowercase letter; lowercase letters, digits, underscores only; ≤40`),
		)
	if (data.id !== undefined && text(data.id) !== place.id) problems.push(tr(`id「${text(data.id)}」要等于文件名「${place.id}」(身份就是文件名;改 id 就是改文件名)`, `id "${text(data.id)}" must equal the file name "${place.id}" (identity is the file name; changing the id means renaming the file)`))
	const extra = Object.keys(data).filter((key) => !FIELDS[kind].includes(key))
	if (extra.length > 0) {
		const kindWord = kind === 'concept' ? tr('概念', 'concepts') : kind === 'relation' ? tr('关系', 'relations') : tr('实体', 'entities')
		problems.push(tr(`不认识的字段:${extra.join('、')}(${kindWord}可用:${FIELDS[kind].join('、')};详见 ${ONTOLOGY_DIR}/SCHEMA.json)`, `Unknown fields: ${extra.join(', ')} (${kindWord} allow: ${FIELDS[kind].join(', ')}; see ${ONTOLOGY_DIR}/SCHEMA.json)`))
	}
	if (text(data.label) === '') problems.push(tr('label 必填:给人看的名字', 'label is required: the human-readable name'))
	if (data.aliases !== undefined && (!Array.isArray(data.aliases) || data.aliases.some((alias) => typeof alias !== 'string'))) problems.push(tr('aliases 只能是字符串数组', 'aliases must be an array of strings'))
	for (const key of ['basis', 'gloss', 'note', 'replaced_by']) if (data[key] !== undefined && data[key] !== null && typeof data[key] !== 'string') problems.push(tr(`${key} 只能是字符串`, `${key} must be a string`))
	if (data.status !== undefined && !ONTOLOGY_STATUS.includes(text(data.status))) problems.push(tr(`status 只能是 ${ONTOLOGY_STATUS.join(' / ')}`, `status must be ${ONTOLOGY_STATUS.join(' / ')}`))
	if (kind === 'concept' && text(data.gloss) === '') problems.push(tr('gloss 必填:一句话说清它指什么,不然引用它的人各读各的', 'gloss is required: one sentence on what it refers to, or everyone who cites it reads it differently'))
	if (kind === 'concept') {
		if (data.kind !== undefined && !CONCEPT_KINDS.includes(text(data.kind))) problems.push(tr(`kind 只能是 ${CONCEPT_KINDS.join(' / ')}(类别 / 度量 / 现象)`, `kind must be ${CONCEPT_KINDS.join(' / ')}`))
		if (data.unit !== undefined && typeof data.unit !== 'string') problems.push(tr('unit 只能是字符串', 'unit must be a string'))
		if (text(data.kind) === 'measure' && text(data.unit) === '') problems.push(tr('度量要写 unit(无量纲写 "1"):口径和单位不写下来,「定义已变」就无从发现', 'a measure needs a unit (write "1" if dimensionless): without the definition and unit written down, a changed definition cannot be noticed'))
	}
	if (kind === 'relation') {
		if (data.domain !== undefined && data.domain !== null && !ID_PATTERN.test(text(data.domain))) problems.push(tr('domain 要是一个概念 id', 'domain must be a concept id'))
		if (data.functional !== undefined && typeof data.functional !== 'boolean') problems.push(tr('functional 只能是 true / false', 'functional must be true / false'))
		if (data.kind !== undefined && !RELATION_KINDS.includes(text(data.kind))) problems.push(tr(`kind 只能是 ${RELATION_KINDS.join(' / ')}(影响 / 定义 / 测量 / 表现为)`, `kind must be ${RELATION_KINDS.join(' / ')}`))
		if (data.shape !== undefined && !RELATION_SHAPES.includes(text(data.shape))) problems.push(tr(`shape 只能是 ${RELATION_SHAPES.join(' / ')}(单调升 / 单调降 / 有峰 / 阈值 / 与别的量耦合)`, `shape must be ${RELATION_SHAPES.join(' / ')}`))
		if (data.shape !== undefined && data.kind !== undefined && text(data.kind) !== 'affects') problems.push(tr('shape 只给「影响」(kind=affects)的关系', 'shape only applies to an affects relation (kind=affects)'))
		if (data.check !== undefined && typeof data.check !== 'string') problems.push(tr('check 只能是字符串', 'check must be a string'))
		const range = data.range
		if (typeof range === 'string') {
			if (!ID_PATTERN.test(text(range))) problems.push(tr('range 写成字符串时要是一个概念 id', 'range given as a string must be a concept id'))
		} else if (isPlainObject(range)) {
			const form = text(range.form)
			const term = text(range.term)
			if (form !== '' && term !== '') problems.push(tr('range 只能二选一:一个概念 id,或 {"form"}', 'range is one or the other: a concept id, or {"form"}'))
			else if (term !== '') {
				if (!ID_PATTERN.test(term)) problems.push(tr('range.term 要是一个概念 id', 'range.term must be a concept id'))
			} else if (!VALUE_FORMS.includes(form)) problems.push(tr(`range.form 只能是 ${VALUE_FORMS.join(' / ')}`, `range.form must be ${VALUE_FORMS.join(' / ')}`))
			if (range.unit !== undefined && typeof range.unit !== 'string') problems.push(tr('range.unit 只能是字符串', 'range.unit must be a string'))
		} else problems.push(tr(`range 必填:一个概念 id(宾语是实体),或 {"form": ${VALUE_FORMS.join(' | ')}}(宾语是字面值)`, `range is required: a concept id (the object is an entity), or {"form": ${VALUE_FORMS.join(' | ')}} (the object is a literal value)`))
	}
	if (kind === 'entity') {
		if (!ID_PATTERN.test(text(data.type))) problems.push(tr('type 必填:它是哪个概念的实体(概念 id)', 'type is required: which concept it is an entity of (concept id)'))
		if (text(data.basis) === '') problems.push(tr('basis 必填:实体是观测,要说清哪份材料让它可以被指认', 'basis is required: an entity is an observation, so say which material identifies it'))
		const shape = evidenceShape(data.provenance, 'provenance')
		if (shape !== null) problems.push(tr(`${shape}(实体没有出处就进不了图)`, `${shape} (an entity without a source cannot enter the graph)`))
		if (data.history !== undefined) {
			if (!Array.isArray(data.history)) problems.push(tr('history 只能是数组', 'history must be an array'))
			else
				data.history.forEach((item, index) => {
					if (!isPlainObject(item) || !/^\d{4}-\d{2}-\d{2}/.test(text(item.at)) || text(item.what) === '') problems.push(tr(`history[${index}] 要是 {"at": "YYYY-MM-DD", "what": "发生了什么"}`, `history[${index}] must be {"at": "YYYY-MM-DD", "what": "what happened"}`))
				})
		}
		if (data.relations !== undefined) {
			if (!Array.isArray(data.relations)) problems.push(tr('relations 只能是数组', 'relations must be an array'))
			else
				data.relations.forEach((relation, index) => {
					const at = `relations[${index}]`
					if (!isPlainObject(relation)) return problems.push(tr(`${at} 要是对象`, `${at} must be an object`))
					const unknown = Object.keys(relation).filter((key) => !RELATION_FIELDS.includes(key))
					if (unknown.length > 0) problems.push(tr(`${at} 不认识的字段:${unknown.join('、')}(可用:${RELATION_FIELDS.join('、')})`, `${at} has unknown fields: ${unknown.join(', ')} (allowed: ${RELATION_FIELDS.join(', ')})`))
					if (!ID_PATTERN.test(text(relation.predicate))) problems.push(tr(`${at}.predicate 要是一个关系 id`, `${at}.predicate must be a relation id`))
					const hasObject = relation.object !== undefined
					const hasValue = relation.value !== undefined
					if (hasObject === hasValue) problems.push(tr(`${at} 要么给 object(另一个实体的 id),要么给 value(字面值),二选一`, `${at} needs exactly one of object (another entity id) or value (a literal)`))
					else if (hasObject && !ENTITY_ID_PATTERN.test(text(relation.object))) problems.push(tr(`${at}.object 要是一个实体 id`, `${at}.object must be an entity id`))
					if (relation.unit !== undefined && typeof relation.unit !== 'string') problems.push(tr(`${at}.unit 只能是字符串`, `${at}.unit must be a string`))
					const evidence = evidenceShape(relation.evidence, `${at}.evidence`)
					if (evidence !== null) problems.push(tr(`${evidence}(一条关系一个出处;没有出处的话是意见,不是观测)`, `${evidence} (one source per relation; without a source it is an opinion, not an observation)`))
				})
		}
	}
	return problems
}

/** 关系文件的值域 → 词汇里的值域形状(`{term}` 或 `{form, unit?}`)。 */
function rangeOf(range) {
	if (typeof range === 'string') return { term: text(range) }
	if (!isPlainObject(range)) return null
	if (text(range.term) !== '') return { term: text(range.term) }
	return text(range.unit) === '' ? { form: text(range.form) } : { form: text(range.form), unit: text(range.unit) }
}

/**
 * **从工作区文件折出本体**(第二道校验在这里):词汇(概念 + 关系)、实体、实体断言、问题清单。
 *
 * 读的是 `state.workspace.files`(路径 → `{digest, data|error}`),所以它是纯函数:
 * 同一批文件永远折出同一张图。跨文件的问题只**提示**,有问题的节点或边不进图——
 * 图上画出来的每一样东西都是这门语言认得的。
 */
export function materializeOntology(files) {
	const problems = []
	const flag = (path, id, code, detail, severity = 'warning') => problems.push({ path, id, code, detail, severity })
	const entries = Object.entries(isPlainObject(files) ? files : {})
		.map(([path, file]) => ({ path, file, place: classifyWorkspacePath(path) }))
		.filter((item) => item.place !== null && item.place.kind !== 'fact' && item.place.kind !== 'lesson')
		.sort((a, b) => (a.path < b.path ? -1 : 1))
	const terms = []
	const predicates = []
	const entityRows = []
	const ids = new Map()
	for (const { path, file, place } of entries) {
		if (file?.error !== undefined && file?.error !== null) {
			flag(path, place.id, 'file_unreadable', String(file.error), 'error')
			continue
		}
		const shape = checkOntologyFile(path, file?.data)
		if (shape.length > 0) {
			flag(path, place.id, 'file_invalid', shape.join(';'), 'error')
			continue
		}
		const data = file.data
		/** 概念与关系共用一个 id 空间(断言里谓词与类型都是这里的名字);实体自成一个空间。 */
		const space = place.kind === 'entity' ? 'entity' : 'lexicon'
		const key = `${space}:${place.id}`
		if (ids.has(key)) {
			flag(path, place.id, 'duplicate_id', tr(`id「${place.id}」重复了:${ids.get(key)} 已经用了它(这一份不进图)`, `Duplicate id "${place.id}": ${ids.get(key)} already uses it (this one stays off the graph)`), 'error')
			continue
		}
		ids.set(key, path)
		const status = text(data.status) === 'deprecated' ? 'deprecated' : 'admitted'
		const parent = place.dirs.length === 0 ? null : place.dirs.at(-1)
		if (place.kind === 'concept') {
			terms.push({ id: place.id, label: text(data.label), gloss: text(data.gloss), ...(CONCEPT_KINDS.includes(text(data.kind)) ? { kind: text(data.kind) } : {}), ...(text(data.unit) === '' ? {} : { unit: text(data.unit) }), aliases: Array.isArray(data.aliases) ? data.aliases.map(String) : [], parent, status, basis: text(data.basis) || null, replacedBy: text(data.replaced_by) || null, path })
		} else if (place.kind === 'relation') {
			predicates.push({ id: place.id, label: text(data.label), gloss: text(data.gloss), ...(RELATION_KINDS.includes(text(data.kind)) ? { kind: text(data.kind) } : {}), ...(RELATION_SHAPES.includes(text(data.shape)) ? { shape: text(data.shape) } : {}), ...(text(data.check) === '' ? {} : { check: text(data.check) }), domain: text(data.domain) || null, range: rangeOf(data.range), functional: data.functional === true, status, basis: text(data.basis) || null, replacedBy: text(data.replaced_by) || null, path })
		} else {
			entityRows.push({ place, path, data, parent })
		}
	}
	const lexicon = { terms, predicates }
	for (const term of terms) {
		if (term.parent === null) continue
		const found = findEntry(lexicon, term.parent)
		if (found === null || found.kind !== 'term') flag(term.path, term.id, 'dangling_parent', tr(`它放在目录「${term.parent}/」里,但没有概念文件 ${term.parent}.json:上一层不成立`, `It sits in directory "${term.parent}/" but there is no concept file ${term.parent}.json: the level above does not hold`), 'info')
	}
	for (const predicate of predicates) {
		if (predicate.domain !== null && findEntry(lexicon, predicate.domain)?.kind !== 'term') flag(predicate.path, predicate.id, 'dangling_domain', tr(`主语概念「${predicate.domain}」不存在`, `Subject concept "${predicate.domain}" does not exist`))
		const term = text(predicate.range?.term)
		if (term !== '' && findEntry(lexicon, term)?.kind !== 'term') flag(predicate.path, predicate.id, 'dangling_range', tr(`宾语概念「${term}」不存在`, `Object concept "${term}" does not exist`))
	}
	const entities = []
	const entityById = new Map()
	for (const { place, path, data, parent } of entityRows) {
		const type = text(data.type)
		const typeEntry = findEntry(lexicon, type)
		if (typeEntry === null || typeEntry.kind !== 'term') {
			flag(path, place.id, 'entity_type_unknown', tr(`类型「${type}」不是已有的概念:先写概念文件,这个实体才进图`, `Type "${type}" is not an existing concept: write the concept file first, then this entity enters the graph`))
			continue
		}
		const entity = { id: place.id, type, label: text(data.label), basis: text(data.basis), provenance: { kind: text(data.provenance.kind), ref: text(data.provenance.ref) }, aliases: Array.isArray(data.aliases) ? data.aliases.map(String) : [], parent, path, relations: Array.isArray(data.relations) ? data.relations : [] }
		entities.push(entity)
		entityById.set(entity.id, entity)
	}
	const entityAssertions = []
	const functionalSeen = new Map()
	for (const entity of entities) {
		if (entity.parent !== null && !entityById.has(entity.parent)) flag(entity.path, entity.id, 'dangling_container', tr(`它放在目录「${entity.parent}/」里,但没有实体文件 ${entity.parent}.json:「属于」这一层不成立`, `It sits in directory "${entity.parent}/" but there is no entity file ${entity.parent}.json: the part-of level does not hold`), 'info')
		entity.relations.forEach((relation, index) => {
			const predicateId = text(relation.predicate)
			const found = findEntry(lexicon, predicateId)
			const where = tr(`${entity.id} 的第 ${index + 1} 条关系`, `relation ${index + 1} of ${entity.id}`)
			if (found === null || found.kind !== 'predicate') {
				flag(entity.path, entity.id, 'relation_unknown', tr(`${where}:关系「${predicateId}」没有关系文件`, `${where}: relation "${predicateId}" has no relation file`))
				return
			}
			let object
			if (relation.object !== undefined) {
				const target = entityById.get(text(relation.object))
				if (target === undefined) {
					flag(entity.path, entity.id, 'dangling_object', tr(`${where}:宾语实体「${text(relation.object)}」不存在(或它自己没进图)`, `${where}: object entity "${text(relation.object)}" does not exist (or is itself off the graph)`))
					return
				}
				object = { kind: 'instance', value: target.id, type: target.type }
			} else {
				const form = text(found.entry.range?.form) || (typeof relation.value === 'number' ? 'quantity' : 'statement')
				object = { kind: form, value: relation.value }
				const unit = text(relation.unit) || text(found.entry.range?.unit)
				if (unit !== '') object.unit = unit
			}
			const assertion = { id: `${entity.id}#${index + 1}`, subject: { id: entity.id, type: entity.type }, predicate: predicateId, object, evidence: { kind: text(relation.evidence.kind), ref: text(relation.evidence.ref) } }
			const invalid = validateAssertion(lexicon, assertion)
			if (invalid.length > 0) {
				flag(entity.path, entity.id, 'relation_invalid', `${where}:${invalid.join(';')}`)
				return
			}
			if (found.entry.functional === true) {
				const key = `${predicateId}\u0000${entity.id}`
				const value = objectKey(object)
				if (functionalSeen.has(key) && functionalSeen.get(key) !== value) flag(entity.path, entity.id, 'functional_conflict', tr(`${where}:「${predicateId}」是单值关系,${entity.id} 却有两个取值(${functionalSeen.get(key)} 与 ${value})`, `${where}: "${predicateId}" is single-valued, but ${entity.id} has two values (${functionalSeen.get(key)} and ${value})`))
				functionalSeen.set(key, value)
			}
			entityAssertions.push(assertion)
		})
	}
	return {
		lexicon,
		entities: entities.map(({ relations, ...entity }) => entity),
		entityAssertions,
		problems,
	}
}

/**
 * **本体大纲**(卡片上那一段):概念树与实体树的前两层,每一支标上它底下有多少个节点;
 * 关系只报总数。模型一眼看得出哪里深、哪里平、哪些节点还散在顶层——
 * 「让模型感受到结构」的全部做法就是这一段,有上限,细节它自己去读文件。
 */
export function ontologyOutline(state, limit = 12) {
	const lexicon = normalizeLexicon(state?.lexicon)
	const entities = Array.isArray(state?.entities) ? state.entities : []
	const tree = (nodes, parentOf) => {
		const children = new Map()
		for (const node of nodes) {
			const parent = parentOf(node)
			const key = parent !== null && nodes.some((item) => item.id === parent) ? parent : null
			children.set(key, [...(children.get(key) ?? []), node.id])
		}
		const count = (id) => (children.get(id) ?? []).reduce((sum, child) => sum + 1 + count(child), 0)
		const roots = (children.get(null) ?? []).sort()
		const shown = roots.slice(0, limit).map((id) => {
			const kids = (children.get(id) ?? []).sort()
			const below = count(id)
			const sub = kids.slice(0, 6).map((kid) => (count(kid) > 0 ? `${kid}(${count(kid)})` : kid))
			return below === 0 ? id : tr(`${id}(${below}):${sub.join('、')}${kids.length > 6 ? ` 等 ${kids.length} 支` : ''}`, `${id} (${below}): ${sub.join(', ')}${kids.length > 6 ? ` and more, ${kids.length} branches` : ''}`)
		})
		return { total: nodes.length, roots: roots.length, lines: shown, more: Math.max(0, roots.length - limit) }
	}
	return {
		concepts: tree(lexicon.terms, (term) => text(term.parent) || null),
		relations: lexicon.predicates.length,
		entities: tree(entities, (entity) => text(entity.parent) || null),
		assertions: Array.isArray(state?.entityAssertions) ? state.entityAssertions.length : 0,
		problems: Array.isArray(state?.ontologyProblems) ? state.ontologyProblems.length : 0,
	}
}
