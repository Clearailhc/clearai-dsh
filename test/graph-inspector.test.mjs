import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, inspectGraphSelection } from '../ui/lib/fold.js'
import { graphProjection } from '../ui/lib/domain-language.js'

test('registered entities and asserted values/edges show sources without inventing verified facts', () => {
	const state = emptyState()
	state.entities = [{ id: 'paper', type: 'publication', label: 'Paper', basis: 'catalog.json' }]
	state.entityAssertions = [{ id: 'source:doi', subject: { type: 'publication', id: 'paper' }, predicate: 'doi', object: { kind: 'reference', value: '2111.06377' }, evidence: { kind: 'document', ref: 'paper.pdf:1' } }]
	const graph = graphProjection(state)
	const value = graph.nodes.find(node => node.kind === 'literal')
	const edge = graph.edges.find(item => item.source === 'asserted')
	for (const selection of [{ kind: 'instance', id: 'publication|paper' }, { kind: 'literal', id: value.id }, { kind: 'edge', id: edge.id }]) {
		const detail = inspectGraphSelection(state, selection)
		assert.ok(detail)
		assert.equal(detail.definition.status, 'asserted')
		assert.match(detail.definition.basis, /paper\.pdf:1/)
		assert.deepEqual(detail.facts, [])
	}
	assert.equal(inspectGraphSelection(state, { kind: 'literal', id: value.id }).definition.value, '2111.06377')
	assert.equal(inspectGraphSelection(state, { kind: 'edge', id: edge.id + '-missing' }), null)
	assert.equal(inspectGraphSelection(state, { kind: 'instance', id: 'publication|missing' }), null)
})

test('a source declaration does not erase independently promoted evidence for the same value', () => {
	const state = emptyState()
	const assertion = { subject: { type: 'sensor', id: 's1' }, predicate: 'reading', object: { kind: 'quantity', value: 2 } }
	state.entityAssertions = [{ ...assertion, id: 'a1', evidence: { ref: 'raw.csv' } }]
	state.facts = [{ id: 'f1', text: 'reading is two', level: 'L3', assertions: [assertion], evidence: [] }]
	const value = graphProjection(state).nodes.find(node => node.kind === 'literal')
	const detail = inspectGraphSelection(state, { kind: 'literal', id: value.id })
	assert.equal(detail.definition.status, 'projected')
	assert.equal(detail.facts.length, 1)
	assert.equal(detail.facts[0].id, 'f1')
	assert.equal(detail.definition.basis, 'raw.csv')
})
