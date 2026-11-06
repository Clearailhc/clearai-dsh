import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { workspacePath } from './workspace-path.js'

// Both logical identifiers are opaque. No characters from either reach a path.
export const auditPathComponent = (id) => createHash('sha256').update(String(id)).digest('hex')

export function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical)
	if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]))
	return value
}
export const contentDigest = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex')

// Error values are diagnostic only; auditMaterialDigest never caches them.
export function fileDigest(cwd, path) {
 try { return contentDigest(readFileSync(workspacePath(cwd, path, { mustExist: true }).absolute)) }
 catch (error) { return error.code === 'outside-workspace' ? 'outside-workspace' : 'missing-or-unreadable' }
}

export function methodSnapshot(cwd, spec, registration, digest = fileDigest) {
	const scripts = new Set(spec?.scripts ?? [])
	// Declared scripts are preferred; ordinary command file operands also count.
	for (const word of String(spec?.command ?? '').match(/[^\s"'`;|&<>]+/g) ?? []) {
		if (/\.(?:[cm]?js|py|sh|r|R)$/.test(word)) scripts.add(word)
	}
	return contentDigest({ registration: digest(cwd, registration), command: spec?.command, scripts: [...scripts].sort().map((path) => [path, digest(cwd, path)]) })
}

export function auditMaterialDigest({ kind, step, plan, state, gate, cwd, errors = [] }) {
 const digest = (root, path) => {
  const value = fileDigest(root, path)
  if (!/^[a-f0-9]{64}$/.test(value)) errors.push({ path, code: value })
  return value
 }
 const canonicalPath = path => { try { return workspacePath(cwd, path).relative } catch { return path } }

	const currentPlan = (state.plans ?? []).find((row) => row.id === plan?.id) ?? plan
	const modelIds = new Set((state.hypotheses ?? []).map((row) => row.use).filter(Boolean))
	const refs = new Set((state.hypotheses ?? []).flatMap((row) => (row.uses ?? []).map((use) => typeof use === 'string' ? use : use.id)))
	for (const answer of gate.answers ?? []) for (const id of answer.uses ?? []) refs.add(id)
	const files = state.workspace?.files ?? {}
	const knowledge = Object.entries(files).filter(([, file]) => refs.has(file?.data?.id)).map(([path, file]) => {
		if (file?.data?.use) modelIds.add(file.data.use)
		return [path, digest(cwd, path)]
	})
	const paths = new Set(step.artifacts ?? [])
	for (const row of gate.confirmed ?? []) if (!/^(?:evidence|hypothesis):/.test(row.ref)) paths.add(row.ref)
	for (const row of state.materials ?? []) for (const path of [row.path, row.ref, ...(row.refs ?? [])]) if (typeof path === 'string' && !/^(?:evidence|hypothesis):/.test(path)) paths.add(path)
	const methods = [...modelIds].sort().map((id) => {
		const path = `clear/models/${id}.json`
		let spec = null
		try { spec = JSON.parse(readFileSync(resolve(cwd, path), 'utf8')) } catch {}
		return [id, methodSnapshot(cwd, spec, path, digest), (spec?.inputs ?? []).map((input) => [input, digest(cwd, input)]), spec?.output ? digest(cwd, spec.output) : null]
	})
	const semantic = (entry) => Object.fromEntries(['id', 'gloss', 'parent', 'kind', 'unit', 'domain', 'range', 'functional', 'shape', 'check', 'type', 'relations', 'status', 'replaced_by'].filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]]))
	const lexicon = state.lexicon ?? {}
	const definitions = ['terms', 'predicates', 'entities'].flatMap((key) => (lexicon[key] ?? []).map(semantic))
	const anomalies = [...(state.anomalies ?? []), ...(gate.anomalies ?? [])].filter((row) => row.by !== 'evaluator' || row.status !== 'open').map((row) => ({ id: row.id, what: row.what, status: row.status, reason: row.reason, explainedBy: row.explainedBy }))
	const materials = [...new Set((state.materials ?? []).map(({ id, at, ...row }) => JSON.stringify(canonical(row))))].sort().map((row) => JSON.parse(row))
	const fingerprint = contentDigest({ kind, step: step.id, criteria: step.done_criteria, goal: state.goal, steps: currentPlan?.steps, answers: gate.answers, lessons: gate.lessons, extra: gate.extra, hypotheses: (state.hypotheses ?? []).map(({ supportedLevel, refutations, inconclusive, ...row }) => row), facts: state.facts, evidence: (state.evidence ?? []).filter((row) => row.anchor !== 'auditor'), materials, anomalies, definitions, knowledge, methods, artifacts: [...new Set([...paths].map(canonicalPath))].sort().map((path) => [path, digest(cwd, path)]) })
 return errors.length ? null : `v6:${fingerprint}`
}

export function auditRerunInputs(cwd, state, step) {
 const paths = new Set(step.artifacts ?? [])
 for (const id of new Set((state.hypotheses ?? []).map(row => row.use).filter(Boolean))) {
  const path = `clear/models/${id}.json`;paths.add(path)
  const spec = JSON.parse(readFileSync(workspacePath(cwd,path,{mustExist:true}).absolute,'utf8'))
  for (const value of [...(spec.inputs ?? []), ...(spec.scripts ?? []), spec.output].filter(Boolean)) paths.add(value)
  for (const word of String(spec.command ?? '').match(/[^\s"'`;|&<>]+/g) ?? []) if (/\.(?:[cm]?js|py|sh|r|R)$/.test(word)) paths.add(word)
 }
 return [...paths]
}
