/** Mechanism receipts are measured from durable state and on-disk records. */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {compareScope} from '../../preset/plugins/scope.js'
export function knowledgeRecords(workspace) {
 const rows=[]
 for(const kind of ['facts','negatives','lessons']) {
  const dir=join(workspace,'clear/knowledge',kind)
  if(!existsSync(dir))continue
  for(const name of readdirSync(dir).filter(name=>name.endsWith('.json'))) {
   const path=join(dir,name)
   try{rows.push({...JSON.parse(readFileSync(path)),storageCategory:kind,path:'clear/knowledge/'+kind+'/'+name})}
   catch{throw new Error('Unreadable persisted knowledge: '+path)}
  }
 }
 return rows
}
export function mechanismReceipt(result,records,previousRecords=[]) {
 const state=result.clearai??{},hypotheses=state.hypotheses??[],anomalies=state.anomalies??[]
 const required=[...hypotheses.filter(row=>!row.retests&&(state.evidence??[]).some(e=>e.hypothesis===row.id&&e.verdict==='refute')).map(row=>({kind:'hypothesis',id:row.id})),...anomalies.filter(row=>!(row.by==='evaluator'&&row.matters==='no')).map(row=>({kind:'anomaly',id:row.id}))]
 if(result.reason==='completed') {
  const supported=new Set((state.audits??[]).flatMap(audit=>(audit.results??[]).filter(row=>row.verdict==='support').map(row=>row.hypothesis)))
  for(const hypothesis of hypotheses)if(supported.has(hypothesis.id)&&!hypothesis.retests&&!(state.evidence??[]).some(row=>row.hypothesis===hypothesis.id&&row.verdict==='refute'))required.push({kind:'fact',id:hypothesis.id})
  for(const lesson of state.lessons??[])required.push({kind:'lesson',id:lesson.id})
 }
 const covered=required.filter(row=>records.some(record=>row.kind==='fact'?record.storageCategory==='facts'&&record.hypothesis===row.id:row.kind==='lesson'?record.storageCategory==='lessons'&&record.id===row.id:record.storageCategory==='negatives'&&(record.source?.hypothesis===row.id||record.source?.anomaly===row.id)))
 const answers=state.goal?.answers??[]
 const actual=answers.flatMap(row=>(row.uses_review??[]).filter(use=>(row.uses??[]).includes(use.id)&&use.confirmed===true&&use.card_path&&use.digest&&(row.basis??[]).length))
 const audits=state.audits??[],seen=new Map(),duplicate=[]
 for(const audit of audits) {
  const key=JSON.stringify([audit.step,audit.digest])
  if(!audit.digest)continue
  const previous=seen.get(key)
  if(previous&&previous.card_path&&['yes','no','unclear'].includes(previous.holds??previous.verdict))duplicate.push(key)
  seen.set(key,audit)
 }
 const silent=result.reason==='completed'&&anomalies.some(row=>row.status==='open'&&row.matters!=='no')
 const invalidActual=answers.some(row=>(row.uses??[]).some(id=>{
  const knowledge=records.find(item=>item.id===id)
  return !knowledge||knowledge.review?.decision==='retracted'||knowledge.rechecks?.some(reason=>reason.status==='pending')
 }))
 const pendingRestored=previousRecords.some(old=>{
  const next=records.find(row=>row.id===old.id)
  return (old.rechecks??[]).filter(reason=>reason.status==='pending').some(reason=>{
   const current=next?.rechecks?.find(row=>row.id===reason.id)
   return !current||(current.status!=='pending'&&!(current.status==='resolved'&&(['user','human','independent'].includes(current.resolution?.by))&&(current.resolution.by!=='independent'||current.resolution.card_path)))
  })
 })
 const outsideRetraction=previousRecords.some(old=>{
  const next=records.find(row=>row.id===old.id)
  const wasRetracted=old.status==='retracted'||old.review?.decision==='retracted',nowRetracted=next?.status==='retracted'||next?.review?.decision==='retracted'
  return !wasRetracted&&nowRetracted&&['out_of_scope','out_of_range'].includes(compareScope(old.scope_spec,{conditions:state.goal?.conditions??{}}).verdict)
 })
 const cardFailures=audits.filter(row=>row.shortfalls?.includes('card_persist_failed')).length
 return {required:required.length,covered:covered.length,actualConfirmed:actual.length,finalReferences:answers.flatMap(row=>row.uses??[]),violations:{silent_closure:silent,unresolved_reference_completed:result.reason==='completed'&&invalidActual,duplicate_dispatch:duplicate.length>0,pending_restored_without_review:pendingRestored,outside_historical_retraction:outsideRetraction,repeated_card_failure:cardFailures>=2},duplicate}
}

export function moistureOnlyExperiments(calls) {
 return calls.slice(1).filter((row,index)=>row.request.w!==calls[index].request.w&&['T','P','cat','t'].every(key=>row.request[key]===calls[index].request[key])).length
}
