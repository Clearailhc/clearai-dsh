import test from 'node:test'
import assert from 'node:assert/strict'
import { researchEvents, mutationsFromResearchEvent, emptyResearchProjection, applyResearchProjection, researchProjectionView } from '../ui/lib/research-events.js'

const result = (seq, mutations) => ({ seq, time: 1000 + seq, type: 'tool/result', data: { turn: 1, step: 2, message: { toolCallId: 'c1' }, meta: { kind: 'clearai', v: 1, mutations } } })
const hypothesis = { t: 'goal/set', id: 'g1', revision: 2, reason: 'Scope changed', hypotheses: [{ id: 'h1', claim: 'Claim A', refute_when: 'A control fails' }, { id: 'h2', claim: 'Claim B' }] }

test('uncommitted JSON, user prose and other tool results do not create achievements', () => {
  for (const event of [{ type: 'tool/call', data: { args: JSON.stringify(hypothesis) } }, { seq: 1, type: 'user/message', data: { content: JSON.stringify(hypothesis) } }, { seq: 1, type: 'tool/result', data: { meta: { mutations: [hypothesis] } } }]) assert.deepEqual(researchEvents(event), [])
  const future = result(2, [hypothesis]); future.data.meta.v = 99
  assert.deepEqual(researchEvents(future), [])
})

test('different hypotheses remain separate and revisions preserve their source', () => {
  const events = researchEvents(result(1, [hypothesis]))
  assert.equal(events.length, 2)
  assert.notEqual(events[0].id, events[1].id)
  assert.equal(events[0].revision, 2)
  assert.equal(events[0].taskId, 'g1')
  assert.equal(events[0].status, 'pending')
  assert.equal(events[0].sourceSeq, 1)
  assert.ok(events[0].summary.includes('A control fails'))
})

test('committed definition changes group per operation and never become verified facts', () => {
  const rows = researchEvents(result(1, [{ t: 'ontology/term_added', id: 'customer', label: 'Customer' }, { t: 'ontology/predicate_added', id: 'belongs' }]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].changes, 2)
  assert.equal(rows[0].status, 'definition')
  assert.equal(rows[0].objects[0].label, 'Customer')
})

test('invalid and partial ontology files do not create structure achievements', () => {
  const rows = researchEvents(result(1, [{ t: 'workspace/synced', changes: [{ path: 'clear/ontology/concepts/customer.json', data: { partial: true } }, { path: 'clear/ontology/concepts/broken.json', error: 'invalid JSON' }] }]))
  assert.deepEqual(rows, [])
})

test('valid committed ontology files produce structural records with evidence paths', () => {
  const rows = researchEvents(result(1, [{ t: 'workspace/synced', changes: [{ path: 'clear/ontology/concepts/customer.json', data: { id: 'customer', label: 'Customer', gloss: 'An account being studied' } }] }]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].category, 'structure')
  assert.equal(rows[0].status, 'definition')
  assert.equal(rows[0].links[0].path, 'clear/ontology/concepts/customer.json')
})

test('validation failure and insufficient evidence remain distinguishable', () => {
  const rows = researchEvents(result(1, [{ t: 'evidence/recorded', id: 'e1', verdict: 'refute', basis: 'Control failed' }, { t: 'evidence/recorded', id: 'e2', verdict: 'unknown', basis: 'Insufficient coverage' }]))
  assert.deepEqual(rows.map(row => row.status), ['refute', 'unknown'])
})

test('tool and internal fact channels deduplicate, refresh replays the same history', () => {
  const mutation = { t: 'audit/dispatched', id: 'a1', evaluator_session: 'child-1', goal_id: 'g1' }
  const hook = { seq: 3, type: 'hook/result', data: { point: 'ClearAIFact', handlerId: 'clearai-fact-1', decision: 'pass', notice: { source: { kind: 'plugin:clearai', sections: [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: [mutation] }) }] } } } }
  assert.deepEqual(mutationsFromResearchEvent(hook), [mutation])
  const events = [hook, result(4, [mutation]), result(5, [{ t: 'audit/settled', id: 'a1', verdict: 'fail', basis: 'Missing control' }])]
  const replay = () => events.reduce(applyResearchProjection, emptyResearchProjection('session-a'))
  const state = replay()
  assert.deepEqual(Object.keys(state.bySeq), ['3', '5'])
  assert.deepEqual(replay(), state)
  assert.equal(applyResearchProjection(state, result(4, [mutation])), state)
  assert.equal(researchProjectionView(state).seen, undefined)
  assert.equal(researchProjectionView(state), researchProjectionView(state))
  assert.equal(Object.keys(emptyResearchProjection('session-b').bySeq).length, 0)
})

test('high-frequency activity does not update the projection or trigger model work', () => {
  const state = emptyResearchProjection('session-a')
  for (const type of ['tool/call', 'assistant/live-chunk', 'llm/retry', 'step/start']) assert.equal(applyResearchProjection(state, { seq: 1, type, data: {} }), state)
})

test('a goal revision does not repropose unchanged hypotheses', () => {
  const first = applyResearchProjection(emptyResearchProjection('s1'), result(1, [hypothesis]))
  const next = applyResearchProjection(first, result(2, [{ ...hypothesis, revision: 3, reason: 'Criteria changed' }]))
  assert.equal(next, first)
})

test('records inherit only the task committed in their own session history', () => {
  let state = applyResearchProjection(emptyResearchProjection('s1'), result(1, [hypothesis]))
  state = applyResearchProjection(state, result(2, [{ t: 'evidence/recorded', id: 'e1', hypothesis: 'h1', verdict: 'unknown' }]))
  assert.equal(state.bySeq[2][0].taskId, 'g1')
  state = applyResearchProjection(state, result(3, [{ ...hypothesis, id: 'g2' }]))
  state = applyResearchProjection(state, result(4, [{ t: 'evidence/recorded', id: 'e2', hypothesis: 'h1', verdict: 'unknown' }]))
  assert.equal(state.bySeq[4][0].taskId, 'g2')
  assert.equal(state.bySeq[2][0].taskId, 'g1')
})

test('late review results retain their original task after a new goal starts', () => {
  let state = applyResearchProjection(emptyResearchProjection('s1'), result(1, [hypothesis, { t: 'audit/dispatched', id: 'a-old', goal_id: 'g1' }]))
  state = applyResearchProjection(state, result(2, [{ ...hypothesis, id: 'g2', hypotheses: [{ id: 'h-new', claim: 'New task claim' }] }]))
  state = applyResearchProjection(state, result(3, [{ t: 'audit/settled', id: 'a-old', verdict: 'support' }, { t: 'evidence/recorded', id: 'e-late', hypothesis: 'h1', verdict: 'support' }]))
  assert.ok(state.bySeq[3].every(record => record.taskId === 'g1'))
  state = applyResearchProjection(state, result(4, [{ t: 'evidence/recorded', id: 'e-unknown', verdict: 'unknown' }]))
  assert.equal(state.bySeq[4][0].taskId, null)
})
