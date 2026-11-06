import { readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { contentDigest, fileDigest } from './audit-material.js'
import { RERUN_EXCLUDED } from './rerun-copy.js'

export const AGENT_WORKFLOW = 'agent-v1'
export const REVIEW_POLICY = 'clearai.review.v1'

// Dependency completeness cannot be inferred from an author's declaration. Until
// independently bounded dependencies exist, bind all ordinary workspace files.
// System projections are separately represented by semantic state, never by UI files.
export function researchSnapshot(cwd) {
 const files = [], unbounded = []
 let bytes = 0
 const walk = (dir, prefix = '') => {
  for (const name of readdirSync(dir).sort()) {
   if (['node_modules', '.venv', 'venv'].includes(name)) unbounded.push(prefix ? `${prefix}/${name}` : name)
   if (RERUN_EXCLUDED.has(name) || (!prefix && name === 'clear')) continue
   const path = prefix ? `${prefix}/${name}` : name
   const stat = lstatSync(join(dir, name))
   if (stat.isSymbolicLink()) throw new Error(`review-symlink: ${path}`)
   if (stat.isDirectory()) walk(join(dir, name), path)
   else if (stat.isFile()) {
    bytes += stat.size
    if (files.length >= 10000 || bytes > 128 * 1024 * 1024) throw new Error('review-snapshot-limit')
    const digest = fileDigest(cwd, path)
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`review-unreadable: ${path}`)
    files.push([path, digest])
   } else throw new Error(`review-special-file: ${path}`)
  }
 }
 walk(cwd)
 return { policy: 'workspace-conservative-v1', digest: contentDigest(files), files, unbounded }
}

export function reviewState(state, step, kind) {
 const ids = new Set(step.tests?.hypotheses ?? [])
 const goal = state.goal ?? {}
 return {
  ...state,
  goal: { id: goal.id, workflow: goal.workflow, claim: goal.claim, done_criteria: goal.done_criteria, conditions: goal.conditions, promote_at_level: goal.promote_at_level },
  plans: [],
  // The final reviewer sees all candidates, so omissions cannot hide contrary claims.
  hypotheses: (state.hypotheses ?? []).filter(h => kind === 'goal_audit' || ids.has(h.id)),
  evidence: (state.evidence ?? []).filter(e => e.anchor !== 'auditor' && (kind === 'goal_audit' || ids.has(e.hypothesis))),
  facts: kind === 'goal_audit' ? state.facts : [],
 }
}

// Public work only. Raw sources remain accessible; author notes are leads, not proof.
export function researchHandoff(state, step, receipts = []) {
 const selected = new Set(step.tests?.hypotheses ?? [])
 return {
  policy: REVIEW_POLICY,
  claims: (state.hypotheses ?? []).map(h => ({ id: h.id, version: h.version, claim: h.claim, refute_when: h.refute_when, scope: h.scope, status: h.status, selected: selected.has(h.id) })),
  observations: (state.materials ?? []).map(m => ({ ref: m.ref, note: m.note, source: m.source, digest: m.digest, step: m.step })),
  checks: (state.evidence ?? []).filter(e => e.evaluator !== 'independent').map(e => ({ hypothesis: e.hypothesis, verdict: e.verdict, basis: e.basis, refs: e.refs, authority: 'author-observation' })),
  exclusions: (state.anomalies ?? []).map(a => ({ id: a.id, what: a.what, status: a.status, reason: a.reason, by: a.by, matters: a.matters })),
  receipts,
 }
}
