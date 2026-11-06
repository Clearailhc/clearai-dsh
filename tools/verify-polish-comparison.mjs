/** Verify paired observations, metering, mount/isolation and objective scores after all workers exit. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { usageSummary } from './native-headless/accounting.mjs'
import { makeWorld, score } from './native-headless/world.mjs'
const root = resolve(process.argv[2] || '')
const json = path => JSON.parse(readFileSync(join(root,path)))
const manifest = json('manifest.json'), comparison = json('comparison.json')
assert.equal(comparison.complete,true)
assert.equal(comparison.results.length,6)
const key=readFileSync(join(root,'.controller/world-key'))
assert.equal(createHash('sha256').update(key).digest('hex'),manifest.worldKeyCommitment)
const rows=[]
for(const row of comparison.results) {
 const result=json(`runs/${row.id}/launcher-result.json`)
 assert.ok(['completed','token_limit','time_limit','blocked','incomplete','error'].includes(result.reason));assert.equal(result.usage.status,'verified')
 assert.equal(result.installation.packageDigest,manifest.candidateDigest)
 assert.deepEqual(result.model,manifest.model)
 assert.equal(result.mount.prompt,row.group==='C');assert.equal(result.mount.tools,row.group==='C')
 assert.ok(Object.values(result.violations).every(value=>value===false))
 assert.equal(json(`runs/${row.id}/isolation-probe.json`).passed,true)
 const calls=readFileSync(join(root,`runs/${row.id}/llm-calls.jsonl`),'utf8').trim().split('\n').map(JSON.parse)
 assert.deepEqual(usageSummary(calls),row.usage)
 assert.equal(calls.length,Object.values(row.roles).reduce((n,r)=>n+r.calls,0))
 assert.equal(row.usage.processed,Object.values(row.roles).reduce((n,r)=>n+r.processed,0))
 const childIds=new Set((result.clearai?.audits??[]).map(a=>a.child))
 assert.ok(calls.filter(call=>!call.purpose&&call.session!==result.session).every(call=>childIds.has(call.session)), 'Child roles must actually be independent auditors; classify any other delegation separately')
 const expected=row.task==='direct'?{score:result.reason==='completed'&&row.submission?.amount===391&&row.submission?.unit==='元'?100:0}:score(makeWorld(key,'polish-060-'+row.task,row.task),result.reason==='completed'?row.submission:null)
 const partialArtifactQuality=row.task==='direct'?null:score(makeWorld(key,'polish-060-'+row.task,row.task),row.submission)
 assert.deepEqual(row.quality,expected)
 const references=(row.submission?.evidence??[]).map(path=>{
  const absolute=resolve(root,'workspaces',row.id,path)
  assert.ok(absolute.startsWith(resolve(root,'workspaces',row.id)+'/'),'Evidence must remain in its workspace')
  return {path,bytes:readFileSync(absolute).length}
 })
 rows.push({id:row.id,reason:result.reason,completed:result.reason==='completed',score:expected.score,partialArtifactQuality,evidenceFiles:references,independentAudits:row.audits.length,invalidOrFailedAudits:row.audits.filter(a=>a.holds!=='yes').length,realExperimentBudget:row.experimentCost})
}
for(const task of ['additive','interaction']){
 const pair=comparison.results.filter(row=>row.task===task)
 assert.equal(pair.length,2);assert.equal(pair[0].initialSha256,pair[1].initialSha256)
}
writeFileSync(join(root,'verification.json'),JSON.stringify({passed:true,allTasksCompleted:rows.every(row=>row.completed),rows,method:'Scores recomputed from hidden truth after workers exited; real mount, isolation probes, role accounting and submitted evidence checked. No model judge.',limitation:'One sample per task/variant; not a significance test or external domain accuracy benchmark.'},null,2))
// This is a synthetic grading seed, disclosed only after every paid worker exited.
writeFileSync(join(root,'grading-truth.json'),JSON.stringify({releasedAfterAllRuns:true,worldKeyHex:key.toString('hex'),worldKeyCommitment:manifest.worldKeyCommitment},null,2))
console.log(JSON.stringify(rows,null,2))
