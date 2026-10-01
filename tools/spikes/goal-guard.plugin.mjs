/**
 * 原型验证一:原生 goal 的「完成」能否被可靠拦下(docs/less-is-more-plan.zh-CN.md 第七节)。
 *
 * 在真 DSH headless 宿主里挂三样东西,走与真模型完全相同的工具管线、守卫与会话日志:
 *   · 一个按剧本发工具调用的假模型(scripted-llm.mjs);
 *   · 一道守卫:模型调 `update_goal(action=complete)` 一律拒绝,指向 `SpikeConclude`;
 *   · `SpikeConclude`:模拟 ClearAI 的结案工具——它自己调 `ctx.goals.complete()`(服务调用,不经工具守卫)。
 *
 * 剧本:create_goal → get_goal → update_goal(complete)【应被拒】→ get_goal【应仍 active】
 *       → SpikeConclude【应完成】→ get_goal【应 complete】→ 收尾文字。
 */
import { registerScriptedModel } from './scripted-llm.mjs'

export const name = 'clearai-spike-goal-guard'
export const inject = ['llm', 'tools', 'goals']

/** 从请求里最近一条工具结果读出 goal 的 id 与 revision(原生 goal 工具返回紧凑 JSON)。 */
function lastGoal(messages) {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i]
		if (message.role !== 'tool') continue
		const text = (message.content ?? []).map((part) => part.text ?? '').join('')
		const match = text.match(/\{[\s\S]*\}/)
		if (match === null) continue
		try {
			const parsed = JSON.parse(match[0])
			const goal = parsed.goal ?? parsed
			if (goal && typeof goal.id === 'string') return goal
		} catch {
			/* 不是 JSON,继续往前找 */
		}
	}
	return null
}

const SCRIPT = [
	() => ({ name: 'create_goal', args: { objective: '原型验证:完成必须先过独立评估' } }),
	() => ({ name: 'get_goal', args: {} }),
	(messages) => {
		const goal = lastGoal(messages)
		return { name: 'update_goal', args: { goal_id: goal?.id ?? 'unknown', revision: goal?.revision ?? 0, action: 'complete' } }
	},
	() => ({ name: 'get_goal', args: {} }),
	() => ({ name: 'SpikeConclude', args: {} }),
	() => ({ name: 'get_goal', args: {} }),
	() => ({ text: 'SPIKE-DONE' }),
]

/**
 * PTC 剧本(`DSH_TOOLS_MODE=ptc` 且 `SPIKE_SCRIPT=ptc`):模型只能调 `run_code`,
 * 在一段程序里先建 goal、再直接 complete——守卫要在嵌套调用里同样拦下。
 */
const PTC_CODE = [
	"const created = await tools.create_goal({ objective: '原型验证:PTC 里也拦得住' })",
	'let attempt',
	"try { attempt = await tools.update_goal({ goal_id: created.goal.id, revision: created.goal.revision, action: 'complete' }) } catch (error) { attempt = 'DENIED: ' + error.message }",
	'const after = await tools.get_goal({})',
	"return { attempt, phase: after.goal.phase }",
].join('\n')
const PTC_SCRIPT = [() => ({ name: 'run_code', args: { code: PTC_CODE, description: '原型验证:PTC 里直接完成 goal' } }), () => ({ text: 'SPIKE-PTC-DONE' })]

export function apply(ctx) {
	registerScriptedModel(ctx, process.env.SPIKE_SCRIPT === 'ptc' ? PTC_SCRIPT : SCRIPT)

	// 守卫:模型不能用原生工具直接完成目标;完成必须走 ClearAI 的结案(那里要先过独立评估)。
	ctx.tools.guard((exec) => {
		const args = typeof exec.arguments === 'string' ? JSON.parse(exec.arguments) : exec.arguments
		if (exec.name === 'update_goal' && args?.action === 'complete') return 'SPIKE-GUARD: 目标的完成必须经 SpikeConclude(先过独立评估),不能直接 complete'
		return undefined
	})

	ctx.tools.register({
		name: 'SpikeConclude',
		description: '原型验证:模拟 ClearAI 的结案工具。独立评估通过后由插件自己把原生 goal 置为完成。',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
		output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
		async execute(_args, exec) {
			const current = ctx.goals.get?.(exec.agent) ?? null
			if (current === null || current === undefined) return '没有当前 goal'
			const done = ctx.goals.complete(exec.agent, { id: current.id, revision: current.revision })
			return `SpikeConclude: goal ${done.id} → ${done.phase}`
		},
	})
}
