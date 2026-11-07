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
