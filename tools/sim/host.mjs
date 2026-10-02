/**
 * 模拟宿主:不起 DSH,把**真内核**装进一个最小的宿主壳里,让一个外部模型(Claude 子代理)
 * 通过命令行调用我们的工具。
 *
 * 为什么要它:我们开发的是代码,验收要回答的是「真模型拿到这套提示词与工具面,会不会走完循环」。
 * 这件事不需要真宿主——需要的是**同一份内核、同一份折法、同一份判据**。宿主接线(装包、注册、
 * 路由)另由 CI 的干净安装与生命周期验收管。
 *
 * 与生产同形的部分:
 *   · 工具走 `tools/pre-execute` 再 `execute`,结果按 `output.render` 给模型、按 `presentationMeta`
 *     取变更折进投影(与宿主一样只认 `meta.kind === 'clearai'`);
 *   · 每次调用之后跑一次 `agent/pre-step`,注入的消息(运行态卡等)原样交给模型;
 *   · 会话日志按真实事件形状记下(`tool/call` / `tool/result` / `user/message`),判分时用真折法重放。
 *
 * 宿主里由人或别的模型做的事,这里交给外部:
 *   · 独立评估者:`subagents.start()` 挂起,等外部用 `settle` 交回裁决(由另一个只读子代理来判);
 *   · 当场问人(L4 放行、计划卡住、事实被推翻):`userQuestions.ask` 按剧本的预设答案作答;
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { applyEvent, applyMutations, derive, emptyState, renderCard, view, MUTATION_KIND } from '../../ui/lib/fold.js'
import { describeDomainShelf, formatAssertion, validateAssertions, validatePredicate, validateTerm } from '../../ui/lib/domain-language.js'

/** 把内容块里的全部文本取出来(工具结果的块是套娃的)。 */
export function textOf(blocks) {
	return (Array.isArray(blocks) ? blocks : [])
		.flatMap((block) => {
			if (typeof block === 'string') return [block]
			if (block?.type === 'text') return [String(block.text ?? '')]
			if (Array.isArray(block?.content)) return [textOf(block.content)]
			return []
		})
		.join('\n')
}

/**
 * @param {object} options
 * @param {string} options.workspace  模型干活的目录(内核的 cwd)
 * @param {string} options.runDir     会话日志与挂起请求落在这里
 * @param {string} [options.sessionId]
 * @param {Record<string, string>} [options.answers]  当场问人的预设答案。键是问题 id,或它的前缀
 *   (`release` = L4 放行、`blocked` = 计划卡住、`fact` = 事实被推翻);值是 `first`(缺省:第一个选项)、
 *   某个选项的原文、`none`(没人能答 ⇒ 抛 NO_PROVIDER),或任意一句话(当作人补的话)。
 */
export function makeSimHost({ workspace, runDir, sessionId = 'sim', answers = {} }) {
	mkdirSync(runDir, { recursive: true })
	const logFile = join(runDir, 'events.jsonl')
	const tools = new Map()
	const listeners = new Map()
	const sections = []
	const warnings = []
	const events = []
	const pending = new Map()
	const humanAnswers = []
	let state = emptyState()
	let seq = 0
	let turn = 0
	let hostGoal = null

	const record = (event) => {
		const stamped = { time: Date.now(), ...event }
		events.push(stamped)
		state = applyEvent(state, stamped)
		appendFileSync(logFile, `${JSON.stringify(stamped)}\n`)
		return stamped
	}

	const service = {
		state: () => state,
		derive: () => derive(state),
		view: () => view(state),
		renderCard: () => renderCard(state),
		preview: (_id, mutations) => {
			const next = applyMutations({ ...state, inFlight: null }, mutations)
			return { state: next, card: renderCard(next), view: view(next) }
		},
		domain: {
			validateTerm: (_id, draft) => validateTerm(state.lexicon, draft),
			validatePredicate: (_id, draft) => validatePredicate(state.lexicon, draft),
			validateAssertions: (_id, assertions, options = {}) => validateAssertions(state, assertions, options),
			renderShelf: (_id, mutations = []) => {
				const next = applyMutations(state, Array.isArray(mutations) ? mutations : [])
				const derived = derive(next)
				return describeDomainShelf(next, derived.factRows, derived.hypotheses)
			},
			format: (_id, assertion) => formatAssertion(state.lexicon, assertion),
		},
	}

	/** 原生 goal 服务:只记状态,不驱动续跑(续跑由外部模型自己的回合代替)。 */
	const goals = {
		get: () => hostGoal,
		create(_agent, request) {
			hostGoal = { id: 'hg-1', revision: 1, objective: request.objective, phase: 'active', maxGoalRounds: request.maxGoalRounds ?? 128, roundsStarted: 0, activation: 'armed' }
			return hostGoal
		},
		edit(_agent, _ref, request) {
			hostGoal = { ...hostGoal, ...request, revision: hostGoal.revision + 1 }
			return hostGoal
		},
		resume() {
			hostGoal = { ...hostGoal, phase: 'active', activation: 'armed', revision: hostGoal.revision + 1 }
			return hostGoal
		},
		pause() {
			hostGoal = { ...hostGoal, phase: 'paused', activation: 'disarmed', revision: hostGoal.revision + 1 }
			return hostGoal
		},
		complete() {
			hostGoal = { ...hostGoal, phase: 'complete', activation: 'disarmed', revision: hostGoal.revision + 1 }
			return hostGoal
		},
		block(_agent, _ref, reason) {
			if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(String(reason?.code ?? ''))) throw new Error('goal block reason requires a lower-kebab-case code and a non-empty message')
			hostGoal = { ...hostGoal, phase: 'blocked', blockedReason: reason, activation: 'disarmed', revision: hostGoal.revision + 1 }
			return hostGoal
		},
		clear() {
			const gone = hostGoal
			hostGoal = null
			return { id: gone?.id ?? 'hg-1', revision: (gone?.revision ?? 0) + 1 }
		},
	}

	/** 当场问人:按剧本预设作答,每一次都记下来(判分与复盘要看得见人答了什么)。 */
	const userQuestions = {
		async ask(request) {
			const answersOut = []
			for (const question of request?.questions ?? []) {
				const id = String(question.id ?? '')
				const preset = String(answers[id] ?? answers[id.split('-')[0]] ?? 'first')
				const labels = (question.options ?? []).map((option) => option.label)
				humanAnswers.push({ id, header: question.header ?? null, question: question.question ?? null, answer: preset })
				if (preset === 'none') throw Object.assign(new Error('no provider'), { code: 'NO_PROVIDER' })
				if (preset === 'first') answersOut.push({ id, selected: labels.slice(0, 1) })
				else if (labels.includes(preset)) answersOut.push({ id, selected: [preset] })
				else answersOut.push({ id, selected: labels.slice(0, 1), custom: preset })
			}
			return { answers: answersOut }
		},
	}

	const subagents = {
		async listChildren() {
			return [...pending.values()].filter((entry) => entry.settled === false).map((entry) => ({ kind: 'child', id: entry.id, activity: 'running', mode: 'spawn' }))
		},
		async startContinuable() {
			throw new Error('模拟宿主只提供一次性 start()')
		},
		async start(provider, request) {
			seq += 1
			const id = `sub-${seq}`
			let resolve
			const result = new Promise((done) => {
				resolve = done
			})
			const entry = {
				id,
				provider,
				label: String(request.label ?? ''),
				persona: request.persona === undefined || request.persona === null ? null : typeof request.persona === 'string' ? request.persona : textOf(Array.isArray(request.persona) ? request.persona : [request.persona]),
				prompt: typeof request.prompt === 'string' ? request.prompt : textOf(Array.isArray(request.prompt) ? request.prompt : [request.prompt]),
				outputSchema: request.outputSchema ?? null,
				toolFilter: request.toolFilter ?? null,
				settled: false,
				resolve,
			}
			pending.set(id, entry)
			return { id, localAgent: undefined, result, dispose: async () => {} }
		},
	}

	const sessionShell = (id) => ({ id, header: { cwd: workspace }, ownEvents: () => (String(id) === sessionId ? events : []), append: () => {} })

	const ctx = {
		logger: {
			info() {},
			warn: (message) => warnings.push(String(message)),
			error: (message) => warnings.push(String(message)),
		},
		get(name) {
			if (name === 'clearai') return service
			if (name === 'goals') return goals
			if (name === 'userQuestions') return userQuestions
			if (name === 'subagents') return subagents
			if (name === 'sessions') return { get: (id) => sessionShell(id), list: () => [sessionShell(sessionId)] }
			if (name === 'tools') return { get: (toolName) => ({ name: toolName }) }
			return undefined
		},
		on(event, handler) {
			listeners.set(event, handler)
			return () => {}
		},
		effect(callback) {
			callback()
			return () => {}
		},
		tools: {
			register(definition) {
				tools.set(definition.name, definition)
				return () => {}
			},
		},
		systemPrompt: {
			section(section) {
				sections.push(section)
				return () => {}
			},
		},
	}

	const agent = { id: sessionId }

	/** 跑一次 pre-step,把注入的消息记进日志,返回模型这一拍会读到的文本。 */
	async function preStep(entering = []) {
		turn += 1
		const handler = listeners.get('agent/pre-step')
		if (handler === undefined) return ''
		const decision = await handler({ agent, turn, step: 1, messages: entering }, async () => ({ kind: 'enter', messages: [] }))
		const texts = []
		for (const message of decision?.messages ?? []) {
			record({ type: 'user/message', data: message })
			const text = textOf(message?.content)
			if (text.trim() !== '') texts.push(text)
		}
		return texts.join('\n\n')
	}

	/** 一次工具调用:守卫 → 执行 → 记日志 → 下一拍的注入。返回模型读到的全部文本。 */
	async function call(name, args) {
		seq += 1
		const callId = `call-${seq}`
		const tool = tools.get(name)
		if (tool === undefined) return { text: `没有这件工具:${name}。可用的是:${[...tools.keys()].join('、')}`, ok: false }
		record({ type: 'tool/call', data: { name, callId, arguments: args } })
		const guard = listeners.get('tools/pre-execute')
		const decision = guard === undefined ? { kind: 'allow' } : await guard({ name, arguments: args, agent, callId }, async () => ({ kind: 'allow' }))
		if (decision?.kind === 'deny' || decision?.kind === 'ask') {
			const reason = decision.kind === 'ask' ? `${decision.reason}\n(这个形态没有人放行通道,按拒绝处理。)` : decision.reason
			const text = `调用被拦下:${reason}`
			record({ type: 'tool/result', data: { callId, message: { content: [{ type: 'text', text }] } } })
			return { text: `${text}\n\n${await preStep()}`.trim(), ok: false }
		}
		let value
		try {
			value = await tool.execute(args, { callId, agent, signal: undefined })
		} catch (error) {
			const text = `工具抛错:${String(error?.stack ?? error).slice(0, 600)}`
			record({ type: 'tool/result', data: { callId, message: { content: [{ type: 'text', text }] } } })
			return { text, ok: false }
		}
		const rendered = typeof tool.output?.render === 'function' ? tool.output.render(args, value) : JSON.stringify(value)
		const resultText = typeof rendered === 'string' ? rendered : textOf(rendered?.content ?? rendered)
		const meta = typeof tool.output?.presentationMeta === 'function' ? tool.output.presentationMeta(args, value) : undefined
		record({ type: 'tool/result', data: { callId, meta: meta?.kind === MUTATION_KIND ? meta : undefined, message: { content: [{ type: 'text', text: resultText }] } } })
		const injected = await preStep()
		return { text: injected === '' ? resultText : `${resultText}\n\n── 系统在你下一步之前注入 ──\n${injected}`, ok: value?.ok === true }
	}

	/** 交回一位子代理的结果(评估者的结构化裁决,或一段正文)。 */
	function settle(id, payload) {
		const entry = pending.get(id)
		if (entry === undefined || entry.settled) return false
		entry.settled = true
		const structured = payload?.structured ?? undefined
		const text = payload?.text ?? (structured === undefined ? '' : JSON.stringify(structured))
		entry.resolve({ output: text === '' ? [] : [{ type: 'text', text }], structured, stopReason: payload?.stopReason ?? 'completed' })
		return true
	}

	const mutations = () =>
		events.flatMap((event) => (event.type === 'tool/result' && event.data?.meta?.kind === MUTATION_KIND ? event.data.meta.mutations ?? [] : []))

	return {
		ctx,
		tools,
		sections,
		warnings,
		events,
		pending,
		humanAnswers,
		state: () => state,
		goal: () => hostGoal,
		call,
		preStep,
		settle,
		mutations,
	}
}
