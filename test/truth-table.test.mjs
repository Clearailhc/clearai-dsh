/**
 * 真值表测试:把 `tools/verify-truth-table.mjs` 的机械核对搬进套件,
 * 并额外校验**生成物与源一致**——`docs/optimization/truth-table.json` 改了却忘了重新生成,
 * 必须在这里当场红,而不是等人在两份 markdown 里看出矛盾。
 *
 * 为什么这条纪律重要:优化计划本身就是冲着「文档、注释、prompt 与代码不同步」去的;
 * 如果新加的真值表自己就能漂移,那它只是第四本账。
 *
 * 跑法:node test/truth-table.test.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const read = (rel) => readFileSync(join(PORT, rel), 'utf8')

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

const TABLE = JSON.parse(read('docs/optimization/truth-table.json'))

console.log('\n【形状:真值表自身是合法的】')
{
	const enums = TABLE.enums
	check('schema 标识存在且是 clearai-truth-table 系列', typeof TABLE.schema === 'string' && TABLE.schema.startsWith('clearai-truth-table/'), TABLE.schema)
	check('机制条目非空', Array.isArray(TABLE.mechanisms) && TABLE.mechanisms.length > 0, `${TABLE.mechanisms.length}`)
	const ids = TABLE.mechanisms.map((m) => m.id)
	check('id 不重复', new Set(ids).size === ids.length)
	const badEnum = []
	for (const m of TABLE.mechanisms) {
		if (!enums.layer.includes(m.layer)) badEnum.push(`${m.id}:layer=${m.layer}`)
		if (!enums.status.includes(m.status)) badEnum.push(`${m.id}:status=${m.status}`)
		if (!enums.hardness.includes(m.hardness)) badEnum.push(`${m.id}:hardness=${m.hardness}`)
		if (!enums.authority.includes(m.authority)) badEnum.push(`${m.id}:authority=${m.authority}`)
	}
	check('每条机制的枚举值都在表头声明的取值里', badEnum.length === 0, badEnum.join(' '))
	const missingFields = TABLE.mechanisms.filter((m) => typeof m.name !== 'string' || typeof m.name_en !== 'string' || typeof m.rationale !== 'string' || typeof m.trigger !== 'string' || typeof m.actor !== 'string')
	check('每条机制都有 name / name_en / trigger / actor / rationale', missingFields.length === 0, missingFields.map((m) => m.id).join(' '))
	check('每条机制都显式声明了 known_mismatch 字段(值可以是 null,但不能缺)', TABLE.mechanisms.every((m) => 'known_mismatch' in m))
}

console.log('\n【生成物:两份 markdown 与 JSON 同步】')
{
	const zh = read('docs/optimization/truth-table.zh-CN.md')
	const en = read('docs/optimization/truth-table.md')
	check('中文版就是由 JSON 生成的', zh.includes('# ClearAI 机制真值表') && zh.includes('由 `truth-table.json` 生成'))
	check('英文版就是由 JSON 生成的', en.includes('# ClearAI Mechanism Truth Table') && en.includes('generated from `truth-table.json`'))
	const missingZh = TABLE.mechanisms.filter((m) => !zh.includes(`\`${m.id}\``)).map((m) => m.id)
	const missingEn = TABLE.mechanisms.filter((m) => !en.includes(`\`${m.id}\``)).map((m) => m.id)
	check('每条机制都出现在中文版里', missingZh.length === 0, missingZh.join(' '))
	check('每条机制都出现在英文版里', missingEn.length === 0, missingEn.join(' '))
	check('两份的条目数一致', TABLE.mechanisms.every((m) => zh.includes(m.name) && en.includes(m.name_en)))
}

console.log('\n【交叉校验:声明去问代码】')
{
	let output = ''
	let ok = true
	try {
		output = execFileSync(process.execPath, [join(PORT, 'tools', 'verify-truth-table.mjs')], { encoding: 'utf8' })
	} catch (error) {
		ok = false
		output = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`
	}
	check('tools/verify-truth-table.mjs 通过', ok, output.split('\n').filter((line) => line.startsWith('  ·')).join(' | '))
	check('校验器确实跑了多项检查(不是空跑)', /真值表校验：\d+ 项全过/.test(output), output.trim().split('\n').pop())
}

console.log('\n【重构基线:计划点名的不符必须在表里留痕】')
{
	const mustTrack = [
		['plan-review', '计划永远要人确认'],
		['max-auto-turns', '默认 128 而不是 6/512'],
		['auto-continuation', '由门状态驱动而不是按档分叉'],
		['autonomy-config', '降级为部署初值 + 槽位选择器'],
		['criteria-required', '正常入口已强制判据'],
		['l4-human-release', '只到步骤/分支级'],
		['commands-menu', '菜单比 standard 预设薄'],
	]
	for (const [id, why] of mustTrack) {
		const entry = TABLE.mechanisms.find((m) => m.id === id)
		check(`真值表收录了 ${id}(${why})`, entry !== undefined)
	}
	const tracked = TABLE.mechanisms.filter((m) => m.known_mismatch !== null).map((m) => m.id)
	check('至少记录了 6 处已知不符(优化计划的存在理由)', tracked.length >= 6, tracked.join(' '))
	check('已知不符的条目都写清了差异(不是空串或占位符)', TABLE.mechanisms.filter((m) => m.known_mismatch !== null).every((m) => typeof m.known_mismatch === 'string' && m.known_mismatch.trim().length >= 10))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
