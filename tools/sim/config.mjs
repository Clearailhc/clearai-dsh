/**
 * 读预设里 `clearai-kernel` 那一行的 `config`——模拟宿主要用**与生产同一份**配置装内核。
 *
 * 为什么不用 yaml 包:它不是本仓库的依赖(宿主自带)。这一行的 config 只用到 YAML 的一个小子集
 * (标量、`- 项` 列表、按缩进嵌套的映射、`#` 注释),所以这里只认这个子集;认不出的写法
 * 直接抛错,而不是猜一个值(猜错的配置会让验收测的是另一套机制)。
 */
import { readFileSync } from 'node:fs'

const scalar = (raw) => {
	const value = raw.trim()
	if (value === 'true') return true
	if (value === 'false') return false
	if (value === 'null' || value === '~') return null
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
	if (/^'.*'$/.test(value) || /^".*"$/.test(value)) return value.slice(1, -1)
	return value
}

/** 把一段按缩进组织的行解析成值(映射或列表)。 */
function parseBlock(lines, start, indent) {
	const first = lines[start]
	if (first !== undefined && first.indent === indent && first.text.startsWith('- ')) {
		const list = []
		let index = start
		while (index < lines.length && lines[index].indent === indent && lines[index].text.startsWith('- ')) {
			list.push(scalar(lines[index].text.slice(2)))
			index += 1
		}
		return { value: list, next: index }
	}
	const map = {}
	let index = start
	while (index < lines.length && lines[index].indent === indent) {
		const match = /^([A-Za-z_][\w-]*):(.*)$/.exec(lines[index].text)
		if (match === null) throw new Error(`读不懂这一行:${lines[index].text}`)
		const [, key, rest] = match
		if (key in map) throw new Error(`重复键:${key}(YAML 的重复键在宿主那边会静默取值,这里拒收)`)
		if (rest.trim() !== '') {
			map[key] = scalar(rest)
			index += 1
			continue
		}
		const child = lines[index + 1]
		if (child === undefined || child.indent <= indent) {
			map[key] = null
			index += 1
			continue
		}
		const parsed = parseBlock(lines, index + 1, child.indent)
		map[key] = parsed.value
		index = parsed.next
	}
	if (index < lines.length && lines[index].indent > indent) throw new Error(`缩进不齐:${lines[index].text}`)
	return { value: map, next: index }
}

export function readKernelConfig(presetPath) {
	const source = readFileSync(presetPath, 'utf8').split('\n')
	const rowStart = source.findIndex((line) => /^- id: clearai-kernel\s*$/.test(line))
	if (rowStart === -1) throw new Error('预设里没有 clearai-kernel 那一行')
	let rowEnd = source.findIndex((line, index) => index > rowStart && /^- /.test(line))
	if (rowEnd === -1) rowEnd = source.length
	const configLine = source.findIndex((line, index) => index > rowStart && index < rowEnd && /^ {2}config:\s*$/.test(line))
	if (configLine === -1) return {}
	const lines = source
		.slice(configLine + 1, rowEnd)
		.map((line) => line.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, ''))
		.filter((line) => line.trim() !== '')
		.map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }))
	if (lines.length === 0) return {}
	return parseBlock(lines, 0, lines[0].indent).value
}
