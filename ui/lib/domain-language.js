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

/** 字面值的五种形态。断言客体如果是**值**,必是其中之一。 */
export const VALUE_FORMS = ['statement', 'quantity', 'formula', 'code', 'reference']

/**
 * 断言客体可以是**值**(上面五种),也可以是**另一个实例**(关系谓词的宾语,
 * 例如「A 是 B 的一部分」)。`instance` 因此不是第六种「值形态」,而是关系谓词的对象形态。
 */
export const OBJECT_KINDS = [...VALUE_FORMS, 'instance']

/** 词条的两种角色。它们共用同一条生命周期(接纳 → 修订 → 黏性废止)。 */
export const LEXICON_KINDS = ['term', 'predicate']

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
	const at = '概念'
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

/** 客体形态与谓词值域是否相容。 */
function objectProblems(predicate, object) {
	const problems = []
	if (!isPlainObject(object)) return [problem('object_required', '断言要有宾语')]
	const kind = text(object.kind)
	if (!OBJECT_KINDS.includes(kind)) return [problem('object_kind_unknown', `宾语形态「${kind}」不认识(可用:${OBJECT_KINDS.join(' / ')})`)]
	const range = isPlainObject(predicate.range) ? predicate.range : {}
	const rangeTerm = text(range.term)
	const rangeForm = text(range.form)
	if (rangeTerm !== '') {
		if (kind !== 'instance') return [problem('object_form_mismatch', `谓词「${predicate.id}」的宾语是概念「${rangeTerm}」的实例,宾语形态应为 instance`)]
		const type = text(object.type)
		if (type !== '' && type !== rangeTerm) return [problem('object_type_mismatch', `宾语实例的类型「${type}」与谓词值域「${rangeTerm}」不一致`)]
		if (text(object.value) === '') return [problem('object_value_required', '宾语实例要有名称')]
		return []
	}
	if (rangeForm !== '' && kind !== rangeForm) return [problem('object_form_mismatch', `谓词「${predicate.id}」的值形态是 ${rangeForm},宾语却是 ${kind}`)]
	switch (kind) {
		case 'statement':
			if (text(object.value) === '') problems.push(problem('object_value_required', '陈述不能为空'))
			else if (String(object.value).length > 2000) problems.push(problem('object_value_too_long', '陈述超过 2000 字:把它拆成断言,或把长文放证据里'))
			break
		case 'quantity':
			if (typeof object.value !== 'number' || !Number.isFinite(object.value)) problems.push(problem('object_quantity_shape', '量形态的 value 必须是有限数值'))
			if (text(object.unit) === '') problems.push(problem('object_unit_required', '量形态要带单位:没有单位的数不是量'))
			break
		case 'formula':
			if (text(object.value) === '') problems.push(problem('object_value_required', '公式不能为空'))
			break
		case 'code':
			if (text(object.value) === '') problems.push(problem('object_value_required', 'code 形态要指向工作区里的一个文件,不能为空'))
			else if (/^([/\\]|[A-Za-z]:[\\/])/.test(text(object.value))) problems.push(problem('object_code_absolute', 'code 形态要写工作区内的相对路径:绝对路径换个工作区就没了'))
			else if (text(object.value).split(/[/\\]/).includes('..')) problems.push(problem('object_code_escape', 'code 形态不许越出工作区(路径里出现了 ..)'))
			break
		case 'reference':
			if (text(object.value) === '') problems.push(problem('object_value_required', '引用不能为空'))
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
	if (!isPlainObject(assertion)) return [problem('assertion_shape', '断言必须是一个对象')]
	const predicateId = text(assertion.predicate)
	if (predicateId === '') return [problem('predicate_required', '断言要写谓词')]
	const found = findEntry(lexicon, predicateId)
	if (found === null) return [problem('predicate_unknown', `谓词「${predicateId}」还没登记`)]
	if (found.kind !== 'predicate') return [problem('predicate_not_predicate', `「${predicateId}」是个概念,不能当谓词用`)]
	const predicate = found.entry
	if (!isUsable(predicate)) problems.push(problem('predicate_deprecated', `谓词「${predicateId}」已废止:新断言不能再用它`))
	const subject = assertion.subject
	if (!isPlainObject(subject) || text(subject.id) === '') problems.push(problem('subject_required', '断言要有主体(至少一个名称)'))
	else {
		const domain = text(predicate.domain)
		const type = text(subject.type)
		if (domain !== '') {
			if (type === '') problems.push(problem('subject_type_required', `谓词「${predicateId}」声明了主词域「${domain}」,主体要写明 type`))
			else if (type !== domain) problems.push(problem('subject_type_mismatch', `主体类型「${type}」与主词域「${domain}」不一致`))
		}
		if (type !== '') {
			const typeEntry = findEntry(lexicon, type)
			if (typeEntry === null) problems.push(problem('subject_type_unknown', `主体类型「${type}」还没登记`))
			else if (typeEntry.kind !== 'term') problems.push(problem('subject_type_not_term', `主体类型「${type}」是个谓词`))
			else if (!isUsable(typeEntry.entry)) problems.push(problem('subject_type_deprecated', `主体类型「${type}」已废止`))
		}
	}
	problems.push(...objectProblems(predicate, assertion.object))
	if (assertion.qualifiers !== undefined && assertion.qualifiers !== null && !isPlainObject(assertion.qualifiers)) problems.push(problem('qualifiers_shape', 'qualifiers 只能是对象(限定条件:时间、工况、适用范围)'))
	return problems
}

/**
 * 一条事实的**整组**断言是否自洽。除了逐条校验,还查「同一主体同一谓词给了两个值」——
 * 单值谓词上这已经是自相矛盾,不该等到与别的事实比才发现。
 */
export function validateAssertions(lexicon, assertions) {
	if (assertions === undefined || assertions === null) return []
	if (!Array.isArray(assertions)) return [problem('assertions_shape', 'assertions 只能是数组')]
	if (assertions.length === 0) return []
	const problems = []
	const seen = new Map()
	for (const [index, assertion] of assertions.entries()) {
		for (const item of validateAssertion(lexicon, assertion)) problems.push(`断言 ${index + 1} · ${item}`)
		const key = `${text(assertion?.predicate)}\u0000${subjectKey(assertion)}`
		const value = objectKey(assertion?.object)
		if (seen.has(key) && seen.get(key) !== value) {
			problems.push(problem('assertion_self_conflict', `同一事实里「${text(assertion?.predicate)}」在主体「${text(assertion?.subject?.id)}」上给了两个值:${seen.get(key)} 与 ${value}`))
		}
		seen.set(key, value)
	}
	return problems
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
		if (walk.cycle !== null) issues.push({ kind: 'cycle', severity: 'warning', id: term.id, detail: `is_a 父链成环(回到「${walk.cycle}」)` })
		else if (walk.missing !== null) issues.push({ kind: 'dangling_parent', severity: 'warning', id: term.id, detail: `父概念「${walk.missing}」不在词汇里` })
	}
	for (const predicate of normalized.predicates) {
		const domain = text(predicate.domain)
		const range = isPlainObject(predicate.range) ? predicate.range : {}
		if (domain !== '') {
			usedTerms.add(domain)
			if (findEntry(normalized, domain) === null) issues.push({ kind: 'dangling_domain', severity: 'warning', id: predicate.id, detail: `主词域「${domain}」不在词汇里` })
		}
		const rangeTerm = text(range.term)
		if (rangeTerm !== '') {
			usedTerms.add(rangeTerm)
			if (findEntry(normalized, rangeTerm) === null) issues.push({ kind: 'dangling_range', severity: 'warning', id: predicate.id, detail: `宾语域「${rangeTerm}」不在词汇里` })
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
				if (!retracted) issues.push({ kind: 'unknown_predicate_in_fact', severity: 'warning', id: String(fact.id ?? ''), detail: `事实里用了没登记的谓词「${predicateId}」` })
				continue
			}
			if (predicate.entry.status === 'deprecated' && !retracted) issues.push({ kind: 'deprecated_in_use', severity: 'info', id: predicateId, detail: `已废止的「${predicateId}」仍被事实「${String(fact.id ?? '')}」引用(记录保留,不再新增)` })
		}
	}
	for (const term of normalized.terms) {
		if (term.status === 'deprecated') continue
		if (!usedTerms.has(term.id) && !normalized.predicates.some((item) => text(item.domain) === term.id || text(item.range?.term) === term.id)) {
			issues.push({ kind: 'unused', severity: 'info', id: term.id, detail: '还没有任何谓词或事实引用它' })
		}
	}
	for (const predicate of normalized.predicates) {
		if (predicate.status === 'deprecated') continue
		if (!usedPredicates.has(predicate.id)) issues.push({ kind: 'unused', severity: 'info', id: predicate.id, detail: '还没有任何事实用它' })
	}
	return issues.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind < b.kind ? -1 : 1))
}

/**
 * **图是投影,不是存储**:同一份账本,永远算出同一组节点、同一组边、同一套默认坐标。
 *
 * 两层分开画(设计里那条最主要的错误就是把它们画成同一种边):
 *   · 词汇层:概念是节点、`is_a` 与谓词是边;
 *   · 知识层:实例是节点、断言是边,边上带那条事实的认识论读数(等级 / 复核态)。
 *
 * 坐标是**确定性布局**:按 `is_a` 深度分层,层内按 id 排序,实例排在最下面一行行铺开。
 * 用户临时拖拽只改当前界面——布局不是知识,不进账本。
 */
export function graphProjection(state) {
	const lexicon = normalizeLexicon(state?.lexicon)
	const facts = Array.isArray(state?.facts) ? state.facts : []
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
	for (const term of terms) nodes.push({ id: `term:${term.id}`, kind: 'concept', ref: term.id, label: term.label ?? term.id, status: term.status ?? 'admitted', parent: text(term.parent) === '' ? null : text(term.parent), uses: uses.get(term.id) ?? 0, depth: depthOf(term) })
	const formsUsed = VALUE_FORMS.filter((form) => predicates.some((item) => text(item.range?.form) === form))
	for (const [index, form] of formsUsed.entries()) nodes.push({ id: `form:${form}`, kind: 'value_type', ref: form, label: form, status: 'admitted', uses: 0, depth: 0, formIndex: index })
	for (const term of terms) {
		if (text(term.parent) === '') continue
		if (!termById.has(text(term.parent))) continue
		edges.push({ id: `is_a:${term.id}`, kind: 'is_a', predicate: null, label: 'is_a', from: `term:${term.id}`, to: `term:${term.parent}`, status: term.status ?? 'admitted' })
	}
	for (const predicate of predicates) {
		const range = isPlainObject(predicate.range) ? predicate.range : {}
		const rangeTerm = text(range.term)
		const form = text(range.form)
		const to = rangeTerm !== '' ? `term:${rangeTerm}` : form !== '' ? `form:${form}` : null
		if (to !== null) edges.push({ id: `predicate:${predicate.id}`, kind: 'predicate', predicate: predicate.id, label: predicate.label ?? predicate.id, from: text(predicate.domain) === '' ? null : `term:${text(predicate.domain)}`, to, status: predicate.status ?? 'admitted', functional: predicate.functional === true })
	}
	const instances = new Map()
	for (const fact of facts) {
		const status = fact?.review?.decision === 'retracted' ? 'retracted' : fact?.refuted === true ? 'refuted' : 'live'
		for (const assertion of Array.isArray(fact?.assertions) ? fact.assertions : []) {
			const subject = isPlainObject(assertion?.subject) ? assertion.subject : {}
			const subjectId = text(subject.id)
			if (subjectId === '') continue
			const key = `${text(subject.type)}|${subjectId}`
			if (!instances.has(key)) instances.set(key, { id: key, kind: 'instance', ref: subjectId, label: subjectId, type: text(subject.type) === '' ? null : text(subject.type), facts: [] })
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
					if (!instances.has(objectKeyId)) instances.set(objectKeyId, { id: objectKeyId, kind: 'instance', ref: objectLabel, label: objectLabel, type: objectType === '' ? null : objectType, facts: [] })
					instances.get(objectKeyId).facts.push(fact.id ?? null)
					to = objectKeyId
				}
			} else if (predicateId !== '') {
				const literalId = `${predicateId}:${objectKey(assertion.object)}`
				if (!instances.has(literalId)) instances.set(literalId, { id: literalId, kind: 'literal', ref: objectKey(assertion.object), label: formatObject(object), type: null, facts: [] })
				instances.get(literalId).facts.push(fact.id ?? null)
				to = literalId
			}
			if (to !== null) edges.push({ id: `assertion:${fact.id ?? ''}:${predicateId}:${subjectKey(assertion)}`, kind: 'assertion', predicate: predicateId, label: text(lexicon.predicates.find((item) => item.id === predicateId)?.label) || predicateId, from: key, to, status, level: fact.level ?? null, fact: fact.id ?? null, scope: fact.scope ?? null })
		}
	}
	for (const instance of [...instances.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) nodes.push(instance)
	const maxDepth = nodes.reduce((best, node) => (node.kind === 'concept' ? Math.max(best, node.depth) : best), 0)
	const COLUMN = 220
	const ROW = 132
	const byDepth = new Map()
	for (const node of nodes.filter((item) => item.kind === 'concept')) {
		const list = byDepth.get(node.depth) ?? []
		list.push(node)
		byDepth.set(node.depth, list)
	}
	const widest = Math.max(...[...byDepth.values()].map((list) => list.length), 1)
	for (const [depth, list] of byDepth) {
		list.forEach((node, index) => {
			node.x = Math.round(index * COLUMN + (widest - list.length) * (COLUMN / 2))
			node.y = depth * ROW
		})
	}
	nodes.filter((item) => item.kind === 'value_type').forEach((node) => {
		node.x = Math.round(node.formIndex * COLUMN)
		node.y = (maxDepth + 1) * ROW
	})
	const instanceBand = (maxDepth + 2) * ROW
	const perRow = 6
	nodes.filter((item) => item.kind === 'instance' || item.kind === 'literal').forEach((node, index) => {
		node.x = (index % perRow) * COLUMN
		node.y = instanceBand + Math.floor(index / perRow) * ROW
	})
	const width = Math.max(...nodes.map((node) => (typeof node.x === 'number' ? node.x : 0)), 0) + COLUMN
	const height = Math.max(...nodes.map((node) => (typeof node.y === 'number' ? node.y : 0)), 0) + ROW
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
 * 三件事按顺序说:有什么词(概念 / 谓词)、它们长什么样(图)、用起来什么情况(引用与冲突)。
 * **不写"权威"二字就够了吗**:不够——所以抬头先写明这一份是读面,
 * 改它不会改词汇,词汇只认账本事件。
 */
export function describeDomainShelf(lexicon, facts, hypotheses = []) {
	const normalized = normalizeLexicon(lexicon)
	const rows = Array.isArray(facts) ? facts : []
	const terms = [...normalized.terms].sort((a, b) => (a.id < b.id ? -1 : 1))
	const predicates = [...normalized.predicates].sort((a, b) => (a.id < b.id ? -1 : 1))
	const usage = new Map()
	for (const fact of rows) {
		for (const assertion of Array.isArray(fact?.assertions) ? fact.assertions : []) {
			const predicate = text(assertion?.predicate)
			if (predicate !== '') usage.set(predicate, (usage.get(predicate) ?? 0) + 1)
			const type = text(assertion?.subject?.type)
			if (type !== '') usage.set(type, (usage.get(type) ?? 0) + 1)
		}
	}
	const conflicts = deriveConflicts(rows, normalized)
	const lines = [
		'# 领域本体(项目词汇)',
		'',
		'> 概念与谓词由账本里的本体事件折出来;**这一份是读面,不是权威**——改它不会改词汇。',
		'> 词条只能经具名动词增删改:注册要带依据、修订留版本、废止留缘由且**不会删除**。',
		'> 语义变化(含义、主词域、值域、单值性)必须**换 id**:稳定 id 的含义不许在历史上悄悄改变。',
		'',
	]
	if (terms.length === 0 && predicates.length === 0) {
		lines.push('(还没有词条。先注册概念与谓词,再让假设带上断言——引用不存在的词会在落账之前被拒。)', '')
		return `${lines.join('\n')}`
	}
	lines.push(`## 概念(${terms.length})`, '')
	if (terms.length === 0) lines.push('(无)', '')
	else {
		lines.push('| id | 名称 | 释义 | 父概念 | 状态 | 引用 | 依据 |', '|---|---|---|---|---|---|---|')
		for (const term of terms) {
			lines.push(`| \`${term.id}\` | ${escapeCell(term.label ?? term.id)} | ${escapeCell(term.gloss ?? '')} | ${term.parent === null || term.parent === undefined ? '—' : `\`${term.parent}\``} | ${term.status === 'deprecated' ? '**已废止**' : '已接纳'} | ${usage.get(term.id) ?? 0} | ${escapeCell(term.basis ?? '—')} |`)
		}
		lines.push('')
	}
	lines.push(`## 谓词(${predicates.length})`, '')
	if (predicates.length === 0) lines.push('(无)', '')
	else {
		lines.push('| id | 名称 | 主词域 | 值域 | 单值 | 状态 | 引用 | 依据 |', '|---|---|---|---|---|---|---|---|')
		for (const predicate of predicates) {
			const range = isPlainObject(predicate.range) ? predicate.range : {}
			const rangeText = text(range.term) !== '' ? `概念 \`${text(range.term)}\`` : `值形态 \`${text(range.form)}\`${text(range.unit) === '' ? '' : `(${text(range.unit)})`}`
			lines.push(`| \`${predicate.id}\` | ${escapeCell(predicate.label ?? predicate.id)} | ${text(predicate.domain) === '' ? '—' : `\`${text(predicate.domain)}\``} | ${rangeText} | ${predicate.functional === true ? '是' : '否'} | ${predicate.status === 'deprecated' ? '**已废止**' : '已接纳'} | ${usage.get(predicate.id) ?? 0} | ${escapeCell(predicate.basis ?? '—')} |`)
		}
		lines.push('')
	}
	const mermaid = describeDomainGraph(normalized)
	if (mermaid !== '') lines.push('## 图', '', mermaid, '')
	const deprecated = [...terms, ...predicates].filter((entry) => entry.status === 'deprecated')
	if (deprecated.length > 0) {
		lines.push('## 已废止(记录保留,新断言不许再引用)', '')
		for (const entry of deprecated) lines.push(`- \`${entry.id}\`:${escapeCell(entry.deprecated?.reason ?? '(未写缘由)')}`)
		lines.push('')
	}
	const typed = rows.filter((fact) => Array.isArray(fact?.assertions) && fact.assertions.length > 0).length
	const propositions = Array.isArray(hypotheses) ? hypotheses : []
	const typedPropositions = propositions.filter((item) => Array.isArray(item?.assertions) && item.assertions.length > 0).length
	lines.push('## 使用', '', `- 已升格事实里 ${typed}/${rows.length} 条带类型化断言;流转中的命题里 ${typedPropositions}/${propositions.length} 条带断言(未升格,不计入「引用」列)。`)
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
 * 词汇图的 Mermaid 文本(货架里那段)。刻意只画**词汇层**:
 * 知识层(实例与断言)在面板上按事实逐条看更清楚,把它塞进一张 Mermaid 会把词汇淹没。
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
