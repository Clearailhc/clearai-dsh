/** Install a real web UI in a separate profile. No daily desktop modification. */
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {spawnSync} from 'node:child_process'
const [sourceHome,destination,profile='ui52']=process.argv.slice(2)
if(!destination||resolve(sourceHome)===resolve(destination))throw new Error('Usage: ui-setup.mjs <isolated-source-home> <separate-ui-home> [profile]')
const installation=JSON.parse(readFileSync(join(sourceHome,'installation.json'))),home=resolve(destination),repo=resolve(import.meta.dirname,'../..')
mkdirSync(home,{recursive:true})
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',npm_config_offline:'true'}
const cli=args=>{const r=spawnSync(installation.app,[join(repo,'tools/native-headless/installed-cli.cjs'),...args],{env,encoding:'utf8',timeout:900000});if(r.status!==0)throw new Error('Native UI CLI failed: '+r.stderr.slice(-500));return r.stdout}
cli(['--profile',profile,...(existsSync(join(home,'profiles',profile,'package.json'))?[]:['--from-default-profile','web']),'--dump-config'])
cli(['plugin','--profile',profile,'add',installation.tarball])
for(const file of ['.credentials.yaml','settings.yaml'])if(existsSync(join(sourceHome,file))){copyFileSync(join(sourceHome,file),join(home,file));chmodSync(join(home,file),0o600)}
const input=JSON.stringify({patch:join(sourceHome,'profiles',installation.profile,'cordis.patch.yml'),output:join(home,'profiles',profile,'cordis.patch.yml')})
const script="const fs=require('fs'),yaml=require('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/yaml');const cfg=JSON.parse(fs.readFileSync(0,'utf8'));const original=yaml.parse(fs.readFileSync(cfg.patch,'utf8'));const patch=original.filter(row=>['agent-default-model','llm-pi-ai'].includes(row.id)||row.id?.startsWith('tool-subagent')||row.insert?.some(item=>item.id==='agent-team')); patch.push({id:'agent-preset-registry',config:{default:'clearai'}},{id:'subagent-model-selection-settings',config:{enabled:true,allowedModels:[{provider:'abhome',model:'deepseek-flash'}]}});fs.writeFileSync(cfg.output,yaml.stringify(patch),{mode:0o600});"
const transformed=spawnSync(installation.app,['-e',script],{env,input,encoding:'utf8',timeout:30000})
if(transformed.status!==0)throw new Error('Native UI patch configuration failed')
writeFileSync(join(home,'ui-installation.json'),JSON.stringify({home,profile,candidateDigest:installation.packageDigest,runtime:installation.runtime,model:installation.model},null,2))
console.log(JSON.stringify({home,profile,candidateDigest:installation.packageDigest}))
