/** Stage-controlled native runs. Truth remains behind a tested read fence. */
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, cpSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { runNative } from './run.mjs'
import { DIAGNOSTIC_SCHEMA, diagnosticSessions, diagnosticRun, EXPERIMENT_AUTHORIZATION } from './diagnostic-protocol.mjs'
import { sessions, BUDGETS, assertGates, stopReasons } from './matrix.mjs'
import { sequenceWorld, sequenceService, sequenceTask } from './sequence.mjs'
import { makeWorld, experimentService, score } from './world.mjs'
import { sequenceMachineScore, gradeSequence, sequenceQuality, factoryQuality } from './scoring.mjs'
import { factoryWorld, factoryTask, FACTORY_DICTIONARY } from './factory.mjs'
import { stageAcceptance } from './acceptance.mjs'
import { knowledgeRecords, mechanismReceipt, moistureOnlyExperiments } from './mechanisms.mjs'
import { captureMaterials, writeSnapshot, readSnapshot, assertSyntheticWorkspace } from './public-materials.mjs'

const assets=resolve(import.meta.dirname), sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex')
const atomic=(file,data)=>{writeFileSync(file+'.pending',JSON.stringify(data,null,2)+'\n');renameSync(file+'.pending',file)}
export function prepareSubmission(workspace,task) {
 const path=join(workspace,'submission.json')
 if(existsSync(path)){mkdirSync(join(workspace,'previous-submissions'),{recursive:true});renameSync(path,join(workspace,'previous-submissions',task+'-previous-'+Date.now()+'.json'))}
}
export function verifyFrozen(manifest,home) {
 const installation=JSON.parse(readFileSync(join(home,'installation.json')))
 if(manifest.candidate.sha256!==installation.packageDigest||sha(manifest.candidate.path)!==manifest.candidate.sha256)throw new Error('Frozen candidate is not installed or tarball changed')
 if(JSON.stringify(manifest.sessions)!==JSON.stringify(manifest.schema===DIAGNOSTIC_SCHEMA?diagnosticSessions():sessions()))throw new Error('Registered matrix changed')
 for(const asset of manifest.assets)if(sha(resolve(assets,'../..',asset.path))!==asset.sha256)throw new Error('Frozen asset changed: '+asset.path)
 return installation
}
export function infrastructureRetryEligible(result) {
 return result.reason==='infrastructure_error'&&['ECONNRESET','ETIMEDOUT','EAI_AGAIN','HTTP_502','HTTP_503','HTTP_504'].includes(result.infrastructureCode)&&stopReasons(result).length===0
}

export async function runStage({home,profile,root,manifest,gates,stage,previous}) {
 root=resolve(root);home=resolve(home);mkdirSync(root,{recursive:true})
 const installation=verifyFrozen(manifest,home)
 const diagnostic=diagnosticRun(manifest,stage)
 if(diagnostic) { /* User explicitly requested a separate diagnostic run without smoke acceptance. */ }
 else if(stage!=='smoke')assertGates(gates)
 else for(const gate of ['suites','package','windows-node24-audit','native-lifecycle','native-ui','preset-and-model','isolation-probes'])if(gates[gate]?.passed!==true||!gates[gate].evidence)throw new Error('Smoke gate missing: '+gate)
 if(!['smoke','development','formal','supplemental','ablation','diagnostic'].includes(stage))throw new Error('Unknown stage')
 const predecessor={formal:'development',supplemental:'formal',ablation:'supplemental'}[stage]
 if(predecessor&&(previous?.passed!==true||previous.stage!==predecessor||previous.candidateDigest!==installation.packageDigest))throw new Error('Previous stage must pass for the same candidate')
 if(existsSync(join(root,stage+'-results.json'))||existsSync(join(root,stage+'-stopped.json')))throw new Error('Preserve prior stage evidence')
 for(const receipt of Object.values(gates)) {
  if(receipt.passed&&receipt.candidateDigest!==installation.packageDigest)throw new Error('Gate receipt belongs to another candidate')
  if(receipt.passed&&(!existsSync(receipt.evidence)||!receipt.sha256||sha(receipt.evidence)!==receipt.sha256))throw new Error('Gate evidence missing or changed')
 }
 const privateRoot=join(root,'.controller');mkdirSync(privateRoot,{recursive:true})
 const keyPath=join(privateRoot,'world-key')
 if(!existsSync(keyPath)||!manifest.worldKeyCommitment||sha(keyPath)!==manifest.worldKeyCommitment)throw new Error('World key must match the commitment frozen in this campaign root before any run')
 const key=readFileSync(keyPath),probe=join(privateRoot,'isolation-sentinel');writeFileSync(probe,'controller file: every agent must be denied\n')
 const selected=manifest.sessions.filter(row=>row.stage===stage),runs=[],scores=[],extraRuns=[]
 const checkpoint=()=>atomic(join(root,stage+'-progress.json'),{candidateDigest:installation.packageDigest,stage,runs,scores,extraRuns})
 for(const row of selected) {
  verifyFrozen(manifest,home)
  const id=`${row.group}-${row.world}-${row.task}`,dir=join(root,stage,id),workspace=join(root,'workspaces',row.group,row.world)
  if(existsSync(dir))throw new Error('Prior run exists; preserve it and use an explicitly registered retry')
  mkdirSync(workspace,{recursive:true});assertSyntheticWorkspace(root,workspace)
  copyFileSync(join(assets,'experiment.py'),join(workspace,'experiment.py'));cpSync(join(assets,'method'),join(workspace,'method'),{recursive:true})
  prepareSubmission(workspace,row.task)
  const previousRecords=knowledgeRecords(workspace),before=join(privateRoot,id+'-before')
  cpSync(workspace,before,{recursive:true,dereference:false})
  let evidence
  for(let attempt=0;attempt<2;attempt++) {
  let world,service,task,submission
  if(/^t[1-4]$/.test(row.task)) {
   world=sequenceWorld(key,row.world);service=await sequenceService(world,row.task);task=sequenceTask(row.task)+(diagnostic?'\n'+EXPERIMENT_AUTHORIZATION+'\n本题原始读数请写入 lab/'+row.task+'/，本题是连续现场任务的 '+row.task+'。':'')
   if(row.task==='t4')writeFileSync(join(workspace,'production.json'),JSON.stringify(world.production(),null,2))
  } else if(row.task==='direct') {
   task='根据给定材料:甲17件,每件23元。计算总金额，写 submission.json 为 {"amount":数值,"unit":"元"}，简短回复。使用默认模式。'
  } else if(['additive','interaction','drift'].includes(row.task)) {
   world=makeWorld(key,row.world,row.task);service=await experimentService(world,{budget:30})
   writeFileSync(join(workspace,'initial.json'),JSON.stringify({observations:service.initial,bounds:[[0,1],[0,1]],noise_sd:world.noise,impurity_limit:.115,remaining_budget:30},null,2))
   task='依据 initial.json 优化 x,y∈[0,1] 的收率，杂质不得超过0.115。允许使用 method/ 通用脚本和说明。用 python3 experiment.py quick|full|calibrate --x X --y Y --output lab/N.json 做实验，成本1/3/2，总预算30单位。保留原始读数，验证后把最终 {"x":数值,"y":数值,"evidence":["路径"]} 写 submission.json，报告参数、仪表口径和局限，完成任务。'
  } else if(row.task.startsWith('factory-')) {
   world=factoryWorld(key,row.world);mkdirSync(join(workspace,'data'),{recursive:true})
   writeFileSync(join(workspace,'data/README.md'),FACTORY_DICTIONARY)
   if(row.task==='factory-t1')writeFileSync(join(workspace,'data/month-08.csv'),world.csv(8))
   if(row.task==='factory-t2')writeFileSync(join(workspace,'data/month-09.csv'),world.csv(9))
   task=factoryTask(row.task)
  } else throw new Error('Unknown registered task: '+row.task)
  if(service)writeFileSync(join(workspace,'experiment-endpoint.json'),JSON.stringify({endpoint:service.endpoint,token:service.token}))
  const budget=row.task==='direct'?BUDGETS.direct:BUDGETS.complex
  let result
  try{result=await runNative({home,profile,workspace,spec:{...row,...budget,output:attempt?dir+'-infra-retry-1':dir,task,isolation:{roots:[root,home],probe}}})}finally{if(service)await service.close()}
  try{submission=JSON.parse(readFileSync(join(workspace,'submission.json')))}catch{submission=null}
  const records=knowledgeRecords(workspace),mechanism=mechanismReceipt(result,records,previousRecords)
  result.violations={...result.violations,...mechanism.violations}
  const material=captureMaterials({root,workspace,task:row.task,submission,result,records})
  const snapshot=writeSnapshot(join(privateRoot,id+'-attempt-'+attempt+'-materials.json'),material)
  evidence={row,result,submission,snapshot,mechanism,attempt,observations:service?.calls??[],experimentCost:service?.spent??service?.calls.length??0,moistureOnlyExperiments:moistureOnlyExperiments(service?.calls??[])}
  atomic(join(privateRoot,id+'-attempt-'+attempt+'.json'),evidence)
  if(attempt===0&&infrastructureRetryEligible(result)) {
   extraRuns.push(evidence);checkpoint()
   renameSync(workspace,join(privateRoot,id+'-failed-workspace'));cpSync(before,workspace,{recursive:true,dereference:false})
   continue
  }
  if(row.task==='direct')scores.push({id,row,score:result.reason==='completed'&&submission?.amount===391&&submission?.unit==='元'?100:0})
  else if(['additive','interaction','drift'].includes(row.task))scores.push({id,row,...score(world,result.reason==='completed'?submission:null),completed:result.reason==='completed'})
  break
  }
  runs.push(evidence);checkpoint()
  const violations=stopReasons(evidence.result)
  if(violations.length){atomic(join(root,stage+'-stopped.json'),{id,reasons:violations,completedRuns:runs.length});throw new Error('Batch stopped: '+violations.join(','))}
 }
 // Worker and auditor processes have exited before any grading truth is supplied.
 for(const evidence of runs.filter(row=>/^t[1-4]$/.test(row.row.task)||row.row.task.startsWith('factory-'))) {
  const {row,result,submission,observations}=evidence,material=readSnapshot(evidence.snapshot)
  const history=runs.slice(0,runs.indexOf(evidence)).filter(old=>old.row.group===row.group&&old.row.world===row.world).map(old=>readSnapshot(old.snapshot))
  const factory=row.task.startsWith('factory-'),world=factory?factoryWorld(key,row.world):sequenceWorld(key,row.world)
  const blind=await gradeSequence({home,profile,root:join(privateRoot,'judges'),protectedRoot:root,probe,task:row.task,world,observations,...material,history})
  if(factory)scores.push({row,score:factoryQuality(row.task,blind.grade,result.reason==='completed'),blind})
  else {const machine=sequenceMachineScore(world,row.task,submission,observations,result.reason==='completed');scores.push({row,machine,quality:sequenceQuality(machine,blind.grade),blind})}
  checkpoint()
 }
 const formal=stage==='ablation'?JSON.parse(readFileSync(join(root,'formal-results.json'))):undefined
 if(formal&&formal.candidateDigest!==installation.packageDigest)throw new Error('Ablation baseline candidate mismatch')
 const assessment=stageAcceptance({stage:diagnostic?'development':stage,runs,scores,formal})
 const acceptance=diagnostic?{stage,status:'completed',passed:runs.every(row=>row.result.reason==='completed'),productAcceptance:false,criteriaAssessment:assessment}:assessment
 const blindRuns=scores.flatMap(row=>row.blind?.judges??[])
 const costs={mainProcessed:runs.reduce((n,row)=>n+(row.result.usage.processed??0),0),infrastructureRetryProcessed:extraRuns.reduce((n,row)=>n+(row.result.usage.processed??0),0),blindProcessed:blindRuns.reduce((n,row)=>n+row.result.usage.processed,0),blindSessions:blindRuns.length}
 const output={candidateDigest:installation.packageDigest,stage,runs,scores,extraRuns,costs,...acceptance}
 atomic(join(root,stage+'-results.json'),output)
 return output
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
 const [home,profile,root,manifestPath,gatesPath,stage,previousPath]=process.argv.slice(2)
 if(!stage)throw new Error('Usage: node campaign.mjs <home> <profile> <new-root> <manifest> <gates> <stage> [previous-stage-acceptance]')
 await runStage({home,profile,root,manifest:JSON.parse(readFileSync(manifestPath)),gates:JSON.parse(readFileSync(gatesPath)),stage,previous:previousPath?JSON.parse(readFileSync(previousPath)):undefined})
}
