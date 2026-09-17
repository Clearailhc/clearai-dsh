/**
 * 离线重判一场已保留的 e2e 现场:把真日志折成投影,打印本体格的全部读数。
 * 用法:node tools/e2e-rejudge-ontology.mjs <日志路径> <标签>
 */
import { execFileSync } from 'node:child_process'
import { applyEvent, derive, emptyState, view } from '../ui/lib/fold.js'

const logPath = process.argv[2]
const label = process.argv[3] ?? logPath
const raw = execFileSync('zstd', ['-d', '-c', logPath], { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' })
const events = raw.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))

let state = emptyState()
const mutations = []
for (const event of events) {
	if (event.type !== 'tool/result') continue
	const meta = event.data?.meta
	if (meta?.kind !== 'clearai') continue
	for (const mutation of Array.isArray(meta.mutations) ? meta.mutations : []) {
		mutations.push(mutation)
		state = applyEvent(state, { type: 'tool/result', data: { meta: { kind: 'clearai', mutation } } })
	}
}

const histogram = {}
for (const mutation of mutations) histogram[mutation.t] = (histogram[mutation.t] ?? 0) + 1

console.log(`\n===== ${label} =====`)
console.log(`变更直方图(${mutations.length} 条):`, JSON.stringify(histogram))
const derived = derive(state)
console.log(`\n阶段:${derived.phase} · 假设 ${derived.hypotheses.length} 条 · 事实 ${derived.factRows.length} 条 · 冲突 ${derived.conflicts.length} 对`)
const goalSet = mutations.filter((m) => m.t === 'goal/set').slice(-1)[0]
if (goalSet !== undefined) {
	console.log(`\n目标:${goalSet.claim}`)
	for (const hypothesis of goalSet.hypotheses ?? []) {
		console.log(`  假设 ${hypothesis.id}: ${String(hypothesis.claim).slice(0, 60)}`)
		console.log(`    断言:${hypothesis.assertions === null || hypothesis.assertions === undefined ? '(无)' : JSON.stringify(hypothesis.assertions)}`)
	}
}
const planCreated = mutations.filter((m) => m.t === 'plan/created').slice(-1)[0]
if (planCreated !== undefined) {
	console.log(`\n计划:${planCreated.brief ?? ''}(${(planCreated.steps ?? []).length} 步)`)
	for (const step of planCreated.steps ?? []) console.log(`  ${step.id}. ${String(step.do).slice(0, 50)} · 物证:${(step.artifacts ?? []).join(',') || '无'} · tests:${JSON.stringify(step.tests ?? null)}`)
}
const lexicon = state.lexicon ?? { terms: [], predicates: [] }
console.log(`\n本体:${lexicon.terms.length} 概念 · ${lexicon.predicates.length} 谓词`)
for (const term of lexicon.terms) console.log(`  概念 ${term.id} · ${term.label} · ${term.status}${term.parent ? ` ↖${term.parent}` : ''}`)
for (const predicate of lexicon.predicates) {
	const range = predicate.range ?? {}
	const rangeText = range.term ?? `${range.form ?? '?'}${range.unit ?? ''}`
	console.log(`  谓词 ${predicate.id} · ${predicate.label} · ${predicate.domain ?? '—'} → ${rangeText}${predicate.functional ? ' · 单值' : ''}`)
}
const projected = view(state, 'offline')
const graph = projected.lexicon?.graph ?? { nodes: [], edges: [] }
const byKind = {}
for (const node of graph.nodes) byKind[node.kind] = (byKind[node.kind] ?? 0) + 1
console.log(`\n图投影:${graph.nodes.length} 节点(${JSON.stringify(byKind)}) · ${graph.edges.length} 边`)
for (const edge of graph.edges) console.log(`  ${edge.kind}: ${String(edge.from).slice(0, 30)} --${String(edge.label ?? '')}--> ${String(edge.to).slice(0, 30)}${edge.level ? ` [${edge.level}]` : ''}${edge.status && edge.kind === 'assertion' ? ` [${edge.status}]` : ''}`)
console.log(`\n冲突:${derived.conflicts.length === 0 ? '无' : JSON.stringify(derived.conflicts)}`)
console.log('\n(收尾:直方图即上方读数;卡片行由 renderCard 另行渲染,此处不重复。)')
