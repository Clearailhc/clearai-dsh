/** Fresh paired tasks under explicitly doubled budgets; every outcome is retained. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,readdirSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
import {runNative} from './run.mjs'
import {makeWorld,experimentService,score} from './world.mjs'
import {MODEL,stopReasons} from './matrix.mjs'
import {PRICE,REQUEST_RESERVE} from './budget.mjs'
import {usageSummary} from './accounting.mjs'
import {initializeCampaignRoot} from './public-materials.mjs'
const [beforeArg,afterArg,rootArg]=process.argv.slice(2)
assert.ok(rootArg,'Usage: compare-double.mjs <previous candidate home> <current candidate home> <new root>')
const root=resolve(rootArg),repo=resolve(import.meta.dirname,'../..'),assets=import.meta.dirname,json=p=>JSON.parse(readFileSync(p)),sha=b=>createHash('sha256').update(b).digest('hex')
const homes={before:resolve(beforeArg),after:resolve(afterArg),bare:resolve(afterArg)},installations=Object.fromEntries(Object.entries(homes).map(([k,h])=>[k,json(join(h,'installation.json'))]))
for(const i of Object.values(installations))assert.deepEqual(i.model,MODEL)
assert.notEqual(installations.before.packageDigest,installations.after.packageDigest)
const ledger=process.env.CLEARAI_TEST_BUDGET_FILE;assert.ok(ledger)
const budget=json(ledger);assert.equal(budget.limitUsd,60);assert.equal(budget.testLimitUsd,10)
assert.ok(Object.values(budget.requests).every(r=>['verified','historical-carry-forward'].includes(r.status)||(r.status==='unknown'&&!r.error&&r.reservedUsd===REQUEST_RESERVE&&r.reservationAcceptance?.authorization&&r.reservationAcceptance.upperBoundUsd===REQUEST_RESERVE)))
initializeCampaignRoot(root);mkdirSync(join(root,'.controller'))
const key=randomBytes(32),probe=join(root,'.controller/sentinel');writeFileSync(join(root,'.controller/world-key'),key,{mode:0o600});writeFileSync(probe,'Private comparison controller\n',{mode:0o600})
const rows=['additive','interaction'].flatMap(task=>['bare','before','after'].map(variant=>({id:task+'-'+variant,task,variant,group:variant==='bare'?'A':'C',mode:variant==='bare'?'default':'clearai'})))
const taskText='依据 initial.json 优化 x,y∈[0,1] 的收率，杂质不得超过0.115。允许使用 method/ 通用脚本和说明。用 python3 experiment.py quick|full|calibrate --x X --y Y --output lab/N.json 做实验，成本1/3/2，总预算60单位。保留原始读数，验证后把最终 {"x":数值,"y":数值,"evidence":["路径"]} 写 submission.json，报告参数、仪表口径和局限，完成任务。'
const bound=['budget.mjs','carrier.mjs','run.mjs','world.mjs','accounting.mjs','matrix.mjs','experiment.py',...readdirSync(join(assets,'method')).map(p=>'method/'+p),'compare-double.mjs'].map(path=>({path,sha256:sha(readFileSync(join(assets,path)))}))
const manifest={schema:'clearai.double-comparison.v1',authorization:'2026-11-07 user: 效果怎样？预算统一x2看看',rows,model:MODEL,installations:Object.fromEntries(Object.entries(installations).map(([k,i])=>[k,{version:i.version,digest:i.packageDigest,model:i.model,runtime:i.runtime}])),task:taskText,budgets:{tokenBudget:10000000,timeoutMs:10800000,experimentBudget:60,testLimitUsd:10,campaignLimitUsd:60},worldKeyCommitment:sha(key),seedPrefix:'double-060-',assets:bound,costBeforeUsd:Object.values(budget.requests).reduce((n,r)=>n+r.reservedUsd,0),policy:'Fresh hidden worlds; identical inputs and model per task across bare/prior/current. Six isolated concurrent sessions, one sample each; API contention affects timing. No quality-based retries. Prior charges and the accepted unknown reservation remain. Report all failures and distinguish artifact quality from goal completion. No causal separation of each individual code change.'}
writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
const results=new Map(),checkpoint=()=>writeFileSync(join(root,'comparison.json'),JSON.stringify({complete:results.size===rows.length,results:rows.filter(r=>results.has(r.id)).map(r=>results.get(r.id))},null,2)+'\n')
checkpoint()
await Promise.all(rows.map(async row=>{
 for(const a of bound)assert.equal(sha(readFileSync(join(assets,a.path))),a.sha256,'Frozen harness changed: '+a.path)
 const workspace=join(root,'workspaces',row.id),output=join(root,'runs',row.id);mkdirSync(workspace,{recursive:true})
 copyFileSync(join(assets,'experiment.py'),join(workspace,'experiment.py'));cpSync(join(assets,'method'),join(workspace,'method'),{recursive:true})
 const world=makeWorld(key,manifest.seedPrefix+row.task,row.task),service=await experimentService(world,{budget:60})
 writeFileSync(join(workspace,'initial.json'),JSON.stringify({observations:service.initial,bounds:[[0,1],[0,1]],noise_sd:world.noise,impurity_limit:.115,remaining_budget:60},null,2))
 const initialSha256=sha(readFileSync(join(workspace,'initial.json')))
 writeFileSync(join(workspace,'experiment-endpoint.json'),JSON.stringify({endpoint:service.endpoint,token:service.token}))
 const installation=installations[row.variant]
 let result
 try{result=await runNative({home:homes[row.variant],profile:installation.profile,workspace,spec:{group:row.group,mode:row.mode,tokenBudget:10000000,timeoutMs:10800000,testId:'double060:'+row.id,output,task:taskText,isolation:{roots:[root,repo,...new Set(Object.values(homes)),'/tmp/clearai060-incremental-comparison-live','/tmp/clearai059-vs060-fixed','/tmp/clearai059-fixed-comparison-home'],probe}}})}
 catch(error){result={reason:'infrastructure_error',error:String(error.message),usage:{status:'unknown'}}}
 finally{await service.close()}
 let submission=null;try{submission=json(join(workspace,'submission.json'))}catch{}
 const calls=existsSync(join(output,'llm-calls.jsonl'))?readFileSync(join(output,'llm-calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[],roles={}
 for(const call of calls){const stats=roles[call.role??'other']??={calls:0,processed:0,output:0,requestMs:0,costUsd:0};const u=call.usage??{};stats.calls++;stats.processed+=(u.inputTokens??0)+(u.outputTokens??0)+(u.cacheReadTokens??0)+(u.cacheWriteTokens??0);stats.output+=u.outputTokens??0;stats.requestMs+=call.finished?call.finished-call.started:0;stats.costUsd+=((u.inputTokens??0)+(u.cacheWriteTokens??0))*PRICE.input/1e6+(u.cacheReadTokens??0)*PRICE.cached/1e6+(u.outputTokens??0)*PRICE.output/1e6}
 const summary={...row,reason:result.reason,error:result.error??null,goalStatus:result.clearai?.goal?.status??null,elapsedMs:result.elapsedMs,usage:result.usage,accountedUsage:usageSummary(calls),roles,costUsd:Object.values(roles).reduce((n,r)=>n+r.costUsd,0),initialSha256,submission,artifactQuality:score(world,submission),completionQuality:score(world,result.reason==='completed'?submission:null),facts:(result.clearai?.facts??[]).map(f=>({id:f.id,hypothesis:f.hypothesis,text:f.text,scope:f.scope_spec,assertions:f.assertions})),ontology:{concepts:result.clearai?.ontology?.concepts?.length??result.clearai?.lexicon?.terms?.length??0,entities:result.clearai?.entities?.length??0},audits:(result.clearai?.audits??[]).map(a=>({id:a.id,kind:a.kind,step:a.step,holds:a.holds??null,status:a.status??null,child:a.child??null,shortfalls:a.shortfalls,results:a.results})),experimentCost:service.spent,violations:stopReasons(result)}
 results.set(row.id,summary);checkpoint();console.log(JSON.stringify({id:row.id,reason:summary.reason,seconds:Math.round((summary.elapsedMs??0)/1000),tokens:summary.usage?.processed,facts:summary.facts.length,score:summary.artifactQuality.score,costUsd:summary.costUsd,violations:summary.violations}))
}))
