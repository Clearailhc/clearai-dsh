import test from 'node:test'
import assert from 'node:assert/strict'
import { sessions, assertGates, stopReasons, MODEL } from '../tools/native-headless/matrix.mjs'
import { pairedAnalysis, sequenceCosts } from '../tools/native-headless/analyze.mjs'
test('matrix has all 162 fixed sessions and simple tasks select default mode', () => {
	const rows = sessions(), counts = Object.fromEntries(['smoke', 'development', 'formal', 'supplemental', 'ablation'].map((stage) => [stage, rows.filter((row) => row.stage === stage).length]))
	assert.deepEqual(counts, { smoke: 6, development: 24, formal: 48, supplemental: 36, ablation: 48 }); assert.equal(rows.length, 162)
	assert.ok(rows.filter((row) => row.task === 'direct').every((row) => row.mode === 'default'))
	assert.equal(new Set(rows.filter((row) => row.stage === 'formal').map((row) => row.world)).size, 6)
})
test('missing engineering gates and usage cannot pass', () => {
	assert.throws(() => assertGates({ suites: { passed: true, evidence: 'log' } }), /windows-node24-audit/)
	assert.deepEqual(stopReasons({ installation: { model: MODEL }, usage: { status: 'unknown' } }), ['unverifiable_usage'])
})
test('task failures consume the fixed experiment penalties', () => {
	assert.deepEqual(sequenceCosts([{ task: 't2', completed: false, firstQualifyingExperiment: 1 }, { task: 't4', completed: false, totalExperiments: 0 }]), { t2: 31, t4: 13 })
})
test('quality and savings verdicts cannot compensate each other', () => {
	const good = Array.from({ length: 6 }, () => ({ aQuality: 2, cQuality: 3, aExperiments: 10, cExperiments: 7 }))
	assert.deepEqual(pairedAnalysis(good, { samples: 1000 }).verdicts, { sequenceQuality: '达到', experimentSavings: '达到' })
	assert.equal(pairedAnalysis(good.map((row) => ({ ...row, cExperiments: 12 })), { samples: 1000 }).verdicts.experimentSavings, '未达到')
	assert.equal(pairedAnalysis(good.slice(0, 1), { samples: 1000 }).verdicts.sequenceQuality, '证据不足')
})
