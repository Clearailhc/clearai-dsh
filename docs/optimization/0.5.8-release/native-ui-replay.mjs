// Historical data only. Stop the disposable DSH UI server before writing the replay.
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
const {Session}=await import(pathToFileURL(join(process.env.CLEARAI_DSH_RESOURCES,'node_modules/@deepseek-ai/dsh-session/lib/index.js')).href)
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs'
import {zstdCompressSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {applyEvent,emptyState,view} from '../../../ui/lib/fold.js'
if(!process.argv[2]||!process.argv[3])throw Error('Usage: native-ui-replay.mjs <disposable-ui-home> <replay-workspace>')
const repo=resolve(import.meta.dirname,'../../..'),home=resolve(process.argv[2]),cwd=resolve(process.argv[3]),id='session-clearai058-jepa-replay'
mkdirSync(cwd,{recursive:true});cpSync(repo+'/docs/cases/runs/jepa-world-model/ws',cwd,{recursive:true})
const events=readFileSync(repo+'/docs/cases/runs/jepa-world-model/events.jsonl','utf8').trim().split('\n').map(JSON.parse)
const session=Session.create(id,[],{version:4,id,createdAt:Date.now(),cwd,isSeeded:false,delegationDepth:0,agentPreset:'clearai'})
session.append('session/title',{title:'JEPA historical replay · 0.5.8',messageSeqs:[],source:{kind:'user'}})
session.append('turn/start',{turn:1})
session.append('user/message',{id:'historical-replay-label',role:'user',content:[{type:'text',text:'Historical JEPA session replay for UI acceptance. No new research or model result.'}],source:{kind:'user'}},{surfaceOp:'append'})
let index=0
for(const event of events){
 let notice
 if(event.type==='user/message')notice=event.data
 else if(event.type==='tool/result'&&event.data?.meta?.mutations?.length)notice={role:'user',content:[{type:'text',text:''}],source:{kind:'plugin:clearai',form:'snapshot',sections:[{name:'clearai/mutations',text:JSON.stringify({mutations:event.data.meta.mutations.map(m=>({...m,at:m.at??event.time}))})}]}}
 if(!notice)continue
 const handlerId='clearai-fact-historical-replay-'+index++
 session.append('hook/invoked',{turn:1,point:'ClearAIFact',dialect:'clearai',handlerId})
 session.append('hook/result',{turn:1,point:'ClearAIFact',handlerId,decision:'pass',durationMs:0,notice:{...notice,id:handlerId}})
}
session.append('turn/end',{turn:1,reason:{kind:'completed'}})
const expected=events.reduce(applyEvent,emptyState()),actual=session.snapshotEvents().reduce(applyEvent,emptyState())
assert.ok(JSON.stringify(view(actual,id).lexicon.graph)===JSON.stringify(view(expected,id).lexicon.graph),'Historical graph projection must match exactly')
const directory=home+'/sessions/--'+cwd.replace(/[\\/:]+/g,'-').replace(/^-+/,'')+'--/'+id;mkdirSync(directory,{recursive:true})
writeFileSync(directory+'/session.v4.jsonl.zstd',Buffer.concat([zstdCompressSync(Buffer.from(JSON.stringify({type:'session',...session.header})+'\n')),zstdCompressSync(Buffer.from(session.snapshotEvents().map(x=>JSON.stringify(x)).join('\n')+'\n'))]))
const storePath=home+'/storages/workspace.json',store=JSON.parse(readFileSync(storePath))
if(!store.global.workspaceIds.includes('jepa058'))store.global.workspaceIds.push('jepa058')
store.tables.workspaces.jepa058={path:cwd,title:'Historical JEPA replay',sessionIds:[id],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
writeFileSync(storePath,JSON.stringify(store,null,2))
console.log(JSON.stringify({replay:true,nodes:view(actual,id).lexicon.graph.nodes.length,edges:view(actual,id).lexicon.graph.edges.length}))
