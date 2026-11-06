import { SECTIONS } from '../../../preset/plugins/prompts.js'
import { nativeAuditSchema } from '../../../preset/plugins/audit-schema.js'
import { mkdtempSync,mkdirSync,writeFileSync,cpSync,existsSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
const promptSizes=Object.fromEntries(['zh','en'].map(lang=>[lang,SECTIONS.reduce((n,s)=>n+s.text[lang].length,0)]))
console.log(JSON.stringify({promptCharacters:promptSizes,tokenizerUsed:false,nativeBasisSchema:nativeAuditSchema({type:'string',maxLength:1200,description:'basis'})}))
const root=mkdtempSync(join(tmpdir(),'clearai-copy-bench-')),src=join(root,'source'),dst=join(root,'copy');mkdirSync(src)
try {
 for(const dir of ['node_modules','sub/node_modules','.venv/lib','clear']) mkdirSync(join(src,dir),{recursive:true})
 for(const dir of ['node_modules','sub/node_modules','.venv/lib','clear']) writeFileSync(join(src,dir,'marker'),'cache')
 mkdirSync(join(src,'data')); const block=Buffer.alloc(64*1024,7)
 for(let i=0;i<1000;i++)writeFileSync(join(src,'data',`${i}.bin`),block)
 const skip=new Set([join(src,'clear'),join(src,'.git'),join(src,'node_modules')])
 const begin=performance.now();cpSync(src,dst,{recursive:true,filter:source=>!skip.has(source)});const elapsed=performance.now()-begin
 console.log(JSON.stringify({files:1000,dataBytes:1000*block.length,copyMs:elapsed,rootNodeModulesCopied:existsSync(join(dst,'node_modules/marker')),nestedNodeModulesCopied:existsSync(join(dst,'sub/node_modules/marker')),pythonVenvCopied:existsSync(join(dst,'.venv/lib/marker'))}))
} finally {rmSync(root,{recursive:true,force:true})}
