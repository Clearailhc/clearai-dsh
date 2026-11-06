import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeBudget, campaignBudget, migrateVerifiedCachePricing } from '../tools/native-headless/budget.mjs'
function fixture(t) { const root=mkdtempSync(join(tmpdir(),'clearai-budget-')); t.after(()=>rmSync(root,{recursive:true,force:true})); const file=join(root,'ledger.json'); initializeBudget(file); return {file,b:campaignBudget(file)} }
test('all sessions and retries share the $5 test ceiling',t=>{const {b}=fixture(t); for(let i=0;i<6;i++) b.reserve({testId:'same',session:String(i)}); assert.throws(()=>b.reserve({testId:'same'}),/Per-test/); assert.doesNotThrow(()=>b.reserve({testId:'different'})); assert.throws(()=>b.reserve({}),/testId/)} )
test('pending requests across tests share the $30 campaign ceiling',t=>{const {b}=fixture(t); for(let i=0;i<37;i++) b.reserve({testId:String(i)}); assert.throws(()=>b.reserve({testId:'next'}),/Campaign/)} )
test('verified usage releases conservative reservations; unknown usage stops every test',t=>{const {b,file}=fixture(t); const id=b.reserve({testId:'x'}); b.settle(id,{inputTokens:1000,outputTokens:200,cacheReadTokens:500}); assert.equal(JSON.parse(readFileSync(file)).requests[id].costUpperBoundUsd,.000543); const unknown=b.reserve({testId:'x'});b.settle(unknown,undefined);assert.throws(()=>b.reserve({testId:'y'}),/Unverifiable/)} )
test('out-of-capacity usage leaves a durable stop, never frees reserved cost',t=>{const {b,file}=fixture(t);const id=b.reserve({testId:'x'});b.settle(id,{inputTokens:1e9,outputTokens:1});assert.equal(JSON.parse(readFileSync(file)).requests[id].status,'unknown');assert.throws(()=>campaignBudget(file).reserve({testId:'z'}),/Unverifiable/)} )

test('invalid cache accounting cannot release a reservation',t=>{const {b,file}=fixture(t);const id=b.reserve({testId:'x'});b.settle(id,{inputTokens:1000,outputTokens:10,cacheReadTokens:-1});assert.equal(JSON.parse(readFileSync(file)).requests[id].status,'unknown');assert.throws(()=>b.reserve({testId:'next'}),/Unverifiable/)} )
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
