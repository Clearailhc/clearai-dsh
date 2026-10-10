import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeAuditSchema, recoveredStructuredOutput } from '../preset/plugins/audit-schema.js'

test('native audit schema preserves enforceable constraints without unsupported length keywords', () => {
 const schema = nativeAuditSchema({ type: 'object', properties: { basis: {type:'string',maxLength:1200}, results: {type:'array',items:{type:'object',properties:{hypothesis:{type:'string',maxLength:80},verdict:{enum:['support','refute','inconclusive']}}}} }, required:['basis'], additionalProperties:false })
 assert.equal(JSON.stringify(schema).includes('maxLength'),false)
 assert.match(schema.properties.basis.description,/1200/)
 assert.deepEqual(schema.required,['basis']);assert.equal(schema.additionalProperties,false)
 assert.deepEqual(schema.properties.results.items.properties.verdict.enum,['support','refute','inconclusive'])
})

test('restart recovers successful structured tool output, never a rejected call or narrative', () => {
 const call={type:'tool/call',data:{callId:'one',name:'structured_output',arguments:'{"holds":"yes","results":[{"hypothesis":"h","verdict":"support"}]}'}}
 assert.equal(recoveredStructuredOutput([call,{type:'assistant/message',data:{message:{content:[{type:'text',text:'holds=yes'}]}}}]),undefined)
 assert.equal(recoveredStructuredOutput([call,{type:'tool/result',data:{message:{toolCallId:'one',isError:true}}}]),undefined)
 assert.equal(recoveredStructuredOutput([call,{type:'tool/result',data:{message:{toolCallId:'one',isError:false}}}]).results[0].verdict,'support')
})
import { mkdirSync, readFileSync, writeFileSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './tmp.mjs'
import { auditPathComponent, auditMaterialDigest, fileDigest, methodSnapshot } from '../preset/plugins/audit-material.js'
import { compareScope } from '../preset/plugins/scope.js'

test('Windows-safe bounded paths preserve every raw logical ID inside the card', () => {
	const cwd = tempDir('clearai-audit-path-')
	for (const id of ['goal:g1', 'normal', '../escape', 'a/b\\c', 'CON', 'NUL.', 'COM1 ', '尾空格 ', 'x'.repeat(500)]) {
		for (const auditor of ['child:1', '../NUL', 'PRN ', '审查者']) {
			const dir = join(cwd, auditPathComponent(id)); mkdirSync(dir, { recursive: true })
			const file = join(dir, `${auditPathComponent(auditor)}.json`)
			for (const holds of ['yes', 'no', 'unclear']) {
				writeFileSync(file, JSON.stringify({ step_id: id, auditor_run_id: auditor, holds }))
				assert.deepEqual(JSON.parse(readFileSync(file)), { step_id: id, auditor_run_id: auditor, holds })
			}
			assert.match(auditPathComponent(id), /^[a-f0-9]{64}$/)
		}
	}
})

test('fingerprint binds full answers, lessons, actual file content and meaning, excludes audit echoes', () => {
	const cwd = tempDir('clearai-audit-material-')
	writeFileSync(join(cwd, 'answer.txt'), 'value=2')
	const input = { cwd, kind: 'goal_audit', step: { id: 'goal:g', done_criteria: 'correct' }, plan: { steps: [{ id: 's', artifacts: ['answer.txt'] }] }, state: { goal: { id: 'g' }, hypotheses: [], evidence: [], lexicon: { terms: [{ id: 't', label: 'Title', gloss: 'meaning' }] } }, gate: { answers: [{ conclusion: '2', uses: [] }], lessons: [{ text: 'check instrument' }] } }
	const original = auditMaterialDigest(input)
	const changed = structuredClone(input); changed.gate.answers[0].conclusion = '20'
	assert.notEqual(auditMaterialDigest(changed), original)
	changed.gate.answers = input.gate.answers; changed.gate.lessons[0].text = 'skip checking'
	assert.notEqual(auditMaterialDigest(changed), original)
	const renamed = structuredClone(input); renamed.state.lexicon.terms[0].label = 'New title'; renamed.state.lexicon.terms[0].aliases = ['alias']
	assert.equal(auditMaterialDigest(renamed), original)
	renamed.state.lexicon.terms[0].gloss = 'different meaning'; assert.notEqual(auditMaterialDigest(renamed), original)
	const echo = structuredClone(input); echo.state.evidence.push({ id: 'audit-e', anchor: 'auditor', at: Date.now() }); echo.state.audits = [{ id: 'dispatch', at: Date.now() }]
	assert.equal(auditMaterialDigest(echo), original)
	const before = statSync(join(cwd, 'answer.txt')); writeFileSync(join(cwd, 'answer.txt'), 'value=9'); utimesSync(join(cwd, 'answer.txt'), before.atime, before.mtime)
	assert.notEqual(auditMaterialDigest(input), original)
	assert.equal(fileDigest(cwd, '../secrets'), 'outside-workspace')
})

test('fingerprint ignores duplicate observation metadata but binds content and the current plan', () => {
 const cwd=tempDir('clearai-audit-observation-')
 const plan={id:'p',steps:[{id:'s',done_criteria:'mean equals 2',artifacts:[]}]}
 const input={cwd,kind:'step_audit',step:plan.steps[0],plan,state:{plans:[plan],materials:[{id:'first',at:1,ref:'raw.json',note:'mean=2'}]},gate:{}}
 const original=auditMaterialDigest(input)
 assert.match(original,/^v5:/)
 input.state.materials.push({id:'second',at:2,ref:'raw.json',note:'mean=2'})
 assert.equal(auditMaterialDigest(input),original)
 input.state.materials[1].note='calibration pending'
 assert.notEqual(auditMaterialDigest(input),original)
 input.state.materials.pop()
 input.state.plans=[{...plan,steps:[{...plan.steps[0],done_criteria:'mean equals 3'}]}]
 assert.notEqual(auditMaterialDigest(input),original)
})

test('method digest notices script content changes even with equal size and mtime', () => {
	const cwd = tempDir('clearai-method-'); writeFileSync(join(cwd, 'spec.json'), '{}'); writeFileSync(join(cwd, 'calc.py'), 'print(2)')
	const spec = { command: 'python calc.py', scripts: ['calc.py'] }; const digest = methodSnapshot(cwd, spec, 'spec.json')
	const before = statSync(join(cwd, 'calc.py')); writeFileSync(join(cwd, 'calc.py'), 'print(6)'); utimesSync(join(cwd, 'calc.py'), before.atime, before.mtime)
	assert.notEqual(methodSnapshot(cwd, spec, 'spec.json'), digest)
})

test('scope uncertainty never becomes applicability or historical retraction', () => {
	const range = { ranges: { T: [10, 20] }, units: { T: '°C' } }
	assert.equal(compareScope(null, range).verdict, 'unscoped')
	assert.equal(compareScope({ note: 'normal operating conditions' }, range).verdict, 'undeclared')
	assert.equal(compareScope(range, { ranges: { T: [12, 15] } }).verdict, 'undeclared')
	assert.equal(compareScope(range, { ranges: { T: [12, 15] }, units: { T: 'K' } }).verdict, 'undeclared')
	assert.equal(compareScope(range, { ranges: { T: [18, 25] }, units: { T: '°C' } }).verdict, 'undeclared')
	assert.equal(compareScope(range, { ranges: { T: [21, 25] }, units: { T: '°C' } }).verdict, 'out_of_range')
	assert.equal(compareScope(range, { ranges: { T: [12, 15] }, units: { T: '°C' } }).verdict, 'applies')
})
