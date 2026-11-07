/** Independent public-record arithmetic, accounting and provenance verification. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {traceabilityCase,traceabilityScore} from './native-headless/traceability.mjs'
import {usageSummary} from './native-headless/accounting.mjs'
import {PRICE} from './native-headless/budget.mjs'
import {stopReasons} from './native-headless/matrix.mjs'
const root=resolve(process.argv[2]),json=p=>JSON.parse(readFileSync(p)),sha=v=>createHash('sha256').update(v).digest('hex')
const csv=(dir,path)=>{if(!existsSync(join(dir,path)))return [];const [head,...lines]=readFileSync(join(dir,path),'utf8').trim().split('\n');const keys=head.split(',');return lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[keys[i],v])))}
export function publicDecision(dir,phase){
 const notice=json(join(dir,phase===3?'data/notice-v2.json':'data/notice-v1.json')),cutoff=notice.effective
 const records=csv(dir,'data/material_usage.csv'),corrections=new Map(csv(dir,'data/usage-corrections.csv').filter(r=>r.effective<=cutoff).map(r=>[r.usage_id,r.lot_id]))
 const affected=new Set(records.filter(r=>notice.suspect_lots.includes(corrections.get(r.usage_id)??r.lot_id)).map(r=>r.batch_id))
 const products=new Map(csv(dir,'data/production_batches.csv').map(r=>[r.batch_id,r.product_id]))
 for(const r of [...csv(dir,'data/reworks.csv'),...csv(dir,'data/new-reworks.csv')])if(r.approved==='yes'&&r.completed_on<=cutoff&&products.get(r.batch_id)!==notice.rework_release_exception_product)affected.delete(r.batch_id)
 const current={};for(const r of [...csv(dir,'data/shipments.csv'),...csv(dir,'data/new-shipments.csv')])if(!current[r.shipment_id]||Number(r.record_version)>Number(current[r.shipment_id].record_version))current[r.shipment_id]=r
 const pieces=r=>Number(r.quantity)*(r.unit==='pack'?Number(r.pack_size):1),returned={}
 for(const r of csv(dir,'data/returns.csv'))if(r.date<=cutoff)returned[r.shipment_id]=(returned[r.shipment_id]??0)+pieces(r)
 const query=phase===2?json(join(dir,'query.json')):null,exposures=[]
 for(const r of Object.values(current))if(affected.has(r.batch_id)&&r.status==='shipped'&&r.shipped_on<=cutoff&&(!query||(query.customers.includes(r.customer_id)&&query.products.includes(products.get(r.batch_id)))))exposures.push({shipment_id:r.shipment_id,customer_id:r.customer_id,batch_id:r.batch_id,net_units:pieces(r)-(returned[r.shipment_id]??0)})
 exposures.sort((a,b)=>a.shipment_id.localeCompare(b.shipment_id));const customer_totals={};for(const r of exposures)customer_totals[r.customer_id]=(customer_totals[r.customer_id]??0)+r.net_units
 return {notice:notice.id,cutoff,quarantined_batches:[...affected].sort(),exposures,customer_totals}
}
try {
 const manifest=json(join(root,'manifest.json')),comparison=json(join(root,'comparison.json'));assert.equal(comparison.complete,true);assert.equal(comparison.results.length,manifest.rows.length)
 const key=readFileSync(join(root,'.controller/world-key'));assert.equal(sha(key),manifest.worldKeyCommitment)
 for(const a of manifest.assets)assert.equal(sha(readFileSync(existsSync(join(root,'.controller/harness',a.path))?join(root,'.controller/harness',a.path):join(import.meta.dirname,'native-headless',a.path))),a.sha256)
 const scenario=traceabilityCase(key),ledger=json(process.env.CLEARAI_TEST_BUDGET_FILE),requests=Object.values(ledger.requests),seen=new Set(),rows=[]
 assert.equal(ledger.limitUsd,60);assert.equal(ledger.testLimitUsd,manifest.budgets.testLimitUsd);assert.equal(requests.filter(r=>r.status==='pending').length,0)
 for(const row of comparison.results){
  if(row.reason==='foundation_failed'){assert.equal(row.costUsd,0);rows.push(row);continue}
  assert.notEqual(row.reason,'controller_error')
  const run=join(root,'runs',row.id),snapshot=join(root,'snapshots',row.id),result=json(join(run,'launcher-result.json'))
  assert.equal(result.installation.packageDigest,manifest.installation.digest);assert.deepEqual(result.model,manifest.model);assert.deepEqual(stopReasons(result),[])
  assert.equal(result.mount.prompt,row.variant==='clearai');assert.equal(result.mount.tools,row.variant==='clearai');assert.equal(json(join(run,'isolation-probe.json')).passed,true)
  assert.equal(result.reason,row.reason);assert.equal(result.elapsedMs,row.elapsedMs);assert.equal(row.sourcesIntact,true)
  for(const [p,h] of Object.entries({...manifest.initialHashes,...(row.phase===3?manifest.updateHashes:{})}))assert.equal(sha(readFileSync(join(snapshot,p))),h)
  if(row.phase===2)assert.deepEqual(json(join(snapshot,'query.json')),scenario.query)
  const gold=scenario.expected(row.phase),decision=publicDecision(snapshot,row.phase);for(const k of Object.keys(decision))assert.deepEqual(decision[k],gold[k])
  let graph=null;try{graph=json(join(snapshot,'artifacts/graph.json'))}catch{}
  assert.deepEqual(traceabilityScore(gold,row.submission,graph),row.score)
  const calls=readFileSync(join(run,'llm-calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),usage=usageSummary(calls)
  assert.equal(usage.status,'verified');assert.deepEqual(usage,result.usage);assert.deepEqual(usage,row.usage);assert.deepEqual(usage,row.accountedUsage)
  const auditors=new Set((result.clearai?.audits??[]).map(a=>a.child).filter(Boolean));let cost=0,parentRequestsWhileWaiting=0
  for(const c of calls){assert.ok(c.budgetId&&!seen.has(c.budgetId));seen.add(c.budgetId);const r=ledger.requests[c.budgetId];assert.equal(r.status,'verified');assert.equal(r.testId,(manifest.taskIdPrefix??'trace060:')+row.id);assert.deepEqual(r.usage,c.usage);cost+=r.reservedUsd;if(c.role==='evaluator')assert.ok(auditors.has(c.session));if(c.role==='main')assert.equal(c.session,result.session)}
  assert.equal(requests.filter(r=>r.testId===(manifest.taskIdPrefix??'trace060:')+row.id).length,calls.length);assert.ok(Math.abs(cost-row.costUsd)<1e-9)
  for(const [role,stats] of Object.entries(row.roles)){const cs=calls.filter(c=>c.role===role);assert.equal(cs.length,stats.calls);assert.equal(usageSummary(cs).processed,stats.processed);const cost=cs.reduce((n,c)=>{const u=c.usage;return n+((u.inputTokens??0)+(u.cacheWriteTokens??0))*PRICE.input/1e6+(u.cacheReadTokens??0)*PRICE.cached/1e6+(u.outputTokens??0)*PRICE.output/1e6},0);assert.ok(Math.abs(cost-stats.costUsd)<1e-9)}
  for(const child of auditors){const cs=calls.filter(c=>c.session===child);if(cs.length){const start=Math.min(...cs.map(c=>c.started)),end=Math.max(...cs.map(c=>c.finished));parentRequestsWhileWaiting+=calls.filter(c=>c.role==='main'&&c.started>start&&c.started<end).length}}
  assert.equal(parentRequestsWhileWaiting,0)
  const provenance=(actual,expected,key)=>{const index=new Map(expected.map(e=>[key(e),e.evidence]));let canonicalSourceCitations=0,locatable=0;for(const row of Array.isArray(actual)?actual:[]){if(!row||typeof row!=='object')continue;const source=index.get(key(row)),refs=Array.isArray(row.evidence)?row.evidence:[];if(refs.some(r=>r.path===source?.path&&r.row===source?.row))canonicalSourceCitations++;if(refs.some(r=>{const p=resolve(snapshot,String(r.path));return p.startsWith(snapshot+'/data/')&&existsSync(p)&&Number.isInteger(r.row)&&r.row>=(p.endsWith('.csv')?2:1)&&r.row<=readFileSync(p,'utf8').trim().split('\n').length}))locatable++}return {canonicalSourceCitations,locatable}}
  const types=['supplier','plant','line','product','customer','material_lot','production_batch','shipment']
  const relations=[['supplied_by','material_lot','supplier'],['located_at','line','plant'],['uses_lot','production_batch','material_lot'],['produced_on','production_batch','line'],['produces','production_batch','product'],['from_batch','shipment','production_batch'],['delivered_to','shipment','customer']]
  const ontologySchema={definedTypes:types.filter(id=>graph?.concepts?.some(c=>c.id===id&&typeof c.definition==='string'&&c.definition.trim())).length,typedRelations:relations.filter(([id,domain,range])=>graph?.relations?.some(r=>r.id===id&&r.domain===domain&&r.range===range&&typeof r.definition==='string'&&r.definition.trim())).length,expectedTypes:types.length,expectedRelations:relations.length}
  const entityKey=e=>e.id+'|'+e.type,edgeKey=e=>e.subject+'|'+e.predicate+'|'+e.object
  const priorReports=Object.entries(row.priorFiles).filter(([p])=>/^report\/phase-[12]\.md$/.test(p));const historyPreserved=priorReports.every(([p,h])=>existsSync(join(snapshot,p))&&sha(readFileSync(join(snapshot,p)))===h)
  const declarations=(row.submission?.reused_artifacts??[]).map(path=>({path,existedBefore:Object.hasOwn(row.priorFiles,path)}))
  const publicToolActivity=[]
  for(const log of result.logs??[]){for(const event of readFileSync(join(run,log.path),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse))if(event.type==='tool/call'&&['read','bash','ReadEvidence'].includes(event.data?.name)){let args;try{args=JSON.parse(event.data.arguments)}catch{continue}const command=String(args.command??''),path=args.file_path??args.path??null;if(['analysis/','artifacts/','clear/knowledge/'].some(prefix=>command.includes(prefix)||String(path).startsWith(prefix)))publicToolActivity.push({session:log.session,role:log.session===result.session?'main':auditors.has(log.session)?'evaluator':'other',tool:event.data.name,path,description:args.description??null,command:command.slice(0,1000)})}}
  const factDir=join(snapshot,'clear/knowledge/facts'),storedFacts=existsSync(factDir)?readdirSync(factDir).filter(p=>p.endsWith('.json')).map(p=>json(join(factDir,p))).map(f=>({id:f.id,text:f.text,scope:f.scope_spec,assertions:f.assertions,evidence:f.evidence})):[]
  const internalEntities=result.clearai?.entities??[],internalAssertions=result.clearai?.entityAssertions??[]
  const entityTypes={};for(const entity of internalEntities)entityTypes[entity.type]=(entityTypes[entity.type]??0)+1
  const coreGraph={entities:internalEntities,edges:internalAssertions.filter(a=>a.object?.kind==='instance').map(a=>({subject:a.subject?.id,predicate:a.predicate,object:a.object?.value}))}
  const coreScore=traceabilityScore(gold,null,coreGraph)
  const internalKnowledge={entityTypes,storedFacts:storedFacts.length,storedFactAssertions:storedFacts.reduce((n,f)=>n+(f.assertions?.length??0),0),assertions:internalAssertions.length,coreEntities:coreScore.entities,coreRelations:coreScore.edges,interpretation:'Internal extras can include notices, returns, reworks and hypotheses. Core recall is coverage; all-object precision counts legitimate extra types and is not an error rate. Backreferences alone are not independent certification.'}
  const evidenceReads={main:{calls:0,sources:0,unchangedRanges:0,omittedChars:0,origins:{}},evaluator:{calls:0,sources:0,unchangedRanges:0,omittedChars:0,origins:{}}}
  for(const log of result.logs??[]){
   const role=log.session===result.session?'main':auditors.has(log.session)?'evaluator':null;if(!role)continue
   const pending=new Set()
   for(const event of readFileSync(join(run,log.path),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)){
    if(event.type==='tool/call'&&event.data?.name==='ReadEvidence')pending.add(event.data.id??event.data.callId)
    if(event.type!=='tool/result')continue
    const message=event.data?.message
    if(!pending.has(message?.toolCallId))continue
    pending.delete(message.toolCallId)
    for(const block of message.content??[]){if(block.type!=='text')continue;let value;try{value=JSON.parse(block.text)}catch{continue}if(!Array.isArray(value.sources))continue
     const stats=evidenceReads[role];stats.calls++
     for(const source of value.sources){if(source.error)continue;stats.sources++;if(source.unchanged){stats.unchangedRanges++;stats.omittedChars+=source.omittedChars??0}const origin=source.sourceOrigin??'unknown';stats.origins[origin]=(stats.origins[origin]??0)+1}
    }
   }
  }
  const facts=result.clearai?.facts??[];for(const fact of facts){const stored=json(join(snapshot,'clear/knowledge/facts',fact.id+'.json'));assert.equal(stored.text,fact.text);assert.deepEqual(stored.scope_spec,fact.scope_spec)}
  rows.push({...row,ontologySchema,internalKnowledge,storedFacts,evidenceReads,parentRequestsWhileWaiting,provenance:{entities:provenance(graph?.entities,gold.entities,entityKey),edges:provenance(graph?.edges,gold.edges,edgeKey)},historyPreserved,reuseDeclarations:declarations,publicToolActivity,facts:facts.map(f=>({id:f.id,text:f.text,scope:f.scope_spec,assertions:f.assertions,evidence:f.evidence})),knowledgeLimits:'Exported graph provenance/accuracy and independent certification are separate. Script/tool activity is behavioral evidence, not a cold-ablation estimate of savings.'})
 }
 const currentCostUsd=rows.reduce((n,r)=>n+r.costUsd,0),cumulativeReservedUsd=requests.reduce((n,r)=>n+r.reservedUsd,0)
 assert.ok(Math.abs(cumulativeReservedUsd-manifest.costBeforeUsd-currentCostUsd)<1e-8)
 const unknown=requests.filter(r=>r.status==='unknown');assert.equal(unknown.length,1);assert.equal(unknown[0].reservedUsd,0.8);assert.ok(unknown[0].reservationAcceptance?.authorization)
 const receipt={dataVerified:true,allTasksCompleted:rows.every(r=>r.taskSucceeded),releaseRecommended:false,budget:{previousReservedUsd:manifest.costBeforeUsd,currentCostUsd,cumulativeReservedUsd,historicalUnknownReservationUsd:0.8,pending:0,newUnknown:0},rows}
 writeFileSync(join(root,'verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({dataVerified:true,budget:receipt.budget,rows:rows.map(r=>({id:r.id,completed:r.taskSucceeded,exact:r.score?.decisionExact,entities:r.score?.entities,edges:r.score?.edges,seconds:Math.round(r.elapsedMs/1000),tokens:r.usage?.processed,costUsd:r.costUsd,facts:r.nativeKnowledge?.facts}))}))
}catch(error){writeFileSync(join(root,'verification.json'),JSON.stringify({dataVerified:false,error:String(error.message)},null,2)+'\n');throw error}
