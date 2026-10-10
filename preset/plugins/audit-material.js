import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

// Both logical identifiers are opaque. No characters from either reach a path.
export const auditPathComponent = (id) => createHash('sha256').update(String(id)).digest('hex')

export function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical)
	if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]))
	return value
}
export const contentDigest = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex')

// Missing/unreadable inputs are material too. Only workspace-relative references
// are inspected; hashing must not create a new privilege or disclose file bytes.
export function fileDigest(cwd, path) {
	if (!cwd || typeof path !== 'string' || isAbsolute(path)) return 'unavailable'
	const file = resolve(cwd, path)
	const rel = relative(cwd, file)
	if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) return 'outside-workspace'
	try { return contentDigest(readFileSync(file)) } catch { return 'missing-or-unreadable' }
}

export function methodSnapshot(cwd, spec, registration) {
	const scripts = new Set(spec?.scripts ?? [])
	// Declared scripts are preferred; ordinary command file operands also count.
	for (const word of String(spec?.command ?? '').match(/[^\s"'`;|&<>]+/g) ?? []) {
		if (/\.(?:[cm]?js|py|sh|r|R)$/.test(word)) scripts.add(word)
	}
	return contentDigest({ registration: fileDigest(cwd, registration), command: spec?.command, scripts: [...scripts].sort().map((path) => [path, fileDigest(cwd, path)]) })
}

export function auditMaterialDigest({ kind, step, plan, state, gate, cwd, teamTasks = [] }) {
	const currentPlan = (state.plans ?? []).find((row) => row.id === plan?.id) ?? plan
	const modelIds = new Set((state.hypotheses ?? []).map((row) => row.use).filter(Boolean))
	const refs = new Set((state.hypotheses ?? []).flatMap((row) => (row.uses ?? []).map((use) => typeof use === 'string' ? use : use.id)))
	for (const answer of gate.answers ?? []) for (const id of answer.uses ?? []) refs.add(id)
	const files = state.workspace?.files ?? {}
	const knowledge = Object.entries(files).filter(([, file]) => refs.has(file?.data?.id)).map(([path, file]) => {
		if (file?.data?.use) modelIds.add(file.data.use)
		return [path, fileDigest(cwd, path)]
	})
	const paths = new Set((currentPlan?.steps ?? []).flatMap((row) => row.artifacts ?? []))
	for (const row of gate.confirmed ?? []) if (!/^(?:evidence|hypothesis):/.test(row.ref)) paths.add(row.ref)
	for (const row of state.materials ?? []) for (const path of [row.path, row.ref, ...(row.refs ?? [])]) if (typeof path === 'string' && !path.includes(':')) paths.add(path)
	const methods = [...modelIds].sort().map((id) => {
		const path = `clear/models/${id}.json`
		let spec = null
		try { spec = JSON.parse(readFileSync(resolve(cwd, path), 'utf8')) } catch {}
		return [id, methodSnapshot(cwd, spec, path), (spec?.inputs ?? []).map((input) => [input, fileDigest(cwd, input)]), spec?.output ? fileDigest(cwd, spec.output) : null]
	})
	const semantic = (entry) => Object.fromEntries(['id', 'gloss', 'parent', 'kind', 'unit', 'domain', 'range', 'functional', 'shape', 'check', 'type', 'relations', 'status', 'replaced_by'].filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]]))
	const lexicon = state.lexicon ?? {}
	const definitions = ['terms', 'predicates', 'entities'].flatMap((key) => (lexicon[key] ?? []).map(semantic))
	const anomalies = [...(state.anomalies ?? []), ...(gate.anomalies ?? [])].filter((row) => row.by !== 'evaluator' || row.status !== 'open').map((row) => ({ id: row.id, what: row.what, status: row.status, reason: row.reason, explainedBy: row.explainedBy }))
	const materials = [...new Set((state.materials ?? []).map(({ id, at, ...row }) => JSON.stringify(canonical(row))))].sort().map((row) => JSON.parse(row))
	return `v6:${contentDigest({ teamTasks, kind, step: step.id, criteria: step.done_criteria, goal: state.goal, steps: currentPlan?.steps, answers: gate.answers, lessons: gate.lessons, extra: gate.extra, hypotheses: (state.hypotheses ?? []).map(({ supportedLevel, refutations, inconclusive, ...row }) => row), facts: state.facts, evidence: (state.evidence ?? []).filter((row) => row.anchor !== 'auditor'), materials, anomalies, definitions, knowledge, methods, artifacts: [...paths].sort().map((path) => [path, fileDigest(cwd, path)]) })}`
}
