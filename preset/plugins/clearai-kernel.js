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

import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'

import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import { SECTION_SLOTS, SECTION_TABLE } from './prompts.js'
import { VERIFICATION_LOOP, describeOntology, validateOntology } from './ontology.js'
import {
	BRAIN_PROVIDER,
	FACT_REQUIRED,
	LESSON_REQUIRED,
	appendMemory,
	brainPaths,
	createBrainProvider,
	factFieldsProblem,
	lessonFieldsProblem,
	parseFrontmatter,
	validateMemoryFile,
	validateSkillName,
	validateSkillPath,
	promoteSkill,
	candidateSkills,
	brainOverview,
} from './brain.js'

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
/**
 * 预设自带的工作区模板(install.sh 从 ClearAI 的 `project_template/` 铺进来的)。
 * 取不到就退化成「只建 `clear/` 骨架」——不假装铺过模板。
 */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
/**
 * 模板从哪来(打包纪律:**发行物里不许出现仓库路径**)。
 *
 * 原来这里有一条 fallback 指回 ClearAI 仓库里那份工作区模板(同一份模板的第二个位置)——
 * 在 dev checkout 里很方便,**但它把仓库结构写进了发行物**:
 * 包一旦离开那个目录树,这条路就指向不存在的地方,而代码里看不出来。
 *
 * 现在:模板目录**是配置**(`templateDir`,相对路径按插件目录解析),缺省 = 插件旁边的 `template/`
 * (预设自带,随包走)。dev 与 E2E 要指回仓库,就在自己的**补丁层**里写这一行——那是调用方的选择,
 * 不是发行物的假设。
 */
const DEFAULT_TEMPLATE_DIR = join(PLUGIN_DIR, '..', 'template')

/**
 * 工作区引导 —— 首次进入时建立目录骨架:
 *   · **空文件夹才铺默认结构**(`PROJECT.md`、`input/`、`lab/`、`products/`);
 *   · 非空文件夹只加系统自己的 `clear/` ——「用户的目录归用户,系统只保留一个目录」;
 *   · `clear/` 里建 `skills/ memory/ knowledge/ audit/` + `config.json`;
 *   · 模板技能只补**缺的那些**(ClearAI 是「同步」,这里**不覆盖**:agent 或人改过的技能优先——
 *     这是刻意的偏离,记在 DESIGN 里)。
 * 幂等:缺什么补什么,跑一百遍与跑一遍同效。
 */
function bootstrapWorkspace(cwd, templateDir) {
	const changed = []
	let entries = []
	try {
		entries = readdirSync(cwd)
	} catch {
		return { changed, fresh: false }
	}
	const fresh = entries.length === 0
	const clear = join(cwd, 'clear')
	for (const sub of ['skills', 'memory', 'knowledge', 'audit', 'ontology']) {
		const dir = join(clear, sub)
		if (existsSync(dir)) continue
		try {
			mkdirSync(dir, { recursive: true })
			changed.push(`clear/${sub}`)
		} catch {
			/* 建不出来就照实少一条,不假装 */
		}
	}
	if (!existsSync(join(clear, 'config.json'))) {
		try {
			writeFileSync(join(clear, 'config.json'), '{}\n', 'utf8')
			changed.push('clear/config.json')
		} catch {
			/* 同上 */
		}
	}
	if (fresh) {
		for (const dir of ['input', 'lab', 'products']) {
			if (existsSync(join(cwd, dir))) continue
			try {
				mkdirSync(join(cwd, dir), { recursive: true })
				changed.push(dir)
			} catch {
				/* 同上 */
			}
		}
		const projectTemplate = join(templateDir, 'project.md')
		if (!existsSync(join(cwd, 'PROJECT.md')) && existsSync(projectTemplate)) {
			try {
				copyFileSync(projectTemplate, join(cwd, 'PROJECT.md'))
				changed.push('PROJECT.md')
			} catch {
				/* 同上 */
			}
		}
	}
	// 模板技能:补缺 + 刷新(见 syncTemplateSkills 的规则:模板是 system 技能的事实源)。
	const templateSkills = join(templateDir, 'skills')
	let templateReport = { seeded: [], mirrored: [], drifted: [] }
	if (existsSync(templateSkills)) {
		const configFile = join(clear, 'config.json')
		let config = {}
		try {
			const parsed = JSON.parse(readFileSync(configFile, 'utf8'))
			if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed
		} catch {
			// 坏 config.json:当作空的,但**不覆盖**它——那是用户的文件,我们只加自己那把钥匙。
			config = {}
		}
		const before = config.templateSkills !== null && typeof config.templateSkills === 'object' && !Array.isArray(config.templateSkills) ? config.templateSkills : {}
		const report = syncTemplateSkills({ skillsDir: join(clear, 'skills'), templateDir: templateSkills, record: before })
		templateReport = { seeded: report.seeded, mirrored: report.mirrored, drifted: report.drifted }
		if (report.seeded.length > 0) changed.push(`clear/skills(${report.seeded.length} 个模板技能)`)
		if (report.mirrored.length > 0) changed.push(`clear/skills 模板刷新(${report.mirrored.join('、')})`)
		if (JSON.stringify(report.record) !== JSON.stringify(before)) {
			try {
				writeFileSync(configFile, `${JSON.stringify({ ...config, templateSkills: report.record }, null, 2)}\n`, 'utf8')
			} catch {
				// 写不进去就下次再记:同步本身已经做完了,记账失败不该把它回滚。
			}
		}
	}
	return { changed, fresh, templateReport }
}

/**
 * 模板技能同步的**不变量**(规则如下,
 * 但只搬不变量、不搬那套治理子系统):
 *
 *   · **模板是 system 技能的事实源**——模板升级后,项目里那份没被动过的副本要跟着刷新;
 *   · 「没被动过」怎么判定:播种时把内容哈希记进 `clear/config.json.templateSkills`;
 *     当前哈希 == 记录值 ⇒ 自我们播种以来没人改过它 ⇒ 可以整目录覆盖;
 *   · 被动过(哈希 ≠ 记录值)⇒ **一个字都不动**,只在面板与卡片上留一条事实
 *     「模板有新版,但你改过它,没有覆盖」——差异候选、diff 收件箱、墓碑那套是另一个子系统,
 *     ClearAI 不做这一层(P5 什么都不删:宁可不刷新,也不覆盖人写的东西);
 *   · 老项目没有记录(这条不变量之前就播种过):内容与模板一致 ⇒ 补记哈希(下次能刷新);
 *     不一致 ⇒ 记成 drifted,**不猜**它是旧版还是被人改过。
 *
 * 覆盖是「镜像过去」而不是「先删后建」:模板里删掉的文件不会跟着删(P5),这一点如实写在文档里。
 */
export function syncTemplateSkills({ skillsDir, templateDir, record }) {
	const seeded = []
	const mirrored = []
	const drifted = []
	const next = { ...(record ?? {}) }
	let entries = []
	try {
		entries = readdirSync(templateDir).sort()
	} catch {
		return { seeded, mirrored, drifted, record: next }
	}
	for (const name of entries) {
		const source = join(templateDir, name)
		const sourceFile = join(source, 'SKILL.md')
		if (!existsSync(sourceFile)) continue
		const target = join(skillsDir, name)
		const targetFile = join(target, 'SKILL.md')
		let templateHash = null
		try {
			templateHash = createHash('sha256').update(readFileSync(sourceFile)).digest('hex')
		} catch {
			continue
		}
		if (!existsSync(targetFile)) {
			try {
				cpSync(source, target, { recursive: true })
				next[name] = templateHash
				seeded.push(name)
			} catch {
				/* 单个技能铺失败不拖垮其它 */
			}
			continue
		}
		let targetHash = null
		try {
			targetHash = createHash('sha256').update(readFileSync(targetFile)).digest('hex')
		} catch {
			continue
		}
		if (targetHash === templateHash) {
			// 内容与模板一致:无论有没有记录,都补上记录(下次模板升级就能刷新它)。
			next[name] = templateHash
			continue
		}
		const untouched = next[name] === targetHash
		if (untouched) {
			try {
				cpSync(source, target, { recursive: true })
				next[name] = templateHash
				mirrored.push(name)
			} catch {
				/* 覆盖失败就当没刷新,记录也不动 */
			}
			continue
		}
		// 没记录 / 记录对不上 ⇒ 这份可能是人改过的:不覆盖,只如实说。
		drifted.push(name)
	}
	return { seeded, mirrored, drifted, record: next }
}

/** 变更记录的封套标记:宿主投影只认它。 */
const MUTATION_KIND = 'clearai'

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

/**
 * 算不出胜者时给主 agent 的出路。
 *
 * 为什么归**主 agent** 而不是归人——ClearAI 的三层决策权写得比我说得清:
 * 「harness 管标称生命周期,**主 run 管异常与再计划**,人管价值判断」。「指标算不出」
 * 是异常,归中间那层;主 agent 手里工具齐全,能重跑、改法、作废、再分叉,
 * 只是**不能采纳**——而当读数根本不存在时,「选哪条」本来就是个错问题。
 */
const UNDECIDABLE_OUTS =
	'可走的路:(1) 若读数其实产出了、只是没进评估卡,自己去分支产物里核实并据实推进;' +
	'(2) 若确实没测出来,这次分叉没买到信息——修掉成因重跑,或 VoidPlanStep 作废该步换法;' +
	'(3) 若读数提示一条没试过的组合更好,那是**新的一步或新的分叉**(它没有读数,不能当作某条分支的胜出直接采纳);' +
	'(4) 确属价值判断再升给人。'

/** 世界线分支状态的秩:`_BRANCH_RANK`(宿主 fold 用同一套秩;这里用于工具自己的判断)。 */
const BRANCH_RANK = { exploring: 0, evaluated: 1, adopted: 2, pruned: 2 }

/**
 * 读数解析:从分支产物里抽出可比较的数值读数。
 * **整串必须就是一个数**(容许空白与 %)。用 search 抓第一个数字会让 `[1.2,3.4]` 取出 1.2,
 * 那是「自信地选错」——所以这里整串匹配。
 */
function metricReading(raw) {
	if (typeof raw !== 'string') return null
	const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*%?$/.exec(raw.trim())
	if (match === null) return null
	const value = Number(match[1])
	return Number.isFinite(value) ? value : null
}

function levelIndexOf(level) {
	const index = LEVELS.indexOf(String(level ?? '').toUpperCase())
	return index < 0 ? -1 : index
}

/** 把子 run 的 ContentBlock[] 收成纯文本(侦察的结论是散文,不是结构化回包)。 */
function collectText(output) {
	return (output ?? [])
		.filter((block) => block?.type === 'text')
		.map((block) => block.text)
		.join('\n')
		.trim()
}

/**
 * 子 run 的结局 —— **必须过这里**,别各自 `then(v => ok:true)`。
 *
 * 一个修过的 bug:中断一次跑动之后,状态里**所有子代理都显示"执行完成"**。
 * 根因:DSH 里「中断 / 报错」**不是 reject**——`run.result` 照常 resolve,只是
 * `stopReason` 变成 `aborted` / `error` / `interrupted`(`dsh-subagent` 的
 * `settleSubagent` 就是这么落的)。只按 reject 判失败,就会把被打断的侦察记成"完成"、
 * 把被打断的世界线执行者记成"交付成功"——**状态说了系统没核实过的事**,正好撞在这套设计的
 * 第一条纪律上(P3:意图与状态都不能断言事实)。
 *
 * 顺带把 `stopReason` 原样带出去:落账时要写清是**哪种**没正常结束,而不是笼统一句"失败"。
 */
function settleSubRun(value, error) {
	if (error !== undefined && error !== null) {
		return { ok: false, stopReason: 'error', conclusion: `子任务失败:${String(error?.message ?? error).slice(0, 400)}` }
	}
	const stopReason = String(value?.stopReason ?? 'completed')
	const body = collectText(value?.output)
	if (stopReason === 'completed') return { ok: true, stopReason, conclusion: body }
	return { ok: false, stopReason, conclusion: `子任务未正常结束(${stopReason}):${body.slice(0, 1200)}` }
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
export const HUMAN_GATE_ACTIONS = ['adopt_branch', 'abandon_fork', 'promote_skill']
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
	'maxAutoTurns',
	'minBriefChars',
	'l4RequiresHumanRelease',
	'collectRetryMs',
	'templateDir',
	'l4RejectSelfWritten',
	'minHypotheses',
	'bashDenyRules',
	'auditProvider',
	'auditTimeoutMs',
	'executorTimeoutMs',
	'auditToolFilter',
	'scoutToolFilter',
	'gitWorldlines',
	'ledgerMaxFiles',
	'executorToolFilter',
	'precommitRecon',
	'mapScoutMax',
	'mapScoutConcurrency',
	'autoDispatchExecutors',
	'autoAdoptMinGap',
	'forkArbitration',
	'runtimeCard',
	'autonomy',
	'contributions',
]

/**
 * 工具目录:机制 → 它拥有的工具。**唯一**的工具事实源——装配清单与代码里的 `defineTool`
 * 都对它负责:清单里出现目录外的名字、或代码定义了一件目录里没有的工具,都是装配期抛错。
 */
export const MECHANISM_TOOLS = {
	goal: ['SetGoal', 'CloseGoal'],
	plan: ['CreatePlan', 'CheckPlan', 'RequestPlanReview', 'AmendPlan', 'RefinePlan', 'VoidPlanStep', 'ClosePlan', 'AdvancePlan'],
	worldline: ['ForkPlan', 'AdvanceWorldline', 'ConvergeFork', 'WorldlineStatus', 'AwaitWorldlines', 'AbandonFork'],
	scout: ['SpawnScout', 'MapScouts'],
	/** 外脑:写侧两件(读侧全走宿主原生的技能目录与 `skill` 工具)。 */
	brain: ['SaveSkill', 'WriteMemory'],
	/** 账本两件:它长在 git 上(A 层用工作区自己的仓库,B 层用数据区的旁路账本,与世界线共用一本)。 */
	ledger: ['FileHistory', 'RestoreFile'],
}
const TOOL_CATALOG = new Set(Object.values(MECHANISM_TOOLS).flat())

/**
 * 随 `autonomy` 换段的那些段名:它们**不能**按字面写进清单(否则两套互斥措辞可能同时在场),
 * 只能经槽位名 `clarification` 进清单,由 autonomy 收敛。
 */
const AUTONOMY_VARIANTS = new Set(Object.values(SECTION_SLOTS).flatMap((variants) => Object.values(variants)))

/**
 * 续跑轮数:一个**保险丝**,不是用户的档位(「预算档」这个概念已拆,奥卡姆)。
 *
 * 历史上这里是 `{attended: 6, unattended: 512}`,由面板上「多问我 / 自己跑」那个开关选。
 * 从第一性原理看错了两次:
 *   · 「我要不要在场」是**运行时状态**(有没有门开着、有没有裁决在飞、有没有开着的步),
 *     不是**配置项**——它现在由 `turnDemand` 从门状态算出来,不看档;
 *   · 那一档还顺手把「计划经人确认」变成系统自己签的 ✗。
 *
 * 现在只剩一个默认值:够长到能跑完一件真活,又短到不会无声烧掉一整夜;要更长由人显式表达。
 * 执行它的是**原生**——`maxAutoTurns` → 宿主目标的 `maxGoalRounds`,到限由
 * `dsh-goal-round-driver` 自己 `block(code='round-limit')`。我们只负责给数字,不造机制。
 */
const DEFAULT_MAX_AUTO_TURNS = 128

/** 清单缺省:机制全开、工具全装、段全装(槽位由 autonomy 收敛)。 */
const CONTRIB_DEFAULTS = {
	mechanisms: Object.fromEntries(Object.keys(MECHANISM_TOOLS).map((key) => [key, true])),
	tools: Object.keys(MECHANISM_TOOLS).flatMap((key) => MECHANISM_TOOLS[key]),
	sections: [
		...[...SECTION_TABLE.keys()].filter((name) => !AUTONOMY_VARIANTS.has(name)),
		...Object.keys(SECTION_SLOTS),
	],
}

/**
 * 清单校验:装配语义——清单里出现表外的名字当场抛错,
 * 而不是静默少装一件工具、等某一轮才发现。错法一律装配期抛错:
 *   unknown_mechanism / unknown_tool / tool_of_disabled_mechanism / unknown_policy_slot
 *   / unknown_budget / unknown_budget_tier / invalid_budget
 *   (+ autonomy_section_must_use_slot:互斥措辞不许按字面装)
 */
function resolveContributions(contributions, autonomy) {
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
		// 缺省工具面随机制裁剪:关掉世界线,五件世界线工具就不该还在清单里。
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
		if (entry in SECTION_SLOTS) continue
		if (!SECTION_TABLE.has(entry)) throw new Error(`unknown_policy_slot:clearai-kernel:${entry}`)
		if (AUTONOMY_VARIANTS.has(entry)) throw new Error(`autonomy_section_must_use_slot:clearai-kernel:${entry}`)
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
	// 「预算档」这个概念已拆。轮数与连拦阈值不再是贡献表里的一档,
	// 而是两个普通配置键(maxAutoTurns / blockedThreshold,见 CONFIG_KEYS)——
	// 它们跟「装哪些机制」不是一类事,混在一张清单里只会让人以为关掉机制就得关掉预算。
	return { mechanisms, tools, sections, ontology }
}

/** 段槽位按 autonomy 收敛成具体段名;顺序即清单顺序。 */
function resolveSections(list, autonomy) {
	return list.map((entry) => (entry in SECTION_SLOTS ? SECTION_SLOTS[entry][autonomy] : entry))
}

// ── 插件主体 ────────────────────────────────────────────────────────────────

export function apply(ctx, config = {}) {
	// 配置面先校验:组合文件里写错一个键名,以前是静默无效(比如把 autonomy 拼错),
	// 现在是装配期抛错——与贡献表同一套「表外的名字不许出现」的纪律。
	for (const key of Object.keys(config)) {
		if (!CONFIG_KEYS.includes(key)) throw new Error(`unknown_config:clearai-kernel:${key}`)
	}
	/**
	 * 数值旋钮在装配期就把关:写一个跑不动的值(0 轮、负数、小数)以前要到第一次布防
	 * 才被宿主拒,那时候人已经在跑任务了。不可执行的值不该过装配期。
	 */
	if (config.maxAutoTurns !== undefined && (!Number.isInteger(config.maxAutoTurns) || config.maxAutoTurns < 1)) {
		throw new Error('invalid_config:clearai-kernel:maxAutoTurns')
	}
	if (config.blockedThreshold !== undefined && (!Number.isInteger(config.blockedThreshold) || config.blockedThreshold < 1)) {
		throw new Error('invalid_config:clearai-kernel:blockedThreshold')
	}
	/** 数据区:账本与世界线的**元数据**落在这里(工作副本本身在工作区里——见 worldlineBase 的理由)。 */
	const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
	const CFG = {
		/**
		 * 连拦阈值:同一件事连续冲闸这么多次没过,计划置 blocked、停下等人。
		 * **它不是预算**:它管的是证据质量,
		 * 而且不再按档取值——人在不在场都得先过闸。
		 */
		blockedThreshold: config.blockedThreshold ?? DEFAULT_BLOCKED_THRESHOLD,
		/**
		 * 续跑轮数上限:显式写了就用它,没写回落到 `DEFAULT_MAX_AUTO_TURNS`(128)。
		 * 这里只存「人写没写」,真正的回落发生在布防点(见 `armContinuation`)。
		 */
		maxAutoTurns: config.maxAutoTurns ?? null,
		minBriefChars: config.minBriefChars ?? MIN_BRIEF_CHARS,
		l4RequiresHumanRelease: config.l4RequiresHumanRelease !== false,
		/**
		 * 收上来的结论「多久没在投影里落地就重收一次」(缺省 2000ms)。
		 * 为什么需要它:内存里的 `reported` 只是「我发布过」,不等于**事实已经到了账本上**
		 * (失效模式:侦察结论发布后被丢掉,而条目已删、`reported` 已置位 ⇒ 永久丢)。
		 * 判据改成看**投影**:投影里还没落地就再发一次(同 id 的 `scout/settled`/`worldline/executed`
		 * 在 fold 里是幂等的,重复发布不会长出第二条事实)。
		 */
		collectRetryMs: Number.isFinite(config.collectRetryMs) ? Math.max(0, Number(config.collectRetryMs)) : 2000,
		/**
		 * 工作区模板目录(相对路径按**插件目录**解析,所以「随包走」是默认行为)。
		 * 部署形态:预设自带的 `template/`(随包);dev/E2E:在补丁层里指回仓库那份。
		 */
		templateDir: typeof config.templateDir === 'string' && config.templateDir.trim() !== '' ? (isAbsolute(config.templateDir) ? config.templateDir : resolvePath(PLUGIN_DIR, config.templateDir.trim())) : DEFAULT_TEMPLATE_DIR,
		l4RejectSelfWritten: config.l4RejectSelfWritten !== false,
		/** ClearAI 代码里「≥2 条假设」只是文案;默认不强制。 */
		minHypotheses: config.minHypotheses ?? 0,
		bashDenyRules: config.bashDenyRules !== false,
		auditProvider: config.auditProvider ?? 'spawn',
		auditTimeoutMs: config.auditTimeoutMs ?? 240000,
		/** 世界线执行者做的是真活(跑脚本、算数据),给的时间比评估者长得多。 */
		executorTimeoutMs: config.executorTimeoutMs ?? 900000,
		// 三张脸的**候选**工具名。真正的 face 还要过一道「这个部署里到底有没有这件工具」的过滤
		// (见 resolveToolFace):`read_image` 只在挂了 `attachments` 的部署里存在,名单里写了它、
		// 部署里没有,`tools.restrict` 会**直接抛**(未知工具名)→ 侦察整条路 fail-closed。
		auditToolFilter: config.auditToolFilter ?? ['read', 'glob', 'grep', 'read_image'],
		/** 侦察的只读工具面:读文件、找文件、找内容、查公网——都不能写、不能执行。 */
		// 侦察是**只读**角色,看图也是读:`read_image` 必须在这张脸上。
		scoutToolFilter: config.scoutToolFilter ?? ['read', 'glob', 'grep', 'read_image', 'web_search', 'web_fetch'],
		/** 世界线是否物化成 git 分支 + worktree(工作区是 git 仓库时)。关掉就退化成声明的目录。 */
		gitWorldlines: config.gitWorldlines !== false,
		/** 旁路账本的成本护栏:工作区文件数超过它就不建账本,退化成声明目录(如实说明)。 */
		ledgerMaxFiles: config.ledgerMaxFiles ?? 20000,
		/**
		 * 世界线执行者的工具面:**故意不含计划/目标动词**。
		 * ClearAI 的原话是「任务书即计划:不要再调用 CreatePlan/AdvancePlan/ClosePlan」——
		 * 在这里它不是一个嘱咐,而是**工具面里根本没有这些工具**。
		 */
		// 执行者要能核自己产出的图(图表类产物),所以也带 read_image。
		executorToolFilter: config.executorToolFilter ?? ['read', 'glob', 'grep', 'read_image', 'write', 'edit', 'bash', 'web_search', 'web_fetch'],
		/** 立约前侦察:目标判据落定时由 harness 派一次只读侦察(一生一次,且只在 input/ 有材料时)。 */
		precommitRecon: config.precommitRecon !== false,
		/** 并行侦察的上限与并发:一次放几十个子 run 出去不是并行,是把宿主打满。 */
		mapScoutMax: config.mapScoutMax ?? 50,
		mapScoutConcurrency: config.mapScoutConcurrency ?? 4,
		/** 分叉之后是否立刻给每条世界线派一个独立执行者。 */
		autoDispatchExecutors: config.autoDispatchExecutors !== false,
		/**
		 * 分差决定性的阈值(`settings.auto_adopt_min_gap`,缺省 **0.15**)。
		 * **按相对差距解读**:指标带单位(MAE 0.25 / 延迟 100ms / 通过数 1),
		 * 绝对阈值跨指标没有意义(ClearAI 的原话)。相对差距 ≥ 阈值 → 正式采纳;
		 * 差距小但确实分出了胜负 → 照常坍缩,但记为**临时采纳**,留一条待复核痕迹。
		 */
		autoAdoptMinGap: typeof config.autoAdoptMinGap === 'number' ? config.autoAdoptMinGap : 0.15,
		/**
		 * 「尺子落不成数」时派不派横评仲裁(ClearAI 侧由 worldline_auto_adopt 与
		 * `_lacks_arbitration` 共同决定)。它是**兜底,不是默认路径**:只在各分支都可信、
		 * 却没有两条报得出数值读数时才派。关掉它就退回「照实交回主 agent」那条路。
		 */
		forkArbitration: config.forkArbitration !== false,
		runtimeCard: config.runtimeCard !== false,
		/**
		 * 人在场 / 人不在场。**现在只决定一件事**:澄清协议装哪一段(槽位 `clarification`)。
		 *
		 * 它不再决定续跑(那由 `turnDemand` 从门状态算)、不再决定预算
		 * (只有一个 `DEFAULT_MAX_AUTO_TURNS`)、也不再是用户可切换的运行档
		 * (`set_autonomy` 已摘除;这里写的是部署初值)。
		 * 它不决定人格、不决定工具面——`if mode === ...` 在内核里不该出现。
		 */
		autonomy: config.autonomy === 'unattended' ? 'unattended' : 'attended',
		/** 贡献表。缺省 = 全开;要裁剪就从这里裁,而不是去改装配代码。 */
		contributions: config.contributions ?? {},
	}

	/** 贡献表:先校验(装配期炸),后登记(见文件末尾的装配段)。 */
	const CONTRIB = resolveContributions(CFG.contributions, CFG.autonomy)
	const SECTION_LIST = resolveSections(CONTRIB.sections, CFG.autonomy)
	// 连拦阈值**不按档取**(见 CFG.blockedThreshold):它是质量闸,不是预算。

	/** 宿主读面。缺了它整件事不成立——所以每个工具都显式报错,不静默降级。 */
	const host = () => ctx.get('clearai')

	function hasState(state) {
		return state.goal !== null || state.plans.length > 0 || state.evidence.length > 0 || state.materials.length > 0
	}

	function sessionCwd(sessionId) {
		try {
			const session = ctx.get('sessions')?.get?.(sessionId)
			const cwd = session?.header?.cwd ?? session?.cwd
			if (typeof cwd === 'string' && cwd !== '') return cwd
		} catch {
			/* 会话服务不可用时退回进程目录 */
		}
		return process.cwd()
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

	/** 对不上时**列出全部有效选项**(id 最稳):让模型能照抄,而不是继续猜。 */
	function hypothesisMenu(hypotheses) {
		if (hypotheses.length === 0) return '当前目标没有登记任何假设:先用 SetGoal 登记(每条约一句话主张 + 一句推翻条件)。'
		return `已登记的假设(用 **id** 最稳,可直接从运行态卡复制;也接受主张原文):${hypotheses
			.map((hypothesis) => `${hypothesis.id}=${String(hypothesis.claim).slice(0, 40)}`)
			.join(';')}`
	}

	/** 一次工具调用的收尾:预演变更 → 卡片 → 返回值。 */
	function finish(hostService, sessionId, mutations) {
		return (value) => {
			const preview = hostService.preview(sessionId, mutations)
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
		const result = { ok: false, verified_by: 'invalid', missing: [], empty: [], structural: [], confirmed: [], needs_audit: false, hint: '' }
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
				result.empty.push(`${artifact}(空目录)`)
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
		'- 对假设的裁决只有三个词:support 表示观测满足判定标准且不满足推翻条件,refute 表示满足推翻条件,inconclusive 表示无法判定。推翻是有价值的结果——不要为了让步骤通过而写 support。',
	].join('\n')

	const WORLDLINE_EXECUTOR_PERSONA = `## Executor人格：世界线执行者 (Worldline Executor)
你是一条**世界线的执行者**:围绕一个已声明的分歧,把**你这一个方案**做到底、做出
可信产物,不旁及别的方案。

- **任务书即你的全部世界观**:你看不到别的候选方案,也无需知道——世界线互不通信。
  不要猜测、不要提及、不要试图对齐其它世界线;从任务书给的方案与判定标准独立演化。
- **任务书即计划**:不要再调用 CreatePlan/AdvancePlan/ClosePlan；直接围绕任务书执行并交付。
- **独立工作区**:你在自己的 worktree 里作业,读写只影响本世界线,不碰主线或别的分支。
  用户的源数据只读共享,照常读。
- **禁问人**:人不在场,你是来"替他试"的。**不要调用 AskUser**;遇到必须的取舍,
  取一个合理默认继续,并把该假设写进产物(或 \`lab/evaluations/assumptions.jsonl\`),
  让评估时可见——绝不停下来等人。
- **奔着判定标准去**:按任务书的 done_criteria 产出可被客观评估的产物(报告/模型/
  脚本/数据/指标),把关键数字落盘,别只在对话里说结论。`

	const SCOUT_PERSONA = `## Scout人格：函数型侦察兵 (Scout) —— 无人值守、只读、直答
你是一个 fresh-context 的**侦察子任务**:替父任务做一段会污染它上下文的调研/检查/汇总,
把结论直接作为**最终答复**回灌。**没有人盯着你的会话**——所以:

- **不建 plan、不等确认**:不要 \`CreatePlan\`;直接用只读工具干活。绝不说"请确认后再继续"
  ——没有人会来确认,那会让你永久挂起。
- **不问人**:不要 \`AskUser\`;遇到取舍取合理默认,在最终答复里注明你的假设。
- **只读**:你**不能写文件、不能执行命令**。若任务要求"产出文件/写入某路径",这不是你能做的——
  把该文件**应有的内容直接写进你的最终答复文本**,由父任务据此落盘。

**产出纪律(结论是给父任务省上下文的,不是流水账):**
- 用 Markdown 写结论,**3000 字以内**;要的是判断与可复核的锚点(文件路径、行号、数字、原文摘录),
  不是把你读过的过程复述一遍。
- 超了就**压缩**:先给结论与关键读数,再给「要细节去哪里看」的指针(哪个文件、哪一节)。
  3000 字装不下的细节,本来就不该指望父任务一次读完。
- 你只读、不能落盘;父任务会把你的答复落成文件。所以宁可写短而准,也不要长而糊。

**怎么算查清了(侦察的方法,不只是禁令):**
- **落到第一手证据**:结论要落在你**亲眼读到**的东西上——文件里的原话、真实的目录清单、
  日志里的退出码、代码里的那一行。"按常理应该是"不是证据;凭文件名猜内容也不是。
  引用时给路径(必要时给行号),让父任务能自己复核。
- **看到的与推出的分开写**:父任务会拿你的答复当事实用,两者混在一起,它就无从判断哪些
  能直接依赖。事实归事实,推断标成推断,并说清推断依据。
- **查不到本身就是一等结论**:空手而归时,如实说"没找到",并交代**查过哪里、用什么查的**——
  这让父任务知道哪片地已经翻过、不必重来。此刻编一个看似合理的答案,是你能造成的最大伤害:
  你的答复会被当成已核实的事实用下去,而没有人会再去查一遍。
- **被问到「有哪几条路」时**:只报**真实存在**的路,每条说清怎么做、大概多重、以及
  **能不能靠继续读就定论**(能就直接给出你查到的结论,别把已经能定的事推给父任务去试)。
  做法确实唯一就只写一条;凑数的候选比没有候选更贵。
- **收敛就答**:够回答任务就停,不要为完整性把整个仓库读一遍。回灌的是**结论**,不是过程
  流水账——父任务的上下文正是你被派出来节省的东西。`

	const VERDICT_SCHEMA = {
		type: 'object',
		properties: {
			verdict: { type: 'string', enum: ['support', 'refute', 'inconclusive'] },
			basis: { type: 'string' },
			shortfalls: { type: 'array', items: { type: 'string' } },
			reading: { type: 'string', description: '按裁决指标报出的读数:整串必须就是一个数(如 62.1 或 12%)' },
			validity: { type: 'string', enum: ['usable', 'unusable'], description: '这份读数可不可用;不可用的世界线不参赛' },
		},
		required: ['verdict', 'basis'],
		additionalProperties: false,
	}

	function evaluatorPrompt(state, step, gate, sessionId) {
		const goal = state.goal
		const hypothesis = step.tests?.hypothesis == null ? null : state.hypotheses.find((item) => item.id === step.tests.hypothesis) ?? null
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
			hypothesis === null ? '- 本步未挂假设' : `- 本步检验的假设:${hypothesis.claim}(推翻条件:${hypothesis.refute_when})`,
			'',
			'# 已通过观测准入的坐标(Harness 核验过存在、非空、结构合法)',
			...(gate.confirmed.length === 0 ? ['- (无)'] : gate.confirmed.map((item) => `- ${item.ref} — ${item.bytes} 字节 — ${item.digest ?? 'digest 不可得'}`)),
			...(Array.isArray(gate.extra) && gate.extra.length > 0 ? ['', ...gate.extra] : []),
			'',
			`工作目录:${sessionCwd(sessionId)}`,
			'',
			'请只读上述坐标与执行记录,拿**已登记的判定标准**对照观测,给出裁决。',
			'准入只核验了「坐标存在且非空」——齐备不等于这一步做完了;判据里的断言(数值、口径、一致性)必须由你逐条核对。',
			'你不得修改任何文件,不得执行写入命令,不得重做方案。',
		].join('\n')
	}

	function normalizeVerdict(value) {
		const verdict = typeof value?.verdict === 'string' ? value.verdict.toLowerCase() : 'inconclusive'
		return {
			verdict: ['support', 'refute', 'inconclusive'].includes(verdict) ? verdict : 'inconclusive',
			basis: typeof value?.basis === 'string' && value.basis.trim() !== '' ? value.basis.trim() : '评估者未给出依据',
			shortfalls: Array.isArray(value?.shortfalls) ? value.shortfalls.filter((item) => typeof item === 'string') : [],
			reading: typeof value?.reading === 'string' && value.reading.trim() !== '' ? value.reading.trim() : null,
			validity: value?.validity === 'usable' || value?.validity === 'unusable' ? value.validity : null,
		}
	}

	function parseLooseJson(output) {
		const raw = (output ?? [])
			.filter((block) => block?.type === 'text')
			.map((block) => block.text)
			.join('\n')
		const match = raw.match(/\{[\s\S]*\}/)
		if (match === null) return { verdict: 'inconclusive', basis: '评估者没有返回可解析的裁决', shortfalls: ['card_unparsable'] }
		try {
			return JSON.parse(match[0])
		} catch {
			return { verdict: 'inconclusive', basis: '评估者的裁决无法解析', shortfalls: ['card_unparsable'] }
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
	 * 在没挂图像能力的部署里,侦察一派出就 fail-closed——「补一个只读工具」变成「打断整条侦察」。
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
	 * 派一次子 run —— 评估者与侦察共用的一条原语。
	 *
	 * 两件事在这里定死,调用方不用各写一遍:
	 *   · **能力降级链**:provider 支持哪些能力就用到哪一层(工具面 > 人格 > 结构化回包 > 只剩提示词),
	 *     降级事实随派遣一起落账 —— 不假装机制还在。
	 *   · **fail-closed**:派不出去就返回 ok:false,由调用方决定后果
	 *     (评估者:这一步不推进;侦察:缺口留着如实报告)。绝不静默降级成"没有独立裁决也算过"。
	 */
	async function dispatchSubRun(options) {
		const subagents = ctx.get('subagents')
		if (subagents === undefined) return { ok: false, reason: 'subagents 服务不可用', failures: [] }
		const base = { label: options.label, parent: options.parent, signal: options.signal, prompt: text(options.prompt) }
		const persona = options.persona
		const schema = options.outputSchema ?? undefined
		const toolFilter = options.toolFilter ?? null
		const failures = []
		/**
		 * **可续跑那一档放最前**(当调用方要的是「结论送达模型」时)。
		 *
		 * 它换来的是**原生结算通知**:运行时在子会话落定时把它的收尾消息投给父 agent
		 * (`notifySettlement`)。这正是异步子 run 此前缺的一环——结论只进账本,模型读不到。
		 *
		 * 两条边界,都是原生自己划的,不是我们挑的:
		 *   · 带 `outputSchema` 的调用**不走这一档**:durable 子会话的 descriptor 刻意不含它
		 *     (原话:它属于「一次性 activation 的结果契约」)。评估者/横评仲裁要的是当场解析的裁决,
		 *     改成可续跑是语义倒退;
		 *   · `persona` / `toolFilter` 会写进 durable descriptor,建时与冷恢复都从它重建 ——
		 *     侦察的只读面因此不会被续跑放宽(这是切换安全的前提,已核)。
		 *
		 * 拿不到这一档(无 `agents` 服务 = `CONTINUATION_UNAVAILABLE`,或后端无
		 * `prepareContinuable` = `UNSUPPORTED_CAPABILITY`)就照旧降级到一次性派遣,
		 * 失败原因进 `failures`,能力事实由调用方如实落账。
		 */
		if (schema === undefined && options.nativeDelivery === true) {
			try {
				const started = await subagents.startContinuable({
					provider: CFG.auditProvider,
					label: options.label,
					request: { ...base, ...(persona !== undefined ? { persona } : {}), ...(toolFilter !== null ? { toolFilter } : {}) },
					signal: options.signal,
				})
				const childId = String(started?.childId ?? '')
				if (childId === '') throw new Error('startContinuable 没有交出 childId')
				// 归一化:可续跑**没有** `run.result`(也没有 dispose)——结算由原生通知与子会话日志给出。
				return { ok: true, run: { id: childId, result: undefined, dispose: undefined }, capability: 'continuable', native: true }
			} catch (error) {
				const reason = `continuable:${String(error?.message ?? error).slice(0, 200)}`
				failures.push(reason)
				// 降级不是静默事件:它决定「结论由谁送达」,值得一行诊断日志。
				ctx.logger?.warn?.(`clearai kernel: 可续跑派遣不可用,降级到一次性派遣(${reason})`)
			}
		}
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
	 * 派一次独立评估,返回裁决 + 这次派遣要落的变更记录。
	 * 能力降级链:provider 支持哪些能力就用到哪一层,降级事实写进台账(不假装机制还在)。
	 */
	/**
	 * 把一条已落定的执行者结果折成变更(仍在跑就返回 null)。
	 *
	 * **这里不管「报过没有」**:发布的时机与重试由 sweep 按**投影**判断
	 * (「报过」不等于「到账本了」)。`dispose` 也挪到「确认到账」之后——早释放会把子会话
	 * 从会话服务里摘掉,而它正是回收结论的最后一份凭据。
	 */
	function collectExecutor(entry) {
		if (entry.settled === null) return null
		const ok = entry.settled.ok === true
		return {
			fork: entry.fork,
			branch: entry.branch,
			label: entry.label,
			// `note` 写**具体**的结局(aborted / error / …),不写笼统的 failed——与侦察那条路同一个纪律
			// (不分开的话,卡片会把 aborted 写成「执行没跑成:failed」——一句假话)。
			mutation: { t: 'worldline/executed', fork: entry.fork, branch: entry.branch, child: entry.child, ok, conclusion: clipConclusion(entry.settled.conclusion, entry.workspace ?? null), note: ok ? null : String(entry.settled.stopReason ?? 'failed') },
		}
	}

	/** 在执行的世界线执行者:childSessionId → 它被允许写的那份工作副本(路径限定用)。 */
	const executorRuns = new Map()
	/** 在跑的侦察:childSessionId → 它的条目(与 `executorRuns` 同一套纪律:派出去就登记,由 sweep 收结论)。 */
	const scoutRuns = new Map()
	/** 盘上残留读数扫过没有(签名 = 工作目录 + 当前分叉列表;变了才重扫,免得每个回合都读盘)。 */
	const residueScan = new Map()

	/**
	 * 每条世界线一条**独立子 run**:fresh context、只看得见自己的任务书、只写得进自己的工作副本。
	 * 「世界线互不通信」在这里是机制:它拿不到别的方案的上下文,也写不进别的目录。
	 */
	/**
	 * **只派遣,不等**:把执行者放出去、登记进表,立刻返回。
	 *
	 * 为什么必须分开:`ForkPlan` 若在这里
	 * `await Promise.all(四个执行者)`,而变更记录是**随工具结果**进日志的——
	 * 于是「长出四条世界线」这条事实要等四个执行者全部跑完才落账:
	 *   · 树上十几分钟看不到分叉(用户看到的就是这个窗口);
	 *   · **更要紧**:这段窗口里跑动一断,`fork/created` 永远不落账,而工作副本与执行者都真实存在
	 *     —— 事实丢了,续跑也就无从谈起。
	 * 事实该在副作用之前/同批落账,所以派遣**立即返回**;结论由 pre-step 的 sweep 收
	 * (与 `WorldlineStatus` 里那个收集器同一个),作为事实注入。
	 */
	async function startWorldlineExecutor(sessionId, agent, fork, branch, signal) {
		const mutations = []
		const brief = [
			WORLDLINE_EXECUTOR_PERSONA,
			'',
			'# 任务书(你的全部世界观)',
			'',
			`- 要裁决的分歧:${fork.question}`,
			`- **你这一个方案**:${branch.label} —— ${branch.approach}`,
			`- **判定标准(你必须做到,并且可被客观核对)**:${branch.done_criteria}`,
			`- 裁决指标:${fork.decide_by?.metric ?? '(未登记)'}(${fork.decide_by?.direction === 'min' ? '越小越好' : '越大越好'})`,
			`- 你的工作副本(读写都在这里面):${branch.workspace}`,
			'',
			'你不知道也不要去猜别的方案。做完就把**结论与产物路径**写进最终答复:',
			'关键数字落盘(报告/脚本/数据),别只在答复里说结论;遇到取舍取合理默认并注明假设。',
		].join('\n')
		const dispatched = await dispatchSubRun({
			label: `世界线执行者 · ${branch.label}`,
			persona: WORLDLINE_EXECUTOR_PERSONA,
			prompt: brief,
			outputSchema: null,
			toolFilter: { allow: resolveToolFace(agent, CFG.executorToolFilter) },
			parent: agent,
			signal,
			// 执行者的收尾消息就是它给模型的报告:与侦察同一条路——要原生结算通知送达。
			nativeDelivery: true,
		})
		if (dispatched.ok !== true) return { ok: false, note: `执行者派不出去(${dispatched.reason})`, mutations }
		const childId = String(dispatched.run.id)
		const entry = { fork: fork.id, branch: branch.id, label: branch.label, workspace: branch.workspace, child: childId, settled: null, reported: false, run: dispatched.run, native: dispatched.native === true }
		executorRuns.set(childId, entry)
		mutations.push({ t: 'worldline/executing', fork: fork.id, branch: branch.id, child: childId, capability: dispatched.capability, degraded_reason: dispatched.degraded ?? null })
		/**
		 * 先把结果挂上,再等:等超时了也不要紧——条目留在表里,WorldlineStatus 之后来收。
		 * 中断/报错是 resolve 带 stopReason(见 settleSubRun):不判它就会把「被打断的执行者」
		 * 记成「交付成功」,而世界线的算术会拿半截读数去比较。
		 *
		 * **可续跑那一档没有 `result` promise**(与侦察同一个形状):结算改由运行时的结算通知
		 * 或子会话日志给出,所以这里要会「没有」。
		 */
		if (dispatched.run?.result !== undefined) {
			entry.promise = dispatched.run.result.then(
				(value) => {
					const settled = settleSubRun(value)
					entry.settled = { ok: settled.ok, conclusion: settled.conclusion, stopReason: settled.stopReason }
					return entry.settled
				},
				(error) => {
					const settled = settleSubRun(undefined, error)
					entry.settled = { ok: false, conclusion: settled.conclusion, stopReason: settled.stopReason }
					return entry.settled
				},
			)
		}
		return { ok: true, mutations, entry, child: childId }
	}

	/**
	 * 收**已经落定**的执行者:把结论折成事实(每一条只收一次)。
	 *
	 * 两个调用者:pre-step 的 sweep(不问自答,结论自动回灌)与 `WorldlineStatus`(模型主动查)。
	 */
	/**
	 * **从执行者自己的会话日志里回收结论**(结论若只挂在父进程内存的 promise 上,父进程一断就永久丢)。
	 *
	 * 典型形态:四条执行者**都正常跑完了**(各自子会话日志最后一条都是 `turn/end{completed}`),
	 * 可父会话退出时只收上来一条 —— 另外三条的结论还在内存那个 `.then()` 上,进程一没就没了。
	 * 而结论**并没有丢**:它就写在执行者自己的会话日志里(DSH 的会话日志就是账本)。
	 * 「什么都不删」在这里的具体含义是:**没丢的东西不该当成丢了**。
	 *
	 * 所以收集分两级:
	 *   ① 内存表里有条目且已落定 → 照旧收(最快、带 stopReason);
	 *   ② 内存表里没有(重启过 / 从没等到扫的机会)→ **去它的会话里读**:最后一次 `turn/end`
	 *      的缘由 + 它最后一条 assistant 文本 = 结论文本。落同一条 `worldline/executed`,
	 *      `note` 写 `recovered`(来源可考:这不是猜的,是从账本里读回来的);
	 *   ③ 连会话都不在了(进程重启且子会话没重建)→ 才写 `lost`(如实说「失联」)。
	 *
	 * 平台边界:宿主的 `sessions` 服务只认**活在当前进程里**的会话(`get(id)`)。
	 * 所以③仍然存在——重启之后的旧结论要靠盘上的日志(人可查),这一层我们不假装能读。
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
	 * **没有回灌的执行者**:先看能不能从它自己的会话里回收结论,收不回来才写「失联」。
	 *
	 * 判据是两条已有事实的推论:**投影里在跑** + **这个进程的内存表里没有它的条目**。
	 * `lost` 与别的结局用同一个转变,只是缘由写具体(「失联」)——因为世界线的活没有丢:
	 * 执行者的产物还在它自己的工作副本里,模型可以照常 `AdvanceWorldline` 用那些产物交付。
	 */
	/**
	 * 收集器的**回合纪元**:纪元 = 当前回合号(`payload.turn`)。
	 *
	 * 为什么:投影**在回合内不前进**(本回合落的变更要等回合边界才折进去),所以
	 * 「投影里还没落地」在同一回合内**永远为真**;旧写法配的是「过了 2 秒就重发」,
	 * 于是每个成功路径都重发一遍(踩过的坑:1 次侦察派遣 ⇒ **31 条** `scout/settled`;
	 * 3 条世界线 ⇒ 14 条 `worldline/executed`),每次都还读一遍子会话日志,那一场跑了 8408s。
	 * 重发只该发生在**下一个回合**——那时投影才有机会说话。
	 *
	 * **但只收窄「重发」这一半**:下面那条「去子会话日志里捞结论」是**收集机会**,
	 * 它必须每个成功路径都留着 —— 按回合限流它,就会漏掉「这次收集之后才到」的结论
	 * (第一版就是这么把 3/3 掉成 2/3 的,真跑验收抓住的)。它按**时间窗口**限流,不按回合。
	 */
	const collectEpochs = new Map()
	/** 本窗口里已经从子会话日志捞过的侦察(会话:侦察 id → 上次尝试的毫秒数):限 I/O,不限机会。 */
	const recoverAttempts = new Map()
	function collectEpoch(sessionId) {
		return collectEpochs.get(String(sessionId)) ?? -1
	}
	function noteCollectTurn(sessionId, turn) {
		collectEpochs.set(String(sessionId), Number.isFinite(turn) ? Number(turn) : collectEpoch(sessionId) + 1)
	}

	function sweepLostExecutors(state, sessionId) {
		const mutations = []
		let recovered = 0
		let lost = 0
		for (const fork of state?.forks ?? []) {
			/**
			 * 分叉已经收口(收敛/放弃)时**不再写「失联」**——那条世界线已经没有归宿,
			 * 把「没人再等它」写成「它没跑成」是记错了事实。但**回收照做**:结论是账本里的东西,
			 * 与「它还有没有用」无关(回收到了,卡片就从「执行者未归」变成「已回灌」)。
			 */
			const terminal = fork.abandoned === true || fork.settled === true
			for (const branch of fork.branches ?? []) {
				const execution = branch.execution ?? null
				if (execution === null || execution.ok !== null) continue
				const child = execution.child === null || execution.child === undefined ? null : String(execution.child)
				const entry = child === null ? undefined : executorRuns.get(child)
				/**
				 * **表里有条目但还没落定**时也要试着回收(形态:四条执行者都跑完了,
				 * 表里那条 promise 却没落定,于是「有条目」把回收挡住了,那条世界线永久停在「执行者未归」)。
				 * 判据不看内存表,看**执行者自己的会话日志**:它写了 `turn/end`,结论就存在了。
				 * 回收成功就把条目标成已报,免得那份 promise 之后落定时又报一次(一条事实一份账)。
				 */
				if (entry !== undefined && entry.settled !== null) continue
				const found = child === null ? null : recoverFromChildSession(child)
				if (found !== null) {
					recovered += 1
					/**
					 * 回收成功就要把条目标成**已落定 + 已发布**。只标 `reported` 不够:
					 * 可续跑那一档没有 promise,条目永远停在 `settled === null`,于是每一拍回收
					 * 都成功、每一拍都重发同一条事实(真跑里会看到「回灌 20 条结论」这种数)。
					 */
					if (entry !== undefined) {
						entry.settled = { ok: found.ok, conclusion: found.conclusion, stopReason: found.stopReason }
						entry.reported = true
						entry.reportedEpoch = collectEpoch(sessionId)
						entry.reportedAt = Date.now()
					}
					mutations.push({
						t: 'worldline/executed',
						fork: fork.id,
						branch: branch.id,
						child,
						ok: found.ok,
						conclusion: clipConclusion(found.conclusion, branch.workspace ?? null),
						note: found.ok ? 'recovered' : found.stopReason,
					})
					continue
				}
				// 会话里没有 `turn/end`(它真的还在跑):不动它,也不冤枉它。
				if (entry !== undefined) continue
				if (terminal) continue
				lost += 1
				mutations.push({
					t: 'worldline/executed',
					fork: fork.id,
					branch: branch.id,
					child,
					ok: false,
					conclusion: '',
					note: 'lost',
				})
			}
		}
		return { mutations, recovered, lost }
	}

	/**
	 * **收侦察的结论**。
	 *
	 * 两级,和 `sweepLostExecutors` 同一套:
	 *   ① 表里已落定的 → 落 `scout/settled`;正常结束且结论非空 → 再落一条 `observation/recorded`(资料面);
	 *   ② 表里没有(进程重启过 / 从来没等到扫的机会)→ 去**它自己的会话日志**里读结论:
	 *      投影里那条侦察还停在「跑着」,而它的会话里已经有 `turn/end` —— 那就是结论。
	 *      没有条目的那条路用 `state.scouts` 里 status='running' 且带 child 的记录来认。
	 */
	function sweepScouts(state, sessionId) {
		const mutations = []
		const lines = []
		const emitted = new Set()
		/**
		 * **还在跑的侦察数**:`AwaitWorldlines` 靠它决定要不要继续等。
		 *
		 * 少了这个数,「等侦察」就是一句空话:`AwaitWorldlines` 的循环只数世界线执行者产出的
		 * 「仍在跑」行,而侦察从来不产那行 ⇒ 只有侦察在跑时 `running` 恒为 0,循环**第一拍就退出**,
		 * 于是模型被告知「用 AwaitWorldlines 在这个回合里等它」却永远等不到。
		 */
		let pending = 0
		/** 本次刚收到的结论(给「没有原生通知」那一档用:收集那一刻的返回里带上它们)。 */
		const notices = []
		/** 判成「失联」的条数(与执行者那条同名的账,面板与注记都要说得出)。 */
		let lost = 0
		const publish = (scoutId, stepId, ok, conclusion, stopReason, meta = {}) => {
			const full = String(conclusion ?? '')
			/**
			 * **全文落盘**。一条事实有三个当事人:下达侦察的模型、独立评估者、人。
			 * 结论此前只活在账本折叠出的资料面里(只有面板读),于是判据写成
			 * 「与侦察结论一致」时模型与评估者都无处可读。落进 `clear/` 之内,
			 * 三者都能读;账本仍是真值源,这份文件是投影产物。
			 */
			const path = ok && full.trim() !== '' ? persistMaterial(sessionId, scoutId, meta, full) : null
			// 账本与观测**同一个上限、同一句截断标记**(超出时必须说清全文在哪):
			// 同一个数在几处各写一遍,迟早会漂成两套口径。
			const clipped = clipConclusion(full, path)
			mutations.push({ t: 'scout/settled', id: scoutId, step: stepId, conclusion: clipped, note: ok ? null : String(stopReason ?? 'failed'), path })
			if (ok && full.trim() !== '') {
				mutations.push({
					t: 'observation/recorded',
					id: `m-${Math.random().toString(36).slice(2, 8)}`,
					ref: `scout:${scoutId}`,
					source: 'scout',
					digest: null,
					bytes: full.length,
					note: clipped,
					path,
					step: stepId ?? null,
				})
			}
			if (ok && full.trim() !== '') notices.push({ kind: 'scout', id: scoutId, trigger: meta.trigger ?? null, conclusion: full, path, native: meta.native === true })
		}
		/** 投影里这条侦察收到结论了吗(`scout/settled` 折进去之后 `conclusion` 就不再是 null)。 */
		const landedIn = (scoutId) => {
			const record = (state?.scouts ?? []).find((item) => item.id === scoutId)
			return record !== undefined && record.conclusion !== null && record.conclusion !== undefined
		}
		for (const entry of scoutRuns.values()) {
			// 已经落到账本上了:这条子 run 退休(摘表 + 释放),免得表无限长。
			if (landedIn(entry.scoutId)) {
				scoutRuns.delete(entry.child)
				try {
					void entry.run?.dispose?.().catch?.(() => {})
				} catch {
					/* dispose 失败不影响结论 */
				}
				continue
			}
			if (entry.settled === null) {
				/**
				 * **没有 `result` promise 的那一档(可续跑)只能从子会话日志里读结论**。
				 * 不走这一步,条目会永远停在「未落定」,而路径②又因为「表里有条目」跳过它
				 * ——结论永久收不上来(修回灌时踩过的同一个坑,换了个入口)。
				 * 读不到就按「还在跑」计一票,让等待循环继续等。
				 */
				// 运行时已经宣告它落定 ⇒ 直接用那条通知(与模型读到的是同一份文本)。
				const announced = noticeFor(state, sessionId, entry.child)
				if (announced !== null) {
					entry.settled = { ok: announced.ok, conclusion: announced.conclusion, stopReason: announced.stopReason }
				} else {
					const found = recoverScoutConclusion(sessionId, entry.scoutId, entry.child)
					if (found === null) {
						pending += 1
						continue
					}
					entry.settled = { ok: found.ok, conclusion: found.conclusion, stopReason: found.stopReason }
				}
			}
			/**
			 * **`reported` 不等于「已落账」**(失效模式:侦察结论发布之后被丢掉,
			 * 而条目已删、`reported` 已置位 ⇒ 那条结论永久丢)。判据改成看**投影**:
			 * 投影里还没落地,过了重试窗口就**再发一次**。重复发布是安全的——
			 * fold 按 id 找记录、覆写同样的字段,不会长出第二条事实。
			 */
			// 同一个回合内不重发(投影在回合内不前进,再发也是白发);跨回合仍不见落地才补发。
			if (entry.reported === true && entry.reportedEpoch === collectEpoch(sessionId)) continue
			entry.reported = true
			entry.reportedEpoch = collectEpoch(sessionId)
			entry.reportedAt = Date.now()
			emitted.add(entry.scoutId)
			publish(entry.scoutId, entry.stepId, entry.settled.ok === true, entry.settled.conclusion, entry.settled.stopReason, { trigger: entry.trigger, digest: entry.digest, child: entry.child, native: entry.native === true })
			lines.push(`侦察 · ${entry.trigger}:${entry.settled.ok === true ? '完成' : `未完成(${entry.settled.stopReason ?? 'unknown'})`}`)
		}
		// ② 表里没有的:投影里**还没收口**的侦察(`scout/dispatched` 落了,`scout/settled` 没落),
		//    去它自己的会话日志里读结论(进程重启过也收得回来)。
		for (const scout of state?.scouts ?? []) {
			if (scout.conclusion !== null && scout.conclusion !== undefined) continue
			if (emitted.has(scout.id)) continue
			const child = scout.child === null || scout.child === undefined ? null : String(scout.child)
			if (child === null || scoutRuns.has(child)) continue
			/**
			 * 这条是**收集机会**,不是重发:迟到一步的结论全靠它接住(第一版把它按回合限流,
			 * 真跑里立刻掉了一条回灌)。所以限流只针对 **I/O**:同一个窗口里对同一条只读一次。
			 */
			const found = recoverScoutConclusion(sessionId, scout.id, child)
			if (found !== null) {
				publish(scout.id, scout.step ?? null, found.ok === true, found.conclusion, found.stopReason, { trigger: scout.trigger ?? null, digest: scout.digest ?? null, child, native: scout.capability === 'continuable' })
				lines.push(`侦察 · ${scout.trigger ?? scout.id}:从会话日志回收(${found.ok === true ? '完成' : found.stopReason})`)
				continue
			}
			/**
			 * 这一次捞不到 ≠ 永远捞不到:它是**收集机会**,不是判决。
			 * 「失联」是另一件事(子会话真的不在了),由回合边界的
			 * `sweepLostScouts()` 用**原生子代理目录**判——判据不该混在一起,
			 * 混在一起会把「迟到一步的结论」冤杀成失联(真跑里立刻掉一条回灌)。
			 */
		}
		return { mutations, lines, pending, notices, lost }
	}

	/**
	 * **失联的侦察**。判据与评估者那条**逐字同构**(`sweepLostAudits`):
	 *   · 只看投影里还没收口的;
	 *   · 本进程攥着的那几次派遣是活的,**不问目录**;
	 *   · 问原生子代理目录:还在跑的不动;
	 *   · 目录里不在跑、结论又收不回来 ⇒ 如实落「失联」终局(一句永久「未回灌」是等不到下文的承诺);
	 *   · 目录拿不到 ⇒ **不判**(判不出就不编)。
	 * 为什么放回合边界而不是每次收集都判:目录是异步读面,而「这次没捞到」不等于「永远捞不到」。
	 */
	/**
	 * 子会话日志里**有几条事件**。判不出回 `null`(读面不可用)——**不编**:
	 * 「一片空白」与「读不到」是两回事,前者说明结论永远不会来,后者什么也说明不了。
	 */
	function childSessionEventCount(childId) {
		const sessions = ctx.get('sessions')
		if (sessions === undefined || typeof sessions.get !== 'function') return null
		try {
			const session = sessions.get(childId)
			if (session === null || session === undefined) return 0
			const events = typeof session.ownEvents === 'function' ? session.ownEvents() : []
			return Array.isArray(events) ? events.length : 0
		} catch {
			return null
		}
	}

	async function sweepLostScouts(sessionId, state, justSettled = new Set()) {
		// `justSettled`:这一拍**刚刚**收上来的(还在同一批 `factMutations` 里,投影尚未前进)。
		// 不排除它们,就会把刚落定的结论再判成「失联」——自己和自己打架,还把那一条结论写没。
		const pending = (state?.scouts ?? []).filter(
			(scout) => (scout.conclusion === null || scout.conclusion === undefined) && typeof scout.child === 'string' && scout.child !== '' && !justSettled.has(scout.id),
		)
		if (pending.length === 0) return { mutations: [], lost: 0, lines: [] }
		const known = new Set([...scoutRuns.values()].map((entry) => String(entry.child ?? '')))
		const unresolved = pending.filter((scout) => !known.has(String(scout.child)))
		if (unresolved.length === 0) return { mutations: [], lost: 0, lines: [] }
		const subagents = ctx.get('subagents')
		if (subagents === undefined || typeof subagents.listChildren !== 'function') return { mutations: [], lost: 0, lines: [] }
		let children = []
		try {
			children = await subagents.listChildren(sessionId)
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 列子代理失败,本次不判侦察失联 ${String(error?.message ?? error).slice(0, 120)}`)
			return { mutations: [], lost: 0, lines: [] }
		}
		const running = new Set((Array.isArray(children) ? children : []).filter((item) => item?.kind === 'child' && item.activity === 'running').map((item) => String(item.id)))
		const listed = new Set((Array.isArray(children) ? children : []).filter((item) => item?.kind === 'child').map((item) => String(item.id)))
		const mutations = []
		const lines = []
		for (const scout of unresolved) {
			const child = String(scout.child)
			if (running.has(child)) continue
			/**
			 * 目录里**没有**这个子会话时,不能立刻判死:可能它刚派出、注册表还没认领。
			 * 退回**它自己的日志**判——一片空白 ⇒ 结论永远不会来了,如实落失联;
			 * 有事件却没有 `turn/end` ⇒ 还在跑,不动它。(目录里**有**它、但不在跑,
			 * 那就是注册表也认它已经结束 ⇒ 直接判失联。)
			 */
			if (!listed.has(child) && childSessionEventCount(child) !== 0) continue
			mutations.push({ t: 'scout/settled', id: scout.id, step: scout.step ?? null, conclusion: '', note: '失联', path: null })
			lines.push(`${scout.trigger ?? scout.id}:侦察失联(子会话已不在跑,结论收不回来)`)
		}
		return { mutations, lost: mutations.length, lines }
	}

	/**
	 * 运行时**已经宣告它落定**了吗。
	 *
	 * 原生的结算通知落在**父会话自己的日志**里(`source.kind === 'subagent-settled'`,带子会话 id
	 * 与它的收尾消息)。用它当结算信号有两个好处:省一次「去子会话日志里捞」的 I/O,
	 * 而且**模型读到的正文**与**账本记的结论**来自同一条信息——两处不会各说各话。
	 *
	 * `ok` 只能从摘要那句英文里读(运行时自己的格式,版本变了要跟着改);结论正文不受影响。
	 */
	function noticeFor(state, sessionId, child) {
		if (child === null || child === undefined) return null
		/**
		 * 先看投影,再看**父会话自己的日志**。
		 *
		 * 为什么要兜这一层:投影是给面板读的,它在一轮之内**可能还没前进**——而通知是运行时刚投
		 * 进来的。账本不能等投影(实测:通知在事件 31、最后一次收集在事件 107,投影里却还是空的,
		 * 于是侦察永远收不了口)。两处解析同一形状的通知,是分层纪律的代价(两个平面互不 import),
		 * 与 fold 里那份等价实现同一个理由。
		 */
		const notice = (state?.notices ?? []).find((item) => String(item?.child ?? '') === String(child)) ?? ownNotices(sessionId).find((item) => String(item?.child ?? '') === String(child))
		if (notice === undefined) return null
		const summary = String(notice.summary ?? '')
		const abnormal = /failed|declined|stopped|abnormally|ran out of room/i.test(summary)
		const conclusion = String(notice.conclusion ?? '').trim()
		return { ok: !abnormal, stopReason: abnormal ? 'abnormal' : 'completed', conclusion: conclusion === '' ? summary : conclusion, from: 'notice' }
	}

	/** 父会话自己的日志里折出来的结算通知(按事件条数缓存,避免每拍重读)。 */
	const noticeCache = new Map()
	function ownNotices(sessionId) {
		const sessions = ctx.get('sessions')
		if (sessions === undefined || typeof sessions.get !== 'function') return []
		let events = []
		try {
			const session = sessions.get(String(sessionId))
			events = typeof session?.ownEvents === 'function' ? session.ownEvents() : []
		} catch {
			return []
		}
		if (!Array.isArray(events)) return []
		const key = String(sessionId)
		const cached = noticeCache.get(key)
		if (cached !== undefined && cached.count === events.length) return cached.notices
		const notices = []
		for (const event of events) {
			if (event?.type !== 'user/message') continue
			const source = event.data?.source
			if (source === null || typeof source !== 'object' || source.kind !== 'subagent-settled') continue
			const blocks = (event.data?.content ?? []).filter((block) => block?.type === 'text').map((block) => String(block.text ?? ''))
			const label = blocks.findIndex((text) => /closing message/i.test(text))
			notices.push({
				child: source.senderSessionId === null || source.senderSessionId === undefined ? null : String(source.senderSessionId),
				summary: String(source.summary ?? blocks[0] ?? ''),
				conclusion: (label === -1 ? blocks.slice(1) : blocks.slice(label + 1)).join('\n').trim(),
				at: typeof event.time === 'number' ? event.time : null,
			})
		}
		noticeCache.set(key, { count: events.length, notices })
		return notices
	}

	/**
	 * 从子会话日志里捞一次侦察结论(**限 I/O** 不限机会:同一个窗口里对同一条只读一次)。
	 *
	 * 为什么按时间窗口限流而不按回合:这条是**收集机会**,不是重发。按回合限它,
	 * 就会漏掉「这次收集之后才到」的结论——第一版这么干过,真跑里立刻掉了一条回灌。
	 */
	function recoverScoutConclusion(sessionId, scoutId, child) {
		if (child === null || child === undefined) return null
		const recoveryKey = `${String(sessionId)}:${scoutId}`
		const lastTry = Number(recoverAttempts.get(recoveryKey) ?? 0)
		if (Date.now() - lastTry < CFG.collectRetryMs) return null
		recoverAttempts.set(recoveryKey, Date.now())
		return recoverFromChildSession(String(child))
	}

	/**
	 * **失联的评估者**。
	 *
	 * `pendingAudits` 是**进程内**的:重启之后它空了,而投影里那条 `audit/dispatched` 还在
	 * (`verdict === null`)。后果有两条,后一条更狠:
	 *   ① 卡片与面板永远写「正在裁决」——一句等不到下文的承诺;
	 *   ② `turnDemand` 见到未落定的裁决就 `hold`(**「机器等待,不推」**)——
	 *      一条永远不会回来的裁决,把整个目标按死在挂起上。
	 *
	 * 判据不看内存,看**宿主的目录**:`subagents.listChildren(sessionId)` 给每个子会话一个
	 * `activity: 'running' | 'inactive'`(还在跑 / 只剩日志),而且它不需要把子代理加载起来。
	 * 投影里在裁决 + 子会话不在跑 ⇒ 落一条 `audit/settled{verdict:'unknown', note:'lost'}`:
	 * 与别的结局用同一个转变,只是缘由写具体(「失联」)。下一次交付会重新派评估者。
	 *
	 * 拿不到目录(服务不在 / 查询失败)时**什么都不做**:不猜、不误伤正在跑的裁决。
	 */
	async function sweepLostAudits(sessionId, state) {
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
			mutations.push({
				t: 'audit/settled',
				id: audit.id,
				step: audit.step,
				verdict: 'unknown',
				basis: '评估者失联:派它的那次进程已经不在了,子会话也不在跑——这次裁决不会有结果。重新交付这一步会派一个新的评估者。',
				shortfalls: ['auditor_lost'],
				card_path: null,
			})
			lines.push(`${audit.step}:裁决失联(记为 unknown,可重新交付)`)
		}
		return { mutations, lost: mutations.length, lines }
	}

	function sweepWorldlineExecutors(state, sessionId) {
		const mutations = []
		const lines = []
		/** 本次刚收到的执行者报告(降级形态靠它送达:有原生通知时这一项不被使用)。 */
		const notices = []
		/** 投影里这条世界线的执行者收到了结论吗(`execution.ok` 不再是 null)。 */
		const landedIn = (forkId, branchId) => {
			const fork = (state?.forks ?? []).find((item) => item.id === forkId)
			const branch = fork === undefined ? undefined : (fork.branches ?? []).find((item) => item.id === branchId)
			const execution = branch?.execution ?? null
			return execution !== null && execution.ok !== null
		}
		for (const entry of executorRuns.values()) {
			if (landedIn(entry.fork, entry.branch)) {
				// 到账了才退休:释放子 run(它已经没有用处)。
				if (entry.reported !== 'landed') {
					entry.reported = 'landed'
					try {
						void entry.run?.dispose?.().catch?.(() => {})
					} catch {
						/* dispose 失败不影响结论 */
					}
				}
				continue
			}
			if (entry.settled === null) {
				// 与侦察同一条:先看运行时的结算通知,再退回子会话日志。
				const announced = noticeFor(state, sessionId, entry.child)
				if (announced === null) {
					lines.push(`${entry.label}:仍在跑`)
					continue
				}
				entry.settled = { ok: announced.ok, conclusion: announced.conclusion, stopReason: announced.stopReason }
			}
			/**
			 * 与侦察同一条纪律:**`reported` 不等于「已落账」**。投影里还没落地,过了重试窗口就再发一次
			 * (`worldline/executed` 按分支覆写,重复发布不会长出第二条事实)。
			 */
			// 与侦察同一条判据:同回合不重发,跨回合仍不见落地才补发。
			if (entry.reported === true && entry.reportedEpoch === collectEpoch(sessionId)) continue
			entry.reported = true
			entry.reportedEpoch = collectEpoch(sessionId)
			entry.reportedAt = Date.now()
			const collected = collectExecutor(entry)
			if (collected === null) continue
			mutations.push(collected.mutation)
			lines.push(`${entry.label}:${collected.mutation.ok === true ? '完成' : `未完成(${collected.mutation.note ?? 'unknown'})`}`)
			if (collected.mutation.ok === true && String(entry.settled.conclusion ?? '').trim() !== '') {
				notices.push({ kind: 'worldline', id: entry.branch, trigger: entry.label, conclusion: String(entry.settled.conclusion), path: entry.workspace ?? null, native: entry.native === true })
			}
		}
		return { mutations, lines, notices }
	}

	/**
	 * 一条侦察任务的**身份**:锚定的步 + 任务原文(空白归一)。
	 *
	 * 为什么要它:没有它,中途被打断之后再跑,所有侦察**从头重派**——
	 * 已经正常回灌过的那些也白跑一遍。任务原文相同 = 同一件事,认出来就能复用它的结论。
	 * 身份里带锚定的步:同一个问法落在不同的步上,是两件事。
	 */
	function scoutDigest(stepId, brief) {
		const normalized = String(brief ?? '').replace(/\s+/g, ' ').trim()
		return createHash('sha256').update(`${String(stepId)}\n${normalized}`).digest('hex').slice(0, 16)
	}

	/**
	 * 这个任务**已经正常回灌过**吗?是就把结论拿回来,不再重跑。
	 *
	 * 复用规则(刻意保守):
	 *   · 只复用 `note === null`(正常结束)且结论非空的那些;
	 *   · 被中断 / 失败 / 仍在跑的,一律重派——正是用户要的「中断的应该继续/重试」;
	 *   · 认最新的一条。
	 * 为什么不做超时过期:任务原文一样就是同一件事,人/模型想重跑就改一个字(工具描述里写明)。
	 */
	function reuseScout(state, digest) {
		const matched = (state.scouts ?? []).filter((scout) => scout.digest === digest)
		for (let index = matched.length - 1; index >= 0; index -= 1) {
			const scout = matched[index]
			if ((scout.note ?? null) === null && typeof scout.conclusion === 'string' && scout.conclusion.trim() !== '') return scout
		}
		return null
	}

	/** 侦察的子 run:只读、fresh context、无人盯(与评估者共用同一条派遣原语)。 */
	async function runScout(sessionId, agent, plan, step, brief, trigger, signal) {
		const mutations = []
		const digest = scoutDigest(step.id, brief)
		// ① 先看这件事是不是**已经正常回灌过**:是就复用,不重跑(幂等派遣)。
		const reusedFrom = reuseScout(stateOf(sessionId), digest)
		if (reusedFrom !== null) {
			return { ok: true, conclusion: reusedFrom.conclusion, reused: true, digest, from: reusedFrom.id, mutations }
		}
		const scoutId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		const dispatched = await dispatchSubRun({
			label: `侦察 · ${trigger} · ${step.id}`,
			persona: SCOUT_PERSONA,
			prompt: [
				SCOUT_PERSONA,
				'',
				'# 侦察任务书(Harness 派发)',
				'',
				`- 锚在哪一步:${step.id}(${step.do})`,
				`- 这一步的判据:${step.done_criteria}`,
				`- 派遣缘由:${trigger}`,
				'',
				'# 要你去查的缺口',
				brief === '' ? '(评估者没给具体缺口:请找出这一步还差哪些一手证据)' : brief,
				'',
				`工作目录:${sessionCwd(sessionId)}`,
				'',
				'只读上述范围,把**结论**作为最终答复回灌(不是过程流水账)。查不到就如实说查过哪里。',
			].join('\n'),
			outputSchema: null,
			toolFilter: { allow: resolveToolFace(agent, CFG.scoutToolFilter) },
			parent: agent,
			signal,
			// 侦察的结论就是它的全部价值:要原生结算通知把它送进模型上下文。
			nativeDelivery: true,
		})
		if (dispatched.ok !== true) {
			// 侦察失败不该挡住主循环:它只是"本可以去查的缺口",如实回报即可
			return { ok: false, note: `侦察派不出去(${dispatched.reason})`, mutations }
		}
		const childId = String(dispatched.run.id)
		mutations.push({ t: 'scout/dispatched', id: scoutId, step: step.id, plan: plan?.id ?? null, goal: step.goal ?? null, trigger, child: childId, capability: dispatched.capability, digest, degraded_reason: dispatched.degraded ?? null })
		/**
		 * **派出去就返回**(与「世界线执行者」同一个病,同一个修法)。
		 *
		 * 原来这里 `await Promise.race([结论, 240s 超时])`,而 `scout/dispatched` 是**随工具结果**
		 * 进日志的 —— 于是这 240 秒里跑动一断(用户打断、进程退出、模型换路),「派过侦察」这条事实
		 * 就没了,而侦察子 run 真的在跑;超时那条路更糟:它落一条 `settled{note:'仍在跑'}` 之后
		 * **没有任何人会再收它的结论**(promise 还在,但没人等)。
		 *
		 * 事实该在副作用之前/同批落账:所以派遣立即返回,结论由 `sweepScouts()` 在
		 * 「下一个回合边界 / 用到世界线与侦察的那几件工具」上收(与执行者完全同一套)。
		 */
		const entry = { scoutId, stepId: step.id, planId: plan?.id ?? null, trigger, digest, child: childId, settled: null, reported: false, run: dispatched.run, native: dispatched.native === true }
		scoutRuns.set(childId, entry)
		/**
		 * 只有一次性派遣才有 `result` promise。可续跑那一档没有 ⇒ 结算改由
		 * `sweepScouts()` 从**子会话自己的日志**里读(它本来就更权威,也是重启后唯一的路)。
		 */
		if (dispatched.run?.result !== undefined) {
			entry.promise = dispatched.run.result.then(
			(value) => {
				const settled = settleSubRun(value)
				entry.settled = { ok: settled.ok, conclusion: settled.conclusion, stopReason: settled.stopReason }
				return entry.settled
			},
			(error) => {
				const settled = settleSubRun(undefined, error)
				entry.settled = { ok: false, conclusion: settled.conclusion, stopReason: settled.stopReason }
				return entry.settled
			},
			)
		}
		return { ok: true, pending: true, conclusion: '', note: null, digest, mutations, child: childId, scoutId }
	}

	async function runEvaluator(sessionId, agent, plan, step, gate, kind, signal) {
		const mutations = []
		const auditKey = `a-${step.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
		const key = `${sessionId}:${kind}:${step.id}`
		let entry = pendingAudits.get(key)
		if (entry === undefined) {
			const dispatched = await dispatchSubRun({
				label: `${kind === 'goal_audit' ? '目标评估者' : kind === 'worldline_audit' ? '世界线评估者' : '评估者'} · ${step.id}`,
				persona: EVALUATOR_DISCIPLINE,
				prompt: evaluatorPrompt(stateOf(sessionId), step, gate, sessionId),
				outputSchema: VERDICT_SCHEMA,
				toolFilter: { allow: resolveToolFace(agent, CFG.auditToolFilter) },
				parent: agent,
				signal,
			})
			if (dispatched.ok !== true) {
				return { verdict: 'unknown', basis: `独立评估者无法派遣(${dispatched.reason})`, shortfalls: ['audit_dispatch_failed'], cardPath: null, mutations }
			}
			mutations.push({ t: 'audit/dispatched', id: auditKey, step: step.id, plan: plan?.id ?? 'goal', kind, evaluator_session: String(dispatched.run.id), capability: dispatched.capability })
			entry = { run: dispatched.run, capability: dispatched.capability, auditKey, settled: undefined }
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
			return { verdict: 'pending', basis: `评估者仍在跑(${Math.round(CFG.auditTimeoutMs / 1000)}s 未回)`, shortfalls: ['audit_pending'], cardPath: null, mutations }
		}
		// 已落定:这次派遣的生命周期到此为止。下一次交付是**新的一次评估**(新证据),必须重新派遣。
		pendingAudits.delete(key)
		if (outcome.ok !== true) {
			return { verdict: 'unknown', basis: `评估者失败:${String(outcome.error?.message ?? outcome.error)}`, shortfalls: ['audit_failed'], cardPath: null, mutations }
		}
		const settled = outcome.value
		const stopReason = String(settled?.stopReason ?? 'completed')
		if (stopReason !== 'completed' && settled?.structured === undefined) {
			return { verdict: 'unknown', basis: `评估者未正常结束(${stopReason})`, shortfalls: ['audit_incomplete'], cardPath: null, mutations }
		}
		const verdict = settled?.structured !== undefined ? normalizeVerdict(settled.structured) : normalizeVerdict(parseLooseJson(settled?.output))
		try {
			await entry.run.dispose?.()
		} catch {
			/* dispose 失败不影响裁决事实 */
		}
		const card = { schema_version: 'clearai.audit.v1', kind, step_id: step.id, auditor_run_id: String(entry.run.id), verdict: verdict.verdict, shortfalls: verdict.shortfalls, card: verdict.basis, created_at: Date.now() }
		const cardPath = writeAuditCard(sessionId, step.id, card)
		if (cardPath === null) {
			return { verdict: 'unknown', basis: '评估卡落盘失败:裁决降级', shortfalls: ['card_persist_failed'], cardPath: null, mutations }
		}
		mutations.push({ t: 'audit/settled', id: entry.auditKey, step: step.id, verdict: verdict.verdict, basis: verdict.basis, shortfalls: verdict.shortfalls, card_path: cardPath })
		return { ...verdict, cardPath, mutations }
	}

	/** 评估卡落盘(系统的面)。写不进 → 返回 null,调用方 fail-closed。 */
	function writeAuditCard(sessionId, stepId, card) {
		const file = join(sessionCwd(sessionId), 'clear', 'evidence', 'audits', String(stepId), `${String(card.auditor_run_id)}.json`)
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

	/**
	 * 「该收口哪个分叉」的目标步。
	 *
	 * 洞长这样:`AbandonFork`/`ConvergeFork` 都在 `firstOpenStep` 上取步。步骤一旦被作废,
	 * 它就不再是「第一个未落定步」——于是挂在上面的未收口分叉**既不能收敛也不能放弃**,
	 * 工作副本永久留在盘上(形态:`lab/` 被声明成物证 → 准入拒 → 模型作废该步改道,
	 * 两条世界线就此失联)。
	 *
	 * 收口的判据(「只落事实 + 放开可达性」):
	 *   · 常规:目标步 = 第一个未落定步(不带 step_id 时的默认);
	 *   · 例外:**已作废**的步,且它上面的分叉还没收口(没收敛、没放弃)——允许显式收口。
	 *     **只允许放弃**,不允许把成果并进一个已经撤回的承诺(交付必须有归宿)。
	 * 这条不改变任何已完成的事实,只是把「没有出口」变成「有出口」。
	 */
	function closableStep(plan, stepId) {
		if (plan === null) return { step: null, orphan: false }
		if (stepId === undefined || stepId === null || stepId === '') {
			return { step: firstOpenStep(plan), orphan: false }
		}
		const step = plan.steps.find((item) => item.id === stepId) ?? null
		if (step === null) return { step: null, orphan: false }
		if (step.status === 'void') return { step, orphan: true }
		const first = firstOpenStep(plan)
		if (first !== null && step.id === first.id) return { step, orphan: false }
		return { step: null, orphan: false }
	}

	function forkOfStep(derivedForks, stepId) {
		return derivedForks.find((fork) => fork.step === stepId) ?? null
	}

	/**
	 * **用到世界线的地方先收一次**结论。
	 *
	 * 原来只有 pre-step 的 sweep 收结论。可一次真跑里整条链(ForkPlan → 四条交付 → 收敛 → 交付
	 * → 收尾)可能**全在一个回合内**走完,中间根本没有回合边界——于是三条执行者跑完了、
	 * 产物也写了、甚至分叉都收敛了,`worldline/executed` 却**从来没落账**:
	 * 卡片对着一条已经采纳的世界线说「(执行中,结论会自动回灌)」,那是一句永久的假话。
	 *
	 * 修法合乎第一性原理:**谁要用这条事实,谁负责把它收上来**。交付、收敛、放弃、收尾
	 * 都要先收——它们本来就只能在结论回来之后才做得对。
	 */
	/**
	 * **成功返回前**收一次结论,两级都收。
	 *
	 * 为什么必须在成功路径上收(而不是入口处):`collectExecutor` 一收就置 `reported = true`,
	 * 而失败的返回(`fail(...)`)不带走 `mutations` —— 在入口处收,一旦这次调用失败,
	 * 结论就**永久丢了**(没人会再收它)。放在成功返回前收,失败时它们原封不动留到下一次。
	 *
	 * 为什么两级一起收(只收一级时,四条执行者只收上来一条):
	 * 内存表是**尽力而为**的——表里没有、或者扫的时候它还没落定的那些,答案在**执行者自己的
	 * 会话日志**里。所以每个「结果会用到世界线」的返回点都顺手做一次回收:
	 * 交付、收敛、收尾、以及两件观察工具。少收一条就是少一条结论叙事,而它是可回收的。
	 */
	function collectExecutors(mutations, state, sessionId) {
		const swept = sweepWorldlineExecutors(state, sessionId)
		mutations.push(...swept.mutations)
		const late = sweepLostExecutors(state, sessionId)
		mutations.push(...late.mutations)
		// 侦察同一套:它也是「派出去就不等」的子 run,结论同样由这里收。
		const scouts = sweepScouts(state, sessionId)
		mutations.push(...scouts.mutations)
		return {
			lines: [...swept.lines, ...scouts.lines],
			recovered: late.recovered,
			lost: late.lost,
			scouts: scouts.mutations.length,
			scoutsPending: scouts.pending,
			scoutsLost: scouts.lost,
			// 本次刚收到的结论:有原生通知的那一档由运行时投递,这里只带「没有原生通知」的那些。
			notices: [...(swept.notices ?? []), ...(scouts.notices ?? [])],
		}
	}

	/** 结论正文进消息时的上限(账本、文件、消息三处同一个数;文件里是全文)。 */
	const CONCLUSION_CHARS = 4000

	/** 正文进消息时的截断标记:不许静默截断——读者要知道自己拿到的是不是全文。 */
	function clipConclusion(text, path) {
		const full = String(text ?? '')
		if (full.length <= CONCLUSION_CHARS) return full
		return `${full.slice(0, CONCLUSION_CHARS)}\n…已截断(全文 ${full.length} 字${path === null || path === undefined ? '' : `,见 ${path}`})`
	}

	/**
	 * 「没有原生通知」那一档的送达:把**本次刚收到**的结论正文拼进这次工具返回。
	 *
	 * 有原生通知时**不拼**——运行时已经把它投给模型了,同一段话出现两遍是这个仓库
	 * 一直反对的事。所以这里只挑 `native !== true` 的那些(即降级到一次性派遣的形态)。
	 */
	function noticeBlock(notices) {
		const pendingNotices = (notices ?? []).filter((item) => item.native !== true)
		if (pendingNotices.length === 0) return ''
		return pendingNotices
			.map((item) => {
				const who = item.kind === 'scout' ? '侦察' : '执行者'
				const head = `【${who}结论 · ${item.id}】${item.trigger === null || item.trigger === undefined ? '' : `${item.trigger}\n`}`
				return `${head}${clipConclusion(item.conclusion, item.path)}`
			})
			.join('\n\n')
	}

	/** 开一次调用的上下文:拿宿主读面、取状态、备一个变更列表。 */
	function open(exec) {
		const hostService = host()
		if (hostService === undefined) {
			return { ok: false, response: fail('host_missing', '宿主包 clearai-dsh 没有挂载:状态机不在(它是会话日志的投影)。先装上它,再谈工具。') }
		}
		const sessionId = String(exec.agent?.id ?? 'unknown')
		return { ok: true, hostService, sessionId, state: hostService.state(sessionId), mutations: [], done: null }
	}

	// ═══ 无人值守续跑窗口(autonomy=unattended) ═══════════════════════════════
	//
	// 事实与驱动的分工:P3 说「事实只能由系统算出来」。宿主的 `goals` 服务**不是**第二本目标账——
	// 它只是一个**驱动器**:它回答「这一轮结束后,系统要不要自己再叫醒我一次?」。
	// 所以内核从不读它做任何判断(目标是否达成、进度多少,一律只从投影里算),
	// 只在三处动它:立约/修订时布防、结案时收兵、计划触礁时报阻塞;重启后补一次重新布防。
	//
	// 为什么必须是**机制**而不是嘱咐:ClearAI 的无人值守档靠「系统自己开下一阶段」活着,
	// 而 DSH 里一个回合结束后想让会话继续,只有宿主的回合驱动能做到。模型自己说"我继续"是无力的。

	const CONTINUATION_CODES = { stalled: 'clearai_loop_stalled', abandoned: 'clearai_loop_abandoned' }

	/**
	 * 计划审阅的两个标签:它们是**机制**定义的措辞,不是模型的即兴表达。
	 * 原生 `plan-review` 意图只要求 `approve` 精确指向本问题自己的某个选项,
	 * 所以标签怎么写由我们定——但**必须**与 `intent.approve` 是同一个字面值。
	 */
	const PLAN_REVIEW_APPROVE = '批准,开始执行'
	const PLAN_REVIEW_REVISE = '先改再交'

	/**
	 * 内核**自己**对平台说过的关于续跑窗口的话,落进投影。
	 *
	 * 为什么不再记在进程内存里:宿主的 `paused` 相位分不清「人按的」与「策略按的」,
	 * 而这两者的处置正好相反——人按的绝不覆盖,自己按的要能恢复。记在内存里,
	 * 一次重启(或一条分叉出去的世界线)就把我们自己的暂停误报成人的暂停,那是一句不实的话。
	 * 落进投影之后,重启、分叉、换进程都读得到同一本账;轮数与相位仍然只在原生 dock 上出现。
	 *
	 * `mutations` 由调用方给(工具结果那条路 / pre-step 的事实通道那条路);给不出就不记——
	 * **宁可这次的账缺一条,也不假装记下了**。
	 */
	function recordContinuation(mutations, before, entry) {
		if (!Array.isArray(mutations)) return
		const previous = before ?? null
		const same =
			previous !== null &&
			previous.state === entry.state &&
			(previous.goal ?? null) === (entry.goal ?? null) &&
			(previous.target ?? null) === (entry.target ?? null) &&
			(previous.why ?? null) === (entry.why ?? null) &&
			(previous.label ?? null) === (entry.label ?? null)
		if (same) return // 同一个事实说第二遍是噪音:账没有变,就不落新的一条
		mutations.push({ t: 'continuation/set', state: entry.state, goal: entry.goal ?? null, target: entry.target ?? null, why: entry.why ?? null, label: entry.label ?? null })
	}

	/**
	 * 续跑文案:两张卡各自对应一个档,工具名用同一件 `ask_user_question`(两档各用各的用法)。
	 * 这是**注入式文案**(作为一条消息进这一回合),不是 system prompt 段。
	 *
	 * 目标层文案只描述当前真实存在的相位:ClearAI 的目标**没有阶段蓝图**(`goal.phases`)。
	 */
	const CONTINUATION_TEXT = {
		plan: '【自动续跑】上一回合已结束,但计划尚未收尾。先 CheckPlan 核对当前真实步骤,继续推进;全部步骤完成后 ClosePlan。若卡在需要人拍板处,用你可用的人门工具(Dialogue 问缺失信息或确认推断,Goal 仅确认)明确停下等人,**不要空转**。禁止仅为了回应本条消息而寒暄或复述计划——直接干活。',
		goal: '【自动续跑·目标未达成】上一阶段的计划已收尾,但目标还没到头。对照运行态卡里的 done_criteria 与已完成阶段的归档,核对还差什么:还有阶段要做就 CreatePlan 开下一阶段(一张计划只承载一个阶段);判据已全部满足就 CloseGoal(outcome="achieved") 交验收,由独立评估者核对后结案。若卡在必须由人拍板处,用确认型提问把承重推断连同依据呈给人、明确停下等人,**不要空转**。禁止仅为了回应本条消息而寒暄或复述目标——直接干活。',
	}

	/**
	 * 窗口最后一个回合的追加提示。
	 * 理由是:harness 在回合末开不了门,门的内容只有模型知道——所以让它**自己**开。
	 * 同一条理由在这里成立:门只能由模型发起的 `ask_user_question` 打开。
	 */
	const LAST_TURN_HINT =
		'\n\n⚠️ 这是本次授权窗口的**最后一个回合**。若届时仍收不了尾,请在回合结束前用一次确认型提问说清:你卡在哪、你的推断与依据是什么、需要我裁决哪个承重判断。不要泛泛地问「是否继续」——那不是一个我能回答的问题。'

	/**
	 * 「这个 run 现在想要什么」——判定当前真实存在的相位:
	 *   · 计划层还有未落定步 → drive(还有活可干)
	 *   · 计划被拦(blocked)/ 已触礁 → stop(计划层已经如实停下等人)
	 *   · 有评估在跑 → hold(机器等待态,推它就是抢评估者的活)
	 *   · 计划层没有诉求(无计划 / 阶段已收):
	 *       - 目标还开着 + 无人值守 → drive(目标层接管,开下一阶段)
	 *       - 目标还开着 + 人在场 → hold(对话+开着的目标 = **挂起可恢复的合法态**,
	 *         ClearAI 原话:「不驱动、run 空闲等人」;人给下一阶段)
	 *   · 其余 → hold(没活可干)
	 */
	function turnDemand(state, derived, goalOpenOverride, auditsResolved) {
		const plan = derived.activePlan
		if (plan !== null && plan.blocked !== undefined) return 'stop'
		// 计划在场但**授权记号未落账**(`PLAN_AWAITING_CONFIRM`):那是等人的一道门,
		// 不是「还有活可干」——推它就是替人做决定(ClearAI 原话:「已经有人在推它了」)。
		// 它与档无关:没有任何一档会替你签这个记号(见 CreatePlan 的确认门)。
		if (plan !== null && plan.status === 'active' && !derived.planIsAuthorized(plan)) return 'hold'
		/**
		 * 裁决还没回来(`audit/dispatched` 但未 `audit/settled`)= 机器等待态,与 fold 的派生同源。
		 * `auditsResolved` 是「这一拍刚刚判定这些裁决已经失联」:那些事实要到下一拍才折进投影,
		 * 所以这一拍必须显式放行,否则一条永远不会回来的裁决会把目标按死在挂起上。
		 */
		if (auditsResolved !== true && state.audits.some((audit) => audit.verdict === null)) return 'hold'
		// 有一道门开着(收件箱非空)就不驱动:等人的事永远优先于往前跑。
		if (derived.hasOpenGate) return 'hold'
		if (plan !== null && plan.steps.some((step) => step.status === 'open')) return 'drive'
		// 目标是否开着:工具刚落的变更还没折进投影,所以允许调用方给一个明确的覆盖值
		// (SetGoal 之后目标一定是开着的——那一拍投影还没前进)。
		const goalOpen = goalOpenOverride ?? (state.goal !== null && state.goal.status === 'open')
		/**
		 * 目标还开着、门都关着、也没有在飞的裁决 ⇒ **该继续**。
		 * 原先这里按档分叉(无人值守 drive / 人在场 hold)——那是让用户**预先声明**
		 * 「请多问我」✗,而"要不要人"这件事已经由**门**表达了:有事要拍板 ⇒ 门开着 ⇒ 上面就 hold 了。
		 */
		if (goalOpen) return 'drive'
		return 'hold'
	}

	/** 令牌可用性:服务不在就如实说,而不是假装布防了。 */
	function continuationService() {
		// **不按 autonomy 分叉**:要不要继续由 `turnDemand` 从门状态算出来
		// (有没有门开着、有没有裁决在飞、有没有开着的步),档位在这条路上不参与判断。
		// 额度也只有一个:`DEFAULT_MAX_AUTO_TURNS`(见布防点)。
		const goals = ctx.get('goals')
		if (goals === undefined || typeof goals.create !== 'function') return { goals: null, why: 'goals 服务不可用' }
		return { goals, why: null }
	}

	/**
	 * 续跑窗口的**身份**:谁在跑 + 哪一档。
	 *
	 * 为什么不再把目标的主张与判据铺进去:宿主那句 objective 有两个消费者——平台面板(**给人看**)
	 * 与驱动器的续跑种子(**给模型看**)。把它写成「用户的目标」,面板上就出现第二个目标,
	 * 而平台这个对象本来不是目标,是**一次跨轮的授权 + 轮数预算**。事实(主张、判据、步骤、证据)
	 * 在我们自己的账上,并且由运行态卡逐回合喂给模型——模型的上下文不缺这一段。
	 * 于是两边各说各的话,用 id 互指:**平台对象说给人听,事实卡片说给模型听。**
	 *
	 * 身份只由 (服务对象, 档位) 构成,所以它**永远不需要改写**:身份一变就是换一枚窗口。
	 * 这条也是「目标修订不重置预算」的机制保证——否则反复修订目标就能刷出无限轮数。
	 */
	/**
	 * 窗口身份里那一档怎么写:**用人话**,与工具行那颗控制同一套词。
	 *
	 * 为什么不是「人在场 / 无人值守」:那两个词是**机制**的词汇,给模型和写文档的人用
	 * (运行态卡、提示词、AUDIT 里继续用它们)。而窗口身份是印在**人看的那块面板**上的
	 * ——同一屏上出现「人在场」与「多问我」两个名字指同一件事,人只会更糊涂。
	 * 两处的字面值由两侧的测试各钉一遍(内核这一份 + 客户端那一份),漂移会当场红。
	 */
	/** 窗口身份里**不写档位**:「多问我 / 自己跑」不是用户的配置,是运行时状态。 */
	/** 一句话摘要:压平空白、超长截断(平台上那句给人看的话用它;内核里没有客户端的 `brief`)。 */
	function clip(text, max) {
		const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
		return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
	}
	function windowTarget(state, derived) {
		const goal = state.goal
		if (goal !== null && goal.status === 'open') return `继续做完:${clip(goal.claim, 26)}`
		if (derived.activePlan !== null) return `继续推进:${clip(derived.activePlan.brief ?? derived.activePlan.id, 26)}`
		return '继续把手上这一步做完'
	}
	/**
	 * 窗口上那句**给人看的话**。
	 *
	 * 原来这里是 `ClearAI 续跑窗口 · 目标 g-mtyirobr2y2l`:一个机制词加一串机器 id。
	 * 而这句是**印在平台面板上、给人看**的 —— 人该看到"在做什么",不是我们在内部怎么称呼它。
	 * (同一屏上还并排着原生那句「进行中的目标」,机制词叠机制词。)
	 *
	 * 换成人话之后,身份就不能再靠"文本相等"判了(目标一改口径文本就变),于是:
	 *   · **归属**仍看我们账上记的那一枚(`before.goal === current.id`)与"这句还是不是我们写的";
	 *   · 文本变了走 **`goals.edit`** —— 改这句话**不动轮数**,所以反复修订刷不出预算;
	 *   · 只有额度(`maxGoalRounds`)变了才换窗口(那是授权变了)。
	 */
	function windowObjective(target) {
		return target
	}

	function continuationView(agent) {
		try {
			return ctx.get('goals')?.get?.(agent) ?? null
		} catch {
			return null
		}
	}

	/**
	 * 布防(立约/修订/重启后):把宿主目标对齐到投影里的目标。
	 * 返回一句如实的说明,交给卡片;任何一步失败都只是「令牌没布上」,绝不影响事实侧的推进。
	 */
	function armContinuation(agent, state, derived, options = {}) {
		const { goals, why } = continuationService()
		/**
		 * 窗口不在时,把这句**事实**的后果也说清楚(一次性形态根本没有窗口,
		 * 而提示词里「让出本轮等唤醒」那句在那种场合是不成立的)。
		 * 只说事实与含义,不劝:**回合结束之后没有人会叫醒你** —— 这一句就够了。
		 */
		if (goals === null) return why === null ? '' : `\n(续跑窗口未布防:${why};含义:这一回合结束之后不会有下一轮来叫醒你——要继续就把它做完,或用 AwaitWorldlines 有界地等。)`
		// SetGoal 那一拍投影还没前进,窗口服务谁由调用方直接给(否则会按「还没有目标」派生)。
		const target = options.target ?? windowTarget(state, derived)
		const objective = windowObjective(target)
		const maxGoalRounds = CFG.maxAutoTurns ?? DEFAULT_MAX_AUTO_TURNS
		const freshWindow = options.freshWindow === true
		const mutations = options.mutations
		const before = state.continuation ?? null
		/** 说一句话 + 把这句话记进账(账没变就不落新条)。 */
		const said = (note, entry) => {
			recordContinuation(mutations, before, entry)
			return note
		}
		const armed = (goalId, label) => ({ state: 'armed', goal: goalId, target, why: null, label: label ?? objective })
		try {
			const current = continuationView(agent)
			if (current === null) {
				/**
				 * **它不在了,而那不是我们干的**。我们自己每次清除都在同一次调用里
				 * 立刻建回一枚(见下面 freshWindow 与 blocked/complete 两支),所以「我们记过一枚
				 * 活着的窗口、此刻它不在」在证据上只可能是外部清的——平台的人在面板上按了清空。
				 * 那就**不重建**:人的动作即刻为真,我们只落一条账、并如实说明后果。
				 * 不说「谁」按的:我们能证明的是「不是我们」,不是「是人」。
				 */
				if (freshWindow !== true && before !== null && before.state === 'armed') {
					return said(
						'\n(续跑窗口已被外部清掉:这一回合之后不会有人来叫醒你——要继续就把它做完,或用 AwaitWorldlines 有界地等;人再开口会重新布防。)',
						{ state: 'withdrawn', goal: null, target: before.target ?? null, why: 'external' },
					)
				}
				const view = goals.create(agent, { objective, maxGoalRounds })
				return said(`\n续跑窗口已布防:${view.maxGoalRounds} 轮上限(${windowLabel(view.maxGoalRounds)})。`, armed(view.id))
			}
			// 人在场这一档:一条人类消息 = 一个新窗口(清 streak / 换 window_id)。
			// 宿主的回合计数是随目标走的,所以换窗口 = 换一枚新目标(先清后建,按宿主契约)。
			if (freshWindow) {
				goals.clear(agent, { id: current.id, revision: current.revision })
				const view = goals.create(agent, { objective, maxGoalRounds })
				return said(`\n续跑窗口已换新(${windowLabel(view.maxGoalRounds)}):${view.maxGoalRounds} 轮上限重新计。`, armed(view.id))
			}
			if (current.phase === 'active') {
				if (current.activation === 'disarmed') {
					goals.resume(agent, { id: current.id, revision: current.revision })
					return said('\n续跑窗口已重新布防(重启/分叉后宿主会解除续跑授权,已被补回)。', armed(current.id))
				}
				/**
				 * 窗口活着(active + armed),而且账也对得上 → **一个字都不说、一次写都不做**。
				 * 文本随目标修订而改写的 `edit` 对齐分支已删:身份一变
				 * 就是换一枚窗口,所以那条路整个不需要了:
				 * 目标修订不再动窗口 ⇒ 预算也不会被反复修订刷掉。
				 */
				/**
				 * **额度变了就换窗口**:
				 * 窗口的额度就是**授权**,额度变了就是换一份授权(额度只有一个默认值,
				 * 但 `maxAutoTurns` 仍可由人显式配置)。旧实现靠 `edit` 去对齐轮数,
				 * 不在这里换窗口,额度变化会把窗口锁在旧额度上。
				 *
				 * 怎么分清「额度变了」与「人改写过了」:看**平台上的文本还是不是我们记下的那句**。
				 * 是我们的 ⇒ 可以按额度换;不是我们的 ⇒ 以人为准,一个字都不动。
				 */
				const ours = before !== null && before.label !== null && before.label !== undefined && before.label === current.objective
				// 额度变了 = 授权变了 ⇒ 换一枚新窗口(清 + 建,按宿主契约)。
				if (ours && current.maxGoalRounds !== maxGoalRounds) {
					goals.clear(agent, { id: current.id, revision: current.revision })
					const view = goals.create(agent, { objective, maxGoalRounds })
					return said(`\n续跑窗口已换新(额度变成 ${windowLabel(view.maxGoalRounds)})。`, armed(view.id, view.objective))
				}
				/**
				 * 台上那句话该更新了(服务对象换了口径 / 换了对象)⇒ **改这句话,不换窗口**。
				 * `edit` 不动轮数,所以"反复修订刷新预算"这条捷径不成立。
				 */
				if (ours && current.objective !== objective) {
					goals.edit(agent, { id: current.id, revision: current.revision }, { objective })
					return said('', armed(current.id, objective))
				}
				if (before !== null && before.state === 'armed' && before.goal === current.id) return ''
				// 账没跟上(旧会话升级上来、或上一次落账没发出去):补一条,不碰平台对象。
				return said('', armed(current.id, current.objective))
			}
			if (current.phase === 'paused') {
				// 只有「我们自己按下的那一次暂停」才由我们恢复;人按的暂停是人的意思,不覆盖。
				if (before !== null && before.state === 'paused' && before.goal === current.id) {
					goals.resume(agent, { id: current.id, revision: current.revision })
					return said('\n续跑已恢复(先前是策略按下的暂停:有活要干了)。', armed(current.id))
				}
				return '\n(续跑窗口停在 paused:宿主目标被暂停,系统不会再自动叫醒你。需要续跑就恢复它。)'
			}
			// blocked / complete:宿主要求先 clear 再 create(「every other current phase must be cleared or resumed」)。
			goals.clear(agent, { id: current.id, revision: current.revision })
			const view = goals.create(agent, { objective, maxGoalRounds })
			return said(`\n续跑窗口已重新布防(上一枚是 ${current.phase},已按宿主契约先清后建):${view.maxGoalRounds} 轮上限。`, armed(view.id))
		} catch (error) {
			return `\n(续跑窗口布防失败:${String(error?.message ?? error).slice(0, 200)})`
		}
	}

	/**
	 * 窗口的说明文字:别让人以为「没有窗口」——每个会话都有窗口,只是额度不同。
	 * 上限由调用方现算的 maxGoalRounds 给:它是 `maxAutoTurns` 或默认值(128),
	 * **不随任何运行档变化**(档位连面板入口都没有了)。
	 */
	function windowLabel(maxGoalRounds) {
		return `${maxGoalRounds} 轮自动续跑,一条人类消息换一个新窗口`
	}

	/** 令牌停着的三种如实说明(额度用尽是机器事实,不是故障)。 */
	function stoppedNote(current) {
		if (current.phase === 'paused') {
			return '\n(续跑窗口停在 paused:宿主目标被暂停,系统不会再自动叫醒你。需要续跑就恢复它,或说一声。人一开口也会换新窗口。)'
		}
		if (current.phase === 'blocked') {
			const code = current.blockedReason?.code ?? '未知'
			// 宿主的回合驱动在 `roundsStarted >= maxGoalRounds` 时自己 block(code='round-limit')。
			return code === 'round-limit'
				? `\n(本次授权窗口的自动续跑额度已用尽(${current.maxGoalRounds} 轮):系统不会再自动叫醒你;人开口即换新窗口,或重新立目标。这**不是**故障,是额度。)`
				: `\n(续跑窗口已阻塞(${code}):需要人介入,系统不会再自动叫醒你。)`
		}
		return '\n(续跑窗口已收(complete):系统不会再自动叫醒你。要接着跑就重新立目标,或说一声。)'
	}

	/** hold:合法等待态 → 解除续跑授权(ClearAI 的「挂起可恢复」)。 */
	function holdContinuation(agent, state, current, reason, mutations) {
		if (current === null || current.phase !== 'active' || current.activation !== 'armed') return ''
		const why =
			reason === 'audit'
				? '独立评估者还在裁决——那是机器等待,不推。裁决回来会继续。'
				: reason === 'plan_confirm'
					? '计划在场但授权记号还没落账(计划待确认):这是等人的门,不替你开工。'
					: reason === 'gate'
						? '收件箱里还有等人的事:人门优先于往前跑。'
						: '计划层已经收尾而目标还开着,下一阶段由人给。人一开口就换新窗口。'
		try {
			continuationService().goals.pause(agent, { id: current.id, revision: current.revision })
			// 「这次暂停是我们按的」必须落账:宿主的 paused 相位分不清人按的与策略按的。
			recordContinuation(mutations, state.continuation ?? null, { state: 'paused', goal: current.id, target: state.continuation?.target ?? null, why: reason })
			return `\n(这一档暂时停着:${why})`
		} catch (error) {
			return `\n(续跑窗口暂停失败:${String(error?.message ?? error).slice(0, 200)})`
		}
	}

	/**
	 * 让窗口服从策略。判定顺序就是 ClearAI 的语义顺序:
	 *   ⓪ 人清掉过续跑 → 撤回一直有效,直到人再开口(人的动作不被静默撤销);
	 *   ① **人开口 = 重新授权**:无条件换新窗口(`reset_goal_loop` 连 budget_exhausted 一起清);
	 *   ② 窗口已经停着(blocked / complete / 人按的 paused)→ 如实说,不自动重开
	 *      ——自动重开一个「额度用尽」的窗口,等于把预算机制废掉;
	 *   ③ 计划层已如实停下 → stop(置阻塞);
	 *   ④ 没有活要干 → 收兵;
	 *   ⑤ drive → 布防 / hold → 挂起。
	 * 每一步都会说明自己做了什么——静默地开关续跑,是这一档最危险的一种失灵。
	 */
	function applyContinuationPolicy(agent, state, derived, options = {}) {
		const plan = derived.activePlan
		const planWork = plan !== null && plan.steps.some((step) => step.status === 'open')
		const goalOpen = options.goalOpen ?? (state.goal !== null && state.goal.status === 'open')
		const hasWork = goalOpen || planWork
		// 档位已经是**部署预设的初值**,不随回合变化 ⇒ 这里没有"当档"要优先。
		const demand = turnDemand(state, derived, options.goalOpen ?? goalOpen, options.auditsResolved === true)
		const { goals, why } = continuationService()
		const current = continuationView(agent)
		const mutations = options.mutations

		if (options.freshWindow === true && hasWork) {
			if (goals === null) return `\n(续跑窗口未布防:${why};含义:这一回合结束之后不会有下一轮来叫醒你——要继续就把它做完,或用 AwaitWorldlines 有界地等。)`
			const note = armContinuation(agent, state, derived, options)
			return demand === 'drive' ? note : note + holdContinuation(agent, state, continuationView(agent), holdReason(state, derived, options.auditsResolved === true), mutations)
		}
		if (goals === null) {
			if (current !== null && demand === 'stop') return stopContinuation(agent, CONTINUATION_CODES.stalled, '计划触礁', mutations)
			return `\n(续跑窗口未布防:${why};含义:这一回合结束之后不会有下一轮来叫醒你——要继续就把它做完,或用 AwaitWorldlines 有界地等。)`
		}
		if (current !== null && (current.phase === 'blocked' || current.phase === 'complete')) {
			// 停着的窗口不自动重开:额度用尽要人来重新授权,人结掉的窗口要人再开口。
			return options.quiet === true ? '' : stoppedNote(current)
		}
		/**
		 * 人在面板上清掉了续跑 ⇒ **不重建**,而且这件事在人再开口之前一直有效。
		 * 少了这一句,撤回只挡得住一拍,下一拍我们又把它建回来——那正是「机制跟人抢方向盘」。
		 * 人开口是重新授权(`freshWindow`),所以它必须能穿过这道闸。
		 */
		if (options.freshWindow !== true && state.continuation !== null && state.continuation !== undefined && state.continuation.state === 'withdrawn') return ''
		if (demand === 'stop') {
			if (current === null || current.phase !== 'active') return ''
			return stopContinuation(agent, CONTINUATION_CODES.stalled, '计划被拦,已如实停下等人', mutations)
		}
		if (!hasWork) {
			if (current === null || current.phase !== 'active') return ''
			return stopContinuation(agent, null, '没有在办的目标或计划', mutations)
		}
		if (current === null) return armContinuation(agent, state, derived, options)
		if (demand === 'drive') return armContinuation(agent, state, derived, options)
		return holdContinuation(agent, state, current, holdReason(state, derived, options.auditsResolved === true), mutations)
	}

	/** 挂起的**真实理由**——卡片里那句说明必须与真正的原因一致,不然它只是一句好听话。 */
	function holdReason(state, derived, auditsResolved) {
		if (auditsResolved !== true && state.audits.some((audit) => audit.verdict === null)) return 'audit'
		const plan = derived.activePlan
		if (plan !== null && plan.status === 'active' && !derived.planIsAuthorized(plan)) return 'plan_confirm'
		if (derived.hasOpenGate) return 'gate'
		/**
		 * 这里曾有个 `goal_boundary`(「人在场时,一个阶段收尾就停下等人」)——
		 * 那是**档位**的表达,档删了它也就不该存在。上面三条是**唯一**能让窗口停下的理由
		 * (都是"真的有人的事"),所以走到这里说明判据与我理解的不一致 ⇒ 如实报未知 + 告警,
		 * 而不是编一个好听的理由(理由那句话是要给模型读的,不许说假话)。
		 */
		ctx.logger?.warn?.('clearai kernel: 窗口挂起但三条已知理由都不成立(状态与判据不一致)')
		return 'unknown'
	}

	/** 收兵:目标达成(或如实放弃)时把窗口停下,别让系统再叫醒一个已经收尾的目标。 */
	function stopContinuation(agent, code, message, mutations) {
		const { goals, why } = continuationService()
		if (goals === null) return ''
		try {
			const current = continuationView(agent)
			if (current === null || current.phase !== 'active') return ''
			// 「我们收的兵」也要落账(否则人后来清掉这枚已完结的窗口时,我们会误说成「外部撤走」)。
			const before = stateOf(String(agent.id))?.continuation ?? null
			const target = before?.target ?? null
			if (code === null) {
				goals.complete(agent, { id: current.id, revision: current.revision })
				recordContinuation(mutations, before, { state: 'stopped', goal: current.id, target, why: 'complete' })
				return '\n续跑窗口已收回(目标达成,系统不会再开下一轮)。'
			}
			goals.block(agent, { id: current.id, revision: current.revision }, { code, message: String(message ?? '').slice(0, 300) })
			recordContinuation(mutations, before, { state: 'stopped', goal: current.id, target, why: code })
			return `\n续跑窗口已置阻塞(${code}):需要人介入才会继续。`
		} catch (error) {
			return `\n(续跑窗口收回失败:${String(error?.message ?? error).slice(0, 200)})`
		}
	}

	/**
	 * **「当档从输入读」这整套已删**(`autonomyFromMessages` / `turnAutonomy` / `autonomyForTurn`):
	 * 它服务的唯一动词是已摘掉的 `set_autonomy` ✗。档位现在只是**部署预设的初值**,
	 * 不随回合变化 ⇒ 没有"这一拍按哪一档跑"这个问题,也就没有瞬时参数要传。
	 */


	/**
	 * 请人**审阅计划**:走原生 `ctx.userQuestions.ask` 的 `plan-review` 意图。
	 *
	 * 为什么要借这一条:客户端为这个意图做了**专门的整屏审阅**(计划 markdown 由原生渲染),
	 * 批准/继续改的标签由机制定义,答案**程序化回到调用方**——于是「计划要人审」从
	 * **提示词劝告**(模型记得问)变成**机制动作**(系统自己问)。而授权记号仍然由我们落账:
	 * **借界面,不借账。**
	 *
	 * 四种结局:approved(落 by='user')/ declined(带回人的反馈)/ cancelled(他改为先说话)
	 * / unavailable(这个形态没有审阅通道)。后三种**不落授权记号**——记号是归属,不是闸门:
	 * 未授权的唯一后果是自动续跑 hold;显式推进不被阻止,第一次交付会按事实补写 by='progress'。
	 */
	async function requestPlanReview(agent, planMarkdown, signal) {
		const questions = ctx.get('userQuestions')
		if (questions === undefined || typeof questions.ask !== 'function') return { outcome: 'unavailable', note: '这个形态没有可用的审阅通道' }
		try {
			const answer = await questions.ask({
				questions: [
					{
						id: 'plan-review',
						header: '计划待你确认',
						question: '批准这份计划并开始执行?',
						detail: planMarkdown,
						options: [
							{ label: PLAN_REVIEW_APPROVE, description: '按这份计划开始执行,交付过程中的证据照旧逐条落账。' },
							{ label: PLAN_REVIEW_REVISE, description: '把意见交回模型改判据或步骤,改完再呈一次。' },
						],
						intent: { kind: 'plan-review', approve: PLAN_REVIEW_APPROVE },
					},
				],
				agent,
				signal,
			})
			const item = (Array.isArray(answer?.answers) ? answer.answers : []).find((entry) => entry?.id === 'plan-review')
			const selected = Array.isArray(item?.selected) ? item.selected : []
			if (selected.length === 1 && selected[0] === PLAN_REVIEW_APPROVE && item.custom === undefined) return { outcome: 'approved', note: '' }
			return { outcome: 'declined', note: String(item?.custom ?? '') }
		} catch (error) {
			const code = String(error?.code ?? '')
			if (code === 'ASK_CANCELLED' || code === 'ASK_ABORTED') return { outcome: 'cancelled', note: '人在审阅时改为先说话' }
			return { outcome: 'unavailable', note: String(error?.message ?? error).slice(0, 200) }
		}
	}

	/**
	 * 请人审阅**已经立起来的**计划,并按结果落授权记号。
	 *
	 * 为什么必须有这条路:`CreatePlan` 会请人审阅,但**改完不会再请** —— 而审阅卡上那句
	 * 「改完再呈一次」正是我们承诺的。死胡同的形态:人在审阅里选了「先改再交」,
	 * 模型照意见改了计划,然后**没有任何入口**能再呈一次 ⇒ 计划永远停在未授权,
	 * 而内核又如实拒绝开工。**打不开的门比没有门更糟**:它把机制变成死胡同。
	 *
	 * 尺子与 CreatePlan 完全一样:只有 approved 才落记号,其余三种结局一个字都不落。
	 */
	async function reviewExistingPlan(plan, exec, mutations, stepsOverride) {
		const steps = stepsOverride ?? plan.steps
		const review = await requestPlanReview(
			exec.agent,
			renderPlanForReview(
				plan.id,
				plan.brief ?? '',
				null,
				steps.map((step) => ({ id: step.id, do: step.do, artifacts: step.artifacts ?? [], done_criteria: step.done_criteria })),
			),
			exec.signal,
		)
		if (review.outcome === 'approved') {
			mutations.push({ t: 'plan/confirmed', plan: plan.id, by: 'user', at: new Date().toISOString() })
			return { confirmed: true, note: '\n人在审阅里**批准**了这份计划——授权记号已落账,可以开工。' }
		}
		if (review.outcome === 'declined') return { confirmed: false, note: `\n人又一次选择**先改再交**${review.note === '' ? '' : `,他的意见:${review.note}`}——仍未授权,按意见再改。` }
		if (review.outcome === 'cancelled') return { confirmed: false, note: '\n人把审阅撤下、改为先说话:仍未授权,等他的下一步指令。' }
		return { confirmed: false, note: `\n(这份计划还没有得到人的授权:${review.note}。系统不会自动续跑它;你显式推进时,第一次交付会按事实记下归属。想再请人审,用 RequestPlanReview 重呈。)` }
	}

	/** 给人审阅的计划正文(markdown)。原生审阅界面渲染它,所以它得是人读得懂的一份计划。 */
	function renderPlanForReview(planId, brief, goal, steps) {
		const lines = [`# 计划:${typeof brief === 'string' && brief.trim() !== '' ? brief.trim() : planId}`]
		if (goal !== null) lines.push('', `**目标**:${goal.claim}`, '', `**判据**:${goal.done_criteria}`)
		lines.push('', '## 步骤')
		for (const step of steps) {
			lines.push('', `**${step.id}** —— ${step.do}`, `- 判据:${step.done_criteria}`)
			if (Array.isArray(step.artifacts) && step.artifacts.length > 0) lines.push(`- 产物:${step.artifacts.join('、')}`)
			if (step.tests !== undefined && step.tests !== null) lines.push(`- 检验:${step.tests.hypothesis}(${step.tests.level})`)
		}
		return lines.join('\n')
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
			'# 事实库(已升格、可作为「已知」引用)',
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
			lines.push('')
		}
		return `${lines.join('\n')}`
	}

	/** 写货架;内容没变就返回 null(调用方据此决定要不要在卡里提一句)。 */
	function ensureFactsShelf(sessionId, state) {
		const body = renderFactsIndex(state)
		if (body === null) return null
		const file = join(sessionCwd(sessionId), 'clear', 'knowledge', 'facts', 'INDEX.md')
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
	 * **本体货架**:把已装的那份本体落成 `clear/ontology/<id>.md`。
	 *
	 * 为什么落成文件而不是只留在代码里:声明是**给模型读的**——它得知道这套系统认哪些对象、
	 * 哪些转移合法、每一级谁来判,才能在写判据与交付时对得上。与 ClearAI 那一侧的
	 * 同一件事:本体从代码里走出来,跟着声明走。
	 *
	 * 幂等:内容一样就不重写(与模板技能同步同一条纪律——文件时间戳是给人的读数)。
	 */
	function ensureOntologyShelf(cwd) {
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
	function continuationStatus(agent) {
		const current = continuationView(agent)
		if (current === null) return null
		return { phase: current.phase, activation: current.activation, roundsStarted: current.roundsStarted, maxGoalRounds: current.maxGoalRounds }
	}

	function validateSteps(steps) {
		if (!Array.isArray(steps) || steps.length === 0) return 'steps 不能为空:一份计划至少一步'
		if (steps.length > MAX_PLAN_STEPS) return `一份计划最多 ${MAX_PLAN_STEPS} 步(收到 ${steps.length})`
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
			if (step.tests !== undefined && step.tests !== null) {
				if (typeof step.tests !== 'object') return `${label} 的 tests 必须是 {hypothesis, level}`
				if (levelIndexOf(step.tests.level) < 0) return `${label} 的 tests.level 必须是 L0–L4 之一`
				if (typeof step.tests.hypothesis !== 'string' || step.tests.hypothesis === '') return `${label} 的 tests 缺少 hypothesis`
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

	// ── SetGoal ────────────────────────────────────────────────────────────

	defineTool({
		name: 'SetGoal',
		description:
			'立目标或修订目标。目标是一等对象,带一份「怎样算回答了」的判据(done_criteria)与候选假设(每条一句话主张 + 一句「什么结果会推翻它」)。修订必须带 reason,版本 +1,旧值全部留痕。同一时间只开一个目标;它跨计划存在,一张 Plan 只承载它的一个阶段。',
		parameters: {
			type: 'object',
			properties: {
				claim: { type: 'string', description: '目标:项目要回答的问题' },
				done_criteria: { type: 'string', description: '怎样算回答了——必须是可核对的判据' },
				promote_at_level: { type: 'string', enum: LEVELS, description: '升格门槛(默认 L3)' },
				hypotheses: {
					type: 'array',
					description: '候选假设:每条一句话主张 + 一句推翻条件',
					items: {
						type: 'object',
						properties: { claim: { type: 'string' }, refute_when: { type: 'string' } },
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
			const cwd = sessionCwd(sessionId)
			const criteria = String(args.done_criteria ?? '').trim()
			if (criteria.length < 4) return fail('done_criteria_required', '判据不能为空:目标是「项目要回答的问题」,判据是「怎样算回答了」。')
			const selfRef = SELF_REFERENCE.find(([pattern]) => pattern.test(criteria))
			if (selfRef !== undefined) return fail('criteria_self_reference', selfRef[1])
			if (typeof args.claim !== 'string' || args.claim.trim() === '') return fail('claim_required', '目标要有主张。')
			const hypotheses = Array.isArray(args.hypotheses) ? args.hypotheses : []
			for (const hypothesis of hypotheses) {
				if (typeof hypothesis?.claim !== 'string' || hypothesis.claim.trim() === '') return fail('hypothesis_claim_required', '每条假设要有一句话主张。')
				if (typeof hypothesis?.refute_when !== 'string' || hypothesis.refute_when.trim() === '') return fail('hypothesis_refute_required', '每条假设必须写清「什么结果会推翻它」——没有推翻条件的假设无法被检验。')
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
			const goalId = isRevision ? state.goal.id : uniqueId('g')
			const revision = isRevision ? state.goal.revision + 1 : 1
			const promoteAtLevel = LEVELS.includes(args.promote_at_level) ? args.promote_at_level : 'L3'
			mutations.push({
				t: 'goal/set',
				id: goalId,
				claim: args.claim.trim(),
				done_criteria: criteria,
				promote_at_level: promoteAtLevel,
				revision,
				reason: isRevision ? String(args.reason).trim() : null,
				hypotheses: hypotheses.map((hypothesis, index) => ({
					id: `h-${Math.random().toString(36).slice(2, 8)}`,
					claim: hypothesis.claim.trim(),
					refute_when: hypothesis.refute_when.trim(),
					version: index + 1,
				})),
			})
			let scoutNote = ''
			if (!isRevision && CFG.precommitRecon) {
				// 立约前侦察:harness 发起(不是模型请求),一生一次,且只在真的有人给过材料时做
				// ——`input/` 是空的就没什么可侦察的,白花一次子 run。
				const inputDir = join(cwd, 'input')
				const materials = existsSync(inputDir) ? countFiles(inputDir, 50) : 0
				if (materials > 0) {
					const scout = await runScout(
						sessionId,
						exec.agent,
						null,
						{ id: 'goal', do: '立约前把已有材料梳一遍', done_criteria: criteria, goal: goalId },
						`把 input/ 里的 ${materials} 份材料读一遍,报告:哪些与这条判据直接相关、哪些是背景、有没有与判据冲突的说法。只报你亲眼读到的。`,
						'precommit_recon',
						exec.signal,
					)
					mutations.push(...scout.mutations)
					// 侦察是「派出去就不等」的子 run:结论由 sweep 收,进资料面。
					scoutNote =
						scout.pending === true
							? '\n立约前侦察已派出(只读),结论会作为观测回灌到资料面 —— 下一步卡片的「资料面」里能看到;要在这个回合里就等它,用 AwaitWorldlines。'
							: `\n(立约前侦察没跑成:${scout.note ?? '未知'})`
				}
			}
			return done({
				ok: true,
				code: isRevision ? 'goal_revised' : 'goal_set',
				message:
					`${isRevision ? `目标已修订到 rev${revision}` : `目标已立(${goalId})`},登记 ${hypotheses.length} 条假设。${scoutNote}` +
					applyContinuationPolicy(exec.agent, state, hostService.derive(sessionId), {
						goalOpen: true,
						// 平台上那句话（给人看）用**目标的主张**说，不写 id；身份与额度由账上那枚窗口负责。
						target: `继续做完:${clip(String(args.claim ?? ''), 26)}`,
						mutations,
					}),
			})
		},
	})

	// ── CloseGoal ──────────────────────────────────────────────────────────

	defineTool({
		name: 'CloseGoal',
		description:
			'结案:交目标验收。系统**无条件**派独立评估者,拿目标判据与转写忠实度逐条核对;只有评估卡说达成才结案为 achieved,否则目标保持开放并回注缺口。你不必为此停下问人。**顺序**:achieved 之前必须先把计划收尾(`ClosePlan`)——事实是在收尾那条路上沉淀的;放弃(`abandoned`)不受此限。',
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
					message: `目标 ${goal.id} 已按 abandoned 结案(阻塞如实记录,记录保留)。${stopContinuation(exec.agent, CONTINUATION_CODES.abandoned, args.note ?? '目标按 abandoned 结案', mutations)}`,
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
					}。\n为什么不让跳过:事实是在**收尾**这条路上沉淀的(假设 → 事实),先结目标就等于跳过沉淀 ✗。\n要接着做:把剩下的步交付或用 VoidPlanStep 作废,然后 \`ClosePlan\`;要放弃这个目标就用 \`CloseGoal(outcome="abandoned")\`(那条路不受此限)。`,
				)
			}
			const derived = hostService.derive(sessionId)
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
			if (audit.verdict === 'pending') return fail('audit_pending', `目标评估者仍在跑:${audit.basis}。先观察当前事实,再谈重试。`)
			if (audit.verdict !== 'support') {
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
					verdict: audit.verdict === 'unknown' ? 'inconclusive' : audit.verdict,
					level: goal.promote_at_level,
					evaluator: 'independent',
					basis: audit.basis,
					refs: goalOrigin.paths,
					origins: goalOrigin.origins,
					anchor: 'auditor',
					basis_reviewable: true,
				})
				const preview = hostService.preview(sessionId, mutations)
				return fail(
					'goal_not_achieved',
					`目标未达成,保持开放。评估者裁决:${audit.verdict}。依据:${audit.basis}${audit.shortfalls.length > 0 ? `\n缺口:${audit.shortfalls.join('; ')}` : ''}\n未落定步骤:${unfinished.length === 0 ? '无' : unfinished.map((step) => step.id).join(', ')}\n\n${preview.card}`,
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
			const continuationNote = stopContinuation(exec.agent, null, '目标达成', mutations)
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
					text: hypothesis.claim,
					scope: hypothesis.refute_when ?? null,
					level: hypothesis.supportedLevel ?? null,
					evidence: state.evidence.filter((item) => item.verdict === 'support').map((item) => item.id),
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
					continuationNote,
			})
		},
	})

	/**
	 * 把一份侦察结论**全文**落成工作区文件(`clear/` 之内,账本仍是真值源,这是投影产物)。
	 *
	 * 为什么是文件而不是只留在账本里:一条事实有三个当事人——下达侦察的模型、独立评估者、
	 * 人。只放在会话日志折叠出的资料面里,只有面板读得到;判据一旦写成「与侦察结论一致」,
	 * 模型与评估者都无处可读,只能裁 inconclusive。落成文件之后三者读的是同一份。
	 * 失败只 warn(照 `persistFact` 的做法):投递仍走消息,只是少了那份可读副本。
	 */
	function persistMaterial(sessionId, scoutId, meta, conclusion) {
		const file = join(sessionCwd(sessionId), 'clear', 'knowledge', 'materials', `${scoutId}.md`)
		try {
			writeTextFile(
				file,
				[
					`# 侦察结论 · ${scoutId}`,
					'',
					`- 触发:${String(meta.trigger ?? '(未记)')}`,
					`- 锚在哪一步:${String(meta.stepId ?? meta.step ?? '(未记)')}`,
					meta.child === undefined ? null : `- 子会话:${String(meta.child)}`,
					meta.digest === undefined ? null : `- 任务指纹:${String(meta.digest)}`,
					`- 收到时间:${new Date().toISOString()}`,
					'',
					'> 这份文件由系统按账本落盘(投影产物);真值源是会话日志里的 `scout/settled`。',
					'',
					String(conclusion),
					'',
				]
					.filter((line) => line !== null)
					.join('\n'),
			)
			return file
		} catch (error) {
			ctx.logger?.warn?.(`clearai kernel: 侦察结论落盘失败 ${String(error?.message ?? error)}`)
			return null
		}
	}

	function persistFact(sessionId, goal, hypothesis, factId) {
		const file = join(sessionCwd(sessionId), 'clear', 'knowledge', 'facts', `${goal.id}.md`)
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
			artifacts: { type: 'array', items: { type: 'string' }, description: '以何物为证:相对 workspace 的产物路径' },
			done_criteria: { type: 'string', description: '判定标准:在结果出现之前写下,必须可核对' },
			tests: {
				type: 'object',
				properties: {
					hypothesis: { type: 'string', description: '要检验的假设:**填 id 最稳**(h-xxxx,从运行态卡复制);也接受主张原文' },
					level: { type: 'string', enum: LEVELS },
				},
				required: ['hypothesis', 'level'],
				additionalProperties: false,
			},
		},
		required: ['id', 'do', 'done_criteria'],
		additionalProperties: false,
	}

	defineTool({
		name: 'CreatePlan',
		description:
			'立约:把复杂任务立成一份计划。每步一句话说清做什么(do)、以何物为证(artifacts)、以及判定标准(done_criteria,在结果出现之前写下)。检验假设的步骤用 tests:{hypothesis, level} 声明验哪条、什么等级。最多 25 步。约立起便锁定:局部挫折改当前步,不要推倒重来。',
		parameters: {
			type: 'object',
			properties: {
				brief: { type: 'string', description: `给人在确认前阅读的计划说明(Markdown,建议 ≥${MIN_BRIEF_CHARS} 字,至少两个 ## 小节)` },
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
			for (const step of args.steps) {
				if (step.tests !== undefined && step.tests !== null && matchHypothesis(state.hypotheses, step.tests.hypothesis) === null) {
					return fail('unknown_hypothesis', `步骤 ${step.id} 声明的假设对不上任何一条已登记的假设。${hypothesisMenu(state.hypotheses)}`)
				}
			}
			const warnings = []
			if (typeof args.brief !== 'string' || args.brief.length < CFG.minBriefChars) warnings.push(`brief 偏短(建议 ≥${CFG.minBriefChars} 字),它是给人读的计划说明`)
			const goal = state.goal !== null && state.goal.status === 'open' ? state.goal : null
			const planId = uniqueId('p')
			/**
			 * 计划确认门:**永远请人审阅,没有任何一档自动确认**。
			 *
			 * 如果让系统替人签「计划经人确认」,这条证据就是**系统自己签的**,
			 * 和 L4「人放行」是同一类病。门的意义就在"这一下是人按的":
			 * 没有它,后面所有基于授权的推理都是空的。
			 *
			 * 走**原生审阅**:由**我们**在计划立起来的这一步请人审阅,计划正文交给原生界面渲染。
			 * 批准 ⇒ 授权记号现在就落(`by:'user'`);其余三种结局 ⇒ 记号不落。这一条把
			 * 「模型记得问才有一道门」换成了「机制自己问」——机制优于劝告。
			 *
			 * 注意记号**不是闸门**:未授权只让自动续跑 `hold`(见 turnDemand),`AdvancePlan`
			 * 照常执行,并在同一条变更里补写 `by:'progress'`(行为即授权,见 AdvancePlan)。
			 */
			const brief = typeof args.brief === 'string' ? args.brief : ''
			const review = await requestPlanReview(exec.agent, renderPlanForReview(planId, brief, goal, args.steps), exec.signal)
			let confirmed = false
			let reviewNote = ''
			if (review.outcome === 'approved') {
				confirmed = true
				reviewNote = '\n人在审阅里**批准**了这份计划(原生审阅卡),授权记号已落账——开始执行。'
			} else if (review.outcome === 'declined') {
				reviewNote = `\n人在审阅里选择**先改再交**${review.note === '' ? '' : `,他的意见:${review.note}`}——计划仍未授权,按他的意见改完再呈一次。`
			} else if (review.outcome === 'cancelled') {
				reviewNote = '\n人把审阅撤下、改为先说话:计划仍未授权,等他的下一步指令。'
			} else {
				reviewNote = `\n(这份计划还没有得到人的授权:${review.note}。系统不会自动续跑它;你显式推进时,第一次交付会按事实记下归属。想再请人审,用 RequestPlanReview 重呈。)`
			}
			mutations.push({
				t: 'plan/created',
				id: planId,
				goal: goal?.id ?? null,
				phase_id: goal?.id ?? null,
				brief,
				confirmed_at: confirmed ? new Date().toISOString() : null,
				confirmed_by: confirmed ? 'user' : null,
				steps: args.steps.map((step) => ({ id: step.id, do: step.do, artifacts: step.artifacts ?? [], done_criteria: step.done_criteria, tests: step.tests ?? null })),
			})
			return done({
				ok: true,
				code: 'plan_created',
				confirmation_required: !confirmed,
				progress_changed: true,
				message: `计划 ${planId} 已立(${args.steps.length} 步)${goal === null ? '' : `,属于目标 ${goal.id} 的一个阶段`}。${warnings.length > 0 ? `\n提醒:${warnings.join(';')}` : ''}${reviewNote}`,
			})
		},
	})

	defineTool({
		name: 'CheckPlan',
		description: '取计划的真实状态:真实 step_id、每步的产物声明与判定标准、派生进度、世界线、以及下一个可交付步。对象不明时先查这里。',
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
			const problem = validateSteps([args.step])
			if (problem !== null) return fail('invalid_step', problem)
			if (plan.steps.some((step) => step.id === args.step.id)) return fail('duplicate_step', `步骤 id 已存在:${args.step.id}`)
			const amended = { id: args.step.id, do: args.step.do, artifacts: args.step.artifacts ?? [], done_criteria: args.step.done_criteria, tests: args.step.tests ?? null }
			mutations.push({ t: 'plan/amended', plan: plan.id, step: amended })
			/**
			 * **没授权的计划:改完再呈一次**(审阅卡上承诺的就是这句)。
			 * 已经授权的计划不再打扰人 —— 补一步不是重新立约。
			 */
			const again = plan.confirmed_at === null ? await reviewExistingPlan(plan, exec, mutations, [...plan.steps, amended]) : { note: '' }
			return done({ ok: true, code: 'plan_amended', progress_changed: false, message: `已补一步 ${args.step.id}(进度不变)。${again.note}` })
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
			const refinedSteps = plan.steps.map((item) => (item.id === step.id ? { ...item, done_criteria: criteria } : item))
			const againRefined = plan.confirmed_at === null ? await reviewExistingPlan(plan, exec, mutations, refinedSteps) : { note: '' }
			return done({ ok: true, code: 'plan_refined', progress_changed: false, message: `步骤 ${step.id} 的判据已精化(进度不变,旧判据留痕)。${againRefined.note}` })
		},
	})

	defineTool({
		name: 'RequestPlanReview',
		description:
			'把**当前这份计划**再呈给人审阅一次(不改任何东西)。计划还没获授权、而你已经按人的意见改完时用它——审阅卡不会自己回来,必须有人再呈一次。人批准 ⇒ 授权记号落账,可以开工;否则一个字都不落,如实停下。已经授权的计划不必再问。',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
		output: CARD_OUTPUT,
		async execute(_args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const plan = activePlanOf(state)
			if (plan === null) return fail('no_active_plan', '没有活动计划。')
			if (plan.confirmed_at !== null) {
				return done({ ok: true, code: 'already_confirmed', progress_changed: false, message: `计划 ${plan.id} 已经获授权(${plan.confirmed_by ?? 'user'}),不必再问。` })
			}
			const review = await reviewExistingPlan(plan, exec, mutations)
			return done({
				ok: true,
				code: review.confirmed ? 'plan_confirmed' : 'plan_review_pending',
				progress_changed: false,
				message: review.confirmed ? `计划 ${plan.id} 已获授权。${review.note}` : `计划 ${plan.id} 仍未授权。${review.note}`,
			})
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
			/**
			 * 作废**不动**分叉:作废是承诺层的权威动作,它不改变尝试层已经发生的事实
			 * ——那些世界线探索过、有的还出了读数。把它们改写成「已放弃」就是改写历史。
			 * 但也不能装作没看见:这一步上要是还挂着没收口的分叉,那是一条**事实**,
			 * 而且它有唯一一个出口(带 step_id 的 AbandonFork)。所以如实说,不说教。
			 */
			const orphan = forkOfStep(hostService.derive(sessionId).forks, step.id)
			const dangling =
				orphan !== null && !orphan.settled && !orphan.abandoned
					? `\n注意:这一步上还有**未收口**的世界线(${orphan.branches.length} 条,${orphan.branches.map((branch) => branch.label).join(' / ')})。它们随这一步作废而终止——不是被人裁掉,也不是被算术排掉。要收掉它们的工作副本(保留 ref,记着「此路不通」),调 \`AbandonFork(step_id="${step.id}", reason=…)\`(那一次会弹人工确认)。`
					: ''
			return done({ ok: true, code: 'step_voided', progress_changed: false, message: `步骤 ${step.id} 已作废(留痕,进度不变)。${dangling}` })
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
			// 未收敛的分叉不能被收尾绕过(放弃探索是人门,不是模型的捷径)
			const derived = hostService.derive(sessionId)
			const openFork = derived.forks.find((fork) => fork.plan === plan.id && !fork.settled && !fork.abandoned)
			if (openFork !== undefined) {
				return fail('fork_not_converged', `步骤 ${openFork.step} 上的分叉还没收敛:先交付每条世界线并用 ConvergeFork 裁决,或请人放弃探索(AbandonFork)。`)
			}
			const unsettled = plan.steps.filter((step) => step.status === 'open')
			if (unsettled.length > 0) {
				return fail('plan_has_open_steps', `还有 ${unsettled.length} 步没落定:${unsettled.map((step) => step.id).join(', ')}。交付它们,或带因作废(VoidPlanStep)。`)
			}
			// 收尾也要把**结论正文**带给模型:这一拍收上来的东西,丢弃返回值就等于白收。
			const collected = collectExecutors(mutations, hostService.state(sessionId), sessionId)
			mutations.push({ t: 'plan/closed', plan: plan.id, summary: args.summary ?? null })
			persistArchive(sessionId, plan, args.summary ?? null)
			return done({
				ok: true,
				code: 'plan_closed',
				message: `计划 ${plan.id} 已收束归档(clear/goals/plans/${plan.id}.md)。${state.goal === null || state.goal.status !== 'open' ? '' : `目标 ${state.goal.id} 仍未结案,继续开下一阶段。`}${noticeBlock(collected.notices) === '' ? '' : `\n\n${noticeBlock(collected.notices)}`}`,
			})
		},
	})

	/** 归档路径取实现事实 `clear/goals/plans/{plan_id}.md`。 */
	function persistArchive(sessionId, plan, summary) {
		const file = join(sessionCwd(sessionId), 'clear', 'goals', 'plans', `${plan.id}.md`)
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
			'交付一步(唯一完成动词):把观测交上来。系统先做观测准入——声明的产物存在、非空、结构合法;准入只看收不收,不做裁决。L0–L2 由你给 verdict 与 basis(依据必须能被复查);L3 以上由系统派独立评估者裁决,你写 verdict 会被拒绝。没有物证,就还没有完成——没有手动标记这回事。',
		parameters: {
			type: 'object',
			properties: {
				step_id: { type: 'string', description: '交付哪一步(只能落在第一个未落定的步,这里是防手滑的确认,不是选择器)' },
				observations: {
					type: 'array',
					description: '观测:这一步拿到的原始结果(相对 workspace 的路径 + 一句说明)',
					items: { type: 'object', properties: { ref: { type: 'string' }, note: { type: 'string' } }, required: ['ref'], additionalProperties: false },
				},
				verdict: { type: 'string', enum: ['support', 'refute', 'inconclusive'], description: '仅 L0–L2 可自判;L3 以上由独立评估者裁决' },
				basis: { type: 'string', description: '自判依据:引用了哪个产物里的哪个事实(必须可复查)' },
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
			// 分叉单 owner:未收敛的分叉不许被普通交付越过(exploring/deciding 都算活跃)
			const forkHere = forkOfStep(hostService.derive(sessionId).forks, step.id)
			if (forkHere !== null && !forkHere.settled && !forkHere.abandoned) {
				const pending = forkHere.branches.filter((branch) => (BRANCH_RANK[branch.status] ?? 0) < BRANCH_RANK.evaluated)
				return fail(
					'fork_node_active',
					`步骤 ${step.id} 长着未收敛的分叉(${forkHere.phase}):${
						pending.length > 0 ? `还有 ${pending.length} 条世界线没交付(${pending.map((branch) => branch.label).join('、')})` : '读数齐了,请 ConvergeFork 让算术裁决'
					}。先让分叉收敛,再交付这一步。`,
				)
			}
			// 序位不变量:交付只能落在第一个未落定步
			if (args.step_id !== undefined && args.step_id !== '' && args.step_id !== step.id) {
				return fail('out_of_order', `交付只能落在第一个未落定步 ${step.id}(${step.do});你给的是 ${args.step_id}。RefinePlan/AmendPlan 不受此限。`)
			}
			// 行为即授权(`plan_write.stamp_confirmed_by_progress`):计划真的推进过,就说明授权
			// 已经发生——在推进的同一条变更里补写记号,而不是留一张「待确认」的账。
			if (plan.confirmed_at === null) {
				mutations.push({ t: 'plan/confirmed', plan: plan.id, by: 'progress', at: new Date().toISOString() })
			}
			// 计划已经如实停下等人:这时再交付不是「更努力」,
			// 而是绕过那道已经开着的门——先改计划或让人介入。
			if (plan.blocked !== undefined) {
				return fail(
					'plan_blocked',
					`计划 ${plan.id} 已置 blocked(连续 ${plan.blocked.attempts} 次未过闸:${plan.blocked.reason}),停下等人。要接着做:AmendPlan 换一条能过闸的路、RefinePlan 补齐判据,或让人介入后重开。`,
				)
			}
			const level = step.tests?.level ?? null
			const levelIndex = levelIndexOf(level)

			// ① 登记观测(只追加)
			const accepted = []
			for (const observation of Array.isArray(args.observations) ? args.observations : []) {
				if (typeof observation?.ref !== 'string' || observation.ref.trim() === '') continue
				const ref = observation.ref.trim()
				const absolute = isAbsolute(ref) ? ref : resolvePath(cwd, ref)
				let bytes = null
				try {
					bytes = statSync(absolute).size
				} catch {
					bytes = null
				}
				const materialId = `m-${Math.random().toString(36).slice(2, 8)}`
				mutations.push({ t: 'observation/recorded', id: materialId, ref, source: 'self', digest: sha256File(absolute), bytes, note: observation.note ?? null, step: step.id })
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

			// ③ 硬拦:连拦计数,达阈值 → 计划 blocked,等人
			if (!gate.ok && !gate.needs_audit) {
				const count = (state.blocks[`${plan.id}:${step.id}`] ?? 0) + 1
				mutations.push({ t: 'block/counted', plan: plan.id, step: step.id, count })
				if (count >= CFG.blockedThreshold) mutations.push({ t: 'plan/blocked', plan: plan.id, step: step.id, attempts: count, reason: `${gate.verified_by}:${gate.hint}` })
				// 触礁就收兵:无人值守这一档不能一边报阻塞、一边让系统继续叫醒自己。
				const stalledNote =
					count >= CFG.blockedThreshold
						? stopContinuation(exec.agent, CONTINUATION_CODES.stalled, `计划 ${plan.id} 第 ${count} 次未过准入(${gate.verified_by}:${gate.hint})`, mutations)
						: ''
				const preview = hostService.preview(sessionId, mutations)
				return fail(
					`evidence_${gate.verified_by}`,
					`未过观测准入(${gate.verified_by},第 ${count} 次):${gate.hint}${count >= CFG.blockedThreshold ? '\n已达阈值,计划置 blocked——停下等人,不要继续交付。' : ''}${stalledNote}\n\n${preview.card}`,
					{ gate: gate.verified_by, blocked: count >= CFG.blockedThreshold, mutations },
				)
			}

			// ④ 裁决:谁可以写
			let verdict
			let evaluator
			let basis
			/** 独立裁决的两件凭据(自判路径下保持 null):评估卡文件与写它的**评估者子会话**。 */
			let auditCardPath = null
			let auditSessionId = null
			if (levelIndex > SELF_JUDGE_MAX_INDEX) {
				if (typeof args.verdict === 'string' && args.verdict !== '') {
					return fail('verdict_not_accepted', `${level} 的证据只能由机器或独立评估者写:做的人不判自己。去掉 verdict/basis 重新交付,系统会派评估者。`)
				}
				const audit = await runEvaluator(sessionId, exec.agent, plan, step, gate, 'evidence_audit', exec.signal)
				mutations.push(...audit.mutations)
				if (audit.verdict === 'pending') return fail('audit_pending', `独立评估者仍在跑:${audit.basis}。先观察当前事实,再谈重试——不要重复派遣。`, { mutations })
				if (audit.verdict === 'unknown') {
					const preview = hostService.preview(sessionId, mutations)
					return fail('evidence_audit_unavailable', `没有拿到独立裁决,这一步不推进(fail-closed):${audit.basis}\n\n${preview.card}`, { mutations })
				}
				verdict = audit.verdict
				evaluator = 'independent'
				basis = audit.basis
				/** 两件凭据从**这一次**的审计结果里取(卡文件 + 评估者子会话)。 */
				auditCardPath = audit.cardPath ?? null
				auditSessionId = audit.mutations.find((mutation) => mutation.t === 'audit/dispatched')?.evaluator_session ?? null
				// 审计缺口定点侦察:评估者说这一步不成,系统自己派一个只读侦察去补它指出的缺口
				// (子角色由 Harness 按触发派生,不是模型的自由委派)
				if (audit.verdict === 'refute') {
					const scout = await runScout(sessionId, exec.agent, plan, step, audit.shortfalls.join('; '), `audit_shortfall:${audit.shortfalls[0] ?? '未指明'}`, exec.signal)
					mutations.push(...scout.mutations)
					// 派出去就不等:结论会在下一个回合边界回灌到资料面。
					if (scout.pending === true) basis = `${basis}\n[已派出只读侦察补缺口 ${scout.scoutId}:结论会作为观测回灌到资料面,不在这次回执里]`
				}
			} else {
				if (typeof args.verdict !== 'string' || args.verdict === '') {
					return fail('verdict_required', `${level ?? '未声明等级'} 的交付要你自己给裁决:verdict(support/refute/inconclusive)与 basis(依据)。依据必须能被复查。`)
				}
				if (typeof args.basis !== 'string' || args.basis.trim().length < 8) {
					return fail('basis_required', 'L0–L2 允许自判,但依据必须可复查:写清你引用了哪个产物里的哪个事实。')
				}
				verdict = ['support', 'refute', 'inconclusive'].includes(args.verdict) ? args.verdict : 'inconclusive'
				evaluator = 'self'
				basis = args.basis.trim()
			}

			/**
			 * **人的放行先落账**(在别的门之前)。
			 *
			 * 放行是**人的动作**,它成立与否与这次交付后来过不过得了别的门无关:
			 *   · 发起者仍是 `tools/pre-execute` 瀑布(在工具跑起来之前就把这次交付摆给人看);
			 *   · 但旧写法把 `human/released` 留在第 ⑦ 步(交付成功之后)——于是「人放行了,可这一交付
			 *     栽在来源分离/判据门上」时,那条事实随失败一起消失,**同一步重试又问人一遍**。
			 * 所以:一知道人放行过,就把这条事实落下来;失败时它跟着回去(见下面的 `refuse`)。
			 */
			const releaseTarget = levelIndex === 4 && CFG.l4RequiresHumanRelease ? l4Delivery(state, 'AdvancePlan', args) : null
			const releaseWitness = releaseTarget !== null && !releaseTarget.released ? witnessedRelease(sessionId, exec.callId) : null
			if (releaseWitness === 'allowed-once' && !releaseTarget.released) {
				mutations.push({ t: 'human/released', plan: plan.id, step: step.id, fork: null, branch: null, call: String(exec.callId ?? ''), via: 'approval' })
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

			/**
			 * ⑥ L4 人放行:**只读**审批栈的权威记录,不推断。
			 * 发起者是 `tools/pre-execute` 瀑布;这里只认那条记录——`human/released`
			 * 已经在上面(别的门之前)落过账,所以这里不写第二遍。
			 */
			if (releaseTarget !== null && !releaseTarget.released && releaseWitness !== 'allowed-once') {
				return refuse(
					'human_release_missing',
					`L4 的交付要有一次**人放行**的权威记录(原生审批栈的 approval/asked + approval/decided=allowed-once),而这一次调用${releaseWitness === null ? '在会话日志里没有任何审批记录' : `的审批结果是 ${releaseWitness}`}。等级是事实的属性,放行是人的动作——两者都不能推断:没有放行记录就不写「人放行」这条事实。`,
				)
			}


			// ⑦ 写证据 + 推进(只增不改)
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
				approvalCall: releaseWitness === 'allowed-once' ? String(exec.callId ?? '') : '',
			})
			const evidenceId = `e-${Math.random().toString(36).slice(2, 8)}`
			mutations.push({
				t: 'evidence/recorded',
				id: evidenceId,
				step: step.id,
				plan: plan.id,
				verdict,
				level: level ?? 'L0',
				evaluator,
				basis,
				/** `refs` 一律是**路径**(旧写法把材料 id 混进来,界面按路径去开 ⇒ 什么也打不开)。 */
				refs: originInfo.paths,
				origins: originInfo.origins,
				anchor: evaluator === 'independent' ? 'auditor' : 'artifact',
				basis_reviewable: evaluator === 'independent' || /[/\\.]/.test(basis),
			})
			let ledgerNote = ''
			if (verdict === 'support') {
				mutations.push({ t: 'step/advanced', plan: plan.id, step: step.id, evidence: evidenceId })
				mutations.push({ t: 'block/cleared', plan: plan.id, step: step.id })
				// 交付点落一次账本提交:一次提交 = 「这一步交付时工作区长什么样」。
				// 只前进、来源可考(提交信息里写着是哪个计划的哪一步)。
				const committed = commitLedger(cwd, `clearai: 交付 ${plan.id}/${step.id} — ${String(step.do).slice(0, 60)}`)
				if (committed.ok === true && committed.skipped !== true) {
					mutations.push({ t: 'git/committed', commit: committed.commit, step: step.id, plan: plan.id, mode: committed.mode, reason: '交付点' })
					ledgerNote = `\n账本:这次交付已记为一条提交(${String(committed.commit ?? '').slice(0, 7)}${committed.mode === 'ledger' ? ',旁路账本' : ''})。`
				} else if (committed.ok !== true) {
					ledgerNote = `\n(账本没记上:${committed.reason}——事实层的推进不受影响。)`
				}
			}
			const tail =
				verdict === 'support'
					? ''
					: verdict === 'refute'
						? '\n推翻是有价值的结果:改判据(RefinePlan)、补一步(AmendPlan)或带因作废(VoidPlanStep)后重来。'
						: '\n无法判定时如实写 inconclusive:把缺什么补上再交付。'
			return done({
				ok: verdict === 'support',
				code: verdict === 'support' ? 'advanced' : `not_converged_${verdict}`,
				gate: gate.verified_by,
				verdict,
				evaluator,
				blocked: false,
				message:
					`步骤 ${step.id} ${verdict === 'support' ? '已交付并推进' : `未收敛(${verdict})`}` +
					`(${evaluator === 'independent' ? '独立评估者裁决' : '自判,依据已记账'})。观测准入:${gate.verified_by};坐标:${gate.confirmed.map((item) => item.ref).join(', ') || '(无)'}。${tail}${ledgerNote}`,
			})
		},
	})

	// ═══ 世界线:分叉 → 各自交付 → 算术收敛只走采纳 ═════════════════════════
	// 搬的是**纯协议**那部分:声明、读数、算术、采纳与留痕。git worktree 与三方合并没有搬:
	// 每条世界线声明一个自己的工作副本(workspace),内核据此强制隔离;合流由你把赢家的产物
	// 落进本步声明的位置。

	// ═══ git 世界线层:世界线 = 分支 + worktree ═══════════════════════════════
	//
	// 探针换来三条硬事实(见 tools/spike-git-worldlines.mjs):
	//   · worktree 隔离完美,落选后 branch ref 永久可读(P5 的落点);
	//   · **主线脏且与世界线改动重叠时 git 直接拒绝合并** → 先把用户手上的快照落成一条提交,再合并;
	//   · **落选世界线里还有未提交的活时 git 拒绝删 worktree** → 先提交到分支,再删工作副本。
	// 另外:互斥改动合并会报冲突(不会被悄悄选边)→ 冲突是决策门,停下问人。

	const GIT_IDENTITY = ['-c', 'user.email=clearai@local', '-c', 'user.name=clearai']

	/** 不 trim 的 git:恢复文件必须逐字节,`git()` 的 trim 会把首尾空行吃掉。 */
	function gitRaw(args, cwd) {
		try {
			return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }) }
		} catch (error) {
			return { ok: false, out: String(error.stdout ?? ''), err: String(error.stderr ?? '').trim() }
		}
	}

	function git(args, cwd) {
		try {
			const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
			return { ok: true, out: out.trim() }
		} catch (error) {
			return { ok: false, out: String(error.stdout ?? '').trim(), err: String(error.stderr ?? '').trim() }
		}
	}

	function isGitWorkspace(cwd) {
		const probe = git(['rev-parse', '--is-inside-work-tree'], cwd)
		return probe.ok === true && probe.out === 'true'
	}

	/** 旁路账本仓库的位置:按工作区路径派生(与工作副本同一套 slug)。 */
	function ledgerDirFor(cwd) {
		const slug = createHash('sha256').update(cwd).digest('hex').slice(0, 12)
		return join(DSH_HOME, 'storages', 'clearai', 'ledger', slug)
	}

	/** 成本护栏:工作区太大就不建旁路账本(数文件,数到上限就停)。 */
	function countFiles(dir, limit) {
		let count = 0
		const walk = (current) => {
			let entries
			try {
				entries = readdirSync(current, { withFileTypes: true })
			} catch {
				return
			}
			for (const entry of entries) {
				if (count > limit) return
				if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.clearai') continue
				if (entry.isDirectory()) walk(join(current, entry.name))
				else count += 1
			}
		}
		walk(dir)
		return count
	}

	/**
	 * 这一轮 git 操作该落在哪:工作区本身是仓库就直接用(用户可见的分支);
	 * 不是仓库就在数据区建**旁路账本仓库**,把工作区当成它的工作树
	 * (`--git-dir` + `--work-tree`,用户文件夹里不会出现 `.git`)。
	 * 两者都不行 → mode 为 null,退化成声明目录并如实说明原因。
	 */
	function gitContext(cwd, baselineMessage) {
		if (isGitWorkspace(cwd)) return { mode: 'workspace', cwd, gitDir: null, reason: null }
		const gitDir = ledgerDirFor(cwd)
		if (!existsSync(join(gitDir, 'HEAD'))) {
			const files = countFiles(cwd, CFG.ledgerMaxFiles + 1)
			if (files > CFG.ledgerMaxFiles) {
				return { mode: null, cwd, gitDir: null, reason: `工作区有 ${files}+ 个文件,超过旁路账本的上限(${CFG.ledgerMaxFiles})` }
			}
			mkdirSync(gitDir, { recursive: true })
			const init = git(['init', '--bare', '-q', gitDir], cwd)
			if (!init.ok) return { mode: null, cwd, gitDir: null, reason: `旁路账本建不起来:${(init.err || '').split('\n')[0]}` }
			git(['--git-dir', gitDir, 'config', 'core.bare', 'false'], cwd)
			git(['--git-dir', gitDir, 'config', 'core.worktree', cwd], cwd)
			const context = { mode: 'ledger', cwd, gitDir, reason: null }
			const added = gitAt(context, ['add', '-A'])
			/**
			 * 基线的提交信息可以**由调用方给**:账本是懒建的,如果第一次建立就发生在某一步交付那一刻,
			 * 那么这一笔既是基线、也是那一步的账 —— 信息必须写成那一步,否则那一步就"没有自己的提交"了
			 * (失效模式:基线把第一步的内容吞掉,历史里那一步只剩一条匿名基线)。
			 */
			const committed = added.ok ? gitAt(context, [...GIT_IDENTITY, 'commit', '-qm', baselineMessage ?? 'clearai:旁路账本基线(工作区当时的全部内容)']) : added
			if (!committed.ok && !/nothing to commit|无文件要提交|working tree clean/i.test(`${committed.out}${committed.err}`)) {
				return { mode: null, cwd, gitDir: null, reason: `旁路账本基线提交失败:${(committed.err || committed.out || '').split('\n')[0]}` }
			}
		}
		return { mode: 'ledger', cwd, gitDir, reason: null }
	}

	/** 在主树上跑 git(旁路账本模式要显式带上 --git-dir/--work-tree)。 */
	function gitAt(context, args) {
		const prefix = context.mode === 'ledger' ? ['--git-dir', context.gitDir, '--work-tree', context.cwd] : []
		return git([...prefix, ...args], context.cwd)
	}

	// ── 账本(D3/D4:账本 = git,与世界线共用一本) ─────────────────────────────
	//
	// ClearAI 的账本是**每次写入**都记一笔(带 turn/tool 归属),我们记在**交付点**:
	// 一次提交 = 一次「这一步交付时工作区长什么样」。这是刻意的偏离:
	// 每次写入的归属在 DSH 里属于宿主的 fs 领域,而交付点归属是内核真正知道的事实。
	// 两条性质照抄不变:**只前进**(恢复 = 新版本 + 新提交)与**留下来源**(提交信息写步 id)。

	/** 在**当前工作区**上落一次账本提交;没有改动就不提交(空提交是噪音)。 */
	function commitLedger(cwd, message) {
		// 把这一步的信息带进建基线那一笔:懒建账本时,基线就是这一步的提交。
		const context = gitContext(cwd, message)
		if (context.mode === null) return { ok: false, reason: context.reason ?? '没有可用的 git' }
		const added = gitAt(context, ['add', '-A'])
		if (added.ok !== true) return { ok: false, reason: `add 失败:${(added.err || '').split('\n')[0]}` }
		const status = gitAt(context, ['status', '--porcelain'])
		if (status.ok === true && status.out.trim() === '') return { ok: true, skipped: true, commit: null, mode: context.mode }
		const committed = gitAt(context, [...GIT_IDENTITY, 'commit', '-qm', message])
		if (committed.ok !== true) {
			const detail = `${committed.err || committed.out || ''}`.split('\n')[0]
			if (/nothing to commit|working tree clean|无文件要提交/i.test(detail)) return { ok: true, skipped: true, commit: null, mode: context.mode }
			return { ok: false, reason: detail }
		}
		const head = gitAt(context, ['rev-parse', '--short', 'HEAD'])
		return { ok: true, skipped: false, commit: head.ok === true ? head.out.trim() : null, mode: context.mode }
	}

	/** 账本里碰过某个路径的提交(新的在前)。 */
	function ledgerHistory(cwd, path, limit) {
		const context = gitContext(cwd)
		if (context.mode === null) return { ok: false, reason: context.reason ?? '没有可用的 git', entries: [] }
		const log = gitAt(context, ['log', `-n${Math.max(1, Math.min(50, limit))}`, '--format=%h%x1f%aI%x1f%s', '--', path])
		if (log.ok !== true) return { ok: false, reason: `读历史失败:${(log.err || '').split('\n')[0]}`, entries: [] }
		const entries = log.out
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== '')
			.map((line) => {
				const [commit, at, subject] = line.split('\u001f')
				return { commit, at, subject }
			})
		return { ok: true, entries, mode: context.mode }
	}

	/** 从某个提交里取一个路径的内容(不落盘)。 */
	function ledgerShow(cwd, commit, path) {
		const context = gitContext(cwd)
		if (context.mode === null) return { ok: false, reason: context.reason ?? '没有可用的 git' }
		const prefix = context.mode === 'ledger' ? ['--git-dir', context.gitDir, '--work-tree', context.cwd] : []
		const shown = gitRaw([...prefix, 'show', `${commit}:${path}`], context.cwd)
		if (shown.ok !== true) return { ok: false, reason: `这个提交里没有 ${path}` }
		return { ok: true, content: shown.out }
	}

	/**
	 * 世界线的工作副本放在**仓库外**(DSH 数据区),按工作区路径派生目录。
	 *
	 * 为什么不能在仓库里放 `.clearai/worldlines/`:那些目录会被主树当成未跟踪内容,
	 * 而采纳前的「把用户手上的改动存成一条提交」用的是 `git add -A` —— 那会把**其他世界线的
	 * 内容当成主线的改动一起提交进去**。工作副本必须在仓库之外,分支 ref 仍然在仓库里(用户可见)。
	 */
	/**
	 * 世界线工作副本的容器:**工作区里**(`<workspace>/clear/worldlines/`)。
	 *
	 * 位置由**宿主沙箱的硬边界**决定:它只允许写「会话自己的 cwd」,
	 * 而原生子代理**继承父会话的 cwd**(`dsh-subagent` 的 `childSessionMeta` 写死
	 * `cwd: parentHeader.cwd`,`SubagentStartRequest` 没有 cwd 字段,沙箱也没有「额外可写根」的缝)。
	 * 于是原设计那个位置(数据区、jail 之外)会让每个执行者**写不进自己的交付物**:
	 * 沙箱报 `[sandbox: file access denied under workspace-write mode]`,只能申请提权——而人只会拒绝。
	 *
	 * 前提是:「**分支 run 的根就是它自己的 worktree**」,
	 * 所以它写自己是「jail 之内」。DSH 给不了子会话自己的根 ⇒ 位置必须让位于沙箱边界。
	 *
	 * 为什么放 `clear/` 而不是 `.clearai/`:这个产品对用户有一句明确承诺——「系统只在你的文件夹里
	 * 加 `clear/` 一个目录」。放 `clear/worldlines/` 完全在那句承诺之内,而且照样在沙箱可写区里。
	 *
	 * 代价(三条):① 要往账本仓库(工作区本身是 git 仓库时是它的)写
	 * `.git/info/exclude`,否则每次交付提交会把各条世界线的文件一起提进主线历史;
	 * ② 「只准写自己那条」从此由**我们的路径守卫**承担(沙箱只保证「在工作区内」);
	 * ③ 备份/同步会同时看到两份(与旧的放置方式同样的成本)。
	 */
	function worldlineBase(cwd) {
		return join(cwd, 'clear', 'worldlines')
	}

	/**
	 * 让 git **看不见**世界线工作副本:把容器写进仓库的 `info/exclude`(本地、不提交、不外传)。
	 *
	 * 不写这一行的后果是具体的:交付点的 `git add -A` 会把**各条世界线**的文件一起提交进主线历史
	 * ——污染主线,而且把「互不通信」的三条方案和它们的中间产物全部泄漏进账本。
	 */
	function ensureWorldlineExcluded(cwd) {
		const container = 'clear/worldlines/'
		const context = gitContext(cwd)
		if (context.mode === null) return { ok: false, reason: context.reason }
		const gitDir = context.mode === 'ledger' ? context.gitDir : git(['rev-parse', '--absolute-git-dir'], cwd).out.trim()
		if (gitDir === '') return { ok: false, reason: '取不到 git 目录' }
		const file = join(gitDir, 'info', 'exclude')
		let current = ''
		try {
			current = readFileSync(file, 'utf8')
		} catch {
			/* 还没有这个文件:下面建 */
		}
		if (current.split('\n').some((line) => line.trim() === container)) return { ok: true, already: true }
		try {
			mkdirSync(dirname(file), { recursive: true })
			writeFileSync(file, `${current === '' || current.endsWith('\n') ? current : `${current}\n`}# clearai:世界线工作副本(它们各自是独立的 git worktree,不属于主线)\n${container}\n`, 'utf8')
			return { ok: true, already: false }
		} catch (error) {
			return { ok: false, reason: String(error?.message ?? error).slice(0, 200) }
		}
	}

	function branchFor(forkId, branchId) {
		return `clearai/${forkId}/${branchId}`
	}

	/**
	 * **盘上残留的读数**:截断之后,上一轮的世界线工作副本与分支还躺在盘上,
	 * 而**新会话的投影是从零开始的**——树上看不到、卡片不提,连「它们存在」这件事都没人报。
	 *
	 * 「什么都不删」(P5)不该等于「什么都看不见」:残留是一条**事实**,该像目录、当档一样
	 * 自己回到投影里,由人来决定留着还是清掉。判据只认两条已有事实:
	 *   · 容器目录里有几份工作副本(`clear/worldlines/<fork>/<branch>/`);
	 *   · `clearai/*` 分支 ref 有几个 —— **减掉当前这盘自己的那些**(自己的不算残留)。
	 *
	 * 不写状态、不新增变更类型:它只是每个会话开场的**一句读数**(扫一次就够,见调用点的去重)。
	 */
	function worldlineResidue(cwd, state) {
		const own = new Set((state?.forks ?? []).map((fork) => String(fork.id)))
		const root = join(cwd, 'clear', 'worldlines')
		const containers = []
		let worktrees = 0
		try {
			for (const name of readdirSync(root)) {
				if (own.has(name)) continue
				let entries = []
				try {
					entries = readdirSync(join(root, name), { withFileTypes: true })
				} catch {
					continue
				}
				const branches = entries.filter((entry) => entry.isDirectory()).length
				if (branches === 0) continue
				containers.push({ id: name, branches })
				worktrees += branches
			}
		} catch {
			return null // 没有容器目录(或读不了):没有残留可报,不是故障
		}
		if (containers.length === 0) return null
		const listed = git(['for-each-ref', 'refs/heads/clearai', '--format=%(refname:short)'], cwd)
		const strayRefs =
			listed.ok === true
				? listed.out
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line !== '' && ![...own].some((id) => line.includes(id))).length
				: null
		return { containers, worktrees, strayRefs }
	}

	/**
	 * 给一个分叉把每条世界线物化成 **分支 + worktree**。
	 * 只有工作区本身是 git 仓库时才做(A 层);不是仓库时返回 ok:false,由调用方退化成声明目录。
	 */
	function prepareWorldlines(cwd, forkId, branches) {
		const context = gitContext(cwd)
		if (context.mode === null) return { ok: false, reason: context.reason }
		// 先把容器排除掉,再开工作副本——顺序反了的话,中途失败的 worktree 会留在 status 里。
		const excluded = ensureWorldlineExcluded(cwd)
		if (excluded.ok !== true) return { ok: false, reason: `世界线容器排除失败(git 会看见工作副本):${excluded.reason}` }
		const base = worldlineBase(cwd)
		const prepared = []
		for (const branch of branches) {
			const path = join(base, forkId, branch.id)
			const name = branchFor(forkId, branch.id)
			mkdirSync(dirname(path), { recursive: true })
			const added = gitAt(context, ['worktree', 'add', '-q', path, '-b', name])
			if (!added.ok) {
				return { ok: false, reason: `worktree 建不起来(${name}):${(added.err || added.out || '').split('\n')[0]}`, prepared }
			}
			prepared.push({ id: branch.id, label: branch.label, path, branch: name })
		}
		return { ok: true, prepared, base, tier: context.mode }
	}

	/** 把某条世界线里还没提交的活提交到它自己的分支(删工作副本前必须做,否则就是"删了留不住")。 */
	function commitWorldline(path, message) {
		const status = git(['status', '--porcelain'], path)
		if (!status.ok) return { ok: false, reason: status.err }
		if (status.out === '') return { ok: true, committed: false }
		git(['add', '-A'], path)
		const committed = git([...GIT_IDENTITY, 'commit', '-qm', message], path)
		return committed.ok ? { ok: true, committed: true } : { ok: false, reason: committed.err.split('\n')[0] ?? '' }
	}

	/** 删工作副本,**保留 branch ref**(P5:落选的世界线必须永久可读)。 */
	function removeWorldline(cwd, path, branch) {
		const context = gitContext(cwd)
		if (context.mode === null) return { ok: false, reason: context.reason }
		const committed = commitWorldline(path, `worldline ${branch}: 落选前的最后状态`)
		const removed = gitAt(context, ['worktree', 'remove', path])
		if (removed.ok) return { ok: true, committed: committed.committed === true, removed: true }
		// git 拒绝(还剩未跟踪的文件之类):用 --force,但**先确认活已经提交过**
		if (committed.ok !== true) return { ok: false, reason: `世界线里还有未提交的活,不敢删:${committed.reason ?? (removed.err || '').split('\n')[0]}` }
		const forced = gitAt(context, ['worktree', 'remove', '--force', path])
		return forced.ok ? { ok: true, committed: true, removed: true, forced: true } : { ok: false, reason: (forced.err || '').split('\n')[0] }
	}

	/**
	 * 采纳 = 把赢家世界线合并回主线。
	 * 三种结局都要如实回报:merged / already-up-to-date / conflict(冲突绝不自动选边)。
	 * 主线脏且与世界线改动重叠时,git 会拒绝——此时先把用户手上的快照落成一条提交,再合并。
	 */
	function adoptWorldline(cwd, branch, message) {
		const context = gitContext(cwd)
		if (context.mode === null) return { ok: false, reason: `没有可用的 git(${context.reason})`, conflict: false, snapshotCommit: null }
		const snapshot = () => {
			const status = gitAt(context, ['status', '--porcelain'])
			if (!status.ok || status.out === '') return null
			gitAt(context, ['add', '-A'])
			const committed = gitAt(context, [...GIT_IDENTITY, 'commit', '-qm', 'clearai:采纳前的工作区快照(你手上的改动已存为一条提交)'])
			if (!committed.ok) return null
			const head = gitAt(context, ['rev-parse', 'HEAD'])
			return head.ok ? head.out : null
		}
		const attempt = () => gitAt(context, [...GIT_IDENTITY, 'merge', '--no-ff', '-m', message, branch])
		let merged = attempt()
		let snapshotCommit = null
		if (!merged.ok && /local changes|本地修改/.test(`${merged.err}\n${merged.out}`)) {
			snapshotCommit = snapshot()
			merged = attempt()
		}
		if (!merged.ok) {
			// 冲突:停下问人,绝不自动选边
			gitAt(context, ['merge', '--abort'])
			return { ok: false, reason: '合并冲突(两个方案改了同一个地方)', conflict: true, snapshotCommit, detail: (merged.err || merged.out).split('\n')[0] ?? '' }
		}
		const head = gitAt(context, ['rev-parse', 'HEAD'])
		const already = /Already up to date|已经是最新的/.test(merged.out)
		return { ok: true, commit: head.ok ? head.out : null, mode: already ? 'already-up-to-date' : 'merged', snapshotCommit }
	}

	/** 交叉校验:git 那边的分支与工作副本清单(第二处事实源,但用户可见)。 */
	function worldlineInventory(cwd, forkId) {
		const context = gitContext(cwd)
		if (context.mode === null) return null
		const branches = gitAt(context, ['branch', '--list', `clearai/${forkId}/*`, '--format=%(refname:short)'])
		const worktrees = gitAt(context, ['worktree', 'list', '--porcelain'])
		return {
			branches: branches.ok && branches.out !== '' ? branches.out.split('\n') : [],
			worktrees: worktrees.ok ? worktrees.out.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9)) : [],
		}
	}

	function validateForkOptions(options, decideBy) {
		if (!Array.isArray(options) || options.length < 2 || options.length > 4) return 'fork_needs_2to4_options:世界线要 2–4 条(分叉是「选一」,不是清单)'
		if (decideBy === null || decideBy === undefined || typeof decideBy !== 'object') return 'decide_by_required:分叉必须登记一把尺子 {metric, direction}——没有判定契约就不能收敛'
		if (typeof decideBy.metric !== 'string' || decideBy.metric.trim() === '') return 'decide_by_metric_required:尺子要有指标名(如 yield_pct)'
		if (decideBy.direction !== 'max' && decideBy.direction !== 'min') return 'decide_by_direction_required:尺子要说明方向:max(越大越好)或 min(越小越好)'
		const labels = new Set()
		for (const [index, option] of options.entries()) {
			const at = `第 ${index + 1} 条世界线`
			if (option === null || typeof option !== 'object') return `invalid_option:${at} 不是一个对象`
			if (typeof option.label !== 'string' || option.label.trim() === '') return `label_required:${at} 要有短标签(世界树上显示的就是它)`
			if (labels.has(option.label.trim())) return `duplicate_label:标签重复:${option.label}`
			labels.add(option.label.trim())
			if (typeof option.approach !== 'string' || option.approach.trim() === '') return `no_approach:${at} 要写清怎么做(这条路线的做法)`
			if (typeof option.done_criteria !== 'string' || option.done_criteria.trim().length < 4) return `no_done_criteria:${at} 要有判定标准`
			const selfRef = SELF_REFERENCE.find(([pattern]) => pattern.test(option.done_criteria))
			if (selfRef !== undefined) return `criteria_self_reference:${at} 的判据自指:${selfRef[1]}`
			if (!option.done_criteria.includes(decideBy.metric.trim())) return `decide_by_not_measured:${at} 的判据里没有出现裁决指标「${decideBy.metric.trim()}」——尺子必须写进每条世界线的判据,否则它量不到东西`
			if (option.level !== undefined && levelIndexOf(option.level) < 0) return `invalid_option:${at} 的 level 必须是 L0–L4`
		}
		return null
	}

	/** 横评仲裁的判决卡字段。 */
	const ARBITER_SCHEMA = {
		type: 'object',
		properties: {
			winner: { type: ['string', 'null'], description: '胜出的 branch_id;无法分出高下就填 null' },
			ranking: { type: 'array', items: { type: 'string' }, description: 'branch_id,从优到劣' },
			reason: { type: 'string', description: '凭哪些卡上的事实这样裁(引用具体条目),一到三句' },
			confidence: { type: 'string', enum: ['high', 'low'] },
		},
		required: ['winner', 'reason'],
		additionalProperties: false,
	}

	/**
	 * 横评仲裁的任务书:只把「分支Evaluator」写成「独立评估者」。
	 *
	 * **兜底,不是默认路径**:默认路径上胜负是算术(不调 LLM、不派子 run)。只有当各分支
	 * 都说「这条可信」、却没有两条报得出数值读数时才派它——那意味着尺子不是数值型的
	 * (「哪个设计更简洁」),证据在卡里、只是不能相减。
	 *
	 * **跨分支视野靠注入,不靠授权**:分支隔离是刻意的,给谁开跨分支读权都会摧毁
	 * 「每张卡是独立证据」这个前提。所以各分支的评估卡**写进任务书**——它得到事实,
	 * 没有得到权限(toolFilter 是空表)。
	 */
	function arbiterTask(fork, cards) {
		const metric = fork.decide_by?.metric ?? ''
		const direction = fork.decide_by?.direction ?? ''
		const ruler =
			metric !== ''
				? `本次分叉声明的裁决尺子是 \`${metric}\`(${direction === 'min' ? '越小越好' : '越大越好'})。它没能落成两个可以相减的数——所以由你按这把尺子的**本意**去裁。\n\n`
				: '本次分叉没有留下可用的裁决尺子,请按分歧本身去裁。\n\n'
		const blocks = cards.map(
			(card) =>
				`### 世界线「${card.label}」(branch_id=${card.branch_id})\n` +
				`- 方案:${card.approach || '(未记录)'}\n` +
				`- 判定标准:${card.done_criteria || '(未记录)'}\n` +
				`- 独立评估者可信判定:${card.validity || '(未判定)'}\n` +
				'```json\n' +
				`${JSON.stringify(card.eval_card ?? {}, null, 1)}\n` +
				'```',
		)
		return (
			`你是这次分叉的**横评仲裁**。围绕分歧「${fork.question}」,各条世界线都已执行完毕并各自被独立评估者核对过。你的活是**在它们之间裁出一个胜者**。\n\n` +
			ruler +
			'## 各世界线的评估卡(Harness 提供,权威、只读)\n' +
			'以下是全部证据。你**看不到也不需要**任何分支的工作区——世界线之间刻意互不可见,那正是每张卡能当独立证据用的前提。请只基于这些卡作判断,不要臆测卡里没有的事实。\n\n' +
			blocks.join('\n\n') +
			'\n\n## 纪律\n' +
			'- **裁的是「哪条更好地回答了那个分歧」**,不是「哪条写得更整齐」。一条如实跑完、结果就是不好的世界线,是**可信的负面结果**,不该因为诚实而被罚。\n' +
			'- 证据不足以分出高下时**就说不足**——`winner` 留空比硬选一个诚实得多,那种情况会转交给主 agent 带着事实继续处置,不是死路。\n' +
			'- 你只裁不采纳,也不能修改任何产物,不能问用户。' +
			'\n\n## 最终答复:严格按这张卡回结构化结果\n' +
			`{"winner":"<胜出的 branch_id;无法分出高下则填 null>","ranking":["<branch_id,从优到劣>"],"reason":"凭哪些卡上的事实这样裁(引用具体条目),一到三句","confidence":"high|low"}`
		)
	}

	/** 把仲裁回执归一;胜者必须是**这次分叉里真实存在的**分支,否则作废(ClearAI 同款)。 */
	function normalizeArbiterVerdict(raw, validIds) {
		const source = raw === null || typeof raw !== 'object' ? {} : raw
		const winner = typeof source.winner === 'string' && validIds.includes(source.winner) ? source.winner : null
		const ranking = Array.isArray(source.ranking) ? source.ranking.filter((id) => typeof id === 'string' && validIds.includes(id)) : []
		const reason = typeof source.reason === 'string' ? source.reason.slice(0, 1200) : ''
		const confidence = source.confidence === 'high' ? 'high' : 'low'
		return { winner, ranking, reason, confidence }
	}

	/**
	 * 派一个横评仲裁。触发条件很窄:各分支都交付了、都说可信,却没有两条报得出数值读数。
	 * 判决**不是采纳**:它只是把「算不出」变回「算得出」,采纳仍由既有那条路走;而且因为
	 * 它是判断不是算术,`decideWinner` 不给余量,一定走**临时采纳 + 人复核痕迹**。
	 */
	async function runArbiter(sessionId, agent, fork, signal) {
		const mutations = []
		const cards = []
		for (const branch of fork.branches) {
			let card = null
			if (typeof branch.card_path === 'string' && branch.card_path !== '') {
				try {
					card = JSON.parse(readFileSync(branch.card_path, 'utf8'))
				} catch {
					card = null
				}
			}
			cards.push({
				branch_id: branch.id,
				label: branch.label,
				approach: branch.approach,
				done_criteria: branch.done_criteria,
				validity: branch.validity,
				eval_card: card,
			})
		}
		const dispatched = await dispatchSubRun({
			label: `横评仲裁 · ${String(fork.question).slice(0, 18)}`,
			persona: EVALUATOR_DISCIPLINE,
			prompt: arbiterTask(fork, cards),
			outputSchema: ARBITER_SCHEMA,
			// 它拿到的是**注入的事实**,不是任何分支的读权:空工具面。
			toolFilter: { allow: [] },
			parent: agent,
			signal,
		})
		if (dispatched.ok !== true) {
			return { verdict: null, mutations, note: `横评仲裁无法派遣(${dispatched.reason})——这一步没有买到新信息,照实交回主 agent。` }
		}
		const arbiterSession = String(dispatched.run.id)
		mutations.push({ t: 'fork/arbitration_dispatched', fork: fork.id, arbiter_session: arbiterSession, capability: dispatched.capability })
		const outcome = await Promise.race([
			dispatched.run.result.then(
				(value) => ({ ok: true, value }),
				(error) => ({ ok: false, error }),
			),
			new Promise((resolve) => {
				const timer = setTimeout(() => resolve(null), CFG.auditTimeoutMs)
				if (typeof timer?.unref === 'function') timer.unref()
			}),
		])
		if (outcome === null) return { verdict: null, mutations, note: `横评仲裁仍在跑(${Math.round(CFG.auditTimeoutMs / 1000)}s 未回)。` }
		if (outcome.ok !== true) return { verdict: null, mutations, note: `横评仲裁失败:${String(outcome.error?.message ?? outcome.error).slice(0, 200)}` }
		// 仲裁被中断也是 resolve:这时它没有判决,别把"没判决"写成"裁不出来"。
		{
			const settled = settleSubRun(outcome.value)
			if (settled.ok !== true) return { verdict: null, mutations, note: `横评仲裁未正常结束(${settled.stopReason}),这一步没有买到新信息,照实交回主 agent。` }
		}
		const structured = outcome.value?.structured
		const verdict = normalizeArbiterVerdict(structured, fork.branches.map((branch) => branch.id))
		mutations.push({
			t: 'fork/arbitrated',
			fork: fork.id,
			winner: verdict.winner,
			ranking: verdict.ranking,
			reason: verdict.reason,
			confidence: verdict.confidence,
			arbiter_run_id: arbiterSession,
		})
		return { verdict, mutations, note: null }
	}

	/** 世界线收敛的算术:`decide_winner`。不做语义判定、不路由、不决定谁赢。 */
	function decideWinner(fork) {
		const contract = fork.decide_by
		if (contract === null || contract === undefined || typeof contract.metric !== 'string' || contract.metric === '') {
			return { undecidable: { code: 'UNDECIDABLE_NO_CONTRACT', reason: '这个分叉没有登记尺子(decide_by):没有判定契约就不能收敛。' } }
		}
		const rows = []
		for (const branch of fork.branches) {
			if ((BRANCH_RANK[branch.status] ?? 0) >= BRANCH_RANK.adopted) continue
			if (branch.validity !== 'usable') continue
			const value = metricReading(branch.reading)
			if (value === null) continue
			rows.push({ branch: branch.id, label: branch.label, value })
		}
		if (rows.length < 2) {
			// 兜底:尺子落不成数(「哪个设计更简洁」)时,横评仲裁的判决顶上。它是**判断**
			// 不是算术,所以不给余量——采纳一定走「临时采纳 + 人复核痕迹」那一档
			// (`_finalize_fork_arbitration` 的原话:「机器可以替人做判断,但不能假装
			// 那是个算出来的结论」)。
			const arbitration = fork.arbitration ?? null
			if (arbitration !== null && fork.branches.some((branch) => branch.id === arbitration.winner)) {
				return {
					winner: arbitration.winner,
					margin: null,
					tie: false,
					metric: contract.metric,
					direction: contract.direction === 'min' ? 'min' : 'max',
					readings: rows,
					by: 'arbiter',
					arbiter_reason: arbitration.reason ?? '',
				}
			}
			return {
				undecidable: {
					code: 'UNDECIDABLE_NO_READINGS',
					reason: `只有 ${rows.length} 条世界线报出了可用读数(需要 ≥2 条才能比较)。${UNDECIDABLE_OUTS}`,
					readings: rows,
				},
			}
		}
		const direction = contract.direction === 'min' ? 'min' : 'max'
		const sorted = rows.slice().sort((a, b) => (direction === 'min' ? a.value - b.value : b.value - a.value))
		// 相对差距,不是绝对差:指标带单位,绝对阈值跨指标没有意义(ClearAI 的原话)。
		const denom = Math.max(Math.abs(sorted[0].value), Math.abs(sorted[1].value)) || 1
		const margin = Math.abs(sorted[0].value - sorted[1].value) / denom
		// 并列**不是**「算不出」:指标说这两条一样好,那是买到的信息,不是信息缺失。
		// 按我们自己签的契约任一条都合格,所以照常给出胜者——但余量 0 必然落进
		// 「临时采纳 + 待复核」那一档,人有机会复核(ClearAI 的 tie 语义逐字对齐)。
		return { winner: sorted[0].branch, margin, tie: sorted[0].value === sorted[1].value, metric: contract.metric, direction, readings: rows, by: 'metric' }
	}

	defineTool({
		name: 'ForkPlan',
		description:
			'分叉:把一个步骤分成 2–4 条互斥的世界线,每条自己做一份工作副本、自己交付。**必须先登记一把尺子**(decide_by{metric,direction}),而且这把尺子要写进每条世界线的判据里——把测量仪装到每条世界线上。收敛由算术决定,不由谁说得响。分叉是「选一」,不是并行加速。',
		parameters: {
			type: 'object',
			properties: {
				question: { type: 'string', description: '要裁决的分歧:一句话说清这条岔路在选什么' },
				options: {
					type: 'array',
					description: '2–4 条互斥路线',
					items: {
						type: 'object',
						properties: {
							label: { type: 'string' },
							approach: { type: 'string' },
							done_criteria: { type: 'string' },
							workspace: { type: 'string', description: '这条世界线自己的工作副本目录(相对 workspace);内核据此强制隔离' },
							artifacts: { type: 'array', items: { type: 'string' } },
							level: { type: 'string', enum: LEVELS },
						},
						required: ['label', 'approach', 'done_criteria'],
						additionalProperties: false,
					},
				},
				decide_by: {
					type: 'object',
					properties: { metric: { type: 'string' }, direction: { type: 'string', enum: ['max', 'min'] } },
					required: ['metric', 'direction'],
					additionalProperties: false,
				},
			},
			required: ['question', 'options', 'decide_by'],
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
			if (plan === null) return fail('no_active_plan', '没有活动计划:分叉长在计划的一步上。')
			const step = firstOpenStep(plan)
			if (step === null) return fail('no_open_step', '这份计划没有未落定的步了。')
			if (typeof args.question !== 'string' || args.question.trim() === '') return fail('question_required', '分叉要说清要裁决的分歧是什么。')
			if (forkOfStep(hostService.derive(sessionId).forks, step.id) !== null) return fail('fork_depth_exceeded', `步骤 ${step.id} 已经长过一个分叉了:一步只分叉一次。`)
			const problem = validateForkOptions(args.options, args.decide_by)
			if (problem !== null) return fail(problem.split(':')[0], problem)
			const forkId = uniqueId('k')
			const options = args.options.map((option) => ({
				id: `b-${Math.random().toString(36).slice(2, 7)}`,
				label: option.label.trim(),
				approach: option.approach.trim(),
				done_criteria: option.done_criteria,
				workspace: option.workspace ?? null,
				artifacts: option.artifacts ?? [],
				level: option.level ?? 'L0',
			}))
			// 世界线 = 分支 + worktree(工作区是 git 仓库时)。物化失败不挡分叉:
			// 退化成"声明的工作副本目录",并把降级事实如实落账。
			const materialized = CFG.gitWorldlines ? prepareWorldlines(cwd, forkId, options) : { ok: false, reason: 'gitWorldlines 关闭' }
			if (materialized.ok === true) {
				for (const entry of materialized.prepared) {
					const option = options.find((item) => item.id === entry.id)
					if (option !== undefined) option.workspace = entry.path
				}
			}
			mutations.push({ t: 'fork/created', id: forkId, step: step.id, plan: plan.id, question: args.question.trim(), decide_by: { metric: args.decide_by.metric.trim(), direction: args.decide_by.direction }, options })
			mutations.push({
				t: 'worldline/prepared',
				fork: forkId,
				tier: materialized.ok === true ? materialized.tier : 'declared',
				base: materialized.ok === true ? materialized.base : null,
				reason: materialized.ok === true ? null : materialized.reason,
				branches: materialized.ok === true ? materialized.prepared.map((entry) => ({ id: entry.id, branch: entry.branch, path: entry.path })) : [],
			})
			// 每条世界线派一个**独立执行者**(fresh context,只看得见自己的任务书):
			// 「世界线互不通信」不靠嘱咐,靠它拿不到别的上下文、也写不进别的目录。
			/**
			 * 执行者**放出去就走**:派遣这一笔(含 `fork/created`、`worldline/prepared`、`worldline/executing`)
			 * 随本次工具结果立即落账。结论不在这里等——它们在跑完之后由 pre-step 的 sweep 收,
			 * 或者由你调 `WorldlineStatus` 主动收。**事实先落账,活再干**。
			 */
			const dispatchedExecutors = []
			if (CFG.autoDispatchExecutors && materialized.ok === true) {
				const forkView = { id: forkId, question: args.question.trim(), decide_by: options === undefined ? null : { metric: args.decide_by.metric.trim(), direction: args.decide_by.direction } }
				for (const option of options) {
					const started = await startWorldlineExecutor(sessionId, exec.agent, forkView, { id: option.id, label: option.label, approach: option.approach, done_criteria: option.done_criteria, workspace: option.workspace }, exec.signal)
					mutations.push(...started.mutations)
					dispatchedExecutors.push({ label: option.label, ok: started.ok, note: started.note ?? null })
				}
			}
			const running = dispatchedExecutors.filter((item) => item.ok === true).map((item) => item.label)
			return done({
				ok: true,
				code: 'fork_created',
				message:
					`步骤 ${step.id} 上长出 ${args.options.length} 条世界线,尺子:${args.decide_by.metric}(${args.decide_by.direction === 'min' ? '越小越好' : '越大越好'})。\n` +
					(materialized.ok === true
						? `每条世界线已经是一份**独立的工作副本 + git 分支**(${materialized.prepared.map((entry) => entry.branch).join('、')})${materialized.tier === 'ledger' ? '(工作区不是 git 仓库,账本建在数据区,你的文件夹里不会多出 .git)' : ''}。\n`
						: `工作区不是 git 仓库,世界线退化成声明的工作副本目录(${materialized.reason})。\n`) +
					(running.length > 0
						? `执行者**已经在各自的工作副本里作业**(${running.join('、')})——他们跑完的结论会在**下一个回合边界**(或用下面两件工具时)作为事实回灌到这一步。看进展用 WorldlineStatus;要在这个回合里就等结论,用 AwaitWorldlines(有界等待,等到了顺手落账)——**不要用 bash sleep 空等**:结论什么时候回来与你睡多久无关。\n`
						: '') +
					(dispatchedExecutors.some((item) => item.ok !== true)
						? `派不出去的:${dispatchedExecutors.filter((item) => item.ok !== true).map((item) => `${item.label}(${item.note})`).join('、')}。\n`
						: '') +
					'下一步:等结论回灌后,逐条用 AdvanceWorldline 交付读数(交付会走观测准入;L3 以上由独立评估者读数)。\n' +
					'全部交付后用 ConvergeFork 让算术裁决;未收敛的分叉不能被普通交付越过。',
			})
		},
	})

	defineTool({
		name: 'AdvanceWorldline',
		description:
			'交付一条世界线:提交它的观测与读数。产物的存在、非空、结构由系统核;读数**整串必须就是一个数**(`62.1`、`12%` 可以,`[1.2,3.4]` 不行——那会「自信地选错」)。L3 以上的世界线由独立评估者读数,你不要自己写 verdict。',
		parameters: {
			type: 'object',
			properties: {
				branch_id: { type: 'string', description: '交付哪条世界线(id 或 label)' },
				observations: {
					type: 'array',
					description: '这条世界线的观测。`ref` 用**它工作副本里的相对路径**(如 `params_c.csv` / `lab/params_c.csv`),系统按那条世界线的工作副本解析;写绝对路径时必须指向它自己的工作副本。',
					items: { type: 'object', properties: { ref: { type: 'string' }, note: { type: 'string' } }, required: ['ref'], additionalProperties: false },
				},
				verdict: { type: 'string', enum: ['support', 'refute', 'inconclusive'], description: '仅 L0–L2 可自判' },
				basis: { type: 'string', description: '自判依据(必须可复查)' },
				reading: { type: 'string', description: '按裁决指标报出的读数:整串必须就是一个数' },
				validity: { type: 'string', enum: ['usable', 'unusable'] },
			},
			required: ['branch_id'],
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
			if (plan === null) return fail('no_active_plan', '没有活动计划。')
			const step = firstOpenStep(plan)
			if (step === null) return fail('no_open_step', '这份计划没有未落定的步了。')
			const fork = forkOfStep(hostService.derive(sessionId).forks, step.id)
			if (fork === null) return fail('no_fork', `步骤 ${step.id} 上没有分叉:先用 ForkPlan。`)
			// 评估卡与评估者会话(仲裁的输入、面板的旁观入口)。自判那条路没有它们,留 null。
			let auditCardPath = null
			let auditSessionId = null
			if (fork.settled || fork.abandoned) return fail('fork_settled', '这个分叉已经收敛或放弃了:世界线不再接受交付。')
			const branch = fork.branches.find((item) => item.id === args.branch_id || item.label === args.branch_id)
			if (branch === undefined) return fail('unknown_branch', `没有这条世界线:${args.branch_id}(可选:${fork.branches.map((item) => item.id).join(', ')})`)
			if (branch.status !== 'exploring') return fail('branch_already_delivered', `世界线 ${branch.label} 已经交付过了(${branch.status})。`)

			// 隔离强制:世界线的观测必须来自它自己的工作副本
			const workspaceRoot = branch.workspace === null || branch.workspace === undefined ? null : resolvePath(cwd, branch.workspace)
			const accepted = []
			for (const observation of Array.isArray(args.observations) ? args.observations : []) {
				if (typeof observation?.ref !== 'string' || observation.ref.trim() === '') continue
				const ref = observation.ref.trim()
				/**
				 * 相对路径按**这条世界线自己的工作副本**解析。
				 *
				 * 原来按主线 `cwd` 解析,于是「世界线的观测」永远落在主线路径上,再被下面那条
				 * 隔离检查拒掉——用户那次真跑里 `AdvanceWorldline` 连续两次报
				 * 「`lab/worldlines/b-7by5g/params_c.csv` 在别的世界线上」,而**相对路径根本
				 * 没有活路**,只有写绝对路径才能通过。这不是模型写错,是解析基准错了:
				 * 「这条世界线的观测」的自然含义就是「它工作副本里的那个文件」。
				 */
				const base = workspaceRoot ?? cwd
				const absolute = isAbsolute(ref) ? ref : resolvePath(base, ref)
				if (workspaceRoot !== null && !absolute.startsWith(workspaceRoot)) {
					return fail(
						'worldline_isolation',
						`世界线 ${branch.label} 的观测必须是它自己工作副本(${branch.workspace})里的产物;${ref} 在别处——世界线互不通信(也碰不到主线)。\n` +
							`正确写法:用**它工作副本里的相对路径**(如 \`params_c.csv\`、\`lab/params_c.csv\`),系统会按那条世界线解析。`,
					)
				}
				let size = null
				try {
					const stat = statSync(absolute)
					size = stat.isFile() && stat.size > 0 ? stat.size : null
				} catch {
					size = null
				}
				if (size === null) return fail('evidence_l1', `世界线 ${branch.label} 的观测不存在或是空的:${ref}`)
				const materialId = `m-${Math.random().toString(36).slice(2, 8)}`
				mutations.push({ t: 'observation/recorded', id: materialId, ref, source: 'self', digest: sha256File(absolute), bytes: size, note: observation.note ?? null, step: step.id, branch: branch.id })
				accepted.push({ id: materialId, ref })
			}
			if (workspaceRoot !== null) {
				for (const artifact of branch.artifacts) {
					const absolute = resolvePath(workspaceRoot, artifact)
					try {
						if (statSync(absolute).size > 0) continue
					} catch {
						/* 不存在 */
					}
					return fail('branch_artifact_missing', `世界线 ${branch.label} 声明的产物没落盘:${branch.workspace}/${artifact}`)
				}
			}
			// 交付要有物证:世界线也不例外
			if (accepted.length === 0 && branch.artifacts.length === 0) {
				return fail('observations_required', `世界线 ${branch.label} 的交付里一个观测都没有:把这条路线跑出来的产物路径写进 observations。没有物证,就还没有完成。`)
			}

			const levelIndex = levelIndexOf(branch.level)
			/**
			 * **L4 的两道门,这条路也要走**。
			 *
			 * 等级是**事实的属性**,不是工具的属性:同一个 L4,走主线要人放行 + 只认外部来源,
			 * 走世界线两样都不要——那是门挂错了轴。这里与 `AdvancePlan` 用**同一个**判定
			 * (`l4Delivery` 按分支等级取目标、`witnessedRelease` 读审批栈的权威记录)。
			 */
			if (levelIndex === 4 && CFG.l4RejectSelfWritten) {
				const written = new Set((state.written ?? []).map((path) => (isAbsolute(path) ? path : resolvePath(cwd, path))))
				const selfAuthored = accepted.filter((item) => written.has(resolvePath(workspaceRoot ?? cwd, item.ref)))
				if (selfAuthored.length > 0) {
					return fail(
						'source_not_external',
						`L4 只认外部来源的观测(人上传、文件自动落盘、外部系统推送),做的人自己写的不算:${selfAuthored.map((item) => item.ref).join(', ')}。要么把这条世界线的等级改成 L3,要么换一份外部来源的观测。`,
					)
				}
			}
			if (levelIndex === 4 && CFG.l4RequiresHumanRelease) {
				const target = l4Delivery(state, 'AdvanceWorldline', args)
				const witnessed = witnessedRelease(sessionId, exec.callId)
				const releasedBefore = target !== null && target.released
				if (!releasedBefore && witnessed !== 'allowed-once') {
					return fail(
						'human_release_missing',
						`L4 的世界线交付要有一次**人放行**的权威记录(原生审批栈的 approval/asked + approval/decided=allowed-once),而这一次调用${witnessed === null ? '在会话日志里没有任何审批记录' : `的审批结果是 ${witnessed}`}。等级是事实的属性,放行是人的动作——走世界线也一样。`,
					)
				}
				if (witnessed === 'allowed-once') {
					mutations.push({ t: 'human/released', plan: plan.id, step: step.id, fork: fork.id, branch: branch.id, call: String(exec.callId ?? ''), via: 'approval' })
				}
			}
			let verdict
			let basis
			let evaluator
			let reading = typeof args.reading === 'string' ? args.reading.trim() : null
			let validity = args.validity === 'unusable' ? 'unusable' : args.validity === 'usable' ? 'usable' : null
			if (levelIndex > SELF_JUDGE_MAX_INDEX) {
				if (typeof args.verdict === 'string' && args.verdict !== '') return fail('verdict_not_accepted', `${branch.level} 的世界线由独立评估者读数:做的人不判自己。去掉 verdict 重新交付。`)
				const syntheticStep = {
					id: `${fork.id}:${branch.id}`,
					ordinal: 0,
					do: `世界线「${branch.label}」:${branch.approach}`,
					done_criteria: branch.done_criteria,
					artifacts: branch.artifacts,
					tests: { hypothesis: step.tests?.hypothesis ?? null, level: branch.level },
				}
				const gate = {
					confirmed: accepted.map((item) => ({ ref: item.ref, bytes: 0, digest: null })),
					extra: [
						`这是分叉「${fork.question}」的一条世界线(共 ${fork.branches.length} 条,互斥、互不通信)。`,
						`**裁决指标**:${fork.decide_by.metric}(${fork.decide_by.direction === 'min' ? '越小越好' : '越大越好'})。`,
						'请按硬信号报出**读数** reading:整串必须就是一个数,例如 62.1 或 12%(不要写区间、单位或一句话);' +
							'并在 validity 里说明这份读数可不可用(usable/unusable)。读数决定胜负,但**由算术决定,不由你决定谁赢**。',
					],
				}
				const audit = await runEvaluator(sessionId, exec.agent, plan, syntheticStep, gate, 'worldline_audit', exec.signal)
				mutations.push(...audit.mutations)
				if (audit.verdict === 'pending') return fail('audit_pending', `世界线评估者仍在跑:${audit.basis}`, { mutations })
				if (audit.verdict === 'unknown') return fail('evidence_audit_unavailable', `没有拿到独立读数,这条世界线不推进(fail-closed):${audit.basis}`, { mutations })
				verdict = audit.verdict
				basis = audit.basis
				evaluator = 'independent'
				reading = audit.reading ?? reading
				validity = audit.validity ?? validity
				auditCardPath = audit.cardPath ?? null
				auditSessionId = audit.mutations.find((mutation) => mutation.t === 'audit/dispatched')?.evaluator_session ?? null
			} else {
				if (typeof args.verdict !== 'string' || args.verdict === '') return fail('verdict_required', `${branch.level} 的世界线要你自己给裁决与依据。`)
				if (typeof args.basis !== 'string' || args.basis.trim().length < 8) return fail('basis_required', '依据必须可复查:写清你引用了哪个产物里的哪个事实。')
				verdict = ['support', 'refute', 'inconclusive'].includes(args.verdict) ? args.verdict : 'inconclusive'
				basis = args.basis.trim()
				evaluator = 'self'
			}
			if (validity === null && reading !== null) validity = metricReading(reading) === null ? 'unusable' : 'usable'
			/**
			 * 世界线证据的出处同样在**记账那一刻**定下来。世界线在**自己的工作副本**里作业,
			 * 所以 `cwd` 就是那份副本 —— 依据里点名的产物按副本核存在性。
			 */
			const originInfo = buildEvidenceOrigins({
				cwd,
				accepted,
				confirmed: [],
				cardPath: auditCardPath,
				evaluatorSession: auditSessionId,
				basis,
			})
			const evidenceId = `e-${Math.random().toString(36).slice(2, 8)}`
			mutations.push({
				t: 'evidence/recorded',
				id: evidenceId,
				step: step.id,
				plan: plan.id,
				branch: branch.id,
				verdict,
				level: branch.level,
				evaluator,
				basis,
				/** `refs` 一律是**路径**:只写材料 id ⇒ 世界线证据一条都开不了。 */
				refs: originInfo.paths,
				origins: originInfo.origins,
				anchor: evaluator === 'independent' ? 'auditor' : 'artifact',
				basis_reviewable: true,
			})
			mutations.push({
				t: 'branch/delivered',
				fork: fork.id,
				branch: branch.id,
				reading,
				validity,
				verdict,
				basis,
				evaluator,
				evidence: evidenceId,
				// 评估卡与评估者会话都落账:横评仲裁靠**注入**这张卡拿到跨分支视野
				// (不靠授权),面板的旁观入口也靠它跳进那个评估者会话。
				card_path: auditCardPath,
				evaluator_session: auditSessionId,
			})
			const parsed = metricReading(reading)
			// 交付成功前收一次执行者结论:这条世界线的「执行者跑成没跑成」该跟它的读数一起落账。
			// 返回值不再丢弃:本次收到的结论正文要跟着这次交付一起给模型。
			const collectedOnDeliver = collectExecutors(mutations, hostService.state(sessionId), sessionId)
			return done({
				ok: true,
				code: 'worldline_delivered',
				verdict,
				evaluator,
				message:
					`世界线「${branch.label}」已交付(裁决 ${verdict}${evaluator === 'independent' ? ' · 独立评估者读数' : ' · 自判'})。` +
					`读数:${reading ?? '未报'}${parsed === null ? '(读不出一个数 → 不参赛)' : ` → ${parsed}`};有效性:${validity ?? '未声明'}。\n胜负由 ConvergeFork 的算术决定。` +
					(noticeBlock(collectedOnDeliver.notices) === '' ? '' : `\n\n${noticeBlock(collectedOnDeliver.notices)}`),
			})
		},
	})

	defineTool({
		name: 'ConvergeFork',
		description:
			'让算术裁决这个分叉:拿事先登记的尺子对每条世界线的读数排序,采纳最优的那条,落选的全部保留(未采纳,留档不删)。**算不出来就停下问人**——读数不足两条、或没有尺子,都不会退化成随便挑一条先合并。采纳只决定用哪条世界线的成果;把它的产物落进本步声明的位置,仍然要一次普通交付。',
		parameters: { type: 'object', properties: { step_id: { type: 'string' } }, additionalProperties: false },
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const plan = activePlanOf(state)
			if (plan === null) return fail('no_active_plan', '没有活动计划。')
			const step = firstOpenStep(plan)
			if (step === null) return fail('no_open_step', '这份计划没有未落定的步了。')
			if (args.step_id !== undefined && args.step_id !== '' && args.step_id !== step.id) return fail('out_of_order', `交付只能落在第一个未落定步 ${step.id}。`)
			const fork = forkOfStep(hostService.derive(sessionId).forks, step.id)
			if (fork === null) return fail('no_fork', `步骤 ${step.id} 上没有分叉。`)
			if (fork.abandoned) return fail('fork_abandoned', '这个分叉已经放弃探索了。')
			if (fork.settled) return { ok: true, code: 'already_converged', mutations: [], card: hostService.renderCard(sessionId), message: `这个分叉已经收敛(采纳 ${fork.verdict?.winner})。\n\n${hostService.renderCard(sessionId)}` }
			const pending = fork.branches.filter((branch) => (BRANCH_RANK[branch.status] ?? 0) < BRANCH_RANK.evaluated)
			if (pending.length > 0) {
				return fail('fork_unsettled', `还有 ${pending.length} 条世界线没交付:${pending.map((branch) => branch.label).join('、')}。每条都要有观测与读数,算术才能比较。`)
			}
			/**
			 * 人在面板上裁决过就先按人的(结构化记录,`by:'user'`)——**人门不是装饰**:
			 * 他按下的那一下必须真的改变结果,否则那道门就只是块牌子。人的裁决是决定,
			 * 不是算出来的:所以走正式采纳(`margin` 记为 null,不做临时那一档)。
			 */
			const humanDecision = fork.humanDecision ?? null
			const humanWinner =
				humanDecision !== null && humanDecision !== undefined && humanDecision.action === 'adopt_branch'
					? fork.branches.find((branch) => branch.id === humanDecision.branch) ?? null
					: null
			let outcome = humanWinner === null ? decideWinner(fork) : { winner: humanWinner.id, margin: null, tie: false, metric: fork.decide_by?.metric ?? '—', direction: fork.decide_by?.direction === 'min' ? 'min' : 'max', readings: [], by: 'user', arbiter_reason: humanDecision.note ?? '人在面板上裁决' }
			let arbiterNote = ''
			if (outcome.undecidable !== undefined && humanWinner === null) {
				// 兜底:尺子落不成数时,派一次**横评仲裁**(各分支的评估卡注入任务书,不破分支隔离)。
				// 判决不是采纳:它只把「算不出」变回「算得出」,采纳仍走下面同一条路。
				const arbitration = fork.arbitration ?? null
				if (arbitration === null && CFG.forkArbitration && fork.branches.length >= 2) {
					const arbiter = await runArbiter(sessionId, exec.agent, fork, exec.signal)
					mutations.push(...arbiter.mutations)
					if (arbiter.verdict !== null && arbiter.verdict.winner === null) {
						// 仲裁跑完了却裁不出来:这是**合法结局**(证据确实不足),但要如实说——
						// 「系统试过仲裁,也没裁出来」与「系统没裁」对人是两件事(ClearAI 的原话)。
						arbiterNote = `\n横评仲裁也未能分出高下:${arbiter.verdict.reason || '证据不足以裁决'}。`
					} else {
						arbiterNote = arbiter.note === null ? '' : `\n横评仲裁:${arbiter.note}`
					}
					if (arbiter.verdict !== null && arbiter.verdict.winner !== null) {
						// 判决把「算不出」变回「算得出」:带上它重判一次(它没有余量 → 临时采纳)。
						outcome = decideWinner({ ...fork, arbitration: arbiter.verdict })
					}
				}
			}
			if (outcome.undecidable !== undefined) {
				mutations.push({ t: 'fork/undecidable', fork: fork.id, code: outcome.undecidable.code, reason: outcome.undecidable.reason, readings: outcome.undecidable.readings ?? [] })
				const preview = hostService.preview(sessionId, mutations)
				return fail(
					outcome.undecidable.code,
					`算不出胜负:${outcome.undecidable.reason}${arbiterNote}\n这是**异常**,归你处置,不是死路;只有确属价值判断时才升给人。\n\n${preview.card}`,
					{ mutations },
				)
			}
			const winner = fork.branches.find((branch) => branch.id === outcome.winner)
			const cwd = sessionCwd(sessionId)
			/**
			 * 分差够不够决定性:**相对**余量与 `autoAdoptMinGap` 比。
			 * 差距大 → 正式采纳;差距小但确实分出了胜负 → 照常坍缩,但记为**临时采纳**,
			 * 留一条待复核痕迹;仲裁给出来的胜者没有余量(判断不是算术),所以一定走临时那一档。
			 */
			const decisive = outcome.by === 'user' || (typeof outcome.margin === 'number' && outcome.margin >= CFG.autoAdoptMinGap)
			const winningReading = outcome.readings.find((row) => row.branch === outcome.winner) ?? null
			const decisionNote =
				outcome.by === 'user'
					? `auto_adopt(人裁决):${fork.decide_by?.metric ?? '—'}=${winningReading?.value ?? '—'}(人在面板上裁决,正式采纳)`
					: outcome.by === 'arbiter'
					? `auto_adopt(横评仲裁):${outcome.metric}=${winningReading?.value ?? '—'}(判断不是算术,故记为临时采纳)`
					: typeof outcome.margin === 'number'
						? `auto_adopt: ${outcome.metric}=${winningReading?.value ?? '—'}(${outcome.direction} 最优,相对差距 ${(outcome.margin * 100).toFixed(1)}%,阈值 ${(CFG.autoAdoptMinGap * 100).toFixed(0)}%)`
						: `auto_adopt: ${outcome.metric}=${winningReading?.value ?? '—'}(唯一可比世界线)`

			/**
			 * 采纳 = 合并,但**只在那个 git 对象今天真的还在的时候**。
			 *
			 * 形态:分叉落账时物化过,后来账本被清理,分支与工作副本一起没了
			 * ——于是 `fork.git_branch` 还写着名字,合并却必然失败,一份计划被一个**机制上不可能收敛**
			 * 的分叉卡住(agent 只能改走 AbandonFork)。
			 *
			 * 判据因此从「账上写没写过分支」改成「**现在还在不在**」:分支 ref 能解析 + 工作副本目录还在。
			 * 不在 ⇒ 不合并,**照样登记这次采纳**,把"把赢家的产物落进声明位置"留给一次普通交付
			 * (与「工作区根本没有 git 上下文」那条路同一个结局)。降级不能只写在分叉侧,收敛侧要接住。
			 */
			const context = gitContext(cwd)
			const refAlive =
				winner?.git_branch !== null && winner?.git_branch !== undefined && context.mode !== null && gitAt(context, ['rev-parse', '--verify', `refs/heads/${winner.git_branch}`]).ok === true
			const worktreeAlive = typeof winner?.worktree_path === 'string' && winner.worktree_path !== '' && existsSync(winner.worktree_path)
			const mergeable = winner?.git_branch !== null && winner?.git_branch !== undefined && CFG.gitWorldlines && refAlive && worktreeAlive
			let mergeNote = ''
			if (winner?.git_branch !== null && winner?.git_branch !== undefined && CFG.gitWorldlines && mergeable !== true) {
				const why = refAlive !== true ? '它的分支已经不在账本里了(账本被清理或换了位置)' : '它的工作副本目录已经不在了'
				mutations.push({ t: 'fork/merge_skipped', fork: fork.id, branch: winner.id, winner: winner.id, reason: why })
				mergeNote = `\n**这次采纳没有合并**:${why}。决定已经登记,赢家的产物请落进本步声明的位置(一次普通交付即可)。`
			}
			if (mergeable === true) {
				const commit = commitWorldline(winner.worktree_path, `worldline ${winner.git_branch}: 采纳前的最后状态`)
				if (commit.ok !== true) {
					const preview = hostService.preview(sessionId, mutations)
					return fail('merge_prepare_failed', `采纳前提交赢家世界线失败:${commit.reason}\n\n${preview.card}`, { mutations })
				}
				const message = [
					`adopt ${winner.label} — ${outcome.metric} ${outcome.direction === 'min' ? '越小越好' : '越大越好'}${decisive ? '' : ' [临时采纳]'}`,
					'',
					`裁决(${outcome.by === 'user' ? '人' : outcome.by === 'arbiter' ? '横评仲裁' : '算术'}):采纳「${winner.label}」,${outcome.by === 'arbiter' ? `依据:${outcome.arbiter_reason}` : `相对差距 ${(outcome.margin * 100).toFixed(1)}%${outcome.tie ? '(并列)' : ''}`}`,
					`读数:${outcome.readings.map((row) => `${row.label}=${row.value}`).join('、')}`,
					`世界线分支:${winner.git_branch}`,
					'',
					'由 ClearAI 自动合并(算术裁决可撤销:git revert 这次合并)。',
				].join('\n')
				const merged = adoptWorldline(cwd, winner.git_branch, message)
				if (merged.ok !== true) {
					mutations.push({ t: 'fork/merge_conflict', fork: fork.id, branch: winner.id, winner: winner.id, margin: outcome.margin, detail: merged.detail ?? merged.reason })
					// 快照这件事**任何结局都要落账**:用户的改动被提交过,他必须知道
					// (原来只在合并成功那条分支里 push,于是冲突时人永远不知道自己的改动进了账本)
					if (merged.snapshotCommit !== null && merged.snapshotCommit !== undefined) {
						mutations.push({ t: 'git/snapshot', commit: merged.snapshotCommit, reason: '采纳前先把工作区手上的改动存成一条提交(否则会被合并覆盖)' })
					}
					const preview = hostService.preview(sessionId, mutations)
					return fail(
						'merge_conflict',
						`算术算出了赢家「${winner.label}」,但**合并冲突**了(两个方案改了同一个地方)。这是决策门,已经在世界树上等你:请决定保留哪一边,或让模型改判据重做一条世界线。\n细节:${merged.detail ?? ''}` +
							(merged.snapshotCommit === null || merged.snapshotCommit === undefined
								? '\n(合并已中止,工作区没有被动过。)'
								: `\n你手上的改动已经存成一条提交(${String(merged.snapshotCommit).slice(0, 7)}),没有丢;合并已中止,工作区保持你那一版。`) +
							`\n\n${preview.card}`,
						{ mutations },
					)
				}
				mutations.push({
					t: 'fork/merged',
					fork: fork.id,
					branch: winner.id,
					commit: merged.commit,
					mode: merged.mode,
					snapshot_commit: merged.snapshotCommit,
					// 临时采纳留一条**待复核**痕迹:它不是结论,是一个待复核的决定。
					provisional: !decisive,
					by: outcome.by ?? 'metric',
					decision_note: decisionNote,
					margin: outcome.margin ?? null,
				})
				if (merged.snapshotCommit !== null) mutations.push({ t: 'git/snapshot', commit: merged.snapshotCommit, reason: '采纳前先把工作区手上的改动存成一条提交(否则会被合并覆盖)' })
				// 落选的世界线:先把活提交到它自己的分支,再删工作副本;branch ref 永久保留
				for (const loser of fork.branches.filter((branch) => branch.id !== outcome.winner)) {
					if (loser.worktree_path === null || loser.worktree_path === undefined || loser.worktree_removed === true) continue
					const removal = removeWorldline(cwd, loser.worktree_path, loser.git_branch)
					if (removal.ok === true) mutations.push({ t: 'worldline/removed', fork: fork.id, branch: loser.id, path: loser.worktree_path, kept_ref: true, committed: removal.committed === true })
				}
			}
			mutations.push({ t: 'fork/converged', fork: fork.id, winner: outcome.winner, margin: outcome.margin, tie: outcome.tie, metric: outcome.metric, direction: outcome.direction })
			const collectedOnConverge = collectExecutors(mutations, hostService.state(sessionId), sessionId)
			return done({
				ok: true,
				code: 'fork_converged',
				verdict: 'support',
				message:
					`算术裁决:采纳「${winner?.label ?? outcome.winner}」(${outcome.metric} ${outcome.direction === 'min' ? '越小越好' : '越大越好'}),` +
					`差额 ${outcome.margin}${outcome.tie ? ' · 并列(指标说一样好是买到的信息)' : ''}。\n` +
					`读数:${outcome.readings.map((row) => `${row.label}=${row.value}`).join('、')}\n` +
					`落选的世界线标为未采纳,**留档不删**。${mergeNote}\n下一步:把采纳那条的产物落进步骤 ${step.id} 声明的位置,再用 AdvancePlan 交付这一步。` +
					(noticeBlock(collectedOnConverge.notices) === '' ? '' : `\n\n${noticeBlock(collectedOnConverge.notices)}`),
			})
		},
	})

	defineTool({
		name: 'SpawnScout',
		description:
			'派一个**只读侦察**替你做一段会污染你上下文的调研:读文件、找文件、找内容、看图、查公网,把结论回灌给你。**角色由 Harness 固定**(只读、不问人、不建计划),你只能给任务,不能选角色。**同一个任务原文如果已经正常回灌过,直接复用它的结论(不再重跑)**——要真重跑,把任务原文改一个字。适合:要翻很多文件才能回答的问题、要核一堆出处的问题。',
		parameters: {
			type: 'object',
			properties: {
				task: { type: 'string', description: '要它查什么:说清范围与「什么样算查清了」' },
				why: { type: 'string', description: '为什么要查(可选):一句话说明这一步缺什么' },
			},
			required: ['task'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			if (typeof args.task !== 'string' || args.task.trim().length < 8) return fail('task_required', '说清要它查什么(至少一句),否则它只能空手而归。')
			const plan = activePlanOf(state)
			const step = plan === null ? null : firstOpenStep(plan)
			const anchorStep = step ?? { id: 'goal', do: '立约前的材料梳理', done_criteria: state.goal?.done_criteria ?? '(未立目标)', goal: state.goal?.id ?? null }
			const scout = await runScout(sessionId, exec.agent, plan, anchorStep, args.task.trim(), `model_request:${String(args.why ?? '').slice(0, 60)}`, exec.signal)
			mutations.push(...scout.mutations)
			if (scout.pending !== true && scout.ok !== true) return fail('scout_unavailable', `侦察没能给你带东西回来:${scout.note ?? '未知原因'}。缺口如实留着,别当它查过了。`, { mutations })
			// 复用:结论**现在**就在手上(没有派子 run),照旧直接给。
			if (scout.reused === true) {
				return done({
					ok: true,
					code: 'scout_reported',
					message: `这件事**上一次已经正常回灌过**(同一个任务原文,身份 ${scout.digest}),直接复用它的结论——没有再派一次。要真重跑,把任务原文改一个字。\n\n${clipConclusion(scout.conclusion, null)}`,
				})
			}
			/**
			 * **派出去就不等**:结论走事实通道,不挤在工具结果里——
			 * 工具结果是「这一动作做完了」的收据,不是「世界发生了什么」的记录。
			 */
			return done({
				ok: true,
				code: 'scout_dispatched',
				message: `侦察已派出(只读、fresh context,身份 ${scout.scoutId})。它是**异步**的:结论会作为观测回灌到资料面(来源标 scout),下一步卡片的「资料面」里能看到。要在这个回合里就等它,用 \`AwaitWorldlines\`(它等的是派出去的子 run);不着急就继续干别的——结论回来时系统会告诉你。`,
			})
		},
	})

	defineTool({
		name: 'MapScouts',
		description:
			'一次派**多个只读侦察**(2–50),每条各查一块,全部并行回灌。适合:一批同构的核查(每个文件/每个来源各一条),或者几条互不相干的线索。它们互相看不见,也不会污染你的上下文。**同一个任务原文如果已经正常回灌过,直接复用它的结论(不再重跑)**——要真重跑,把任务原文改一个字。',
		parameters: {
			type: 'object',
			properties: {
				tasks: {
					type: 'array',
					description: '2–50 条互不相干的侦察任务',
					items: { type: 'object', properties: { task: { type: 'string' }, why: { type: 'string' } }, required: ['task'], additionalProperties: false },
				},
			},
			required: ['tasks'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const tasks = Array.isArray(args.tasks) ? args.tasks.filter((item) => typeof item?.task === 'string' && item.task.trim() !== '') : []
			if (tasks.length < 2 || tasks.length > CFG.mapScoutMax) return fail('map_needs_2to50', `一次派 2–${CFG.mapScoutMax} 条侦察(收到 ${tasks.length} 条):每条要能独立成立。`)
			const plan = activePlanOf(state)
			const step = plan === null ? null : firstOpenStep(plan)
			const anchorStep = step ?? { id: 'goal', do: '并行核查', done_criteria: state.goal?.done_criteria ?? '(未立目标)', goal: state.goal?.id ?? null }
			const conclusions = []
			let reusedCount = 0
			let dispatchedCount = 0
			// 并发有上限:一次放 50 个子 run 出去不是"并行",是把宿主打满
			for (let index = 0; index < tasks.length; index += CFG.mapScoutConcurrency) {
				const batch = tasks.slice(index, index + CFG.mapScoutConcurrency)
				const results = await Promise.all(
					batch.map((item) => runScout(sessionId, exec.agent, plan, anchorStep, item.task.trim(), `map:${String(item.why ?? '').slice(0, 40)}`, exec.signal)),
				)
				for (const result of results) {
					mutations.push(...result.mutations)
					if (result.reused === true) {
						reusedCount += 1
						conclusions.push(`(复用上一次的回灌)${String(result.conclusion ?? '').slice(0, 600)}`)
						continue
					}
					if (result.pending === true) {
						dispatchedCount += 1
						conclusions.push(`(已派出 ${result.scoutId},结论会回灌到资料面)`)
						continue
					}
					conclusions.push(result.ok === true ? String(result.conclusion ?? '').slice(0, 600) : `(未回灌:${result.note ?? '未知'})`)
				}
			}
			return done({
				ok: true,
				code: dispatchedCount > 0 ? 'map_dispatched' : 'map_reported',
				message:
					`派出去 ${tasks.length} 条侦察:${reusedCount > 0 ? `${reusedCount} 条**复用**上一次的回灌(任务原文没变,不重跑)` : ''}${reusedCount > 0 && dispatchedCount > 0 ? ' · ' : ''}${dispatchedCount > 0 ? `${dispatchedCount} 条**已经派出**(异步,结论会作为观测回灌到资料面;要在这个回合里等就用 \`AwaitWorldlines\`)` : ''}。\n\n${conclusions.map((item, index) => `【${index + 1}】${item}`).join('\n\n')}`,
			})
		},
	})

	defineTool({
		name: 'WorldlineStatus',
		description:
			'看世界线现在什么状态:哪些执行者已经回灌(顺手把结论落账)、哪些还在跑。执行者跑的是真活,可能十几分钟——超时不是失败,用这个工具事后收。',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
		output: CARD_OUTPUT,
		async execute(_args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const swept = collectExecutors(mutations, hostService.state(sessionId), sessionId)
			const lines = swept.lines.map((item) => `· ${item}`)
			if (swept.recovered > 0) lines.push(`· ${swept.recovered} 条结论是从执行者自己的会话日志里回收的`)
			if (swept.lost > 0) lines.push(`· ${swept.lost} 条失联(产物还在各自的工作副本里)`)
			if (noticeBlock(swept.notices) !== '') lines.push('', noticeBlock(swept.notices))
			if (lines.length === 0) lines.push('· 没有在跑的世界线执行者')
			return done({ ok: true, code: 'worldline_status', message: lines.join('\n') })
		},
	})

	defineTool({
		name: 'AwaitWorldlines',
		description:
			'**有界地等**派出去还没回来的子 run——世界线执行者**与侦察**都算(最长 300 秒),谁的结论回来了就顺手落账。它是「等」这件事的**唯一正当姿势**:换成 bash `sleep` 轮询会把一整个回合的时间烧在空等上,而且结论什么时候回来与你睡多久无关。等待期间不会阻塞别的会话;到点就返回,没回来的照样在跑。',
		parameters: {
			type: 'object',
			properties: {
				timeout_s: { type: 'number', description: '最多等多少秒(5–300,缺省 120)。到点就返回,不是失败。' },
				until: { type: 'string', description: '等什么:`any`(缺省,任一条落定就返回)/ `all`(全部落定或到点)' },
			},
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const wait = Math.min(300, Math.max(5, Math.round(Number(args.timeout_s ?? 120) || 120)))
			const until = args.until === 'all' ? 'all' : 'any'
			const started = Date.now()
			let collected = 0
			let lines = []
			/**
			 * 等到的**结论正文**要攒着:摘要行每一拍都重建,正文必须跨拍累积,
			 * 否则「等到的那一拍」过去之后,模型只剩一句「回灌 1 条结论」。
			 */
			const notices = []
			const pending = () => {
				const before = mutations.length
				const swept = collectExecutors(mutations, hostService.state(sessionId), sessionId)
				/**
				 * 「回灌几条」数的是**结论**,不是变更条数:一条侦察会落两条变更
				 * (`scout/settled` + 观测),一条世界线落一条 `worldline/executed`。
				 * 模型读这句话是判断「它回来了没有」——数变更会报出比事实大的数字
				 * (一条侦察报成两条),那是这一层最不该有的假话。
				 */
				collected += mutations.slice(before).filter((mutation) => mutation.t === 'scout/settled' || mutation.t === 'worldline/executed').length
				lines = swept.lines.map((item) => `· ${item}`)
				if (swept.recovered > 0) lines.push(`· ${swept.recovered} 条结论是从执行者自己的会话日志里回收的`)
				if (swept.lost > 0) lines.push(`· ${swept.lost} 条失联(产物还在各自的工作副本里)`)
				notices.push(...(swept.notices ?? []))
				/**
				 * 「还在跑」= 世界线执行者(内存表里真有、还没落定的那些)**加上**侦察。
				 * 少了侦察这一票,只有侦察在跑时这个循环第一拍就退出,
				 * 而 SpawnScout 的返回原话恰恰让模型「用 AwaitWorldlines 在这个回合里等它」。
				 */
				return swept.lines.filter((line) => line.endsWith('仍在跑')).length + (swept.scoutsPending ?? 0)
			}
			/**
			 * 等:每 2 秒看一次表。**不 busy-wait**——每次都是一个真定时器,
			 * 而且随时可被打断(agent 被中断时 `signal` 就 abort)。
			 */
			while (Date.now() - started < wait * 1000) {
				const running = pending()
				if (running === 0) break
				if (until === 'any' && collected > 0) break
				const aborted = await new Promise((resolve) => {
					const timer = setTimeout(() => resolve(false), 2000)
					const onAbort = () => {
						clearTimeout(timer)
						resolve(true)
					}
					if (exec.signal === undefined) return
					if (exec.signal.aborted) return onAbort()
					exec.signal.addEventListener('abort', onAbort, { once: true })
					setTimeout(() => exec.signal?.removeEventListener?.('abort', onAbort), 2100)
				})
				if (aborted === true) break
			}
			const running = pending()
			const waited = Math.round((Date.now() - started) / 1000)
			const doneLines = lines.filter((line) => !line.endsWith('仍在跑'))
			const recovered = lines.filter((line) => line.includes('从执行者自己的会话日志里回收')).length
			const lostLines = lines.filter((line) => line.includes('条失联'))
			const head =
				`等了 ${waited}s(上限 ${wait}s):回灌 ${collected} 条结论` +
				(waited >= wait && running > 0 ? `,**还有 ${running} 条仍在跑**(到点返回,不是失败:它们跑的是真活,可以再来等一次,或先干别的)` : '') +
				(recovered > 0 ? `;其中 ${recovered} 条是从执行者自己的会话日志里回收的` : '') +
				(lostLines.length > 0 ? `;${lostLines.join('、')}` : '')
			return done({
				ok: true,
				code: 'worldlines_awaited',
				message: `${head}\n${(doneLines.length > 0 ? doneLines : lines).join('\n')}${noticeBlock(notices) === '' ? '' : `\n\n${noticeBlock(notices)}`}`,
			})
		},
	})

	defineTool({
		name: 'AbandonFork',
		description:
			'放弃探索:分叉卡死时的声明出口,也是**已作废步骤上未收口分叉的唯一出口**。**只给人**——你调用它会弹一次人工确认;缘由必填,放弃要留痕可考。只对还在探索/待裁决的分叉有效(已收敛的不能放弃:收敛只走采纳)。带 step_id 可收口一个**已作废步骤**上的孤儿分叉。',
		parameters: { type: 'object', properties: { reason: { type: 'string' }, step_id: { type: 'string', description: '要收口哪一步上的分叉(缺省=第一个未落定步);已作废的步也接受——那是孤儿分叉的唯一出口' } }, required: ['reason'], additionalProperties: false },
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, state, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const plan = activePlanOf(state)
			if (plan === null) return fail('no_active_plan', '没有活动计划。')
			const target = closableStep(plan, args.step_id)
			if (target.step === null) {
				return fail(
					'no_open_step',
					args.step_id === undefined || args.step_id === ''
						? '这份计划没有未落定的步了。'
						: `步骤 ${args.step_id} 不能在这里收口:只有**第一个未落定步**或**已作废的步**上的分叉可以显式收口。`,
				)
			}
			const step = target.step
			const fork = forkOfStep(hostService.derive(sessionId).forks, step.id)
			if (fork === null) return fail('no_fork', `步骤 ${step.id} 上没有分叉。`)
			if (fork.settled) return fail('fork_not_abandonable', '这个分叉已经收敛了:收敛只走采纳,不能放弃。')
			if (fork.abandoned) return fail('fork_not_abandonable', '这个分叉已经放弃过了。')
			if (typeof args.reason !== 'string' || args.reason.trim() === '') return fail('reason_required', '放弃必须带缘由。')
			mutations.push({ t: 'fork/abandoned', fork: fork.id, reason: args.reason.trim() })
			const abandonCwd = sessionCwd(sessionId)
			for (const branch of fork.branches) {
				if (branch.worktree_path === null || branch.worktree_path === undefined || branch.worktree_removed === true) continue
				const removal = removeWorldline(abandonCwd, branch.worktree_path, branch.git_branch)
				if (removal.ok === true) mutations.push({ t: 'worldline/removed', fork: fork.id, branch: branch.id, path: branch.worktree_path, kept_ref: true, committed: removal.committed === true })
			}
			const tail = target.orphan
				? `\n这一步已经作废(承诺撤回),所以这里的放弃是**收口孤儿**:它的世界线不会再有归宿。工作副本已收掉,ref 保留。`
				: '\n这一步不再被分叉挡住,可以继续普通交付。'
			return done({ ok: true, code: 'fork_abandoned', message: `分叉已放弃(人已放行,缘由留痕):${args.reason.trim()}。\n各条世界线的工作副本已收掉,分支 ref 保留(它们记着「此路不通」)。${tail}` })
		},
	})

	// ═══ 外脑:把工作区投影成**宿主原生的技能条目**;自建只有写侧两件 ═══════════
	//
	// 为什么不建索引:宿主已经有「有界索引 + 按需加载 + digest 变了才注入」这一整套
	// (`tool-skill` 的 agent/pre-step),我们只要把 `clear/skills/**` 与 `clear/memory/**`
	// **投影**成条目。于是:没有第二份目录、没有自建注入、没有要同步的 INDEX.md。
	// 读侧因此只需要原生工具:加载正文是 `skill`,读单条是 `read`
	// (带 limit/offset),资源是 `resourceBase` 给出的目录。

	const skillsService = ctx.get('skills')
	let invalidateBrain = null
	if (skillsService !== undefined && typeof skillsService.registerProvider === 'function') {
		ctx.effect(() => {
			try {
				return skillsService.registerProvider((control) => {
					invalidateBrain = typeof control?.invalidate === 'function' ? control.invalidate : null
					return createBrainProvider({
						log: (message) => ctx.logger?.warn?.(`clearai brain: ${message}`),
						// 目录变了就让宿主的目录缓存失效(见 brain.js 的说明)。
						invalidate: invalidateBrain,
					})
				})
			} catch (error) {
				// 重复注册(同名同层)会抛:如实记一笔,不让它把整个预设拖挂。
				ctx.logger?.warn?.(`clearai brain: 技能提供者注册失败 ${String(error?.message ?? error).slice(0, 160)}`)
				return () => {}
			}
		}, 'clearai: brain provider')
	}

	/**
	 * 落实人门动作里**只有内核做得了**的那一件:采纳候选技能。
	 *
	 * 为什么归内核:技能文件在预设平面的工作区里,而「谁写技能文件」只能有一个答案(单一写者)。
	 * 人的点击只负责把**结构化决定**送进会话(宿主平面的路由),剩下这一下由内核在 pre-step 里做。
	 */
	function applyHumanGateActions(sessionId, messages) {
		const list = Array.isArray(messages) ? messages : []
		const promotions = []
		for (const message of list) {
			const gate = parseHumanGateMessage(message)
			if (gate === null || gate.action !== 'promote_skill' || typeof gate.skill !== 'string') continue
			promotions.push(gate.skill)
		}
		if (promotions.length === 0) return { note: '', promoted: [] }
		const cwd = sessionCwd(sessionId)
		const notes = []
		const promoted = []
		for (const skill of promotions) {
			// 已经采纳过就不重复写(幂等:人可能点两下,或者消息在历史里又被带进来一次)。
			if (!candidateSkills(cwd).some((entry) => entry.name === skill)) {
				notes.push(`${skill}:已经不是候选了(可能早已采纳)`)
				continue
			}
			const result = promoteSkill(cwd, skill, { at: new Date().toISOString(), by: 'user' })
			if (result.ok !== true) {
				notes.push(`${skill}:采纳失败(${result.reason})`)
				continue
			}
			invalidateBrainCatalog()
			promoted.push(skill)
			// **不要**在这里改 lastCandidates:那会让紧接着的扫描判成「没变化」而不发事实,
			// 于是投影里的候选名单仍然留着刚被采纳的那一个(收件箱里的条目不会消失)。
			// 变更检测交给扫描自己:名单确实变了,它就会发。
			notes.push(`${skill}:已采纳(status → active,作者与时间留在 frontmatter 里)`)
		}
		return { note: notes.length === 0 ? '' : `\n外脑:${notes.join(';')}`, promoted }
	}

	/**
	 * 把「工作区里有哪些候选技能」落成一条**事实**(只在变化时落,不刷日志)。
	 * 面板的收件箱据此出条目——状态锚:候选被采纳或被删,下一次扫描就没有它了。
	 */
	/** 每个会话最近一次扫描到的候选(内存缓存,只用来判断「要不要再落一条事实」)。 */
	const lastCandidates = new Map()
	/** 已经做过工作区引导的会话:引导是幂等的,但没必要每回合都扫一遍目录。 */
	const bootstrapped = new Set()

	function publishBrain(sessionId) {
		const cwd = sessionCwd(sessionId)
		let overview = null
		try {
			overview = brainOverview(cwd)
		} catch (error) {
			ctx.logger?.warn?.(`clearai brain: 扫描失败 ${String(error?.message ?? error).slice(0, 160)}`)
			return { note: '', payload: null }
		}
		const candidates = overview.skills.filter((entry) => entry.status === 'candidate').map((entry) => ({ name: entry.name, description: entry.description }))
		/**
		 * 章程也在这里取一次(它属于外脑的第一层):文件没动就**不重发**(与目录同一条纪律),
		 * 但事实一旦变了就随投影走 —— 于是模型看的卡、人看的面板,读的是同一份读数。
		 */
		let constitution = null
		try {
			constitution = constitutionFacts(cwd)
		} catch (error) {
			ctx.logger?.warn?.(`clearai brain: 章程扫描失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}
		// 指纹只跟文件系统事实走:内容没改就不重发(与目录同一条纪律)。
		const constitutionDigest = constitution === null ? 'none' : `${constitution.modifiedAt}:${constitution.bytes}:${constitution.legacy === true ? 'legacy' : 'root'}`
		const constitutionChanged = lastConstitution.get(sessionId) !== constitutionDigest
		if (constitutionChanged) lastConstitution.set(sessionId, constitutionDigest)
		const before = JSON.stringify(lastCandidates.get(sessionId) ?? null)
		const after = JSON.stringify(overview)
		if (before === after && !constitutionChanged) return { note: '', payload: null }
		lastCandidates.set(sessionId, overview)
		return {
			note: candidates.length === 0 ? '' : `\n(外脑:${candidates.length} 个候选技能等人采纳——面板上「需要你」里能看到。)`,
			// 清单随投影走(面板据此画「外脑」页签);正文才走宿主路由(点开某一条时才读盘)。
			payload: { candidates, overview, ...(constitutionChanged ? { constitution } : {}) },
		}
	}

	/**
	 * ═══ 项目章程(``PROJECT.md``):把「它还是不是一个空壳」变成一条可查的事实 ═══
	 *
	 * 为什么需要它:没有它,跑完几轮、交付了产物、记忆写了两份,
	 * `PROJECT.md` 还是铺工作区那一刻的模板——18 处占位原封不动,谁也没发现。
	 * 根因不是模型懒:章程的**读**侧已经是最好的(原生指令文件每步重投影),但**写**侧
	 * 只有一句提示词、没有任何时机,而且**没有任何地方让模型或人看见「它还是空壳」**。
	 *
	 * 所以这里只做一件事:把它变成事实(不是劝告)。规则照着 ClearAI 模板自己的话:
	 * **以 `[` 包起来的条目是占位——占位就是「尚未确定」,不是默认答案,也不能当完成证据。**
	 *
	 * 只认带 schema 标记的模板章程:没有那个标记的文件多半是人自己写的,那时**不猜**
	 * (返回 schema:null,只给修改时间)。
	 */
	/**
	 * 章程的读数——**只有文件系统事实**:在不在、多大、最后改动什么时候。
	 *
	 * 这里原来那份「占位 X/Y 条 + 当前阶段解析」已砍掉(
	 * 「要有计数吗」)。三条理由:
	 *   · **脆**:它是对文本做格式解析——模型把章程第 5 节写成 `- **变更记录**（一行即…）`,
	 *     要求 `**标签**:` 的规则当场把条目数从 18 数成 17。改一个标点,「事实」就变了;
	 *   · **可刷**:「占位 0/18」可以靠删占位、灌废话达到——奖励的是把数字清掉,不是把章程写实;
	 *   · **第二本账**:章程每回合被**原生指令文件整份注入**上下文,模型手里就是原文。
	 *     再算一遍摘要,等于对已经在上下文里的东西做二次推导,只会更旧更错。
	 *
	 * 留下的这三样是真的:它们在不在、多大、什么时候动过——不依赖任何格式约定。
	 */
	function constitutionFacts(cwd) {
		const file = join(cwd, 'PROJECT.md')
		try {
			const info = statSync(file)
			return { exists: true, modifiedAt: info.mtimeMs, bytes: info.size }
		} catch {
			// 没有章程(非空工作区不铺)与读不到,是同一件事:如实说「没有」,不编一个。
			try {
				const info = statSync(join(cwd, 'clear', 'project.md'))
				return { exists: true, modifiedAt: info.mtimeMs, bytes: info.size, legacy: true }
			} catch {
				return null
			}
		}
	}

	/** 每个会话最近一次取到的合并目录指纹(与 lastCandidates 同一个用途:变了才发)。 */
	const lastCatalog = new Map()
	/** 章程指纹:文件没动就不重复发(与目录同一条纪律)。 */
	const lastConstitution = new Map()

	/**
	 * 取一次宿主原生的**合并技能目录**,随投影下发(变了才发)。
	 *
	 * 为什么走原生服务、而不是自己扫 `clear/skills`:`skills` 是**分层注册表**——预设自带
	 * (`bundled`)、项目(`.dsh/skills`、`.agents/skills`)、用户(`~/.dsh/skills`)与我们注册的
	 * `clear/skills` 在宿主侧合并、同名按 rank 取赢家。模型看到的本来就是这张合并表;
	 * 面板原来只画我们那一片,于是「面板上的表」与「模型看到的表」是两张不同的表。
	 * 同一次 pre-step 里原生 `tool-skill` 也在调它(宿主有 collect 缓存),所以这不是新增一次扫描。
	 *
	 * 三条纪律:
	 *   · `complete !== true` 就**不发**——不完整的观测看起来像「技能被删了」,那是谎;
	 *   · 只在变了才发(指纹短路),否则每回合一条消息把日志刷满;
	 *   · 只取叶子字段(名字/描述/来源/调用策略/目录),不把宿主的活对象搬进日志。
	 */
	async function publishCatalog(sessionId, agent) {
		const service = ctx.get('skills')
		if (service === undefined || typeof service.snapshot !== 'function') return null
		const cwd = sessionCwd(sessionId)
		let snapshot = null
		try {
			snapshot = await service.snapshot({ cwd, scope: agent })
		} catch (error) {
			ctx.logger?.warn?.(`clearai brain: 目录快照失败 ${String(error?.message ?? error).slice(0, 160)}`)
			return null
		}
		if (snapshot === null || typeof snapshot !== 'object' || snapshot.complete !== true) return null
		const prefix = cwd.endsWith(sep) ? cwd : `${cwd}${sep}`
		const entries = (Array.isArray(snapshot.skills) ? snapshot.skills : [])
			.map((skill) => {
				const base = skill?.resourceBase
				const dir = base !== null && typeof base === 'object' && base.kind === 'directory' && typeof base.path === 'string' ? base.path : null
				return {
					name: String(skill?.name ?? ''),
					description: String(skill?.description ?? '').slice(0, 300),
					when_to_use: typeof skill?.whenToUse === 'string' ? skill.whenToUse.slice(0, 300) : null,
					source: String(skill?.source ?? 'unknown'),
					provider: String(skill?.provider ?? ''),
					model: skill?.invocation?.modelInvocable === true,
					user: skill?.invocation?.userInvocable === true,
					dir,
					// 正文文件 = 技能目录下的 `SKILL.md`(原生 filesystem provider 自己的约定:
					// `path = join(dir,'SKILL.md')`、`resourceBase.path = 技能目录`)。
					// 记忆那条是**虚拟条目**(根本没有正文文件),所以它是 null——面板据此不画链接,
					// 而不是让人点进去撞一个 404。
					file: dir === null || String(skill?.source ?? '') === 'clearai-memory' ? null : join(dir, 'SKILL.md'),
					// 面板读正文走的是**工作区内**的读面(路径守卫),所以「在不在工作区里」这条
					// 事实由知道 cwd 的这一侧算好发下去,免得面板去猜。
					inside: dir === null ? null : dir === cwd || dir.startsWith(prefix),
				}
			})
			.filter((entry) => entry.name !== '')
		const digest = JSON.stringify(entries)
		if (lastCatalog.get(sessionId) === digest) return null
		lastCatalog.set(sessionId, digest)
		return { complete: true, entries }
	}

	/**
	 * ═══ 当档(人在场 / 无人值守):人的事实,内核负责下发 ═══
	 *
	 * 为什么由内核算而不是面板自己算:`当档 = 人切的 ?? 组合里写的初值`,而初值只有内核
	 * 看得到(宿主平面拿不到预设配置)。**让知道的那一侧说**,与目录下发是同一条纪律。
	 *
	 * 为什么它必须进投影(而不是只写在卡里):面板要画一个开关,得有个机器可读的当值;
	 * 而且「人什么时候把档切成了什么」是可审计的事实,该和别的决定一样留在日志里。
	 */
	function effectiveAutonomy(state) {
		const override = state?.autonomy?.override?.value
		if (override === 'attended' || override === 'unattended') return override
		return CFG.autonomy
	}
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

	/** 当档变了才发(与目录同一条纪律:变化才发,不刷墙)。 */
	const lastAutonomy = new Map()
	function publishAutonomy(sessionId, state, fromInput = null) {
		const value = fromInput === 'attended' || fromInput === 'unattended' ? fromInput : effectiveAutonomy(state)
		const source = fromInput !== null || state?.autonomy?.override?.value === value ? 'session' : 'preset'
		const digest = `${value}:${source}`
		if (lastAutonomy.get(sessionId) === digest) return null
		lastAutonomy.set(sessionId, digest)
		// preset 一起发下去:面板才说得清「这是部署的初值,还是你此刻切的」。
		return { value, preset: CFG.autonomy, source }
	}

	/** 一条最简的插件消息(与运行态卡同一条通道,只是没有卡)。 */
	function pluginNotice(payload, note, brainPayload, autonomyPayload = null, factMutations = []) {
		const sections = [{ name: 'clearai', text: note }]
		if (brainPayload !== null) sections.push({ name: 'clearai/brain', text: JSON.stringify(brainPayload) })
		if (autonomyPayload !== null) sections.push({ name: 'clearai/autonomy', text: JSON.stringify(autonomyPayload) })
		/**
		 * 内核在**回合之间**观察到的事实变更(目前是「世界线执行者跑完了」)。
		 * 与工具结果里的 `meta.mutations` 同形,所以投影那一侧直接 `applyMutations` —— 一个折法。
		 */
		if (factMutations.length > 0) sections.push({ name: 'clearai/mutations', text: JSON.stringify({ mutations: factMutations }) })
		return {
			id: `clearai-brain-${payload.turn}-${payload.step}-${Date.now().toString(36)}`,
			role: 'user',
			content: text(note),
			source: { kind: 'plugin', plugin: 'clearai', form: 'snapshot', sections },
		}
	}

	/** 一次写盘之后让宿主的目录缓存失效(下一个回合的 catalog 就会带上新条目)。 */
	function invalidateBrainCatalog() {
		try {
			invalidateBrain?.()
		} catch (error) {
			ctx.logger?.warn?.(`clearai brain: 目录失效失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}
	}

	defineTool({
		name: 'SaveSkill',
		description:
			'把一套值得复用的方法沉淀成技能(写 `clear/skills/<name>/SKILL.md`)。写进去是**候选态**——人采纳之后模型才加载得到它,这是刻意的:自己写的 SOP 该由人过一道。技能正文用 `workflows/`、`templates/`、`checklists/`、`references/` 组织,别把长篇细节塞进 SKILL.md。',
		parameters: {
			type: 'object',
			properties: {
				skill: { type: 'string', description: '技能名(kebab-case,即目录名);改进已有技能则填它的名字' },
				content: { type: 'string', description: '该文件的完整内容(全文写入,不是 diff)。SKILL.md 必须含 name 与 description 两项 frontmatter' },
				path: { type: 'string', description: "技能目录内的相对路径,缺省 'SKILL.md';不许含 '..'" },
			},
			required: ['skill', 'content'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const cwd = sessionCwd(sessionId)
			const nameProblem = validateSkillName(args.skill)
			if (nameProblem !== null) return fail(nameProblem, '技能名要 kebab-case(小写字母/数字/短横),它就是目录名。')
			const pathProblem = validateSkillPath(args.path ?? 'SKILL.md')
			if (pathProblem !== null) return fail(pathProblem, '路径只能是技能目录内的相对路径,不许 `..`。')
			if (typeof args.content !== 'string' || args.content.trim() === '') return fail('content_required', '写全文,不是 diff。')
			const target = join(brainPaths(cwd).skills, String(args.skill).trim(), args.path ?? 'SKILL.md')
			const isSkillFile = (args.path ?? 'SKILL.md') === 'SKILL.md'
			let text = args.content
			if (isSkillFile) {
				const { data } = parseFrontmatter(text)
				if (typeof data.name !== 'string' || data.name.trim() === '') return fail('skill_frontmatter_required', 'SKILL.md 的 frontmatter 必须含 name。')
				if (typeof data.description !== 'string' || data.description.trim() === '') {
					return fail('skill_frontmatter_required', 'SKILL.md 的 frontmatter 必须含 description(写清【触发词】与适用/不适用)。')
				}
				if (typeof data.status !== 'string' || data.status === '') {
					// 默认候选:**模型写的 SOP 由人过一道**(ClearAI 的候选/采纳治理,这里用 invocation 表达)。
					text = `${text.replace(/^---\n/, `---\nstatus: candidate\n`)}`
				}
			}
			try {
				mkdirSync(dirname(target), { recursive: true })
				writeFileSync(target, text, 'utf8')
			} catch (error) {
				return fail('skill_write_failed', `写盘失败:${String(error?.message ?? error).slice(0, 200)}`)
			}
			invalidateBrainCatalog()
			const relativePath = join('clear', 'skills', String(args.skill).trim(), args.path ?? 'SKILL.md')
			const candidateNote = isSkillFile && parseFrontmatter(text).data.status === 'candidate' ? '\n它是**候选态**:人采纳(modelInvocable 打开)之后才进模型的技能目录。' : ''
			return done({
				ok: true,
				code: 'skill_saved',
				message: `技能已写入 ${relativePath}(${Buffer.byteLength(text, 'utf8')} 字节)。${candidateNote}`,
			})
		},
	})

	defineTool({
		name: 'WriteMemory',
		description:
			'把一条值得沉淀的经验写进项目记忆(`clear/memory/`)。lesson 至少含 Context/Trigger/Action/Validation/Reuse Hint;fact 至少含 Statement/Evidence/Scope/Last Verified。按标题跨文件自动去重——同一件事写两次只会留一条。',
		parameters: {
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['lesson', 'fact'], description: 'lesson=任务偏好与陷阱教训;fact=领域事实与技术观察' },
				title: { type: 'string', description: '一句话标题(去重按它)' },
				fields: {
					type: 'object',
					description: `结构化字段。lesson 必填 ${LESSON_REQUIRED.join('/')};fact 必填 ${FACT_REQUIRED.join('/')}`,
					additionalProperties: { type: 'string' },
				},
				source: { type: 'string', description: '这条经验的出处(哪一步、哪次交付)' },
				target: { type: 'string', description: "写进哪个文件,缺省 lessons.md / facts.md(扁平 .md,不许含路径分隔符)" },
			},
			required: ['kind', 'title', 'fields'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const cwd = sessionCwd(sessionId)
			const kind = args.kind === 'fact' ? 'fact' : 'lesson'
			const title = String(args.title ?? '').trim()
			if (title === '') return fail('title_required', '记忆要有标题:去重、索引、读全文都靠它。')
			const fields = args.fields !== null && typeof args.fields === 'object' ? args.fields : {}
			const missing = kind === 'lesson' ? lessonFieldsProblem(fields) : factFieldsProblem(fields)
			if (missing !== null) {
				return fail('memory_fields_required', `${kind} 缺字段:${missing.join('、')}。结构不是形式——缺了它这条经验以后没法被复用。`)
			}
			if (args.target !== undefined && args.target !== null) {
				const problem = validateMemoryFile(args.target)
				if (problem !== null) return fail(problem, 'target 只能是扁平的 .md 文件名。')
			}
			const written = appendMemory(cwd, { kind, title, fields, source: args.source ?? null, target: args.target ?? null })
			if (written.ok !== true) return fail(String(written.reason ?? 'memory_write_failed'), '记忆写入失败。')
			invalidateBrainCatalog()
			const relativePath = written.relative ?? join('clear', 'memory', written.path ?? '')
			const hint =
				kind === 'lesson' && fields.Trigger && fields.Action && fields.Validation
					? '\n这条具备跨任务复用潜力:值得的话用 `skill` 读 `skill-creator` 取工艺,再用 SaveSkill 结晶(优先改进已有技能)。'
					: ''
			return done({
				ok: true,
				code: written.skipped === true ? 'memory_already_present' : 'memory_written',
				message:
					written.skipped === true
						? `这条已经在了(标题去重命中),没有重复写入:${relativePath}`
						: `已写入 ${relativePath}。下一个回合的技能目录里会出现 \`project-memory\` 的索引。${hint}`,
			})
		},
	})

	// ── 账本两件:读历史 / 恢复(恢复 = 新版本,永不回退) ─────────────────────

	/** 路径守卫:账本工具只认工作区内的相对路径(与读面同一套纪律)。 */
	function ledgerPath(cwd, candidate) {
		const raw = String(candidate ?? '').trim()
		if (raw === '' || isAbsolute(raw) || raw.includes('..')) return null
		return raw.replace(/^\.\//, '')
	}

	defineTool({
		name: 'FileHistory',
		description:
			'查一个文件的账本历史(工作区每次**交付点**落一条提交,不是每次写入)。给路径与可选条数,返回碰过它的提交:短 id、时间、提交信息(写着是哪一步交付的)。要看某个版本的内容或恢复它,用 RestoreFile。',
		parameters: {
			type: 'object',
			properties: {
				path: { type: 'string', description: '工作区内的相对路径' },
				limit: { type: 'number', description: '最多几条(1–50,缺省 10)' },
			},
			required: ['path'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const cwd = sessionCwd(sessionId)
			const path = ledgerPath(cwd, args.path)
			if (path === null) return fail('invalid_path', '只认工作区内的相对路径(不许绝对路径或 `..`)。')
			const history = ledgerHistory(cwd, path, args.limit ?? 10)
			if (history.ok !== true) return fail('ledger_unavailable', `账本读不到:${history.reason}`)
			if (history.entries.length === 0) {
				return done({ ok: true, code: 'no_history', message: `${path} 在账本里没有提交记录(交付点才会落一条;也可能它还没被交付过)。` })
			}
			const lines = history.entries.map((entry) => `${entry.commit} · ${String(entry.at).slice(0, 19)} · ${entry.subject}`)
			return done({
				ok: true,
				code: 'file_history',
				message: `${path} 在账本里有 ${history.entries.length} 条提交${history.mode === 'ledger' ? '(旁路账本)' : ''}:\n${lines.join('\n')}`,
			})
		},
	})

	defineTool({
		name: 'RestoreFile',
		description:
			'把一个文件恢复到某个提交时的内容——**恢复是一条新提交,永不回退历史**(账本只前进)。先用 FileHistory 找到提交 id。不确定就先把当前内容另存一份,再恢复。',
		parameters: {
			type: 'object',
			properties: {
				path: { type: 'string', description: '工作区内的相对路径' },
				commit: { type: 'string', description: 'FileHistory 给出的提交 id(短 id 即可)' },
				reason: { type: 'string', description: '为什么恢复(留痕用)' },
			},
			required: ['path', 'commit'],
			additionalProperties: false,
		},
		output: CARD_OUTPUT,
		async execute(args, exec) {
			const call = open(exec)
			if (call.ok !== true) return call.response
			const { hostService, sessionId, mutations } = call
			const done = finish(hostService, sessionId, mutations)
			const cwd = sessionCwd(sessionId)
			const path = ledgerPath(cwd, args.path)
			if (path === null) return fail('invalid_path', '只认工作区内的相对路径(不许绝对路径或 `..`)。')
			if (typeof args.commit !== 'string' || !/^[0-9a-f]{4,40}$/i.test(args.commit.trim())) return fail('invalid_commit', 'commit 要是 FileHistory 给出的十六进制 id。')
			const commit = args.commit.trim()
			const shown = ledgerShow(cwd, commit, path)
			if (shown.ok !== true) return fail('not_in_commit', `${commit} 里没有 ${path}:${shown.reason}`)
			const target = resolvePath(cwd, path)
			try {
				writeFileSync(target, shown.content, 'utf8')
			} catch (error) {
				return fail('restore_failed', `写回失败:${String(error?.message ?? error).slice(0, 160)}`)
			}
			// 恢复**自己**也落一条提交:历史只前进,所以「恢复」是可查的一步,不是把时间倒回去。
			const committed = commitLedger(cwd, `clearai: 恢复 ${path} ← ${commit}${typeof args.reason === 'string' && args.reason.trim() !== '' ? `(${String(args.reason).slice(0, 60)})` : ''}`)
			mutations.push({ t: 'git/restored', path, from: commit, commit: committed.commit ?? null, mode: committed.mode ?? null, reason: args.reason ?? null })
			return done({
				ok: true,
				code: 'file_restored',
				message:
					`${path} 已恢复成 ${commit} 时的内容(${shown.content.length} 字符)。` +
					(committed.ok === true && committed.skipped !== true
						? `这条恢复自己也是一条新提交(${String(committed.commit ?? '').slice(0, 7)})——账本只前进,历史没有被抹掉。`
						: `(恢复本身没能落成提交:${committed.reason ?? '无改动'}。)`),
			})
		},
	})

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
		return [join(cwd, 'clear', 'evidence'), join(cwd, 'clear', 'knowledge', 'facts'), join(cwd, 'clear', 'goals')]
	}

	function touchesProtected(sessionId, value) {
		if (typeof value !== 'string' || value === '') return null
		for (const root of protectedRoots(sessionId)) {
			if (value.includes(root)) return root
		}
		return null
	}

	/**
	 * **人放行的权威记录**。
	 *
	 * 原生审批栈在**会话日志**里落了一对事件:`approval/asked{id,toolName,callId}` +
	 * `approval/decided{id,outcome}`。`allowed-once` 是唯一的放行,而审批策略只有 `ask`/`never`
	 * 两种取值(`dsh-user-approval` 的 `Config` 就这两个)⇒ `allowed-once` **只可能**来自审批瀑布,
	 * 不可能来自「策略自动放行」。
	 *
	 * 所以这条事实**读出来**,不推断:读不到就如实说读不到(fail closed)。
	 * 改之前我们是「走到这一步 ⇒ 一定放过行」,于是策略自动放行、审批档为 never、或 ask 压根没触发时,
	 * 日志里都会出现一条**「人放行」的假事实**(而 `rejected`/`cancelled` 一条都不记)。
	 */
	function witnessedRelease(sessionId, callId) {
		const wanted = String(callId ?? '')
		if (wanted === '') return null
		const session = ctx.get('sessions')?.get?.(sessionId)
		if (session === undefined || session === null || typeof session.ownEvents !== 'function') return null
		let events = []
		try {
			events = session.ownEvents()
		} catch {
			return null
		}
		let approvalId = null
		for (const event of events) {
			if (event?.type !== 'approval/asked') continue
			if (String(event.data?.callId ?? '') !== wanted) continue
			approvalId = String(event.data?.id ?? '')
		}
		if (approvalId === null) return null
		for (const event of events) {
			if (event?.type !== 'approval/decided') continue
			if (String(event.data?.id ?? '') !== approvalId) continue
			return String(event.data?.outcome ?? 'unavailable')
		}
		return 'pending'
	}

	/**
	 * L4 的那道门挂在**等级**上,不挂在工具名上。
	 *
	 * 同一个 `level: 'L4'`,主线按**步骤**等级、世界线按**分支**等级——两条交付路径必须是同一道门。
	 * 改之前:`l4RequiresHumanRelease` 与 `l4RejectSelfWritten` 只写在 `AdvancePlan` 里,
	 * `AdvanceWorldline` 那条路两样都没有(同一个 L4,走世界线就不用放过行、也不查来源)。
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
				fork: null,
				branch: null,
				level: step.tests?.level ?? null,
				doneCriteria: step.done_criteria,
				// 放行一次的语义没变(同一步第二次交付不再问第二遍),只是记法要认「步骤」这条轴。
				released: (state.releases ?? []).some((item) => item.step === step.id && (item.branch ?? null) === null),
			}
		}
		if (toolName === 'AdvanceWorldline') {
			const wanted = typeof args?.branch_id === 'string' ? args.branch_id : ''
			if (wanted === '') return null
			const fork = (state.forks ?? []).find((item) => item.step === step.id)
			const branch = fork === undefined ? undefined : (fork.branches ?? []).find((item) => item.id === wanted || item.label === wanted)
			if (branch === undefined) return null
			if (levelIndexOf(branch.level) !== 4) return null
			return {
				kind: 'branch',
				plan,
				step,
				fork,
				branch,
				level: branch.level ?? null,
				doneCriteria: branch.done_criteria,
				// 放行绑在**这一条世界线**上:同一步的另一条线不继承它的放行。
				released: (state.releases ?? []).some((item) => item.branch === branch.id),
			}
		}
		return null
	}

	/** 一句人类可读的门名(两条路径的回执用同一句,免得措辞漂移)。 */
	function l4Label(target) {
		return target.kind === 'branch' ? `世界线「${target.branch.label}」` : `步骤 ${target.step.id}`
	}

	ctx.on('tools/pre-execute', async (exec, next) => {
		if (exec.agent !== undefined) {
			const sessionId = String(exec.agent.id)
			const hostService = host()
			const state = hostService === undefined ? null : hostService.state(sessionId)
			const owned = state !== null && hasState(state)
			const args = exec.arguments ?? {}
			// 世界线执行者的路径限定:「独立工作副本」是机制,不是嘱咐。
			// 相对路径按它自己的工作副本解析(所以它写 `probe.txt` 是自然的),
			// 但解析结果越出那份副本就拒——它碰不到主线,也碰不到别的世界线。
			const executor = executorRuns.get(sessionId)
			if (executor !== undefined && (exec.name === 'write' || exec.name === 'edit' || exec.name === 'bash')) {
				// bash 的整条命令**不是**一个路径:按 token 扫,凡看起来像路径的都解析后检查。
				// (与 ClearAI 的 _deny_workspace_escape 同一个思路:判解析后的路径,不判拼写。
				//  把整条命令当一个路径去 resolve,`echo x > /别处/f` 这种写法会直接漏过去。)
				const raw = exec.name === 'bash' ? String(args.command ?? '') : String(args.file_path ?? args.path ?? '')
				const candidates = exec.name === 'bash' ? raw.split(/[\s'"`<>|;&()$]+/).filter((token) => token !== '' && !token.startsWith('-')) : [raw]
				for (const candidate of candidates) {
					if (candidate === '') continue
					const looksLikePath = isAbsolute(candidate) || candidate.startsWith('~') || candidate.includes('/') || candidate.startsWith('.')
					if (!looksLikePath) continue
					const absolute = isAbsolute(candidate) ? candidate : resolvePath(executor.workspace, candidate)
					if (!absolute.startsWith(executor.workspace)) {
						return {
							kind: 'deny',
							reason: `你被派来执行世界线的一条方案,只能在自己的工作副本里作业:${executor.workspace}。${candidate} 在别处——世界线互不通信(也碰不到主线)。`,
						}
					}
				}
			}
			{
				// 「评估卡与事实只能由系统写」:做的人写不进证据面(执行者同样适用)
				const suspect = touchesProtected(sessionId, args.file_path) ?? touchesProtected(sessionId, args.path) ?? (exec.name === 'bash' ? touchesProtected(sessionId, args.command) : null)
				if (suspect !== null) {
					return { kind: 'deny', reason: `clear/evidence、clear/knowledge/facts、clear/goals 由系统所有,做的人不能写:${suspect}。事实与评估卡只能由系统落盘。` }
				}
				// L4 人放行:ClearAI 的设计目标未实现,这里用宿主的审批瀑布实现。
				// 门挂在**等级**上:主线看步骤等级,世界线看分支等级——两条路同一道门。
				{
					const target = CFG.l4RequiresHumanRelease ? l4Delivery(state, exec.name, args) : null
					if (target !== null && !target.released) {
						return {
							kind: 'ask',
							reason: `${l4Label(target)} 是 L4(新产生的、不可重复或来自外部的证据):没有人放行不能开始交付。判据:${target.doneCriteria}`,
						}
					}
				}
				// 放弃探索只给人:模型可以请求,放行必须由人做(ClearAI 的 abandon_fork 出口义务)
				if (exec.name === 'AbandonFork') {
					const plan = activePlanOf(state)
					const step = plan === null ? null : firstOpenStep(plan)
					const fork = step === null ? null : forkOfStep(hostService.derive(sessionId).forks, step.id)
					if (fork !== null && !fork.settled && !fork.abandoned) {
						return {
							kind: 'ask',
							reason: `放弃探索是人的决定:分叉「${fork.question}」还有 ${fork.branches.filter((branch) => (BRANCH_RANK[branch.status] ?? 0) < BRANCH_RANK.adopted).length} 条世界线没有终局。缘由:${String(args.reason ?? '(未填)')}`,
						}
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

	/**
	 * 铺工作区(幂等)。
	 *
	 * **为什么要抢在第一个 pre-step 之前**(`agent/created`)而不是等到 pre-step:
	 * 技能目录是宿主原生那张**合并目录**的一部分,而原生 `tool-skill` 的 pre-step 会在我们前面
	 * 先取一次快照(`cwd + 作用域 + revision` 做键的缓存)。等轮到自己才铺,那次快照就把**空表**
	 * 缓存住了——后果不只是面板没内容:模型自己也一直看不到 `clear/skills` 里的 18 条模板技能,
	 * 人引用 `/技能名` 也注入不出正文。
	 * pre-step 里仍然保留一次调用:铺之前就存在的会话、或事件没送到的情况,兜底。
	 *
	 * `cwdHint` 只信**调用方给的** cwd:`agent/created` 那一刻会话服务里可能还查不到这个会话,
	 * 而 `sessionCwd` 查不到时会退回进程目录——那会把 `clear/` 铺到宿主自己的目录里去(宁可不铺)。
	 */
	function ensureWorkspace(sessionId, cwdHint) {
		if (bootstrapped.has(sessionId)) return ''
		if (typeof cwdHint !== 'string' || cwdHint === '') return ''
		bootstrapped.add(sessionId)
		try {
			const result = bootstrapWorkspace(cwdHint, CFG.templateDir)
			const report = result.templateReport ?? { mirrored: [], drifted: [] }
			// 漂移这条事实**与铺没铺无关**:这一次没铺任何东西,也一样要告诉模型「模板有新版、你改过、没覆盖」。
			const drift =
				report.drifted.length === 0
					? ''
					: `\n(模板技能有新版,但这几份你改过,**没有覆盖**:${report.drifted.join('、')}——要不要跟进由你定。)`
			if (result.changed.length === 0) return drift
			// 目录真的变了:让宿主的技能目录缓存失效,否则它还会端出铺之前那张空表。
			invalidateBrainCatalog()
			return `\n(工作区已铺好:${result.changed.join('、')}${result.fresh ? '——这是空文件夹,默认结构一并铺上' : '——已有内容的文件夹只加系统自己的 clear/'}。)${drift}`
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 工作区引导失败 ${String(error?.message ?? error).slice(0, 160)}`)
			return ''
		}
	}

	// 会话一被创建/接入就把工作区铺好(见 ensureWorkspace:要抢在原生目录快照之前)。
	ctx.on('agent/created', (payload) => {
		const agent = payload?.agent
		const id = agent?.id ?? agent?.session?.id
		if (id === undefined || id === null) return
		ensureWorkspace(String(id), agent?.session?.header?.cwd)
	})

	// ═══ 每回合派生的运行态卡 ═══════════════════════════════════════════════

	const lastCard = new Map()

	ctx.on('agent/pre-step', async (payload, next) => {
		const decision = await next()
		if (decision === null || decision === undefined || decision.kind !== 'enter') return decision
		const hostService = host()
		if (hostService === undefined) return decision
		const sessionId = String(payload.agent.id)
		/** 这一步进来的消息:`user` = 人开口(换窗口),`goal` = 宿主的自动续跑回合。 */
		const entering = Array.isArray(payload.messages) ? payload.messages : []
		const humanSpoke = entering.some((message) => message?.source?.kind === 'user')
		const autoRound = entering.find((message) => message?.source?.kind === 'goal') ?? null
		/**
		 * **本回合的当档从输入读**:人门消息先入 inbox、后落日志,而这一拍跑在它落账之前,
		 * 所以这里读投影必然是旧档——而这一轮恰恰是人的动作触发的那一轮。
		 */
		noteCollectTurn(sessionId, payload.turn)

		// 外脑的两件活**与运行态卡无关**,所以放在最前面(否则「还没有目标」的会话里,
		// 人采纳候选技能那一下会被状态门挡住——那是人的决定,不该被状态挡住):
		//   ① 人在面板上采纳了某个候选 → 改写 frontmatter(`status: active`)并落一条记录;
		//   ② 扫描候选技能 → 落一条 `brain/candidates` 事实(面板的收件箱据此出条目)。
		// 顺序有讲究:先落实人的动作,再扫描——采纳之后这一回合扫出来就「已经没有候选了」。
		// 工作区兜底铺设(正常情况下 agent/created 那一刻已经铺过了)。
		const workspaceNote = ensureWorkspace(sessionId, sessionCwd(sessionId))
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
		let brainNote = ''
		/** 事实货架那句话说一次就够(事实很少变)。 */
		let factsNote = ''
		let brainPayload = null
		/** 目录变了才有的一句话(目录是稀疏变化的:开局、采纳一条、外面手工加了一条)。 */
		let catalogNote = ''
		try {
			const acted = applyHumanGateActions(sessionId, entering)
			const scanned = publishBrain(sessionId)
			// 合并目录:面板与模型看**同一张表**(见 publishCatalog 的注释)。它是异步的,
			// 所以这一条 await 在 pre-step 里——原生 tool-skill 的 pre-step 也是这么等的。
			const catalog = await publishCatalog(sessionId, payload.agent)
			if (catalog !== null) catalogNote = `\n(技能目录已更新:${catalog.entries.length} 条可用。)`
			brainNote = `${acted.note}${scanned.note}${catalogNote}`
			if (acted.promoted.length > 0 || scanned.payload !== null || catalog !== null) {
				brainPayload = {}
				if (acted.promoted.length > 0) brainPayload.promoted = acted.promoted
				if (scanned.payload !== null) {
					brainPayload.candidates = scanned.payload.candidates
					brainPayload.overview = scanned.payload.overview
					// 章程读数(变了才有这一把钥匙):面板与卡片据此说「它还剩几条占位」。
					if (scanned.payload.constitution !== undefined) brainPayload.constitution = scanned.payload.constitution
				}
				if (catalog !== null) brainPayload.catalog = catalog
			}
		} catch (error) {
			ctx.logger?.warn?.(`clearai brain: pre-step 处理失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}

		// 当档:人是可以随时切的(面板开关),所以每个 pre-step 都核对一次。
		// 它落在**投影**里(不是只写在卡里):面板要画开关,而「人什么时候切成了什么」是可审计的事实。
		let autonomyPayload = null
		try {
			// **不**过 `hasState`:当档是会话级事实,从第一回合起就存在,
			// 而且人恰恰要在立约之前就能切档(「我这就走,别等我」)。
			autonomyPayload = publishAutonomy(sessionId, hostService.state(sessionId))
		} catch {
			// 读不到状态就不发:如实少一条事实,不编一个档。
		}
		if (autonomyPayload !== null && brainNote === '') brainNote = `\n(运行档:${autonomyPayload.value === 'unattended' ? '无人值守' : '人在场'}。)`

		/**
		 * **世界线结论的回灌**:`ForkPlan` 把执行者放出去就返回(事实先落账),
		 * 结论由这里收——每个回合扫一次已落定的执行者,把 `worldline/executed` 当作**事实**注入。
		 *
		 * 为什么走「插件消息的 section」而不是等模型来问:结论是**世界发生的事**,该像目录、
		 * 当档一样自己回到投影里;靠模型轮询 WorldlineStatus 等于把「系统知道的事」压在模型的记性上。
		 */
		let factMutations = []
		try {
			// 两级一起收:内存表里那些落定的,以及表里没有、只能从执行者自己的会话日志里读回来的。
			const swept = collectExecutors(factMutations, hostService.state(sessionId), sessionId)
			const lost = { recovered: swept.recovered, lost: swept.lost }
			if (lost.recovered > 0) {
				brainNote = `${brainNote}\n(有 ${lost.recovered} 条世界线的执行者结论是从**它自己的会话日志**里回收的(派它的那次进程已经不在了,结论没丢):已进投影,逐条用 AdvanceWorldline 交付读数。)`
			}
			if (lost.lost > 0) {
				brainNote = `${brainNote}\n(有 ${lost.lost} 条世界线的执行者**失联**(派它的那次进程已经不在,子会话也已不在这个进程里):树与卡片上它们不再是「在跑」。执行者留下的产物还在各自的工作副本里,可以照常 AdvanceWorldline 交付。)`
			}
			if (swept.lines.length > 0) {
				const done = swept.lines.filter((line) => !line.endsWith('仍在跑'))
				if (done.length > 0) brainNote = `${brainNote}\n(世界线执行者已回灌:${done.join('、')}——结论已进投影,逐条用 AdvanceWorldline 交付读数。)`
			}
			/**
			 * 这一拍收上来的结论,**没有原生通知的那一档**要把正文直接放进注记:
			 * 它是「没有工具调用却收到结论」的唯一路径,不带正文的话,这条结论就只剩计数了。
			 */
			if (noticeBlock(swept.notices) !== '') brainNote = `${brainNote}\n\n${noticeBlock(swept.notices)}`
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 世界线结论回灌失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}
		/**
		 * 失联的评估者:重启之后 `pendingAudits` 空了,而投影里那条裁决还停在「在跑」——
		 * 它会把目标按在 hold 上。这里问一次宿主的子代理目录,把「它已经不在跑」如实落成一条事实。
		 */
		let auditsResolved = false
		try {
			const audits = await sweepLostAudits(sessionId, hostService.state(sessionId))
			if (audits.mutations.length > 0) {
				factMutations.push(...audits.mutations)
				auditsResolved = true
				brainNote = `${brainNote}\n(有 ${audits.lost} 条独立裁决**失联**(子会话已不在跑):已如实记为 unknown——不必再等它,重新交付这一步就会派一个新的评估者。)`
			}
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 失联裁决盘点失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}
		/**
		 * **失联的侦察**:同一拍、同一套判据(原生子代理目录 + 本进程攥着的派遣)。
		 * 一句永久「未回灌」在卡片上就是一句等不到下文的承诺。
		 */
		try {
			// 本拍刚落定的侦察不算失联(它们的 `scout/settled` 还在这一批变更里,投影没前进)。
			const settledInBatch = new Set(factMutations.filter((mutation) => mutation.t === 'scout/settled').map((mutation) => mutation.id))
			const scouts = await sweepLostScouts(sessionId, hostService.state(sessionId), settledInBatch)
			if (scouts.mutations.length > 0) {
				factMutations.push(...scouts.mutations)
				brainNote = `${brainNote}\n(有 ${scouts.lost} 条侦察**失联**(子会话已不在跑):已如实记下「结论收不回来」——不必再等它,需要那份材料就重新派一次。)`
			}
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 失联侦察盘点失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}
		/**
		 * **盘上残留**:投影从零开始,可盘上的上一轮还在。
		 * 每个会话扫一次(签名 = 工作目录 + 当前这盘的分叉 id 列表,变了才重扫),
		 * 有残留就如实报一条读数——不落状态、不新增变更类型。
		 */
		try {
			const cwd = sessionCwd(sessionId)
			const state = hostService.state(sessionId)
			/**
			 * **事实货架**:事实变了才重写、才在卡里提一句——**变了才发**,与目录同一条纪律。
			 * 事实很少变(升格一次),所以这句话在大多数回合里都不出现。
			 */
			const shelf = ensureFactsShelf(sessionId, state)
			if (shelf !== null) factsNote = `\n- 事实库多了一条(或边界改了):${shelf}——引用前先看它的边界(推翻条件)。`
			const signature = `${cwd}|${(state.forks ?? []).map((fork) => String(fork.id)).join(',')}`
			if (residueScan.get(sessionId) !== signature) {
				residueScan.set(sessionId, signature)
				const residue = worldlineResidue(cwd, state)
				if (residue !== null) {
					const where = residue.containers.map((item) => `${item.id}(${item.branches} 份)`).join('、')
					const refs = residue.strayRefs === null ? '' : `与 ${residue.strayRefs} 个 clearai 分支 ref`
					brainNote = `${brainNote}\n(盘上还留着**上一轮**的 ${residue.worktrees} 份世界线工作副本:${where}${refs}——它们不属于当前这盘,没有任何机制会自动收。留着就是留档(P5:什么都不删);要清掉用 git worktree remove + git branch -D。)`
				}
			}
		} catch (error) {
			ctx.logger?.warn?.(`clearai: 盘上残留读数失败 ${String(error?.message ?? error).slice(0, 160)}`)
		}

		if (!CFG.runtimeCard) {
			if (brainNote === '' && brainPayload === null && autonomyPayload === null && ontologyPayload === null && factMutations.length === 0) return decision
			return { kind: 'enter', messages: [...decision.messages, pluginNotice(payload, brainNote, brainPayload, autonomyPayload, factMutations)] }
		}
		let card
		let rearmNote = ''
		try {
			const state = hostService.state(sessionId)
			if (!hasState(state)) {
				if (brainNote === '' && brainPayload === null && autonomyPayload === null && ontologyPayload === null && factMutations.length === 0) return decision
				return { kind: 'enter', messages: [...decision.messages, pluginNotice(payload, brainNote, brainPayload, autonomyPayload, factMutations)] }
			}
			// 档位不再随回合变化(它是部署预设的初值)⇒ 卡片照投影渲染,没有"本回合的新档"要覆盖。
			card = hostService.renderCard(sessionId)
			const derived = hostService.derive(sessionId)
			// 续跑窗口的接管:策略说 drive 就布防(人开口则换新窗口)、hold 就停、
			// stop 就置阻塞。重启补防也在这一条路上(宿主的 activation 是进程本地的)。
			rearmNote = applyContinuationPolicy(payload.agent, state, derived, { freshWindow: humanSpoke, auditsResolved, mutations: factMutations })

			// 自动续跑回合:模型这一回合是**被叫醒的**,它需要知道为什么、以及现在的事实是什么。
			// 所以:① 卡片强制注入(绕开「只在变化时注入」的去重);② 附上 ClearAI 的续跑文案。
			if (autoRound !== null) {
				const view = continuationView(payload.agent)
				const layer = derived.activePlan !== null && derived.activePlan.steps.some((step) => step.status === 'open') ? 'plan' : 'goal'
				const rounds = view === null ? '' : `(第 ${view.roundsStarted}/${view.maxGoalRounds} 轮)`
				const lastTurn = view !== null && view.roundsStarted >= view.maxGoalRounds - 1 ? LAST_TURN_HINT : ''
				card = `${card}\n\n${CONTINUATION_TEXT[layer]}${rounds}${lastTurn}`
			}
		} catch (error) {
			return decision
		}
		if (rearmNote !== '') card = `${card}\n${rearmNote}`
		if (brainNote !== '') card = `${card}\n${brainNote}`
		if (workspaceNote !== '') card = `${card}${workspaceNote}`
		if (ontologyNote !== '') card = `${card}${ontologyNote}`
		if (factsNote !== '') card = `${card}${factsNote}`
		const ontologyPayload = publishOntology(sessionId)
		// 外脑的事实走**结构化 section**(不是卡里的散文):fold 从会话日志里把它折进投影,
		// 于是「有哪些候选技能」与「谁采纳了它」都是**可重放的事实**,不是一句说明。
		const brainSections = [
			...(brainPayload === null ? [] : [{ name: 'clearai/brain', text: JSON.stringify(brainPayload) }]),
			...(autonomyPayload === null ? [] : [{ name: 'clearai/autonomy', text: JSON.stringify(autonomyPayload) }]),
			...(ontologyPayload === null ? [] : [{ name: 'clearai/ontology', text: JSON.stringify(ontologyPayload) }]),
			...(factMutations.length === 0 ? [] : [{ name: 'clearai/mutations', text: JSON.stringify({ mutations: factMutations }) }]),
		]
		// 自动续跑回合永远注入(那是这一回合的全部由来);其余回合只在状态变化时注入。
		if (autoRound === null && lastCard.get(sessionId) === card) {
			// 卡片没变,但**外脑事实变了**(目录是最常见的一种:人在外面加了一条技能,状态一动没动):
			// 只发事实、不重发卡片——重发卡片是往会话里塞一段没变的长文(白花 token,还多一条噪音)。
			if (brainSections.length === 0 && autonomyPayload === null && ontologyPayload === null && factMutations.length === 0) return decision
			return { kind: 'enter', messages: [...decision.messages, pluginNotice(payload, brainNote, brainPayload, autonomyPayload, factMutations)] }
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
						kind: 'plugin',
						plugin: 'clearai',
						form: 'snapshot',
						sections: [{ name: 'clearai', text: card }, ...brainSections],
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
		ctx.tools.register(TOOL_DEFS.get(toolName))
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
				.join('/')};autonomy=${CFG.autonomy});状态由宿主投影持有`,
	)
}
