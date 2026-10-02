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

import { z } from 'zod'
import { MUTATION_KIND, STATE_VERSION, applyEvent, applyMutations, derive, emptyState, inspectGraphSelection, renderCard, view } from './fold.js'
import { describeDomainShelf, formatAssertion, graphProjection, validateAssertions, validatePredicate, validateTerm } from './domain-language.js'
import { knowledgeView as knowledgeViewOf } from './knowledge-view.js'
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
	blocks: z.record(z.string(), z.unknown()),
	releases: z.array(z.unknown()),
})

/** 浏览器读到的那个视图(面板契约——客户端与宿主半各自消费它的同一批字段)。 */
const viewSchema = z.looseObject({
	ok: z.boolean(),
	mounted: z.boolean(),
	sessionId: z.string().nullable(),
	goal: z.unknown().nullable(),
	plan: z.unknown().nullable(),
	/** 待处理:只陈述的几行(计划停下、结论矛盾),见 fold.js 的 derive。 */
	needYou: z.array(z.unknown()),
	evidence: z.array(z.unknown()),
	audits: z.array(z.unknown()),
	materials: z.array(z.unknown()),
	facts: z.array(z.unknown()),
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

	/**
	 * ═══ 注入服务只走**方法式**,读不到就降级 ═══
	 *
	 * 属性式读服务(把服务名当属性取)在 Cordis 里走一条 Proxy walk:只要本 fiber
	 * (或链路上某个声明了同一条 inject 的祖先 fiber)此刻不是 ACTIVE,它**当场抛**
	 * `cannot get required service "…" in inactive context`。
	 * 方法式 `ctx.get(名字)` 走的是全局注册表,同一时刻只回 `undefined`——
	 * 于是「这一刻读不到」成了一个**可表示**的值:读面降级,而不是把一次跑了几分钟的
	 * 评审整个作废。所以宿主半一次都不许出现属性式访问;`inject` 声明保留,
	 * 它保证正常路径上的就位顺序。
	 *
	 * 连方法式都炸(不该发生)时也走同一条降级:读面不许变成失败面。
	 *
	 * 降级这件事本身也要留痕:落一条**宿主健康事实**——只增不删,只留最近这些条,
	 * 随 `state()` / `view()` 读取暴露(字段 `hostHealth`)。它与折法从会话日志折出来的
	 * 那份**同形**(`[{ scope, detail, at }]`),所以面板与卡不必为「本地的」和「折出来的」
	 * 写两套读法。
	 */
	const HOST_HEALTH_MAX = 20
	const hostHealth = []
	/**
	 * **内容寻址的 id**:`scope + detail` 一样就是同一条观测。
	 *
	 * 为什么不用时间戳:`at` 每次都不同,同一条降级会被记成无数条。用内容算 id 之后,
	 * ① 本地数组自己按 id 去重;② 内核把观测落成 `host/inactive` 变更时用同一个 id,
	 * 折法按 id 幂等 ⇒ **账本上一条、读数上一条**,不会因为"宿主记一次、内核再落一次"变成两条。
	 */
	const hostHealthId = (scope, detail) => {
		let h = 0x811c9dc5
		const text = `${scope}\u0000${detail}`
		for (let index = 0; index < text.length; index += 1) {
			h ^= text.charCodeAt(index)
			h = Math.imul(h, 0x01000193) >>> 0
		}
		return `hh-${h.toString(16).padStart(8, '0')}`
	}
	const noteHostHealth = (scope, detail) => {
		const id = hostHealthId(scope, detail)
		if (hostHealth.some((entry) => entry.id === id)) return
		hostHealth.push({ id, scope, detail, at: Date.now() })
		if (hostHealth.length > HOST_HEALTH_MAX) hostHealth.splice(0, hostHealth.length - HOST_HEALTH_MAX)
	}
	/**
	 * 与折法折出来的那份**合并**,不是覆盖:折法手里的 `hostHealth` 是账本上的历史,
	 * 本地这份是「这一刻读不到」的观测;两者都是读者要知道的事实,谁都不许把谁盖掉。
	 * 本地一条都没有时原样返回,正常路径上的返回值与加这条机制之前逐字段相同。
	 */
	const withHostHealth = (value) => {
		if (hostHealth.length === 0) return value
		const folded = Array.isArray(value?.hostHealth) ? value.hostHealth : []
		// 账本上已经有同一条(内核把它落成了 `host/inactive`)就不再加本地那份:同一条事实只报一次。
		const known = new Set(folded.map((entry) => entry?.id).filter((id) => id !== undefined && id !== null))
		const fresh = hostHealth.filter((entry) => !known.has(entry.id)).map((entry) => ({ ...entry }))
		if (fresh.length === 0) return { ...value, hostHealth: folded }
		return { ...value, hostHealth: [...folded, ...fresh] }
	}

	const sessionsOf = () => {
		let sessions
		try {
			sessions = ctx.get('sessions')
		} catch {
			sessions = undefined
		}
		if (sessions === undefined || sessions === null) {
			noteHostHealth('sessions', '宿主半此刻拿不到会话服务:读面退回空态(不是「这个会话不存在」)')
			return undefined
		}
		return sessions
	}

	/** 投影服务:同上一条降级语义,同一条方法式访问。 */
	const projectionsOf = () => {
		let projections
		try {
			projections = ctx.get('sessionProjections')
		} catch {
			projections = undefined
		}
		if (projections === undefined || projections === null) {
			noteHostHealth('sessionProjections', '宿主半此刻拿不到投影服务:读面退回空态(不是「这个会话没有状态」)')
			return undefined
		}
		return projections
	}

	/**
	 * 本插件 fiber 掉出 ACTIVE 时留一条观测。
	 *
	 * 读面降级只解释「这一刻读不到」,解释不了「为什么会读不到」——那要看 fiber 生命周期。
	 * Cordis 的 `internal/status` 事件带着 (fiber, 旧状态),订阅面就挂在它上面;
	 * 事件面是所有 fiber 共用的,所以过滤靠**身份**(`ctx.fiber`)而不是名字。
	 * 观测面的失败不许把产品弄坏:订阅抛错也只是少一条证据。
	 */
	const FIBER_ACTIVE = 2
	try {
		ctx.on('internal/status', (fiber, oldValue) => {
			if (fiber !== ctx.fiber || oldValue !== FIBER_ACTIVE) return
			const detail = `宿主半 fiber 掉出 ACTIVE(${oldValue} → ${fiber.state}):两个注入服务这一刻都读不到,读面退回空态`
			noteHostHealth('sessions', detail)
			noteHostHealth('sessionProjections', detail)
			ctx.logger?.warn?.(`clearai: ${detail}`)
		})
	} catch (error) {
		ctx.logger?.warn?.(`clearai: fiber 生命周期观测没挂上 ${String(error?.message ?? error).slice(0, 160)}`)
	}

	ctx.effect(
		() => {
			const projections = projectionsOf()
			if (projections === undefined || typeof projections.register !== 'function') return () => {}
			const disposer = projections.register({
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
			})
			return typeof disposer === 'function' ? disposer : () => {}
		},
		'clearai: session projection unit',
	)

	/** 读面:预设侧与运行态卡都走这里,不各自维护一份状态。 */
	const stateOf = (sessionId) => {
		const sessions = sessionsOf()
		if (sessions === undefined || typeof sessions.get !== 'function') return withHostHealth(emptyState())
		const session = sessions.get(sessionId)
		if (session === undefined) return withHostHealth(emptyState())
		const projections = projectionsOf()
		if (projections === undefined || typeof projections.stateOf !== 'function') return withHostHealth(emptyState())
		return withHostHealth(projections.stateOf(session, 'clearai') ?? emptyState())
	}

	/** 会话服务的读,给路由用:同一条降级语义(拿不到 ⇒ `undefined`)。 */
	const sessionOf = (sessionId) => {
		const sessions = sessionsOf()
		return sessions === undefined || typeof sessions.get !== 'function' ? undefined : sessions.get(sessionId)
	}

	/** 面板视图:与 `state()` 同一份降级读数(健康事实一起交出去)。 */
	const viewOf = (sessionId) => withHostHealth(view(stateOf(sessionId)))

	/**
	 * ═══ 面板只读 ═══
	 *
	 * 面板没有写入口。原来的人门通道 `/api/clearai/gate` 在第六阶段整条拿掉:
	 * 撤回 / 维持事实第三阶段起由内核在那次交付里当场问人;本体四动词随编辑抽屉一起删,
	 * 要改词汇就在对话里说。旧日志里人按过的动作仍由 `fold.js` 的 `parseHumanGate` 照旧折出来。
	 */
	/**
	 * 面板用的 HTTP 面**必须挂 `connection` 的 exact fetch route 表**,不能只挂 `webServer`——
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
	ctx.inject(['connection'], (connectionCtx) => {
		/** 挂一条 exact fetch route:归属当前 fiber,connection 消失时自动收掉。 */
		const route = (path, methods, fetch) =>
			connectionCtx.effect(
				() => connectionCtx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch: (request) => Promise.resolve(fetch(request)) }),
				`clearai: ${path}`,
			)

		/**
		 * `GET /api/clearai/inspector?sessionId=…&kind=…&id=…`
		 *
		 * **知识 Inspector**:图上点了一个节点或边,把它的定义 / 关系 / 断言 / 证据链 / 历史取回来。
		 *
		 * 为什么走路由而不是塞进 `view()`:选择是**动态**的——把每个节点每条边的完整链都预先
		 * 推进投影,等于对一张 61 节点 / 147 边的图各算一遍,而人一次只看一个。
		 * 组装仍然只有一处实现(`inspectGraphSelection`,纯函数在宿主半),所以
		 * 「客户端自己拼证据链」这条口子没有开。
		 *
		 * 只读:**不产生任何变更**,也拿不到写入口。
		 */
		route('/api/clearai/inspector', ['GET'], async (httpRequest) => {
			const url = new URL(httpRequest.url)
			const sessionId = url.searchParams.get('sessionId') ?? ''
			const session = sessionOf(sessionId)
			if (session === undefined) return reply(404, { ok: false, error: 'no_live_session' })
			/**
			 * 直接用本模块的折法读状态,不走 `ctx.get('clearai')`:那条门面是同一条 fiber 上
			 * 提供给**预设侧**用的,而这条路由只是把同一个纯函数接到 HTTP 上——
			 * 中间多一跳服务解析,只会多一种「服务没接上」的失败模式。
			 */
			const projections = projectionsOf()
			const state = projections === undefined || typeof projections.stateOf !== 'function' ? null : projections.stateOf(session, 'clearai')
			if (state === null || state === undefined) return reply(200, { ok: true, found: false })
			const found = inspectGraphSelection(state, { kind: url.searchParams.get('kind') ?? '', id: url.searchParams.get('id') ?? '' }, derive(state))
			/** 找不到不是错误:那个对象可能刚被废止或本来就不在(如实说 `found: false`,不编一份空的)。 */
			if (found === null) return reply(200, { ok: true, found: false })
			return reply(200, { ok: true, found: true, inspector: found })
		})

	})

	ctx.effect(
		() =>
			ctx.provide('clearai', {
				/** 原始状态(工具做不变量判断用)。调用方不得修改。 */
				state: stateOf,
				/** 派生:阶段/完成度/假设状态,全部现算。 */
				derive: (sessionId) => derive(stateOf(sessionId)),
				/** 面板视图(与 wire 同一份,降级时一并交出席位健康事实)。 */
				view: viewOf,
				/** 运行态卡:注给模型的**事实**。 */
				renderCard: (sessionId) => renderCard(stateOf(sessionId)),
				/**
				 * 预演:把本次调用要落的变更先折一遍,好让工具返回的卡片是**这一步之后**的样子。
				 * 投影要到结果落账才前进,而工具在返回时就需要说清新状态——
				 * 与其在预设侧复制一份 fold,不如让 fold 的拥有者替它算。
				 */
				preview: (sessionId, mutations) => {
					/**
					 * 预演的是**这次调用返回之后**的样子:那时这次调用已经不在飞了。
					 * 不清掉 `inFlight`,交付自己的结果上就会写着「在等裁决」(等的正是它自己)。
					 */
					const next = applyMutations({ ...stateOf(sessionId), inFlight: null }, mutations)
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
					/**
					 * **递整份 state,不只递 lexicon**:断言的主体要能被指认(实例登记过)才算数,
					 * 而「登记过哪些实例」住在 `state.entities` 里。只递词汇的话,那条判据永远无从判断,
					 * 只能迁移期一律放行——那就等于没有这条判据。
					 */
					validateAssertions: (sessionId, assertions, options = {}) => validateAssertions(stateOf(sessionId), assertions, options),
					/**
					 * 货架正文。带 `mutations` 时按**这一步之后**的样子渲染——
					 * 工具在返回前就把货架写好,读的人不必等下一回合。
					 */
					renderShelf: (sessionId, mutations = []) => {
						const state = applyMutations(stateOf(sessionId), Array.isArray(mutations) ? mutations : [])
						const next = derive(state)
						// 在途命题也传进去:词汇刚立起来时「引用 0」会让人以为没人用,而断言已经在假设上了。
						// `view`:货架的「使用」一节与运行态卡 / 右栏读**同一份**叙述(单一叙述源)。
						return describeDomainShelf(state.lexicon, next.factRows, next.hypotheses, { view: knowledgeViewOf(state) })
					},
					/** 一条断言的一行人话(货架 / 卡片 / 查询共用同一句话,免得三处各写一套)。 */
					format: (sessionId, assertion) => formatAssertion(stateOf(sessionId).lexicon, assertion),
					/**
					 * **当前的图投影**(节点 / 边)。给内核用:谓词登记与 `Assert` 都要判
					 * 「这个类型是已登记的概念吗」——判据只有一份,就在这张投影里。只读,不落盘。
					 */
					graph: (sessionId) => graphProjection(stateOf(sessionId)),
				},
				/**
				 * **知识 Inspector**:一个选择 → 它的定义 / 关系 / 断言 / 证据链 / 历史。
				 *
				 * 组装住在纯函数里(`inspectGraphSelection`),这里只把当前状态喂给它——
				 * 客户端因此永远拿不到「自己拼链」的机会,凡是读到链的地方都同源。
				 */
				inspector: (sessionId, selection) => {
					const state = stateOf(sessionId)
					return inspectGraphSelection(state, selection, derive(state))
				},
			}),
		'clearai: read facade',
	)
}
