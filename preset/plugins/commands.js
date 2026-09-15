/**
 * ClearAI 的 `/` 命令:人侧的状态窗,外加一个呈审捷径。
 *
 * 为什么只读:权威账本只有一个写入者(clearai-kernel 的意图工具)。命令是**人**的界面——
 * 人不需要借命令改状态:改状态的动作都有专门的门(计划审阅卡、人门动词、面板按钮)。
 * 所以这四个命令(`goal` / `plan` / `evidence` / `worldline`)只从 `clearai` 读门面
 * 现算现渲染,一个字都不落账。
 *
 * 唯一的例外是 `/plan-review`,而且它也不写账:它把「请重新呈审」这句话结构化地
 * steer 给模型,真正的呈审与授权记号落账仍走模型侧的 `RequestPlanReview` 工具。
 * 为什么不直接在命令里弹审阅卡:授权记号(`plan/confirmed`)只能随工具结果的
 * `meta.mutations` 进日志,命令处理器没有这条通道——这不是限制,是权威边界
 * (test/authority-boundary.test.mjs 钉的就是它)。
 *
 * 数据从哪来:宿主半(ui/lib/index.js)提供的 `clearai` 门面——state/derive/view 都走它,
 * **不从 ui/lib import**:发行物里预设与 ui/ 的相对位置不一样,跨平面 import 装上就炸
 * (分层纪律与内核一致:预设平面与宿主平面互不依赖,共享逻辑各自实现或走服务)。
 * 从会话日志现折的,与面板读的是同一份,不存在「命令看到的是另一份状态」。
 */

export const name = 'clearai-commands'
export const inject = ['commands']

/** 命令的注册形状,供 test/preset-composition.test.mjs 断言(名字即公共契约)。 */
export const CLEARAI_COMMANDS = ['goal', 'plan', 'evidence', 'worldline', 'plan-review']

const STEP_STATUS_LABEL = { open: '未交付', advanced: '已交付', void: '已作废' }

/** 人门的引导语:人在 `/` 菜单里能做什么,取决于此刻门开在哪(收件箱就是门,由派生事实算出)。 */
function gateHints(derived) {
	const hints = []
	if (derived.planConfirmationPending) hints.push('/plan-review 重新呈审计划')
	for (const item of derived.inbox ?? []) {
		if (item.kind === 'fork_adopt') hints.push(`世界线等你裁决:${item.summary}`)
		if (item.kind === 'skill_candidate') hints.push(`技能候选等你扶正:${item.summary}`)
		if (item.kind === 'provisional_review') hints.push(`有一个临时采纳待复核:${item.summary}`)
		if (item.kind === 'plan_blocked') hints.push(`计划触礁,等你指示:${item.summary}`)
	}
	return hints
}

export function apply(ctx) {
	const commands = ctx.get('commands')
	const clearai = () => ctx.get('clearai')

	/** 会话键:与内核同一口径(exec.agent.id → sessionId)。 */
	const sessionOf = (invocation) => String(invocation.agent?.id ?? '')

	const readState = (invocation) => {
		const facade = clearai()
		if (facade === undefined) return { error: 'ClearAI 内核不在这个会话里(命令挂上了,内核没挂上)。' }
		const sessionId = sessionOf(invocation)
		const state = facade.state(sessionId)
		return { sessionId, state, derived: facade.derive(sessionId) }
	}

	commands.register({
		name: 'goal',
		description: '当前认识论目标:主张、判据、候选假设与各自的状态(只读,从账本现算)',
		handler: (invocation) => {
			const { state, derived, error } = readState(invocation)
			if (error !== undefined) return { kind: 'error', text: error }
			if (state.goal === null) return { kind: 'success', text: '还没有立目标。让模型用 SetGoal 立一个(带判据与至少两条候选假设)。' }
			const lines = [
				`目标(v${state.goal.revision} · ${state.goal.status}):${state.goal.claim}`,
				`判据:${state.goal.done_criteria}`,
				'',
				`完成度(派生):${derived.progress === null ? '—' : `${Math.round(derived.progress * 100)}%`} · 阶段:${derived.phase ?? '—'}`,
				'',
				'候选假设:',
			]
			for (const hypothesis of derived.hypotheses) {
				const marks = [`状态 ${hypothesis.status}`]
				if (hypothesis.supportedLevel !== null) marks.push(`支持到 ${hypothesis.supportedLevel}`)
				if (hypothesis.refutations > 0) marks.push(`推翻 ${hypothesis.refutations} 次`)
				if (hypothesis.inconclusive > 0) marks.push(`无法判定 ${hypothesis.inconclusive} 次`)
				lines.push(`- [${hypothesis.id}] ${hypothesis.claim}(${marks.join(' · ')})`)
				lines.push(`  推翻条件:${hypothesis.refute_when}`)
			}
			if (derived.hypotheses.length === 0) lines.push('(这条目标没带假设——它是在下限落地之前立的)')
			return { kind: 'success', text: lines.join('\n') }
		},
	})

	commands.register({
		name: 'plan',
		description: '活动计划:步骤状态与授权记号(只读,从账本现算)',
		handler: (invocation) => {
			const { state, derived, error } = readState(invocation)
			if (error !== undefined) return { kind: 'error', text: error }
			const plan = state.plans.find((candidate) => candidate.status === 'active') ?? null
			if (plan === null) {
				const closed = state.plans.length
				return { kind: 'success', text: closed === 0 ? '还没有计划。' : `当前没有活动计划(${closed} 份已收尾)。` }
			}
			const stamp = plan.confirmed_at !== null ? `已授权(${plan.confirmed_by === 'user' ? '人批准' : '按行为补写归属'} @ ${plan.confirmed_at})` : '未授权——系统不会自动续跑;显式推进时第一次交付会按事实记下归属'
			const lines = [
				`计划 ${plan.id}(${plan.steps.length} 步) · ${stamp}`,
				'',
				...plan.steps.map((step, index) => {
					const head = `${index + 1}. [${STEP_STATUS_LABEL[step.status] ?? step.status}] ${step.id}: ${step.do}`
					const tail = step.status === 'void' ? `\n   作废缘由:${step.voidReason ?? '—'}` : ''
					return head + tail
				}),
			]
			const hints = gateHints(derived)
			if (hints.length > 0) lines.push('', `此刻能做的:${hints.join(';')}`)
			return { kind: 'success', text: lines.join('\n') }
		},
	})

	commands.register({
		name: 'evidence',
		description: '证据面:评估卡裁决、进行中步骤的交付摘要(只读,从账本现算)',
		handler: (invocation) => {
			const { state, derived, error } = readState(invocation)
			if (error !== undefined) return { kind: 'error', text: error }
			const lines = []
			const audits = state.audits ?? []
			if (audits.length > 0) {
				lines.push('评估卡:')
				for (const audit of audits.slice(-12)) {
					const verdict = audit.verdict === null ? '裁决在飞' : (typeof audit.verdict === 'object' ? (audit.verdict.accepted === true ? 'accepted' : `not_accepted${audit.verdict.grade !== undefined ? `(${audit.verdict.grade})` : ''}`) : String(audit.verdict))
					lines.push(`- ${audit.step ?? '?'}:${verdict}`)
				}
			} else {
				lines.push('还没有评估卡。')
			}
			const plan = state.plans.find((candidate) => candidate.status === 'active') ?? null
			if (plan !== null) {
				const delivered = plan.steps.filter((step) => step.status === 'advanced')
				if (delivered.length > 0) {
					lines.push('', '已交付的步骤(结算单在 clear/evidence/):')
					for (const step of delivered) lines.push(`- ${step.id}: ${step.do}`)
				}
			}
			if ((state.facts ?? []).length > 0) {
				lines.push('', '已升格的事实:')
				for (const fact of state.facts.slice(-8)) lines.push(`- ${fact.text}`)
			}
			return { kind: 'success', text: lines.join('\n') }
		},
	})

	commands.register({
		name: 'worldline',
		description: '世界线:分叉、分支读数与终局(只读,从账本现算)',
		handler: (invocation) => {
			const { derived, error } = readState(invocation)
			if (error !== undefined) return { kind: 'error', text: error }
			const forks = derived.forks ?? []
			if (forks.length === 0) return { kind: 'success', text: '还没有分叉。真分歧(跑完才知道谁更好)出现时,模型会用 ForkPlan 开世界线。' }
			const lines = []
			for (const fork of forks) {
				const extra = fork.orphaned ? '(随步骤作古而终止)' : fork.phase === 'deciding' ? '(在等你的裁决——面板或人门卡)' : ''
				lines.push(`分叉 ${fork.id} [${fork.phase}]${extra}: ${fork.question}`)
				lines.push(`  尺子:${fork.decideBy?.metric ?? '—'}(取${fork.decideBy?.direction === 'min' ? '最小' : '最大'})`)
				for (const branch of fork.branches) {
					const flags = [branch.id === fork.recommended ? '推荐' : null, branch.failed ? '执行失败' : null, branch.unreturned ? '执行者未归' : null, branch.orphaned ? '孤儿' : null].filter((flag) => flag !== null).join(' · ')
					lines.push(`  - ${branch.label}(${branch.status}${flags === '' ? '' : ` · ${flags}`}) 读数 ${branch.reading ?? '—'}`)
				}
				if (fork.merge !== null && fork.merge !== undefined) {
					const label = fork.branches.find((branch) => branch.id === fork.merge.branch)?.label ?? fork.merge.branch
					lines.push(`  终局:采纳「${label}」(${fork.merge.by === 'user' ? '人裁决' : '算术收敛'}${fork.merge.provisional === true ? ' · 临时采纳,待复核' : ''})`)
				}
			}
			return { kind: 'success', text: lines.join('\n') }
		},
	})

	commands.register({
		name: 'plan-review',
		description: '把当前计划重新呈给你审阅(原生审阅卡)。批准才会落授权记号',
		handler: (invocation) => {
			const { state, derived, error } = readState(invocation)
			if (error !== undefined) return { kind: 'error', text: error }
			const plan = state.plans.find((candidate) => candidate.status === 'active') ?? null
			if (plan === null) return { kind: 'error', text: '没有活动计划——无可呈审。' }
			if (derived.planConfirmationPending !== true) {
				return { kind: 'success', text: `这份计划已有授权(${plan.confirmed_by === 'user' ? '人批准' : '按行为记下的归属'}),不需要重呈。` }
			}
			/**
			 * 呈审本身由模型侧的 RequestPlanReview 做:授权记号只能随工具结果的 meta.mutations
			 * 落账,命令处理器没有那条通道(这是权威边界,不是缺功能)。所以这里把一句结构化的
			 * 请求 steer 给模型——与人在输入框里打同一句话等价,只是免打字、带先决检查。
			 */
			const message = {
				id: `clearai-cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
				role: 'user',
				content: [{ type: 'text', text: '请用 RequestPlanReview 把当前计划重新呈给我审阅。' }],
				source: { kind: 'user' },
			}
			const agent = invocation.agent
			if (agent.status === 'running') agent.steer(message)
			else agent.followup(message)
			return { kind: 'success', text: '已让模型把计划重新呈给你审(RequestPlanReview)——审阅卡出来时,批准才会落授权记号。' }
		},
	})
}
