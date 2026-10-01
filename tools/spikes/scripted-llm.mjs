/**
 * 原型验证共用:一个按剧本发工具调用的假模型(不需要任何凭据)。
 * 它走与真模型完全相同的工具管线、守卫与会话日志;剧本的每一步按「已有几条 assistant 消息」取。
 */
export const PROVIDER = 'spike-scripted'

function* chunksFor(step, index) {
	if (step.text !== undefined) {
		yield { type: 'block-start', index: 0, blockType: 'text' }
		yield { type: 'text-delta', index: 0, text: step.text }
		yield { type: 'block-end', index: 0, block: { type: 'text', text: step.text } }
		yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
		yield { type: 'finish', reason: { kind: 'stop' } }
		return
	}
	const id = `spike-call-${index}`
	const args = JSON.stringify(step.args)
	yield { type: 'block-start', index: 0, blockType: 'tool-call' }
	yield { type: 'tool-call-delta', index: 0, id, name: step.name, argumentsDelta: args }
	yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: step.name, arguments: args } }
	yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
	yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/** 注册假模型。`script` 是 `(messages) => {name,args} | {text}` 的数组。 */
export function registerScriptedModel(ctx, script) {
	const adapter = {
		providerInfo: (provider) => ({ id: provider, name: provider }),
		providerRetryPolicy: () => undefined,
		imageRequestPricing: () => undefined,
		listModels: async () => [{ id: 'script', name: 'script' }],
		resolveModel: async (provider, model) => ({ provider, id: model, name: model, contextWindow: 200000 }),
		async prepareCall(provider, model) {
			return { model: await adapter.resolveModel(provider, model), stream: (options) => adapter.stream(options) }
		},
		async *stream(options) {
			const messages = options.messages ?? []
			// 标题生成之类的辅助调用不带工具:给一句话就走,不占剧本
			if (!Array.isArray(options.tools) || options.tools.length === 0) {
				yield* chunksFor({ text: 'spike' }, 0)
				return
			}
			const done = messages.filter((message) => message.role === 'assistant').length
			yield* chunksFor(script[Math.min(done, script.length - 1)](messages), done)
		},
	}
	ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter), 'spike:adapter')
}
