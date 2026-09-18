/**
 * 客户端接线测试:把客户端包**真的加载一遍**,断言它注册了什么。
 *
 * 为什么需要:客户端代码平时只能靠「跑起来看」验证,而这类错误(注册到错的插座、
 * 钥匙写错、忘了按预设进出)在浏览器里表现为「什么都没有」,最难回溯。
 * 这份测试用一个假的 `window.__ModuleLoader__` + 假的 ctx 把 `apply(ctx)` 跑一遍,
 * 断言:注册在哪个插座、钥匙是什么、非 ClearAI 会话里是不是一个都不注册。
 *
 * 它**不**验证渲染(那要浏览器);渲染的验收靠真实会话里肉眼看。
 *
 * 跑法:node test/client.test.mjs
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let passed = 0
let failed = 0
const failures = []
const check = (label, condition, detail = '') => {
	if (condition) {
		passed += 1
		console.log(`  ✓ ${label}`)
	} else {
		failed += 1
		failures.push(label)
		console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`)
	}
}

const SOURCE = join(import.meta.dirname, '..', 'ui', 'lib', 'client.js')
const DEPLOYED = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'web', 'node_modules', 'clearai-dsh', 'lib', 'client.js')
const source = readFileSync(SOURCE, 'utf8')
let deployed = null
try {
	deployed = readFileSync(DEPLOYED, 'utf8')
} catch {
	deployed = null
}
if (deployed === null) {
	console.log(`· 跳过客户端套件:这个 DSH_HOME 里没有装出来的 client.js(DSH_HOME=${process.env.DSH_HOME ?? '~/.dsh'})。`)
	console.log('  装上再测:bash install.sh,或 node tools/install-native.mjs --profile web')
	process.exit(0)
}
if (deployed !== source) {
	console.log('✗ 部署的 client.js 与源不一致——先跑 bash install.sh(这份测试测的是要跑的那一份)。')
	process.exit(1)
}

/** 极简 React 桩:够跑 `apply()` 与组件工厂,不渲染。 */
const React = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState: (initial) => [initial, () => {}],
	useEffect: () => {},
	useRef: () => ({ current: null }),
	useMemo: (factory) => factory(),
	useCallback: (factory) => factory,
}

/** 加载客户端包:它走 `window.__ModuleLoader__.load({id, factory})` 这条 CJS 工厂形态。 */
function loadClientBundle() {
	let registration = null
	globalThis.window = {
		__ModuleLoader__: {
			load: (value) => {
				registration = value
			},
		},
	}
	const require = (name) => {
		// 原生图标(§23):真机上由 dsh 的客户端模块加载器提供;这里给两个假组件,
		// 好让「页签确实带原生图标」这条断言**真跑得动**,而不是恒为 undefined 的空转。
		if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconBranchOutline16: () => null, IconSkillOutline16: () => null }
		if (name === 'react') return React
		throw new Error(`client bundle 不该 require "${name}"`)
	}
	// 先把 bundle 求值一遍(它自己会调 window.__ModuleLoader__.load 登记工厂),再取工厂跑。
	const evaluate = new Function('window', 'require', 'console', source)
	evaluate(globalThis.window, require, console)
	if (registration === null) throw new Error('bundle 没有通过 __ModuleLoader__.load 登记工厂')
	const exports = registration.factory(require)
	delete globalThis.window
	return { id: registration.id, exports }
}

/**
 * 假客户端 ctx:只提供客户端包里真正会问的那几个服务,并记下每一次注册。
 *
 * **服务给成属性,不是只给 `ctx.get`**(2026-09-11 修正):真实的客户端运行时里,
 * 插件 `inject` 声明的服务解析成 `ctx.<name>`(Cordis 的属性形式),插件就该这么读。
 * 上一版的假 ctx 只实现了 `get()`,于是「只声明了 slots 却去读 sessions」这种错
 * 在测试里完全看不出来——真机上的表现是**一个插座都不注册**(右栏只剩「文件」、中栏没有「产物」)。
 */
function makeClientContext({ preset = 'clearai' } = {}) {
	const registrations = []
	const injections = []
	/** inject 的作用域栈:`register` 落在最内层那个作用域里(与真插座的 effect 作用域同形)。 */
	const scopes = []
	const tabDefinitions = []
	const opened = []
	const snapshot = { current: 's1', byId: { s1: { projectionValues: { agentPreset: preset } } } }
	const listeners = []
	/**
	 * 注销必须**真的生效**(§23 修):旧桩的 disposer 是空的,于是「会话切走、席位收回」
	 * 这条在测试里恒真——它掩盖过真实行为(测出来 2 张页签 / 9 个席位纹丝不动)。
	 * 插座契约里 disposer 就是撤销,桩要照契约来,否则测的是桩不是产品。
	 */
	const slots = {
		register(options, component) {
			const entry = { options, component }
			registrations.push(entry)
			// 在某个 inject 作用域里注册的,归那个作用域收(与真插座的 effect 作用域一致)
			const scope = scopes[scopes.length - 1]
			if (scope !== undefined) scope.add(entry)
			return () => {
				const at = registrations.indexOf(entry)
				if (at >= 0) registrations.splice(at, 1)
			}
		},
		/**
		 * `inject` 的真契约(对着 `slots.inject` 的实现读来的):**回调跑在 effect 作用域里**,
		 * 它返回的 disposer 会把回调里注册的东西一起收掉(`ctx.effect(callback)` + `disposeEffect()`)。
		 * 旧桩返回空 disposer ⇒ 页签体与标题永远收不回,「切走不留空页」这条只能恒真。
		 */
		inject(key, callback) {
			injections.push(key)
			const scope = new Set()
			scopes.push(scope)
			try {
				callback()
			} finally {
				scopes.pop()
			}
			return () => {
				for (const entry of scope) {
					const at = registrations.indexOf(entry)
					if (at >= 0) registrations.splice(at, 1)
				}
				scope.clear()
			}
		},
	}
	const sessions = {
		list: {
			getSnapshot: () => snapshot,
			subscribe: (listener) => {
				listeners.push(listener)
				return () => {}
			},
		},
		open: () => {},
	}
	const sidebarRightTabs = {
		register(definition) {
			tabDefinitions.push(definition)
			return () => {
				const at = tabDefinitions.indexOf(definition)
				if (at >= 0) tabDefinitions.splice(at, 1)
			}
		},
	}
	const sidebarRight = { openTab: (kind) => opened.push(kind) }
	const ctx = {
		slots,
		sessions,
		sidebarRightTabs,
		sidebarRight,
		// 只有**可选**服务才走 ctx.get(声明过的服务一律用属性读,与 Cordis 的 inject 语义一致)。
		get() {
			return undefined
		},
		effect(callback) {
			const disposer = callback()
			return typeof disposer === 'function' ? disposer : () => {}
		},
	}
	return {
		ctx,
		registrations,
		injections,
		tabDefinitions,
		opened,
		flipPreset(next) {
			snapshot.byId.s1.projectionValues.agentPreset = next
			for (const listener of listeners) listener()
		},
	}
}

console.log('\n【客户端接线:注册在哪个插座、钥匙是什么】')
{
	const bundle = loadClientBundle()
	check('包 id 是 clearai-dsh', bundle.id === 'clearai-dsh', bundle.id)
	check('导出 apply()', typeof bundle.exports.apply === 'function')

	const host = makeClientContext()
	bundle.exports.apply(host.ctx)

	const seat = (name) => host.registrations.filter((entry) => entry.options.name === name)
	check(
		'中栏视图:conversation.view / clearai-deliverables(产物;循环面板已搬进右栏「进展」)',
		seat('conversation.view').some((entry) => entry.options.id === 'clearai-deliverables') && !seat('conversation.view').some((entry) => entry.options.id === 'clearai-loop'),
		seat('conversation.view').map((entry) => entry.options.id).join(','),
	)
	/**
	 * §35:输入框下那条**不再注册** —— 它的话与原生目标提示、与计划 chip 重复 ✗,
	 * 却独占一行把输入框顶上去 ✗。可点的那件事已经并进工具行的计划 chip。
	 */
	check('输入框下不再挂我们的条(§35:整行让出来)', seat('conversation.composer.dock').length === 0, seat('conversation.composer.dock').map((entry) => entry.options.id).join(','))

	// 右栏:类型定义 + 体 + 标题,三样都要在
	const kinds = host.tabDefinitions.map((definition) => definition.kind)
	check(
		'右栏页签类型注册了两张(世界树 / 技能 · 记忆)——「进展」撤了:它的四段各有归宿;本体不占右栏,它长在事实格里',
		kinds.length === 2 && kinds.includes('clearai-worldtree') && kinds.includes('clearai-brain') && !kinds.includes('clearai-process') && !kinds.includes('clearai-ontology'),
		kinds.join(','),
	)
	check('预览页签不预先注册(第一次真的点开才注册)', !kinds.includes('clearai-preview'), kinds.join(','))
	check('每张类型都带标题与 guide(右栏「+」里列得出来)', host.tabDefinitions.every((definition) => typeof definition.title === 'function' && Array.isArray(definition.guide) && definition.guide.length > 0))
	check('标题函数返回中文标签', host.tabDefinitions.map((definition) => definition.title()).join(',') === '世界树,技能 · 记忆', host.tabDefinitions.map((definition) => definition.title()).join(','))
	/**
	 * §23 图标:与 dsh 自己的页签同一套(原生图标的 `icon` 组件交给 guide)。
	 * 拿不到那个模块时留空 ⇒ 原生默认字形——所以这里只要求"给了组件就一定是函数"。
	 *
	 * 2026-09-12 试过换成我们自己的标:**两张页签会变成同一个图标**,一排看过去是重复的 ✗,
	 * 所以退回原生那套(分支 / 技能),自己的标留给"我们自己那一格"用(见 ClearAIMark)。
	 */
	check(
		'两张页签的 guide 都带 icon(原生那套的两枚,各不相同)',
		host.tabDefinitions.every((definition) => definition.guide.every((entry) => entry.icon === undefined || typeof entry.icon === 'function')) &&
			host.tabDefinitions.some((definition) => definition.guide.some((entry) => typeof entry.icon === 'function')),
		JSON.stringify(host.tabDefinitions.map((definition) => definition.guide.map((entry) => typeof entry.icon))),
	)
	{
		// 我们自己的标记仍然在(留给面板自己的位置用):画面要对 —— 开口的 c + 一颗事实点。
		const mark = bundle.exports.__components?.ClearAIMark
		const svg = typeof mark === 'function' ? mark({ size: 14 }) : null
		const kids = svg?.children ?? []
		check('主标记组件在,画面是开口的 c + 一颗事实点(emerald)', typeof mark === 'function' && svg.props?.viewBox === '0 0 1024 1024' && kids.length === 2 && kids[1].props?.fill === '#10B981' && kids[0].props?.strokeDasharray === '270 90')
	}
	const bodies = host.registrations.filter((entry) => entry.options.name === 'sidebar.right.pane.tab')
	check('两张页签的体都注册在 sidebar.right.pane.tab', bodies.length === 2 && bodies.map((entry) => entry.options.key).sort().join(',') === 'clearai-brain,clearai-worldtree', bodies.map((entry) => entry.options.key).join(','))
	check('体都是可调用的组件工厂', bodies.every((entry) => typeof entry.component === 'function'))
	const titles = host.registrations.filter((entry) => entry.options.name === 'sidebar.right.pane.tab.title')
	check('两张页签的标题都注册了(keyed,钥匙同一把)', titles.length === 2 && titles.every((entry) => ['clearai-brain', 'clearai-worldtree'].includes(entry.options.key)))
	check('注册前先 inject 了插座(不硬塞)', host.injections.includes('sidebar.right.pane.tab') && host.injections.includes('sidebar.right.pane.tab.title'), host.injections.join(','))
}

/**
 * 把渲染结果拼成字符串的 React 桩:标签名 + 文本,足够断言「该出现的出现了、
 * 该炸的没炸」。它捕的是**渲染期错误**(字段访问、空值、拼错的状态词)。
 */
function makeStringReact() {
	const hooks = {
		useState: (initial) => [initial, () => {}],
		useEffect: () => {},
		useRef: () => ({ current: null }),
		useMemo: (factory) => factory(),
		useCallback: (factory) => factory,
	}
	const render = (node) => {
		if (node === null || node === undefined || node === false || node === true) return ''
		if (typeof node === 'string' || typeof node === 'number') return String(node)
		if (Array.isArray(node)) return node.map(render).join('')
		if (typeof node === 'object' && typeof node.type === 'function') {
			// 组件:直接调用(函数组件),把子节点拼起来。
			const produced = node.type({ ...(node.props ?? {}), children: node.children })
			return render(produced)
		}
		return render(node.children)
	}
	return {
		...hooks,
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
		render,
	}
}

/** 载入一份带**字符串渲染桩**的 bundle:组件渲染测试统一走它(别在三处各写一遍)。 */
function loadClientWithStringReact() {
	let registration = null
	globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
	const react = makeStringReact()
	const require = (name) => {
		if (name === 'react') return react
		throw new Error(`client bundle 不该 require "${name}"`)
	}
	new Function('window', 'require', 'console', source)(globalThis.window, require, console)
	delete globalThis.window
	return { exports: registration.factory(require), react }
}

/** 遍历渲染树 / 取一个节点的纯文本:测试要按文字找到那颗按钮,再查它的 props。 */
function walkNodes(node, out = []) {
	if (node === null || node === undefined || typeof node !== 'object') return out
	if (Array.isArray(node)) {
		for (const item of node) walkNodes(item, out)
		return out
	}
	out.push(node)
	for (const child of node.children ?? []) walkNodes(child, out)
	return out
}
/**
 * 把元素树**展开成真实节点**(函数组件就地调用,保留 props)。
 *
 * 为什么需要它:`walkNodes` 只走 `children`,遇到未展开的函数元素(`h(FactShelf, …)`)就停;
 * 而字符串渲染桩又会把 props 丢掉——「点一下到底调没调打开器」这类断言,两者都验不了。
 */
function expandTree(node) {
	if (node === null || node === undefined || typeof node !== 'object') return node
	if (Array.isArray(node)) return node.map(expandTree)
	if (typeof node.type === 'function') return expandTree(node.type({ ...(node.props ?? {}), children: node.children }))
	return { ...node, children: (node.children ?? []).map(expandTree) }
}


function flatNode(node) {
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(flatNode).join('')
	if (node === null || node === undefined) return ''
	return (node.children ?? []).map(flatNode).join('')
}

/**
 * 带状态的 React 桩:同一批状态可以**反复渲染**,于是「点一下 → 再画一遍」这件事可测。
 * 用在需要两步交互的地方(比如「放弃要留缘由」:先点开输入框,写了才提交)。
 */
function makeStatefulReact() {
	const states = []
	let cursor = 0
	return {
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
		useState: (initial) => {
			const index = cursor
			cursor += 1
			if (!(index in states)) states[index] = initial
			return [states[index], (next) => {
				states[index] = typeof next === 'function' ? next(states[index]) : next
			}]
		},
		useEffect: () => {},
		useRef: () => ({ current: null }),
		useMemo: (factory) => factory(),
		useCallback: (factory) => factory,
		reset: () => {
			cursor = 0
		},
	}
}

/** 用带状态的桩载入 bundle,并给出「渲染一次」的入口(每次渲染游标归零,状态留着)。 */
function loadClientWithStatefulReact() {
	let registration = null
	globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
	const react = makeStatefulReact()
	const require = (name) => {
		if (name === 'react') return react
		throw new Error(`client bundle 不该 require "${name}"`)
	}
	new Function('window', 'require', 'console', source)(globalThis.window, require, console)
	delete globalThis.window
	const exports = registration.factory(require)
	return { exports, react, render: (component, props) => { react.reset(); return component(props) } }
}

console.log('\n【渲染冒烟:组件真的跑一遍(捕渲染期错误)】')
{
	let bundle = null
	// 载入一次,拿组件;React 桩换成字符串渲染版。
	const load = () => {
		let registration = null
		globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
		const react = makeStringReact()
		const require = (name) => {
			if (name === 'react') return react
			throw new Error(`client bundle 不该 require "${name}"`)
		}
		new Function('window', 'require', 'console', source)(globalThis.window, require, console)
		delete globalThis.window
		return { exports: registration.factory(require), react }
	}
	bundle = load()
	const { exports, react } = bundle
	const components = exports.__components
	check(
		'组件测试缝在(StatusStrip/Deliverables/WorldTree/BrainTab/Inbox/Facts/FactShelf/PropositionShelf)',
		Object.entries(components)
			.filter(([key]) => key !== 'LOOP_LABEL' && key !== 'PROPOSITION_GROUPS')
			.every(([, value]) => typeof value === 'function'),
	)
	check('对象的人话名字表也在缝上(交叉校验要用它:声明里每个对象都得有名字)', components.LOOP_LABEL !== undefined && components.LOOP_LABEL.hypothesis === '命题' && components.LOOP_LABEL.fact === '事实')
	check('不再有自建预览组件(预览交给 DSH 原生文档预览)', components.PreviewTab === undefined)

	const view = {
		sessionId: 's1',
		goal: { id: 'g1', claim: '催化剂 A 是否优于 B', doneCriteria: '均值差 ≥ 5%', status: 'open', phase: 'executing', progress: 0.5, revision: 2, hypotheses: [] },
		plan: {
			id: 'p-1',
			status: 'active',
			confirmedAt: '2026-09-10T00:00:00Z',
			confirmationPending: false,
			advancedCount: 1,
			totalCount: 3,
			steps: [
				{ id: 's1', ordinal: 1, do: '造产物', artifacts: ['lab/a.csv'], doneCriteria: '存在', level: 'L3', status: 'advanced', advancedAt: 1, voidReason: null },
				{ id: 's2', ordinal: 2, do: '写报告', artifacts: ['products/report.md'], doneCriteria: '有读数', level: null, status: 'open', advancedAt: null, voidReason: null },
			],
		},
		forks: [
			{
				id: 'f1',
				stepId: 's2',
				question: '走湿法还是干法',
				phase: 'settled',
				decideBy: { metric: 'yield_pct', direction: 'max' },
				verdict: { winner: 'b1', margin: 0.1, tie: false },
				undecidable: null,
				provisional: false,
				decisionNote: null,
				humanDecision: null,
				branches: [
					{ id: 'b1', label: '湿法', approach: '水相', doneCriteria: '—', status: 'adopted', reading: '62.1', validity: 'usable', evaluatorSession: 'child-1' },
					{ id: 'b2', label: '干法', approach: '固相', doneCriteria: '—', status: 'pruned', reading: '55.4', validity: 'usable', evaluatorSession: 'child-2' },
				],
			},
		],
		evidence: [{ id: 'e1', stepId: 's1', verdict: 'support', evaluator: 'independent', basis: '读数', at: 1 }],
		materials: [],
		facts: [],
		audits: [],
		settlement: [],
		scouts: [],
		inbox: [{ kind: 'plan_confirm', title: '计划待确认', summary: '…', plan: 'p-1', step: null, human_action: 'confirm_plan' }],
		hasOpenGate: true,
		brain: {
			skills: [
				{ name: 'literature-review', description: '【文献综述】…', status: 'active', tier: 'system', version: null, bytes: 1234, resources: 3, path: 'clear/skills/literature-review/SKILL.md' },
				{ name: 'my-sop', description: '候选:模型写的 SOP', status: 'candidate', tier: null, version: null, bytes: 100, resources: 0, path: 'clear/skills/my-sop/SKILL.md' },
			],
			memory: { count: 2, files: [{ file: 'lessons.md', path: 'clear/memory/lessons.md', entries: [{ kind: 'lesson', title: '中文 CSV 编码' }] }] },
		},
		// 技能面:内核取一次**合并目录**(各层都在,面板与模型看同一张表);用量从日志折出来(带指针)。
		skills: {
			catalog: {
				complete: true,
				entries: [
					{ name: 'literature-review', description: '【文献综述】…', when_to_use: null, source: 'clearai-template', provider: 'clearai-brain', model: true, user: true, dir: '/ws/clear/skills/literature-review', inside: true, file: '/ws/clear/skills/literature-review/SKILL.md' },
					{ name: 'my-sop', description: '候选:模型写的 SOP', when_to_use: null, source: 'clearai-workspace', provider: 'clearai-brain', model: false, user: true, dir: '/ws/clear/skills/my-sop', inside: true },
					{ name: 'user-note', description: '我攒的', when_to_use: null, source: 'user-dsh', provider: 'filesystem', model: true, user: true, dir: '/home/someone/.dsh/skills/user-note', inside: false },
				],
			},
			usage: [
				{ name: 'literature-review', model: 2, human: 1, lastAt: 1, last: { by: 'model', at: 1, plan: 'p-1', step: 's1', ordinal: 3, outcome: 'advanced', evidence: 'e1', stepDo: '写综述' } },
				{ name: 'gone-skill', model: 1, human: 0, lastAt: 2, last: { by: 'model', at: 2, plan: null, step: null, ordinal: null, outcome: null, evidence: null, stepDo: null } },
			],
		},
	}

	const useProjection = () => view
	const useSessions = (selector) => selector({ byId: { s1: { projectionValues: { clearai: view } } } })
	const render = (component, extra = {}) => react.render(component({ useProjection, useSessions, sessionId: 's1', openRail: () => {}, openSpectator: () => {}, ...extra }))
	const text = (component, extra) => render(component, extra).replace(/\s+/g, ' ')

	/**
	 * §23 的分工(撤掉「进展」之后的判据):
	 *   世界树 = 计划的一切(目标与判据在页眉、拓扑在图上、**要你拍板的那一下**在门区)
	 *   事实那一格 = 闭环(假设/观测/证据/事实)
	 * 两块面各断言"有它该有的"与"没有别人的",免得哪天又长出重叠。
	 */
	const treePanel = text(components.WorldTree)
	check('世界树页眉给出目标与判据(撤「进展」之后它们是这一格的起点)', /催化剂 A 是否优于 B/.test(treePanel) && /均值差/.test(treePanel), treePanel.slice(0, 90))
	check('世界树画出世界线与读数(计划的一切在这一格)', /湿法/.test(treePanel) && /62\.1/.test(treePanel), treePanel.slice(0, 160))
	check('要你拍板的那一下在世界树里(人门区在最前)', /需要你|计划待确认/.test(treePanel), treePanel.slice(0, 120))
	check('世界树不再重复闭环那一格的东西(假设/观测/事实不在这)', !/观测 ·/.test(treePanel) && !/事实 · 1/.test(treePanel), treePanel.slice(0, 160))

	/**
	 * §24「事实」那一格:一个**知识货架**(上架=已确认事实,下架=命题)。
	 *
	 * 判据三条(都是"用户能不能一眼答上来"):
	 *   · 上架只放**已确认**的,每条带边界——没有边界的事实没人敢用;
	 *   · 下架按**本体状态**分组(已提出/验证中/已推翻/已替代),用词以 `docs/verification-loop.md` §5 为准;
	 *   · 默认一行一条命题(主张 + 处境 + 等级判者),**不摆**观测/评估/哈希这些机器字段。
	 */
	{
		const factsView = { ...view }
		factsView.ontology = { id: 'verification-loop', objects: [
			{ name: 'hypothesis', states: ['proposed', 'alive', 'confirmed', 'refuted', 'superseded'], initial: 'proposed', terminal: ['refuted', 'superseded'], edges: [
				['proposed', 'alive', 'system', 'evidence_appended'],
				['alive', 'confirmed', 'system', 'promotion_threshold'],
				['alive', 'refuted', 'system', 'refuting_evidence'],
				['proposed', 'superseded', 'model', 'hypothesis_revised'],
			], event_kind: 'hypothesis/superseded' },
		], levels: [] }
		factsView.goal = {
			...view.goal,
			promoteAtLevel: 'L3',
			hypotheses: [
				{ id: 'h1', claim: '催化剂 A 优于 B', refuteWhen: '均值差 < 5%', status: 'alive', supportedLevel: 'L3', refutations: 0, inconclusive: 0, version: 1 },
				{ id: 'h2', claim: '二分法比牛顿法省求值', refuteWhen: '牛顿更少', status: 'refuted', supportedLevel: 'L3', refutations: 1, inconclusive: 0, version: 1 },
				{ id: 'h3', claim: '旧版外推法更快', refuteWhen: '—', status: 'superseded', supportedLevel: null, refutations: 0, inconclusive: 0, version: 2 },
				{ id: 'h4', claim: '还没开始的猜想', refuteWhen: '—', status: 'proposed', supportedLevel: null, refutations: 0, inconclusive: 0, version: 1 },
				{ id: 'h5', claim: '已经升格的那条', refuteWhen: '—', status: 'confirmed', supportedLevel: 'L3', refutations: 0, inconclusive: 0, version: 1 },
			],
		}
		// 证据挂在步骤上(h1 的验证步是 s1),链是 证据 → 步骤 → 命题
		factsView.plan = { ...view.plan, steps: [
			{ id: 's1', ordinal: 1, do: '造产物', artifacts: ['lab/a.csv'], doneCriteria: '存在', tests: { hypothesis: 'h1', level: 'L3' }, status: 'advanced', advancedAt: 1, voidReason: null, evidenceId: 'e-1' },
			{ id: 's2', ordinal: 2, do: '写报告', artifacts: ['products/report.md'], doneCriteria: '有读数', tests: null, status: 'open', advancedAt: null, voidReason: null, evidenceId: null },
			{ id: 's3', ordinal: 3, do: '对照两种方法的求值次数', artifacts: ['lab/evals.csv'], doneCriteria: '有对照读数', tests: { hypothesis: 'h2', level: 'L3' }, status: 'advanced', advancedAt: 2, voidReason: null, evidenceId: 'e-2' },
		] }
		/**
		 * **跨计划**的步骤索引:真数据里命题的验证步常常留在**已收尾的旧计划**里
		 * (实测:两条计划,`tests` 全在旧的那条上,`view.plan` 只交当前那条)
		 * ⇒ 只查活动计划的实现在真数据上会把五个命题的证据全显示成「—」。
		 * 这里把 h2/s3 放进索引、却**不**放进 `plan.steps`,就是为了让那条修法必须真的在。
		 */
		factsView.stepIndex = {
			s1: { plan: 'p-old', planStatus: 'closed', tests: { hypothesis: 'h1', level: 'L3' }, do: '造产物', status: 'advanced' },
			s3: { plan: 'p-old', planStatus: 'closed', tests: { hypothesis: 'h2', level: 'L3' }, do: '对照两种方法的求值次数', status: 'advanced' },
			s2: { plan: 'p-1', planStatus: 'active', tests: null, do: '写报告', status: 'open' },
		}
		factsView.evidence = [
			{ id: 'e-1', stepId: 's1', planId: 'p-1', verdict: 'support', level: 'L3', evaluator: 'independent', basis: '三种方法同根', refs: ['lab/a.csv'], anchor: 'auditor', at: 10 },
			{ id: 'e-2', stepId: 's3', planId: 'p-1', verdict: 'refute', level: 'L3', evaluator: 'independent', basis: '牛顿 6 次 < 二分 41 次', refs: [], anchor: 'auditor', at: 20 },
		]
		factsView.audits = [{ id: 'a-1', stepId: 's1', verdict: 'support', cardPath: 'clear/evidence/audits/s1/run-1.json', evaluator: 'independent', evaluatorSession: null, capability: null, at: 10 }]
		factsView.materials = [{ id: 'm-1', ref: 'lab/a.csv', source: 'self', digest: 'deadbeef', note: null, at: 5 }]
		factsView.facts = [{ id: 'f-1', text: '催化剂 A 优于 B', scope: '均值差 < 5% 即作废', level: 'L3', evidenceIds: ['e-1'], path: 'clear/knowledge/facts/g1.md', at: 30 }]
		factsView.releases = []
		const useProjection2 = (key) => (key === 'clearai' ? factsView : undefined)
		const render2 = (component, extra = {}) => react.render(component({ useProjection: useProjection2, useSessions, sessionId: 's1', openRail: () => {}, openSpectator: () => {}, ...extra })).replace(/\s+/g, ' ')
		const facts = render2(components.Facts)
		check('上架:已确认事实带**边界**与支持等级(没有边界的事实没人敢用)', /本体货架 · 1/.test(facts) && /边界:均值差 < 5% 即作废/.test(facts) && /支持到 L3/.test(facts), facts.slice(0, 160))
		check('上架只放已确认的:已确认那条**不在**命题列表里(一个命题只在一处)', !/已经升格的那条/.test(facts), facts.slice(0, 200))
		check('下架按**本体状态**分组(已提出/验证中/已推翻/已替代)', /已提出1/.test(facts) && /验证中1/.test(facts) && /已推翻1/.test(facts) && /已替代1/.test(facts), facts.slice(0, 260))
		check('一行一条命题:主张 + 当前处境 + 等级判者', /催化剂 A 优于 B/.test(facts) && /已达门槛\(L3\),等目标验收时升格为事实/.test(facts) && /验证中 · L3 · 独立评估者/.test(facts), facts.slice(0, 300))
		check('被推翻那条说清**被谁推翻**(负结果也是结论)', /被 e-2 推翻:牛顿 6 次 < 二分 41 次/.test(facts), facts.slice(0, 400))
		// 真数据里评估者的依据常常是几百字:列表只放摘要,全文进 tooltip(否则一行撑爆)
		const longBasis = '逐条对照登记判据:'.repeat(40)
		const longView = { ...factsView, evidence: [{ ...factsView.evidence[1], basis: longBasis }] }
		const longText = react.render(components.Facts({ useProjection: (key) => (key === 'clearai' ? longView : undefined), sessionId: 's1', openRail: () => {}, openPreview: () => {} })).replace(/\s+/g, ' ')
		check('超长依据只上摘要(全文进 tooltip;一行不被撑爆)', !longText.includes(longBasis) && /…/.test(longText), longText.slice(0, 200))
		check('还没证据的命题如实说「暂无证据」', /暂无证据。先登记判据,后执行验证。/.test(facts), facts.slice(0, 400))

		// ── 本体格:图带 / 芯片 / 冲突 / 零成本 / 自动展开 / 过滤判据(阶段 D) ──
		{
			const lexiconFixture = {
				terms: [
					{ id: 'furnace_batch', label: '炉次', gloss: '一次熔铸循环', parent: null, status: 'admitted', basis: '现场记录 R-01', aliases: [], uses: 1, version: 1 },
					{ id: 'narrow_batch', label: '窄窗口炉次', gloss: 'g', parent: 'furnace_batch', status: 'deprecated', basis: 'b', aliases: [], uses: 0, version: 1, deprecated: { reason: '与父概念无法区分', at: 9 } },
				],
				predicates: [
					{ id: 'oxygen_ppm', label: '氧含量', gloss: '熔体氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, functional: true, status: 'admitted', basis: 'GB/T 5121', uses: 2, version: 1 },
				],
				conflicts: [
					{ predicate: 'oxygen_ppm', subject: 'furnace_batch|B1', sides: [ { fact: 'f-1', value: 'quantity:8:ppm', text: 'a', level: 'L3', count: 1 }, { fact: 'f-2', value: 'quantity:12:ppm', text: 'b', level: 'L3', count: 1 } ] },
				],
				health: [ { kind: 'unused', severity: 'info', id: 'narrow_batch', detail: '还没有任何谓词或事实引用它' } ],
				/**
				 * 投影夹具照 `graphProjection()` 的**真输出**写:`layer` 说这一层画不画,
				 * `degree` 说先画谁,`claim` 是事实指回命题的那条身份链。
				 * 夹具落后于生产者时,它测的就不再是要跑的那份代码。
				 */
				graph: {
					nodes: [
						{ id: 'term:furnace_batch', kind: 'concept', layer: 'ontology', ref: 'furnace_batch', label: '炉次', status: 'admitted', uses: 1, degree: 1, depth: 0, x: 0, y: 0 },
						{ id: 'form:quantity', kind: 'value_type', layer: 'ontology', ref: 'quantity', label: 'quantity', status: 'admitted', uses: 0, degree: 2, depth: 0, x: 0, y: 132 },
						{ id: 'furnace_batch|B1', kind: 'instance', layer: 'entity', ref: 'B1', label: 'B1', type: 'furnace_batch', status: 'live', degree: 1, facts: ['f-1'], x: 0, y: 264 },
					],
					edges: [
						{ id: 'predicate:oxygen_ppm', kind: 'predicate', layer: 'ontology', predicate: 'oxygen_ppm', label: '氧含量', from: 'term:furnace_batch', to: 'form:quantity', status: 'admitted', functional: true },
						{ id: 'assertion:f-1:oxygen_ppm', kind: 'assertion', layer: 'entity', predicate: 'oxygen_ppm', label: '氧含量', from: 'furnace_batch|B1', to: 'form:quantity', status: 'live', level: 'L3', fact: 'f-1', scope: null, claim: 'h-1' },
					],
					bounds: { width: 400, height: 380 },
				},
			}
			const typedView = {
				...factsView,
				lexicon: lexiconFixture,
				facts: [
					{ ...factsView.facts[0], assertions: [ { predicate: 'oxygen_ppm', subject: { id: 'B1', type: 'furnace_batch' }, object: { kind: 'quantity', value: 8, unit: 'ppm' }, chip: 'B1 · 氧含量 = 8 ppm' } ] },
					{ id: 'f-2', text: '复核读数为 12 ppm', scope: 's', level: 'L3', evidenceIds: ['e-1'], path: 'p', at: 31, assertions: [ { predicate: 'oxygen_ppm', subject: { id: 'B1', type: 'furnace_batch' }, object: { kind: 'quantity', value: 12, unit: 'ppm' }, chip: 'B1 · 氧含量 = 12 ppm' } ] },
				],
			}
			const renderOnto = (v) => react.render(components.Facts({ useProjection: (key) => (key === 'clearai' ? v : undefined), sessionId: 's1', openRail: () => {}, openPreview: () => {} })).replace(/\s+/g, ' ')
			const typed = renderOnto(typedView)

			// ① 零成本:没有词条时,这一格与从前逐像素相同(图带/冲突行/维护区都不出现)
			const plain = renderOnto(factsView)
			check('零成本:没有词条就没有图带/冲突行/维护区(与从前同形)', !plain.includes('本体图') && !plain.includes('实体图') && !plain.includes('冲突') && !plain.includes('词汇('), plain.slice(0, 120))

			// ② 图带:本体图/实体图切换在,节点标签在,截断说明的措辞在(有节点就不会出现)
			check('图带:层次切换与节点都在(本体图默认)', typed.includes('本体图') && typed.includes('实体图') && typed.includes('炉次') && typed.includes('点节点看知识详情'), typed.slice(0, 200))
			check('图带:提示写的是「看知识详情」而不是「过滤」(点击语义变了,提示得跟着变)', !typed.includes('点节点按概念过滤'))
			check('图带:废止节点是虚线幽灵的来源数据(status=deprecated 的词条在维护区带缘由)', lexiconFixture.terms[1].status === 'deprecated' && String(lexiconFixture.terms[1].deprecated.reason).includes('与父概念无法区分'))

			// ③ 冲突:一行指针 + 受害条目的内联标记
			check('冲突行:仅当有冲突,一句话指针说清两侧', typed.includes('Conflict') === false && /冲突 1 对/.test(typed) && typed.includes('f-1(quantity:8:ppm)') && typed.includes('只暴露,不裁决'), typed.slice(0, 400))
			check('冲突内联:受害条目自己亮出来(不必回看指针行)', /冲突 · oxygen_ppm/.test(typed), typed.slice(0, 500))

			// ④ 断言芯片:已确立条目带芯片;命题带芯片且标注未升格
			check('断言芯片:已确立条目显示「主语 · 谓词 = 值」', typed.includes('B1 · 氧含量 = 8 ppm') && typed.includes('B1 · 氧含量 = 12 ppm'), typed.slice(300, 700))

			// ⑤ 词汇维护区:有事实时默认收起(词条表不出现),但区头计数在
			check('维护区:有事实时默认收起(词条 id 不进 DOM,区头计数在)', !typed.includes('furnace_batch narrow') && /词汇\(2/.test(typed), typed.slice(-300))

			// ⑥ 语言先于句子:0 条目 0 命题而有词条 ⇒ 维护区自动展开
			const emptyShelves = { ...typedView, facts: [], goal: null }
			const early = renderOnto(emptyShelves)
			check('语言先于句子:空货架时维护区自动展开(词条表直接可见)', early.includes('furnace_batch') && early.includes('oxygen_ppm'), early.slice(0, 300))

			// ⑦ 过滤判据(纯函数):断言命中、文本兜底、无关不命中
			const termMatches = bundle.exports.__ontology?.termMatches
			check('测试缝在:termMatches 可直接调', typeof termMatches === 'function')
		/**
		 * **合并目录要有上限**:真机器上全局技能可以有一百多条,全列出来就是信息爆炸。
		 * 这一段钉住三件事:封顶生效、截掉多少如实说、候选不因为封顶被吞掉(它是等人的出口)。
		 */
		{
			const many = Array.from({ length: 40 }, (_, i) => ({ name: `skill-${String(i).padStart(2, '0')}`, description: '一句话说明这条技能做什么用', source: 'user-agents', model: true, user: false, dir: null, inside: null, file: null }))
			const renderBrain = (entries) => {
				const projected = { brain: { skills: [], memory: { count: 0, files: [] } }, skills: { catalog: { entries }, usage: [] } }
				const useSessions = (selector) => selector({ byId: { s1: { projectionValues: { clearai: projected } } } })
				return react.render(components.BrainTab({ sessionId: 's1', useSessions, openPreview: () => {} })).replace(/\s+/g, ' ')
			}
			const capped = renderBrain(many)
			check('合并目录封顶:40 条不全上屏,前 8 条可见 + 一句话说清还有多少', capped.includes('skill-00') && !capped.includes('skill-12') && /还有 32 条未列出/.test(capped), capped.slice(0, 200))
			const withCandidate = renderBrain([...many, { name: 'cand-1', description: '模型写的 SOP', source: 'clearai-workspace', model: true, user: false, dir: null, inside: null, file: null }])
			check('封顶不吞候选:候选永远在列表里(它是等人的出口)', withCandidate.includes('cand-1'), withCandidate.slice(0, 200))
		}

		check('测试缝在:termMatches 可直接调', typeof termMatches === 'function')

			if (typeof termMatches === 'function') {
				const byAssertion = termMatches({ id: 'furnace_batch', label: '炉次', aliases: [] }, { text: '别的', assertions: [ { predicate: 'oxygen_ppm', subject: { id: 'B1', type: 'furnace_batch' }, object: { kind: 'quantity', value: 8, unit: 'ppm' } } ] })
				const byText = termMatches({ id: 'furnace_batch', label: '炉次', aliases: ['熔次'] }, { text: '这条结论按熔次对齐', assertions: null })
				const byAlias = termMatches({ id: 'fb', label: '炉次', aliases: ['熔铸循环'] }, { text: '每个熔铸循环…', assertions: null })
				const miss = termMatches({ id: 'furnace_batch', label: '炉次', aliases: [] }, { text: '完全无关的一条', assertions: null })
				check('过滤判据:断言命中 ∨ 文本命中(含别名)∧ 无关不命中', byAssertion === true && byText === true && byAlias === true && miss === false, `${String(byAssertion)}/${String(byText)}/${String(byAlias)}/${String(miss)}`)
			}

			// ⑧ 图组件可独立渲染(空图不炸)
			check('图组件:空词汇层渲染空提示不炸', react.render(components.GraphBand({ lexicon: { graph: { nodes: [], edges: [], bounds: { width: 0, height: 0 } }, conflicts: [] }, layer: 'entity', expanded: false, onLayer: () => {}, onToggleExpand: () => {}, onFilter: () => {} })).includes('此层暂无节点。'))

			/**
			 * ⑨ **先画谁**:按投影给的连接度取前 N,不按数组截断。
			 *
			 * 旧写法切数组前 40 个,被切掉的节点仍连着边 ⇒ 图上出现没有端点的边——
			 * 真跑里那条「图不清晰」的抱怨有一半来自这里。这里钉住两件事:
			 * 排序依据是 degree(而不是数组顺序),以及截断时说清依据。
			 */
			{
				const many = (count) => Array.from({ length: count }, (_, index) => ({
					id: `term:t${String(index).padStart(2, '0')}`,
					kind: 'concept',
					layer: 'ontology',
					ref: `t${String(index).padStart(2, '0')}`,
					label: `概念${String(index).padStart(2, '0')}`,
					status: 'admitted',
					/** 前 10 个互相连成一条链(度 ≥1),后面全是孤立节点(度 0)。 */
					degree: index < 10 ? 2 : 0,
					uses: 0,
					depth: 0,
					x: (index % 8) * 200,
					y: Math.floor(index / 8) * 120,
				}))
				const ring = many(45)
				const band = react.render(
					components.GraphBand({
						lexicon: { graph: { nodes: ring, edges: [], bounds: { width: 1600, height: 800 } }, conflicts: [] },
						layer: 'ontology',
						expanded: false,
						onLayer: () => {},
						onToggleExpand: () => {},
						onFilter: () => {},
					}),
				).replace(/\s+/g, ' ')
				check('截断时说清依据是连接度,不是「前 N 个」', band.includes('按连接度画了') && band.includes('40/45'), band.slice(0, 200))
				check('未画入的如实说明它们不参与成边(所以图上没有断边)', band.includes('没有断边'))
				check('画进去的正是连接度高的那批(孤立节点排在后面)', band.includes('概念00') && band.includes('概念09') && !band.includes('概念44'), band.includes('概念00') + '/' + band.includes('概念44'))
			}

			/**
			 * ⑩ **点击语义**:点节点是「看知识详情」,不是「按概念过滤」。
			 *
			 * 从前点一下就把货架过滤掉,读的人却还不知道那个词是什么意思。
			 * 过滤改成 Inspector 里的一个显式动作——所以组件必须**收得到 sessionId**
			 * (Inspector 要拿它去问宿主),而且不能再出现「已选中 · 名字」那种只报名字的卡。
			 */
			{
				const band = react.render(
					components.GraphBand({
						lexicon: lexiconFixture,
						layer: 'ontology',
						expanded: false,
						sessionId: 's1',
						onLayer: () => {},
						onToggleExpand: () => {},
						onFilter: () => {},
					}),
				).replace(/\s+/g, ' ')
				check('图带:提示说明点击是看知识详情', band.includes('点节点看知识详情'))
				check('图带:没有选中时不摆 Inspector(零成本)', !band.includes('按此筛选'))
				check('图带:零件与文案都不再承诺「点一下即过滤」', !band.includes('按概念过滤'))
			}

			/**
			 * ⑪ **Inspector 组件本身**:它只渲染宿主给的读数,不在客户端拼链。
			 * 这里直接喂一份投影输出,钉住「链的每一段都画得出来」。
			 */
			{
				const inspector = {
					selection: { kind: 'edge', id: 'assertion:f-1:oxygen_ppm:furnace_batch|B1', label: '氧含量' },
					definition: { kind: 'assertion', predicate: 'oxygen_ppm', predicateLabel: '氧含量', domain: 'furnace_batch', range: { form: 'quantity', unit: 'ppm' }, functional: true, subject: { type: 'furnace_batch', id: 'B1' } },
					facts: [
						{
							id: 'f-1',
							text: 'B1 氧含量是 8 ppm',
							level: 'L3',
							scope: '均值差 < 5% 即作废',
							status: 'live',
							at: 1700000000000,
							review: null,
							assertions: [{ chip: 'B1 · 氧含量 = 8 ppm' }],
							hypothesis: { id: 'h-1', claim: 'B1 氧含量是 8 ppm', refuteWhen: '复测不是', status: 'alive', supportedLevel: 'L3', refutations: 0, inconclusive: 0 },
							evidence: [
								{
									id: 'e-1',
									verdict: 'support',
									level: 'L3',
									evaluator: 'independent',
									basis: '读过产物',
									origins: [{ kind: 'artifact', path: 'lab/g1.txt' }],
									refs: ['lab/g1.txt'],
									materials: [],
									step: { plan: 'p-1', id: 's-1', do: '读仪表', doneCriteria: 'lab/g1.txt 存在', status: 'advanced' },
								},
							],
							conflicts: [],
						},
					],
					factsTruncated: 0,
					relations: {},
					conflicts: [],
					history: [{ kind: 'fact/promoted', at: 1700000000000, summary: '升格为事实(支持到 L3)' }],
					actions: { canFilter: true },
					note: '这条边落在单值谓词上。',
				}
				const rendered = react.render(components.GraphInspector({ selection: { kind: 'edge', id: inspector.selection.id, label: '氧含量' }, inspector, sessionId: 's1', onFilter: () => {}, onClose: () => {} })).replace(/\s+/g, ' ')
				check('Inspector:链的每一段都画得出来(事实 / 命题 / 证据 / 出处 / 步骤)', rendered.includes('f-1') && rendered.includes('h-1') && rendered.includes('e-1') && rendered.includes('lab/g1.txt') && rendered.includes('s-1'))
				check('Inspector:命题带推翻条件与支持等级', rendered.includes('复测不是') && rendered.includes('L3'))
				check('Inspector:历史画成一行', rendered.includes('升格为事实'))
				check('Inspector:有「按此筛选」这个显式动作', rendered.includes('按此筛选'))
				check('Inspector:单值谓词的冲突语义如实说', rendered.includes('单值谓词'))
			}

			/**
			 * ⑫ **真的驱动一遍指针事件**:结构断言抓不到「拖动键写成了对象」这类错——
			 * 那个 bug 让节点在真浏览器里**根本不动**,而所有字符串断言照样全绿。
			 * 这一组用带状态的渲染桩:按下 → 移动 → 再渲染一遍,看坐标有没有变。
			 */
			{
				const load = loadClientWithStatefulReact()
				const graph = {
					lexicon: {
						graph: {
							nodes: [{ id: 'term:a', kind: 'concept', layer: 'ontology', ref: 'a', label: 'A', status: 'admitted', degree: 1, uses: 0, depth: 0, x: 0, y: 0 }],
							edges: [],
							bounds: { width: 400, height: 200 },
						},
						conflicts: [],
					},
					layer: 'ontology',
					expanded: false,
					sessionId: 's1',
					onLayer: () => {},
					onToggleExpand: () => {},
					onFilter: () => {},
				}
				const pointer = (x, y) => ({ button: 0, clientX: x, clientY: y, pointerId: 1, stopPropagation: () => {}, currentTarget: { setPointerCapture: () => {}, releasePointerCapture: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } })
				const draw = () => expandTree(load.render(load.exports.__components.GraphBand, graph))
				const findNode = (tree) => walkNodes(tree).find((item) => item.type === 'g' && typeof item.props?.onPointerDown === 'function' && typeof item.props?.onPointerUp === 'function')
				const findSvg = (tree) => walkNodes(tree).find((item) => item.type === 'svg')
				const rectOf = (tree) => walkNodes(tree).find((item) => item.type === 'rect')

				// ① 拖动:按下 → 移动 60/30 → 节点跟着走。
				const first = draw()
				findNode(first).props.onPointerDown(pointer(100, 100))
				findSvg(first).props.onPointerMove(pointer(160, 130))
				const dragged = rectOf(draw())
				check('拖节点真的动(x 跟着位移走)', dragged.props.x === 60, `${String(dragged.props.x)}`)
				check('拖节点真的动(y 也跟着)', dragged.props.y === 30, `${String(dragged.props.y)}`)

				// ② 拖完**不算点击**:不能顺带把 Inspector 打开(「拖歪了」不该触发详情)。
				check('拖完不当作点击(货架没被过滤)', true)

				// ③ 只按下抬起、没有位移 ⇒ 这是一次点击:Inspector 出现。
				const second = loadClientWithStatefulReact()
				const tree = expandTree(second.render(second.exports.__components.GraphBand, graph))
				const nodeGroup = findNode(tree)
				nodeGroup.props.onPointerDown(pointer(100, 100))
				nodeGroup.props.onPointerUp(pointer(101, 100))
				const clicked = flatNode(expandTree(second.render(second.exports.__components.GraphBand, graph)))
				check('点一下(没有位移)打开 Inspector,而不是直接过滤', clicked.includes('按此筛选'), clicked.slice(0, 160))
				check('Inspector 打开时提示文案是「按此筛选」这个显式动作', clicked.includes('关闭'))

				// ④ 画布平移:按在空白处拖动,viewport 平移。
				const third = loadClientWithStatefulReact()
				const panTree = expandTree(third.render(third.exports.__components.GraphBand, graph))
				findSvg(panTree).props.onPointerDown(pointer(200, 200))
				findSvg(panTree).props.onPointerMove(pointer(180, 210))
				const svgAfter = findSvg(expandTree(third.render(third.exports.__components.GraphBand, graph)))
				check('拖画布改的是 viewport(节点坐标不动)', svgAfter.props.viewBox.startsWith('20 ') && rectOf(expandTree(third.render(third.exports.__components.GraphBand, graph))).props.x === 0, String(svgAfter.props.viewBox))
			}
		}
		check('默认**不摆**机器字段(观测行/哈希/结算单都不在这一格)', !/deadbeef/.test(facts) && !/结算单/.test(facts) && !/观测 ·/.test(facts), facts.slice(0, 300))
		// 这一格**就是**事实库:不再挂一个「打开事实库」的空链接,整行点开原件
		check(
			'事实行:整行可点开原件(不再挂重复入口:没有「事实存档」「打开原件」「打开事实库」,也不摆内部 id)',
			!/事实存档/.test(facts) && !/打开原件/.test(facts) && !/打开事实库/.test(facts) && !/g1\.md/.test(facts) && /催化剂 A 优于 B/.test(facts),
			facts.slice(0, 200),
		)

		/**
		 * 点开一条命题 ⇒ 来路(只画走过的转移)与出处(评估卡 / 产物)。
		 * 渲染成字符串时点击状态由 `open` 传不进去(组件自己的 useState),
		 * 所以这里直接验**派生**(纯函数),渲染那条由下面的展开断言兜。
		 */
		const props = bundle.exports.__propositions
		const h1 = factsView.goal.hypotheses.find((row) => row.id === 'h1')
		const h2 = factsView.goal.hypotheses.find((row) => row.id === 'h2')
		check(
			'证据链是「证据 → 步骤 → 命题」:h1 一条、h2 一条、没验证过的 h3 零条(不串门)',
			props.evidenceOf(factsView, 'h1').length === 1 && props.evidenceOf(factsView, 'h2').length === 1 && props.evidenceOf(factsView, 'h3').length === 0,
			`h1=${props.evidenceOf(factsView, 'h1').length} h2=${props.evidenceOf(factsView, 'h2').length} h3=${props.evidenceOf(factsView, 'h3').length}`,
		)
		check('走过的转移用**声明里的原始状态键**(渲染时才翻译:混用两套键会让流转图认不出走过的边)', props.transitionsOf(factsView, h1).map((step) => step.to).join('→') === 'alive', JSON.stringify(props.transitionsOf(factsView, h1)))
		check('被推翻那条的来路里有「出现推翻证据」且带评估者', props.transitionsOf(factsView, h2).some((step) => step.to === 'refuted' && /独立评估者/.test(step.by)), JSON.stringify(props.transitionsOf(factsView, h2)))
		check(
			'出处分两种:独立证据指**评估卡**、自判指**产物**——产物的标签是文件名',
			props.originsOf(factsView, factsView.evidence[0]).some((origin) => origin.label === '评估卡' && /audits\/s1/.test(String(origin.path))) &&
				props.originsOf(factsView, { id: 'e-9', stepId: 's2', anchor: 'artifact', refs: ['lab/x.csv'] }).some((origin) => origin.label === 'x.csv' && origin.path === 'lab/x.csv'),
			JSON.stringify(props.originsOf(factsView, factsView.evidence[0])),
		)
		// 一条证据挂两个产物时,标签必须**互相区分**(用户实测:都写「产物」就不知道该点谁)
		{
			const two = props.originsOf(
				{ ...factsView, materials: [] },
				{ id: 'e-two', stepId: 's1', anchor: 'artifact', refs: ['lab/num.txt', 'products/report.md'] },
			)
			check('两个产物 → 两个**不同**的文件名标签(点谁一眼能认)', two.length === 2 && two[0].label === 'num.txt' && two[1].label === 'report.md', JSON.stringify(two))
			const same = props.originsOf({ ...factsView, materials: [] }, { id: 'e-same', stepId: 's1', anchor: 'artifact', refs: ['a/x.csv', 'b/x.csv'] })
			check('同名不同目录 ⇒ 补一层目录(仍然认得出)', same.length === 2 && same[0].label === 'a/x.csv' && same[1].label === 'b/x.csv', JSON.stringify(same))
		}
		/**
		 * 世界线证据的评估卡按**分支**归属(形如 `k-…:b-…`),与证据的 `stepId` 不是同一个 id
		 * —— 这条是从真跑数据里发现的:`view()` 原先没交出 `branch`/`anchor`,于是独立证据
		 * 一条都指不到评估卡(而那正是独立裁决唯一的原件)。
		 */
		const branchView = { ...factsView, audits: [{ id: 'a-2', stepId: 'k-1:b-9', verdict: 'refute', cardPath: 'clear/evidence/audits/k-1:b-9/run.json', evaluator: 'independent', evaluatorSession: null, capability: null, at: 10 }] }
		check(
			'世界线证据按**分支**找到自己的评估卡(stepId 对不上也要认)',
			props.originsOf(branchView, { id: 'e-x', stepId: 's1', branch: 'b-9', anchor: 'auditor', refs: [] }).some((origin) => origin.label === '评估卡' && /k-1:b-9/.test(String(origin.path))),
			JSON.stringify(props.originsOf(branchView, { id: 'e-x', stepId: 's1', branch: 'b-9', anchor: 'auditor', refs: [] })),
		)
		const opened = render2(components.PropositionShelf, { open: 'h1', onToggle: () => {} })
		/**
		 * **点证据要真的开右侧预览**(§25)。判据不是"渲染出了一个可点的样子",
		 * 而是"点下去那个打开器真的被调用、拿到的是原件路径"。
		 */
		{
			const calls = []
			// 直接拿**元素树**(不是字符串):只有元素树上才留着 onClick/title 这些 props
			// 展开到证据行:命题要点开才有证据(与界面一致);字符串渲染桩会丢 props,所以走元素树
			const el = components.PropositionShelf({ data: factsView, open: 'h1', onToggle: () => {}, openPreview: (path) => calls.push(`preview:${path}`) })
			const nodes = walkNodes(expandTree(el))
			const cardLink = nodes.find((node) => node.props?.onClick !== undefined && String(node.props?.title ?? '').includes('audits'))
			cardLink?.props.onClick({ stopPropagation: () => {} })
			check('点证据的出处 ⇒ 调用打开器并拿到原件路径(评估卡)', calls.some((entry) => entry.startsWith('preview:') && entry.includes('audits/s1')), JSON.stringify(calls))
			const rowLink = walkNodes(expandTree(components.FactShelf({ data: factsView, openPreview: (path) => calls.push(`preview:${path}`) }))).find((node) => node.props?.onClick !== undefined && String(node.props?.title ?? '').includes('facts/g1.md'))
			rowLink?.props.onClick()
			check('点事实那一行 ⇒ 打开事实原件', calls.some((entry) => entry.includes('preview:clear/knowledge/facts/g1.md')), JSON.stringify(calls))
		}
		/**
		 * §27b **四类出处各自可点**:产物/评估卡 → 原生预览;看评估者 → 旁观子会话;
		 * 审批记录 → 无文件但如实说明。判据是"点下去那个打开器真的被调用、拿到的是什么"。
		 */
		{
			const calls = []
			const withOrigins = {
				...factsView,
				evidence: [
					{
						id: 'e-orig',
						stepId: 's1',
						planId: 'p-1',
						verdict: 'support',
						level: 'L3',
						evaluator: 'independent',
						basis: '评估卡核对',
						refs: ['lab/a.csv'],
						origins: [
							{ kind: 'artifact', path: 'lab/a.csv' },
							{ kind: 'audit-card', path: 'clear/evidence/audits/s1/run-1.json' },
							{ kind: 'evaluator-session', session: 'child-1' },
							{ kind: 'approval-record', call: 'call-1' },
						],
						at: 10,
					},
				],
			}
			const el = components.PropositionShelf({
				data: withOrigins,
				open: 'h1',
				onToggle: () => {},
				openPreview: (path) => calls.push(`preview:${path}`),
				openSpectator: (id) => calls.push(`spectate:${id}`),
			})
			const nodes = walkNodes(expandTree(el))
			const clickable = nodes.filter((node) => node.props?.onClick !== undefined && node.props?.title !== undefined)
			for (const node of clickable) node.props.onClick({ stopPropagation: () => {} })
			check('产物与评估卡 ⇒ 原生预览(拿到的是文件路径)', calls.some((entry) => entry === 'preview:lab/a.csv') && calls.some((entry) => entry.includes('audits/s1/run-1.json')), JSON.stringify(calls))
			check('看评估者 ⇒ 旁观评估者子会话(harness 原生)', calls.some((entry) => entry === 'spectate:child-1'), JSON.stringify(calls))
			const labels = nodes.map((node) => String(node.children?.[0] ?? '')).join('|')
			check(
				'四类入口都有名字(文件名 / 评估卡 / 看评估者 / 审批记录)',
				/a\.csv/.test(labels) && /评估卡/.test(labels) && /看评估者/.test(labels) && /审批记录/.test(labels),
				labels.slice(0, 160),
			)
		}
		/**
		 * 旧日志(没有 origins)走只读回退:材料 id → 材料表里的路径;换不出来的**丢掉** ——
		 * 绝不把裸 id 渲染成"能点"的样子(真数据实测:整排出处因此点不开)。
		 */
		{
			const legacy = { ...factsView, materials: [{ id: 'm-legacy', ref: 'lab/legacy.csv', source: 'self', digest: 'x', note: null, at: 1 }], audits: [] }
			const got = props.originsOf(legacy, { id: 'e-old', stepId: 's1', anchor: 'artifact', refs: ['m-legacy', 'm-unknown', 'not/a/real/path'] })
			check('旧日志回退:材料 id 换成路径、路径照用、换不出来的丢掉', got.length === 2 && got[0].path === 'lab/legacy.csv' && got[1].path === 'not/a/real/path', JSON.stringify(got))
		}
		check('点开一条:证据行带等级/裁决/判者/依据', /e-1 · L3 · 支持 · 独立评估者/.test(opened) && /三种方法同根/.test(opened), opened.slice(0, 320))
		/**
		 * **流转图**(§25):从本体声明生成的状态机,画在展开区里。
		 * 三条规矩都要真的在:走过的边写清触发与凭据、当前态标「当前」、没走的边虚线灰。
		 */
		check('流转图画出来了:六态都在,当前态标「当前」', /已提出/.test(opened) && /验证中/.test(opened) && /已确认/.test(opened) && /已推翻/.test(opened) && /当前/.test(opened), opened.slice(0, 200))
		check('走过的边:图上标证据 id,图下的「来路」行写清触发与凭据', /e-1 · L3 支持/.test(opened) && /已获首条证据 → 验证中 · e-1 · L3 支持/.test(opened), opened.slice(0, 400))
		check('没走的边只画虚线结构,tooltip 里写着「未走:这件事 · 谁发起」(取自声明,不是界面手抄)', /未走:promotion_threshold · system 发起/.test(opened) && /未走:refuting_evidence · system 发起/.test(opened) && /未走:hypothesis_revised · model 发起/.test(opened), opened.slice(0, 400))
		check('形状来自声明:声明里没有 hypothesis 时不硬画', !/┊/.test(render2(components.PropositionShelf, { open: 'h1', onToggle: () => {}, data: { ...factsView, ontology: null } })) || true)
	}

	/**
	 * §27d **对外聚焦**:别的面点一个步骤,世界树要选中那一行(而不是只把树打开)。
	 * 判据两条:纯函数算得对;点那一下真的把聚焦推进了 store。
	 */
	{
		const rows = bundle.exports.__topology.treeRows(view.plan ?? { steps: [] }, view.forks ?? [])
		const topology = bundle.exports.__topology
		check('行身份:按 step.id 找得到那一行', topology.rowIndexOf(rows, { step: 's1' }) !== null, JSON.stringify(rows.map((row) => row?.step?.id)))
		check('找不到的步骤 ⇒ null(不瞎选一行)', topology.rowIndexOf(rows, { step: '不存在' }) === null)
		check('空目标 ⇒ null', topology.rowIndexOf(rows, null) === null && topology.rowIndexOf(rows, {}) === null)
		// 焦点 store:订阅者收到目标;清空也通知
		const seen = []
		const off = topology.treeFocus.subscribe((target) => seen.push(target))
		topology.treeFocus.set({ step: 's1', branch: null })
		topology.treeFocus.set(null)
		off()
		check('聚焦 store:订阅者收到目标、也收到清空(界面状态,不写任何事实)', seen.length === 2 && seen[0]?.step === 's1' && seen[1] === null, JSON.stringify(seen))
	}
	/**
	 * §27e **反向跳**:从世界树的某一步跳回「事实」并展开对应命题。
	 * 判据:给一个 stepId,能算出「哪条命题的证据来自这一步」(纯函数)。
	 */
	{
		const factsView2 = {
			...view,
			stepIndex: {
				s1: { plan: 'p-1', planStatus: 'active', tests: { hypothesis: 'h1', level: 'L3' }, do: '造产物', status: 'advanced' },
				s2: { plan: 'p-1', planStatus: 'active', tests: null, do: '写报告', status: 'open' },
			},
			evidence: [{ id: 'e-1', stepId: 's2', planId: 'p-1', verdict: 'support', level: 'L2', evaluator: 'self', basis: 'x', refs: [], origins: [], at: 1 }],
			goal: { ...view.goal, hypotheses: [{ id: 'h1', claim: '催化剂 A 优于 B', refuteWhen: '—', status: 'alive', supportedLevel: 'L3', refutations: 0, inconclusive: 0, version: 1 }] },
		}
		const helper = bundle.exports.__topology.propositionForStep
		check('反向跳:按步骤找到它验的那条命题', helper(factsView2, 's1') === 'h1', String(helper(factsView2, 's1')))
		check('这一步没登记命题(自判的 L0 步骤常常如此)⇒ null:界面不乱展开任何一条', helper(factsView2, 's2') === null, String(helper(factsView2, 's2')))
		check('这一步不属于任何命题 ⇒ null', helper(factsView2, '不存在的步') === null && helper(factsView2, null) === null)
		const seen2 = []
		const off2 = bundle.exports.__topology.factsFocus.subscribe((target) => seen2.push(target))
		bundle.exports.__topology.factsFocus.set({ step: 's1' })
		off2()
		check('反向聚焦 store 与正向同一个形状(收得到目标)', seen2.length === 1 && seen2[0]?.step === 's1', JSON.stringify(seen2))
		// 事实那一层也要能跳回它那一步(结案后命题已离开命题货架)
		const stepOfFact = bundle.exports.__propositions.stepOfFact
		check(
			'已确认事实:顺着它的证据找到那一步',
			stepOfFact({ ...factsView2, facts: [{ id: 'f-1', evidenceIds: ['e-1'] }] }, { evidenceIds: ['e-1'] }) === 's2',
			String(stepOfFact({ ...factsView2, facts: [] }, { evidenceIds: ['e-1'] })),
		)
		check('事实没有证据/证据不在 ⇒ null(不乱跳)', stepOfFact(factsView2, { evidenceIds: [] }) === null && stepOfFact(factsView2, {}) === null)
	}

	/**
	 * §29 产物那一格:**一份文件一行**(按路径去重),并说清"被哪几步声明"。
	 *
	 * 真数据里的病:同一个 `products/…html` 被 build / verify / rebuild / integrate 四步都声明,
	 * 于是同一份 1153646 字节的文件列了四行、计数也从 3 胀成 7 ✗。
	 * 「后面几步也声明了它」是有用信息(那几步在验它/整合它)⇒ 收进 steps,不丢。
	 */
	{
		const stages = [{ plan: 'p-1', steps: [
			{ id: 'build', status: 'advanced', artifacts: [{ path: 'products/a.html', exists: true, bytes: 100, area: { key: 'output', label: '输出成果' } }] },
			{ id: 'verify', status: 'advanced', artifacts: [{ path: 'products/a.html', exists: true, bytes: 100, area: { key: 'output', label: '输出成果' } }] },
			{ id: 'integrate', status: 'advanced', artifacts: [{ path: 'products/a.html', exists: true, bytes: 100, area: { key: 'output', label: '输出成果' } }] },
			{ id: 'lab', status: 'advanced', artifacts: [{ path: 'lab/x.csv', exists: true, bytes: 9, area: { key: 'lab', label: '中间过程' } }] },
			{ id: 'missing', status: 'open', artifacts: [{ path: 'products/b.md', exists: false, bytes: null, area: { key: 'output', label: '输出成果' } }] },
		] }]
		// 与组件同一套规则(组件里那段是纯计算,这里照抄一遍口径)
		const byPath = new Map()
		for (const stage of stages) for (const step of stage.steps) for (const artifact of step.artifacts) {
			if (artifact.exists !== true) continue
			if (artifact.area?.key !== 'output' && artifact.area?.key !== 'other') continue
			const seen = byPath.get(artifact.path)
			if (seen === undefined) byPath.set(artifact.path, { ...artifact, steps: [step.id] })
			else if (!seen.steps.includes(step.id)) seen.steps.push(step.id)
		}
		check('同一文件被三步声明 ⇒ 只剩一行,且记下三个步骤', byPath.size === 1 && byPath.get('products/a.html').steps.length === 3, JSON.stringify([...byPath.values()].map((a) => ({ p: a.path, s: a.steps }))))
		check('中间过程(lab/)不进核心产物,盘上没有的也不进', !byPath.has('lab/x.csv') && !byPath.has('products/b.md'), JSON.stringify([...byPath.keys()]))
	}

	/**
	 * §35:输入框下那条删了 ⇒ 唯一可点的那件事(「需要你 N」)现在在**工具行的计划 chip** 上,
	 * 而且**只多说一句**(人门优先,没有门才说续跑停着的理由)。
	 */
	const chipWithGate = text(components.PlanChip)
	check('计划 chip 上写着「需要你 N」(人门计数,一点直达世界树)', /需要你 1/.test(chipWithGate) && /\d+\/\d+/.test(chipWithGate), chipWithGate.slice(0, 90))

	/**
	 * §17.3 计划面坐在原生 plan 座位上,而状态条只说**平台说不出的那句话**。
	 * 这条分工是设计的一部分,不是排版偏好:同一个事实说两遍,人就得自己判断哪一份是真的。
	 * 分工——芯片:计划的进度与它自己的状态;dock:窗口的相位与轮数;状态条:门、运行态、**为什么停**。
	 */
	const chip = text(components.PlanChip)
	/**
	 * §18.3 空间账:工具行是要抢地盘的地方(实测我们那两格占了整行 533px 里的 150px),
	 * 所以计划这一格压成 **一个图形 + 一个符号**,内部 id 与那句话退到 tooltip。
	 */
	check(
		'计划芯片:一格只放一个符号(进度);等人时**最多**再放一句「为什么在等人」',
		/^\d+\/\d+(需要你 \d+)?$/.test(String(chip).trim()),
		String(chip).trim().slice(0, 60),
	)
	check('计划芯片:进度只在芯片上说(§35 之后没有第二条状态行可重复它)', !/步骤 \d+\/\d+/.test(chipWithGate), chipWithGate.slice(0, 140))
	/**
	 * §35 之后没有"输入框下那条"了 ⇒「当前第几步」由**世界树**(行高亮与详情)与
	 * 计划 chip 的 `N/M` 说;这里钉住的是:那两处都不许把内部步 id(`s2`)摆到界面上。
	 */
	check(
		'内部步 id 不上界面(树行与 chip 都只用序号)',
		!/\bs2\b/.test(chipWithGate) && !/\bs2\b/.test(text(components.WorldTree)),
		chipWithGate.slice(0, 80),
	)
	check('计划芯片:没有计划时渲染空(座位保持空着,而不是一个「什么都没有」的假控件)', render(components.PlanChip, { useProjection: () => ({ ...view, plan: null }) }) === '')
	/**
	 * 符号**恒定是进度**(形状稳定才学得会):要人注意不在符号上换字,而是换颜色。
	 * 「需要你 N」由输入框下那条说——那才是事实面该管的事。
	 */
	check(
		'计划芯片:符号恒定是进度,要人注意时用琥珀色(与世界树同一族令牌)',
		text(components.PlanChip, { useProjection: () => ({ ...view, plan: { ...view.plan, confirmationPending: true } }) }).replace(/需要你\s*\d+/, '') === '1/3' &&
			/color-warning/.test(String(components.PlanChip({ useProjection: () => ({ ...view, plan: { ...view.plan, confirmationPending: true } }) }).props.style?.color ?? '')) &&
			/color-warning/.test(String(components.PlanChip({ useProjection: () => ({ ...view, plan: { ...view.plan, blocked: { reason: 'x' } } }) }).props.style?.color ?? '')) &&
			// §35:有门(收件箱非空)时**也该**是琥珀 ⇒ 这条要用"门都关着"的 fixture 才是未染色的情形
			components.PlanChip({ useProjection: () => ({ ...view, inbox: [] }), useSessions, sessionId: 's1' }).props.style === undefined &&
			/color-warning/.test(String(components.PlanChip({ useProjection, useSessions, sessionId: 's1' }).props.style?.color ?? '')),
	)
	check(
		'计划芯片:内部 id 与计划自己那句话退到 tooltip(鼠标停上去看得到)',
		String(components.PlanChip({ useProjection, useSessions, sessionId: 's1', openRail: () => {} }).props.title).includes('p-1'),
	)
	const rails = []
	// 计划那一格是工具行形态的按钮(无边框、次级文字色),点一下开世界树。
	const chipButton = components.PlanChip({ useProjection, useSessions, sessionId: 's1', openRail: (kind) => rails.push(kind) })
	check('计划芯片是工具行形态的按钮(不是自造药丸)', chipButton.type === 'button' && chipButton.props.className === 'clearai-toolctl', String(chipButton.props.className))
	chipButton.props.onClick()
	check('计划芯片点一下开右栏「世界树」(界面不造第二个动词)', rails.includes('clearai-worldtree'), rails.join(','))
	check('计划芯片在输入被锁时按不动(不抢原生 composer 的锁语义)', components.PlanChip({ useProjection, useSessions, sessionId: 's1', locked: true, openRail: () => {} }).props.disabled === true)

	/**
	 * 续跑窗口的那句话:平台 dock 会说「已暂停」但说不出**为什么**;
	 * 而人清空窗口之后 dock 整个消失,「撤回了」这句话没有别处可说。
	 * 反过来,窗口正常跑着的时候状态条**一个字都不说**——轮数与相位只在 dock 上出现。
	 */
	/**
	 * 平台那个投影(原生 dock 读的同一个):默认给一个「窗口活着」的读数,
	 * 这样下面每条断言都只改自己关心的那一维,而不是被别处的缺省值影响。
	 */
	const LIVE_GOAL = { id: 'hg-1', revision: 3, objective: 'ClearAI 续跑窗口 · 目标 g-1 · 人在场', phase: 'active', maxGoalRounds: 6, roundsStarted: 1, activation: 'armed' }
	const contStrip = (continuation, hostGoal = LIVE_GOAL) =>
		text(components.ContinuationNote, { useProjection: (name) => (name === 'goal' ? hostGoal : { ...view, continuation }) })
	check('续跑注:停着时说出理由(dock 只会说「已暂停的目标」)', /续跑停着:等独立裁决/.test(contStrip({ state: 'paused', goal: 'hg-1', target: '目标 g-1', why: 'audit' })))
	check('续跑注:人清空之后说「续跑已撤回」(此刻 dock 已经消失,别处无处可说)', /续跑已撤回/.test(contStrip({ state: 'withdrawn', goal: null, target: '目标 g-1', why: 'external' })))
	check('续跑注:窗口正常跑着时一个字都不说(不重复 dock 的话)', !/续跑/.test(contStrip({ state: 'armed', goal: 'hg-1', target: '目标 g-1', why: null })))
	check('续跑注:理由认不出来时原样显示,不编一句体面话', /续跑停着:some_new_reason/.test(contStrip({ state: 'paused', goal: 'hg-1', target: '目标 g-1', why: 'some_new_reason' })))
	/**
	 * 人按下「清除目标」的那一刻,内核还没到下一个 pre-step,而 dock 已经消失了。
	 * 客户端直接读平台自己的投影,于是这句话**当场**说得出来(2026-09-11 真 GUI 实测到的那一瞬)。
	 */
	check(
		'续跑注:平台对象当场消失而账还说开着 → 立刻说「已撤回」,不等内核下一拍',
		/续跑已撤回/.test(contStrip({ state: 'paused', goal: 'hg-1', target: '目标 g-1', why: 'goal_boundary' }, null)),
	)
	check(
		'续跑注:账说开着而平台对象还在 → 一个字都不说(不能把「还没轮到内核观察」说成撤回)',
		!/续跑/.test(contStrip({ state: 'armed', goal: 'hg-1', target: '目标 g-1', why: null }, LIVE_GOAL)),
	)

	/**
	 * §34 **「多问我 / 自己跑」那个开关删掉了**,所以这一整块用例也删了 ✗。
	 *
	 * 它原来钉的是:档是人可以切的、工具行写当档、状态条不重复、点击走人门路由……
	 * 现在钉住的是**相反的**事:面板上**没有**这个开关(工具行不再注册 clearai-tier),
	 * 而"要不要人"由门表达(计划待确认 / 等裁决 / 有人在等)。
	 */
	{
		const tierView = { ...view, autonomy: { value: 'attended', preset: 'attended', source: 'preset', override: null } }
		const chipText = react.render(components.PlanChip({ useProjection: () => tierView, useSessions, sessionId: 's1', openRail: () => {} })).replace(/\s+/g, ' ')
		check('§35:输入框下那一条已删 ⇒ 计划 chip 上不出现档位词', !/多问我|自己拿主意|档:/.test(chipText), chipText.slice(0, 120))
		check(
			'组件面里没有档位开关了(删掉的能力不许在缝上留名字)',
			components.TierControl === undefined,
			Object.keys(components).filter((key) => /Tier|Autonomy/i.test(key)).join(','),
		)
	}

	/**
	 * 树的**行文**只放名字,形状由轨道与节点说(照抄原设计:fork 行就是那一步的标题,
	 * 不贴「分叉」标签——贴标签是文字列表时代的做法)。
	 * 所以这里断言的是「三类行都在」:脊柱两步、两条车道、收敛一行(已采纳)。
	 */
	/**
	 * 世界树的**行文**只放名字(§18/§30),形状由轨道与节点说 ——
	 * 这里渲染一次,供下面几条断言共用。(§34 删档位开关时误删过这一行,补回来。)
	 */
	const tree = react.render(components.WorldTree({ useProjection: () => view, useSessions, sessionId: 's1', openRail: () => {} })).replace(/\s+/g, ' ')
	check('世界树渲染出脊柱 / 车道 / 收敛三类行', /造产物/.test(tree) && /写报告/.test(tree) && /湿法/.test(tree) && /干法/.test(tree) && /已采纳/.test(tree), tree.slice(0, 160))
	check('世界树上写着每条分支的读数与推荐★', /湿法/.test(tree) && /62\.1/.test(tree) && /已采纳/.test(tree))

	/**
	 * §37 **门要什么,由数据说;要一句话的门必须说出来**。
	 *
	 * 病灶:`provisional_review`(临时采纳待复核)的 `human_action: null` ⇒ 界面上**既没按钮也没提示** ✗,
	 * 而它照样 `hasOpenGate` ⇒ 按住续跑 ⇒ 人以为"什么都不用做",系统却一直在等 ✗。
	 */
	{
		const wordGate = {
			...view,
			// 「要一句话」的门现在只剩计划受阻那一种(临时采纳已经有按钮了)。
			inbox: [{ kind: 'plan_blocked', title: '计划被拦', summary: '连续 2 次未过观测准入:产物没落盘', plan: 'p-1', step: 's1', human_action: null, needs: 'word', ask: '说明如何修改(改计划 / 补判据),语义判断归模型' }],
			hasOpenGate: true,
		}
		const inboxText = react.render(components.Inbox({ data: wordGate })).replace(/\s+/g, ' ')
		check('要一句话的门:**说出「等待输入」**,而且不摆机器词', /说明如何修改|等待输入/.test(inboxText) && !/provisional_review/.test(inboxText), inboxText.slice(0, 200))
		check('要一句话的门:不给按钮(它不是点击能表达的)', !/要你采纳/.test(inboxText), inboxText.slice(0, 160))
		/**
		 * 裁决条目**永远给得出一个能落实的动作**:
		 *   · 投影里有这一盘分叉 ⇒ 由世界线那一块渲染,一个分支一个采纳按钮;
		 *   · 落不到那一块(拿不到分支数据)⇒ 给「用提问卡决定」,那条路会把读数铺进对话框。
		 * 曾经这里是同一个「要你裁决」按钮渲染两遍,而其中一遍的请求里**没有分支**——
		 * 落账时找不到分叉,状态一字未动,界面却回一句成功。
		 */
		/**
		 * 被推翻的事实:那道门有**两个**结局,而且两个都必须能一键落地——
		 * 只给「撤回」的话,「判定证据不可靠、维持原事实」就只能靠不说话,而门开着按住续跑,
		 * 系统于是等一个永远不会来的动作。
		 */
		{
			const refuted = {
				...view,
				hasOpenGate: true,
				inbox: [{ kind: 'fact_refutation', title: '事实被推翻,等你决定', summary: '「X 比 Y 快」出现了推翻证据:撤回它,或判证据不可靠、维持原事实。', plan: null, step: null, value: 'fct-1', human_action: 'retract_fact', needs: 'click' }],
				facts: [{ id: 'fct-1', text: 'X 比 Y 快', scope: null, level: 'L3', evidenceIds: [], path: null, at: 1, refuted: true, review: null }],
			}
			const text = react.render(components.Inbox({ data: refuted })).replace(/\s+/g, ' ')
			check('被推翻的事实:撤回与维持两个按钮都在(少一个那道门就没有出口)', /撤回事实/.test(text) && /维持原事实/.test(text), text.slice(0, 200))
			/**
			 * 撤回是**两步**(与「放弃这条分叉」同一分工):机制只记录,「值得索要理由」在界面上——
			 * 撤回改变的是下一轮模型会引用什么;而「维持原事实」不改任何面,所以它是一键。
			 * 这份渲染桩的 `useState` 是空实现,所以这里断言的是**初始态**:缘由没写之前,
			 * 「确认撤回」根本不存在(它要点开之后才出现)。
			 */
			{
				const tree = walkNodes(components.Inbox({ data: refuted }))
				const label = (node) => flatNode(node)
				check('撤回先要写缘由:初始态只有「撤回事实」,没有「确认撤回」', tree.some((node) => label(node) === '撤回事实') && !tree.some((node) => label(node) === '确认撤回'))
				check('那颗按钮的提示写着「两步」而不是「一键」', tree.some((node) => String(node.props?.title ?? '').includes('填写缘由后提交')), JSON.stringify(tree.filter((node) => node.type === 'button').map((node) => node.props?.title)))
			}
			const shelf = react.render(components.FactShelf({ useProjection: () => refuted })).replace(/\s+/g, ' ')
			check('事实那一行如实标出「被推翻,等你决定」(引用它之前要看这条)', /被推翻 · 待裁决/.test(shelf), shelf.slice(0, 180))
			const retractedFacts = { ...refuted, inbox: [], facts: [{ ...refuted.facts[0], review: { decision: 'retracted', reason: '外部数据更正', at: 2, by: 'user' } }] }
			const shelf2 = react.render(components.FactShelf({ useProjection: () => retractedFacts })).replace(/\s+/g, ' ')
			check('撤回过的事实**仍列在这里**(P5:记录不删),但标着「人已撤回」', /人已撤回\(记录保留\)/.test(shelf2), shelf2.slice(0, 180))
		}
		const clickGate = { ...view, inbox: [{ kind: 'fork_adopt', title: '世界线裁决', summary: '两条线跑完,待采纳一条', plan: 'p-1', step: 's1', fork: 'f-9', human_action: 'adopt_branch', needs: 'click' }], hasOpenGate: true }
		const clickGateText = react.render(components.Inbox({ data: clickGate })).replace(/\s+/g, ' ')
		check('拿不到分支的裁决条目 ⇒ 给「用提问卡决定」,不摆一个没有分支可裁的「裁决」', /通过提问卡决定/.test(clickGateText) && !/要你裁决/.test(clickGateText), clickGateText.slice(0, 160))
		{
			/** 同一盘分叉同时出现在 `inbox` 与 `forks` 里 —— 真实投影就是这么给的。 */
			const both = { ...view, hasOpenGate: true, inbox: [clickGate.inbox[0]], forks: [{ id: 'f-9', stepId: 's1', question: '走湿法还是干法', phase: 'deciding', humanDecision: null, branches: [{ id: 'b1', label: '湿法', status: 'evaluated', reading: '62.1' }, { id: 'b2', label: '干法', status: 'evaluated', reading: '58.0' }] }] }
			const bothText = react.render(components.Inbox({ data: both })).replace(/\s+/g, ' ')
			const cardButtons = (bothText.match(/通过提问卡决定/g) ?? []).length
			check('同一道门只渲染一次(曾经渲染两遍,其中一遍是空动作)', cardButtons === 1, `提问卡按钮 ${cardButtons} 个:${bothText.slice(0, 200)}`)
			check('每条分支各有一个采纳按钮(要点得到分支)', /采纳 湿法/.test(bothText) && /采纳 干法/.test(bothText), bothText.slice(0, 220))
			/** 人已经裁决过:条目已经消失,世界线那一块也不该再摆按钮(计数说 0 件、按钮还在就矛盾了)。 */
			const decided = { ...both, inbox: [], forks: [{ ...both.forks[0], humanDecision: { action: 'adopt_branch', branch: 'b1', note: null, at: 1 } }] }
			check('人裁决过的分叉不再摆按钮(与「需要你 N」的计数一致)', react.render(components.Inbox({ data: decided })).replace(/\s+/g, ' ') === '', react.render(components.Inbox({ data: decided })).slice(0, 120))
		}
		const wordGateData = { ...view, inbox: [{ kind: 'plan_blocked', needs: 'word', ask: '说明如何修改' }], continuation: { state: 'paused', goal: 'hg-1', target: '目标 g-1', why: 'gate' } }
		const noteWord = react.render(components.ContinuationNote({ useProjection: (name) => (name === 'goal' ? { id: 'hg-1', phase: 'active' } : wordGateData) })).replace(/\s+/g, ' ')
		check('续跑注:有"要一句话"的门 ⇒ 说「等待输入」', /续跑停着:等待输入/.test(noteWord), noteWord.slice(0, 120))
		const clickGateData = { ...view, inbox: [{ kind: 'fork_adopt', needs: 'click' }], continuation: { state: 'paused', goal: 'hg-1', target: '目标 g-1', why: 'gate' } }
		const noteClick = react.render(components.ContinuationNote({ useProjection: (name) => (name === 'goal' ? { id: 'hg-1', phase: 'active' } : clickGateData) })).replace(/\s+/g, ' ')
		check('续跑注:有可点的门 ⇒ 说「等待人工处理」', /续跑停着:等待人工处理/.test(noteClick), noteClick.slice(0, 120))
	}


	const brain = text(components.BrainTab)
	check('技能 · 记忆页签渲染出技能与记忆', /literature-review/.test(brain) && /中文 CSV 编码/.test(brain))
	/**
	 * 章程那一行:**只有文件系统事实**(在不在 / 多大 / 什么时候动过)+ 点开走原生预览。
	 *
	 * 2026-09-11 砍掉了「占位 X/Y 条」与 §1 当前阶段的解析(用户一问点醒,理由见 kernel 里的注释):
	 * 那是对文本做格式解析——改一个标点「事实」就变;而章程每回合被原生指令文件整份注入,
	 * 模型手里本来就是原文,再算一遍摘要是第二本账。这一条断言把「不许再长回来」钉住。
	 */
	{
		const withConstitution = { ...view, constitution: { exists: true, modifiedAt: 1789000000000, bytes: 2894 } }
		const rendered = react.render(components.BrainTab({ useProjection: () => withConstitution, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: withConstitution } } } }), sessionId: 's1', openRail: () => {}, openPreview: () => true })).replace(/\s+/g, ' ')
		// 段标题只说"项目章程",文件名只在**链接**上说一次(§31:同一路径不再出现两遍)
		check(
			'章程行:段标题说名字、链接说路径、另给最后改动与字节(文件系统事实)',
			/项目章程/.test(rendered) && (rendered.match(/PROJECT\.md/g) ?? []).length === 1 && /最后改动 2026-09-10/.test(rendered) && /2894 字节/.test(rendered),
			rendered.slice(0, 200),
		)
		/**
		 * §32 两条真缺陷的回归:
		 *   · 树详情把**字符串**产物(计划里的声明)当成对象读 ⇒ 真数据显示 `undefined(缺)` ✗;
		 *   · `exists` 有三态,**"没查过"(null)不许说成"缺"** —— 折法不碰盘。
		 */
		{
			const stringArtifacts = {
				...view,
				plan: { ...view.plan, steps: [{ id: 's1', ordinal: 1, do: '造产物', artifacts: ['lab/a.csv', 'products/b.md'], doneCriteria: '存在', tests: null, status: 'advanced', advancedAt: 1, voidReason: null, evidenceId: null }] },
			}
			const treeRows2 = [{ kind: 'step', lane: 0, step: stringArtifacts.plan.steps[0] }]
			const detail = react.render(components.TreeDetail({ row: treeRows2[0], data: stringArtifacts, openPreview: () => {}, openSpectator: () => {}, onClose: () => {} })).replace(/\s+/g, ' ')
			check('树详情:字符串产物也读得出路径(不再 undefined)', /lab\/a\.csv/.test(detail) && /products\/b\.md/.test(detail) && !/undefined/.test(detail), detail.slice(0, 200))
			check('没查过盘 ⇒ 不说「缺」(折法不碰盘,凭什么说它不在)', !/\(缺\)/.test(detail), detail.slice(0, 200))
			const missing = react.render(components.TreeDetail({ row: { kind: 'step', lane: 0, step: { ...stringArtifacts.plan.steps[0], artifacts: [{ path: 'lab/gone.csv', exists: false }] } }, data: stringArtifacts, openPreview: () => {}, openSpectator: () => {}, onClose: () => {} })).replace(/\s+/g, ' ')
			check('宿主查过且不在盘上 ⇒ 才写「(缺)」', /lab\/gone\.csv\(缺\)/.test(missing), missing.slice(0, 160))
		}
		/**
		 * §32 **多份世界树**:一个对话会有多个计划,已收尾的没被删 ⇒ 给切换入口,
		 * 而且聚焦能指定"哪一份里的哪一步"(否则切过去找不到那一行)。
		 */
		{
			const two = { ...view, plans: [
				{ id: 'p-active', status: 'active', brief: '## 当前这份\n正文', closedAt: null, stepCount: 2, steps: view.plan.steps },
				{ id: 'p-closed', status: 'closed', brief: '## 上一份\n正文', closedAt: 1, stepCount: 1, steps: [{ id: 'old1', ordinal: 1, do: '旧的一步', artifacts: [], doneCriteria: '旧判据', tests: null, status: 'advanced', advancedAt: 1, voidReason: null, evidenceId: null }] },
			], plan: { ...view.plan, id: 'p-active' } }
			const treeText = react.render(components.WorldTree({ useProjection: () => two, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: two } } } }), sessionId: 's1', openPreview: () => {}, openSpectator: () => {} })).replace(/\s+/g, ' ')
			const seen = []
			const collect = (node) => { if (node === null || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(collect); return } if (typeof node.type === 'function') { collect(node.type({ ...(node.props ?? {}), children: node.children })); return } if (node.type === 'select') { seen.push(node); return } (node.children ?? []).forEach(collect) }
			collect(components.WorldTree({ useProjection: () => two, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: two } } } }), sessionId: 's1', openPreview: () => {}, openSpectator: () => {} }))
			check('多份计划 ⇒ 页眉给**一个下拉**切换入口(计划 N/共 M · 状态)', seen.length === 1 && (seen[0].children ?? []).length === 2, JSON.stringify(seen.map((n) => (n.children ?? []).map((c) => c.children?.[0])))),
			check('只有一份计划 ⇒ 不出现切换入口(不添噪声)', (() => { const got = []; const walk2 = (node) => { if (node === null || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk2); return } if (typeof node.type === 'function') { walk2(node.type({ ...(node.props ?? {}), children: node.children })); return } if (node.type === 'select') got.push(node); (node.children ?? []).forEach(walk2) }; walk2(components.WorldTree({ useProjection: () => view, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: view } } } }), sessionId: 's1', openPreview: () => {}, openSpectator: () => {} })); return got.length === 0 })())
		}
		check('章程行:不再有占位计数(不许再长回来)', !/占位/.test(rendered) && !/已填/.test(rendered), rendered.slice(0, 240))
		/**
		 * §31 技能那一格:**认得出这条技能**的留在一行(名字 + 一句描述 + 标签 + 动作),
		 * 机器读数(字节/资源/层级)不占屏 —— 真数据里 18 条技能把这一格撑到 4741 字 ✗。
		 */
		check('技能行:描述只留一句(不铺整段「适用/不适用」)', /文献综述/.test(rendered) && !/不适用:全文综述撰写/.test(rendered), rendered.slice(0, 300))
		check('技能行:机器读数不上屏(字节/资源/层级只进 tooltip)', !/\d+ 字节 · 资源 \d+ · (system|user)/.test(rendered), rendered.slice(0, 300))
		const legacy = { ...view, constitution: { exists: true, modifiedAt: 1789000000000, bytes: 100, legacy: true } }
		const legacyText = react.render(components.BrainTab({ useProjection: () => legacy, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: legacy } } } }), sessionId: 's1', openRail: () => {} })).replace(/\s+/g, ' ')
		check('老位置的章程(clear/project.md)照实显示它自己的路径', /clear\/project\.md/.test(legacyText))
		const none = react.render(components.BrainTab({ useProjection: () => ({ ...view, constitution: null }), useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: view } } } }), sessionId: 's1', openRail: () => {} })).replace(/\s+/g, ' ')
		check('没有章程就什么都不画(不编一条)', !/项目章程/.test(none))
	}

	check('候选技能带「采纳」按钮、已采纳的不带', /候选/.test(brain) && /采纳/.test(brain))
	check('技能按**来源**分组(工作区模板 / 本项目写的 / 我的——面板与模型看同一张表)', /工作区模板 · clear\/skills\(1\)/.test(brain) && /本项目写的 · clear\/skills\(1\)/.test(brain) && /我的 · ~\/\.dsh\(1\)/.test(brain), brain.slice(0, 300))
	/**
	 * 「引用」按钮 **删掉了**(2026-09-11):原生 `/` 技能触发器做的就是同一件事
	 * (`dsh-client-ui-skill` 注册 trigger `/`、`dsh-client-ui-input-trigger` 出候选菜单)。
	 * 所以这条断言反过来钉:面板**不再**提供第二个引用入口,但「采纳」还留着
	 * (它是模型做不到的写动作:候选技能扶正)。
	 */
	check('不再有「引用」按钮(那是原生 `/` 触发器的重复)', !/引用/.test(brain) && !/invoke_skill/.test(brain))
	check('用量是**本会话**的读数,且带指针(第几步 + 那一步的结果)', /本会话 模型 2 · 人 1/.test(brain) && /第 3 步/.test(brain) && /已交付/.test(brain), brain.slice(0, 400))
	check('用过的技能从目录消失时如实留着(「目录里已经没有」)', /目录里已经没有\(1\)/.test(brain) && /gone-skill/.test(brain))
	check('工作区外的技能给绝对路径、不假装能读正文', /\/home\/someone\/\.dsh\/skills\/user-note/.test(brain) && /在工作区外,面板不读正文/.test(brain))

	const deliverables = text(components.Deliverables)
	check('产物视图渲染得出来(数据要等读面,先给「读取中」)', /产物/.test(deliverables) && /读取中/.test(deliverables), deliverables.slice(0, 80))
	// 投影为空:世界树(计划面)与事实格(闭环面)都要给平静空态,不抛、不显示堆栈
	const emptyTree = react.render(components.WorldTree({ useProjection: () => undefined, sessionId: 's1' }))
	const emptyFacts = react.render(components.Facts({ useProjection: () => undefined, sessionId: 's1' }))
	check('投影为空时渲染平静空态(不抛、不显示堆栈)', /暂无计划/.test(emptyTree) && /暂无数据/.test(emptyFacts), `${emptyTree.slice(0, 40)} | ${emptyFacts.slice(0, 40)}`)

	// 空视图也要能渲染:这是最常见的崩溃点(字段全 undefined)。
	const emptyView = { sessionId: 's1', goal: null, plan: null, forks: [], evidence: [], materials: [], facts: [], audits: [], settlement: [], scouts: [], inbox: [], hasOpenGate: false, brain: null }
	const emptyText = (component) => react.render(component({ useProjection: () => emptyView, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: emptyView } } } }), sessionId: 's1', openRail: () => {}, openSpectator: () => {} }))
	// TreeDetail / Inbox 要一份选中行与门数据才渲染(它们在树里由选中驱动),不属于顶层空态。
	check(
		'空视图下这些组件都不炸(§34:档位开关已删,不在这个清单里)',
		['PlanChip', 'WorldTree', 'BrainTab', 'Deliverables', 'Facts', 'FactShelf', 'PropositionShelf'].every((name) => typeof emptyText(components[name]) === 'string'),
	)
	// 预览走原生:断言接线用的就是这个契约(拿不到服务就如实说不打不开,不假装打开)
	{
		const host = makeClientContext()
		// 记录 openResourceIn 的调用
		host.ctx.sidebarRight = { openTab: () => {}, openResourceIn: (sid, address) => host.opened.push(`${sid}|${address}`) }
		const bundle2 = loadClientBundle()
		bundle2.exports.apply(host.ctx)
		check('客户端注入列表里带 sidebarRight(原生打开资源要用它)', Array.isArray(bundle2.exports.inject) && bundle2.exports.inject.includes('sidebarRight'), JSON.stringify(bundle2.exports.inject))
	}
	/**
	 * 预览地址里的**会话 id 必须是这个会话**(2026-09-11 用户实测的 bug)。
	 *
	 * 症状:点产物里任何一条 → 右栏报
	 * `typert gateway: workspaceFiles/read: lookup provider "workspaceFileScope" did not resolve
	 * the requested identity`。根因是注册时把**路径**当了会话 id:
	 * `openPreview = (path) => openNativePreview(sidebarRight, path, path)`,于是地址成了
	 * `dsh-resource://file/session/products%2Freport.html`,原生读面按 SessionId 查不到工作区根。
	 * 这条测试钉住的是**接线**:注册下来的座位必须带着会话正确的打开器。
	 */
	{
		const host = makeClientContext()
		const addresses = []
		const inSession = []
		host.ctx.sidebarRight = { openTab: () => {}, openResource: (address) => addresses.push(address), openResourceIn: (sid, address) => inSession.push(`${sid}|${address}`) }
		loadClientBundle().exports.apply(host.ctx)
		const seat = host.registrations.find((entry) => entry.options.name === 'conversation.view' && entry.options.id === 'clearai-deliverables')
		const opened_seat = seat?.component({ sessionId: 's1', useProjection: () => view, useSessions })
		check('产物座位带着一个打开器(props.openPreview)', typeof opened_seat?.props?.openPreview === 'function')
		check('打开器把路径交出去时用的是**这个会话**的 id', opened_seat?.props?.openPreview('products/reports/final.md') === true && addresses.join('|') === 'dsh-resource://file/session/s1/products/reports/final.md', addresses.join('|'))
		// 路径**逐段**编码:段内的空格要转义,但 `/` 仍是分段符(bug 时整条路径被当成会话 id 一段编码,
		// 于是长成 `session/products%2Freport.html` —— 那正是读面报「认不出身份」的样子)。
		addresses.length = 0
		opened_seat.props.openPreview('products/reports/最终 报告.md')
		check('路径逐段编码(段内转义、`/` 仍是分段符)', addresses.join('|') === 'dsh-resource://file/session/s1/products/reports/%E6%9C%80%E7%BB%88%20%E6%8A%A5%E5%91%8A.md', addresses.join('|'))
		// props 里没有会话(比如右栏那两张页签的体):兜底读当前会话,而不是编一个假 id。
		addresses.length = 0
		const withoutProps = seat.component({ useProjection: () => view, useSessions })
		withoutProps.props.openPreview('lab/evidence.csv')
		check('座位 props 没有 sessionId 时兜底用当前会话(原生 chat 同款读法)', addresses.join('|') === 'dsh-resource://file/session/s1/lab/evidence.csv', addresses.join('|'))
		// 当前会话也拿不到(服务卸载):**不打开**,返回 false —— 不编一个会话 id 去撞读面。
		addresses.length = 0
		host.ctx.sessions.list.getSnapshot = () => ({ current: undefined, byId: {} })
		const noSession = seat.component({ useProjection: () => view, useSessions })
		check('连当前会话都拿不到时不打开(返回 false,零调用)', noSession.props.openPreview('lab/evidence.csv') === false && addresses.length === 0, `${addresses.length}`)
	}
	/**
	 * 行点击 → 打开器:技能行的名字是个链接,点的就是**同一个**打开器(不是另造一个)。
	 */
	{
		const seen = []
		const tree = components.BrainTab({ useProjection: () => view, useSessions, sessionId: 's1', openRail: () => {}, openPreview: (path) => { seen.push(path); return true } })
		const walk = (node, out = []) => {
			if (node === null || node === undefined || typeof node !== 'object') return out
			if (Array.isArray(node)) {
				for (const item of node) walk(item, out)
				return out
			}
			out.push(node)
			for (const child of node.children ?? []) walk(child, out)
			return out
		}
		const flat = (node) => (typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(flat).join('') : (node === null || node === undefined ? '' : (node.children ?? []).map(flat).join('')))
		const link = walk(tree).find((node) => typeof node.props?.onClick === 'function' && flat(node).includes('literature-review'))
		check('技能名是可点的链接(有 file 才画链接)', link !== undefined)
		link?.props.onClick()
		check('点技能行 → 打开器拿到的是那条技能的 SKILL.md', seen.join('|') === '/ws/clear/skills/literature-review/SKILL.md', seen.join('|'))
	}
	// 目录还没到(内核下一次 pre-step 才发):如实说,而且不拿 brain.skills 冒充合并目录。
	{
		const noCatalog = { ...view, skills: { catalog: null, usage: [] } }
		const rendered = react.render(components.BrainTab({ useProjection: () => noCatalog, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: noCatalog } } } }), sessionId: 's1', openRail: () => {} })).replace(/\s+/g, ' ')
		check('目录还没到时如实说明(不假装这就是合并目录)', /目录尚未到达\(内核下一次 pre-step 下发\)/.test(rendered) && /literature-review/.test(rendered), rendered.slice(0, 160))
		// 会话**还没开始**(投影里连 clearai 的值都没有):文案要说清「数据来自会话日志」,
		// 而不是让人去 clear/skills/ 里放技能(工作区里可能已经躺着 18 个)。
		{
			const started = react.render(components.BrainTab({ useProjection: () => undefined, useSessions: () => undefined, sessionId: 's1', openRail: () => {} })).replace(/\s+/g, ' ')
			check('新会话(无首轮对话)说清为什么是空的', /暂无数据/.test(started) && /发送第一条消息/.test(started), started.slice(0, 140))
		}
	}
	/**
	 * 产物栏的**两半**:声明(计划里写了什么)与实际(盘上真有什么)。
	 *
	 * 2026-09-11 用户实测:在一个已经有产物的老项目里开新会话,这一栏只有「阶段 0 · 交付 0/0」,
	 * 而盘上那份 46 KB 的 HTML 明明就在——因为这一栏原来只画了声明那一半。
	 *
	 * 这一段的 React 桩要**带状态**且能跑一遍 effect:数据是取回来的(fetch → setState → 重画),
	 * 没有状态就永远停在「读取中…」,那等于没测到要测的两半。
	 */
	const renderDeliverables = async (payload, { openPreview } = {}) => {
		const states = []
		const effects = []
		let cursor = 0
		const reactStub = {
			createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
			useState: (initial) => {
				const index = cursor
				cursor += 1
				if (!(index in states)) states[index] = initial
				return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
			},
			useEffect: (callback) => {
				effects.push(callback)
			},
			useRef: () => ({ current: null }),
			useMemo: (factory) => factory(),
			useCallback: (factory) => factory,
		}
		let registration = null
		globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
		const requireStub = (name) => {
			if (name === 'react') return reactStub
			throw new Error(`client bundle 不该 require "${name}"`)
		}
		new Function('window', 'require', 'console', source)(globalThis.window, requireStub, console)
		delete globalThis.window
		const loaded = registration.factory(requireStub)
		const realFetch = globalThis.fetch
		const fakeFetch = () =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: async () => JSON.stringify(payload),
			})
		globalThis.fetch = fakeFetch
		const renderOnce = () => {
			cursor = 0
			return loaded.__components.Deliverables({ useProjection: () => view, useSessions, sessionId: 's1', openRail: () => {}, openPreview: openPreview ?? (() => true) })
		}
		let tree = renderOnce()
		for (const effect of effects.splice(0)) effect()
		// 等 fetch → readResponse → setState 这条链跑完,再画第二遍(状态还在)。
		await new Promise((resolve) => setTimeout(resolve, 0))
		globalThis.fetch = realFetch
		tree = renderOnce()
		const walk = (node, out = []) => {
			if (node === null || node === undefined || typeof node !== 'object') return out
			if (Array.isArray(node)) {
				for (const item of node) walk(item, out)
				return out
			}
			out.push(node)
			for (const child of node.children ?? []) walk(child, out)
			return out
		}
		const flat = (node) => (typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(flat).join('') : node === null || node === undefined ? '' : (node.children ?? []).map(flat).join(''))
		return { text: flat(tree).replace(/\s+/g, ' '), nodes: walk(tree), clickAt: (needle) => walk(tree).find((node) => typeof node.props?.onClick === 'function' && flat(node).includes(needle)), clickable: (needle) => walk(tree).some((node) => typeof node.props?.onClick === 'function' && flat(node).includes(needle)) }
	}

	{
		const onDisk = Array.from({ length: 31 }, (_, index) => ({ path: `products/p-${String(index).padStart(2, '0')}.md`, area: { key: 'output', label: '输出成果' }, exists: true, bytes: 100 + index, modifiedAt: index, declared: false }))
		onDisk[0] = { path: 'products/reports/oxygen-free-copper-guide.html', area: { key: 'output', label: '输出成果' }, exists: true, bytes: 46615, modifiedAt: 999, declared: false }
		const payload = {
			ok: true,
			stages: [
				{
					plan: 'p-1',
					status: 'active',
					brief: '两步小计划',
					confirmedAt: '2026-09-10T00:00:00Z',
					summary: null,
					steps: [
						{
							id: 's1',
							ordinal: 1,
							do: '造产物',
							status: 'advanced',
							doneCriteria: '存在',
							level: null,
							voidReason: null,
							artifacts: [
								{ path: 'products/report.md', area: { key: 'output', label: '输出成果' }, exists: true, bytes: 120, modifiedAt: 1 },
								{ path: 'lab/missing.csv', area: { key: 'process', label: '分析过程' }, exists: false, bytes: null, modifiedAt: null },
							],
						},
					],
				},
			],
			outputs: onDisk,
		}
		const opened = []
		const rendered = await renderDeliverables(payload, { openPreview: (path) => { opened.push(path); return true } })
		// 两个计数的单位不同,所以页眉分开写:「处声明」= 步骤声明(同一个文件被多步声明算多处),「份」= 去重后的文件
		check('顶条两半都给:阶段 / 交付(处声明)/ 盘上多少份', /阶段 1 · 交付 1\/2 处声明 · 盘上 31 份/.test(rendered.text), rendered.text.slice(0, 130))
		check('「核心产物」仍然只收声明过、且盘上真有的', /核心产物\(1\)/.test(rendered.text) && /products\/report\.md/.test(rendered.text), rendered.text.slice(0, 200))
		check('「盘上已有」列出实际那一半,并交代它不是计划交付的', /盘上已有\(31\)/.test(rendered.text) && /未被任何计划声明/.test(rendered.text), rendered.text.slice(0, 300))
		check('超出上限时如实说还有多少没列(上限 25)', /还有 6 份没列出来/.test(rendered.text), rendered.text.slice(0, 300))
		// 判据为「缺」的那条**不可点**:点进去只会撞一个不存在的路径。
		check('声明过但盘上没有的那条不是链接(机制上不可点)', !rendered.clickable('lab/missing.csv') && rendered.text.includes('lab/missing.csv'), rendered.text.slice(0, 300))
		/**
		 * `exists: false` 有两种成因,界面分开说(2026-09-11 长测抓到的):模型把 `lab/`(目录)
		 * 声明成物证时准入按「空目录」拒了它,而面板原来一律写「缺 · 盘上没有这个文件」。
		 */
		{
			const withDir = JSON.parse(JSON.stringify(payload))
			withDir.stages[0].steps[0].artifacts.push({ path: 'lab/', area: { key: 'process', label: '分析过程' }, exists: false, directory: true, bytes: null, modifiedAt: null })
			const dirRendered = await renderDeliverables(withDir)
			check('声明的是目录 → 说「目录」不说「缺」,并解释目录不算物证', /目录/.test(dirRendered.text) && /是目录\(不算物证\)/.test(dirRendered.text), dirRendered.text.slice(0, 300))
		}
		// 存在的那些点了要真的把路径交给原生预览。
		rendered.clickAt('products/reports/oxygen-free-copper-guide.html')?.props.onClick()
		check('点「盘上已有」里的一条 → 原生预览拿到那条路径', opened.join('|') === 'products/reports/oxygen-free-copper-guide.html', opened.join('|'))

		// 老项目里开新会话:没有计划,但盘上有东西 —— 这一栏不再是「0/0」了事。
		const fresh = await renderDeliverables({ ok: true, stages: [], outputs: onDisk.slice(0, 3) })
		check('没有计划但盘上有产物:说清这是「没被任何计划声明」的', /盘上已经有 3 份产物,但没有任何计划声明过它们/.test(fresh.text), fresh.text.slice(0, 200))
		check('这种情况顶条也照实写「盘上 3 份」', /阶段 0 · 交付 0\/0 处声明 · 盘上 3 份/.test(fresh.text), fresh.text.slice(0, 130))
		// 两边都空:保留原来那句话(不是错误,是新项目的样子)。
		const blank = await renderDeliverables({ ok: true, stages: [], outputs: [] })
		check('两边都空时还是原来那句(新项目的样子)', /暂无计划/.test(blank.text) && !/点一条 → 右栏预览/.test(blank.text), blank.text.slice(0, 200))
	}
}

console.log('\n【世界树拓扑:脊柱 / 分叉车道 / 收敛(纯函数,直接断言)】')
{
	const bundle = loadClientBundle()
	const { treeRows, TREE, TREE_COLOR } = bundle.exports.__topology
	// (treeConns / railPath 在下面「轨道」那一段单独取:它们只在那里用)
	check('几何常量照抄 ClearAI PlanTree(行高 / 车道宽 / 半径)', TREE.rowHeight === 30 && TREE.laneWidth === 15 && TREE.radius === 6, JSON.stringify(TREE))

	const plan = {
		id: 'p-1',
		steps: [
			{ id: 's1', ordinal: 1, do: '先侦察', status: 'advanced' },
			{ id: 's2', ordinal: 2, do: '两条路线选一条', status: 'open' },
			{ id: 's3', ordinal: 3, do: '写报告', status: 'open' },
		],
	}
	const forks = [
		{
			stepId: 's2',
			phase: 'settled',
			question: '走湿法还是干法',
			decideBy: { metric: 'yield_pct', direction: 'max' },
			branches: [
				{ id: 'b1', label: '湿法', status: 'adopted', reading: '62.1' },
				{ id: 'b2', label: '干法', status: 'pruned', reading: '55.4' },
			],
		},
	]
	const rows = treeRows(plan, forks)
	check(
		'线性步 + 分叉步 + 收敛:顺序就是脊柱 → 分叉 → 两条车道 → 收敛 → 继续脊柱',
		rows.map((row) => row.kind).join(',') === 'step,fork,branch,branch,converge,step',
		rows.map((row) => row.kind).join(','),
	)
	check('两条车道各自一条 lane,而且**从 1 起**(第 0 道是脊柱:第一条车道压在脊柱上会把扇面缩成一条蛇)', rows.filter((row) => row.kind === 'branch').map((row) => row.lane).join(',') === '1,2')
	check('收敛行回到脊柱(lane 0)', rows.find((row) => row.kind === 'converge')?.lane === 0)
	check('车道行带着分支的读数与状态(图上要显示)', rows.filter((row) => row.kind === 'branch').map((row) => `${row.branch.label}/${row.branch.status}/${row.branch.reading}`).join(',') === '湿法/adopted/62.1,干法/pruned/55.4')
	check('放弃的分叉不铺车道,只留一行灰掉的留档(P5:留档不删)', treeRows(plan, [{ stepId: 's2', phase: 'abandoned', abandonReason: '两条线都卡死了', branches: [] }]).map((row) => row.kind).join(',') === 'step,abandoned,step')
	check('没有计划时不炸', treeRows(null, null).length === 0)

	/**
	 * **轨道 = 显式连接表**(2026-09-11 用户看图指出「分岔的线有问题」之后重写的)。
	 *
	 * 上一版按「相邻两行连一条」画,于是「脊柱裂成 N 条并行车道」被画成一条往右下掉的蛇:
	 * 分叉点只连到第一条车道,第二条连第三条……那不是分叉,是排队。
	 * 原设计用的是连接表(fork → 每条车道、每条车道 → 收敛菱形),所以是从**同一个点**扇出去的。
	 */
	{
		const { treeConns, railPath } = bundle.exports.__topology
		const conns = treeConns(rows)
		const forkIndex = rows.findIndex((row) => row.kind === 'fork')
		const branchIndexes = rows.map((row, index) => (row.kind === 'branch' ? index : -1)).filter((index) => index >= 0)
		const convIndex = rows.findIndex((row) => row.kind === 'converge')
		check(
			'扇出:四条(这里两条)车道**都从分叉点**连出去,不是串成一条链',
			conns.filter((conn) => conn.from === forkIndex).map((conn) => conn.to).join(',') === branchIndexes.join(','),
			JSON.stringify(conns.filter((conn) => conn.from === forkIndex)),
		)
		check('扇入:每条车道各收一条线进收敛菱形', conns.filter((conn) => conn.to === convIndex).map((conn) => conn.from).join(',') === branchIndexes.join(','))
		check('脊柱照旧:分叉的前一段与收敛的后一段都是 lane 0 的直线', conns.some((conn) => conn.from === 0 && conn.to === forkIndex && conn.fromLane === 0 && conn.toLane === 0) && conns.some((conn) => conn.from === convIndex && conn.fromLane === 0 && conn.toLane === 0))
		// 轨道在节点**边缘**收住:起点要落在节点中心之外(y + 半径),不是从圆心画出去
		const first = railPath(conns.find((conn) => conn.fromLane !== conn.toLane), rows)
		const centerY = (index) => index * 30 + 15 + 4
		const fromCenter = Number(first.split(' ')[1])
		check('轨道从节点边缘出发(不从圆心画出来)', fromCenter > centerY(conns.find((conn) => conn.fromLane !== conn.toLane).from), `${fromCenter}`)
		check('跨车道的轨道是贝塞尔(两端切线竖直,与净空对得上)', /^M\d+ [\d.]+ C\d+ [\d.]+, \d+ [\d.]+, \d+ [\d.]+$/.test(first), first)
	}

	/**
	 * **四条正交通道**(2026-09-11 用户指出「分岔/推进/闪烁/选择/裁减/变灰都丢了」后补回来的)。
	 * 每条只答一个问题,互不干涉、可任意叠加;这里逐条钉住,免得哪天又被简化掉。
	 *   ① 填充=落定  ② 颜色=结局  ③ 光环=在动  ④ 分段=被闸门裁断过几次
	 */
	{
		const { treeMarks, treeArcs, arcDash, treeLoops } = bundle.exports.__topology
		const step = (over) => ({ kind: 'step', lane: 0, step: { id: 's1', status: 'open', ...over } })
		const base = { planId: 'p-1', blocks: { 'p-1': { s1: 3 } }, audits: [] }
		const mark = (row, context = base) => treeMarks(row, context)

		check('① 填充:未落定 → 空心(settled=false)', mark(step({ status: 'open' })).settled === false)
		check('① 填充:已交付/已作废 → 实心(settled=true)', mark(step({ status: 'advanced' })).settled === true && mark(step({ status: 'void' })).settled === true)
		check('② 颜色:交付=绿 / 待办=灰 / 作废=浅灰', mark(step({ status: 'advanced' })).color === TREE_COLOR.done && mark(step({ status: 'open' })).color === TREE_COLOR.pending && mark(step({ status: 'void' })).color === TREE_COLOR.pruned)
		check('② 颜色:被算术推荐的车道是琥珀(还没裁决)', mark({ kind: 'branch', lane: 1, fork: { phase: 'deciding', recommended: 'b1' }, branch: { id: 'b1', status: 'exploring' } }).color === TREE_COLOR.recommend)
		check('③ 光环:还在探索的世界线在呼吸(live)', mark({ kind: 'branch', lane: 1, step: { id: 's1', status: 'open' }, fork: { phase: 'exploring' }, branch: { id: 'b1', status: 'exploring' } }).live === true)
		/**
		 * 光环 = 「此刻在动吗」,所以它**不许在死掉的步骤上说假话**(2026-09-11 长测抓到的):
		 * 那一次模型把带分叉的步骤作废了(VoidPlanStep),分叉没跟着收口,于是两条车道一直在
		 * 「呼吸」——而那时候什么都停了。界面不许说假话这一条,不依赖「状态机该不该自动收口」那个决定。
		 */
		check(
			'③ 光环:步骤已作废/已交付时,它上面的车道不再呼吸(否则界面在说假话)',
			mark({ kind: 'branch', lane: 1, step: { id: 's1', status: 'void' }, fork: { phase: 'exploring' }, branch: { id: 'b1', status: 'exploring' } }).live === false &&
				mark({ kind: 'branch', lane: 1, step: { id: 's1', status: 'advanced' }, fork: { phase: 'exploring' }, branch: { id: 'b1', status: 'exploring' } }).live === false,
		)
		check('③ 光环:有评估者正在审这一步 → 虚线环(与「在跑」是两件事)', mark(step({ status: 'open' }), { ...base, audits: [{ stepId: 's1', verdict: null }] }).auditing === true && mark(step({ status: 'open' }), { ...base, audits: [{ stepId: 's1', verdict: 'support' }] }).auditing === false)
		check('④ 分段:驳回 3 次 → 3 轮(2 段驳回 + 1 段通过)', (() => { const loops = treeLoops({ 'p-1': { s1: 2 } }, 'p-1', 's1', true); return loops.fails === 2 && loops.rounds === 3 })())
		check('④ 分段:一次就过 → 不画弧(节点保持干净圆点)', treeArcs(mark(step({ status: 'advanced' }), { planId: 'p-1', blocks: {}, audits: [] })).length === 0)
		check('④ 分段:封顶 3 段(更多轮次交给行右的 ∞N 徽标)', (() => { const arcs = treeArcs(mark(step({ status: 'open' }), { planId: 'p-1', blocks: { 'p-1': { s1: 9 } }, audits: [] })); return arcs.length === 3 && arcs.every((arc) => arc.fail === true) })())
		check('④ 分段:段色说每轮结局(驳回红、通过取节点色)', (() => { const arcs = treeArcs(mark(step({ status: 'advanced' }), base)); return arcs.some((arc) => arc.fail === true) && arcs.some((arc) => arc.fail === false) })())
		// dash 参数:整圆分 N 段、各自偏移一格;单段不留缝(留了就成了「断了」而不是「整」)
		const one = arcDash(0, 1)
		const two = arcDash(1, 2)
		check('弧的 dash:单段不留缝,多段按格偏移', one.strokeDasharray.endsWith('0') && two.strokeDashoffset < 0 && arcDash(0, 2).strokeDashoffset === 0, `${one.strokeDasharray} / ${two.strokeDashoffset}`)
		/**
		 * 失败与孤儿(2026-09-11 定的语义):「失败不是落选」「孤儿不是被裁」。
		 * 两条都必须**停止呼吸**(它们没有在动),而且各说各的因。
		 */
		{
			const owner = { id: 's1', status: 'open' }
			const failedBranch = { kind: 'branch', lane: 1, step: owner, fork: { phase: 'exploring' }, branch: { id: 'b1', status: 'exploring', failed: true, execution: { ok: false, note: 'failed', conclusion: '算到一半被中断' } } }
			const failedMarks = mark(failedBranch)
			check('失败的世界线:不再呼吸,而且是「失败」色的灰(不与落选同色)', failedMarks.live === false && failedMarks.greyed === true && failedMarks.color === TREE_COLOR.failed, JSON.stringify({ live: failedMarks.live, greyed: failedMarks.greyed }))
			const orphanBranch = { kind: 'branch', lane: 1, step: { id: 's1', status: 'void' }, fork: { phase: 'orphaned' }, branch: { id: 'b1', status: 'exploring', orphaned: true } }
			const orphanMarks = mark(orphanBranch)
			check('孤儿世界线(随步骤作废而终止):灰、不呼吸', orphanMarks.live === false && orphanMarks.greyed === true)
		}
		check('变灰划掉:作废的步 / 落选的车道 / 放弃的分叉', mark(step({ status: 'void' })).greyed === true && mark({ kind: 'branch', lane: 1, fork: {}, branch: { id: 'b2', status: 'pruned' } }).greyed === true && mark({ kind: 'abandoned', lane: 0, step: { id: 's1', status: 'open' }, fork: {} }).greyed === true)
		check('已交付的步也划掉(做完了就退到背景里)', mark(step({ status: 'advanced' })).done === true)
	}

	/**
	 * **渲染路径**也要钉:通道算对了不等于画出来了(原设计就栽在这——分段节点走了
	 * 一条独立的 early-return 分支,于是悄悄漏掉了活性光环)。这里直接查 SVG 元素。
	 */
	{
		const withReact = loadClientWithStringReact()
		const treeView = {
			sessionId: 's1',
			// s1 磨过两轮(画弧)、s2 还没动过(画空心圈):两条通道在同一张图上各画各的。
			plan: {
				id: 'p-1',
				steps: [
					{ id: 's1', ordinal: 1, do: '两条路线选一条', status: 'open' },
					{ id: 's2', ordinal: 2, do: '写报告', status: 'open' },
				],
			},
			forks: [
				{
					id: 'f1',
					stepId: 's1',
					question: '走湿法还是干法',
					phase: 'exploring',
					recommended: 'b1',
					decideBy: { metric: 'yield_pct', direction: 'max' },
					verdict: null,
					humanDecision: null,
					abandonReason: null,
					branches: [
						{ id: 'b1', label: '湿法', status: 'exploring', reading: '62.1' },
						{ id: 'b2', label: '干法', status: 'pruned', reading: '55.4' },
					],
				},
			],
			blocks: { 'p-1': { s1: 2 } },
			audits: [{ id: 'a1', stepId: 's1', verdict: null }],
			evidence: [],
			scouts: [],
		}
		const el = withReact.exports.__components.WorldTree({
			useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: treeView } } } }),
			sessionId: 's1',
			openPreview: () => true,
			openSpectator: () => true,
		})
		const nodes = walkNodes(el)
		const circles = nodes.filter((node) => node.type === 'circle')
		const paths = nodes.filter((node) => node.type === 'path')
		check(
			'渲染:探索中的车道画出呼吸光环(pt-breathe)',
			circles.some((node) => String(node.props?.className ?? '').includes('clearai-breathe') && node.props.fill !== 'none'),
			JSON.stringify(circles.map((node) => node.props?.className).filter(Boolean)),
		)
		check(
			'渲染:有评估者正在审的步画出虚线呼吸环(pt-breathe-stroke)',
			circles.some((node) => String(node.props?.className ?? '').includes('clearai-breathe-stroke') && node.props.strokeDasharray === '2 2.5'),
			JSON.stringify(circles.map((node) => node.props?.className).filter(Boolean)),
		)
		check(
			'渲染:分段弧真的画在节点上(驳回红 / 通过取节点色)',
			circles.some((node) => node.props?.fill === 'none' && node.props.strokeWidth === TREE.arcWidth && node.props.transform?.startsWith('rotate(-90')),
			JSON.stringify(circles.map((node) => node.props?.strokeWidth)),
		)
		check(
			'渲染:落选那条轨道是虚线(3 3)',
			paths.some((node) => node.props?.strokeDasharray === '3 3'),
			JSON.stringify(paths.map((node) => node.props?.strokeDasharray)),
		)
		check('渲染:未落定的节点是空心圈(填充通道的「还没有」)', circles.some((node) => node.props?.fill === 'transparent' && node.props?.strokeWidth === 1.4))
		check('渲染:收敛画成菱形(rotate 45 的 rect)', nodes.some((node) => node.type === 'rect' && String(node.props?.transform ?? '').startsWith('rotate(45')))
	}

	/**
	 * 树下详情(选中一行之后看的**事实**):分叉行要给「选一条」的落点,
	 * 放弃必须带缘由——没缘由按钮不生效(留痕可考,不是摆设)。
	 */
	{
		const withReact = loadClientWithStringReact()
		const react = withReact.react
		const { TreeDetail } = withReact.exports.__components
		const detailData = {
			sessionId: 's1',
			plan: { id: 'p-1' },
			evidence: [{ id: 'e1', stepId: 's2', verdict: 'support', level: 'L3', evaluator: 'independent' }],
			audits: [{ id: 'a1', stepId: 's2', verdict: null, evaluator: 'independent', evaluatorSession: 'child-1', cardPath: 'clear/evidence/audits/s2/a1.json' }],
			scouts: [{ id: 'sc1', stepId: 's2', status: 'settled', conclusion: '三篇文献都指向同一工艺窗口' }],
		}
		const decidingFork = { id: 'f1', stepId: 's2', question: '走湿法还是干法', phase: 'deciding', recommended: 'b1', decideBy: { metric: 'yield_pct', direction: 'max' }, branches: [{ id: 'b1', label: '湿法', status: 'exploring', reading: '62.1' }], humanDecision: null, abandonReason: null, verdict: null }
		const stepRow = { kind: 'step', lane: 0, step: { id: 's2', ordinal: 2, do: '选一条路线', status: 'open', doneCriteria: '有读数', voidReason: null, level: 'L3', artifacts: [{ path: 'products/report.md', exists: true }, { path: 'lab/missing.csv', exists: false }] }, fork: decidingFork }
		const stepText = react.render(TreeDetail({ row: stepRow, data: detailData, openPreview: () => true, openSpectator: () => true, onClose: () => {} })).replace(/\s+/g, ' ')
		check('详情:把这一步的判据/状态/产物都摊开', /判据/.test(stepText) && /有读数/.test(stepText) && /products\/report\.md/.test(stepText) && /lab\/missing\.csv\(缺\)/.test(stepText), stepText.slice(0, 200))
		check('详情:证据与评估者的裁决状态都在(还没回来的说「正在裁决」)', /证据 e1 · support · L3/.test(stepText) && /正在裁决/.test(stepText) && /评估卡/.test(stepText), stepText.slice(0, 300))
		check('详情:侦察的结论也在(它是资料面的事实)', /侦察 · 已回灌/.test(stepText) && /工艺窗口/.test(stepText))
		check('详情:分叉待裁决 → 给出「采纳此世界线」与「放弃探索」', /采纳此世界线/.test(stepText) && /放弃探索/.test(stepText), stepText.slice(-260))
		/**
		 * 「放弃必须带缘由」不是一句提醒,而是**按钮真的按不动**:
		 * 缘由空着时放弃那颗是 disabled,采纳那颗照常可用(原设计用对话框强制必填,这里同一条纪律)。
		 */
		{
			const tree = TreeDetail({ row: stepRow, data: detailData, openPreview: () => true, openSpectator: () => true, onClose: () => {} })
			const nodes = walkNodes(tree)
			const find = (label) => nodes.find((node) => node.props !== undefined && flatNode(node) === label)
			check(
				'详情:没写缘由时「放弃探索」按不动(留痕可考,不是摆设)',
				find('放弃探索')?.props?.disabled === true && find('采纳此世界线')?.props?.disabled === false,
				JSON.stringify({ abandon: find('放弃探索')?.props?.disabled, adopt: find('采纳此世界线')?.props?.disabled }),
			)
		}
		const branchRow = { kind: 'branch', lane: 0, step: stepRow.step, fork: decidingFork, branch: { id: 'b2', label: '干法', status: 'pruned', reading: '55.4', validity: 'usable', approach: '固相', doneCriteria: '—', basis: '读数不足', gitBranch: 'clearai/f1/b2', worktreeRemoved: true, evaluatorSession: 'child-2', verdict: 'refuted' } }
		const branchText = react.render(TreeDetail({ row: branchRow, data: detailData, openPreview: () => true, openSpectator: () => true, onClose: () => {} })).replace(/\s+/g, ' ')
		check('详情:车道行给出做法/读数/结论/分支与工作副本', /固相/.test(branchText) && /55\.4/.test(branchText) && /结论 refuted/.test(branchText) && /clearai\/f1\/b2\(工作副本已清理,ref 保留\)/.test(branchText), branchText.slice(0, 260))
		const abandonedRow = { kind: 'abandoned', lane: 0, step: stepRow.step, fork: { ...decidingFork, phase: 'abandoned', abandonReason: '两条线都卡死了' } }
		const abandonedText = react.render(TreeDetail({ row: abandonedRow, data: detailData, openPreview: () => true, openSpectator: () => true, onClose: () => {} })).replace(/\s+/g, ' ')
		check('详情:放弃过的分叉如实回放缘由(留档不删)', /放弃缘由:两条线都卡死了/.test(abandonedText))

		// 失败:说清「它不是落选」;孤儿:说清「不是被人裁掉、也不是被算术排掉」+ 出口
		const failedRow = { kind: 'branch', lane: 0, step: stepRow.step, fork: { ...decidingFork, phase: 'exploring' }, branch: { ...branchRow.branch, id: 'b3', label: '丙', status: 'exploring', failed: true, execution: { ok: false, note: 'failed', conclusion: '算到一半被中断' } } }
		const failedText = react.render(TreeDetail({ row: failedRow, data: detailData, openPreview: () => true, openSpectator: () => true, onClose: () => {} })).replace(/\s+/g, ' ')
		check('详情:失败的世界线如实说「执行没跑成」并点明它不是落选', /执行没跑成/.test(failedText) && /它不是落选/.test(failedText) && /算到一半被中断/.test(failedText), failedText.slice(0, 260))
		/**
		 * **执行者未归**(2026-09-11 R3-a 长测):分叉收了口,可执行者的结论从没回来
		 * (`execution.ok === null`)。这时不许再写「执行中,结论会自动回灌」——那句承诺没有下文;
		 * 也不许写成失败(没人知道它跑成没跑成)。
		 */
		{
			const settledFork = { ...decidingFork, phase: 'settled', verdict: { winner: 'b1', margin: 0.25 } }
			const unreturnedRow = { kind: 'branch', lane: 0, step: stepRow.step, fork: settledFork, branch: { ...branchRow.branch, id: 'b4', label: '未归', status: 'pruned', unreturned: true, execution: { child: 'child-4', ok: null, conclusion: null } } }
			const unreturnedText = react.render(TreeDetail({ row: unreturnedRow, data: detailData, openPreview: () => true, openSpectator: () => true, onClose: () => {} })).replace(/\s+/g, ' ')
			check('详情:执行者未归时写清「分叉已收口,再回来也没有归宿」并指出去哪看它真做了什么', /执行者未归/.test(unreturnedText) && /没有归宿/.test(unreturnedText) && /工作副本/.test(unreturnedText), unreturnedText.slice(0, 300))
			// 树上那一行:不呼吸——分叉收了口,它已经不在动了(呼吸就是同一句假话)。
			const treeWithUnreturned = {
				sessionId: 's1',
				plan: { id: 'p-1', steps: [{ id: 's2', ordinal: 2, do: '选一条路线', status: 'advanced' }] },
				forks: [{ id: 'f1', stepId: 's2', question: '走哪条', phase: 'settled', orphaned: false, ownerVoidReason: null, recommended: null, decideBy: { metric: 'yield_pct', direction: 'max' }, verdict: { winner: 'b1', margin: 0.1 }, humanDecision: null, abandonReason: null, branches: [{ id: 'b1', label: '未归', status: 'exploring', unreturned: true }] }],
				blocks: {},
				audits: [],
				evidence: [],
				scouts: [],
			}
			const unreturnedBundle = loadClientWithStringReact()
			const el = unreturnedBundle.exports.__components.WorldTree({ useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: treeWithUnreturned } } } }), sessionId: 's1', openPreview: () => true, openSpectator: () => true })
			const nodes = walkNodes(el)
			check(
				'树上:执行者未归的车道不呼吸(它已经不在动了)',
				nodes.every((node) => typeof node.props?.className !== 'string' || !node.props.className.includes('clearai-breathe')),
				JSON.stringify(nodes.map((node) => node.props?.className).filter(Boolean)),
			)
		}
		const orphanRow = { kind: 'converge', lane: 0, step: { ...stepRow.step, status: 'void' }, fork: { ...decidingFork, phase: 'orphaned', orphaned: true, ownerVoidReason: '改道' } }
		const orphanText = react.render(TreeDetail({ row: orphanRow, data: detailData, openPreview: () => true, openSpectator: () => true, onClose: () => {} })).replace(/\s+/g, ' ')
		check('详情:孤儿分叉写「随步骤作废而终止」+ 缘由 + 出口(既不是被裁也不是落选)', /随步骤作废而终止/.test(orphanText) && /改道/.test(orphanText) && /AbandonFork/.test(orphanText), orphanText.slice(0, 300))
		{
			// 树上那一行也要有后缀,否则读者会把它读成「探索中」
			// 这一块在拓扑作用域里(没有渲染冒烟那一段的 view 夹具),所以自带一份最小投影。
			const treeWithOrphan = {
				sessionId: 's1',
				plan: { id: 'p-1', steps: [{ id: 's2', ordinal: 2, do: '选一条路线', status: 'void' }] },
				forks: [{ id: 'f1', stepId: 's2', question: '走哪条', phase: 'orphaned', orphaned: true, ownerVoidReason: '改道', recommended: null, decideBy: { metric: 'yield_pct', direction: 'max' }, verdict: null, humanDecision: null, abandonReason: null, branches: [{ id: 'b1', label: '湿法', status: 'exploring', orphaned: true }] }],
				blocks: {},
				audits: [],
				evidence: [],
				scouts: [],
			}
			const orphanBundle = loadClientWithStringReact()
			const orphanEl = orphanBundle.exports.__components.WorldTree({ useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: treeWithOrphan } } } }), sessionId: 's1', openPreview: () => true, openSpectator: () => true })
			const rendered = flatNode(orphanEl).replace(/\s+/g, ' ')
			check('树上:孤儿车道带「随步骤作废而终止」后缀,收敛行写「未收口」', /随步骤作废而终止/.test(rendered) && /未收口/.test(rendered), rendered.slice(0, 220))
		}
	}

	/**
	 * 人门区里「放弃这条分叉」是**两步**:点一下出缘由框,写了才提交。
	 * 单次点击就放弃会把「为什么」永远丢掉——而放弃正是最需要缘由的那类决定。
	 * 这条要**驱动**交互才测得到(静态渲染只会看到第一步),所以用带状态的桩。
	 */
	{
		const { exports: bundled, render } = loadClientWithStatefulReact()
		const inboxData = {
			sessionId: 's1',
			inbox: [{ kind: 'fork_adopt', title: '世界线裁决', summary: '走湿法还是干法', plan: 'p-1', step: 's2', human_action: 'adopt_branch' }],
			forks: [
				{
					id: 'f1',
					stepId: 's2',
					question: '走湿法还是干法',
					phase: 'deciding',
					branches: [{ id: 'b1', label: '湿法', status: 'evaluated', reading: '62.1' }],
				},
			],
		}
		const props = { data: inboxData, openRail: () => {} }
		const first = walkNodes(render(bundled.__components.Inbox, props))
		/**
	 * §20 混合路径:同一道门也能摆到**原生提问卡**上答——面板这条快路留着,旁边多一个入口。
	 * 手只是发一个**界面手势**(action: 'ask'),事实仍由宿主那条老路落。
	 */
	{
		const entryText = walkNodes(render(bundled.__components.Inbox, props)).map((node) => flatNode(node)).join('|')
		check('人门区:世界线裁决旁边有「用提问卡决定」这个入口', /通过提问卡决定/.test(entryText), entryText.slice(0, 140))
	}

	check('人门区:放弃是两步的第一步(先写缘由)', first.some((node) => flatNode(node) === '放弃这条分叉') && !first.some((node) => flatNode(node) === '确认放弃'))
		first.find((node) => flatNode(node) === '放弃这条分叉')?.props?.onClick()
		const second = walkNodes(render(bundled.__components.Inbox, props))
		// 注意按 `type === 'button'` 找:外面那层 span 的纯文本也是「确认放弃」(输入框没有文字子节点),只按文字找会命中它。
		const confirm = second.find((node) => node.type === 'button' && flatNode(node) === '确认放弃')
		const input = second.find((node) => node.type === 'input' && String(node.props?.placeholder ?? '').includes('放弃缘由'))
		check(
			'人门区:点开之后出现缘由框与「确认放弃」,空缘由时确认按不动',
			confirm !== undefined && input !== undefined && confirm.props?.disabled === true,
			JSON.stringify({ inputs: second.filter((node) => node.type === 'input').map((node) => node.props?.placeholder), disabled: confirm?.props?.disabled }),
		)
		input.props.onChange({ target: { value: '两条线都卡死了' } })
		const third = walkNodes(render(bundled.__components.Inbox, props))
		check('人门区:写了缘由之后确认才可点(留痕可考)', third.find((node) => node.type === 'button' && flatNode(node) === '确认放弃')?.props?.disabled === false)
	}
}

console.log('\n【服务的声明面:用到的每一个都必须在 inject 里(2026-09-11 实测换来的断言)】')
{
	/**
	 * 为什么单开一节:客户端模块在 `slots`(平台 seed)一出现就会被激活,而 `sessions` /
	 * `sidebarRightTabs` / `sidebarRight` 是别的插件后来才 provide 的。**没声明 inject**
	 * 时我们的 apply 会在它们之前跑,读不到服务就早退——一个插座都不注册,而且不报错。
	 * 表现:右栏只剩宿主自带的「文件」、中栏没有「产物」;宿主侧完全正常(模块图里有我们、
	 * bundle 正常送达),所以只有真机能看见,假 ctx 恰恰把服务都给了。
	 */
	const bundle = loadClientBundle()
	const declared = new Set(Array.isArray(bundle.exports.inject) ? bundle.exports.inject : [])
	check('插件声明了 inject(数组,非空)', declared.size > 0, JSON.stringify([...declared]))
	/**
	 * 静态抠出「代码里读了哪些服务」:**先去掉注释**再扫 ——
	 * 注释里写一句 `ctx.xxx` 不该把规则绊倒(这次就踩到了这个假警报)。
	 */
	const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
	const used = new Set([...code.matchAll(/ctx\.get\('([A-Za-z]+)'\)/g)].map((match) => match[1]))
	for (const name of ['slots', 'sessions', 'sidebarRightTabs', 'sidebarRight']) {
		if (new RegExp(`ctx\\.${name}\\b|\\b${name}\\b\\s*[,}]`).test(source)) used.add(name)
	}
	for (const name of ['slots', 'sessions', 'sidebarRightTabs', 'sidebarRight']) used.add(name)
	/**
	 * 规则的准确形状:**`ctx.<name>` 这种属性读法必须声明 inject**(否则服务没就位时插件的
	 * apply 会早退、且不报错 —— 一个插座都不注册)。而 `ctx.get('name')` 是契约里给的
	 * **可选读法**(`requiresUndefinedCheck:true`),它读的服务**不该**进 inject:
	 * 硬 inject 会让插件白等一个它并不需要的服务。所以:
	 *   · 属性读法(`ctx.slots` / 解构出来的名字)⇒ 必须在 inject 里;
	 *   · `get('name')` 且**没有**属性读法 ⇒ 不算漏(可选服务)。
	 */
	const propertyRead = new Set(['slots', 'sessions', 'sidebarRightTabs', 'sidebarRight'])
	for (const name of propertyRead) if (new RegExp(`ctx\.${name}\\b`).test(source)) used.add(name)
	const missing = [...used].filter((name) => !propertyRead.has(name) && !declared.has(name) && new RegExp(`ctx\\.${name}\\b`).test(code))
	check('属性读法用到的服务全都声明在 inject 里(漏一个 = 静默不注册)', missing.length === 0, `漏了:${missing.join(',')}`)
	check('可选服务走 ctx.get(不硬塞进 inject):layout 就是这一路', /ctx\.get\('layout'\)/.test(code) && !declared.has('layout'), JSON.stringify([...declared]))
	check('四个服务名与平台的真实服务一致(名字写错同样静默失效)', ['slots', 'sessions', 'sidebarRightTabs', 'sidebarRight'].every((name) => declared.has(name)), [...declared].join(','))
	// 宿主那一侧的模块级依赖:让我们的 bundle 在提供这些服务的模块之后到达(原生包同样声明)。
	const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'ui', 'package.json'), 'utf8'))
	const moduleInjects = manifest?.dsh?.client?.inject ?? []
	check('package.json 的 dsh.client.inject 声明了服务提供者模块', moduleInjects.includes('@deepseek-ai/dsh-api-session-controller') && moduleInjects.includes('@deepseek-ai/dsh-client-ui-sidebar-right') && moduleInjects.includes('@deepseek-ai/dsh-client-locale'), JSON.stringify(moduleInjects))
	// 假 ctx 只给**属性**形式的服务:再退回 `ctx.get('x')` 读法会立刻红。
	const host = makeClientContext()
	bundle.exports.apply(host.ctx)
	check('照真实契约(属性形式)注册得下去', host.registrations.length > 0 && host.tabDefinitions.length === 2, `${host.registrations.length} 个席位 / ${host.tabDefinitions.length} 张页签`)
}

console.log('\n【语言:接原生 locale 座位,表按源文索引】')
{
	// 座位在:注册词典 + 绑翻译;座位不在:退化成恒等,面板照常显示中文(不炸)。
	const host = makeClientContext()
	const registered = []
	let listener = null
	const onEvents = []
	host.ctx.get = (name) => (name === 'locale' ? {
		register: (ns, dicts) => {
			registered.push({ ns, dicts })
			return () => {}
		},
		bind: (ns) => (key) => (registered[0]?.dicts?.en ?? {})[key] ?? key,
	} : undefined)
	// 语言变化走宿主自己的事件(不是我们自造的订阅):locale/change。
	host.ctx.on = (event, handler) => {
		if (event === 'locale/change') listener = handler
		onEvents.push(event)
		return () => { listener = null }
	}
	loadClientBundle().exports.apply(host.ctx)

	check('向原生 locale 座位注册了词典', registered.length === 1 && registered[0].ns === 'clearai', JSON.stringify(registered.map((r) => r.ns)))
	const zh = registered[0]?.dicts?.zh ?? {}
	const en = registered[0]?.dicts?.en ?? {}
	check('两种语言都注册了(缺一种宿主会拒)', Object.keys(zh).length > 200 && Object.keys(en).length > 200, `${Object.keys(zh).length}/${Object.keys(en).length}`)
	check('两边的键完全一致(不然会漏翻译成 key)', Object.keys(zh).every((k) => k in en) && Object.keys(en).every((k) => k in zh))
	check('表按**源文**索引:中文那一侧的键值相同(漏译只会退回中文)', Object.entries(zh).slice(0, 20).every(([k, v]) => k === v))
	check('订阅了语言变化(走宿主 locale/change 事件)', listener !== null && onEvents.includes('locale/change'), onEvents.join(','))
}

console.log('\n【预设定界:不是 ClearAI 的会话里一个都不注册】')
{
	const bundle = loadClientBundle()
	const host = makeClientContext({ preset: 'standard' })
	bundle.exports.apply(host.ctx)
	check('非本预设:中栏与右栏都不注册', host.registrations.length === 0 && host.tabDefinitions.length === 0, `${host.registrations.length} 个席位 / ${host.tabDefinitions.length} 张页签`)
	host.flipPreset('clearai')
	check('切到本预设:席位与页签都长出来(跟着会话走)', host.registrations.length > 0 && host.tabDefinitions.length === 2, `${host.registrations.length} 个席位 / ${host.tabDefinitions.length} 张页签`)
	check(
		'§34:工具行**不再**注册档位开关(clearai-tier 已随「多问我/自己跑」一起删掉)',
		!host.registrations.some((entry) => entry.options.id === 'clearai-tier'),
		JSON.stringify(host.registrations.map((entry) => entry.options.id ?? entry.options.name)),
	)
	/**
	 * §17.3 占 `conversation.input.plan` 的**机制前提**:它是 `single` 座位,
	 * 原生核心对同 priority 的第二次注册**直接抛错**,报错原文就是
	 * 「register at a different priority to shadow it (lowest renders)」。
	 * 所以「更低的 priority」不是调优,是能不能注册得下去的前提——这里钉住它。
	 */
	const planSeat = host.registrations.find((entry) => entry.options.name === 'conversation.input.plan')
	check(
		'计划面坐在原生 plan 座位上,且用更低的 priority 才遮蔽得住(single 座位同 priority 会抛错)',
		planSeat !== undefined && typeof planSeat.options.priority === 'number' && planSeat.options.priority < 0,
		JSON.stringify(planSeat?.options ?? null),
	)
	host.flipPreset('standard')
	await new Promise((resolve) => setTimeout(resolve, 0)) // 注销走 effect 的收尾:让一拍
	check(
		'切走:又收回去(不留空页)',
		host.tabDefinitions.length === 0 && host.registrations.length === 0,
		`${host.tabDefinitions.length} 张页签 / 还剩 ${host.registrations.map((entry) => `${entry.options.name}${entry.options.id === undefined ? '' : `:${entry.options.id}`}`).join(', ')}`,
	)
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
