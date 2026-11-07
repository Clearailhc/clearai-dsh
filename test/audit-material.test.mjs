import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeAuditSchema, recoveredStructuredOutput, bindAuditCriteria } from '../preset/plugins/audit-schema.js'

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
	const input = { cwd, kind: 'goal_audit', step: { id: 'goal:g', done_criteria: 'correct', artifacts: ['answer.txt'] }, plan: { steps: [{ id: 's', artifacts: ['answer.txt'] }] }, state: { goal: { id: 'g' }, hypotheses: [], evidence: [], lexicon: { terms: [{ id: 't', label: 'Title', gloss: 'meaning' }] } }, gate: { answers: [{ conclusion: '2', uses: [] }], lessons: [{ text: 'check instrument' }] } }
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
 writeFileSync(join(cwd, 'raw.json'), '{}')
 const plan={id:'p',steps:[{id:'s',done_criteria:'mean equals 2',artifacts:[]}]}
 const input={cwd,kind:'step_audit',step:plan.steps[0],plan,state:{plans:[plan],materials:[{id:'first',at:1,ref:'raw.json',note:'mean=2'}]},gate:{}}
 const original=auditMaterialDigest(input)
 assert.match(original,/^v6:/)
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

test('audit criterion protocol rejects the observed invented C1 sub-identities before settlement', () => {
 const generic = { type:'object', properties:{ criteria:{type:'array',items:{type:'object',properties:{criterion:{type:'string'},result:{enum:['pass','fail','not_applicable']}},required:['criterion','result']}}} }
 const bound = nativeAuditSchema(bindAuditCriteria(generic,[{id:'C1',text:'original compound criterion'}]))
 assert.deepEqual(bound.properties.criteria.items.properties.criterion.enum,['C1'])
 for(const observed of ['C1(1) 原始值均值','C1(2) 独立复跑','C2','C1 original compound criterion']) assert.equal(bound.properties.criteria.items.properties.criterion.enum.includes(observed),false)
 assert.deepEqual(bound.properties.criteria.items.properties.result.enum,['pass','fail','not_applicable'])
 assert.equal(generic.properties.criteria.items.properties.criterion.enum,undefined)
 assert.throws(()=>bindAuditCriteria(generic,[]))
 assert.throws(()=>bindAuditCriteria(generic,[{id:'C1'},{id:'C1'}]))
})

import { researchSnapshot, researchHandoff, partialReviewClaims, reviewDelta, reviewObligation, REVIEW_POLICY } from '../preset/plugins/research-contract.js'
import { pendingKnowledgeClaims, coveredClaimVerdict } from '../preset/plugins/research-contract.js'

test('pending knowledge is current-goal independent support, never an unrelated or superseded lead', () => {
 const hypotheses=['held','saved','self','later','refuted','old','retired','new'].map(id=>({id,goal:id==='old'?'previous':'current',status:id==='retired'?'superseded':'alive',refutations:id==='refuted'?1:0}))
 const evidence=hypotheses.filter(h=>h.id!=='new').map(h=>({hypothesis:h.id,evaluator:h.id==='self'?'self':'independent',verdict:'support'}))
 evidence.push({hypothesis:'later',evaluator:'independent',verdict:'inconclusive'})
 const state={goal:{id:'current',conditions:{batch:'one'}},hypotheses,evidence,facts:[{hypothesis:'saved'}]}
 assert.deepEqual(pendingKnowledgeClaims(state),['held'])
 const handoff=researchHandoff({...state,hypotheses:[{...hypotheses[0],scope:{ranges:{x:[0,1]}},assertions:[{predicate:'measured'}]}]},{tests:{hypotheses:['held']}})
 assert.deepEqual(handoff.claims[0].scope,{conditions:{batch:'one'},ranges:{x:[0,1]}})
 assert.deepEqual(handoff.claims[0].assertions,[{predicate:'measured'}])
 for(const coverage of [undefined,null,'narrower','unknown'])assert.equal(coveredClaimVerdict('support',coverage),'inconclusive')
 assert.equal(coveredClaimVerdict('support','full'),'support');assert.equal(coveredClaimVerdict('refute','full'),'refute')
})

test('native review schema binds exact claim identities and count without changing criteria', () => {
 const schema={properties:{criteria:{items:{properties:{criterion:{}}}},results:{items:{properties:{hypothesis:{}}}}}}
 const bound=bindAuditCriteria(schema,[{id:'C1'}],['h1','h2'])
 assert.deepEqual(bound.properties.results.items.properties.hypothesis.enum,['h1','h2'])
 assert.equal(bound.properties.results.minItems,2);assert.equal(bound.properties.results.maxItems,2)
 assert.equal(bindAuditCriteria(schema,[{id:'C1'}],[]).properties.results.maxItems,0)
 const native=nativeAuditSchema(bound);assert.equal(native.properties.results.minItems,undefined);assert.equal(native.properties.results.maxItems,undefined);assert.match(native.properties.results.description,/item count 2–2/)
 assert.throws(()=>bindAuditCriteria(schema,[{id:'C1'}],['h1','h1']))
})

test('partial certification requires independent bounded impact and preserves ontology obligations', () => {
 const results = [{hypothesis:'safe',verdict:'support',independent_of_open_issues:true},{hypothesis:'affected',verdict:'support',independent_of_open_issues:true}]
 const issue = {status:'open',by:'evaluator',matters:'yes',touches:['affected'],impact_basis:'Original observations prove the recommendation independent of this noise explanation.'}
 assert.deepEqual([...partialReviewClaims(results,[issue],['safe','affected'])],['safe'])
 for(const change of [{touches:null},{touches:[]},{touches:['unknown']},{by:'model'},{impact_basis:''}]) assert.equal(partialReviewClaims(results,[{...issue,...change}],['safe','affected']).size,0)
 assert.equal(partialReviewClaims([{...results[0],independent_of_open_issues:false}],[issue],['safe','affected']).size,0)
 assert.equal(partialReviewClaims([{...results[0],verdict:'inconclusive'}],[],['safe']).size,0)
})

test('review differences expose added counterevidence, changed methods and removed sources without certifying applicability', () => {
 const delta=reviewDelta({files:[['raw','1'],['method','2'],['removed','3']],unbounded:[]},{files:[['raw','1'],['method','4'],['counterexample','5']],unbounded:[]})
 assert.deepEqual(delta.changed,['method']);assert.deepEqual(delta.added,['counterexample']);assert.deepEqual(delta.removed,['removed']);assert.equal(delta.unchanged,1)
 assert.match(delta.authority,/requires independent review/)
 assert.equal(reviewDelta(null,{files:[]}).complete,false)
 assert.equal(reviewDelta({files:[],unbounded:['venv']},{files:[]}).complete,false)
})
import { readEvidence } from '../preset/plugins/read-evidence.js'

test('native fingerprints ignore unrelated hypotheses and UI echoes but bind evidence, scope, criteria and trust', () => {
 const cwd=tempDir('clearai-native-digest-');writeFileSync(join(cwd,'source.txt'),'one\ntwo\n')
 const input={cwd,kind:'claim_audit',step:{id:'review:h1',done_criteria:'Check value',artifacts:['source.txt'],tests:{hypotheses:['h1'],level:'L3'}},state:{goal:{id:'g',workflow:'agent-v1',done_criteria:'correct',conditions:{batch:1}},hypotheses:[{id:'h1',claim:'value=1'},{id:'h2',claim:'other'}],plans:[]},gate:{confirmed:[],trust:{model:'test'}}}
 const original=auditMaterialDigest(input);assert.match(original,/^v7:/)
 input.state.hypotheses[1].claim='unrelated revision';input.state.plans.push({id:'other',steps:[{id:'new'}]});input.state.audits=[{id:'ui'}]
 assert.equal(auditMaterialDigest(input),original)
 input.gate.trust.model='other';assert.notEqual(auditMaterialDigest(input),original);input.gate.trust.model='test'
 input.state.goal.conditions.batch=2;assert.notEqual(auditMaterialDigest(input),original);input.state.goal.conditions.batch=1
 input.step.done_criteria='different';assert.notEqual(auditMaterialDigest(input),original);input.step.done_criteria='Check value'
 writeFileSync(join(cwd,'counterexample.txt'),'value differs')
 assert.notEqual(auditMaterialDigest(input),original,'undeclared evidence cannot be excluded by author claims')
 assert.equal(researchSnapshot(cwd).files.length,2)
})

test('public handoff preserves contrary observations and labels author checks',()=>{
 const handoff=researchHandoff({hypotheses:[{id:'unused',claim:'alternative'}],materials:[{ref:'negative.txt',note:'failure',source:'self'}],evidence:[{verdict:'support',evaluator:'self'}],anomalies:[{id:'a',status:'ruled_out',reason:'author exclusion'}]}, {tests:{hypotheses:[]}})
 assert.equal(handoff.claims[0].selected,false);assert.equal(handoff.observations[0].note,'failure')
 assert.equal(handoff.checks[0].authority,'author-observation');assert.equal(handoff.exclusions[0].reason,'author exclusion')
})

test('batched evidence reads preserve citation lines, reject traversal and bound payloads',()=>{
 const cwd=tempDir('clearai-evidence-batch-');writeFileSync(join(cwd,'source.txt'),'first\nsecond\nthird')
 const rows=readEvidence(cwd,[{path:'source.txt',line:2,count:1},{path:'../secret'},{path:'source.txt',line:99}])
 assert.equal(rows[0].text,'2: second');assert.equal(rows[0].digest,fileDigest(cwd,'source.txt'))
 assert.ok(rows[1].error);assert.ok(rows[2].error)
 assert.throws(()=>readEvidence(cwd,Array(9).fill({path:'source.txt'})))
})


test('review obligations separate current work from final completion without waiving dependencies', () => {
 const state={goal:{id:'g',claim:'Report temperature',done_criteria:'submission.json contains measured temperature'}}
 const step={done_criteria:'Reference equals 900 C',tests:{hypotheses:['h1']}}
 for(const kind of ['claim_audit','evidence_audit']){
  const obligation=reviewObligation(state,step,kind)
  assert.equal(obligation.scope,'selected-work');assert.equal(obligation.final_delivery_required_now,false)
  assert.equal(obligation.goal_context.done_criteria,state.goal.done_criteria)
  assert.deepEqual(obligation.claims,['h1']);assert.equal(obligation.criteria,step.done_criteria)
 }
 const final=reviewObligation(state,step,'goal_audit')
 assert.equal(final.scope,'final-delivery');assert.equal(final.final_delivery_required_now,true)
 assert.equal(final.policy,REVIEW_POLICY)
})

test('handoff preserves contrary independent history beside author support without manufacturing current proof', () => {
 const state={hypotheses:[{id:'h1'}],evidence:[
  {hypothesis:'h1',verdict:'support',evaluator:'self',basis:'initial reading'},
  {hypothesis:'h1',verdict:'refute',evaluator:'independent',basis:'counterexample',refs:['raw.txt:1']},
  {hypothesis:'h1',verdict:'support',evaluator:'self',basis:'author repeats claim'},
  {hypothesis:'h2',verdict:'support',evaluator:'independent',basis:'positive finding already covered by receipts'},
 ]}
 const original=structuredClone(state),handoff=researchHandoff(state,{tests:{hypotheses:['h1']}})
 assert.equal(handoff.checks.length,2);assert.equal(handoff.independent_counterevidence.length,1)
 assert.equal(handoff.independent_counterevidence[0].verdict,'refute')
 assert.match(handoff.independent_counterevidence[0].authority,/historical.*applicability/)
 assert.deepEqual(handoff.receipts,[]);assert.deepEqual(state,original)
})


test('legacy review reuse also invalidates changed evaluator trust or policy', () => {
 const cwd=tempDir('clearai-legacy-review-policy-');writeFileSync(join(cwd,'raw.txt'),'value=1')
 const input={cwd,kind:'evidence_audit',step:{id:'s1',done_criteria:'value equals 1',artifacts:['raw.txt']},state:{goal:{id:'g',workflow:'steps-v1'}},gate:{trust:{model:'same',policy:'clearai.review.v1'}}}
 const original=auditMaterialDigest(input)
 assert.equal(auditMaterialDigest(structuredClone(input)),original)
 for(const field of ['model','policy','discipline','presetSource','l4Human']){
  const changed=structuredClone(input);changed.gate.trust[field]='changed'
  assert.notEqual(auditMaterialDigest(changed),original,field)
 }
})
