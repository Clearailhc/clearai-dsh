/**
 * 原型验证三:原生 `present` 与准入的关系(docs/less-is-more-plan.zh-CN.md 第七节)。
 *
 *   · `SpikeAdvance{step, artifact}`:模拟 `AdvancePlan` 的准入——产物必须存在且非空;
 *     收下之后由内核自己往会话日志追加一条 `deliverables/presented`(与原生 `present` 写的是同一种事件),
 *     原生交付卡片按回合读它,模型不用再调一次 `present`。
 *   · 内核也能看见模型自己调的 `present`(`tools/result`),记下来备查,但不拦。
 *
 * 剧本:写 empty.md(空)→ SpikeAdvance(empty.md)【应拒收,不声明】→ 写 report.md → SpikeAdvance(report.md)
 *       【应收下并声明】→ 模型自己 present(notes.md)【内核看得见】→ SpikeSeen → 收尾。
 */
import { registerScriptedModel } from './scripted-llm.mjs'

export const name = 'clearai-spike-present'
export const inject = ['llm', 'tools', 'fs', 'sessionProjections']

const SCRIPT = [
	() => ({ name: 'write', args: { file_path: 'empty.md', content: '' } }),
	() => ({ name: 'SpikeAdvance', args: { step: 's1', artifact: 'empty.md' } }),
	() => ({ name: 'write', args: { file_path: 'report.md', content: '# 结论\n\n成立,范围:样本 A。\n' } }),
	() => ({ name: 'SpikeAdvance', args: { step: 's1', artifact: 'report.md' } }),
	() => ({ name: 'write', args: { file_path: 'notes.md', content: '过程笔记\n' } }),
	() => ({ name: 'present', args: { files: [{ path: 'notes.md', description: '模型自己交的' }] } }),
	() => ({ name: 'SpikeSeen', args: {} }),
	() => ({ text: 'SPIKE-PRESENT-DONE' }),
]

const text = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]

export function apply(ctx) {
	registerScriptedModel(ctx, SCRIPT)

	const seen = []
	ctx.on('tools/result', (exec, result) => {
		if (exec.name === 'present' && !result.isError) seen.push({ callId: exec.callId, by: 'model' })
	})

	ctx.tools.register({
		name: 'SpikeAdvance',
		description: '原型验证:准入核对产物存在且非空;收下后由内核声明为交付物。',
		parameters: { type: 'object', properties: { step: { type: 'string' }, artifact: { type: 'string' } }, required: ['step', 'artifact'], additionalProperties: false },
		output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
		async execute(args, exec) {
			const session = exec.agent.session
			const cwd = session.header.cwd
			const info = await ctx.fs.stat(await ctx.fs.resolve(args.artifact, { cwd, signal: exec.signal }), exec.signal)
			if (info === undefined || info.type !== 'file' || info.size === 0) throw new Error(`准入拒收:${args.artifact} 不存在或为空`)
			const turn = ctx.sessionProjections.stateOf(session, 'turnBoundary').lastTurn
			session.append('deliverables/presented', { turn, callId: exec.callId, files: [{ path: args.artifact, description: `步骤 ${args.step} 的产物` }] })
			seen.push({ callId: exec.callId, by: 'kernel' })
			return `准入收下 ${args.artifact},已声明为交付物`
		},
	})

	ctx.tools.register({
		name: 'SpikeSeen',
		description: '原型验证:内核看到的交付声明。',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
		output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
		async execute() {
			return JSON.stringify(seen)
		},
	})
}
