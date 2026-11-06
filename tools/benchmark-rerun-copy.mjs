import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { createRerunCopy } from '../preset/plugins/rerun-copy.js'
const root=await mkdtemp(join(tmpdir(),'clearai-copy-bench-')),source=join(root,'source')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));await mkdir(source)
try {
 const files=400,size=65536,payload=Buffer.alloc(size,42)
 for(let i=0;i<files;i++)await writeFile(join(source,i+'.bin'),payload)
 const rows=[]
 for(const kind of ['sync-baseline','async-candidate'])for(let repeat=0;repeat<5;repeat++) {
  const destination=join(root,kind+repeat),loop=monitorEventLoopDelay({resolution:1});loop.enable();await delay(10);const start=performance.now()
  if(kind==='sync-baseline')cpSync(source,destination,{recursive:true})
  else {const result=await createRerunCopy(source,destination);if(result.status!=='ready'||result.files!==files||result.bytes!==files*size)throw Error('Invalid copy')}
  const elapsedMs=performance.now()-start;await delay(10);loop.disable();rows.push({kind,repeat,files,bytes:files*size,elapsedMs,eventLoopMaxMs:loop.max/1e6});await rm(destination,{recursive:true,force:true})
 }
 const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]
 console.log(JSON.stringify({fixture:'400 equal 64KiB files; identical bytes, no excluded directories',node:process.version,platform:process.platform,rows,summary:Object.fromEntries(['sync-baseline','async-candidate'].map(kind=>[kind,{medianMs:median(rows.filter(r=>r.kind===kind).map(r=>r.elapsedMs)),medianEventLoopMaxMs:median(rows.filter(r=>r.kind===kind).map(r=>r.eventLoopMaxMs))}])),limitation:'Copy throughput and event-loop blocking only, not end-to-end model efficiency'},null,2))
} finally {await rm(root,{recursive:true,force:true})}
