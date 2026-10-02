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

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'

import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { SECTION_TABLE } from './prompts.js'
import { VERIFICATION_LOOP, describeOntology, validateOntology } from './ontology.js'

export const name = 'clearai-kernel'
/** 宿主注册表 + `clearai` 读面(宿主包提供;缺了会在工具里明确报错,而不是静默不工作)。 */
export const inject = ['tools', 'systemPrompt']

// ── 常量:全部来自 ClearAI 的代码事实 ───────────────────────────────────────

const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4']
/** 判断短名的上限(字);没起名时取主张开头这么多字。 */
const HANDLE_LIMIT = 12
/**
 * **结果的人话**。账本里记 `support / refute / inconclusive`(内部名不改);
 * 模型写结果时三种人话也认,工具结果与卡只写人话——模型读到什么就会照着说什么。
 */
const VERDICT_WORD = { support: '支持', refute: '推翻', inconclusive: '不确定' }
const VERDICT_ALIAS = { 支持: 'support', 推翻: 'refute', 不确定: 'inconclusive', 说不清: 'inconclusive', 判不了: 'inconclusive' }
const canonicalVerdict = (value) => {
	const raw = String(value ?? '').trim()
	if (['support', 'refute', 'inconclusive'].includes(raw.toLowerCase())) return raw.toLowerCase()
	return VERDICT_ALIAS[raw] ?? null
}
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
	'requireCriteriaVerdict',
	'requireLandedEntities',
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
	plan: ['CreatePlan', 'AdvancePlan', 'RevisePlan', 'ClosePlan'],
	/**
	 * 领域本体没有工具:模型用原生文件工具直接写 `clear/ontology/{concepts,relations,entities}/**.json`,
	 * 写入时由 `tools/pre-execute` 查单个文件,读取时折法从文件折出图(见 `syncWorkspace`)。
	 * 从前的 Define / Deprecate / RegisterInstance / Assert 四件随之删除。
	 */
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
		/** 判据修订门:改「怎样算完成」要带一份独立裁决的 auditKey(机制缺省关,preset 里开)。 */
		requireCriteriaVerdict: config.requireCriteriaVerdict === true,
		/**
		 * **实体门**(结案唯一的结构关口;机制缺省关,preset 里开):将要升格的判断里,
		 * 断言主体还不是实体图节点 ⇒ 结案被拒。它挡的是「本体写得漂亮、实体图是空的」。
		 * 出口两条:给主体写实体文件(`clear/ontology/entities/<id>.json`),或把断言从判断上拿掉 / 如实 abandoned。
		 */
		requireLandedEntities: config.requireLandedEntities === true,
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
		/** 短名(第六阶段):模型自己起的那个名字,人和模型都用它说话。 */
		const byName = hypotheses.filter((hypothesis) => typeof hypothesis.name === 'string' && hypothesis.name !== '' && normalize(hypothesis.name) === wantedNormalized)
		if (byName.length === 1) return byName[0]
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

	/** 对不上时**列出全部有效选项**(短名最顺手):让模型能照抄,而不是继续猜。 */
	function hypothesisMenu(hypotheses) {
		if (hypotheses.length === 0) return '当前目标没有登记任何判断:先用 Frame 登记(每条一个短名、一句话主张、一句推翻条件)。'
		return `已登记的判断(填短名即可,也认主张原文):${hypotheses.map((hypothesis) => `「${handleOf(hypothesis)}」${String(hypothesis.claim).slice(0, 40)}`).join(';')}`
	}

	/**
	 * **判断的短名**:人和模型说起一条判断时用的名字。模型立判断时自己起;
	 * 旧账本或没起名的,取主张开头。账本里的 id 只给机器对账,不上卡、不进工具结果。
	 */
	function handleOf(hypothesis) {
		const name = typeof hypothesis?.name === 'string' ? hypothesis.name.trim() : ''
		if (name !== '') return name
		const claim = String(hypothesis?.claim ?? '').replace(/\s+/g, ' ').trim()
		return claim.length <= HANDLE_LIMIT ? claim : `${claim.slice(0, HANDLE_LIMIT)}…`
	}

	/** 按 id 找回一条判断的短名(找不到就如实说「一条已不在账上的判断」)。 */
	function handleById(state, id) {
		const found = (state?.hypotheses ?? []).find((hypothesis) => hypothesis.id === id)
		return found === undefined ? '一条已不在账上的判断' : handleOf(found)
	}

	/** 拒绝类结果的卡尾:与收尾同一条「卡没变就不附」。 */
	function cardTail(sessionId, preview) {
		const card = preview?.card ?? null
		if (card === null || lastCard.get(sessionId) === card) return ''
		lastCard.set(sessionId, card)
		return `\n\n${card}`
	}

	/** 一次工具调用的收尾:预演变更 → 卡片 → 返回值。 */
	function finish(hostService, sessionId, mutations) {
		return (value) => {
			const preview = previewOf(hostService, sessionId, mutations)
			const card = preview?.card ?? null
			/**
			 * **卡没变就不附**(第六阶段):回合开头与工具返回共用「上次发过的那张」。
			 * 同一张卡在一轮里重发几遍,只是把同样的话塞给模型几遍——它读得越多,照抄得越多。
			 */
			const fresh = card !== null && lastCard.get(sessionId) !== card
			if (fresh) lastCard.set(sessionId, card)
			const result = {
				...value,
				mutations,
				card,
				message: fresh ? `${value.message ?? value.code ?? 'ok'}\n\n${card}` : `${value.message ?? value.code ?? 'ok'}${card === null ? '' : '\n(状态卡与上次相同,不再重发。)'}`,
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
			result.hint = `声明的产物没落盘:${result.missing.join(', ')}。三条合法出路:①把产物做出来;②改声明(RevisePlan refine 改判据、add 补一步换产物);③带因作废(RevisePlan void)。`
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
			// ClearAI 的存量兼容出口。本内核在 CreatePlan/RevisePlan 就强制判据,所以这条路径不可达
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
	function open(exec, options = {}) {
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
		/**
		 * **按需同步工作区**(`options.sync`,Frame 与 Conclude 用):模型可能刚在同一拍里写完
		 * 实体或概念文件就立约 / 结案,等下一拍的 pre-step 才同步就晚了。这里先把变化落成一条
		 * `workspace/synced` 放进这次调用的变更里,并按「同步之后」的样子交出状态与派生。
		 */
		if (options.sync === true) {
			const base = hostService.state(sessionId)
			let synced = null
			try {
				synced = syncWorkspace(sessionId, base)
			} catch (error) {
				ctx.logger?.warn?.(`clearai: 工作区同步失败 ${String(error?.message ?? error).slice(0, 160)}`)
			}
			if (synced !== null) {
				const preview = previewOf(hostService, sessionId, [synced])
				if (preview !== null) return { ok: true, hostService, sessionId, state: preview.state, derived: preview.derived ?? null, mutations: [synced], done: null }
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
			return `\n已问人怎么办,但${why}:计划保持 blocked,停下等人。人回答之前,你自己能动的只有计划本身:RevisePlan 改判据(refine)、补一步换做法(add)、带原因作废(void)。${blockNativeGoal(exec.agent, BLOCK_CODES.needsHuman, `步骤 ${step.id} 连续 ${attempts} 次没过,等人决定:按缺口再改,还是作废这一步。`)}`
		}
		const said = asked.note === null ? '' : `,人说:「${asked.note}」`
		if (asked.choice === STALL_VOID) {
			mutations.push({ t: 'plan/voided', plan: plan.id, step: step.id, reason: `人决定作废:连续 ${attempts} 次没过${asked.note === null ? '' : `(${asked.note})`}` })
			mutations.push({ t: 'block/cleared', plan: plan.id, step: step.id })
			return `\n人决定**作废这一步**${said}。已带原因作废,记录保留;接着做下一步。`
		}
		mutations.push({ t: 'block/cleared', plan: plan.id, step: step.id })
		return `\n人让你**按缺口再改**${said}。改判据(RevisePlan refine)或换做法后再交付。`
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

	// ═══ 工作区同步:攒下来的事实与本体住在文件里,每一拍把变化折进账本 ═══════════════
	//
	// 投影只吃账本;而跨会话活着的东西(`clear/knowledge/facts/*.json`、`clear/ontology/**.json`)
	// 住在项目文件里,谁都可能改(别的会话、模型用原生文件工具、人手改)。所以每一拍扫一次这两处,
	// 把**变了的**文件连内容一起落成一条 `workspace/synced` 变更——文件内容由此成为可重放的事实。
	// 读盘按 (mtime, size) 记进程内缓存:没变的文件不重读、不重算摘要。

	const FACTS_REL = ['clear', 'knowledge', 'facts']
	const ONTOLOGY_REL = ['clear', 'ontology']
	const ONTOLOGY_BRANCH_DIRS = ['concepts', 'relations', 'entities']
	/** 读面有界(与 `domain-language.js` 的 `WORKSPACE_LIMITS` 同值):超出的如实报成读不成,不静默截断。 */
	const WORKSPACE_MAX_FILES = 2000
	const WORKSPACE_MAX_BYTES = 65536
	const workspaceReads = new Map()

	/** 工作区里归投影管的 JSON 文件(相对路径,正斜杠)。 */
	function listWorkspaceFiles(cwd) {
		const out = []
		const walk = (relParts, recursive) => {
			let entries
			try {
				entries = readdirSync(join(cwd, ...relParts), { withFileTypes: true })
			} catch {
				return
			}
			entries.sort((a, b) => a.name.localeCompare(b.name))
			for (const entry of entries) {
				if (out.length >= WORKSPACE_MAX_FILES) return
				if (entry.name.startsWith('.')) continue
				if (entry.isDirectory()) {
					if (recursive) walk([...relParts, entry.name], true)
				} else if (entry.isFile() && entry.name.endsWith('.json')) out.push([...relParts, entry.name].join('/'))
			}
		}
		walk(FACTS_REL, false)
		for (const branch of ONTOLOGY_BRANCH_DIRS) walk([...ONTOLOGY_REL, branch], true)
		return out
	}

	/** 读一个工作区文件 → `{ path, digest, data }` 或 `{ path, digest, error }`。 */
	function readWorkspaceFile(cwd, path) {
		const file = join(cwd, ...path.split('/'))
		let stat
		try {
			stat = statSync(file)
		} catch {
			return null
		}
		const cached = workspaceReads.get(file)
		if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.change
		let change
		if (stat.size > WORKSPACE_MAX_BYTES) change = { path, digest: `size:${stat.size}:${stat.mtimeMs}`, error: `文件太大(${stat.size} 字节,上限 ${WORKSPACE_MAX_BYTES})` }
		else {
			const raw = readFileSync(file, 'utf8')
			const digest = createHash('sha1').update(raw).digest('hex').slice(0, 16)
			try {
				change = { path, digest, data: JSON.parse(raw) }
			} catch (error) {
				change = { path, digest, error: `不是合法 JSON:${String(error?.message ?? error).slice(0, 160)}` }
			}
		}
		workspaceReads.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, change })
		return change
	}

	/**
	 * 这一拍工作区相对账本的变化 → 一条 `workspace/synced` 变更;没变返回 null。
	 * 子会话(评估者)不同步:它们不读这份投影,同步只会往它们的账里塞无关的东西。
	 */
	function syncWorkspace(sessionId, state) {
		if (isSpawnedChild(sessionId)) return null
		const cwd = sessionCwd(sessionId)
		if (cwd === null) return null
		const known = state?.workspace?.files ?? {}
		const changes = []
		const seen = new Set()
		for (const path of listWorkspaceFiles(cwd)) {
			seen.add(path)
			const change = readWorkspaceFile(cwd, path)
			if (change === null) continue
			if (known[path]?.digest !== change.digest) changes.push(change)
		}
		for (const path of Object.keys(known)) if (!seen.has(path)) changes.push({ path, removed: true })
		if (changes.length === 0) return null
		const id = `ws-${createHash('sha1').update(JSON.stringify(changes.map((change) => [change.path, change.digest ?? 'removed']))).digest('hex').slice(0, 12)}`
		return { t: 'workspace/synced', id, changes }
	}

	/** 写货架;内容没变就返回 null(调用方据此决定要不要在卡里提一句)。 */
	function ensureFactsShelf(sessionId, state, mutations = []) {
		/**
		 * 所有权判据在写入口:子会话的投影里
		 * 没有主线的事实,让它铺只会按它自己那份重写 `INDEX.md`。
		 */
		if (isSpawnedChild(sessionId)) return null
		/**
		 * 货架要显示「被推翻」那个读数,而它是**派生的**(fold 的 derive),不在原始状态里。
		 * 所以这里问一次读面,而不是在货架里重算一遍(重算 = 第二份判据,必然漂)。
		 */
		/** 带上这一拍刚同步进来的文件:别的会话刚升格的事实这一拍就进货架。 */
		const rows = (mutations.length > 0 ? host()?.preview?.(sessionId, mutations)?.derived?.factRows : undefined) ?? host()?.derive?.(sessionId)?.factRows
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
			/** 状态由证据算:读派生的那份(`state` 里只有立约时的 proposed,文件会一直停在「全部待检验」)。 */
			const hypotheses = Array.isArray(derived?.hypotheses) ? derived.hypotheses : Array.isArray(state?.hypotheses) ? state.hypotheses : []
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

	/**
	 * **本体文件树的地基**:`clear/ontology/SCHEMA.json`(字段定义,只读)与三支目录。
	 *
	 * 本体由模型用原生文件工具直接写;它要知道往哪写、每种文件有哪些字段。字段定义与写入时的
	 * 校验是同一份(宿主半的 `domain.schema` / `domain.checkFile`),所以这里只把它铺出来。
	 * 幂等:内容没变就不重写。子会话(评估者)不铺:它们只读。
	 */
	function ensureOntologySchema(hostService, sessionId) {
		if (isSpawnedChild(sessionId) || typeof hostService?.domain?.schema !== 'function') return null
		const cwd = sessionCwd(sessionId)
		if (cwd === null) return null
		try {
			for (const branch of ONTOLOGY_BRANCH_DIRS) mkdirSync(join(cwd, ...ONTOLOGY_REL, branch), { recursive: true })
			const file = join(cwd, ...ONTOLOGY_REL, 'SCHEMA.json')
			const body = `${JSON.stringify(hostService.domain.schema(), null, 2)}\n`
			if (existsSync(file) && readFileSync(file, 'utf8') === body) return null
			writeTextFile(file, body)
			return file
		} catch (error) {
			ctx.logger?.warn?.(`clearai ontology: 字段定义写入失败 ${String(error?.message ?? error).slice(0, 160)}`)
			return null
		}
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
						'候选假设:每条一句话主张 + 一句推翻条件;可带**类型化断言**(可选,提供即严校:谓词与概念必须已登记、宾语形态要合值域、同一事实里不许自相矛盾)。不写断言照旧成立——断言是加法,不是门槛。修订目标时不传这一项 = 判断不变;传了就是这一版的完整清单,没列出的会记成「已替换」。',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string', description: '短名,十二字以内,你自己起(如「python3 能跑」)。之后说起这条判断、在别的工具里引用它,都用这个名字' },
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
			const call = open(exec, { sync: true })
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
			/**
			 * **修订时没传 `hypotheses` = 判断不变**,不是「一条都不要了」。
			 * 只改判据的修订若把缺省读成空清单,已被支持的判断会一起落成「已替换」,
			 * 而替换是终态,按原文补登也回不来。要撤掉判断就显式列出留下的那几条。
			 */
			const carried = args.hypotheses === undefined && state.goal !== null && state.goal.status === 'open'
			const hypotheses = Array.isArray(args.hypotheses)
				? args.hypotheses
				: carried
					? state.hypotheses
							.filter((item) => item.goal === state.goal.id && item.status !== 'superseded')
							.map((item) => ({ claim: item.claim, refute_when: item.refute_when, ...(item.name ? { name: item.name } : {}), ...(Array.isArray(item.assertions) ? { assertions: item.assertions } : {}) }))
					: []
			const names = hypotheses.map((hypothesis) => (typeof hypothesis?.name === 'string' ? hypothesis.name.trim() : '')).filter((name) => name !== '')
			if (new Set(names).size !== names.length) return fail('hypothesis_name_duplicate', '两条判断用了同一个短名:短名是用来区分判断的,换一个。')
			for (const hypothesis of hypotheses) {
				if (typeof hypothesis?.claim !== 'string' || hypothesis.claim.trim() === '') return fail('hypothesis_claim_required', '每条假设要有一句话主张。')
				if (typeof hypothesis?.refute_when !== 'string' || hypothesis.refute_when.trim() === '') return fail('hypothesis_refute_required', '每条假设必须写清「什么结果会推翻它」——没有推翻条件的假设无法被检验。')
				if (hypothesis?.name !== undefined && (typeof hypothesis.name !== 'string' || hypothesis.name.trim().length > HANDLE_LIMIT + 4)) return fail('hypothesis_name_too_long', `判断的短名要短:${HANDLE_LIMIT} 字以内,能让人一眼认出是哪条就够。`)
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
					const problems = judge.validateAssertions(sessionId, hypothesis.assertions, { legacy, mutations })
					if (problems.length > 0) {
						return fail('assertions_rejected', `这条假设的断言不能成立(先在 clear/ontology/ 下写好用到的概念、关系与主体实体文件,或改断言):\n${problems.map((item) => `- ${item}`).join('\n')}`)
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
				const given = typeof hypothesis.name === 'string' ? hypothesis.name.trim() : ''
				const kept = carried === undefined ? '' : String(existing.find((item) => item.id === carried)?.name ?? '')
				return {
					id: carried ?? `h-${Math.random().toString(36).slice(2, 8)}`,
					/** 短名:这一版给了就用这一版的,没给就沿用旧的;都没有就不写(读的一侧取主张开头)。 */
					...(given !== '' ? { name: given } : kept !== '' ? { name: kept } : {}),
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
					`${isRevision ? `目标已修订(第 ${revision} 版)` : '目标已立'},${carried ? '判断沿用上一版,' : ''}登记了 ${hypotheses.length} 条判断${nextHypotheses.length === 0 ? '' : `:${nextHypotheses.map((item) => `「${handleOf(item)}」`).join('、')}`}。` +
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
			const call = open(exec, { sync: true })
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
					message: `目标已如实放弃(阻塞原因记下了,记录都保留)。${blockNativeGoal(exec.agent, BLOCK_CODES.abandoned, `模型如实放弃了这个目标:${args.note ?? '没写原因'}。要不要结束由人决定。`)}`,
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
					}。\n为什么不让跳过:事实是在**收尾**这条路上沉淀的(假设 → 事实),先结目标就等于跳过沉淀 ✗。\n要接着做:把剩下的步交付或用 RevisePlan(void)作废,然后 \`ClosePlan\`;要放弃这个目标就用 \`Conclude(outcome="abandoned")\`(那条路不受此限)。`,
				)
			}
			const derived = call.derived ?? hostService.derive(sessionId)
			/**
			 * **实体门:将要升格的结论,主体必须在图上。**(结案唯一的结构关口)
			 *
			 * 位置有讲究——它坐在「计划已收尾」之后、**派评估者之前**:先拦便宜能补的,
			 * 再花钱请人裁决;等评估卡回来才发现主体没落图,那一次子 run 就白花了。
			 *
			 * 判据只看**将要升格的那几条判断**(与下面升格循环逐字同一套谓词):没到门槛的判断
			 * 还不是结论,不欠这一笔;只有散文、没有断言的判断也不拦——那是只给模型的缺口
			 * (`prose_only_claims`),不是关口。主体是不是图上的节点,读的是 `derive()` 挂在每条
			 * 判断上的 `unlanded`,与卡上缺口 ③ 同一份读数。
			 *
			 * 为什么看节点、不看边:边由升格本身落下(事实带着断言进图);要求升格之前另用
			 * 实体文件里把同一句话再写一遍,只是让模型重复劳动——第三阶段重跑里它就这样多花了一轮。
			 *
			 * 第四阶段删掉的两道门:「跳级没写理由」(`ExplainLevelSkip` 整套删除)与
			 * 「将升格的命题没有断言形态」(降为缺口)。依据见 `docs/less-is-more-plan.zh-CN.md` 第四阶段。
			 */
			if (CFG.requireLandedEntities && derived.knowledge.mode === 'knowledge') {
				const threshold = levelIndexOf(goal.promote_at_level)
				const promotable = derived.hypotheses.filter(
					(hypothesis) =>
						(hypothesis.status === 'alive' || hypothesis.status === 'proposed') &&
						(hypothesis.refutations ?? 0) === 0 &&
						levelIndexOf(hypothesis.supportedLevel) >= threshold,
				)
				const offGraph = promotable.filter((hypothesis) => (hypothesis.unlanded ?? []).length > 0)
				if (offGraph.length > 0) {
					return fail(
						'entities_unlanded',
						`有 ${offGraph.length} 条将要升格的判断,断言主体还不在实体图上:\n${offGraph
							.map((hypothesis) => `- ${hypothesis.id}(${hypothesis.supportedLevel}):${hypothesis.unlanded.map((subject) => `${subject.type}|${subject.id}`).join('、')}`)
							.join('\n')}\n为什么不让跳过:升格会把这些断言连同主体一起写进实体图;主体没有出处,图上就多出一个无从复核的节点。\n两条出口:① 给这些主体各写一个实体文件(\`clear/ontology/entities/<id>.json\`,带类型与出处),然后重新结案(不必在实体文件里再写同一句话,升格会落下这条边);② 这些断言不值得留下形态,就用 \`Frame\` 修订把它们从判断上拿掉,或如实 \`Conclude(outcome="abandoned")\`。`,
						{ mutations },
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
						`目标未达成,保持开放。**这一步与上一次是同一份材料,所以复用了上一条独立裁决**(不再重复花钱请人):独立评估者认为判据${audit.holds === 'no' ? '没有达成' : '判不了是否达成'}。依据:${audit.basis}\n要拿到新判断,先改材料:补观测 / 交付产物 / 修订假设或判据;只是再喊一次结案不会产生新判断。\n还没落定的步骤:${unfinished.length === 0 ? '无' : unfinished.map((step) => `第 ${step.ordinal} 步(${step.id})`).join('、')}`,
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
					`目标还没达成,保持开放。独立评估者认为判据${audit.holds === 'no' ? '没有达成' : '判不了是否达成'}。依据:${audit.basis}${audit.shortfalls.length > 0 ? `\n缺口(逐条):\n${audit.shortfalls.map((item) => `- ${verdictText([item])}`).join('\n')}` : ''}\n还没落定的步骤:${unfinished.length === 0 ? '无' : unfinished.map((step) => `第 ${step.ordinal} 步(${step.id})`).join('、')}${preview === null ? '\n(状态卡这一刻取不到:宿主读面不可用。已经发生的事实照旧落账;先看当前账本再谈重试。)' : cardTail(sessionId, preview)}`,
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
			/** 升格时第三道校验没过的判断:不升格,回执里写清卡在哪。 */
			const held = []
			for (const hypothesis of derived.hypotheses) {
				/**
				 * 只升格**这个目标**的判断,且每条只升格一次:上一个目标的判断状态仍是 alive,
				 * 不挡的话下一次结案会把它再写一遍(同一条结论两个事实文件)。
				 */
				if (typeof hypothesis.goal === 'string' && hypothesis.goal !== goal.id) continue
				if ((state.facts ?? []).some((fact) => fact.hypothesis === hypothesis.id)) continue
				if (hypothesis.status !== 'alive' && hypothesis.status !== 'proposed') continue
				if (hypothesis.refutations > 0) continue
				if (levelIndexOf(hypothesis.supportedLevel) < threshold) continue
				const assertions = Array.isArray(hypothesis.assertions) ? hypothesis.assertions : null
				/**
				 * **第三道校验(升格时)**:断言涉及的谓词、类型、主体此刻都要在本体文件里成立。
				 * 平时跨文件的问题只提示(模型改一组文件时中间态必然不一致);写进长期知识这一刻不行。
				 */
				if (assertions !== null && assertions.length > 0) {
					let problems = []
					try {
						problems = hostService.domain?.validateAssertions?.(sessionId, assertions, { mutations }) ?? []
					} catch (error) {
						problems = [`校验这一刻做不了:${String(error?.message ?? error).slice(0, 160)}`]
					}
					if (problems.length > 0) {
						held.push(`「${handleOf(hypothesis)}」:${problems.map(String).join(';')}`)
						continue
					}
				}
				const factId = `f-${Math.random().toString(36).slice(2, 8)}`
				const evidence = evidenceFor(state, hypothesis.id)
					.filter((item) => item.verdict === 'support')
					.map((item) => item.id)
				/** 升格这一刻断言用到的词条的含义指纹:之后谁改了定义,这条事实就知道要复核。 */
				let definitions = null
				try {
					definitions = assertions === null ? null : (hostService.domain?.definitions?.(sessionId, assertions, mutations) ?? null)
				} catch {
					definitions = null
				}
				const record = { id: factId, goal: goal.id, hypothesis: hypothesis.id, text: hypothesis.claim, scope: hypothesis.refute_when ?? null, level: hypothesis.supportedLevel ?? null, evidence, assertions, definitions }
				const path = persistFact(sessionId, record)
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
					evidence,
					assertions,
					definitions,
					path,
				})
				promoted.push({ id: factId, claim: hypothesis.claim })
			}
			return done({
				ok: true,
				code: 'goal_achieved',
				verdict: 'support',
				message:
					`目标已达成(独立评估者的依据:${audit.basis})。` +
					(held.length > 0 ? `\n这几条判断够格了,但断言用到的本体此刻不成立,**没有写进长期知识**(它们照旧留在记录里;改好本体文件后,要在之后的目标里再检验一次才能写进长期知识):\n${held.map((item) => `- ${item}`).join('\n')}` : '') +
					(promoted.length > 0 ? `\n写进长期知识:${promoted.map((item) => `${item.claim}(clear/knowledge/facts/${item.id}.json)`).join(' / ')}。之后的会话都读得到它们(总览在 clear/knowledge/facts/INDEX.md)。` : '\n没有判断达到写进长期知识的门槛。') +
					(untouched.length > 0
						? `\n结案时有 ${untouched.length} 条判断**一次都没检验过**:${untouched.map((hypothesis) => `「${handleOf(hypothesis)}」`).join('、')}——没检验不是「没问题」,是「没看过」;它们留在账上,随时可以补一次检验。`
						: '') +
					'\n被推翻与被替换的判断都留在记录里。' +
					/** 「怎么做」也要攒下来:这次摸出的可复用做法写成原生技能,下次宿主会列出来。 */
					'\n这次如果摸出了以后还会用的做法(怎么查、怎么算、怎么验),写成原生技能:.agents/skills/<名字>/SKILL.md(description 写清什么时候用)。' +
					continuationNote +
					declareDeliverables(exec, sessionId, delivered),
			})
		},
	})

	/**
	 * **一条事实一个文件**(`clear/knowledge/facts/<事实 id>.json`),只有系统写。
	 *
	 * 为什么是文件而不只是账本:账本只活在一次会话里,而「攒下来」的意思是下一个会话也读得到。
	 * 每个会话每一拍把这个目录同步进自己的账(`workspace/synced`),于是别的会话升格的事实
	 * 在这里也是「已知」,复核结论(撤回 / 维持)也写在同一个文件上。
	 */
	function persistFact(sessionId, record) {
		const file = sessionFile(sessionId, 'clear', 'knowledge', 'facts', `${record.id}.json`)
		if (file === null) return null
		const at = Date.now()
		try {
			writeTextFile(file, `${JSON.stringify({ ...record, session: sessionId, status: 'established', review: null, at, history: [{ event: 'promoted', at, level: record.level ?? null }] }, null, 2)}\n`)
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
						description: '这一步检验哪几条判断:填判断的短名(也认主张原文)。一次观测同时判几条竞争的判断时(比较那一步),把它们都列上',
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
			if (activePlanOf(state) !== null) return fail('active_plan_exists', '已经有一份活动计划。改它用 RevisePlan,收它用 ClosePlan。')
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
				message: `计划已立(${args.steps.length} 步)${goal === null ? '' : ',是当前目标的一个阶段'}。${warnings.length > 0 ? `\n提醒:${warnings.join(';')}` : ''}`,
			})
		},
	})

	/**
	 * **改计划只有一个入口**,三种动作各自的校验不变:补一步(`add`)、精化判据(`refine`)、
	 * 带因作废(`void`)。事件名沿用(`plan/amended` / `plan/refined` / `plan/voided`),旧日志照旧折。
	 * 三种都不动进度;连拦的那一步被补、被改判据、被作废,都清掉连拦。
	 */
	defineTool({
		name: 'RevisePlan',
		description:
			'改当前计划,不动进度(返回 progress_changed=false),三种动作:`action="add"` 补一步(漏了活就补上,给 `step`);`action="refine"` 精化一步的判定标准(给 `step_id` 与新的 `done_criteria`,旧判据留在日志里);`action="void"` 带因作废一步(给 `step_id` 与 `reason`:发现某步本不该存在就作废并说明缘由——作废留痕光明正大,为凑完成而造证是大忌;已交付的步不能作废)。',
		parameters: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: ['add', 'refine', 'void'], description: 'add=补一步;refine=改判据;void=带因作废' },
				step: { ...STEP_SCHEMA, description: 'action=add:新步' },
				step_id: { type: 'string', description: 'action=refine / void:哪一步' },
				done_criteria: { type: 'string', description: 'action=refine:新的判定标准' },
				reason: { type: 'string', description: '为什么改(action=void 必填)' },
			},
			required: ['action'],
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
			if (args.action === 'add') {
				if (args.step === undefined || args.step === null) return fail('step_required', 'action="add" 要给 `step`(id / do / done_criteria,可选 artifacts 与 tests)。')
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
			}
			if (args.action !== 'refine' && args.action !== 'void') return fail('unknown_action', 'action 只能是 add / refine / void。')
			const step = plan.steps.find((item) => item.id === args.step_id)
			if (step === undefined) return fail('unknown_step', `没有这一步:${args.step_id}`)
			if (args.action === 'refine') {
				if (step.status !== 'open') return fail('step_settled', `步骤 ${step.id} 已落定(${step.status}),判据不再可改。`)
				const criteria = String(args.done_criteria ?? '').trim()
				if (criteria.length < 4) return fail('done_criteria_required', '判据不能为空。')
				const selfRef = SELF_REFERENCE.find(([pattern]) => pattern.test(criteria))
				if (selfRef !== undefined) return fail('criteria_self_reference', selfRef[1])
				mutations.push({ t: 'plan/refined', plan: plan.id, step: step.id, old_criteria: step.done_criteria, new_criteria: criteria, reason: args.reason ?? null })
				if (plan.blocked !== undefined) mutations.push({ t: 'block/cleared', plan: plan.id, step: plan.blocked.step })
				return done({ ok: true, code: 'plan_refined', progress_changed: false, message: `步骤 ${step.id} 的判据已精化(进度不变,旧判据留痕)。` })
			}
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
				return fail('plan_has_open_steps', `还有 ${unsettled.length} 步没落定:${unsettled.map((step) => step.id).join(', ')}。交付它们,或带因作废(RevisePlan void)。`)
			}
			mutations.push({ t: 'plan/closed', plan: plan.id, summary: args.summary ?? null })
			persistArchive(sessionId, plan, args.summary ?? null)
			return done({
				ok: true,
				code: 'plan_closed',
				message: `计划已收尾归档(clear/goals/plans/${plan.id}.md)。${state.goal === null || state.goal.status !== 'open' ? '' : '目标还没结案:继续开下一阶段,或用 Conclude 结案。'}`,
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
					description: '仅 L0–L2:这一步检验的每条判断各一格,对照它的推翻条件读结果:没碰到推翻条件是「支持」,碰到了是「推翻」,这次观测区分不了是「不确定」。推翻和不确定都不妨碍这一步完成',
					items: {
						type: 'object',
						properties: {
							hypothesis: { type: 'string', description: '判断的短名(也认主张原文)' },
							verdict: { type: 'string', enum: ['支持', '推翻', '不确定', 'support', 'refute', 'inconclusive'] },
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
				return fail('out_of_order', `交付只能落在第一个未落定步 ${step.id}(${step.do});你给的是 ${args.step_id}。RevisePlan 不受此限。`)
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
			 * 它落到同一道已有的门(`plan/blocked` ⇒ 「待处理」里那条等人处置的条目)。
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
					`观测没收下(第 ${count} 次):${gate.hint}${count >= CFG.blockedThreshold ? '\n连续被拦到了上限,计划停下等人:不要继续交付。' : ''}${stalledNote}${cardTail(sessionId, preview)}`,
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
							`${stalledNote}${cardTail(sessionId, preview)}`,
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
					reuseNote = `\n**同一条材料**:这次**复用了上一条独立裁决**,没有重复请人。要拿到新判断先改材料——换产物内容、补观测,或用 RevisePlan(refine)改这一步的判据。`
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
						return fail('result_not_tested', `「${String(item?.hypothesis ?? '')}」不是这一步检验的判断。这一步检验的是:${tested.length === 0 ? '(无——不检验判断的步骤不给 results)' : tested.map((id) => `「${handleById(state, id)}」`).join('、')}。`)
					}
					const verdict = canonicalVerdict(item.verdict)
					if (verdict === null) return fail('result_invalid', '每条结果只能是「支持」「推翻」「不确定」之一。')
					byId.set(found.id, { hypothesis: found.id, verdict, basis: typeof item.basis === 'string' && item.basis.trim() !== '' ? item.basis.trim() : null })
				}
				const missing = tested.filter((id) => !byId.has(id))
				if (missing.length > 0) {
					return fail(
						'results_required',
						`这一步检验 ${tested.length} 条判断,还缺 ${missing.map((id) => `「${handleById(state, id)}」`).join('、')} 的结果。每条对照它的推翻条件读:没碰到推翻条件是「支持」,碰到了是「推翻」,这次观测区分不了是「不确定」——三种都算这一步完成。`,
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
			const outcome = results.length === 0 ? '' : `\n结果:${results.map((item) => `「${handleById(state, item.hypothesis)}」${VERDICT_WORD[item.verdict]}`).join(';')}。`
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
					`第 ${step.ordinal} 步(${step.id})已交付(${evaluator === 'independent' ? '独立评估者判的' : '你自己判的,依据已记下'})。收下的观测:${gate.confirmed.map((item) => item.ref).join(', ') || '(无)'}。` +
					outcome +
					(refuted ? '\n推翻也是有价值的结果:它和支持一样记进证据,判断的状态由证据算。' : '') +
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
	 * 人审查一条事实之后**把结论写回它自己那个文件**(`status` / `review`,`history` 只追加)。
	 *
	 * 为什么在文件里而不是只留在账本:别的会话与模型读的都是 `clear/knowledge/facts/`,
	 * 撤回过的若还原样躺在那里,下一轮会照旧引用一条已经作废的事实。
	 */
	function markFactReviewed(cwd, fact, review) {
		if (cwd === null || cwd === undefined || !/^[A-Za-z0-9_-]+$/.test(String(fact?.id ?? ''))) return null
		const file = join(cwd, 'clear', 'knowledge', 'facts', `${fact.id}.json`)
		try {
			if (!existsSync(file)) return null
			const data = JSON.parse(readFileSync(file, 'utf8'))
			const at = Date.now()
			const reason = review.reason === null || review.reason === undefined || String(review.reason).trim() === '' ? null : String(review.reason).slice(0, 400)
			const decision = review.retracted ? 'retracted' : 'kept'
			data.status = review.retracted ? 'retracted' : 'established'
			data.review = { decision, reason, at, by: 'user' }
			data.history = [...(Array.isArray(data.history) ? data.history : []), { event: decision, at, reason }]
			writeTextFile(file, `${JSON.stringify(data, null, 2)}\n`)
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

	/**
	 * 系统所有的四格:`evidence` / `knowledge/facts` / `goals` / `ontology`(相对工作区)。
	 * `ontology` 里**模型可写**的是三支本体目录(`concepts` / `relations` / `entities`);
	 * 字段定义 `SCHEMA.json` 与过程本体那份货架仍归系统。
	 */
	const PROTECTED_REL = [['clear', 'evidence'], ['clear', 'knowledge', 'facts'], ['clear', 'goals'], ['clear', 'ontology']]
	const OPEN_REL = ONTOLOGY_BRANCH_DIRS.map((branch) => ['clear', 'ontology', branch])

	/** 工作区内的相对路径(正斜杠);在工作区外或取不到工作区返回 null。 */
	function workspaceRelative(sessionId, value) {
		const cwd = sessionCwd(sessionId)
		if (cwd === null || typeof value !== 'string' || value.trim() === '') return null
		const rel = relative(cwd, isAbsolute(value) ? value : resolvePath(cwd, value)).split('\\').join('/')
		if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
		return rel
	}

	const underRel = (rel, parts) => rel === parts.join('/') || rel.startsWith(`${parts.join('/')}/`)

	/**
	 * 一个**文件路径**落在系统所有的格子里吗(返回那一格,否则 null)。
	 * 相对路径与绝对路径一样判(从前只比绝对路径的子串,`clear/knowledge/facts/x` 这样的相对写法直接绕过去了)。
	 */
	function protectedPath(sessionId, value) {
		const rel = workspaceRelative(sessionId, value)
		if (rel === null) return null
		if (OPEN_REL.some((parts) => underRel(rel, parts))) return null
		const root = PROTECTED_REL.find((parts) => underRel(rel, parts))
		return root === undefined ? null : root.join('/')
	}

	/** bash 命令里**写**系统格子的迹象:命令里出现了那一格(相对或绝对写法)且带写操作。只读命令不拦。 */
	const WRITE_HINT = /((?<![0-9&])>(?!&|\s*\/dev\/null)|\b(rm|mv|cp|tee|touch|mkdir|ln|chmod|truncate|install|rsync|dd)\b|\bsed\s+-i|\bperl\s+-[a-z]*i)/
	function bashTouchesProtected(sessionId, command) {
		if (typeof command !== 'string' || command === '' || !WRITE_HINT.test(command)) return null
		const cwd = sessionCwd(sessionId)
		for (const parts of PROTECTED_REL) {
			const rel = parts.join('/')
			const forms = cwd === null ? [rel] : [rel, join(cwd, ...parts)]
			for (const form of forms) {
				let index = command.indexOf(form)
				while (index !== -1) {
					const rest = command.slice(index + form.length)
					/** 写的是三支本体目录:放行(挪目录正是重新分层的方式)。 */
					if (!(parts.at(-1) === 'ontology' && ONTOLOGY_BRANCH_DIRS.some((branch) => rest.startsWith(`/${branch}`)))) return rel
					index = command.indexOf(form, index + form.length)
				}
			}
		}
		return null
	}

	/**
	 * **第一道校验**:模型用 write / edit 写本体文件时,先在内存里得出写完之后的全文,
	 * 用宿主半的 `domain.checkFile` 查单个文件。不过就拒这次写,原因原样回给模型。
	 * 不是 `.json` 的文件不归本体管(放行,读的时候也不认)。
	 */
	function ontologyWriteProblems(hostService, sessionId, name, args) {
		const rel = workspaceRelative(sessionId, args?.file_path)
		if (rel === null || !rel.endsWith('.json') || !OPEN_REL.some((parts) => underRel(rel, parts))) return null
		if (typeof hostService?.domain?.checkFile !== 'function') return null
		let content = null
		if (name === 'write') content = typeof args.content === 'string' ? args.content : null
		else if (name === 'edit') {
			const file = join(sessionCwd(sessionId), ...rel.split('/'))
			if (!existsSync(file)) return null
			const before = readFileSync(file, 'utf8')
			const from = String(args.old_string ?? '')
			if (from === '' || !before.includes(from)) return null
			content = args.replace_all === true ? before.split(from).join(String(args.new_string ?? '')) : before.replace(from, () => String(args.new_string ?? ''))
		}
		if (content === null) return null
		const problems = hostService.domain.checkFile(rel, content)
		return problems.length === 0 ? null : { rel, problems }
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
				/**
				 * 「评估卡、事实、目标只能由系统写」:做的人写不进这几格。只拦**写**:
				 * 读事实文件正是攒下来的东西被用上的方式。本体三支目录(`clear/ontology/{concepts,relations,entities}`)
				 * 是模型自己的,写进去要过第一道校验。
				 */
				const writing = exec.name === 'write' || exec.name === 'edit'
				const suspect = writing ? (protectedPath(sessionId, args.file_path) ?? protectedPath(sessionId, args.path)) : exec.name === 'bash' ? bashTouchesProtected(sessionId, args.command) : null
				if (suspect !== null) {
					return {
						kind: 'deny',
						reason: `${suspect} 由系统所有,做的人不能写(clear/evidence、clear/knowledge/facts、clear/goals、clear/ontology 的 SCHEMA.json 与货架)。事实只由独立评估之后的结案写;本体请写在 clear/ontology/concepts、relations、entities 下。`,
					}
				}
				if (writing && hostService !== undefined) {
					const rejected = ontologyWriteProblems(hostService, sessionId, exec.name, args)
					if (rejected !== null) {
						return { kind: 'deny', reason: `本体文件 ${rejected.rel} 没写进去,单个文件的格式不对:\n${rejected.problems.map((item) => `- ${item}`).join('\n')}\n字段定义在 clear/ontology/SCHEMA.json。` }
					}
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
		/** 本体文件树的地基(SCHEMA.json 与三支目录),幂等;位置在提示词里说,不进卡。 */
		ensureOntologySchema(hostService, sessionId)
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
		 * **工作区同步**:事实文件与本体文件这一拍的变化(别的会话升格的事实、模型刚写的本体)。
		 * 放在兜底事实之后:那些是上一步已经发生的事,文件变化是这一拍才看见的。
		 */
		try {
			const synced = syncWorkspace(sessionId, hostService.state(sessionId))
			if (synced !== null) factMutations.push(synced)
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 工作区同步失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}
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
			const shelf = ensureFactsShelf(sessionId, hostService.state(sessionId), factMutations)
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
