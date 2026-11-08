/** Paired, fresh-session knowledge construction/reuse/change case. No model judge. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,cpSync,lstatSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
import {runNative} from './run.mjs'
import {traceabilityCase,traceabilityScore} from './traceability.mjs'
import {initializeCampaignRoot} from './public-materials.mjs'
import {MODEL,stopReasons} from './matrix.mjs'
import {PRICE,REQUEST_RESERVE} from './budget.mjs'
import {usageSummary} from './accounting.mjs'
const [homeArg,rootArg,configArg]=process.argv.slice(2);assert.ok(homeArg&&rootArg&&configArg)
const config=JSON.parse(readFileSync(resolve(configArg))),baselineRoot=config.baselineRoot?resolve(config.baselineRoot):null
assert.ok(config.taskIdPrefix?.startsWith('evidence060:'));assert.ok(/^[a-f0-9]{40}$/.test(config.productCommit))
assert.ok(JSON.stringify(config.phases)==='[1]'||JSON.stringify(config.phases)==='[1,2,3]')
assert.ok(config.variants?.length&&config.variants.every(v=>['native','clearai'].includes(v))&&new Set(config.variants).size===config.variants.length)
const home=resolve(homeArg),root=resolve(rootArg),repo=resolve(import.meta.dirname,'../..'),json=p=>JSON.parse(readFileSync(p)),sha=v=>createHash('sha256').update(v).digest('hex')
const installation=json(join(home,'installation.json')),ledgerPath=process.env.CLEARAI_TEST_BUDGET_FILE;assert.ok(ledgerPath)
assert.deepEqual(installation.model,MODEL)
const limits=config.budgets??{tokenBudget:15000000,timeoutMs:10800000,testLimitUsd:12,campaignLimitUsd:60}
assert.ok(Number.isSafeInteger(limits.tokenBudget)&&limits.tokenBudget>0&&limits.tokenBudget<=100000000)
assert.ok(Number.isSafeInteger(limits.timeoutMs)&&limits.timeoutMs>0&&limits.timeoutMs<=14400000)
assert.ok(Number.isFinite(limits.testLimitUsd)&&limits.testLimitUsd>0&&limits.testLimitUsd<=limits.campaignLimitUsd)
const budget=json(ledgerPath);assert.equal(budget.limitUsd,limits.campaignLimitUsd);assert.equal(budget.testLimitUsd,limits.testLimitUsd)
const historicalUnknownReservations=Object.entries(budget.requests).filter(([,r])=>r.status==='unknown').map(([id,r])=>({id,reservedUsd:r.reservedUsd}))
assert.ok(Object.values(budget.requests).every(r=>['verified','historical-carry-forward'].includes(r.status)||(r.status==='unknown'&&!r.error&&r.reservedUsd===REQUEST_RESERVE&&r.reservationAcceptance?.authorization&&r.reservationAcceptance.upperBoundUsd===REQUEST_RESERVE)))
initializeCampaignRoot(root);mkdirSync(join(root,'.controller'))
let key,scenario,generationAttempts=0
if(baselineRoot){key=readFileSync(join(baselineRoot,'.controller/world-key'));scenario=traceabilityCase(key);const baseline=json(join(baselineRoot,'manifest.json'));assert.equal(sha(key),baseline.worldKeyCommitment);assert.equal(json(join(baselineRoot,'verification.json')).dataVerified,true)}else{
do {key=randomBytes(32);scenario=traceabilityCase(key);generationAttempts++} while(generationAttempts<100&&(scenario.expected(1).exposures.length<8||scenario.expected(2).exposures.length<2||scenario.expected(3).exposures.length<8))
}
assert.ok(scenario.expected(1).exposures.length>=8&&scenario.expected(2).exposures.length>=2&&scenario.expected(3).exposures.length>=8,'No nondegenerate case generated; no models started')
writeFileSync(join(root,'.controller/world-key'),key,{mode:0o600})
const probe=join(root,'.controller/sentinel');writeFileSync(probe,'Private controller\n',{mode:0o600})
const variants=config.variants,rows=variants.flatMap(variant=>config.phases.map(phase=>({id:variant+'-'+phase,variant,phase})))
assert.ok(scenario.expected(2).exposures.length>0,'Nonempty reuse query required; preserve this unrun world if unsuitable')
const assets=['budget.mjs','carrier.mjs','run.mjs','isolation.mjs','accounting.mjs','matrix.mjs','public-materials.mjs','traceability.mjs','compare-evidence-candidate.mjs'].map(path=>({path,sha256:sha(readFileSync(join(import.meta.dirname,path)))}))
mkdirSync(join(root,'.controller/harness'));for(const a of assets)cpSync(join(import.meta.dirname,a.path),join(root,'.controller/harness',a.path))
const manifest={schema:'clearai.traceability-comparison.v1',productCommit:config.productCommit,taskIdPrefix:config.taskIdPrefix,baselineRoot,pricingCheck:config.pricingCheck,rows,model:MODEL,installation:{digest:installation.packageDigest,runtime:installation.runtime,version:installation.version},budgets:limits,historicalUnknownReservations,costBeforeUsd:Object.values(budget.requests).reduce((n,r)=>n+r.reservedUsd,0),worldKeyCommitment:sha(key),generationAttempts,generationRule:'Before any model call: phase 1/3 at least 8 exposed shipments, phase 2 at least 2; at most 100 generated worlds. Never select by model outcome.',assets,tasks:[1,2,3].map(phase=>({phase,text:scenario.task(phase)})),initialHashes:Object.fromEntries(Object.entries(scenario.initial).map(([p,v])=>[p,sha(v)])),updateHashes:Object.fromEntries(Object.entries(scenario.updates).map(([p,v])=>[p,sha(v)])),policy:'Candidate verification uses the bounded limits recorded in budgets; prior spend and accepted unknown reservations are retained. Frozen regression is not a causal efficiency comparison because budget changed; fresh paired instance uses equal budgets. One synthetic case, 3 fresh sessions per variant. Same model, input bytes, tools and budgets; only preset differs. Both may persist notes, scripts and structured knowledge. Native is DSH default, not a text-only model. Variants run concurrently; phases are sequential and retain prior workspace. No quality reruns. If a foundation task fails, later stages are skipped for that variant. Raw graph structure is not independent knowledge. Warm follow-up demonstrates use but without a cold ablation cannot quantify causal reuse savings.'}
writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
const results=new Map(),save=()=>writeFileSync(join(root,'comparison.json'),JSON.stringify({complete:results.size===rows.length,results:rows.filter(r=>results.has(r.id)).map(r=>results.get(r.id))},null,2)+'\n');save()
const writeInputs=(ws,files)=>{for(const [path,data] of Object.entries(files)){mkdirSync(dirname(join(ws,path)),{recursive:true});writeFileSync(join(ws,path),data)}}
const filesUnder=(dir,prefix='')=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesUnder(join(dir,e.name),prefix+e.name+'/'):e.isFile()?[prefix+e.name]:[]):[]
const outcomes=await Promise.allSettled(variants.map(async variant=>{
 const workspace=join(root,'workspaces',variant);mkdirSync(workspace,{recursive:true});writeInputs(workspace,scenario.initial)
 let blocked=false
 for(const row of rows.filter(r=>r.variant===variant)){
  if(blocked){results.set(row.id,{...row,reason:'foundation_failed',taskSucceeded:false,costUsd:0,usage:null});save();continue}
  for(const a of assets)assert.equal(sha(readFileSync(join(import.meta.dirname,a.path))),a.sha256,'Harness changed during paid comparison')
  if(row.phase===2)writeInputs(workspace,{'query.json':JSON.stringify(scenario.query,null,2)})
  if(row.phase===3)writeInputs(workspace,scenario.updates)
  const priorFiles=Object.fromEntries(filesUnder(workspace).filter(p=>!p.startsWith('data/')&&!p.startsWith('.')).map(p=>[p,sha(readFileSync(join(workspace,p)))]))
  const output=join(root,'runs',row.id)
  const result=await runNative({home,profile:installation.profile,workspace,spec:{group:variant==='native'?'A':'C',mode:variant==='native'?'default':'clearai',task:scenario.task(row.phase),tokenBudget:limits.tokenBudget,timeoutMs:limits.timeoutMs,testId:config.taskIdPrefix+row.id,output,isolation:{roots:[root,...(config.isolationRoots??[]),...(baselineRoot?[baselineRoot]:[]),repo,home,'/tmp/clearai060-double-comparison','/tmp/clearai060-incremental-comparison-live','/tmp/clearai060-review-boundary-aligned','/tmp/clearai060-incremental-final','/tmp/clearai059-vs060-fixed','/tmp/clearai059-fixed-comparison-home'],probe}}})
  let submission=null,graph=null;try{submission=json(join(workspace,'submission.json'))}catch{}try{graph=json(join(workspace,'artifacts/graph.json'))}catch{}
  const calls=readFileSync(join(output,'llm-calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),roles={}
  for(const c of calls){const role=roles[c.role??'other']??={calls:0,processed:0,output:0,requestMs:0,costUsd:0},u=c.usage??{};role.calls++;role.processed+=(u.inputTokens??0)+(u.outputTokens??0)+(u.cacheReadTokens??0)+(u.cacheWriteTokens??0);role.output+=u.outputTokens??0;role.requestMs+=(c.finished??c.started)-c.started;role.costUsd+=((u.inputTokens??0)+(u.cacheWriteTokens??0))*PRICE.input/1e6+(u.cacheReadTokens??0)*PRICE.cached/1e6+(u.outputTokens??0)*PRICE.output/1e6}
  const snapshots=join(root,'snapshots',row.id);mkdirSync(snapshots,{recursive:true})
  // Owned synthetic workspace only. Never copy model session logs or credentials.
  for(const path of ['data','artifacts','analysis','report','knowledge','clear/knowledge','clear/ontology','clear/evidence/audits','submission.json','query.json'])if(existsSync(join(workspace,path)))cpSync(join(workspace,path),join(snapshots,path),{recursive:true,filter:src=>!lstatSync(src).isSymbolicLink()})
  const sourceHashes=Object.fromEntries(filesUnder(join(workspace,'data')).map(p=>['data/'+p,sha(readFileSync(join(workspace,'data',p)))]))
  const sourceExpected={...manifest.initialHashes,...(row.phase===3?manifest.updateHashes:{})}
  const sourcesIntact=Object.entries(sourceExpected).every(([p,h])=>sourceHashes[p]===h)
  const taskSucceeded=result.reason==='completed'&&(variant==='native'||result.clearai?.goal?.status==='achieved')
  const summary={...row,reason:result.reason,taskSucceeded,goalStatus:result.clearai?.goal?.status??null,elapsedMs:result.elapsedMs,usage:result.usage,accountedUsage:usageSummary(calls),roles,costUsd:Object.values(roles).reduce((n,r)=>n+r.costUsd,0),submission,score:traceabilityScore(scenario.expected(row.phase),submission,graph),graph:{concepts:graph?.concepts?.length??0,relations:graph?.relations?.length??0,entities:graph?.entities?.length??0,edges:graph?.edges?.length??0},nativeKnowledge:{concepts:result.clearai?.lexicon?.terms?.length??0,entities:result.clearai?.entities?.length??0,facts:result.clearai?.facts?.length??0,ontologyProblems:result.clearai?.ontologyProblems??[]},audits:(result.clearai?.audits??[]).map(a=>({id:a.id,kind:a.kind,holds:a.holds??null,child:a.child??null,results:a.results})),priorFiles,sourceHashes,sourcesIntact,violations:stopReasons(result)}
  results.set(row.id,summary);save();console.log(JSON.stringify({id:row.id,reason:summary.reason,taskSucceeded,seconds:Math.round(summary.elapsedMs/1000),tokens:summary.usage?.processed,costUsd:summary.costUsd,score:summary.score,facts:summary.nativeKnowledge.facts}))
  if(!taskSucceeded||summary.violations.length||!sourcesIntact)blocked=true
 }
}))

for(let i=0;i<outcomes.length;i++)if(outcomes[i].status==='rejected'){const variant=variants[i];for(const row of rows.filter(r=>r.variant===variant&&!results.has(r.id)))results.set(row.id,{...row,reason:'controller_error',taskSucceeded:false,error:String(outcomes[i].reason?.message??outcomes[i].reason),usage:null,costUsd:null});save();process.exitCode=1}
