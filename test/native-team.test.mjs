import test from 'node:test'
import assert from 'node:assert/strict'
import { teamBinding, teamObservations } from '../preset/plugins/native-team.js'
import { applyMutations, emptyState, STATE_VERSION, view } from '../ui/lib/fold.js'
import { planTodos } from '../preset/plugins/native-todos.js'
import { auditMaterialDigest } from '../preset/plugins/audit-material.js'
import { tempDir } from './tmp.mjs'
const agent = { id: 'lead' }
const task = { id: 'task-1', revision: 1, subject: 'measure', description: 'save data', status: 'completed' }
const service = { tryMembership: a => a === agent ? { id: 'lead' } : undefined, getTask: (_a, id) => { if (id !== task.id) throw Error('not found'); return task } }
const step = { id: 's', do: 'measure', done_criteria: 'valid data', team_task_id: task.id }

test('bindings require a current Team task, reject duplicates and never fabricate old links', () => {
 assert.throws(() => teamBinding(undefined, agent, [step]), /membership/)
 assert.throws(() => teamBinding(service, {}, [step]), /membership/)
 assert.throws(() => teamBinding(service, agent, [{ ...step, team_task_id: 'missing' }]), /not found/)
 assert.throws(() => teamBinding(service, agent, [step, { ...step, id: 's2' }]), /Duplicate/)
 assert.throws(() => teamBinding(service, agent, [step], [{ ...step, status: 'advanced' }]), /Duplicate/)
 assert.equal(teamBinding(service, agent, [step], [{ ...step, status: 'void' }]).size, 1)
 const old = applyMutations(emptyState(), [{ t: 'plan/created', id: 'p', steps: [{ id: 'legacy', do: 'old' }] }])
 assert.equal(old.plans[0].steps[0].team_task_id, undefined)
 assert.equal(STATE_VERSION, 23)
})

test('native completed remains unaccepted; reopening preserves acceptance history and is visible', () => {
 const binding = teamBinding(service, agent, [step]).get('s')
 let state = applyMutations(emptyState(), [{ t: 'plan/created', id: 'p', steps: [{ ...step, ...binding }] }])
 assert.equal(state.plans[0].steps[0].status, 'open')
 assert.equal(planTodos(state)[0].status, 'in_progress')
 assert.match(planTodos(state)[0].content, /待核验/)
 assert.equal(view(state).plan.steps[0].team_task_id, task.id)
 const observation = teamObservations({ ...service, getTask: () => ({ ...task, status: 'pending', revision: 2 }) }, agent, state)[0]
 state = applyMutations(state, [{ t: 'team/observed', ...observation }])
 assert.equal(state.plans[0].steps[0].team_task.status, 'pending')
 assert.equal(state.plans[0].steps[0].status, 'open')
 const foreign = teamObservations({ ...service, tryMembership: () => ({ id: 'another-team' }) }, agent, state)
 assert.equal(foreign[0].task.status, 'unavailable')
})

test('native task changes invalidate audit materials without a new dispatch being an input', () => {
 const input = { cwd: tempDir('team-digest-'), kind: 'evidence_audit', step: { id: 's' }, state: { plans: [] }, gate: {}, teamTasks: [{ task }] }
 const digest = auditMaterialDigest(input)
 assert.equal(auditMaterialDigest(input), digest)
 assert.notEqual(auditMaterialDigest({ ...input, teamTasks: [{ task: { ...task, revision: 2, status: 'pending' } }] }), digest)
})
