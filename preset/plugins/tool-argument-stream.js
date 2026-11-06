/** Preserve malformed ClearAI calls for explicit rejection by the tool gate. */
export async function* recoverToolArguments(stream, names, signal) {
	const pending = new Map()
	try {
		for await (const chunk of stream) {
			if (chunk.type === 'tool-call-delta') {
				const call = pending.get(chunk.index) ?? { id: '', name: '', arguments: '' }
				if (chunk.id) call.id = chunk.id
				if (chunk.name) call.name = chunk.name
				call.arguments += chunk.argumentsDelta ?? ''
				pending.set(chunk.index, call)
			}
			if (chunk.type === 'block-end') pending.delete(chunk.index)
			yield chunk
		}
	} catch (error) {
		if (signal?.aborted || error?.code !== 'MALFORMED_RESPONSE' || pending.size === 0) throw error
		for (const call of pending.values()) {
			if (!call.id || !names.has(call.name)) throw error
			let malformed = false
			try { JSON.parse(call.arguments) } catch { malformed = true }
			if (!malformed) throw error
		}
		for (const [index, call] of pending) yield { type: 'block-end', index, block: { type: 'tool-call', ...call } }
		yield { type: 'finish', reason: { kind: 'tool-calls' } }
	}
}
