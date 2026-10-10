export function usageSummary(calls) {
	const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, missing: 0, pending: 0 }
	for (const call of calls) {
		if (!call.usage || !['inputTokens', 'outputTokens'].every((key) => Number.isFinite(call.usage[key]) && call.usage[key] >= 0) || ['cacheReadTokens', 'cacheWriteTokens'].some((key) => call.usage[key] !== undefined && (!Number.isFinite(call.usage[key]) || call.usage[key] < 0))) { if (call.ended) out.missing++; else out.pending++; continue }
		const u = call.usage
		for (const [key, field] of Object.entries({ input: 'inputTokens', output: 'outputTokens', cacheRead: 'cacheReadTokens', cacheWrite: 'cacheWriteTokens' })) out[key] += Number(u[field] ?? 0)
		out.calls++
	}
	out.lowerBound = out.input + out.output + out.cacheRead + out.cacheWrite
	out.status = out.missing || out.pending ? 'unknown' : 'verified'
	out.processed = out.status === 'verified' ? out.lowerBound : null
	return out
}
export function redact(value) {
	return JSON.parse(JSON.stringify(value, (key, val) => /^(?:apiKey|authorization|password|secret|token)$/i.test(key) ? '[redacted]' : typeof val === 'string' ? val.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]') : val))
}

export function onceAsync(operation) {
	let result
	return (...args) => result ??= Promise.resolve().then(() => operation(...args))
}

export function infrastructureErrorCode(error) {
	const code=error?.code??error?.cause?.code
	if(['ECONNRESET','ETIMEDOUT','EAI_AGAIN'].includes(code))return code
	const status=error?.status??error?.statusCode
	return [502,503,504].includes(status)?'HTTP_'+status:undefined
}
