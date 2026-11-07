/** Offline contract gate against the installed native session writer and reader. */
import {nativeRuntime} from './runtime.mjs'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {join,resolve} from 'node:path'
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
const repo=resolve(import.meta.dirname,'../..')
if(!process.env.CLEARAI_CONTRACT_CHILD) {
 const output=resolve(process.argv[2]??join(tmpdir(),'clearai-native-contract'))
 mkdirSync(output,{recursive:true})
 const run=spawnSync(nativeRuntime().app,[import.meta.filename,output],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',CLEARAI_CONTRACT_CHILD:'1'},encoding:'utf8',timeout:30000})
 writeFileSync(join(output,'native.log'),run.stdout+run.stderr)
 assert.equal(run.status,0,run.stderr);process.stdout.write(run.stdout)
} else {
 const require=createRequire(join(nativeRuntime().resources,'package.json'))
 const {Session,KNOWN_SESSION_EVENT_TYPES}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)
 const {BlockAssembler}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
 const {assertSupportedJsonSchema}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href)
 const {nativeAuditSchema,bindAuditCriteria}=await import(pathToFileURL(join(repo,'preset/plugins/audit-schema.js')).href)
 const claimSchema=bindAuditCriteria({type:'object',properties:{criteria:{type:'array',items:{type:'object',properties:{criterion:{type:'string'}}}},results:{type:'array',items:{type:'object',properties:{hypothesis:{type:'string'},verdict:{type:'string',enum:['support','refute','inconclusive']},coverage:{type:'string',enum:['full','narrower','unknown']}},required:['hypothesis','verdict','coverage']}}}},[{id:'C1'}],['h-one'])
 assert.throws(()=>assertSupportedJsonSchema(claimSchema),/minItems|maxItems/)
 assert.doesNotThrow(()=>assertSupportedJsonSchema(nativeAuditSchema(claimSchema)))
 const {recoverToolArguments}=await import(pathToFileURL(join(repo,'preset/plugins/tool-argument-stream.js')).href)
 const malformed='{"answers":[{]'
 async function* adapterFailure(){yield {type:'tool-call-delta',index:0,id:'bad-json',name:'Conclude',argumentsDelta:malformed};yield {type:'finish',reason:{kind:'error',failure:{code:'MALFORMED_RESPONSE'}}}}
 const live=new BlockAssembler()
 for await(const chunk of recoverToolArguments(adapterFailure(),new Set(['Conclude'])))live.push(chunk)
 assert.equal(live.finish.kind,'tool-calls')
 assert.equal(live.blocks()[0].arguments,malformed,'Native assembler must preserve invalid bytes for tool rejection')
 const {applyEvent,emptyState}=await import(pathToFileURL(join(repo,'ui/lib/fold.js')).href)
 const header={version:4,id:'synthetic-contract',createdAt:Date.now(),cwd:tmpdir(),isSeeded:false}
 const session=Session.create(header.id,[],header)
 session.append('turn/start',{turn:1})
 session.append('user/message',{id:'u',role:'user',content:[{type:'text',text:'synthetic'}],source:{kind:'user'}},{surfaceOp:'append'})
 const surfaceBefore=JSON.stringify(session.deriveMessages())
 const mutations=[{t:'audit/dispatched',id:'audit:fixture',step:'goal:CON ',evaluator_session:'child:NUL',digest:'v4:synthetic',status:'dispatched'}]
 session.append('hook/invoked',{turn:1,point:'ClearAIFact',dialect:'clearai',handlerId:'clearai-fact-fixture'})
 session.append('hook/result',{turn:1,point:'ClearAIFact',handlerId:'clearai-fact-fixture',decision:'pass',durationMs:0,notice:{id:'clearai-notice-fixture',role:'user',content:[{type:'text',text:''}],source:{kind:'plugin:clearai',form:'snapshot',sections:[{name:'clearai/mutations',text:JSON.stringify({mutations})}]}}})
 assert.equal(JSON.stringify(session.deriveMessages()),surfaceBefore,'Durable hooks cannot insert model messages')
 session.append('turn/end',{turn:1,reason:{kind:'completed'}})
 const events=session.snapshotEvents(),restored=Session.create(header.id,JSON.parse(JSON.stringify(events)),header)
 assert.ok(events.every(event=>KNOWN_SESSION_EVENT_TYPES.has(event.type)),'Native persistence must recognize every written event')
 assert.deepEqual(restored.snapshotEvents().slice(0,events.length),events)
 assert.equal(JSON.stringify(restored.deriveMessages()),surfaceBefore)
 const projection=events.reduce(applyEvent,emptyState())
 assert.equal(projection.audits[0].child,'child:NUL');assert.equal(projection.audits[0].step,'goal:CON ')
 const result={passed:true,runtime:process.version,checks:['native review schema','native append','native cold replay','unchanged model surface','signed projection replay']}
 writeFileSync(join(resolve(process.argv[2]),'result.json'),JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result))
}
