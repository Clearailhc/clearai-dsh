/**
 * 裁决产出预算测试 —— 「耗时不是靠提示词劝下来的,而是靠协议的形状」。
 *
 * 为什么单开一份:真跑(2026-09-29 · 会话 9dc1fe2b)里一次目标级裁决的 `basis` 是一篇五千余字的
 * 论证,评估者末步单次生成 81s;同一目标被派了 5 个评估者,合计 584.8s。
 * 病根不在评估者话多,而在 **`VERDICT_SCHEMA` 对产出的形状没有任何约束**:
 * `basis` 是无上限字符串,`shortfalls` 是 `string[]`(一整段散文正好合法),没有 `refs`。
 * 提示词里写多少句「请简短」都改不动这件事——**长度只能由 schema 与归一化给**。
 *
 * 这份测试钉三件事:
 *   ① 形状:`VERDICT_SCHEMA` 里短裁决与逐条 refs 是**声明**出来的(不是文案);
 *   ② 纪律:`EVALUATOR_DISCIPLINE` 要的是「短裁决 + 逐条 refs」,且不含「长篇论证」的相反承诺;
 *   ③ **反例**:超长 basis / 旧形状 shortfalls 的样本必须被拒或被截断——
 *      正例全绿说明不了任何事,反例必须红(仓库纪律)。
 *
 * 跑法:node test/prompt-budget.test.mjs
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './tmp.mjs'
import { apply } from '../preset/plugins/clearai-kernel.js'
import { applyMutations, emptyState, renderCard, view } from '../ui/lib/fold.js'

// 与 kernel.test.mjs 同形:内核会按 DSH_HOME 落旁路账本,别往用户真实的 ~/.dsh 里塞。
process.env.DSH_HOME = tempDir('clearai-budget-home-')

const PORT = join(import.meta.dirname, '..')
const KERNEL_SOURCE = readFileSync(join(PORT, 'preset', 'plugins', 'clearai-kernel.js'), 'utf8')

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

/**
 * 从源码里**取出一个字面量对象/数组并求值**。
 *
 * 为什么用求值而不是正则:正则只能断言「文本里有 maxLength」,断言不了
 * `required` 里到底有没有 `refs`、`items.required` 里有没有三个字段。
 * 而这份测试要钉的恰恰是**结构**,不是文本。取的是本仓库自己的源码,不做任何外部输入求值。
 */
function extractLiteral(source, marker) {
	const start = source.indexOf(marker)
	if (start < 0) return null
	const openIndex = start + marker.length - 1
	const open = source[openIndex]
	const close = open === '{' ? '}' : ']'
	let depth = 0
	let inString = null
	for (let index = openIndex; index < source.length; index += 1) {
		const char = source[index]
		if (inString !== null) {
			if (char === '\\') index += 1
			else if (char === inString) inString = null
			continue
		}
		if (char === "'" || char === '"' || char === '`') {
			inString = char
			continue
		}
		if (char === open) depth += 1
		else if (char === close) {
			depth -= 1
			if (depth === 0) {
				const text = source.slice(openIndex, index + 1)
				try {
					return { value: new Function(`return (${text})`)(), text }
				} catch (error) {
					return { value: null, text, error: String(error?.message ?? error) }
				}
			}
		}
	}
	return null
}

/**
 * 一个**最小的** schema 形状校验器:只认这段 schema 用到的那几种约束。
 * 它的职责是回答「这份样本过不过得了新形状」——正是运行时会对评估者产出做的那件事。
 */
function shapeProblems(schema, value, path = 'value') {
	if (schema === null || typeof schema !== 'object') return []
	const problems = []
	const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type]
	if (types.includes('object')) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${path} 不是对象`]
		for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${path}.${key} 缺失(required)`)
		for (const [key, entry] of Object.entries(value)) {
			const declared = schema.properties?.[key]
			if (declared === undefined) {
				if (schema.additionalProperties === false) problems.push(`${path}.${key} 未声明`)
				continue
			}
			problems.push(...shapeProblems(declared, entry, `${path}.${key}`))
		}
		return problems
	}
	if (types.includes('array')) {
		if (!Array.isArray(value)) return [`${path} 不是数组`]
		for (const [index, entry] of value.entries()) problems.push(...shapeProblems(schema.items ?? {}, entry, `${path}[${index}]`))
		return problems
	}
	if (types.includes('string')) {
		if (typeof value !== 'string') return [`${path} 不是字符串`]
		if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) problems.push(`${path} 超出 maxLength(${value.length} > ${schema.maxLength})`)
		return problems
	}
	if (types.includes('integer')) {
		if (!Number.isInteger(value)) problems.push(`${path} 不是整数`)
		return problems
	}
	return problems
}

// ═══ ① VERDICT_SCHEMA 的形状 ═══════════════════════════════════════════

console.log('\n【① VERDICT_SCHEMA:短裁决 + 逐条 refs 是声明出来的】')
const verdictLiteral = extractLiteral(KERNEL_SOURCE, 'const VERDICT_SCHEMA = {')
const verdict = verdictLiteral?.value ?? null
check('VERDICT_SCHEMA 取得出来(不是靠猜)', verdict !== null && typeof verdict === 'object', verdictLiteral?.error ?? '未找到')
{
	const properties = verdict?.properties ?? {}
	const basis = properties.basis ?? {}
	const shortfalls = properties.shortfalls ?? {}
	const refs = properties.refs ?? {}

	check('basis 声明了长度上限(maxLength 是数)', typeof basis.maxLength === 'number', JSON.stringify(basis))
	check('basis 的上限 ≤ 1200(短裁决,不是散文)', typeof basis.maxLength === 'number' && basis.maxLength <= 1200, String(basis.maxLength))

	check('shortfalls 是数组', shortfalls.type === 'array', JSON.stringify(shortfalls))
	check('shortfalls 的元素是对象(不再是一段散文)', shortfalls.items?.type === 'object', JSON.stringify(shortfalls.items))
	const shortfallFields = ['criterion', 'what', 'missing']
	check(
		`shortfalls 元素形状含 ${shortfallFields.join(' / ')}`,
		shortfallFields.every((field) => shortfallFields.every((entry) => entry in (shortfalls.items?.properties ?? {})) && field in (shortfalls.items?.properties ?? {})),
		JSON.stringify(Object.keys(shortfalls.items?.properties ?? {})),
	)
	check('shortfalls 的三个字段都是必填', shortfallFields.every((field) => (shortfalls.items?.required ?? []).includes(field)), JSON.stringify(shortfalls.items?.required))

	check('refs 是数组(逐条指到文件与行)', refs.type === 'array', JSON.stringify(refs))
	check('refs 元素含 path 与 line 两个字段', 'path' in (refs.items?.properties ?? {}) && 'line' in (refs.items?.properties ?? {}), JSON.stringify(Object.keys(refs.items?.properties ?? {})))
	check('refs 元素至少要指认 path(必填)', (refs.items?.required ?? []).includes('path'), JSON.stringify(refs.items?.required))
	/**
	 * **`refs` 声明但不强制**——这条是拿真跑换来的:
	 * 把 refs 写进 `required` 会让一份完全可用的裁决因为少一个数组被 runtime 拒收,
	 * 于是 structured 通道为空、账上只剩「无法判定」,目标永远结不了案。
	 * 想要的是"给了就严校"(形状),不是"不给就报废"(必填);
	 * 真缺 refs 时由内核的正文兜底把裁决从 markdown 卡片里读回来(见 kernel 的 `parseLooseJson`)。
	 */
	check('refs 是声明出来的数组形状(给了就严校)', refs.type === 'array', JSON.stringify(refs))
	check('refs **不**在 required 里(缺它不许把一份裁决整份丢掉)', !(verdict?.required ?? []).includes('refs'), JSON.stringify(verdict?.required))

	check('schema 关掉额外字段(形状即契约)', verdict?.additionalProperties === false && shortfalls.items?.additionalProperties === false, `${String(verdict?.additionalProperties)} / ${String(shortfalls.items?.additionalProperties)}`)

	/**
	 * **反例(静态面)**:旧形状的裁决样本必须过不了这份 schema。
	 * 这一条是「schema 真的在管产出」的证明——否则新形状只是文档里的一句话。
	 */
	const legacySample = { verdict: 'refute', basis: 'x'.repeat((basis.maxLength ?? 1200) + 300), shortfalls: ['③ 不满足（严格口径）：语料库 7 条 origin 直书「待补」，判分用的反例中 v17 无具名文献、无 URL……（一整段散文）'] }
	const legacyProblems = shapeProblems(verdict, legacySample)
	check('反例:超长 basis + 旧形状 shortfalls 被 schema 拒', legacyProblems.length > 0, legacyProblems.slice(0, 3).join(' ;; '))
	check('反例确实触发了「超长」与「形状」两类问题(不是撞上别的字段)', legacyProblems.some((item) => /maxLength/.test(item)) && legacyProblems.some((item) => /shortfalls\[0\]/.test(item)), legacyProblems.join(' ;; '))

	// 这套检查是活的:合规样本必须过。
	const goodSample = {
		holds: 'no',
		basis: '判据③不满足:31 条反例里 v17 无具名文献。',
		results: [{ hypothesis: 'h-abc123', verdict: 'inconclusive', basis: '交付不成立,读不出结果' }],
		shortfalls: [{ criterion: '③ 语料库每条带可追溯出处', what: 'boundary-negatives-verified.json:24 v17 只写「B站分区形成史」', missing: '一条可点开的一手来源' }],
		refs: [{ path: 'lab/data/boundary-negatives-verified.json', line: 24 }],
	}
	check('活检查:合规样本过得了同一份 schema', shapeProblems(verdict, goodSample).length === 0, shapeProblems(verdict, goodSample).join(' ;; '))
}

// ═══ ② EVALUATOR_DISCIPLINE:要短裁决 + 逐条 refs ═════════════════════════

console.log('\n【② EVALUATOR_DISCIPLINE:短裁决 + 逐条 refs,不是长篇论证】')
const disciplineLiteral = extractLiteral(KERNEL_SOURCE, 'const EVALUATOR_DISCIPLINE = [')
const discipline = typeof disciplineLiteral?.value?.join === 'function' ? disciplineLiteral.value.join('\n') : ''
check('EVALUATOR_DISCIPLINE 取得出来', discipline.length > 200, `长度 ${discipline.length}`)
check('纪律里点名 refs(逐条指到文件与行)', /refs/.test(discipline))
check('纪律里有字数上限(短裁决是写明的预算)', /(≤|不超过|最多|上限)[^。\n]{0,12}\d{2,4}\s*字/.test(discipline), discipline.slice(0, 120))
check('纪律要求每条缺口指认判据条目(criterion / 判据)', /(criterion|判据条目|哪条判据)/.test(discipline))
check(
	'纪律里没有「长篇/详细论证」的相反承诺',
	!/(尽可能详细|充分展开|不限字数|越长越好|长篇论证)/.test(discipline),
	(discipline.match(/(尽可能详细|充分展开|不限字数|越长越好|长篇论证)/) ?? [])[0] ?? '',
)

// ═══ ③ 反例(行为面):走真工具面,归一化必须截断 / 拒 ═══════════════════════
//
// 只断言源码里有 `slice(0, 1200)` 是**文本**断言;契约要的是「归一化真的会截断」。
// 所以这里把内核装进一个最小宿主,让它经真正的 `CloseGoal` 路径拿到一份越界裁决,
// 再看落账的那条 `audit/settled` 事实长什么样。

console.log('\n【③ 反例:越界裁决经真工具面落账时必须被截断/归一】')
{
	const SESSION = 'session-budget'
	const WORKSPACE = tempDir('clearai-budget-ws-')
	mkdirSync(join(WORKSPACE, 'clear', 'evidence', 'audits'), { recursive: true })

	const OVERSIZE = 5000
	const LEGACY_VERDICT = {
		verdict: 'refute',
		basis: '一'.repeat(OVERSIZE),
		// 旧形状:一整段散文。runtime 不校验时评估者就会这么回。
		shortfalls: ['③ 不满足（严格口径）：逐条打开页面的核验从未做过，失配数这个读数不存在；这一整段散文正是旧形状。'],
	}
	const registered = new Map()
	const audits = []
	const states = new Map()
	const service = {
		state: (id) => states.get(id) ?? emptyState(),
		derive: () => ({ hypotheses: [], factRows: [], lexicon: emptyState().lexicon, knowledge: { mode: 'ordinary', gaps: [] } }),
		view: (id) => view(service.state(id)),
		renderCard: (id) => renderCard(service.state(id)),
		preview: (id, mutations) => {
			const next = applyMutations(service.state(id), mutations)
			return { state: next, card: renderCard(next), view: view(next) }
		},
	}
	const ctx = {
		logger: { info() {}, warn() {}, error() {} },
		get(name) {
			if (name === 'clearai') return service
			if (name === 'tools') return { get: (toolName) => ({ name: toolName }) }
			if (name === 'sessions') return { get: (id) => ({ header: { cwd: WORKSPACE }, ownEvents: () => [], append() {} }) }
			if (name === 'subagents') {
				return {
					async listChildren() {
						return []
					},
					async start(provider, request) {
						audits.push({ provider, request })
						return {
							id: 'child-budget-1',
							localAgent: undefined,
							result: Promise.resolve({ output: [], structured: LEGACY_VERDICT, stopReason: 'completed' }),
							dispose: async () => {},
						}
					},
				}
			}
			return undefined
		},
		on() {
			return () => {}
		},
		effect(callback) {
			callback()
			return () => {}
		},
		tools: { register: (entry) => registered.set(entry.name, entry) },
		systemPrompt: { section() {} },
	}
	apply(ctx, { minHypotheses: 0, requireTypedPromotion: false })

	// 状态:一个开着的目标。CloseGoal 的「先收计划」那道门在没有计划时直接放行。
	states.set(
		SESSION,
		applyMutations(emptyState(), [
			{
				t: 'goal/set',
				id: 'g-budget',
				revision: 1,
				claim: '裁决产出必须有预算',
				done_criteria: '存在一份评估卡,且它 ≤ 1200 字',
				promote_at_level: 'L3',
				hypotheses: [{ id: 'h-budget', claim: '越界产出必须被截断', refute_when: '越界产出原样落账' }],
			},
		]),
	)

	const closeGoal = registered.get('CloseGoal')
	check('CloseGoal 已注册到工具面(反例走的是真工具)', typeof closeGoal?.execute === 'function')
	check('schema 面:越界样本确实越界(否则这条反例是空跑)', LEGACY_VERDICT.basis.length > (verdict?.properties?.basis?.maxLength ?? 1200) && typeof LEGACY_VERDICT.shortfalls[0] === 'string', `basis=${LEGACY_VERDICT.basis.length}`)

	let result = null
	try {
		result = await closeGoal.execute({ outcome: 'achieved', note: '反例' }, { callId: 'call-budget', agent: { id: SESSION }, signal: undefined })
	} catch (error) {
		result = { error: String(error?.message ?? error) }
	}
	const settled = (result?.mutations ?? []).find((mutation) => mutation?.t === 'audit/settled') ?? null
	check('越界裁决仍然落了一条 audit/settled 事实(不因越界就丢)', settled !== null, JSON.stringify(result?.error ?? result?.code ?? result?.ok))
	check(
		`落账 basis 被截到 ≤ ${verdict?.properties?.basis?.maxLength ?? 1200} 字`,
		settled !== null && String(settled.basis ?? '').length <= (verdict?.properties?.basis?.maxLength ?? 1200),
		`实际 ${String(settled?.basis ?? '').length}`,
	)
	const landedShortfalls = Array.isArray(settled?.shortfalls) ? settled.shortfalls : []
	check(
		'旧形状 shortfalls 被归一成 {criterion, what, missing} 而不是原样落账',
		landedShortfalls.length > 0 && landedShortfalls.every((item) => item !== null && typeof item === 'object' && 'criterion' in item && 'what' in item && 'missing' in item),
		JSON.stringify(landedShortfalls).slice(0, 200),
	)
	check('归一后的 basis 里带得出「被裁过」的痕迹(读账的人看得见)', /裁|截断|1200/.test(String(settled?.basis ?? '')), String(settled?.basis ?? '').slice(-60))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exitCode = 1
}
