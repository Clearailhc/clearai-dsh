/** Native tarball installation into a disposable home using the installed CLI. */
import {mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,chmodSync,readdirSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {spawnSync} from 'node:child_process'
import {homedir} from 'node:os'
import {createHash} from 'node:crypto'
const repo=resolve(import.meta.dirname,'../..')
const home=resolve(process.argv[2] || join(repo,'.tmp-native52/home'))
const profile=process.argv[3] || 'native52-pr23'
const app='/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
const cli=join(repo,'tools/native-headless/installed-cli.cjs')
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,npm_config_cache:join(home,'npm-cache'),DSH_TELEMETRY_DISABLED:'1'}
if(process.argv.includes('--offline'))env.npm_config_offline='true'
mkdirSync(home,{recursive:true})
for(const f of ['.credentials.yaml','settings.yaml'])if(existsSync(join(homedir(),'.dsh',f))){copyFileSync(join(homedir(),'.dsh',f),join(home,f));chmodSync(join(home,f),0o600)}
function dsh(args){const run=spawnSync(app,[cli,...args],{env,encoding:'utf8',timeout:900000});if(run.status!==0)throw new Error('Installed CLI failed: '+String(run.stderr).slice(-1000));return run.stdout}
dsh(['--profile',profile,...(existsSync(join(home,'profiles',profile,'package.json')) ? [] : ['--from-default-profile','headless']),'--dump-config'])
const dist=join(repo,'dist/clearai-dsh')
const packed=spawnSync('npm',['pack',dist,'--pack-destination',home,'--json'],{env,encoding:'utf8',timeout:120000})
if(packed.status!==0)throw new Error('npm pack failed: '+packed.stderr.slice(-600))
const packedFile=join(home,JSON.parse(packed.stdout)[0].filename)
const runtimeDigest=createHash('sha256').update(readFileSync('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar')).digest('hex')
const packageDigest=createHash('sha256').update(readFileSync(packedFile)).digest('hex')
const tarball=packedFile.replace(/\.tgz$/,`-${packageDigest.slice(0,16)}.tgz`)
copyFileSync(packedFile,tarball)
if (!process.argv.includes('--configure-only')) dsh(['plugin','--profile',profile,'add',tarball])
else if (!existsSync(join(home,'profiles',profile,'node_modules/clearai-dsh/package.json'))) throw new Error('Configure-only requires a natively installed candidate')
// Use the parser shipped with the installed app, without an npm cache dependency.
function yamlTransform(operation,input) {
 const source="const fs=require('fs'),yaml=require('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/yaml');const input=fs.readFileSync(0,'utf8');process.stdout.write("+(operation==='parse'?'JSON.stringify(yaml.parse(input))':'yaml.stringify(JSON.parse(input))')+");"
 const run=spawnSync(app,['-e',source],{env,input,encoding:'utf8',timeout:30000})
 if(run.status!==0)throw new Error('Installed YAML parser unavailable')
 return operation==='parse'?JSON.parse(run.stdout):run.stdout
}
const yaml={parse:input=>yamlTransform('parse',input),stringify:input=>yamlTransform('stringify',JSON.stringify(input))}
const desktop=yaml.parse(readFileSync(join(homedir(),'.dsh/profiles/desktop/cordis.patch.yml'),'utf8'))
const llm=desktop.find(x=>x.id==='llm-pi-ai')?.config
if(!llm?.providers?.abhome)throw new Error('Configured abhome provider not found')
const patch=[{id:'agent-default-model',config:{provider:'abhome',model:'deepseek-flash',reasoningEffort:'medium'}},{id:'llm-pi-ai',config:{...llm,providers:{abhome:llm.providers.abhome}}},{id:'headless-runner',disabled:true},{insert:[{id:'agent-preset-registry',name:'@deepseek-ai/dsh-agent-preset-registry',config:{default:'clearai'}},{id:'subagent-model-selection-settings',name:'@deepseek-ai/dsh-tool-subagent/model-selection-settings',config:{enabled:true,allowedModels:[{provider:'abhome',model:'deepseek-flash'}]}},{id:'native-test-carrier',name:join(repo,'tools/native-headless/carrier.mjs'),config:{profile,spec:process.env.CLEARAI_NATIVE_SPEC || join(home,'spec.json')}}]}]
if (process.argv.includes('--teams')) {
 const read=spawnSync(app,['-e',"process.stdout.write(require('fs').readFileSync('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-experimental-agent-team-profile/cordis.patch.yml','utf8'))"],{env,encoding:'utf8',timeout:30000})
 if(read.status!==0)throw new Error('Installed native Team profile is unavailable')
 patch.unshift(...yaml.parse(read.stdout))
}
const p=join(home,'profiles',profile,'cordis.patch.yml');writeFileSync(p,yaml.stringify(patch));chmodSync(p,0o600)
const installed=join(home,'profiles',profile,'node_modules','clearai-dsh'), packageFiles=[]
function verifyFiles(dir,rel='') {
 for(const entry of readdirSync(join(dir,rel),{withFileTypes:true})) {
  const path=join(rel,entry.name)
  if(entry.isDirectory())verifyFiles(dir,path)
  else {
   const sha=buffer=>createHash('sha256').update(buffer).digest('hex'), expected=sha(readFileSync(join(dir,path))),actual=sha(readFileSync(join(installed,path)))
   if(expected!==actual)throw new Error(`Native installation differs from source artifact: ${path}`)
   packageFiles.push({path,sha256:actual})
  }
 }
}
verifyFiles(dist,'lib');verifyFiles(dist,'presets')
const versions=spawnSync(app,['-e',"const fs=require('fs');const root='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/';console.log(JSON.stringify({node:process.version,cli:JSON.parse(fs.readFileSync(root+'dsh/package.json')).version,agent:JSON.parse(fs.readFileSync(root+'dsh-agent/package.json')).version}))"],{env,encoding:'utf8',timeout:30000})
if(versions.status!==0)throw new Error('Installed runtime version query failed')
const runtime=JSON.parse(versions.stdout)
if(runtime.cli!=='0.2.0-rc.2')throw new Error('This preregistration requires installed DSH 0.2.0-rc.2')
writeFileSync(join(home,'installation.json'),JSON.stringify({home,profile,teams:process.argv.includes('--teams'),app,tarball,packageDigest,runtimeDigest,runtime,packageFiles,model:{provider:'abhome',model:'deepseek-flash',reasoningEffort:'medium'},version:JSON.parse(readFileSync(join(dist,'package.json'))).version},null,2))
console.log(JSON.stringify({home,profile,tarball,version:JSON.parse(readFileSync(join(dist,'package.json'))).version}))
