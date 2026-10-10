/** Installed DSH host, native preset composition and native model selection. */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { usageSummary, redact, onceAsync } from './accounting.mjs'
import { installReadIsolation, probeReadIsolation } from './isolation.mjs'

const resources = process.env.CLEARAI_DSH_RESOURCES || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
const native = (pkg) => import(pathToFileURL(join(resources, 'node_modules/@deepseek-ai', pkg, 'lib/index.js')).href)
const { installModelSelection } = await native('dsh-agent')
const { createUserMessage } = await native('dsh-llm')
const { entryListSchema } = await native('cordis-plugin-include')
const { load, dump } = await import(pathToFileURL(join(resources, 'node_modules/js-yaml/index.js')).href)
export const name = 'clearai-native-test-carrier'
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'sessionQuery', 'agentPresets', 'llm', 'tools', 'sandbox', 'shell']
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const model = { provider: 'abhome', model: 'deepseek-flash', reasoningEffort: 'medium' }

export function apply(ctx, config) {
	if (!ctx.get('appExit')) throw new Error('Native appExit service required')
	const spec = JSON.parse(readFileSync(process.env.CLEARAI_NATIVE_SPEC || config.spec, 'utf8'))
	const out = spec.output; mkdirSync(out, { recursive: true })
	const started = Date.now(), calls = [], requests = [], approvals = [], saved = new Map()
	let main, stopping = false, reason = 'running', failure, unknownQuestion = false, cancelFault = false
	let crashFault=false
	const clearMode = spec.mode !== 'default' && spec.group.startsWith('C')
	let promptMounted = false, toolsMounted = false, projection = null, answer = ''
	const atomic = (file, value) => writeFileSync(join(out, file), `${JSON.stringify(redact(value), null, 2)}\n`)
	const capture = (session) => {
		if (!session) return
		const id = String(session.id), old = saved.get(id) ?? { cursor: 0, path: createHash('sha256').update(id).digest('hex') + '.jsonl' }
		const events = session.snapshotEvents()
		if (old.cursor === 0) appendFileSync(join(out, old.path), JSON.stringify(redact({ header: session.header })) + '\n')
		for (const event of events.slice(old.cursor)) appendFileSync(join(out, old.path), JSON.stringify(redact(event)) + '\n')
		old.cursor = events.length; saved.set(id, old)
		if (id === main?.id) {
			const texts = events.filter((e) => e.type === 'assistant/message').map((e) => ((e.data.message ?? e.data).content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')).filter(Boolean)
			answer = texts.at(-1) ?? answer
		}
	}
	const checkpoint = () => {
		try { for (const session of ctx.get('sessions')?.list() ?? []) capture(session) } catch {}
		try { projection = main ? ctx.get('clearai')?.state(main.id) ?? projection : projection } catch {}
		const result = { session: main?.id, group: spec.group, mode: clearMode ? 'clearai' : 'default', reason, failure, elapsedMs: Date.now() - started, model, usage: usageSummary(calls), mount: { prompt: promptMounted, tools: toolsMounted }, requests, approvals, answer, clearai: projection, logs: [...saved].map(([session, value]) => ({ session, ...value })) }
		atomic('checkpoint.json', result)
		return result
	}
	atomic('carrier-started.json', { pid: process.pid, group: spec.group, model })
	ctx.on('llm/stream', (options, next) => {
		if (options.provider !== model.provider || options.model !== model.model) throw new Error('Unexpected native LLM model route')
		const call = { session: options.sessionId, purpose: options.purpose, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, started: Date.now(), ended: false }
		calls.push(call); checkpoint()
		return (async function* () {
			try {
				if(main&&options.sessionId!==main.id&&spec.fault==='audit-timeout') {
					atomic('fault-injected.json',{fault:spec.fault,session:options.sessionId,at:Date.now()})
					await new Promise((accept,reject)=>{options.signal?.addEventListener('abort',()=>reject(new Error('Registered audit timeout: transport cancelled')),{once:true});setTimeout(accept,300000)})
				}
				if(main&&options.sessionId!==main.id&&spec.fault==='disconnect') {atomic('fault-injected.json',{fault:spec.fault,session:options.sessionId,at:Date.now()});throw new Error('Registered native transport disconnect')}
				for await (const chunk of next()) { if (chunk.type === 'usage') { call.usage = chunk.usage; checkpoint() } yield chunk }
			}
			finally { call.ended = true; call.finished = Date.now(); appendFileSync(join(out, 'llm-calls.jsonl'), JSON.stringify(redact(call)) + '\n'); checkpoint() }
		})()
	})
	ctx.on('agent/request', async (payload, next) => {
		const request = await next()
		const selected = { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort }
		requests.push({ session: payload.agent?.id, ...selected, at: Date.now() })
		if (Object.keys(model).some((key) => model[key] !== selected[key])) throw new Error('Model configuration mismatch')
		if (spec.fault === 'cancel-after-child-request' && payload.agent?.id !== main?.id) cancelFault = true
		checkpoint(); return request
	})
	ctx.on('session/event', (session, event) => {
		capture(session)
		if(spec.fault==='crash-after-child-verdict'&&main&&session.id!==main.id&&event.type==='turn/end'&&event.data?.reason?.kind==='completed'&&!crashFault) {
			crashFault=true
			void (async()=>{
				// Completed children detach and close their persistence handle. Wait for
				// disposal, then read the durable log; flushing a closing handle races it.
				const deadline=Date.now()+15000
				while(ctx.get('sessions').get(session.id)&&Date.now()<deadline)await delay(25)
				if(ctx.get('sessions').get(session.id))throw new Error('Completed child did not detach before crash checkpoint')
				const lease=await ctx.get('sessionQuery').observeSession(session.id,{projectionMode:'none'})
				try {
					if(!lease.events.some(event=>event.type==='turn/end'&&event.data?.reason?.kind==='completed'))throw new Error('Child verdict was not durably completed')
				}finally{lease[Symbol.dispose]?.()}
				if(await ctx.get('sessions').flush(main.session)!==true)throw new Error('Parent crash checkpoint not durable')
				checkpoint();atomic('fault-injected.json',{fault:spec.fault,child:session.id,parent:main.id,at:Date.now()});process.kill(process.pid,'SIGKILL')
			})().catch(error=>finish('infrastructure_error',String(error.message)))
		}
		if (session.id !== main?.id) return
		if (event.type === 'system/message') promptMounted ||= /ClearAI.*boundary of fact|ClearAI.*事实边界/.test(JSON.stringify(event.data))
		if (event.type === 'request/header') {
			toolsMounted = event.data.header.tools?.some((tool) => tool.name === 'Frame') === true
			if (clearMode && (!toolsMounted || !promptMounted)) throw new Error('Native ClearAI prompt/tool contributions missing')
			if (!clearMode && toolsMounted) throw new Error('Default mode unexpectedly mounted ClearAI')
		}
	})
	ctx.on('approval/request', (req) => {
		const script = (spec.approvals ?? []).find((row) => row.toolName === req.toolName && row.reason === req.reason)
		const answer = script?.answer ?? 'unavailable'; approvals.push({ toolName: req.toolName, reason: req.reason, answer }); return answer
	})
	ctx.on('user-questions/request', (req) => {
		return { answers: (req.questions ?? []).map((question) => {
			const script = (spec.decisions ?? []).find((row) => row.id === question.id && row.question === question.question)
			if (!script) { unknownQuestion = true; throw Object.assign(new Error('Unscripted business decision'), { code: 'NO_PROVIDER' }) }
			return { id: question.id, selected: script.selected ?? [], ...(script.custom !== undefined ? { custom: script.custom } : {}) }
		}) }
	})
	const finish = onceAsync(async (terminal, error) => {
		stopping = true; reason = terminal; failure = error ?? failure; checkpoint()
		let agents = []
		try { agents = ctx.get('agents').list() } catch {}
		if (terminal !== 'completed') {
			for (const agent of agents) {
				try { const goals = ctx.get('goals'), goal = goals?.get(agent); if (goal?.phase === 'active') goals.block(agent, { id: goal.id, revision: goal.revision }, { code: 'test-stopped', message: terminal }) } catch (error) { failure = `${failure ?? ''}; stop continuation: ${error.message}` }
				try { if (agent.status === 'running') agent.cancel({ kind: 'user' }) } catch {}
			}
		}
		const drained = await Promise.race([Promise.all(agents.map((a) => a.whenIdle())).then(() => true), delay(15000).then(() => false)])
		if (!drained) failure = `${failure ?? ''}; associated agents did not settle within cancellation drain limit`
		checkpoint()
		try { const sessions = ctx.get('sessions'); for (const session of sessions.list()) { capture(session); await sessions.flush(session) } } catch (error) { failure = `${failure ?? ''}; native flush: ${error.message}` }
		atomic('result.json', checkpoint())
		process.stdout.write(JSON.stringify({ type: 'done', reason, output: out }) + '\n')
		ctx.get('appExit')(terminal === 'completed' ? 0 : 1)
	})
	const cancel = () => { void finish('user_cancelled', 'User or registered fault cancellation') }
	process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
	ctx.effect(() => () => { process.off('SIGINT', cancel); process.off('SIGTERM', cancel) })
	async function run() {
		await ctx.get('loader').await()
		if(spec.isolation)atomic('isolation-policy.json',installReadIsolation(ctx,{...spec.isolation,workspace:process.cwd()}))
		const selection = ctx.get('agentDefaultModel').currentSelection()
		if (Object.keys(model).some((key) => selection[key] !== model[key])) throw new Error('Default model configuration mismatch')
		const presets = ctx.get('agentPresets')
		let presetId = 'clearai'
		if (clearMode && spec.group !== 'C') {
			const document = await presets.readDocument('clearai'), plugins = load(document.content, { schema: entryListSchema })
			let found = false
			for (const row of plugins) {
				if (row.id === 'clearai-kernel') { found = true; row.config = { ...row.config, ...(spec.group === 'C-no-applicability' ? { applicabilityFeedback: false } : { negativeWriteback: false }) } }
				if (row.id === 'skill-filesystem') row.config.customSkillDirs = [join(process.env.DSH_HOME, 'profiles', config.profile ?? 'native52-pr23', 'node_modules/clearai-dsh/presets/clearai/skills')]
			}
			if (!found) throw new Error('Cannot register native ablation: kernel row missing')
			presetId = spec.group
			await presets.register({ id: presetId, name: presetId, description: 'Preregistered native composition variant', plugins })
			atomic('ablation-composition.json', { presetId, sha256: createHash('sha256').update(dump(plugins, { schema: entryListSchema })).digest('hex'), switches: spec.group })
		}
		const preset = clearMode ? await presets.resolve(presetId) : null
		if (clearMode && !preset?.id) throw new Error('Native preset resolution failed')
		const create = spec.resumeSessionId ? ctx.get('agents').resume.bind(ctx.get('agents')) : ctx.get('agents').create.bind(ctx.get('agents'))
		const made = await create({ ...(spec.resumeSessionId ? { resumeSessionId: spec.resumeSessionId } : { sessionId: 'session-native-' + randomUUID(), meta: { cwd: process.cwd(), ...(preset ? { agentPreset: preset.id } : {}) } }), agentOptions: model, setup: async (agentCtx) => { installModelSelection(agentCtx, { current: selection, assembled: undefined }); if (preset) await presets.mount(agentCtx, preset.id) } })
		main = made.agent
		if(spec.isolation?.probe)atomic('isolation-probe.json',await probeReadIsolation(ctx,main,spec.isolation.probe))
		if (preset && (presets.composedPreset(main.ctx) !== preset.id || !ctx.get('clearai'))) throw new Error('Native preset/projection mount failed')
		await main.whenIdle()
		atomic('session-started.json', { session: main.id, resumed: !!spec.resumeSessionId })
		main.followup(createUserMessage({ content: [{ type: 'text', text: spec.task }], source: { kind: 'user' } }))
		while (!stopping) {
			const record = checkpoint(), agents = ctx.get('agents').list()
			if (cancelFault) return finish('user_cancelled', 'Registered cancellation after child request')
			if(spec.fault==='cancel-after-frame'&&projection?.goal)return finish('user_cancelled','Synthetic UI fixture: retain open goal and loaded knowledge for replay inspection')
			if (record.usage.lowerBound >= spec.tokenBudget) return finish('token_limit')
			if (Date.now() - started >= spec.timeoutMs) return finish('time_limit')
			if (unknownQuestion) return finish('blocked', 'Unregistered human decision')
			if(spec.fault==='audit-timeout'&&(projection?.audits??[]).some(audit=>audit.shortfalls?.includes('audit_timeout')))return finish('blocked','Registered 240-second audit timeout observed; no completion permitted')
			const goal = ctx.get('goals')?.get(main), state = clearMode ? projection : null
			const pending = (state?.audits ?? []).some((audit) => audit.verdict === null)
			if (!agents.some((agent) => agent.status === 'running') && !pending) {
				const end = main.session.snapshotEvents().filter((e) => e.type === 'turn/end').at(-1)
				if (end?.data?.reason?.kind === 'error') return finish('error', end.data.reason.error?.message)
				if (state?.goal?.status === 'achieved' || goal?.phase === 'complete') return finish('completed')
				if (state?.goal?.status === 'abandoned' || goal?.phase === 'blocked') return finish('blocked')
				if (!state?.goal && !goal && end?.data?.reason?.kind === 'completed') return finish('completed')
				if (state?.goal?.status === 'open' || goal?.phase === 'active') { await delay(250); continue }
				if (end) return finish('incomplete', 'Persistent goal did not complete')
			}
			await delay(250)
		}
	}
	run().catch((error) => finish('error', String(error?.message ?? error)))
}
