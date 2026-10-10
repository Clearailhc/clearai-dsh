/** Native preset variants are tested before any product ablation run. */
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {runNative} from './run.mjs'
const [home,profile,rootPath]=process.argv.slice(2)
if(!rootPath)throw new Error('Usage: ablation-probe.mjs <home> <profile> <new-root>')
const root=resolve(rootPath);if(existsSync(root))throw new Error('Preserve prior ablation probe')
mkdirSync(root,{recursive:true});const sentinel=join(root,'private');writeFileSync(sentinel,'synthetic controller')
const rows=[]
for(const group of ['C-no-applicability','C-no-negative']) {
 const workspace=join(root,group,'workspace'),facts=join(workspace,'clear/knowledge/facts');mkdirSync(facts,{recursive:true})
 writeFileSync(join(facts,'f-probe.json'),JSON.stringify({id:'f-probe',text:'Synthetic A reference = 2',scope_spec:{conditions:{instrument:'A'}},status:'established',level:'L3'}))
 const task=group==='C-no-applicability'?'合成消融挂载探针。只调用 Frame：conditions instrument=B；hypotheses 一条引用 uses=["f-probe"]，主张B读数可能为2，refute_when为独立B读数不同；目标为检查边界反馈。系统将取消，不必结案。':'合成消融挂载探针。先 Frame 一个检查合成读数的开放课题，再调用 Anomaly action=open，what=合成观测2与3尚未解释，matters=yes。不写知识文件，不调用Conclude；系统会取消。'
 const result=await runNative({home,profile,workspace,spec:{group,mode:'clearai',task,tokenBudget:240000,timeoutMs:1200000,fault:group==='C-no-applicability'?'cancel-after-frame':'cancel-after-anomaly',output:join(root,group,'run'),isolation:{roots:[root,home],probe:sentinel}}})
 assert.equal(result.reason,'user_cancelled');assert.equal(result.usage.status,'verified')
 assert.ok(result.mount.prompt&&result.mount.tools)
 const composition=JSON.parse(readFileSync(join(root,group,'run/ablation-composition.json')));assert.equal(composition.presetId,group)
 if(group==='C-no-applicability')assert.ok(result.clearai.hypotheses.some(row=>row.uses?.some(use=>use.id==='f-probe'&&use.verdict==='unchecked')))
 else {assert.ok(result.clearai.anomalies.length);const dir=join(workspace,'clear/knowledge/negatives');assert.ok(!existsSync(dir)||readdirSync(dir).filter(name=>name.endsWith('.json')).length===0)}
 rows.push({group,result,composition})
}
writeFileSync(join(root,'result.json'),JSON.stringify({passed:true,rows},null,2))
