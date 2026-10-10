/** Sequential launcher: a failed stage stops expansion and keeps all evidence. */
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {runStage} from './campaign.mjs'
const [home,profile,rootPath,gatePath]=process.argv.slice(2)
if(!gatePath)throw new Error('Usage: all-stages.mjs <home> <profile> <frozen-root> <gate-receipts>')
const root=resolve(rootPath),manifest=JSON.parse(readFileSync(join(root,'manifest.json'))),gates=JSON.parse(readFileSync(gatePath))
let previous
for(const stage of ['smoke','development','formal','supplemental','ablation']) {
 console.log(JSON.stringify({event:'stage-started',stage,at:new Date().toISOString()}))
 previous=await runStage({home,profile,root,manifest,gates,stage,previous})
 console.log(JSON.stringify({event:'stage-ended',stage,passed:previous.passed,costs:previous.costs,at:new Date().toISOString()}))
 if(!previous.passed){process.exitCode=1;break}
 if(stage==='smoke') {
  const evidence=join(root,'smoke-results.json')
  gates['smoke-six']={passed:true,candidateDigest:manifest.candidate.sha256,evidence,sha256:createHash('sha256').update(readFileSync(evidence)).digest('hex')}
  writeFileSync(join(root,'gates-after-smoke.json'),JSON.stringify(gates,null,2)+'\n',{flag:'wx'})
 }
}
