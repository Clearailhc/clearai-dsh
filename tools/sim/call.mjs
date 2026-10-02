#!/usr/bin/env node
/**
 * 模型调用工具的入口(给扮演模型的子代理用)。
 *
 *   node tools/sim/call.mjs <运行目录> <工具名> <<'EOF'
 *   { ...参数 JSON... }
 *   EOF
 *
 * 参数从标准输入读(免得 shell 转义把 JSON 弄坏)。打印的就是模型这一拍读到的全部文本:
 * 工具结果,以及系统在下一步之前注入的消息。
 *
 * 一次调用可能要等独立评估者(几分钟)。最多等 9 分钟;还没回来就打印调用 id,
 * 稍后用 `node tools/sim/call.mjs <运行目录> --result <id>` 接着取。
 *
 * 编排者用的子命令:
 *   --brief            交给模型的说明(提示词段 + 工具目录 + 开场注入)
 *   --pending          挂起的子代理请求(评估者)
 *   --settle <id>      交回一位子代理的结果,标准输入给 {"structured": {...}} 或 {"text": "..."}
 *   --status / --stop
 */
import { request as httpRequest } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [runArg, ...rest] = process.argv.slice(2)
if (runArg === undefined || rest.length === 0) {
	console.error("用法:node tools/sim/call.mjs <运行目录> <工具名> <<'EOF' {参数} EOF")
	process.exit(2)
}
const port = Number(readFileSync(join(resolve(runArg), 'port'), 'utf8').trim())

/** 直接走 node:http(不走 fetch):本机回环不该经过出站代理。 */
function send(method, path, body) {
	return new Promise((done, reject) => {
		const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
		const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': payload.length }, timeout: 600000 }, (res) => {
			const chunks = []
			res.on('data', (chunk) => chunks.push(chunk))
			res.on('end', () => {
				try {
					done(JSON.parse(Buffer.concat(chunks).toString('utf8')))
				} catch (error) {
					reject(error)
				}
			})
		})
		req.on('error', reject)
		if (payload !== undefined) req.write(payload)
		req.end()
	})
}

const stdin = () => {
	try {
		const raw = readFileSync(0, 'utf8').trim()
		return raw === '' ? {} : JSON.parse(raw)
	} catch (error) {
		console.error(`标准输入不是合法 JSON:${error.message}`)
		process.exit(2)
	}
}

const printCall = (outcome) => {
	if (outcome.pending === true) {
		console.log(`(调用 ${outcome.id} 还在进行——多半是独立评估者在判。稍后运行:node tools/sim/call.mjs ${runArg} --result ${outcome.id})`)
		return
	}
	console.log(outcome.text ?? JSON.stringify(outcome))
}

const [command, argument] = rest
if (command === '--brief') {
	const brief = await send('GET', '/brief')
	console.log(JSON.stringify(brief, null, 2))
} else if (command === '--pending') {
	console.log(JSON.stringify(await send('GET', '/pending'), null, 2))
} else if (command === '--settle') {
	console.log(JSON.stringify(await send('POST', '/settle', { id: argument, ...stdin() })))
} else if (command === '--result') {
	printCall(await send('GET', `/result?id=${encodeURIComponent(argument)}`))
} else if (command === '--status') {
	console.log(JSON.stringify(await send('GET', '/status'), null, 2))
} else if (command === '--stop') {
	console.log(JSON.stringify(await send('POST', '/stop')))
} else {
	printCall(await send('POST', '/call', { tool: command, args: stdin() }))
}
