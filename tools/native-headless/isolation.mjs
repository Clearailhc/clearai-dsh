/** Test-only read fence, layered on native DSH write/cancel/approval policy. */
import { realpathSync, existsSync, symlinkSync, unlinkSync } from 'node:fs'
import { resolve, relative, dirname, basename, join } from 'node:path'
import {homedir} from 'node:os'
const canonical = path => {
 const full=resolve(path)
 if(existsSync(full))return realpathSync(full)
 const parent=dirname(full)
 return parent===full?full:join(canonical(parent),basename(full))
}
const under = (path,root) => { const rel=relative(root,path); return rel===''||(!rel.startsWith('..')&&!rel.startsWith('/')) }
const quote = value => JSON.stringify(value)
export function installReadIsolation(ctx,{roots,workspace}) {
 if(process.platform!=='darwin')throw new Error('Read isolation must be validated on this test host; macOS Seatbelt is required')
 const deny=[...new Set([...roots,homedir()].map(canonical))],allowed=canonical(workspace)
 const sandbox=ctx.get('sandbox'),shell=ctx.get('shell')
 if(!sandbox?.confine||shell?.sandboxMode!=='workspace-write')throw new Error('Native confined shell/write policy required for read isolation')
 const confine=sandbox.confine.bind(sandbox)
 const restriction=`(deny file-read* (require-all (require-any ${deny.map(root=>`(subpath ${quote(root)})`).join(' ')}) (require-not (subpath ${quote(allowed)}))))`
 sandbox.confine=async(...args)=>{
  const prepared=await confine(...args)
  const argv=[...prepared.argv],index=argv.indexOf('-p')
  if(!String(argv[0]).endsWith('sandbox-exec')||index<0||typeof argv[index+1]!=='string')throw new Error('Expected native Seatbelt profile; cannot safely attach read isolation')
  // One kernel application: nesting sandbox-exec is prohibited by native policy.
  argv[index+1]+='\n'+restriction
  return {...prepared,argv,denialSignatures:[...(prepared.denialSignatures??[]),'Operation not permitted']}
 }
 ctx.effect(()=>()=>{sandbox.confine=confine})
 ctx.tools.guard(exec=>{
  if(exec.arguments?.sandbox_permissions)return 'test_read_isolation: escalation unavailable in fixed test environment'
  if(!['read','read_image','write','edit','glob','grep','ls'].includes(exec.name))return
  const scan=['glob','grep','ls'].includes(exec.name)
  for(const key of scan?['path']:['file_path']) {
   const value=exec.arguments?.[key]??(scan?'.':null);if(typeof value!=='string')continue
   const path=canonical(resolve(exec.agent?.session?.header?.cwd??workspace,value))
   if(!under(path,allowed)&&deny.some(root=>under(path,root)||(scan&&under(root,path))))return 'test_read_isolation: another group, private profile or controller output is unavailable'
  }
 })
 return {backend:'native-write-policy+seatbelt-read-fence',roots:deny,workspace:allowed}
}

export async function probeReadIsolation(ctx,agent,path) {
 if(!existsSync(path))throw new Error('Actual isolation probe needs an existing external sentinel')
 const execute=async(name,args)=>ctx.tools.execute({name,arguments:args,agent,signal:new AbortController().signal,callId:'isolation-'+name})
 const read=await execute('read',{file_path:path})
 const shell=await execute('bash',{command:`cat '${path.replaceAll("'","'\\''")}'`,description:'Verify private controller file is unreadable',workdir:agent.session.header.cwd,timeoutMs:10000,run_in_background:false})
 const positive=await execute('bash',{command:'printf isolation-ok > isolation-public.txt; cat isolation-public.txt',description:'Verify allowed workspace reads and writes succeed',workdir:agent.session.header.cwd,timeoutMs:10000,run_in_background:false})
 const readDenied=read.isError===true&&JSON.stringify(read).includes('test_read_isolation')
 const shellDenied=!shell.isError&&shell.value?.exitCode!==0&&shell.value?.sandbox?.runnerFailed!==true&&/Operation not permitted|Permission denied/i.test(JSON.stringify(shell.value?.stderr))
 const workspaceWorks=!positive.isError&&positive.value?.exitCode===0&&positive.value?.stdout?.text==='isolation-ok'
 const alias=join(agent.session.header.cwd,'isolation-private-link')
 let symlink
 try{symlinkSync(path,alias);symlink=await execute('read',{file_path:alias})}finally{if(existsSync(alias))unlinkSync(alias)}
 const symlinkDenied=symlink?.isError===true&&JSON.stringify(symlink).includes('test_read_isolation')
 const parentScan=await execute('grep',{path:dirname(path),pattern:'SECRET'})
 const parentDenied=parentScan.isError===true&&JSON.stringify(parentScan).includes('test_read_isolation')
 if(!readDenied||!shellDenied||!workspaceWorks||!symlinkDenied||!parentDenied)throw new Error('Isolation probe failed: '+JSON.stringify({read,shell,positive,symlink,parentScan,readDenied,shellDenied,workspaceWorks,symlinkDenied,parentDenied}))
 return {passed:true,path,readDenied,shellDenied,workspaceWorks,symlinkDenied,parentDenied,read,shell,positive,symlink,parentScan}
}
