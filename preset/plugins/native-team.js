/** Team execution is observational input; only ClearAI can accept evidence. */
export function teamBinding(service, agent, steps, existing = []) {
  const bindings = new Map()
  const used = new Set(existing.filter(step => step.status !== 'void').map(step => step.team_task_id).filter(Boolean))
  for (const step of steps) {
    if (step.team_task_id === undefined) continue
    if (typeof step.team_task_id !== 'string' || !step.team_task_id.trim()) throw new Error('team_task_id must be a nonempty native task id')
    const membership = agent ? service?.tryMembership(agent) : undefined
    if (!membership) throw new Error('team_task_id requires membership in the current native Team')
    if (used.has(step.team_task_id)) throw new Error(`Duplicate active Team task binding: ${step.team_task_id}`)
    const task = service.getTask(agent, step.team_task_id)
    if (!task || task.status === 'deleted') throw new Error(`Native Team task is unavailable: ${step.team_task_id}`)
    used.add(step.team_task_id)
    bindings.set(step.id, { team_task_id: task.id, team_id: String(membership.id), team_task: taskSnapshot(task) })
  }
  return bindings
}
export function taskSnapshot(task) {
  return { id: task.id, revision: task.revision, status: task.status, subject: task.subject, description: task.description, ownerName: task.ownerName ?? null, blockedBy: task.blockedBy ?? [], result: task.result ?? null }
}
export function teamObservations(service, agent, state) {
  const membership = agent ? service?.tryMembership(agent) : undefined
  return (state.plans ?? []).flatMap(plan => plan.steps.filter(step => step.team_task_id && step.status !== 'void').map(step => {
    let task
    try {
      if (!membership || String(membership.id) !== step.team_id) throw new Error('Original Team is unavailable in this session')
      task = taskSnapshot(service.getTask(agent, step.team_task_id))
    } catch (error) { task = { id: step.team_task_id, status: 'unavailable', reason: error.message } }
    return { plan: plan.id, step: step.id, team_id: step.team_id, task }
  }))
}
