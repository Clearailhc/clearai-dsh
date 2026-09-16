/**
 * 宿主半的机制测试 —— 人门通道(D2=B:面板可写,但只写人门动作)。
 *
 * 为什么单开一份:人门通道住在**宿主平面**(`ui/lib/index.js` 的路由),不在预设内核里。
 * 内核测试证明「状态怎么算」,这份证明「人按下的那一下会变成什么」——两条都红才算真红。
 *
 * 跑法:node test/host.test.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { tempDir, trackTemp } from './tmp.mjs'
import { pathToFileURL } from 'node:url'

/**
 * 这份测试跑在**部署出去的那一份**上,不是仓库源上。
 *
 * 为什么:`lib/index.js` 要 `import { z } from 'zod'`,而 zod 只在 DSH 的模块回退层里解析得到
 * (宿主进程有回退,裸 node 没有)。所以先用**逐字节比对**守住「测的就是要跑的那一份」——
 * 部署落后于源就直接红,而不是让你以为测过了。
 */
const SOURCE_DIR = join(import.meta.dirname, '..', 'ui', 'lib')
const DEPLOYED_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'web', 'node_modules', 'clearai-dsh', 'lib')
// 源名 → 包里名:打包时 `ui/lib/index.js` 成了 `lib/host.js`(见 tools/build-package.mjs)
for (const [file, packed] of [['index.js', 'host.js'], ['fold.js', 'fold.js'], ['client.js', 'client.js']]) {
	const source = readFileSync(join(SOURCE_DIR, file), 'utf8')
	let deployed = null
	try {
		deployed = readFileSync(join(DEPLOYED_DIR, packed), 'utf8')
	} catch {
		deployed = null
	}
	if (deployed === null) {
		console.log(`· 跳过宿主半套件:这个 DSH_HOME 里没有装出来的 ${packed}(DSH_HOME=${process.env.DSH_HOME ?? '~/.dsh'})。`)
		console.log('  装上再测(测的就是要跑的那一份):bash install.sh,或 node tools/install-native.mjs --profile web')
		process.exit(0)
	}
	if (deployed !== source) {
		console.log(`✗ 部署的 ${packed} 与源不一致——先跑 bash install.sh 再测(这份测试测的是要跑的那一份)。`)
		process.exit(1)
	}
}

const bust = `?test=${Date.now()}`
const { apply } = await import(pathToFileURL(join(DEPLOYED_DIR, 'host.js')).href + bust)
const { HUMAN_GATE_ACTIONS, HUMAN_GATE_MARK, applyEvent, applyMutations, emptyState, parseHumanGate, view } = await import(
	pathToFileURL(join(DEPLOYED_DIR, 'fold.js')).href + bust
)

let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail = '') {
	if (condition) {
		passed += 1
		console.log(`  ✓ ${label}`)
	} else {
		failed += 1
		failures.push(label)
		console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`)
	}
}

// ── 假的宿主:够跑人门通道的最小面(路由 + agents + sessions + 投影) ──────────

function makeHost(options = {}) {
	const routes = []
	const disposers = []
	const sent = []
	const agent = {
		id: 'session-1',
		status: options.status ?? 'idle',
		followup(message) {
			sent.push({ via: 'followup', message })
		},
		steer(message) {
			sent.push({ via: 'steer', message })
		},
	}
	const hostRef = {}
	const provided = new Map()
	const ctx = {
		// 宿主半声明了 inject: ['sessionProjections', 'sessions'],所以这两个是**属性**,
		// 不是 ctx.get 的产物——按真实契约喂。
		sessionProjections: {
			register: () => () => {},
			// 测试可以设定它,好验「读面把投影算成了什么」。
			stateOf: () => hostRef.projectionState ?? emptyState(),
		},
		sessions: { get: (id) => (options.cwd === undefined || id !== 'session-1' ? undefined : { header: { cwd: options.cwd } }) },
		logger: { info() {}, warn() {}, error() {} },
		// connection 的 exact fetch route 表:浏览器那侧的 /api/* 只有挂在这里才到得了。
		connection: {
			fetch: {
				register(route) {
					routes.push(route)
					const dispose = () => {
						const index = routes.indexOf(route)
						if (index >= 0) routes.splice(index, 1)
					}
					disposers.push(dispose)
					return dispose
				},
			},
		},
		/** 真 Cordis 的延迟注入:服务就位才跑 callback(host 半用它挂路由)。 */
		inject(deps, callback) {
			if (deps.includes('connection') && options.noConnection === true) return () => {}
			callback(ctx)
			return () => {}
		},
		get(name) {
			if (name === 'agents') return { get: (id) => (id === 'session-1' && options.live !== false ? agent : undefined) }
			// 技能注册表:工作区外那条读面只认它报出来的目录(见 resolveSkillFile)。
			if (name === 'skills') {
				return {
					async snapshot() {
						return options.skillsSnapshot ?? { skills: [], complete: true }
					},
				}
			}
			return undefined
		},
		on() {
			return () => {}
		},
		effect(callback) {
			const disposer = callback()
			return typeof disposer === 'function' ? disposer : () => {}
		},
		provide(name, value) {
			// 宿主半把 `clearai` 服务挂在这里;测试要能拿到它(view/renderCard 的**真实现**)。
			provided.set(name, value)
			return () => {}
		},
	}
	Object.assign(hostRef, { ctx, routes, disposers, sent, agent, projectionState: null, provided })
	return hostRef
}

/**
 * 造一次请求并调用某条 exact fetch route。
 *
 * 路由契约从 Node 的 `(req,res)` 换成了 web 标准的 `(Request) => Response`
 * ——因为浏览器那侧走的是 connection 的 fetch 表(2026-09-11 实测)。
 */
async function callRoute(host, path, { method = 'GET', body, query } = {}) {
	const route = host.routes.find((item) => item.path === path)
	if (route === undefined) return { status: 0, payload: null, text: 'route_not_registered', route: undefined }
	// connection 的共享 handler 先按 methods 过滤:不匹配就根本不会调到我们的处理器
	// (它落到 RPC 端点那条路上,最后是 404 "not found")。这里照同一个行为模拟。
	if (!route.methods.includes(method)) return { status: 404, payload: null, text: 'not found', route }
	const url = `http://localhost${path}${query === undefined ? '' : `?${new URLSearchParams(query).toString()}`}`
	// GET/HEAD 不许带 body(Fetch 规范),所以只有非 GET 才挂请求体。
	const withBody = body !== undefined && method !== 'GET' && method !== 'HEAD'
	const request = new Request(url, {
		method,
		...(withBody ? { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
	})
	const response = await route.fetch(request)
	const text = await response.text()
	let payload = null
	try {
		payload = text === '' ? null : JSON.parse(text)
	} catch {
		payload = null
	}
	return { status: response.status, payload, text, route }
}

console.log('\n【人门通道:五个动词、只给人、留署名】')
{
	const host = makeHost()
	apply(host.ctx)
	const route = host.routes.find((item) => item.path === '/api/clearai/gate')
	// 路由挂在哪一层,是 2026-09-11 实测换来的教训:必须挂 connection 的 exact fetch 表,
	// 只挂 webServer 的话浏览器永远轮不到(会拿到 connection 的 404 "not found")。
	check('路由挂在 connection 的 exact fetch 表上(/api/clearai/gate)', route !== undefined && route.path === '/api/clearai/gate' && route.methods.includes('POST') && route.requestBody === 'buffered', JSON.stringify({ path: route?.path, methods: route?.methods }))
	check('三条面板路由都挂上了(人门 / 交付物 / 工作区现状)', ['/api/clearai/gate', '/api/clearai/deliverables', '/api/clearai/brain'].every((p) => host.routes.some((item) => item.path === p)), host.routes.map((item) => item.path).join(','))
	// 文件正文那条路由**删了**:预览走 DSH 原生(6 个实现:md/图片/pdf/html/code/text),
	// 我们不再自己读盘、不再自己渲染——少一条读面 = 少一处要维护的路径守卫。
	check('不再注册文件正文读面(预览走原生,不重复造)', host.routes.every((item) => item.path !== '/api/clearai/file'), host.routes.map((item) => item.path).join(','))
	// 路径必须合平台的端点语法(`connection` 在 `assertFetchRoute` 里会当场抛,抛了就整个包挂不上):
	// /api/<段>[/<段>],每段只允许 [A-Za-z0-9_$.-]。写错一个字符 → 装配期炸,而不是浏览器里静默 404。
	{
		const SEGMENT = /^[A-Za-z0-9_$.-]+$/
		const bad = host.routes.map((item) => item.path).filter((path) => !path.startsWith('/api/') || path.slice('/api/'.length).split('/').some((segment) => segment === '' || !SEGMENT.test(segment)))
		check('路由路径合平台的端点语法(不合会在装配期抛,整个包挂不上)', bad.length === 0, bad.join(','))
	}
	{
		const noConnection = makeHost({ noConnection: true })
		apply(noConnection.ctx)
		check('没有 connection 的档(headless):一条路由都不挂,但装配照常(投影与服务仍在)', noConnection.routes.length === 0)
	}
	check('路由是可回收的(ctx.effect 返回 disposer)', host.disposers.length > 0)

	const post = async (payload, method = 'POST') => {
		const result = await callRoute(host, '/api/clearai/gate', { method, ...(payload === null ? {} : { body: payload }) })
		await new Promise((resolve) => setTimeout(resolve, 0))
		return result
	}

	/**
	 * ①′ 事实复核:**先核标的**。
	 *
	 * 这条门和世界线那道一样,标的可能已经不在了(投影前进、事实被别的路径改了)。
	 * 不核就回一句成功,等于又一个「点了报成功、账上一字未改」的控件——
	 * 那正是这套界面最不能有的东西(收件箱那个 `fork_adopt` 按钮刚刚栽在这上面)。
	 */
	{
		/**
		 * 这一组要一份**有工作目录**的宿主:`stateOf` 先问 `sessions.get`,拿不到会话就退回空状态
		 * ——没有 cwd 的桩读不到任何投影,撤回自然找不到标的。
		 */
		const factHost = makeHost({ cwd: '/tmp/clearai-facts-test' })
		apply(factHost.ctx)
		const postFact = async (payload) => {
			const result = await callRoute(factHost, '/api/clearai/gate', { method: 'POST', body: payload })
			await new Promise((resolve) => setTimeout(resolve, 0))
			return result
		}
		factHost.projectionState = { ...emptyState(), facts: [{ id: 'fct-2', text: 'X 比 Y 快', scope: null, level: 'L3', evidence: [], path: null, at: 1, review: null }] }
		const unknownFact = await postFact({ sessionId: 'session-1', action: 'retract_fact', value: 'fct-nope' })
		check('撤回一条不存在的事实 → 409 fact_not_found(不许回一句成功)', unknownFact.status === 409 && unknownFact.payload?.error === 'fact_not_found', `${unknownFact.status}/${unknownFact.payload?.error}`)
		const before = factHost.sent.length
		const retracted = await postFact({ sessionId: 'session-1', action: 'retract_fact', value: 'fct-2', note: '外部数据更正' })
		check('撤回一条在的事实 → 200,并落一条**署名是人**的人门消息', retracted.status === 200 && retracted.payload?.action === 'retract_fact' && factHost.sent.length === before + 1 && factHost.sent.at(-1).message?.source?.kind === 'user', `${retracted.status}/${factHost.sent.length}`)
		check('消息里带事实 id 与缘由(落账要靠它)', /fct-2/.test(factHost.sent.at(-1).message.content[0].text) && /外部数据更正/.test(factHost.sent.at(-1).message.content[0].text), factHost.sent.at(-1).message.content[0].text.slice(0, 140))
		const kept = await postFact({ sessionId: 'session-1', action: 'keep_fact', value: 'fct-2' })
		check('维持原事实也是一条人门动作(它必须能一键落地,否则那道门没有出口)', kept.status === 200 && kept.payload?.action === 'keep_fact', `${kept.status}/${kept.payload?.action}`)
		factHost.projectionState = { ...factHost.projectionState, facts: [{ ...factHost.projectionState.facts[0], review: { decision: 'kept', reason: null, at: 2, by: 'user' } }] }
		const again = await postFact({ sessionId: 'session-1', action: 'keep_fact', value: 'fct-2' })
		check('已经审过的事实再审 → 409 fact_already_reviewed(第一次决定为准)', again.status === 409 && again.payload?.error === 'fact_already_reviewed', `${again.status}/${again.payload?.error}`)

		/**
		 * 认可一次临时采纳:同一套纪律——先核那道门还开着没有。
		 * 标的错、不是临时采纳、已经认可过,一律 409,而不是收下一条什么都不改的动作。
		 */
		const provisionalFork = { id: 'f-1', stepId: 's1', question: '走哪条', phase: 'settled', branches: [], merge: { branch: 'b-1', provisional: true, confirmed: null } }
		factHost.projectionState = { ...emptyState(), forks: [provisionalFork] }
		const noFork = await postFact({ sessionId: 'session-1', action: 'confirm_provisional', fork: 'f-nope' })
		check('认可一盘不存在的分叉 → 409 fork_not_found', noFork.status === 409 && noFork.payload?.error === 'fork_not_found', `${noFork.status}/${noFork.payload?.error}`)
		factHost.projectionState = { ...emptyState(), forks: [{ ...provisionalFork, merge: { ...provisionalFork.merge, provisional: false } }] }
		const notProvisional = await postFact({ sessionId: 'session-1', action: 'confirm_provisional', fork: 'f-1' })
		check('不是临时采纳 → 409 not_provisional(不许把正式采纳再「认可」一遍)', notProvisional.status === 409 && notProvisional.payload?.error === 'not_provisional', `${notProvisional.status}/${notProvisional.payload?.error}`)
		factHost.projectionState = { ...emptyState(), forks: [provisionalFork] }
		const confirmed = await postFact({ sessionId: 'session-1', action: 'confirm_provisional', fork: 'f-1' })
		check('临时采纳且门开着 → 200,并落一条署名是人的人门消息', confirmed.status === 200 && confirmed.payload?.action === 'confirm_provisional' && factHost.sent.at(-1).message?.source?.kind === 'user' && /f-1/.test(factHost.sent.at(-1).message.content[0].text), `${confirmed.status}/${String(factHost.sent.at(-1)?.message?.content?.[0]?.text).slice(0, 120)}`)
		factHost.projectionState = { ...emptyState(), forks: [{ ...provisionalFork, merge: { ...provisionalFork.merge, confirmed: { at: 3, by: 'user' } } }] }
		const twice = await postFact({ sessionId: 'session-1', action: 'confirm_provisional', fork: 'f-1' })
		check('已经认可过 → 409 already_confirmed(第一次认可为准)', twice.status === 409 && twice.payload?.error === 'already_confirmed', `${twice.status}/${twice.payload?.error}`)
	}

	// ① 动词白名单:表外的动作一律拒(与贡献表同一套纪律:表外的名字不许出现)
	const unknown = await post({ sessionId: 'session-1', action: 'delete_everything' })
	check('表外的动词 → 400 unknown_gate_action', unknown.status === 400 && unknown.payload?.error === 'unknown_gate_action', `${unknown.status}/${unknown.payload?.error}`)
	check('被拒的动作不会往会话里投消息', host.sent.length === 0)
	/**
	 * 白名单恰好四个动词 —— 2026-09-11 砍掉两个,砍的理由就是「它们是重复」:
	 * `confirm_plan`(原生 plan-mode 就是用户复核的出口;我们自己的授权记号本来就「交付即落账」)、
	 * `invoke_skill`(原生 `/` 技能触发器做同一件事)。这条断言把「不许再长回来」钉死:
	 * 想加动词,先回答「原生为什么不够」。
	 */
	/**
	 * 白名单**逐字列举**,不数个数:加一个动词必须同时改这里——那一步就是「先说清原生为什么不够」。
	 * 砍掉的三个(confirm_plan / invoke_skill / set_autonomy)不许长回来。
	 */
	check(
		'白名单恰好是那六个动词(砍掉的重复项不许回来:confirm_plan / invoke_skill / set_autonomy)',
		[...HUMAN_GATE_ACTIONS].sort().join(',') === ['adopt_branch', 'abandon_fork', 'promote_skill', 'retract_fact', 'keep_fact', 'confirm_provisional'].sort().join(','),
		HUMAN_GATE_ACTIONS.join(','),
	)

	// 方法过滤发生在 connection 层(按路由声明的 methods),我们的处理器根本不会被调用——
	// 这正是「挂错层」那个 bug 的反面:挂对了,平台替我们把方法也管了。
	const notPost = await post({ sessionId: 'session-1', action: 'promote_skill', skill: 'my-sop' }, 'GET')
	check('非 POST:connection 层按 methods 挡掉(404 not found,处理器不被调用)', notPost.status === 404 && notPost.text === 'not found', `${notPost.status}/${notPost.text}`)

	const noSession = await post({ sessionId: 'ghost', action: 'promote_skill', skill: 'my-sop' })
	check('会话不活(没有活着的 agent)→ 404,不假装成功', noSession.status === 404 && noSession.payload?.error === 'no_live_session')

	/**
	 * ② §34 **`set_autonomy` 已摘掉**(「要不要人参与」由门表达,不由面板开关表达)。
	 * 所以这里断言的是**相反**的事:那个动作再也进不来 —— 表外的名字一律拒(与贡献表同一套纪律)。
	 */
	const goneTier = await post({ sessionId: 'session-1', action: 'set_autonomy', value: 'unattended' })
	check('已摘掉的动词 ⇒ 400(表外名字不许出现)', goneTier.status === 400 && goneTier.payload?.error === 'unknown_gate_action', `${goneTier.status}/${goneTier.payload?.error}`)
	check('而且一个字都没投出去(拒绝就是拒绝,不静默半生效)', host.sent.length === 0, String(host.sent.length))

	/**
	 * §34:原来这里有一组「人刚切档那一拍,宿主按**传进来的当档**渲染卡片」——
	 * 它服务的是已摘掉的 `set_autonomy` ✗。档位现在是部署预设的初值,卡片照投影渲染即可,
	 * 没有"传进来的当档"这回事。
	 */

	/**
	 * §20 混合路径:点我们那条 → 用**原生提问卡**问 → 答案变回同一条人门消息。
	 * 借界面,不借账:无论从哪儿答,落进日志的都是同一个动词、同一套校验。
	 */
	{
		// 带 `cwd`:宿主服务的 `state()` 要先解析得出会话(否则它如实退回空状态,门看起来就是关的)。
		const askHost = makeHost({ cwd: tempDir('clearai-host-ask-') })
		apply(askHost.ctx)
		// 投影里摆一道**开着**的世界线裁决(真实形状:分叉在 deciding,带判据与推荐)
		// 形状照**内核真正落的变更**写(折法只认这些字段):两条分支都交付过 ⇒ 分叉进 deciding。
		askHost.projectionState = applyMutations(emptyState(), [
			{ t: 'goal/set', id: 'g-1', claim: '两条路线取一条', done_criteria: '有一条能跑通', hypotheses: [] },
			{ t: 'plan/created', id: 'p-1', goal: 'g-1', brief: '路线对比', steps: [{ id: 's1', do: '两条路线各试一遍', artifacts: [], done_criteria: '有读数' }] },
			{ t: 'fork/created', id: 'f-1', plan: 'p-1', step: 's1', question: '走哪条', decide_by: { metric: 'ms', direction: 'min' }, options: [
				{ id: 'b-1', label: '甲', approach: '直接算', done_criteria: '有 ms 读数' },
				{ id: 'b-2', label: '乙', approach: '绕一圈', done_criteria: '有 ms 读数' },
			] },
			{ t: 'branch/delivered', fork: 'f-1', branch: 'b-1', reading: '12', validity: 'usable', verdict: 'support', basis: '读数', evaluator: 'independent' },
			{ t: 'branch/delivered', fork: 'f-1', branch: 'b-2', reading: '31', validity: 'usable', verdict: 'support', basis: '读数', evaluator: 'independent' },
			{ t: 'fork/arbitrated', fork: 'f-1', winner: 'b-1', ranking: ['b-1', 'b-2'], reason: '读数更低', confidence: 'high' },
		])
		const asked = []
		askHost.ctx.get = ((original) => (name) => (name === 'userQuestions' ? { ask: async (request) => { asked.push(request); return { answers: [{ id: 'fork-adopt', selected: ['乙'] }] } } } : original(name)))(askHost.ctx.get.bind(askHost.ctx))
		const route = askHost.routes.find((item) => item.path === '/api/clearai/gate')
		const post = async (body) => {
			const response = await route.fetch(new Request('http://x/api/clearai/gate', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
			return { status: response.status, payload: await response.json() }
		}
		const before = askHost.sent.length
		const asked200 = await post({ sessionId: 'session-1', action: 'ask', gate: 'fork_adopt', fork: 'f-1' })
		// HTTP 只是「卡摆上去了」这件事的回执(桩立刻作答,所以这里不假设「还没落账」的窗口)。
		check('点我们那条 ⇒ 摆一张原生提问卡(200 + asked 回执)', asked200.status === 200 && asked200.payload?.asked === true, `${asked200.status}/${JSON.stringify(asked200.payload)}`)
		// 让 promise 链跑完(答案是异步落的账)
		await new Promise((resolve) => setTimeout(resolve, 50))
		check('卡片的问题是从**投影**现算的(判据 + 各分支读数 + 推荐)', asked.length === 1 && /ms/.test(String(asked[0]?.questions?.[0]?.detail ?? '')) && /甲/.test(String(asked[0]?.questions?.[0]?.detail ?? '')) && asked[0]?.questions?.[0]?.options?.length === 2, JSON.stringify(asked[0]?.questions?.[0]?.detail ?? '').slice(0, 120))
		check('人答了 ⇒ 落的仍是**同一条人门消息**(署名是人、结构化标记、动词是 adopt_branch)', askHost.sent.length === before + 1 && /adopt_branch/.test(JSON.stringify(askHost.sent.at(-1)?.message?.content ?? '')) && askHost.sent.at(-1)?.message?.source?.kind === 'user', JSON.stringify(askHost.sent.at(-1)?.message?.content ?? '').slice(0, 120))

		// 人把卡撤下(没选也没写)⇒ 什么都不落
		const quiet = makeHost({ cwd: tempDir('clearai-host-ask-quiet-') })
		apply(quiet.ctx)
		quiet.projectionState = askHost.projectionState
		quiet.ctx.get = ((original) => (name) => (name === 'userQuestions' ? { ask: async () => ({ answers: [{ id: 'fork-adopt', selected: [] }] }) } : original(name)))(quiet.ctx.get.bind(quiet.ctx))
		const quietRoute = quiet.routes.find((item) => item.path === '/api/clearai/gate')
		await quietRoute.fetch(new Request('http://x/api/clearai/gate', { method: 'POST', body: JSON.stringify({ sessionId: 'session-1', action: 'ask', gate: 'fork_adopt', fork: 'f-1' }), headers: { 'content-type': 'application/json' } }))
		await new Promise((resolve) => setTimeout(resolve, 50))
		check('人撤下卡(没选也没写)⇒ 一个字都不落(不算答过)', quiet.sent.length === 0, String(quiet.sent.length))

		// 没有提问通道的形态:如实拒,不假装摆了卡
		const bare = makeHost({ cwd: tempDir('clearai-host-ask-bare-') })
		apply(bare.ctx)
		bare.projectionState = askHost.projectionState
		const bareRoute = bare.routes.find((item) => item.path === '/api/clearai/gate')
		const noChannel = await bareRoute.fetch(new Request('http://x/api/clearai/gate', { method: 'POST', body: JSON.stringify({ sessionId: 'session-1', action: 'ask', gate: 'fork_adopt', fork: 'f-1' }), headers: { 'content-type': 'application/json' } }))
		check('这个形态没有提问通道 ⇒ 409 no_question_channel(不假装摆了卡)', noChannel.status === 409 && (await noChannel.json())?.error === 'no_question_channel')
		// 门已经不在了(分叉不是 deciding)⇒ 拒,不摆过期的卡
		const stale = await post({ sessionId: 'session-1', action: 'ask', gate: 'fork_adopt', fork: 'f-nope' })
		check('那道门不在了 ⇒ 409 gate_not_open(不摆一张过期的卡)', stale.status === 409 && stale.payload?.error === 'gate_not_open', `${stale.status}/${JSON.stringify(stale.payload)}`)
	}

	/**
	 * §24:证据要交出 `branch` 与 `anchor` —— 面板据此给每条证据指**出处**
	 * (独立证据指评估卡、自判指产物)。少了它们,「评估卡」那一项永远出不来。
	 */
	{
		const host = makeHost({ cwd: tempDir('clearai-evidence-fields-') })
		apply(host.ctx)
		host.projectionState = applyMutations(emptyState(), [
			{ t: 'goal/set', id: 'g-1', claim: '核一个读数', done_criteria: '有裁决', hypotheses: [{ id: 'h-1', claim: '读数可信', refute_when: '不一致' }] },
			{ t: 'plan/created', id: 'p-1', goal: 'g-1', brief: '一步', steps: [{ id: 's1', do: '算一个读数', artifacts: [], done_criteria: '有读数', tests: { hypothesis: 'h-1', level: 'L3' } }] },
			{ t: 'evidence/recorded', id: 'e-1', plan: 'p-1', step: 's1', branch: 'b-7', verdict: 'support', level: 'L3', evaluator: 'independent', basis: '评估卡核对', refs: ['lab/x.csv'], anchor: 'auditor' },
		])
		const row = view(host.projectionState).evidence[0]
		check('证据交出 branch 与 anchor(面板据此指评估卡 / 产物)', row?.branch === 'b-7' && row?.anchor === 'auditor', JSON.stringify(row ?? null))
	}

	// ③ 跑着的会话:插到最近的步边界,不打断它
	const running = makeHost({ status: 'running' })
	apply(running.ctx)
	await callRoute(running, '/api/clearai/gate', { method: 'POST', body: { sessionId: 'session-1', action: 'adopt_branch', fork: 'f-1', branch: 'b-1' } })
	await new Promise((resolve) => setTimeout(resolve, 0))
	check('running 的会话走 steer(不打断当前回合)', running.sent.length === 1 && running.sent[0].via === 'steer')
	const adoptText = String(running.sent[0]?.message?.content?.[0]?.text ?? '')
	check('采纳裁决的正文点名 ConvergeFork(合并是内核的活)', /ConvergeFork/.test(adoptText))
	const abandon = parseHumanGate({ source: { kind: 'user' }, content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"abandon_fork","fork":"f-1"}` }] })
	check('放弃分叉也是白名单里的动词', abandon?.action === 'abandon_fork')
	// 采纳候选技能:白名单里的第四个动词,带上技能名(idle 的会话,所以走 followup)
	const promote = await post({ sessionId: 'session-1', action: 'promote_skill', skill: 'my-sop' })
	const promoteMessage = host.sent[host.sent.length - 1]?.message ?? {}
	check('采纳候选技能 → 200 且标记里带技能名', promote.status === 200 && parseHumanGate(promoteMessage)?.skill === 'my-sop', JSON.stringify(parseHumanGate(promoteMessage)))
	check('正文说清「下一个回合它就在你的技能目录里」', /技能目录/.test(String(promoteMessage.content?.[0]?.text ?? '')))

	/**
	 * 2026-09-11:「引用技能」这条人门动作**删了**,理由留在测试里(免得有人又想加回来):
	 * 原生 `dsh-client-ui-skill` 注册的是 `/` 输入触发器 —— 人打一个 `/` 就出候选菜单,
	 * 选一条即把技能正文作为指令注入这一回合,走的是与我们的按钮**完全同一条**原生手势
	 * (`dsh-tool-skill` 的 `SKILL_GESTURE`,只认 `source.kind === 'user'`)。
	 * 我们在面板上再放一个按钮,等于把同一件事做第二遍,还多一处会与原生菜单走偏的语义。
	 * 技能名语法那条校验(宁可拒绝,也不静默不注入)因此也不再需要 —— 人不再经过我们输入名字。
	 */
	check('引用技能这条动作已经删掉(它是原生 `/` 触发器的重复)', !HUMAN_GATE_ACTIONS.includes('invoke_skill'))

	// ④ 坏输入不炸路由
	const badJson = await post(null)
	check('空体 → 400 bad_json', badJson.status === 400 && badJson.payload?.error === 'bad_json', `${badJson.status}/${badJson.payload?.error}`)
	// 到这个宿主上成功投出去的消息只有两条:切档 + 采纳技能(裁决那条投给了 running 那个宿主)。
	// 其余全是坏输入,一条都不许进会话 —— 白名单与取值校验的价值就在这里。
	check('坏输入不投消息(§34 摘掉一个动词 ⇒ 有效输入少一条)', host.sent.length === 1, String(host.sent.length))
}

console.log('\n【两条只读读面:路径守卫 / 声明对实际 / 分页与拒绝】')
{
	const workspace = tempDir('clearai-host-ws-')
	mkdirSync(join(workspace, 'lab'), { recursive: true })
	writeFileSync(join(workspace, 'lab', 'probe.csv'), 'run,value\n1,61\n')
	writeFileSync(join(workspace, 'note.md'), '# 笔记\n正文\n')
	writeFileSync(join(workspace, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 4]))
	// 工作区**外面**的一个兄弟目录:验证路径守卫用的。固定名字,所以显式登记回收。
	const sibling = trackTemp(join(workspace, '..', `clearai-host-sibling-${process.pid}`))
	mkdirSync(sibling, { recursive: true })
	writeFileSync(join(sibling, 'secret.txt'), '不该被读到')

	const host = makeHost({ cwd: workspace })
	apply(host.ctx)
	const route = (path) => host.routes.find((item) => item.path === path)
	check('交付物读面已注册', route('/api/clearai/deliverables') !== undefined)
	check('工作区现状读面已注册', route('/api/clearai/brain') !== undefined)

	const get = async (path, query) => {
		const result = await callRoute(host, path, { method: 'GET', query })
		await new Promise((resolve) => setTimeout(resolve, 0))
		return result
	}

	// ① 交付物读面(文件正文读面已删:预览交给 DSH 原生的文档预览)
	// ③ 交付物:声明 vs 实际(盘上在不在)
	host.projectionState = applyMutations(emptyState(), [
			{
				t: 'plan/created',
				id: 'p-1',
				brief: '两步小计划',
				steps: [
					{ id: 's1', do: '造产物', artifacts: ['lab/probe.csv'], done_criteria: '存在', tests: null },
					{ id: 's2', do: '造一个不存在的产物', artifacts: ['lab/never.txt'], done_criteria: '存在', tests: null },
				],
			},
		])
	const deliverables = await get('/api/clearai/deliverables', { sessionId: 'session-1' })
	const steps = deliverables.payload?.stages?.[0]?.steps ?? []
	check('交付物按阶段分组返回', deliverables.status === 200 && deliverables.payload?.stages?.length === 1 && steps.length === 2, JSON.stringify(deliverables.payload).slice(0, 120))
	check('盘上有的:exists=true 且给字节数', steps[0]?.artifacts?.[0]?.exists === true && steps[0]?.artifacts?.[0]?.bytes === 15, JSON.stringify(steps[0]?.artifacts))
	check('盘上没有的:exists=false(「声明 vs 实际」的对照就是这个)', steps[1]?.artifacts?.[0]?.exists === false && steps[1]?.artifacts?.[0]?.bytes === null)
	/**
	 * `exists:false` 有两种成因,读面分开给(2026-09-11 长测抓到的):模型把 `lab/` 这种
	 * **目录**声明成物证时,准入按「空目录」拒了它——面板要是只说「盘上没有这个文件」,
	 * 那句话就是假的(它在,只是不是文件)。
	 */
	{
		host.projectionState = applyMutations(emptyState(), [
			{ t: 'plan/created', id: 'p-dir', steps: [{ id: 'd1', do: '把目录当物证', artifacts: ['lab'], done_criteria: '—', tests: null }] },
		])
		const dirRead = await get('/api/clearai/deliverables', { sessionId: 'session-1' })
		const dirArtifact = dirRead.payload?.stages?.[0]?.steps?.[0]?.artifacts?.[0]
		check('声明的是目录 → exists=false 且 directory=true(事实有两种,读面就给两种)', dirArtifact?.exists === false && dirArtifact?.directory === true, JSON.stringify(dirArtifact))
	}
	// 分类照抄 taxonomy.json:输出成果要能和中间过程分开,否则 100 个中间文件淹掉 3 份交付物。
	{
		writeFileSync(join(workspace, 'products-report.md'), 'x')
		mkdirSync(join(workspace, 'products', 'reports'), { recursive: true })
		writeFileSync(join(workspace, 'products', 'reports', 'final.md'), '# 终稿\n')
		writeFileSync(join(workspace, 'PROJECT.md'), '# 章程\n')
		host.projectionState = applyMutations(emptyState(), [
			{
				t: 'plan/created',
				id: 'p-2',
				steps: [
					{
						id: 's9',
						do: '交付与过程混在一起',
						artifacts: ['products/reports/final.md', 'lab/probe.csv', 'PROJECT.md', 'input/raw.csv', 'products-report.md'],
						done_criteria: '—',
						tests: null,
					},
				],
			},
		])
		const areas = await get('/api/clearai/deliverables', { sessionId: 'session-1' })
		const labels = (areas.payload?.stages?.[0]?.steps?.[0]?.artifacts ?? []).map((artifact) => `${artifact.path}=${artifact.area?.label}`)
		check(
			'产物按 taxonomy 分类(输出成果 / 分析过程 / 章程 / 项目资料 / 未分类)',
			labels.join(' | ') === 'products/reports/final.md=输出成果 | lab/probe.csv=分析过程 | PROJECT.md=章程 | input/raw.csv=项目资料 | products-report.md=未分类',
			labels.join(' | '),
		)
	}
	/**
	 * 「实际」那一半:盘上真有、但没有任何计划声明过的 products/ 文件。
	 *
	 * 这条读面是 2026-09-11 用户实测换来的:老项目里开新会话,面板只有「阶段 0 · 交付 0/0」,
	 * 而盘上那份 HTML 明明就在。声明与实际是两件事,读面两半都要给。
	 */
	{
		mkdirSync(join(workspace, 'products', 'sub', 'deep'), { recursive: true })
		writeFileSync(join(workspace, 'products', 'guide.html'), '<html>成品</html>')
		writeFileSync(join(workspace, 'products', '.hidden.md'), '隐藏项')
		writeFileSync(join(workspace, 'products', 'sub', 'deep', 'notes.txt'), '深一层')
		// 时间戳写死:排序断言不能靠「谁先写」这种毫秒级巧合。
		utimesSync(join(workspace, 'products', 'guide.html'), new Date(1000), new Date(1000))
		utimesSync(join(workspace, 'products', 'sub', 'deep', 'notes.txt'), new Date(2000), new Date(2000))
		const actual = await get('/api/clearai/deliverables', { sessionId: 'session-1' })
		const onDisk = actual.payload?.outputs ?? []
		const paths = onDisk.map((item) => item.path)
		check('盘上已有:products/ 下没被声明的列出来(含子目录)', paths.includes('products/guide.html') && paths.includes('products/sub/deep/notes.txt'), paths.join(','))
		check('路径相对**工作区**(与声明的产物同一形式,面板才能原样递给原生预览)', paths.every((path) => path.startsWith('products/')), paths.join(','))
		check('已声明的**不重复列**(同一条不许在栏里出现两遍)', !paths.some((path) => path.endsWith('reports/final.md')) && !paths.includes('products/reports/final.md'), paths.join(','))
		check('隐藏项不进(以 . 开头的不算「我拿到了什么」)', !paths.some((path) => path.includes('.hidden')), paths.join(','))
		check(
			'每条与声明的产物同形状(分类 / 字节 / 改动时间 / declared=false)',
			onDisk.length >= 2 && onDisk.every((item) => item.area?.key === 'output' && Number.isInteger(item.bytes) && typeof item.modifiedAt === 'number' && item.exists === true && item.declared === false),
			JSON.stringify(onDisk.slice(0, 2)),
		)
		check('按改动时间倒序(最近动过的排前面)', paths[0] === 'products/sub/deep/notes.txt' && paths[1] === 'products/guide.html', paths.join(','))
		// 巨大 products/:扫描与返回各有上限,而且返回的是**最近改动的**那批(上限在结果侧)。
		mkdirSync(join(workspace, 'products', 'bulk'), { recursive: true })
		for (let index = 0; index < 205; index += 1) writeFileSync(join(workspace, 'products', 'bulk', `out-${String(index).padStart(3, '0')}.txt`), 'x')
		const bulk = await get('/api/clearai/deliverables', { sessionId: 'session-1' })
		const bulkPaths = bulk.payload?.outputs ?? []
		check('products/ 很大时返回封顶 200 条(不把整个目录塞给面板)', bulkPaths.length === 200, `${bulkPaths.length}`)
		check('封顶后最新的那条仍在(上限在**结果**侧,不是扫描侧)', bulkPaths.some((item) => item.path === 'products/bulk/out-204.txt'), bulkPaths.slice(0, 3).map((item) => item.path).join(','))
		// products/ 不存在:空数组,不是错误。
		const other = makeHost({ cwd: tempDir('clearai-host-empty-') })
		apply(other.ctx)
		other.projectionState = emptyState()
		const none = await callRoute(other, '/api/clearai/deliverables', { method: 'GET', query: { sessionId: 'session-1' } })
		check('没有 products/ 目录时给空数组(不是失败)', none.status === 200 && Array.isArray(none.payload?.outputs) && none.payload.outputs.length === 0, JSON.stringify(none.payload).slice(0, 120))
	}
}

console.log('\n【标记解析:严格,不给模型留伪造的口子】')
{
	check('不是标记的消息 → null', parseHumanGate({ content: [{ type: 'text', text: '你好' }] }) === null)
	check('标记后面不是 JSON → null', parseHumanGate({ content: [{ type: 'text', text: `${HUMAN_GATE_MARK} 随便写点什么` }] }) === null)
	check('JSON 合法但动作不在白名单 → null', parseHumanGate({ content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"rm_rf"}` }] }) === null)
	check('缺 content → null', parseHumanGate({}) === null && parseHumanGate(null) === null)
	check(
		'**署名不是人**的同名标记不算人门动作(插件消息伪造不了人意)',
		parseHumanGate({ source: { kind: 'plugin' }, content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"set_autonomy","value":"unattended"}` }] }) === null,
	)
}

console.log('\n【折进投影:确认计划就地生效,世界线裁决记在分叉上】')
{
	const plan = (state) => state.plans[0]
	let state = emptyState()
	state = applyEvent(state, { type: 'user/message', time: Date.now(), data: { id: 'm0', role: 'user', content: [{ type: 'text', text: '开始吧' }], source: { kind: 'user' } } })
	check('普通用户消息不产生任何门状态', state.plans.length === 0)
	state = { ...state, plans: [{ id: 'p-1', goal: null, phase_id: null, brief: '', status: 'active', at: Date.now(), closedAt: null, summary: null, blocked: undefined, confirmed_at: null, confirmed_by: null, steps: [{ id: 's1', ordinal: 1, do: 'x', artifacts: [], done_criteria: 'y', tests: null, status: 'open', evidence: null, criteria_versions: [] }] }] }
	// 2026-09-11:`confirm_plan` 这个动词砍了(它写的记号本来就会在第一次交付时按事实补写),
	// 于是「人门 → 记号落账」这条路径只剩**行为即授权**一条。这里改测**砍掉之后的边界**:
	// 白名单里没有了,那么带这个动作的消息**什么也不改**——不能因为「格式对」就生效。
	const before = { ...plan(state) }
	state = applyEvent(state, { type: 'user/message', time: Date.now(), data: { id: 'm1', role: 'user', content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"confirm_plan","plan":"p-1"}` }], source: { kind: 'user' } } })
	check('已砍掉的动词即使格式合法也不生效(白名单就是边界)', plan(state).confirmed_by === before.confirmed_by && plan(state).confirmed_at === before.confirmed_at)
	// 真门仍然生效:放弃分叉(白名单里留着)必须落成分叉上的人裁决。
	state = { ...state, forks: [{ id: 'f-1', stepId: 's1', question: '走哪条', phase: 'deciding', humanDecision: null, branches: [], plan: 'p-1' }] }
	state = applyEvent(state, { type: 'user/message', time: Date.now(), data: { id: 'm2', role: 'user', content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"abandon_fork","fork":"f-1","note":"两条都不划算"}` }], source: { kind: 'user' } } })
	check('真门(放弃分叉)→ 分叉上留下人的裁决(不是模型断言)', state.forks[0].humanDecision?.action === 'abandon_fork' && state.forks[0].humanDecision?.note === '两条都不划算')
	// 切档:人的事实就地生效,而且是**人**署名的(插件消息里的同名标记不算)。
	/**
	 * §34:档位不再由门消息折进来(那个动词已摘掉)。旧日志里若真有 `set_autonomy` 的标记,
	 * 折叠层仍然认得出它(兼容),但**新会话不会再产生**这种账 —— 这里钉住后者。
	 */
	const beforeTier = view(state).autonomy
	state = applyEvent(state, { type: 'user/message', time: Date.now(), data: { id: 'm3', role: 'user', content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"set_autonomy","value":"unattended"}` }], source: { kind: 'user' } } })
	/**
	 * 有内容的两条:
	 *   · **兼容旧日志**:折叠层仍然认得旧标记(不把它折成脏值);
	 *   · **不认表外值**:`god-mode` 这种永远不会变成"当档"(投影与卡片都不认它)。
	 */
	check('兼容:旧日志里的档位标记折得出来(不折成脏值)', ['attended', 'unattended', null, undefined].includes(view(state).autonomy.override?.value ?? null), JSON.stringify(view(state).autonomy.override ?? null))
	check('表外的档位值永远不生效', view(state).autonomy.value !== 'god-mode' && view(state).autonomy.override?.value !== 'god-mode', JSON.stringify(view(state).autonomy))
}

console.log('\n【技能面:合并目录折进投影,用量从日志里折出来(零新账)】')
{
	// 目录:内核从宿主的 skills 服务取一次快照,随插件消息的 section 下发 → fold 折进状态。
	const dir = join(tempDir('clearai-brain-'), 'clear', 'skills', 'literature-review')
	const catalog = {
		complete: true,
		entries: [
			{ name: 'literature-review', description: '【文献综述】…', when_to_use: null, source: 'clearai-template', provider: 'clearai-brain', model: true, user: true, dir, inside: false },
			{ name: 'my-sop', description: '模型写的 SOP', when_to_use: null, source: 'clearai-workspace', provider: 'clearai-brain', model: false, user: true, dir: null, inside: null },
		],
	}
	let state = emptyState()
	state = applyEvent(state, {
		type: 'user/message',
		time: 1000,
		data: { id: 'm-cat', role: 'user', content: [{ type: 'text', text: '(技能目录已更新:2 条可用。)' }], source: { kind: 'plugin', plugin: 'clearai', form: 'snapshot', sections: [{ name: 'clearai/brain', text: JSON.stringify({ catalog }) }] } },
	})
	check('合并目录折进投影(可重放的事实)', state.skillCatalog?.entries?.length === 2 && state.skillCatalog.entries[1].model === false)
	check('视图把技能面交出去(面板读的就是这个)', view(state).skills?.catalog?.entries?.length === 2)

	// 用量①:模型加载 = `tool/call name='skill'`(原生工具,不是我们的)
	state = applyEvent(state, { type: 'tool/call', time: 1100, data: { name: 'skill', callId: 'c1', arguments: JSON.stringify({ name: 'literature-review' }) } })
	check('模型加载一次 → 记为 model 一次', view(state).skills.usage.find((item) => item.name === 'literature-review')?.model === 1)
	state = applyEvent(state, { type: 'tool/call', time: 1200, data: { name: 'skill', callId: 'c2', arguments: JSON.stringify({ name: 'literature-review' }) } })
	check('再加载一次 → 累加到 2(次数就是次数,不取平均)', view(state).skills.usage.find((item) => item.name === 'literature-review')?.model === 2)
	state = applyEvent(state, { type: 'tool/call', time: 1300, data: { name: 'read', callId: 'c3', arguments: JSON.stringify({ file_path: 'x' }) } })
	check('别的工具不算用量(只认原生 skill 这一件)', view(state).skills.usage.find((item) => item.name === 'literature-review')?.model === 2)

	/**
	 * `writeCalls`:内核在**回合边界**上要问「这个会话动过工作区没有」,以此决定要不要记一次
	 * 工作区快照。`written` 只认 write/edit,而探索最常走 bash(脚本自己产出文件)——
	 * 所以这条计数必须比 `written` 宽,且只读调用一笔都不记。
	 */
	{
		const before = state.writeCalls ?? 0
		const call = (time, name, args) => applyEvent(state, { type: 'tool/call', time, data: { name, callId: `wc-${time}`, arguments: JSON.stringify(args) } })
		state = call(2000, 'bash', { command: 'python probe.py' })
		state = call(2001, 'write', { file_path: 'lab/a.txt', content: 'x' })
		state = call(2002, 'edit', { file_path: 'lab/a.txt', old_string: 'x', new_string: 'y' })
		check('会改工作区的调用各记一笔(bash / write / edit)', state.writeCalls === before + 3, String(state.writeCalls))
		const snapshotCount = state.writeCalls
		state = call(2003, 'read', { file_path: 'lab/a.txt' })
		state = call(2004, 'grep', { pattern: 'x' })
		state = call(2005, 'glob', { pattern: '*.txt' })
		check('只读调用一笔都不记(否则空转的回合也会去提交)', state.writeCalls === snapshotCount, String(state.writeCalls))
	}

	// 用量②:人引用 = 一条含 `/名字` 的用户消息(与原生注入判据同一条正则)
	state = applyEvent(state, { type: 'user/message', time: 1400, data: { id: 'm-q', role: 'user', content: [{ type: 'text', text: '先按 /my-sop 来一遍' }], source: { kind: 'user' } } })
	check('人引用一次 → 记为 human 一次', view(state).skills.usage.find((item) => item.name === 'my-sop')?.human === 1)
	state = applyEvent(state, { type: 'user/message', time: 1500, data: { id: 'm-q2', role: 'user', content: [{ type: 'text', text: '看看 /usr/bin 与 5/8 这些不该被认成技能' }], source: { kind: 'user' } } })
	check('路径与分数不被误认(与原生同一条正则的原样好处)', view(state).skills.usage.length === 2, JSON.stringify(view(state).skills.usage.map((item) => item.name)))
	// 原生注入的那条消息**不是**人的引用:署名是 skill-invocation,不能重复计数。
	state = applyEvent(state, { type: 'user/message', time: 1600, data: { id: 'm-inj', role: 'user', content: [{ type: 'text', text: '<skill_content name="my-sop">\n/some/path\n</skill_content>' }], source: { kind: 'skill-invocation', name: 'my-sop', form: 'instructions' } } })
	check('原生注入的正文不算「人又引用了一次」', view(state).skills.usage.find((item) => item.name === 'my-sop')?.human === 1)
	// 内核的插件消息里出现 `/名字` 也不算(署名必须是人)。
	state = applyEvent(state, { type: 'user/message', time: 1700, data: { id: 'm-plugin', role: 'user', content: [{ type: 'text', text: '面板上可以 /my-sop' }], source: { kind: 'plugin', plugin: 'clearai' } } })
	check('插件消息里的 `/名字` 不算人引用(署名是判据)', view(state).skills.usage.find((item) => item.name === 'my-sop')?.human === 1)

	// 指针:落在哪一步、那一步现在什么结果(现算,所以后来交付了也跟着变)
	state = { ...state, plans: [{ id: 'p-1', status: 'active', steps: [{ id: 's1', ordinal: 3, do: '写综述', status: 'open', evidence: null, artifacts: [], done_criteria: '', tests: null, criteria_versions: [] }] }] }
	state = applyEvent(state, { type: 'tool/call', time: 1800, data: { name: 'skill', callId: 'c4', arguments: JSON.stringify({ name: 'literature-review' }) } })
	const pointed = view(state).skills.usage.find((item) => item.name === 'literature-review')
	check('用量带**指针**:第几步(步序号,不是内部 id)', pointed?.last?.ordinal === 3 && pointed?.last?.by === 'model', JSON.stringify(pointed?.last))
	check('指针落点的那一步现在还没交付', pointed?.last?.outcome === 'open')
	{
		const advanced = { ...state, plans: [{ ...state.plans[0], steps: [{ ...state.plans[0].steps[0], status: 'advanced', evidence: 'ev-9' }] }] }
		const after = view(advanced).skills.usage.find((item) => item.name === 'literature-review')
		check('那一步后来交付了 → 指针跟着变(读数不存,现算)', after?.last?.outcome === 'advanced' && after?.last?.evidence === 'ev-9', JSON.stringify(after?.last))
	}

	// 引用的门消息本身不改状态(落实在原生 pre-step),但会留下「人用过」这条事实
	{
		const before = state.skillUsage['my-sop'].human
		const next = applyEvent(state, { type: 'user/message', time: 1900, data: { id: 'm-gate', role: 'user', content: [{ type: 'text', text: `${HUMAN_GATE_MARK} {"action":"invoke_skill","skill":"my-sop"}\n/my-sop\n人在面板上引用了技能。` }], source: { kind: 'user' } } })
		check('invoke_skill 的门消息本身就是那条手势消息 → 计一次人引用', next.skillUsage['my-sop'].human === before + 1)
		check('invoke_skill 不碰分叉与世界线(它不是裁决)', next.forks.length === 0 && next.plans.length === state.plans.length)
	}

	// 「目录里已经没有」:用过的技能被删掉了,读数还在(不静默消失)
	{
		const shrunk = applyEvent(state, { type: 'user/message', time: 2000, data: { id: 'm-shrink', role: 'user', content: [{ type: 'text', text: '换个目录' }], source: { kind: 'plugin', plugin: 'clearai', form: 'snapshot', sections: [{ name: 'clearai/brain', text: JSON.stringify({ catalog: { complete: true, entries: [catalog.entries[0]] } }) }] } } })
		const names = view(shrunk).skills.catalog.entries.map((entry) => entry.name)
		check('目录收缩成一条,用量记录仍然留着(面板会显示「目录里已经没有」)', names.length === 1 && view(shrunk).skills.usage.some((item) => item.name === 'my-sop'))
	}
}

// ── 原生结算通知:模型读到的正文与账本记的结论同源 ─────────────────────────────
{
	const notice = applyEvent(emptyState(), {
		type: 'user/message',
		time: 1000,
		data: {
			id: 'notice-1',
			role: 'user',
			content: [
				{ type: 'text', text: 'Background subagent c-1 finished and will do no further work unless you send it more.' },
				{ type: 'text', text: 'Its closing message:' },
				{ type: 'text', text: '数完了:clear/skills 下 18 条技能。' },
			],
			source: { kind: 'subagent-settled', form: 'notice', summary: 'Background subagent c-1 finished.', senderSessionId: 'c-1' },
		},
	})
	/**
	 * 原生结算通知**不进投影**:模型自己就收到了那条消息,而账本侧的结算只认内核攥着的
	 * `run.result`。折它只会多出一个没有读者的字段——这条断言钉住「别再折回来」:
	 * 真要消费它,得先有一个消费者,并且记住结论在「closing message:」之后(运行时那行摘要不是子会话说的话)。
	 */
	check('原生结算通知不进投影(没有消费者的字段不该被折进来)', view(notice).notices === undefined && !/notices/.test(JSON.stringify(view(notice))), JSON.stringify(view(notice)).slice(0, 120))
	check('不是人的消息:通知不该被当成人的动作(人门/答复都只认 source.kind=user)', parseHumanGate({ source: { kind: 'subagent-settled' }, content: [{ type: 'text', text: '[clearai·人门] x' }] }) === null)
}

// ── 假设留痕:三零 = 「未触及」,结案之后仍看得见(不逼 verdict,但不许留白)──────
{
	const { renderCard } = await import('../ui/lib/fold.js')
	const state = applyMutations(emptyState(), [
		{ t: 'goal/set', id: 'g1', claim: '判定 A 与 B', done_criteria: '有结论', revision: 1, status: 'open', promote_at_level: 'L2', hypotheses: [{ id: 'h1', claim: 'A 成立', refute_when: '读数不支持' }, { id: 'h2', claim: 'B 成立', refute_when: '控制 B 后差异消失' }] },
		{ t: 'evidence/recorded', id: 'e1', step: 's1', verdict: 'support', level: 'L2', hypothesis: 'h1' },
		{ t: 'goal/closed', id: 'g1', status: 'achieved', verdict: 'support', note: null, unjudged: ['h2'] },
	])
	const card = renderCard(state)
	check('卡片把「从没被证据碰过」写成 (未触及)(与「无法判定 n」分得开)', /h2 \[proposed\].*\(未触及\)/.test(card), card.split('\n').filter((line) => line.includes('h2')).join(' ').slice(0, 140))
	check('结案留痕在卡片上还在(未判不是「没问题」,是「没看过」)', /结案留痕.*h2/.test(card), card.split('\n').filter((line) => line.includes('结案留痕')).join(' ').slice(0, 140))
	check('视图把 unjudged 交出去', (view(state).goal?.unjudged ?? []).includes('h2'), JSON.stringify(view(state).goal?.unjudged ?? null))
}

// ── 资料面:外脑送来的观测与在跑的侦察(模型与面板读的是同一份)────────────────
{
	// `renderCard` 是模型每一步唯一读到的窗口;`view` 是面板读的。两处必须都有指针。
	const { renderCard } = await import('../ui/lib/fold.js')
	const materialPath = 'clear/knowledge/materials/s-1.md'
	const withScout = applyMutations(emptyState(), [
		{ t: 'scout/dispatched', id: 's-1', step: 'goal:g1', trigger: 'model_request:盘点', child: 'c-1', capability: 'continuable', digest: 'd1' },
		{ t: 'observation/recorded', id: 'm-1', ref: 'scout:s-1', source: 'scout', digest: null, bytes: 4200, note: '侦察结论(只读):clear/skills 下 18 条技能,SKILL.md 覆盖 18/18。', path: materialPath, step: 'goal:g1' },
		{ t: 'scout/settled', id: 's-1', step: 'goal:g1', conclusion: '侦察结论(只读):clear/skills 下 18 条技能。', note: null, path: materialPath },
	])
	const card = renderCard(withScout)
	check(
		'卡片「资料面」给出指针与摘要(模型这才读得到外脑的结论)',
		/资料面/.test(card) && card.includes(materialPath) && /18 条技能/.test(card),
		card.split('\n').filter((line) => line.includes('资料面') || line.includes(materialPath)).join(' / ').slice(0, 160),
	)
	check('面板与模型读同一份:侦察与材料的 path 都交出去了', view(withScout).scouts[0]?.path === materialPath && view(withScout).materials[0]?.path === materialPath, JSON.stringify({ scout: view(withScout).scouts[0]?.path ?? null, material: view(withScout).materials[0]?.path ?? null }))
	const pending = applyMutations(emptyState(), [{ t: 'scout/dispatched', id: 's-2', step: 'goal:g1', trigger: 'model_request:盘点', child: 'c-2', capability: 'continuable', digest: 'd2' }])
	check('在跑的侦察也列出来(模型知道有东西在路上)', /\[在跑\] 侦察 s-2/.test(renderCard(pending)), renderCard(pending).split('\n').filter((line) => line.includes('在跑')).join(' ').slice(0, 120))
	const selfOnly = applyMutations(emptyState(), [{ t: 'observation/recorded', id: 'm-2', ref: 'lab/a.txt', source: 'self', digest: null, bytes: 10, note: '我自己写的观测', step: 's1' }])
	check('只有自己的观测 ⇒ 不出「资料面」段(不制造噪声)', !/资料面/.test(renderCard(selfOnly)))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
