/** A tag is not permission to publish a candidate with missing live evidence. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, join } from 'node:path'
import { verifyReleaseBudget, verifyComparisonFunding } from './release-budget.mjs'
const root=resolve(import.meta.dirname,'..')
const version=JSON.parse(readFileSync(resolve(root,'package.json'))).version
const receipt=JSON.parse(readFileSync(resolve(root,`docs/optimization/${version}-release/acceptance.json`)))
assert.equal(receipt.version,version)
assert.equal(receipt.passed,true)
const polish=receipt.scope?.kind==='polish-paired-review'
let approvedLimits={limitUsd:30,testLimitUsd:5}
let expandedLedger=null
if(polish) {
 assert.equal(version,'0.6.0')
 assert.equal(receipt.scope.authorizedByUser,true)
 const comparison=JSON.parse(readFileSync(resolve(root,`docs/optimization/${version}-release/comparison/comparison.json`)))
 const manifest=JSON.parse(readFileSync(resolve(root,`docs/optimization/${version}-release/comparison/manifest.json`)))
 if(manifest.approvedLimits){
  assert.ok(typeof manifest.protocol?.authorization==='string'&&manifest.protocol.authorization.trim())
  approvedLimits=manifest.approvedLimits
  expandedLedger=JSON.parse(readFileSync(resolve(root,`docs/optimization/${version}-release/budget.json`)))
  const budget=verifyReleaseBudget(expandedLedger,approvedLimits)
  for(const key of ['limitUsd','perTestLimitUsd','pendingRequests','unknownRequests','acceptedUnknownReservations'])assert.equal(receipt.budget[key],budget[key])
  assert.ok(Math.abs(receipt.budget.costUpperBoundUsd-budget.costUpperBoundUsd)<1e-8)
  assert.deepEqual(receipt.budget.perTestCostUpperBoundUsd,budget.perTestCostUpperBoundUsd)
 }
 assert.equal(comparison.complete,true)
 assert.equal(comparison.results.length,6)
 assert.deepEqual(comparison.results.map(row=>row.id).sort(),['additive-A','additive-C','direct-A','direct-C','interaction-A','interaction-C'])
 if(expandedLedger){
  const calls=Object.fromEntries(comparison.results.map(row=>[row.id,readFileSync(resolve(root,`docs/optimization/${version}-release/comparison/runs/${row.id}/llm-calls.jsonl`),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)]))
  verifyComparisonFunding(expandedLedger,manifest,comparison,calls)
 }
 for(const row of comparison.results) {
  assert.equal(row.reason,'completed');assert.equal(row.usage.status,'verified')
  assert.deepEqual(row.violations,[])
  assert.ok(Number.isFinite(row.quality.score)&&row.quality.score>0&&row.quality.score<=100)
  if(row.task!=='direct')assert.equal(row.quality.feasible,true)
  assert.equal(Object.values(row.roles).reduce((n,r)=>n+r.processed,0),row.usage.processed)
  assert.ok(row.elapsedMs>0&&row.costUpperBoundUsd>=0)
 }
 for(const task of ['additive','interaction']) {
  const pair=comparison.results.filter(row=>row.task===task)
  assert.equal(pair[0].initialSha256,pair[1].initialSha256,'Both variants need identical initial observations')
 }
 assert.equal(JSON.parse(readFileSync(resolve(root,`docs/optimization/${version}-release/comparison/verification.json`))).passed,true)
 const run=receipt.gates['single-native-e2e']
 assert.equal(run?.reason,'completed');assert.equal(run?.usageStatus,'verified')
 assert.ok(run?.independentAudits>0);assert.equal(run?.parentRequestsWhileWaiting,0)
}
const singleE2e=receipt.scope?.kind==='single-native-e2e'
if(singleE2e) {
 assert.equal(version,'0.5.9')
 assert.equal(receipt.scope.authorizedByUser,true)
 assert.equal(receipt.scope.request,'跑一个端到端任务然后发布新版本。')
 const run=receipt.gates['single-native-e2e']
 assert.equal(run?.reason,'completed');assert.equal(run?.usageStatus,'verified')
 assert.ok(run?.independentAudits>0);assert.equal(run?.parentRequestsWhileWaiting,0)
}
const reducedScope=receipt.scope?.kind==='first-paired-smoke'
if(reducedScope) {
 assert.equal(receipt.scope.authorizedByUser,true)
 assert.equal(receipt.scope.request,'跑完首场没问题就升级发布')
 const pair=receipt.gates['smoke-first-pair']?.runs
 assert.equal(pair?.length,2,'Both sides of the first pair must finish')
 assert.deepEqual(pair.map(row=>row.group).sort(),['A','C'])
 assert.ok(pair.every(row=>row.task==='additive'&&row.reason==='completed'&&row.usageStatus==='verified'&&row.feasible===true&&row.score>0))
}
for(const gate of polish?['single-native-e2e','paired-comparison','engineering','package','lifecycle','production-ui','performance']:singleE2e?['single-native-e2e','engineering','package','lifecycle','production-ui']:['fast','slow-over-300s','cancel','disconnect','process-recovery',reducedScope?'smoke-first-pair':'smoke-six','production-ui','performance']) assert.equal(receipt.gates[gate]?.passed,true,`Missing gate: ${gate}`)
assert.equal(receipt.budget.limitUsd,approvedLimits.limitUsd);assert.equal(receipt.budget.perTestLimitUsd,approvedLimits.testLimitUsd)
assert.ok(receipt.budget.verified && Number.isFinite(receipt.budget.costUpperBoundUsd) && receipt.budget.costUpperBoundUsd >= 0 && receipt.budget.costUpperBoundUsd <= approvedLimits.limitUsd)
assert.equal(receipt.budget.pendingRequests,0,'In-flight usage must settle before release')
assert.equal(receipt.budget.unknownRequests,receipt.budget.acceptedUnknownReservations,'Unknown usage needs an explicit full-reservation exception')
assert.ok(Object.keys(receipt.budget.perTestCostUpperBoundUsd ?? {}).length>0)
for(const cost of Object.values(receipt.budget.perTestCostUpperBoundUsd)) assert.ok(Number.isFinite(cost)&&cost>=0&&cost<=approvedLimits.testLimitUsd,'Per-test spending exceeds the approved limit')
assert.ok(receipt.files.length>0)
const required=['package.json','preset/agent.cordis.yml']
if(polish) required.push('tools/release-budget.mjs',`docs/optimization/${version}-release/budget.json`,'package-lock.json','tools/verify-release-evidence.mjs','tools/verify-polish-comparison.mjs','tools/benchmark-research-events.mjs',`docs/optimization/${version}/preview-checks.json`,...['comparison.json','manifest.json','verification.json'].map(name=>`docs/optimization/${version}-release/comparison/${name}`))
function walk(directory){for(const entry of readdirSync(resolve(root,directory),{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())walk(path);else required.push(path.replaceAll('\\','/'))}}
for(const directory of ['preset/plugins','ui/lib','tools/native-headless'])walk(directory)
const recorded=new Set(receipt.files.map(row=>row.path))
for(const path of required)assert.ok(recorded.has(path),`Evidence must bind all runtime and test-driver files: ${path}`)
for(const row of receipt.files){const path=relative(root,resolve(root,row.path));assert.ok(path&&!path.startsWith('..'),'Evidence path must stay inside the checkout')}
for(const row of receipt.files) assert.equal(createHash('sha256').update(readFileSync(resolve(root,row.path))).digest('hex'),row.sha256,`Evidence does not match candidate: ${row.path}`)
console.log('Final candidate evidence verified')
