import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {makeWorld,experimentService,score} from '../../../tools/native-headless/world.mjs'
import {runNative} from '../../../tools/native-headless/run.mjs'
const [root,home,profile,output]=process.argv.slice(2)
if(!output)throw new Error('Usage: continuation-driver.mjs <campaign-root> <DSH-home> <profile> <new-output>')
const workspace=root+'/workspaces/C/smoke-1'
const progress=JSON.parse(readFileSync(root+'/smoke-progress.json')),prior=progress.runs.find(r=>r.row.group==='C'&&r.row.task==='additive')
assert.equal(prior.result.reason,'token_limit');assert.equal(prior.result.usage.status,'verified')
const originalSpec=JSON.parse(readFileSync(root+'/smoke/C-smoke-1-additive/spec.json'))
const endpoint=JSON.parse(readFileSync(workspace+'/experiment-endpoint.json'))
const world=makeWorld(readFileSync(root+'/.controller/world-key'),'smoke-1','additive'),service=await experimentService(world,{budget:30})
for(const observation of prior.observations){const response=await fetch(service.endpoint,{method:'POST',headers:{authorization:'Bearer '+service.token},body:JSON.stringify(observation.request)});assert.deepEqual(await response.json(),observation.result)}
assert.equal(service.spent,prior.experimentCost)
const proxy=createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/experiment'||req.headers.authorization!=='Bearer '+endpoint.token){res.writeHead(404);res.end();return}
 try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096){res.writeHead(413);res.end();return}}const response=await fetch(service.endpoint,{method:'POST',headers:{authorization:'Bearer '+service.token},body:raw});res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text())}catch{res.writeHead(500);res.end('{}')}
})
await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(Number(new URL(endpoint.endpoint).port),'127.0.0.1',resolve)})
mkdirSync(output,{recursive:true})
writeFileSync(output+'/continuation-registration.json',JSON.stringify({originalSession:prior.result.session,originalGoal:prior.result.clearai.goal.id,originalReason:'token_limit',originalProcessedTokens:prior.result.usage.processed,additionalTokenCeiling:8000000,perTestLimitUsd:5,sharedBudgetTestId:originalSpec.testId,experimentBudget:30,experimentSpent:service.spent,restoredObservations:prior.observations.length,taskUnchanged:true,reason:'Continue the same first case after the harness token ceiling; preserve original outcomes and all costs.'},null,2))
try{
 const result=await runNative({home,profile,workspace,spec:{...originalSpec,output,tokenBudget:8000000,resumeSessionId:prior.result.session,resumeOnly:false,task:'继续刚才因测试令牌上限中断的同一任务和同一目标，不新建目标。沿用已有计划、原始读数和实验预算，不重置任何实验或费用。实验服务已恢复，已消耗的 30 单位仍然计入上限。核对当前状态，完成原定 submission.json 和结案；如果现有证据不足，明确说明，不伪造完成。'}})
 let submission;try{submission=JSON.parse(readFileSync(workspace+'/submission.json'))}catch{}
 const sameGoal=result.clearai?.goal?.id===prior.result.clearai.goal.id
 const graded=score(world,result.reason==='completed'?submission:null)
 const receipt={passed:result.reason==='completed'&&result.usage.status==='verified'&&sameGoal&&graded.feasible&&graded.score>0,reason:result.reason,sameGoal,score:graded.score,feasible:graded.feasible,elapsedMs:result.elapsedMs,usage:result.usage,experimentCost:service.spent,originalExperimentCost:prior.experimentCost,installation:result.installation}
 writeFileSync(output+'/receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.passed?0:1
}finally{await new Promise(r=>proxy.close(r));await service.close()}
