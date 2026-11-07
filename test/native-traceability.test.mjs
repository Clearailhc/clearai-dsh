import test from 'node:test'
import assert from 'node:assert/strict'
import {traceabilityCase,traceabilityScore} from '../tools/native-headless/traceability.mjs'

test('traceability case preserves paired inputs and contains a substantial typed graph',()=>{
 const a=traceabilityCase(Buffer.alloc(32,7)),b=traceabilityCase(Buffer.alloc(32,7))
 assert.deepEqual(a.initial,b.initial);assert.deepEqual(a.expected(3),b.expected(3))
 assert.equal(a.expected(1).entities.length,234);assert.equal(a.expected(1).edges.length,508)
 assert.equal(a.expected(3).entities.length,246);assert.equal(a.expected(3).edges.length,532)
 assert.ok(!Object.keys(a.initial).some(p=>p.includes('v2')||p.includes('corrections')))
 for(const phase of [1,2,3]){
  const e=a.expected(phase),graph={entities:e.entities,edges:e.edges}
  assert.equal(traceabilityScore(e,e,graph).decisionExact,true)
  assert.equal(traceabilityScore(e,e,graph).edges.recall,1)
  const bad={...e,exposures:e.exposures.map((r,i)=>i? r : {...r,net_units:r.net_units+1})}
  assert.equal(traceabilityScore(e,bad,graph).decisionExact,false)
  const ids=new Set(e.entities.map(r=>r.id));assert.ok(e.edges.every(r=>ids.has(r.subject)&&ids.has(r.object)))
 }
 assert.deepEqual(a.expected(2).quarantined_batches,a.expected(1).quarantined_batches)
 assert.ok(a.expected(2).exposures.length<a.expected(1).exposures.length)
 assert.equal(traceabilityScore(a.expected(3),a.expected(1),null).decisionExact,false)
})

test('risk is a bounded notice decision and distinguishes approval, versions and pack units',()=>{
 const a=traceabilityCase(Buffer.alloc(32,7)),e=a.expected(3)
 assert.ok(e.exposures.some(r=>r.shipment_id>='SHP121'&&r.net_units%24===0))
 const updates=JSON.parse(a.updates['data/notice-v2.json']),old=JSON.parse(a.initial['data/notice-v1.json'])
 assert.equal(updates.supersedes,old.id);assert.notDeepEqual(updates.suspect_lots,old.suspect_lots)
 assert.match(a.initial['data/README.md'],/unapproved rework is not a release/)
 assert.match(a.task(2),/复用/);assert.match(a.task(3),/保留/)
 const missing=traceabilityScore(e,null,null);assert.equal(missing.decisionExact,false);assert.equal(missing.entities.recall,0)
})
