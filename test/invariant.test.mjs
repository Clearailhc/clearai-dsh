/**
 * 宿主不变量(`clearai-dsh` 的伴生件)的断言。
 *
 * 这一份测的是**契约本身**:合法序列一律放行、每一条契约的违反都当场抛、抛出来的消息里
 * 有契约名(便于 grep)与归属包名(宿主据此归属)。
 *
 * 为什么值得单开一套:它约束的是**所有生产者**(内核的 22 件工具、人门、以及将来新加的入口),
 * 而它自己又跑在宿主的落账路径上——判宽了等于没判,判严了会把正确的行为拦下。
 *
 * 跑法:node test/invariant.test.mjs
 */

import { CONTRACTS, PACKAGE_NAME, emptyTrace, foldEvent, foldMutation, install, mutationsOf } from '../ui/lib/invariant.js'

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

/** 一份**合法**的起手:目标(L3 门槛)→ 计划(一步,验 h-1)→ 准入 → 交付。 */
function validPrefix() {
	return [
		{ t: 'goal/set', id: 'g-1', promote_at_level: 'L3', hypotheses: [{ id: 'h-1', claim: '甲更好' }] },
		{ t: 'plan/created', id: 'p-1', goal: 'g-1', steps: [{ id: 's1', status: 'open', tests: { hypothesis: 'h-1', level: 'L3' } }] },
		{ t: 'admission/checked', plan: 'p-1', step: 's1' },
		{ t: 'step/advanced', plan: 'p-1', step: 's1' },
		{ t: 'evidence/recorded', plan: 'p-1', step: 's1', verdict: 'support', level: 'L3' },
		{ t: 'fact/promoted', goal: 'g-1', text: '甲更好' },
	]
}

console.log('\n【① 合法序列一律放行】')
{
	const { caught, fail } = catcher()
	const trace = emptyTrace()
	for (const mutation of validPrefix()) foldMutation(trace, mutation, fail)
	check('目标 → 计划 → 准入 → 交付 → 证据 → 升格:一路放行', caught.length === 0, caught.join(' | '))
	check('轨迹真的前进了(不是"什么都不判"就算过)', trace.steps.get('s1')?.status === 'advanced' && trace.supportLevel.get('g-1') === 'L3', JSON.stringify({ step: trace.steps.get('s1'), level: trace.supportLevel.get('g-1') }))
	check('契约名是固定的五个(改动要连测试一起改)', CONTRACTS.length === 5, CONTRACTS.join(','))
	check('归属包名是 clearai-dsh(宿主据此过滤与归属)', PACKAGE_NAME === 'clearai-dsh', PACKAGE_NAME)
}

console.log('\n【② 契约一:引用完整性】')
{
	const { fail } = catcher()
	const trace = emptyTrace()
	for (const mutation of validPrefix()) foldMutation(trace, mutation, fail)
	// **先登记**一个计划与一步:轨迹里一个步骤都没有时这条契约刻意不判(窗口不从开头起),那不是这次要测的。
	const seeded = (fail) => {
		const trace = emptyTrace()
		foldMutation(trace, { t: 'plan/created', id: 'p-1', steps: [{ id: 's1', status: 'open' }] }, fail)
		return trace
	}
	const cases = [
		['指向不存在的步骤', { t: 'evidence/recorded', plan: 'p-1', step: 'ghost', verdict: 'support', level: 'L3' }, seeded],
		['指向不存在的计划', { t: 'plan/closed', plan: 'ghost' }, seeded],
		['指向不存在的分叉', { t: 'worldline/executing', fork: 'k-ghost', branch: 'b-1' }, seeded],
	]
	for (const [label, mutation, seed] of cases) {
		const { caught, fail: boom } = catcher()
		let threw = false
		try {
			foldMutation(seed(boom), mutation, boom)
		} catch {
			threw = true
		}
		check(`引用完整性:${label} → 当场抛,且消息里点名契约`, threw && caught[0].includes('引用完整性'), caught[0] ?? '(没抛)')
	}
	/**
	 * **伪步骤不算计划步骤**:目标轴的验收(`audit/settled{step:'goal:g-…'}`)与世界线轴的评估
	 * (`…{step:'k-…:b-…'}`)也带 `step`,但它们本来就不在 `plan/created` 里登记。
	 * 把它们当计划步骤查,会把一条**正确**的裁决拦在账本之外(真跑教出来的第二条)。
	 */
	{
		const { caught: pseudoCaught, fail: pseudo } = catcher()
		const trace = seeded(pseudo)
		foldMutation(trace, { t: 'audit/dispatched', id: 'a-1', step: 'goal:g-1', plan: 'goal', evaluator_session: 'c-1' }, pseudo)
		foldMutation(trace, { t: 'audit/settled', id: 'a-1', step: 'goal:g-1', verdict: 'support' }, pseudo)
		foldMutation(trace, { t: 'audit/dispatched', id: 'a-2', step: 'k-1:b-1', plan: 'p-1', evaluator_session: 'c-2' }, pseudo)
		foldMutation(trace, { t: 'audit/settled', id: 'a-2', step: 'k-1:b-1', verdict: 'support' }, pseudo)
		check('带冒号的伪步骤(目标轴 / 世界线轴)不当计划步骤查 → 放行', pseudoCaught.length === 0, pseudoCaught.join(' | '))
	}

	// 一无所知时不判:窗口不从开头起的日志不该被这条判据误伤(真跑教出来的那一条)。
	const { caught: blindCaught, fail: blind } = catcher()
	foldMutation(emptyTrace(), { t: 'observation/recorded', step: 'gen-raw', ref: 'lab/x.csv' }, blind)
	check('轨迹里一个步骤都没有时不判(窗口不从开头起,查不到≠不存在)', blindCaught.length === 0, blindCaught.join(' | '))
}

console.log('\n【③ 契约二:准入先于推进】')
{
	const { caught, fail } = catcher()
	const trace = emptyTrace()
	foldMutation(trace, { t: 'plan/created', id: 'p-1', steps: [{ id: 's1', status: 'open' }] }, fail)
	let threw = false
	try {
		foldMutation(trace, { t: 'step/advanced', plan: 'p-1', step: 's1' }, fail)
	} catch {
		threw = true
	}
	check('没经准入就推进 → 抛', threw && caught[0].includes('准入先于推进'), caught[0] ?? '(没抛)')
	const { caught: after, fail: ok } = catcher()
	foldMutation(trace, { t: 'admission/checked', plan: 'p-1', step: 's1' }, ok)
	foldMutation(trace, { t: 'step/advanced', plan: 'p-1', step: 's1' }, ok)
	check('补上准入之后再推进 → 放行(判的是顺序,不是不许推进)', after.length === 0, after.join(' | '))
}

console.log('\n【④ 契约三:结算必有派遣】')
{
	// `worldline/executed` 那条要先让**分叉与世界线存在**:不然先撞上的是引用那一条,
	// 测出来的就不是这条契约了(判据要能单独判,才叫一条契约)。
	const withFork = (fail) => {
		const trace = emptyTrace()
		foldMutation(trace, { t: 'fork/created', id: 'k-1', options: [{ id: 'b-1' }] }, fail)
		foldMutation(trace, { t: 'worldline/prepared', fork: 'k-1', branches: [{ id: 'b-1', status: 'exploring' }] }, fail)
		return trace
	}
	const cases = [
		['scout/settled 没有对应派遣', { t: 'scout/settled', id: 's-ghost', step: 's1' }, '结算必有派遣', (fail) => {
			const trace = emptyTrace()
			foldMutation(trace, { t: 'plan/created', id: 'p-1', steps: [{ id: 's1', status: 'open' }] }, fail)
			return trace
		}],
		['worldline/executed 没有对应派遣', { t: 'worldline/executed', fork: 'k-1', branch: 'b-1' }, '结算必有派遣', withFork],
		['audit/settled 没有对应派遣', { t: 'audit/settled', plan: 'p-1', step: 's1', verdict: 'support' }, '结算必有派遣', (fail) => {
			const trace = emptyTrace()
			foldMutation(trace, { t: 'plan/created', id: 'p-1', steps: [{ id: 's1', status: 'open' }] }, fail)
			return trace
		}],
	]
	for (const [label, mutation, contract, seed] of cases) {
		const { caught, fail } = catcher()
		const trace = seed(fail)
		let threw = false
		try {
			foldMutation(trace, mutation, fail)
		} catch {
			threw = true
		}
		check(`${label} → 抛`, threw && caught[0].includes(contract), caught[0] ?? '(没抛)')
	}
	// 派遣之后结算:放行
	const { caught, fail } = catcher()
	const fork = emptyTrace()
	foldMutation(fork, { t: 'fork/created', id: 'k-1', options: [{ id: 'b-1' }] }, fail)
	foldMutation(fork, { t: 'worldline/prepared', fork: 'k-1', branches: [{ id: 'b-1', status: 'exploring' }] }, fail)
	foldMutation(fork, { t: 'worldline/executing', fork: 'k-1', branch: 'b-1' }, fail)
	foldMutation(fork, { t: 'worldline/executed', fork: 'k-1', branch: 'b-1' }, fail)
	foldMutation(fork, { t: 'branch/delivered', fork: 'k-1', branch: 'b-1', reading: '7' }, fail)
	check('分叉 → 派遣 → 结算 → 交付 一路放行', caught.length === 0, caught.join(' | '))
}

console.log('\n【⑤ 契约四:升格有据】')
{
	// 低等级支持:不许升格
	const low = emptyTrace()
	const { caught, fail } = catcher()
	for (const mutation of validPrefix().slice(0, 4)) foldMutation(low, mutation, fail)
	foldMutation(low, { t: 'evidence/recorded', plan: 'p-1', step: 's1', verdict: 'support', level: 'L1' }, fail)
	let threw = false
	try {
		foldMutation(low, { t: 'fact/promoted', goal: 'g-1', text: '甲更好' }, fail)
	} catch {
		threw = true
	}
	check('支持只到 L1、门槛是 L3 → 升格被拦', threw && caught[0].includes('升格有据'), caught[0] ?? '(没抛)')
	// 一条支持都没有就升格:同样要拦(这正是"没到级就必须一条都不升"那一半)
	const zero = emptyTrace()
	const { caught: zeroCaught, fail: zeroFail } = catcher()
	foldMutation(zero, { t: 'goal/set', id: 'g-1', promote_at_level: 'L3', hypotheses: [{ id: 'h-1' }] }, zeroFail)
	foldMutation(zero, { t: 'plan/created', id: 'p-1', steps: [{ id: 's1', status: 'open', tests: { hypothesis: 'h-1', level: 'L3' } }] }, zeroFail)
	let zeroThrew = false
	try {
		foldMutation(zero, { t: 'fact/promoted', goal: 'g-1', text: 'x' }, zeroFail)
	} catch {
		zeroThrew = true
	}
	check('一条支持都没有就升格 → 拦(没到级就必须一条都不升)', zeroThrew && zeroCaught[0].includes('升格有据'), zeroCaught[0] ?? '(没抛)')
	// 目标根本没登记(这条日志里没有它的 goal/set)⇒ **不判**:宁可不判,也不冤枉
	const unknown = emptyTrace()
	const { caught: none, fail: mild } = catcher()
	foldMutation(unknown, { t: 'fact/promoted', goal: 'g-ghost', text: 'x' }, mild)
	check('目标没登记过时不判(宁可不判,也不冤枉)', none.length === 0, none.join(' | '))
}

console.log('\n【⑥ 契约五:事实棘轮(只朝一个方向走)】')
{
	const { caught, fail } = catcher()
	const trace = emptyTrace()
	foldMutation(trace, { t: 'plan/created', id: 'p-1', steps: [{ id: 's1', status: 'open' }] }, fail)
	foldMutation(trace, { t: 'admission/checked', plan: 'p-1', step: 's1' }, fail)
	// 真实形状:作废是 `plan/voided`(带**一个** step),不是 `step/void`。
	foldMutation(trace, { t: 'plan/voided', plan: 'p-1', step: 's1', reason: '测试' }, fail)
	let threw = false
	try {
		foldMutation(trace, { t: 'step/advanced', plan: 'p-1', step: 's1' }, fail)
	} catch {
		threw = true
	}
	check('作废过的步骤又被推进 → 抛(降级不可表示)', threw && caught[0].includes('事实棘轮'), caught[0] ?? '(没抛)')
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

	// 安装件:种子 + 落账前判 + 落账后提交
	const { caught, fail } = catcher()
	const sessions = []
	const listeners = new Map()
	const ctx = {
		sessions: {
			list: () => sessions,
		},
		on(event, handler, options) {
			listeners.set(event, { handler, options })
			return () => {}
		},
	}
	install(ctx, fail)
	check('安装件挂上三条听点:会话创建 / 落账前 / 落账后', listeners.has('session/created') && listeners.has('internal/dispatch') && listeners.has('session/event'))
	check('安装件要求注入 sessions(没有它这条不变量无从谈起)', JSON.stringify(install.inject) === JSON.stringify(['sessions']))
	const session = { snapshotEvents: () => [] }
	listeners.get('session/created').handler(session)
	const seeded = { type: 'user/message', data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [{ t: 'plan/created', id: 'p-1', steps: [{ id: 's1', status: 'open' }] }] }) }] } } }
	listeners.get('internal/dispatch').handler('emit', 'session/event', [session, seeded])
	listeners.get('session/event').handler(session, seeded)
	const good = { type: 'user/message', data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [{ t: 'goal/set', id: 'g-1', promote_at_level: 'L3', hypotheses: [] }] }) }] } } }
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
	check('判不过的那一条不会污染轨迹(候选改在副本上)', (() => {
		// 再送一条合法事件:轨迹应当还是"只有 goal/set"那一份,而不是被坏事件改过
		const another = { type: 'user/message', data: { source: { kind: 'plugin', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [{ t: 'plan/created', id: 'p-2', steps: [] }] }) }] } } }
		try {
			listeners.get('internal/dispatch').handler('emit', 'session/event', [session, another])
			listeners.get('session/event').handler(session, another)
			return true
		} catch {
			return false
		}
	})())
}

console.log('')
if (failures.length > 0) {
	console.log(`结果:${passed} 通过,${failures.length} 失败`)
	for (const label of failures) console.log(`  - ${label}`)
	process.exit(1)
}
console.log(`结果:${passed} 通过,0 失败`)
