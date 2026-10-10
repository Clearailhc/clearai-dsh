/** Native todo is a display of the ledger, never a second completion authority. */
export function planTodos(state, language = 'zh') {
 const plans = (state?.plans ?? []).filter(plan => !state.goal || plan.goal === state.goal.id)
 const plan = plans.find(plan => plan.status === 'active') ?? plans.at(-1)
 if (!plan) return null
 const open = plan.steps.find(step => step.status === 'open')
 const active = plan.status === 'active' && !plan.blocked && (!state.goal || state.goal.status === 'open')
 return plan.steps.filter(step => step.status !== 'void').map((step, index) => ({
  content: `${index + 1}. ${String(step.do).length > 160 ? String(step.do).slice(0, 160) + '…' : step.do}${plan.blocked?.step === step.id ? (language === 'en' ? ' — blocked: ' : ' · 受阻:') + String(plan.blocked.reason ?? '').slice(0, 100) : ''}`,
  status: step.status === 'advanced' ? 'completed' : active && step === open ? 'in_progress' : 'pending',
 }))
}

export function createTodoMirror({ session, isChild = () => false, warn = () => {} }) {
 const written = new Map()
 return (id, state) => {
  if (isChild(id)) return
  const todos = planTodos(state, state?.language)
  // No ClearAI plan: keep an unrelated native todo list intact.
  if (todos === null && !written.has(id)) return
  try {
   const target = session(id)
   if (typeof target?.append !== 'function') return
   const events = target.snapshotEvents?.() ?? target.ownEvents?.() ?? []
   const boundary = events.findLast?.(event => event.type === 'turn/start' || event.type === 'todo/write')
   const value = JSON.stringify(todos ?? [])
   if (boundary?.type === 'todo/write' && JSON.stringify(boundary.data.todos) === value) return
   const turn = events.findLast?.(event => event.type === 'turn/start')?.data?.turn ?? 0
   // Fallback for hosts that expose append but not their event snapshot.
   if (!boundary && written.get(id) === `${turn}:${value}`) return
   target.append('todo/write', { todos: todos ?? [] })
   written.set(id, `${turn}:${value}`)
  } catch (error) { warn(`clearai: native todo sync failed: ${error.message}`) }
 }
}
