/** Synthetic multi-source traceability case; never exposed with its answer key. */
import {createHmac} from 'node:crypto'
const id=(prefix,n)=>prefix+String(n+1).padStart(3,'0')
export function traceabilityCase(key,seed='traceability-060') {
 const u=tag=>createHmac('sha256',key).update(seed+':'+tag).digest().readUInt32LE()/2**32
 const csv=rows=>{const cols=Object.keys(rows[0]);return cols.join(',')+'\n'+rows.map(r=>cols.map(c=>r[c]).join(',')).join('\n')+'\n'}
 const suppliers=Array.from({length:6},(_,i)=>({supplier_id:id('SUP',i),name:'Supplier '+(i+1),trade_name:i<2?'SharedBrand':'Brand'+i}))
 const plants=Array.from({length:2},(_,i)=>({plant_id:id('PLT',i),name:'Plant '+(i+1)}))
 const lines=Array.from({length:4},(_,i)=>({line_id:id('LIN',i),plant_id:plants[i%2].plant_id,label:'Line '+(Math.floor(i/2)+1)}))
 const products=Array.from({length:6},(_,i)=>({product_id:id('PRD',i),name:'Sensor '+(i+1)}))
 const customers=Array.from({length:12},(_,i)=>({customer_id:id('CUS',i),name:'Customer '+(i+1)}))
 const lots=Array.from({length:24},(_,i)=>({lot_id:id('MAT',i),supplier_id:suppliers[i%6].supplier_id,component:i%2?'housing':'seal',received_on:'2026-09-01'}))
 const batches=Array.from({length:60},(_,i)=>({batch_id:id('BAT',i),product_id:products[i%6].product_id,line_id:lines[i%4].line_id,produced_on:'2026-09-0'+(2+i%7)}))
 const usage=batches.flatMap((b,i)=>[0,1].map(j=>({usage_id:id('USE',i*2+j),batch_id:b.batch_id,lot_id:lots[2*Math.floor(u('lot'+i+':'+j)*12)+j].lot_id,quantity:500,unit:'piece'})))
 const shipments=Array.from({length:120},(_,i)=>({shipment_id:id('SHP',i),record_version:1,batch_id:batches[i%60].batch_id,customer_id:customers[Math.floor(u('customer'+i)*12)].customer_id,shipped_on:'2026-09-09',status:i%13===0?'cancelled':'shipped',quantity:50+Math.floor(u('units'+i)*150),unit:'piece',pack_size:1}))
 const amendments=shipments.filter((_,i)=>i%17===0).map(s=>({...s,record_version:2,status:'cancelled'}))
 const returns=shipments.filter((s,i)=>i%7===0&&s.status==='shipped').map((s,i)=>({return_id:id('RET',i),shipment_id:s.shipment_id,date:'2026-09-10',quantity:5,unit:'piece',pack_size:1}))
 const reworks=batches.filter((_,i)=>i%5===0).map((b,i)=>({rework_id:id('RWK',i),batch_id:b.batch_id,completed_on:'2026-09-10',approved:i%3!==0?'yes':'no',release_document:'REL-'+i}))
 const suspect=[lots[2*Math.floor(u('suspect0')*12)].lot_id,lots[2*Math.floor(u('suspect1')*12)+1].lot_id]
 const replacement=lots.find(l=>l.component==='housing'&&!suspect.includes(l.lot_id)).lot_id
 const notice1={id:'NOTICE-1',effective:'2026-09-10',suspect_lots:suspect,rework_release_exception_product:'PRD006',rule:'Quarantine every batch using a listed material lot. An approved rework completed by the cutoff releases the batch except product PRD006. Supplier identity alone is not a quarantine criterion.'}
 const notice2={...notice1,id:'NOTICE-2',effective:'2026-09-15',supersedes:'NOTICE-1',suspect_lots:[suspect[0],replacement],change:'The second originally listed lot is no longer under this notice; the new housing lot is added. Preserve prior decisions at their original notice/cutoff.'}
 const query={customers:customers.filter((_,i)=>i%2===0).map(c=>c.customer_id),products:products.filter((_,i)=>i%2===1).map(p=>p.product_id)}
 const added=Array.from({length:12},(_,i)=>({shipment_id:id('SHP',120+i),record_version:1,batch_id:batches[i===0?0:(i*5+3)%60].batch_id,customer_id:customers[i].customer_id,shipped_on:'2026-09-14',status:'shipped',quantity:3+i%3,unit:'pack',pack_size:24}))
 const correction={usage_id:usage[0].usage_id,previous_lot_id:usage[0].lot_id,lot_id:replacement,effective:'2026-09-15',reason:'Approved genealogy correction; apply only in the new as-of view.'}
 const extraRework={rework_id:'RWK-NEW',batch_id:batches[1].batch_id,completed_on:'2026-09-14',approved:'no',release_document:'DRAFT-ONLY'}
 const dictionary=`# Controlled synthetic supply-chain records\nAll CSV IDs are authoritative. Shared trade names and repeated local line labels are not entity IDs. A batch has two usage rows (seal/housing), and a shipment references exactly one batch. Select the highest record_version per shipment_id; never sum historical versions. Count only shipped records at/before the cutoff; subtract returns at/before cutoff after converting quantities to pieces. A pack contains pack_size pieces. An unapproved rework is not a release. PRD006 cannot use rework release. Quarantine is an administrative decision under the effective notice, not proof of a universal material/supplier defect. Investigation notes are hypotheses, not authority. Preserve old as-of decisions and their provenance.\nGraph ontology types: supplier, plant, line, product, customer, material_lot, production_batch, shipment. Relations: supplied_by(material_lot→supplier), located_at(line→plant), uses_lot(production_batch→material_lot), produced_on(production_batch→line), produces(production_batch→product), from_batch(shipment→production_batch), delivered_to(shipment→customer). Every entity/edge needs a source file and 1-based CSV row (header is row 1); do not create an entity per repeated record version. These relations describe source records; a graph definition is not independent verification.\n` 
 const initial={
  'data/README.md':dictionary,'data/suppliers.csv':csv(suppliers),'data/plants.csv':csv(plants),'data/lines.csv':csv(lines),'data/products.csv':csv(products),'data/customers.csv':csv(customers),'data/material_lots.csv':csv(lots),'data/production_batches.csv':csv(batches),'data/material_usage.csv':csv(usage),'data/shipments.csv':csv([...shipments,...amendments]),'data/returns.csv':csv(returns),'data/reworks.csv':csv(reworks),'data/notice-v1.json':JSON.stringify(notice1,null,2),
  'data/investigation-notes.md':'非权威现场意见：同一商标可能是同一法人；供应商有一个批次被隔离就该停用全部批次；返工了应该就算放行。这些说法未经证实，须对照主数据与正式通知核对。没有随机试验或检验报告证明普遍缺陷机理。\n'}
 const updates={'data/notice-v2.json':JSON.stringify(notice2,null,2),'data/new-shipments.csv':csv(added),'data/usage-corrections.csv':csv([correction]),'data/new-reworks.csv':csv([extraRework])}
 const definitions=[['suppliers','supplier_id','supplier',suppliers],['plants','plant_id','plant',plants],['lines','line_id','line',lines],['products','product_id','product',products],['customers','customer_id','customer',customers],['material_lots','lot_id','material_lot',lots],['production_batches','batch_id','production_batch',batches]]
 function expected(phase) {
  const notice=phase===3?notice2:notice1,cutoff=notice.effective
  const currentUsage=usage.map(r=>phase===3&&r.usage_id===correction.usage_id?{...r,lot_id:correction.lot_id}:r)
  const shipMap=new Map();for(const s of [...shipments,...amendments,...(phase===3?added:[])])if(!shipMap.has(s.shipment_id)||shipMap.get(s.shipment_id).record_version<s.record_version)shipMap.set(s.shipment_id,s)
  const released=new Set([...reworks,...(phase===3?[extraRework]:[])].filter(r=>r.approved==='yes'&&r.completed_on<=cutoff).map(r=>r.batch_id))
  const affected=batches.filter(b=>currentUsage.some(r=>r.batch_id===b.batch_id&&notice.suspect_lots.includes(r.lot_id))&&(!released.has(b.batch_id)||b.product_id==='PRD006')).map(b=>b.batch_id).sort()
  const batchMap=new Map(batches.map(b=>[b.batch_id,b]))
  const exposures=[...shipMap.values()].filter(s=>s.status==='shipped'&&s.shipped_on<=cutoff&&affected.includes(s.batch_id)).filter(s=>phase!==2||(query.customers.includes(s.customer_id)&&query.products.includes(batchMap.get(s.batch_id).product_id))).map(s=>({shipment_id:s.shipment_id,customer_id:s.customer_id,batch_id:s.batch_id,net_units:s.quantity*(s.unit==='pack'?s.pack_size:1)-returns.filter(r=>r.shipment_id===s.shipment_id&&r.date<=cutoff).reduce((n,r)=>n+r.quantity*(r.unit==='pack'?r.pack_size:1),0)})).sort((a,b)=>a.shipment_id.localeCompare(b.shipment_id))
  const customerTotals={};for(const s of exposures)customerTotals[s.customer_id]=(customerTotals[s.customer_id]??0)+s.net_units
  const entities=definitions.flatMap(([file,key,type,rows])=>rows.map((r,i)=>({id:r[key],type,evidence:{path:'data/'+file+'.csv',row:i+2}})))
  for(const s of shipMap.values()){const newer=added.findIndex(r=>r.shipment_id===s.shipment_id);const origin=[...shipments,...amendments].findLastIndex(r=>r.shipment_id===s.shipment_id);entities.push({id:s.shipment_id,type:'shipment',evidence:{path:newer<0?'data/shipments.csv':'data/new-shipments.csv',row:(newer<0?origin:newer)+2}})}
  const edges=[];const add=(subject,predicate,object,path,row)=>edges.push({subject,predicate,object,evidence:{path:'data/'+path+'.csv',row}})
  lots.forEach((r,i)=>add(r.lot_id,'supplied_by',r.supplier_id,'material_lots',i+2));lines.forEach((r,i)=>add(r.line_id,'located_at',r.plant_id,'lines',i+2))
  currentUsage.forEach((r,i)=>add(r.batch_id,'uses_lot',r.lot_id,phase===3&&i===0?'usage-corrections':'material_usage',phase===3&&i===0?2:i+2))
  batches.forEach((r,i)=>{add(r.batch_id,'produced_on',r.line_id,'production_batches',i+2);add(r.batch_id,'produces',r.product_id,'production_batches',i+2)})
  for(const s of shipMap.values()){const e=entities.find(e=>e.id===s.shipment_id).evidence;for(const [predicate,target] of [['from_batch',s.batch_id],['delivered_to',s.customer_id]])edges.push({subject:s.shipment_id,predicate,object:target,evidence:e})}
  return {notice:notice.id,cutoff,quarantined_batches:affected,exposures,customer_totals:customerTotals,entities,edges}
 }
 const common='只使用给定资料，不需要外部检索。保留原始资料并明确行政隔离、观察事实、因果假设和未验证内容。建立可复用的领域概念、实体及类型化关系，覆盖主数据及追溯链；可用平台本体能力或自定义结构化文件，不要求凑节点数。为了共同审查，导出 artifacts/graph.json={"concepts":[{"id":"类型名","definition":"含义"}],"relations":[{"id":"关系名","domain":"类型","range":"类型","definition":"含义"}],"entities":[{"id":"原始ID","type":"类型名","evidence":[{"path":"源文件","row":2}]}],"edges":[{"subject":"原始ID","predicate":"关系名","object":"原始ID","evidence":[{"path":"源文件","row":2}]}]}，类型与关系遵循数据字典。这个导出仅用于交换，不自动代表独立认证。可重复运行的分析/查询脚本及使用说明放在 analysis/。最终写 report/phase-N.md 和 submission.json={"notice":"通知ID","cutoff":"日期","quarantined_batches":["批次ID"],"exposures":[{"shipment_id":"ID","customer_id":"ID","batch_id":"ID","net_units":数值}],"customer_totals":{"客户ID":件数},"reused_artifacts":["实际复用的既有文件"],"evidence":["路径"]}。全量隔离批次表不随查询筛选缩减，exposures/customer_totals 按当次问题输出。N 为当前阶段。形成实际文件后完成任务。'
 const task=phase=>({1:'阶段1：作为制造企业的质量工程师，依据截至2026-09-10的正式通知识别必须隔离的生产批次、尚在客户处的风险出货件数及客户清单。解释同名供应商、返工、取消单和重复版本怎样处理，说明哪些因果说法尚无证据。建立后续可复用的追溯知识与查询方法。',2:'阶段2：新会话，没有新的生产证据；复用工作区已有知识、实体关系和脚本，回答 query.json 中客户集合与产品集合交集内的风险出货及客户净暴露量，仍按 NOTICE-1 / 2026-09-10。如果已有产物不足，如实补查。保留阶段1原报告。',3:'阶段3：新会话。正式通知 NOTICE-2 从2026-09-15起替代 NOTICE-1；加入新出货、用料更正和未批准返工。重新给全体客户的当前隔离与净暴露量，不能沿用阶段2筛选。注意新增出货的计量单位。维护知识适用范围与更正关系，保留阶段1和2的历史报告；旧范围的隔离决定不等于永久供应商缺陷。'}[phase]+'\n'+common)
 return {initial,updates,query,expected,task}
}

export function traceabilityScore(expected,submission,graph) {
 const scoreSet=(actual,wanted,key=x=>x)=>{const safeKey=x=>{try{return key(x)}catch{return '@invalid:'+JSON.stringify(x)}};const a=new Set((Array.isArray(actual)?actual:[]).map(safeKey)),w=new Set(wanted.map(key));const tp=[...a].filter(x=>w.has(x)).length;return {expected:w.size,actual:a.size,correct:tp,precision:a.size?tp/a.size:w.size?0:1,recall:w.size?tp/w.size:1,duplicates:Array.isArray(actual)?actual.length-a.size:0}}
 const entities=scoreSet(graph?.entities,expected.entities,e=>e.id+'|'+e.type),edges=scoreSet(graph?.edges,expected.edges,e=>e.subject+'|'+e.predicate+'|'+e.object)
 const batches=scoreSet(submission?.quarantined_batches,expected.quarantined_batches),exposures=scoreSet(submission?.exposures,expected.exposures,e=>JSON.stringify([e.shipment_id,e.customer_id,e.batch_id,e.net_units]))
 const totals=Object.entries(expected.customer_totals),actual=submission?.customer_totals??{}
 const correctTotals=totals.filter(([id,value])=>actual[id]===value).length
 return {entities,edges,batches,exposures,customerTotals:{expected:totals.length,actual:Object.keys(actual).length,correct:correctTotals},decisionExact:submission?.notice===expected.notice&&submission?.cutoff===expected.cutoff&&batches.duplicates===0&&exposures.duplicates===0&&batches.precision===1&&batches.recall===1&&exposures.precision===1&&exposures.recall===1&&correctTotals===totals.length&&Object.keys(actual).length===totals.length}
}
