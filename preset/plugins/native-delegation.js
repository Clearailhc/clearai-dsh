/** Select the host's delegation surface without creating a second Team runtime. */
import { scopeOf, scopeChainOf } from '@deepseek-ai/dsh-scope'
import * as control from '@deepseek-ai/dsh-tool-subagent-control'
import * as roster from '@deepseek-ai/dsh-tool-subagent-control/list-agents'
import * as delegate from '@deepseek-ai/dsh-tool-subagent'

export const name = 'clearai-native-delegation'
export const inject = ['agents', 'tools', 'systemPrompt', 'subagents']
export async function apply(ctx) {
  const composition = scopeOf(ctx)
  const installed = new Map()
  const belongs = agent => scopeChainOf(scopeOf(agent.ctx)).includes(composition)
  const mode = agent => ctx.get('agentTeams')?.tryMembership(agent) ? 'team' : 'subagent'
  const install = async agent => {
    if (!belongs(agent) || installed.has(agent)) return
    // Ordinary one-shot children, including auditors, retain the inherited tool
    // filter. Never register delegation capabilities in their exempt own layer.
    if (agent.session.header.origin === 'subagent' && mode(agent) !== 'team') return
    const record = { mode: mode(agent), fibers: [] }
    installed.set(agent, record)
    if (record.mode === 'team') return // Native host owns tools, policy and roster.
    for (const [plugin, config] of [[control], [roster], [delegate, { provider: 'spawn', toolName: 'subagent', modelSelectionSettings: true, backgroundMode: 'continuable' }], [delegate, { provider: 'fork', toolName: 'subagent_fork', backgroundMode: 'continuable' }]]) {
      const fiber = agent.ctx.plugin(plugin, config)
      record.fibers.push(fiber)
      await fiber
    }
  }
  const remove = async agent => {
    const record = installed.get(agent)
    installed.delete(agent)
    for (const fiber of record?.fibers ?? []) await fiber.dispose()
  }
  ctx.on('agent/created', async ({ agent }) => { await install(agent) })
  ctx.on('agent/disposed', async ({ agent }) => { await remove(agent) })
  ctx.on('agent/request', async (payload, next) => {
    const agent = payload.agent
    if (agent && belongs(agent)) {
      await install(agent)
      const record = installed.get(agent)
      if (record && record.mode !== mode(agent)) throw new Error('ClearAI delegation mode changed; start a new session. Existing work has not been migrated or dispatched.')
      if (record?.mode === 'team') {
        for (const tool of ['spawn_teammate', 'list_agents', 'send_message', 'team_task_get', 'team_task_update']) {
          if (!ctx.tools.get(tool, agent)) throw new Error(`ClearAI native Team mounting failed: missing ${tool}`)
        }
      }
    }
    return next()
  })
  ctx.effect(() => () => Promise.all([...installed.keys()].map(remove)))
  await Promise.all(ctx.agents.list().map(install))
}
