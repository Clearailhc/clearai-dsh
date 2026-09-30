/**
 * ui-drive —— 驱一个**已经开着**的 Chrome(CDP),用来跑真会话并截面板图。
 *
 * 为什么要有它:面板截图必须来自**真会话 + 真投影**,不能手画;
 * 而 Playwright 不在这个仓库的依赖里,Chrome 的调试协议本身就够了(Node 22 自带 WebSocket)。
 *
 * 用法(先自己起一个带调试端口的 Chrome,见 tools/capture-ui.sh):
 *   node tools/ui-drive.mjs text
 *   node tools/ui-drive.mjs click "世界树"
 *   node tools/ui-drive.mjs type "任务文本"
 *   node tools/ui-drive.mjs key Enter
 *   node tools/ui-drive.mjs wait 5000
 *   node tools/ui-drive.mjs shot docs/shots/world-tree.png
 *
 * 它是**开发工具**,不进发行物(files 白名单里没有 tools/)。
 */

const PORT = process.env.CDP_PORT ?? '9333'

async function targets() {
	const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
	return await response.json()
}

const list = await targets()
const page = list.find((item) => item.type === 'page')
if (page === undefined) {
	console.error(`✗ 没有页面目标(Chrome 开了吗?端口 ${PORT})`)
	process.exit(2)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
	socket.addEventListener('open', resolve, { once: true })
	socket.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
socket.addEventListener('message', (event) => {
	const message = JSON.parse(event.data)
	if (message.id === undefined) return
	const slot = pending.get(message.id)
	if (slot === undefined) return
	pending.delete(message.id)
	if (message.error !== undefined) slot.reject(new Error(JSON.stringify(message.error)))
	else slot.resolve(message.result)
})

function send(method, params = {}) {
	const id = nextId++
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject })
		socket.send(JSON.stringify({ id, method, params }))
	})
}

/** 在页面里求值,返回可序列化的结果。 */
async function evaluate(expression) {
	const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
	if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text ?? 'evaluate failed')
	return result.result.value
}

/** 按可见文本找一个元素,返回它的中心点(找不到 → null)。 */
async function centerOf(text, tag = '*') {
	return await evaluate(`(() => {
		const wanted = ${JSON.stringify(text)}
		const nodes = Array.from(document.querySelectorAll(${JSON.stringify(tag)}))
		const hit = nodes.filter((el) => (el.innerText ?? '').trim() === wanted && el.offsetParent !== null).pop()
			?? nodes.filter((el) => (el.innerText ?? '').includes(wanted) && el.offsetParent !== null).pop()
		if (!hit) return null
		hit.scrollIntoView({ block: 'center' })
		const r = hit.getBoundingClientRect()
		return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: hit.tagName, text: (hit.innerText ?? '').slice(0, 60) }
	})()`)
}

async function clickAt(x, y) {
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const [command, ...rest] = process.argv.slice(2)

if (command === 'text') {
	console.log(await evaluate('document.body.innerText'))
} else if (command === 'eval') {
	console.log(JSON.stringify(await evaluate(rest.join(' ')), null, 2))
} else if (command === 'click') {
	const target = await centerOf(rest.join(' '))
	if (target === null) {
		console.error(`✗ 找不到可点的元素:${rest.join(' ')}`)
		process.exit(3)
	}
	await clickAt(target.x, target.y)
	console.log(`clicked ${target.tag} @${Math.round(target.x)},${Math.round(target.y)} "${target.text}"`)
} else if (command === 'focus') {
	const target = await centerOf(rest[0] ?? '')
	void target
} else if (command === 'type') {
	const text = rest.join(' ')
	// 输入框是原生 composer(contenteditable):先聚焦,再用 Input.insertText 走真实输入路径。
	const box = await evaluate(`(() => {
		const el = document.querySelector('[contenteditable="true"], textarea')
		if (!el) return null
		el.focus()
		const r = el.getBoundingClientRect()
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
	})()`)
	if (box === null) {
		console.error('✗ 找不到输入框')
		process.exit(3)
	}
	await clickAt(box.x, box.y)
	await send('Input.insertText', { text })
	console.log(`typed ${text.length} chars`)
} else if (command === 'key') {
	const key = rest[0] ?? 'Enter'
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 0 })
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 0 })
	console.log(`key ${key}`)
} else if (command === 'wait') {
	await sleep(Number(rest[0] ?? 1000))
	console.log(`waited ${rest[0]}ms`)
} else if (command === 'locale') {
	/**
	 * 切界面语言:CDP 覆写导航器语言再重载。
	 * headless 下 `--lang=` 只影响 Chrome 自己的界面文案,不影响 `navigator.language`
	 * (实测仍是 en-US),而宿主是按导航器语言兜底选字典的——所以必须走这一条。
	 */
	const tag = rest[0] ?? 'zh-CN'
	await send('Emulation.setLocaleOverride', { locale: tag })
	await send('Page.reload', { ignoreCache: true })
	await sleep(2500)
	console.log(`locale ${tag}`)
} else if (command === 'shot') {
	const path = rest[0]
	/**
	 * 可选第二参数是一个 CSS 选择器:**只截这个元素**。
	 * 为什么要有它:面板截图不该把左侧项目栏拍进去(那里是真实的项目名),
	 * 也不该把输入框、状态栏这些不变的东西带进来——按元素裁最省事也最稳。
	 */
	const selector = rest[1]
	let clip
	if (selector !== undefined) {
		const rect = await evaluate(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)})
			if (!el) return null
			const r = el.getBoundingClientRect()
			return { x: r.left, y: r.top, width: r.width, height: r.height }
		})()`)
		if (rect === null) {
			console.error(`✗ 找不到要裁的元素:${selector}`)
			process.exit(3)
		}
		// 第三个参数:从底部裁掉多少 CSS px(输入框与状态栏不该进图)
		const inset = Number(rest[2] ?? 0)
		clip = { x: rect.x, y: rect.y, width: rect.width, height: Math.max(120, rect.height - (Number.isFinite(inset) ? inset : 0)), scale: 1 }
	}
	const result = await send('Page.captureScreenshot', clip === undefined ? { format: 'png', captureBeyondViewport: false } : { format: 'png', clip })
	const { writeFileSync, mkdirSync } = await import('node:fs')
	const { dirname } = await import('node:path')
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, Buffer.from(result.data, 'base64'))
	console.log(`saved ${path}`)
} else {
	console.error('用法:node tools/ui-drive.mjs <text|eval|click|type|key|wait|locale|shot> [参数]  · shot <路径> [CSS 选择器]')
	process.exit(2)
}

socket.close()
