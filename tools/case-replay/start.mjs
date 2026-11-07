/** Isolated official DSH web host for recorded acceptance sessions; no provider credentials. */
import {mkdtempSync,mkdirSync,readdirSync,symlinkSync,writeFileSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1]
for(const flag of ['--host-node-modules','--config'])if(!args.includes(flag))throw new Error('Required: '+flag)
const modules=resolve(option('--host-node-modules')),root=resolve(import.meta.dirname,'../..'),cli=join(modules,'@deepseek-ai/dsh/lib/bin.js')
if(!existsSync(cli)||!existsSync(join(root,'dist/clearai-dsh/lib/host.js')))throw new Error('Official host and production build required')
const home=mkdtempSync(join(tmpdir(),'clearai-case-replay-')),profile=join(home,'profiles/web'),target=join(profile,'node_modules')
mkdirSync(target,{recursive:true})
for(const entry of readdirSync(modules,{withFileTypes:true})){
 if(entry.name.startsWith('@')){mkdirSync(join(target,entry.name));for(const child of readdirSync(join(modules,entry.name)))symlinkSync(join(modules,entry.name,child),join(target,entry.name,child),'junction')}
 else if(!['clearai-dsh','clearai-case-replay'].includes(entry.name))symlinkSync(join(modules,entry.name),join(target,entry.name),'junction')
}
symlinkSync(join(root,'dist/clearai-dsh'),join(target,'clearai-dsh'),'junction');symlinkSync(import.meta.dirname,join(target,'clearai-case-replay'),'junction')
writeFileSync(join(profile,'package.json'),JSON.stringify({name:'clearai-case-replay-profile',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','clearai-dsh']}}},null,2))
writeFileSync(join(profile,'cordis.yml'),'[]\n')
writeFileSync(join(profile,'cordis.patch.yml'),`- insert:
    - id: clearai-case-replay
      name: clearai-case-replay
- id: session-title-llm
  disabled: true
- id: ui-settings-general
  config:
    welcomeNoticeVersion: '2026-09-28.1'
- id: ui-settings-models
  config:
    credentialOnboarding: false
`)
const env={};for(const key of ['PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS'])if(process.env[key])env[key]=process.env[key]
Object.assign(env,{DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',CLEARAI_CASE_REPLAY_CONFIG:resolve(option('--config'))})
console.log('Recorded case profile: '+home)
const child=spawn(process.execPath,[cli,'web','--port',args.includes('--port')?option('--port'):'3096','--no-open'],{env,stdio:'inherit'})
process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>{process.exitCode=code??1})
