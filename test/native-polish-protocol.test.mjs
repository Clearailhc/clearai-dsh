import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {initializeBudget} from '../tools/native-headless/budget.mjs'
for(const fault of ['missing-authorization','unbounded-tokens','invalid-limits'])test('paid comparison rejects '+fault+' before creating tasks or reserving money',t=>{
 const root=mkdtempSync(join(tmpdir(),'clearai-polish-protocol-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const home=join(root,'home');mkdirSync(home);writeFileSync(join(home,'installation.json'),JSON.stringify({version:'0.6.0',packageDigest:'unused'}))
 const budget=join(root,'budget.json');initializeBudget(budget);const before=readFileSync(budget,'utf8')
 const protocol={authorization:'test-only authorization',limits:{limitUsd:30,testLimitUsd:5},budgets:{direct:{tokenBudget:10,timeoutMs:100},complex:{tokenBudget:10,timeoutMs:100}},testIdPrefix:'test:',isolationRoots:[]}
 if(fault==='missing-authorization')protocol.authorization=''
 if(fault==='unbounded-tokens')protocol.budgets.complex.tokenBudget=-1
 if(fault==='invalid-limits')protocol.limits.testLimitUsd=31
 const config=join(root,'protocol.json');writeFileSync(config,JSON.stringify(protocol));const output=join(root,'output')
 const result=spawnSync(process.execPath,['tools/native-headless/compare-polish.mjs',home,'unused',output],{cwd:new URL('..',import.meta.url),env:{...process.env,DS_KEY:'',CLEARAI_TEST_BUDGET_FILE:budget,CLEARAI_POLISH_PROTOCOL:config},encoding:'utf8',timeout:10000})
 assert.notEqual(result.status,0);assert.equal(existsSync(output),false,result.stderr);assert.equal(readFileSync(budget,'utf8'),before)
})

test('public recovery archive derives prompt evidence and measures sanitized artifacts without exposing private messages',t=>{
 const root=mkdtempSync(join(tmpdir(),'clearai-public-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const source=join(root,'source'),destination=join(root,'public'),run=join(source,'runs/case-C'),workspace=join(source,'workspaces/case-C')
 mkdirSync(run,{recursive:true});mkdirSync(workspace,{recursive:true})
 const put=(p,v)=>writeFileSync(p,JSON.stringify(v))
 put(join(source,'manifest.json'),{schema:'clearai.polish-comparison.v1'})
 put(join(source,'comparison.json'),{complete:true,results:[{id:'case-C',recovery:{kind:'same-session'}}]})
 put(join(source,'verification.json'),{passed:true,allTasksCompleted:true,rows:[{id:'case-C',evidenceFiles:[{path:'evidence.json',bytes:0}]}]})
 put(join(source,'grading-truth.json'),{releasedAfterAllRuns:true})
 put(join(run,'launcher-result.json'),{session:'native-main',mount:{prompt:false,tools:true},logs:[{session:'native-main',path:'main.jsonl'}]})
 const privateMessage=JSON.stringify({type:'system/message',data:'ClearAI boundary of fact PRIVATE-PROMPT'})+'\n'
 writeFileSync(join(run,'main.jsonl'),privateMessage+JSON.stringify({type:'tool/result',data:{ok:true}})+'\n')
 writeFileSync(join(workspace,'evidence.json'),'{"value":1.000}')
 const result=spawnSync(process.execPath,['tools/archive-native-comparison.mjs',source,destination],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000})
 assert.equal(result.status,0,result.stderr)
 const receipt=JSON.parse(readFileSync(join(destination,'runs/case-C/mount-evidence.json')))
 assert.equal(receipt.restoredPrompt,true);assert.equal(receipt.session,'native-main');assert.match(receipt.sourceSha256,/^[a-f0-9]{64}$/)
 assert.ok(!readFileSync(join(destination,'runs/case-C/main.public.jsonl'),'utf8').includes('PRIVATE-PROMPT'))
 const verification=JSON.parse(readFileSync(join(destination,'verification.json')))
 assert.equal(verification.rows[0].evidenceFiles[0].bytes,readFileSync(join(destination,'workspaces/case-C/evidence.json')).length)
 assert.equal(readFileSync(join(workspace,'evidence.json'),'utf8'),'{"value":1.000}')
})
