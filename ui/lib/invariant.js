/**
 * ClearAI 的**宿主不变量**（`@deepseek-ai/dsh-invariants` 的伴生件）。
 *
 * 这一份与上一版的根本差别:它**不再自己折**。上一版为了"落账之前判"维护了一套
 * plans/steps/forks/branches/… 的索引,上岗第一小时就因为与主投影**对不上**被修了两次
 * ——那不是业务有错,是**第二套解释器**必然漂移。现在状态直接用生产折法
 * （`fold.js` 的 `applyEvent`)推进,契约只在生产状态与候选变更上判:
 *
 *   · 状态只有一个权威(投影),这里只是把它**再跑一遍**——同一份代码,不可能漂;
 *   · 本文件独有的只剩**时机**(落账之前)与**判据**(五条契约);
 *   · 唯一的私有累积是 admitted 步骤集合(折法刻意把 `admission/checked` 留在台账层,
 *     投影里没有它——那不是解释形状,是一行 `add(step)`)。
 *
 * 三条纪律:
 *   · **只判契约,不判判断**:这里只问"这条事实能不能和已经落下的事实同时成立"。
 *   · **已经发生的失败必须允许入账**:评估者崩溃、落盘失败是事实,拦下它们
 *     就是"只允许好看的事实进入账本"——那本身是不实陈述。
 *   · **诊断面不许假装承重**:没挂这个服务的部署里它是零成本的一行判断。
 */
import { applyEvent, emptyState } from './fold.js'

/** 归属包名:违反时报出去的是这个名字(宿主据此过滤与归属)。 */
const PACKAGE_NAME = 'clearai-dsh'
/** Cordis 伴生插件名。 */
const name = 'clearai-invariant'
/** 服务由宿主组合提供;没有它时这一行进等待,不报错。 */
const inject = ['invariants']

/** 一条 fact 里的 mutations:两种装载点(插件消息的段、工具结果的 meta)。 */
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
				/* 坏 payload 由折法决定怎么办;这里不猜。 */
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
 * **伪步骤**:目标轴(`goal:<id>`)与世界线轴(`<forkId>:<branchId>`)的裁决也带 `step`,
 * 但它们本来就不在 `plan/created` 里登记。计划步骤 id 的取字纪律是字母/数字/下划线/短横
 * (见内核 `STEP_SCHEMA`),两条伪轴一律带冒号。
 */
const isPseudoStep = (step) => String(step).includes(':')

const LEVEL_RANK = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 }

/** 在**生产状态**里找一个计划步骤(裸 id;这是 `view.stepIndex` 的同一份事实)。 */
function findStep(state, step) {
	if (step === null || step === undefined || isPseudoStep(step)) return undefined
	for (const plan of state?.plans ?? []) {
		const found = (plan.steps ?? []).find((item) => String(item.id) === String(step))
		if (found !== undefined) return found
	}
	return undefined
}

/**
 * 五条契约,逐条判。输入是**生产折法**算出的 `before`(落这条之前的状态)、候选事件的
 * 变更、与 admitted 累积。违反就 `fail(消息)`;判据查不到的那一半**安静地不判**
 * (查不到 ≠ 不存在——判据比事实窄就是误伤,这一条是被真跑教出来的)。
 */
function judge(before, mutations, admittedIn, fail) {
	const plans = Array.isArray(before?.plans) ? before.plans : []
	const hasAnyStep = plans.some((plan) => Array.isArray(plan.steps) && plan.steps.length > 0)
	/**
	 * **本批累积**:一次交付的变更里,`admission/checked` 与 `step/advanced`、
	 * `audit/dispatched` 与 `audit/settled` 常常**同一批**落(内核就是这么发的——
	 * 派遣先落、结论在同一笔里回填)。判据只看"之前"就会把这批自己拦下,
	 * 所以这里把两条累积随循环一起长:顺序仍然要求(先派遣后结算),只是允许在同批。
	 */
	const admitted = new Set(admittedIn ?? [])
	const auditsSeen = new Set((Array.isArray(before?.audits) ? before.audits : []).map((item) => String(item.id)))
	const scoutsSeen = new Set((Array.isArray(before?.scouts) ? before.scouts : []).map((item) => String(item.id)))
	for (const mutation of mutations) {
		if (mutation === null || typeof mutation !== 'object' || typeof mutation.t !== 'string') continue
		const t = mutation.t
		const step = mutation.step === undefined || mutation.step === null ? null : String(mutation.step)

		// ── 契约①:引用完整性(查生产状态,不是另一份索引) ────────────────────
		if (step !== null && !isPseudoStep(step) && hasAnyStep && ['evidence/recorded', 'observation/recorded', 'step/advanced', 'scout/dispatched'].includes(t)) {
			if (findStep(before, step) === undefined) fail(`引用完整性:${t} 指向不存在的步骤 ${step}——事实不能指向还没登记的东西`)
		}

		// ── 契约②:准入先于推进(同批允许先准入后推进;跨批看 admitted 累积) ────────
		if (t === 'admission/checked' && step !== null) admitted.add(step)
		if (t === 'step/advanced' && step !== null && !isPseudoStep(step) && !admitted.has(step)) {
			fail(`准入先于推进:step/advanced(${step}) 之前没有该步的 admission/checked`)
		}

		// ── 契约③:结算必有派遣(生产状态 + 本批已见的派遣) ─────────────────────
		if (t === 'audit/settled' && !auditsSeen.has(String(mutation.id))) {
			fail(`结算必有派遣:audit/settled(${String(mutation.id)}) 之前没有 audit/dispatched`)
		}
		if (t === 'scout/settled' && !scoutsSeen.has(String(mutation.id))) {
			fail(`结算必有派遣:scout/settled(${String(mutation.id)}) 之前没有 scout/dispatched`)
		}
		if (t === 'audit/dispatched' && mutation.id !== undefined && mutation.id !== null) auditsSeen.add(String(mutation.id))
		if (t === 'scout/dispatched' && mutation.id !== undefined && mutation.id !== null) scoutsSeen.add(String(mutation.id))

		// ── 契约④:升格有据(目标登记的门槛 vs 已落账的支持证据) ─────────────────
		if (t === 'fact/promoted') {
			const goal = before?.goal ?? null
			const need = LEVEL_RANK[String(goal?.promote_at_level ?? '')]
			if (goal !== null && need !== undefined) {
				/** 顺着 假设(claim 匹配)→ 步骤(tests.hypothesis)→ 证据(support) 这条边走。 */
				const hypothesis = (Array.isArray(before?.hypotheses) ? before.hypotheses : []).find((item) => String(item.claim ?? '') === String(mutation.text ?? ''))
				const hypId = hypothesis === undefined ? null : String(hypothesis.id)
				const stepIds = new Set(
					hypId === null ? [] : plans.flatMap((plan) => (plan.steps ?? []).filter((s) => String(s?.tests?.hypothesis ?? '') === hypId).map((s) => String(s.id))),
				)
				const support = (Array.isArray(before?.evidence) ? before.evidence : []).filter((item) => String(item.verdict) === 'support' && (hypId === null || stepIds.has(String(item.step))))
				const best = support.reduce((max, item) => Math.max(max, LEVEL_RANK[String(item.level)] ?? -1), -1)
				if (best < need) fail(`升格有据:fact/promoted 的最高支持等级(${best === -1 ? '无' : `L${best}`})没到目标登记的 promote_at_level(${String(goal.promote_at_level)})`)
			}
		}

		// ── 契约⑤:事实棘轮(生产折法对降级是**静默忽略**的;这里是唯一的检测点) ────
		if (t === 'step/advanced' && step !== null) {
			const found = findStep(before, step)
			if (found !== undefined && String(found.status) === 'void') {
				fail(`事实棘轮:步骤(${step})已作废,不能再被推进——已经落下的事实不能被改写`)
			}
		}
	}
}

/**
 * 安装件:宿主把 `(childCtx, fail)` 交给我们。
 * 状态用**生产折法**推进(`applyEvent`);候选先叠在副本上,判不过就不污染。
 */
const install = Object.assign(
	(ctx, fail) => {
		const states = new WeakMap()
		const admitted = new WeakMap()
		const staged = new WeakMap()
		const seed = (session) => {
			let state = emptyState()
			const adm = new Set()
			for (const event of session.snapshotEvents()) {
				state = applyEvent(state, event)
				for (const mutation of mutationsOf(event)) {
					if (mutation?.t === 'admission/checked' && mutation.step !== undefined && mutation.step !== null) adm.add(String(mutation.step))
				}
			}
			states.set(session, state)
			admitted.set(session, adm)
			return state
		}
		ctx.sessions.list().forEach(seed)
		ctx.on('session/created', (session) => seed(session), { global: true })
		ctx.on(
			'internal/dispatch',
			(_mode, eventName, args) => {
				if (eventName !== 'session/event') return
				const [session, event] = args
				const mutations = mutationsOf(event)
				if (mutations.length === 0) return
				const before = states.get(session) ?? emptyState()
				judge(before, mutations, admitted.get(session) ?? new Set(), fail)
				// 判过了才推进:候选状态与累积都改在副本上。
				const candidate = applyEvent(before, event)
				const adm = new Set(admitted.get(session) ?? new Set())
				for (const mutation of mutations) {
					if (mutation?.t === 'admission/checked' && mutation.step !== undefined && mutation.step !== null) adm.add(String(mutation.step))
				}
				staged.set(event, { session, state: candidate, admitted: adm })
			},
			{ global: true },
		)
		ctx.on(
			'session/event',
			(session, event) => {
				const candidate = staged.get(event)
				if (candidate === undefined) return
				staged.delete(event)
				states.set(session, candidate.state)
				admitted.set(session, candidate.admitted)
			},
			{ global: true },
		)
	},
	{ inject: ['sessions'] },
)

/** 把这一包的不变量注册进宿主(`apply` 是伴生插件的入口)。 */
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

export { PACKAGE_NAME, apply, inject, install, judge, mutationsOf, name }
