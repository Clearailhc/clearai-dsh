/**
 * 对比套件 —— 把**真实现场**在新机制下的读数与旧读数并排钉住。
 *
 * 现场(两处来源,按可用性取第一个):本机完整导出 `.tmp-session/session.v4.jsonl`
 * (DSH 会话 9dc1fe2b · 2026-09-29 · 工作区 chouxiang,1635 事件 / 13.9MB);
 * 或**随仓库走的夹具** `test/fixtures/session-9dc1fe2b-closegoal.jsonl`(同一会话切出来的
 * 17 条事件(5 次结案 + 5 条结果 + 7 次立约,够 A/C 两组用,见那里的 README)。为什么必须有夹具:完整导出是 gitignore 的临时物,
 * 干净检出(CI、新克隆)上只读它会**直接崩**——2026-09-29 的发布流程就是这么红的。
 * 诊断见 `.tmp-audit/DIAGNOSIS.md`(若本机有)。
 * 每一条断言都写成「旧读数 → 新读数」两个数:只报新读数的话,没人知道它修的是什么。
 *
 * **A 组为什么用结构性断言(而不是重放)**:重放整条 CloseGoal 链要拉起内核的 pre-step、
 * 子代理生命周期、宿主投影单元,成本远高于收益;而「派发事实在 `await` 之前独立落账」与
 * 「宿主半没有属性式服务访问」都是**结构性**性质——源码读得出来,判据指向的行号稳定。
 * 会话本身的读数(5 次结案的结局分类、账上落了几条 audit 事实)照旧从真导出里数。
 * **B/C 组不走源码文本**:它们是真函数(`deriveKnowledge` / `graphProjection`)的行为断言。
 *
 * 跑法:node test/contrast.test.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyMutations, derive, deriveKnowledge, emptyState } from '../ui/lib/fold.js'
import { graphProjection } from '../ui/lib/domain-language.js'

const PORT = join(import.meta.dirname, '..')
/**
 * 真会话的两处来源。**优先完整导出**(本机),退回**随仓库的夹具**(CI / 干净检出)。
 * 两处都没有 = 仓库坏了(夹具是提交进版本库的),那时如实报错,不假装通过。
 */
const SESSION_SOURCES = [join(PORT, '.tmp-session', 'session.v4.jsonl'), join(import.meta.dirname, 'fixtures', 'session-9dc1fe2b-closegoal.jsonl')]
const SESSION_FILE = SESSION_SOURCES.find((candidate) => existsSync(candidate)) ?? null
if (SESSION_FILE === null) {
	console.log(`✗ 对照套件需要一个真会话导出,但两处都没有:\n  ${SESSION_SOURCES.join('\n  ')}\n  夹具是随仓库提交的:它不在,说明仓库被改坏了(见 test/fixtures/README.md)。`)
	process.exit(1)
}
const KERNEL_SOURCE = readFileSync(join(PORT, 'preset', 'plugins', 'clearai-kernel.js'), 'utf8')
const HOST_SOURCE = readFileSync(join(PORT, 'ui', 'lib', 'index.js'), 'utf8')

let passed = 0
let failed = 0
const failures = []
function check(label, condition, detail = '') {
	if (condition) {
		passed += 1
		console.log(`  ✓ ${label}`)
	} else {
		failed += 1
		failures.push(label)
		console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`)
	}
}

/** 取一个函数的函数体(按缩进一级的收尾大括号切)。结构性断言全靠它。 */
function functionBody(source, marker, indent = '\t') {
	const start = source.indexOf(marker)
	if (start < 0) return null
	const tail = `\n${indent}}`
	const end = source.indexOf(tail, start)
	return end < 0 ? source.slice(start) : source.slice(start, end)
}

/**
 * 把注释与字符串**按位替换成空格**(长度不变),好让 `indexOf('await')` 只找到真代码里的 await。
 *
 * 为什么必须有:内核的注释里就写着「工具在 `await` 期间可能被 abort」——
 * 不屏蔽注释,判据会指着那句注释说「await 在这里」,而真正的落账语句明明在它前面。
 * 位置一一对应(空格替换不改变下标),所以还能拿同一个下标回到原文取上下文。
 */
function maskCommentsAndStrings(text) {
	let out = ''
	let index = 0
	let state = null
	const blank = (count) => ' '.repeat(count)
	while (index < text.length) {
		const char = text[index]
		const next = text[index + 1]
		if (state === null) {
			if (char === '/' && next === '/') {
				state = 'line'
				out += blank(2)
				index += 2
				continue
			}
			if (char === '/' && next === '*') {
				state = 'block'
				out += blank(2)
				index += 2
				continue
			}
			if (char === "'" || char === '"' || char === '`') {
				state = char
				out += ' '
				index += 1
				continue
			}
			out += char
			index += 1
			continue
		}
		if (state === 'line') {
			if (char === '\n') {
				state = null
				out += '\n'
			} else out += ' '
			index += 1
			continue
		}
		if (state === 'block') {
			if (char === '*' && next === '/') {
				state = null
				out += blank(2)
				index += 2
			} else {
				out += char === '\n' ? '\n' : ' '
				index += 1
			}
			continue
		}
		// 字符串/模板串内部:整体抹平(转义序列按两格算,保持长度)。
		if (char === '\\') {
			out += blank(2)
			index += 2
			continue
		}
		if (char === state) {
			state = null
			out += ' '
			index += 1
			continue
		}
		out += char === '\n' ? '\n' : ' '
		index += 1
	}
	return out
}

// ═══ A 组 · CloseGoal:结局分类与「账上有几条 audit 事实」═══════════════════
//
// 旧读数(真会话):5 次 CloseGoal → 1 inconclusive(落地) + 4 失败(1 次平台错
// `cannot get required service "sessions" in inactive context` + 3 次被打断);
// **goal_audit 事实只有 2 条**(只有那一次落地的结案留下了 dispatched + settled),
// 而 #2 那次评估者其实跑满 174s 并算出 refute——它从账本上不存在。
// 新读数(新机制):派发事实在 `await` 之前独立落账 ⇒ 每次结案至少留下一条,
// throw / abort 都抹不掉;`turnDemand` 的 hold 与 `sweepEndedAudits` 才看得见它。

console.log('\n【A 组 · 真会话:5 次结案的结局与账上的 audit 事实】')
console.log(`  现场:${SESSION_FILE.includes('fixtures') ? '随仓库夹具' : '本机完整导出'} ${SESSION_FILE.replace(`${PORT}/`, '')}`)
const events = readFileSync(SESSION_FILE, 'utf8')
	.split('\n')
	.filter((line) => line.trim() !== '')
	.map((line) => JSON.parse(line))

const closeGoalCalls = events.filter((event) => event.type === 'tool/call' && event.data?.name === 'CloseGoal')
const resultsByCallId = new Map(events.filter((event) => event.type === 'tool/result' && event.data?.message?.toolCallId).map((event) => [event.data.message.toolCallId, event.data]))
const textOf = (data) => (data?.message?.content ?? []).filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n')
const mutationsOf = (data) => (Array.isArray(data?.meta?.mutations) ? data.meta.mutations : [])

const closeGoalFacts = []
for (const call of closeGoalCalls) {
	const data = resultsByCallId.get(call.data.callId)
	const auditFacts = mutationsOf(data).filter((mutation) => String(mutation?.t ?? '').startsWith('audit/'))
	const text = textOf(data)
	const outcome = /裁决[:：]inconclusive/.test(text) ? 'inconclusive' : data?.message?.isError === true ? 'failed' : 'unknown'
	closeGoalFacts.push({ callId: call.data.callId, outcome, auditFacts, text: text.slice(0, 80) })
}
const inconclusive = closeGoalFacts.filter((entry) => entry.outcome === 'inconclusive').length
const failedAttempts = closeGoalFacts.filter((entry) => entry.outcome === 'failed').length
const landedGoalFacts = closeGoalFacts.reduce((count, entry) => count + entry.auditFacts.length, 0)
const attemptsWithFacts = closeGoalFacts.filter((entry) => entry.auditFacts.length > 0).length
const goalAuditKinds = closeGoalFacts.flatMap((entry) => entry.auditFacts).map((mutation) => mutation.t)

check('真会话里 CloseGoal 共 5 次(读数非空跑)', closeGoalCalls.length === 5, String(closeGoalCalls.length))
check('结局分类:1 次 inconclusive + 4 次失败', inconclusive === 1 && failedAttempts === 4, `inconclusive=${inconclusive} failed=${failedAttempts}`)
check(
	'4 次失败里含 1 次平台错(inactive context)+ 3 次被打断',
	closeGoalFacts.filter((entry) => /inactive context/.test(entry.text)).length === 1 && closeGoalFacts.filter((entry) => /aborted/.test(entry.text)).length === 3,
	closeGoalFacts.map((entry) => entry.outcome).join(','),
)
check('旧读数:goal_audit 事实只有 2 条(1 dispatched + 1 settled)', landedGoalFacts === 2, String(landedGoalFacts))
check('旧读数:5 次结案里只有 1 次留下了 audit 事实', attemptsWithFacts === 1, `${attemptsWithFacts}/5`)
check('两条事实成对(dispatched 与 settled 同源)', goalAuditKinds.filter((kind) => kind === 'audit/dispatched').length === 1 && goalAuditKinds.filter((kind) => kind === 'audit/settled').length === 1, goalAuditKinds.join(','))

// ── 新机制的结构判据 ─────────────────────────────────────────────────────
const evaluatorBody = functionBody(KERNEL_SOURCE, 'async function runEvaluator(')
check('runEvaluator 取得出来', typeof evaluatorBody === 'string' && evaluatorBody.length > 400, String(evaluatorBody?.length ?? 0))
{
	const firstAwait = maskCommentsAndStrings(evaluatorBody).indexOf('await')
	const beforeAwait = firstAwait < 0 ? evaluatorBody : evaluatorBody.slice(0, firstAwait)
	/**
	 * 「独立落账」的判据:在内核第一次 `await` **之前**,就有一个把事实推进**独立通道**的调用,
	 * 而且它落的正是这一次派遣(`audit`)。这样一次 throw / abort 抹不掉它——
	 * 因为它已经不在那个可被撤销的栈帧里了。
	 */
	const landing = /(landFact|recordFact|pendingFacts\s*[.(])/.test(beforeAwait) && /audit/.test(beforeAwait)
	check('新机制:runEvaluator 在 await 之前就有独立落账调用(落的是这次审计)', landing, `await 位置=${firstAwait}; 之前 ${beforeAwait.length} 字`)
	check('独立通道存在(不是只把变更塞进工具结果)', /pendingFacts/.test(KERNEL_SOURCE) && /function landFact\(/.test(KERNEL_SOURCE))
	check('工具结果的出口会把独立通道的事实并进去(两条通道同源)', /withPendingFacts\(/.test(KERNEL_SOURCE) && /drainPendingFacts\(/.test(KERNEL_SOURCE))
	// 这套检查是活的:故意把 landing 判据喂给一段「先 await 再落账」的代码,它必须判否。
	const oldOrder = 'const dispatched = await dispatchSubRun({}) ; mutations.push(landFact(sessionId, { t: "audit/dispatched" }))'
	const oldBeforeAwait = oldOrder.slice(0, oldOrder.indexOf('await'))
	check('活检查:把旧顺序(先 await 后落账)喂给同一判据,它判否', !(/(landFact|recordFact|pendingFacts\s*[.(])/.test(oldBeforeAwait) && /audit/.test(oldBeforeAwait)))
}

console.log('\n【A 组 · 宿主半:属性式服务访问必须清零】')
{
	const propertyAccess = [...HOST_SOURCE.matchAll(/ctx\.(sessions|sessionProjections)\s*[.[]/g)].map((match) => match[0])
	check('新读数:属性式访问为 0(`ctx.get(...)` 取不到就降级,绝不抛)', propertyAccess.length === 0, propertyAccess.join(' '))
	check('不是空扫:同一份源码里确实有方法式取面', /ctx\.get\('sessions'\)/.test(HOST_SOURCE) && /ctx\.get\('sessionProjections'\)/.test(HOST_SOURCE))
	// 活检查:同一个扫描器抓得到一段故意写坏的访问。
	const injected = 'const s = ctx.sessions.get(id); const p = ctx.sessionProjections.stateOf(s)'
	check('活检查:同一扫描器抓得到故意注入的属性式访问', [...injected.matchAll(/ctx\.(sessions|sessionProjections)\s*[.[]/g)].length === 2)
}

// ═══ B 组 · 结案门:第三阶段证伪那一场被拦四次 → 第四阶段一次也不拦 ═══════════════
//
// 现场:`docs/optimization/sim-runs/2026-10-02-p3/falsification/events.jsonl`(随仓库走)。
// 旧读数:计划收尾之后第一次 Conclude 起,被拦四次(跳级没理由 → 没有断言形态 ×2 → 主体没落图),
// 外加 7 次补救调用。新读数:把同一份账折到第一次 Conclude 之前,结案门一道都不该触发——
// 跳级理由与「没有断言形态」两道门删了,唯一留下的实体门只看将升格判断的断言主体,而那条判断没写断言。
// 另一半是第二阶段到第三阶段那四条命题的真会话:全部 L3、L0 证据 0 条,从前报 7 处跳级;现在不报。

console.log('\n【B 组 · 结案门:证伪那一场从拦四次到一次不拦】')
{
	const LOG = join(PORT, 'docs', 'optimization', 'sim-runs', '2026-10-02-p3', 'falsification', 'events.jsonl')
	const events = readFileSync(LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
	const calls = new Map(events.filter((event) => event.type === 'tool/call').map((event) => [event.data.callId, event.data.name]))
	const results = events.filter((event) => event.type === 'tool/result')
	const concludes = results.filter((event) => calls.get(event.data.callId) === 'Conclude')
	const blocked = concludes.filter((event) => !(event.data.meta?.mutations ?? []).some((mutation) => mutation.t === 'goal/closed'))
	check('旧读数:同一场里 Conclude 被拦 4 次(第 5 次才结案)', concludes.length === 5 && blocked.length === 4, `${concludes.length} 次结案、${blocked.length} 次被拦`)
	const firstConclude = results.indexOf(concludes[0])
	const mutations = results.slice(0, firstConclude).flatMap((event) => event.data.meta?.mutations ?? [])
	const state = applyMutations(emptyState(), mutations)
	const derived = derive(state)
	const threshold = ['L0', 'L1', 'L2', 'L3', 'L4'].indexOf(state.goal?.promote_at_level ?? 'L3')
	const promotable = derived.hypotheses.filter((item) => (item.status === 'alive' || item.status === 'proposed') && (item.refutations ?? 0) === 0 && ['L0', 'L1', 'L2', 'L3', 'L4'].indexOf(item.supportedLevel ?? '') >= threshold)
	check('前提:折到第一次 Conclude 之前,计划已收尾、有 1 条判断到了门槛', state.plans.every((plan) => plan.status !== 'active') && promotable.length === 1, `${promotable.length} 条`)
	check('新读数:将升格的判断没有主体不在图上 ⇒ 实体门不拦', promotable.every((item) => (item.unlanded ?? []).length === 0))
	const codes = derived.knowledge.gaps.map((gap) => gap.code)
	check('新读数:缺口里没有被删的那几种(跳级 / 没有词汇 / 零引用 / 事实没带断言)', !codes.some((code) => ['levels_skipped', 'no_language', 'orphan_terms', 'unstructured_facts'].includes(code)), codes.join(','))
	check('只有散文的判断照旧在卡上列成缺口(看得见,但不拦)', codes.includes('prose_only_claims'), codes.join(','))
}

console.log('\n【B 组 · 真会话的四条 L3 命题:从前报 7 处跳级,现在不报】')
{
	const spec = [
		{ id: 'h-1', levels: ['L1', 'L2', 'L3'] },
		{ id: 'h-2', levels: ['L2', 'L3'] },
		{ id: 'h-3', levels: ['L2', 'L3'] },
		{ id: 'h-4', levels: ['L1', 'L3'] },
	]
	const mutations = [
		{
			t: 'goal/set',
			id: 'g-contrast',
			revision: 1,
			claim: '「抽象」能否被定义为一个可判别、可复现的谓词',
			done_criteria: '存在一份解释文,含判别程序与失效节',
			promote_at_level: 'L3',
			hypotheses: spec.map((item) => ({ id: item.id, claim: `命题 ${item.id}`, refute_when: '出现反例' })),
		},
		{
			t: 'plan/created',
			id: 'p-contrast',
			goal: 'g-contrast',
			steps: spec.map((item, index) => ({ id: `s-${index + 1}`, do: `核验 ${item.id}`, done_criteria: '读数落盘', status: 'open', tests: { hypothesis: item.id, level: item.levels[item.levels.length - 1] } })),
		},
	]
	for (const [index, item] of spec.entries()) {
		for (const level of item.levels) {
			mutations.push({ t: 'evidence/recorded', id: `e-${item.id}-${level}`, step: `s-${index + 1}`, plan: 'p-contrast', verdict: 'support', level, evaluator: level === 'L3' ? 'independent' : 'self', basis: `${item.id} 在 ${level} 的读数` })
		}
	}
	const state = applyMutations(emptyState(), mutations)
	const derived = derive(state)
	check('前提:4 条命题 supportedLevel 全是 L3(与真会话一致)', derived.hypotheses.every((item) => item.supportedLevel === 'L3'), derived.hypotheses.map((item) => item.supportedLevel).join(','))
	const knowledge = deriveKnowledge(state, derived.hypotheses, derived.factRows, derived.lexicon)
	check('状态进了知识模式(缺口才有载体)', knowledge.mode === 'knowledge', knowledge.mode)
	check('新读数:没有 levels_skipped 缺口(等级只决定谁来判)', (knowledge.gaps ?? []).every((item) => item.code !== 'levels_skipped'), (knowledge.gaps ?? []).map((item) => item.code).join(','))
	check('新读数:派生里没有 untouchedLevels(旧读数是 1+2+2+2=7 处)', derived.hypotheses.every((item) => !('untouchedLevels' in item)))
	check('每个缺口四件套齐(code/count/detail/nextAction)', (knowledge.gaps ?? []).every((item) => typeof item.code === 'string' && typeof item.count === 'number' && typeof item.detail === 'string' && item.detail !== '' && typeof item.nextAction === 'string' && item.nextAction !== ''), JSON.stringify((knowledge.gaps ?? []).map((item) => item.code)))
}

// ═══ C 组 · 实体图:数据早就写好了,只差一条通道 ═════════════════════════
//
// 真会话:累计落账断言 13 条(rev1 3 + rev2 5 + rev3 5),形状全是
// `sucai|yangben_* · cheng_wei = chouxiang|chouxiang`;但 facts 0 条 ⇒ 实体图 0 节点/0 边。
// 反事实(契约 v2):5 个实体登记 + 5 条实体断言 ⇒ **6 节点 / 5 边**,且图不再依赖目标裁决。
// 向后兼容:只喂 facts 断言时,投影与改造前逐字节一致(仍 6/5,source 为 promoted)。

console.log('\n【C 组 · 反事实复算:0 节点/0 边 → 6 节点/5 边】')
const realAssertions = (() => {
	let last = null
	for (const event of events) {
		if (event.type !== 'tool/call' || event.data?.name !== 'SetGoal') continue
		let args = null
		try {
			args = JSON.parse(event.data.arguments)
		} catch {
			continue
		}
		const chengwei = (args.hypotheses ?? []).flatMap((hypothesis) => (hypothesis.assertions ?? []).filter((assertion) => assertion?.predicate === 'cheng_wei'))
		if (chengwei.length >= 5) last = chengwei
	}
	return last ?? []
})()
const entityOf = (state) => {
	const projection = graphProjection(state)
	return { nodes: projection.nodes.filter((node) => node.layer === 'entity'), edges: projection.edges.filter((edge) => edge.layer === 'entity') }
}

check('真会话里取得到 rev3 那 5 条 cheng_wei 断言(读数非空跑)', realAssertions.length === 5, String(realAssertions.length))
check(
	'断言形状确认为 `sucai|yangben_* · cheng_wei = chouxiang|chouxiang`',
	realAssertions.every((assertion) => assertion.subject?.type === 'sucai' && /^yangben_/.test(String(assertion.subject?.id)) && assertion.object?.kind === 'instance' && assertion.object?.type === 'chouxiang' && assertion.object?.value === 'chouxiang'),
	JSON.stringify(realAssertions.map((assertion) => `${assertion.subject?.type}|${assertion.subject?.id}`)),
)
const realState = applyMutations(emptyState(), [{ t: 'fact/promoted', id: 'f-rev3', hypothesis: 'h-fib2e2', level: 'L3', assertions: realAssertions }])
check('真会话读数:facts 为空时实体图是 0 节点/0 边', entityOf(emptyState()).nodes.length === 0 && entityOf(emptyState()).edges.length === 0, JSON.stringify(entityOf(emptyState())))

{
	// 旧读数:只把断言登记成实体(contract v1 的「只产节点」)——图仍然是空的边。
	const registrations = realAssertions.map((assertion, index) => ({ t: 'entity/registered', id: assertion.subject.id, type: assertion.subject.type, label: assertion.subject.id, basis: `语料条目 p0${index + 1}`, provenance: { kind: 'named', ref: `教材条目 p0${index + 1}` } }))
	const registeredOnly = applyMutations(emptyState(), registrations)
	const registeredProjection = entityOf(registeredOnly)
	check('新机制:5 个实体登记产出 5 个节点', registeredProjection.nodes.length === 5, `${registeredProjection.nodes.length} 节点`)
	check('实体登记单独不产边(所以必须有实体断言那一等入口)', registeredProjection.nodes.length === 5 && registeredProjection.edges.length === 0, `${registeredProjection.edges.length} 边`)
	check("登记节点带 source='registered'", registeredProjection.nodes.length === 5 && registeredProjection.nodes.every((node) => node.source === 'registered'), JSON.stringify(registeredProjection.nodes.map((node) => node.source)))
}

{
	// 反事实:5 个实体登记 + 5 条实体断言。
	const mutations = realAssertions.map((assertion, index) => ({ t: 'entity/registered', id: assertion.subject.id, type: assertion.subject.type, label: assertion.subject.id, basis: `语料条目 p0${index + 1}`, provenance: { kind: 'named', ref: `教材条目 p0${index + 1}` } }))
	mutations.push(...realAssertions.map((assertion, index) => ({ t: 'entity/asserted', id: `ea-${index + 1}`, subject: assertion.subject, predicate: assertion.predicate, object: assertion.object, evidence: { kind: 'named', ref: `教材条目 p0${index + 1}` } })))
	const counterfactual = applyMutations(emptyState(), mutations)
	const projection = entityOf(counterfactual)
	check('新读数:6 节点 / 5 边(旧读数 0/0)', projection.nodes.length === 6 && projection.edges.length === 5, `${projection.nodes.length} 节点 / ${projection.edges.length} 边`)
	const subjectNodes = projection.nodes.filter((node) => node.type === 'sucai')
	const objectNodes = projection.nodes.filter((node) => node.type === 'chouxiang')
	check('5 个 sucai 主体节点都来自登记(source=\'registered\')', subjectNodes.length === 5 && subjectNodes.every((node) => node.source === 'registered'), JSON.stringify(subjectNodes.map((node) => `${node.id}:${node.source}`)))
	check('chouxiang 客体节点按来源标 asserted', objectNodes.length === 1 && objectNodes[0].source === 'asserted', JSON.stringify(objectNodes.map((node) => `${node.id}:${node.source}`)))
	check('5 条边都来自实体断言(source=\'asserted\',带出处、未过独立裁决)', projection.edges.length === 5 && projection.edges.every((edge) => edge.source === 'asserted'), JSON.stringify(projection.edges.map((edge) => edge.source)))
	// 活检查:同一份计数喂给空状态必须给 0(计数器不是恒等于期望值)。
	check('活检查:同一套计数喂给空状态得到 0/0', entityOf(emptyState()).nodes.length === 0 && entityOf(emptyState()).edges.length === 0)
}

{
	// 向后兼容:只喂 facts 断言时,投影与改造前**逐字节一致** —— 连 `source` 字段都不许出现。
	const projection = entityOf(realState)
	check('兼容:只有 facts 断言时仍是 6 节点 / 5 边', projection.nodes.length === 6 && projection.edges.length === 5, `${projection.nodes.length}/${projection.edges.length}`)
	const byteUnchanged = JSON.stringify(graphProjection(realState))
	check('兼容:两个新来源都为空时,投影序列化里没有 source 字段(与改造前逐字节一致)', !byteUnchanged.includes('"source"'), byteUnchanged.slice(byteUnchanged.indexOf('"source"') - 60, byteUnchanged.indexOf('"source"') + 40))
	check('兼容:facts 与登记同键时以 registered 优先(同键去重,不双算)', (() => {
		const both = applyMutations(realState, realAssertions.map((assertion) => ({ t: 'entity/registered', id: assertion.subject.id, type: assertion.subject.type, label: assertion.subject.id, basis: '登记', provenance: { kind: 'named', ref: '登记' } })))
		const merged = entityOf(both)
		const subjects = merged.nodes.filter((node) => node.type === 'sucai')
		return merged.nodes.length === 6 && subjects.length === 5 && subjects.every((node) => node.source === 'registered')
	})(), JSON.stringify(entityOf(applyMutations(realState, realAssertions.map((a) => ({ t: 'entity/registered', id: a.subject.id, type: a.subject.type, label: a.subject.id, basis: '登记', provenance: { kind: 'named', ref: '登记' } })))).nodes.map((node) => `${node.id}:${node.source}`)))
	// 新读数:一旦合并打开,facts 那条来源必须自报家门是 promoted(与 asserted 分得开)。
	const mergedWithFacts = applyMutations(realState, realAssertions.map((assertion) => ({ t: 'entity/registered', id: assertion.subject.id, type: assertion.subject.type, label: assertion.subject.id, basis: '登记', provenance: { kind: 'named', ref: '登记' } })))
	const mergedProjection = entityOf(mergedWithFacts)
	const objectNode = mergedProjection.nodes.find((node) => node.type === 'chouxiang') ?? null
	check("新读数:合并打开后,facts 来源的节点与边标 source='promoted'", objectNode?.source === 'promoted' && mergedProjection.edges.every((edge) => edge.source === 'promoted'), `${String(objectNode?.source)} / ${JSON.stringify([...new Set(mergedProjection.edges.map((edge) => edge.source))])}`)
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exitCode = 1
}
