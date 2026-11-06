import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { integrityStore } from '../preset/plugins/integrity.js'
import { workspacePath } from '../preset/plugins/workspace-path.js'
import { auditMaterialDigest } from '../preset/plugins/audit-material.js'
import { validateAuditEvidence, auditCriteria, citationsUnchanged } from '../preset/plugins/audit-evidence.js'
import { createRerunCopy } from '../preset/plugins/rerun-copy.js'

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'clearai-integrity-test-')), cwd = join(root, 'workspace'), home = join(root, 'host')
	mkdirSync(cwd); t.after(() => rmSync(root, { recursive: true, force: true }))
	return { root, cwd, home, store: integrityStore(cwd, home) }
}

test('receipts survive restart, accept another kernel and detect equal-size edits without trusting metadata', t => {
	const { cwd, home, store } = fixture(t), path = 'clear/knowledge/facts/a.json'
	store.write(path, '{"value":1}', { session: 'a', event: 'promoted:1' })
	const other = integrityStore(cwd, home)
	assert.deepEqual(other.check(), [])
	other.write(path, '{"value":2}', { session: 'b', event: 'reviewed:2' })
	assert.deepEqual(store.check(), [])
	const file = join(cwd, path), stat = statSync(file)
	writeFileSync(file, '{"value":9}'); utimesSync(file, stat.atime, stat.mtime)
	assert.equal(store.check()[0].code, 'modified')
	assert.throws(() => other.write(path, '{}', { session: 'b', event: 'overwrite' }), /integrity-modified/)
	assert.equal(readFileSync(file, 'utf8'), '{"value":9}')
	rmSync(file); assert.equal(store.check()[0].code, 'removed')
})

test('real Node, Python and shell writes remain observable as unregistered evidence', t => {
	const { cwd, store } = fixture(t)
	mkdirSync(join(cwd, 'clear/evidence'), { recursive: true })
	execFileSync(process.execPath, ['-e', "require('fs').writeFileSync('clear/evidence/node.json','{}')"], { cwd })
	if (process.platform !== 'win32') {
		execFileSync('python3', ['-c', "open('clear/evidence/python.json','w').write('{}')"], { cwd })
		execFileSync('bash', ['-c', 'p=clear; echo "{}" > "$p/evidence/shell.json"'], { cwd })
	}
	assert.equal(store.check().length, process.platform === 'win32' ? 1 : 3)
	assert(store.check().every(row => row.code === 'unregistered'))
	assert.throws(() => store.write('clear/evidence/node.json', 'new', { session: 'x', event: 'x' }), /unregistered/)
})

test('canonical references bind absolute inputs and reject outside/symlink paths', t => {
	const { root, cwd } = fixture(t), file = join(cwd, 'result.txt')
	writeFileSync(file, 'WRONG')
	assert.equal(workspacePath(cwd, file).relative, 'result.txt')
	assert.throws(() => workspacePath(cwd, '../secret'), /outside-workspace/)
	const input = { cwd, kind: 'audit', step: { id: 's', artifacts: [file] }, state: {}, gate: {} }
	const first = auditMaterialDigest(input)
	writeFileSync(file, 'VALID'); assert.notEqual(auditMaterialDigest(input), first)
	rmSync(file); const errors = []; assert.equal(auditMaterialDigest({ ...input, errors }), null); assert(errors.length)
	writeFileSync(join(root, 'secret'), 'secret')
	try { symlinkSync(root, join(cwd, 'escape'), 'junction') } catch (error) { if (error.code === 'EPERM') return t.diagnostic('Symlink creation unavailable on this runner'); throw error }
	assert.throws(() => workspacePath(cwd, 'escape/secret'), /outside-workspace/)
	assert.throws(() => workspacePath(cwd, 'escape/future'), /outside-workspace/)
})

test('positive audits require every criterion and usable citations; changed citations invalidate reuse', t => {
	const { cwd } = fixture(t)
	writeFileSync(join(cwd, 'evidence.txt'), 'measured=2\n')
	const criteria = auditCriteria('measurement exists\nmeasurement equals 2')
	const positive = { holds: 'yes', results: [], refs: [{ path: 'evidence.txt', line: 1 }], criteria: criteria.map(row => ({ criterion: row.id, result: 'pass', basis: 'evidence.txt:1 measured=2' })) }
	const verified = validateAuditEvidence(cwd, positive, criteria)
	assert.equal(verified.holds, 'yes'); assert(citationsUnchanged(cwd, verified.refs))
	assert.equal(validateAuditEvidence(cwd, { ...positive, refs: [] }, criteria).holds, 'unknown')
	assert.equal(validateAuditEvidence(cwd, { ...positive, criteria: positive.criteria.slice(1) }, criteria).holds, 'unknown')
	assert.equal(validateAuditEvidence(cwd, { ...positive, refs: [{ path: 'evidence.txt', line: 999 }] }, criteria).holds, 'unknown')
	writeFileSync(join(cwd, 'evidence.txt'), 'measured=9\n'); assert(!citationsUnchanged(cwd, verified.refs))
})

test('asynchronous snapshots exclude nested dependencies and refuse omitted required inputs', async t => {
	const { root, cwd } = fixture(t)
	for (const dir of ['source', 'pkg/node_modules', '.venv', '.git']) { mkdirSync(join(cwd, dir), { recursive: true }); writeFileSync(join(cwd, dir, 'input.txt'), 'input') }
	const good = await createRerunCopy(cwd, join(root, 'copy'), { required: ['source/input.txt'] })
	assert.equal(good.status, 'ready'); assert.equal(good.files, 1); assert.equal(good.bytes, 5)
	const bad = await createRerunCopy(cwd, join(root, 'bad'), { required: ['pkg/node_modules/input.txt'] })
	assert.equal(bad.directory, null); assert.match(bad.error, /required-input-excluded/)
	const controller = new AbortController(); controller.abort()
	assert.equal((await createRerunCopy(cwd, join(root, 'cancelled'), { signal: controller.signal })).status, 'cancelled')
})

test('snapshot inside workspace is accessible without recursively copying itself or deleting an existing target', async t => {
 const {cwd} = fixture(t);mkdirSync(join(cwd,'.clearai-reruns'),{recursive:true});writeFileSync(join(cwd,'input.txt'),'abc');const target=join(cwd,'.clearai-reruns','one');
 const copy=await createRerunCopy(cwd,target,{required:['input.txt']});assert.equal(copy.status,'ready');assert.equal(copy.files,1);assert.equal(readFileSync(join(target,'input.txt'),'utf8'),'abc');
 const duplicate=await createRerunCopy(cwd,target);assert.equal(duplicate.status,'unavailable');assert.equal(readFileSync(join(target,'input.txt'),'utf8'),'abc')
})
