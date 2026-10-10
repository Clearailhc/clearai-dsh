/** Real native lifecycle faults; these are engineering evidence, never product samples. */
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {runNative} from './run.mjs'
import {BUDGETS} from './matrix.mjs'
export const AUDIT_PROBE_TASK='这是合成工程探针。写 lab/reading.json 为 {"instrument":"synthetic-A","unit":"count","observations":[2,2,2],"mean":2,"source":"synthetic fixture"}。Frame 的条件为 instrument=synthetic-A，目标是核对这三个合成整数均值；允许只提出一条均值为2的判断，不强制建本体。CreatePlan 一个 L3 步骤，产物 lab/reading.json，判据为核对原始观测、来源、单位和均值。AdvancePlan 交独立评估，ClosePlan。Conclude achieved，answers 写清结论、范围和文件依据。不能以文本宣称完成，不能请求未登记的人工作业决定。'
export async function runFaultSuite({home,profile,root}) {
 root=resolve(root);if(existsSync(root))throw new Error('Keep earlier fault evidence; use a new directory')
 mkdirSync(root,{recursive:true});const sentinel=join(root,'private-sentinel');writeFileSync(sentinel,'private engineering sentinel')
 const results=[]
 for(const fault of ['cancel-after-child-request','disconnect','audit-timeout','crash-after-child-verdict']) {
  const workspace=join(root,fault,'workspace'),output=join(root,fault,'run')
  const first=await runNative({home,profile,workspace,spec:{...BUDGETS.complex,group:'C',mode:'clearai',task:AUDIT_PROBE_TASK,fault,output,isolation:{roots:[root,home],probe:sentinel}}})
  let second,passed=false
  if(fault==='cancel-after-child-request')passed=first.reason==='user_cancelled'&&first.usage.lowerBound>0&&!/did not settle|stop continuation/.test(first.failure??'')
  if(fault==='disconnect')passed=first.reason==='blocked'&&first.usage.lowerBound>0
  if(fault==='audit-timeout')passed=first.reason==='blocked'&&first.elapsedMs>=240000&&first.clearai?.audits.some(row=>row.shortfalls?.includes('audit_timeout'))&&first.clearai?.goal?.status!=='achieved'
  if(fault==='crash-after-child-verdict') {
   const checkpoint=JSON.parse(readFileSync(join(output,'checkpoint.json')))
   if(!existsSync(join(output,'fault-injected.json')))throw new Error('Crash fault never fired')
   second=await runNative({home,profile,workspace,spec:{...BUDGETS.complex,group:'C',mode:'clearai',task:'恢复已有持久目标、计划和已结束的评估者。继续原任务，不重新立题。先恢复旧审计，不要重复派遣已有完成的同材料评估；补足结论后完成。',resumeSessionId:checkpoint.session,output:join(root,fault,'recovered'),isolation:{roots:[root,home],probe:sentinel}}})
   const completedChild=JSON.parse(readFileSync(join(output,'fault-injected.json'))).child
   passed=second.reason==='completed'&&second.clearai?.audits.some(row=>row.child===completedChild&&['yes','no','unclear'].includes(row.holds??row.verdict))
  }
  results.push({fault,first,second,passed});writeFileSync(join(root,'results.json'),JSON.stringify({passed:results.length===4&&results.every(row=>row.passed),results},null,2)+'\n')
  if(!passed)throw new Error('Fault gate failed: '+fault+'; preserved in '+root)
 }
 return results
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
 const [home,profile,root]=process.argv.slice(2);if(!root)throw new Error('Usage: node faults.mjs <isolated-home> <profile> <new-root>')
 await runFaultSuite({home,profile,root})
}
