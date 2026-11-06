/** A tag is not permission to publish a candidate with missing live evidence. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, join } from 'node:path'
const root=resolve(import.meta.dirname,'..')
const version=JSON.parse(readFileSync(resolve(root,'package.json'))).version
const receipt=JSON.parse(readFileSync(resolve(root,`docs/optimization/${version}-release/acceptance.json`)))
assert.equal(receipt.version,version)
assert.equal(receipt.passed,true)
const reducedScope=receipt.scope?.kind==='first-paired-smoke'
if(reducedScope) {
 assert.equal(receipt.scope.authorizedByUser,true)
 assert.equal(receipt.scope.request,'跑完首场没问题就升级发布')
 const pair=receipt.gates['smoke-first-pair']?.runs
 assert.equal(pair?.length,2,'Both sides of the first pair must finish')
 assert.deepEqual(pair.map(row=>row.group).sort(),['A','C'])
 assert.ok(pair.every(row=>row.task==='additive'&&row.reason==='completed'&&row.usageStatus==='verified'&&row.feasible===true&&row.score>0))
}
for(const gate of ['fast','slow-over-300s','cancel','disconnect','process-recovery',reducedScope?'smoke-first-pair':'smoke-six','production-ui','performance']) assert.equal(receipt.gates[gate]?.passed,true,`Missing gate: ${gate}`)
assert.equal(receipt.budget.limitUsd,30);assert.equal(receipt.budget.perTestLimitUsd,5)
assert.ok(receipt.budget.verified && Number.isFinite(receipt.budget.costUpperBoundUsd) && receipt.budget.costUpperBoundUsd >= 0 && receipt.budget.costUpperBoundUsd <= 30)
assert.equal(receipt.budget.pendingRequests,0,'In-flight usage must settle before release')
assert.equal(receipt.budget.unknownRequests,receipt.budget.acceptedUnknownReservations,'Unknown usage needs an explicit full-reservation exception')
assert.ok(Object.keys(receipt.budget.perTestCostUpperBoundUsd ?? {}).length>0)
for(const cost of Object.values(receipt.budget.perTestCostUpperBoundUsd)) assert.ok(Number.isFinite(cost)&&cost>=0&&cost<=5,'Per-test spending exceeds the approved limit')
assert.ok(receipt.files.length>0)
const required=['package.json','preset/agent.cordis.yml']
function walk(directory){for(const entry of readdirSync(resolve(root,directory),{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())walk(path);else required.push(path.replaceAll('\\','/'))}}
for(const directory of ['preset/plugins','ui/lib','tools/native-headless'])walk(directory)
const recorded=new Set(receipt.files.map(row=>row.path))
for(const path of required)assert.ok(recorded.has(path),`Evidence must bind all runtime and test-driver files: ${path}`)
for(const row of receipt.files){const path=relative(root,resolve(root,row.path));assert.ok(path&&!path.startsWith('..'),'Evidence path must stay inside the checkout')}
for(const row of receipt.files) assert.equal(createHash('sha256').update(readFileSync(resolve(root,row.path))).digest('hex'),row.sha256,`Evidence does not match candidate: ${row.path}`)
console.log('Final candidate evidence verified')
