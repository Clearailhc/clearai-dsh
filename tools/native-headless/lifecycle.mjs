/** Genuine historical packages, native installed CLI, disposable profile. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,symlinkSync,copyFileSync} from 'node:fs'
import {execFileSync,spawnSync} from 'node:child_process'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {emptyState,applyMutations,STATE_VERSION} from '../../ui/lib/fold.js'
const repo=resolve(import.meta.dirname,'../..'),root=resolve(process.argv[2] || mkdtempSync('/private/tmp/clearai-native-lifecycle-'))
const home=join(root,'home'),profile='lifecycle52',app='/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,npm_config_cache:join(root,'npm-cache'),DSH_TELEMETRY_DISABLED:'1'}
if(process.argv.includes('--offline'))env.npm_config_offline='true'
mkdirSync(home,{recursive:true});const checks=[]
const sha=buffer=>createHash('sha256').update(buffer).digest('hex')
function cli(args){const r=spawnSync(app,[join(repo,'tools/native-headless/installed-cli.cjs'),...args],{env,encoding:'utf8',timeout:900000});if(r.status!==0)throw new Error('Native CLI failed: '+r.stderr.slice(-600));return r.stdout}
const built=[]
const historicalVersions=(process.argv.find(arg=>arg.startsWith('--versions='))?.slice('--versions='.length)??'0.5.0,0.5.1').split(',')
assert.ok(historicalVersions.every(version=>/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(version)))
for(const version of historicalVersions){
 const source=join(root,'source-'+version);mkdirSync(source,{recursive:true})
 execFileSync('tar',['-x','-C',source],{input:execFileSync('git',['archive','v'+version],{cwd:repo,maxBuffer:128*1024*1024})})
 symlinkSync(join(repo,'node_modules'),join(source,'node_modules'),'dir')
 const dist=join(root,'package-'+version)
 const build=spawnSync(process.execPath,[join(source,'tools/build-package.mjs'),'--out',dist],{cwd:source,encoding:'utf8',timeout:120000})
 assert.equal(build.status,0,build.stderr);built.push({version,dist})
 const old=await import(pathToFileURL(join(source,'ui/lib/fold.js')).href)
 const ledger=[{t:'goal/set',id:'g-old',claim:'Historical calibration',done_criteria:'one record',hypotheses:[{id:'h-old',claim:'old sensor bias',refute_when:'independent reading differs'}]},{t:'fact/promoted',id:'f-old',text:'old sensor bias',hypothesis:'h-old',level:'L3',scope:'independent reading differs'},{t:'evidence/recorded',id:'e-old',hypothesis:'h-old',level:'L3',verdict:'support'}]
 const before=JSON.stringify(ledger),legacy=old.applyMutations(old.emptyState(),ledger),replayed=applyMutations(emptyState(),ledger)
 assert.equal(replayed.facts[0].scope,null);assert.equal(replayed.facts[0].refute_when,'independent reading differs')
 assert.equal(replayed.facts[0].id,legacy.facts[0].id);assert.equal(JSON.stringify(ledger),before)
 checks.push({check:'replay',version,oldStateVersion:old.STATE_VERSION,newStateVersion:STATE_VERSION,ledgerDigest:sha(before),passed:true})
}
built.push({version:JSON.parse(readFileSync(join(repo,'dist/clearai-dsh/package.json'))).version,dist:join(repo,'dist/clearai-dsh')})
cli(['--profile',profile,'--from-default-profile','headless','--dump-config'])
function packageTarball(item){const r=spawnSync('npm',['pack',item.dist,'--pack-destination',root,'--json'],{env,encoding:'utf8',timeout:120000});assert.equal(r.status,0,r.stderr);const initial=join(root,JSON.parse(r.stdout)[0].filename),digest=sha(readFileSync(initial)),path=initial.replace(/\.tgz$/,`-${digest.slice(0,16)}.tgz`);copyFileSync(initial,path);return {path,digest}}
for(const item of built){const packed=packageTarball(item);cli(['plugin','--profile',profile,'add',packed.path]);const installed=join(home,'profiles',profile,'node_modules/clearai-dsh'),manifest=JSON.parse(readFileSync(join(installed,'package.json'))),profileManifest=JSON.parse(readFileSync(join(home,'profiles',profile,'package.json')));assert.equal(manifest.version,item.version);assert.equal(profileManifest.dsh.profile.bundles.filter(x=>x==='clearai-dsh').length,1);const rows=cli(['--profile',profile,'--dump-config']);assert(rows.includes('preset-clearai'));assert(rows.includes('clearai-host'));for(const path of ['lib/fold.js','presets/clearai/plugins/clearai-kernel.js'])if(existsSync(join(item.dist,path)))assert.equal(sha(readFileSync(join(installed,path))),sha(readFileSync(join(item.dist,path))));checks.push({check:'native-install-upgrade',version:item.version,packageDigest:packed.digest,passed:true})}
const candidate=packageTarball(built.at(-1))
cli(['plugin','--profile',profile,'remove','clearai-dsh'])
assert(!existsSync(join(home,'profiles',profile,'node_modules/clearai-dsh')))
const removed=cli(['--profile',profile,'--dump-config']);assert(!removed.includes('preset-clearai'));assert(!removed.includes('clearai-host'))
checks.push({check:'native-uninstall',passed:true})
cli(['plugin','--profile',profile,'add',candidate.path])
assert(cli(['--profile',profile,'--dump-config']).includes('preset-clearai'))
checks.push({check:'native-reinstall',passed:true})
writeFileSync(join(root,'result.json'),JSON.stringify({passed:true,root,checks},null,2)+'\n')
console.log(JSON.stringify({passed:true,root,checks}))
