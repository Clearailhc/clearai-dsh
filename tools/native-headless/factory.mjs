/** Paired yield-attribution worlds; only public CSVs leave this coordinator. */
import {createHmac} from 'node:crypto'
export function factoryWorld(key,seed) {
 const uniform=tag=>createHmac('sha256',key).update(`${seed}:${tag}`).digest().readUInt32LE()/4294967296
 const truth={badLot:'B0723',humidityThreshold:63+4*uniform('threshold'),lotEffect:.14+.04*uniform('effect'),wearLine:uniform('line')<.5?'L1':'L2',wearStation:uniform('station')<.5?'ST2':'ST3',wearStart:9+Math.floor(3*uniform('start'))}
 const monthRows=month=>{
  const rows=[]
  for(let day=1;day<=(month===8?31:30);day++)for(const line of ['L1','L2'])for(const station of ['ST1','ST2','ST3','ST4'])for(const shift of ['day','night'])for(let job=0;job<4;job++) {
   const id=[month,day,line,station,shift,job].join(':'),date=`2026-${month===8?'08':'09'}-${String(day).padStart(2,'0')}`
   const humidity_pct=55+12*Math.sin(day/17*2*Math.PI)+(shift==='night'?7:0)+6*(uniform(id+'hum')-.5)
   const badAvailable=month===8?day>=10:day<5,lot=badAvailable&&uniform(id+'lot')<(shift==='night'?.7:.25)?truth.badLot:uniform(id+'supplier')<.5?'A0812':'B0820'
   const wear=month===9&&line===truth.wearLine&&station===truth.wearStation&&day>=truth.wearStart
   const probability=Math.min(.6,.025+(lot===truth.badLot?(humidity_pct>truth.humidityThreshold?truth.lotEffect:.01):0)+(wear?.01*(day-truth.wearStart):0))
   const units=40+Math.floor(21*uniform(id+'units'));let bad=0,rescued=0
   for(let n=0;n<units;n++)if(uniform(id+':unit:'+n)<probability){bad++;if(uniform(id+':rescue:'+n)<(wear?.15:.6))rescued++}
   rows.push({date,line,station,shift,supplier:lot.startsWith('B')?'S-B':'S-A',lot,humidity_pct:Math.round(humidity_pct*10)/10,units,first_pass_ok:units-bad,final_ok:units-bad+rescued})
  }
  return rows
 }
 const csv=month=>{const rows=monthRows(month),fields=Object.keys(rows[0]);return fields.join(',')+'\n'+rows.map(row=>fields.map(field=>row[field]).join(',')).join('\n')+'\n'}
 return {truth:()=>({...truth}),csv}
}
export const FACTORY_DICTIONARY='每行是一工单在一个工位的一班生产。date=日期；line=产线；station=工位；shift=班次；supplier=供应商；lot=批次；humidity_pct=相对湿度%；units=投入数；first_pass_ok=一次合格数；final_ok=返工后最终合格数。八月良率=first_pass_ok/units。\n'
export function factoryTask(task) {
 const prompts={'factory-t1':'分析 data/month-08.csv 的八月良率下滑原因。分清真正原因和混杂因素，限制结论范围，建议怎样处理。','factory-t2':'data/month-09.csv 是九月报工。9月5日停用 B0723 批次后良率似乎仍低。从九月起良率改为 final_ok/units。分析新原因、检查旧结论在新口径下的适用性，保留旧口径和原范围仍成立的事实。','factory-t3':'没有新数据。根据前两题，给出下周是否恢复使用供应商 S-B 来料的建议和条件，明确依据与未知。'}
 return `${prompts[task]} 数据字典在 data/README.md，工作区历史文件可读取复用。分析脚本可放 analysis/。最终写 report/${task}.md，且提交 submission.json={"conclusion":"结论","conditions":"范围和条件","evidence":["文件路径"]}。必要时按使用需要建本体；不要求数量。`
}
