/**
 * ClearAI 的**宿主不变量**（`@deepseek-ai/dsh-invariants` 的伴生件）。
 *
 * 为什么要有它:跨机制不变量原本只在验收脚本里**事后**算——跑完一场、解出日志、再判。
 * 而这几条契约(引用完整性、准入先于推进、结算必有派遣、升格有据、事实只朝一个方向走)
 * 本来就是**逐条事实**的性质:每条事实落下时就能判,判晚了只是把 bug 留到跑完之后才看见。
 * 宿主给了这个位置(`invariants.register(packageName, installer)`,违反时抛带**稳定错误码**与
 * **归属包名**的 `InvariantError`),就用它:挂在真跑里,而不是只在归档里。
 *
 * 三条纪律:
 *   · **只判契约,不判判断**:这里只问"这条事实能不能和已经落下的事实同时成立",
 *     不问"这一步该不该交付""这个读数对不对"——那些是模型与评估者的事(P0)。
 *   · **判在落账之前**(宿主 `internal/dispatch` 那一拍):不合法的事实**根本进不了日志**,
 *     而不是先落再事后喊。
 *   · **诊断面不许假装承重**:它是可开关的伴生件(`enabled` / `package_allowlist`),
 *     装在哪一层由组合决定;没挂这个服务的部署里它安静地不参与。
 */

/** 归属包名:违反时报出去的是这个名字(宿主据此过滤与归属)。 */
const PACKAGE_NAME = 'clearai-dsh'
/** Cordis 伴生插件名。 */
const name = 'clearai-invariant'
/** 服务由宿主组合提供;没有它时这一行进等待,不报错。 */
const inject = ['invariants']

/** 五个契约,逐条可单独判:名字进错误消息,便于 grep 与定位。 */
const CONTRACTS = ['引用完整性', '准入先于推进', '结算必有派遣', '升格有据', '事实棘轮']

/**
 * 每条事实带什么 id、指向谁。这里**只读字段,不读语义**:事实的字段形状是内核与折法之间的契约,
 * 变了这里必须跟着变(改不动就会当场抛,而不是悄悄放过)。
 */
const STEP_REF_MUTATIONS = ['admission/checked', 'step/advanced', 'observation/recorded', 'scout/dispatched', 'evidence/recorded', 'audit/settled']
const PLAN_REF_MUTATIONS = ['plan/created', 'plan/confirmed', 'plan/refined', 'plan/amended', 'plan/voided', 'plan/closed', 'plan/blocked']
const FORK_REF_MUTATIONS = ['worldline/prepared', 'worldline/executing', 'worldline/executed', 'worldline/removed', 'branch/delivered', 'fork/recommended', 'fork/converged', 'fork/merged', 'fork/undecidable', 'fork/abandoned']
/** 状态棘轮里"只许前进"的那几样:值越大越靠后。 */
const STEP_RANK = { open: 0, blocked: 0, advanced: 1, void: 2 }
const PLAN_RANK = { active: 0, blocked: 0, closed: 1 }

/**
 * 空轨迹:只留判这几条契约需要的索引,不复制整份状态。
 *
 * **步骤按裸 id 索引**:真实变更里有一半不带 `plan`(`observation/recorded`、`audit/settled`、
 * `plan/voided` 都是),而步骤 id 在内核里本来就是全局唯一的(`stepIndex` 也按裸 id 建)。
 * 用 `plan:step` 当键会把这些**合法**事实判成"指向不存在的步骤"——判据比事实窄,就是误伤。
 */
function emptyTrace() {
	return {
		plans: new Map(),
		steps: new Map(),
		forks: new Map(),
		branches: new Map(),
		admitted: new Set(),
		dispatched: new Set(),
		scouts: new Map(),
		audits: new Set(),
		promoteAtLevel: new Map(),
		supportLevel: new Map(),
		/** 假设 → 它属于哪个目标;步骤 → 它验的是哪条假设。升格那条契约要顺着这两条边走。 */
		hypothesisGoal: new Map(),
		stepHypothesis: new Map(),
	}
}

/** 一条 fact 里的 mutations:两种装载点(插件消息的 `clearai/mutations` 段、工具结果的 meta)。 */
function mutationsOf(event) {
	const out = []
	const source = event?.data?.source
	if (source !== null && typeof source === 'object' && Array.isArray(source.sections)) {
		const section = source.sections.find((item) => item?.name === 'clearai/mutations')
		if (section !== undefined && typeof section.text === 'string') {
			try {
				const payload = JSON.parse(section.text)
				if (Array.isArray(payload?.mutations)) out.push(...payload.mutations)
			} catch {
				/* 坏 payload 由折法那边决定怎么办;这里不猜、也不判。 */
			}
		}
	}
	const meta = event?.data?.meta
	if (meta !== null && meta !== undefined && typeof meta === 'object' && meta.kind === 'clearai') {
		if (Array.isArray(meta.mutations)) out.push(...meta.mutations)
		else if (meta.mutation !== undefined) out.push(meta.mutation)
	}
	return out
}

/**
 * **伪步骤**:目标轴与世界线轴的裁决也带 `step` 字段,但那个值不是计划步骤——
 * 它是 `goal:<目标 id>`(目标验收)或 `<forkId>:<branchId>`(世界线评估)。
 * 它们**本来就不该**在 `plan/created` 里登记。
 *
 * 判据:计划步骤 id 的取字纪律是**字母/数字/下划线/短横**(见内核 `STEP_SCHEMA` 的说明),
 * 而两条伪轴一律带冒号。所以带冒号的 step 一律不当计划步骤看(真跑教出来的第二条)。
 */
const isPseudoStep = (step) => String(step).includes(':')
const LEVEL_RANK = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 }

/**
 * 把一条变更折进轨迹,**顺路判契约**。违反就 `fail(消息)`(宿主把它包成 `InvariantError`)。
 *
 * 判的顺序刻意是"先查引用、再改轨迹":一条指向不存在步骤的事实,既不该改轨迹,也不该进日志。
 */
function foldMutation(trace, mutation, fail) {
	if (mutation === null || typeof mutation !== 'object' || typeof mutation.t !== 'string') return
	const t = mutation.t
	const plan = mutation.plan === undefined || mutation.plan === null ? null : String(mutation.plan)
	const step = mutation.step === undefined || mutation.step === null ? null : String(mutation.step)

	// ── 契约①:引用完整性 ────────────────────────────────────────────────────
	if (STEP_REF_MUTATIONS.includes(t) && step !== null && !isPseudoStep(step)) {
		/**
		 * **一无所知时不判**:轨迹里一个步骤都没有,说明这份日志的窗口不从开头起
		 * (或者登记事实的形状变了)——那时"查不到"不是"不存在"。判据只在**有据可查**时开口,
		 * 否则它会把正确的事实拦在账本之外(这一条是被真跑教出来的)。
		 */
		if (trace.steps.size > 0 && !trace.steps.has(step)) {
			fail(`引用完整性:${t} 指向不存在的步骤 ${step}——事实不能指向还没登记的东西`)
		}
	}
	if (PLAN_REF_MUTATIONS.includes(t) && plan !== null && t !== 'plan/created' && !trace.plans.has(plan)) {
		fail(`引用完整性:${t} 指向不存在的计划 ${plan}`)
	}
	if (FORK_REF_MUTATIONS.includes(t)) {
		const fork = mutation.fork === undefined || mutation.fork === null ? null : String(mutation.fork)
		if (fork !== null && !trace.forks.has(fork)) {
			fail(`引用完整性:${t} 指向不存在的分叉 ${fork}`)
		}
		if (t === 'branch/delivered') {
			const branch = mutation.branch === undefined || mutation.branch === null ? null : String(mutation.branch)
			if (branch !== null && fork !== null && !trace.branches.has(`${fork}:${branch}`)) {
				fail(`引用完整性:branch/delivered 指向不存在的世界线 ${fork}:${branch}`)
			}
		}
		if (t === 'branch/delivered' && !trace.dispatched.has(`worldline:${fork}:${mutation.branch}`)) {
			fail(`结算必有派遣:branch/delivered(${fork}:${String(mutation.branch)}) 之前没有 worldline/executing`)
		}
	}

	// ── 契约②:准入先于推进 ──────────────────────────────────────────────────
	if (t === 'step/advanced') {
		if (step === null || isPseudoStep(step) || !trace.steps.has(step)) return // 引用那条已经报过(或一无所知)
		if (!trace.admitted.has(step)) {
			fail(`准入先于推进:step/advanced(${step}) 之前没有该步的 admission/checked`)
		}
	}

	// ── 契约③:结算必有派遣 ──────────────────────────────────────────────────
	if (t === 'scout/settled') {
		const id = mutation.id === undefined || mutation.id === null ? null : String(mutation.id)
		if (id !== null && !trace.scouts.has(id)) fail(`结算必有派遣:scout/settled(${id}) 之前没有 scout/dispatched`)
	}
	if (t === 'worldline/executed' && !trace.dispatched.has(`worldline:${mutation.fork}:${mutation.branch}`)) {
		fail(`结算必有派遣:worldline/executed(${String(mutation.fork)}:${String(mutation.branch)}) 之前没有 worldline/executing`)
	}
	if (t === 'audit/settled') {
		const byStep = step === null ? false : trace.audits.has(step)
		if (!byStep) fail(`结算必有派遣:audit/settled(${String(step ?? '?')}) 之前没有 audit/dispatched`)
	}

	// ── 契约④:升格有据 ──────────────────────────────────────────────────────
	if (t === 'fact/promoted') {
		/**
		 * 阈值登记在**目标**上,而事实只带 `goal`(内核从假设反查目标写进来的)。
		 * 目标与那条假设对不上时**不判**(宁可不判,也不冤枉)——但一定判得住常规路径。
		 */
		const goal = mutation.goal === undefined || mutation.goal === null ? null : String(mutation.goal)
		const need = LEVEL_RANK[String(trace.promoteAtLevel.get(goal) ?? '')]
		const got = LEVEL_RANK[String(trace.supportLevel.get(goal) ?? '')]
		if (need !== undefined && (got === undefined || got < need)) {
			fail(`升格有据:fact/promoted 的支持等级(${String(trace.supportLevel.get(goal) ?? '无')})没到该目标登记的 promote_at_level(${String(trace.promoteAtLevel.get(goal))})`)
		}
	}

	/**
	 * ── 契约⑤:事实棘轮(只朝一个方向走) ─────────────────────────────────────
	 *
	 * 判的是"这条变更自己要写成什么状态",而不是读它带的某个字段——`step/advanced` 这类变更
	 * 根本不带 `status`:它的**种类**就是状态。折法里对降级是"静默忽略",这里把那份静默变成
	 * 一声巨响:有人想改写已经落下的事实,是生产者出了 bug,不是可以悄悄吃掉的东西。
	 */
	const ratchetStatus = (map, key, rank, next, what) => {
		if (key === null || key === undefined) return
		const row = map.get(key)
		if (row === undefined) return
		const before = typeof row === 'string' ? row : row.status
		if ((rank[String(next)] ?? -1) < (rank[String(before)] ?? -1)) {
			fail(`事实棘轮:${what}(${key}) 从 ${String(before)} 退回了 ${String(next)}——已经落下的事实不能被改写`)
		}
	}

	// ── 通过:改轨迹 ────────────────────────────────────────────────────────
	/** 登记一个步骤(计划里带到的那几个形状共用)。 */
	const register = (item, ownerPlan) => {
		if (item === null || typeof item !== 'object' || item.id === undefined || item.id === null) return
		const id = String(item.id)
		trace.steps.set(id, { status: String(item.status ?? 'open'), plan: ownerPlan })
		const hypothesis = item?.tests?.hypothesis
		if (hypothesis !== undefined && hypothesis !== null && String(hypothesis) !== '') trace.stepHypothesis.set(id, String(hypothesis))
	}
	if (t === 'plan/created') {
		const id = mutation.id === undefined || mutation.id === null ? plan : String(mutation.id)
		if (id !== null) trace.plans.set(id, String(mutation.status ?? 'active'))
		for (const item of Array.isArray(mutation.steps) ? mutation.steps : []) register(item, id)
		return
	}
	if (t === 'plan/amended') {
		// 真实形状是**一个** step(不是数组):`{t:'plan/amended', plan, step:{...}}`
		register(mutation.step, plan)
		return
	}
	if (t === 'plan/refined') {
		// 精化只改判据,不动状态;把 `tests` 记下来,升格那条契约要顺着它走。
		const item = mutation.step
		if (item !== null && typeof item === 'object' && item.id !== undefined && item.id !== null) {
			const id = String(item.id)
			const existing = trace.steps.get(id)
			if (existing === undefined) trace.steps.set(id, { status: 'open', plan })
			const hypothesis = item?.tests?.hypothesis
			if (hypothesis !== undefined && hypothesis !== null && String(hypothesis) !== '') trace.stepHypothesis.set(id, String(hypothesis))
		}
		return
	}
	if (t === 'plan/voided') {
		// 作废的是**一个** step:状态写成 void,并且要过棘轮(作废过的不许再被推进)。
		const id = mutation.step === undefined || mutation.step === null ? null : String(mutation.step)
		if (id !== null) {
			ratchetStatus(trace.steps, id, STEP_RANK, 'void', '步骤状态')
			const existing = trace.steps.get(id)
			trace.steps.set(id, { status: 'void', plan: existing?.plan ?? plan })
		}
		return
	}
	if (t === 'plan/closed') {
		if (plan !== null && trace.plans.has(plan)) {
			ratchetStatus(trace.plans, plan, PLAN_RANK, 'closed', '计划状态')
			trace.plans.set(plan, 'closed')
		}
		return
	}
	if (t === 'plan/blocked') {
		if (plan !== null && trace.plans.has(plan)) {
			ratchetStatus(trace.plans, plan, PLAN_RANK, 'blocked', '计划状态')
			trace.plans.set(plan, 'blocked')
		}
		return
	}

	if (t === 'fork/created') {
		const id = mutation.id === undefined || mutation.id === null ? null : String(mutation.id)
		if (id !== null) {
			trace.forks.set(id, String(mutation.status ?? 'deciding'))
			for (const item of Array.isArray(mutation.options) ? mutation.options : []) {
				if (item?.id !== undefined) trace.branches.set(`${id}:${item.id}`, 'exploring')
			}
		}
		return
	}
	if (t === 'worldline/prepared') {
		const fork = String(mutation.fork ?? '')
		for (const item of Array.isArray(mutation.branches) ? mutation.branches : []) {
			if (item?.id !== undefined) trace.branches.set(`${fork}:${item.id}`, String(item.status ?? 'exploring'))
		}
		return
	}
	if (t === 'worldline/executing') {
		trace.dispatched.add(`worldline:${String(mutation.fork)}:${String(mutation.branch)}`)
		return
	}
	if (t === 'scout/dispatched') {
		const id = mutation.id === undefined || mutation.id === null ? null : String(mutation.id)
		if (id !== null) trace.scouts.set(id, 'dispatched')
		return
	}
	if (t === 'audit/dispatched') {
		if (step !== null) trace.audits.add(step)
		return
	}
	if (t === 'admission/checked') {
		if (step !== null) trace.admitted.add(step)
		return
	}
	if (t === 'step/advanced') {
		ratchetStatus(trace.steps, step, STEP_RANK, 'advanced', '步骤状态')
		const existing = trace.steps.get(step)
		trace.steps.set(step, { status: 'advanced', plan: existing?.plan ?? plan })
		return
	}
	if (t === 'goal/set') {
		const id = mutation.id === undefined || mutation.id === null ? null : String(mutation.id)
		if (id === null) return
		trace.promoteAtLevel.set(id, String(mutation.promote_at_level ?? ''))
		for (const hypothesis of Array.isArray(mutation.hypotheses) ? mutation.hypotheses : []) {
			if (hypothesis?.id !== undefined) trace.hypothesisGoal.set(String(hypothesis.id), id)
		}
		return
	}
	if (t === 'evidence/recorded' && String(mutation.verdict ?? '') === 'support') {
		/**
		 * 证据只带 `plan`/`step`;要走到目标得顺着**步骤 → 假设 → 目标**这条边。
		 * 走不通就**不判**(宁可不判,也不冤枉):登记不齐是另一件事,不该由这条契约来罚。
		 */
		const hypothesis = step === null ? undefined : trace.stepHypothesis.get(step)
		const goal = hypothesis === undefined ? null : (trace.hypothesisGoal.get(hypothesis) ?? null)
		if (goal === null) return
		const before = LEVEL_RANK[String(trace.supportLevel.get(goal) ?? '')] ?? -1
		const now = LEVEL_RANK[String(mutation.level ?? '')] ?? -1
		if (now > before) trace.supportLevel.set(goal, String(mutation.level))
		return
	}
	// 别的变更类型(呈现类、台账类)与这五条契约无关:读过就算了,不猜它的语义。
}

/** 一个事件里所有变更逐条判(顺序就是日志里的顺序)。 */
function foldEvent(trace, event, fail) {
	if (event === null || typeof event !== 'object') return
	for (const mutation of mutationsOf(event)) foldMutation(trace, mutation, fail)
}

/**
 * 安装件:宿主把 `(childCtx, fail)` 交给我们。
 *
 * 种子来自 `session.snapshotEvents()`,之后**在落账之前**逐条判(`internal/dispatch` 那一拍,
 * 与宿主自己那几个伴生件同一个做法):不合法的事实根本进不了日志。
 */
const install = Object.assign(
	(ctx, fail) => {
		const traces = new WeakMap()
		const staged = new WeakMap()
		const seed = (session) => {
			const trace = emptyTrace()
			for (const event of session.snapshotEvents()) foldEvent(trace, event, fail)
			traces.set(session, trace)
			return trace
		}
		ctx.sessions.list().forEach(seed)
		ctx.on('session/created', (session) => seed(session), { global: true })
		ctx.on(
			'internal/dispatch',
			(_mode, eventName, args) => {
				if (eventName !== 'session/event') return
				const [session, event] = args
				if (mutationsOf(event).length === 0) return
				// 候选轨迹先改在副本上:判不过就什么都不改(fail 会当场抛出去)。
				const candidate = copyTrace(traces.get(session) ?? emptyTrace())
				foldEvent(candidate, event, fail)
				staged.set(event, { session, trace: candidate })
			},
			{ global: true },
		)
		ctx.on(
			'session/event',
			(session, event) => {
				const candidate = staged.get(event)
				if (candidate === undefined) return
				staged.delete(event)
				traces.set(session, candidate.trace)
			},
			{ global: true },
		)
	},
	{ inject: ['sessions'] },
)

/** 轨迹的浅拷贝:判一条候选事件时,判不过就不许污染已经落下的轨迹。 */
function copyTrace(trace) {
	return {
		plans: new Map(trace.plans),
		steps: new Map(trace.steps),
		forks: new Map(trace.forks),
		branches: new Map(trace.branches),
		admitted: new Set(trace.admitted),
		dispatched: new Set(trace.dispatched),
		scouts: new Map(trace.scouts),
		audits: new Set(trace.audits),
		promoteAtLevel: new Map(trace.promoteAtLevel),
		supportLevel: new Map(trace.supportLevel),
		hypothesisGoal: new Map(trace.hypothesisGoal),
		stepHypothesis: new Map(trace.stepHypothesis),
	}
}

/** 把这一包的不变量注册进宿主(`apply` 是伴生插件的入口)。 */
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

export { CONTRACTS, PACKAGE_NAME, apply, emptyTrace, foldEvent, foldMutation, inject, install, mutationsOf, name }
