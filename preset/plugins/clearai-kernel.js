/**
 * clearai-kernel —— ClearAI 的**判断侧**(预设平面)。
 *
 * 分工(第一性原理):
 *   · **事实**在宿主:`clearai-dsh` 注册了一个会话投影单元,状态 = 会话日志的投影。
 *     预设会被重建(组合文件一动,名册就重挂),进程级的东西只能注册一次——所以状态机不在预设里。
 *   · **判断**在这里:读盘核产物(观测准入)、派独立评估者、算术排序、生成变更记录。
 *     这些要么需要 I/O,要么需要异步,而且它们是「模型负责智能判断」那一半。
 *
 * 工具是**意图工具**:它们不宣称事实,只产出「请求」,并把系统的核验结果一起写成变更记录,
 * 由宿主那侧的纯 fold 折进状态。写路径:`return {..., mutations}` →
 * `output.presentationMeta` 把它放进 `tool/result.meta` → 投影 fold。
 *
 * 逐条对应 docs/loop-philosophy.md:
 *   P1 机制优于劝告      → 准入、唯一完成动词、闸门、算术,全是代码
 *   P2 不可表示优于不可违反 → 工具 schema 里没有 status/progress/phase;fold 的秩棘轮让降级不可表示
 *   P3 意图工具不能断言事实 → 状态只能由「系统核验过的变更记录」推进,不由模型的说法推进
 *   P4 做的人不判自己     → L3 以上拒绝自带 verdict;派 fresh-context 评估者,裁决只取结构化回包
 *   P5 什么都不删         → 状态是可重放的投影;refine/void/superseded 的旧值都在
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'

import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { SECTION_TABLE } from './prompts.js'
import { VERIFICATION_LOOP, describeOntology, validateOntology } from './ontology.js'

export const name = 'clearai-kernel'
/** 宿主注册表 + `clearai` 读面(宿主包提供;缺了会在工具里明确报错,而不是静默不工作)。 */
export const inject = ['tools', 'systemPrompt']

// ── 常量:全部来自 ClearAI 的代码事实 ───────────────────────────────────────

const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4']
/** 自判等级上限:L0–L2 可自判,L3 以上拒绝。 */
const SELF_JUDGE_MAX_INDEX = 2
/** `MAX_PLAN_STEPS`。 */
const MAX_PLAN_STEPS = 25
/**
 * `_DEFAULT_BLOCKED_THRESHOLD`:连续未过闸达阈值 → 计划置 blocked,等人。
 * 它**不按档取值**:它是证据质量闸,不是预算,
 * 人在不在场都得先过闸。部署想要「人就在旁边,早点回来问」,就在配置面写小一点(现在是 2)。
 */
const DEFAULT_BLOCKED_THRESHOLD = 3
/** 计划简述的 ≥280 字符质量门。校验失败只警告,不阻断。 */
const MIN_BRIEF_CHARS = 280

/** 变更记录的封套标记:宿主投影只认它。 */
const MUTATION_KIND = 'clearai'

/**
 * 内核下发的上下文消息**署名**。
 *
 * 宿主从 session 格式 v4 起把消息来源改成生产者自有:共享包装 `{ kind: 'plugin', plugin }`
 * 已退役,原生接纳当场拒绝它(报 `format v4 message requires a producer-owned source kind`)。
 * `plugin:clearai` 正是宿主读取已发布 V3 日志时给 clearai 抬升出来的那个值——
 * 于是老会话折得出来、新会话写得进去,两侧只认一个名字。
 */
const MESSAGE_SOURCE_KIND = 'plugin:clearai'

/** 自指检测:账本自指四条 + 对话自指三条。 */
const SELF_REFERENCE = [
	[/ClosePlan\s*成功/, '判据不得引用「ClosePlan 成功」——那是系统的动作,不是可核对的产物'],
	[/计划状态\s*(?:为|是|=)?\s*done/i, '判据不得引用「计划状态 done」——状态由系统派生,不能作为判据'],
	[/目标\s*(?:已|状态)?\s*achieved/i, '判据不得引用「目标 achieved」——那是评估者的裁决,不是本步的产物'],
	[/本步.{0,8}(?:标记|标为|置为)\s*done/i, '判据不得引用「本步标记 done」——没有手动标记这回事'],
	[/记录在对话(?:中|里)/, '判据不得是「记录在对话中」——对话不是可复核的产物'],
	[/见上文/, '判据不得是「见上文」——评估者读不到你的上下文'],
	[/已在对话(?:中|里)/, '判据不得是「已在对话里」——对话不是可复核的产物'],
]

function levelIndexOf(level) {
	const index = LEVELS.indexOf(String(level ?? '').toUpperCase())
	return index < 0 ? -1 : index
}

function text(value) {
	return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

function sha256File(path, maxBytes = 8 * 1024 * 1024) {
	try {
		const stat = statSync(path)
		if (!stat.isFile()) return null
		if (stat.size > maxBytes) return `size:${stat.size}`
		return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)}`
	} catch {
		return null
	}
}

/**
 * 生成一个唯一 id。
 * **不能只用毫秒时间戳**:同一毫秒内建两份计划就会撞 id,而 fold 按 id 找计划,
 * 于是后续的 step/advanced 会落到旧的那份上——症状是「明明推进了却还开着」。
 */
function uniqueId(prefix) {
	return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function fail(code, message, extra = {}) {
	return { ok: false, code, message, ...extra }
}

/** `clear/` 是系统所有的那一面:这些写入只有内核做,做的人被闸门挡在外面。 */
function writeTextFile(file, content) {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, content, 'utf8')
}

function appendTextFile(file, content) {
	mkdirSync(dirname(file), { recursive: true })
	appendFileSync(file, content, 'utf8')
}

const OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		ok: { type: 'boolean' },
		code: { type: 'string' },
		message: { type: 'string' },
		verdict: { type: 'string' },
		evaluator: { type: 'string' },
		gate: { type: 'string' },
		progress_changed: { type: 'boolean' },
		blocked: { type: 'boolean' },
		/** 立约时告诉模型「这份计划要不要人确认」(计划确认门的两档)。 */
		confirmation_required: { type: 'boolean' },
		card: { type: 'string' },
		mutations: { type: 'array', items: { type: 'object', additionalProperties: true } },
	},
	required: ['ok'],
	additionalProperties: false,
}

/**
 * 人门标记 —— **内核侧的解析**(宿主半 `fold.js` 有一份等价实现,两边都不 import 对方:
 * 预设平面与宿主平面互不依赖是这套移植的分层纪律)。
 *
 * 两份实现必须同格式,所以不是靠人记住,而是靠测试:
 * `test/kernel.test.mjs` 拿同一批消息喂两个解析器,断言结论一致。
 * 这份白名单不能是**抄在闭包里的私本**——
 * 改标记要改两处、忘了就静默失效。现在它在模块层、被导出,漏一处测试就红。
 */
export const HUMAN_GATE_MARK = '[clearai·人门]'
/**
 * 人门**动词白名单**(与宿主半 `fold.js` 的同名表逐字一致 —— 两边不 import 对方,
 * 靠 `test/kernel.test.mjs` 的等价性用例钉住)。
 *
 * 两侧白名单一旦各自维护,摘动词时只改一侧 ⇒ 内核仍认、宿主不认 ⇒ **等价性用例立刻红** ✓。
 * 这正是那条用例存在的意义:两份实现漂移不许静默。
 */
/**
 * **逐字镜像 `ui/lib/fold.js` 的同名清单**(预设面不能 import 宿主半,于是只能两份;
 * 两份相等由 `test/authority-boundary.test.mjs` 钉死——它红的时候,是清单漂了,不是测试坏了)。
 */
export const HUMAN_GATE_ACTIONS = [
	'register_term',
	'register_predicate',
	'revise_term',
	'deprecate_entry',
]
export function parseHumanGateMessage(message) {
	if (message === null || typeof message !== 'object') return null
	// 署名必须是人:插件与模型来源的同名标记不算人门动作(与宿主半同一条纪律)。
	if (message.source === null || typeof message.source !== 'object' || message.source.kind !== 'user') return null
	const blocks = Array.isArray(message.content) ? message.content : []
	const first = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string')
	if (first === undefined || !first.text.startsWith(HUMAN_GATE_MARK)) return null
	const line = first.text.slice(HUMAN_GATE_MARK.length).trim().split('\n')[0].trim()
	try {
		const parsed = JSON.parse(line)
		if (parsed === null || typeof parsed !== 'object') return null
		// 表外的动词不算人门动作(与宿主半同一条纪律:表外的名字不许出现)。
		if (!HUMAN_GATE_ACTIONS.includes(String(parsed.action ?? ''))) return null
		return parsed
	} catch {
		return null
	}
}

/** 把这一笔落成事实:变更记录进 meta,卡片由宿主 fold 预演后给出(所以是「这一步之后」的样子)。 */
function mutationMeta(_args, value) {
	const mutations = value !== null && typeof value === 'object' && Array.isArray(value.mutations) ? value.mutations : []
	return { kind: MUTATION_KIND, v: 1, mutations }
}

function renderValue(_args, value) {
	return text(value?.message ?? String(value?.code ?? 'ok'))
}

const CARD_OUTPUT = { schema: OUTPUT_SCHEMA, render: renderValue, presentationMeta: mutationMeta }

/**
 * 配置面:组合文件的 `config:` 里**允许出现**的键。
 * 写错一个键名以前是静默无效(`autonomoy: unattended` 会安静地什么都不做)——现在装配期抛错。
 * 这份清单与下面 `CFG` 的赋值一一对应;测试会拿**实际部署的组合文件**来核对(文本级抽取)。
 */
export const CONFIG_KEYS = [
	'blockedThreshold',
	'minBriefChars',
	'l4RequiresHumanRelease',
	'l4RejectSelfWritten',
	'minHypotheses',
	'requireTypedPromotion',
	'requireCriteriaVerdict',
	'requireLandedEntities',
	'requireLevelReasons',
	'bashDenyRules',
	'auditProvider',
	'auditTimeoutMs',
	'auditToolFilter',
	'runtimeCard',
	'contributions',
]

/**
 * 工具目录:机制 → 它拥有的工具。**唯一**的工具事实源——装配清单与代码里的 `defineTool`
 * 都对它负责:清单里出现目录外的名字、或代码定义了一件目录里没有的工具,都是装配期抛错。
 */
export const MECHANISM_TOOLS = {
	goal: ['Frame', 'Conclude'],
	plan: ['CreatePlan', 'CheckPlan', 'AmendPlan', 'RefinePlan', 'VoidPlanStep', 'ClosePlan', 'AdvancePlan'],
	/**
	 * 领域语言:九个写入口(概念注册/修订/废止 · **实例登记** · **带出处的断言** · 跳级理由)
	 * + 一个读入口(按概念取已知)。「约定」与「观测」各走各的门:概念不需依据,实例与断言必须带出处。
	 */
	ontology: ['RegisterTerm', 'RegisterPredicate', 'ReviseTerm', 'RevisePredicate', 'DeprecateTerm', 'DeprecatePredicate', 'RegisterInstance', 'Assert', 'ExplainLevelSkip', 'QueryKnowledge'],
}
const TOOL_CATALOG = new Set(Object.values(MECHANISM_TOOLS).flat())

/** 清单缺省:机制全开、工具全装、段全装。 */
const CONTRIB_DEFAULTS = {
	mechanisms: Object.fromEntries(Object.keys(MECHANISM_TOOLS).map((key) => [key, true])),
	tools: Object.keys(MECHANISM_TOOLS).flatMap((key) => MECHANISM_TOOLS[key]),
	sections: [...SECTION_TABLE.keys()],
}

/**
 * 清单校验:装配语义——清单里出现表外的名字当场抛错,
 * 而不是静默少装一件工具、等某一轮才发现。错法一律装配期抛错:
 *   unknown_mechanism / unknown_tool / tool_of_disabled_mechanism / unknown_policy_slot
 *   / unknown_budget / unknown_budget_tier / invalid_budget
 */
function resolveContributions(contributions) {
	const declared = contributions ?? {}
	/**
	 * 贡献表**顶层**也走白名单:`budgets` 块删掉之后,旧写法
	 * (`contributions: { budgets: {...} }`)必须装配期就炸——否则它会**静默无效**,
	 * 而「配了没生效」正是这份移植最想消灭的一类错(与未知机制/未知工具同一条纪律)。
	 */
	for (const key of Object.keys(declared)) {
		if (key !== 'mechanisms' && key !== 'tools' && key !== 'sections' && key !== 'ontology') throw new Error(`unknown_contribution:clearai-kernel:${key}`)
	}
	const mechanisms = { ...CONTRIB_DEFAULTS.mechanisms }
	for (const [key, value] of Object.entries(declared.mechanisms ?? {})) {
		if (!(key in MECHANISM_TOOLS)) throw new Error(`unknown_mechanism:clearai-kernel:${key}`)
		mechanisms[key] = value !== false
	}
	const tools = declared.tools === undefined ? [...CONTRIB_DEFAULTS.tools] : [...declared.tools]
	if (declared.tools === undefined) {
		// 缺省工具面随机制裁剪:关掉一个机制,它的工具就不该还在清单里。
		for (const key of Object.keys(MECHANISM_TOOLS)) {
			if (mechanisms[key] === true) continue
			for (const toolName of MECHANISM_TOOLS[key]) tools.splice(tools.indexOf(toolName), 1)
		}
	}
	for (const toolName of tools) {
		if (!TOOL_CATALOG.has(toolName)) throw new Error(`unknown_tool:clearai-kernel:${toolName}`)
		const owner = Object.keys(MECHANISM_TOOLS).find((key) => MECHANISM_TOOLS[key].includes(toolName))
		if (owner !== undefined && mechanisms[owner] !== true) {
			throw new Error(`tool_of_disabled_mechanism:clearai-kernel:${toolName}:${owner}`)
		}
	}
	const sections = declared.sections === undefined ? [...CONTRIB_DEFAULTS.sections] : [...declared.sections]
	for (const entry of sections) {
		if (!SECTION_TABLE.has(entry)) throw new Error(`unknown_policy_slot:clearai-kernel:${entry}`)
	}
	/**
	 * **本体**:贡献表的第八项,也是唯一一项**状态面**(前七项都是行为面)。
	 * 三条装配期纪律(逐条对着 ClearAI 本体 P1 的定案):
	 *   · **一个进程一份本体**:两份声明的合并语义未定义(两个插件各声明一个 hypothesis 算什么?),
	 *     所以第二份直接拒;换装 = 换发行清单那一行。
	 *   · **不装本体是合法状态**(阉割发行):给 `null` 就是明说「这个发行没有本体」;
	 *     给了名字就必须是表里那一份——写错名字装配期就炸,不是静默当没装。
	 *   · **声明自身的形状在装配期校验**(初始态/终态/可达性/等级前缀单调):`validateOntology`。
	 */
	const ontologyName = declared.ontology === undefined ? VERIFICATION_LOOP.id : declared.ontology
	let ontology = null
	if (ontologyName !== null) {
		if (ontologyName !== VERIFICATION_LOOP.id) throw new Error(`unknown_ontology:clearai-kernel:${String(ontologyName)}`)
		const problems = validateOntology(VERIFICATION_LOOP)
		if (problems.length > 0) throw new Error(`invalid_ontology:clearai-kernel:${problems[0]}`)
		ontology = VERIFICATION_LOOP
	}
	return { mechanisms, tools, sections, ontology }
}

// ── 插件主体 ────────────────────────────────────────────────────────────────

export function apply(ctx, config = {}) {
	// 配置面先校验:组合文件里写错一个键名,以前是静默无效(比如把一个键拼错),
	// 现在是装配期抛错——与贡献表同一套「表外的名字不许出现」的纪律。
	for (const key of Object.keys(config)) {
		if (!CONFIG_KEYS.includes(key)) throw new Error(`unknown_config:clearai-kernel:${key}`)
	}
	/**
	 * 数值旋钮在装配期就把关:写一个跑不动的值(0 轮、负数、小数)以前要到第一次布防
	 * 才被宿主拒,那时候人已经在跑任务了。不可执行的值不该过装配期。
	 */
	if (config.blockedThreshold !== undefined && (!Number.isInteger(config.blockedThreshold) || config.blockedThreshold < 1)) {
		throw new Error('invalid_config:clearai-kernel:blockedThreshold')
	}
	const CFG = {
		/**
		 * 连拦阈值:同一件事连续冲闸这么多次没过,计划置 blocked、停下等人。
		 * **它不是预算**:它管的是证据质量,
		 * 而且不再按档取值——人在不在场都得先过闸。
		 */
		blockedThreshold: config.blockedThreshold ?? DEFAULT_BLOCKED_THRESHOLD,
		minBriefChars: config.minBriefChars ?? MIN_BRIEF_CHARS,
		l4RequiresHumanRelease: config.l4RequiresHumanRelease !== false,
		l4RejectSelfWritten: config.l4RejectSelfWritten !== false,
		/** ClearAI 代码里「≥2 条假设」只是文案;默认不强制。 */
		minHypotheses: config.minHypotheses ?? 0,
		/**
		 * **知识门**:将要升格的命题必须已有断言的形态,否则结案被拒。
		 *
		 * 与 `minHypotheses` 是**两条不同的立场**,所以是两个键,不是一个:
		 * 前者说「开工要有候选对比」,这条说「结论要有形态」。一个部署完全可以只要前者。
		 * 机制侧缺省关(= 断言始终是加法),preset 里写 true——与 `blockedThreshold` 同一个模式。
		 */
		requireTypedPromotion: config.requireTypedPromotion === true,
		/**
		 * 两道与它对称的门(机制缺省关,preset 里开):
		 *   · `requireLandedEntities`:断言主体还没落到实体图上 ⇒ 结案被拒。
		 *     它挡的是「本体写得漂亮、实体图是空的」——那是把结论停在散文上的另一种形态。
		 *   · `requireLevelReasons`:有等级被跳过而没写理由 ⇒ 结案被拒。
		 *     它挡的是「一路只在最贵的那一级交付」——便宜的检查从未被走过,却没人知道为什么。
		 * 两条出口都诚实:补齐(RegisterInstance / Assert / ExplainLevelSkip)或如实 abandoned。
		 */
		/** 判据修订门:改「怎样算完成」要带一份独立裁决的 auditKey(机制缺省关,preset 里开)。 */
		requireCriteriaVerdict: config.requireCriteriaVerdict === true,
		requireLandedEntities: config.requireLandedEntities === true,
		requireLevelReasons: config.requireLevelReasons === true,
		bashDenyRules: config.bashDenyRules !== false,
		auditProvider: config.auditProvider ?? 'spawn',
		auditTimeoutMs: config.auditTimeoutMs ?? 240000,
		// 三张脸的**候选**工具名。真正的 face 还要过一道「这个部署里到底有没有这件工具」的过滤
		// (见 resolveToolFace):`read_image` 只在挂了 `attachments` 的部署里存在,名单里写了它、
		// 部署里没有,`tools.restrict` 会**直接抛**(未知工具名)→ 评估整条路 fail-closed。
		auditToolFilter: config.auditToolFilter ?? ['read', 'glob', 'grep', 'read_image'],
		runtimeCard: config.runtimeCard !== false,
		/** 贡献表。缺省 = 全开;要裁剪就从这里裁,而不是去改装配代码。 */
		contributions: config.contributions ?? {},
	}

	/** 贡献表:先校验(装配期炸),后登记(见文件末尾的装配段)。 */
	const CONTRIB = resolveContributions(CFG.contributions)
	const SECTION_LIST = CONTRIB.sections

	/** 宿主读面。缺了它整件事不成立——所以每个工具都显式报错,不静默降级。 */
	const host = () => ctx.get('clearai')

	/**
	 * ═══ 事实的独立落账通道(pendingFacts) ═══════════════════════════════════
	 *
	 * **要解决的问题**:`audit/dispatched` 原来只写在**工具结果的 `mutations` 数组**里。
	 * 子代理是异步的:工具进入 `await` 之后,进程可能被 abort、宿主服务可能瞬态不可得。
	 * 一旦这条路出问题,整批变更随栈帧一起消失——`turnDemand` 的「有裁决在飞 ⇒ hold」不触发,
	 * `sweepEndedAudits` 也看不见,而模型只会原样重试。代价是一次已经算完的评审
	 * (耗时以分钟计)从账本上不存在。
	 *
	 * **修法的第一性原理**:事实不能寄存在"工具调用成功返回"这个易失载体上。
	 * 所以「派发」这一类事实在 **`await` 之前**写进这里,由两个通道各自落账:
	 *   · 同一个工具结果的 `mutations`(及时:这一拍就进投影、卡就能说);
	 *   · 下一拍的 pre-step(兜底:工具抛错/被 abort 也丢不掉)。
	 * 两条通道同源同形,宿主那一侧只有一个折法。
	 *
	 * **幂等**:同一个 id 只落一次(下表记已入账的 id),免得两条通道同一条事实落两遍。
	 */
	const pendingFacts = new Map()
	const pendingFactIds = new Set()
	/** 把一条事实推进独立落账通道(返回它自己,方便调用方同时塞进工具结果的 mutations)。 */
	function landFact(sessionId, mutation) {
		if (mutation === null || typeof mutation !== 'object') return mutation
		const key = `${sessionId}:${String(mutation.t)}:${String(mutation.id ?? mutation.step ?? '')}`
		if (pendingFactIds.has(key)) return mutation
		pendingFactIds.add(key)
		const list = pendingFacts.get(sessionId) ?? []
		list.push(mutation)
		pendingFacts.set(sessionId, list)
		return mutation
	}
	/** 取出并清空这一拍的兜底事实(只有 pre-step 调;重复取到空数组是正常的)。 */
	function drainPendingFacts(sessionId) {
		const list = pendingFacts.get(sessionId) ?? []
		pendingFacts.delete(sessionId)
		return list
	}

	function hasState(state) {
		return state.goal !== null || state.plans.length > 0 || state.evidence.length > 0 || state.materials.length > 0
	}

	/**
	 * 会话工作目录。**拿不到就返回 `null`,绝不回退 `process.cwd()`**。
	 *
	 * 为什么删掉那条回退:会话服务瞬态不可得时,回退会把 `clear/` 下的读面写进
	 * **dsh 进程自己的目录**——评估卡落到进程目录、而工具随后抛错,读账的人再也找不到它。
	 * **"写不出去"与"写到别处"是两件事**:前者是诚实的降级,后者是悄悄改了账本的位置。
	 * 删掉回退之后,「错地方」在类型上不可表示。
	 *
	 * 调用方纪律:纯展示用 `sessionCwdLabel()`;要拼路径用 `sessionFile()`;
	 * 需要裸 cwd 的(快照 / 引导铺设)自己判 `null` 并如实少做一件事。
	 */
	function sessionCwd(sessionId) {
		try {
			const session = ctx.get('sessions')?.get?.(sessionId)
			const cwd = session?.header?.cwd ?? session?.cwd
			if (typeof cwd === 'string' && cwd !== '') return cwd
		} catch {
			/* 服务不可得:如实返回 null,由调用方决定少做哪件事 */
		}
		return null
	}

	/** 卡片 / 提示文案里那个"工作目录":拿不到就如实说拿不到,不写一个假路径。 */
	function sessionCwdLabel(sessionId) {
		return sessionCwd(sessionId) ?? '(会话工作目录这一刻不可得)'
	}

	/** 会话工作区下的一个绝对路径;拿不到会话目录时返回 `null`(调用方跳过这次写入)。 */
	function sessionFile(sessionId, ...parts) {
		const cwd = sessionCwd(sessionId)
		return cwd === null ? null : join(cwd, ...parts)
	}

	/**
	 * 这个会话是不是**派出去的子会话**(评估者)。
	 *
	 * 判据读宿主的会话头:`dsh-subagent` 生成子会话时写死 `parentSession`——与它写死
	 * `cwd: parentHeader.cwd` 是同一处,所以「共享工作区」与「身份是子会话」总是一起出现。
	 * 会话服务问不出来时按「不是子会话」处理:与 `sessionCwd` 的退路同一个方向,
	 * 拿不到证据时维持既有行为,不新增一条静默分支。
	 */
	function isSpawnedChild(sessionId) {
		try {
			const header = ctx.get('sessions')?.get?.(sessionId)?.header
			if (header === null || typeof header !== 'object') return false
			return header.origin === 'subagent' || header.parentSession !== undefined
		} catch {
			return false
		}
	}

	/**
	 * 认一条假设:`id` 最稳,**原文**与**唯一前缀**(≥8 字)也认。
	 *
	 * 为什么放宽:模型会把假设**原文**整句填进 `tests.hypothesis`(真跑里连着三轮都是),
	 * 而当时只认 id,错误信息又不列出有效 id——它于是逐字猜哪里差了一个标点,白烧了三轮上下文。
	 * 「机制把模型逼进猜谜」是机制的问题,不是模型的问题。
	 */
	function matchHypothesis(hypotheses, wanted) {
		const raw = String(wanted ?? '').trim()
		if (raw === '') return null
		const normalize = (text) => String(text ?? '').replace(/\s+/g, '').replace(/[（）()【】\[\]「」]/g, '')
		const exact = hypotheses.find((hypothesis) => hypothesis.id === raw)
		if (exact !== undefined) return exact
		const wantedNormalized = normalize(raw)
		const byText = hypotheses.filter((hypothesis) => normalize(hypothesis.claim) === wantedNormalized)
		if (byText.length === 1) return byText[0]
		if (wantedNormalized.length >= 8) {
			const byPrefix = hypotheses.filter((hypothesis) => normalize(hypothesis.claim).startsWith(wantedNormalized) || normalize(hypothesis.claim).includes(wantedNormalized))
			if (byPrefix.length === 1) return byPrefix[0]
			if (byPrefix.length > 1) return null
		}
		return null
	}

	/**
	 * 一个步骤要检验的判断,一律解析成 **id 数组**:新写法 `tests.hypotheses`(可多条),
	 * 旧写法单条 `tests.hypothesis` 照旧认。一个关键实验可以同时判几条竞争的判断,每条各得一份证据。
	 * 解析在**立约那一刻**做完,账上存的是 id——主张原文改了也认得出。
	 */
	function resolveTests(hypotheses, tests) {
		if (tests === undefined || tests === null) return { ok: true, tests: null }
		const wanted = Array.isArray(tests.hypotheses) ? tests.hypotheses : tests.hypothesis !== undefined ? [tests.hypothesis] : []
		const ids = []
		for (const raw of wanted) {
			const found = matchHypothesis(hypotheses, raw)
			if (found === null) return { ok: false, wanted: String(raw) }
			if (!ids.includes(found.id)) ids.push(found.id)
		}
		return { ok: true, tests: { hypotheses: ids, level: tests.level } }
	}

	/** 一个已登记步骤检验的判断 id(兼容旧账本的单条写法)。 */
	function testedBy(step) {
		const tests = step?.tests
		if (tests === undefined || tests === null) return []
		if (Array.isArray(tests.hypotheses)) return tests.hypotheses.map(String)
		return typeof tests.hypothesis === 'string' && tests.hypothesis !== '' ? [tests.hypothesis] : []
	}

	/**
	 * 一条判断收到的证据。新账上每条证据写明它针对哪条判断(`hypothesis`);
	 * 旧账没有这一格,按「证据 → 步骤 → 步骤检验的判断」那条边找回来。
	 */
	function evidenceFor(state, hypothesisId) {
		const steps = new Map()
		for (const plan of state?.plans ?? []) for (const step of plan.steps ?? []) steps.set(`${plan.id}:${step.id}`, step)
		return (state?.evidence ?? []).filter((item) => {
			if (item.hypothesis !== undefined) return item.hypothesis === hypothesisId
			return testedBy(steps.get(`${item.plan}:${item.step}`)).includes(hypothesisId)
		})
	}

	/** 对不上时**列出全部有效选项**(id 最稳):让模型能照抄,而不是继续猜。 */
	function hypothesisMenu(hypotheses) {
		if (hypotheses.length === 0) return '当前目标没有登记任何假设:先用 Frame 登记(每条约一句话主张 + 一句推翻条件)。'
		return `已登记的假设(用 **id** 最稳,可直接从运行态卡复制;也接受主张原文):${hypotheses
			.map((hypothesis) => `${hypothesis.id}=${String(hypothesis.claim).slice(0, 40)}`)
			.join(';')}`
	}

	/** 一次工具调用的收尾:预演变更 → 卡片 → 返回值。 */
	function finish(hostService, sessionId, mutations) {
		return (value) => {
			const preview = previewOf(hostService, sessionId, mutations)
			const result = {
				...value,
				mutations,
				card: preview.card,
				message: `${value.message ?? value.code ?? 'ok'}\n\n${preview.card}`,
			}
			// 输出**越界就裁掉并告警**:宿主会拿 output.schema 校验工具结果,多一个未声明的字段
			// 会让整个工具调用失败(CreatePlan 曾因此全军覆没)。
			// 裁掉会让模型少看到一个字段(可接受的降级),但绝不让一次成功的动作整个作废。
			const declared = new Set(Object.keys(OUTPUT_SCHEMA.properties))
			const trimmed = Object.keys(result).filter((key) => !declared.has(key))
			if (trimmed.length > 0) {
				ctx.logger?.warn?.(`clearai kernel: 输出越界,已裁掉 ${trimmed.join(',')}(补进 OUTPUT_SCHEMA 才是正解)`)
				for (const key of trimmed) delete result[key]
			}
			return result
		}
	}

	// ═══ 观测准入:只查「收不收」,不查「说明了什么」 ═══════════════════════
	// 判定树:l1 / l2 / no_anchor / invalid / needs_audit。

	function admission(cwd, step, artifactsOverride) {
		const result = { ok: false, verified_by: 'invalid', missing: [], directories: [], empty: [], structural: [], confirmed: [], needs_audit: false, hint: '' }
		if (step === null || typeof step !== 'object') {
			result.missing.push('step')
			return result
		}
		const artifacts = Array.isArray(artifactsOverride) ? artifactsOverride : Array.isArray(step.artifacts) ? step.artifacts : []
		const criteria = typeof step.done_criteria === 'string' ? step.done_criteria.trim() : ''

		if (artifacts.length === 0 && criteria === '') {
			result.missing.push('done_criteria')
			return result
		}

		for (const artifact of artifacts) {
			/**
			 * **目录不可得 ⇒ 按「读不到」处理**,不拿 `null` 去 `resolve`:
			 * 准入回答的是"这份观测收不收",而"我看不到工作区"不是"这份产物不存在"。
			 * 这时候把它记为缺失、如实说清原因,比让工具崩掉诚实。
			 */
			if (typeof cwd !== 'string' || cwd === '') {
				result.missing.push(artifact)
				continue
			}
			const absolute = isAbsolute(artifact) ? artifact : resolvePath(cwd, artifact)
			let stat = null
			try {
				stat = statSync(absolute)
			} catch {
				stat = null
			}
			if (stat === null) {
				result.missing.push(artifact)
				continue
			}
			if (stat.isDirectory()) {
				let files = 0
				let bytes = 0
				const countContents = (directory) => {
					for (const entry of readdirSync(directory, { withFileTypes: true })) {
						const entryPath = join(directory, entry.name)
						if (entry.isDirectory()) countContents(entryPath)
						else if (entry.isFile()) {
							files += 1
							bytes += statSync(entryPath).size
						}
					}
				}
				try {
					countContents(absolute)
				} catch {
					// 目录在读数期间变化时，仍如实说明它不能作为物证。
				}
				result.directories.push(`${artifact}(目录不是物证,含 ${files} 个文件、${bytes} 字节)`)
				continue
			}
			if (stat.size === 0) {
				result.empty.push(`${artifact}(空文件)`)
				continue
			}
			const lower = artifact.toLowerCase()
			if (lower.endsWith('.json')) {
				try {
					JSON.parse(readFileSync(absolute, 'utf8'))
				} catch {
					result.structural.push(`${artifact}(.json 无法解析)`)
					continue
				}
			} else if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
				const body = readFileSync(absolute, 'utf8')
					.split('\n')
					.filter((line) => !line.trimStart().startsWith('#'))
					.join('')
					.trim()
				if (body.length < 20) {
					result.structural.push(`${artifact}(仅有标题/内容过少)`)
					continue
				}
			}
			// 其他扩展名不做结构判定——不误伤
			result.confirmed.push({ ref: artifact, bytes: stat.size, digest: sha256File(absolute) })
		}

		if (result.missing.length > 0) {
			result.verified_by = 'l1'
			result.hint = `声明的产物没落盘:${result.missing.join(', ')}。三条合法出路:①把产物做出来;②改声明(RefinePlan 改判据、AmendPlan 换产物);③带因作废(VoidPlanStep)。`
			return result
		}
		if (result.directories.length > 0) {
			result.verified_by = 'l1'
			result.hint = `声明的产物是目录:${result.directories.join(', ')}。目录不是物证,请在 artifacts 声明具体文件。`
			return result
		}
		if (result.empty.length > 0) {
			result.verified_by = 'l1'
			result.hint = `产物存在但是空:${result.empty.join(', ')}。空文件不是观测。`
			return result
		}
		if (result.structural.length > 0) {
			result.verified_by = 'l2'
			result.hint = `产物结构不合法:${result.structural.join(', ')}。结构合法的产物才能被评估。`
			return result
		}
		if (artifacts.length === 0) {
			result.verified_by = 'no_anchor'
			result.hint = '这一步一个可验收的坐标都没声明——不改变世界的步骤没有可验收的东西。把产物写进 artifacts。'
			return result
		}
		if (criteria === '') {
			// ClearAI 的存量兼容出口。本内核在 CreatePlan/AmendPlan 就强制判据,所以这条路径不可达
			// ——「没有判据 → 确定性放行」这个软肋在这里被关掉。
			result.ok = true
			result.verified_by = 'l1'
			result.hint = '判据为空,坐标即完成声明(存量兼容出口)。'
			return result
		}
		result.verified_by = 'needs_audit'
		result.needs_audit = true
		result.hint = '坐标齐备,判据非空 → 交独立评估者裁决(准入不裁决)。'
		return result
	}

	// ═══ 独立评估者:派遣是触发,不是模型的选择 ═════════════════════════════
	// 「做的人不判自己」的机制位。裁决只取自结构化回包;评估卡由系统落盘。

	const EVALUATOR_DISCIPLINE = [
		'## Evaluator人格:评估者 —— 只核对,不发挥',
		'你是独立评估者:拿着判定标准与产物,做冷静、可复核的评估,产出一张结构化评估卡。你没有参与探索,不背任何方案的立场——这正是你可信的原因。',
		'',
		'**三层信道(按幻觉风险):**',
		'1. 硬信号(零幻觉,最可信):产物自带的客观数字、文件是否存在及字段是否齐、以及执行记录。直接读取已落盘的产物,照抄进评估卡——不要自行写文件、不要执行命令、不要润色或估计。',
		'2. 领域信号(逐条核对):逐条对照判据给结论(通过/不通过/不适用 + 一句证据),不发挥、不新增标准。',
		'3. 软判断(有幻觉风险,须隔离标注):报告完整性、方案合理性这类主观项可以给,但必须显式标注「主观评估」。',
		'',
		'**纪律:**',
		'- 只核对不发挥:你的职责是对照标准验收,不是重做方案、不是提改进建议。',
		'- 你没有写入权限:任何需要产出文件的事都不是你的事。',
		'- 你给**两项**裁决,不要混在一起:',
		'  · **交付成立吗**(`holds`):yes = 判据逐条满足、观测真实;no = 有判据不满足,或观测与记录对不上;unclear = 凭现有材料判不了。',
		'  · **每条判断的结果**(`results`,这一步检验几条就给几格):对照它的推翻条件读——support = 没碰到推翻条件,refute = 碰到了,inconclusive = 这次观测区分不了。',
		'- 交付成立与判断被推翻可以同时为真:推翻是有价值的结果,它不让交付失败。不要为了让步骤通过而写 support。',
		'',
		'**回包的形状就是你的动作空间(字段长度由 schema 校验,超了会被拒):**',
		'- `basis` 是**一句话结论**,≤1200 字。**不要在这里写论证**——论证放 `refs`:逐条 `{path, line}` 指到你实际读过的文件与行,让第三方照着就能复核。',
		'- `shortfalls` 每条**必须**写成三格:`{criterion, what, missing}`——`criterion` 指明**判据的哪一条**(引它的编号或原文前 20 字),`what` 是你实际读到的(带 `path:line`),`missing` 是还缺什么才算满足。**一段散文不算一条缺口**:读的人无法逐条对照。',
		'- 没有缺口就给空数组;有缺口却只写"整体不足"等于没写。',
	].join('\n')

	/**
	 * **裁决卡的形状 = 预算**。
	 *
	 * 一篇数千字的 `basis` 会让评估者的单步生成吃掉一兩分钟,而这论证本该由父会话展开。
	 * **耗时不是靠提示词劝下来的**,而是靠协议的形状:`basis` 是给一句话的,
	 * 论证放 `refs` 逐条指到文件与行;每条缺口写成「哪条判据 / 你看到什么 / 还缺什么」三格。
	 * 字段长度由 schema 校验,runtime 会拒绝越界产出——这才叫机制。
	 */
	const VERDICT_SCHEMA = {
		type: 'object',
		properties: {
			holds: { type: 'string', enum: ['yes', 'no', 'unclear'], description: '交付成立吗:yes=判据逐条满足、观测真实;no=有判据不满足或观测不真实;unclear=凭现有材料判不了' },
			basis: { type: 'string', maxLength: 1200, description: '一句话结论(≤1200 字);展开的论证放 refs,不要写在这里' },
			results: {
				type: 'array',
				description: '这一步检验的每条判断各一格:对照它的推翻条件读结果。不检验判断的步骤给空数组。',
				items: {
					type: 'object',
					properties: {
						hypothesis: { type: 'string', maxLength: 80, description: '判断的 id' },
						verdict: { type: 'string', enum: ['support', 'refute', 'inconclusive'] },
						basis: { type: 'string', maxLength: 600, description: '一句话:这次观测对照推翻条件读出了什么' },
					},
					required: ['hypothesis', 'verdict'],
					additionalProperties: false,
				},
			},
			shortfalls: {
				type: 'array',
				description: '每条缺口一格:哪条判据、你看到什么、还缺什么。不要写散文。',
				items: {
					type: 'object',
					properties: {
						criterion: { type: 'string', maxLength: 200, description: '判据的哪一条(引它自己的编号或原文前 20 字)' },
						what: { type: 'string', maxLength: 400, description: '你实际读到的是什么(带 path:line)' },
						missing: { type: 'string', maxLength: 200, description: '还缺什么才算满足' },
					},
					required: ['criterion', 'what', 'missing'],
					additionalProperties: false,
				},
			},
			refs: {
				type: 'array',
				description: '逐条证据引用:文件与行号。裁决要能被第三方照着复核。',
				items: {
					type: 'object',
					properties: {
						path: { type: 'string', maxLength: 300 },
						line: { type: 'integer' },
					},
					required: ['path'],
					additionalProperties: false,
				},
			},
		},
		/**
		 * `refs` **声明但不强制**。
		 *
		 * 它是我们想要的形状(逐条可复核),但把它写进 `required` 会让一份**完全可用**的裁决
		 * 因为少一个数组而被 runtime 丢掉——那时"有没有裁决"就变成了抛硬币。这不是假设:
		 * 一次真跑的评估者在正文里写清了 `verdict: support`,而结构化通道被 schema 拒收,
		 * 目标于是永远结不了案。**先保证裁决到得了,再要求它可复核**;没给 refs 时,
		 * 下面的正文兜底会把裁决从 markdown 卡片里取回来(并且如实标注它是被救回来的)。
		 */
		required: ['holds', 'basis'],
		additionalProperties: false,
	}

	function evaluatorPrompt(state, step, gate, sessionId) {
		const goal = state.goal
		const tested = testedBy(step)
			.map((id) => state.hypotheses.find((item) => item.id === id))
			.filter((item) => item !== undefined)
		return [
			EVALUATOR_DISCIPLINE,
			'',
			'# 评估任务书(Harness 派发:你不是被评估者,也不是执行者)',
			'',
			`- 步骤:${step.id}${step.ordinal > 0 ? `(第 ${step.ordinal} 步)` : ''}`,
			`- 这一步要做什么:${step.do}`,
			goal === null ? '- 目标:未立' : `- 目标:${goal.claim}`,
			`- **判定标准(在做之前就已登记)**:${step.done_criteria}`,
			step.tests == null ? '- 本步未声明验证等级' : `- 验证等级:${step.tests.level}(决定谁可以写裁决)`,
			...(tested.length === 0
				? ['- 本步不检验判断:`results` 给空数组']
				: ['- 本步检验的判断(每条在 `results` 里各给一格):', ...tested.map((item) => `  · ${item.id}:${item.claim}(推翻条件:${item.refute_when})`)]),
			'',
			'# 已通过观测准入的坐标(Harness 核验过存在、非空、结构合法)',
			...(gate.confirmed.length === 0 ? ['- (无)'] : gate.confirmed.map((item) => `- ${item.ref} — ${item.bytes} 字节 — ${item.digest ?? 'digest 不可得'}`)),
			...(Array.isArray(gate.extra) && gate.extra.length > 0 ? ['', ...gate.extra] : []),
			'',
			`工作目录:${sessionCwdLabel(sessionId)}`,
			'',
			'请只读上述坐标与执行记录,给出两项裁决:拿**已登记的判定标准**对照观测,判交付成立吗(`holds`);再拿每条判断的**推翻条件**对照观测,读出它的结果(`results`)。',
			'准入只核验了「坐标存在且非空」——齐备不等于这一步做完了;判据里的断言(数值、口径、一致性)必须由你逐条核对。',
			'你不得修改任何文件,不得执行写入命令,不得重做方案。',
		].join('\n')
	}

	/**
	 * 裁决归一化。**两种形状都认**:新形状是
	 * `shortfalls[{criterion, what, missing}]`,旧形状是 `shortfalls: string[]`
	 * (老评估者、老账本、以及某些 provider 不校验 schema 时都会给旧形状)。
	 *
	 * 为什么必须显式兼容:契约升级时最坏的做法是"新形状之外一律丢"——
	 * 那会让一份合法但旧式的裁决在账上变成"没有缺口"。两种都在,各自如实。
	 */
	function normalizeVerdict(value) {
		/**
		 * 旧形状只有一个 `verdict`:那时评估者用它说的是「交付成立吗」(真跑里的依据都写着「判据满足」),
		 * 所以 support/refute/inconclusive 按 yes/no/unclear 读回来,不把它当成对判断的结果。
		 */
		const legacy = typeof value?.verdict === 'string' ? value.verdict.toLowerCase() : null
		const rawHolds = typeof value?.holds === 'string' ? value.holds.toLowerCase() : null
		const holds = ['yes', 'no', 'unclear'].includes(rawHolds) ? rawHolds : legacy === 'support' ? 'yes' : legacy === 'refute' ? 'no' : 'unclear'
		const results = []
		for (const item of Array.isArray(value?.results) ? value.results : []) {
			if (item === null || typeof item !== 'object') continue
			const hypothesis = String(item.hypothesis ?? '').trim()
			const verdict = String(item.verdict ?? '').toLowerCase()
			if (hypothesis === '' || !['support', 'refute', 'inconclusive'].includes(verdict)) continue
			results.push({ hypothesis: hypothesis.slice(0, 80), verdict, basis: typeof item.basis === 'string' && item.basis.trim() !== '' ? item.basis.trim().slice(0, 600) : null })
		}
		const shortfalls = []
		for (const item of Array.isArray(value?.shortfalls) ? value.shortfalls : []) {
			if (typeof item === 'string') {
				const plain = item.trim()
				// 旧形状:一整段散文。**不丢**,但把它按"还没有结构"如实标注,而不是硬塞成三格。
				if (plain !== '') shortfalls.push({ criterion: '未结构化(旧式裁决)', what: plain.slice(0, 400), missing: '' })
				continue
			}
			if (item === null || typeof item !== 'object') continue
			const criterion = String(item.criterion ?? '').trim()
			const what = String(item.what ?? '').trim()
			const missing = String(item.missing ?? '').trim()
			if (criterion === '' && what === '' && missing === '') continue
			shortfalls.push({ criterion: criterion.slice(0, 200), what: what.slice(0, 400), missing: missing.slice(0, 200) })
		}
		const refs = []
		for (const item of Array.isArray(value?.refs) ? value.refs : []) {
			if (item === null || typeof item !== 'object') continue
			const path = String(item.path ?? '').trim()
			if (path === '') continue
			const line = Number.isInteger(item.line) ? item.line : null
			refs.push({ path: path.slice(0, 300), line })
		}
		const basis = typeof value?.basis === 'string' && value.basis.trim() !== '' ? value.basis.trim() : '评估者未给出依据'
		return {
			holds,
			results,
			// 截断是**兜底**:schema 已声明 maxLength,越界的产出本不该到这里;真到了也不能让账本吃下五千字。
			// 截断标记**算在预算内**:申报多少就必须是多少。
			basis: basis.length > 1200 ? `${basis.slice(0, 1170)}…(裁到 1200 字;完整论证应由 refs 指认)` : basis,
			shortfalls,
			refs,
		}
	}

	/**
	 * 缺口的**一行话**。两种形状都认:新形状是 `{criterion, what, missing}` 三格,
	 * 旧形状是纯字符串(老裁决/内核自己落的 code)。**一行一条**,不再把几段散文拼成一段。
	 */
	function verdictText(shortfalls) {
		if (!Array.isArray(shortfalls)) return ''
		return shortfalls
			.map((item) => {
				if (typeof item === 'string') return item
				if (item === null || typeof item !== 'object') return ''
				const parts = [String(item.criterion ?? '').trim(), String(item.what ?? '').trim(), String(item.missing ?? '').trim()].filter((part) => part !== '')
				return parts.join(' · ')
			})
			.filter((line) => line !== '')
			.join('; ')
	}

	function parseLooseJson(output) {
		const raw = (output ?? [])
			.filter((block) => block?.type === 'text')
			.map((block) => block.text)
			.join('\n')
		const match = raw.match(/\{[\s\S]*\}/)
		if (match !== null) {
			try {
				return JSON.parse(match[0])
			} catch {
				/* 不是 JSON:落到下面的正文卡片形态 */
			}
		}
		/**
		 * **正文卡片兜底**。
		 *
		 * 为什么必须有:评估者经常不吐 JSON,而是写一张 markdown 评估卡
		 * (`## 评估卡 · …` / `**verdict: support**` / `**basis**:…`)。那时结构化通道可能整个是空的
		 * (模型没走结构化输出,或形状不合 schema),只认 JSON 就等于**把一份写得清清楚楚的裁决丢掉**
		 * ——账上只剩下"无法判定",而真实原因是我们没读。这不是评估者没说,是我们没听。
		 *
		 * 取法刻意保守:只认 `verdict:` 后面紧跟的那三个词之一(允许 markdown 加粗),
		 * `basis` 取它之后到下一个标题/表格前的一段(有长度上限)。取不到就如实说取不到——
		 * 猜一份 support 比丢掉一份 refute 坏得多。
		 */
		const holdsMatch = raw.match(/holds\s*[:：]\s*\**\s*(yes|no|unclear)\b/i)
		const verdictMatch = holdsMatch ?? raw.match(/verdict\s*[:：]\s*\**\s*(support|refute|inconclusive)\b/i)
		if (verdictMatch === null) return { holds: 'unclear', basis: '评估者没有返回可解析的裁决', shortfalls: ['card_unparsable'] }
		const after = raw.slice(verdictMatch.index + verdictMatch[0].length)
		const basisMatch = after.match(/basis\s*\*{0,2}\s*[:：]\s*\**\s*([\s\S]{4,1200}?)(?=\n\s*\n|\n#{1,6}\s|\n\|)/i)
		const basis = (basisMatch === null ? after.slice(0, 400) : basisMatch[1]).replace(/\s+/g, ' ').trim()
		return {
			...(holdsMatch === null ? { verdict: verdictMatch[1].toLowerCase() } : { holds: verdictMatch[1].toLowerCase() }),
			basis: basis === '' ? '评估者给了裁决但没写依据(正文卡片里没有可取的 basis)' : basis,
			shortfalls: [],
			/** 读的人要能分辨:这条裁决是从正文里救回来的,不是结构化通道给的。 */
			salvaged_from_text: true,
		}
	}

	const pendingAudits = new Map()

	/**
	 * 把「候选工具名」解析成**这个部署里真的有**的那一张脸。
	 *
	 * 第一性原理:角色的边界是**工具面**(平台执行),不是人格里的一句嘱咐——所以我们要给子 run
	 * 一张明确的 allow 表;但那张表**不能写死**:`read_image` 只在挂了 `attachments` 的部署里存在
	 * (`dsh-tool-fs` 把它的注册包在 `ctx.inject(['attachments'], …)` 里),而 `tools.restrict({allow})`
	 * 遇到**未知工具名会直接抛**(它自己会校验 known restrictable tools)。写死的结果是:
	 * 在没挂图像能力的部署里,评估者一派出就 fail-closed——「补一个只读工具」变成「打断整次评估」。
	 *
	 * 奥卡姆:不新造「只读分类器」(DSH 也没有这个标记——`executionMode` 管的是并发调度,不是只读),
	 * 就问**已经存在的那个权威**:工具注册表(`ctx.tools.get(name, scope)`)。
	 * 名单仍由我们写(要显式排除 `ask_user_question` 这类人工通道),存在性交给平台回答。
	 */
	function resolveToolFace(agent, names) {
		const tools = ctx.get('tools')
		if (tools === undefined || typeof tools.get !== 'function') return names
		let scope
		try {
			scope = agent
		} catch {
			scope = undefined
		}
		const known = names.filter((name) => {
			try {
				return tools.get(name, scope) !== undefined
			} catch {
				return true // 注册表问不出来就保留:别把候选名单悄悄削短
			}
		})
		return known.length > 0 ? known : names
	}

	/** 读一次当前状态(评估任务书要用它)。宿主不在时给个空壳,让任务书照样能生成。 */
	function stateOf(sessionId) {
		const hostService = host()
		return hostService === undefined ? { goal: null, hypotheses: [] } : hostService.state(sessionId)
	}

	/**
	 * 派一次子 run(评估者用的原语)。
	 *
	 * 两件事在这里定死,调用方不用各写一遍:
	 *   · **能力降级链**:provider 支持哪些能力就用到哪一层(工具面 > 人格 > 结构化回包 > 只剩提示词),
	 *     降级事实随派遣一起落账 —— 不假装机制还在。
	 *   · **fail-closed**:派不出去就返回 ok:false,由调用方决定后果
	 *     (评估者:这一步不推进)。绝不静默降级成"没有独立裁决也算过"。
	 */
	async function dispatchSubRun(options) {
		const subagents = ctx.get('subagents')
		if (subagents === undefined) return { ok: false, reason: 'subagents 服务不可用', failures: [] }
		const base = { label: options.label, parent: options.parent, signal: options.signal, prompt: text(options.prompt) }
		const persona = options.persona
		const schema = options.outputSchema ?? undefined
		const toolFilter = options.toolFilter ?? null
		const failures = []
		const attempts = []
		if (toolFilter !== null) attempts.push({ variant: { persona, outputSchema: schema, toolFilter }, capability: 'persona+outputSchema+toolFilter' })
		attempts.push({ variant: { persona, outputSchema: schema }, capability: 'persona+outputSchema' })
		if (toolFilter !== null) attempts.push({ variant: { persona, toolFilter }, capability: 'persona+toolFilter' })
		attempts.push({ variant: { persona }, capability: 'persona' })
		if (schema !== undefined) attempts.push({ variant: { outputSchema: schema }, capability: 'outputSchema' })
		attempts.push({ variant: {}, capability: 'prompt-only' })
		for (const attempt of attempts) {
			try {
				const run = await subagents.start(CFG.auditProvider, { ...base, ...attempt.variant })
				/**
				 * `native: false` = 结论不会由运行时投递,得靠收集那一刻的返回值带上(降级路径)。
				 * `degraded` 把**为什么降级**如实带出去(调用方落进账本):只说「能力不是 continuable」
				 * 不解释原因,读账的人无法判断这是部署限制还是代码 bug。
				 */
				return { ok: true, run, capability: attempt.capability, native: false, degraded: failures[0] ?? null }
			} catch (error) {
				failures.push(`${attempt.capability}:${String(error?.message ?? error).slice(0, 100)}`)
			}
		}
		return { ok: false, reason: failures.join(' | '), failures }
	}

	/**
	 * **从评估者自己的会话日志里读回结论**(结论若只挂在父进程内存的 promise 上,父进程一断就永久丢)。
	 *
	 * 结论并没有丢:它写在评估者自己的会话日志里(最后一次 `turn/end` 的缘由 + 最后一条 assistant 文本)。
	 * 「什么都不删」在这里的具体含义是:**没丢的东西不该当成丢了**。
	 *
	 * 平台边界:宿主的 `sessions` 服务只认**活在当前进程里**的会话(`get(id)`)。
	 * 会话不在了就返回 null,由调用方如实记为 unknown——这一层我们不假装能读。
	 */
	function recoverFromChildSession(childId) {
		const sessions = ctx.get('sessions')
		if (sessions === undefined || typeof sessions.get !== 'function') return null
		let session = null
		try {
			session = sessions.get(childId) ?? null
		} catch {
			return null
		}
		if (session === null && typeof sessions.list === 'function') {
			// 有些部署里 `get` 只认带前缀的 id:按前缀再找一次(仍然是**别人的**会话,只读事件)。
			try {
				session = sessions.list().find((item) => String(item?.id ?? '').includes(childId)) ?? null
			} catch {
				session = null
			}
		}
		if (session === null) return null
		let events = []
		try {
			events = typeof session.ownEvents === 'function' ? session.ownEvents() : typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
		} catch {
			return null
		}
		let end = null
		for (const event of events) if (event?.type === 'turn/end') end = event
		if (end === null) return null // 还没跑完:不动它(它真的还在跑)
		let conclusion = ''
		for (const event of events) {
			if (event === end) break
			if (event?.type !== 'assistant/message') continue
			const blocks = event.data?.message?.content ?? []
			const text = blocks
				.filter((block) => block?.type === 'text')
				.map((block) => String(block.text ?? ''))
				.join('\n')
				.trim()
			if (text !== '') conclusion = text
		}
		const reason = String(end.data?.reason?.kind ?? 'unknown')
		const ok = reason === 'completed'
		/**
		 * 异常结束的结论要**自带说明**,与一次性派遣那条路(`settleSubRun`)同一个形状:
		 * 半截文本被当成「回灌过的结论」是这里最危险的假话。两条路形状一致,
		 * 「这句话是从哪条路来的」就不再影响账本的可读性。
		 */
		return { ok, stopReason: reason, conclusion: ok ? conclusion : `子任务未正常结束(${reason}):${conclusion.slice(0, 1200)}` }
	}


	/**
	 * **已结束的评估者**。
	 *
	 * `pendingAudits` 是**进程内**的:重启之后它空了,而投影里那条 `audit/dispatched` 还在
	 * (`verdict === null`)。后果有两条,后一条更狠:
	 *   ① 卡片与面板永远写「正在裁决」——一句等不到下文的承诺;
	 *   ② `turnDemand` 见到未落定的裁决就 `hold`(**「机器等待,不推」**)——
	 *      一条永远不会回来的裁决,把整个目标按死在挂起上。
	 *
	 * 判据不看内存,看**宿主的目录**:`subagents.listChildren(sessionId)` 给每个子会话一个
	 * `activity: 'running' | 'inactive'`(还在跑 / 只剩日志)——**宿主是"还在不在跑"的唯一权威**。
	 * 目录说已结束 ⇒ 这次运行**结束了**。结束不等于失联:结论可能就躺在它自己的会话日志里,
	 * 所以**先取回**,取不回才如实落 unknown。
	 *
	 * 结算只报事实、不给建议(「重新交付会派一个新的评估者」那类话删了):
	 * 要不要重试是计划层的决定,不是账本该说的话。
	 *
	 * 拿不到目录(服务不在 / 查询失败)时**什么都不做**:不猜、不误伤正在跑的裁决。
	 */
	async function sweepEndedAudits(sessionId, state) {
		const pending = (state?.audits ?? []).filter((audit) => audit.verdict === null && typeof audit.child === 'string' && audit.child !== '')
		if (pending.length === 0) return { mutations: [], lost: 0, lines: [] }
		// 这个进程里正攥着的那几次派遣:它们是活的,不问目录。
		const known = new Set([...pendingAudits.values()].map((entry) => String(entry.run?.id ?? '')))
		const unresolved = pending.filter((audit) => !known.has(String(audit.child)))
		if (unresolved.length === 0) return { mutations: [], lost: 0, lines: [] }
		const subagents = ctx.get('subagents')
		if (subagents === undefined || typeof subagents.listChildren !== 'function') return { mutations: [], lost: 0, lines: [] }
		let children = []
		try {
			children = await subagents.listChildren(sessionId)
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 列子代理失败,本次不判失联 ${String(error?.message ?? error).slice(0, 120)}`)
			return { mutations: [], lost: 0, lines: [] }
		}
		const running = new Set((Array.isArray(children) ? children : []).filter((item) => item?.kind === 'child' && item.activity === 'running').map((item) => String(item.id)))
		const mutations = []
		const lines = []
		for (const audit of unresolved) {
			if (running.has(String(audit.child))) continue
			/**
			 * 宿主说已结束 ⇒ **先把它的结论取回来**(读它自己的会话日志)。
			 * 跳过它就把「结束」误报成「死亡」,还会诱导重新交付 ⇒ 同一次评估被重做。
			 */
			const recovered = recoverVerdictFromChildSession(audit.child)
			if (recovered !== null && recovered.ok === true) {
				const card = { schema_version: 'clearai.audit.v2', kind: audit.kind ?? 'evidence_audit', step_id: audit.step, auditor_run_id: String(audit.child), holds: recovered.verdict.holds, results: recovered.verdict.results, shortfalls: recovered.verdict.shortfalls, card: recovered.verdict.basis, created_at: Date.now() }
				const cardPath = writeAuditCard(sessionId, audit.step, card)
				mutations.push({ t: 'audit/settled', id: audit.id, step: audit.step, verdict: recovered.verdict.holds, holds: recovered.verdict.holds, results: recovered.verdict.results, basis: recovered.verdict.basis, shortfalls: recovered.verdict.shortfalls, card_path: cardPath, digest: audit.digest ?? null })
				lines.push(`${audit.step}:裁决从子会话日志取回(交付成立:${recovered.verdict.holds})`)
				continue
			}
			if (recovered !== null && recovered.ok !== true) {
				mutations.push({ t: 'audit/settled', id: audit.id, step: audit.step, verdict: 'unknown', basis: `评估者已结束,但未正常完成(${recovered.stopReason})。`, shortfalls: ['audit_incomplete'], card_path: null, digest: audit.digest ?? null })
				lines.push(`${audit.step}:评估者已结束、未正常完成(记为 unknown)`)
				continue
			}
			mutations.push({ t: 'audit/settled', id: audit.id, step: audit.step, verdict: 'unknown', basis: '评估者已结束(宿主目录报告),但其结论未能从子会话日志取回。', shortfalls: ['auditor_ended_uncollected'], card_path: null, digest: audit.digest ?? null })
			lines.push(`${audit.step}:评估者已结束、结论未取回(记为 unknown)`)
		}
		return { mutations, settled: mutations.length, lines }
	}

	/**
	 * 从子会话日志里取回**评估者**的裁决(经 `recoverFromChildSession`)。
	 *
	 * 返回三档:`{ok:true, verdict}` 取回了;`{ok:false, stopReason}` 它结束了但未正常完成;
	 * `null` 连它的日志都读不到。三档都只是**读数**,判断留给调用方如实分档。
	 */
	function recoverVerdictFromChildSession(childId) {
		const settled = recoverFromChildSession(childId)
		if (settled === null) return null
		if (settled.ok !== true) return { ok: false, stopReason: settled.stopReason }
		const verdict = normalizeVerdict(parseLooseJson([{ type: 'text', text: settled.conclusion }]))
		return { ok: true, verdict }
	}

	/**
	 * ═══ 裁决复用:同态不重派 ═════════════════════════════════════════════════
	 *
	 * **代价**:同一个目标在零工具调用、状态逐字未变的情况下可以被反复结案,
	 * 每次都从头派一个评估者、各烧掉一两分钟;而上一次的结论被平台错误丢掉之后,
	 * 模型只会原样再烧一遍。**没有算术依据的重派,就是把等待当成进展。**
	 *
	 * **修法**:复用判据是**状态内容**,不是"模型又喊了一次结案"。
	 * digest 覆盖:裁决种类、被裁决的步、目标修订号、准入坐标、证据集合。
	 * 只要这五项一字不变,无论 Conclude 喊多少次都只评审一次;证据一变 digest 就变,
	 * **必然**重派。两种语义都由算术决定,不靠模型自觉。
	 *
	 * 只有**落定过的裁决**才可复用(`verdict` 非 null 且不是 unknown):
	 * `unknown` 不是裁决,它只说明"那一次没成",那正是应该重派的理由。
	 */
	function auditDigest(kind, step, plan, state, gate) {
		/**
		 * **digest 只盖「材料」,不盖「上一次裁决留下的东西」。**
		 *
		 * 为什么这一条是这套复用能不能用的分水岭:一次不确定的结案自己会落一条
		 * `evidence/recorded`(`anchor:'auditor'`)。原来 digest 把证据集合整个算进去,
		 * 于是**每重试一次 digest 就变一次**,复用永远命中不了——模型每喊一次结案就再烧两三分钟,
		 * 而两次之间它什么都没改。这不是"新证据",是同一条评审自己的回声。
		 *
		 * 所以这里只取**可能改变结论的材料**:
		 *   · 目标修订号(判据/假设换了内容才会变);
		 *   · 计划的步与产物(交付了什么);
		 *   · 观测(state.materials);
		 *   · 原始假设(claim / status / 断言)——**刻意不用派生读数**:
		 *     `supportedLevel` / `refutations` / `inconclusive` 都是证据算出来的,
		 *     而审计留下的那条证据会把它们改掉,用它就等于把回声又算进来一次;
		 *   · 已升格事实;
		 *   · **非审计来源**的证据(自判的 L0–L2 是真材料,保留)。
		 *
		 * 于是语义变成:材料变了 ⇒ 必然重审;材料没变 ⇒ 复用上次裁决,并把这件事说明白。
		 */
		const material = (Array.isArray(state?.evidence) ? state.evidence : [])
			.filter((item) => String(item?.anchor ?? '') !== 'auditor')
			.map((item) => `${String(item?.id ?? '')}:${String(item?.verdict ?? '')}:${String(item?.level ?? '')}`)
		const hypotheses = (Array.isArray(state?.hypotheses) ? state.hypotheses : []).map((item) =>
			[String(item?.id ?? ''), String(item?.status ?? ''), String(item?.claim ?? '').replace(/\s+/g, ' '), JSON.stringify(item?.assertions ?? null)].join(':'),
		)
		const materials = (Array.isArray(state?.materials) ? state.materials : []).map((item) => `${String(item?.id ?? '')}:${String(item?.digest ?? '')}`)
		const facts = (Array.isArray(state?.facts) ? state.facts : []).map((item) => `${String(item?.id ?? '')}:${String(item?.level ?? '')}:${JSON.stringify(item?.assertions ?? null)}`)
		/**
		 * 步的**判据**与产物一起算材料:判据一变,"这一步算不算做完"就是另一个问题
		 * (`evaluatorPrompt` 会把判据逐字交给评估者)——不把它算进来会出现
		 * "改了判据却复用旧裁决"这种明显错的复用。
		 */
		const steps = (Array.isArray(plan?.steps) ? plan.steps : []).map((item) => `${String(item?.id ?? '')}:${String(item?.status ?? '')}:${String(item?.done_criteria ?? '')}:${(Array.isArray(item?.artifacts) ? item.artifacts : []).join('|')}`)
		const goal = `${String(state?.goal?.id ?? '')}:${Number(state?.goal?.revision ?? 0)}`
		/**
		 * **准入坐标里只有"产物"算材料**。
		 *
		 * `gate.confirmed` 在两条路上形状不同:证据审计那一侧是**产物路径 + 字节数 + 内容摘要**
		 * (文件内容一变,digest 就变——这是"交付的东西真的改了吗"的唯一硬信号);
		 * 目标审计那一侧是 `evidence:` / `hypothesis:` 两类引用(证据集合与派生读数)——
		 * 把它们算进来,就等于又把上一次评审的回声算进来一次。
		 * 所以:留下产物,去掉回声。
		 */
		const artifacts = (Array.isArray(gate?.confirmed) ? gate.confirmed : [])
			.filter((item) => {
				const ref = String(item?.ref ?? '')
				return !ref.startsWith('evidence:') && !ref.startsWith('hypothesis:')
			})
			.map((item) => `${String(item?.ref ?? '')}:${String(item?.bytes ?? '')}:${String(item?.digest ?? '')}`)
		const root = createHash('sha256').update(JSON.stringify([kind, step.id, goal, steps, materials, hypotheses, facts, material, artifacts])).digest('hex')
		return root.slice(0, 16)
	}

	/**
	 * 一条结算事实说的「交付成立吗」。新账写在 `holds` 上;旧账只有 `verdict`,
	 * 那时它说的就是交付成立吗,按 support→yes、refute→no、inconclusive→unclear 读。
	 */
	function auditHolds(audit) {
		const holds = String(audit?.holds ?? '')
		if (['yes', 'no', 'unclear', 'unknown'].includes(holds)) return holds
		const legacy = String(audit?.verdict ?? '')
		if (legacy === 'support') return 'yes'
		if (legacy === 'refute') return 'no'
		if (legacy === 'inconclusive') return 'unclear'
		return legacy
	}

	/** 投影里最近一条与该 digest 相同、且**真的给出了裁决**的结算事实。 */
	function reuseAudit(state, stepId, digest) {
		const matched = (state?.audits ?? []).filter((audit) => String(audit?.step ?? '') === String(stepId) && String(audit?.digest ?? '') === digest)
		for (let index = matched.length - 1; index >= 0; index -= 1) {
			const audit = matched[index]
			if (!['yes', 'no', 'unclear'].includes(auditHolds(audit))) continue
			return audit
		}
		return null
	}

	async function runEvaluator(sessionId, agent, plan, step, gate, kind, signal) {
		const mutations = []
		const auditKey = `a-${step.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		const key = `${sessionId}:${kind}:${step.id}`
		const digest = auditDigest(kind, step, plan, stateOf(sessionId), gate)
		let entry = pendingAudits.get(key)
		/**
		 * **同态复用**:先看在飞的(pendingAudits),再看**已经落定的**(投影里 digest 相同且给出了裁决的那一条)。
		 * 顺序不能反:在飞的那一次还没结论,复用一条更早的裁决会让"刚派出去的"变成孤儿。
		 */
		/**
		 * **三类裁决都能复用**——判据是"材料变没变",与"谁在问"无关。
		 *
		 * 交付那一步(`evidence_audit`)原来被排除在外,理由是"每次交付都该留一条自己的裁决行"。
		 * 那条理由只对了一半:该留的是**这次交付发生过**,而不是"又烧了一次评估者"。
		 * 所以复用照样说话——落一条 `audit/reused`(谁复用了谁的裁决、凭哪个 digest),
		 * 而"重复交付"这件事由**连拦计数**接着管(见 `AdvancePlan` 里那条 `audit_reused` 分支):
		 * 材料没变就重来 ⇒ 计数 +1,达阈值把计划置 blocked 停下等人。
		 * 于是"每次交付都被记下来"与"不重复花钱"两件事同时成立。
		 */
		if (entry === undefined) {
			const reused = reuseAudit(stateOf(sessionId), step.id, digest)
			if (reused !== null) {
				/**
				 * 落一条 `audit/reused` 而不是静默返回:**"这次没花钱"也要是账上的事实**,
				 * 否则读账的人分不清"复用了一次裁决"和"这次根本没派"。
				 */
				mutations.push({
					t: 'audit/reused',
					id: auditKey,
					step: step.id,
					plan: plan?.id ?? 'goal',
					kind,
					digest,
					by: String(reused.id ?? ''),
				})
				return {
					holds: auditHolds(reused),
					results: Array.isArray(reused.results) ? reused.results : [],
					basis: String(reused.basis ?? ''),
					shortfalls: Array.isArray(reused.shortfalls) ? reused.shortfalls : [],
					cardPath: reused.card_path ?? null,
					/**
					 * **出处不因复用而消失**:这份裁决当初是哪张卡、哪个评估者会话写的,
					 * 照旧带出来——否则复用会让证据变成一个点不开的东西,而"可复核"正是它的全部价值。
					 */
					evaluatorSession: reused.child ?? null,
					reusedFrom: String(reused.id ?? ''),
					reused: true,
					digest,
					mutations,
				}
			}
		}
		if (entry === undefined) {
			/**
			 * **派发事实在 `await` 之前就落账**——这是这条通道存在的全部理由。
			 *
			 * 工具在 `await` 期间可能被 abort、宿主 fiber 可能瞬态掉线;那时结果永远不回来,
			 * 而"我派过一个评估者"是**已经发生的事实**。把它写在 await 之后,等于把事实寄存在
			 * 一个会被撤销的栈帧里:`hold` 不触发、`sweepEndedAudits` 看不见,模型只会原样重试。
			 *
			 * `id` 取一个与裁决 digest 绑定的**稳定键**:同一个状态反复结案得到同一个键,
			 * 于是下面那次"带上子会话 id 的完整事实"按 id 覆盖它,而不是在账上留两条。
			 */
			const pendingId = `audit:pending:${kind}:${step.id}:${digest}`
			landFact(sessionId, { t: 'audit/dispatched', id: pendingId, step: step.id, plan: plan?.id ?? 'goal', kind, digest, capability: null, evaluator_session: null, status: 'dispatching' })
			const dispatched = await dispatchSubRun({
				label: `${kind === 'goal_audit' ? '目标评估者' : '评估者'} · ${step.id}`,
				persona: EVALUATOR_DISCIPLINE,
				prompt: evaluatorPrompt(stateOf(sessionId), step, gate, sessionId),
				outputSchema: VERDICT_SCHEMA,
				toolFilter: { allow: resolveToolFace(agent, CFG.auditToolFilter) },
				parent: agent,
				signal,
			})
			if (dispatched.ok !== true) {
				/**
				 * 派不出去:把那条"正在派"如实结掉。结算与派发**同 id**,且上面那条 pending
				 * 走的是独立落账通道、在 `withPendingFacts` 的合并结果里排在前面,所以折法先建记录、
				 * 再结它——账上不会留一条永远 `verdict=null` 的悬空派发。
				 */
				mutations.push({ t: 'audit/settled', id: pendingId, step: step.id, verdict: 'unknown', holds: 'unknown', basis: `独立评估者无法派遣(${dispatched.reason})`, shortfalls: ['audit_dispatch_failed'], card_path: null, digest })
				return { holds: 'unknown', results: [], basis: `独立评估者无法派遣(${dispatched.reason})`, shortfalls: ['audit_dispatch_failed'], cardPath: null, mutations }
			}
			mutations.push({ t: 'audit/dispatched', id: pendingId, step: step.id, plan: plan?.id ?? 'goal', kind, evaluator_session: String(dispatched.run.id), capability: dispatched.capability, digest, status: 'dispatched' })
			entry = { sessionId, run: dispatched.run, capability: dispatched.capability, auditKey: pendingId, step: step.id, plan: plan?.id ?? 'goal', kind, settled: undefined }
			pendingAudits.set(key, entry)
			entry.settled = dispatched.run.result.then(
				(value) => ({ ok: true, value }),
				(error) => ({ ok: false, error }),
			)
		}
		const outcome = await Promise.race([
			entry.settled,
			new Promise((resolve) => {
				const timer = setTimeout(() => resolve(null), CFG.auditTimeoutMs)
				if (typeof timer?.unref === 'function') timer.unref()
			}),
		])
		if (outcome === null) {
			// 仍在跑:条目留着,下一次交付继续等同一次派遣(不重复派遣)。派发事实已经在上面的 mutations 里。
			return { holds: 'pending', results: [], basis: `评估者仍在跑(${Math.round(CFG.auditTimeoutMs / 1000)}s 未回)`, shortfalls: ['audit_pending'], cardPath: null, mutations }
		}
		// 已落定:这次派遣的生命周期到此为止。下一次交付是**新的一次评估**(新证据),必须重新派遣。
		pendingAudits.delete(key)
		if (outcome.ok !== true) {
			return settleUnknown(`评估者失败:${String(outcome.error?.message ?? outcome.error)}`, ['audit_failed'])
		}
		/**
		 * **裁决一旦结束,就要落一条结算事实**——不管结局是什么。
		 *
		 * 三条路原来直接 `return unknown`(评估者失败 / 没正常结束 / 评估卡落盘失败),
		 * 账上只剩 `audit/dispatched`:看上去像"它还在跑",而它**已经结束了**。
		 * 结局不好也是结局,如实落下来——不然那条派发事实会在账上挂到天荒地老,
		 * 而"评估者没有悬空"这条不变量也只能红着,连解释都拿不出证据。
		 */
		const settleUnknown = (basis, shortfalls) => {
			mutations.push({ t: 'audit/settled', id: entry.auditKey, step: step.id, verdict: 'unknown', holds: 'unknown', basis, shortfalls, card_path: null, digest })
			return { holds: 'unknown', results: [], basis, shortfalls, cardPath: null, digest, mutations }
		}
		const settled = outcome.value
		const stopReason = String(settled?.stopReason ?? 'completed')
		if (stopReason !== 'completed' && settled?.structured === undefined) {
			return settleUnknown(`评估者未正常结束(${stopReason})`, ['audit_incomplete'])
		}
		const verdict = settled?.structured !== undefined ? normalizeVerdict(settled.structured) : normalizeVerdict(parseLooseJson(settled?.output))
		try {
			await entry.run.dispose?.()
		} catch {
			/* dispose 失败不影响裁决事实 */
		}
		const card = { schema_version: 'clearai.audit.v2', kind, step_id: step.id, auditor_run_id: String(entry.run.id), holds: verdict.holds, results: verdict.results, shortfalls: verdict.shortfalls, card: verdict.basis, created_at: Date.now() }
		const cardPath = writeAuditCard(sessionId, step.id, card)
		if (cardPath === null) {
			return settleUnknown('评估卡落盘失败:裁决降级', ['card_persist_failed'])
		}
		mutations.push({ t: 'audit/settled', id: entry.auditKey, step: step.id, verdict: verdict.holds, holds: verdict.holds, results: verdict.results, basis: verdict.basis, shortfalls: verdict.shortfalls, card_path: cardPath, digest })
		return { ...verdict, cardPath, digest, mutations }
	}

	/** 评估卡落盘(系统的面)。写不进 → 返回 null,调用方 fail-closed。 */
	function writeAuditCard(sessionId, stepId, card) {
		const file = sessionFile(sessionId, 'clear', 'evidence', 'audits', String(stepId), `${String(card.auditor_run_id)}.json`)
		if (file === null) return null
		try {
			writeTextFile(file, `${JSON.stringify(card, null, 2)}\n`)
			return file
		} catch (error) {
			ctx.logger?.warn?.(`clearai kernel: 评估卡落盘失败 ${String(error?.message ?? error)}`)
			return null
		}
	}

	/**
	 * 从「依据」里挑出一个**真实存在**的工作区文件。
	 *
	 * 依据是模型写的一句话,通常点着某个产物(「lab/roots.csv 的读数」)。这里把候选 token 逐个
	 * 落到盘上核一次:存在才算数。**这不是猜,是核** —— 面板上每个可点的东西都必须此刻真的在盘上。
	 */
	function resolveBasisArtifact(cwd, basis) {
		for (const raw of String(basis ?? '').split(/[\s,;:()[\]{}"'`]+/)) {
			const token = raw.replace(/[。;,:.。)）\]]+$/u, '').trim()
			if (token === '' || (!token.includes('/') && !token.includes('.'))) continue
			try {
				if (existsSync(isAbsolute(token) ? token : resolvePath(cwd, token))) return token
			} catch {
				/* 读不了就当不存在 */
			}
		}
		return null
	}

	/**
	 * 一条证据的**出处**:记账那一刻就解析成事实,界面只渲染、不猜。
	 *
	 * 四类(与面板上的四个入口一一对应):
	 *   · `artifact`          —— 产物文件(准入闸门 stat 过的,或依据里点名且此刻在盘上的)
	 *   · `audit-card`        —— 独立裁决的评估卡文件
	 *   · `evaluator-session` —— 写这条裁决的**评估者子会话**(论证过程在里面,可旁观)
	 *   · `approval-record`   —— L4 的人放行(原生审批对,没有文件,但不可伪造)
	 *
	 * `refs` 同时归一只写**路径** —— 旧写法把材料 id 与路径混排,界面按路径去开 ⇒ 点不开。
	 */
	function buildEvidenceOrigins({ cwd, accepted, confirmed, cardPath, evaluatorSession, basis, approvalCall }) {
		const origins = []
		const paths = []
		const rel = (value) => {
			const text = String(value ?? '')
			if (text === '') return text
			if (!isAbsolute(text)) return text
			const inside = relative(cwd, text)
			return inside.startsWith('..') ? text : inside
		}
		for (const item of accepted ?? []) {
			if (typeof item?.ref !== 'string' || item.ref === '') continue
			origins.push({ kind: 'artifact', path: rel(item.ref) })
			paths.push(item.ref)
		}
		for (const item of confirmed ?? []) {
			if (typeof item?.ref !== 'string' || item.ref === '' || paths.includes(item.ref)) continue
			origins.push({ kind: 'artifact', path: rel(item.ref) })
			paths.push(item.ref)
		}
		if (typeof cardPath === 'string' && cardPath !== '') origins.push({ kind: 'audit-card', path: rel(cardPath) })
		if (typeof evaluatorSession === 'string' && evaluatorSession !== '') origins.push({ kind: 'evaluator-session', session: evaluatorSession })
		const fromBasis = resolveBasisArtifact(cwd, basis)
		if (fromBasis !== null && !paths.includes(fromBasis)) {
			origins.push({ kind: 'artifact', path: rel(fromBasis), from_basis: true })
			paths.push(fromBasis)
		}
		if (typeof approvalCall === 'string' && approvalCall !== '') origins.push({ kind: 'approval-record', call: approvalCall })
		return { origins, paths: paths.map(rel) }
	}

	// ═══ 工具 ══════════════════════════════════════════════════════════════

	function activePlanOf(state) {
		return state.plans.find((plan) => plan.status === 'active') ?? null
	}

	function firstOpenStep(plan) {
		return plan?.steps.find((step) => step.status === 'open') ?? null
	}

	/** 开一次调用的上下文:拿宿主读面、取状态、备一个变更列表。 */
	function open(exec) {
		const hostService = host()
		if (hostService === undefined) {
			return { ok: false, response: fail('host_missing', '宿主包 clearai-dsh 没有挂载:状态机不在(它是会话日志的投影)。先装上它,再谈工具。') }
		}
		const sessionId = String(exec.agent?.id ?? 'unknown')
		/**
		 * **入口检查宿主的两件纯读面**(`state` / `derive`)。宿主 fiber 可以在一次调用的
		 * `await` 期间瞬态掉出 ACTIVE:`derive` 在派发前成功、评估者跑完之后再读宿主就抛,
		 * 工具抛错时 `mutations` 里那条 `audit/dispatched` 随栈帧一起没了。
		 *
		 * 宿主半的属性式访问已改成降级(见 `ui/lib/index.js`),但**这一侧不能赌别人修好了**:
		 * 不通就当场把已经落账的事实交出去(而不是抛),`withPendingFacts` 会把独立落账通道里的事实
		 * 并进这个失败结果,所以"派过"这件事不丢。
		 *
		 * **刻意不摸 `preview`**:它是"假定这批变更已落账会怎样"的读面,测试的宿主桩里它会把状态推进一次
		 * (`applyMutations`),拿它当体检会把状态推进一次。真正需要它的那几处(结案裁决)自己带兜底。
		 */
		try {
			hostService.state(sessionId)
			hostService.derive(sessionId)
		} catch (error) {
			return {
				ok: false,
				response: fail(
					'host_unavailable',
					`宿主读面这一刻不可用(${String(error?.message ?? error).slice(0, 200)})。**已经发生的事实照旧落账**(派发记录不丢);现在先看当前账本,再谈重试——不要重做一遍已经做过的事。`,
					{ mutations: [] },
				),
			}
		}
		return { ok: true, hostService, sessionId, state: hostService.state(sessionId), mutations: [], done: null }
	}

	/**
	 * **读面兜底**:`preview` 在真实运行里是"宿主 fiber 已经掉线"时的抛出点(见 `open` 的注释)。
	 * 拿不到就返回 null,调用方如实降级——**绝不把整批已经落账的变更丢掉**。
	 */
	function previewOf(hostService, sessionId, mutations) {
		try {
			return hostService.preview(sessionId, mutations)
		} catch (error) {
			ctx.logger?.warn?.(`clearai kernel: 读面不可用 ${String(error?.message ?? error).slice(0, 160)}`)
			return null
		}
	}

	// ═══ 原生 goal:目标的文字、续跑、暂停与完成归宿主 ═══════════════════════════
	//
	// ClearAI 只往当前原生 goal 上挂判据与判断(`Frame`),并把「完成」收归带独立评估的结案(`Conclude`)。
	// 续跑由原生 goal 的驱动自己做;我们只在三处动它:立约时建或改那一句话、结案通过时置完成、
	// 需要人而没人能答(或模型如实放弃)时置阻塞并写明原因。读它只为拿到 id 与 revision,不做任何判断。

	const BLOCK_CODES = { abandoned: 'clearai-goal-abandoned', needsHuman: 'clearai-needs-human' }

	function nativeGoals() {
		const goals = ctx.get('goals')
		return goals !== undefined && goals !== null && typeof goals.get === 'function' ? goals : null
	}

	function nativeGoal(agent) {
		try {
			return nativeGoals()?.get(agent) ?? null
		} catch {
			return null
		}
	}

	const goalRef = (goal) => ({ id: goal.id, revision: goal.revision })

	/** `Frame` 用:当前没有原生 goal(或上一枚已完成)就建一枚,有就把那一句话对齐。返回给模型的一句说明。 */
	function attachNativeGoal(agent, objective) {
		const goals = nativeGoals()
		if (goals === null) return '\n(这个形态没有原生 goal 服务:目标只记在 ClearAI 的账上,不会自动续跑——要继续就在这一回合里做完。)'
		try {
			const current = goals.get(agent)
			if (current === null || current === undefined) {
				goals.create(agent, { objective })
				return ''
			}
			if (current.phase === 'complete') {
				goals.clear(agent, goalRef(current))
				goals.create(agent, { objective })
				return ''
			}
			if (current.objective !== objective) goals.edit(agent, goalRef(current), { objective })
			if (current.phase === 'blocked' || current.phase === 'paused') return `\n(原生 goal 现在是 ${current.phase === 'blocked' ? '阻塞' : '暂停'}:要不要继续由人决定,系统不替人恢复。)`
			return ''
		} catch (error) {
			return `\n(原生 goal 没挂上:${String(error?.message ?? error).slice(0, 200)})`
		}
	}

	/** `Conclude` 通过独立评估之后:原生 goal 置为完成。拿不到服务或调用失败就如实说。 */
	function completeNativeGoal(agent) {
		const goals = nativeGoals()
		if (goals === null) return ''
		try {
			const current = goals.get(agent)
			if (current === null || current === undefined || current.phase === 'complete') return ''
			goals.complete(agent, goalRef(current))
			return ''
		} catch (error) {
			return `\n(原生 goal 没能置为完成:${String(error?.message ?? error).slice(0, 200)})`
		}
	}

	/** 需要人(或模型如实放弃)时让原生 goal 停下,写明原因——续跑驱动看到阻塞就不会再叫醒模型。 */
	function blockNativeGoal(agent, code, message) {
		const goals = nativeGoals()
		if (goals === null) return ''
		try {
			const current = goals.get(agent)
			if (current === null || current === undefined || current.phase !== 'active') return ''
			goals.block(agent, goalRef(current), { code, message: String(message ?? '').slice(0, 300) })
			return '\n原生 goal 已置为阻塞,写明了在等什么;人处理完会恢复它。'
		} catch (error) {
			return `\n(原生 goal 没能置为阻塞:${String(error?.message ?? error).slice(0, 200)})`
		}
	}

	/**
	 * ═══ 人门:由开门的那次调用当场问 ═══
	 *
	 * 与原生 `exit_plan_mode` 同一条路:问题与选项由内核写,答案在进程内交回内核——
	 * 模型只能触发询问,碰不到答案;它自己调 `ask_user_question` 问到的东西不会落进这本账。
	 * 没人能答时(`NO_PROVIDER`:headless、没有界面)不替人决定:门开着,原生 goal 置为阻塞。
	 */
	async function askHuman(exec, { id, header, question, detail, options }) {
		const questions = ctx.get('userQuestions')
		if (questions === undefined || questions === null || typeof questions.ask !== 'function') return { ok: false, reason: 'no_provider', detail: '这个形态没有提问通道' }
		try {
			const answer = await questions.ask({ questions: [{ id, header, question, ...(detail === undefined ? {} : { detail }), options }], agent: exec.agent, signal: exec.signal })
			const item = (Array.isArray(answer?.answers) ? answer.answers : []).find((entry) => entry?.id === id)
			const selected = Array.isArray(item?.selected) ? item.selected : []
			return { ok: true, choice: selected[0] ?? null, note: typeof item?.custom === 'string' && item.custom.trim() !== '' ? item.custom.trim() : null }
		} catch (error) {
			const code = String(error?.code ?? '')
			if (code === 'NO_PROVIDER') return { ok: false, reason: 'no_provider', detail: '没有人能回答' }
			if (code === 'ASK_CANCELLED' || code === 'ASK_ABORTED') return { ok: false, reason: 'cancelled', detail: '人把问题撤下了' }
			return { ok: false, reason: 'error', detail: String(error?.message ?? error).slice(0, 200) }
		}
	}

	const RELEASE_YES = '放行这次交付'
	const RELEASE_NO = '先不放行'
	const STALL_CONTINUE = '让它按缺口再改'
	const STALL_VOID = '作废这一步'
	const FACT_RETRACT = '撤回这条事实'
	const FACT_KEEP = '维持原事实'

	/**
	 * **同一步连拦到阈值 ⇒ 当场问人怎么办**。两个选项都能落地:按缺口再改(清掉连拦,
	 * 人的话原样交给模型),或作废这一步(带人的缘由)。人撤下问题或没人能答 ⇒ 计划保持 blocked,
	 * 原生 goal 置为阻塞;下一次交付会再问一次——决定不丢,门的状态在账上。
	 */
	async function escalateBlocked(exec, plan, step, attempts, reason, mutations) {
		const asked = await askHuman(exec, {
			id: `blocked-${plan.id}-${step.id}`,
			header: '这一步卡住了',
			question: `步骤 ${step.id}(${clip(step.do, 60)})连续 ${attempts} 次没过:${clip(reason, 200)}。怎么办?`,
			options: [
				{ label: STALL_CONTINUE, description: '模型按缺口改判据或换做法后再交;你可以补一句方向。' },
				{ label: STALL_VOID, description: '这一步不做了,带原因作废(记录保留)。' },
			],
		})
		if (asked.ok !== true) {
			const why = asked.reason === 'cancelled' ? '人把问题撤下了' : '没有人能回答'
			return `\n已问人怎么办,但${why}:计划保持 blocked,停下等人。人回答之前,你自己能动的只有计划本身:RefinePlan 改判据、AmendPlan 换做法、VoidPlanStep 带原因作废。${blockNativeGoal(exec.agent, BLOCK_CODES.needsHuman, `步骤 ${step.id} 连续 ${attempts} 次没过,等人决定:按缺口再改,还是作废这一步。`)}`
		}
		const said = asked.note === null ? '' : `,人说:「${asked.note}」`
		if (asked.choice === STALL_VOID) {
			mutations.push({ t: 'plan/voided', plan: plan.id, step: step.id, reason: `人决定作废:连续 ${attempts} 次没过${asked.note === null ? '' : `(${asked.note})`}` })
			mutations.push({ t: 'block/cleared', plan: plan.id, step: step.id })
			return `\n人决定**作废这一步**${said}。已带原因作废,记录保留;接着做下一步。`
		}
		mutations.push({ t: 'block/cleared', plan: plan.id, step: step.id })
		return `\n人让你**按缺口再改**${said}。改判据(RefinePlan)或换做法后再交付。`
	}

	/**
	 * **推翻证据碰到已确立的事实 ⇒ 当场问人撤回还是维持**(数据本身也可能错,所以不自动撤回)。
	 * 两种结局都落账(`fact/reviewed`),并在事实文件上追加一行,下一轮模型读得到。
	 * 没人能答 ⇒ 事实标着「被推翻、待复核」,原生 goal 置为阻塞。
	 */
	async function reviewRefutedFacts(exec, sessionId, state, refutedHypotheses, basis, mutations) {
		const pending = (state.facts ?? []).filter((fact) => refutedHypotheses.includes(fact.hypothesis) && (fact.review === undefined || fact.review === null))
		if (pending.length === 0) return ''
		const notes = []
		for (const fact of pending) {
			const asked = await askHuman(exec, {
				id: `fact-${fact.id}`,
				header: '已确立的结论被推翻了',
				question: `「${clip(fact.text, 120)}」出现了推翻证据:${clip(basis, 200)}。撤回它,还是判这次证据不可靠、维持原事实?`,
				options: [
					{ label: FACT_RETRACT, description: '它不再算已确立的结论(记录保留)。' },
					{ label: FACT_KEEP, description: '这次证据不可靠,事实保留;推翻证据照样留在账上。' },
				],
			})
			if (asked.ok !== true || (asked.choice !== FACT_RETRACT && asked.choice !== FACT_KEEP)) {
				notes.push(`${fact.id} 待人复核(${asked.ok === true ? '没选' : asked.reason === 'cancelled' ? '人把问题撤下了' : '没有人能回答'})${blockNativeGoal(exec.agent, BLOCK_CODES.needsHuman, `事实 ${fact.id} 出现了推翻证据,等人决定撤回还是维持。`)}`)
				continue
			}
			const review = { decision: asked.choice === FACT_RETRACT ? 'retracted' : 'kept', reason: asked.note }
			mutations.push({ t: 'fact/reviewed', fact: fact.id, decision: review.decision, reason: review.reason, by: 'user' })
			markFactReviewed(sessionCwd(sessionId), fact, { retracted: review.decision === 'retracted', reason: review.reason })
			notes.push(`${fact.id}:人决定${review.decision === 'retracted' ? '**撤回**(记录保留,不再作为已知引用)' : '**维持原事实**(判这次证据不可靠)'}`)
		}
		return `\n复核:${notes.join(';')}`
	}

	/** 一句话摘要:压平空白、超长截断。 */
	function clip(text, max) {
		const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
		return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
	}

	/**
	 * **交付卡片只在结案时出**:把这个目标下各步经准入收下的产物,一次声明为原生交付卡片。
	 * 写的是与原生 `present` 同一种事件(`deliverables/presented`),原生卡片按回合读它;
	 * 模型不必再调一次 `present`。过程中的步骤产物不出卡片。
	 */
	function declareDeliverables(exec, sessionId, files) {
		if (files.length === 0) return ''
		try {
			const session = exec?.agent?.session ?? ctx.get('sessions')?.get?.(sessionId) ?? null
			if (session === null || typeof session.append !== 'function') return ''
			const turn = ctx.get('sessionProjections')?.stateOf?.(session, 'turnBoundary')?.lastTurn ?? null
			session.append('deliverables/presented', { turn, callId: String(exec?.callId ?? ''), files })
			return `\n交付卡片已声明 ${files.length} 份产物。`
		} catch (error) {
			return `\n(交付卡片没声明成:${String(error?.message ?? error).slice(0, 160)})`
		}
	}

	/** 已经铺过货架的会话(内存记忆:货架是幂等文件写,重启后重铺一次也无害)。 */
	const ontologyShelved = new Set()

	/**
	 * **事实货架**:把已升格的事实汇成 `clear/knowledge/facts/INDEX.md`。
	 *
	 * 为什么必须有它:在它之前,事实只落进 `clear/knowledge/facts/<目标 id>.md`
	 * —— **没有任何读者**(模型不知道有哪些事实、更不知道文件名按目标 id 拼)。
	 * 螺旋的上半圈(事实作为已知喂给下一轮)就是断在这里。
	 *
	 * 三条纪律(与本体货架、模板技能同步同一套):
	 *   · **面板与模型读同一张表**:这一份就是面板「事实」页签读的东西;
	 *   · **幂等**:内容一样就不重写(文件时间戳是给人的读数,不是噪声);
	 *   · **带边界**:每条事实都写上它的推翻条件与支持等级——没有边界的事实没人敢用。
	 */
	function renderFactsIndex(state) {
		const facts = Array.isArray(state?.facts) ? state.facts : []
		if (facts.length === 0) return null
		const lines = [
			'# 本体内容(已确立条目,可作为「已知」引用;未结构化的旧条目照旧在架)',
			'',
			'> 每条都带**边界**(推翻条件)与**支持等级**:引用它之前先看边界还在不在。',
			'> 这一份由系统维护(做的人不能写 `clear/knowledge/facts`);新的在前。',
			'',
		]
		for (const fact of [...facts].reverse()) {
			lines.push(`## ${fact.id} · ${fact.text}`)
			lines.push('')
			lines.push(`- 边界:${fact.scope === null || fact.scope === undefined || String(fact.scope).trim() === '' ? '(未写——引用前请谨慎)' : String(fact.scope)}`)
			lines.push(`- 支持到:${fact.level ?? '(未记等级)'} · 证据:${(fact.evidence ?? []).join('、') || '(无)'}`)
			lines.push(`- 来源目标:${fact.goal ?? '—'} · 升格时间:${fact.at === undefined || fact.at === null ? '—' : new Date(fact.at).toISOString()}`)
			/**
			 * 复核状态要写在货架上:模型读的就是这份文件。撤回过的若还写「可作为已知引用」,
			 * 下一轮它会照旧引用一条已经作废的事实——那是最坏的一种不实。
			 */
			if (fact.review !== undefined && fact.review !== null) {
				const when = fact.review.at === undefined || fact.review.at === null ? '' : ` @ ${new Date(fact.review.at).toISOString()}`
				const why = fact.review.reason === null || fact.review.reason === undefined ? '' : `,缘由:${fact.review.reason}`
				lines.push(fact.review.decision === 'retracted' ? `- **已撤回**(人审查后决定${why}${when}):不再作为「已知」引用;记录保留` : `- 有推翻证据,但**人判定证据不可靠,维持原事实**(${why.replace(/^,/, '')}${when})`)
			} else if (fact.refuted === true) {
				lines.push('- ⚠️ **有推翻证据,等人决定**(撤回或维持):引用它之前先看这条。')
			}
			lines.push('')
		}
		return `${lines.join('\n')}`
	}

	/** 写货架;内容没变就返回 null(调用方据此决定要不要在卡里提一句)。 */
	function ensureFactsShelf(sessionId, state) {
		/**
		 * 与词汇货架**同一条所有权规则,同一个位置**(写入口):子会话的投影里
		 * 没有主线的事实,让它铺只会按它自己那份重写 `INDEX.md`。
		 */
		if (isSpawnedChild(sessionId)) return null
		/**
		 * 货架要显示「被推翻」那个读数,而它是**派生的**(fold 的 derive),不在原始状态里。
		 * 所以这里问一次读面,而不是在货架里重算一遍(重算 = 第二份判据,必然漂)。
		 */
		const rows = host()?.derive?.(sessionId)?.factRows
		const body = renderFactsIndex(Array.isArray(rows) ? { ...state, facts: rows } : state)
		if (body === null) return null
		const file = sessionFile(sessionId, 'clear', 'knowledge', 'facts', 'INDEX.md')
		if (file === null) return null
		try {
			if (existsSync(file) && readFileSync(file, 'utf8') === body) return null
			writeTextFile(file, body)
			return `clear/knowledge/facts/INDEX.md`
		} catch (error) {
			ctx.logger?.warn?.(`clearai facts: 货架写入失败 ${String(error?.message ?? error).slice(0, 160)}`)
			return null
		}
	}

	/**
	 * **领域词汇货架**:把折出来的词汇落成 `clear/ontology/domain.md`。
	 *
	 * 与过程本体货架同一条纪律(读面 + 幂等),但**触发时机不同**:过程本体随发布版本,
	 * 一个会话铺一次就够;词汇每一步都可能变,所以每个本体动词落账之后都要重铺一遍——
	 * 内容没变就不重写(文件时间戳是给人的读数,不是噪声)。
	 *
	 * 带 `mutations` 时按**这一步之后**的样子渲染:工具返回前货架就已更新,读的人不必等下一回合。
	 */
	/**
	 * 铺领域词汇货架(幂等)。
	 *
	 * **写入口自带所有权判据:派出去的子会话结构上写不进这份文件。**
	 *
	 * 规则一句话:工作区级读面属于拥有账本的会话。子会话(评估者)与主线
	 * 共享同一个工作区,却持有**另一份(空的)投影**——让它照自己的投影重铺,
	 * `renderShelf(子会话)` 渲染出的就是「还没有词条」的占位版。真跑里评估者两次读到
	 * 7 行占位版、主线连读三次都是 96 行 21 词条,两边各自稳定:文件在「谁最后铺了一拍」
	 * 之间摆动,而两边谁都没说谎。子会话**读**这份货架(评估者核对判据正要读它),但不写。
	 *
	 * 判据放在**写函数里**而不是调用点,与 `tools/pre-execute` 拒模型写 `clear/` 是同一条
	 * 纪律:边界住在咽喉点,新增多少调用点都绕不过(不可表达优于不可违反)。
	 */
	function ensureDomainShelf(hostService, sessionId, mutations = []) {
		if (hostService?.domain?.renderShelf === undefined) return ''
		if (isSpawnedChild(sessionId)) return ''
		try {
			const body = hostService.domain.renderShelf(sessionId, Array.isArray(mutations) ? mutations : [])
			const file = sessionFile(sessionId, 'clear', 'ontology', 'domain.md')
		if (file === null) return null
			if (existsSync(file) && readFileSync(file, 'utf8') === body) return ''
			writeTextFile(file, body)
			return `\n词汇货架已更新:${join('clear', 'ontology', 'domain.md')}(概念 / 谓词 / 图 / 引用)。**它是读面,不是权威**——要改词汇就调注册 / 修订 / 废止动词。`
		} catch (error) {
			ctx.logger?.warn?.(`clearai domain shelf: 写入失败 ${String(error?.message ?? error).slice(0, 160)}`)
			return ''
		}
	}

	/**
	 * **目标文档**:把当前目标(一句话、判据全文、假设、修订留痕)落成
	 * `clear/goals/{goalId}.md`——本体声明里 `goal.persistence` 早就写了这个落点,
	 * 只是从前没有人写它。
	 *
	 * 为什么需要它:判据全文是每一拍都要用的东西,但**不该每一拍都进上下文**——
	 * 卡里给压缩版 + 一个"全文在哪"的指针,需要逐字核对的场合(评估者、人复核、模型自己重读)
	 * 去读这份文件。这样"卡瘦了"不会变成"判据丢了"。
	 *
	 * 幂等:内容没变就不重写(与两份货架同一条纪律)。
	 */
	function ensureGoalDoc(sessionId, state, derived) {
		const goal = state?.goal ?? null
		if (goal === null) return ''
		if (isSpawnedChild(sessionId)) return ''
		try {
			const hypotheses = Array.isArray(state?.hypotheses) ? state.hypotheses : []
			const history = Array.isArray(goal.criteriaHistory) ? goal.criteriaHistory : []
			const lines = [
				`# 目标 ${goal.id}(rev${goal.revision} · ${goal.status})`,
				'',
				`- **一句话**:${goal.headline ?? '(未写)'}`,
				`- **主张**:${goal.claim}`,
				`- **升格门槛**:${goal.promote_at_level ?? 'L3'}`,
				`- **判据(全文)**${Array.isArray(goal.criteria) && goal.criteria.length > 0 ? '' : '(未逐条拆分)'}:`,
				...(Array.isArray(goal.criteria) && goal.criteria.length > 0 ? goal.criteria.map((item, index) => `  ${index + 1}. ${item}`) : [`  ${goal.done_criteria}`]),
				goal.criteria_note === null || goal.criteria_note === undefined ? '' : `- **判据背景**(不参与判定):${goal.criteria_note}`,
				'',
				'> 这份文件由系统按账本落盘(投影产物);权威是账本里的 `goal/set` 与 `criteria/revised`。',
				'',
				`## 假设(${hypotheses.length})`,
				'',
			]
			for (const hypothesis of hypotheses) {
				lines.push(`- \`${hypothesis.id}\` [${hypothesis.status}] ${hypothesis.claim}`)
				lines.push(`  - 推翻条件:${hypothesis.refute_when}`)
				if (Array.isArray(hypothesis.assertions) && hypothesis.assertions.length > 0) lines.push(`  - 断言:${hypothesis.assertions.length} 条`)
			}
			if (history.length > 0) {
				lines.push('', `## 判据修订留痕(${history.length})`, '')
				for (const item of history) lines.push(`- rev${item.revision}:${item.reason ?? '(未写缘由)'}(独立裁决 ${item.audit ?? '—'})`)
			}
			const body = `${lines.filter((line) => line !== '').join('\n')}\n`
			const file = sessionFile(sessionId, 'clear', 'goals', `${goal.id}.md`)
			if (file === null) return ''
			if (existsSync(file) && readFileSync(file, 'utf8') === body) return ''
			writeTextFile(file, body)
			return join('clear', 'goals', `${goal.id}.md`)
		} catch (error) {
			ctx.logger?.warn?.(`clearai goal doc: 写入失败 ${String(error?.message ?? error).slice(0, 160)}`)
			return ''
		}
	}

	/**
	 * 领域判据的宿主入口。**拿不到就明确拒,不抛**:预设与宿主半同包同版本,
	 * 但一个缺了这道门的宿主(旧包、裁剪过的部署、测试桩)不该让工具在 `undefined` 上崩——
	 * 崩掉会让模型以为是自己的参数错了,而真实原因是这一层没接上。
	 */
	function domainJudge(hostService) {
		return hostService?.domain ?? null
	}

	/** 在折出来的词汇里找一个条目(概念或谓词)。判据与折法同源:读的就是 `state.lexicon`。 */
	function findLexiconEntry(state, id) {
		const lexicon = state?.lexicon ?? {}
		const wanted = String(id ?? '').trim()
		if (wanted === '') return null
		const term = (Array.isArray(lexicon.terms) ? lexicon.terms : []).find((item) => item.id === wanted)
		if (term !== undefined) return { kind: 'term', entry: term }
		const predicate = (Array.isArray(lexicon.predicates) ? lexicon.predicates : []).find((item) => item.id === wanted)
		if (predicate !== undefined) return { kind: 'predicate', entry: predicate }
		return null
	}

	/** 查询条件的一行人话:让「查不到」也说得清查的是什么。 */
	function describeFilter(filter) {
		const parts = []
		if (filter.term !== '') parts.push(`概念「${filter.term}」`)
		if (filter.predicate !== '') parts.push(`谓词「${filter.predicate}」`)
		if (filter.subject !== '') parts.push(`主体「${filter.subject}」`)
		return `查询:${parts.join(' · ')}`
	}

	/**
	 * **本体货架**:把已装的那份本体落成 `clear/ontology/<id>.md`。
	 *
	 * 为什么落成文件而不是只留在代码里:声明是**给模型读的**——它得知道这套系统认哪些对象、
	 * 哪些转移合法、每一级谁来判,才能在写判据与交付时对得上。与 ClearAI 那一侧的
	 * 同一件事:本体从代码里走出来,跟着声明走。
	 *
	 * 幂等:内容一样就不重写(与模板技能同步同一条纪律——文件时间戳是给人的读数)。
	 */
	function ensureOntologyShelf(cwd) {
		if (typeof cwd !== 'string' || cwd === '') return null
		if (CONTRIB.ontology === null || CONTRIB.ontology === undefined) return null
		const file = join(cwd, 'clear', 'ontology', `${CONTRIB.ontology.id}.md`)
		const body = describeOntology(CONTRIB.ontology)
		try {
			if (existsSync(file) && readFileSync(file, 'utf8') === body) return file
			writeTextFile(file, body)
			return file
		} catch (error) {
			ctx.logger?.warn?.(`clearai ontology: 货架写入失败 ${String(error?.message ?? error).slice(0, 160)}`)
			return null
		}
	}

	/** 令牌现状(只读,给运行态卡;读了不用它做判断)。 */

	/**
	 * 校验一批步骤。`existing` 是同一计划里已有的步骤(补一步时传入)。
	 *
	 * **产物路径不重叠**:同一计划里两个步骤不许声明同一个产物路径(作废的步不算)。
	 * 并行探索交给原生子任务,而原生子任务共用一个工作目录——没有这一条,两条并行的路线
	 * 会互相覆盖对方的产出,准入收下的就不一定是那一步自己做出来的东西。
	 */
	function validateSteps(steps, existing = []) {
		if (!Array.isArray(steps) || steps.length === 0) return 'steps 不能为空:一份计划至少一步'
		if (steps.length > MAX_PLAN_STEPS) return `一份计划最多 ${MAX_PLAN_STEPS} 步(收到 ${steps.length})`
		const normalizePath = (path) => String(path).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/')
		const claimed = new Map()
		for (const step of existing) {
			if (step?.status === 'void') continue
			for (const path of Array.isArray(step?.artifacts) ? step.artifacts : []) claimed.set(normalizePath(typeof path === 'string' ? path : path?.path ?? ''), step.id)
		}
		const seen = new Set()
		for (const [index, step] of steps.entries()) {
			const label = `第 ${index + 1} 步`
			if (typeof step?.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(step.id)) return `${label} 缺少合法 id(字母/数字/下划线/短横,≤40)`
			if (seen.has(step.id)) return `${label} 的 id 与前面重复:${step.id}`
			seen.add(step.id)
			if (typeof step.do !== 'string' || step.do.trim().length < 2) return `${label} 的 do 太短:一句话说清做什么`
			if (typeof step.done_criteria !== 'string' || step.done_criteria.trim().length < 4) return `${label} 缺少 done_criteria:判定标准要在结果出现之前写下`
			const selfRef = SELF_REFERENCE.find(([pattern]) => pattern.test(step.done_criteria))
			if (selfRef !== undefined) return `${label} 的判据自指:${selfRef[1]}`
			if (step.artifacts !== undefined && !Array.isArray(step.artifacts)) return `${label} 的 artifacts 必须是路径数组`
			for (const path of step.artifacts ?? []) {
				const key = normalizePath(path)
				if (key === '') continue
				const owner = claimed.get(key)
				if (owner !== undefined && owner !== step.id) return `${label} 的产物 ${path} 已经由步骤 ${owner} 声明:同一计划里两步不许声明同一个产物路径(并行的路线会互相覆盖)。换一个路径。`
				claimed.set(key, step.id)
			}
			if (step.tests !== undefined && step.tests !== null) {
				if (typeof step.tests !== 'object') return `${label} 的 tests 必须是 {hypotheses, level}`
				if (levelIndexOf(step.tests.level) < 0) return `${label} 的 tests.level 必须是 L0–L4 之一`
				const wanted = Array.isArray(step.tests.hypotheses) ? step.tests.hypotheses : step.tests.hypothesis !== undefined ? [step.tests.hypothesis] : []
				if (wanted.length === 0 || wanted.some((item) => typeof item !== 'string' || item.trim() === '')) return `${label} 的 tests 要写明检验哪几条判断(hypotheses:id 数组,至少一条)`
			}
		}
		return null
	}

	/**
	 * 工具**声明**与工具**装配**分两拍:
	 * 这里只登记定义,真正 `ctx.tools.register` 由末尾的贡献表驱动——
	 * 「装了哪些工具」是一件清单事实,不是散落在 1500 行里的既成事实。
	 */
	const TOOL_DEFS = new Map()
	function defineTool(definition) {
		if (TOOL_DEFS.has(definition.name)) throw new Error(`duplicate_tool:clearai-kernel:${definition.name}`)
		// 代码里定义了目录外的工具 = 代码与工具事实源漂移;同样是装配期抛错。
		if (!TOOL_CATALOG.has(definition.name)) throw new Error(`undeclared_tool:clearai-kernel:${definition.name}`)
		TOOL_DEFS.set(definition.name, definition)
	}

	/**
	 * **工具结果的统一出口**:把独立落账通道里这一拍的事实并进结果。
	 *
	 * 顺序是刻意的——`pendingFacts` 里的是**已经发生的事实**(派发在 `await` 之前就落了),
	 * 而工具自己的 `mutations` 是这一拍的结算。两者同形、同一个折法,
	 * 所以并起来交给宿主不会多一条通道,只是让"事实比工具结果活得更久"。
	 */
	function withPendingFacts(exec, value) {
		const sessionId = String(exec?.agent?.id ?? 'unknown')
		const pending = drainPendingFacts(sessionId)
		if (pending.length === 0) return value
		if (value === null || typeof value !== 'object') return value
		const own = Array.isArray(value.mutations) ? value.mutations : []
		/**
		 * **顺序有意义:`pending` 在前,工具自己那批在后。**
		 *
		 * 独立落账通道里的第一条永远是"派发/派遣发生"(那件事先发生),工具自己的那批里则是
		 * "这次调用怎么了结的"(可能带同一条 id 的覆盖,或一条 `audit/settled`)。
		 * 折法是**按顺序**吃的:先有那条 `audit/dispatched`,后面的 `audit/settled` 才找得到它
		 * 要结的那条记录。反过来放,结算会落在一条还不存在的记录上,变成一次 no-op——
		 * 账上就留下一条永远 verdict=null 的悬空派发,派生阶段也跟着永远停在"等裁决"。
		 *
		 * 去重只挡**同一条事实被两条通道各送一次**;顺序不因此改变。
		 */
		const key = (mutation) => `${String(mutation?.t)}:${String(mutation?.id ?? mutation?.step ?? '')}`
		const seen = new Set(own.filter((mutation) => mutation !== null && typeof mutation === 'object').map(key))
		const merged = [...pending.filter((mutation) => !seen.has(key(mutation))), ...own]
		return { ...value, mutations: merged }
	}

	// ── Frame ────────────────────────────────────────────────────────────

	defineTool({
		name: 'Frame',
		description:
			'立约或修订:往当前原生 goal 上挂一份「怎样算回答了」的判据(done_criteria)与候选判断(每条一句话主张 + 一句「什么结果会推翻它」)。没有原生 goal 时会建一个,目标那一句话(headline)就是它的说法;续跑、暂停由原生 goal 管。修订必须带 reason,版本 +1,旧值全部留痕;改判据文本要带一份独立裁决。同一时间只开一个目标;它跨计划存在,一张 Plan 只承载它的一个阶段。',
		parameters: {
			type: 'object',
			properties: {
				headline: { type: 'string', maxLength: 120, description: '一句话目标(≤120 字):卡上 / 面板 / 续跑文案反复出现的那一句。首次立约必填' },
				claim: { type: 'string', description: '目标:项目要回答的问题(可以长;身份与判据的落点)' },
				done_criteria: { type: 'string', description: '怎样算回答了——必须是可核对的判据,至少含一处能清点的形态(数字 / 条数 / "存在一份文件")' },
				legacy: { type: 'boolean', description: '旧会话迁移:一次性放行长文本与缺 headline(新目标不要用)' },
				criteria: {
					type: 'array',
					items: { type: 'string' },
					description: '判据逐条写(每条一句话,含可清点数或"存在一份文件"这类能核的形态)。给了它就按条记,不给则用 done_criteria 的全文',
				},
				criteria_note: { type: 'string', description: '判据的背景说明(不参与判定,只解释为什么这么定)' },
				criteria_verdict: {
					type: 'string',
					description: '改判据文本时要带的独立裁决 auditKey:改「怎样算完成」不能被顺手做掉',
				},
				promote_at_level: { type: 'string', enum: LEVELS, description: '升格门槛(默认 L3)' },
				hypotheses: {
					type: 'array',
					description:
						'候选假设:每条一句话主张 + 一句推翻条件;可带**类型化断言**(可选,提供即严校:谓词与概念必须已登记、宾语形态要合值域、同一事实里不许自相矛盾)。不写断言照旧成立——断言是加法,不是门槛。',
					items: {
						type: 'object',
						properties: {
							claim: { type: 'string' },
							refute_when: { type: 'string' },
							assertions: {
								type: 'array',
								description: '断言:主词–谓词–宾语(引用领域词汇里的 id)',
								items: {
									type: 'object',
									properties: {
										predicate: { type: 'string' },
										subject: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string' } }, required: ['id'], additionalProperties: false },
										object: {
											type: 'object',
											properties: { kind: { type: 'string', enum: ['statement', 'quantity', 'formula', 'code', 'reference', 'instance'] }, value: {}, unit: { type: 'string' }, type: { type: 'string' } },
											required: ['kind'],
											additionalProperties: false,
										},
										qualifiers: { type: 'object' },
									},
									required: ['predicate', 'subject', 'object'],
									additionalProperties: false,
								},
							},
						},
						required: ['claim', 'refute_when'],
						additionalProperties: false,
					},
				},
				reason: { type: 'string', description: '修订目标时必须写一句原因(首次立目标不需要)' },
			},
			required: ['claim', 'done_criteria'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const criteria = String(args.done_criteria ?? '').trim()
			if (criteria.length < 4) return fail('done_criteria_required', '判据不能为空:目标是「项目要回答的问题」,判据是「怎样算回答了」。')
			const selfRef = SELF_REFERENCE.find(([pattern]) => pattern.test(criteria))
			if (selfRef !== undefined) return fail('criteria_self_reference', selfRef[1])
			if (typeof args.claim !== 'string' || args.claim.trim() === '') return fail('claim_required', '目标要有主张。')
			// 迁移开关要在假设校验**之前**就有值:下面那条「主体必须可指认」对它放行。
			const legacy = args.legacy === true
			const criteriaList = (Array.isArray(args.criteria) ? args.criteria : []).map((item) => String(item ?? '').trim()).filter((item) => item !== '')
			const criteriaNote = typeof args.criteria_note === 'string' && args.criteria_note.trim() !== '' ? args.criteria_note.trim() : null
			const hypotheses = Array.isArray(args.hypotheses) ? args.hypotheses : []
			for (const hypothesis of hypotheses) {
				if (typeof hypothesis?.claim !== 'string' || hypothesis.claim.trim() === '') return fail('hypothesis_claim_required', '每条假设要有一句话主张。')
				if (typeof hypothesis?.refute_when !== 'string' || hypothesis.refute_when.trim() === '') return fail('hypothesis_refute_required', '每条假设必须写清「什么结果会推翻它」——没有推翻条件的假设无法被检验。')
				/**
				 * **宽松+校验**:不写断言放行(断言是加法),写了就在**落账之前**严校——
				 * 引用不存在的谓词 / 概念、宾语形态不合值域、同一事实自相矛盾,一律当场拒。
				 * 判据来自宿主半(`hostService.domain`),与折法和读面同源。
				 */
				if (hypothesis.assertions !== undefined && hypothesis.assertions !== null) {
					const judge = domainJudge(hostService)
					if (judge === null) return fail('domain_unavailable', '这一层的宿主没有提供领域判据(domain facade):无法校验断言。请检查宿主半与预设是否同版本。')
					// `legacy`:迁移期一次性放行「主体还没登记」这条(`Frame` 的 `legacy:true`)——
					// 旧会话的断言主体在登记实例这条路存在之前就写下了,不该因为补上了机制而追溯失败。
					const problems = judge.validateAssertions(sessionId, hypothesis.assertions, { legacy })
					if (problems.length > 0) {
						return fail('assertions_rejected', `这条假设的断言不能成立(先注册词汇,或改断言):\n${problems.map((item) => `- ${item}`).join('\n')}`)
					}
				}
			}
			// 假设数量下限:首次立目标就得带够候选——0 条一样拦(候选对比是检验的前提,
			// 只有一个猜想时「验证」容易退化成找证据支持自己)。修订不受此限。
			if (CFG.minHypotheses > 0 && state.goal === null && hypotheses.length < CFG.minHypotheses) {
				return fail('hypotheses_too_few', `至少登记 ${CFG.minHypotheses} 条候选假设(每条:一句话主张 + 一句推翻条件)。只有一个猜想,检验容易退化成找证据支持自己;候选对比才让「推翻」成为可能。`)
			}
			const isRevision = state.goal !== null && state.goal.status === 'open'
			if (isRevision && (typeof args.reason !== 'string' || args.reason.trim() === '')) {
				return fail('reason_required', '修订目标必须带一句原因:改了什么、为什么改。旧版本会留在日志里。')
			}
			/**
			 * **标识先算,再谈改什么**:`goalId` / `revision` 既要在判据修订那条变更里用,
			 * 也要在下面的 `goal/set` 里用。**声明必须在使用之前**——JS 的时间死区,
			 * 顺序写反了,门的**成功路径**会在跑起来那一刻抛 ReferenceError
			 * (失败路径永远不碰它们,所以单测很容易漏过去)。
			 */
			const goalId = isRevision ? state.goal.id : uniqueId('g')
			const revision = isRevision ? state.goal.revision + 1 : 1
			/**
			 * **改判据文本要有一份独立裁决**(`criteria_verdict` = 一个 auditKey)。
			 *
			 * 判据是"怎样算完成"——它一变,前面所有工作的验收含义跟着变。允许在同一次
			 * `Frame` 里顺手改掉,等于允许把"做不到"重新定义成"做到了"。补的正是那一"眼"外部裁决。
			 * 出口两条:拿到一份落定的独立裁决再改,或如实 `Conclude(outcome="abandoned")`。
			 * 迁移期用 `legacy:true` 放行(旧会话没有这条路)。
			 */
			if (CFG.requireCriteriaVerdict && isRevision && !legacy && criteria !== String(state.goal.done_criteria ?? '').trim()) {
				const wanted = String(args.criteria_verdict ?? '').trim()
				if (wanted === '') {
					return fail(
						'criteria_verdict_required',
						'改判据文本要带一份独立裁决的 `criteria_verdict`(auditKey)。\n为什么:判据是"怎样算完成";它一变,前面所有工作的验收含义跟着变。允许在同一次调用里顺手改掉,等于允许把"做不到"重新定义成"做到了"。\n两条出口:先派一次独立评估拿到裁决再改,或如实 `Conclude(outcome="abandoned")`(放弃不需要动判据)。',
					)
				}
				const settled = (state.audits ?? []).filter((audit) => String(audit.id) === wanted)
				const usable = settled.find((audit) => ['yes', 'no', 'unclear'].includes(auditHolds(audit)))
				if (usable === undefined) {
					const inFlight = settled.some((audit) => audit.verdict === null)
					return fail(
						'criteria_verdict_unknown',
						inFlight
							? `那份裁决(${wanted})还在飞:等它落定再改判据。`
							: `账上找不到 ${wanted} 这份**已落定**的独立裁决。最近几条:${(state.audits ?? []).slice(-5).map((audit) => `${audit.id}(${audit.verdict ?? '在飞'})`).join('、') || '(当前没有裁决)'}。`,
					)
				}
				mutations.push({ t: 'criteria/revised', goal: goalId, revision, from: String(state.goal.done_criteria ?? ''), to: criteria, reason: String(args.reason ?? '').trim(), audit: wanted })
			}
			/**
			 * **一句话的目标**(`headline`)与**可清点的判据**。
			 *
			 * 为什么单独立这个字段:目标与判据是每一拍都进上下文的那两句,而它们此前是**一整段散文**——
			 * 长到卡里占几百字、长到"这一版改了哪一条"没法逐条对。人读不动,机器也没法清点。
			 *
			 * 纪律落在这里而不是提示词里:
			 *   · `headline` ≤120 字:它才是卡上、面板上、续跑文案里反复出现的那一句。
			 */
			/**
			 * `headline` 可以省略——**省略时由 `claim` 的第一句现算**,所以老调用方照旧可用。
			 * 但现算出来的那一句**必须**在 120 字以内:超了就是"你的目标一句话说不完",
			 * 那时要么自己给一个 `headline`,要么把问题收窄。这样"一句话的目标"是硬的,
			 * 而"必须多传一个字段"不是——机制挡的是长文,不是调用方的记性。
			 */
			const firstSentence = (raw) => {
				const text = String(raw ?? '').trim()
				if (text === '') return ''
				const cut = text.search(/[。!?;;\n]/)
				return (cut === -1 ? text : text.slice(0, cut)).trim()
			}
			const headline = String(args.headline ?? '').trim() === '' ? firstSentence(args.claim) : String(args.headline).trim()
			if (!legacy) {
				if (headline === '') return fail('headline_required', '目标要有一句话的说法(`headline`,≤120 字):它是卡上、面板上、续跑文案里反复出现的那一句。')
				if (headline.length > 120) {
					return fail(
						'headline_too_long',
						`目标的一句话有 ${headline.length} 字,超过 120 字上限。\n一句话说不完的问题,通常是把两三个问题捆在了一起:要么显式给一个 ≤120 字的 \`headline\`,要么把问题收窄到能一句话说清的那一个。长的主张照旧放 \`claim\`。`,
					)
				}
			}
			const promoteAtLevel = LEVELS.includes(args.promote_at_level) ? args.promote_at_level : 'L3'
			/**
			 * **修订不许给同一句话发新身份。**
			 *
			 * 真跑踩出来的:一轮长跑里目标改过一次版,卡上就出现 4 条主张的 6~8 行读数——
			 * 同一句话挂着两个 id、各报一个状态(一个「已支持」、另一个「未触及」),
			 * 模型得自己去调和两份自相矛盾的读数。而 id 是身份:主张原文没变就该用回原来的 id,
			 * 这样「这条猜想被验到哪一级」跨版本仍然接着算。
			 *
			 * 反过来,**这一版没再列出来的**要如实落成 `hypothesis/superseded`:
			 * 折法早就认识这条变更,只是从来没有人发过它(与 `retracted` 当年那个「声明了没有生产者」
			 * 是同一种病)。不发它,被放弃的猜想会永远挂在 `proposed` 上,结案时又变成一条假的「没看过」。
			 */
			const existing = state.hypotheses.filter((item) => item.goal === goalId)
			const claimKey = (text) => String(text ?? '').trim().replace(/\s+/g, ' ')
			const idByClaim = new Map(existing.map((item) => [claimKey(item.claim), item.id]))
			const reused = new Set()
			const nextHypotheses = hypotheses.map((hypothesis, index) => {
				const claim = hypothesis.claim.trim()
				const carried = idByClaim.get(claimKey(claim))
				if (carried !== undefined) reused.add(carried)
				return {
					id: carried ?? `h-${Math.random().toString(36).slice(2, 8)}`,
					claim,
					refute_when: hypothesis.refute_when.trim(),
					/** 断言随假设落账;没写就是 null(加法,不是门槛)。 */
					assertions: Array.isArray(hypothesis.assertions) ? hypothesis.assertions : null,
					version: index + 1,
				}
			})
			mutations.push({
				t: 'goal/set',
				id: goalId,
				headline: headline === '' ? null : headline,
				legacy,
				claim: args.claim.trim(),
				done_criteria: criteria,
				criteria: criteriaList,
				criteria_note: criteriaNote,
				promote_at_level: promoteAtLevel,
				revision,
				reason: isRevision ? String(args.reason).trim() : null,
				hypotheses: nextHypotheses,
			})
			for (const dropped of existing) {
				if (reused.has(dropped.id)) continue
				const promoted = (state.facts ?? []).some((fact) => fact.hypothesis === dropped.id)
				if (promoted) continue
				mutations.push({ t: 'hypothesis/superseded', goal: goalId, id: dropped.id, claim: dropped.claim, by: `rev${revision}` })
			}
			return done({
				ok: true,
				code: isRevision ? 'goal_revised' : 'goal_set',
				message:
					`${isRevision ? `目标已修订到 rev${revision}` : `目标已立(${goalId})`},登记 ${hypotheses.length} 条假设。` +
					// 原生 goal 上那一句给人看:用目标的一句话,不写 id。
					attachNativeGoal(exec.agent, clip(headline === '' ? String(args.claim ?? '') : headline, 120)),
			})
		},
	})

	// ── Conclude ──────────────────────────────────────────────────────────

	defineTool({
		name: 'Conclude',
		description:
			'结案:交目标验收——这是完成目标的唯一路径(原生「完成目标」会被拒)。系统**无条件**派独立评估者,拿目标判据与转写忠实度逐条核对;判据达成才结案为 achieved:原生 goal 置为完成、达门槛的判断升格为事实、各步收下的产物声明为交付卡片。否则目标保持开放并回注缺口。**顺序**:achieved 之前必须先把计划收尾(`ClosePlan`)。放弃(`abandoned`)不受此限:原生 goal 置为阻塞,写明原因,由人决定结束。',
		parameters: {
			type: 'object',
			properties: {
				outcome: { type: 'string', enum: ['achieved', 'abandoned'], description: 'achieved=判据已达成;abandoned=如实说清阻塞后放弃' },
				note: { type: 'string', description: '结案说明' },
			},
			required: ['outcome'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			if (state.goal === null || state.goal.status !== 'open') return fail('no_open_goal', '当前没有开放的目标。')
			const goal = state.goal
			if (args.outcome === 'abandoned') {
				mutations.push({ t: 'goal/closed', id: goal.id, status: 'abandoned', verdict: null, note: args.note ?? null })
				return done({
					ok: true,
					code: 'goal_abandoned',
					message: `目标 ${goal.id} 已按 abandoned 结案(阻塞如实记录,记录保留)。${blockNativeGoal(exec.agent, BLOCK_CODES.abandoned, `模型如实放弃了这个目标:${args.note ?? '没写原因'}。要不要结束由人决定。`)}`,
				})
			}
			const plan = activePlanOf(state)
			/**
			 * **目标结案前先把计划收尾**(严格,不是提示)。
			 *
			 * 为什么不让跳过:事实是在收尾那条路上沉淀的(`fact/promoted` 就在本工具里,
			 * 而它按 `derived.hypotheses` 逐条升格)—— 先结目标、留一份 active 的计划,
			 * 等于在账上留下一个开着的东西,还绕过了"沉淀"这道动作 ✗。
			 * 真跑里出现过这个组合:目标 achieved 而计划 active、`fact/promoted: 0`。
			 *
			 * 放弃(`abandoned`)走的是另一条路,**不**受此限:如实说清阻塞就收兵,别为难人 ✓。
			 */
			const openPlan = (state.plans ?? []).find((item) => item.status === 'active') ?? null
			if (openPlan !== null) {
				const remaining = (openPlan.steps ?? []).filter((step) => step.status === 'open')
				return fail(
					'plan_open',
					`目标结案前先把**计划收尾**:计划 ${openPlan.id} 还是 active${
						remaining.length === 0
							? '(所有步都落定了,只差一次 ClosePlan)'
							: `(还有 ${remaining.length} 步没落定:${remaining.map((step) => step.id).join(', ')})`
					}。\n为什么不让跳过:事实是在**收尾**这条路上沉淀的(假设 → 事实),先结目标就等于跳过沉淀 ✗。\n要接着做:把剩下的步交付或用 VoidPlanStep 作废,然后 \`ClosePlan\`;要放弃这个目标就用 \`Conclude(outcome="abandoned")\`(那条路不受此限)。`,
				)
			}
			const derived = hostService.derive(sessionId)
			/**
			 * **知识门:核心结论不许以纯散文升格。**
			 *
			 * 位置有讲究——它坐在「计划已收尾」之后、**派评估者之前**。判据与准入同一条顺序纪律:
			 * 先把能做的前提查完,再花钱请人裁决;等评估卡回来才发现没形态,那一次子 run 就白花了。
			 *
			 * 为什么需要它:断言一直是「加法,不是门槛」,于是真跑里模型的最优策略就是
			 * 「检索 → 总结 → 写报告」——本体、实体、认识论三张图都长不出来,因为完成函数里没有它们。
			 * 让缺口进卡(见 `renderCard`)只解决「看得见」;这一道解决「绕不过」。
			 *
			 * **判据是结构谓词,不是词面**:将要升格的命题里,只要有一条没有断言就拦。
			 * 出口有两条,都是诚实的:补上断言的形态再结,或者如实 `abandoned`。
			 * 缺口不许被伪装成 support(那是「造证」,比不结案坏得多)。
			 *
			 * 开关是 `requireTypedPromotion`(机制缺省关,preset 里开):它与 `minHypotheses`
			 * 是两条不同的立场,所以不共用一个键。另外它**只在知识模式下生效**——
			 * 没有登记的命题就没有「形态」可谈,那时拦下来的只是一句空话。
			 */
			/**
			 * **结构缺口的两道门**(与上面的知识门同一族、同一条顺序纪律:先拦便宜能补的,
			 * 再花钱请人裁决)。
			 *
			 * 两道都是「可清点的整数 + 两条诚实出口」,判据来自投影的 `gaps`,不另算一套:
			 *   · `entities_unlanded`:N 个断言主体还没落到实体图。补法是 `RegisterInstance`
			 *     (登记节点)或 `Assert`(连出处把边也落下来);不值当就如实 abandoned。
			 *   · `levels_skipped`:N 处跳级没有理由。补法是 `ExplainLevelSkip`。
			 * 提示词只会被读成建议;这两道进的是完成函数。
			 */
			const gapOf = (code) => (derived.knowledge.gaps ?? []).find((gap) => gap.code === code) ?? null
			if (CFG.requireLandedEntities && derived.knowledge.mode === 'knowledge') {
				const gap = gapOf('entities_unlanded')
				if (gap !== null) {
					return fail(
						'entities_unlanded',
						`${gap.detail}\n${gap.nextAction}\n为什么不让跳过:断言停在命题上时,图是空的——而"查到的实体"没有落成图,等于这一轮没有留下可复用的东西。两条出口:补登记,或如实 \`Conclude(outcome="abandoned")\`。`,
						{ mutations },
					)
				}
			}
			if (CFG.requireLevelReasons && derived.knowledge.mode === 'knowledge') {
				const gap = gapOf('levels_skipped')
				if (gap !== null) {
					return fail(
						'levels_skipped',
						`${gap.detail}\n${gap.nextAction}\n为什么不让跳过:等级是"这条结论多大程度只能靠信任做的人";跳过便宜的那几级本身不违规,但**没有理由**的跳级等于没人知道为什么。两条出口:补理由,或如实 \`Conclude(outcome="abandoned")\`。`,
						{ mutations },
					)
				}
			}
			if (CFG.requireTypedPromotion && derived.knowledge.mode === 'knowledge') {
				const threshold = levelIndexOf(goal.promote_at_level)
				/** 与下面那段升格循环**逐字同一套谓词**:将要升格的就是这几条,一条不多一条不少。 */
				const promotable = derived.hypotheses.filter(
					(hypothesis) =>
						(hypothesis.status === 'alive' || hypothesis.status === 'proposed') &&
						(hypothesis.refutations ?? 0) === 0 &&
						levelIndexOf(hypothesis.supportedLevel) >= threshold,
				)
				const untyped = promotable.filter((hypothesis) => !Array.isArray(hypothesis.assertions) || hypothesis.assertions.length === 0)
				if (untyped.length > 0) {
					return fail(
						'claims_untyped',
						`有 ${untyped.length} 条命题已经验到门槛、却**没有断言的形态**,再往下就是散文升格:\n${untyped
							.map((hypothesis) => `- ${hypothesis.id}(${hypothesis.supportedLevel}):${hypothesis.claim}`)
							.join('\n')}\n把结论写成「主词 · 谓词 = 宾语」才进得了实体图,下一轮也才按概念取用得到。两条路:\n① **补形态再结**:词汇里没有对应的概念 / 谓词就先 \`RegisterTerm\` / \`RegisterPredicate\`,再用 \`Frame\` 修订目标、把这些命题连断言一起重列一遍(主张原文一字不动就会用回原 id,验到哪一级接着算),然后重新结案;\n② **如实放弃**:这些结论不值得留下形态,就用 \`Conclude(outcome="abandoned")\` 说清阻塞收兵。\n别为了让门放行而编一个词——词汇是约定,它将长期约束这个项目怎么写结论。`,
					)
				}
			}
			const unfinished = plan === null ? [] : plan.steps.filter((step) => step.status === 'open')
			const syntheticStep = { id: `goal:${goal.id}`, ordinal: 0, do: `核验目标 ${goal.id} 的判据与转写忠实度`, done_criteria: goal.done_criteria, artifacts: [], tests: null }
			const gate = {
				confirmed: [
					...state.evidence.map((item) => ({ ref: `evidence:${item.id}`, bytes: 0, digest: `verdict=${item.verdict}` })),
					...derived.hypotheses.map((item) => ({ ref: `hypothesis:${item.id}`, bytes: 0, digest: `${item.status}/支持到${item.supportedLevel ?? '—'}` })),
				],
			}
			const audit = await runEvaluator(sessionId, exec.agent, plan, syntheticStep, gate, 'goal_audit', exec.signal)
			mutations.push(...audit.mutations)
			if (audit.holds === 'pending') return fail('audit_pending', `目标评估者仍在跑:${audit.basis}。先观察当前事实,再谈重试。`, { mutations: audit.mutations })
			if (audit.holds !== 'yes') {
				/**
				 * **复用来的裁决不落第二条证据**。
				 *
				 * 复用意味着"这一次没有新的判断发生"——它只是同一条评审对同一批材料再说了一遍。
				 * 再落一条 `evidence/recorded` 会有两个坏处:账上多一条同义行,而且它会进下一次
				 * digest 的输入面(那条正是"回声"本身)。所以复用只如实说清:裁决是什么、为什么复用、
				 * 要改什么才能得到新判断。真正的结案事实(`audit/reused`)已经在 `audit.mutations` 里。
				 */
				if (audit.reused === true) {
					return fail(
						'goal_not_achieved',
						`目标未达成,保持开放。**这一步与上一次是同一份材料,所以复用了上一条独立裁决**(不再重复花钱请人):判据达成 ${audit.holds}。依据:${audit.basis}\n要拿到新判断,先改材料:补观测 / 交付产物 / 修订假设或判据;只是再喊一次结案不会产生新判断。\n未落定步骤:${unfinished.length === 0 ? '无' : unfinished.map((step) => step.id).join(', ')}`,
						{ mutations },
					)
				}
				/**
				 * 目标级裁决也要带得出出处:那条审计自己写了一张卡、也有它的评估者会话。
				 * 这一处原先 `refs: []` ⇒ 面板上这条证据一个可点的东西都没有 ✗。
				 */
				const goalOrigin = buildEvidenceOrigins({
					cwd: sessionCwd(sessionId),
					accepted: [],
					confirmed: [],
					cardPath: audit.cardPath ?? null,
					evaluatorSession: audit.mutations.find((mutation) => mutation.t === 'audit/dispatched')?.evaluator_session ?? null,
					basis: audit.basis,
				})
				mutations.push({
					t: 'evidence/recorded',
					id: `e-${Math.random().toString(36).slice(2, 8)}`,
					step: syntheticStep.id,
					plan: plan?.id ?? 'goal',
					/** 目标级的裁决不是对哪一条判断的结果:不挂判断,只记「判据没达成 / 判不了」。 */
					hypothesis: null,
					verdict: audit.holds === 'no' ? 'refute' : 'inconclusive',
					level: goal.promote_at_level,
					evaluator: 'independent',
					basis: audit.basis,
					refs: goalOrigin.paths,
					origins: goalOrigin.origins,
					anchor: 'auditor',
					basis_reviewable: true,
				})
				/**
				 * 读面兜底:`preview` 是本次真实运行里"宿主 fiber 掉线"的抛出点。
				 * 拿不到就**不带卡**返回,而不是把这一批事实(含 `audit/dispatched`/`audit/settled`)丢掉。
				 */
				const preview = previewOf(hostService, sessionId, mutations)
				return fail(
					'goal_not_achieved',
					`目标未达成,保持开放。评估者裁决:判据达成 ${audit.holds}。依据:${audit.basis}${audit.shortfalls.length > 0 ? `\n缺口(逐条):\n${audit.shortfalls.map((item) => `- ${verdictText([item])}`).join('\n')}` : ''}\n未落定步骤:${unfinished.length === 0 ? '无' : unfinished.map((step) => step.id).join(', ')}${preview === null ? '\n(运行态卡这一刻取不到:宿主读面不可用。已经发生的事实照旧落账;先看当前账本再谈重试。)' : `\n\n${preview.card}`}`,
					{ mutations },
				)
			}
			/**
			 * **没被任何证据触及的假设**,结案时如实记一笔。
			 *
			 * 两种「没结论」要分得开:证据说「无法判定」= 现有信息不足以定论(已经在账上);
			 * 三样全零 = **没人碰过它**。不强制证实/证伪——但「没看过」不能被写成「没问题」,
			 * 所以这里把它记进结案那条变更里,卡片与面板都说得出来。
			 */
			const untouched = derived.hypotheses.filter(
				(hypothesis) => (hypothesis.supportedLevel === null || hypothesis.supportedLevel === undefined) && (hypothesis.refutations ?? 0) === 0 && (hypothesis.inconclusive ?? 0) === 0,
			)
			mutations.push({ t: 'goal/closed', id: goal.id, status: 'achieved', verdict: 'support', note: args.note ?? null, unjudged: untouched.map((hypothesis) => hypothesis.id) })
			const continuationNote = completeNativeGoal(exec.agent)
			/** 这个目标下各步经准入收下的产物(按路径去重),结案时一次声明成交付卡片。 */
			const delivered = []
			for (const item of state.plans ?? []) {
				if (item.goal !== goal.id) continue
				for (const step of item.steps ?? []) {
					if (step.status !== 'advanced') continue
					for (const artifact of step.artifacts ?? []) {
						const path = typeof artifact === 'string' ? artifact : String(artifact?.path ?? '')
						if (path !== '' && !delivered.some((file) => file.path === path)) delivered.push({ path, description: `步骤 ${step.id}:${clip(step.do, 60)}` })
					}
				}
			}
			const threshold = levelIndexOf(goal.promote_at_level)
			const promoted = []
			for (const hypothesis of derived.hypotheses) {
				if (hypothesis.status !== 'alive' && hypothesis.status !== 'proposed') continue
				if (hypothesis.refutations > 0) continue
				if (levelIndexOf(hypothesis.supportedLevel) < threshold) continue
				const factId = `f-${Math.random().toString(36).slice(2, 8)}`
				const path = persistFact(sessionId, goal, hypothesis, factId)
				/**
				 * 事实带上**边界**(`scope` = 这条假设的推翻条件):没有边界的事实,下一轮没人敢用;
				 * 有边界才算「已知」而不是「口号」。它与出处(证据 id)、等级一起进事实库与货架。
				 */
				mutations.push({
					t: 'fact/promoted',
					id: factId,
					goal: goal.id,
					/**
					 * **身份与内容一起定型**:`hypothesis` 是产出它的那条假设(按 id 关联,
					 * 措辞改了也认得出),`assertions` 是这条事实的类型化内容(没写就是 null)。
					 * 断言只在**升格这一刻**落地——旧事实不会被回溯改写。
					 */
					hypothesis: hypothesis.id,
					text: hypothesis.claim,
					scope: hypothesis.refute_when ?? null,
					level: hypothesis.supportedLevel ?? null,
					evidence: evidenceFor(state, hypothesis.id)
						.filter((item) => item.verdict === 'support')
						.map((item) => item.id),
					assertions: Array.isArray(hypothesis.assertions) ? hypothesis.assertions : null,
					path,
				})
				promoted.push(hypothesis.claim)
			}
			return done({
				ok: true,
				code: 'goal_achieved',
				verdict: 'support',
				message:
					`目标 ${goal.id} 已达成(独立评估者裁决:${audit.basis})。` +
					(promoted.length > 0 ? `\n升格为事实:${promoted.join(' / ')}(写入 clear/knowledge/facts/${goal.id}.md)` : '\n没有达到升格门槛的假设。') +
					(untouched.length > 0
						? `\n结案时有 ${untouched.length} 条假设**没有被任何证据触及**:${untouched.map((hypothesis) => hypothesis.id).join(', ')}——未判的假设不是「没问题」,是「没看过」;它们留在账上,随时可以补一次验证。`
						: '') +
					'\n被推翻与被改版的假设保留在日志里。' +
					continuationNote +
					declareDeliverables(exec, sessionId, delivered),
			})
		},
	})

	function persistFact(sessionId, goal, hypothesis, factId) {
		const file = sessionFile(sessionId, 'clear', 'knowledge', 'facts', `${goal.id}.md`)
		if (file === null) return null
		try {
			appendTextFile(
				file,
				`\n## ${factId} · ${hypothesis.claim}\n\n- 假设:${hypothesis.id}(支持到 ${hypothesis.supportedLevel},无推翻)\n- 推翻条件:${hypothesis.refute_when}\n- 来源目标:${goal.id}\n- 升格时间:${new Date().toISOString()}\n`,
			)
			return file
		} catch (error) {
			ctx.logger?.warn?.(`clearai kernel: 事实落盘失败 ${String(error?.message ?? error)}`)
			return null
		}
	}

	// ── 计划六件 ───────────────────────────────────────────────────────────

	const STEP_SCHEMA = {
		type: 'object',
		properties: {
			id: { type: 'string', description: '稳定 id(字母/数字/下划线/短横)' },
			do: { type: 'string', description: '这一步做什么' },
			artifacts: { type: 'array', items: { type: 'string' }, description: '以何物为证:相对 workspace 的具体产物文件路径(目录不是物证)' },
			done_criteria: { type: 'string', description: '判定标准:在结果出现之前写下,必须可核对' },
			tests: {
				type: 'object',
				properties: {
					hypotheses: {
						type: 'array',
						minItems: 1,
						items: { type: 'string' },
						description: '这一步检验哪几条判断:**填 id 最稳**(h-xxxx,从运行态卡复制),也接受主张原文。一次观测同时判几条竞争的判断时(比较那一步),把它们都列上',
					},
					level: { type: 'string', enum: LEVELS },
				},
				required: ['hypotheses', 'level'],
				additionalProperties: false,
			},
		},
		required: ['id', 'do', 'done_criteria'],
		additionalProperties: false,
	}


	// ── 领域语言(本体动词)─────────────────────────────────────────────────
	/**
	 * 七个动词 = 领域词汇的**全部写入口**(注册 / 修订 / 废止,概念与谓词各一套)+ 一个读入口。
	 *
	 * 它们只做一件事:把「这个领域有哪些概念、哪些谓词、关系取什么值形态」写进账本事件,
	 * 由折法折成 `state.lexicon`;再由同一份折法长出本体图、冲突读数与货架。
	 *
	 * 四条贯穿所有动词的纪律:
	 *   · **判据只有一份**——校验经 `hostService.domain.*`(与折法、读面同源),预设侧不复制规则;
	 *   · **依据必填**——约定可以自愿,不能无来由;
	 *   · **没有删除**——修订留版本,废止留缘由且是黏性终态;
	 *   · **语义变化必须换 id**——改展示信息走修订,改含义/主词域/值域走「废止 + 新注册」。
	 */
	defineTool({
		name: 'RegisterTerm',
		description:
			'登记一个领域概念(本体图上的节点)。id 用小写 slug;`gloss` 一句话说清它指什么;`basis` 必填——哪份材料、哪条事实或人说的哪句话让这个词成立。`parent` 可选(is_a,只能连概念)。登记是**约定**不是主张:它不需要证据等级,但从此可以出现在断言里。要改展示信息用 ReviseTerm,要作废用 DeprecateTerm(记录不会删)。',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: '小写字母开头的 slug(字母/数字/下划线,≤40)' },
				label: { type: 'string', description: '给人看的名字' },
				gloss: { type: 'string', description: '一句话释义' },
				aliases: { type: 'array', items: { type: 'string' }, description: '别名(可选)' },
				parent: { type: 'string', description: '父概念 id(可选,is_a)' },
				basis: { type: 'string', description: '依据:哪份材料 / 哪条事实 / 谁说的' },
			},
			required: ['id', 'label', 'gloss', 'basis'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const judge = domainJudge(hostService)
			if (judge === null) return fail('domain_unavailable', '这一层的宿主没有提供领域判据(domain facade):无法校验词汇。请检查宿主半与预设是否同版本。')
			const problems = judge.validateTerm(sessionId, args)
			if (problems.length > 0) return fail('term_rejected', `这个词不能登记:\n${problems.map((item) => `- ${item}`).join('\n')}`)
			mutations.push({
				t: 'ontology/term_added',
				id: String(args.id).trim(),
				label: String(args.label).trim(),
				gloss: String(args.gloss).trim(),
				aliases: Array.isArray(args.aliases) ? args.aliases.map((alias) => String(alias)) : [],
				parent: args.parent === undefined ? null : String(args.parent).trim(),
				basis: String(args.basis).trim(),
			})
			const note = ensureDomainShelf(hostService, sessionId, mutations)
			return done({
				ok: true,
				code: 'term_registered',
				message: `概念 ${String(args.id).trim()} 已登记。它现在是本体图上的一个节点:新断言可以引用它。${note}`,
			})
		},
	})

	defineTool({
		name: 'RegisterPredicate',
		description:
			'登记一个领域谓词(本体图上的边)。值域二选一:`range={form:"quantity"|"statement"|"formula"|"code"|"reference",unit?}` 说宾语是一个**字面值**,或 `range={term:"<概念 id>"}` 说宾语是**另一个概念的实例**。`domain` 可选(主词域,声明了它,断言的主体就必须写明类型)。`functional=true` 表示单值:同一主体出现两个不同取值时,投影会给出一对**冲突**(只暴露,不裁决)。',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: '小写字母开头的 slug' },
				label: { type: 'string', description: '给人看的名字' },
				gloss: { type: 'string', description: '一句话释义(可选)' },
				domain: { type: 'string', description: '主词域:概念 id(可选)' },
				range: {
					type: 'object',
					description: '值域:{form,unit?} 或 {term}',
					properties: {
						form: { type: 'string', enum: ['statement', 'quantity', 'formula', 'code', 'reference'] },
						unit: { type: 'string' },
						term: { type: 'string' },
					},
					additionalProperties: false,
				},
				functional: { type: 'boolean', description: '是否单值(默认否)' },
				basis: { type: 'string', description: '依据(必填)' },
			},
			required: ['id', 'label', 'range', 'basis'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const judge = domainJudge(hostService)
			if (judge === null) return fail('domain_unavailable', '这一层的宿主没有提供领域判据(domain facade):无法校验词汇。请检查宿主半与预设是否同版本。')
			const problems = judge.validatePredicate(sessionId, args)
			if (problems.length > 0) return fail('predicate_rejected', `这个谓词不能登记:\n${problems.map((item) => `- ${item}`).join('\n')}`)
			mutations.push({
				t: 'ontology/predicate_added',
				id: String(args.id).trim(),
				label: String(args.label).trim(),
				gloss: args.gloss === undefined ? '' : String(args.gloss).trim(),
				domain: args.domain === undefined ? null : String(args.domain).trim(),
				range: args.range,
				functional: args.functional === true,
				basis: String(args.basis).trim(),
			})
			const note = ensureDomainShelf(hostService, sessionId, mutations)
			return done({
				ok: true,
				code: 'predicate_registered',
				message: `谓词 ${String(args.id).trim()} 已登记(${args.range?.term ? `宾语是概念 ${args.range.term} 的实例` : `宾语取 ${args.range?.form} 形态`}${args.functional === true ? ' · 单值' : ''})。下一步:在 Frame 的假设里带上断言,引用它。${note}`,
			})
		},
	})

	defineTool({
		name: 'ReviseTerm',
		description:
			'修订一个概念的**展示信息**(名字 / 释义 / 别名):版本 +1,旧值留在账上,id 不变。**语义变化不许走这条路**——含义、父概念变了就废止旧条目、注册新条目;稳定 id 的含义在历史上悄悄改变,等于拿今天的释义重写所有旧事实。',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				label: { type: 'string', description: '新名字(可选)' },
				gloss: { type: 'string', description: '新释义(可选)' },
				aliases: { type: 'array', items: { type: 'string' } },
				reason: { type: 'string', description: '为什么改(必填)' },
			},
			required: ['id', 'reason'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const entry = findLexiconEntry(state, args.id)
			if (entry === null || entry.kind !== 'term') return fail('unknown_term', `词汇里没有这个概念:${String(args.id)}`)
			if (entry.entry.status === 'deprecated') return fail('term_deprecated', `概念 ${String(args.id)} 已废止,不能修订(要恢复语义就注册新条目)。`)
			if (typeof args.reason !== 'string' || args.reason.trim() === '') return fail('reason_required', '修订要写一句原因:改了什么、为什么改。')
			if (args.label === undefined && args.gloss === undefined && args.aliases === undefined) return fail('nothing_to_revise', '没有要改的字段:label / gloss / aliases 至少给一个。')
			mutations.push({ t: 'ontology/term_revised', id: String(args.id), label: args.label === undefined ? undefined : String(args.label).trim(), gloss: args.gloss === undefined ? undefined : String(args.gloss).trim(), aliases: Array.isArray(args.aliases) ? args.aliases.map((alias) => String(alias)) : undefined, reason: String(args.reason).trim() })
			const note = ensureDomainShelf(hostService, sessionId, mutations)
			return done({ ok: true, code: 'term_revised', message: `概念 ${String(args.id)} 已修订(旧值留在账上)。${note}` })
		},
	})

	defineTool({
		name: 'RevisePredicate',
		description: '修订一个谓词的**展示信息**(名字 / 释义)。值域、主词域与单值性是语义——那三样变了要废止旧谓词、注册新的。',
		parameters: {
			type: 'object',
			properties: { id: { type: 'string' }, label: { type: 'string' }, gloss: { type: 'string' }, reason: { type: 'string' } },
			required: ['id', 'reason'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const entry = findLexiconEntry(state, args.id)
			if (entry === null || entry.kind !== 'predicate') return fail('unknown_predicate', `词汇里没有这个谓词:${String(args.id)}`)
			if (entry.entry.status === 'deprecated') return fail('predicate_deprecated', `谓词 ${String(args.id)} 已废止,不能修订。`)
			if (typeof args.reason !== 'string' || args.reason.trim() === '') return fail('reason_required', '修订要写一句原因。')
			mutations.push({ t: 'ontology/predicate_revised', id: String(args.id), label: args.label === undefined ? undefined : String(args.label).trim(), gloss: args.gloss === undefined ? undefined : String(args.gloss).trim(), reason: String(args.reason).trim() })
			const note = ensureDomainShelf(hostService, sessionId, mutations)
			return done({ ok: true, code: 'predicate_revised', message: `谓词 ${String(args.id)} 已修订(版本 +1,旧值留着)。${note}` })
		},
	})

	/**
	 * **废止是黏性终态**:没有复活这条路。存量事实照旧可读(历史留着),
	 * 引用它的**新**断言会被拒,并在货架上标明「所用术语已废止」。
	 */
	defineTool({
		name: 'DeprecateTerm',
		description:
			'废止一个概念(或谓词):缘由必填。**没有删除**——条目、旧版本与引用过它的事实全部留着;新断言不许再引用它,存量事实在货架上标明「所用术语已废止」。要恢复语义就注册一个新条目(那是覆盖,不是复活)。',
		parameters: {
			type: 'object',
			properties: { id: { type: 'string', description: '概念或谓词的 id' }, reason: { type: 'string', description: '为什么废止(必填)' } },
			required: ['id', 'reason'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const entry = findLexiconEntry(state, args.id)
			if (entry === null) return fail('unknown_entry', `词汇里没有这个条目:${String(args.id)}`)
			if (entry.entry.status === 'deprecated') return fail('already_deprecated', `${String(args.id)} 已经是废止状态(这一步不会重复记账)。`)
			if (typeof args.reason !== 'string' || args.reason.trim() === '') return fail('reason_required', '废止要写缘由:为什么这个词不再用。')
			mutations.push({ t: entry.kind === 'term' ? 'ontology/term_deprecated' : 'ontology/predicate_deprecated', id: String(args.id), reason: String(args.reason).trim() })
			const note = ensureDomainShelf(hostService, sessionId, mutations)
			return done({
				ok: true,
				code: 'entry_deprecated',
				message: `${entry.kind === 'term' ? '概念' : '谓词'} ${String(args.id)} 已废止(记录保留,新断言不许再引用;引用过它的事实照旧可读)。${note}`,
			})
		},
	})

	defineTool({
		name: 'DeprecatePredicate',
		description: '废止一个谓词:缘由必填,记录保留,新断言不许再引用它(与 DeprecateTerm 同一条纪律,单列出来是为了让参数与语义各自说清)。',
		parameters: {
			type: 'object',
			properties: { id: { type: 'string' }, reason: { type: 'string' } },
			required: ['id', 'reason'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const entry = findLexiconEntry(state, args.id)
			if (entry === null || entry.kind !== 'predicate') return fail('unknown_predicate', `词汇里没有这个谓词:${String(args.id)}`)
			if (entry.entry.status === 'deprecated') return fail('already_deprecated', `${String(args.id)} 已经是废止状态。`)
			if (typeof args.reason !== 'string' || args.reason.trim() === '') return fail('reason_required', '废止要写缘由。')
			mutations.push({ t: 'ontology/predicate_deprecated', id: String(args.id), reason: String(args.reason).trim() })
			const note = ensureDomainShelf(hostService, sessionId, mutations)
			return done({ ok: true, code: 'entry_deprecated', message: `谓词 ${String(args.id)} 已废止(记录保留,新断言不许再引用)。${note}` })
		},
	})

	/**
	 * **螺旋上半圈的入口**:按概念 / 谓词 / 主体取「已知」。
	 * 读数全部来自投影(事实与流转中的假设),不新建任何存储;它也不改任何东西。
	 */
	defineTool({
		name: 'QueryKnowledge',
		description:
			'按概念 / 谓词 / 主体查「已知」:返回带类型化断言的**已升格事实**与**还在流转的命题**。要复用前面的结论就用它,而不是把事实库重读一遍。只读:它不改任何东西。',
		parameters: {
			type: 'object',
			properties: {
				term: { type: 'string', description: '概念 id:匹配断言的主体类型 / 宾语概念 / 词条本身' },
				predicate: { type: 'string', description: '谓词 id' },
				subject: { type: 'string', description: '主体名称(实例)' },
			},
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const derived = hostService.derive(sessionId)
			const filter = { term: args.term === undefined ? '' : String(args.term).trim(), predicate: args.predicate === undefined ? '' : String(args.predicate).trim(), subject: args.subject === undefined ? '' : String(args.subject).trim() }
			if (filter.term === '' && filter.predicate === '' && filter.subject === '') return fail('query_empty', '至少给一个条件:term / predicate / subject。')
			const match = (assertion) => {
				const subject = assertion?.subject ?? {}
				const object = assertion?.object ?? {}
				if (filter.predicate !== '' && String(assertion?.predicate ?? '') !== filter.predicate) return false
				if (filter.subject !== '' && String(subject.id ?? '') !== filter.subject) return false
				if (filter.term !== '') {
					const hits = [String(subject.type ?? ''), String(subject.id ?? ''), String(object.kind) === 'instance' ? String(object.type ?? '') : '', String(object.kind) === 'instance' ? String(object.value ?? '') : '', String(assertion?.predicate ?? '')]
					if (!hits.includes(filter.term)) return false
				}
				return true
			}
			const facts = derived.factRows.filter((fact) => (Array.isArray(fact.assertions) ? fact.assertions : []).some(match))
			const inFlight = derived.hypotheses.filter((hypothesis) => (Array.isArray(hypothesis.assertions) ? hypothesis.assertions : []).some(match))
			if (facts.length === 0 && inFlight.length === 0) {
				return done({ ok: true, code: 'knowledge_empty', message: `这个词汇条件下还没有任何东西:${describeFilter(filter)}。要么先登记/验证,要么换个条件——**不要**把「查不到」写成「不存在」。` })
			}
			const lines = []
			if (facts.length > 0) {
				lines.push(`已知(已升格,可作为已知引用):${facts.length} 条`)
				for (const fact of facts.slice(0, 12)) {
					lines.push(`- ${fact.id} · ${clip(String(fact.text ?? ''), 120)}(支持到 ${fact.level ?? '—'}${fact.review?.decision === 'retracted' ? ' · **已撤回**' : fact.refuted === true ? ' · 有推翻证据等人决定' : ''})`)
					lines.push(`  边界:${clip(String(fact.scope ?? '(未写)'), 120)}`)
					for (const assertion of fact.assertions ?? []) if (match(assertion)) lines.push(`  断言:${hostService.domain.format(sessionId, assertion)}`)
				}
				if (facts.length > 12) lines.push(`  (还有 ${facts.length - 12} 条,见 clear/knowledge/facts/INDEX.md)`)
			}
			if (inFlight.length > 0) {
				lines.push(`还在流转的命题(未升格):${inFlight.length} 条`)
				for (const hypothesis of inFlight.slice(0, 8)) {
					lines.push(`- ${hypothesis.id} [${hypothesis.status}] ${clip(String(hypothesis.claim ?? ''), 100)}${hypothesis.supportedLevel === null ? '' : `(支持到 ${hypothesis.supportedLevel})`}`)
					for (const assertion of hypothesis.assertions ?? []) if (match(assertion)) lines.push(`  断言:${hostService.domain.format(sessionId, assertion)}`)
				}
			}
			return done({ ok: true, code: 'knowledge_found', message: `${describeFilter(filter)}\n${lines.join('\n')}` })
		},
	})

	/**
	 * ── 实体两件:实例与关于它的断言 ──────────────────────────────────────────
	 *
	 * **为什么要单独立这两件**:原来实体层的节点与边**只**来自
	 * 已升格事实,而事实是"目标级独立裁决判 support"之后才发的奖励。于是一条观察要变成实体,
	 * 必须同时满足「命题登记了 + 断言类型合法 + 证据够门槛 + 无推翻 + **整条目标的四条散文判据
	 * 都被评估者认可**」——最后那一条与这条观察毫无关系,却握着实体层的存在性。
	 * 失效模式是**比例失衡**:本体层可以堆出几十个词(登记是约定,不花代价),而实体图可能
	 * 一个节点都没有——账面上"本体建好了",实际上一条可复核的观测都没留下来。
	 *
	 * 修法是把「约定」与「观测」分开,各给一个写入口:
	 *   · `RegisterTerm` = 约定(概念,不需要依据);
	 *   · `RegisterInstance` = 观测(实例,**必须**带依据与出处);
	 *   · `Assert` = 关于某个实例的一句话(**必须**带出处),它**在落账那一刻就进实体图**。
	 * 事实层照旧:独立裁决过的结论仍然升格成事实,实体图因此有两类边
	 * (带等级的 `promoted` 与带出处的 `asserted`),两条都看得见。
	 */
	defineTool({
		name: 'RegisterInstance',
		description:
			'登记一个**实例**(实体图上的节点):某个具体的人 / 作品 / 事件 / 样本。与 `RegisterTerm` 的分工是硬的——概念是**约定**(不需要依据),实例是**观测**(`basis` 与 `provenance` 必填)。`type` 必须是已登记的概念。实例自己不带关系;要让它连上别的节点就用 `Assert`。',
		parameters: {
			type: 'object',
			properties: {
				id: { type: 'string', description: '实例 id:小写 slug 或原文名(字母/数字/下划线/短横,≤60)' },
				type: { type: 'string', description: '它是什么概念的实例(已登记的 term id)' },
				label: { type: 'string', description: '给人看的名字' },
				basis: { type: 'string', description: '依据:哪份材料 / 哪条观测让这个实例成立' },
				provenance: {
					type: 'object',
					description: '出处:能指认到的东西。url = 可打开的链接;named = 具名文献 / 条目;backref = 工作区里已有的文件或条目 id',
					properties: {
						kind: { type: 'string', enum: ['url', 'named', 'backref'] },
						ref: { type: 'string', description: '链接、文献名或文件路径' },
					},
					required: ['kind', 'ref'],
					additionalProperties: false,
				},
			},
			required: ['id', 'type', 'label', 'basis', 'provenance'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const id = String(args.id ?? '').trim()
			const type = String(args.type ?? '').trim()
			const label = String(args.label ?? '').trim()
			const basis = String(args.basis ?? '').trim()
			const kind = String(args.provenance?.kind ?? '').trim()
			const ref = String(args.provenance?.ref ?? '').trim()
			if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) return fail('instance_id_invalid', 'id 只能用字母/数字/下划线/短横(≤60):它是图上的稳定键,不能含空格与标点。')
			if (label === '') return fail('instance_label_required', '实例要有一个人能读的名字。')
			if (basis === '') return fail('instance_basis_required', '实例是**观测**不是约定:写清哪份材料让它可以被指认。')
			if (!['url', 'named', 'backref'].includes(kind) || ref === '') {
				return fail('instance_provenance_required', '出处必填:`{kind:"url"|"named"|"backref", ref:"…"}`。没有出处的实例进不了实体图——那是它与概念的区别。')
			}
			const terms = Array.isArray(stateOf(sessionId)?.lexicon?.terms) ? stateOf(sessionId).lexicon.terms : []
			const known = terms.find((term) => String(term.id) === type)
			if (known === undefined) return fail('instance_type_unknown', `type ${type} 不是已登记的概念。先 RegisterTerm 立这个概念(它才是约定那一侧),再登记实例。`)
			if (String(known.status ?? 'admitted') === 'deprecated') return fail('instance_type_deprecated', `概念 ${type} 已废止:新断言不许再引用它。`)
			mutations.push({ t: 'entity/registered', id, type, label, basis, provenance: { kind, ref } })
			const note = ensureDomainShelf(hostService, sessionId, mutations)
			return done({
				ok: true,
				code: 'instance_registered',
				message: `实例 ${id} 已登记为 ${type} 的实例(出处:${kind} · ${ref})。它现在是实体图上的一个节点——**还没有边**:要让它连上别的节点,用 \`Assert\` 写一句带出处的话。${note}`,
			})
		},
	})

	defineTool({
		name: 'Assert',
		description:
			'说一句关于某个**已登记实例**的话(主词–谓词–宾语),并带上出处。它**在落账那一刻就进实体图**:不需要等目标级独立裁决。这是把"查到的实体"变成"实体图谱"的那条路。带等级的结论仍走假设 → 证据 → 升格那条路(那才叫事实);`Assert` 记的是**观测**,图上的边会标成 `asserted` 与事实边区分。',
		parameters: {
			type: 'object',
			properties: {
				subject: {
					type: 'object',
					properties: { id: { type: 'string' }, type: { type: 'string' } },
					required: ['id', 'type'],
					additionalProperties: false,
				},
				predicate: { type: 'string', description: '已登记的谓词 id' },
				object: {
					type: 'object',
					properties: {
						kind: { type: 'string', enum: ['instance', 'statement', 'quantity', 'formula', 'code', 'reference'] },
						value: {},
						type: { type: 'string', description: 'kind=instance 时,宾语所属概念 id' },
						unit: { type: 'string' },
					},
					required: ['kind'],
					additionalProperties: false,
				},
				evidence: {
					type: 'object',
					properties: { kind: { type: 'string', enum: ['url', 'named', 'backref'] }, ref: { type: 'string' } },
					required: ['kind', 'ref'],
					additionalProperties: false,
				},
			},
			required: ['subject', 'predicate', 'object', 'evidence'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const judge = domainJudge(hostService)
			if (judge === null) return fail('domain_unavailable', '这一层的宿主没有提供领域判据(domain facade):无法校验断言。请检查宿主半与预设是否同版本。')
			const subjectId = String(args.subject?.id ?? '').trim()
			const subjectType = String(args.subject?.type ?? '').trim()
			const predicateId = String(args.predicate ?? '').trim()
			const kind = String(args.evidence?.kind ?? '').trim()
			const ref = String(args.evidence?.ref ?? '').trim()
			if (subjectId === '' || subjectType === '') return fail('assert_subject_required', '主词要同时给 `id` 与 `type`(type 是它所属的概念)。')
			if (predicateId === '') return fail('assert_predicate_required', '谓词必填:先 `RegisterPredicate` 立一条关系,再说这句话。')
			if (!['url', 'named', 'backref'].includes(kind) || ref === '') return fail('assert_evidence_required', '出处必填:`{kind:"url"|"named"|"backref", ref:"…"}`。**没有出处的话是意见,不是观测**——它不进实体图。')
			const projection = hostService.domain.graph?.(sessionId) ?? null
			const registered = Array.isArray(stateOf(sessionId)?.entities) ? stateOf(sessionId).entities : []
			if (!registered.some((entity) => String(entity.id) === subjectId && String(entity.type) === subjectType)) {
				return fail('assert_subject_not_registered', `主词 ${subjectType}|${subjectId} 还不是实体图上的节点。先 \`RegisterInstance\` 把它连出处登记下来,再说关于它的话——**主词可指认**是这句话能被复核的前提。`)
			}
			if (projection !== null && Array.isArray(projection.nodes)) {
				const types = new Set(projection.nodes.filter((node) => node?.kind === 'concept').map((node) => String(node.ref)))
				if (!types.has(subjectType)) return fail('assert_subject_type_unknown', `主词的类型 ${subjectType} 不是已登记的概念。`)
				const objectType = String(args.object?.type ?? '').trim()
				if (String(args.object?.kind) === 'instance' && objectType !== '' && !types.has(objectType)) return fail('assert_object_type_unknown', `宾语的类型 ${objectType} 不是已登记的概念。`)
			}
			const problems = judge.validateAssertions(sessionId, [{ predicate: predicateId, subject: { id: subjectId, type: subjectType }, object: args.object }])
			if (problems.length > 0) return fail('assertion_rejected', `这句话不能成立:\n${problems.map((item) => `- ${item}`).join('\n')}`)
			const assertionId = `as-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
			mutations.push({
				t: 'entity/asserted',
				id: assertionId,
				subject: { id: subjectId, type: subjectType },
				predicate: predicateId,
				object: args.object,
				evidence: { kind, ref },
			})
			const note = ensureDomainShelf(hostService, sessionId, mutations)
			return done({
				ok: true,
				code: 'entity_asserted',
				message: `${subjectType}|${subjectId} —${predicateId}→ 已落账(出处:${kind} · ${ref})。它现在**在实体图上有一条边**;这条边走的是"带出处的观测",与升格事实那条"带等级的结论"分开标注。${note}`,
			})
		},
	})

	/**
	 * ── ExplainLevelSkip:跳级要记账 ─────────────────────────────────────────
	 *
	 * 等级衡量的是「这条结论在多大程度上只能靠信任做的人」。便宜的那几级(L0 自洽检查、
	 * L1 已有知识、L2 已有数据)不是形式:它们能在花掉一次独立裁决之前先把问题问清。
	 * 但 `supportedLevel` 只是 support 证据的最大值,**跳级不违规、也没有任何代价**——
	 * 于是"一路只在最贵的那一级交付"成了最优策略:结论全部停在 L3,而 L0 证据一条都没有。
	 *
	 * 不逼模型补读数(首次测量确实可能没有廉价路),但**跳级必须留下理由**:
	 * 理由是「这一级在本项目里为什么不适用」,不是「时间不够」。
	 */
	defineTool({
		name: 'ExplainLevelSkip',
		description:
			'为**没走过的验证等级**留下理由。`levels` 必须是这条命题当前"未走过"的等级(卡上会列出来);`reason` 要写成"这一级在本项目里为什么不适用",并**点到该等级要检查的对象名**——写"时间不够"不算理由。它不改等级、也不替代读数:它只让"跳过"从默许变成账上的一条事实。',
		parameters: {
			type: 'object',
			properties: {
				hypothesis: { type: 'string', description: '命题 id(也认原文与唯一前缀)' },
				levels: { type: 'array', items: { type: 'string', enum: LEVELS }, description: '未走过的等级' },
				reason: { type: 'string', description: '为什么这一级在本项目里不适用(必须点到该等级要检查的对象名)' },
			},
			required: ['hypothesis', 'levels', 'reason'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const derived = hostService.derive(sessionId)
			const hypothesis = matchHypothesis(derived.hypotheses, args.hypothesis)
			if (hypothesis === null) return fail('hypothesis_unknown', `认不出这条命题:${String(args.hypothesis)}。有效 id:${derived.hypotheses.map((item) => item.id).join('、') || '(当前没有命题)'}。`)
			const levels = (Array.isArray(args.levels) ? args.levels : []).map((level) => String(level)).filter((level) => LEVELS.includes(level))
			if (levels.length === 0) return fail('levels_required', `levels 必填,取值 ${LEVELS.join('/')}。`)
			const untouched = Array.isArray(hypothesis.untouchedLevels) ? hypothesis.untouchedLevels : []
			const notUntouched = levels.filter((level) => !untouched.includes(level))
			if (notUntouched.length > 0) {
				return fail(
					'levels_not_untouched',
					`${notUntouched.join('/')} 不是"未走过"的等级,不能给它写跳过理由(${hypothesis.id} 当前未走过:${untouched.join('/') || '无'})。见卡上那行读数。`,
				)
			}
			const reason = String(args.reason ?? '').trim()
			if (reason.length < 24) return fail('skip_reason_too_short', '理由太短:写明"这一级要检查什么、为什么在本项目里不适用"。')
			/**
			 * **可清点的理由判据**:理由里必须出现该等级要检查的对象名(取自这条命题自己的断言主体)。
			 * 这不是文字游戏——它挡住的是"随便写一句「不适用」就把门过了"这条捷径。
			 */
			const subjects = (Array.isArray(hypothesis.assertions) ? hypothesis.assertions : [])
				.map((assertion) => String(assertion?.object?.value ?? '').trim())
				.concat((Array.isArray(hypothesis.assertions) ? hypothesis.assertions : []).map((assertion) => String(assertion?.subject?.id ?? '').trim()))
				.filter((token) => token !== '')
			if (subjects.length > 0 && !subjects.some((token) => reason.includes(token))) {
				return fail(
					'skip_reason_missing_object',
					`理由里必须点到这一级要检查的对象名:${subjects.slice(0, 6).join('、')}。\n为什么要求这个:一句"不适用"谁都会写,而写清"看的是哪个对象、为什么不适用于它"才是一次可复核的判断。`,
				)
			}
			mutations.push({ t: 'level/skipped', goal: state.goal?.id ?? null, hypothesis: hypothesis.id, levels, reason })
			const left = untouched.filter((level) => !levels.includes(level))
			return done({
				ok: true,
				code: 'level_skip_recorded',
				message: `${hypothesis.id} 的 ${levels.join('/')} 已记下跳过理由。${left.length === 0 ? '这条命题的跳级现在都有理由了。' : `还剩 ${left.join('/')} 没有理由——卡上会继续报。`}`,
			})
		},
	})

	defineTool({
		name: 'CreatePlan',
		description:
			'立约:把复杂任务立成一份计划。每步一句话说清做什么(do)、以何物为证(artifacts)、以及判定标准(done_criteria,在结果出现之前写下)。检验判断的步骤用 tests:{hypotheses, level} 声明验哪几条、什么等级(比较竞争路线的那一步,把竞争的几条都列上)。最多 25 步。约立起便锁定:局部挫折改当前步,不要推倒重来。',
		parameters: {
			type: 'object',
			properties: {
				brief: { type: 'string', description: `给人读的计划说明(Markdown,建议 ≥${MIN_BRIEF_CHARS} 字,至少两个 ## 小节)` },
				steps: { type: 'array', items: STEP_SCHEMA },
			},
			required: ['steps'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			if (activePlanOf(state) !== null) return fail('active_plan_exists', '已经有一份活动计划。改它用 AmendPlan / RefinePlan / VoidPlanStep,收它用 ClosePlan。')
			const problem = validateSteps(args.steps)
			if (problem !== null) return fail('invalid_steps', problem)
			const resolvedTests = new Map()
			for (const step of args.steps) {
				const resolved = resolveTests(state.hypotheses, step.tests)
				if (resolved.ok !== true) return fail('unknown_hypothesis', `步骤 ${step.id} 声明的判断「${resolved.wanted}」对不上任何一条已登记的判断。${hypothesisMenu(state.hypotheses)}`)
				resolvedTests.set(step.id, resolved.tests)
			}
			const warnings = []
			if (typeof args.brief !== 'string' || args.brief.length < CFG.minBriefChars) warnings.push(`brief 偏短(建议 ≥${CFG.minBriefChars} 字),它是给人读的计划说明`)
			const goal = state.goal !== null && state.goal.status === 'open' ? state.goal : null
			const planId = uniqueId('p')
			const brief = typeof args.brief === 'string' ? args.brief : ''
			mutations.push({
				t: 'plan/created',
				id: planId,
				goal: goal?.id ?? null,
				phase_id: goal?.id ?? null,
				brief,
				steps: args.steps.map((step) => ({ id: step.id, do: step.do, artifacts: step.artifacts ?? [], done_criteria: step.done_criteria, tests: resolvedTests.get(step.id) ?? null })),
			})
			return done({
				ok: true,
				code: 'plan_created',
				progress_changed: true,
				message: `计划 ${planId} 已立(${args.steps.length} 步)${goal === null ? '' : `,属于目标 ${goal.id} 的一个阶段`}。${warnings.length > 0 ? `\n提醒:${warnings.join(';')}` : ''}`,
			})
		},
	})

	defineTool({
		name: 'CheckPlan',
		description: '取计划的真实状态:真实 step_id、每步的产物声明与判定标准、派生进度、以及下一个可交付步。对象不明时先查这里。',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
		output: CARD_OUTPUT,
		async execute(_args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const card = call.hostService.renderCard(call.sessionId)
			return { ok: true, mutations: [], card, message: card }
		},
	})

	defineTool({
		name: 'AmendPlan',
		description: '补一步:漏了活就补上。不动进度(返回值 progress_changed=false)。',
		parameters: { type: 'object', properties: { step: STEP_SCHEMA }, required: ['step'], additionalProperties: false },
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const plan = activePlanOf(state)
			if (plan === null) return fail('no_active_plan', '没有活动计划。')
			if (plan.steps.length >= MAX_PLAN_STEPS) return fail('plan_too_long', `计划已有 ${plan.steps.length} 步,上限 ${MAX_PLAN_STEPS}。`)
			const problem = validateSteps([args.step], plan.steps)
			if (problem !== null) return fail('invalid_step', problem)
			if (plan.steps.some((step) => step.id === args.step.id)) return fail('duplicate_step', `步骤 id 已存在:${args.step.id}`)
			const resolved = resolveTests(state.hypotheses, args.step.tests)
			if (resolved.ok !== true) return fail('unknown_hypothesis', `步骤 ${args.step.id} 声明的判断「${resolved.wanted}」对不上任何一条已登记的判断。${hypothesisMenu(state.hypotheses)}`)
			const amended = { id: args.step.id, do: args.step.do, artifacts: args.step.artifacts ?? [], done_criteria: args.step.done_criteria, tests: resolved.tests }
			mutations.push({ t: 'plan/amended', plan: plan.id, step: amended })
			if (plan.blocked !== undefined) mutations.push({ t: 'block/cleared', plan: plan.id, step: plan.blocked.step })
			return done({ ok: true, code: 'plan_amended', progress_changed: false, message: `已补一步 ${args.step.id}(进度不变)。` })
		},
	})

	defineTool({
		name: 'RefinePlan',
		description: '精化判定标准:只改 done_criteria,不动进度。旧判据留在日志里(什么都不删)。',
		parameters: {
			type: 'object',
			properties: { step_id: { type: 'string' }, done_criteria: { type: 'string' }, reason: { type: 'string' } },
			required: ['step_id', 'done_criteria'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const plan = activePlanOf(state)
			if (plan === null) return fail('no_active_plan', '没有活动计划。')
			const step = plan.steps.find((item) => item.id === args.step_id)
			if (step === undefined) return fail('unknown_step', `没有这一步:${args.step_id}`)
			if (step.status !== 'open') return fail('step_settled', `步骤 ${step.id} 已落定(${step.status}),判据不再可改。`)
			const criteria = String(args.done_criteria ?? '').trim()
			if (criteria.length < 4) return fail('done_criteria_required', '判据不能为空。')
			const selfRef = SELF_REFERENCE.find(([pattern]) => pattern.test(criteria))
			if (selfRef !== undefined) return fail('criteria_self_reference', selfRef[1])
			mutations.push({ t: 'plan/refined', plan: plan.id, step: step.id, old_criteria: step.done_criteria, new_criteria: criteria, reason: args.reason ?? null })
			if (plan.blocked !== undefined) mutations.push({ t: 'block/cleared', plan: plan.id, step: plan.blocked.step })
			return done({ ok: true, code: 'plan_refined', progress_changed: false, message: `步骤 ${step.id} 的判据已精化(进度不变,旧判据留痕)。` })
		},
	})

	defineTool({
		name: 'VoidPlanStep',
		description: '带因作废一步:发现某步本不该存在就作废并说明缘由。作废留痕光明正大;为凑完成而造证是大忌。不动进度。',
		parameters: { type: 'object', properties: { step_id: { type: 'string' }, reason: { type: 'string' } }, required: ['step_id', 'reason'], additionalProperties: false },
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const plan = activePlanOf(state)
			if (plan === null) return fail('no_active_plan', '没有活动计划。')
			const step = plan.steps.find((item) => item.id === args.step_id)
			if (step === undefined) return fail('unknown_step', `没有这一步:${args.step_id}`)
			if (step.status === 'advanced') return fail('step_settled', `步骤 ${step.id} 已交付,不能作废(已交付的事实不会被撤销)。`)
			if (typeof args.reason !== 'string' || args.reason.trim() === '') return fail('reason_required', '作废必须带原因。')
			mutations.push({ t: 'plan/voided', plan: plan.id, step: step.id, reason: args.reason.trim() })
			if (plan.blocked?.step === step.id) mutations.push({ t: 'block/cleared', plan: plan.id, step: step.id })
			return done({ ok: true, code: 'step_voided', progress_changed: false, message: `步骤 ${step.id} 已作废(留痕,进度不变)。` })
		},
	})

	defineTool({
		name: 'ClosePlan',
		description: '收束当前阶段:把这一张计划归档。目标若未达成,系统会叫醒你开下一阶段。',
		parameters: { type: 'object', properties: { summary: { type: 'string', description: '收束之辞:这一阶段拿到了什么' } }, additionalProperties: false },
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const plan = activePlanOf(state)
			if (plan === null) return fail('no_active_plan', '没有活动计划。')
			const unsettled = plan.steps.filter((step) => step.status === 'open')
			if (unsettled.length > 0) {
				return fail('plan_has_open_steps', `还有 ${unsettled.length} 步没落定:${unsettled.map((step) => step.id).join(', ')}。交付它们,或带因作废(VoidPlanStep)。`)
			}
			mutations.push({ t: 'plan/closed', plan: plan.id, summary: args.summary ?? null })
			persistArchive(sessionId, plan, args.summary ?? null)
			return done({
				ok: true,
				code: 'plan_closed',
				message: `计划 ${plan.id} 已收束归档(clear/goals/plans/${plan.id}.md)。${state.goal === null || state.goal.status !== 'open' ? '' : `目标 ${state.goal.id} 仍未结案,继续开下一阶段。`}`,
			})
		},
	})

	/** 归档路径取实现事实 `clear/goals/plans/{plan_id}.md`。 */
	function persistArchive(sessionId, plan, summary) {
		const file = sessionFile(sessionId, 'clear', 'goals', 'plans', `${plan.id}.md`)
		if (file === null) return null
		const lines = [`# 阶段归档 · ${plan.id}`, '', `- 收束时间:${new Date().toISOString()}`, `- 所属目标:${plan.goal ?? '—'}`, summary === null ? '' : `- 收束之辞:${summary}`, '', '## 步骤']
		for (const step of plan.steps) {
			lines.push(`- [${step.status}] ${step.ordinal}. ${step.do} → ${step.artifacts.join(', ') || '(未声明)'}${step.voidReason === null ? '' : ` (作废:${step.voidReason})`}`)
		}
		try {
			writeTextFile(file, `${lines.join('\n')}\n`)
		} catch (error) {
			ctx.logger?.warn?.(`clearai kernel: 阶段归档失败 ${String(error?.message ?? error)}`)
		}
	}

	// ── AdvancePlan:唯一完成动词 ────────────────────────────────────────────

	defineTool({
		name: 'AdvancePlan',
		description:
			'交付一步(唯一完成动词):把观测交上来。系统先做观测准入——声明的产物存在、非空、结构合法;准入只看收不收,不做裁决。交付成立这一步就完成——它检验的判断被支持、被推翻还是说不清,**都算完成**,结果单独记成证据。L0–L2 由你给 basis(交付凭什么成立,必须能被复查)与 results(这一步检验的每条判断各一格);L3 以上两项都由系统派独立评估者判,你写 results 会被拒绝。没有物证,就还没有完成——没有手动标记这回事。',
		parameters: {
			type: 'object',
			properties: {
				step_id: { type: 'string', description: '交付哪一步(只能落在第一个未落定的步,这里是防手滑的确认,不是选择器)' },
				observations: {
					type: 'array',
					description: '观测:这一步拿到的原始结果(相对 workspace 的路径 + 一句说明)',
					items: { type: 'object', properties: { ref: { type: 'string' }, note: { type: 'string' } }, required: ['ref'], additionalProperties: false },
				},
				basis: { type: 'string', description: '交付凭什么成立:引用了哪个产物里的哪个事实(必须可复查)。仅 L0–L2 由你写' },
				results: {
					type: 'array',
					description: '仅 L0–L2:这一步检验的每条判断各一格,对照它的推翻条件读结果。support=没碰到推翻条件;refute=碰到了;inconclusive=这次观测区分不了。推翻和说不清都不妨碍这一步完成',
					items: {
						type: 'object',
						properties: {
							hypothesis: { type: 'string', description: '判断 id(也认原文)' },
							verdict: { type: 'string', enum: ['support', 'refute', 'inconclusive'] },
							basis: { type: 'string', description: '一句话:这次观测对照推翻条件读出了什么(不写就用上面那句 basis)' },
						},
						required: ['hypothesis', 'verdict'],
						additionalProperties: false,
					},
				},
			},
			required: ['step_id'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const cwd = sessionCwd(sessionId)
			const plan = activePlanOf(state)
			if (plan === null) return fail('no_active_plan', '没有活动计划。先 CreatePlan。')
			const step = firstOpenStep(plan)
			if (step === null) return fail('no_open_step', '这份计划没有未落定的步了:ClosePlan 收束它。')
			// 序位不变量:交付只能落在第一个未落定步
			if (args.step_id !== undefined && args.step_id !== '' && args.step_id !== step.id) {
				return fail('out_of_order', `交付只能落在第一个未落定步 ${step.id}(${step.do});你给的是 ${args.step_id}。RefinePlan/AmendPlan 不受此限。`)
			}
			// 计划已经如实停下等人:这时再交付不是「更努力」,
			// 而是绕过那道已经开着的门——先改计划或让人介入。
			if (plan.blocked !== undefined) {
				const blockedStep = plan.steps.find((item) => item.id === plan.blocked.step) ?? step
				const decision = await escalateBlocked(exec, plan, blockedStep, plan.blocked.attempts, plan.blocked.reason, mutations)
				return fail(
					'plan_blocked',
					`计划 ${plan.id} 已置 blocked(连续 ${plan.blocked.attempts} 次未过闸:${plan.blocked.reason})。${decision}`,
					mutations.length > 0 ? { mutations } : {},
				)
			}
			const level = step.tests?.level ?? null
			const levelIndex = levelIndexOf(level)

			// ① 登记观测(只追加)
			const accepted = []
			// 目录不可得时(digest / 字节数都无从算起)不在循环里拼路径:那是"这一刻读不到",
			// 不是"这份观测有问题"。观测照旧落账(它是模型报的),只是**读数缺失**如实为 null——
			// 让调用崩掉会把这一批 observation/recorded 一起丢进可撤销的栈帧,那才是真的损失。
			const readableCwd = typeof cwd === 'string' && cwd !== ''
			for (const observation of Array.isArray(args.observations) ? args.observations : []) {
				if (typeof observation?.ref !== 'string' || observation.ref.trim() === '') continue
				const ref = observation.ref.trim()
				let bytes = null
				let digest = null
				if (readableCwd) {
					const absolute = isAbsolute(ref) ? ref : resolvePath(cwd, ref)
					try {
						bytes = statSync(absolute).size
					} catch {
						bytes = null
					}
					digest = sha256File(absolute)
				}
				const materialId = `m-${Math.random().toString(36).slice(2, 8)}`
				mutations.push({ t: 'observation/recorded', id: materialId, ref, source: 'self', digest, bytes, note: observation.note ?? null, step: step.id })
				accepted.push({ id: materialId, ref })
			}

			// ② 准入
			const gate = admission(cwd, step)
			mutations.push({
				t: 'admission/checked',
				step: step.id,
				plan: plan.id,
				verified_by: gate.verified_by,
				missing: gate.missing,
				empty: gate.empty,
				structural: gate.structural,
				needs_audit: gate.needs_audit,
			})

			/**
			 * **连拦计数**:一条路,两个触发点——准入没过、拿不到裁决。
			 *
			 * 「拿不到裁决」原来不计数,于是评估者失联或提供方不可用时,模型可以一次次重新交付、
			 * 每次 fail-closed,而**永远不会升级给人**:同一语义动作反复做、不带来新事实,
			 * 正是这套失败哲学要停下来的那一种(每次恢复都要带来新东西)。计数之后,
			 * 它落到同一道已有的门(`plan/blocked` ⇒ 收件箱里那条等人处置的条目)。
			 */
			const countBlock = (kind, detail) => {
				const count = (state.blocks[`${plan.id}:${step.id}`] ?? 0) + 1
				mutations.push({ t: 'block/counted', plan: plan.id, step: step.id, count, reason: `${kind}:${detail}` })
				if (count >= CFG.blockedThreshold) mutations.push({ t: 'plan/blocked', plan: plan.id, step: step.id, attempts: count, reason: `${kind}:${detail}` })
				return count
			}

			// ③ 硬拦:连拦计数,达阈值 → 计划 blocked,等人
			if (!gate.ok && !gate.needs_audit) {
				const count = countBlock(gate.verified_by, gate.hint)
				// 触礁就收兵:无人值守这一档不能一边报阻塞、一边让系统继续叫醒自己。
				const stalledNote =
					count >= CFG.blockedThreshold
						? await escalateBlocked(exec, plan, step, count, `计划 ${plan.id} 第 ${count} 次未过准入(${gate.verified_by}:${gate.hint})`, mutations)
						: ''
				const preview = previewOf(hostService, sessionId, mutations)
				return fail(
					`evidence_${gate.verified_by}`,
					`未过观测准入(${gate.verified_by},第 ${count} 次):${gate.hint}${count >= CFG.blockedThreshold ? '\n已达阈值,计划置 blocked——停下等人,不要继续交付。' : ''}${stalledNote}\n\n${preview.card}`,
					{ gate: gate.verified_by, blocked: count >= CFG.blockedThreshold, mutations },
				)
			}

			/**
			 * **L4 人放行:由这次交付当场问**(在派评估者之前——人不放行就不必花那一次评估)。
			 * 放行是人的动作,问出来就落账;同一步第二次交付不再问。没人能答 ⇒ 不交付、原生 goal 停下等人。
			 */
			const releaseTarget = levelIndex === 4 && CFG.l4RequiresHumanRelease ? l4Delivery(state, 'AdvancePlan', args) : null
			let releasedHere = false
			if (releaseTarget !== null && !releaseTarget.released) {
				const asked = await askHuman(exec, {
					id: `release-${step.id}`,
					header: 'L4 要人放行',
					question: `步骤 ${step.id}(${clip(step.do, 60)})是 L4:新产生的、不可重复或来自外部的证据。放行这次交付吗?`,
					detail: `判据:${step.done_criteria}`,
					options: [
						{ label: RELEASE_YES, description: '交给独立评估者判。' },
						{ label: RELEASE_NO, description: '这次不交付,模型停下等你。' },
					],
				})
				if (asked.ok !== true || asked.choice !== RELEASE_YES) {
					const why = asked.ok !== true ? (asked.reason === 'cancelled' ? '人把问题撤下了' : '没有人能回答') : `人选了「${asked.choice ?? '没选'}」${asked.note === null ? '' : `:${asked.note}`}`
					return fail(
						'human_release_missing',
						`L4 的交付要人放行,这一次没有放行(${why})。等级是事实的属性,放行是人的动作——不能推断。${asked.ok === true ? '' : blockNativeGoal(exec.agent, BLOCK_CODES.needsHuman, `步骤 ${step.id} 是 L4,等人放行。`)}`,
						mutations.length > 0 ? { mutations } : {},
					)
				}
				mutations.push({ t: 'human/released', plan: plan.id, step: step.id, call: String(exec.callId ?? ''), via: 'ask', note: asked.note })
				releasedHere = true
			}

			// ④ 两项裁决:交付成立吗 / 每条判断的结果。谁可以写,由等级定
			const tested = testedBy(step)
			let evaluator
			let basis
			/** 每条被检验的判断一格:`{hypothesis, verdict, basis}`。不检验判断的步骤为空。 */
			let results = []
			/** 独立裁决的两件凭据(自判路径下保持 null):评估卡文件与写它的**评估者子会话**。 */
			let auditCardPath = null
			let auditSessionId = null
			/** 复用说明(模型与人都看得到的那一句);不复用时为空串。 */
			let reuseNote = ''
			if (levelIndex > SELF_JUDGE_MAX_INDEX) {
				if (Array.isArray(args.results) && args.results.length > 0) {
					return fail('verdict_not_accepted', `${level} 的两项裁决只能由机器或独立评估者写:做的人不判自己。去掉 results 重新交付,系统会派评估者。`)
				}
				const audit = await runEvaluator(sessionId, exec.agent, plan, step, gate, 'evidence_audit', exec.signal)
				mutations.push(...audit.mutations)
				if (audit.holds === 'pending') return fail('audit_pending', `独立评估者仍在跑:${audit.basis}。先观察当前事实,再谈重试——不要重复派遣。`, { mutations })
				if (audit.holds === 'unknown') {
					const count = countBlock('audit_unavailable', audit.basis)
					const stalled = count >= CFG.blockedThreshold
					const stalledNote = stalled ? await escalateBlocked(exec, plan, step, count, `计划 ${plan.id} 第 ${count} 次拿不到独立裁决`, mutations) : ''
					const preview = previewOf(hostService, sessionId, mutations)
					return fail(
						'evidence_audit_unavailable',
						`没有拿到独立裁决,这一步不推进(fail-closed):${audit.basis}` +
							(stalled ? `\n已达连拦阈值(${count} 次),计划置 blocked——停下等人,不要继续交付。` : `\n(这是第 ${count} 次;同一件事连续 ${CFG.blockedThreshold} 次拿不到裁决就置 blocked 等人。)`) +
							`${stalledNote}\n\n${preview.card}`,
						{ gate: 'audit_unavailable', blocked: stalled, mutations },
					)
				}
				/**
				 * **交付不成立 ⇒ 退回,步骤留在 open**。这是唯一让一步停在原地的裁决:
				 * 判据没满足、观测与记录对不上,或凭现有材料判不了交付成立没有。
				 * 判断被推翻**不在**这里——那是结果,不是交付失败。
				 */
				if (audit.holds !== 'yes') {
					const count = countBlock('delivery_not_holding', audit.basis)
					const stalled = count >= CFG.blockedThreshold
					const stalledNote = stalled ? await escalateBlocked(exec, plan, step, count, `计划 ${plan.id} 第 ${count} 次交付不成立`, mutations) : ''
					return fail(
						'delivery_not_holding',
						`独立评估者判这次交付${audit.holds === 'no' ? '**不成立**' : '**判不了成不成立**'},这一步不推进:${audit.basis}` +
							(audit.shortfalls.length > 0 ? `\n缺口(逐条):\n${audit.shortfalls.map((item) => `- ${verdictText([item])}`).join('\n')}` : '') +
							(audit.reused === true ? '\n(同一份材料,复用了上一条独立裁决;要拿到新判断先改材料。)' : '') +
							(stalled ? `\n已达连拦阈值(${count} 次),计划置 blocked——停下等人。` : '') +
							stalledNote,
						{ gate: 'delivery_not_holding', evaluator: 'independent', blocked: stalled, mutations },
					)
				}
				evaluator = 'independent'
				basis = audit.basis
				/** 评估者漏给的判断如实记「说不清」,并写明是漏给的——不替它猜。 */
				results = tested.map((id) => {
					const found = (audit.results ?? []).find((item) => item.hypothesis === id) ?? null
					return found === null ? { hypothesis: id, verdict: 'inconclusive', basis: '评估者没有给这条判断的结果' } : { hypothesis: id, verdict: found.verdict, basis: found.basis ?? null }
				})
				/** 两件凭据从**这一次**的审计结果里取(卡文件 + 评估者子会话);复用也照样带出来。 */
				auditCardPath = audit.cardPath ?? null
				auditSessionId = audit.mutations.find((mutation) => mutation.t === 'audit/dispatched')?.evaluator_session ?? audit.evaluatorSession ?? null
				if (audit.reused === true) {
					reuseNote = `\n**同一条材料**:这次**复用了上一条独立裁决**,没有重复请人。要拿到新判断先改材料——换产物内容、补观测,或用 RefinePlan 改这一步的判据。`
					basis = `${basis}\n[同一条材料:这次复用了上一条独立裁决,没有重复请人。]`
				}
			} else {
				if (typeof args.basis !== 'string' || args.basis.trim().length < 8) {
					return fail('basis_required', `${level ?? '未声明等级'} 的交付由你自己判:写清交付凭什么成立(basis)——引用了哪个产物里的哪个事实,必须能被复查。`)
				}
				const given = Array.isArray(args.results) ? args.results : []
				const byId = new Map()
				for (const item of given) {
					const found = matchHypothesis(state.hypotheses, item?.hypothesis)
					if (found === null || !tested.includes(found.id)) {
						return fail('result_not_tested', `「${String(item?.hypothesis ?? '')}」不是这一步检验的判断。这一步检验的是:${tested.length === 0 ? '(无——不检验判断的步骤不给 results)' : tested.join('、')}。`)
					}
					if (!['support', 'refute', 'inconclusive'].includes(String(item.verdict))) return fail('result_invalid', '每条结果的 verdict 只能是 support / refute / inconclusive。')
					byId.set(found.id, { hypothesis: found.id, verdict: item.verdict, basis: typeof item.basis === 'string' && item.basis.trim() !== '' ? item.basis.trim() : null })
				}
				const missing = tested.filter((id) => !byId.has(id))
				if (missing.length > 0) {
					return fail(
						'results_required',
						`这一步检验 ${tested.length} 条判断,还缺 ${missing.join('、')} 的结果。每条对照它的推翻条件读:support=没碰到推翻条件,refute=碰到了,inconclusive=这次观测区分不了——三种都算这一步完成。`,
					)
				}
				evaluator = 'self'
				basis = args.basis.trim()
				results = tested.map((id) => byId.get(id))
			}

			/** 交付失败时,已经落下的事实照样回去(事实不因后来的失败而消失)。 */
			const refuse = (code, message) => fail(code, message, mutations.length > 0 ? { mutations } : {})

			// ⑤ L4 来源分离:做的人自己写过的路径不算观测(自写路径来自日志,不是内存)
			if (levelIndex === 4 && CFG.l4RejectSelfWritten) {
				const written = new Set((state.written ?? []).map((path) => resolvePath(cwd, path)))
				const selfAuthored = gate.confirmed.filter((item) => written.has(resolvePath(cwd, item.ref)))
				if (selfAuthored.length > 0) {
					return refuse(
						'source_not_external',
						`L4 只认外部来源的观测(人上传、文件自动落盘、外部系统推送),做的人自己写的不算:${selfAuthored.map((item) => item.ref).join(', ')}。要么把等级改成 L3,要么换一份外部来源的观测。`,
					)
				}
			}

			// ⑦ 推进 + 每条判断各记一份证据(只增不改)
			/**
			 * **出处在这一刻定下来**:四类入口(产物 / 评估卡 / 评估者子会话 / 人放行)
			 * 全部解析成事实写进账里,界面只渲染、不猜。
			 */
			const originInfo = buildEvidenceOrigins({
				cwd,
				accepted,
				confirmed: gate.confirmed,
				cardPath: auditCardPath,
				evaluatorSession: auditSessionId,
				basis,
				approvalCall: releasedHere ? String(exec.callId ?? '') : '',
			})
			const evidenceIds = []
			for (const result of results) {
				const evidenceId = `e-${Math.random().toString(36).slice(2, 8)}`
				evidenceIds.push(evidenceId)
				mutations.push({
					t: 'evidence/recorded',
					id: evidenceId,
					step: step.id,
					plan: plan.id,
					/** 证据针对哪条判断:一个关键实验可以同时给几条判断各一份。 */
					hypothesis: result.hypothesis,
					verdict: result.verdict,
					level: level ?? 'L0',
					evaluator,
					basis: result.basis ?? basis,
					/** `refs` 一律是**路径**(旧写法把材料 id 混进来,界面按路径去开 ⇒ 什么也打不开)。 */
					refs: originInfo.paths,
					origins: originInfo.origins,
					anchor: evaluator === 'independent' ? 'auditor' : 'artifact',
					basis_reviewable: evaluator === 'independent' || /[/\\.]/.test(basis),
				})
			}
			/**
			 * **交付成立 ⇒ 这一步完成**,不论结果是支持、推翻还是说不清。
			 * 交付本身(谁判的、凭什么、出处)记在推进这条事实上;判断的状态由证据算。
			 */
			mutations.push({ t: 'step/advanced', plan: plan.id, step: step.id, evidence: evidenceIds, evaluator, basis, refs: originInfo.paths, origins: originInfo.origins })
			mutations.push({ t: 'block/cleared', plan: plan.id, step: step.id })
			const word = { support: '支持', refute: '推翻', inconclusive: '说不清' }
			const outcome = results.length === 0 ? '' : `\n结果:${results.map((item) => `${item.hypothesis} ${word[item.verdict]}`).join(';')}。`
			const refuted = results.some((item) => item.verdict === 'refute')
			const factReview = refuted
				? await reviewRefutedFacts(
						exec,
						sessionId,
						state,
						results.filter((item) => item.verdict === 'refute').map((item) => item.hypothesis),
						results.find((item) => item.verdict === 'refute')?.basis ?? basis,
						mutations,
					)
				: ''
			return done({
				ok: true,
				code: 'advanced',
				gate: gate.verified_by,
				evaluator,
				blocked: false,
				message:
					`步骤 ${step.id} 已交付并推进(${evaluator === 'independent' ? '独立评估者裁决' : '自判,依据已记账'})。观测准入:${gate.verified_by};坐标:${gate.confirmed.map((item) => item.ref).join(', ') || '(无)'}。` +
					outcome +
					(refuted ? '\n推翻是有价值的结果:它和支持一样记进证据,判断的状态由证据算。' : '') +
					factReview +
					reuseNote,
			})
		},
	})

	/**
	 * ═══ 当档(人在场 / 无人值守):人的事实,内核负责下发 ═══
	 *
	 * 为什么由内核算而不是面板自己算:`当档 = 人切的 ?? 组合里写的初值`,而初值只有内核
	 * 看得到(宿主平面拿不到预设配置)。**让知道的那一侧说**,与目录下发是同一条纪律。
	 *
	 * 为什么它必须进投影(而不是只写在卡里):面板要画一个开关,得有个机器可读的当值;
	 * 而且「人什么时候把档切成了什么」是可审计的事实,该和别的决定一样留在日志里。
	 */
	/**
	 * **本体形状**下发:面板那一格页眉要从**声明**生成,不能在界面里手抄一份
	 * (抄一份就会漂移——而漂移的界面比没有界面更坏)。所以把形状当事实发下去,
	 * 与目录/当档同一条纪律:**变了才发**;它一个会话只发一次(本体在进程内是常量)。
	 */
	const lastOntology = new Map()
	function publishOntology(sessionId) {
		if (CONTRIB.ontology === null || CONTRIB.ontology === undefined) return null
		const digest = CONTRIB.ontology.id
		if (lastOntology.get(sessionId) === digest) return null
		lastOntology.set(sessionId, digest)
		return {
			id: CONTRIB.ontology.id,
			objects: CONTRIB.ontology.objects.map((object) => ({
				name: object.name,
				states: object.states,
				initial: object.initial,
				terminal: object.terminal,
				/** `[from, to, actor, on]`:界面据此画流转图(走过的那条写清触发与凭据,未走的写明需要什么)。 */
				edges: object.transitions.map((edge) => [edge.from, edge.to, edge.actor, edge.on]),
				event_kind: object.event_kind,
			})),
			levels: CONTRIB.ontology.levels.map((level) => ({ id: level.id, judge: level.judge, gate: level.gate })),
		}
	}

	function pluginNotice(payload, note, factMutations = [], ontologyPayload = null) {
		const sections = [{ name: 'clearai', text: note }]
		// 与 `extraSections` 同一份形状:这条通道也可能**只**带本体(第一回合、状态还没立起来)。
		if (ontologyPayload !== null) sections.push({ name: 'clearai/ontology', text: JSON.stringify(ontologyPayload) })
		/**
		 * 内核在**回合之间**观察到的事实变更(例如评估者裁决收口)。
		 * 与工具结果里的 `meta.mutations` 同形,所以投影那一侧直接 `applyMutations` —— 一个折法。
		 */
		if (factMutations.length > 0) sections.push({ name: 'clearai/mutations', text: JSON.stringify({ mutations: factMutations }) })
		return {
			id: `clearai-notice-${payload.turn}-${payload.step}-${Date.now().toString(36)}`,
			role: 'user',
			content: text(note),
			source: { kind: MESSAGE_SOURCE_KIND, form: 'snapshot', sections },
		}
	}

	/**
	 * 人审查一条事实之后**在它自己那份文件上追加一行**(不改写、不删行)。
	 *
	 * 为什么在文件里而不是只留在账本:模型读的是 `clear/knowledge/facts/`,撤回过的若还
	 * 原样躺在那里,下一轮它会照旧引用一条已经作废的事实。行里带 fact id,所以即使多条事实
	 * 共用一个文件、追加落在最后,也读得出是哪一条被审过。
	 */
	function markFactReviewed(cwd, fact, review) {
		const goalId = typeof fact.goal === 'string' && fact.goal !== '' ? fact.goal : 'facts'
		const file = join(cwd, 'clear', 'knowledge', 'facts', `${goalId}.md`)
		const why = review.reason === null || review.reason === undefined || String(review.reason).trim() === '' ? '' : `,缘由:${String(review.reason).slice(0, 200)}`
		const line = review.retracted
			? `- **撤回记录**(\`${fact.id}\`):人审查后决定**撤回**${why} @ ${new Date().toISOString()}——记录保留,不再作为「已知」引用。\n`
			: `- **复核记录**(\`${fact.id}\`):有推翻证据,人判定证据不可靠,**维持原事实**${why} @ ${new Date().toISOString()}。\n`
		try {
			appendTextFile(file, line)
			return file
		} catch (error) {
			ctx.logger?.warn?.(`clearai kernel: 事实复核记录落盘失败 ${String(error?.message ?? error).slice(0, 160)}`)
			return null
		}
	}

	// ═══ 事实边界:保护「系统所有」的路径 + bash 危险闸门 + L4 人放行 ═══════

	const DENY_REASONS = [
		[
			'递归删除系统路径',
			(command) => {
				const match = /(^|[;&|]\s*)rm\s+([^;&|]*)/i.exec(command)
				if (match === null) return false
				const segment = match[2]
				if (!(/(^|\s)-[A-Za-z]*r/i.test(segment) || segment.includes('--recursive'))) return false
				for (const token of segment.split(/\s+/)) {
					if (token === '' || token.startsWith('-')) continue
					const bare = token.replace(/^["']|["']$/g, '')
					if (bare === '/' || bare === '~' || bare.startsWith('~/') || /^\/[^/]+$/.test(bare)) return true
				}
				return false
			},
		],
		['fork 炸弹', (command) => /:\s*\(\s*\)\s*\{/.test(command)],
		['磁盘破坏', (command) => /(^|[;&|]\s*)mkfs|\bdd\b[^;&|]*of=\/dev\/|>\s*\/dev\/sd[a-z]/.test(command)],
		['提权', (command) => /(^|[;&|]\s*)sudo\s/.test(command)],
		['远程脚本直灌 shell', (command) => /(curl|wget)\b[^;&|]*\|\s*(sudo\s+)?(ba|z|d|k)?sh\b/.test(command)],
		['把根目录改成全局可写', (command) => /chmod\s+(-R\s+)?777\s+\/(\s|$)/.test(command)],
		['掩盖真实退出码', (command) => /;\s*echo\s+\$\?/.test(command)],
		[
			'非可信来源装包',
			(command) => {
				if (!/(^|[;&|]\s*)(pip3?|uv)\s+(pip\s+)?install\b/.test(command)) return false
				if (/(git\+|github:|\.git(\s|$))/.test(command)) return true
				const urls = command.match(/https?:\/\/[^\s"']+/g) ?? []
				const trusted = ['pypi.org', 'files.pythonhosted.org', 'pypi.tuna.tsinghua.edu.cn', 'mirrors.tuna.tsinghua.edu.cn', 'mirrors.aliyun.com', 'download.pytorch.org']
				return urls.some((url) => !trusted.some((host) => url.includes(host)))
			},
		],
		['拉起宿主应用', (command) => /\.app\/Contents\/MacOS\/|\bopen\s+-a\b/.test(command)],
	]

	function protectedRoots(sessionId) {
		const cwd = sessionCwd(sessionId)
		/**
		 * 系统所有的四格:`evidence` / `facts` / `goals`,加上 `ontology`(词汇货架)。
		 * 为什么词汇也在此列:货架是**渲染**,词条的权威在账本事件里——
		 * 谁直接改那份 markdown,谁就制造了一份谁也不认的词汇表(面板读的是折法)。
		 */
		return [join(cwd, 'clear', 'evidence'), join(cwd, 'clear', 'knowledge', 'facts'), join(cwd, 'clear', 'goals'), join(cwd, 'clear', 'ontology')]
	}

	function touchesProtected(sessionId, value) {
		if (typeof value !== 'string' || value === '') return null
		for (const root of protectedRoots(sessionId)) {
			if (value.includes(root)) return root
		}
		return null
	}

	/**
	 * L4 的那道门挂在**步骤的等级**上:交付 L4 步骤之前要有人放行。
	 *
	 * 返回 `null` = 这次调用不是 L4 交付(不是 L4 就什么都不做,不打扰)。
	 */
	function l4Delivery(state, toolName, args) {
		const plan = activePlanOf(state)
		const step = plan === null ? null : firstOpenStep(plan)
		if (plan === null || step === null) return null
		if (toolName === 'AdvancePlan') {
			if (levelIndexOf(step.tests?.level) !== 4) return null
			return {
				kind: 'step',
				plan,
				step,
				level: step.tests?.level ?? null,
				doneCriteria: step.done_criteria,
				// 同一步第二次交付不再问第二遍。
				released: (state.releases ?? []).some((item) => item.step === step.id),
			}
		}
		return null
	}


	ctx.on('tools/pre-execute', async (exec, next) => {
		if (exec.agent !== undefined) {
			const sessionId = String(exec.agent.id)
			const hostService = host()
			const state = hostService === undefined ? null : hostService.state(sessionId)
			const owned = state !== null && hasState(state)
			const rawArgs = exec.arguments ?? {}
			let args = rawArgs
			if (typeof rawArgs === 'string') {
				try {
					args = JSON.parse(rawArgs)
				} catch {
					args = {}
				}
			}
			/**
			 * **完成要过独立评估**:立过约的会话里,模型不能用原生工具直接把目标置为完成——
			 * 那条路绕开了结案评估与升格。人用 `/goal` 或界面结束目标不经这里(那是人的权力,
			 * 但不算任何判断已确立)。没立约的会话不拦:那时目标不是 ClearAI 的。
			 */
			if (exec.name === 'update_goal' && String(args?.action ?? '') === 'complete' && state?.goal !== null && state?.goal !== undefined && state.goal.status === 'open') {
				const native = nativeGoal(exec.agent)
				return {
					kind: 'deny',
					reason: `目标的完成要先过独立评估:用 Conclude(outcome="achieved") 结案——评估者核对判据通过后,系统会把原生 goal 置为完成并升格事实。${native === null ? '' : `(当前原生 goal:${native.id})`}要放弃就用 Conclude(outcome="abandoned")。`,
				}
			}
			{
				// 「评估卡与事实只能由系统写」:做的人写不进证据面
				const suspect = touchesProtected(sessionId, args.file_path) ?? touchesProtected(sessionId, args.path) ?? (exec.name === 'bash' ? touchesProtected(sessionId, args.command) : null)
				if (suspect !== null) {
					return { kind: 'deny', reason: `clear/evidence、clear/knowledge/facts、clear/goals、clear/ontology 由系统所有,做的人不能写:${suspect}。事实、评估卡与词汇货架只能由系统落盘(词汇要改就调注册/修订/废止动词)。` }
				}
			}
			if (CFG.bashDenyRules && exec.name === 'bash' && typeof args.command === 'string') {
				for (const [reason, test] of DENY_REASONS) {
					if (test(args.command)) return { kind: 'deny', reason: `dangerous bash command (${reason}); rewrite the command to avoid this pattern` }
				}
			}
		}
		return next()
	})

	// ═══ 每回合派生的运行态卡 ═══════════════════════════════════════════════

	const lastCard = new Map()
	/**
	 * **判据全文只在修订后注入一次**(每个会话记最后一次发过的修订号)。
	 *
	 * 卡里给的是压缩版 + `clear/goals/{goalId}.md` 指针;但刚改完判据的那一拍,
	 * 模型必须**逐字看到**新判据——否则它会照着旧判据干活,而账上已经换了尺子。
	 * 所以修订后的第一张卡补一段全文,之后各拍只留压缩版。
	 */
	const lastCriteriaSent = new Map()
	/** 已经落过账的宿主降级观测(按内容寻址 id);重启后重建一次,折法那侧幂等。 */
	const landedHostHealth = new Set()

	ctx.on('agent/pre-step', async (payload, next) => {
		const decision = await next()
		if (decision === null || decision === undefined || decision.kind !== 'enter') return decision
		const hostService = host()
		if (hostService === undefined) return decision
		const sessionId = String(payload.agent.id)
		/** 这一步进来的消息:`goal` = 原生 goal 驱动叫醒的续跑回合(那一回合卡片照发,不去重)。 */
		const entering = Array.isArray(payload.messages) ? payload.messages : []
		const autoRound = entering.find((message) => message?.source?.kind === 'goal') ?? null

		/**
		 * 本体货架:每个会话铺一次;第一拍在卡里指一下它(只说一次——它是**常驻事实**,
		 * 每拍重复就是往上下文里灌水)。模型据此知道「这套系统认哪些对象、每级谁来判」,
		 * 于是写判据与交付时对得上本体。
		 */
		let ontologyNote = ''
		if (CONTRIB.ontology !== null && CONTRIB.ontology !== undefined && !ontologyShelved.has(sessionId)) {
			const shelf = ensureOntologyShelf(sessionCwd(sessionId))
			ontologyShelved.add(sessionId)
			if (shelf !== null) ontologyNote = `\n- 本体已就位(${CONTRIB.ontology.objects.length} 个对象 · ${CONTRIB.ontology.levels.length} 级):${join('clear', 'ontology', `${CONTRIB.ontology.id}.md`)}——交付前对照它(哪些状态合法、每一级谁来判)。`
		}
		/**
		 * **领域词汇货架**每一拍都重铺一次(幂等:内容没变就不重写)。
		 *
		 * 为什么不像过程本体那样只铺一次:那一份随**发布版本**,这一份随**会话**——
		 * 一个项目今天没用词汇、明天开始用,货架必须自己长出来,而不是等人记得去建。
		 * 它也不进卡:货架的位置在提示词里说一次就够,每拍重复就是往上下文里灌水。
		 * 所有权判据(子会话不写)在写入口——见 `ensureDomainShelf`。
		 */
		ensureDomainShelf(host(), sessionId)
		let turnNote = ''
		/** 事实货架那句话说一次就够(事实很少变)。 */
		let factsNote = ''

		/**
		 * 本体声明是**会话级事实**:会话级事实,第一回合就该到,所以在这里发。
		 *
		 * 为什么不能留在函数末尾:它下面是两条**早起返回**(无卡档 / 无状态档),而它们正是
		 * 「立约之前」那条路唯一的出口。留在末尾,这份声明就只能在会话**已经有状态**之后才到;
		 * 而卡里那句「本体已就位」只说得了一次(说过就记进 `ontologyShelved`,早起返回又不带它)
		 * ⇒ 模型永远读不到货架在哪,面板也要等到立约之后才画得出本体页眉。
		 */
		const ontologyPayload = publishOntology(sessionId)

		let factMutations = []
		/**
		 * **宿主读面降级:把观测落成账本事实**(`host/inactive`)。
		 *
		 * 宿主半取不到 `sessions` / `sessionProjections` 时会在**进程内**记一条观测,随 `state()`/`view()`
		 * 暴露出来——那是"看得见",但**不在账本上**:重启、换进程、离线复判都读不到它,
		 * 而"这一刻读不到投影"恰恰是最需要能事后解释的一条事实。
		 *
		 * 谁合适写:变更记录只能由内核与宿主人门通道产生(权威边界),所以**内核来写**——
		 * 它在每个 pre-step 读到宿主的观测,把还没上账的那几条落成变更。
		 * id 用宿主给的**内容寻址 id**,折法按 id 幂等 ⇒ 反复观察到同一条也只落一条;
		 * 进程重启后内核会重新观察一次(那时账上已经有一条同 id,折法照样幂等)。
		 */
		try {
			const observed = hostService.state(sessionId)?.hostHealth
			for (const entry of Array.isArray(observed) ? observed : []) {
				const id = entry?.id
				if (typeof id !== 'string' || id === '') continue
				if (landedHostHealth.has(id)) continue
				landedHostHealth.add(id)
				factMutations.push({ t: 'host/inactive', id, scope: entry.scope ?? null, detail: entry.detail ?? null })
			}
		} catch {
			// 读不到就不落:这条机制本身不允许成为新的故障点。
		}
		/**
		 * **目标文档**(`clear/goals/{goalId}.md`):判据全文的家。
		 *
		 * 卡里现在只给压缩版判据 + 一个指针(见 `knowledge-view.js` 的目标那一段),
		 * 所以这份文件必须真的在盘上——否则"卡瘦了"就变成"判据找不着了"。
		 * 幂等:内容没变就不重写。
		 */
		try {
			ensureGoalDoc(sessionId, hostService.state(sessionId), hostService.derive(sessionId))
		} catch {
			// 写不出来不影响这一拍:卡里的指针会指向一个还不存在的文件,下拍再试。
		}
		/**
		 * **独立落账通道的兜底**:上一步在 `await` 之前落下的派发/派遣事实,如果没赶上
		 * 那一次工具结果(工具抛错、被 abort、或结果丢失),在这里补折一次。
		 * 放在 `factMutations` 初始化之后、别的事实之前——它是**已经发生**的事,
		 * 语义上早于这一拍新收上来的结论。
		 */
		factMutations.push(...drainPendingFacts(sessionId))
		/**
		 * 失联的评估者:重启之后 `pendingAudits` 空了,而投影里那条裁决还停在「在跑」——
		 * 它会把目标按在 hold 上。这里问一次宿主的子代理目录,把「它已经不在跑」如实落成一条事实。
		 */
		try {
			const audits = await sweepEndedAudits(sessionId, hostService.state(sessionId))
			if (audits.mutations.length > 0) {
				factMutations.push(...audits.mutations)
				turnNote = `${turnNote}\n(有 ${audits.settled} 条此前在等的独立裁决已收口:结论从子会话日志取回,或如实记为 unknown。)`
			}
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 已结束裁决盘点失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}
		try {
			/**
			 * **事实货架**:事实变了才重写、才在卡里提一句——**变了才发**,与目录同一条纪律。
			 * 事实很少变(升格一次),所以这句话在大多数回合里都不出现。
			 * 所有权判据(子会话不写)在写入口——见 `ensureFactsShelf`。
			 */
			const shelf = ensureFactsShelf(sessionId, hostService.state(sessionId))
			if (shelf !== null) factsNote = `\n- 事实库多了一条(或边界改了):${shelf}——引用前先看它的边界(推翻条件)。`
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 事实货架重写失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}

		/**
		 * 无卡通道的注记 = 卡里那几句(工作区、本体、事实货架)。
		 * 这条通道正是「还没有状态」那一回合唯一的出口,而本体货架那句话**只说一次**
		 * (说完就记进 `ontologyShelved`)——不带它,这一回合就是把那句话永久丢掉。
		 */
		const noticeNote = `${turnNote}${ontologyNote}`
		if (!CFG.runtimeCard) {
			if (noticeNote === '' && ontologyPayload === null && factMutations.length === 0) return decision
			return { kind: 'enter', messages: [...decision.messages, pluginNotice(payload, noticeNote, factMutations, ontologyPayload)] }
		}
		let card
		try {
			const state = hostService.state(sessionId)
			if (!hasState(state)) {
				if (noticeNote === '' && ontologyPayload === null && factMutations.length === 0) return decision
				return { kind: 'enter', messages: [...decision.messages, pluginNotice(payload, noticeNote, factMutations, ontologyPayload)] }
			}
			card = hostService.renderCard(sessionId)
		} catch (error) {
			return decision
		}
		/**
		 * 判据全文的一次性注入(见 `lastCriteriaSent` 的注释):只在修订号变过时补,
		 * 补完记住修订号。它走的是同一条卡通道,不另开消息。
		 */
		try {
			const cardState = hostService.state(sessionId)
			const cardGoal = cardState?.goal ?? null
			if (cardGoal !== null && String(cardGoal.status) === 'open' && lastCriteriaSent.get(sessionId) !== cardGoal.revision) {
				lastCriteriaSent.set(sessionId, cardGoal.revision)
				const full = Array.isArray(cardGoal.criteria) && cardGoal.criteria.length > 0 ? cardGoal.criteria.map((item, index) => `  ${index + 1}. ${item}`).join('\n') : `  ${String(cardGoal.done_criteria ?? '')}`
				card = `${card}\n\n- **判据全文(rev${cardGoal.revision},只在修订后发这一次)**:\n${full}`
			}
		} catch {
			// 读不到状态就不补:卡里仍有压缩版与指针。
		}
		if (turnNote !== '') card = `${card}\n${turnNote}`
		if (ontologyNote !== '') card = `${card}${ontologyNote}`
		if (factsNote !== '') card = `${card}${factsNote}`
		// 卡之外的事实走**结构化 section**(不是卡里的散文):fold 从会话日志里把它折进投影,
		// 于是它们都是**可重放的事实**,不是一句说明。
		const extraSections = [
			...(ontologyPayload === null ? [] : [{ name: 'clearai/ontology', text: JSON.stringify(ontologyPayload) }]),
			...(factMutations.length === 0 ? [] : [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: factMutations }) }]),
		]
		// 自动续跑回合永远注入(那是这一回合的全部由来);其余回合只在状态变化时注入。
		if (autoRound === null && lastCard.get(sessionId) === card) {
			// 卡片没变,但**事实变了**(状态一动没动):
			// 只发事实、不重发卡片——重发卡片是往会话里塞一段没变的长文(白花 token,还多一条噪音)。
			if (extraSections.length === 0 && ontologyPayload === null && factMutations.length === 0) return decision
			return { kind: 'enter', messages: [...decision.messages, pluginNotice(payload, noticeNote, factMutations, ontologyPayload)] }
		}
		lastCard.set(sessionId, card)
		return {
			kind: 'enter',
			messages: [
				...decision.messages,
				{
					id: `clearai-card-${payload.turn}-${payload.step}-${Date.now().toString(36)}`,
					role: 'user',
					content: text(card),
					source: {
						kind: MESSAGE_SOURCE_KIND,
						form: 'snapshot',
						sections: [{ name: 'clearai', text: card }, ...extraSections],
					},
				},
			],
		}
	})

	// ═══ 装配:贡献表驱动 ═══════════════════════════════════════════════════
	//
	// 装配语义:装配根遍历清单,清单里出现表外的名字
	// (未知工具 / 未知段 / 未知机制 / 已关机制的残留工具)当场抛错——**装配期炸**,
	// 而不是运行到某一轮才发现少装了一件工具。清单缺省 = 全开;要裁剪只改清单。

	for (const toolName of CONTRIB.tools) {
		const definition = TOOL_DEFS.get(toolName)
		// 每一个工具的输出都过一遍统一出口:独立落账通道里的事实不会因为工具抛错/被 abort 而丢。
		ctx.tools.register({ ...definition, execute: async (args, exec) => withPendingFacts(exec, await definition.execute(args, exec)) })
	}

	// 提示词段由当前 ClearAI DSH 预设提供，围绕认识论循环与事实边界组织。
	// 当前 preset 与内核实现共同构成有效契约。
	for (const sectionName of SECTION_LIST) {
		const section = SECTION_TABLE.get(sectionName)
		ctx.effect(
			() => ctx.systemPrompt.section({ name: section.name, order: section.order, text: section.text }),
			`clearai:section:${section.name}`,
		)
	}

	ctx.logger?.info?.(
		`clearai kernel: ${CONTRIB.tools.length} 件意图工具、${CONTRIB.sections.length} 段已装配` +
			`(机制 ${Object.entries(CONTRIB.mechanisms)
				.filter(([, on]) => on)
				.map(([key]) => key)
				.join('/')});状态由宿主投影持有`,
	)
}
