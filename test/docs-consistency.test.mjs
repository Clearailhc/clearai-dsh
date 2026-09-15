/**
 * 文档一致性:**过去被写错过的那些句子,不许再回到"现在时"**。
 *
 * 这一份测试来自本次收敛的真实教训:仓库里出现过多处「机制改了、文档/注释/prompt 没跟上」,
 * 而且每一条都长得像正常句子——`Goal 档自动确认`、`6/512`、`run.current_step`、
 * `set_autonomy` 面板开关……读的人无法从语气上分辨它说的是现在还是两年前。
 *
 * 规则只有一条:**这些短语可以出现,但那一行必须同时带上"这是历史/已删/已改"的标记。**
 * 于是「保留历史」与「不许冒充现状」两件事同时成立——P5(什么都不删)与诚实描述并存。
 *
 * 扫描面:
 *   · docs/**.md(除 docs/optimization/,那里是本次收敛的账本,本来就要引用旧说法)
 *   · preset/agent.cordis.yml 与 preset/plugins/*.js(注释与提示词正文)
 *   · README / CHANGELOG 之外的根文档
 * CHANGELOG 刻意豁免:它的职责就是记录当时发生了什么。
 *
 * 跑法:node test/docs-consistency.test.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')

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

/** 递归收集要扫的文件。 */
function walk(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) walk(full, out)
		else out.push(full)
	}
	return out
}

const OPTIMIZATION = join(PORT, 'docs', 'optimization')
const files = [
	...walk(join(PORT, 'docs')).filter((file) => file.endsWith('.md') && !file.startsWith(OPTIMIZATION)),
	join(PORT, 'preset', 'agent.cordis.yml'),
	...walk(join(PORT, 'preset', 'plugins')).filter((file) => file.endsWith('.js')),
	join(PORT, 'README.md'),
	join(PORT, 'README.zh-CN.md'),
]
// CHANGELOG 的职责是记录当时发生了什么,豁免。
const SCANNED = files.filter((file) => !file.endsWith('CHANGELOG.md'))

/**
 * 禁用短语 → 为什么它危险。
 * 每一条都是**真实漂移过**的说法,不是假想。
 */
const BANNED = [
	{ pattern: /(6\s*\/\s*512|6 轮 vs 512|人在场 6 \/ 无人值守 512|attended: 6|unattended: 512)/, why: '两档额度(6/512)已删除,现在只有 DEFAULT_MAX_AUTO_TURNS=128' },
	{ pattern: /(Goal 档自动确认|立约即授权|无人值守.{0,6}自动确认|unattended.{0,12}auto-?confirm)/, why: '计划授权没有自动确认分支;confirmed_by 只有 user 与 progress' },
	{ pattern: /(无\s*done_criteria.{0,12}绕过|不经独立评估|bypassed by "no criteria")/, why: '正常 CreatePlan 入口已由 validateSteps 强制判据' },
	{ pattern: /run\.current_step/, why: 'DSH 里不存在这个字段;事实源是 CheckPlan 与运行态卡' },
	{ pattern: /全程中文/, why: '提示词已改为跟随用户语言' },
	{ pattern: /(通用 L4.{0,8}(已|全部)实现|universal L4 gate.{0,10}implemented)/, why: 'L4 人门只覆盖步骤/分支级' },
	{ pattern: /(八状态机.{0,6}已实现|eight-state machine.{0,10}shipped)/, why: '八状态验证机仍是设计目标' },
]

/** 一行如果带上这些标记,说明它在讲历史/已删/已改 —— 允许。 */
const HISTORY_MARKERS = [
	'已删', '已摘', '已改', '已修', '已移除', '历史', '曾经', '以前', '原先', '原本', '原文', '过期', '漂移', '不再', '旧的', '旧写法', '残留', '不许', '禁止', '旧语义',
	'removed', 'deleted', 'was deleted', 'previously', 'no longer', 'used to', 'historical', 'retired', 'stale', 'old wording', 'design goal', 'design target', 'not implemented',
	'Design only', '设计目标', '未实现', '欠', '待',
]

console.log('\n【扫描面:确实扫到了该扫的文件】')
{
	check('扫到了 docs 下的文档', SCANNED.filter((file) => file.includes('/docs/')).length >= 10, `${SCANNED.length} 个文件`)
	check('扫到了 preset 组合与插件', SCANNED.some((file) => file.endsWith('agent.cordis.yml')) && SCANNED.some((file) => file.endsWith('clearai-kernel.js')))
	check('docs/optimization 被排除(它是本次收敛的账本,本来就要引用旧说法)', !SCANNED.some((file) => file.startsWith(OPTIMIZATION)))
	check('CHANGELOG 被豁免(它记录当时发生了什么)', !SCANNED.some((file) => file.endsWith('CHANGELOG.md')))
}

console.log('\n【禁用短语:可以出现,但那一行必须标明是历史】')
{
	const offenders = []
	for (const file of SCANNED) {
		const text = readFileSync(file, 'utf8')
		for (const [index, line] of text.split('\n').entries()) {
			for (const { pattern, why } of BANNED) {
				if (!pattern.test(line)) continue
				if (HISTORY_MARKERS.some((marker) => line.includes(marker))) continue
				offenders.push(`${relative(PORT, file)}:${index + 1} 「${line.trim().slice(0, 90)}」 ← ${why}`)
			}
		}
	}
	check('没有"以现在时"出现的历史说法', offenders.length === 0, offenders.slice(0, 6).join(' ;; '))
}

console.log('\n【反向:这些短语没有被一刀切删掉(历史要留着)】')
{
	const all = SCANNED.map((file) => readFileSync(file, 'utf8')).join('\n')
	const optimization = readFileSync(join(OPTIMIZATION, 'truth-table.zh-CN.md'), 'utf8')
	check('真值表里留了历史说法的记录', /6\/512|自动确认|set_autonomy/.test(optimization))
	check('已知缺口文档点明了"授权不是闸门"', /授权是\*\*记号与归属\*\*|不是闸门/.test(readFileSync(join(PORT, 'docs', 'known-gaps.zh-CN.md'), 'utf8')))
	check('扫描面本身非空(不是空跑)', all.length > 10000, `${all.length} 字节`)
}

console.log('\n【每份文档都指得出自己的状态】')
{
	const known = readFileSync(join(PORT, 'docs', 'known-gaps.zh-CN.md'), 'utf8')
	const philosophy = readFileSync(join(PORT, 'docs', 'loop-philosophy.zh-CN.md'), 'utf8')
	check('已知缺口指向真值表(读法有了唯一出口)', known.includes('optimization/truth-table.zh-CN.md'))
	check('循环哲学承认"文档与实现没有机械等价检查"', /没有机械等价检查/.test(philosophy))
	check('循环哲学列出了它自己的张力条目(不是只写优点)', /真实存在\*\*的张力|真实存在\*\*张力/.test(philosophy) || /以下是这套设计\*\*真实存在\*\*的张力/.test(philosophy))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
