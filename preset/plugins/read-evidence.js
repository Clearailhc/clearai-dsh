import { readFileSync, statSync } from 'node:fs'
import { workspacePath } from './workspace-path.js'
import { contentDigest } from './audit-material.js'

export const name = 'clearai-read-evidence'
export const inject = ['tools', 'sessions']

export function readEvidence(cwd, requests) {
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
   const text = excerpt.slice(0, remaining)
   remaining -= text.length
   return { path: source.relative, line: start, digest: contentDigest(bytes), totalLines: lines.length, text, truncated: text.length < excerpt.length || start - 1 + count < lines.length }
  } catch (error) { return { path: request.path, error: String(error.message) } }
 })
}

export function apply(ctx) {
 ctx.tools.register({
  name: 'ReadEvidence',
  description: 'Batch-read up to eight evidence files with exact line numbers and content hashes. Hashes identify source bytes, not truth. Cite path and inspected line in the verdict; use native read/search for larger files.',
  parameters: { type: 'object', additionalProperties: false, required: ['sources'], properties: { sources: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' }, line: { type: 'integer' }, count: { type: 'integer' } } } } } },
  output: { schema: { type: 'object', properties: { sources: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'integer' }, digest: { type: 'string' }, totalLines: { type: 'integer' }, text: { type: 'string' }, truncated: { type: 'boolean' }, error: { type: 'string' } }, required: ['path'], additionalProperties: false } } }, required: ['sources'], additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
  execute(args, exec) {
   const session = ctx.get('sessions')?.get(String(exec.agent?.id))
   return { sources: readEvidence(session?.header?.cwd ?? session?.cwd, args.sources) }
  },
 })
}
