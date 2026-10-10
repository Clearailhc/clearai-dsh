import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFileSync,existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tempDir} from './tmp.mjs'
import {sequenceWorld} from '../tools/native-headless/sequence.mjs'
import {sequenceMachineScore,sequenceQuality,validateGrade,blindAgreement,blindText} from '../tools/native-headless/scoring.mjs'
import {stageAcceptance} from '../tools/native-headless/acceptance.mjs'
import {mechanismReceipt,moistureOnlyExperiments} from '../tools/native-headless/mechanisms.mjs'
import {prepareSubmission} from '../tools/native-headless/campaign.mjs'
import {nativeTestEnvironment} from '../tools/native-headless/run.mjs'
import {factoryWorld} from '../tools/native-headless/factory.mjs'
const grade=()=>({components:{drift:1,relations:1,excluded:1,scope:1,diagnosis:1,fix:1},factory:{cause:1,confounding:1,metric:1,decision:1},overconfident:0,correctDiagnosis:true,misusedOld:false,correctReuse:true,historicalRetraction:false,evidence:['lab/current.json: measured']})
test('uncompleted tasks score zero despite a locally optimal submission; t2 failure costs 31',()=>{
 const world=sequenceWorld('synthetic-key','score'),recipe=world.optimum('t2').recipe
 const failed=sequenceMachineScore(world,'t2',{recipe},[],false)
 assert.equal(failed.chosen.score,0);assert.equal(failed.firstQualifyingExperiment,31);assert.equal(sequenceQuality(failed,grade()),0)
 assert.equal(sequenceQuality(sequenceMachineScore(world,'t2',{recipe},[],true),grade()),4)
})
test('blind grades require complete evidence and safety judgments; disagreements trigger third judge',()=>{
 assert.equal(validateGrade(grade()).correctReuse,true)
 const incomplete=grade();delete incomplete.historicalRetraction;assert.throws(()=>validateGrade(incomplete),/Invalid/)
 const missing=grade();missing.evidence=[];assert.throws(()=>validateGrade(missing),/evidence/)
 const different=grade();different.correctReuse=false;assert.equal(blindAgreement(grade(),different),false)
 const text=blindText('ClearAI group C f-aaaaaaa f-bbbbbbb f-aaaaaaa')
 assert.ok(!text.includes('ClearAI'));assert.match(text,/reference-1.*reference-2.*reference-1/)
})
test('old submission survives in history but cannot be mistaken for the next task result',()=>{
 const workspace=tempDir('native-submission-');writeFileSync(join(workspace,'submission.json'),'old task')
 prepareSubmission(workspace,'t2');assert.equal(existsSync(join(workspace,'submission.json')),false)
})
test('native child environment excludes arbitrary inherited provider credentials',()=>{
 const env=nativeTestEnvironment('/tmp/test-home','/tmp/spec',{PATH:'/bin',HOME:'/tmp',OPENAI_API_KEY:'synthetic-key',ARBITRARY_SECRET:'synthetic'})
 assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.ARBITRARY_SECRET,undefined);assert.equal(env.PATH,'/bin')
})
test('persisted negative coverage and actual final confirmed references are different mechanisms',()=>{
 const result={reason:'completed',clearai:{hypotheses:[{id:'h-one'}],evidence:[{hypothesis:'h-one',verdict:'refute'}],anomalies:[{id:'a-one',status:'explained',matters:'yes'}],goal:{answers:[{uses:['f-known'],basis:['lab/current.json'],uses_review:[{id:'f-known',confirmed:true,card_path:'card.json',digest:'v4:hash'}]}]}}}
 const records=[{storageCategory:'negatives',source:{hypothesis:'h-one'}},{storageCategory:'negatives',source:{anomaly:'a-one'}},{id:'f-known',rechecks:[]}]
 const receipt=mechanismReceipt(result,records);assert.equal(receipt.required,2);assert.equal(receipt.covered,2);assert.equal(receipt.actualConfirmed,1);assert.equal(receipt.violations.silent_closure,false)
 records[2].rechecks=[{status:'pending'}];assert.equal(mechanismReceipt(result,records).violations.unresolved_reference_completed,true)
})
test('silent closure and repeated settled-material dispatches stop a batch',()=>{
 const receipt=mechanismReceipt({reason:'completed',clearai:{anomalies:[{status:'open',matters:'unclear'}],audits:[{step:'s',digest:'v4:x',card_path:'first',holds:'yes'},{step:'s',digest:'v4:x',holds:'yes'}]}},[])
 assert.equal(receipt.violations.silent_closure,true);assert.equal(receipt.violations.duplicate_dispatch,true)
})
test('lost pending reasons and out-of-scope historical retractions are critical',()=>{
 const old=[{id:'f-one',status:'established',scope_spec:{conditions:{instrument:'A'}},rechecks:[{id:'reason',status:'pending'}]}]
 const result={reason:'completed',clearai:{goal:{conditions:{instrument:'B'}},audits:[]}}
 const vanished=mechanismReceipt(result,[{...old[0],rechecks:[],status:'retracted'}],old)
 assert.equal(vanished.violations.pending_restored_without_review,true);assert.equal(vanished.violations.outside_historical_retraction,true)
 const resolved=mechanismReceipt(result,[{...old[0],rechecks:[{id:'reason',status:'resolved',resolution:{by:'independent',card_path:'lab/card.json'}}]}],old)
 assert.equal(resolved.violations.pending_restored_without_review,false)
})
test('smoke acceptance rejects failed or nonscorable optimization even with six run records',()=>{
 const runs=Array.from({length:6},()=>({result:{reason:'completed',usage:{status:'verified'}}})),scores=[...Array.from({length:2},()=>({row:{task:'direct'},score:100})),...Array.from({length:4},()=>({row:{task:'additive'},score:90,feasible:true}))]
 assert.equal(stageAcceptance({stage:'smoke',runs,scores}).passed,true);scores[3].score=0;assert.equal(stageAcceptance({stage:'smoke',runs,scores}).passed,false)
})
test('moisture-only cost never replaces total t4 diagnosis cost',()=>{
 const recipe={T:170,P:3.5,cat:1,t:70,w:.3},calls=[{request:recipe},{request:{...recipe,w:.6}},{request:{...recipe,T:180,w:.6}}]
 assert.equal(moistureOnlyExperiments(calls),1)
})
test('factory pairing preserves raw accounting and world-specific changes',()=>{
 const a=factoryWorld('synthetic','factory-1'),b=factoryWorld('synthetic','factory-1'),other=factoryWorld('synthetic','factory-2')
 assert.deepEqual(a.truth(),b.truth());assert.notDeepEqual(a.truth(),other.truth())
 const csv=a.csv(9),lines=csv.trim().split('\n'),fields=lines.shift().split(',')
 assert.equal(lines.length,30*2*4*2*4)
 for(const line of lines){const r=Object.fromEntries(line.split(',').map((v,i)=>[fields[i],v]));assert.ok(+r.first_pass_ok<=+r.final_ok&&+r.final_ok<=+r.units);if(r.date>='2026-09-05')assert.notEqual(r.lot,'B0723')}
})
test('formal acceptance uses whole paired worlds, requires auditable usage and observed feedback opportunities',()=>{
 const scores=[],runs=[]
 for(let i=0;i<6;i++)for(const group of ['A','C'])for(const task of ['t1','t2','t3','t4']) {
  const row={group,world:'formal-'+i,task},g=grade()
  scores.push({row,quality:group==='C'?3.5:2.5,machine:{task,completed:true,firstQualifyingExperiment:group==='C'?4:8,totalExperiments:group==='C'?3:6},blind:{grade:g}})
  runs.push({row,result:{reason:'completed',usage:{status:'verified',processed:group==='C'?200:100}},mechanism:{required:1,covered:1,actualConfirmed:1,violations:{}}})
 }
 const passed=stageAcceptance({stage:'formal',runs,scores})
 assert.equal(passed.passed,true);assert.equal(passed.paired.worlds,6);assert.equal(passed.metrics.actualReuse,1)
 runs[0].result.usage.processed=null;runs[0].result.usage.status='unknown'
 const missing=stageAcceptance({stage:'formal',runs,scores});assert.equal(missing.passed,false);assert.equal(missing.metrics.tokenRatio,null)
 runs[0].result.usage={status:'verified',processed:100}
 runs.forEach(run=>run.mechanism.required=0)
 assert.equal(stageAcceptance({stage:'formal',runs,scores}).passed,false)
})
