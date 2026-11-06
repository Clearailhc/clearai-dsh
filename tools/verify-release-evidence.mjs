/** A tag is not permission to publish a candidate with missing live evidence. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const root=resolve(import.meta.dirname,'..')
const receipt=JSON.parse(readFileSync(resolve(root,'docs/optimization/0.5.8-release/acceptance.json')))
assert.equal(receipt.version,JSON.parse(readFileSync(resolve(root,'package.json'))).version)
assert.equal(receipt.passed,true)
for(const gate of ['fast','slow-over-300s','cancel','disconnect','process-recovery','smoke-six','production-ui','performance']) assert.equal(receipt.gates[gate]?.passed,true,`Missing gate: ${gate}`)
assert.equal(receipt.budget.limitUsd,30);assert.equal(receipt.budget.perTestLimitUsd,5)
assert.ok(receipt.budget.verified && receipt.budget.costUpperBoundUsd <= 30)
assert.ok(receipt.files.length>0)
for(const row of receipt.files) assert.equal(createHash('sha256').update(readFileSync(resolve(root,row.path))).digest('hex'),row.sha256,`Evidence does not match candidate: ${row.path}`)
console.log('Final candidate evidence verified')
