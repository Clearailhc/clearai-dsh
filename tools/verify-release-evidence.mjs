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
for(const gate of ['fast','slow-over-300s','cancel','disconnect','process-recovery','smoke-six','production-ui','performance']) assert.equal(receipt.gates[gate]?.passed,true,`Missing gate: ${gate}`)
assert.equal(receipt.budget.limitUsd,30);assert.equal(receipt.budget.perTestLimitUsd,5)
assert.ok(receipt.budget.verified && receipt.budget.costUpperBoundUsd <= 30)
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
