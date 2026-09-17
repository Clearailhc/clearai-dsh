/**
 * clearai-dsh —— 宿主半。
 *
 * 这一半只做两件事,都是**进程级、只做一次**的:
 *   ① 注册一个会话投影单元 `clearai`:ClearAI 的状态不是被存下来的,而是**会话日志的投影**。
 *      fold 是纯同步函数(见 ./fold.js),认的是工具写进 `tool/result.meta` 的变更记录。
 *   ② 发布服务 `clearai`,给预设侧(意图工具、运行态卡)读状态用——
 *      与 DSH 自己的 `goals`(宿主服务 + 预设只放工具)同构。
 *
 * 为什么状态机必须在这一层:预设会被**重建**(组合文件的 mtime 一变,名册就重新挂载),
 * 而进程级的东西(投影注册、服务名)只能注册一次。把状态放在预设里,等于让一个会被重建的
 * 东西持有进程级资源——第二次挂载必然撞名(失效模式:webserver 报 duplicate exact route)。
 *
 * 面板也不再需要 HTTP 路由:投影单元的 `wire` 把视图推给浏览器,客户端用
 * `useProjection('clearai')` 读——免轮询、自带变更通知。
 */

import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { HUMAN_GATE_ACTIONS, HUMAN_GATE_MARK, MUTATION_KIND, STATE_VERSION, applyEvent, applyMutations, derive, emptyState, renderCard, view } from './fold.js'
import { describeDomainShelf, formatAssertion, validateAssertions, validatePredicate, validateTerm } from './domain-language.js'
import { install as installInvariants } from './invariant.js'

export const name = 'clearai-host'
/** 投影注册表与会话存储:两个都是宿主服务,这里只消费。 */
export const inject = ['sessionProjections', 'sessions']

/** 状态:纯 JSON(投影的持久化缓存前提)。这里只做形状校验,细节由 fold 保证。 */
const stateSchema = z.looseObject({
	sessionId: z.string().optional(),
	goal: z.unknown().nullable(),
	hypotheses: z.array(z.unknown()),
	plans: z.array(z.unknown()),
	evidence: z.array(z.unknown()),
	audits: z.array(z.unknown()),
	materials: z.array(z.unknown()),
	facts: z.array(z.unknown()),
	forks: z.array(z.unknown()),
	scouts: z.array(z.unknown()),
	blocks: z.record(z.string(), z.unknown()),
	releases: z.array(z.unknown()),
	/** 宿主原生的合并技能目录(内核取一次快照,变了才发)。 */
	skillCatalog: z.unknown().nullable(),
	/** 本会话的技能加载记录(从 tool/call 与 `/名字` 用户消息折出来,零新账)。 */
	skillUsage: z.record(z.string(), z.unknown()),
})

/** 浏览器读到的那个视图(面板契约——客户端与宿主半各自消费它的同一批字段)。 */
const viewSchema = z.looseObject({
	ok: z.boolean(),
	mounted: z.boolean(),
	sessionId: z.string().nullable(),
	goal: z.unknown().nullable(),
	plan: z.unknown().nullable(),
	/** 收件箱:面板「需要你 N」的数据面(条目只带分诊信息,见 fold.js 的 derive)。 */
	inbox: z.array(z.unknown()),
	hasOpenGate: z.boolean(),
	/** 外脑全景:技能清单与记忆索引(内核扫描后随投影下发,面板据此画「技能 · 记忆」页签)。 */
	brain: z.unknown().nullable(),
	/** 技能面:**合并目录**(与模型同一张表)+ 本会话用量(面板「技能 · 记忆」页签)。 */
	skills: z.unknown(),
	evidence: z.array(z.unknown()),
	audits: z.array(z.unknown()),
	materials: z.array(z.unknown()),
	facts: z.array(z.unknown()),
	forks: z.array(z.unknown()),
	scouts: z.array(z.unknown()),
})

export function apply(ctx) {
	/**
	 * **把自己的不变量交给宿主**(`@deepseek-ai/dsh-invariants`)——但只在它挂了的时候。
	 *
	 * 为什么在这里注册、而不是另起一行组合:不变量服务**不是每个部署都挂**的诊断面
	 * (它由组合决定,还带 `enabled` 与包名白/黑名单)。在我们这一侧读一次、有就加入,
	 * 于是任何挂了它的部署(宿主自己的开发组合、我们跑验收的那套)都自动带上这几条契约,
	 * 而没挂它的部署里这段是**零成本**的一行判断,不是一个永远等服务的悬空行。
	 *
	 * 认不出服务、或这个名字已经被别的路径注册过(同包名重复注册宿主会抛):都安静放过——
	 * 诊断面不许把产品弄坏。
	 */
	try {
		const invariants = ctx.get('invariants')
		if (invariants !== undefined && typeof invariants.register === 'function') {
			invariants.register('clearai-dsh', installInvariants)
		}
	} catch (error) {
		ctx.logger?.warn?.(`clearai: 宿主不变量没挂上 ${String(error?.message ?? error).slice(0, 160)}`)
	}

	// 视图按状态引用记忆:同一份状态不重复造对象(投影用 Object.is 判断要不要发布)
	let lastState = null
	let lastView = null
	const memoView = (state) => {
		if (state === lastState && lastView !== null) return lastView
		lastState = state
		lastView = view(state)
		return lastView
	}

	ctx.effect(
		() =>
			ctx.sessionProjections.register({
				key: 'clearai',
				stateVersion: STATE_VERSION,
				stateSchema,
				init: (header) => ({ ...emptyState(), sessionId: String(header.id) }),
				/**
				 * 纯同步 fold:见 fold.js 的 applyEvent——
				 * 它吃工具写进 `tool/result.meta` 的变更记录,也吃 `tool/call`
				 * 带来的两条过程事实(在飞、自写路径)。不认识的事件原样返回旧状态。
				 */
				apply(state, event) {
					return applyEvent(state, event)
				},
				wire: { viewSchema, view: memoView },
			}),
		'clearai: session projection unit',
	)

	/** 读面:预设侧与运行态卡都走这里,不各自维护一份状态。 */
	const stateOf = (sessionId) => {
		const session = ctx.sessions.get(sessionId)
		if (session === undefined) return emptyState()
		return ctx.sessionProjections.stateOf(session, 'clearai') ?? emptyState()
	}

	/**
	 * ═══ 人门通道(D2=B:面板可写,但只写人门动作)═══
	 *
	 * 三条硬约束,每一条都有测试盯着:
	 *   ① **动词白名单**:adopt_branch / abandon_fork / promote_skill,
	 *      表外一律拒(与贡献表同一套「表外的名字不许出现」)——**取值**也在这一层校验
	 *      (技能名合原生语法),宁可 400,也不静默半生效;
	 *      `set_autonomy` 已摘掉:「在场与否」是运行时状态,不该是面板上的一个开关 ✗;
	 *   ② **agent 不可达**:这些动词**没有工具 schema**——模型的工具面里不存在它们。
	 *      模型能做的只是读到「人做了什么」这条事实(它进的是会话日志,不是内核状态);
	 *   ③ **留下署名**:动作变成一条 `source.kind === 'user'` 的消息,折进投影时写
	 *      `by:'user'`——「谁在什么时候裁了哪条世界线、扶正了哪个技能、把档切成了什么」都在日志里。
	 *
	 * 两个动词已砍掉(奥卡姆:它们是重复,不是能力):
	 *   · `confirm_plan` —— 原生 `dsh-plan-mode` 就是「用户复核的出口」;而授权本来就「交付即落账」;
	 *   · `invoke_skill` —— 原生 `/` 技能触发器做同一件事(还带候选菜单),我们那条只是在旁边
	 *     又写了一遍同一个手势。
	 *
	 * 为什么走 HTTP 路由而不是 `harness.handle`:那是 cordis **动态插件**的座位,静态客户端包
	 * 没有它(`host.call` 只在动态运行时的包里存在)。宿主平面的路由是这条
	 * 通道在静态包里的对应物,与 ClearAI 面板自己的写接口(FastAPI 路由)同一个层级。
	 */
	/**
	 * 面板用的三条 HTTP 面**必须挂 `connection` 的 exact fetch route 表**,不能只挂 `webServer`——
	 * 挂错层,浏览器里一按就是 404。
	 *
	 * 浏览器那侧的 `/api/*` 先落到 connection 的共享 channel:它先查 exact fetch route 表;
	 * 查不到就把路径当成 RPC 端点(`/api/<ns>.<method>`)去问 interceptor;再查不到,
	 * **直接 `404 "not found"`**。而 `webServer.register({kind:'exact'})` 挂在 `/api` 前缀那条
	 * **后面**,浏览器永远轮不到——面板上的表现就是「点引用 → Unexpected token 'o',
	 * "not found" is not valid JSON」「点技能进不去预览」「产物读不到」。
	 * 原生包也是挂在 fetch 表上的(见 `dsh-client-ui-deliverables` 的 `/api/present.open`)。
	 *
	 * 另一件事:connection 在**没有 web 的档**(headless / SDK)里不存在,所以这里用
	 * `ctx.inject([...])` **延迟注册**——服务出现才挂、消失就收。原来那种「apply 里
	 * `ctx.get('webServer')` 拿一次、拿不到就整段跳过」的写法,在服务晚到时是**静默不挂**。
	 */
	const reply = (status, payload) => Response.json(payload, { status, headers: { 'cache-control': 'no-store' } })
	/**
	 * 产物的**语义分类**:
	 *   章程 `PROJECT.md` / 项目资料 `input/` / 分析过程 `lab/` / 输出成果 `products/` / 外脑 `clear/`。
	 * 面板据此把「核心产物」排在前面,而不是把 100 个中间文件与 3 份交付物混在一起。
	 */
	const pathAreaOf = (path) => {
		const clean = String(path ?? '').replace(/^\.\//, '')
		if (clean === 'PROJECT.md' || clean === 'project.md') return { key: 'constitution', label: '章程' }
		if (clean.startsWith('input/')) return { key: 'input', label: '项目资料' }
		if (clean.startsWith('lab/')) return { key: 'process', label: '分析过程' }
		if (clean.startsWith('products/')) return { key: 'output', label: '输出成果' }
		if (clean.startsWith('clear/')) return { key: 'brain', label: '外脑' }
		return { key: 'other', label: '未分类' }
	}
	const resolveInside = (cwd, candidate) => {
		if (typeof candidate !== 'string' || candidate === '') return null
		const base = resolve(cwd)
		const target = resolve(base, candidate)
		if (target !== base && !target.startsWith(`${base}${sep}`)) return null
		return target
	}
	/**
	 * 盘上**实际**的输出成果:`products/` 底下真有、但**任何计划都还没声明**的那些文件。
	 *
	 * 为什么要它:在一个已经有产物的老项目里开新会话,「产物」栏只有
	 * 「阶段 0 · 交付 0/0」—— 因为这一栏原来只认投影里的**声明**。可人此刻问的是「我拿到了什么」,
	 * 盘上那份 46 KB 的 HTML 明明就在。声明与实际是两件事,这一栏本来就该两边都看得见。
	 *
	 * 奥卡姆:不新开读面、不建第二本账 —— 就是一次有界的目录遍历,字段与声明的产物**同一形状**,
	 * 所以面板能复用同一行渲染。边界写死在这里(depth ≤ 5、扫 ≤2000 条、返回 ≤200 条、
	 * 跳隐藏项与符号链接目录),因为这一栏是给人「第一眼」看的,把整个工作区倒进来就等于
	 * 把它变回一个文件管理器。
	 *
	 * 两个上限分工不同:**扫描上限**防的是巨大的 products/(扫描要停得下来),
	 * **返回上限**防的是把 2000 条全塞给面板。上限留在结果侧而不是扫描侧,返回的那 200 条
	 * 才真是**最近改动的**那 200 条,而不是 readdir 碰巧先遇到的那批。
	 */
	const OUTPUT_MAX_DEPTH = 5
	const OUTPUT_MAX_SCAN = 2000
	const OUTPUT_MAX_FILES = 200
	const listWorkspaceOutputs = (cwd) => {
		const root = resolveInside(cwd, 'products')
		if (root === null) return []
		const workspaceRoot = resolve(cwd)
		const found = []
		let scanned = 0
		const walk = (dir, depth) => {
			if (depth > OUTPUT_MAX_DEPTH || scanned >= OUTPUT_MAX_SCAN) return
			let entries = []
			try {
				entries = readdirSync(dir, { withFileTypes: true })
			} catch {
				// 目录读不了(权限/竞态):跳过这一支,不把整条读面拖成失败。
				return
			}
			for (const entry of entries) {
				if (scanned >= OUTPUT_MAX_SCAN) return
				if (entry.name.startsWith('.')) continue
				const absolute = join(dir, entry.name)
				// 符号链接不进(目录可能成环;文件也不是「盘上真的有一份」)。
				if (entry.isDirectory()) {
					walk(absolute, depth + 1)
					continue
				}
				if (!entry.isFile()) continue
				scanned += 1
				let info = null
				try {
					info = statSync(absolute)
				} catch {
					continue
				}
				// 路径一律**相对工作区**(与声明的产物同一形式):面板把它原样交给原生预览,
				// 原生按工作区根解析 —— 给成相对 products/ 的路径会指到别的文件上去。
				found.push({ relative: relative(workspaceRoot, absolute), bytes: info.size, modifiedAt: info.mtimeMs })
			}
		}
		walk(root, 1)
		// 最近动过的排前面:人问的是「我拿到了什么」,新东西更可能是答案。
		return found.sort((left, right) => right.modifiedAt - left.modifiedAt).slice(0, OUTPUT_MAX_FILES)
	}
	/**
	 * 一条人门消息:**署名是人 + 结构化标记 + 一句人话**。
	 * 两条路(面板直接点 / 原生提问卡答)共用它 ⇒ 无论从哪儿来,落进日志的是同一种事实。
	 */
	function appendHumanGate(agent, { detail, human, followUp }) {
		const text = `${HUMAN_GATE_MARK} ${JSON.stringify(detail)}\n${human}这是**结构化的决定,不是商量**:${followUp}。\n`
		const message = {
			id: `clearai-gate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
			role: 'user',
			content: [{ type: 'text', text }],
			source: { kind: 'user' },
		}
		// 跑着就插到最近的步边界(steer);闲着就叫醒它(followup)。
		if (agent.status === 'running') agent.steer(message)
		else agent.followup(message)
	}

	/**
	 * 把一道开着的人门**建成一张原生提问卡**(混合路径:内容走原生,裁决回我们的账本)。
	 *
	 * 问题与选项都从**投影**现算(此刻真实的分叉与技能),不在前端拼——前端只发一个手势。
	 * 认不出来(那道门已经不在了)就返回 `null`:如实拒掉,不摆一张过期的卡。
	 */
	function buildGateQuestion(gate, { sessionId, fork, skill }) {
		const state = stateOf(sessionId)
		const projected = view(state)
		if (gate === 'fork_adopt') {
			const target = (projected.forks ?? []).find((item) => item.id === fork && item.phase === 'deciding')
			if (target === undefined) return null
			const branches = target.branches ?? []
			if (branches.length === 0) return null
			const recommended = branches.find((branch) => branch.id === target.recommended) ?? null
			const lines = [
				`**要裁决的**:${target.question}`,
				`**判据**:${target.decideBy?.metric ?? '—'}(取${target.decideBy?.direction === 'min' ? '最小' : '最大'})`,
				'',
				...branches.map((branch) => `- **${branch.label}**(${branch.id}${branch.id === target.recommended ? ' · 推荐' : ''}):${branch.approach} · 读数 ${branch.reading ?? '—'} · 有效性 ${branch.validity ?? '—'}`),
			]
			if (target.provisional === true) lines.push('', '⚠️ 这次裁决还是**暂定**的:证据不够硬。')
			return {
				kind: 'adopt_branch',
				questions: [
					{
						id: 'fork-adopt',
						header: '世界线裁决',
						question: `采纳哪条世界线?(推荐:${recommended?.label ?? '无'})`,
						detail: lines.join('\n'),
						options: branches.map((branch) => ({
							label: branch.label,
							description: `${branch.approach} · 读数 ${branch.reading ?? '—'}`,
						})),
					},
				],
				byLabel: new Map(branches.map((branch) => [branch.label, branch.id])),
				fork: target.id,
			}
		}
		if (gate === 'promote_skill') {
			const candidate = (projected.brain?.skills ?? []).find((item) => item.name === skill && item.status === 'candidate')
			if (candidate === undefined) return null
			return {
				kind: 'promote_skill',
				questions: [
					{
						id: 'promote-skill',
						header: '候选技能',
						question: `采纳候选技能「${candidate.name}」?`,
						detail: [`**它是什么**:${candidate.description ?? '(没有描述)'}`, `**落在哪**:${candidate.path ?? '—'}`, '', '采纳之后它会进入你的技能目录(内核改写 frontmatter),模型从此加载得到它。'].join('\n'),
						options: [
							{ label: '采纳', description: '写进技能目录,模型从此加载得到它。' },
							{ label: '先不采纳', description: '候选留在工作区里,你以后还可以采纳。' },
						],
					},
				],
				byLabel: new Map([['采纳', 'yes'], ['先不采纳', 'no']]),
				skill: candidate.name,
			}
		}
		return null
	}

	/**
	 * 把原生卡上的答案翻译成**人门动作**;人没作答(撤下卡/跳过)⇒ `null`,什么都不落。
	 * 判据用的是我们自己的标签(与内核的 `intent.approve` 同一条纪律:按标签判,不按按钮文字)。
	 */
	function answerOf(asked, answer) {
		const item = (Array.isArray(answer?.answers) ? answer.answers : []).find((entry) => entry?.id === asked.questions[0].id)
		const selected = Array.isArray(item?.selected) ? item.selected : []
		const custom = typeof item?.custom === 'string' ? item.custom.trim() : ''
		if (selected.length === 0 && custom === '') return null
		if (asked.kind === 'adopt_branch') {
			// 人可以直接选一条,也可以在自定义框里打一条世界线 id 或名字。
			const branchId = selected.length === 1 ? (asked.byLabel.get(selected[0]) ?? null) : (asked.byLabel.get(custom) ?? (/^b-[a-z0-9]+$/.test(custom) ? custom : null))
			if (branchId === null) return null
			return {
				detail: { action: 'adopt_branch', plan: null, fork: asked.fork, branch: branchId, skill: null, value: null, note: null },
				human: `人在原生提问卡上裁决:采纳这条世界线(${branchId})。`,
				followUp: '跑 ConvergeFork 落实它——合并与清理是内核的活',
			}
		}
		if (asked.kind === 'promote_skill') {
			const choice = selected.length === 1 ? (asked.byLabel.get(selected[0]) ?? null) : (asked.byLabel.get(custom) ?? null)
			if (choice !== 'yes') return null // 「先不采纳」= 人不采纳:什么都不落(与直接路径一致:不采纳不是一条事实)
			return {
				detail: { action: 'promote_skill', plan: null, fork: null, branch: null, skill: asked.skill, value: null, note: null },
				human: `人在原生提问卡上采纳了候选技能「${asked.skill}」——它从此进你的技能目录。`,
				followUp: '候选状态正由内核改写(`status: active`),下一个回合它就在你的技能目录里',
			}
		}
		return null
	}

	ctx.inject(['connection'], (connectionCtx) => {
		/** 挂一条 exact fetch route:归属当前 fiber,connection 消失时自动收掉。 */
		const route = (path, methods, fetch) =>
			connectionCtx.effect(
				() => connectionCtx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch: (request) => Promise.resolve(fetch(request)) }),
				`clearai: ${path}`,
			)

		route('/api/clearai/gate', ['POST'], async (httpRequest) => {
			let request = null
			try {
				request = await httpRequest.json()
			} catch {
				// 连 JSON 都不是:如实说,而不是当成「未知动词」。
				return reply(400, { ok: false, error: 'bad_json' })
			}
			const action = request === null || typeof request !== 'object' ? '' : String(request.action ?? '')
			/**
			 * `ask` 是**界面手势**,不是事实动词:它把某道等人的人门摆到**原生提问卡**上,
			 * 再由人在卡里选——选出来的答案仍走下面那条老路(人门消息 → 内核落事实)。
			 * 所以白名单分两层:能**写事实**的只有 `HUMAN_GATE_ACTIONS`;能**发起提问**的另有一个。
			 */
			const ASKABLE_GATES = ['fork_adopt', 'promote_skill']
			if (action !== 'ask' && !HUMAN_GATE_ACTIONS.includes(action)) return reply(400, { ok: false, error: 'unknown_gate_action' })
			const sessionId = request === null || typeof request !== 'object' ? '' : String(request.sessionId ?? '')
			const agents = ctx.get('agents')
			const agent = sessionId === '' ? undefined : agents?.get?.(sessionId)
			if (agent === undefined) return reply(404, { ok: false, error: 'no_live_session' })
			// 只挑需要的最小标量,不在 RPC 边界上搬活的会话对象。
			const detail = {
				action,
				plan: typeof request.plan === 'string' ? request.plan : null,
				fork: typeof request.fork === 'string' ? request.fork : null,
				branch: typeof request.branch === 'string' ? request.branch : null,
				skill: typeof request.skill === 'string' ? request.skill : null,
				value: typeof request.value === 'string' ? request.value : null,
				note: typeof request.note === 'string' ? request.note.slice(0, 200) : null,
			}
			/**
			 * **本体四动词(人的通道)**:词条字段在 RPC 边界上只收表内的那几个、带长度上限——
			 * 表外的字段一律剥掉(不是拒:人门消息进日志,日志里不该出现没约定的形状)。
			 * 判据与模型工具**同一份**:校验用 `domain-language` 的纯函数,对当前词汇判,
			 * 不过就 400 并把问题清单带回界面——「点了报成功、账上一字未改」不许再出现。
			 */
			const ONTOLOGY_GATE_ACTIONS = ['register_term', 'register_predicate', 'revise_term', 'deprecate_entry']
			if (ONTOLOGY_GATE_ACTIONS.includes(action)) {
				const raw = request.entry ?? {}
				const str = (key, cap = 300) => (typeof raw[key] === 'string' ? raw[key].slice(0, cap) : undefined)
				detail.entry = {
					id: str('id', 40),
					label: str('label', 60),
					gloss: str('gloss'),
					basis: str('basis'),
					parent: str('parent', 40),
					domain: str('domain', 40),
					reason: str('reason', 200),
					unit: str('unit', 24),
					aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((item) => typeof item === 'string').slice(0, 8).map((item) => item.slice(0, 60)) : undefined,
					functional: raw.functional === true ? true : undefined,
					range:
						raw.range !== null && typeof raw.range === 'object' && ['statement', 'quantity', 'formula', 'code', 'reference'].includes(String(raw.range.form))
							? { form: String(raw.range.form), unit: typeof raw.range.unit === 'string' ? raw.range.unit.slice(0, 24) : undefined, term: typeof raw.range.term === 'string' ? raw.range.term.slice(0, 40) : undefined }
							: undefined,
				}
				const lexicon = stateOf(sessionId).lexicon
				let problems = []
				if (action === 'register_term') problems = validateTerm(lexicon, detail.entry)
				if (action === 'register_predicate') problems = validatePredicate(lexicon, detail.entry)
				if (action === 'revise_term' || action === 'deprecate_entry') {
					const id = detail.entry.id ?? ''
					const known = [...(lexicon.terms ?? []), ...(lexicon.predicates ?? [])].find((item) => item.id === id)
					if (known === undefined) problems = [`unknown_entry:词汇里没有这个条目:${id}`]
					else if (action === 'deprecate_entry' && known.status === 'deprecated') problems = [`already_deprecated:${id} 已经是废止状态`]
					else if ((detail.entry.reason ?? '') === '' || detail.entry.reason === undefined) problems = ['reason_required:这一步要写一句缘由']
					else if (action === 'revise_term' && detail.entry.label === undefined && detail.entry.gloss === undefined && detail.entry.aliases === undefined) problems = ['nothing_to_revise:label / gloss / aliases 至少给一个']
				}
				if (problems.length > 0) return reply(400, { ok: false, error: 'entry_rejected', problems })
			}
			/**
			 * 技能名要先过**取值校验**,再进日志。
			 *
			 * 它必须是原生那条语法(kebab-case):这个名字会变成 `/<名字>` 手势(原生 pre-step
			 * 认的就是 `[a-z0-9]+(-[a-z0-9]+)*`),放别的形状进去只会静默不生效——比拒绝更坏。
			 * 表外的值一律拒,与动词白名单同一套纪律。
			 */
			if (action === 'promote_skill' && (detail.skill === null || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(detail.skill))) {
				return reply(400, { ok: false, error: 'bad_skill_name' })
			}
			/**
			 * 撤回 / 维持一条事实:先**核标的还在不在**。
			 *
			 * 与提问卡那条同一个理由:`buildGateQuestion` 认不出那道门时回 409,而不是摆一张过期的卡。
			 * 这里如果不核,面板会收到一句成功、而账本上一字未改——「点了报成功、什么都没做」
			 * 正是这套界面最不能有的那类东西。
			 */
			if (action === 'confirm_provisional') {
				const projected = view(stateOf(sessionId))
				const fork = (projected.forks ?? []).find((item) => item.id === detail.fork)
				if (fork === undefined) return reply(409, { ok: false, error: 'fork_not_found' })
				if (fork.merge?.provisional !== true) return reply(409, { ok: false, error: 'not_provisional' })
				if (fork.merge?.confirmed !== null && fork.merge?.confirmed !== undefined) return reply(409, { ok: false, error: 'already_confirmed' })
			}
			if (action === 'retract_fact' || action === 'keep_fact') {
				const projected = view(stateOf(sessionId))
				const fact = (projected.facts ?? []).find((item) => item.id === detail.value)
				if (fact === undefined) return reply(409, { ok: false, error: 'fact_not_found' })
				if (fact.review !== null && fact.review !== undefined) return reply(409, { ok: false, error: 'fact_already_reviewed' })
			}
			/**
			 * ── 混合路径:点我们那条 → 用**原生提问卡**问 ──────────────────────
			 *
			 * 为什么值这一条:我们自己的人门行(fork 裁决 / 采纳技能)现在只能在右栏面板里点按钮,
			 * 而「人正在看对话」的时候,卡就在他眼前、还把输入框挡住——那是原生最擅长的形态。
			 * 借的只是**问答界面**:答案回来之后,落账的那条事实与直接点按钮**一模一样**
			 * (同一个人门消息、同一套校验、同一本账)。借界面,不借账。
			 */
			if (action === 'ask') {
				const gate = String(request.gate ?? '')
				if (!ASKABLE_GATES.includes(gate)) return reply(400, { ok: false, error: 'bad_gate' })
				const questions = ctx.get('userQuestions')
				if (questions === undefined || typeof questions.ask !== 'function') {
					return reply(409, { ok: false, error: 'no_question_channel' })
				}
				const asked = buildGateQuestion(gate, { sessionId, fork: typeof request.fork === 'string' ? request.fork : null, skill: typeof request.skill === 'string' ? request.skill : null })
				if (asked === null) return reply(409, { ok: false, error: 'gate_not_open' })
				/**
				 * **不占着 HTTP 请求等人**:点击只是「把卡摆上去」,人什么时候答都行。
				 * 答案到了再落账(与直接点按钮同一条路),失败也只记一行日志——界面手势不该 500。
				 */
				void questions
					.ask({ questions: asked.questions, agent })
					.then((answer) => {
						const chosen = answerOf(asked, answer)
						if (chosen === null) return null // 人撤下了卡:什么都不落(他不算答过)
						return appendHumanGate(agent, chosen)
					})
					.catch((error) => {
						ctx.logger?.warn?.(`clearai gate: 原生提问失败 ${String(error?.message ?? error).slice(0, 160)}`)
					})
				return reply(200, { ok: true, asked: true, gate })
			}
			const human =
				action === 'adopt_branch'
					? `人在面板上裁决:采纳这条世界线(${detail.branch ?? '?'})。`
					: action === 'promote_skill'
						? `人在面板上采纳了候选技能「${detail.skill ?? '?'}」——它从此进你的技能目录。`
						: action === 'confirm_provisional'
							? `人复核了那次**临时采纳**(${detail.fork ?? '?'})并认可它:这个结论不再是「待复核」。`
							: action === 'retract_fact'
							? `人审查了被推翻的那条事实(${detail.value ?? '?'})后决定**撤回**它${detail.note === null ? '' : `,缘由:${detail.note}`}。`
							: action === 'keep_fact'
								? `人审查了被推翻的那条事实(${detail.value ?? '?'})后判定**证据不可靠,维持原事实**${detail.note === null ? '' : `,缘由:${detail.note}`}。`
							: ONTOLOGY_GATE_ACTIONS.includes(action)
								? `人在本体格里${action === 'register_term' ? `登记了概念「${detail.entry?.label ?? detail.entry?.id ?? '?'}」` : action === 'register_predicate' ? `登记了谓词「${detail.entry?.label ?? detail.entry?.id ?? '?'}」` : action === 'revise_term' ? `修订了「${detail.entry?.id ?? '?'}」的展示信息` : `废止了「${detail.entry?.id ?? '?'}」`}${detail.entry?.basis ? `,依据:${detail.entry.basis}` : ''}${detail.entry?.reason ? `,缘由:${detail.entry.reason}` : ''}。`
								: '人在面板上做了一个动作。'
			const followUp =
				ONTOLOGY_GATE_ACTIONS.includes(action)
					? '这条词汇变更已落账(`by:user`),与模型工具落的是同一本账、同一套判据;词汇货架会在下一拍同步'
					: action === 'confirm_provisional'
					? '这条确认已经落账(`by:user`);那道门随之消失,续跑可以继续'
					: action === 'retract_fact' || action === 'keep_fact'
					? '这个决定已经落账,并会写进 `clear/knowledge/facts/` 那一份(下一轮引用它之前先看那条记录)'
					: action === 'promote_skill'
					? '候选状态正由内核改写(`status: active`),下一个回合它就在你的技能目录里'
					/* 说准(rather than 说满):这句话写下的那一刻只到 inbox、还没进投影,
					   所以不能断言「已经在投影里生效」——失效模式是模型看到它与卡片矛盾,停下来问人。 */
					: '跑 ConvergeFork 落实它——合并与清理是内核的活'
			try {
				appendHumanGate(agent, { detail, human, followUp })
			} catch (error) {
				return reply(500, { ok: false, error: String(error?.message ?? error).slice(0, 200) })
			}
			return reply(200, { ok: true, action, sessionId })
		})

		/**
		 * ═══ 两条只读读面(面板在浏览器里读不了盘)═══
		 *
		 * `GET /api/clearai/deliverables?sessionId=` 交付物:按阶段(Plan)分组,每条给出
		 *   声明(步骤 artifacts)、盘上在不在、多大、谁验的。**声明 vs 实际**是这个产品的核心对照。
		 * `GET /api/clearai/brain?sessionId=` 工作区现状:技能目录(内核还没落事实时面板的兜底)。
		 *
		 * **没有「读文件正文」那条了**:预览交给 DSH 原生的文档预览
		 * (`dsh-client-ui-sidebar-documentpreview` 的 6 个实现 + 它自己的分页读盘),
		 * 我们只按原生地址把文件递过去。少一条读面 = 少一处要维护的路径守卫,
		 * 而且原生那边本来就有 markdown / 图片 / pdf / html 的渲染。
		 */
		route('/api/clearai/deliverables', ['GET'], (httpRequest) => {
			const url = new URL(httpRequest.url)
			const session = ctx.sessions.get(url.searchParams.get('sessionId') ?? '')
			const cwd = session?.header?.cwd
			if (typeof cwd !== 'string' || cwd === '') return reply(404, { ok: false, error: 'no_live_session' })
			// 只挑叶子字段构造属于我们自己的 JSON:不把投影对象整体搬出去。
			const state = ctx.sessionProjections.stateOf(session, 'clearai')
			const stages = (state?.plans ?? []).map((plan) => ({
				plan: plan.id,
				status: plan.status,
				brief: plan.brief ?? '',
				confirmedAt: plan.confirmed_at ?? null,
				openedAt: plan.at ?? null,
				closedAt: plan.closedAt ?? null,
				summary: plan.summary ?? null,
				steps: (plan.steps ?? []).map((step) => ({
					id: step.id,
					ordinal: step.ordinal,
					do: step.do,
					status: step.status,
					doneCriteria: step.done_criteria,
					level: step.tests?.level ?? null,
					advancedAt: step.advancedAt ?? null,
					voidReason: step.voidReason ?? null,
					artifacts: (step.artifacts ?? []).map((artifact) => {
						const absolute = resolveInside(cwd, artifact)
						let info = null
						try {
							info = absolute === null ? null : statSync(absolute)
						} catch {
							info = null
						}
						const isFile = info !== null && info.isFile()
						/**
						 * `exists: false` 有两种成因,**面板必须分开说**(混着写会误导下一步动作):
						 * 模型把 `lab/`(一个目录)声明成物证时,准入按「空目录」拒了它;
						 * 而面板原来一律写「缺 · 盘上没有这个文件」——它明明在,只是不是文件。
						 * 事实有两种,界面就别用一句话盖住。
						 */
						return {
							path: artifact,
							area: pathAreaOf(artifact),
							exists: isFile,
							directory: info !== null && info.isDirectory(),
							bytes: isFile ? info.size : null,
							modifiedAt: isFile ? info.mtimeMs : null,
						}
					}),
				})),
			}))
			/**
			 * 「实际」那一半:盘上真有、但没有任何计划声明过的 products/ 文件。
			 * 与声明过的按**路径**去重 —— 同一条不许在栏里出现两遍。
			 */
			const declared = new Set(stages.flatMap((stage) => stage.steps.flatMap((step) => step.artifacts.map((artifact) => artifact.path))))
			const outputs = listWorkspaceOutputs(cwd)
				.filter((item) => !declared.has(item.relative))
				.map((item) => ({ path: item.relative, area: pathAreaOf(item.relative), exists: true, bytes: item.bytes, modifiedAt: item.modifiedAt, declared: false }))
			return reply(200, { ok: true, stages, outputs })
		})

		/**
		 * `GET /api/clearai/brain?sessionId=` —— 工作区**现状**的实时技能目录。
		 *
		 * 为什么需要它:面板的数据来自会话日志的投影,而内核只在
		 * `agent/pre-step` 里落事实;于是**新建的会话在第一轮对话之前**,「技能 · 记忆」页签是空的
		 * (提示还让人「先在 clear/skills/ 里放一个技能」——可那里明明躺着 18 个模板技能)。
		 *
		 * 这条读面直接问宿主的 `skills` 服务(它就是模型看到的那张合并目录),返回字段与内核
		 * 随投影下发的 `catalog.entries` **逐字段一致**,所以面板能用同一套渲染。
		 * 它是**读面不是事实**:面板会如实标注「本会话还没有第一轮对话,这份还没进投影」。
		 */
		route('/api/clearai/brain', ['GET'], async (httpRequest) => {
			const url = new URL(httpRequest.url)
			const session = ctx.sessions.get(url.searchParams.get('sessionId') ?? '')
			const cwd = session?.header?.cwd
			if (typeof cwd !== 'string' || cwd === '') return reply(404, { ok: false, error: 'no_live_session' })
			const skills = ctx.get('skills')
			if (skills === undefined || typeof skills.snapshot !== 'function') return reply(200, { ok: false, error: 'no_skill_registry' })
			const agent = ctx.get('agents')?.get?.(session.id)
			let snapshot = null
			try {
				snapshot = await skills.snapshot({ cwd, ...(agent === undefined ? {} : { scope: agent }) })
			} catch {
				return reply(200, { ok: false, error: 'snapshot_failed' })
			}
			// 观测不完整就不发:一张缺几条的表比空表更坏(它会看起来像「技能被删了」)。
			if (snapshot === null || snapshot.complete !== true) return reply(200, { ok: false, error: 'incomplete' })
			const prefix = cwd.endsWith(sep) ? cwd : `${cwd}${sep}`
			const entries = (Array.isArray(snapshot.skills) ? snapshot.skills : [])
				.map((skill) => {
					const base = skill?.resourceBase
					const dir = base !== null && typeof base === 'object' && base.kind === 'directory' && typeof base.path === 'string' ? base.path : null
					return {
						name: String(skill?.name ?? ''),
						description: String(skill?.description ?? '').slice(0, 300),
						when_to_use: typeof skill?.whenToUse === 'string' ? skill.whenToUse.slice(0, 300) : null,
						source: String(skill?.source ?? 'unknown'),
						provider: String(skill?.provider ?? ''),
						model: skill?.invocation?.modelInvocable === true,
						user: skill?.invocation?.userInvocable === true,
						dir,
						// 与内核同一套约定:虚拟条目(记忆索引)没有正文文件。
						file: dir === null || String(skill?.source ?? '') === 'clearai-memory' ? null : join(dir, 'SKILL.md'),
						inside: dir === null ? null : dir === cwd || dir.startsWith(prefix),
					}
				})
				.filter((entry) => entry.name !== '')
			return reply(200, { ok: true, complete: true, entries })
		})

	})

	ctx.effect(
		() =>
			ctx.provide('clearai', {
				/** 原始状态(工具做不变量判断用)。调用方不得修改。 */
				state: stateOf,
				/** 派生:阶段/完成度/假设状态/世界线阶段,全部现算。 */
				derive: (sessionId) => derive(stateOf(sessionId)),
				/** 面板视图(与 wire 同一份)。 */
				view: (sessionId) => view(stateOf(sessionId)),
				/**
				 * 运行态卡:注给模型的**事实**。
				 *
				 * `overrides.autonomy`:面板上曾可以切档,而那一拍投影里还是旧档
				 * (消息先入 inbox、后落日志,而 pre-step 跑在它落账之前)。切档入口已经摘除,
				 * 但**这条覆盖通道保留**:一是旧会话日志里仍有那种记录,二是它保证了"卡片说的就是
				 * 这一回合真正要跑的机制"这条不变量——两句话互相矛盾比一句话过期更糟
				 * (旧投影与新消息同框时,模型会被矛盾卡住——所以宁缺毋假)。
				 */
				renderCard: (sessionId, overrides = {}) => {
					const state = stateOf(sessionId)
					if (overrides.autonomy !== 'attended' && overrides.autonomy !== 'unattended') return renderCard(state)
					return renderCard({
						...state,
						autonomy: {
							...(state.autonomy ?? {}),
							effective: { value: overrides.autonomy, source: 'session', preset: state.autonomy?.effective?.preset ?? null },
						},
					})
				},
				/**
				 * 预演:把本次调用要落的变更先折一遍,好让工具返回的卡片是**这一步之后**的样子。
				 * 投影要到结果落账才前进,而工具在返回时就需要说清新状态——
				 * 与其在预设侧复制一份 fold,不如让 fold 的拥有者替它算。
				 */
				preview: (sessionId, mutations) => {
					const next = applyMutations(stateOf(sessionId), mutations)
					return { state: next, card: renderCard(next), view: view(next) }
				},
				/**
				 * **领域语言层的判据**(值形状、引用存在、值域、同一事实自洽)与货架正文。
				 *
				 * 为什么由宿主半提供,而不是预设侧自己写一份:判据**只能有一份**。
				 * 预设侧的工具与这条路由要判的是同一件事,而两份实现必然漂成
				 * 「登记时放行、升格时拒绝」——那种不一致在界面上与「这条还没验」长得一模一样。
				 * 所以判据住在纯函数模块里,预设侧经这道门调用它。
				 */
				domain: {
					validateTerm: (sessionId, draft) => validateTerm(stateOf(sessionId).lexicon, draft),
					validatePredicate: (sessionId, draft) => validatePredicate(stateOf(sessionId).lexicon, draft),
					validateAssertions: (sessionId, assertions) => validateAssertions(stateOf(sessionId).lexicon, assertions),
					/**
					 * 货架正文。带 `mutations` 时按**这一步之后**的样子渲染——
					 * 工具在返回前就把货架写好,读的人不必等下一回合。
					 */
					renderShelf: (sessionId, mutations = []) => {
						const state = applyMutations(stateOf(sessionId), Array.isArray(mutations) ? mutations : [])
						const next = derive(state)
						// 在途命题也传进去:词汇刚立起来时「引用 0」会让人以为没人用,而断言已经在假设上了。
						return describeDomainShelf(state.lexicon, next.factRows, next.hypotheses)
					},
					/** 一条断言的一行人话(货架 / 卡片 / 查询共用同一句话,免得三处各写一套)。 */
					format: (sessionId, assertion) => formatAssertion(stateOf(sessionId).lexicon, assertion),
				},
			}),
		'clearai: read facade',
	)
}
