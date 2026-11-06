/** Fixed-input historical comparison: add the released preset without rerunning selected candidate outcomes. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { runNative } from './native-headless/run.mjs'
import { makeWorld, experimentService, score } from './native-headless/world.mjs'
import { MODEL, BUDGETS, stopReasons } from './native-headless/matrix.mjs'
import { PRICE, REQUEST_RESERVE } from './native-headless/budget.mjs'
import { initializeCampaignRoot } from './native-headless/public-materials.mjs'
const [priorArg,homeArg,rootArg]=process.argv.slice(2)
assert.ok(rootArg,'Usage: compare-release-baseline.mjs <prior completed trial> <installed 0.5.9 home> <new root>')
const prior=resolve(priorArg),home=resolve(homeArg),root=resolve(rootArg),assets=resolve(import.meta.dirname,'native-headless')
const json=p=>JSON.parse(readFileSync(p)),sha=x=>createHash('sha256').update(x).digest('hex')
const old=json(join(prior,'manifest.json')),completed=json(join(prior,'comparison.json')),validation=json(join(prior,'verification.json')),installation=json(join(home,'installation.json'))
assert.equal(completed.complete,true);assert.equal(validation.dataVerified,true);assert.equal(installation.version,'0.5.9');assert.deepEqual(installation.model,old.model);assert.deepEqual(old.model,MODEL)
const ledger=process.env.CLEARAI_TEST_BUDGET_FILE;assert.ok(ledger)
const budget=json(ledger);assert.equal(budget.limitUsd,30);assert.equal(budget.testLimitUsd,5)
assert.ok(Object.values(budget.requests).every(r=>['verified','historical-carry-forward'].includes(r.status)||(r.status==='unknown'&&!r.error&&r.reservedUsd===REQUEST_RESERVE&&r.reservationAcceptance?.authorization&&r.reservationAcceptance.upperBoundUsd===REQUEST_RESERVE)))
for(const name of ['world.mjs','experiment.py','carrier.mjs','run.mjs','accounting.mjs','matrix.mjs',...readdirSync(join(assets,'method')).map(n=>'method/'+n)])assert.equal(sha(readFileSync(join(assets,name))),old.assets.find(a=>a.path===name)?.sha256,'Changed experimental material: '+name)
initializeCampaignRoot(root);mkdirSync(join(root,'.controller'))
const key=readFileSync(join(prior,'.controller/world-key'));assert.equal(sha(key),old.worldKeyCommitment)
const probe=join(root,'.controller/sentinel');writeFileSync(probe,'Private version comparison controller\n',{mode:0o600})
const manifest={schema:'clearai.fixed-version-comparison.v1',baselineVersion:'0.5.9',baselineDigest:installation.packageDigest,candidateDigest:old.candidateDigest,model:MODEL,priorManifestDigest:sha(readFileSync(join(prior,'manifest.json'))),priorComparisonDigest:sha(readFileSync(join(prior,'comparison.json'))),tasks:['additive','interaction'],task:old.tasks.optimization,budgets:BUDGETS.complex,experimentBudget:30,worldKeyCommitment:old.worldKeyCommitment,costBeforeUsd:Object.values(budget.requests).reduce((n,r)=>n+r.reservedUsd,0),driverDigest:sha(readFileSync(new URL(import.meta.url))),policy:'Both predeclared original complex tasks; reuse every original candidate outcome, including failures. Exactly one released-version run per task. Identical initial bytes, hidden world, experimental service, model, tools and budgets. No quality-based reruns. Baseline cannot read the prior trial. Sequential noncontemporaneous single-sample comparison; timing includes service variability. Historical unknown capacity remains fully charged.'}
writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
const results=[]
for(const task of manifest.tasks){
 const candidate=completed.results.find(r=>r.phase==='initial'&&r.task===task&&r.group==='C');assert.ok(candidate)
 const workspace=join(root,'workspaces',task),output=join(root,'runs',task);mkdirSync(workspace,{recursive:true})
 copyFileSync(join(assets,'experiment.py'),join(workspace,'experiment.py'));cpSync(join(assets,'method'),join(workspace,'method'),{recursive:true})
 const world=makeWorld(key,'native-060-'+task,task),service=await experimentService(world,{budget:30})
 writeFileSync(join(workspace,'initial.json'),JSON.stringify({observations:service.initial,bounds:[[0,1],[0,1]],noise_sd:world.noise,impurity_limit:.115,remaining_budget:30},null,2))
 assert.equal(sha(readFileSync(join(workspace,'initial.json'))),candidate.initialSha256,'Inputs must match candidate byte for byte')
 writeFileSync(join(workspace,'experiment-endpoint.json'),JSON.stringify({endpoint:service.endpoint,token:service.token}))
 let result
 try{result=await runNative({home,profile:installation.profile,workspace,spec:{group:'C',mode:'clearai',...BUDGETS.complex,testId:'released059-fixed:'+task,output,task:old.tasks.optimization,isolation:{roots:[root,prior,home],probe}}})}finally{await service.close()}
 let submission=null;try{submission=json(join(workspace,'submission.json'))}catch{}
 const calls=readFileSync(join(output,'llm-calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),roles={}
 for(const call of calls){const s=roles[call.role??'other']??={calls:0,processed:0,requestMs:0,costUsd:0};s.calls++;const u=call.usage??{};s.processed+=(u.inputTokens??0)+(u.outputTokens??0)+(u.cacheReadTokens??0)+(u.cacheWriteTokens??0);s.requestMs+=call.finished?call.finished-call.started:0;s.costUsd+=((u.inputTokens??0)+(u.cacheWriteTokens??0))*PRICE.input/1e6+(u.cacheReadTokens??0)*PRICE.cached/1e6+(u.outputTokens??0)*PRICE.output/1e6}
 const baseline={task,version:'0.5.9',reason:result.reason,elapsedMs:result.elapsedMs,usage:result.usage,roles,costUsd:Object.values(roles).reduce((n,r)=>n+r.costUsd,0),goalStatus:result.clearai?.goal?.status??null,facts:result.clearai?.facts??[],audits:(result.clearai?.audits??[]).map(a=>({kind:a.kind,holds:a.holds,step:a.step})),submission,artifactQuality:score(world,submission),violations:stopReasons(result),initialSha256:candidate.initialSha256}
 results.push({task,baseline,candidate:{...candidate,artifactQuality:validation.rows.find(r=>r.id===candidate.id).artifactQuality}})
 writeFileSync(join(root,'comparison.json'),JSON.stringify({manifest:'manifest.json',complete:results.length===manifest.tasks.length,results},null,2)+'\n')
 console.log(JSON.stringify({task,reason:baseline.reason,seconds:Math.round(baseline.elapsedMs/1000),tokens:baseline.usage.processed,facts:baseline.facts.length,score:baseline.artifactQuality.score,costUsd:baseline.costUsd}))
 if(baseline.violations.length)throw Error('Comparison stopped: '+baseline.violations.join(','))
}
