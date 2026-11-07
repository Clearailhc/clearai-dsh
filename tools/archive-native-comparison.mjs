/** Export settled measurements and public tool activity; private model streams stay local. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, relative, extname } from 'node:path'
import { createHash } from 'node:crypto'

const [sourceArg, destinationArg] = process.argv.slice(2)
assert.ok(sourceArg && destinationArg, 'Usage: archive-native-comparison.mjs <settled trial> <new archive>')
const source = resolve(sourceArg), destination = resolve(destinationArg)
assert.ok(!existsSync(destination), 'Keep previous attempt archives intact')
const json = path => JSON.parse(readFileSync(join(source, path)))
const comparison = json('comparison.json'), verification = json('verification.json')
assert.equal(comparison.complete, true)
assert.equal(verification.dataVerified, true)
assert.equal(json('grading-truth.json').disclosedAfterAllWorkersExited, true)
const secrets = [process.env.DS_KEY].filter(Boolean)
for (const entry of readdirSync(join(source, 'workspaces'), { withFileTypes: true })) {
 const endpoint = join(source, 'workspaces', entry.name, 'experiment-endpoint.json')
 if (entry.isDirectory() && existsSync(endpoint)) secrets.push(JSON.parse(readFileSync(endpoint)).token)
}
const publicTypes = new Set(['tool/call', 'tool/result', 'goal/change', 'subagent/descriptor', 'subagent/catalog', 'job/registered', 'job/settled', 'turn/start', 'turn/end', 'step/start', 'step/end'])
const omittedKeys = new Set(['stream', 'reasoning', 'reasoning_content', 'reasoningContent'])
function scrub(value) {
 if (Array.isArray(value)) return value.filter(v => !(v && typeof v === 'object' && /reasoning/i.test(v.type ?? ''))).map(scrub)
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !omittedKeys.has(key)).map(([key, item]) => [key, scrub(item)]))
 if (typeof value === 'string') for (const secret of secrets) if (secret) value = value.replaceAll(secret, '[credential redacted]')
 return value
}
const files = []
function save(path, value, format = 'json') {
 const target = resolve(destination, path)
 assert.ok(target.startsWith(destination + '/'))
 const text = format === 'json' ? JSON.stringify(scrub(value), null, 2) + '\n' : format === 'jsonl' ? value.map(v => JSON.stringify(scrub(v))).join('\n') + '\n' : scrub(value)
 for (const secret of secrets) if (secret) assert.ok(!text.includes(secret), 'Secret in archive')
 assert.ok(!/sk-[a-zA-Z0-9]{20,}/.test(text), 'Possible API credential in archive')
 mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, text)
 files.push({ path, sha256: createHash('sha256').update(text).digest('hex') })
}
for (const name of ['manifest.json', 'comparison.json', 'verification.json', 'grading-truth.json', 'stop-after-current.json']) if (existsSync(join(source, name))) save(name, json(name))
for (const row of comparison.results.filter(r => r.reason !== 'not_run')) {
 const run = `runs/${row.id}`
 for (const name of ['launcher-result.json', 'isolation-probe.json', 'spec.json', 'carrier-started.json', 'session-started.json']) if (existsSync(join(source, run, name))) save(`${run}/${name}`, json(`${run}/${name}`))
 for (const name of readdirSync(join(source, run)).filter(name => name.endsWith('.jsonl'))) {
  const records = readFileSync(join(source, run, name), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  const measuredCalls = name === 'llm-calls.jsonl'
  save(`${run}/${measuredCalls ? name : name.replace('.jsonl', '.public.jsonl')}`, measuredCalls ? records : records.filter(row => publicTypes.has(row.type)), 'jsonl')
 }
 const snapshot = resolve(source, row.snapshot)
 assert.ok(snapshot.startsWith(source + '/'))
 function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
   const path = join(dir, entry.name), output = relative(source, path)
   if (['node_modules', '.git', '.clearai-reruns', '__pycache__'].includes(entry.name) || entry.isSymbolicLink()) continue
   if (entry.isDirectory()) walk(path)
   else if (entry.isFile() && ['.json', '.md', '.txt', '.py', '.csv', '.js', '.mjs'].includes(extname(path))) {
    const content = readFileSync(path, 'utf8')
    save(output, extname(path) === '.json' ? JSON.parse(content) : content, extname(path) === '.json' ? 'json' : 'text')
   }
  }
 }
 walk(snapshot)
}
save('archive.json', { schema: 'clearai.public-comparison-archive.v1', complete: true, acceptancePassed: verification.passed, policy: 'Original sessions remain private. Public archives retain measured usage, tool calls/results, task lifecycle and source artifacts. Assistant reasoning and duplicate stream payloads are omitted; credentials are redacted. Sanitized files have separate hashes and do not claim byte identity with originals.', files })
console.log(JSON.stringify({ destination, files: files.length, acceptancePassed: verification.passed }))
