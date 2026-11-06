/** Verify fixed-input released-version comparison without interpreting failures as missing data. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { usageSummary } from './native-headless/accounting.mjs'
import { makeWorld, score } from './native-headless/world.mjs'
import { PRICE } from './native-headless/budget.mjs'
import { stopReasons } from './native-headless/matrix.mjs'
const [rootArg,priorArg]=process.argv.slice(2)
assert.ok(priorArg,'Usage: verify-release-baseline.mjs <baseline root> <prior candidate root>')
const root=resolve(rootArg), prior=resolve(priorArg), json=p=>JSON.parse(readFileSync(p)), sha=b=>createHash('sha256').update(b).digest('hex')
const manifest=json(join(root,'manifest.json')), comparison=json(join(root,'comparison.json')), priorComparison=json(join(prior,'comparison.json'))
assert.equal(manifest.schema,'clearai.fixed-version-comparison.v1');assert.equal(comparison.complete,true)
assert.equal(sha(readFileSync(join(prior,'manifest.json'))),manifest.priorManifestDigest)
assert.equal(sha(readFileSync(join(prior,'comparison.json'))),manifest.priorComparisonDigest)
assert.equal(json(join(prior,'verification.json')).dataVerified,true)
assert.equal(sha(readFileSync(new URL('./compare-release-baseline.mjs',import.meta.url))),manifest.driverDigest)
assert.deepEqual(comparison.results.map(r=>r.task),manifest.tasks)
const key=readFileSync(join(prior,'.controller/world-key'));assert.equal(sha(key),manifest.worldKeyCommitment)
const rows=[]
for(const row of comparison.results){
 const {task,baseline}=row, run=join(root,'runs',task), result=json(join(run,'launcher-result.json'))
 const candidate=priorComparison.results.find(r=>r.phase==='initial'&&r.task===task&&r.group==='C')
 for(const field of ['reason','elapsedMs','usage','goalStatus','initialSha256'])assert.deepEqual(row.candidate[field],candidate[field])
 assert.equal(result.installation.version,'0.5.9');assert.equal(result.installation.packageDigest,manifest.baselineDigest)
 assert.equal(result.mount.prompt,true);assert.equal(result.mount.tools,true)
 assert.deepEqual(result.model,manifest.model);assert.deepEqual(stopReasons(result),[])
 assert.equal(json(join(run,'isolation-probe.json')).passed,true)
 assert.equal(baseline.reason,result.reason);assert.equal(baseline.elapsedMs,result.elapsedMs)
 assert.equal(sha(readFileSync(join(root,'workspaces',task,'initial.json'))),candidate.initialSha256)
 const calls=readFileSync(join(run,'llm-calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
 const usage=usageSummary(calls);assert.equal(usage.status,'verified');assert.deepEqual(usage,baseline.usage);assert.deepEqual(usage,result.usage)
 const auditorIds=new Set(result.clearai.audits.map(a=>a.child).filter(Boolean))
 for(const c of calls){assert.ok(['main','evaluator','explorer','other'].includes(c.role));if(c.role==='main')assert.equal(c.session,result.session);if(c.role==='evaluator')assert.ok(auditorIds.has(c.session))}
 for(const [role,reported] of Object.entries(baseline.roles)){
  const relevant=calls.filter(c=>c.role===role);assert.equal(reported.calls,relevant.length);assert.equal(reported.processed,usageSummary(relevant).processed)
 }
 const cost=calls.reduce((n,c)=>{const u=c.usage;return n+((u.inputTokens??0)+(u.cacheWriteTokens??0))*PRICE.input/1e6+(u.cacheReadTokens??0)*PRICE.cached/1e6+(u.outputTokens??0)*PRICE.output/1e6},0)
 assert.ok(Math.abs(cost-baseline.costUsd)<1e-9)
 const world=makeWorld(key,'native-060-'+task,task), quality=score(world,baseline.submission)
 assert.deepEqual(quality,baseline.artifactQuality)
 assert.deepEqual(score(world,candidate.submission),row.candidate.artifactQuality)
 assert.deepEqual(baseline.facts,result.clearai.facts)
 assert.deepEqual(result.clearai.ontologyProblems,[])
 for(const fact of baseline.facts){
  const saved=json(join(root,'workspaces',task,'clear/knowledge/facts',fact.id+'.json'))
  for(const field of ['id','text','hypothesis','assertions','scope_spec'])assert.deepEqual(saved[field],fact[field])
 }
 let parentRequestsWhileWaiting=0
 for(const child of auditorIds){const cs=calls.filter(c=>c.session===child);if(!cs.length)continue;const start=Math.min(...cs.map(c=>c.started)),end=Math.max(...cs.map(c=>c.finished));parentRequestsWhileWaiting+=calls.filter(c=>c.role==='main'&&c.started>start&&c.started<end).length}
 assert.equal(parentRequestsWhileWaiting,0)
 rows.push({task,baseline:{reason:baseline.reason,goalStatus:result.clearai.goal?.status,elapsedMs:baseline.elapsedMs,tokens:usage.processed,costUsd:cost,artifactQuality:quality,facts:baseline.facts.length,roles:baseline.roles,audits:baseline.audits,parentRequestsWhileWaiting},candidate:{reason:candidate.reason,goalStatus:candidate.goalStatus,elapsedMs:candidate.elapsedMs,tokens:candidate.usage.processed,costUsd:candidate.costUpperBoundUsd,artifactQuality:row.candidate.artifactQuality,facts:candidate.knowledgeFacts.length,roles:candidate.roles,audits:candidate.audits}})
}
const candidateAcceptance=json(join(prior,'verification.json')).passed===true
const acceptancePassed=candidateAcceptance&&rows.every(r=>r.baseline.reason==='completed'&&r.baseline.goalStatus==='achieved')
const receipt={dataVerified:true,acceptancePassed,releaseRecommended:false,rows,limitation:'Two fixed tasks, one sample per version. Noncontemporaneous timings; model sampling and service variability prevent statistical or per-feature causal claims. Artifact score is separate from successful goal completion. Existing candidate failures are retained, not rerun.'}
writeFileSync(join(root,'verification.json'),JSON.stringify(receipt,null,2)+'\n')
console.log(JSON.stringify(receipt,null,2))
