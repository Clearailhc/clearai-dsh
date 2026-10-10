/** Explicit synthetic records for inspecting the real installed entity-card UI. */
import {mkdirSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {runNative} from './run.mjs'
const [home,profile,rootPath]=process.argv.slice(2)
if(!rootPath)throw new Error('Usage: ui-fixture.mjs <isolated home> <profile> <new root>')
const root=resolve(rootPath),workspace=join(root,'workspace')
if(existsSync(root))throw new Error('Keep earlier UI evidence; choose a new root')
const put=(path,data)=>{const file=join(workspace,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n')}
put('lab/fixture.md','# Synthetic UI fixture\nThis is fabricated engineering display data, never product benefit evidence.\nReference reading: 2 count. Recheck pending: method changed.\n')
put('clear/ontology/concepts/instrument.json',{id:'instrument',label:'合成仪表',kind:'category',gloss:'UI工程夹具中的合成仪表',basis:'lab/fixture.md'})
put('clear/ontology/entities/synthetic-A.json',{id:'synthetic-A',type:'instrument',label:'合成仪表A',basis:'lab/fixture.md',provenance:{kind:'backref',ref:'lab/fixture.md'}})
const scope={conditions:{instrument:'synthetic-A'}}
put('clear/knowledge/facts/f-ui-calibration.json',{id:'f-ui-calibration',text:'合成仪表A在原夹具中的参考读数为2 count（UI夹具）',about:['synthetic-A'],scope_spec:scope,status:'established',level:'L3',evidence:['e-ui-fixture'],evidence_records:[{id:'e-ui-fixture',level:'L3',verdict:'support',ref:'lab/fixture.md',refs:['lab/fixture.md'],anchor:'fixture'}],rechecks:[{id:'ui-method-change',kind:'method_changed',status:'pending',detail:'合成方法版本改变，等待独立复核',evidence:'lab/fixture.md'}]})
put('clear/knowledge/lessons/l-ui-reference.json',{id:'l-ui-reference',text:'使用合成仪表A前先复核参考读数（UI夹具）',kind:'method',about:['synthetic-A'],scope_spec:scope,evidence:'lab/fixture.md',basis:'synthetic display fixture',status:'active'})
put('clear/knowledge/negatives/n-ui-moisture.json',{id:'n-ui-moisture',kind:'excluded',statement:'在合成夹具范围内，含水变化未解释读数差异（UI夹具）',about:['synthetic-A'],scope,status:'excluded',evidence:['lab/fixture.md'],source:{session:'synthetic-ui-fixture',hypothesis:'h-ui-moisture'}})
put('clear/evidence/ui-evaluation.json',{schema_version:'clearai.audit.v2',step_id:'goal:ui-fixture',auditor_run_id:'synthetic-ui-fixture',holds:'unclear',card:'Synthetic fixture: method changed; recheck incomplete. This card is display data, not a real audit verdict.',results:[],shortfalls:['synthetic-fixture']})
const sentinel=join(root,'private-sentinel');writeFileSync(sentinel,'synthetic UI sentinel')
const result=await runNative({home,profile,workspace,spec:{group:'C',mode:'clearai',tokenBudget:240000,timeoutMs:120000,output:join(root,'run'),fault:'cancel-after-frame',task:'这是仅用于真实界面回放的合成工程夹具。已有知识文件不是本次实测。只调用 Frame，about 使用 synthetic-A，conditions 写 instrument=synthetic-A，目标是检查实体卡中事实、经验、负向条目和待核验原因的展示。不派审计、不宣称目标达成。系统将在立题后取消，保留开放目标供界面检查。',isolation:{roots:[root,home],probe:sentinel}}})
console.log(JSON.stringify({session:result.session,reason:result.reason,root}))
