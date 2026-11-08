import { checkOntologyFile } from './domain-language.js'
import { createHash } from 'node:crypto'

/** UI-only projection. Source metadata remains the authority; never used as model input. */
export const RESEARCH_EVENT_VERSION = 4

const list = value => Array.isArray(value) ? value : []
const text = value => typeof value === 'string' ? value : ''
const object = (kind, id, label) => ({ kind, id: text(id), label: text(label) || text(id) })

/** Project only committed kernel mutation metadata, never tool argument fragments or files. */
export function mutationsFromResearchEvent(event) {
  if (!Number.isSafeInteger(event?.seq)) return []
  if (event.type === 'tool/result') {
    const meta = event.data?.meta
    return meta?.kind === 'clearai' && meta.v === 1 ? list(meta.mutations ?? (meta.mutation ? [meta.mutation] : [])) : []
  }
  const data = event.type === 'hook/result' && event.data?.point === 'ClearAIFact' && event.data?.handlerId?.startsWith('clearai-fact-') && event.data?.decision === 'pass' ? event.data.notice : event.type === 'user/message' ? event.data : null
  const source = data?.source
  if (!(source?.kind === 'plugin:clearai' || (source?.kind === 'plugin' && source?.plugin === 'clearai'))) return []
  const section = list(source.sections).find(item => item?.name === 'clearai/mutations')
  try { return list(JSON.parse(section?.text).mutations) } catch { return [] }
}

export function researchEvents(event, mutations = mutationsFromResearchEvent(event)) {
  const output = []
  const add = (category, mutation, index, objects, summary, status, links = []) => {
    output.push({
      v: RESEARCH_EVENT_VERSION, id: `${event.seq}:${index}:${category}`, category,
      sourceSeq: event.seq, sourceCallId: event.data?.message?.toolCallId ?? null, example: event.data?.meta?.example === true,
      turn: event.data?.turn ?? null, step: event.data?.step ?? null,
      taskId: text(mutation.goal_id) || text(mutation.goal) || (mutation.t === 'goal/set' || mutation.t === 'goal/closed' ? text(mutation.id) : null),
      time: typeof event.time === 'number' ? event.time : null,
      objects: objects.filter(item => item.id), summary: summary.filter(Boolean), status,
      links: links.filter(link => link && typeof link === 'object'), revision: mutation.revision ?? null, replaces: mutation.t === 'hypothesis/superseded' ? text(mutation.id) : null,
      sourceTypes: [mutation.t],
    })
  }
  const structure = [], entities = []
  mutations.forEach((mutation, index) => {
    if (!mutation || typeof mutation.t !== 'string') return
    const m = mutation
    if (m.t === 'goal/set') {
      list(m.hypotheses).forEach((hypothesis, offset) => {
        if (!text(hypothesis?.id) || !text(hypothesis?.claim)) return
        add('hypothesis', m, `${index}.${offset}`, [object('hypothesis', hypothesis.id, hypothesis.name)], [text(hypothesis.claim), text(m.reason)], 'pending')
        output.at(-1).refutationCondition = text(hypothesis.refute_when) || null
      })
    } else if (m.t === 'hypothesis/superseded') {
      add('hypothesis', m, index, [object('hypothesis', m.id)], [text(m.claim), text(m.reason), text(m.by)], 'superseded')
    } else if (/^ontology\/(term|predicate)_(added|revised|deprecated)$/.test(m.t)) {
      structure.push({ mutation: m, index })
    } else if (m.t === 'workspace/synced') {
      list(m.changes).forEach(change => {
        if (change?.error || change?.removed || !change?.data || typeof change.data !== 'object') return
        const match = /^clear\/ontology\/(concepts|relations|entities)\/(?:.*\/)?([^/]+)\.json$/.exec(text(change.path))
        if (!match || checkOntologyFile(change.path, change.data).length) return
        const row = { mutation: { t: m.t, id: match[2], label: change.data.label, basis: change.data.basis, path: change.path }, index }
        ;(match[1] === 'entities' ? entities : structure).push(row)
      })
      if (list(m.integrity).length) add('integrity', m, index, [], list(m.integrity).map(item => text(item?.path) + ': ' + text(item?.code)), 'review-required')
    } else if (m.t === 'entity/registered' || m.t === 'entity/asserted') {
      entities.push({ mutation: m, index })
    } else if (m.t === 'evidence/recorded') {
      add('validation', m, index, [object('hypothesis', m.hypothesis), object('evidence', m.id)], [text(m.basis)], text(m.verdict) || 'unknown', list(m.origins))
    } else if (m.t === 'audit/dispatched' && text(m.evaluator_session) && m.status !== 'dispatching') {
      add('handoff', m, index, [object('audit', m.id)], [text(m.reason), ...list(m.criteria).map(item => typeof item === 'string' ? item : text(item?.text))], 'dispatched', text(m.evaluator_session) ? [{ kind: 'evaluator-session', sessionId: m.evaluator_session }] : [])
    } else if (m.t === 'audit/settled') {
      add('adjudication', m, index, [object('audit', m.id)], [text(m.basis), ...list(m.shortfalls).map(item => typeof item === 'string' ? item : text(item?.detail) || [text(item?.criterion), text(item?.what), text(item?.missing)].filter(Boolean).join(' · '))], text(m.verdict) || 'unknown', text(m.card_path) ? [{ kind: 'audit-card', path: m.card_path }] : [])
    } else if (m.t === 'goal/closed') {
      add('outcome', m, index, [object('goal', m.id)], list(m.answers).flatMap(answer => [text(answer?.conclusion), ...list(answer?.basis).map(text), ...list(answer?.open).map(item => text(item?.effect) || text(item))]), text(m.status) || 'unknown')
    }
  })
  for (const [category, rows] of [['structure', structure], ['entities', entities]]) {
    if (!rows.length) continue
    const objects = rows.map(({ mutation: m }) => category === 'structure'
      ? object(m.t.includes('predicate') || m.path?.includes('/relations/') ? 'predicate' : 'term', m.id, m.label)
      : object('entity', m.id ?? m.subject?.id, m.label))
    const basis = rows.map(({ mutation: m }) => text(m.basis)).filter(Boolean)
    add(category, rows[0].mutation, rows[0].index, objects, basis, category === 'structure' ? 'definition' : 'pending')
    output.at(-1).changes = rows.length
    output.at(-1).sourceTypes = [...new Set(rows.map(row => row.mutation.t))]
    output.at(-1).links = rows.filter(row => row.mutation.path).map(row => ({ kind: 'artifact', path: row.mutation.path }))
  }
  return output.sort((a, b) => Number.parseInt(a.id.split(':')[1]) - Number.parseInt(b.id.split(':')[1]))
}

const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).filter(key => key !== 'at').sort().map(key => [key, item[key]])) : item)
const fingerprint = mutation => createHash('sha256').update(canonical(mutation)).digest('hex')

/** Session-owned, disposable UI cache. Replaying it never executes tools or changes research. */
export function emptyResearchProjection(sessionId) {
  return { sessionId, v: RESEARCH_EVENT_VERSION, taskId: null, objectTasks: {}, seen: {}, bySeq: {} }
}

export function applyResearchProjection(state, event) {
  const candidates = mutationsFromResearchEvent(event).filter(mutation => mutation && typeof mutation === 'object' && typeof mutation.t === 'string')
  if (!candidates.length) return state
  const accepted = new Set()
  const fresh = candidates.filter(mutation => {
    const key = fingerprint(mutation)
    if (Object.hasOwn(state.seen, key) || accepted.has(key)) return false
    accepted.add(key)
    return true
  })
  if (!fresh.length) return state
  const hypothesisKeys = []
  const displayMutations = fresh.map(mutation => mutation.t !== 'goal/set' ? mutation : {
    ...mutation,
    hypotheses: list(mutation.hypotheses).filter(hypothesis => {
      const key = 'hypothesis:' + fingerprint({ goal: mutation.id, hypothesis })
      if (Object.hasOwn(state.seen, key)) return false
      hypothesisKeys.push(key)
      return true
    }),
  })
  const records = researchEvents(event, displayMutations)
  const taskId = [...fresh].reverse().find(mutation => mutation.t === 'goal/set')?.id ?? state.taskId
  const objectTasks = { ...state.objectTasks }
  for (const mutation of fresh) {
    if (mutation.t === 'goal/set') for (const hypothesis of list(mutation.hypotheses).filter(item => text(item?.id))) objectTasks[`hypothesis:${hypothesis.id}`] = mutation.id
    if (mutation.t === 'audit/dispatched' && text(mutation.id)) {
      const key = `audit:${mutation.id}`
      objectTasks[key] = mutation.goal_id ?? mutation.goal ?? objectTasks[key] ?? taskId
    }
  }
  const contextChanged = taskId !== state.taskId || Object.keys(objectTasks).some(key => objectTasks[key] !== state.objectTasks[key])
  if (!records.length && !contextChanged) return state
  for (const record of records) if (!record.taskId) {
    const sourceTask = record.objects.map(item => objectTasks[`${item.kind}:${item.id}`]).find(Boolean)
    record.taskId = sourceTask ?? (['validation', 'adjudication'].includes(record.category) ? null : taskId)
  }
  const seen = { ...state.seen }
  for (const mutation of fresh) seen[fingerprint(mutation)] = event.seq
  for (const key of hypothesisKeys) seen[key] = event.seq
  return { ...state, taskId, objectTasks, seen, bySeq: records.length ? { ...state.bySeq, [event.seq]: records } : state.bySeq }
}

const views = new WeakMap()
export function researchProjectionView(state) {
  if (!views.has(state.bySeq)) views.set(state.bySeq, { sessionId: state.sessionId, v: state.v, bySeq: state.bySeq })
  return views.get(state.bySeq)
}
