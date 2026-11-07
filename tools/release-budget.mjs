/** Verify a preserved cumulative ledger against an explicitly approved limit chain. */
import assert from 'node:assert/strict'
import {PRICE,REQUEST_RESERVE} from './native-headless/budget.mjs'
import {validPaidUsage} from './native-headless/accounting.mjs'
export function verifyReleaseBudget(ledger,approved){
 assert.equal(ledger.version,3);assert.deepEqual(ledger.price,PRICE)
 let limits={limitUsd:30,testLimitUsd:5}
 for(const change of ledger.limitChanges??[]){
  assert.deepEqual(change.from,limits);assert.ok(typeof change.authorization==='string'&&change.authorization.trim())
  const next=change.to
  assert.ok(Number.isFinite(next?.limitUsd)&&Number.isFinite(next?.testLimitUsd)&&next.limitUsd>=limits.limitUsd&&next.testLimitUsd>=limits.testLimitUsd&&next.testLimitUsd<=next.limitUsd)
  limits=next
 }
 assert.deepEqual(limits,approved);assert.equal(ledger.limitUsd,limits.limitUsd);assert.equal(ledger.testLimitUsd,limits.testLimitUsd)
 let total=0,unknown=0,accepted=0;const perTest={}
 for(const row of Object.values(ledger.requests)){
  assert.ok(typeof row.testId==='string'&&row.testId);assert.ok(Number.isFinite(row.reservedUsd)&&row.reservedUsd>=0)
  assert.ok(['verified','unknown','historical-carry-forward'].includes(row.status),'Pending or unrecognized usage blocks publication')
  if(row.status==='verified'){
   assert.ok(validPaidUsage(row.usage));const u=row.usage
   const cost=((u.inputTokens+(u.cacheWriteTokens??0))*PRICE.input+(u.cacheReadTokens??0)*PRICE.cached+u.outputTokens*PRICE.output)/1e6
   assert.ok(Math.abs(cost-row.reservedUsd)<1e-9,'Known usage must retain its recorded price')
  }else if(row.status==='unknown'){
   unknown++;assert.equal(row.reservedUsd,REQUEST_RESERVE);assert.ok(!row.error)
   assert.ok(typeof row.reservationAcceptance?.authorization==='string'&&row.reservationAcceptance.authorization.trim())
   assert.equal(row.reservationAcceptance.upperBoundUsd,REQUEST_RESERVE);accepted++
  }else assert.ok(typeof row.sourceVersion==='string'&&row.sourceVersion,'Historical expense reservations need provenance')
  total+=row.reservedUsd;perTest[row.testId]=(perTest[row.testId]??0)+row.reservedUsd
 }
 assert.ok(total<=limits.limitUsd);for(const cost of Object.values(perTest))assert.ok(cost<=limits.testLimitUsd)
 return {limitUsd:limits.limitUsd,perTestLimitUsd:limits.testLimitUsd,costUpperBoundUsd:total,pendingRequests:0,unknownRequests:unknown,acceptedUnknownReservations:accepted,perTestCostUpperBoundUsd:perTest,accountingStatus:unknown?'bounded-unknown':'verified'}
}
