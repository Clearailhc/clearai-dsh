import test from 'node:test'
import assert from 'node:assert/strict'
import { onceAsync, usageSummary, redact } from '../tools/native-headless/accounting.mjs'

test('cancellation runs once even when signal and normal loop race', async () => {
	let runs = 0; const finish = onceAsync(async () => { runs++; await Promise.resolve(); return 'saved' })
	assert.deepEqual(await Promise.all([finish(), finish(), finish()]), ['saved', 'saved', 'saved']); assert.equal(runs, 1)
})
test('missing or pending usage remains unknown with nonzero known lower bound', () => {
	const known = { ended: true, usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 90 } }
	assert.equal(usageSummary([known]).processed, 100)
	for (const extra of [{ ended: true }, { ended: false }]) {
		const result = usageSummary([known, extra]); assert.equal(result.status, 'unknown'); assert.equal(result.processed, null); assert.equal(result.lowerBound, 100)
	}
})
test('only credential content is redacted', () => {
	assert.deepEqual(redact({ apiKey: 'hidden', token: 'experiment', text: 'Bearer abc.123', inputTokens: 20 }), { apiKey: '[redacted]', token: '[redacted]', text: 'Bearer [redacted]', inputTokens: 20 })
})
test('faults demonstrably injected before provider dispatch are separate from unknown paid requests',()=>{
 const injected={injectedBeforeProvider:'disconnect',providerInvoked:false,ended:true}
 assert.equal(usageSummary([injected]).status,'verified')
 assert.equal(usageSummary([injected]).injectedBeforeProvider,1)
 assert.equal(usageSummary([injected]).calls,0)
 assert.equal(usageSummary([{...injected,providerInvoked:true}]).status,'unknown')
 assert.equal(usageSummary([{providerInvoked:false,ended:true}]).status,'unknown')
})
