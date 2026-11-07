import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

// Official peak USD rates checked 2026-11-06. Reserve a full 1M prompt plus
// 384K output for every request; disable adapter retries in the test profile.
export const PRICE = Object.freeze({ input: 0.3, cached: 0.006, output: 1.2, source: 'https://api-docs.deepseek.com/quick_start/pricing/', checked: '2026-11-06' })
export const REQUEST_RESERVE = 0.8
function lockBudget(file) {
 const lock=file+'.lock', deadline=Date.now()+5000
 while(true){
  try{mkdirSync(lock);return lock}catch(error){
   if(error.code!=='EEXIST'||Date.now()>=deadline)throw error
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10)
  }
 }
}
function validLimits(data){
 let previous={limitUsd:30,testLimitUsd:5}
 for(const change of data.limitChanges??[]){
  if(change.from?.limitUsd!==previous.limitUsd||change.from?.testLimitUsd!==previous.testLimitUsd||typeof change.authorization!=='string'||!change.authorization.trim())return false
  const next=change.to
  if(!Number.isFinite(next?.limitUsd)||!Number.isFinite(next?.testLimitUsd)||next.limitUsd<previous.limitUsd||next.testLimitUsd<previous.testLimitUsd||next.testLimitUsd>next.limitUsd)return false
  previous=next
 }
 return data.limitUsd===previous.limitUsd&&data.testLimitUsd===previous.testLimitUsd
}
export function raiseBudgetLimits(file,to,authorization){
 if(typeof authorization!=='string'||!authorization.trim())throw new Error('Explicit authorization required')
 const lock=lockBudget(file)
 try{
  const data=JSON.parse(readFileSync(file)),from={limitUsd:data.limitUsd,testLimitUsd:data.testLimitUsd}
  if(data.version!==3||!validLimits(data)||JSON.stringify(data.price)!==JSON.stringify(PRICE))throw new Error('Budget policy mismatch')
  if(Object.values(data.requests).some(r=>r.status==='pending'))throw new Error('Drain pending requests before budget increase')
  if(!Number.isFinite(to.limitUsd)||!Number.isFinite(to.testLimitUsd)||to.limitUsd<from.limitUsd||to.testLimitUsd<from.testLimitUsd||to.testLimitUsd>to.limitUsd||(to.limitUsd===from.limitUsd&&to.testLimitUsd===from.testLimitUsd))throw new Error('A bounded increase is required')
  const change={from,to,authorization,at:Date.now(),reservedBeforeUsd:Object.values(data.requests).reduce((n,r)=>n+r.reservedUsd,0)}
  data.limitChanges=[...(data.limitChanges??[]),change];Object.assign(data,to)
  const temporary=file+'.'+randomUUID();writeFileSync(temporary,JSON.stringify(data,null,2),{mode:0o600});renameSync(temporary,file)
  return change
 }finally{rmSync(lock,{recursive:true,force:true})}
}
export function doubleBudgetLimits(file, authorization){
 if(typeof authorization!=='string'||!authorization.trim())throw new Error('Explicit authorization required')
 const lock=lockBudget(file)
 try{
  const data=JSON.parse(readFileSync(file))
  if(data.version!==3||data.limitUsd!==30||data.testLimitUsd!==5||JSON.stringify(data.price)!==JSON.stringify(PRICE))throw new Error('Only the original limits may be doubled once')
  if(Object.values(data.requests).some(r=>r.status==='pending'))throw new Error('Drain pending requests before budget increase')
  const change={from:{limitUsd:30,testLimitUsd:5},to:{limitUsd:60,testLimitUsd:10},authorization,at:Date.now(),reservedBeforeUsd:Object.values(data.requests).reduce((n,r)=>n+r.reservedUsd,0)}
  data.limitChanges=[...(data.limitChanges??[]),change];data.limitUsd=60;data.testLimitUsd=10
  const temporary=file+'.'+randomUUID();writeFileSync(temporary,JSON.stringify(data,null,2),{mode:0o600});renameSync(temporary,file)
  return change
 }finally{rmSync(lock,{recursive:true,force:true})}
}
export function initializeBudget(file) {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, JSON.stringify({ version: 3, limitUsd: 30, testLimitUsd: 5, price: PRICE, requests: {} }), { flag: 'wx', mode: 0o600 })
}
export function campaignBudget(file) {
	if (!file || !existsSync(file)) throw new Error('Initialize CLEARAI_TEST_BUDGET_FILE before any paid run')
	const transact = operation => {
		const lock = lockBudget(file)
		try {
			const data = JSON.parse(readFileSync(file))
			if (data.version !== 3 || !validLimits(data) || JSON.stringify(data.price) !== JSON.stringify(PRICE)) throw new Error('Budget policy mismatch')
			const result = operation(data), temporary = file + '.' + randomUUID()
			writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 }); renameSync(temporary, file)
			return result
		} finally { rmSync(lock, { recursive: true, force: true }) }
	}
	return {
		acceptUnknownReservation(id, authorization) { return transact(data => {
			const row = data.requests[id]
			if (!row || row.status !== 'unknown' || row.error || row.reservedUsd !== REQUEST_RESERVE || typeof authorization !== 'string' || !authorization.trim()) throw new Error('Explicit authorization and intact reservation required')
			row.reservationAcceptance = { authorization, at: Date.now(), upperBoundUsd: REQUEST_RESERVE }
		}) },
		reserve(meta = {}) { return transact(data => {
			if (typeof meta.testId !== 'string' || !meta.testId.trim()) throw new Error('Stable testId required for per-test budget')
			if (Object.values(data.requests).some(row => row.status === 'unknown' && !(row.reservationAcceptance?.authorization && row.reservationAcceptance.upperBoundUsd === REQUEST_RESERVE && row.reservedUsd === REQUEST_RESERVE && !row.error))) throw new Error('Unverifiable paid usage: campaign stopped')
			const used = Object.values(data.requests).reduce((sum, row) => sum + row.reservedUsd, 0)
			if (used + REQUEST_RESERVE > data.limitUsd) throw new Error('Campaign budget exhausted')
			const testUsed = Object.values(data.requests).filter(row => row.testId === meta.testId).reduce((sum, row) => sum + row.reservedUsd, 0)
			if (testUsed + REQUEST_RESERVE > data.testLimitUsd) throw new Error('Per-test budget exhausted')
			const id = randomUUID(); data.requests[id] = { ...meta, startedAt: Date.now(), reservedUsd: REQUEST_RESERVE, status: 'pending' }; return id
		}) },
		settle(id, usage) { return transact(data => {
			const row = data.requests[id]; if (!row || row.status !== 'pending') throw new Error('Unknown or already settled request')
			if (!usage || ![usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0].every(value => Number.isFinite(value) && value >= 0)) { row.status = 'unknown'; return }
			const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
			const uncachedCostUpperBoundUsd = (input * PRICE.input + usage.outputTokens * PRICE.output) / 1e6
			const bound = ((usage.inputTokens + (usage.cacheWriteTokens ?? 0)) * PRICE.input + (usage.cacheReadTokens ?? 0) * PRICE.cached + usage.outputTokens * PRICE.output) / 1e6
			if (!Number.isFinite(bound) || bound < 0 || uncachedCostUpperBoundUsd > REQUEST_RESERVE) { row.status = 'unknown'; row.error = 'Usage exceeded reserved model capacity'; return }
			Object.assign(row, { usage, status: 'verified', finishedAt: Date.now(), reservedUsd: bound, costUpperBoundUsd: bound, uncachedCostUpperBoundUsd })
		}) },
	}
}

// Reconcile only verified provider usage. Unknown and in-flight reservations are never discounted.
export function migrateVerifiedCachePricing(file) {
 const lock=file+'.lock';mkdirSync(lock)
 try {
  const data=JSON.parse(readFileSync(file))
  if(data.version===3)return
  if(data.version!==2||data.limitUsd!==30||data.testLimitUsd!==5||JSON.stringify(data.price)!==JSON.stringify(PRICE))throw new Error('Budget policy mismatch')
  if(Object.values(data.requests).some(row=>row.status==='pending'))throw new Error('Drain pending requests before pricing migration')
  const previousCostUpperBoundUsd=Object.values(data.requests).reduce((n,row)=>n+row.reservedUsd,0)
  for(const row of Object.values(data.requests)) {
   if(row.status!=='verified')continue
   const u=row.usage
   if(!u||![u.inputTokens,u.outputTokens,u.cacheReadTokens??0,u.cacheWriteTokens??0].every(n=>Number.isFinite(n)&&n>=0))throw new Error('Invalid verified usage')
   const old=((u.inputTokens+(u.cacheReadTokens??0)+(u.cacheWriteTokens??0))*PRICE.input+u.outputTokens*PRICE.output)/1e6
   if(Math.abs(row.reservedUsd-old)>1e-9||old>REQUEST_RESERVE)throw new Error('Unexpected prior reservation')
   const bound=((u.inputTokens+(u.cacheWriteTokens??0))*PRICE.input+(u.cacheReadTokens??0)*PRICE.cached+u.outputTokens*PRICE.output)/1e6
   Object.assign(row,{uncachedCostUpperBoundUsd:old,costUpperBoundUsd:bound,reservedUsd:bound})
  }
  data.version=3;data.pricingMigration={at:Date.now(),previousCostUpperBoundUsd,basis:'Verified cache hits at published peak cache-read price; all pending/unknown capacity reservations unchanged'}
  const temporary=file+'.'+randomUUID();writeFileSync(temporary,JSON.stringify(data,null,2),{mode:0o600});renameSync(temporary,file)
 } finally {rmSync(lock,{recursive:true,force:true})}
}
