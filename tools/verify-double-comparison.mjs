/** Independent accounting and task-result checks for the doubled-budget comparison. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {usageSummary} from './native-headless/accounting.mjs'
import {makeWorld,score} from './native-headless/world.mjs'
import {PRICE} from './native-headless/budget.mjs'
import {stopReasons} from './native-headless/matrix.mjs'
const root=resolve(process.argv[2]),json=p=>JSON.parse(readFileSync(p)),sha=b=>createHash('sha256').update(b).digest('hex')
try{
 const manifest=json(join(root,'manifest.json')),comparison=json(join(root,'comparison.json'))
 assert.equal(manifest.schema,'clearai.double-comparison.v1');assert.equal(comparison.complete,true)
 assert.equal(comparison.results.length,6);assert.deepEqual(comparison.results.map(r=>r.id),manifest.rows.map(r=>r.id))
 const key=readFileSync(join(root,'.controller/world-key'));assert.equal(sha(key),manifest.worldKeyCommitment)
 for(const a of manifest.assets)assert.equal(sha(readFileSync(join(import.meta.dirname,'native-headless',a.path))),a.sha256)
 assert.ok(process.env.CLEARAI_TEST_BUDGET_FILE,'Existing campaign ledger required')
 const ledger=json(process.env.CLEARAI_TEST_BUDGET_FILE),requests=Object.values(ledger.requests),seenBudgetIds=new Set()
 assert.equal(ledger.limitUsd,60);assert.equal(ledger.testLimitUsd,10)
 assert.equal(requests.filter(r=>r.status==='pending').length,0)
 const rows=[]
 for(const row of comparison.results){
  const run=join(root,'runs',row.id),ws=join(root,'workspaces',row.id),result=json(join(run,'launcher-result.json'))
  assert.deepEqual(stopReasons(result),[])
  assert.equal(result.installation.packageDigest,manifest.installations[row.variant].digest);assert.deepEqual(result.model,manifest.model)
  assert.equal(result.mount.prompt,row.variant!=='bare');assert.equal(result.mount.tools,row.variant!=='bare')
  assert.equal(json(join(run,'isolation-probe.json')).passed,true)
  assert.equal(result.reason,row.reason);assert.equal(result.elapsedMs,row.elapsedMs)
  assert.equal(sha(readFileSync(join(ws,'initial.json'))),row.initialSha256)
  const calls=readFileSync(join(run,'llm-calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),usage=usageSummary(calls)
  for(const c of calls){
   assert.ok(c.budgetId&&!seenBudgetIds.has(c.budgetId));seenBudgetIds.add(c.budgetId)
   const entry=ledger.requests[c.budgetId];assert.ok(entry);assert.equal(entry.status,'verified');assert.equal(entry.testId,'double060:'+row.id);assert.equal(entry.session,c.session);assert.deepEqual(entry.usage,c.usage)
  }
  assert.equal(usage.status,'verified');assert.deepEqual(usage,row.usage);assert.deepEqual(usage,row.accountedUsage);assert.deepEqual(usage,result.usage)
  const auditorIds=new Set((result.clearai?.audits??[]).map(a=>a.child).filter(Boolean))
  for(const c of calls){assert.ok(['main','evaluator','explorer','other'].includes(c.role));if(c.role==='main')assert.equal(c.session,result.session);if(c.role==='evaluator')assert.ok(auditorIds.has(c.session))}
  let total=0
  for(const [role,stats] of Object.entries(row.roles)){
   const cs=calls.filter(c=>c.role===role);assert.equal(stats.calls,cs.length);assert.equal(stats.processed,usageSummary(cs).processed)
   const cost=cs.reduce((n,c)=>{const u=c.usage;return n+((u.inputTokens??0)+(u.cacheWriteTokens??0))*PRICE.input/1e6+(u.cacheReadTokens??0)*PRICE.cached/1e6+(u.outputTokens??0)*PRICE.output/1e6},0)
   assert.ok(Math.abs(cost-stats.costUsd)<1e-9);total+=cost
  }
  assert.ok(Math.abs(total-row.costUsd)<1e-9)
  const charged=requests.filter(r=>r.testId==='double060:'+row.id)
  assert.equal(charged.length,calls.length);assert.ok(Math.abs(charged.reduce((n,r)=>n+r.reservedUsd,0)-total)<1e-9)
  const world=makeWorld(key,manifest.seedPrefix+row.task,row.task)
  assert.deepEqual(score(world,row.submission),row.artifactQuality);assert.deepEqual(score(world,row.reason==='completed'?row.submission:null),row.completionQuality)
  for(const path of row.submission?.evidence??[]){const absolute=resolve(ws,path);assert.ok(absolute.startsWith(ws+'/'));assert.ok(existsSync(absolute)&&readFileSync(absolute).length>0)}
  assert.equal(row.facts.length,result.clearai?.facts?.length??0)
  for(const fact of row.facts){const saved=json(join(ws,'clear/knowledge/facts',fact.id+'.json'));assert.equal(saved.id,fact.id);assert.equal(saved.hypothesis,fact.hypothesis);assert.equal(saved.text,fact.text);assert.deepEqual(saved.scope_spec,fact.scope);assert.deepEqual(saved.assertions,fact.assertions)}
  let parentRequestsWhileWaiting=0
  for(const child of auditorIds){const cs=calls.filter(c=>c.session===child);if(!cs.length)continue;const start=Math.min(...cs.map(c=>c.started)),end=Math.max(...cs.map(c=>c.finished));parentRequestsWhileWaiting+=calls.filter(c=>c.role==='main'&&c.started>start&&c.started<end).length}
  assert.equal(parentRequestsWhileWaiting,0)
  const taskSucceeded=row.reason==='completed'&&(row.variant==='bare'||row.goalStatus==='achieved')
  const auditWork=(result.clearai?.audits??[]).map(a=>{
   const cs=calls.filter(c=>c.session===a.child)
   return {id:a.id,kind:a.kind,holds:a.holds??null,calls:cs.length,processed:usageSummary(cs).processed,output:cs.reduce((n,c)=>n+(c.usage?.outputTokens??0),0),requestMs:cs.reduce((n,c)=>n+c.finished-c.started,0),spanMs:cs.length?Math.max(...cs.map(c=>c.finished))-Math.min(...cs.map(c=>c.started)):0}
  })
  rows.push({...row,taskSucceeded,taskQuality:score(world,taskSucceeded?row.submission:null),parentRequestsWhileWaiting,auditWork,ontologyProblems:result.clearai?.ontologyProblems??[],planCount:result.clearai?.plans?.length??0})
 }
 for(const task of ['additive','interaction'])assert.equal(new Set(rows.filter(r=>r.task===task).map(r=>r.initialSha256)).size,1)
 const currentCostUsd=rows.reduce((n,r)=>n+r.costUsd,0),cumulativeReservedUsd=requests.reduce((n,r)=>n+r.reservedUsd,0)
 assert.ok(Math.abs(cumulativeReservedUsd-manifest.costBeforeUsd-currentCostUsd)<1e-8)
 const unknown=requests.filter(r=>r.status==='unknown')
 assert.equal(unknown.length,1);assert.equal(unknown[0].reservedUsd,0.8);assert.ok(unknown[0].reservationAcceptance?.authorization);assert.ok(!unknown[0].testId?.startsWith('double060:'))
 const budget={limitUsd:ledger.limitUsd,testLimitUsd:ledger.testLimitUsd,previousReservedUsd:manifest.costBeforeUsd,currentCostUsd,cumulativeReservedUsd,historicalUnknownReservationUsd:0.8,pending:0,newUnknown:0}
 const receipt={dataVerified:true,allTasksCompleted:rows.every(r=>r.taskSucceeded),releaseRecommended:false,budget,rows,limitation:'Fresh synthetic tasks, one sample per variant. Concurrent API calls share service resources. Artifact quality and task completion are separate. Additional budget, different worlds and cumulative code changes prevent attributing differences to any single mechanism. No cross-task ontology reuse benefit is measured here.'}
 writeFileSync(join(root,'verification.json'),JSON.stringify(receipt,null,2)+'\n')
 console.log(JSON.stringify({dataVerified:true,allTasksCompleted:receipt.allTasksCompleted,rows:rows.map(r=>({id:r.id,reason:r.reason,seconds:Math.round(r.elapsedMs/1000),tokens:r.usage.processed,costUsd:r.costUsd,facts:r.facts.length,score:r.artifactQuality.score}))}))
}catch(error){writeFileSync(join(root,'verification.json'),JSON.stringify({dataVerified:false,error:String(error.message)},null,2)+'\n');throw error}
