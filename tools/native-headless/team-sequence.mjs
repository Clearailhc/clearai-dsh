/** Paired native-delegation sequences. This is a mechanism gate, not a benefit study. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { runNative } from './run.mjs'
import { factoryWorld, FACTORY_DICTIONARY, factoryTask } from './factory.mjs'
import { knowledgeRecords, mechanismReceipt } from './mechanisms.mjs'

const [normalHome, teamHome, outputArg] = process.argv.slice(2)
if (!outputArg) throw Error('Usage: team-sequence.mjs <normal-home> <team-home> <new-output>')
const root = resolve(outputArg), repo = resolve(import.meta.dirname, '../..')
assert.ok(!existsSync(root), 'Preserve prior runs; choose a new frozen round')
assert.equal(execFileSync('git', ['-c','core.fsmonitor=false','status','--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(), '', 'Commit the candidate and assets before freeze')
const installations = [normalHome,teamHome].map(home => JSON.parse(readFileSync(join(home,'installation.json'))))
assert.equal(installations[0].teams, false)
assert.equal(installations[1].teams, true)
assert.equal(installations[0].packageDigest, installations[1].packageDigest)
const sha = data => createHash('sha256').update(data).digest('hex')
mkdirSync(join(root,'.controller'),{recursive:true})
const key = randomBytes(32)
writeFileSync(join(root,'.controller/world-key'),key,{mode:0o600})
const seeds = ['team-world-101','team-world-202','team-world-303']
const assets = Object.fromEntries(['team-sequence.mjs','factory.mjs','carrier.mjs','run.mjs','isolation.mjs','mechanisms.mjs'].map(name => [name,sha(readFileSync(join(import.meta.dirname,name)))]))
const manifest = { schema:'clearai.native-team.v1', candidate:installations[0], commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(), seeds, assets, keyCommitment:sha(key), taskIds:['factory-t1','factory-t2'], sessions:12, budgets:{processedTokens:5_000_000,wallMs:90*60_000}, productBenefitClaim:false }
writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2))
const results=[]
function save(extra={}) { writeFileSync(join(root,'results.json'),JSON.stringify({manifest:'manifest.json',results,...extra},null,2)) }
for (const seed of seeds) {
 const world=factoryWorld(key,seed)
 writeFileSync(join(root,'.controller',seed+'.json'),JSON.stringify(world.truth()))
 for (const [index,home] of [normalHome,teamHome].entries()) {
  const teams=index===1, arm=teams?'team':'subagent',base=join(root,seed,arm),workspace=join(base,'workspace')
  mkdirSync(join(workspace,'data'),{recursive:true})
  writeFileSync(join(workspace,'data/README.md'),FACTORY_DICTIONARY+'All rows are synthetic. Reproducible local analysis is authorized. Keep old files and metric definitions; no physical action or external business decision is needed.\n')
  writeFileSync(join(workspace,'data/month-08.csv'),world.csv(8))
  let previous=[]
  for(const [position,taskId] of manifest.taskIds.entries()) {
   if(position===1)writeFileSync(join(workspace,'data/month-09.csv'),world.csv(9))
   const task=factoryTask(taskId)+(teams ? '\n本题明确要求使用原生智能体团队：请创建至少一个队友，实际使用原生共享任务，把一项执行任务通过 team_task_id 绑定到 ClearAI 计划步骤。只让队友执行分析，不把队友作为独立评估者。' : '\n本题请用普通原生子代理完成一个独立分析分工，不使用原生团队。')+'\n两种委派方式都要保留可重跑脚本、关键中间表、对象和指标口径；证据支持、排除与局限及时回灌已有本体/实体图。最终答案列出实际采用的历史知识条目；无合适旧知识时如实说明。不要把新口径直接覆盖为旧指标，也不要据新月份撤回旧月份仍成立的事实。提交中额外写出 suspected_lot、interaction_variable、suspected_station、suspected_line（不适用写 null），供合成测试对账。无需构建框架。'
   const result=await runNative({home,profile:installations[index].profile,workspace,spec:{group:'C',mode:'clearai',task,tokenBudget:5_000_000,timeoutMs:90*60_000,output:join(base,taskId),isolation:{roots:[root,normalHome,teamHome,repo],probe:join(root,'.controller/world-key')}}})
   const records=knowledgeRecords(workspace),mechanism=mechanismReceipt(result,records,previous)
   const events=result.logs.flatMap(log=>readFileSync(join(base,taskId,log.path),'utf8').trim().split('\n').map(JSON.parse))
   const toolCalls=events.filter(e=>e.type==='tool/call'), calls=readFileSync(join(base,taskId,'llm-calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
   const audits=(result.clearai?.audits??[]).filter(a=>a.verdict!=='reused')
   const waiting=calls.filter(c=>c.session===result.session&&audits.some(a=>c.started>a.at&&c.started<a.settledAt)).length
   const names=toolCalls.map(e=>e.data.name), used=teams?names.includes('spawn_teammate'):names.some(n=>['subagent','subagent_fork'].includes(n))
   let submission=null;try{submission=JSON.parse(readFileSync(join(workspace,'submission.json')))}catch{}
   const truth=world.truth(),numericQuality=position===0?submission?.suspected_lot===truth.badLot&&/humid|湿度/i.test(submission?.interaction_variable??''):submission?.suspected_station===truth.wearStation&&submission?.suspected_line===truth.wearLine
   const row={seed,arm,taskId,reason:result.reason,failure:result.failure,usage:result.usage,elapsedMs:result.elapsedMs,dispatches:audits.length,parentRequestsWhileAuditing:waiting,delegationUsed:used,nativeTeam:result.nativeTeam,graph:{concepts:result.clearai?.lexicon?.terms?.length??0,relations:result.clearai?.lexicon?.predicates?.length??0,entities:result.clearai?.entities?.length??0,facts:records.filter(r=>r.storageCategory==='facts').length},mechanism,numericQuality,submission}
   results.push(row);save()
   const critical=Object.entries(mechanism.violations).filter(([,value])=>value).map(([name])=>name)
   if(result.usage.status!=='verified')critical.push('usage_unknown')
   if(waiting)critical.push('parent_audit_polling')
   if(critical.length){save({stopped:true,critical});throw Error('Critical mechanism stop: '+critical.join(','))}
   previous=records
  }
 }
}
save({completed:true,limitation:'Twelve paired engineering sessions; descriptive results only. Business failures remain failures. Human-readable graph claims require semantic review alongside the fixed machine fields.'})
console.log(JSON.stringify({completed:true,sessions:results.length,root}))
