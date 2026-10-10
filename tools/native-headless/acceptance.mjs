import { pairedAnalysis, sequenceCosts } from './analyze.mjs'
const mean=rows=>rows.reduce((a,b)=>a+b,0)/rows.length
export function stageAcceptance({stage,runs,scores,formal}) {
 if(stage==='smoke') {
  const completed=runs.length===6&&runs.every(row=>row.result.reason==='completed'&&row.result.usage.status==='verified')
  const direct=scores.filter(row=>row.row.task==='direct'),optimization=scores.filter(row=>row.row.task!=='direct')
  const passed=completed&&direct.length===2&&direct.every(row=>row.score===100)&&optimization.length===4&&optimization.every(row=>row.feasible&&row.score>0)
  return {stage,passed,status:passed?'passed':'failed',completed:runs.filter(row=>row.result.reason==='completed').length,expected:6}
 }
 const worlds=[...new Set(scores.filter(row=>row.row.group==='A'&&/^t[1-4]$/.test(row.row.task)).map(row=>row.row.world))],pairs=[]
 if(['development','formal'].includes(stage)) {
  const expected=stage==='development'?3:6
  if(worlds.length!==expected||scores.length!==expected*8)throw new Error('Missing registered sequence scores')
  for(const world of worlds) {
   const group=name=>{
    const rows=scores.filter(row=>row.row.world===world&&row.row.group===name)
    if(rows.length!==4||rows.some(row=>!Number.isFinite(row.quality)))throw new Error('Missing world/task grade')
    const costs=sequenceCosts(rows.map(row=>({...row.machine,correctDiagnosis:row.blind.grade.correctDiagnosis})))
    return {quality:mean(rows.filter(row=>row.row.task!=='t1').map(row=>row.quality)),first:rows.find(row=>row.row.task==='t1').quality,experiments:mean([costs.t2,costs.t4])}
   }
   const a=group('A'),c=group('C');pairs.push({world,aQuality:a.quality,cQuality:c.quality,aFirst:a.first,cFirst:c.first,aExperiments:a.experiments,cExperiments:c.experiments})
  }
  const paired=pairedAnalysis(pairs),cRuns=runs.filter(row=>row.row.group==='C'),cScores=scores.filter(row=>row.row.group==='C')
  const required=cRuns.reduce((sum,row)=>sum+(row.mechanism?.required??0),0),covered=cRuns.reduce((sum,row)=>sum+(row.mechanism?.covered??0),0)
  const later=cRuns.filter(row=>['t2','t4'].includes(row.row.task)),actual=later.filter(row=>row.result.reason==='completed'&&row.mechanism?.actualConfirmed>0&&cScores.find(score=>score.row.world===row.row.world&&score.row.task===row.row.task)?.blind.grade.correctReuse===true).length
  const usageVerified=runs.length===expected*8&&runs.every(row=>row.result.usage?.status==='verified'&&Number.isFinite(row.result.usage.processed))
  const tokens=group=>runs.filter(row=>row.row.group===group).reduce((sum,row)=>sum+(Number.isFinite(row.result.usage?.processed)?row.result.usage.processed:0),0)
  const overconfident=group=>scores.filter(row=>row.row.group===group).reduce((sum,row)=>sum+row.blind.grade.overconfident,0)
  const metrics={feedback:required?covered/required:null,feedbackOpportunities:required,actualReuse:actual/later.length,usageVerified,tokenRatio:usageVerified&&tokens('A')>0?tokens('C')/tokens('A'):null,overconfident:{A:overconfident('A'),C:overconfident('C')},historyRetractions:cScores.filter(row=>row.blind.grade.historicalRetraction).length,oldMisuse:cScores.filter(row=>row.row.task==='t3'&&row.blind.grade.misusedOld).length,silentClosures:cRuns.filter(row=>row.mechanism?.violations.silent_closure).length,changeFromFirst:{A:mean(pairs.map(row=>row.aQuality-row.aFirst)),C:mean(pairs.map(row=>row.cQuality-row.cFirst))}}
  const mechanics=metrics.feedback>=.95&&metrics.actualReuse>=.8&&metrics.historyRetractions===0&&metrics.oldMisuse===0&&metrics.silentClosures===0&&metrics.overconfident.C<=metrics.overconfident.A&&metrics.tokenRatio!==null&&metrics.tokenRatio<=2.5
  const quality=paired.point.quality>=.5,savings=paired.point.savings!==null&&paired.point.savings>=.2&&paired.point.quality>=0
  const uncertainty=stage==='development'||Object.values(paired.verdicts).every(value=>value==='达到')
  return {stage,passed:mechanics&&quality&&savings&&uncertainty,metrics,pairs,paired,verdicts:{sequenceQuality:stage==='development'?(quality?'达到':'未达到'):paired.verdicts.sequenceQuality,experimentSavings:stage==='development'?(savings?'达到':'未达到'):paired.verdicts.experimentSavings,changeHandling:metrics.historyRetractions===0&&metrics.oldMisuse===0&&metrics.silentClosures===0?'达到':'未达到',cost:metrics.tokenRatio!==null&&metrics.tokenRatio<=2.5?'达到':'未达到'}}
 }
 if(stage==='supplemental') {
  if(scores.length!==36)throw new Error('Missing supplemental scores')
  const templates=['factory','additive','interaction','drift'],differences={}
  for(const template of templates) {
   const matching=scores.filter(row=>template==='factory'?row.row.task.startsWith('factory'):row.row.task===template)
   const values=group=>matching.filter(row=>row.row.group===group).map(row=>row.score)
   if(!values('A').length||!values('C').length)throw new Error('Missing supplemental template')
   differences[template]=mean(values('C'))-mean(values('A'))
  }
  const historyRetractions=scores.filter(row=>row.blind?.grade.historicalRetraction).length
  return {stage,passed:Object.values(differences).every(value=>value>=-5)&&historyRetractions===0,differences,historyRetractions,verdicts:{singleTaskNoninferiority:Object.values(differences).every(value=>value>=-5)?'达到':'未达到'}}
 }
 // Ablations describe mechanisms; they are not a replacement for full-C acceptance.
 if(stage==='ablation') {
  if(scores.length!==48||!formal?.passed||formal.stage!=='formal')throw new Error('Complete formal-C baseline and all ablations required')
  const comparisons={}
  for(const group of ['C-no-applicability','C-no-negative']) {
   const pairs=[]
   for(const world of [...new Set(scores.filter(row=>row.row.group===group).map(row=>row.row.world))]) {
    const full=formal.scores.filter(row=>row.row.group==='C'&&row.row.world===world),variant=scores.filter(row=>row.row.group===group&&row.row.world===world)
    if(full.length!==4||variant.length!==4)throw new Error('Unpaired ablation world')
    const summary=rows=>({quality:mean(rows.filter(row=>row.row.task!=='t1').map(row=>row.quality)),costs:sequenceCosts(rows.map(row=>({...row.machine,correctDiagnosis:row.blind.grade.correctDiagnosis})))})
    const a=summary(variant),c=summary(full)
    pairs.push({world,aQuality:a.quality,cQuality:c.quality,aExperiments:mean(Object.values(a.costs)),cExperiments:mean(Object.values(c.costs))})
   }
   if(pairs.length!==6)throw new Error('Missing ablation worlds')
   comparisons[group]={interpretation:'positive effects favor full C',analysis:pairedAnalysis(pairs)}
  }
  return {stage,passed:true,status:'descriptive',comparisons}
 }
 throw new Error('Unknown acceptance stage')
}
