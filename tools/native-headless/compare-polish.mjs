/** User-authorized small-release comparison, separate from the long research campaign. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, cpSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { runNative } from './run.mjs'
import { makeWorld, experimentService, score } from './world.mjs'
import { MODEL, BUDGETS, stopReasons } from './matrix.mjs'
import { PRICE } from './budget.mjs'
import { initializeCampaignRoot } from './public-materials.mjs'

const [homeArg, profile, rootArg] = process.argv.slice(2)
if (!rootArg) throw Error('Usage: compare-polish.mjs <installed home> <profile> <new output root>')
const home = resolve(homeArg), root = resolve(rootArg), assets = import.meta.dirname
const installation = JSON.parse(readFileSync(join(home, 'installation.json')))
const budgetFile = process.env.CLEARAI_TEST_BUDGET_FILE
assert.ok(budgetFile && existsSync(budgetFile), 'Use the existing campaign ledger')
const budget = JSON.parse(readFileSync(budgetFile))
assert.equal(budget.limitUsd, 30); assert.equal(budget.testLimitUsd, 5)
assert.ok(Object.values(budget.requests).every(row => ['verified','historical-carry-forward'].includes(row.status)), 'Settle every live request before starting comparison')
initializeCampaignRoot(root)
const privateRoot = join(root, '.controller'); mkdirSync(privateRoot)
const key = randomBytes(32), probe = join(privateRoot, 'sentinel')
writeFileSync(join(privateRoot, 'world-key'), key, { mode: 0o600 })
writeFileSync(probe, 'SECRET comparison controller sentinel\n')
const sha = value => createHash('sha256').update(value).digest('hex')
const rows = ['direct', 'additive', 'interaction'].flatMap((task, index) => (index % 2 ? ['C', 'A'] : ['A', 'C']).map(group => ({ task, group, mode: group === 'C' ? 'clearai' : 'default' })))
const tasks = {
 direct: '根据给定材料:甲17件,每件23元。计算总金额，写 submission.json 为 {"amount":数值,"unit":"元"}，简短回复。',
 optimization: '依据 initial.json 优化 x,y∈[0,1] 的收率，杂质不得超过0.115。允许使用 method/ 通用脚本和说明。用 python3 experiment.py quick|full|calibrate --x X --y Y --output lab/N.json 做实验，成本1/3/2，总预算30单位。保留原始读数，验证后把最终 {"x":数值,"y":数值,"evidence":["路径"]} 写 submission.json，报告参数、仪表口径和局限，完成任务。',
}
const boundAssets = []
function bind(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) bind(path); else boundAssets.push({ path: path.slice(assets.length + 1), sha256: sha(readFileSync(path)) }) } }
bind(assets)
const manifest = { schema: 'clearai.polish-comparison.v1', version: installation.version, candidateDigest: installation.packageDigest, model: MODEL, rows, tasks, budgets: BUDGETS, experimentBudget: 30, worldKeyCommitment: sha(key), assets: boundAssets, costBeforeUsd: Object.values(budget.requests).reduce((n,r) => n+r.reservedUsd,0), authorization: '这次验收你可以启动多个任务，并和裸模型的效果进行对比，看看最终效果以及token耗费和时长都有什么对比。', policy: 'One run per task/group, sequential counterbalanced order; no quality-based reruns. Same native tools/model/inputs, default preset A versus ClearAI C. Hidden truth is unavailable to agents, validated with native isolation probes. Deterministic objective scoring after each worker exits. Functional failures remain rows; unverifiable usage, isolation or model mismatch stops remaining runs.' }
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
const results = []
const checkpoint = () => writeFileSync(join(root,'comparison.json'),JSON.stringify({ manifest:'manifest.json', results, complete:results.length===rows.length },null,2))
for (const row of rows) {
 for (const asset of boundAssets) assert.equal(sha(readFileSync(join(assets,asset.path))),asset.sha256,'Frozen comparison driver changed')
 const id = `${row.task}-${row.group}`, workspace = join(root,'workspaces',id), output = join(root,'runs',id)
 mkdirSync(workspace,{recursive:true})
 let service, world
 if (row.task !== 'direct') {
  copyFileSync(join(assets,'experiment.py'),join(workspace,'experiment.py')); cpSync(join(assets,'method'),join(workspace,'method'),{recursive:true})
  world = makeWorld(key,'polish-060-'+row.task,row.task)
  service = await experimentService(world,{budget:30})
  writeFileSync(join(workspace,'initial.json'),JSON.stringify({observations:service.initial,bounds:[[0,1],[0,1]],noise_sd:world.noise,impurity_limit:.115,remaining_budget:30},null,2))
  writeFileSync(join(workspace,'experiment-endpoint.json'),JSON.stringify({endpoint:service.endpoint,token:service.token}))
 }
 let result
 try {
  result = await runNative({home,profile,workspace,spec:{...row,...(row.task==='direct'?BUDGETS.direct:BUDGETS.complex),testId:`polish060:${id}`,output,task:row.task==='direct'?tasks.direct:tasks.optimization,isolation:{roots:[root,home],probe}}})
 } finally { await service?.close() }
 let submission = null
 try { submission=JSON.parse(readFileSync(join(workspace,'submission.json'))) } catch {}
 const quality = row.task==='direct' ? {score:result.reason==='completed'&&submission?.amount===391&&submission?.unit==='元'?100:0} : score(world,result.reason==='completed'?submission:null)
 const calls=existsSync(join(output,'llm-calls.jsonl'))?readFileSync(join(output,'llm-calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
 const roles={}
 for(const call of calls) {
  const role=call.purpose?'other':call.session===result.session?'main':'evaluator'
  const stats=roles[role]??={calls:0,input:0,output:0,cacheRead:0,cacheWrite:0,processed:0,requestMs:0,costUpperBoundUsd:0}
  const u=call.usage??{};stats.calls++
  stats.input+=u.inputTokens??0;stats.output+=u.outputTokens??0;stats.cacheRead+=u.cacheReadTokens??0;stats.cacheWrite+=u.cacheWriteTokens??0
  stats.requestMs+=call.finished?call.finished-call.started:0
  stats.processed+=(u.inputTokens??0)+(u.outputTokens??0)+(u.cacheReadTokens??0)+(u.cacheWriteTokens??0)
  stats.costUpperBoundUsd+=((u.inputTokens??0)+(u.cacheWriteTokens??0))*PRICE.input/1e6+(u.cacheReadTokens??0)*PRICE.cached/1e6+(u.outputTokens??0)*PRICE.output/1e6
 }
 const audits=(result.clearai?.audits??[]).filter(a=>a.verdict!=='reused')
 const summary={id,...row,reason:result.reason,quality,submission,elapsedMs:result.elapsedMs,usage:result.usage,roles,costUpperBoundUsd:Object.values(roles).reduce((n,r)=>n+r.costUpperBoundUsd,0),audits:audits.map(({id,verdict,holds,basis,shortfalls})=>({id,verdict,holds,basis,shortfalls})),experimentCost:service?.spent??0,observations:service?.calls??[],initialSha256:row.task==='direct'?null:sha(readFileSync(join(workspace,'initial.json'))),violations:stopReasons(result)}
 results.push(summary);checkpoint();console.log(JSON.stringify({id,reason:summary.reason,score:quality.score,elapsedMs:summary.elapsedMs,tokens:summary.usage.processed,cost:summary.costUpperBoundUsd}))
 if(summary.violations.length)throw Error('Comparison stopped: '+summary.violations.join(','))
}
