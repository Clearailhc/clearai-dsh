/**
 * 宿主不变量(`clearai-dsh` 的伴生件)的断言。
 *
 * 这一份测的是**契约本身**:合法序列一律放行、每一条契约的违反都当场抛、
 * 抛出来的消息里有契约名(便于 grep)与归属包名(宿主据此归属)。
 *
 * 与上一版的差别:状态用**生产折法**(`applyEvent`)搭建——伴生件自己不再折,
 * 测试也不该另造一套夹具,否则又在测第二套解释器。
 *
 * 跑法:node test/invariant.test.mjs
 */
import { applyEvent, emptyState } from '../ui/lib/fold.js'
import { PACKAGE_NAME, inject, install, judge, mutationsOf, name } from '../ui/lib/invariant.js'

let passed = 0
const failures = []
function check(label, ok, detail = '') {
	if (ok) {
		passed += 1
		console.log(`  ✓ ${label}`)
		return
	}
	failures.push(label)
	console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

/** 用来抓违反:宿主给安装件的那个 `fail` 就是"抛"。 */
function catcher() {
	const caught = []
	const fail = (message) => {
		caught.push(String(message))
		throw new Error(String(message))
	}
	return { caught, fail }
}

/** 用**生产折法**把一串变更落成状态(测试与伴生件用同一份代码)。 */
function stateOf(mutations) {
	let state = emptyState()
	for (const mutation of mutations) {
		state = applyEvent(state, { type: 'user/message', time: 1, data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [mutation] }) }] } } })
	}
	return state
}

/** 一份**合法**的起手:目标(L3 门槛)→ 计划(一步,验 h-1)→ 准入 → 交付 → 证据 → 升格。 */
function validPrefix() {
	return [
		{ t: 'goal/set', id: 'g-1', claim: '甲更好', done_criteria: '有裁决', promote_at_level: 'L3', hypotheses: [{ id: 'h-1', claim: '甲更好', refute_when: '乙更好' }] },
		{ t: 'plan/created', id: 'p-1', goal: 'g-1', steps: [{ id: 's1', status: 'open', tests: { hypothesis: 'h-1', level: 'L3' } }] },
		{ t: 'admission/checked', plan: 'p-1', step: 's1', verified_by: 'artifact' },
		{ t: 'step/advanced', plan: 'p-1', step: 's1', evidence: 'e-1' },
		{ t: 'evidence/recorded', id: 'e-1', plan: 'p-1', step: 's1', verdict: 'support', level: 'L3' },
		{ t: 'fact/promoted', goal: 'g-1', text: '甲更好', scope: null, level: 'L3', evidence: ['e-1'] },
	]
}

console.log('\n【① 合法序列一律放行】')
{
	const { caught, fail } = catcher()
	const before = stateOf(validPrefix().slice(0, -1))
	const admitted = new Set(['s1'])
	judge(before, [validPrefix().at(-1)], admitted, fail)
	check('目标 → 计划 → 准入 → 交付 → 证据 → 升格:一路放行', caught.length === 0, caught.join(' | '))
	check('状态真的是生产折法算的(不是"什么都不判"就算过)', before.plans[0]?.steps?.[0]?.status === 'advanced', String(before.plans[0]?.steps?.[0]?.status))
	check('归属包名是 clearai-dsh(宿主据此过滤与归属)', PACKAGE_NAME === 'clearai-dsh', PACKAGE_NAME)
	check('伴生件名与注入声明在', name === 'clearai-invariant' && inject.includes('invariants'), `${name}/${inject.join(',')}`)
}

console.log('\n【② 契约一:引用完整性】')
{
	const before = stateOf(validPrefix().slice(0, 2))
	const cases = [
		['指向不存在的步骤', { t: 'evidence/recorded', plan: 'p-1', step: 'ghost', verdict: 'support', level: 'L3' }],
		['observation 指向不存在的步骤', { t: 'observation/recorded', step: 'ghost', ref: 'lab/x.csv' }],
	]
	for (const [label, mutation] of cases) {
		const { caught, fail } = catcher()
		let threw = false
		try {
			judge(before, [mutation], new Set(), fail)
		} catch {
			threw = true
		}
		check(`引用完整性:${label} → 当场抛,且消息里点名契约`, threw && caught[0].includes('引用完整性'), caught[0] ?? '(没抛)')
	}
	// 一无所知时不判:窗口不从开头起的日志不该被这条判据误伤。
	try {
		judge(emptyState(), [{ t: 'observation/recorded', step: 'gen-raw', ref: 'lab/x.csv' }], new Set(), (m) => { throw new Error(m) })
		check('状态里一个步骤都没有时不判(查不到 ≠ 不存在)', true)
	} catch {
		check('状态里一个步骤都没有时不判(查不到 ≠ 不存在)', false)
	}
	// 伪步骤(目标轴 / 世界线轴)不当计划步骤查
	try {
		judge(before, [
			{ t: 'audit/dispatched', id: 'a-1', step: 'goal:g-1', plan: 'goal', evaluator_session: 'c-1' },
			{ t: 'audit/settled', id: 'a-1', step: 'goal:g-1', verdict: 'support' },
		], new Set(), (m) => { throw new Error(m) })
		check('带冒号的伪步骤(目标轴)不当计划步骤查 → 放行', true)
	} catch (error) {
		check('带冒号的伪步骤(目标轴)不当计划步骤查 → 放行', false, String(error.message).slice(0, 100))
	}
}

console.log('\n【③ 契约二:准入先于推进】')
{
	const before = stateOf([validPrefix()[0], validPrefix()[1]])
	const { caught, fail } = catcher()
	let threw = false
	try {
		judge(before, [{ t: 'step/advanced', plan: 'p-1', step: 's1' }], new Set(), fail)
	} catch {
		threw = true
	}
	check('没经准入就推进 → 抛', threw && caught[0].includes('准入先于推进'), caught[0] ?? '(没抛)')
	try {
		judge(before, [{ t: 'step/advanced', plan: 'p-1', step: 's1' }], new Set(['s1']), (m) => { throw new Error(m) })
		check('补上准入之后再推进 → 放行(判的是顺序,不是不许推进)', true)
	} catch (error) {
		check('补上准入之后再推进 → 放行(判的是顺序,不是不许推进)', false, String(error.message).slice(0, 100))
	}
}

console.log('\n【④ 契约三:结算必有派遣】')
{
	const before = stateOf([
		validPrefix()[0],
		validPrefix()[1],
		{ t: 'fork/created', id: 'k-1', step: 's1', plan: 'p-1', question: '走哪条', decide_by: { metric: 'x = y', direction: 'min' }, options: [{ label: '甲', approach: 'a', done_criteria: 'c' }] },
		{ t: 'worldline/prepared', fork: 'k-1', branches: [{ id: 'b-1', label: '甲', status: 'exploring', level: 'L0', done_criteria: 'c', artifacts: [] }] },
		{ t: 'worldline/executing', fork: 'k-1', branch: 'b-1', child: 'c-exec' },
		{ t: 'audit/dispatched', id: 'a-1', step: 's1', plan: 'p-1', evaluator_session: 'c-aud' },
		{ t: 'scout/dispatched', id: 'sc-1', step: 's1', plan: 'p-1', trigger: '观测缺口', child: 'c-scout' },
	])
	const cases = [
		['scout/settled 没有对应派遣', { t: 'scout/settled', id: 'sc-ghost', step: 's1', conclusion: 'x' }],
		['audit/settled 没有对应派遣', { t: 'audit/settled', id: 'a-ghost', step: 's1', verdict: 'support' }],
	]
	for (const [label, mutation] of cases) {
		const { caught, fail } = catcher()
		let threw = false
		try {
			judge(before, [mutation], new Set(), fail)
		} catch {
			threw = true
		}
		check(`${label} → 抛`, threw && caught[0].includes('结算必有派遣'), caught[0] ?? '(没抛)')
	}
	try {
		judge(before, [
			{ t: 'scout/settled', id: 'sc-1', step: 's1', conclusion: '查到了' },
			{ t: 'audit/settled', id: 'a-1', step: 's1', verdict: 'support' },
		], new Set(), (m) => { throw new Error(m) })
		check('有派遣的结算 → 放行', true)
	} catch (error) {
		check('有派遣的结算 → 放行', false, String(error.message).slice(0, 100))
	}
}

console.log('\n【⑤ 契约四:升格有据】')
{
	const lowPrefix = [
		validPrefix()[0],
		validPrefix()[1],
		{ t: 'admission/checked', plan: 'p-1', step: 's1', verified_by: 'artifact' },
		{ t: 'step/advanced', plan: 'p-1', step: 's1', evidence: 'e-0' },
		{ t: 'evidence/recorded', id: 'e-0', plan: 'p-1', step: 's1', verdict: 'support', level: 'L1' },
	]
	const low = stateOf(lowPrefix)
	const { caught, fail } = catcher()
	let threw = false
	try {
		judge(low, [{ t: 'fact/promoted', goal: 'g-1', text: '甲更好', level: 'L1' }], new Set(), fail)
	} catch {
		threw = true
	}
	check('支持只到 L1、门槛是 L3 → 升格被拦', threw && caught[0].includes('升格有据'), caught[0] ?? '(没抛)')
	const zero = stateOf(lowPrefix.slice(0, 3))
	const zeroCatcher = catcher()
	let zt = false
	try {
		judge(zero, [{ t: 'fact/promoted', goal: 'g-1', text: '甲更好' }], new Set(), zeroCatcher.fail)
	} catch {
		zt = true
	}
	check('一条支持都没有就升格 → 拦', zt && zeroCatcher.caught[0].includes('升格有据'), zeroCatcher.caught[0] ?? '(没抛)')
	try {
		judge(emptyState(), [{ t: 'fact/promoted', goal: 'g-ghost', text: 'x' }], new Set(), (m) => { throw new Error(m) })
		check('状态里没有目标时不判(宁可不判,也不冤枉)', true)
	} catch {
		check('状态里没有目标时不判(宁可不判,也不冤枉)', false)
	}
}

console.log('\n【⑥ 契约五:事实棘轮(生产折法静默忽略降级;这里是唯一检测点)】')
{
	const before = stateOf([
		validPrefix()[0],
		validPrefix()[1],
		{ t: 'plan/voided', plan: 'p-1', step: 's1', reason: '测试' },
	])
	check('前置:折法里这一步已是 void(静默降级的受害者正是它)', before.plans[0]?.steps?.[0]?.status === 'void', String(before.plans[0]?.steps?.[0]?.status))
	const { caught, fail } = catcher()
	let threw = false
	try {
		judge(before, [{ t: 'step/advanced', plan: 'p-1', step: 's1' }], new Set(['s1']), fail)
	} catch {
		threw = true
	}
	check('作废过的步骤又被推进 → 抛(折法自己不会报,这里是唯一报警的)', threw && caught[0].includes('事实棘轮'), caught[0] ?? '(没抛)')
}

console.log('\n【⑦ 事件的装载点与安装件】')
{
	const message = { type: 'user/message', time: 1, data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [{ t: 'goal/set', id: 'g-1', promote_at_level: 'L3', hypotheses: [] }] }) }] } } }
	check('插件消息里的 clearai/mutations 段读得出来', mutationsOf(message).length === 1 && mutationsOf(message)[0].t === 'goal/set')
	const toolResult = { type: 'tool/result', data: { meta: { kind: 'clearai', mutations: [{ t: 'plan/created', id: 'p-1', steps: [] }] } } }
	check('工具结果 meta 里的变更读得出来', mutationsOf(toolResult).length === 1 && mutationsOf(toolResult)[0].t === 'plan/created')
	check('不相干的事件读不出变更(不猜)', mutationsOf({ type: 'user/message', data: { source: { kind: 'user' } } }).length === 0)
	const hostile = { type: 'user/message', data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: '{坏 JSON' }] } } }
	check('坏 payload 不炸(由折法决定怎么办,这里不猜)', mutationsOf(hostile).length === 0)

	const { caught, fail } = catcher()
	const sessions = []
	const listeners = new Map()
	const ctx = { sessions: { list: () => sessions }, on(event, handler, options) { listeners.set(event, { handler, options }); return () => {} } }
	install(ctx, fail)
	check('安装件挂上三条听点:会话创建 / 落账前 / 落账后', listeners.has('session/created') && listeners.has('internal/dispatch') && listeners.has('session/event'))
	check('安装件要求注入 sessions(没有它这条不变量无从谈起)', JSON.stringify(install.inject) === JSON.stringify(['sessions']))
	const session = { snapshotEvents: () => [] }
	listeners.get('session/created').handler(session)
	const seeded = { type: 'user/message', data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [{ t: 'plan/created', id: 'p-1', steps: [{ id: 's1', status: 'open' }] }] }) }] } } }
	listeners.get('internal/dispatch').handler('emit', 'session/event', [session, seeded])
	listeners.get('session/event').handler(session, seeded)
	const good = { type: 'user/message', data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [{ t: 'admission/checked', plan: 'p-1', step: 's1' }, { t: 'step/advanced', plan: 'p-1', step: 's1' }] }) }] } } }
	listeners.get('internal/dispatch').handler('emit', 'session/event', [session, good])
	listeners.get('session/event').handler(session, good)
	check('合法事件:落账前判过、落账后提交(没有异常)', caught.length === 0, caught.join(' | '))
	const bad = { type: 'user/message', data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [{ t: 'evidence/recorded', plan: 'p-1', step: 'ghost', verdict: 'support', level: 'L3' }] }) }] } } }
	let rejected = false
	try {
		listeners.get('internal/dispatch').handler('emit', 'session/event', [session, bad])
	} catch {
		rejected = true
	}
	check('**落账之前**就拦下:不合法的事实根本进不了日志', rejected && caught.length === 1 && caught[0].includes('引用完整性'), caught.join(' | '))
	let polluted = false
	try {
		const another = { type: 'user/message', data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [{ t: 'plan/closed', plan: 'p-1' }] }) }] } } }
		listeners.get('internal/dispatch').handler('emit', 'session/event', [session, another])
		listeners.get('session/event').handler(session, another)
	} catch {
		polluted = true
	}
	check('判不过的那一条不会污染状态(候选改在副本上)', !polluted)
}

console.log('')
if (failures.length > 0) {
	console.log(`结果:${passed} 通过,${failures.length} 失败`)
	for (const label of failures) console.log(`  - ${label}`)
	process.exit(1)
}
console.log(`结果:${passed} 通过,0 失败`)
