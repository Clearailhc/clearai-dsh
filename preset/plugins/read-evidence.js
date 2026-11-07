import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { workspacePath } from './workspace-path.js'
import { contentDigest } from './audit-material.js'

export const name = 'clearai-read-evidence'
export const inject = ['tools', 'sessions']

// Observation only: do not infer semantic reuse from an existing file. Capture
// names before the first tool call, not when a model later declares reuse.
export function sourceInventory(cwd) {
 const paths = new Set(); let complete = true
 const walk = (dir, prefix = '') => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
   if (paths.size >= 10000) { complete = false; return }
   const path = prefix + entry.name
   if (entry.isSymbolicLink() || ['node_modules', '.git', '.venv', 'venv'].includes(entry.name)) { complete = false; continue }
   if (entry.isDirectory()) walk(join(dir, entry.name), path + '/')
   else if (entry.isFile()) paths.add(path)
  }
 }
 try { walk(cwd) } catch { complete = false }
 return { paths, complete }
}

// Session-local transport receipts, never evidence of truth or audit authority.
// Only a fully delivered range may be omitted. A different range, changed bytes,
// fresh session, or an ordinary read always returns text. No source text is cached.
export function readEvidence(cwd, requests, receipts = new Map()) {
 if (!cwd || !Array.isArray(requests) || requests.length < 1 || requests.length > 8) throw new Error('Supply 1–8 sources in the current workspace.')
 let remaining = 24000
 return requests.map(request => {
  try {
   const source = workspacePath(cwd, request.path, { mustExist: true })
   if (statSync(source.absolute).size > 2 * 1024 * 1024) throw new Error('Source exceeds 2 MiB; use native bounded read/search.')
   const bytes = readFileSync(source.absolute)
   const lines = bytes.toString('utf8').split(/\r?\n/)
   const start = request.line ?? 1, count = request.count ?? 80
   if (!Number.isInteger(start) || start < 1 || start > lines.length || !Number.isInteger(count) || count < 1 || count > 240) throw new Error('Invalid line range (count 1–240).')
   const excerpt = lines.slice(start - 1, start - 1 + count).map((line, i) => `${start + i}: ${line}`).join('\n')
   const digest = contentDigest(bytes)
   const key = JSON.stringify([cwd, source.relative, start, count])
   const previous = receipts.get(key)
   if (request.ifUnchanged === true && previous?.digest === digest && previous.chars > 512) return { path: source.relative, line: start, count, digest, totalLines: lines.length, unchanged: true, omittedChars: previous.chars, text: '', truncated: start - 1 + count < lines.length, notice: 'This exact range was already delivered in this session with identical bytes. Omit ifUnchanged or set it to false to read the text again. Matching bytes do not establish truth or applicability.' }
   const text = excerpt.slice(0, remaining)
   remaining -= text.length
   if (text.length === excerpt.length) {
    if (receipts.size >= 512 && !receipts.has(key)) receipts.delete(receipts.keys().next().value)
    receipts.set(key, { digest, chars: text.length })
   }
   return { path: source.relative, line: start, count, digest, totalLines: lines.length, text, truncated: text.length < excerpt.length || start - 1 + count < lines.length }
  } catch (error) { return { path: request.path, error: String(error.message) } }
 })
}

export function apply(ctx) {
 const sessions = new WeakMap()
 const inventories = new WeakMap()
 ctx.on?.('agent/pre-step', (payload, next) => {
  const session = ctx.get('sessions')?.get(String(payload?.agent?.id))
  if (session && !inventories.has(session)) {
   const events = session.snapshotEvents?.()
   const fresh = Array.isArray(events) && !events.some(event => event.type === 'tool/call')
   inventories.set(session, fresh ? sourceInventory(session.header?.cwd ?? session.cwd) : { paths: new Set(), complete: false })
  }
  return next()
 })
 ctx.tools.register({
  name: 'ReadEvidence',
  description: 'Batch-read 1–8 bounded evidence ranges with line numbers and content hashes. Set ifUnchanged:true only to check a previously read range without repeating its text. Ordinary reads always return text, including after context compaction. Changed files and new ranges return text. sourceOrigin records whether a file was observed before this session first used tools, created later, or unknown; do not list newly created snapshots as pre-existing reuse. Reads and matching bytes never establish truth or semantic applicability. Use native read/search for larger files.',
  parameters: { type: 'object', additionalProperties: false, required: ['sources'], properties: { sources: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' }, line: { type: 'integer' }, count: { type: 'integer' }, ifUnchanged: { type: 'boolean', description: 'Opt in to a receipt for an identical range already delivered in this session. Omit/false to return text; changed files always return text.' } } } } } },
  output: { schema: { type: 'object', properties: { sources: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'integer' }, count: { type: 'integer' }, digest: { type: 'string' }, totalLines: { type: 'integer' }, text: { type: 'string' }, truncated: { type: 'boolean' }, unchanged: { type: 'boolean' }, omittedChars: { type: 'integer' }, notice: { type: 'string' }, sourceOrigin: { type: 'string', enum: ['pre-existing', 'created-after-baseline', 'unknown'] }, error: { type: 'string' } }, required: ['path'], additionalProperties: false } } }, required: ['sources'], additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
  execute(args, exec) {
   const session = ctx.get('sessions')?.get(String(exec.agent?.id))
   if (session && !sessions.has(session)) sessions.set(session, new Map())
   const inventory = session ? inventories.get(session) : null
   return { sources: readEvidence(session?.header?.cwd ?? session?.cwd, args.sources, session ? sessions.get(session) : new Map()).map(row => row.error ? row : ({ ...row, sourceOrigin: inventory?.paths.has(row.path) ? 'pre-existing' : inventory?.complete ? 'created-after-baseline' : 'unknown' })) }
  },
 })
}
