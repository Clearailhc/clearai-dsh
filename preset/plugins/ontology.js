/**
 * 本体声明:把「有哪些对象、哪些状态、谁能发起哪条转移、每一级谁来判」
 * 从散文变成**装配期可校验的数据**。
 *
 * 为什么它得进插件:本体以**声明数据**的形式进入插件平面,插件里那堆散在
 * `fold.js` 与内核里的状态语义第一次有了**一处可校验的出处**:
 *   · 装机时(`apply`)就校验形状:初始态在状态表里、终态零出边、非终态至少一条出边、
 *     边不重复、等级的前缀单调性;
 *   · 每个对象声明的 `event_kind` 必须是**折法真认识的变更类型**(见 `test/ontology.test.mjs`
 *     的交叉校验)——于是「声明了却没接线」不可能悄悄存在;
 *   · 守卫写**具名标识**,名字必须在核心里真的存在(交叉校验同上)——「挂了一条不存在的法」
 *     同样是装配期的错,不是运行期的惊喜。
 *
 * ## 声明必须描述**派生的真实语义**,不是理想化
 *
 * 1. **对象是八个**:目标 / 计划 / 步骤是折法里的一等对象(goal / plan / step),
 *    与假设、观测、评估、证据、事实并列声明。
 * 2. **`step` 承载验证**:一个步骤最多承载一次验证(`step.tests`),
 *    这是「一步一验」的落地形态。
 * 3. **降级不可表示**:折法的秩
 *    (`open/blocked=0 < advanced/void=1`)明令**降级不可表示**,所以不存在「驳回重做」的边——
 *    与其补一条边,不如不给这条路。
 * 4. **`hypothesis.refuted` 是黏性终态**:折法确保「被推翻」不会被下一版假设清单
 *    改写成「已被替代」(先黏住)。
 */

/** 一个字段的声明。`values` 给了就是枚举。 */
export function field(name, options = {}) {
	return { name, note: options.note ?? '', required: options.required !== false, values: options.values ?? null }
}

/**
 * 一条合法转移。
 * `actor` 是能发起它的身份(`system` = 内核按事实推进 / `model` = 模型的工具动作 /
 * `human` = 只有人的结构化动作,如原生审批栈的放行);`guards` 是守卫的**具名标识**。
 */
export function transition(from, to, actor, on, guards = [], note = '', event = '') {
	return { from, to, actor, on, guards, note, event }
}

/** 一种本体对象的声明。**没有 current_state** —— 状态由事实算出来,没有住处。 */
export function object(name, declaration) {
	return {
		name,
		states: declaration.states,
		initial: declaration.initial,
		terminal: declaration.terminal ?? [],
		transitions: declaration.transitions ?? [],
		fields: declaration.fields ?? [],
		/** 落点:它存在哪(指向既有落点,**不新建存储**)。 */
		persistence: declaration.persistence ?? '',
		/**
		 * 这个对象**诞生**时落的那条变更(`fold.js` 词汇表里的那一个)。
		 * 转移各自的 `event` 在边上——这一平面一条边一种变更类型,与 Python 那一侧
		 * 「一个对象一个 event_kind」不同(见文件头)。
		 */
		event_kind: declaration.event_kind ?? '',
		note: declaration.note ?? '',
	}
}

/** 一级验证的语义:谁来判、认什么来源、开始前要求什么。 */
export function level(id, declaration) {
	return {
		id,
		judge: declaration.judge,
		sources: declaration.sources,
		gate: declaration.gate ?? 'none',
		note: declaration.note ?? '',
	}
}

/** 一份本体:对象 + 等级。一个进程一份(见 `validateOntology` 的调用方)。 */
export function ontology(id, declaration) {
	return { id, objects: declaration.objects, levels: declaration.levels ?? [], note: declaration.note ?? '' }
}

/**
 * 装配期不变式。**只检查声明自身的形状**——它与折法/内核的交叉校验在测试里
 * (那一侧要同时 import 折法与内核,不能放进预设的装配期)。
 *
 * 返回问题清单(空 = 通过);抛错留给调用方决定(这里只回答「有没有问题」)。
 */
export function validateOntology(spec) {
	const problems = []
	if (spec === null || typeof spec !== 'object') return ['ontology: 不是一份声明']
	if (typeof spec.id !== 'string' || spec.id.trim() === '') problems.push('ontology: 缺 id')
	if (!Array.isArray(spec.objects) || spec.objects.length === 0) problems.push('ontology: 一个对象都没有')
	const seen = new Set()
	for (const obj of spec.objects ?? []) {
		const at = `object ${obj?.name ?? '(无名)'}`
		if (typeof obj?.name !== 'string' || obj.name.trim() === '') problems.push(`${at}: 缺 name`)
		if (seen.has(obj?.name)) problems.push(`${at}: 对象重名`)
		seen.add(obj?.name)
		const states = Array.isArray(obj?.states) ? obj.states : []
		if (states.length === 0) problems.push(`${at}: 一个状态都没有`)
		if (new Set(states).size !== states.length) problems.push(`${at}: 状态重名`)
		if (!states.includes(obj?.initial)) problems.push(`${at}: 初始态 ${String(obj?.initial)} 不在状态表里`)
		for (const terminal of obj?.terminal ?? []) {
			if (!states.includes(terminal)) problems.push(`${at}: 终态 ${terminal} 不在状态表里`)
		}
		const edges = new Map()
		for (const edge of obj?.transitions ?? []) {
			const key = `${edge?.from}→${edge?.to}`
			if (!states.includes(edge?.from)) problems.push(`${at}: 边 ${key} 的起点不在状态表里`)
			if (!states.includes(edge?.to)) problems.push(`${at}: 边 ${key} 的终点不在状态表里`)
			if (edges.has(key)) problems.push(`${at}: 边 ${key} 重复`)
			edges.set(key, edge)
			if (!['system', 'model', 'human'].includes(edge?.actor)) problems.push(`${at}: 边 ${key} 的身份 ${String(edge?.actor)} 不认识`)
			if (typeof edge?.on !== 'string' || edge.on.trim() === '') problems.push(`${at}: 边 ${key} 缺 on(这件事的名字)`)
		}
		// 终态零出边;非终态至少一条出边(否则那条路是死的)。
		for (const state of states) {
			const out = (obj.transitions ?? []).filter((edge) => edge.from === state).length
			const isTerminal = (obj.terminal ?? []).includes(state)
			if (isTerminal && out > 0) problems.push(`${at}: 终态 ${state} 还有出边(${out} 条)`)
			if (!isTerminal && out === 0) problems.push(`${at}: 非终态 ${state} 没有出边(那是一条死路)`)
		}
		// 每个状态都必须从初始态走得到(否则声明了一条没人走的路)。
		const reachable = new Set([obj?.initial])
		for (let round = 0; round < states.length; round += 1) {
			for (const edge of obj?.transitions ?? []) {
				if (reachable.has(edge.from)) reachable.add(edge.to)
			}
		}
		for (const state of states) {
			if (!reachable.has(state)) problems.push(`${at}: 状态 ${state} 从初始态走不到`)
		}
		if (typeof obj?.event_kind !== 'string' || obj.event_kind.trim() === '') problems.push(`${at}: 缺 event_kind(它每一次转移要发的那条变更)`)
	}
	// 等级:前缀单调——判的人只会越来越外部,来源只会越来越宽,门只会越来越严。
	const JUDGE_RANK = { self: 0, independent: 1 }
	const GATE_RANK = { none: 0, registered_criteria: 1, human_release: 2 }
	const levels = Array.isArray(spec.levels) ? spec.levels : []
	levels.forEach((item, index) => {
		if (item?.id !== `L${index}`) problems.push(`levels: 第 ${index} 项的 id 是 ${String(item?.id)},应为 L${index}`)
		if (!(item?.judge in JUDGE_RANK)) problems.push(`levels: ${String(item?.id)} 的 judge ${String(item?.judge)} 不认识`)
		if (!Array.isArray(item?.sources) || item.sources.length === 0) problems.push(`levels: ${String(item?.id)} 没有声明来源`)
		if (!(item?.gate in GATE_RANK)) problems.push(`levels: ${String(item?.id)} 的 gate ${String(item?.gate)} 不认识`)
		if (index === 0) return
		const previous = levels[index - 1]
		if (JUDGE_RANK[item?.judge] < JUDGE_RANK[previous?.judge]) problems.push(`levels: ${item.id} 的判者比 ${previous.id} 更内部(前缀必须单调)`)
		if (GATE_RANK[item?.gate] < GATE_RANK[previous?.gate]) problems.push(`levels: ${item.id} 的门比 ${previous.id} 更松(前缀必须单调)`)
	})
	return problems
}

/** 一份给人/给模型读的说明(markdown)。货架写的就是它。 */
export function describeOntology(spec) {
	const lines = [`# 本体:${spec.id}`, '', spec.note, '', '## 对象']
	for (const obj of spec.objects) {
		lines.push('', `### ${obj.name}`, `- 状态:${obj.states.join(' → ')}`, `- 初始:${obj.initial} · 终态:${obj.terminal.length === 0 ? '(无)' : obj.terminal.join('、')}`)
		if (obj.persistence !== '') lines.push(`- 落点:${obj.persistence}(不新建存储)`)
		if (obj.event_kind !== '') lines.push(`- 每次转移发:${obj.event_kind}`)
		for (const edge of obj.transitions) {
			lines.push(`  - ${edge.from} → ${edge.to}:由 **${edge.actor}** 发起,当 ${edge.on}${edge.guards.length === 0 ? '' : `(守卫:${edge.guards.join('、')})`}`)
		}
		if (obj.fields.length > 0) lines.push(`- 字段:${obj.fields.map((item) => `${item.name}${item.values === null ? '' : `(${item.values.join('|')})`}`).join('、')}`)
		if (obj.note !== '') lines.push(`- 说明:${obj.note}`)
	}
	if (spec.levels.length > 0) {
		lines.push('', '## 五级')
		for (const item of spec.levels) {
			lines.push(`- **${item.id}** 判者 ${item.judge} · 来源 ${item.sources.join('、')} · 门 ${item.gate} —— ${item.note}`)
		}
	}
	return `${lines.join('\n')}\n`
}

/**
 * **这一平面的本体**(逐条转录自 `fold.js` 的词汇表与内核的门,不是抄 Python 那份文本;
 * 四处差异见文件头)。
 */
export const VERIFICATION_LOOP = ontology('verification-loop', {
	note: '八个对象 + 五级验证。声明是数据;实例状态由事实算出来(见文件头那条红线)。',
	levels: [
		level('L0', { judge: 'self', sources: ['self'], note: '只靠推理的快速合理性检查;依据必须可复查' }),
		level('L1', { judge: 'self', sources: ['self'], note: '已有知识:文献、数据库是否已回答或已否定' }),
		level('L2', { judge: 'self', sources: ['self'], note: '已有数据或小规模计算' }),
		level('L3', { judge: 'independent', sources: ['self'], gate: 'registered_criteria', note: '新产生且可重跑的证据;判据先写后做,裁决由独立评估者写' }),
		level('L4', { judge: 'independent', sources: ['human_upload', 'file_drop', 'callback', 'pull'], gate: 'human_release', note: '不可重复或来自外部的证据;先登记标准,人放行(原生审批栈的权威记录)' }),
	],
	objects: [
		object('goal', {
			states: ['open', 'achieved', 'abandoned', 'superseded'],
			initial: 'open',
			terminal: ['achieved', 'abandoned', 'superseded'],
			transitions: [
				transition('open', 'achieved', 'system', 'goal_verified', ['independent_verdict_support'], '独立评估者裁 support 才结案', 'goal/closed'),
				transition('open', 'abandoned', 'model', 'goal_abandoned', ['independent_verdict_written'], '如实放弃要写清阻塞;记录保留', 'goal/closed'),
				transition('open', 'superseded', 'model', 'new_goal_set', [], '同一条线只开一个目标;开新的把旧的置为被替代', 'goal/set'),
			],
			fields: [field('claim'), field('done_criteria'), field('promote_at_level', { values: ['L0', 'L1', 'L2', 'L3', 'L4'] }), field('revision')],
			persistence: 'fold.goal + clear/goals/',
			event_kind: 'goal/set',
			note: '这一平面的一等对象(那一侧记在 goal 文档里);status 是派生值,声明里没有它的住处',
		}),
		object('hypothesis', {
			states: ['proposed', 'alive', 'confirmed', 'refuted', 'superseded'],
			initial: 'proposed',
			terminal: ['refuted', 'superseded'],
			transitions: [
				transition('proposed', 'alive', 'system', 'evidence_appended', [], '第一条证据到达', 'evidence/recorded'),
				transition('proposed', 'confirmed', 'system', 'promotion_threshold', [], '捷径:单条达门槛的支持证据可直接确认(与那一侧同一条边)', 'fact/promoted'),
				transition('alive', 'confirmed', 'system', 'promotion_threshold', [], '最高支持等级达到 promote_at_level ⇒ 升格为事实', 'fact/promoted'),
				transition('confirmed', 'refuted', 'system', 'refuting_evidence', [], '已确认的假设后来被新证据推翻——状态由证据算,不因「已确认」而豁免', 'evidence/recorded'),
				transition('alive', 'refuted', 'system', 'refuting_evidence', [], '有推翻裁决;被推翻的假设保留', 'evidence/recorded'),
				transition('proposed', 'refuted', 'system', 'refuting_evidence', [], '第一条证据就是推翻(L3 以上由独立评估者写)', 'evidence/recorded'),
				transition('proposed', 'superseded', 'model', 'hypothesis_revised', [], '还没证据就被下一版清单换掉', 'hypothesis/superseded'),
				transition('alive', 'superseded', 'model', 'hypothesis_revised', [], '同上,已经活着的也算', 'hypothesis/superseded'),
			],
			fields: [field('claim'), field('refute_when')],
			persistence: 'fold.hypotheses(goal/set 一起落)',
			event_kind: 'hypothesis/superseded',
			note: '状态由证据算:**confirmed 那条边的落账在 fact 对象那边**(升格成事实 ⇒ 面板把它读成已确认),假设自己没有这条变更;refuted 是黏性终态(与「目标侧被推翻的计划不可复活」同一个病同一个修法);不声明 status',
		}),
		object('plan', {
			states: ['active', 'closed'],
			initial: 'active',
			terminal: ['closed'],
			transitions: [
				transition('active', 'closed', 'model', 'plan_closed', [], '一份计划只承载一个阶段,收尾由模型发起', 'plan/closed'),
				// 「受阻」是**字段**不是状态:一条自环把它记在计划上(折法里 `plan.blocked` 就是这个落点)。
				transition('active', 'active', 'system', 'gate_failed_repeatedly', ['block_threshold'], '某一步连拦达阈值 ⇒ 计划置受阻等人(状态不变,事实加一条)', 'plan/blocked'),
			],
			fields: [field('brief'), field('steps'), field('confirmed_at', { required: false }), field('confirmed_by', { required: false, values: ['user', 'autonomy', 'progress'] }), field('blocked', { required: false })],
			persistence: 'fold.plans + clear/goals/plans/',
			event_kind: 'plan/created',
			note: '「受阻」是字段不是状态(它会被清掉);授权记号也是字段——有记号或已推进过都算授权',
		}),
		object('step', {
			states: ['open', 'advanced', 'void'],
			initial: 'open',
			terminal: ['advanced', 'void'],
			transitions: [
				transition('open', 'advanced', 'system', 'step_delivered', ['admission_passed', 'level_judge_split', 'external_source_for_l4', 'human_release_for_l4'], '唯一完成动词的落点:证据、裁决、门都过了才升', 'step/advanced'),
				transition('open', 'void', 'model', 'step_voided', [], '计划改了,这一步作废(留缘由)', 'plan/voided'),
			],
			fields: [field('do'), field('done_criteria'), field('artifacts'), field('tests', { required: false })],
			persistence: 'fold.plans[].steps',
			event_kind: 'step/advanced',
			note: '这一平面上它同时就是「一次验证」(step.tests = hypothesis + level);没有「降级重做」那条边:秩明令降级不可表示;「受阻」不在步的状态里——它是计划上的字段(见 plan 的自环)',
		}),
		object('observation', {
			states: ['received', 'accepted', 'rejected'],
			initial: 'received',
			terminal: ['accepted', 'rejected'],
			transitions: [
				transition('received', 'accepted', 'system', 'source_admissible', ['admission_passed'], '准入只回答「收不收」,不回答「说明了什么」;收下的落一条观测', 'observation/recorded'),
				transition('received', 'rejected', 'system', 'source_not_admissible', [], '不收:只在准入账(`admission/checked`)上留痕,不落观测对象', 'admission/checked'),
			],
			fields: [field('content'), field('source', { values: ['self', 'human_upload', 'file_drop', 'callback', 'pull'] }), field('ref')],
			persistence: 'fold.materials(收下的)+ 准入账(不收的)',
			event_kind: 'observation/recorded',
			note: '`received` 活在一次交付调用之内(候选观测):收下的才成为对象,不收的只留一条准入事实——「不收」不是对象的终态,是账本上的一行',
		}),
		object('evaluation', {
			states: ['recorded'],
			initial: 'recorded',
			terminal: ['recorded'],
			transitions: [],
			fields: [field('evaluator', { values: ['self', 'independent', 'machine'] }), field('verdict', { values: ['support', 'refute', 'inconclusive'] }), field('basis'), field('shortfalls', { required: false })],
			persistence: 'fold.audits + clear/evidence/audits/',
			event_kind: 'audit/settled',
			note: '写下就不改;重评产生新的一条。做的人与判的人按等级分开(L3 以上只能由独立评估者写)',
		}),
		object('evidence', {
			states: ['recorded'],
			initial: 'recorded',
			terminal: ['recorded'],
			transitions: [],
			fields: [field('verdict', { values: ['support', 'refute', 'inconclusive'] }), field('level', { values: ['L0', 'L1', 'L2', 'L3', 'L4'] }), field('refs'), field('anchor', { values: ['auditor', 'artifact'] })],
			persistence: 'fold.evidence',
			event_kind: 'evidence/recorded',
			note: '与步骤上的收敛记录分开;anchor 说这条证据钉在哪(独立裁决 / 物证)',
		}),
		object('fact', {
			states: ['promoted'],
			initial: 'promoted',
			terminal: ['promoted'],
			transitions: [],
			fields: [
				field('text', { note: '一句话陈述' }),
				/** 边界:没有边界的事实没人敢用——下一轮引用它之前先看这条。 */
				field('scope', { note: '边界(推翻条件):什么情况下它作废' }),
				field('level', { note: '被支持到哪一级(判者可查)' }),
				field('evidence'),
				field('path'),
				field('last_verified', { required: false, note: '升格时间(派生,不另存)' }),
			],
			persistence: 'clear/knowledge/facts/',
			event_kind: 'fact/promoted',
			note: '升格由系统做;每条带边界(scope)与等级,下一轮作为「已知」引用时先看边界。货架在 clear/knowledge/facts/INDEX.md(面板「事实」那一格读的是同一张表)。「被推翻先标记、由人决定撤回」这一层这一平面**还没有**——如实记着(那一侧 P9 有)',
		}),
		object('release', {
			states: ['granted'],
			initial: 'granted',
			terminal: ['granted'],
			transitions: [],
			fields: [field('step', { required: false }), field('branch', { required: false }), field('call'), field('via', { values: ['approval'] })],
			persistence: 'fold.releases(原生审批栈的审计对是权威记录)',
			event_kind: 'human/released',
			note: 'L4 的人放行:一次一放行;步级的事实一落,同一步重试不再问人)',
		}),
	],
})
