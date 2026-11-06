window.__ModuleLoader__.load({
  id: 'clearai-research-preview',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const kind = 'clearai-example-event'
    const listeners = new Set()
    let latest = 0
    function ExampleEvent({ node }) {
      const [error, setError] = React.useState('')
      const [pending, setPending] = React.useState(false)
      const value = node.data
      const event = value.event
      const cursor = React.useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback) }, () => latest)
      if (value.cursor !== cursor) return null
      // This row is a replay control; production research events render in their own official slots.
      return h('section', { 'aria-label': '示例回放控制', style: { fontSize: '0.85em', margin: '8px 0' } },
        h('small', null, `示例回放 / Example replay · 无模型调用 · ${value.cursor}/${value.total}`),
        value.cursor === 4 ? h('p', null, event.summary) : null,
        value.cursor < value.total && h('button', { type: 'button', disabled: pending, onClick: async () => {
          setPending(true)
          try { const response = await fetch('/api/clearai-example/next', { method: 'POST' }); if (!response.ok) throw new Error(String(response.status)) }
          catch (e) { setError(`回放未推进：${e.message}`); setPending(false) }
        }, style: { display: 'block', marginTop: 8, padding: '5px 10px', color: 'inherit', background: 'transparent', border: '1px solid currentColor', borderRadius: 6 } }, '播放下一事件 / Next event'),
        error && h('p', { role: 'alert' }, error))

    }
    return { inject: ['uiConversation', 'slots', 'conversation'], apply(ctx) {
      ctx.conversation.blocks.set('clearai-059-example', { reason: '示例回放不调用模型。请使用事件下方的回放按钮。' })
      ctx.uiConversation.events.register({
        kind, target: 'chat',
        match: { 'tool/result': event => event.data?.meta?.kind === 'clearai-example-replay' ? { id: String(event.seq), role: 'start', exclusive: true } : null },
        start: (_context, match) => {
          const value = match.event.data.meta
          if (value.cursor > latest) { latest = value.cursor; queueMicrotask(() => listeners.forEach(callback => callback())) }
          return { value, seq: match.event.seq, location: match.location }
        },
        update: context => context.state,
        buildViewNode: context => ({ key: context.key, id: context.id, kind, target: 'chat', data: context.state.value, anchorSeq: context.state.seq, location: context.state.location, visibility: 'visible', groupTree: 'turn' }),
      })
      ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: kind }, ExampleEvent))
    } }
  },
})
