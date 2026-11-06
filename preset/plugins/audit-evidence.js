import { readFileSync } from 'node:fs'
import { workspacePath } from './workspace-path.js'
import { contentDigest, fileDigest } from './audit-material.js'

export const auditCriteria = value => String(value ?? '').split(/\r?\n/).map(row => row.trim()).filter(Boolean).map((text, index) => ({ id: `C${index + 1}`, text }))

// A resolvable citation binds bytes, not truth, source independence or causality.
export function validateAuditEvidence(cwd, verdict, criteria) {
	if (verdict.holds !== 'yes' && !(verdict.results ?? []).some(row => row.verdict === 'support')) return verdict
	const refs = [], errors = []
	for (const ref of verdict.refs ?? []) {
		try {
			const path = workspacePath(cwd, ref.path, { mustExist: true })
			const bytes = readFileSync(path.absolute)
			const lines = bytes.toString('utf8').split(/\r?\n/).length
			if (!Number.isInteger(ref.line) || ref.line < 1 || ref.line > lines) throw new Error('invalid-line')
			refs.push({ path: path.relative, line: ref.line, digest: contentDigest(bytes) })
		} catch { errors.push(`audit_reference_invalid:${ref.path}`) }
	}
	if (!refs.length) errors.push('audit_references_required')
	const rows = verdict.criteria ?? []
	for (const criterion of criteria) {
		const matches = rows.filter(row => row.criterion === criterion.id)
		if (matches.length !== 1 || !['pass', 'fail', 'not_applicable'].includes(matches[0].result) || !matches[0].basis?.trim()) errors.push(`audit_criterion_missing:${criterion.id}`)
		else if (verdict.holds === 'yes' && matches[0].result !== 'pass') errors.push(`audit_criterion_not_passed:${criterion.id}`)
	}
	if (!criteria.length || rows.some(row => !criteria.some(item => item.id === row.criterion))) errors.push('audit_criteria_invalid')
	return errors.length ? { ...verdict, holds: 'unknown', results: [], shortfalls: [...(verdict.shortfalls ?? []), ...errors] } : { ...verdict, refs }
}

export const citationsUnchanged = (cwd, refs) => Array.isArray(refs) && refs.length > 0 && refs.every(ref => /^[a-f0-9]{64}$/.test(ref.digest ?? '') && fileDigest(cwd, ref.path) === ref.digest)
