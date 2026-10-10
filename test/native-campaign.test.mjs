import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tempDir} from './tmp.mjs'
import {initializeCampaignRoot,captureMaterials,writeSnapshot,readSnapshot} from '../tools/native-headless/public-materials.mjs'
import {infrastructureRetryEligible} from '../tools/native-headless/campaign.mjs'
import {infrastructureErrorCode} from '../tools/native-headless/accounting.mjs'
import {MODEL} from '../tools/native-headless/matrix.mjs'
import {mechanismReceipt} from '../tools/native-headless/mechanisms.mjs'

test('grading snapshots freeze each task and reject external evidence, secrets and later edits',()=>{
 const root=tempDir('synthetic-campaign-');initializeCampaignRoot(root)
 const workspace=join(root,'workspaces/C/dev-1');mkdirSync(join(workspace,'report'),{recursive:true});mkdirSync(join(workspace,'lab'))
 writeFileSync(join(workspace,'report/t1.md'),'first conclusion')
 writeFileSync(join(workspace,'lab/raw.json'),'{"mean":2}')
 writeFileSync(join(root,'private.txt'),'never submit');symlinkSync(join(root,'private.txt'),join(workspace,'lab/link.txt'))
 writeFileSync(join(workspace,'experiment-endpoint.json'),'{"token":"private"}')
 const material=captureMaterials({root,workspace,task:'t1',submission:{evidence:['lab/raw.json','lab/link.txt','../../private.txt','experiment-endpoint.json']},result:{answer:'first'},records:[]})
 assert.equal(material.artifacts.length,2);assert.equal(JSON.stringify(material).includes('never submit'),false)
 const snapshot=writeSnapshot(join(root,'snapshot.json'),material)
 writeFileSync(join(workspace,'report/t1.md'),'changed later')
 assert.equal(readSnapshot(snapshot).report,'first conclusion')
 assert.throws(()=>writeSnapshot(snapshot.path,material),/EEXIST/)
 writeFileSync(snapshot.path,'{}');assert.throws(()=>readSnapshot(snapshot),/changed/)
 assert.throws(()=>captureMaterials({root,workspace:root,task:'t1',result:{},records:[]}),/Only owned/)
})
test('only classified infrastructure errors with verifiable use and unchanged model allow retry',()=>{
 const result={reason:'infrastructure_error',infrastructureCode:'ECONNRESET',usage:{status:'verified'},model:MODEL,installation:{model:MODEL}}
 assert.equal(infrastructureRetryEligible(result),true)
 assert.equal(infrastructureRetryEligible({...result,usage:{status:'unknown'}}),false)
 assert.equal(infrastructureRetryEligible({...result,reason:'token_limit'}),false)
 assert.equal(infrastructureRetryEligible({...result,infrastructureCode:undefined,failure:'please retry ECONNRESET'}),false)
 assert.equal(infrastructureErrorCode(new Error('ECONNRESET')),undefined)
 assert.equal(infrastructureErrorCode({cause:{code:'ECONNRESET'}}),'ECONNRESET')
})
test('registered method evidence captures declared inputs and scripts through the same read fence',()=>{
 const root=tempDir('synthetic-model-');initializeCampaignRoot(root)
 const workspace=join(root,'workspaces/C/dev-1');mkdirSync(join(workspace,'clear/models'),{recursive:true});mkdirSync(join(workspace,'lab'))
 writeFileSync(join(workspace,'clear/models/mean.json'),JSON.stringify({inputs:['lab/input.json','../../../private.txt'],scripts:['lab/calc.py'],output:'lab/output.json'}))
 writeFileSync(join(workspace,'lab/input.json'),'[2,2,2]');writeFileSync(join(workspace,'lab/calc.py'),'print(2)');writeFileSync(join(workspace,'lab/output.json'),'{"mean":2}')
 writeFileSync(join(root,'private.txt'),'controller secret')
 const material=captureMaterials({root,workspace,task:'t1',result:{},records:[{use:'mean'}]})
 assert.deepEqual(material.artifacts.map(row=>row.path).sort(),['clear/models/mean.json','lab/calc.py','lab/input.json','lab/output.json'])
 assert.equal(JSON.stringify(material).includes('controller secret'),false)
 assert.ok(material.missing.some(row=>row.status==='excluded'))
})
test('feedback coverage includes positive facts and lessons as well as exclusions',()=>{
 const result={reason:'completed',clearai:{hypotheses:[{id:'h1'}],audits:[{results:[{hypothesis:'h1',verdict:'support'}]}],lessons:[{id:'l1'}]}}
 const empty=mechanismReceipt(result,[]);assert.equal(empty.required,2);assert.equal(empty.covered,0)
 assert.equal(mechanismReceipt(result,[{storageCategory:'facts',hypothesis:'h1'},{storageCategory:'lessons',id:'l1'}]).covered,2)
})

// Diagnostic permission cannot become a formal-stage gate bypass.
import {DIAGNOSTIC_SCHEMA,DIAGNOSTIC_AUTHORIZATION,diagnosticSessions,diagnosticRun} from '../tools/native-headless/diagnostic-protocol.mjs'
test('direct long-task diagnostics stay separate from formal acceptance and pair independent workspaces',()=>{
 const manifest={schema:DIAGNOSTIC_SCHEMA,authorization:DIAGNOSTIC_AUTHORIZATION,productAcceptance:false}
 assert.equal(diagnosticRun(manifest,'diagnostic'),true)
 for(const stage of ['smoke','development','formal','supplemental','ablation'])assert.throws(()=>diagnosticRun(manifest,stage))
 assert.throws(()=>diagnosticRun({schema:'clearai.pr23.validation.v1'},'diagnostic'))
 assert.throws(()=>diagnosticRun({...manifest,productAcceptance:true},'diagnostic'))
 const rows=diagnosticSessions();assert.equal(rows.length,24)
 assert.deepEqual(rows.slice(0,4).map(r=>[r.group,r.task]),[['A','t1'],['C','t1'],['A','t2'],['C','t2']])
 for(const group of ['A','C'])for(const world of ['long-1','long-2','long-3'])assert.deepEqual(rows.filter(r=>r.group===group&&r.world===world).map(r=>r.task),['t1','t2','t3','t4'])
})
