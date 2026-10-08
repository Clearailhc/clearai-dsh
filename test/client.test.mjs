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

import { existsSync, readFileSync } from 'node:fs'
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
const VENDOR = join(import.meta.dirname, '..', 'ui', 'vendor', 'xyflow.js')
const VENDOR_FORCE = join(import.meta.dirname, '..', 'ui', 'vendor', 'force.js')
const DEPLOYED = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'web', 'node_modules', 'clearai-dsh', 'lib', 'client.js')
/**
 * **发出去的那一份 = vendor 行 + 主文件**(见 tools/build-package.mjs)。
 * 这里比的就是那个组合——不是「源里有一个文件」而已:xvflow 那一行如果没跟上,
 * 浏览器里就找不到 React Flow,面板会安静地退化成没有图。
 */
/**
 * vendor 是**生成物**(ui/vendor/ 不入库)。没生成时如实跳过,不假装测过——
 * 与「插件没装就跳过」同一条纪律;生成它的命令写在提示里。
 */
if (!existsSync(VENDOR) || !existsSync(VENDOR_FORCE)) {
	console.log('· 跳过客户端套件:ui/vendor/xyflow.js 还没生成(它是生成物,不入库)。')
	console.log('  生成它:node tools/build-vendor.mjs(或 npm run build)')
	process.exit(0)
}
const VENDOR_SOURCE = readFileSync(VENDOR, 'utf8')
const MAIN_SOURCE = readFileSync(SOURCE, 'utf8')
/**
 * **行为测试跑的是主文件**,vendor 由装载器以参数注入一个桩。
 * 为什么不用真的:真库要真 React + 真 DOM(它坏了也不是我们的 bug),而我们钉的是**适配层**。
 * 另外:vendor 里那句 `function __clearaiXyflow` 是**函数声明**——它会覆盖同名参数,
 * 所以「拼在一起再注入」这条路根本走不通(试过,真库被跑起来、撞在桩 React 上)。
 */
const source = MAIN_SOURCE
/** **部署件比对**用的是 build 真正拼出来的那一份(vendor 在前、主文件在后)。 */
const expectedDeployed = `${VENDOR_SOURCE}\n${readFileSync(VENDOR_FORCE, 'utf8')}\n${MAIN_SOURCE}`
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
if (deployed !== expectedDeployed) {
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
	const evaluate = new Function('window', 'require', 'console', '__clearaiXyflow', '__clearaiForce', source)
	evaluate(globalThis.window, require, console, () => makeXyflowStub(React.createElement))
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
	/**
	 * 会话列表快照:形状**照抄宿主**(`SessionListState`)——`{ ids, byId, phase, projectionsBySession }`,
	 * **没有 `current`**;谁是「当前会话」由 `byId` 行上的 `retainedBy.mainView` 表达。
	 *
	 * 旧桩自己造了一个 `current: 's1'`,于是 240 条检查全绿,而真宿主上四个面板**静默消失**:
	 * 我们的客户端半读的正是那个字段,而它早就不存在了。桩必须与宿主同形,否则测的是桩不是产品。
	 */
	const snapshot = {
		ids: ['s1'],
		byId: { s1: { id: 's1', retainedBy: { mainView: 1 }, projectionValues: { agentPreset: preset } } },
		phase: 'ready',
		projectionsBySession: {},
	}
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
	
	/**
	 * §35:输入框下那条**不再注册** —— 它的话与原生目标提示、与计划 chip 重复 ✗,
	 * 却独占一行把输入框顶上去 ✗。可点的那件事已经并进工具行的计划 chip。
	 */
	check('输入框下不再挂我们的条(§35:整行让出来)', seat('conversation.composer.dock').length === 0, seat('conversation.composer.dock').map((entry) => entry.options.id).join(','))

	/**
	 * 0.5.1:右栏不再注册页签——世界树并入探索货架的「过程记录」。
	 * 中栏两格:探索(过程)紧挨本体(结果),探索排在前面。
	 */
	check('右栏不再注册页签(世界树并入探索货架)', host.tabDefinitions.length === 0 && seat('sidebar.right.pane.tab').length === 0, JSON.stringify(host.tabDefinitions.map((definition) => definition.kind)))
	const views = seat('conversation.view').map((entry) => entry.options)
	check('中栏两格:探索在本体之前', views.length === 2 && views[0].id === 'clearai-explore' && views[1].id === 'clearai-facts' && views[0].order < views[1].order, JSON.stringify(views.map((view) => [view.id, view.order])))
	check('注册前先 inject 了插座(不硬塞)', host.injections.includes('conversation.view') && host.injections.includes('conversation.input.plan'), host.injections.join(','))
	{
		// 我们自己的标记仍然在(留给面板自己的位置用):画面要对 —— 开口的 c + 一颗事实点。
		const mark = bundle.exports.__components?.ClearAIMark
		const svg = typeof mark === 'function' ? mark({ size: 14 }) : null
		const kids = svg?.children ?? []
		check('主标记组件在,画面是开口的 c + 一颗事实点(emerald)', typeof mark === 'function' && svg.props?.viewBox === '0 0 1024 1024' && kids.length === 2 && kids[1].props?.fill === '#10B981' && kids[0].props?.strokeDasharray === '270 90')
	}
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
		/**
		 * `forwardRef` / `memo` 是**对象**(带 render),不是函数——真 React 会调它们的 render。
		 * 字符串桩照做:不然 React Flow 那种形状的组件在这条渲染路径上会**静默消失**,
		 * 「节点标签在不在」这类断言就会假红(而它其实是好的)。
		 */
		if (typeof node === 'object' && node.type !== null && typeof node.type === 'object' && typeof node.type.render === 'function') {
			const produced = node.type.render({ ...(node.props ?? {}), children: node.children })
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
	new Function('window', 'require', 'console', '__clearaiXyflow', '__clearaiForce', source)(globalThis.window, require, console, () => makeXyflowStub(react.createElement), makeForceStub())
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
	/**
	 * `forwardRef` / `memo` 是**对象**(带 render),不是函数——真 React 会调它们的 render。
	 * 渲染桩照做:不然「形状跟真库一致」的桩就没法被测到。
	 */
	if (node.type !== null && typeof node.type === 'object' && typeof node.type.render === 'function') return expandTree(node.type.render({ ...(node.props ?? {}), children: node.children }))
	return { ...node, children: (node.children ?? []).map(expandTree) }
}

function flatNode(node) {
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(flatNode).join('')
	if (node === null || node === undefined) return ''
	return (node.children ?? []).map(flatNode).join('')
}

/**
 * **React Flow 桩**:渲染成一个带名字的元素,把 `nodes` / `edges` 原样留在 props 上。
 *
 * 为什么不用真的库:测试要钉的是**适配层**(投影 → React Flow 的 nodes/edges、
 * 点击回调是不是接到了 Inspector),不是库自己怎么画。真库要 webgl/hooks,
 * 在这类渲染桩里跑不动,而且它坏了也不是我们的 bug。
 * 真的那一份走 `ui/vendor/xyflow.js`(build 时打进 client.js),另有断言钉住它。
 */
function makeXyflowStub(h) {
	const element = (name) => (props) => {
		const children = props?.children === undefined ? [] : Array.isArray(props.children) ? props.children : [props.children]
		/**
		 * 真库会把每个节点的 label 画在画布上。桩照做——于是「节点标签在不在」
		 * 这类断言验的仍然是**用户看得见的东西**,而不是 props 里的一个字段。
		 */
		const labels = name === 'react-flow' && Array.isArray(props?.nodes) ? props.nodes.map((node, index) => h('span', { key: `label-${index}` }, String(node?.data?.label ?? ''))) : []
		return h(name, props, ...children, ...labels)
	}
	/**
	 * **形状必须跟真库一致**:v12 的 `ReactFlow` 是 `forwardRef` 对象、
	 * `Controls`/`MiniMap`/`Background` 是 `memo` 对象——**都不是函数**。
	 * 桩当初全给函数,于是「按 typeof 判组件在不在」那个错把真机判成不可用、而测试全绿。
	 * 这里用一个 `$$typeof` 标记的对象复现真形状,让同类错在测试里就红。
	 */
	const component = (name, tag) => ({ $$typeof: Symbol.for(name), render: element(tag) })
	return {
		ReactFlow: component('react.forward_ref', 'react-flow'),
		Controls: component('react.memo', 'rf-controls'),
		MiniMap: component('react.memo', 'rf-minimap'),
		Background: component('react.memo', 'rf-background'),
	}
}

/**
 * **力导向桩**:把每个节点按插入顺序摆到一条确定的对角线上。
 *
 * 布局质量属于**库**(FA2)与真浏览器检查,不是这一层要验的东西;这里只钉两件事:
 * 它**被调用过**,而且它的返回值**真的进了节点 position**。
 * 桩确定且可断言——「同一份账本 ⇒ 同一张图」这条因此仍能在这层验。
 */
function makeForceStub() {
	class Graph {
		constructor() {
			this.nodes = new Map()
			this.order = []
		}
		addNode(id, attributes) {
			this.nodes.set(id, { ...attributes })
			this.order.push(id)
		}
		hasNode(id) {
			return this.nodes.has(id)
		}
		addEdge() {}
		getNodeAttribute(id, key) {
			const index = this.order.indexOf(id)
			return key === 'x' ? 40 * index : key === 'y' ? 30 * index : undefined
		}
	}
	return { Graph, forceAtlas2: { assign() {} } }
}

/**
 * 带状态的 React 桩:同一批状态可以**反复渲染**,于是「点一下 → 再画一遍」这件事可测。
 * 用在需要两步交互的地方(比如「撤回要留缘由」:先点开输入框,写了才提交)。
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
	new Function('window', 'require', 'console', '__clearaiXyflow', '__clearaiForce', source)(globalThis.window, require, console, () => makeXyflowStub(react.createElement), makeForceStub())
	delete globalThis.window
	const exports = registration.factory(require)
	return { exports, react, render: (component, props) => { react.reset(); return component(props) } }
}

/**
 * 载入 bundle,但**不给** vendor 函数(模拟 ui/vendor/xyflow.js 没打进来):
 * 用来钉「降级要如实、不要崩,而且要说出原因」——build 拼装掉了、或包不完整时会走到这条路。
 */
function loadClientBundleWithoutXyflow() {
	let registration = null
	globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
	const react = makeStringReact()
	const require = (name) => {
		if (name === 'react') return react
		if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
		throw new Error(`client bundle 不该 require "${name}"`)
	}
	/** 这里**故意不注入**:客户端应当走如实降级那条路,而不是崩。 */
	new Function('window', 'require', 'console', '__clearaiXyflow', '__clearaiForce', source)(globalThis.window, require, console, undefined, makeForceStub())
	delete globalThis.window
	return { exports: registration.factory(require), react }
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
		new Function('window', 'require', 'console', '__clearaiXyflow', '__clearaiForce', source)(globalThis.window, require, console, () => makeXyflowStub(react.createElement), makeForceStub())
		delete globalThis.window
		return { exports: registration.factory(require), react }
	}
	bundle = load()
	const { exports, react } = bundle
	const components = exports.__components
	
	check('对象的人话名字表也在缝上(交叉校验要用它:声明里每个对象都得有名字)', components.LOOP_LABEL !== undefined && components.LOOP_LABEL.hypothesis === '命题' && components.LOOP_LABEL.fact === '事实')
	check('不再有自建预览组件(预览交给 DSH 原生文档预览)', components.PreviewTab === undefined)
	/** 真 DSH 里实测:图组件的样式表也带 data-plugin="clearai-dsh",按包名判「已挂过」会让面板 CSS 整张不挂。 */
	check('面板样式表按自己的标记查重(不被图组件那张挡住)', source.includes(`style[data-plugin="clearai-dsh"][data-clearai="panel"]`) && source.includes(`tag.dataset.clearai = 'panel'`))

	const view = {
		sessionId: 's1',
		goal: { id: 'g1', claim: '催化剂 A 是否优于 B', doneCriteria: '均值差 ≥ 5%', status: 'open', phase: 'executing', progress: 0.5, revision: 2, hypotheses: [] },
		/**
		 * 判据逐条的**同一份**(`knowledgeView`):面板与运行态卡读它,面板不再自己拼一套。
		 * 这一份在真宿主里由 `fold.view()` 挂出来;测试里给的就是那个形状。
		 */
		knowledgeView: {
			goal: {
				id: 'g1',
				criteriaLines: ['均值差 ≥ 5%', '留出集实测有读数', '语料每条带可追溯出处'],
				criteriaTotal: 3,
				criteriaNote: '口径可随复核改',
				criteriaChanged: true,
				criteriaHistory: [{ revision: 1, audit: 'audit-7' }],
				docPath: 'clear/goals/g1.md',
			},
		},
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
		needYou: [{ kind: 'plan_blocked', text: '计划卡住了:产物没落盘' }],
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
	
	check('待处理的那一句在世界树里(只陈述)', /待处理/.test(treePanel) && /计划卡住了/.test(treePanel), treePanel.slice(0, 120))
	check('世界树不再重复闭环那一格的东西(假设/观测/事实不在这)', !/观测 ·/.test(treePanel) && !/事实 · 1/.test(treePanel), treePanel.slice(0, 160))
	/**
	 * **判据逐条**:`Frame` 收的是 `criteria: string[]`(每条一句话、每条可清点),
	 * 挤成一句「判据:均值差…」会把「第 3 条没做到」抹平。面板与**运行态卡读同一份**
	 * (`knowledgeView.goal.criteriaLines`),所以这里断言的是那份投影在屏上的形状:
	 * 序号、修订史与谁裁的、全文指针、以及哪一段不参与判定。
	 */
	check('目标那块把判据逐条列出来(带序号,不是压成一句)', /1\. 均值差 ≥ 5%/.test(treePanel) && /2\. 留出集实测有读数/.test(treePanel) && /3\. 语料每条带可追溯出处/.test(treePanel), treePanel.slice(0, 220))
	check('判据小节标出条数、修订几次与最近一次独立裁决', /判据 · 3/.test(treePanel) && /已修订 1 次/.test(treePanel) && /audit-7/.test(treePanel), treePanel.slice(0, 220))
	check('判据小节给出全文指引(沿用目标文档那条既有做法)', /全文在 clear\/goals\/g1\.md/.test(text(components.WorldTree, { openPreview: () => true })), treePanel.slice(0, 240))
	check('criteria_note 单独标成不参与判定的背景', /背景\(不参与判定\)/.test(treePanel) && /口径可随复核改/.test(treePanel), treePanel.slice(0, 260))
	/** 投影里没有逐条那一份(旧宿主 / 这个字段出现之前的目标)时:退回原来那句摘要,不空白、不另拼一套。 */
	const noCriteria = { ...view, knowledgeView: undefined }
	const fallbackPanel = react
		.render(components.WorldTree({ useProjection: () => noCriteria, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: noCriteria } } } }), sessionId: 's1', openRail: () => {}, openSpectator: () => {}, openPreview: () => true }))
		.replace(/\s+/g, ' ')
	check('拿不到逐条那一份:退回一句摘要 + 全文进 tooltip(旧投影不被新语义打空)', /判据:均值差 ≥ 5%/.test(fallbackPanel) && !/背景\(不参与判定\)/.test(fallbackPanel), fallbackPanel.slice(0, 160))
	/** `criteria: []`(立了目标但清单空)与「没有这一份」同一处置:不许显示一个「判据 · 0」的小节。 */
	const emptyList = { ...view, knowledgeView: { goal: { ...view.knowledgeView.goal, criteriaLines: [], criteriaTotal: 0 } } }
	const emptyPanel = react
		.render(components.WorldTree({ useProjection: () => emptyList, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: emptyList } } } }), sessionId: 's1', openRail: () => {}, openSpectator: () => {}, openPreview: () => true }))
		.replace(/\s+/g, ' ')
	check('判据清单是空数组:退回摘要,不出现「判据 · 0」小节', /判据:均值差 ≥ 5%/.test(emptyPanel) && !/判据 · 0/.test(emptyPanel), emptyPanel.slice(0, 160))

	/**
	 * 第六阶段「本体」那一格:**图为主**,下面一行一条结论。
	 *
	 * 判据都是"用户能不能一眼答上来":
	 *   · 页眉说在回答什么、一行计数、待处理、四站进度轨(判断 → 检验 → 已验证 → 入本体);
	 *   · 结论按可信度分组(已验证 / 待核验 / 验证中 / 不确定 / 已推翻 / 已替换),一行一条;
	 *   · 点开依次是 进度 → 可信度怎么变的 → 补充;
	 *   · 内部编号(h-… / e-… / s-…)与机器词(support / refute / proposed)不上屏。
	 */
	{
		const atlasView = {
			...view,
			needYou: [{ kind: 'conflict', text: '炉次 B1的氧含量:「8 ppm」和「12 ppm」矛盾,以哪个为准?' }],
			goal: {
				...view.goal,
				hypotheses: [
					{ id: 'h-aa11', name: 'A 优于 B', claim: '催化剂 A 的产率比 B 高 5% 以上', refuteWhen: '均值差 < 5%', status: 'alive', trust: 'credible', supportedLevel: 'L3', history: [
						{ kind: 'proposed', at: 1, to: 'testing' },
						{ kind: 'evidence', id: 'e-1', at: 10, ordinal: 1, verdict: 'support', level: 'L3', evaluator: 'independent', basis: '三种方法同根', from: 'testing', to: 'credible' },
					] },
					{ id: 'h-bb22', name: '二分更省', claim: '二分法比牛顿法省求值', refuteWhen: '牛顿更少', status: 'refuted', trust: 'refuted', supportedLevel: null, history: [
						{ kind: 'proposed', at: 2, to: 'testing' },
						{ kind: 'evidence', id: 'e-2', at: 20, ordinal: 3, verdict: 'refute', level: 'L3', evaluator: 'independent', basis: '牛顿 6 次 < 二分 41 次', from: 'testing', to: 'refuted' },
					] },
					{ id: 'h-cc33', name: '温度无关', claim: '产率与温度无关', refuteWhen: '相关系数 > 0.3', status: 'proposed', trust: 'testing', supportedLevel: null, history: [{ kind: 'proposed', at: 3, to: 'testing' }] },
					{ id: 'h-dd44', name: '学习率敏感', claim: '学习率扫一遍结果差很多', refuteWhen: '差异 < 1%', status: 'alive', trust: 'unclear', supportedLevel: null, history: [
						{ kind: 'proposed', at: 4, to: 'testing' },
						{ kind: 'evidence', id: 'e-3', at: 30, ordinal: 4, verdict: 'inconclusive', level: 'L2', evaluator: 'self', basis: '噪声太大', from: 'testing', to: 'unclear' },
					] },
				],
			},
			evidence: [
				{ id: 'e-1', stepId: 's1', planId: 'p-1', verdict: 'support', level: 'L3', evaluator: 'independent', basis: '三种方法同根', refs: ['lab/a.csv'], origins: [{ kind: 'audit-card', path: 'clear/evidence/audits/s1/run-1.json' }], at: 10 },
			],
			facts: [{ id: 'f-1', hypothesis: 'h-aa11', text: '催化剂 A 的产率比 B 高 5% 以上', scope: '均值差 < 5%', level: 'L3', evidenceIds: ['e-1'], path: 'clear/knowledge/facts/g1.md', at: 40, assertions: [{ predicate: 'yield', subject: { id: 'cat_a', type: 'catalyst' }, object: { kind: 'quantity', value: 62, unit: '%' } }] }],
			lexicon: {
				terms: [], predicates: [], conflicts: [], health: [],
				graph: {
					nodes: [
						{ id: 'term:catalyst', kind: 'concept', layer: 'ontology', ref: 'catalyst', label: '催化剂', status: 'admitted', x: 0, y: 0 },
						{ id: 'form:quantity', kind: 'value_type', layer: 'ontology', ref: 'quantity', label: 'quantity', status: 'admitted', x: 0, y: 100 },
						{ id: 'catalyst|cat_a', kind: 'instance', layer: 'entity', ref: 'cat_a', label: '催化剂 A', type: 'catalyst', status: 'live', facts: ['f-1'], x: 0, y: 200 },
					],
					edges: [{ id: 'predicate:yield', kind: 'predicate', layer: 'ontology', predicate: 'yield', label: '产率', from: 'term:catalyst', to: 'form:quantity', status: 'admitted' }],
					bounds: { width: 400, height: 300 },
				},
			},
		}
		const atlasProjection = (key) => (key === 'clearai' ? atlasView : undefined)
		const atlas = react.render(components.Atlas({ useProjection: atlasProjection, sessionId: 's1', openPreview: () => {} })).replace(/\s+/g, ' ')
		/** 0.5.1:判断的计数、进度轨与全部判断移到探索货架的「过程记录」;本体货架只放结果。 */
		const explore = (extra = {}) => react.render(components.ExploreView({ useProjection: atlasProjection, sessionId: 's1', openPreview: () => {}, ...extra })).replace(/\s+/g, ' ')
		const exploreOpen = (() => {
			const realState = react.useState
			react.useState = (initial) => [initial === false ? true : initial, () => {}]
			try {
				return explore()
			} finally {
				react.useState = realState
			}
		})()
		check('本体货架页眉:说在回答什么(目标那句)', atlas.includes('催化剂 A 是否优于 B'), atlas.slice(0, 120))
		check('本体货架只列已确立的事实(推翻的、在验的不在这里)', atlas.includes('已确立的事实') && atlas.includes('A 优于 B') && !atlas.includes('二分更省') && !atlas.includes('温度无关'), atlas.slice(-300))
		check('探索货架:待您处理那一句只陈述(没有按钮)', exploreOpen.includes('待您处理(1)') && exploreOpen.includes('以哪个为准'), exploreOpen.slice(0, 260))
		check('过程记录:一行计数用状态词', /已验证 1 · 验证中 1 · 不确定 1 · 已推翻 1/.test(exploreOpen), exploreOpen.slice(0, 400))
		check('过程记录:四站进度轨带每站人数', /判断 4/.test(exploreOpen) && /检验 3/.test(exploreOpen) && /已验证 1/.test(exploreOpen) && /纳入本体 1/.test(exploreOpen), exploreOpen.slice(0, 500))
		check('图带:本体图 / 实体图二选一,带各层点数', atlas.includes('本体图 2') && atlas.includes('实体图 1'), atlas.slice(0, 400))
		check('过程记录里判断按可信度分组,一行一条短名', exploreOpen.includes('A 优于 B') && exploreOpen.includes('二分更省') && exploreOpen.includes('温度无关') && exploreOpen.includes('学习率敏感'))
		check('判断行带「第几步」,不摆内部编号', exploreOpen.includes('第 3 步') && !/h-aa11|h-bb22|e-1|\bs1\b|f-1/.test(exploreOpen), exploreOpen.slice(-400))
		check('过程记录默认折叠:只给一行摘要', !explore().includes('二分更省') && explore().includes('过程记录'), explore().slice(-200))
		check('不出现机器词(support / refute / proposed / alive)', !/\bsupport\b|\brefute\b|\bproposed\b|\balive\b/.test(atlas + exploreOpen))
		check('不再出现旧用词(站住 / 已确认 / 在验 / 世界树)', !/站住|已确认|在验|世界树/.test(atlas + exploreOpen))
		check('本体图上值的形态说人话(quantity → 数值)', !atlas.includes('quantity'), atlas.slice(0, 400))

		/** 0.5.1 探索货架:问题、候选与各自预测、新发现的问题(按钮只替人发话)、结论卡。 */
		const exploring = {
			...atlasView,
			goal: {
				...atlasView.goal,
				answers: [
					{ question: 'q1', conclusion: '选 A', basis: ['三种方法同根'], open: [{ about: ['h-bb22'], effect: '若温度相关,A 的优势可能缩小' }], decide: ['是否进入中试'] },
					{ question: 'q2', conclusion: '', basis: [], open: [], decide: [], unanswered: '预算用尽' },
				],
			},
			plan: { ...(atlasView.plan ?? {}), id: 'p-1', totalCount: 3, advancedCount: 1, steps: atlasView.plan?.steps ?? [] },
			exploration: {
				mode: 'solve',
				current: 'q1',
				areas: [],
				questions: [
					{ id: 'q1', text: '催化剂 A 是否优于 B', status: 'open', implicit: false, area: null, counts: { examining: 2 }, candidates: [
						{ id: 'h-x1', name: '温度主导', claim: '温度主导', state: 'examining', from: null, refuteWhen: null, refutations: 0, inconclusive: 0 },
						{ id: 'h-x2', name: '配比主导', claim: '配比主导', state: 'examining', from: null, refuteWhen: null, refutations: 0, inconclusive: 0 },
					] },
					{ id: 'q2', text: '副产物从哪一步产生', status: 'emergent', implicit: false, area: null, counts: {}, candidates: [] },
				],
				next: { ordinal: 2, do: '在两档温度下各测一次', predictions: [{ hypothesis: 'h-x1', name: '温度主导', expect: '产率相差 > 5%' }, { hypothesis: 'h-x2', name: '配比主导', expect: '产率相差 > 5%' }], indistinct: true },
			},
		}
		const sentTexts = []
		const exploreText = react.render(components.ExploreView({ useProjection: (key) => (key === 'clearai' ? exploring : undefined), sessionId: 's1', send: (text) => (sentTexts.push(text), true) })).replace(/\s+/g, ' ')
		check('探索货架:问题与候选假设、当前问题标在页眉', exploreText.includes('问题 1') && exploreText.includes('温度主导') && exploreText.includes('当前问题 1 / 共 2'), exploreText.slice(0, 300))
		check('下一步按候选列出预测;预测相同如实说区分不了', exploreText.includes('若「温度主导」成立,预测') && exploreText.includes('各候选假设的预测相同,此步骤无法区分它们'), exploreText)
		const nextText = react.render(components.NextBox({ next: { ...exploring.exploration.next, indistinct: false } })).replace(/\s+/g, ' ')
		check('预测不同:不出警告,只说如何调整', !nextText.includes('无法区分') && nextText.includes('如需调整计划'), nextText)
		check('新发现的问题带「立为问题 / 暂缓」两个按钮', exploreText.includes('新发现的问题') && exploreText.includes('立为问题') && exploreText.includes('暂缓'), exploreText)
		const findButtons = (node, out = []) => {
			if (node === null || typeof node !== 'object') return out
			if (Array.isArray(node)) {
				node.forEach((child) => findButtons(child, out))
				return out
			}
			if (node.type === 'button') out.push(node)
			if (typeof node.type === 'function') findButtons(node.type({ ...(node.props ?? {}), children: node.children }), out)
			findButtons(node.children, out)
			return out
		}
		const outcomes = []
		const emergentButtons = findButtons(components.EmergentActions({ question: exploring.exploration.questions[1], send: (text) => (sentTexts.push(text), true), sent: {}, onSent: (id, kind) => outcomes.push([id, kind]) }))
		emergentButtons.find((button) => String(button.children).includes('立为问题'))?.props.onClick()
		check('「立为问题」只发一句话给模型(界面不改状态)', sentTexts.some((text) => text.includes('副产物从哪一步产生') && text.includes('立为问题')) && outcomes.some(([id, kind]) => id === 'q2' && kind === 'pursue'), JSON.stringify({ sentTexts, outcomes }))
		const failedOutcomes = []
		findButtons(components.EmergentActions({ question: exploring.exploration.questions[1], send: undefined, sent: {}, onSent: (id, kind) => failedOutcomes.push(kind) }))
			.find((button) => String(button.children).includes('暂缓'))
			?.props.onClick()
		check('发不出去时如实记为失败(不假装发了)', failedOutcomes[0] === 'failed', JSON.stringify(failedOutcomes))
		const answersText = react.render(components.AnswerCards({ data: exploring, openExplore: () => {} })).replace(/\s+/g, ' ')
		check('结论卡四部分:结论 / 依据 / 尚未确定的事项 / 待您决策', ['结论', '选 A', '依据', '三种方法同根', '尚未确定的事项', 'A 的优势可能缩小', '待您决策', '是否进入中试', '查看探索记录'].every((word) => answersText.includes(word)), answersText)
		check('多个问题时按问题切换', answersText.includes('问题 1') && answersText.includes('问题 2'), answersText.slice(0, 120))
		const atlasWithAnswers = react.render(components.Atlas({ useProjection: (key) => (key === 'clearai' ? exploring : undefined), sessionId: 's1', openPreview: () => {} })).replace(/\s+/g, ' ')
		check('本体货架带出结论卡', atlasWithAnswers.includes('待您决策') && atlasWithAnswers.includes('选 A'), atlasWithAnswers.slice(0, 300))
		const chipText = (projection) => react.render(components.PlanChip({ useProjection: () => projection })).replace(/\s+/g, ' ')
		check('计划芯片:求解时写「问题 i/n · 待检验假设 k 个」', chipText(exploring).includes('问题 1/2 · 待检验假设 2 个'), chipText(exploring))
		const surveying = { ...exploring, exploration: { ...exploring.exploration, mode: 'survey', areas: [{ id: 'a1', name: '工艺', state: 'clear', judgments: 2, verified: 1, openAnomalies: 0 }, { id: 'a2', name: '原料', state: 'in_progress', judgments: 1, verified: 0, openAnomalies: 1 }] } }
		check('计划芯片:调研时写「板块 已厘清/总数」与待您决定的问题数', chipText(surveying).includes('板块 1/2 · 1 个问题待您决定'), chipText(surveying))

		const props = bundle.exports.__propositions
		const rows = props.conclusionsOf(atlasView)
		const byName = (name) => rows.find((row) => row.name === name)
		check('结论模型:每条判断一行,状态取自宿主算好的 trust', rows.length === 4 && byName('A 优于 B').trust === 'credible' && byName('二分更省').trust === 'refuted', JSON.stringify(rows.map((row) => [row.name, row.trust])))
		check('站位:写进长期知识 = 4,推翻停在检验 = 2,只提出 = 1,检验过 = 2', byName('A 优于 B').station === 4 && byName('二分更省').station === 2 && byName('温度无关').station === 1 && byName('学习率敏感').station === 2)
		check('结论行带出处那一步与依据', byName('A 优于 B').step === 1 && byName('A 优于 B').basis === '三种方法同根' && byName('A 优于 B').fact === 'f-1')
		const legacy = props.conclusionsOf({ goal: null, facts: [{ id: 'f-old', text: '旧账本里的事实', scope: null, level: 'L3', evidenceIds: [], at: 1 }] })
		check('旧账本里没有判断关联的事实也各占一行(已验证、入本体)', legacy.length === 1 && legacy[0].trust === 'credible' && legacy[0].station === 4, JSON.stringify(legacy))

		/** 点开一条:进度 → 可信度怎么变的 → 补充(直接渲染展开区;行的展开状态是组件自己的 useState)。 */
		const opened = react.render(components.ConclusionDetail({ row: byName('A 优于 B'), data: atlasView, onFocus: () => {} })).replace(/\s+/g, ' ')
		const order = ['进度', '可信度变化', '补充说明'].map((word) => opened.indexOf(word))
		check('展开区三段依次是 进度 → 可信度变化 → 补充说明', order.every((at) => at >= 0) && order[0] < order[1] && order[1] < order[2], opened.slice(0, 200))
		check('可信度的每一笔:第几步 · 支持 · 独立核验 · 之前 → 之后', /第 1 步:支持 · 独立核验 · 验证中 → 已验证/.test(opened), opened.slice(0, 400))
		check('补充说明里有 依据 / 推翻条件 / 相关 / 来源(范围与推翻条件相同就不重复)', opened.includes('依据') && opened.includes('推翻条件') && opened.includes('相关') && opened.includes('来源') && !opened.includes('范围'), opened.slice(-400))
		check('相关里用实例在图上的名字,而不是 id', opened.includes('催化剂 A') && !opened.includes('cat_a'), opened.slice(-300))
		check('依据带「查看核验」入口', opened.includes('查看核验'))
		{
			const calls = []
			const el = components.ConclusionDetail({ row: byName('A 优于 B'), data: { ...atlasView, openPreview: (path) => calls.push(path) }, onFocus: () => {} })
			const link = walkNodes(expandTree(el)).find((node) => node.props?.onClick !== undefined && String(node.props?.title ?? '').includes('audits'))
			link?.props.onClick()
			check('点「查看核验」⇒ 原生预览打开评估卡', calls.some((path) => path.includes('audits/s1/run-1.json')), JSON.stringify(calls))
		}
		const refutedDetail = react.render(components.ConclusionDetail({ row: byName('二分更省'), data: atlasView })).replace(/\s+/g, ' ')
		check('被推翻那条:进度条说清停在哪,不给下一步', refutedDetail.includes('在检验阶段被推翻') && !refutedDetail.includes('下一步'), refutedDetail.slice(0, 300))
		check('被推翻那一笔写「推翻」', /第 3 步:推翻/.test(refutedDetail), refutedDetail.slice(0, 300))
		const pendingDetail = react.render(components.ConclusionDetail({ row: byName('温度无关'), data: atlasView })).replace(/\s+/g, ' ')
		check('还没检验的:时间线末尾给下一步', pendingDetail.includes('下一步:安排步骤对其进行检验'), pendingDetail.slice(0, 300))
		const unclearDetail = react.render(components.ConclusionDetail({ row: byName('学习率敏感'), data: atlasView })).replace(/\s+/g, ' ')
		check('不确定那一笔写「不确定」,自己检验说到了哪一级', /第 4 步:不确定 · 自行检验/.test(unclearDetail), unclearDetail.slice(0, 300))

		// ── 图带 ──
		{
			const emptyGraph = { graph: { nodes: [], edges: [], bounds: { width: 0, height: 0 } }, conflicts: [] }
			const entityEmpty = react.render(components.GraphBand({ lexicon: emptyGraph, layer: 'entity', fullscreen: false, onLayer: () => {}, onToggleFullscreen: () => {}, onFilter: () => {} }))
			check('实体图空态说人话(不点名内部工具)', entityEmpty.includes('实体图暂无内容') && !entityEmpty.includes('RegisterInstance'), entityEmpty.slice(0, 200))
			const unlanded = react.render(components.GraphBand({ lexicon: emptyGraph, layer: 'entity', unlanded: 3, fullscreen: false, onLayer: () => {}, onToggleFullscreen: () => {}, onFilter: () => {} }))
			check('实体图空着但有断言没落地:说清有几个', unlanded.includes('3') && unlanded.includes('尚未建立实体文件'), unlanded.slice(0, 200))
			const ontoEmpty = react.render(components.GraphBand({ lexicon: emptyGraph, layer: 'ontology', fullscreen: false, onLayer: () => {}, onToggleFullscreen: () => {}, onFilter: () => {} }))
			check('本体图空态与实体图可区分', ontoEmpty.includes('本体图暂无内容'), ontoEmpty.slice(0, 200))
			check('本体图空态指向本体文件', ontoEmpty.includes('clear/ontology/concepts/'), ontoEmpty.slice(0, 200))
		}
		{
			/** 目录嵌套就是子图:45 个点(1 根 · 4 枝 · 每枝 10 叶),点多默认收到第一层,跨枝的边改连到枝上。 */
			const node = (id, parent) => ({ id: `term:${id}`, kind: 'concept', layer: 'ontology', ref: id, label: id, status: 'admitted', parent, x: 0, y: 0 })
			const nodes = [node('root', null)]
			for (let branch = 0; branch < 4; branch += 1) {
				nodes.push(node(`b${branch}`, 'root'))
				for (let leaf = 0; leaf < 10; leaf += 1) nodes.push(node(`b${branch}l${leaf}`, `b${branch}`))
			}
			const edges = [
				...nodes.filter((item) => item.parent !== null).map((item) => ({ id: `is_a:${item.ref}`, kind: 'is_a', layer: 'ontology', from: item.id, to: `term:${item.parent}` })),
				{ id: 'rel:x', kind: 'relation', layer: 'ontology', label: '依赖', from: 'term:b0l3', to: 'term:b1l7' },
				{ id: 'rel:y', kind: 'relation', layer: 'ontology', label: '依赖', from: 'term:b0l4', to: 'term:b1l2' },
			]
			const problems = [{ path: 'clear/ontology/relations/bad.json', id: 'bad', code: 'dangling_range', detail: '值域「nope」没有对应的概念文件', severity: 'warning' }]
			const tree = expandTree(components.GraphBand({ lexicon: { graph: { nodes, edges, bounds: { width: 800, height: 600 } }, conflicts: [], problems }, layer: 'ontology', fullscreen: false, sessionId: 's1', onLayer: () => {}, onToggleFullscreen: () => {}, onFilter: () => {} }))
			const flow = walkNodes(tree).find((item) => item.type === 'react-flow')
			check('点多(> 40)默认收到第一层:只剩根和四枝', flow?.props?.nodes?.length === 5, String(flow?.props?.nodes?.length))
			const branchLabel = String(flatNode(walkNodes([flow?.props?.nodes?.find((item) => item.id === 'term:b0')?.data?.label])))
			check('收起的枝标出藏了几个(+10)', branchLabel.includes('+10'), branchLabel)
			const crossing = (flow?.props?.edges ?? []).filter((edge) => edge.source === 'term:b0' && edge.target === 'term:b1')
			check('藏起来的叶子之间的边改连到枝上,同类边去重', crossing.length === 1, JSON.stringify(flow?.props?.edges?.map((edge) => `${edge.source}>${edge.target}`)))
			check('不留自环', (flow?.props?.edges ?? []).every((edge) => edge.source !== edge.target))
			const text = String(flatNode(tree))
			check('读时查出的文件问题列在图下,说清哪个文件', text.includes('本体文件有 1 项问题') && text.includes('clear/ontology/relations/bad.json'), text.slice(-300))
		}
		{
			const many = (count) => Array.from({ length: count }, (_, index) => ({ id: `term:t${String(index).padStart(2, '0')}`, kind: 'concept', layer: 'ontology', ref: `t${index}`, label: `概念${String(index).padStart(2, '0')}`, status: 'admitted', x: (index % 8) * 200, y: Math.floor(index / 8) * 120 }))
			const tree = expandTree(components.GraphBand({ lexicon: { graph: { nodes: many(45), edges: [], bounds: { width: 1600, height: 800 } }, conflicts: [] }, layer: 'ontology', fullscreen: false, sessionId: 's1', onLayer: () => {}, onToggleFullscreen: () => {}, onFilter: () => {} }))
			const flow = walkNodes(tree).find((item) => item.type === 'react-flow')
			check('图交给 React Flow 渲染', flow !== undefined)
			check('组件形状是 forwardRef/memo 对象也要认', typeof components.GraphBand === 'function' && flow !== undefined && !String(flatNode(tree)).includes('图组件不可用'))
			check('适配层不截断:全部节点交出去(视口归库管)', flow?.props?.nodes?.length === 45, String(flow?.props?.nodes?.length))
			check('节点画成星点(点 + 标签),不是方框', String(flatNode(walkNodes([flow?.props?.nodes?.[0]?.data?.label]))).includes('概念00') && flow?.props?.nodes?.[0]?.data?.label?.props?.className === 'clearai-star')
			check('库的零件用上了(Controls / Background;小地图去掉了)', ['rf-controls', 'rf-background'].every((name) => walkNodes(tree).some((item) => item.type === name)) && !walkNodes(tree).some((item) => item.type === 'rf-minimap'))
			check('工具条:本体图 / 实体图 / 图例 / 适配 / 全屏', ['本体图', '实体图', '已验证', '待核验', '适配', '全屏'].every((word) => flatNode(tree).includes(word)))
			check('点击回调交给了库(节点 / 边 / 空白)', typeof flow?.props?.onNodeClick === 'function' && typeof flow?.props?.onEdgeClick === 'function' && typeof flow?.props?.onPaneClick === 'function')
			check('拖动 / 平移 / 缩放由库承担', flow?.props?.nodesDraggable === true && flow?.props?.panOnDrag === true && flow?.props?.zoomOnScroll === true)
			check('没选之前不摆小卡', !flatNode(tree).includes('只看相关'))
		}
		{
			const small = expandTree(components.GraphBand({ lexicon: atlasView.lexicon, layer: 'ontology', fullscreen: false, sessionId: 's1', onLayer: () => {}, onToggleFullscreen: () => {}, onFilter: () => {} }))
			const flow = walkNodes(small).find((item) => item.type === 'react-flow')
			const positions = (flow?.props?.nodes ?? []).map((node) => `${Math.round(node.position.x)},${Math.round(node.position.y)}`)
			check('小图排成一圈(不跑力导向,点不叠在一起)', positions.length === 2 && new Set(positions).size === 2, positions.join(' | '))
		}
		{
			const broken = loadClientBundleWithoutXyflow()
			const rendered = broken.react.render(broken.exports.__components.GraphBand({ lexicon: atlasView.lexicon, layer: 'ontology', fullscreen: false, sessionId: 's1', onLayer: () => {}, onToggleFullscreen: () => {}, onFilter: () => {} })).replace(/\s+/g, ' ')
			check('拿不到图组件时如实说原因,结论照常可读', /图组件不可用\(.+?\)/.test(rendered) && rendered.includes('结论仍可正常查看'), rendered.slice(0, 200))
		}

		// ── 点一个点 / 一条边:小卡 ──
		{
			const inspector = {
				selection: { kind: 'edge', id: 'assertion:f-1:yield', label: '产率' },
				definition: { kind: 'assertion', predicate: 'yield', gloss: '每批的产率', domain: 'catalyst', domainLabel: '催化剂', basis: '实验记录' },
				facts: [
					{ id: 'f-1', text: '催化剂 A 的产率是 62%', scope: '均值差 < 5%', status: 'live', review: null, conflicts: [], hypothesis: { id: 'h-aa11', refuteWhen: '均值差 < 5%' } },
					{ id: 'f-2', text: '复核读数是 55%', scope: '复测', status: 'live', review: null, conflicts: [{ predicate: 'yield' }], hypothesis: null },
				],
				factsTruncated: 0,
				relations: { edges: [{ chip: 'cat_a · 产率 = 62%' }] },
			}
			const card = react.render(components.GraphInspector({ selection: inspector.selection, inspector, names: new Map([['cat_a', '催化剂 A']]), sessionId: 's1', onFilter: () => {}, onClose: () => {} })).replace(/\s+/g, ' ')
			check('小卡:标题是名字,带释义 / 主语 / 依据', card.includes('产率') && card.includes('每批的产率') && card.includes('催化剂') && card.includes('实验记录'), card.slice(0, 200))
			check('小卡:关系串里的实例 id 换成图上的名字', card.includes('催化剂 A · 产率 = 62%') && !card.includes('cat_a'), card)
			check('小卡:用到它的结论带状态签(已验证 / 有矛盾)', card.includes('引用此项的结论') && card.includes('已验证') && card.includes('有矛盾'), card)
			check('小卡:范围与算错相同时不重复', !card.includes('范围:均值差') && card.includes('范围:复测'), card)
			check('小卡:不摆内部编号', !/f-1|f-2|h-aa11/.test(card), card)
			check('小卡:「只看相关」与「关闭」两个显式动作', card.includes('仅显示相关项') && card.includes('关闭'))
		}
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
	 * §35:输入框下那条删了 ⇒ 唯一可点的那件事(「待处理 N」)现在在**工具行的计划 chip** 上,
	 * 而且**只多说一句**(人门优先,没有门才说续跑停着的理由)。
	 */
	const chipWithGate = text(components.PlanChip)
	check('计划 chip 上写着「待处理 N」(人门计数,一点直达世界树)', /待处理 1/.test(chipWithGate) && /\d+\/\d+/.test(chipWithGate), chipWithGate.slice(0, 90))

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
		/^\d+\/\d+(待处理 \d+)?$/.test(String(chip).trim()),
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
	 * 「待处理 N」由输入框下那条说——那才是事实面该管的事。
	 */
	check(
		'计划芯片:符号恒定是进度,要人注意时用琥珀色(与世界树同一族令牌)',
		text(components.PlanChip, { useProjection: () => ({ ...view, plan: { ...view.plan, confirmationPending: true } }) }).replace(/待处理\s*\d+/, '') === '1/3' &&
			/color-warning/.test(String(components.PlanChip({ useProjection: () => ({ ...view, plan: { ...view.plan, confirmationPending: true } }) }).props.style?.color ?? '')) &&
			/color-warning/.test(String(components.PlanChip({ useProjection: () => ({ ...view, plan: { ...view.plan, blocked: { reason: 'x' } } }) }).props.style?.color ?? '')) &&
			// 有「待处理」时**也该**是琥珀 ⇒ 这条要用"门都关着"的 fixture 才是未染色的情形
			components.PlanChip({ useProjection: () => ({ ...view, needYou: [] }), useSessions, sessionId: 's1' }).props.style === undefined &&
			/color-warning/.test(String(components.PlanChip({ useProjection, useSessions, sessionId: 's1' }).props.style?.color ?? '')),
	)
	check(
		'计划芯片:内部 id 与计划自己那句话退到 tooltip(鼠标停上去看得到)',
		String(components.PlanChip({ useProjection, useSessions, sessionId: 's1', openRail: () => {} }).props.title).includes('p-1'),
	)
	const rails = []
	// 计划那一格是工具行形态的按钮(无边框、次级文字色),点一下开世界树。
	const chipButton = components.PlanChip({ useProjection, useSessions, sessionId: 's1', openExplore: () => rails.push('clearai-explore') })
	check('计划芯片是工具行形态的按钮(不是自造药丸)', chipButton.type === 'button' && chipButton.props.className === 'clearai-toolctl', String(chipButton.props.className))
	chipButton.props.onClick()
	check('计划芯片点一下打开探索货架(界面不造第二个动词)', rails.includes('clearai-explore'), rails.join(','))
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

	/**
	 * 人按下「清除目标」的那一刻,内核还没到下一个 pre-step,而 dock 已经消失了。
	 * 客户端直接读平台自己的投影,于是这句话**当场**说得出来(2026-09-11 真 GUI 实测到的那一瞬)。
	 */

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
	 * 世界树的**行文**只放名字(§18/§30),形状由轨道与节点说 ——
	 * 这里渲染一次,供下面几条断言共用。(§34 删档位开关时误删过这一行,补回来。)
	 */
	const tree = react.render(components.WorldTree({ useProjection: () => view, useSessions, sessionId: 's1', openRail: () => {} })).replace(/\s+/g, ' ')
	check('世界树渲染出脊柱上的每一步', /造产物/.test(tree) && /写报告/.test(tree), tree.slice(0, 160))
	check('世界树不再画车道与收敛(并行探索交给原生子任务)', !/湿法|干法|已采纳|车道/.test(tree), tree.slice(0, 160))

	/**
	 * 「待处理」只陈述(面板只读):计划卡住、两条结论矛盾。没有按钮——要人的事在对话里问。
	 */
	{
		const needText = react.render(components.NeedYou({ data: view })).replace(/\s+/g, ' ')
		check('待处理:一条一行,说人话', /待处理/.test(needText) && /计划卡住了:产物没落盘/.test(needText), needText)
		check('待处理:不渲染任何按钮(面板没有写入口)', !walkNodes(expandTree(components.NeedYou({ data: view }))).some((node) => node.type === 'button'))
		check('没有要你做的事 ⇒ 什么都不画', components.NeedYou({ data: { ...view, needYou: [] } }) === null)
	}

	/**
	 * 章程那一行:**只有文件系统事实**(在不在 / 多大 / 什么时候动过)+ 点开走原生预览。
	 *
	 * 2026-09-11 砍掉了「占位 X/Y 条」与 §1 当前阶段的解析(用户一问点醒,理由见 kernel 里的注释):
	 * 那是对文本做格式解析——改一个标点「事实」就变;而章程每回合被原生指令文件整份注入,
	 * 模型手里本来就是原文,再算一遍摘要是第二本账。这一条断言把「不许再长回来」钉住。
	 */
	{
		
		// 段标题只说"项目章程",文件名只在**链接**上说一次(§31:同一路径不再出现两遍)
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
			check('宿主查过且不在盘上 ⇒ 才写「(缺)」', /lab\/gone\.csv\(缺失\)/.test(missing), missing.slice(0, 160))
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
			const seen = []
			const collect = (node) => { if (node === null || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(collect); return } if (typeof node.type === 'function') { collect(node.type({ ...(node.props ?? {}), children: node.children })); return } if (node.type === 'select') { seen.push(node); return } (node.children ?? []).forEach(collect) }
			collect(components.WorldTree({ useProjection: () => two, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: two } } } }), sessionId: 's1', openPreview: () => {}, openSpectator: () => {} }))
			check('多份计划 ⇒ 页眉给**一个下拉**切换入口(计划 N/共 M · 状态)', seen.length === 1 && (seen[0].children ?? []).length === 2, JSON.stringify(seen.map((n) => (n.children ?? []).map((c) => c.children?.[0])))),
			check('只有一份计划 ⇒ 不出现切换入口(不添噪声)', (() => { const got = []; const walk2 = (node) => { if (node === null || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk2); return } if (typeof node.type === 'function') { walk2(node.type({ ...(node.props ?? {}), children: node.children })); return } if (node.type === 'select') got.push(node); (node.children ?? []).forEach(walk2) }; walk2(components.WorldTree({ useProjection: () => view, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: view } } } }), sessionId: 's1', openPreview: () => {}, openSpectator: () => {} })); return got.length === 0 })())
		}
	}

	// 投影为空:世界树(计划面)与事实格(闭环面)都要给平静空态,不抛、不显示堆栈
	const emptyTree = react.render(components.WorldTree({ useProjection: () => undefined, sessionId: 's1' }))
	const emptyFacts = react.render(components.Atlas({ useProjection: () => undefined, sessionId: 's1' }))
	check('投影为空时渲染平静空态(不抛、不显示堆栈)', /暂无计划/.test(emptyTree) && /暂无内容/.test(emptyFacts), `${emptyTree.slice(0, 40)} | ${emptyFacts.slice(0, 40)}`)

	// 空视图也要能渲染:这是最常见的崩溃点(字段全 undefined)。
	const emptyView = { sessionId: 's1', goal: null, plan: null, evidence: [], materials: [], facts: [], audits: [], settlement: [], needYou: [] }
	const emptyText = (component) => react.render(component({ useProjection: () => emptyView, useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: emptyView } } } }), sessionId: 's1', openRail: () => {}, openSpectator: () => {} }))
	// TreeDetail / NeedYou 要一份选中行与门数据才渲染(它们在树里由选中驱动),不属于顶层空态。
	check(
		'空视图下这些组件都不炸',
		['PlanChip', 'WorldTree', 'Atlas'].every((name) => typeof emptyText(components[name]) === 'string'),
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
		const seat = host.registrations.find((entry) => entry.options.name === 'conversation.view' && entry.options.id === 'clearai-facts')
		const opened_seat = seat?.component({ sessionId: 's1', useProjection: () => view, useSessions })
		check('本体座位带着一个打开器(props.openPreview)', typeof opened_seat?.props?.openPreview === 'function')
		check('打开器把路径交出去时用的是**这个会话**的 id', opened_seat?.props?.openPreview('products/reports/final.md') === true && addresses.join('|') === 'dsh-resource://file/session/s1/products/reports/final.md', addresses.join('|'))
		// 路径**逐段**编码:段内的空格要转义,但 `/` 仍是分段符(bug 时整条路径被当成会话 id 一段编码,
		// 于是长成 `session/products%2Freport.html` —— 那正是读面报「认不出身份」的样子)。
		addresses.length = 0
		opened_seat.props.openPreview('products/reports/最终 报告.md')
		check('路径逐段编码(段内转义、`/` 仍是分段符)', addresses.join('|') === 'dsh-resource://file/session/s1/products/reports/%E6%9C%80%E7%BB%88%20%E6%8A%A5%E5%91%8A.md', addresses.join('|'))
		// props 里没有会话(比如右栏页签的体):兜底读当前会话,而不是编一个假 id。
		addresses.length = 0
		const withoutProps = seat.component({ useProjection: () => view, useSessions })
		withoutProps.props.openPreview('lab/evidence.csv')
		check('座位 props 没有 sessionId 时兜底用当前会话(与宿主同一个读法:retainedBy.mainView)', addresses.join('|') === 'dsh-resource://file/session/s1/lab/evidence.csv', addresses.join('|'))
		// 当前会话也拿不到(服务卸载):**不打开**,返回 false —— 不编一个会话 id 去撞读面。
		addresses.length = 0
		host.ctx.sessions.list.getSnapshot = () => ({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
		const noSession = seat.component({ useProjection: () => view, useSessions })
		check('连当前会话都拿不到时不打开(返回 false,零调用)', noSession.props.openPreview('lab/evidence.csv') === false && addresses.length === 0, `${addresses.length}`)
	}

}

console.log('\n【世界树拓扑:一条脊柱(纯函数,直接断言)】')
{
	const bundle = loadClientBundle()
	const { treeRows, treeConns, railPath, TREE } = bundle.exports.__topology
	check('几何常量照抄 ClearAI PlanTree(行高 / 车道宽 / 半径)', TREE.rowHeight === 30 && TREE.laneWidth === 15 && TREE.radius === 6, JSON.stringify(TREE))

	const plan = {
		id: 'p-1',
		steps: [
			{ id: 's1', ordinal: 1, do: '先摸清地形', status: 'advanced' },
			{ id: 's2', ordinal: 2, do: '跑甲做法', status: 'open' },
			{ id: 's3', ordinal: 3, do: '跑乙做法', status: 'open' },
			{ id: 's4', ordinal: 4, do: '写报告', status: 'open' },
		],
	}
	const rows = treeRows(plan)
	check('一步一行,全在脊柱上(竞争路线就是脊柱上的几步,不再有车道)', rows.map((row) => `${row.kind}:${row.lane}`).join(',') === 'step:0,step:0,step:0,step:0', rows.map((row) => `${row.kind}:${row.lane}`).join(','))
	check('没有计划时不炸', treeRows(null).length === 0)
	const conns = treeConns(rows)
	check('相邻两步连一段脊柱(n 步 n-1 段)', conns.length === 3 && conns.every((conn, index) => conn.from === index && conn.to === index + 1 && conn.fromLane === 0 && conn.toLane === 0), JSON.stringify(conns))
	const first = railPath(conns[0], rows)
	const centerY = (index) => index * 30 + 15 + 4
	check('轨道从节点边缘出发(不从圆心画出来),同一车道是直线', Number(first.split(' ')[1]) > centerY(0) && /^M\d+ [\d.]+ L\d+ [\d.]+$/.test(first), first)
	check('世界树的拓扑缝里不再有车道相关的入口', !('forks' in bundle.exports.__topology))
}

{
	const bundle = loadClientBundle()
	const { TREE_COLOR } = bundle.exports.__topology
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

		check('③ 光环:有评估者正在审这一步 → 虚线环(与「在跑」是两件事)', mark(step({ status: 'open' }), { ...base, audits: [{ stepId: 's1', verdict: null }] }).auditing === true && mark(step({ status: 'open' }), { ...base, audits: [{ stepId: 's1', verdict: 'support' }] }).auditing === false)
		check('④ 分段:驳回 3 次 → 3 轮(2 段驳回 + 1 段通过)', (() => { const loops = treeLoops({ 'p-1': { s1: 2 } }, 'p-1', 's1', true); return loops.fails === 2 && loops.rounds === 3 })())
		check('④ 分段:一次就过 → 不画弧(节点保持干净圆点)', treeArcs(mark(step({ status: 'advanced' }), { planId: 'p-1', blocks: {}, audits: [] })).length === 0)
		check('④ 分段:封顶 3 段(更多轮次交给行右的 ∞N 徽标)', (() => { const arcs = treeArcs(mark(step({ status: 'open' }), { planId: 'p-1', blocks: { 'p-1': { s1: 9 } }, audits: [] })); return arcs.length === 3 && arcs.every((arc) => arc.fail === true) })())
		check('④ 分段:段色说每轮结局(驳回红、通过取节点色)', (() => { const arcs = treeArcs(mark(step({ status: 'advanced' }), base)); return arcs.some((arc) => arc.fail === true) && arcs.some((arc) => arc.fail === false) })())
		// dash 参数:整圆分 N 段、各自偏移一格;单段不留缝(留了就成了「断了」而不是「整」)
		const one = arcDash(0, 1)
		const two = arcDash(1, 2)
		check('弧的 dash:单段不留缝,多段按格偏移', one.strokeDasharray.endsWith('0') && two.strokeDashoffset < 0 && arcDash(0, 2).strokeDashoffset === 0, `${one.strokeDasharray} / ${two.strokeDashoffset}`)
		check('已交付的步也划掉(做完了就退到背景里)', mark(step({ status: 'advanced' })).done === true)
	}

}

// 渲染路径与树下详情:通道算对了不等于画出来了,直接查 SVG 元素与详情文本。
{
	const withReact = loadClientWithStringReact()
	const { TREE } = withReact.exports.__topology
	const treeView = {
		sessionId: 's1',
		// s1 磨过两轮且有评估者在审(画弧 + 虚线环)、s2 还没动过(画空心圈)。
		plan: { id: 'p-1', steps: [ { id: 's1', ordinal: 1, do: '跑甲做法', status: 'open' }, { id: 's2', ordinal: 2, do: '写报告', status: 'open' } ] },
		blocks: { 'p-1': { s1: 2 } },
		audits: [{ id: 'a1', stepId: 's1', verdict: null }],
		evidence: [],
	}
	const el = withReact.exports.__components.WorldTree({
		useSessions: (selector) => selector({ byId: { s1: { projectionValues: { clearai: treeView } } } }),
		sessionId: 's1',
		openPreview: () => true,
		openSpectator: () => true,
	})
	const nodes = walkNodes(el)
	const circles = nodes.filter((node) => node.type === 'circle')
	check('渲染:有评估者正在审的步画出虚线呼吸环', circles.some((node) => String(node.props?.className ?? '').includes('clearai-breathe-stroke') && node.props.strokeDasharray === '2 2.5'), JSON.stringify(circles.map((node) => node.props?.className).filter(Boolean)))
	check('渲染:分段弧真的画在节点上', circles.some((node) => node.props?.fill === 'none' && node.props.strokeWidth === TREE.arcWidth && node.props.transform?.startsWith('rotate(-90')), JSON.stringify(circles.map((node) => node.props?.strokeWidth)))
	check('渲染:未落定的节点是空心圈', circles.some((node) => node.props?.fill === 'transparent'))
	check('渲染:不再画收敛菱形', !nodes.some((node) => node.type === 'rect' && String(node.props?.transform ?? '').startsWith('rotate(45')))

	const react = withReact.react
	const { TreeDetail } = withReact.exports.__components
	const detailData = {
		sessionId: 's1',
		plan: { id: 'p-1' },
		evidence: [{ id: 'e1', stepId: 's2', verdict: 'support', level: 'L3', evaluator: 'independent' }],
		audits: [{ id: 'a1', stepId: 's2', verdict: null, evaluator: 'independent', evaluatorSession: 'child-1', cardPath: 'clear/evidence/audits/s2/a1.json' }],
	}
	const stepRow = { kind: 'step', lane: 0, step: { id: 's2', ordinal: 2, do: '跑乙做法', status: 'open', doneCriteria: '有读数', voidReason: null, level: 'L3', artifacts: [{ path: 'products/report.md', exists: true }, { path: 'lab/missing.csv', exists: false }] } }
	const stepText = react.render(TreeDetail({ row: stepRow, data: detailData, openPreview: () => true, openSpectator: () => true, onClose: () => {} })).replace(/\s+/g, ' ')
	check('详情:把这一步的判据/状态/产物都摊开', /判据/.test(stepText) && /有读数/.test(stepText) && /products\/report\.md/.test(stepText) && /lab\/missing\.csv\(缺失\)/.test(stepText), stepText.slice(0, 200))
	check('详情:检验结果与独立核验的状态都在,说人话(还没回来的说「正在裁决」;不摆证据编号)', /检验结果:支持 · 独立核验/.test(stepText) && /正在裁决/.test(stepText) && !/\be1\b|support/.test(stepText), stepText.slice(0, 200))
	check('详情:不再有采纳 / 放弃分叉的动作', !/采纳此世界线|放弃探索/.test(stepText))
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
	check('三个服务名与平台的真实服务一致(名字写错同样静默失效)', ['slots', 'sessions', 'sidebarRight'].every((name) => declared.has(name)), [...declared].join(','))
	// 宿主那一侧的模块级依赖:让我们的 bundle 在提供这些服务的模块之后到达(原生包同样声明)。
	const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'ui', 'package.json'), 'utf8'))
	const moduleInjects = manifest?.dsh?.client?.inject ?? []
	check('package.json 的 dsh.client.inject 声明了服务提供者模块', moduleInjects.includes('@deepseek-ai/dsh-api-session-controller') && moduleInjects.includes('@deepseek-ai/dsh-client-ui-sidebar-right') && moduleInjects.includes('@deepseek-ai/dsh-client-locale'), JSON.stringify(moduleInjects))
	// 假 ctx 只给**属性**形式的服务:再退回 `ctx.get('x')` 读法会立刻红。
	const host = makeClientContext()
	bundle.exports.apply(host.ctx)
	check('照真实契约(属性形式)注册得下去', host.registrations.length > 0 && host.tabDefinitions.length === 0, `${host.registrations.length} 个席位 / ${host.tabDefinitions.length} 张页签`)
}

console.log('\n【图谱渲染:React Flow 那一行真的在部署件里】')
{
	/**
	 * 这一条守的是**装出去之后还能不能用**:React Flow 由 `ui/vendor/xyflow.js` 提供,
	 * build 时与主文件拼成同一份 lib/client.js(它是一个**同作用域的函数**,不是模块行——
	 * 运行时动态加载的模块行不在启动图里,`require` 不认它)。
	 * 拼接一旦掉了,浏览器里图会安静地退化成「图组件不可用」——所以这里验的是**包里的字节**,
	 * 不是源里的意图。
	 */
	check('部署件里带着 vendor 函数(build 的拼接没掉)', deployed.includes('function __clearaiXyflow(require)'))
	check('部署件里带上了 React Flow 的样式(缺了布局会散)', deployed.includes('data-clearai'))
	/**
	 * vendor 里**只能**依赖平台种子字:任何别的外部包在浏览器里都解析不到
	 * (`require` 只认种子词与已注册的行),那会在运行时才炸。这条断言把打包结果
	 * 的依赖面钉死——打包配置改动时它会先红,而不是等人打开面板发现图没了。
	 */
	const vendorRequires = [...readFileSync(VENDOR, 'utf8').matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
	const externalNotSeed = [...new Set(vendorRequires)].filter((name) => name !== 'react' && name !== 'react/jsx-runtime')
	check('vendor 的外部依赖只有平台种子字(react / react/jsx-runtime)', externalNotSeed.length === 0, externalNotSeed.join(','))
	check('主文件确实调用它(而不是只用桩)', readFileSync(SOURCE, 'utf8').includes('__clearaiXyflow(require)'))
	check('依赖面仍然只有平台种子字(不 require 任何 npm 包)', !/require\('@xyflow/.test(readFileSync(SOURCE, 'utf8')))
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
	check('两种语言都注册了(缺一种宿主会拒)', Object.keys(zh).length > 0 && Object.keys(en).length > 0, `${Object.keys(zh).length}/${Object.keys(en).length}`)
	{
		/** 用到的每个 `t('…')` 都要在词典里:漏一个,英文界面上就冒出一句中文。 */
		const used = [...new Set([...source.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)].map((match) => match[1]))]
		const missing = used.filter((key) => !(key in zh) || !(key in en))
		check('界面上用到的每句话都登记了两种语言', used.length > 50 && missing.length === 0, missing.slice(0, 8).join(' | '))
	}
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
	check('切到本预设:席位长出来,不再有右栏页签(跟着会话走)', host.registrations.length > 0 && host.tabDefinitions.length === 0, `${host.registrations.length} 个席位 / ${host.tabDefinitions.length} 张页签`)
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
