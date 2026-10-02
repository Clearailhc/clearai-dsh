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

const { SCENARIOS, INVARIANTS, evaluateLog } = await import(join(PORT, 'tools', 'e2e-scenarios.mjs'))

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
	const MECHANISMS = ['Frame', 'CreatePlan', 'ClosePlan', 'Conclude']
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

	const wrongStep = invariantNamed('证据都挂在存在的步骤上')
	const stray = [...HEALTHY, { t: 'evidence/recorded', step: 's99', verdict: 'support' }]
	check('证据挂在不存在的一步上 ⇒ 抓住', wrongStep.run(contextOf(stray)).ok === false, JSON.stringify(wrongStep.run(contextOf(stray)).detail))

	const missingArtifact = invariantNamed('声明的物证真的在盘上')
	const noFile = contextOf(HEALTHY)
	check('推进了却没有物证文件 ⇒ 抓住', missingArtifact.run(noFile).ok === false, JSON.stringify(missingArtifact.run(noFile).detail))

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
	// 先记证据、后作废该步:那是历史,不是孤儿(真跑里见过这个形态)。
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
	check('证据挂在 RevisePlan(add)补的步上 ⇒ 放过', evidenceOnAmendedStep.run(contextOf(amendedSingle)).ok === true, JSON.stringify(evidenceOnAmendedStep.run(contextOf(amendedSingle)).detail))

	// 目标未结案时,「到级了没升格」不该判违规(升格只发生在 Conclude 那一刻)。
	const openGoal = contextOf([
		...HEALTHY.filter((m) => m.t !== 'goal/closed'),
		{ t: 'goal/set', id: 'g1', promote_at_level: 'L2' },
		{ t: 'evidence/recorded', step: 's1', level: 'L2', verdict: 'support' },
	])
	check('目标未结案 ⇒ 不要求升格(只判「没到级不许升格」)', promotion.run(openGoal).ok === true, JSON.stringify(promotion.run(openGoal).detail))
}

console.log('\n【④ 剧本断言:用坏上下文必须红】')
{
	const empty = contextOf([])
	const routes = SCENARIOS['competing-routes']
	const falsification = SCENARIOS.falsification
	// **安全性质**在空日志上恒真是对的(「被推翻的不许升格」,没有事实就没有违规);
	// 其余断言在空日志上必须全红,否则「它在看日志」这句话就不成立。
	const SAFETY = '安全性质'
	// 两类断言在空日志上恒真是**对的**,不算「意外通过」:
	//   · 安全性质(「被推翻的不许升格」:没有事实就没有违规);
	//   · 条件断言(前提不成立就不适用)——前提由别的断言保证。
	const vacuouslyTrue = (label) => label.includes('安全性质') || label.includes('条件断言')
	// 「没有两步撞路径」是安全性质:空日志上恒真,其余在空日志上必须全红。
	const routesEmpty = routes.asserts(empty).filter((assertion) => !assertion.label.includes('没有两步声明同一产物'))
	check('竞争路线剧本的活性断言在空日志上全红(断言真的在看日志)', routesEmpty.every((assertion) => assertion.ok === false), `${routesEmpty.filter((a) => a.ok).length} 条意外通过`)
	// 两步声明同一个产物 ⇒ 抓住;各占一处 ⇒ 放过。
	const clashRow = (steps) => routes.asserts(contextOf([{ t: 'plan/created', id: 'p1', steps }])).find((row) => row.label.includes('没有两步声明同一产物'))
	check('两步声明同一产物 ⇒ 抓住(并行路线会互相覆盖)', clashRow([{ id: 's1', artifacts: ['lab/data.json'] }, { id: 's2', artifacts: ['lab/data.json'] }]).ok === false)
	check('两步各占一处产物 ⇒ 放过', clashRow([{ id: 's1', artifacts: ['lab/compact/data.json'] }, { id: 's2', artifacts: ['lab/pretty/data.json'] }]).ok === true)
	const falsificationEmpty = falsification.asserts(empty).filter((assertion) => !vacuouslyTrue(assertion.label))
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

console.log('\n【⑤ 模拟宿主:真内核 + 外部评估者 + 同一个判官】')
{
	const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs')
	const { tmpdir } = await import('node:os')
	const { readKernelConfig } = await import(join(PORT, 'tools', 'sim', 'config.mjs'))
	const { makeSimHost } = await import(join(PORT, 'tools', 'sim', 'host.mjs'))
	const { apply } = await import(join(PORT, 'preset', 'plugins', 'clearai-kernel.js'))

	const config = readKernelConfig(join(PORT, 'preset', 'agent.cordis.yml'))
	check('配置读取:与预设同一份(连拦阈值、假设下限、机制贡献)', config.blockedThreshold === 2 && config.minHypotheses === 2 && config.contributions?.mechanisms?.goal === true && Array.isArray(config.auditToolFilter), JSON.stringify(config).slice(0, 160))

	const root = mkdtempSync(join(tmpdir(), 'clearai-sim-'))
	const workspace = join(root, 'ws')
	mkdirSync(workspace, { recursive: true })
	process.env.DSH_HOME = join(root, 'home')
	const host = makeSimHost({ workspace, runDir: join(root, 'run') })
	apply(host.ctx, { ...config, auditTimeoutMs: 5000 })
	check('装上:6 件工具、3 段提示词', host.tools.size === 6 && host.sections.length === 3, `${host.tools.size} / ${host.sections.length}`)

	const goal = await host.call('Frame', { headline: '判定 A', claim: '判定 A 是否成立', done_criteria: '存在一份文件 lab/v.md', hypotheses: [{ claim: 'A 成立', refute_when: '读数不是 2' }, { claim: 'A 不成立', refute_when: '读数是 2' }] })
	check('工具结果给模型的是内核的原话,不是一句 ok', goal.ok === true && /现在的状态/.test(goal.text), goal.text.slice(0, 120))
	const hypothesis = host.mutations().find((mutation) => mutation.t === 'goal/set')?.hypotheses?.[0]?.id
	await host.call('CreatePlan', { brief: `## 做法\n${'跑一次,记读数。'.repeat(30)}\n\n## 判据\n读数为 2。`, steps: [{ id: 'run', do: '跑一次', artifacts: ['lab/run.txt'], done_criteria: 'lab/run.txt 存在,含读数', tests: { hypotheses: [hypothesis], level: 'L3' } }] })
	check('立约时原生 goal 建好了(续跑交给它)', host.goal()?.phase === 'active', JSON.stringify(host.goal()))
	check('建计划不再问人(审阅记号删了)', host.humanAnswers.length === 0, JSON.stringify(host.humanAnswers))
	mkdirSync(join(workspace, 'lab'), { recursive: true })
	writeFileSync(join(workspace, 'lab', 'run.txt'), 'value=2\n')
	const delivering = host.call('AdvancePlan', { step_id: 'run', basis: 'lab/run.txt 第 1 行 value=2' })
	await new Promise((done) => setTimeout(done, 50))
	const request = [...host.pending.values()].find((entry) => entry.settled === false)
	check('L3 交付把评估者挂起来,等外部交回裁决(提示词是正文,不是对象)', request !== undefined && request.prompt.length > 40 && !request.prompt.includes('[object Object]'), String(request?.prompt ?? '').slice(0, 80))
	host.settle(request.id, { structured: { holds: 'yes', basis: 'lab/run.txt 第 1 行 value=2', results: [{ hypothesis, verdict: 'support', basis: '读数是 2' }], refs: [{ path: 'lab/run.txt', line: 1 }] } })
	const delivered = await delivering
	const kinds = host.mutations().map((mutation) => mutation.t)
	check('交回裁决之后交付落定:派发、结算、推进都在账上', delivered.ok === true && kinds.includes('audit/dispatched') && kinds.includes('audit/settled') && kinds.includes('step/advanced'), kinds.join(','))
	check('结果针对那条判断落成证据', host.mutations().some((mutation) => mutation.t === 'evidence/recorded' && mutation.hypothesis === hypothesis && mutation.verdict === 'support'), JSON.stringify(host.mutations().filter((mutation) => mutation.t === 'evidence/recorded')))
	const evaluated = await evaluateLog({ scenario: null, events: host.events, mutations: host.mutations(), workspace, exists: () => true, called: () => true })
	check('同一个判官认得模拟宿主的日志(不变量全过)', evaluated.checks.every((item) => item.ok), JSON.stringify(evaluated.checks.filter((item) => !item.ok).map((item) => item.label)))
	rmSync(root, { recursive: true, force: true })
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
