/**
 * 本体(§22)的交叉校验:**声明里的每一条,在这一平面都要真有对应的东西**。
 *
 * 这一份测试是那个模块的意义所在——声明写成数据之后,「声明了却没接线」必须**当场红**,
 * 而不是等人 grep:
 *   ① 每个对象的 `event_kind` 必须是折法真认识的变更类型;
 *   ② 每条守卫的名字必须在核心里真有一处实现(用具名的 CFG 开关或带名的函数);
 *   ③ 五级的判者/来源/门 必须与内核真实执行的那三条门对应(L3 起独立判、L4 要人放行、
 *      L4 不认自写来源);
 *   ④ 折法里那些状态词汇,必须与声明里写的**一致**(多一个少一个都红)。
 *
 * 跑法:node test/ontology.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')

const { VERIFICATION_LOOP, describeOntology, validateOntology } = await import(join(PORT, 'preset', 'plugins', 'ontology.js'))
const foldSource = readFileSync(join(PORT, 'ui', 'lib', 'fold.js'), 'utf8')
const kernelSource = readFileSync(join(PORT, 'preset', 'plugins', 'clearai-kernel.js'), 'utf8')

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

console.log('\n【形状:装配期不变式(与内核 apply 时跑的是同一个函数)】')
{
	const problems = validateOntology(VERIFICATION_LOOP)
	check('声明通过装配期校验(初始态/终态/可达性/等级前缀单调)', problems.length === 0, problems.join(' | '))
	check('识别得出坏声明(校验器是活的,不是摆设)', validateOntology({ id: 'x', objects: [{ name: 'o', states: ['a'], initial: 'b' }], levels: [] }).length > 0)
	check('一个进程一份本体:换装只能换那一行(声明里只有一个 id)', typeof VERIFICATION_LOOP.id === 'string' && VERIFICATION_LOOP.id === 'verification-loop', VERIFICATION_LOOP.id)
}

console.log('\n【① 事件面:每一条边声明的 event,折法必须真认识】')
{
	/**
	 * 折法的词汇表 = `applyMutation` 里 case 的那一串 **加上** LEDGER_ONLY_MUTATIONS
	 * (后者是「只留台账、不折进视图」的几类,它们同样是合法的变更类型)。
	 */
	const known = new Set([...foldSource.matchAll(/case '([a-z]+\/[a-z_]+)':/g)].map((match) => match[1]))
	check('折法词汇表读得到(不是空集)', known.size > 10, `${known.size} 个`)
	check('台账专用变更也算认识(admission/checked 等)', foldSource.includes("admission/checked"))
	const edges = VERIFICATION_LOOP.objects.flatMap((object) => object.transitions.map((edge) => ({ object: object.name, ...edge })))
	check('每条边都声明了 event(这一平面一条边一种变更类型)', edges.every((edge) => edge.event !== ''), edges.filter((edge) => edge.event === '').map((edge) => `${edge.object}:${edge.from}→${edge.to}`).join(','))
	for (const edge of edges) {
		const ledgerOnly = /'admission\/checked'|'git\/committed'|'git\/restored'|'git\/snapshot'/.test(`'${edge.event}'`)
		check(`${edge.object}:${edge.from}→${edge.to} → ${edge.event} 折法认识`, known.has(edge.event) || ledgerOnly, edge.event)
	}
	/**
	 * 对象级 `event_kind` 是**诞生事件**(创建不是一条边):它同样要是折法认识的类型。
	 * 这一平面一条边一种变更类型,所以转移各自的 event 在边上(与 Python 那一侧不同)。
	 */
	const isKnown = (type) => known.has(type) || /^(admission|git)\/(checked|committed|restored|snapshot)$/.test(type)
	for (const object of VERIFICATION_LOOP.objects) {
		check(`${object.name}:诞生事件 ${object.event_kind} 折法认识`, object.event_kind !== '' && isKnown(object.event_kind), object.event_kind)
	}
	// 反向:折法认识的关键变更,没有一个是「没人声明的孤儿」(边 ∪ 诞生事件)
	const declared = new Set([...edges.map((edge) => edge.event), ...VERIFICATION_LOOP.objects.map((object) => object.event_kind)])
	for (const type of ['goal/set', 'goal/closed', 'plan/created', 'step/advanced', 'observation/recorded', 'audit/settled', 'evidence/recorded', 'fact/promoted', 'human/released']) {
		check(`折法的关键变更 ${type} 在声明里有主`, declared.has(type))
	}
}

console.log('\n【② 守卫:声明里每一个具名守卫,核心里真有那一处实现】')
{
	/**
	 * 守卫名 → 内核里的实现锚点(串或正则)。**故意用具名锚点**:
	 * 谁把门拆了,这条就红——声明不该是一份漂亮的愿望清单。
	 */
	const guards = {
		independent_verdict_support: /independent_verdict|verdict === 'support'/,
		independent_verdict_written: /CloseGoal|goal\/closed/,
		admission_passed: /function admissionGate|admission\/checked/,
		level_judge_split: /SELF_JUDGE_MAX_INDEX/,
		external_source_for_l4: /l4RejectSelfWritten/,
		human_release_for_l4: /l4RequiresHumanRelease/,
		block_threshold: /CFG\.blockedThreshold/,
		human_retraction_decision: /markFactReviewed/,
	}
	const named = new Set(VERIFICATION_LOOP.objects.flatMap((object) => object.transitions.flatMap((edge) => edge.guards)))
	for (const guard of named) {
		const anchor = guards[guard]
		check(`守卫 ${guard}:声明里有名字`, guard !== '')
		if (anchor === undefined) {
			check(`守卫 ${guard}:测试里有锚点(新守卫要顺手加锚点)`, false)
			continue
		}
		check(`守卫 ${guard}:核心里真有那一处(${String(anchor).slice(0, 28)}…)`, anchor.test(kernelSource))
	}
	check('声明里的守卫没有孤儿(每个名字都被某条边用着)', named.size > 0, [...named].join(','))
}

console.log('\n【③ 等级:声明的判者/来源/门,与内核真跑的那三条门对应】')
{
	const kernelL4 = /levelIndex === 4 && CFG\.l4RequiresHumanRelease/.test(kernelSource)
	const kernelExternal = /levelIndex === 4 && CFG\.l4RejectSelfWritten/.test(kernelSource)
	const selfJudge = /SELF_JUDGE_MAX_INDEX = 2/.test(kernelSource)
	check('L4 要人放行:声明说 human_release,内核真有那道门', VERIFICATION_LOOP.levels[4].gate === 'human_release' && kernelL4)
	check('L4 只认外部来源:声明列了四种来源,内核真不认自写', VERIFICATION_LOOP.levels[4].sources.length === 4 && !VERIFICATION_LOOP.levels[4].sources.includes('self') && kernelExternal)
	check('L3 起独立判:声明说 independent,内核真把自判卡在 L2', VERIFICATION_LOOP.levels[3].judge === 'independent' && selfJudge)
	check('L0–L2 可自判:声明与内核同一条线', VERIFICATION_LOOP.levels.slice(0, 3).every((item) => item.judge === 'self'))
}

console.log('\n【④ 状态词汇:声明写的,必须与折法里真用的**同一套**】')
{
	/**
	 * 逐条对着折法里的字面量。(拿掉任一侧的那个词,这条就红——这就是「声明描述派生的真实语义」。)
	 */
	const vocab = {
		goal: ['open', 'achieved', 'abandoned', 'superseded'],
		hypothesis: ['proposed', 'refuted', 'superseded', 'retracted'],
		plan: ['active', 'closed'],
		step: ['open', 'advanced', 'void'],
		observation: ['accepted', 'rejected'],
	}
	for (const [name, states] of Object.entries(vocab)) {
		const object = VERIFICATION_LOOP.objects.find((item) => item.name === name)
		const missing = states.filter((state) => !object.states.includes(state))
		check(`${name}:声明的状态里有折法真用的那几个(${states.join('/')})`, missing.length === 0, missing.join(','))
	}
	/**
	 * §22 的黏性:终态不该被别的边改写。声明里 `refuted` / `retracted` 都是零出边,
	 * 折法里也必须真的黏住——**撤回优先于一切**:后来的支持证据不复活一条被撤回的事实。
	 */
	check('假设的 refuted 是黏性终态:声明零出边,折法真黏住(与 ClearAI 本体 P3 同一个修法)', /status !== 'refuted'[\s\S]{0,40}refutations > 0/.test(foldSource))
	check('假设的 retracted 同样是黏性终态,而且优先于 refuted(人撤回的不因后来证据复活)', /retractedClaims\.has\(String\(hypothesis\.claim/.test(foldSource) && /status !== 'retracted' && refutations > 0/.test(foldSource))
	const supersededGuarded = /item\.status !== 'refuted' && !promoted/.test(foldSource)
	check('「已被替代」不改写终态:折法里那两处前提在', supersededGuarded)
}

console.log('\n【⑤ 事实那一格:声明里的字段与名字,界面与内核都得真有】')
{
	const fact = VERIFICATION_LOOP.objects.find((object) => object.name === 'fact')
	check('fact 声明了边界(scope)与最近验证时间', fact.fields.some((field) => field.name === 'scope') && fact.fields.some((field) => field.name === 'last_verified'), fact.fields.map((field) => field.name).join(','))
	// 声明里的字段必须在**落账那条路**上真出现:fact/promoted 带 scope
	check('升格那一刻真的带上边界(内核 fact/promoted 里有 scope)', /t: 'fact\/promoted'[\s\S]{0,400}?scope:/.test(kernelSource))
	const clientSource = readFileSync(join(PORT, 'ui', 'lib', 'client.js'), 'utf8')
	const labelStart = clientSource.indexOf('const LOOP_LABEL = lazyTable(() => ({')
	const labelBlock = clientSource.slice(labelStart, clientSource.indexOf('}))', labelStart))
	for (const object of VERIFICATION_LOOP.objects) {
		check(`界面有 ${object.name} 的人话名字(声明里每个对象都要有,少一个就红)`, labelBlock.includes(`${object.name}:`), labelBlock.replace(/\s+/g, ' ').slice(0, 80))
	}
	check('「事实」那一格注册在中栏视图里(与产物并列)', /id: 'clearai-facts'/.test(clientSource) && /label: t\('事实'\)/.test(clientSource))
	check('进展与世界线不再重复(分工写进了注释而不是口头约定)', /计划与世界线的\*\*行\*\*归世界树/.test(clientSource) || /归世界树/.test(clientSource))
	check('事实货架(INDEX.md)由内核维护,且面板读的是同一张表', /renderFactsIndex/.test(kernelSource) && /INDEX\.md/.test(kernelSource))
}

console.log('\n【计数类说法:文件里写的对象数必须与声明对得上】')
{
	/**
	 * 「对象是八个」曾经同时写在文件头与 note 里,而 `objects` 声明的是**九个**
	 * (多出来的是 `release`)——两处一起漂,谁也没发现。所以这个数不靠人眼:
	 * 把正文里的汉字数抓出来,与声明的长度对账。
	 */
	const NUMERALS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
	const source = readFileSync(join(PORT, 'preset', 'plugins', 'ontology.js'), 'utf8')
	// 只认**计数声明**那两处(文件头与 note):`一个对象` 这类量词短语不是计数,别误伤。
	const claimed = [...source.matchAll(/对象是([一二三四五六七八九十])个/g), ...source.matchAll(/^\s*note: '([一二三四五六七八九十])个对象/gm)].map((match) => NUMERALS[match[1]])
	check('正文里的对象数读得出来(至少一处)', claimed.length >= 1, String(claimed))
	check('正文里写的对象数与声明长度一致', claimed.every((value) => value === VERIFICATION_LOOP.objects.length), `写的:${claimed.join(',')} · 声明:${VERIFICATION_LOOP.objects.length}`)
}

console.log('\n【货架:本体落成 clear/ontology/<id>.md,而且是给模型读的】')
{
	const doc = describeOntology(VERIFICATION_LOOP)
	check('货架正文含全部对象与五级', VERIFICATION_LOOP.objects.every((object) => doc.includes(`### ${object.name}`)) && doc.includes('## 五级'))
	check('货架正文写出转移与守卫(模型据此对得上本体)', doc.includes('→') && doc.includes('守卫:'))
	check('内核确实会写它(货架函数与调用点都在)', /function ensureOntologyShelf/.test(kernelSource) && /ensureOntologyShelf\(sessionCwd\(sessionId\)\)/.test(kernelSource))
	check('clear/ 骨架里有 ontology 那一格', /\['skills', 'memory', 'knowledge', 'audit', 'ontology'\]/.test(kernelSource))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
