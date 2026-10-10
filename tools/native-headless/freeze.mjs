import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join, resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { MODEL, BUDGETS, sessions, REQUIRED_GATES } from './matrix.mjs'
import { DIAGNOSTIC_SCHEMA, DIAGNOSTIC_AUTHORIZATION, diagnosticSessions } from './diagnostic-protocol.mjs'
import { initializeCampaignRoot } from './public-materials.mjs'

const repo = resolve(import.meta.dirname, '../..'), [candidate, output] = process.argv.slice(2)
if (!candidate || !output) throw new Error('Usage: node freeze.mjs <candidate.tgz> <new-output-directory>')
const diagnostic=process.argv.includes('--diagnostic')
const destination = resolve(output)
if (existsSync(join(destination, 'manifest.json'))) throw new Error('Frozen manifest already exists; use a new candidate round')
const dirty=execFileSync('git',['-c','core.fsmonitor=false','status','--porcelain'],{cwd:repo,encoding:'utf8'})
if(dirty.trim())throw new Error('Commit the reviewed implementation and test assets before freezing')
initializeCampaignRoot(destination)
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const files = []
function walk(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else files.push({ path: relative(repo, path), sha256: sha(path) }) } }
walk(join(repo, 'tools/native-headless'))
for(const path of ['preset/plugins/scope.js','docs/optimization/0.5.2-plan/pr23-preregistration.zh-CN.md','docs/optimization/0.5.2-plan/direct-long-diagnostic.zh-CN.md'])files.push({path,sha256:sha(join(repo,path))})
mkdirSync(destination, { recursive: true })
const controller=join(destination,'.controller');mkdirSync(controller,{recursive:true})
const key=join(controller,'world-key')
if(!existsSync(key))writeFileSync(key,randomBytes(32),{mode:0o600})
writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ schema: diagnostic?DIAGNOSTIC_SCHEMA:'clearai.pr23.validation.v1', ...(diagnostic?{authorization:DIAGNOSTIC_AUTHORIZATION,productAcceptance:false}:{}), base: '4a866bc5c22f80face7b5c0a78a83e6fe832f7da', commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), candidate: { path: resolve(candidate), sha256: sha(candidate) }, model: MODEL, budgets: BUDGETS, gates: diagnostic?[]:REQUIRED_GATES, assets: files.sort((a, b) => a.path.localeCompare(b.path)), sessions: diagnostic?diagnosticSessions():sessions(), worldKeyCommitment:sha(key), hiddenTruthPolicy: 'World key persists only in protected controller storage, committed before runs; truth remains in controller memory. Deny controller/profile/other-workspace reads, verify actual probes; never place truth or key in worker workspace/spec/argv.' }, null, 2) + '\n')
console.log(join(destination, 'manifest.json'))
