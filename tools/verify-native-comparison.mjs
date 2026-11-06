/** Verify completed or failed native-workflow trials without changing their outcomes. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {usageSummary} from './native-headless/accounting.mjs'
import {makeWorld,score} from './native-headless/world.mjs'
import {PRICE} from './native-headless/budget.mjs'
const root=resolve(process.argv[2]||''),json=path=>JSON.parse(readFileSync(join(root,path)))
const manifest=json('manifest.json'), comparison=json('comparison.json')
assert.equal(manifest.schema,'clearai.native-comparison.v1');assert.equal(comparison.complete,true)
assert.equal(comparison.results.length,14);assert.equal(manifest.rows.length,14)
const truth=json('grading-truth.json');assert.equal(truth.disclosedAfterAllWorkersExited,true)
const key=Buffer.from(truth.worldKey,'hex')
assert.equal(createHash('sha256').update(key).digest('hex'),manifest.worldKeyCommitment)
const rows=[],stopReasons=[]
for(const [index,row] of comparison.results.entries()) {
 const expectedRow=manifest.rows[index]
 for(const field of ['phase','task','group','mode'])assert.equal(row[field],expectedRow[field])
 if(row.reason==='not_run') {assert.ok(row.blockedByInitial===true || ['candidate_implementation_error','superseded_candidate'].includes(row.stop?.reason));stopReasons.push(`${row.id}: ${row.stop?.reason ?? 'prerequisite failed'}`);continue}
 const result=json(`runs/${row.id}/launcher-result.json`)
 assert.equal(result.reason,row.reason);assert.equal(result.usage.status,'verified')
 assert.equal(result.installation.packageDigest,manifest.candidateDigest);assert.deepEqual(result.model,manifest.model)
 assert.equal(result.mount.prompt,row.group==='C');assert.equal(result.mount.tools,row.group==='C')
 assert.ok(Object.values(result.violations).every(v=>v===false));assert.equal(json(`runs/${row.id}/isolation-probe.json`).passed,true)
 const calls=readFileSync(join(root,`runs/${row.id}/llm-calls.jsonl`),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
 assert.deepEqual(usageSummary(calls),row.usage)
 const auditorIds=new Set((result.clearai?.audits??[]).map(a=>a.child).filter(Boolean))
 for(const c of calls) {
  assert.ok(['main','evaluator','explorer','other'].includes(c.role))
  if(c.role==='main')assert.equal(c.session,result.session)
  if(c.role==='evaluator')assert.ok(auditorIds.has(c.session))
  if(c.role==='explorer')assert.ok(!auditorIds.has(c.session))
 }
 for(const [role,reported] of Object.entries(row.roles)) {
  const relevant=calls.filter(c=>c.role===role),usage=usageSummary(relevant)
  assert.equal(reported.calls,relevant.length);assert.equal(reported.processed,usage.processed)
  const cost=relevant.reduce((n,c)=>{const u=c.usage;return n+((u.inputTokens??0)+(u.cacheWriteTokens??0))*PRICE.input/1e6+(u.cacheReadTokens??0)*PRICE.cached/1e6+(u.outputTokens??0)*PRICE.output/1e6},0)
  assert.ok(Math.abs(cost-reported.costUpperBoundUsd)<1e-9)
 }
 let parentRequestsWhileWaiting=0
 for(const child of auditorIds){const childCalls=calls.filter(c=>c.session===child);if(!childCalls.length)continue;const start=Math.min(...childCalls.map(c=>c.started)),end=Math.max(...childCalls.map(c=>c.finished));parentRequestsWhileWaiting+=calls.filter(c=>c.role==='main'&&c.started>start&&c.started<end).length}
 assert.equal(parentRequestsWhileWaiting,0)
 const world=makeWorld(key,'native-060-'+row.task,row.task),limit=row.phase==='changed'?.08:.115
 const expected=row.task==='direct'?{score:row.reason==='completed'&&row.submission?.amount===391&&row.submission?.unit==='元'?100:0}:score(world,row.reason==='completed'?row.submission:null,{limit})
 assert.deepEqual(row.quality,expected)
 const artifactQuality=row.task==='direct'?expected:score(world,row.submission,{limit})
 if(row.reason!=='completed')stopReasons.push(`${row.id}: ${row.reason}`)
 if(row.task!=='direct'&&(!expected.feasible||expected.score<=0))stopReasons.push(`${row.id}: infeasible or no useful improvement`)
 if(row.task==='direct'&&expected.score!==100)stopReasons.push(`${row.id}: incorrect amount`)
 if(row.group==='C'&&row.task!=='direct'&&row.goalStatus!=='achieved')stopReasons.push(`${row.id}: goal not achieved`)
 const snapshot=resolve(root,row.snapshot)
 assert.ok(snapshot.startsWith(root+'/'))
 for(const path of row.submission?.evidence??[]){const absolute=resolve(snapshot,path);assert.ok(absolute.startsWith(snapshot+'/'));assert.ok(existsSync(absolute)&&readFileSync(absolute).length>0)}
 rows.push({id:row.id,reason:row.reason,quality:expected,artifactQuality,processed:row.usage.processed,elapsedMs:row.elapsedMs,cost:row.costUpperBoundUsd,independentAudits:row.audits.length,parentRequestsWhileWaiting})
}
const reuse=[]
for(const task of ['additive','interaction'])for(const phase of ['initial','reuse','changed']){
 const pair=comparison.results.filter(r=>r.task===task&&r.phase===phase)
 if(pair.some(r=>r.reason==='not_run'))continue
 assert.equal(pair.length,2);assert.equal(pair[0].initialSha256,pair[1].initialSha256)
 const a=pair.find(r=>r.group==='A'),c=pair.find(r=>r.group==='C'),noise=makeWorld(key,'native-060-'+task,task).noise
 if(c.quality.feasible&&a.quality.feasible&&c.quality.value+2*noise<a.quality.value)stopReasons.push(`${task}/${phase}: below preregistered quality tolerance`)
 if(phase==='initial'&&!c.knowledgeFacts.length)stopReasons.push(`${task}: no reusable verified knowledge`)
 if(phase==='reuse'){
  const initial=comparison.results.find(r=>r.task===task&&r.group==='C'&&r.phase==='initial')
  const verifiedUse=c.answers.some(answer=>(answer.uses_review??[]).some(use=>use.confirmed))
  const benefit=c.usage.processed<initial.usage.processed||c.costUpperBoundUsd<initial.costUpperBoundUsd||c.experimentCost<initial.experimentCost
  reuse.push({task,verifiedUse,measuredBenefit:benefit})
  if(!verifiedUse||!benefit)stopReasons.push(`${task}: verified reuse benefit not demonstrated`)
 }
 if(phase==='changed'&&!c.audits.some(a=>a.holds==='yes'))stopReasons.push(`${task}: changed conditions lack independent review`)
}
const receipt={dataVerified:true,passed:stopReasons.length===0,allTasksCompleted:comparison.results.every(r=>r.reason==='completed'),stopReasons,rows,reuse,limitation:'One sample per task/phase/variant. Paired objective tolerance is two observation-noise standard deviations; this is not a statistical superiority claim.'}
writeFileSync(join(root,'verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2))
