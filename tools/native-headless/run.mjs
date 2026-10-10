/** Run an installed native profile; never flatten presets or modify the app. */
import {spawn} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const repo=resolve(fileURLToPath(new URL('../..',import.meta.url)))
export function nativeTestEnvironment(home,specPath,source=process.env) {
 const env={}
 for(const key of ['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG','LC_ALL','LC_CTYPE','SSL_CERT_FILE','SSL_CERT_DIR'])if(source[key]!==undefined)env[key]=source[key]
 return {...env,DSH_HOME:home,ELECTRON_RUN_AS_NODE:'1',CLEARAI_NATIVE_SPEC:specPath,DSH_TELEMETRY_DISABLED:'1'}
}
export async function runNative({home,profile='native52',workspace,spec}) {
 home=resolve(home);workspace=resolve(workspace)
 if(!existsSync(join(home,'installation.json')))throw new Error('Run setup.mjs first; native candidate installation required')
 const installation=JSON.parse(readFileSync(join(home,'installation.json')))
 if(installation.profile!==profile)throw new Error('Installed profile mismatch')
 if(!installation.packageFiles?.length||installation.runtime?.cli!=='0.2.0-rc.2')throw new Error('Missing verified native artifact/runtime metadata; reconfigure isolated installation')
 for(const file of installation.packageFiles)if(createHash('sha256').update(readFileSync(join(home,'profiles',profile,'node_modules','clearai-dsh',file.path))).digest('hex')!==file.sha256)throw new Error(`Installed candidate changed: ${file.path}`)
 if(!['A','C','C-no-applicability','C-no-negative'].includes(spec.group))throw new Error('Unknown group')
 if(!spec.tokenBudget||!spec.timeoutMs||!spec.output||!spec.task)throw new Error('Incomplete run spec')
 const output=resolve(spec.output)
 if(existsSync(join(output,'result.json')))throw new Error('Refusing to overwrite a prior run')
 mkdirSync(output,{recursive:true});mkdirSync(workspace,{recursive:true})
 const specPath=join(output,'spec.json');writeFileSync(specPath,JSON.stringify({...spec,output},null,2)+'\n')
 const log=await import('node:fs').then(fs=>fs.createWriteStream(join(output,'launcher.log')))
 const child=spawn(installation.app,[join(repo,'tools/native-headless/installed-cli.cjs'),'--profile',profile],{cwd:workspace,env:nativeTestEnvironment(home,specPath),stdio:['ignore','pipe','pipe']})
 child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false})
 let forcedKill
 let stopping=false,stopCause

 const stop=(cause='user_cancelled')=>{if(stopping)return;stopping=true;stopCause=cause;child.kill('SIGTERM');forcedKill ??=setTimeout(()=>child.kill('SIGKILL'),15000)}
 const userStop=()=>stop('user_cancelled')
 process.once('SIGINT',userStop);process.once('SIGTERM',userStop)
 const startup=setTimeout(()=>{if(!existsSync(join(output,'carrier-started.json')))stop('infrastructure_error')},30000)
 const timeout=setTimeout(()=>stop('time_limit'),spec.timeoutMs+30000)
 const status=await new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}))})
 clearTimeout(startup);clearTimeout(timeout);clearTimeout(forcedKill);process.off('SIGINT',userStop);process.off('SIGTERM',userStop);await new Promise(r=>log.end(r))
 if(!existsSync(join(output,'result.json'))) {
  const result={group:spec.group,reason:stopCause ?? 'infrastructure_error',failure:'Native carrier did not produce a final result',usage:existsSync(join(output,'checkpoint.json'))?JSON.parse(readFileSync(join(output,'checkpoint.json'))).usage:{status:'unknown',processed:null,lowerBound:0},status}
  writeFileSync(join(output,'launcher-result.json'),JSON.stringify(result,null,2));return result
 }
 const result=JSON.parse(readFileSync(join(output,'result.json')))
 if(stopCause&&stopCause!=='user_cancelled')result.reason=stopCause
 if(result.reason==='completed'&&(!result.usage?.calls||result.usage?.missing||!result.answer)) {result.reason='infrastructure_error';result.failure='Unverifiable usage or missing answer'}
 result.installation={version:installation.version,packageDigest:installation.packageDigest,model:installation.model,runtime:installation.runtime,runtimeDigest:installation.runtimeDigest};result.process=status
 writeFileSync(join(output,'launcher-result.json'),JSON.stringify(result,null,2)+'\n');return result
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const option=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1]}
 const specPath=option('spec'),home=option('home'),workspace=option('workspace')
 if(!specPath||!home||!workspace)throw new Error('Usage: node run.mjs --home <isolated DSH_HOME> --profile native52 --workspace <path> --spec <json>')
 const result=await runNative({home,profile:option('profile'),workspace,spec:JSON.parse(readFileSync(specPath))})
 console.log(JSON.stringify({group:result.group,reason:result.reason,usage:result.usage,output:resolve(JSON.parse(readFileSync(specPath)).output)}))
 process.exitCode=result.reason==='completed'?0:1
}
