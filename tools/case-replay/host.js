/** Read-only presentation of recorded native events through the official session seed API. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
export const inject = ['sessions', 'workspaceRegistry']
export async function apply(ctx) {
 const config=JSON.parse(readFileSync(process.env.CLEARAI_CASE_REPLAY_CONFIG,'utf8'))
 let blockedModelRequests=0
 ctx.on('llm/stream',()=>{
  blockedModelRequests++
  try{const receipt=JSON.parse(readFileSync(config.receipt,'utf8'));receipt.blockedModelRequests=blockedModelRequests;writeFileSync(config.receipt,JSON.stringify(receipt,null,2)+'\n')}catch{}
  throw new Error('Recorded case replay: model execution is disabled')
 })
 const result=JSON.parse(readFileSync(join(config.run,'launcher-result.json'),'utf8'))
 const workspace=await ctx.workspaceRegistry.create(config.workspace,'供应链真实任务 · 历史回放 / Recorded supply-chain case')
 const receipts=[]
 for(const log of result.logs){
  const bytes=readFileSync(join(config.run,log.path)),rows=bytes.toString('utf8').trim().split('\n').map(JSON.parse)
  const header=rows.find(r=>r.header)?.header
  if(!header)throw new Error('Recorded session header missing')
  const events=rows.filter(r=>typeof r.type==='string')
  const session=ctx.sessions.create(log.session,{seed:events,meta:{...header,cwd:config.workspace}})
  await workspace.attachSession(session.id)
  if(log.session===result.session)session.append('session/title',{title:'真实任务回放 · 供应链追溯 / Recorded supply-chain case'})
  receipts.push({session:log.session,sha256:createHash('sha256').update(bytes).digest('hex'),sourceEvents:events.length,replayedEvents:session.snapshotEvents().length})
 }
 writeFileSync(config.receipt,JSON.stringify({kind:'official-dsh-recorded-session-replay',sourceRun:config.run,mainSession:result.session,workspace:config.workspace,modelCalls:0,blockedModelRequests,sessions:receipts},null,2)+'\n')
 console.info('Recorded case sessions loaded; model credentials are absent in this replay process.')
}
