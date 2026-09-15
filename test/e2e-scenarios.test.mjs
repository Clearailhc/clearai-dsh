/**
 * 长测剧本与不变量的**快测**:不开会话、不花 token,用合成日志验「断言本身会不会抓人」。
 *
 * 为什么需要它:长测的结论全靠这些断言。如果断言写漏了(比如 `countOf` 拼错、上下文取错),
 * 长测会以「全绿」的姿势骗人——那比没有长测更糟。所以每个不变量都配一个**反例**:
 * 造一份坏日志,断言必须红;再造一份好日志,断言必须绿。
 *
 * 跑法:node test/e2e-scenarios.test.mjs
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')

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

const { SCENARIOS, INVARIANTS } = await import(join(PORT, 'tools', 'e2e-scenarios.mjs'))

/** 把一串变更包成不变量要的上下文(与 e2e-run.mjs 里那份同形)。 */
function contextOf(mutations, overrides = {}) {
	const countOf = (kind) => mutations.filter((mutation) => mutation.t === kind).length
	return {
		mutations,
		kinds: new Set(mutations.map((mutation) => mutation.t)),
		countOf,
		// 默认「盘上什么都没有」:空日志配 `exists: () => true` 会让物证类断言假绿。
		exists: () => false,
		readArtifact: () => '',
		called: () => true,
		events: [],
		toolCalls: [],
		// 默认「模型什么都没看到」:默认值给了正文就等于把这条不变量架空。
		modelVisibleText: '',
		workspace: '/tmp',
		projected: { plan: { steps: [] } },
		derived: { hypotheses: [] },
		state: {},
		evidenceVerdicts: [],
		promotedIds: [],
		hypothesisStatus: {},
		projectedSteps: 0,
		memoryEntries: 0,
		...overrides,
	}
}

/** 一份**健康**的日志骨架:立约 → 两步入计划 → 准入 → 推进 → 收尾。 */
const HEALTHY = [
	{ t: 'goal/set', id: 'g1', hypotheses: [{ id: 'h1', claim: 'A' }, { id: 'h2', claim: 'B' }] },
	{ t: 'plan/created', id: 'p1', steps: [{ id: 's1', artifacts: ['lab/a.txt'] }, { id: 's2', artifacts: [] }] },
	{ t: 'admission/checked', step: 's1' },
	{ t: 'evidence/recorded', step: 's1', verdict: 'support' },
	{ t: 'step/advanced', step: 's1' },
	{ t: 'audit/dispatched', id: 'a1' },
	{ t: 'audit/settled', id: 'a1' },
	{ t: 'plan/closed', plan: 'p1' },
	{ t: 'goal/closed', goal: 'g1' },
]

const invariantNamed = (fragment) => INVARIANTS.find((invariant) => invariant.label.includes(fragment))

console.log('\n【① 剧本表自身完整】')
{
	const names = Object.keys(SCENARIOS)
	check('至少四个剧本(长测要有覆盖面)', names.length >= 4, names.join(','))
	const incomplete = names.filter((name) => {
		const scenario = SCENARIOS[name]
		return typeof scenario.title !== 'string' || typeof scenario.why !== 'string' || typeof scenario.task !== 'string' || typeof scenario.asserts !== 'function'
	})
	check('每个剧本都有 title/why/task/asserts(缺一样就没法复盘)', incomplete.length === 0, incomplete.join(','))
	// 任务书必须**点名机制**:测的是装配,任务不说用哪个工具,模型就可能绕开它——那场就白跑了。
	const MECHANISMS = ['SetGoal', 'CreatePlan', 'ForkPlan', 'AdvanceWorldline', 'ConvergeFork', 'SpawnScout', 'ClosePlan', 'CloseGoal', 'WriteMemory']
	const vague = names.filter((name) => !MECHANISMS.some((tool) => SCENARIOS[name].task.includes(tool)))
	check('每个任务书都点名了它要验的机制(否则跑的是模型的自由发挥)', vague.length === 0, vague.join(','))
}

console.log('\n【② 不变量:健康日志全绿】')
{
	const ctx = contextOf(HEALTHY, { exists: () => true, projected: { plan: { steps: [{ id: 's1' }, { id: 's2' }] } }, projectedSteps: 2 })
	for (const invariant of INVARIANTS) {
		const outcome = invariant.run(ctx)
		check(`健康日志不误报:${invariant.label.slice(0, 24)}…`, outcome.ok, outcome.detail ?? '')
	}
}

console.log('\n【③ 不变量:坏日志必须红(不然长测会骗人)】')
{
	const skipAdmission = invariantNamed('跳过准入')
	const bad = HEALTHY.filter((mutation) => mutation.t !== 'admission/checked')
	check('推进前没有准入 ⇒ 抓住', skipAdmission.run(contextOf(bad)).ok === false, JSON.stringify(skipAdmission.run(contextOf(bad)).detail))

	const danglingAudit = invariantNamed('评估者没有悬空')
	const dangling = [...HEALTHY.filter((mutation) => mutation.t !== 'audit/settled'), { t: 'audit/dispatched', id: 'a2' }]
	check('评估者派了没收 ⇒ 抓住', danglingAudit.run(contextOf(dangling)).ok === false, JSON.stringify(danglingAudit.run(contextOf(dangling)).detail))

	const orphanFork = invariantNamed('分叉不留孤儿')
	const orphan = [...HEALTHY, { t: 'fork/created', id: 'f1' }]
	check('分叉开了没收口 ⇒ 抓住', orphanFork.run(contextOf(orphan)).ok === false, JSON.stringify(orphanFork.run(contextOf(orphan)).detail))

	const wrongStep = invariantNamed('证据都挂在存在的步骤上')
	const stray = [...HEALTHY, { t: 'evidence/recorded', step: 's99', verdict: 'support' }]
	check('证据挂在不存在的一步上 ⇒ 抓住', wrongStep.run(contextOf(stray)).ok === false, JSON.stringify(wrongStep.run(contextOf(stray)).detail))

	const missingArtifact = invariantNamed('声明的物证真的在盘上')
	const noFile = contextOf(HEALTHY)
	check('推进了却没有物证文件 ⇒ 抓住', missingArtifact.run(noFile).ok === false, JSON.stringify(missingArtifact.run(noFile).detail))

	const danglingScout = invariantNamed('侦察没有悬空')
	check('侦察派了没收 ⇒ 抓住', danglingScout.run(contextOf([...HEALTHY, { t: 'scout/dispatched', id: 's1' }])).ok === false)
	check('侦察派了也收了 ⇒ 放过', danglingScout.run(contextOf([...HEALTHY, { t: 'scout/dispatched', id: 's1' }, { t: 'scout/settled', id: 's1' }])).ok === true)
}

console.log('\n【③b 升格与证据等级自洽:两边都要抓】')
{
	const promotion = invariantNamed('升格与证据等级自洽')
	// 门槛与证据等级**分开给**:写成一个参数就会把「没到级」测成「到了级」。
	const atLevel = (threshold, evidenceLevel, extra = []) =>
		contextOf([
			...HEALTHY,
			{ t: 'goal/set', id: 'g1', promote_at_level: threshold },
			{ t: 'evidence/recorded', step: 's1', level: evidenceLevel, verdict: 'support' },
			...extra,
		])
	const promoted = [{ t: 'fact/promoted', text: 'A' }]
	check('没到级却升格了 ⇒ 抓住', promotion.run(atLevel('L3', 'L2', promoted)).ok === false, JSON.stringify(promotion.run(atLevel('L3', 'L2', promoted)).detail))
	check('没到级也没升格 ⇒ 放过(机制的正确姿势)', promotion.run(atLevel('L3', 'L2')).ok === true, JSON.stringify(promotion.run(atLevel('L3', 'L2')).detail))
	check('到了级却没升格 ⇒ 抓住', promotion.run(atLevel('L2', 'L2')).ok === false, JSON.stringify(promotion.run(atLevel('L2', 'L2')).detail))
	check('到了级也升格了 ⇒ 放过', promotion.run(atLevel('L2', 'L2', promoted)).ok === true, JSON.stringify(promotion.run(atLevel('L2', 'L2', promoted)).detail))
	// 修订后的步骤不算孤儿:长测第一版就是在这里误报的。
	const evidenceOnAmendedStep = invariantNamed('证据都挂在存在的步骤上')
	const amended = [...HEALTHY, { t: 'plan/amended', step: { id: 'crosscheck2', artifacts: [] } }, { t: 'evidence/recorded', step: 'crosscheck2', verdict: 'support' }]
	check('证据挂在**修订后新增**的步上 ⇒ 放过', evidenceOnAmendedStep.run(contextOf(amended)).ok === true, JSON.stringify(evidenceOnAmendedStep.run(contextOf(amended)).detail))
	// 先记证据、后作废该步:那是历史,不是孤儿(世界线场真跑里就是这个形态)。
	const evidenceThenVoid = [...HEALTHY, { t: 'plan/amended', step: { id: 'crosscheck2', artifacts: [] } }, { t: 'evidence/recorded', step: 'crosscheck2', verdict: 'support' }, { t: 'plan/voided', step: 'crosscheck2' }]
	check('证据先记、该步后作废 ⇒ 放过(不追溯)', evidenceOnAmendedStep.run(contextOf(evidenceThenVoid)).ok === true, JSON.stringify(evidenceOnAmendedStep.run(contextOf(evidenceThenVoid)).detail))
	// 作废之后还有人往那步上记证据:那才是孤儿。
	const voidThenEvidence = [...HEALTHY, { t: 'plan/amended', step: { id: 'crosscheck2', artifacts: [] } }, { t: 'plan/voided', step: 'crosscheck2' }, { t: 'evidence/recorded', step: 'crosscheck2', verdict: 'support' }]
	check('该步作废之后又记证据 ⇒ 抓住', evidenceOnAmendedStep.run(contextOf(voidThenEvidence)).ok === false)

	// 合成锚点:目标级审计的证据挂在 `goal:<目标id>` 上;锚点所指的目标必须存在。
	const goalLevelEvidence = [...HEALTHY, { t: 'evidence/recorded', step: 'goal:g1', verdict: 'support' }]
	check('证据挂在目标级合成锚点上 ⇒ 放过(锚点所指目标存在)', evidenceOnAmendedStep.run(contextOf(goalLevelEvidence)).ok === true, JSON.stringify(evidenceOnAmendedStep.run(contextOf(goalLevelEvidence)).detail))
	const bogusAnchor = [...HEALTHY, { t: 'evidence/recorded', step: 'goal:g-nope', verdict: 'support' }]
	check('合成锚点指向不存在的目标 ⇒ 抓住', evidenceOnAmendedStep.run(contextOf(bogusAnchor)).ok === false)
	// `plan/amended` 是**单个** step 对象(不是数组):按 amended 补的步上记证据不算孤儿。
	const amendedSingle = [...HEALTHY, { t: 'plan/amended', step: { id: 'verify-inventory-v2', artifacts: [] } }, { t: 'evidence/recorded', step: 'verify-inventory-v2', verdict: 'support' }]
	check('证据挂在 AmendPlan 补的步上 ⇒ 放过', evidenceOnAmendedStep.run(contextOf(amendedSingle)).ok === true, JSON.stringify(evidenceOnAmendedStep.run(contextOf(amendedSingle)).detail))

	// 目标未结案时,「到级了没升格」不该判违规(升格只发生在 CloseGoal 那一刻)。
	const openGoal = contextOf([
		...HEALTHY.filter((m) => m.t !== 'goal/closed'),
		{ t: 'goal/set', id: 'g1', promote_at_level: 'L2' },
		{ t: 'evidence/recorded', step: 's1', level: 'L2', verdict: 'support' },
	])
	check('目标未结案 ⇒ 不要求升格(只判「没到级不许升格」)', promotion.run(openGoal).ok === true, JSON.stringify(promotion.run(openGoal).detail))
}

console.log('\n【③c 异步子 run 的结论:账上有 ≠ 心里有】')
{
	const visible = invariantNamed('异步子 run 的结论对模型可见')
	const conclusion = '侦察结论(只读):clear/skills 下共 18 条技能,其中 SKILL.md 覆盖 18/18。'
	const withScout = [...HEALTHY, { t: 'scout/settled', id: 's-1', conclusion, note: null }]
	// 反例:结论只在变更记录里——这正是上一轮把那场 36/36 判成绿的形态。
	const onlyInLedger = contextOf(withScout)
	check('结论只躺在账本里 ⇒ 抓住(上一轮假绿的墓志铭)', visible.run(onlyInLedger).ok === false, JSON.stringify(visible.run(onlyInLedger).detail))
	// 正例之一:结论出现在工具结果的消息体里。
	const inToolResult = contextOf(withScout, { modelVisibleText: `回了 1 条结论\n${conclusion}` })
	check('结论出现在工具返回里 ⇒ 放过', visible.run(inToolResult).ok === true, JSON.stringify(visible.run(inToolResult).detail))
	// 正例之二:结论出现在 **user/message** 里——原生结算通知走的就是这条。
	const inNotice = contextOf(withScout, { modelVisibleText: `Background subagent s-1 finished.\nIts closing message:\n${conclusion}` })
	check('结论出现在原生通知(user/message)里 ⇒ 放过', visible.run(inNotice).ok === true, JSON.stringify(visible.run(inNotice).detail))
	// 执行者那条同样要查(否则只有侦察被修)。
	const withExecutor = [...HEALTHY, { t: 'worldline/executed', fork: 'k-1', branch: 'b-1', child: 'c-1', ok: true, conclusion, note: null }]
	check('执行者的结论只躺在账本里 ⇒ 同样抓住', visible.run(contextOf(withExecutor)).ok === false, JSON.stringify(visible.run(contextOf(withExecutor)).detail))
	// 被截断后进消息:特征串取开头一段,截断也能认出来(避免判据自己制造假红)。
	const long = `${'甲'.repeat(200)}结尾`
	const truncated = contextOf([...HEALTHY, { t: 'scout/settled', id: 's-2', conclusion: long, note: null }], { modelVisibleText: `${long.slice(0, 120)}…已截断,全文 203 字` })
	check('正文被截断后进消息(带指针)⇒ 仍算送达', visible.run(truncated).ok === true, JSON.stringify(visible.run(truncated).detail))
}

console.log('\n【④ 剧本断言:用坏上下文必须红】')
{
	const empty = contextOf([])
	const worldline = SCENARIOS['worldline-arbitration']
	const falsification = SCENARIOS.falsification
	// **安全性质**在空日志上恒真是对的(「被推翻的不许升格」,没有事实就没有违规);
	// 其余断言在空日志上必须全红,否则「它在看日志」这句话就不成立。
	const SAFETY = '安全性质'
	// 侦察剧本里「产物引用了侦察结论」那一条:读不到文件 ⇒ 红;读到且含「侦察」⇒ 绿。
	const scout = SCENARIOS['scout-first']
	const citing = scout.asserts(contextOf([{ t: 'scout/dispatched', id: 's-1', child: 'c-1' }, { t: 'scout/settled', id: 's-1', conclusion: '共 18 条', path: null }], { readArtifact: () => '清单(据侦察结论):18 条技能。' }))
	const noCite = scout.asserts(contextOf([{ t: 'scout/dispatched', id: 's-1', child: 'c-1' }, { t: 'scout/settled', id: 's-1', conclusion: '共 18 条', path: null }], { readArtifact: () => '清单:18 条技能。' }))
	const citeCheck = (rows) => rows.find((row) => row.label.includes('引用了侦察结论'))
	check('产物引用了侦察结论 ⇒ 放过', citeCheck(citing).ok === true, JSON.stringify(citeCheck(citing).detail))
	check('产物没引用侦察结论 ⇒ 抓住(送达要被用上,不只是进了上下文)', citeCheck(noCite).ok === false, JSON.stringify(citeCheck(noCite).detail))

	const worldlineEmpty = worldline.asserts(empty)
	check('世界线剧本在空日志上一条都立不住(断言真的在看日志)', worldlineEmpty.every((assertion) => assertion.ok === false), `${worldlineEmpty.filter((a) => a.ok).length} 条意外通过`)
	const falsificationEmpty = falsification.asserts(empty).filter((assertion) => !assertion.label.includes(SAFETY))
	check('证伪剧本的**活性**断言在空日志上全红(安全性质那条按定义恒真,已排除)', falsificationEmpty.every((assertion) => assertion.ok === false), `${falsificationEmpty.filter((a) => a.ok).length} 条意外通过`)
	// 证伪剧本的核心断言必须真的能区分「被推翻的假设不许升格」。
	const sneaky = contextOf([], {
		promotedIds: ['h2'],
		hypothesisStatus: { h1: 'alive', h2: 'refuted' },
		evidenceVerdicts: ['support', 'refute'],
	})
	const guard = falsification.asserts(sneaky).find((assertion) => assertion.label.includes('升格成事实'))
	check('「被推翻的假设不许升格成事实」这条会抓人', guard.ok === false, JSON.stringify(guard.detail))
	const clean = contextOf([], { promotedIds: ['h1'], hypothesisStatus: { h1: 'alive', h2: 'refuted' }, evidenceVerdicts: ['support', 'refute'] })
	const guardOk = falsification.asserts(clean).find((assertion) => assertion.label.includes('升格成事实'))
	check('同一断言在干净日志上放过', guardOk.ok === true, JSON.stringify(guardOk.detail))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
