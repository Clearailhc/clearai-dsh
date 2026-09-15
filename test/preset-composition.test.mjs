/**
 * 预设组合:挂载表与 `/` 命令的契约。
 *
 * 钉三件事:
 *   ① 原生工作方式真的挂回来了(tool-todo / subagent / workflow / ralph),
 *      而两套「第二本账」(tool-goal / command-goal / plan-mode)仍然不在;
 *   ② 五个 `/` 命令注册形状正确(名字即公共契约,客户端菜单按它出);
 *   ③ 命令的行为:只读窗从账本现算、呈审捷径只在「计划待授权」时放行 steer。
 *
 * 跑法:node test/preset-composition.test.mjs
 */
import { readFileSync } from 'node:fs'
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

const PRESET = readFileSync(join(PORT, 'preset', 'agent.cordis.yml'), 'utf8')
const { CLEARAI_COMMANDS, apply, inject } = await import('../preset/plugins/commands.js')
const { emptyState, applyMutations, derive } = await import('../ui/lib/fold.js')

console.log('\n【① 挂载表:工作方式回来了,第二本账没有】')
{
	check('tool-todo 挂载且允许并行 in_progress', /@deepseek-ai\/dsh-tool-todo/.test(PRESET) && /allowParallelInProgress: true/.test(PRESET))
	check('tool-subagent 挂载且带模型选择设置', /@deepseek-ai\/dsh-tool-subagent'/.test(PRESET) && /modelSelectionSettings: true/.test(PRESET))
	check('tool-workflow 挂载', /@deepseek-ai\/dsh-tool-workflow/.test(PRESET))
	check('tool-ralph 挂载', /@deepseek-ai\/dsh-tool-ralph/.test(PRESET))
	check('workflow worker 与 delegation realm 在(workflows 服务要有自己的 realm)', /workflow-worker-thread/.test(PRESET) && /workflowEngine: true/.test(PRESET))
	check('tool-goal 仍未挂载(目标只有一本账)', !/@deepseek-ai\/dsh-tool-goal/.test(PRESET))
	check('command-goal 仍未挂载(原生 /goal 与 ClearAI 目标撞名)', !/dsh-command-goal/.test(PRESET))
	check('plan-mode 仍未挂载(两套计划纪律不并存)', !/dsh-plan-mode/.test(PRESET))
	check('clearai-commands 插件挂载', /\.\/plugins\/commands\.js/.test(PRESET))
}

console.log('\n【② 命令注册形状】')
{
	const registered = new Map()
	const fakeCtx = {
		get: (name) => (name === 'commands' ? { register: (definition) => registered.set(definition.name, definition) } : undefined),
	}
	check('inject 声明 commands 服务', inject.includes('commands'))
	apply(fakeCtx)
	check('恰好注册五个命令,名字即契约', CLEARAI_COMMANDS.length === 5 && CLEARAI_COMMANDS.every((name) => registered.has(name)), [...registered.keys()].join(' '))
	check('每个命令都有给人读的描述', [...registered.values()].every((definition) => typeof definition.description === 'string' && definition.description.length > 8))
}

console.log('\n【③ 命令行为:只读现算 + 呈审捷径的门】')
{
	const ledgerState = applyMutations(emptyState(), [
		{
			t: 'goal/set',
			id: 'g1',
			claim: '查清 X 是否成立',
			done_criteria: '结论落在 facts.md',
			promote_at_level: 'L3',
			revision: 1,
			hypotheses: [
				{ id: 'h1', claim: 'X 成立', refute_when: '读数不支持' },
				{ id: 'h2', claim: 'Y 才是真因', refute_when: '控制 Y 后差异消失' },
			],
		},
		{ t: 'plan/created', id: 'p1', steps: [{ id: 's1', do: '跑实验', done_criteria: 'lab/out.csv 存在' }, { id: 's2', do: '分析', done_criteria: 'facts.md 更新' }], brief: 'x'.repeat(300) },
	])
	// 假门面照宿主半的真实形状(ui/lib/index.js):state(sessionId) 与 derive(sessionId) 都在。
	let current = ledgerState
	const facade = { state: () => current, derive: () => derive(current), view: undefined }
	const registered = new Map()
	const steered = []
	const fakeAgent = { id: 's-cmd', status: 'idle', steer: (message) => steered.push(message), followup: (message) => steered.push(message) }
	apply({
		get: (name) => (name === 'commands' ? { register: (definition) => registered.set(definition.name, definition) } : name === 'clearai' ? facade : undefined),
	})
	const invoke = (name) => registered.get(name).handler({ commandId: 'c1', agent: fakeAgent, rawInput: '', attachments: [], signal: undefined })

	const goal = await invoke('goal')
	check('/goal 渲染主张与两条假设', goal.kind === 'success' && goal.text.includes('查清 X 是否成立') && goal.text.includes('X 成立') && goal.text.includes('Y 才是真因'), goal.text?.slice(0, 80))

	const plan = await invoke('plan')
	check('/plan 渲染步骤与未授权语义(不自动续跑/按事实记归属)', plan.kind === 'success' && plan.text.includes('s1') && /不会自动续跑/.test(plan.text) && /按事实记下归属/.test(plan.text), plan.text?.slice(0, 120))

	const worldline = await invoke('worldline')
	check('/worldline 空账时如实说没有分叉', worldline.kind === 'success' && /还没有分叉/.test(worldline.text))

	const review = await invoke('plan-review')
	check('/plan-review 在待授权时 steer 一句结构化请求(记账仍走 RequestPlanReview)', review.kind === 'success' && steered.length === 1 && /RequestPlanReview/.test(steered[0].content[0].text))
	check('steer 出去的是署名人的普通消息(不带人门标记)', steered[0].source?.kind === 'user' && !steered[0].content[0].text.includes('[clearai·人门]'))

	// 已授权的计划:/plan-review 如实说不用重呈,不再 steer。
	const authorized = applyMutations(ledgerState, [{ t: 'plan/confirmed', plan: 'p1', by: 'user' }])
	current = authorized
	steered.length = 0
	const again = await invoke('plan-review')
	check('已授权后 /plan-review 不再打扰(如实说已有授权)', again.kind === 'success' && /不需要重呈/.test(again.text) && steered.length === 0)

	// 空账:四个命令都不该炸,如实说「没有」。
	current = emptyState()
	check('空账上 /goal /plan /plan-review 都如实且不失控', (await invoke('goal')).kind === 'success' && (await invoke('plan')).kind === 'success' && (await invoke('plan-review')).kind === 'error')
	check('内核门面缺席时报错而不是炸进程', await (async () => {
		const reg = new Map()
		apply({ get: (name) => (name === 'commands' ? { register: (definition) => reg.set(definition.name, definition) } : undefined) })
		const result = await reg.get('goal').handler({ commandId: 'c2', agent: fakeAgent, rawInput: '', attachments: [], signal: undefined })
		return result.kind === 'error'
	})())
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
