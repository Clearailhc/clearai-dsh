import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeBudget, campaignBudget, migrateVerifiedCachePricing, doubleBudgetLimits, raiseBudgetLimits } from '../tools/native-headless/budget.mjs'
function fixture(t) { const root=mkdtempSync(join(tmpdir(),'clearai-budget-')); t.after(()=>rmSync(root,{recursive:true,force:true})); const file=join(root,'ledger.json'); initializeBudget(file); return {file,b:campaignBudget(file)} }
test('all sessions and retries share the $5 test ceiling',t=>{const {b}=fixture(t); for(let i=0;i<6;i++) b.reserve({testId:'same',session:String(i)}); assert.throws(()=>b.reserve({testId:'same'}),/Per-test/); assert.doesNotThrow(()=>b.reserve({testId:'different'})); assert.throws(()=>b.reserve({}),/testId/)} )
test('pending requests across tests share the $30 campaign ceiling',t=>{const {b}=fixture(t); for(let i=0;i<37;i++) b.reserve({testId:String(i)}); assert.throws(()=>b.reserve({testId:'next'}),/Campaign/)} )
test('verified usage releases conservative reservations; unknown usage stops every test',t=>{const {b,file}=fixture(t); const id=b.reserve({testId:'x'}); b.settle(id,{inputTokens:1000,outputTokens:200,cacheReadTokens:500}); assert.equal(JSON.parse(readFileSync(file)).requests[id].costUpperBoundUsd,.000543); const unknown=b.reserve({testId:'x'});b.settle(unknown,undefined);assert.throws(()=>b.reserve({testId:'y'}),/Unverifiable/)} )
test('out-of-capacity usage leaves a durable stop, never frees reserved cost',t=>{const {b,file}=fixture(t);const id=b.reserve({testId:'x'});b.settle(id,{inputTokens:1e9,outputTokens:1});assert.equal(JSON.parse(readFileSync(file)).requests[id].status,'unknown');assert.throws(()=>campaignBudget(file).reserve({testId:'z'}),/Unverifiable/)} )

test('invalid cache accounting cannot release a reservation',t=>{const {b,file}=fixture(t);const id=b.reserve({testId:'x'});b.settle(id,{inputTokens:1000,outputTokens:10,cacheReadTokens:-1});assert.equal(JSON.parse(readFileSync(file)).requests[id].status,'unknown');assert.throws(()=>b.reserve({testId:'next'}),/Unverifiable/)} )
test('zero fallback retains the full reservation and blocks further paid dispatch',t=>{
 const {b,file}=fixture(t),id=b.reserve({testId:'stream'})
 b.settle(id,{inputTokens:0,outputTokens:0,totalTokens:0})
 const row=JSON.parse(readFileSync(file)).requests[id]
 assert.equal(row.status,'unknown');assert.equal(row.reservedUsd,.8)
 assert.throws(()=>b.reserve({testId:'next'}),/Unverifiable/)
})
test('a specifically authorized unknown retains its full cost and does not approve future unknowns',t=>{
 const {b,file}=fixture(t),id=b.reserve({testId:'x'});b.settle(id,undefined)
 assert.throws(()=>b.acceptUnknownReservation(id,''),/authorization/)
 b.acceptUnknownReservation(id,'Explicit user approval for this request')
 const row=JSON.parse(readFileSync(file)).requests[id]
 assert.equal(row.status,'unknown');assert.equal(row.reservedUsd,.8)
 const next=b.reserve({testId:'x'});b.settle(next,undefined)
 assert.throws(()=>b.reserve({testId:'y'}),/Unverifiable/)
})

test('cache-price reconciliation preserves old bounds, unknown reservations and hard caps',t=>{
 const {file,b}=fixture(t),id=b.reserve({testId:'x'});b.settle(id,{inputTokens:1000,outputTokens:200,cacheReadTokens:500})
 const unknown=b.reserve({testId:'x'});b.settle(unknown,undefined);b.acceptUnknownReservation(unknown,'Explicit user exception')
 const old=JSON.parse(readFileSync(file));old.version=2;old.requests[id].reservedUsd=.00069;old.requests[id].costUpperBoundUsd=.00069;writeFileSync(file,JSON.stringify(old))
 migrateVerifiedCachePricing(file);const now=JSON.parse(readFileSync(file))
 assert.equal(now.version,3);assert.equal(now.requests[id].reservedUsd,.000543);assert.equal(now.requests[id].uncachedCostUpperBoundUsd,.00069)
 assert.deepEqual(now.requests[unknown],old.requests[unknown]);assert.equal(now.limitUsd,30);assert.equal(now.testLimitUsd,5)
 assert.doesNotThrow(()=>campaignBudget(file).reserve({testId:'x'}))
})
test('pricing reconciliation refuses pending requests without changing the ledger',t=>{
 const {file,b}=fixture(t);b.reserve({testId:'x'})
 const old=JSON.parse(readFileSync(file));old.version=2;writeFileSync(file,JSON.stringify(old));const before=readFileSync(file,'utf8')
 assert.throws(()=>migrateVerifiedCachePricing(file),/Drain pending/);assert.equal(readFileSync(file,'utf8'),before)
})


test('explicit doubling preserves every prior charge and unknown reservation, and cannot repeat',t=>{
 const {file,b}=fixture(t),id=b.reserve({testId:'old'});b.settle(id,{inputTokens:1000,outputTokens:200})
 const unknown=b.reserve({testId:'old'});b.settle(unknown,undefined);b.acceptUnknownReservation(unknown,'Earlier specific exception')
 const before=JSON.parse(readFileSync(file))
 assert.throws(()=>doubleBudgetLimits(file,''),/authorization/)
 doubleBudgetLimits(file,'User explicitly requests all budgets x2')
 const after=JSON.parse(readFileSync(file));assert.deepEqual(after.requests,before.requests)
 assert.equal(after.limitUsd,60);assert.equal(after.testLimitUsd,10)
 assert.throws(()=>doubleBudgetLimits(file,'repeat'),/once/)
 for(let i=0;i<12;i++)b.reserve({testId:'new'})
 assert.throws(()=>b.reserve({testId:'new'}),/Per-test/)
 for(let i=0;i<61;i++)b.reserve({testId:'other-'+i})
 assert.throws(()=>b.reserve({testId:'overflow'}),/Campaign/)
})
test('budget increase cannot reset pending or authorize arbitrary cap edits',t=>{
 const {file,b}=fixture(t);b.reserve({testId:'pending'})
 const before=readFileSync(file,'utf8');assert.throws(()=>doubleBudgetLimits(file,'approved'),/Drain pending/);assert.equal(readFileSync(file,'utf8'),before)
 const data=JSON.parse(before);data.limitUsd=60;data.testLimitUsd=10;writeFileSync(file,JSON.stringify(data))
 assert.throws(()=>b.reserve({testId:'new'}),/policy mismatch/)
})


import { spawn, spawnSync } from 'node:child_process'
test('Windows replacement retries preserve the old ledger and hold the lock',t=>{
 const {file}=fixture(t),moduleUrl=new URL('../tools/native-headless/budget.mjs',import.meta.url).href
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import fs from 'node:fs';
  import {syncBuiltinESMExports} from 'node:module';
  import {campaignBudget} from ${JSON.stringify(moduleUrl)};
  const file=${JSON.stringify(file)},before=fs.readFileSync(file,'utf8'),rename=fs.renameSync;
  Object.defineProperty(process,'platform',{value:'win32'});
  let attempts=0;
  fs.renameSync=(source,target)=>{
   assert.equal(target,file);
   assert.ok(fs.existsSync(file+'.lock'));
   assert.equal(fs.readFileSync(file,'utf8'),before);
   if(++attempts<3)throw Object.assign(new Error('Transient sharing denial'),{code:'EPERM'});
   return rename(source,target);
  };
  syncBuiltinESMExports();
  const id=campaignBudget(file).reserve({testId:'windows-sharing'});
  assert.equal(attempts,3);
  assert.equal(JSON.parse(fs.readFileSync(file)).requests[id].status,'pending');
  assert.equal(fs.existsSync(file+'.lock'),false);
 `],{encoding:'utf8',timeout:10000})
 assert.equal(child.status,0,child.stderr)
 assert.equal(Object.keys(JSON.parse(readFileSync(file)).requests).length,1)
})
test('concurrent workers preserve all shared reservations and settlements',async t=>{
 const {file}=fixture(t),moduleUrl=new URL('../tools/native-headless/budget.mjs',import.meta.url).href
 await Promise.all(Array.from({length:4},(_,worker)=>new Promise((resolve,reject)=>{
  const source=`import {campaignBudget} from ${JSON.stringify(moduleUrl)};const b=campaignBudget(${JSON.stringify(file)});for(let i=0;i<20;i++){const id=b.reserve({testId:'worker-'+${worker}});b.settle(id,{inputTokens:10,outputTokens:10});}`
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','ignore','pipe']});let stderr=''
  child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(stderr)))
 })))
 const rows=Object.values(JSON.parse(readFileSync(file)).requests)
 assert.equal(rows.length,80);assert.ok(rows.every(r=>r.status==='verified'))
})

 test('further authorized increases preserve reservations and validate the complete limit chain',t=>{
 const {file,b}=fixture(t);doubleBudgetLimits(file,'User doubled the original limits')
 const id=b.reserve({testId:'prior'});b.settle(id,{inputTokens:20,outputTokens:10})
 const before=JSON.parse(readFileSync(file))
 assert.throws(()=>raiseBudgetLimits(file,{limitUsd:60,testLimitUsd:12},''),/authorization/)
 assert.throws(()=>raiseBudgetLimits(file,{limitUsd:60,testLimitUsd:9},'raise'),/increase/)
 raiseBudgetLimits(file,{limitUsd:60,testLimitUsd:12},'User allows a modest further increase')
 const after=JSON.parse(readFileSync(file));assert.deepEqual(after.requests,before.requests);assert.equal(after.limitChanges.length,2)
 const pending=b.reserve({testId:'new'})
 assert.throws(()=>raiseBudgetLimits(file,{limitUsd:60,testLimitUsd:13},'raise'),/pending/)
 b.settle(pending,{inputTokens:1,outputTokens:1})
 const tampered=JSON.parse(readFileSync(file));tampered.limitChanges[1].from.testLimitUsd=9;writeFileSync(file,JSON.stringify(tampered))
 assert.throws(()=>b.reserve({testId:'bad'}),/policy/)
 })
