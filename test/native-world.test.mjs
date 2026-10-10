import test from 'node:test'
import assert from 'node:assert/strict'
import { sequenceWorld, sequenceService, scoreRecipe } from '../tools/native-headless/sequence.mjs'

test('paired worlds preserve sequence structure without sharing noise streams across tasks', () => {
 const a=sequenceWorld('private-key','formal-1'),b=sequenceWorld('private-key','formal-1'),other=sequenceWorld('private-key','formal-2')
 assert.deepEqual(a.truth(),b.truth());assert.notDeepEqual(a.truth(),other.truth())
 assert.equal(a.bias('t1',20),0);assert.ok(a.bias('t1',21)>0);assert.equal(a.bias('t1',21),a.bias('t2',1));assert.equal(a.bias('t3',1),0);assert.ok(a.bias('t4',1)>a.bias('t2',1))
 const r={T:170,P:3.5,cat:1,t:70,w:.1}
 assert.deepEqual(a.evaluate('t4',r),a.evaluate('t4',{...r,w:1}))
 assert.equal(a.production().length,42)
})
test('experiment API exposes observations, never truth, and enforces experiment count', async () => {
 const world=sequenceWorld('in-memory-key','test'),service=await sequenceService(world,'t4')
 try {
  const headers={authorization:'Bearer '+service.token,'content-type':'application/json'}
  const base=service.endpoint.replace('/experiment','')
  assert.equal((await fetch(base+'/truth',{headers})).status,404)
  assert.equal((await fetch(service.endpoint,{method:'POST',headers:{...headers,authorization:'Bearer wrong'},body:'{}'})).status,404)
  const r={T:170,P:3.5,cat:1,t:70,w:.3}
  for(let i=0;i<12;i++) {
   const response=await fetch(service.endpoint,{method:'POST',headers,body:JSON.stringify(r)});assert.equal(response.status,200)
   const observation=await response.json();assert.equal(observation.run,i+1);assert.equal(observation.T_actual,undefined);assert.equal(observation.truth,undefined)
  }
  assert.equal((await fetch(service.endpoint,{method:'POST',headers,body:JSON.stringify(r)})).status,409)
  assert.equal((await (await fetch(base+'/log',{headers})).json()).calls.length,12)
 } finally {await service.close()}
})
test('out-of-range or infeasible recipes receive zero, including completed prose claims', () => {
 const world=sequenceWorld('private','test')
 assert.equal(scoreRecipe(world,'t3',null).score,0)
 assert.equal(scoreRecipe(world,'t3',{T:201,P:4,cat:1,t:80,w:.3}).score,0)
 assert.equal(scoreRecipe(world,'t3',{T:200,P:4,cat:2,t:120,w:.3}).score,0)
 const optimum=world.optimum('t3');assert.ok(scoreRecipe(world,'t3',optimum.recipe).score>99)
})
