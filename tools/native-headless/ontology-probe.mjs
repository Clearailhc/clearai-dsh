/** Synthetic native regression: build a graph from raw material and retain an audited partial fact. */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { runNative } from './run.mjs'
import { knowledgeRecords } from './mechanisms.mjs'
import { graphProjection } from '../../ui/lib/domain-language.js'
const [home,profile,rootPath]=process.argv.slice(2)
if(!rootPath)throw new Error('Usage: ontology-probe.mjs <home> <profile> <new-root>')
const root=resolve(rootPath),workspace=join(root,'workspace')
if(existsSync(root))throw new Error('Preserve earlier evidence; choose a new root')
mkdirSync(join(workspace,'lab'),{recursive:true})
writeFileSync(join(workspace,'lab/readings.csv'),'instrument,batch,setpoint_C,reference_C\nK1,B1,100,92\nK1,B1,110,102\nK1,B1,120,112\n')
writeFileSync(join(workspace,'lab/source.md'),'Synthetic engineering fixture. K1 is a simulated furnace in batch B1. CSV setpoint_C is the controller setting, reference_C is the reference thermometer reading, both degrees Celsius. The reference is the calibration basis for this fixture. This fixture establishes a calibration difference for these three readings only; other batches and ranges remain unknown. Reproducible local computations are authorized. There is no physical equipment, private data, or external write.\n')
const sentinel=join(root,'private-sentinel');writeFileSync(sentinel,'controller only')
const run=(name,task,fault)=>runNative({home,profile,workspace,spec:{group:'C',mode:'clearai',task,fault,tokenBudget:5_000_000,timeoutMs:90*60_000,output:join(root,name),isolation:{roots:[root,home],probe:sentinel}}})
const first=await run('accumulate',`这是最小本体回灌工程回归,不是收益基准。依据 lab/source.md 和 lab/readings.csv,核对 K1 在 B1 三个读数中的设定值与参考温度的差,并保留可复用证据。分两阶段:先确认当前批次的偏差;下一阶段才讨论另批次能否复用,所以本次先不结案。
先读取这两个小文件。只用当前批次一条假设,范围明确限于 K1、B1、这些测点。按 ClearAI 提示词完成最小本体和实体关联,一份简短可重跑核算和一份结果表即可,不建设额外框架。完成一个独立核验的 L3 步骤,产物给出原始数值、运算、结果和适用范围。不要写入 clear/knowledge 或伪造审计。系统将在独立阶段事实实际保存后主动中断,这是预先登记的测试动作。不要提前 Conclude,无需人工审批本地计算。`, 'cancel-after-partial-fact')
writeFileSync(join(root,'stage-one.json'),JSON.stringify(first,null,2))
assert.equal(first.reason,'user_cancelled',first.failure)
assert.equal(first.clearai.goal.status,'open')
assert.ok(first.clearai.lexicon.terms.length>0&&first.clearai.lexicon.predicates.length>0&&first.clearai.entities.length>0)
const facts=knowledgeRecords(workspace).filter(r=>r.storageCategory==='facts')
assert.ok(facts.length>0)
assert.ok(facts.every(f=>f.assertions?.length&&f.evidence_records.some(e=>e.evaluator==='independent')&&f.scope_spec))
assert.ok(graphProjection(first.clearai).edges.some(e=>e.source==='promoted'))
assert.ok(first.usage.calls>0&&!first.usage.missing)
const second=await run('new-session',`这是中断后恢复工程回归。读取 clear/knowledge/facts 下本批K1事实、对应本体和它的证据,随后只调用一次 Frame,conditions 为 instrument=K1、batch=B1;用一条假设引用刚读到的事实id写入 uses,不新增观测、不改本体、不审计、不结案。当前任务仍仅针对原事实范围中的三测点;系统将在 Frame 后取消。`, 'cancel-after-frame')
assert.equal(second.reason,'user_cancelled')
assert.ok(second.clearai.entities.length>0)
assert.ok(second.clearai.hypotheses.some(h=>h.uses?.some(u=>facts.some(f=>f.id===u.id))))
assert.ok(second.usage.calls>0&&!second.usage.missing)
const result={passed:true,candidate:first.installation,first:{reason:first.reason,usage:first.usage,elapsedMs:first.elapsedMs,concepts:first.clearai.lexicon.terms.length,relations:first.clearai.lexicon.predicates.length,entities:first.clearai.entities.length,facts:facts.length},second:{reason:second.reason,usage:second.usage,elapsedMs:second.elapsedMs},limitations:'Engineering mechanism probe with synthetic public data; not evidence of comparative quality or token savings.'}
writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
