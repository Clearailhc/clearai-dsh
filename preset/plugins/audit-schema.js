/** DSH rc.2 enforces a JSON-schema subset. Bounds remain annotations and runtime limits. */
export function nativeAuditSchema(value) {
 if (Array.isArray(value)) return value.map(nativeAuditSchema)
 if (!value || typeof value !== 'object') return value
 const result = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'maxLength').map(([key, child]) => [key, nativeAuditSchema(child)]))
 if (value.maxLength !== undefined) result.description = `${value.description ?? ''} (maximum ${value.maxLength} characters; excess is truncated by the consumer)`
 return result
}

/** Only a successful authoritative structured_output result survives child recovery. */
export function recoveredStructuredOutput(events) {
 const calls = new Map()
 let value
 for (const event of events) {
  if (event.type === 'tool/call' && event.data?.name === 'structured_output') {
   try { calls.set(event.data.callId, typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments) } catch {}
  }
  if (event.type === 'tool/result') {
   const message = event.data?.message
   const id = message?.toolCallId ?? message?.source?.callId
   if (calls.has(id) && message?.isError !== true && !event.data.error) value = calls.get(id)
  }
 }
 return value
}
