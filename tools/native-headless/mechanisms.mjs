/** Mechanism receipts are measured from durable state and on-disk records. */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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
export function mechanismReceipt(result,records) {
 const state=result.clearai??{},hypotheses=state.hypotheses??[],anomalies=state.anomalies??[]
 const required=[...hypotheses.filter(row=>!row.retests&&(state.evidence??[]).some(e=>e.hypothesis===row.id&&e.verdict==='refute')).map(row=>({kind:'hypothesis',id:row.id})),...anomalies.filter(row=>!(row.by==='evaluator'&&row.matters==='no')).map(row=>({kind:'anomaly',id:row.id}))]
 const covered=required.filter(row=>records.some(record=>record.storageCategory==='negatives'&&(record.source?.hypothesis===row.id||record.source?.anomaly===row.id)))
 const answers=state.goal?.answers??[]
 const actual=answers.flatMap(row=>(row.uses_review??[]).filter(use=>use.confirmed===true&&use.card_path&&use.digest&&(row.basis??[]).length))
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
 return {required:required.length,covered:covered.length,actualConfirmed:actual.length,finalReferences:answers.flatMap(row=>row.uses??[]),violations:{silent_closure:silent,unresolved_reference_completed:result.reason==='completed'&&invalidActual,duplicate_dispatch:duplicate.length>0},duplicate}
}

export function moistureOnlyExperiments(calls) {
 return calls.slice(1).filter((row,index)=>row.request.w!==calls[index].request.w&&['T','P','cat','t'].every(key=>row.request[key]===calls[index].request[key])).length
}
