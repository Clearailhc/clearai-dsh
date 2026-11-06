import { mkdirSync } from 'node:fs'
import { scenario, kernelExamples } from './scenario.js'

export const inject = ['sessions', 'workspaceRegistry', 'connection']
export async function apply(ctx) {
  console.info('ClearAI example: initializing')
  const cwd = '/tmp/clearai-059-example-workspace'
  mkdirSync(cwd, { recursive: true })
  const workspace = await ctx.workspaceRegistry.create(cwd, 'ClearAI 0.5.9 · 示例回放 / Example replay')
  const session = ctx.sessions.create('clearai-059-example', { meta: { cwd } })
  await workspace.attachSession(session.id)
  console.info('ClearAI example: session attached')
  let cursor = 0
  session.append('agent-preset/selected', { agentPreset: 'clearai' })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', { id: 'example-user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '示例回放：比较客户流失差异（不调用模型）' }] }, { surfaceOp: 'append' })
  const advance = () => {
    if (cursor >= scenario.length) return false
    const id = `example-${++cursor}`
    if (cursor === 4) session.append('user/message', { id: 'example-user-2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '示例用户调整：只比较最近 90 天的客户。' }] }, { surfaceOp: 'append' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: { id, role: 'tool', toolCallId: id, source: { type: 'tool', name: 'ExampleReplay', callId: id }, content: [] },
      meta: { kind: 'clearai-example-replay', v: 1, event: scenario[cursor - 1], cursor, total: scenario.length },
    }, { surfaceOp: 'append' })
    if (kernelExamples[cursor - 1].length) session.append('tool/result', {
      turn: 1, step: 1,
      message: { id: id + '-kernel', role: 'tool', toolCallId: id + '-kernel', source: { kind: 'tool', name: 'ExampleReplay', callId: id + '-kernel' }, content: [] },
      meta: { kind: 'clearai', v: 1, example: true, mutations: kernelExamples[cursor - 1] },
    }, { surfaceOp: 'append' })
    if (cursor === scenario.length) {
      session.append('step/end', { turn: 1, step: 1 })
      session.append('turn/end', { turn: 1, reason: 'completed' })
    }
    return true
  }
  advance()
  console.info('ClearAI example: first event committed')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/clearai-example/next', methods: ['POST'], requestBody: 'buffered',
    fetch: () => Response.json({ advanced: advance(), cursor, total: scenario.length }),
  }), 'example replay only')
}
