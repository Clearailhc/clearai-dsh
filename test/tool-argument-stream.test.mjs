import test from 'node:test'
import assert from 'node:assert/strict'
import {recoverToolArguments} from '../preset/plugins/tool-argument-stream.js'
const error=Object.assign(new Error('invalid JSON'),{code:'MALFORMED_RESPONSE'})
async function* broken(name='Conclude',raw='{"answers":[{]') {
 yield {type:'tool-call-delta',index:0,id:'c1',name,argumentsDelta:raw}
 yield {type:'usage',usage:{inputTokens:10,outputTokens:5}}
 throw error
}
test('malformed call retains exact bytes and usage for rejection, without provider retry',async()=>{
 const rows=await Array.fromAsync(recoverToolArguments(broken(),new Set(['Conclude'])))
 assert.equal(rows[1].type,'usage');assert.equal(rows[2].block.arguments,'{"answers":[{]')
 assert.equal(rows[3].reason.kind,'tool-calls')
})
test('unknown tools, valid arguments with transport error, and cancellation remain failures',async()=>{
 for(const [source,signal] of [[broken('bash'),undefined],[broken('Conclude','{}'),undefined],[broken(),{aborted:true}]]) await assert.rejects(Array.fromAsync(recoverToolArguments(source,new Set(['Conclude']),signal)),e=>e===error)
})
test('native adapter terminal failure chunks become rejection calls; other finishes stay intact',async()=>{
 async function* native(code){yield {type:'tool-call-delta',index:2,id:'c2',name:'Conclude',argumentsDelta:'{"broken":'};yield {type:'finish',reason:{kind:'error',failure:{code}}}}
 const recovered=await Array.fromAsync(recoverToolArguments(native('MALFORMED_RESPONSE'),new Set(['Conclude'])))
 assert.equal(recovered[1].block.arguments,'{"broken":');assert.equal(recovered[2].reason.kind,'tool-calls')
 const unchanged=await Array.fromAsync(recoverToolArguments(native('NETWORK'),new Set(['Conclude'])))
 assert.equal(unchanged[1].reason.failure.code,'NETWORK')
})
