/** Duplicate UI projection work only; not a model or full-task benchmark. */
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const source = process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : new URL('../ui/lib/research-events.js', import.meta.url).href
const { emptyResearchProjection, applyResearchProjection } = await import(source)
const event = { seq: 1, type: 'tool/result', data: { meta: { kind: 'clearai', v: 1, mutations: [{ t: 'ontology/term_added', id: 't', label: 'Term' }] } } }
const state = applyResearchProjection(emptyResearchProjection('s'), event)
for (let i = 0; i < 10000; i++) state.seen['historical:' + i] = i
const times = []
for (let i = 0; i < 1000; i++) {
 const start = performance.now()
 if (applyResearchProjection(state, event) !== state) throw Error('Duplicate changed projection')
 times.push(performance.now() - start)
}
times.sort((a,b) => a-b)
console.log(JSON.stringify({ historicalKeys: 10000, duplicateEvents: 1000, totalMs: times.reduce((a,b) => a+b,0), p95Ms: times[950], modelCalls: 0 }))
