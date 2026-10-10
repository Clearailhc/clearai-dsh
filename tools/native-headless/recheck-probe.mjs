/** Real native cross-session calculation probe, explicitly synthetic engineering evidence. */
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import assert from 'node:assert/strict'
import {runNative} from './run.mjs'
import {methodSnapshot,fileDigest} from '../../preset/plugins/audit-material.js'
import {BUDGETS} from './matrix.mjs'
const [home,profile,rootPath]=process.argv.slice(2)
if(!rootPath)throw new Error('Usage: recheck-probe.mjs <home> <profile> <new-root>')
const root=resolve(rootPath),workspace=join(root,'workspace')
if(existsSync(root))throw new Error('Preserve earlier probe records')
const put=(path,value)=>{const file=join(workspace,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n')}
put('lab/input.json',[2,2,2]);put('lab/output.json',{mean:2})
put('lab/calc.py','import json\nfrom pathlib import Path\nx=json.loads(Path("lab/input.json").read_text())\nPath("lab/output.json").write_text(json.dumps({"mean":sum(x)/len(x)}))\n')
const spec={id:'mean',command:'python3 lab/calc.py',inputs:['lab/input.json'],scripts:['lab/calc.py'],output:'lab/output.json',baseline:{mean:2},tolerance:.01}
put('clear/models/mean.json',spec)
put('lab/original.md','Synthetic engineering fixture: original observations [2,2,2], mean 2 count, instrument synthetic-A. The fact is seeded only to exercise native recheck persistence, not product benefit evidence.')
put('clear/knowledge/facts/f-native-mean.json',{id:'f-native-mean',text:'合成仪表A本夹具的均值为2 count',scope_spec:{conditions:{instrument:'synthetic-A'}},status:'established',level:'L3',use:'mean',evidence:['e-original'],evidence_records:[{id:'e-original',refs:['lab/original.md'],verdict:'support',level:'L3'}],calculation:{model:'mean',reference:{mean:2},inputs:{'lab/input.json':fileDigest(workspace,'lab/input.json')},method:methodSnapshot(workspace,spec,'clear/models/mean.json')}})
const sentinel=join(root,'private-sentinel');writeFileSync(sentinel,'synthetic controller')
const runs=[],record=()=>JSON.parse(readFileSync(join(workspace,'clear/knowledge/facts/f-native-mean.json'))),observations=()=>JSON.parse(readFileSync(join(workspace,'clear/evidence/models/mean.json'))).runs
const run=async(name,task,fault)=>{
 const result=await runNative({home,profile,workspace,spec:{...BUDGETS.complex,group:'C',mode:'clearai',task,fault,output:join(root,name),isolation:{roots:[root,home],probe:sentinel}}})
 runs.push({name,result,fact:record()});writeFileSync(join(root,'progress.json'),JSON.stringify({runs},null,2));return result
}
const frame='这是合成核算工程探针。只调用 Frame 一次：conditions 为 instrument=synthetic-A，hypotheses 给一条均值仍为2的判断，refute_when 为当前均值不等于2，uses=["f-native-mean"]。不改文件，不派审计，不手动运行计算；内核会自动核算。系统将在 Frame 完成后取消。'
put('lab/input.json',[3,3,3])
const first=await run('drift',frame,'cancel-after-frame')
assert.equal(first.reason,'user_cancelled');assert.equal(observations().length,1);assert.equal(observations()[0].outputs.mean,3)
assert.ok(record().rechecks.some(row=>row.status==='pending'&&row.kind==='output_deviation'))
const reasons=record().rechecks.map(row=>row.id)
const second=await run('fresh-session',frame,'cancel-after-frame')
assert.equal(second.reason,'user_cancelled');assert.equal(observations().length,1)
assert.ok(reasons.every(id=>record().rechecks.some(row=>row.id===id&&row.status==='pending')))
assert.ok(second.clearai.hypotheses.some(row=>row.uses?.some(use=>use.id==='f-native-mean'&&use.verdict==='pending')))
put('lab/input.json',[2,2,2])
put('lab/controller-history.md','Synthetic engineering fixture chronology: the test controller initially seeded [2,2,2] and reference mean=2; then it wrote [3,3,3], causing the output_deviation and its linked anomaly; a second session saw unchanged [3,3,3], did not rerun the calculation, and retained pending reasons; immediately before this session the controller restored [2,2,2]. The second recorded calculation run will therefore be the automatic Frame recheck in this restoring session, not the second session above. All writes use JSON.stringify(values,null,2)+newline. Actor and change source are explicitly this test controller. Only current mean and reason-by-reason independent confirmation are the acceptance criteria; reconstructing old hashes is unnecessary.\n')
const third=await run('independent-recheck','这是合成核算工程探针，已知变化过程及来源见 lab/controller-history.md，当前输入已由控制器恢复为[2,2,2]。先读 f-native-mean 的基准与全部待核验原因和 lab/input.json。Frame conditions 为 instrument=synthetic-A，hypotheses 一条均值2的判断，uses=["f-native-mean"]，retests="f-native-mean"，refute_when 为均值偏离2。判据仅两项：当前原始观测均值为2，已有待核验原因经独立复检逐条解决。完成一个 L3 步骤，产物 lab/recheck.md 简要列原始观测、计算方法、基准和各原因的复核依据。已有 lab/calc.py 可重跑，不必开发另一个验证框架或反推历史哈希。评估者须独立计算并逐条确认 rechecks。不要手改系统知识或评估记录。复检通过后 ClosePlan，Conclude achieved，最终答案直接引用 f-native-mean 并给文件依据；不提出新经验。未解决的原因保持开放。')
assert.equal(third.reason,'completed');assert.equal(record().calculation.reference.mean,2)
assert.ok(reasons.every(id=>record().rechecks.some(row=>row.id===id&&row.status==='resolved'&&row.resolution?.by==='independent'&&row.resolution.card_path)))
const fourth=await run('confirmed-new-session',frame,'cancel-after-frame')
assert.ok(fourth.clearai.hypotheses.some(row=>row.uses?.some(use=>use.id==='f-native-mean'&&use.verdict==='applies')))
writeFileSync(join(root,'result.json'),JSON.stringify({passed:true,runs,candidateDigest:third.installation.packageDigest},null,2))
