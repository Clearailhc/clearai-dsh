/** Install one explicitly selected CLI and candidate into a disposable DSH home. */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { nativeRuntime, npmCommand } from './runtime.mjs'
import { MODEL } from './matrix.mjs'
const repo=resolve(import.meta.dirname,'../..'),home=resolve(process.argv[2]||join(repo,'.tmp-native058/home')),profile=process.argv[3]||'native058'
const runtime=nativeRuntime(), require=createRequire(join(runtime.resources,'package.json')), yaml=require('yaml')
const env={...process.env,CLEARAI_DSH_RESOURCES:runtime.resources,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1'}
mkdirSync(home,{recursive:true})
function dsh(args){const result=spawnSync(runtime.app,[join(repo,'tools/native-headless/installed-cli.cjs'),...args],{env,encoding:'utf8',timeout:900000});if(result.status!==0)throw new Error('Native CLI failed: '+result.stderr.slice(-1500));return result.stdout}
dsh(['--profile',profile,...(existsSync(join(home,'profiles',profile,'package.json'))?[]:['--from-default-profile','headless']),'--dump-config'])
const dist=join(repo,'dist/clearai-dsh')
const packed=spawnSync(...npmCommand(['pack',dist,'--pack-destination',home,'--json']),{encoding:'utf8',env,timeout:120000})
if(packed.status!==0)throw new Error('Could not pack candidate')
const initial=join(home,JSON.parse(packed.stdout)[0].filename),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),packageDigest=sha(readFileSync(initial)),tarball=initial.replace(/\.tgz$/,`-${packageDigest.slice(0,16)}.tgz`)
copyFileSync(initial,tarball)
dsh(['plugin','--profile',profile,'add',tarball])
const patch=[
 {id:'agent-default-model',config:MODEL},
 {id:'llm-pi-ai',config:{providers:{deepseek:{apiKeyEnv:'DS_KEY',baseURL:'https://api.deepseek.com',models:[{id:'deepseek-flash',contextWindow:1048576,maxTokens:32768,input:['text'],reasoningEfforts:{medium:'medium'}}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
 {id:'headless-runner',disabled:true},
 {insert:[{id:'agent-preset-registry',name:'@deepseek-ai/dsh-agent-preset-registry',config:{default:'clearai'}},
 {id:'subagent-model-selection-settings',name:'@deepseek-ai/dsh-tool-subagent/model-selection-settings',config:{enabled:true,allowedModels:[{provider:MODEL.provider,model:MODEL.model}]}},
 {id:'native-test-carrier',name:join(repo,'tools/native-headless/carrier.mjs'),config:{profile,spec:join(home,'spec.json')}}]},
]
writeFileSync(join(home,'profiles',profile,'cordis.patch.yml'),yaml.stringify(patch),{mode:0o600})
const installed=join(home,'profiles',profile,'node_modules/clearai-dsh'),packageFiles=[]
function verify(dir){for(const entry of readdirSync(join(dist,dir),{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())verify(path);else{const expected=sha(readFileSync(join(dist,path)));if(sha(readFileSync(join(installed,path)))!==expected)throw new Error('Installed artifact mismatch: '+path);packageFiles.push({path,sha256:expected})}}}
verify('lib');verify('presets')
writeFileSync(join(home,'installation.json'),JSON.stringify({home,profile,...runtime,tarball,packageDigest,packageFiles,model:MODEL,version:JSON.parse(readFileSync(join(dist,'package.json'))).version},null,2))
console.log(JSON.stringify({home,profile,version:JSON.parse(readFileSync(join(dist,'package.json'))).version,runtime:runtime.runtime,credentialPresent:Boolean(process.env.DS_KEY)}))
