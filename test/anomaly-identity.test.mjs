import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyState,applyMutation} from '../ui/lib/fold.js'
const settle=(id,anomalies)=>({t:'audit/settled',id,verdict:'support',holds:'yes',anomalies})
function fixture(){const s=emptyState();s.audits=[{id:'a',goal_id:'g'},{id:'b',goal_id:'g'}];return applyMutation(s,settle('a',[{what:'component changed',matters:'unclear'}]))}
test('fresh independent acknowledgment keeps one disposed anomaly across paraphrases',()=>{
 let s=fixture();s.anomalies[0].status='escalated';s.anomalies[0].reason='128 units sensitivity disclosed'
 const m=settle('b',[{existing_id:'a#u1',disposition:'maintain',what:'same component issue',impact_basis:'source and disclosed sensitivity rechecked'}])
 s=applyMutation(s,m);assert.equal(s.anomalies.length,1);assert.equal(s.anomalies[0].status,'escalated');assert.equal(s.anomalies[0].reviews.length,1)
 s=applyMutation(s,m);assert.equal(s.anomalies[0].reviews.length,1)
})
test('new counterevidence or missing independent basis reopens the original anomaly',()=>{
 for(const item of [{disposition:'reopen',impact_basis:'changed evidence'},{disposition:'maintain'}]){let s=fixture();s.anomalies[0].status='escalated';s=applyMutation(s,settle('b',[{existing_id:'a#u1',what:'component changed',...item}]));assert.equal(s.anomalies[0].status,'open')}
})
test('cross-goal and unknown references cannot inherit an old disposition',()=>{
 for(const id of ['missing','a#u1']){let s=fixture();s.anomalies[0].status='escalated';s.audits[1].goal_id='other';s=applyMutation(s,settle('b',[{existing_id:id,disposition:'maintain',what:'new concern',impact_basis:'checked'}]));assert.equal(s.anomalies.length,2);assert.equal(s.anomalies[1].status,'open')}
})

test('independent review can acknowledge a model finding only in its registered goal',()=>{
 for(const goal of ['g','other']){let s=emptyState();s.goal={id:'g'};s=applyMutation(s,{t:'anomaly/opened',id:'model',what:'component changed'});s.anomalies[0].status='escalated';s.audits=[{id:'review',goal_id:goal}];s=applyMutation(s,settle('review',[{existing_id:'model',disposition:'maintain',what:'same issue',impact_basis:'source and boundary checked'}]));assert.equal(s.anomalies.length,goal==='g'?1:2);assert.equal(s.anomalies[0].status,'escalated')}
})
