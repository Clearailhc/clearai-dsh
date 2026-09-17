/**
 * e2e-run —— **真跑一遍**,不是跑测试。
 *
 * 为什么需要它(2026-09-10 的教训):测试直接调 `execute`,宿主那一步输出 schema 校验在测试里
 * 被跳过,于是 337 条断言全绿而 `CreatePlan` 在实跑里**每一次都失败**。所以除了单测,还得有一条
 * 「真进程 + 真模型 + 真会话日志 + 真投影」的验收线。
 *
 * 它做四件事:
 *   ① 把预设(`preset/agent.cordis.yml`)的行**摊平成一份 patch**,让 headless profile 直接带上
 *      ClearAI(不用 GUI、不用起服务器);
 *   ② 在一个**临时工作区**里跑一个真任务(`dsh --profile headless --patch … "<task>"`);
 *   ③ 找到这次会话的日志,断言该发生的事真的发生了(工具调用、变更记录、没有契约错误);
 *   ④ 用**我们自己的 fold** 折这份真日志,断言投影真的长出了计划与目标
 *      ——这一步等于把「内核 + 宿主投影 + 面板数据面」整条链在真数据上验了一遍。
 *
 * 跑法:
 *   node tools/e2e-run.mjs "任务文本"
 *   node tools/e2e-run.mjs --keep "任务文本"     # 保留临时工作区与会话,便于人工看
 *
 * 依赖:DSH 的 launch 环境(`npx --no-install @deepseek-ai/dsh`)与 checkout 里的 `yaml`
 * (只用于把预设 yml 摊成 patch;这是 dev 工具,不进部署)。
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { artifactExists, countMemoryEntries } from './e2e-workspace.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
/**
 * `let` 而不是 `const`:`--installed` 那一场要在一个**一次性 DSH_HOME** 里跑真实安装
 * (装包 + 建 profile + 读会话日志都在那边),所以建好之后要把它重指过去。
 */
let DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
/** dsh checkout 在哪:只用来解析它自带的 `yaml`(摊平预设用)。从 npx 缓存现找,不写死机器路径。 */
function discoverDshCheckout() {
	const cache = join(process.env.HOME ?? homedir(), '.npm', '_npx')
	if (existsSync(cache)) {
		for (const entry of readdirSync(cache)) {
			if (existsSync(join(cache, entry, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) return join(cache, entry)
		}
	}
	throw new Error('找不到 DSH 宿主(查过 ~/.npm/_npx/*)。先 `npx @deepseek-ai/dsh --help` 让缓存就位。')
}
const CHECKOUT = process.env.DSH_CHECKOUT ?? discoverDshCheckout()
/** 预设来源:默认 = 仓库里那份;`--installed` 重指到**装出来的包**里那份(见下)。 */
let PRESET_YML = join(PORT, 'preset', 'agent.cordis.yml')

const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
/** 取一个 `--flag value` 形式的值(取不到就 undefined)。 */
const option = (flag) => {
	const index = argv.indexOf(flag)
	return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--') ? argv[index + 1] : undefined
}
/**
 * `--goals`:一次性形态里**保留** `goal` 服务与 `goal-round-driver`(默认会关掉它们,见 SECOND_LEDGER)。
 *   为什么要有这一档:续跑窗口的那套东西(身份文本、额度、账)只在挂了这三行的组合里存在,
 *   而 §17.5 要验的是「人刚切档那一拍」的内核行为——那一拍发生在回合**内**,不需要等驱动器,
 *   所以用它就能在 headless 里真跑,不必去驱动 GUI。
 * `--resident`:跑**常驻形态**(`--profile web`)而不是一次性形态(`headless`)。
 *   为什么必须有这一档:一次性形态**故意不挂** `goal` 服务与 `goal-round-driver`(见下 SECOND_LEDGER),
 *   所以那里根本不可能有续跑窗口——§17 的那套东西(窗口的身份文本、我们的账、被驱动器叫醒的轮次)
 *   只能在常驻形态里真跑。默认的 headless 那一档验的是「一次性形态如实说没有窗口」。
 * `--workspace <dir>`:在一个**现成的工作区**里跑(比如某个真项目的副本)。
 *
 * 为什么需要(2026-09-11 做长测时加的):临时空工作区验不了「章程已经有内容」「盘上已有产物」
 * 「记忆里已经有经验」这类**有历史的工作区**——而最近几轮改的恰恰是这三件事的行为。
 * 传进来的工作区**不会被删**(那是调用方的资产)。
 */
/**
 * `--scenario <name>`:换一份**长测剧本**(定义在 `tools/e2e-scenarios.mjs`)。
 *
 * 剧本给两样:任务书(写死,因为测的是装配不是模型的创造力)与断言(从真日志取证)。
 * 另外它还会跑一组**跨机制不变量**(不跳准入、评估者不悬空、分叉不留孤儿……)——
 * 那些才是长测的价值所在:单点机制在单测里都绿,跨机制的先后与配对关系只有跑完整一场才看得见。
 */
const scenarioName = option('--scenario')
const SCENARIO_MODULE = await import(new URL('./e2e-scenarios.mjs', import.meta.url))
const scenario = scenarioName === undefined ? null : (SCENARIO_MODULE.SCENARIOS[scenarioName] ?? null)
if (scenarioName !== undefined && scenario === null) {
	console.error(`✗ 没有这个剧本:${scenarioName}\n  可选:${Object.keys(SCENARIO_MODULE.SCENARIOS).join(', ')}`)
	process.exit(2)
}

const useWorkspace = option('--workspace')
/**
 * `--autonomy attended|unattended` / `--max-turns N`:覆盖内核那一行的配置。
 * 「当档」是人可以随时切的,但 headless 跑动要先把初值定下来——无人值守档立约即授权、按轮数自己跑,
 * 正好用来验「有界的自动续跑」。
 */
const autonomy = option('--autonomy')
const maxTurns = option('--max-turns')
/**
 * `--skills`:换一个**小场景**验「人引用技能」那条链路(面板「引用」按钮发的就是这条消息)。
 *
 * 为什么单开一场:默认任务要求模型立目标建计划,如果在它前面加一个 `/技能名` 手势,
 * 注入的 SOP 会把模型带去干那件事——主线断言就不再确定。所以引用这条链路自己跑一场:
 * 一句 `/<技能名>` + 一句「别调别的工具,只说一句你拿到了什么」。
 */
const skillsScenario = argv.includes('--skills')
/**
 * `--freeform`:这一场**本来就不建目标/计划**(比如「只改章程与记忆」这种有界任务)。
 * 不加旗标时,「有目标 / 有计划」是**断言**;加了就是不适用——如实跳过,
 * 而不是让一场成功的跑动在报告里显示成一排 ✗。
 */
const freeform = argv.includes('--freeform')
/**
 * `--expect-complete`:这一场**应该跑到收尾**(目标结案、没有未落定步骤)。
 *
 * 为什么不设成默认:有一批场景**故意**在半路停(「建完计划就停,不要执行步骤」、`--max-turns 1`
 * 的截断场),给它们扣一顶「没跑完」的帽子是冤枉。但长链验收场必须显式要求,
 * 否则「半路停下」会伪装成一排 ✓(R3 之前就是这样:24 通过,而链根本没走完)。
 */
const expectComplete = argv.includes('--expect-complete') || scenario?.expectComplete === true
/**
 * `--installed`:这一场跑**装出来的包**,不是仓库里摊平的行(S3)。
 *
 * 差别在哪:默认那一场把预设摊平成补丁行插进 headless,验的是「内核 + 宿主投影 + 面板数据面」;
 * 而这一场在一个一次性 DSH_HOME 里
 *   ① 用官方模板建一个 headless profile;
 *   ② 把 `dist/clearai-dsh` **装进去**(`dsh plugin add`;没有 pnpm 就手工对账并如实标注);
 *   ③ 补丁层里只插**名册一行**(headless 不挂名册),root 指向包内的 `presets/`;
 *   ④ 于是这场跑的是**包里的行 + 包里的预设 + 包里的模板**。
 *
 * 代价如实说:`--autonomy` / `--max-turns` 这类覆盖在装出来的形态里**注入不进去**
 * (配置在预设里,预设随包),所以那一场用包里的缺省值;`--installed` 会打印这句话。
 */
const installedMode = argv.includes('--installed')
/**
 * 常驻形态:窗口真的会被驱动器叫醒的那一种。见文件头的 `--resident`。
 * `--installed` 与它组合时,装出来的 profile 也从 **web** 缺省模板来(名册只在挂它的部署里存在)。
 */
const resident = argv.includes('--resident')
const VALUE_FLAGS = new Set(['--workspace', '--autonomy', '--max-turns', '--scenario'])
const task =
	argv
		.filter((item, index) => !item.startsWith('--') && !VALUE_FLAGS.has(argv[index - 1] ?? ''))
		.join(' ')
		.trim() ||
	scenario?.task ||
	(skillsScenario
		? '/literature-review 只做一件事:读一遍我刚引用的这条技能,用一句话告诉我它的名字与它教你做的第一件事。不要调用任何其他工具,不要立目标、不要建计划。'
		: '这个工作区是空的。我要一份可核对的小交付:先立目标(判据:lab/probe.txt 存在且含一行表头 + 一行数据),再建一份两步计划——第一步造出 lab/probe.txt,第二步核对它的列名。立目标时登记至少两条候选假设(每条写清什么结果会推翻它),计划步骤里用 tests 声明验哪条。建完计划就停,不要执行步骤。')
/** 引用场景里那个手势指向的技能名(断言注入的是它不是别的)。 */
const QUOTED_SKILL = 'literature-review'

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

// ── ⓪ 读数小工具:把「有历史的工作区」变成几个可比数字 ────────────────────────

/** 章程读数:与内核那一侧同一套判据(占位 = 以 `[` 开头的条目)。没有就是 0/0。 */
function readConstitution(workspace) {
	const file = join(workspace, 'PROJECT.md')
	if (!existsSync(file)) return { exists: false, items: 0, placeholders: 0, stage: null, changeLog: 0 }
	let text = ''
	try {
		text = readFileSync(file, 'utf8')
	} catch {
		return { exists: false, items: 0, placeholders: 0, stage: null, changeLog: 0 }
	}
	const items = []
	for (const line of text.split(/\r?\n/)) {
		// 与内核同一套判据(标签后的分隔符可以是冒号/全角冒号/括号/空格——见 kernel 里的注释)。
		const match = /^-\s*\*\*([^*]+)\*\*\s*[：:]?\s*(.*)$/.exec(line.trim())
		if (match === null) continue
		const value = match[2].trim()
		items.push({ label: match[1].trim(), value, placeholder: value === '' || value.startsWith('[') })
	}
	const stage = items.find((item) => item.label.includes('当前阶段')) ?? null
	// §5 变更记录:模板里那一行是占位,填过之后应为「日期 + 改了什么 + 原因」形态的行
	const changeLog = (text.split('变更记录')[1] ?? '').split(/\r?\n/).filter((line) => /^\s*[-*]\s*\S/.test(line) && !line.includes('[')).length
	return { exists: true, items: items.length, placeholders: items.filter((item) => item.placeholder).length, stage: stage === null ? null : { filled: !stage.placeholder, value: stage.placeholder ? null : stage.value }, changeLog }
}

/** 记忆条数:数 `clear/memory/*.md` 里的一级条目(`## `)。 */
/** 盘上产物:products/ 下的文件(相对工作区路径)。 */
function listProducts(workspace, limit = 200) {
	const root = join(workspace, 'products')
	const found = []
	const walk = (dir, depth) => {
		if (depth > 4 || found.length >= limit) return
		let entries = []
		try {
			entries = readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (entry.name.startsWith('.')) continue
			const full = join(dir, entry.name)
			if (entry.isDirectory()) walk(full, depth + 1)
			else if (entry.isFile()) found.push(full.slice(workspace.length + 1))
		}
	}
	walk(root, 1)
	return found.sort()
}

/** 这个工作区里已经有多少个会话目录(跑完之后应当 +1)。 */
function countSessionLogs(workspace) {
	// 与 sessionLogFor 用**同一个** slug 规则(上一版这里另写了一套 `~XX~` 转义,
	// 于是「已有会话」永远是 0——读数自欺)。
	return sessionLogsIn(workspace).length
}

// ── ⓪ `--installed`:先在一个一次性 DSH_HOME 里**真装一遍包**(S3)──────────────
/**
 * 这一场要验的是**装出来的产物**,不是仓库里的源。所以:
 *   ① 一次性 DSH_HOME + 官方 headless 模板建 profile;
 *   ② `dsh plugin add`(没 pnpm 就手工对账并如实标注)把 `dist/clearai-dsh` 装进去;
 *   ③ 预设/内核/模板都从**安装位置**读:`<profile>/node_modules/clearai-dsh/presets/clearai/`;
 *   ④ 宿主半不再由我们插行 —— 包的 `cordis.patch.yml` 自己带(`--dump-config` 里能看到 `clearai-host`)。
 *
 * 为什么仍然要摊平预设:headless 是**一次性 app**,它自己创建 agent、**不选预设**
 * (名册是给能选预设的 app 用的:web)。所以「名册选择」那条路在 S2 的 web 启动里验过,
 * 这里验的是另一半:**装出来的行 / 预设 / 模板在真进程里跑得对不对**。
 */
let installedHome = null
let installedTemplateDir = null
let installedProfile = 'headless'
if (argv.includes('--installed')) {
	installedHome = mkdtempSync(join(tmpdir(), 'clearai-e2e-home-'))
	installedProfile = 'e2e-native'
	const realHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
	for (const name of ['.credentials.yaml', 'settings.yaml']) {
		if (existsSync(join(realHome, name))) copyFileSync(join(realHome, name), join(installedHome, name))
	}
	if (existsSync(join(realHome, 'llm-deepseek'))) cpSync(join(realHome, 'llm-deepseek'), join(installedHome, 'llm-deepseek'), { recursive: true })
	DSH_HOME = installedHome
	const installer = spawnSync('node', [join(PORT, 'tools', 'install-native.mjs'), '--home', installedHome, '--profile', installedProfile, '--from-default', resident ? 'web' : 'headless', '--dist', join(PORT, 'dist', 'clearai-dsh')], { encoding: 'utf8', env: { ...process.env, DSH_HOME: installedHome }, timeout: 900000 })
	console.log(String(installer.stdout ?? '').split('\n').filter((line) => line.trim() !== '').map((line) => `  ${line}`).join('\n'))
	check('装出来的包进了 profile(原生 CLI 或手工对账)', installer.status === 0, String(installer.stderr ?? '').slice(-300))
	check('包的补丁层生效:组合里有 clearai-host 行', /组合里的我们的行:.*clearai-host/.test(String(installer.stdout ?? '')), String(installer.stdout ?? '').slice(-160))
	if (installer.status !== 0) process.exit(1)
	const installedPresetDir = join(installedHome, 'profiles', installedProfile, 'node_modules', 'clearai-dsh', 'presets', 'clearai')
	check('预设从**安装位置**读(不是仓库)', existsSync(join(installedPresetDir, 'agent.cordis.yml')), installedPresetDir)
	PRESET_YML = join(installedPresetDir, 'agent.cordis.yml')
	installedTemplateDir = join(installedPresetDir, 'template')
	console.log(`  这一场跑的是装出来的包:${dirname(installedPresetDir)}`)
}

// ── ① 预设 → patch:把每一行摊成绝对路径的插入项 ──────────────────────────────

const { parse: parseYaml, stringify: stringifyYaml } = await import(join(CHECKOUT, 'node_modules', 'yaml', 'dist', 'index.js'))
const presetRows = parseYaml(readFileSync(PRESET_YML, 'utf8')).map((row) => ({
	...row,
	// 相对路径按**这份预设自己所在的目录**解析:仓库形态是 preset/,--installed 是包里的那份。
	name: row.name?.startsWith('.') ? resolve(dirname(PRESET_YML), row.name) : row.name,
}))

/**
 * headless profile 已经挂了 dsh-base 的一大堆行,所以 patch 必须是**差集**:
 * 已在的行跳过(不能重复插,id 会撞),预设特意**不挂**的那些行显式关掉(第二本账)。
 * 「已在的行」直接从 `dsh --dump-config` 读——不猜。
 */
const dump = spawnSync('npx', ['--no-install', '@deepseek-ai/dsh', '--profile', resident ? 'web' : 'headless', '--dump-config'], { encoding: 'utf8', timeout: 180000 })
const present = new Set([...String(dump.stdout ?? '').matchAll(/^- id: (\S+)/gm)].map((match) => match[1]))
check(`读得到 ${resident ? 'web' : 'headless'} profile 的行清单(dump-config)`, present.size > 20, `${present.size} 行`)

/** 预设刻意不挂的行(第二本账):base 里有就关掉,否则 E2E 跑的不是预设的行为。 */
/**
 * 关掉**模型面**的第二本账:`tool-goal`/`command-goal`/`plan-mode`,
 * 以及 `goal`(服务)与 `goal-round-driver`(续跑执行者)。
 *
 * 后者为什么也关(2026-09-11 那次长测定案):**一次性形态兑现不了续跑** —— 一个任务一个回合,
 * 空闲即退出,没有"下一轮"可以续。
 * `dsh-headless` 是 `followup(task) → await whenIdle() → flush → exit`,而驱动器在**静默点**
 * (回合结束之后 ~18ms,它自己要先过一次持久化屏障)才把下一轮排进 inbox ——
 * 于是「排上的一轮」几乎总在送到之前随拆机一起被丢掉(复现 3/3)。
 * 实测:退出前「再看一眼 pending」的一行修法**无效**(实验 A 仍 1 回合);
 * 给 300ms 静默窗口**有效**(实验 B:2 回合、18 条变更、目标结案)但那是个**时间假设**,
 * 不是机制。按 P1/P2:一次性形态本来就承诺不了续跑,那就**别在它里面声称有**——
 * 关掉这两行,内核会如实报「续跑窗口未布防:goals 服务不可用」,卡片上不再有假承诺。
 * 产品形态(web)照旧挂着它们,一行不动。
 */
// 阶段 5 起,todo/subagent/workflow/ralph 随预设挂回(工作方式,产不出 clearai 变更,
// 权威边界测试钉死)——E2E 必须带着它们跑,否则跑的不是预设的行为。
// 仍然要关的只有第二本账三件(goal 工具/命令与 plan-mode)与一次性形态兑现不了的续跑两行。
const SECOND_LEDGER = ['tool-goal', 'command-goal', 'plan-mode', 'goal', 'goal-round-driver']
/**
 * 两种「看起来缺、其实已经在」的行,单独处理(不插,否则 prompt 段/嵌套 id 会撞):
 *   · `persona`:headless 的人格由 `system-prompt` 行的 `personaPrefix` 承担 → 改成覆盖那个配置;
 *   · `compaction`:它的三个子行在 base 里各自独立挂着 → 不插这个组。
 * 其余**已在**的行一律不动:base 的配置带着 E2E 不需要的那些字段,覆盖会丢东西。
 */
const handled = new Set(['persona', 'compaction'])
const missing = presetRows
	.filter((row) => !present.has(row.id) && !handled.has(row.id))
	.map((row) => {
		// delegation 组:摊平成行就丢了 standing scope,而 modelSelectionSettings 需要它
		// (子代理的模型选择按会话键在预设 scope 上)。headless 没有界面也没有 scope,
		// 这一项在摊平形态里关掉——产品形态(web 名册挂载)照开,不受这里影响。
		if (row.id === 'delegation' && Array.isArray(row.config)) {
			const config = row.config.map((sub) =>
				sub?.id === 'tool-subagent' ? { ...sub, config: { ...(sub.config ?? {}), modelSelectionSettings: false } } : sub,
			)
			return { ...row, config }
		}
		// 内核那一行:按命令行覆盖当档与轮数上限(其余配置照抄预设)。
		if (row.id !== 'clearai-kernel') return row
		const config = { ...(row.config ?? {}) }
		if (autonomy !== undefined) config.autonomy = autonomy
		if (maxTurns !== undefined) config.maxAutoTurns = Number(maxTurns)
		/**
		 * 模板目录**是配置**(打包纪律④:发行物里不许出现仓库路径,内核里那条指回仓库的
		 * fallback 已删)。E2E 跑的是仓库里那份内核,所以在这里显式指回 ClearAI 的模板目录;
		 * 生产形态下缺省是插件旁边的 `template/`(随包走)。
		 */
		config.templateDir = installedTemplateDir ?? join(PORT, 'preset', 'template')
		return { ...row, config }
	})
const personaRow = presetRows.find((row) => row.id === 'persona')
/**
 * 宿主平面那一行也要挂:投影单元 `clearai` 在宿主包里。没有它内核会如实报 `host_missing`
 * ——第一次跑 E2E 就是这么发现的:工具「成功」返回、可 mutations 全空,投影长不出任何东西。
 */
const HOST_PACKAGE = join(DSH_HOME, 'profiles', 'web', 'node_modules', 'clearai-dsh', 'lib', 'host.js')
/** 预设的 tool-subagent 开了 modelSelectionSettings,它要求宿主平面这一行(web 自带,headless 没有)。 */
const MODEL_SELECTION_ROW = { id: 'subagent-model-selection-settings', name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings' }
/**
 * 常驻形态**不关**这两行:续跑窗口就是它们。关掉它再验 §17 等于验一个空壳。
 */
const keepGoalRows = resident || argv.includes('--goals')
const disabledRows = keepGoalRows ? SECOND_LEDGER.filter((id) => id !== 'goal' && id !== 'goal-round-driver') : SECOND_LEDGER
/**
 * 补丁拆两层,顺序敏感:宿主面的行(模型选择设置、投影宿主半)必须**先于**预设面加载——
 * 同一补丁层内的行是**并发**加载的,而 tool-subagent 在 apply 期就同步取
 * `subagentModelSelection` 服务,同层竞态会必现「requires … in the Host scope」。
 * 两个 `--patch` 按顺序各成一层,层与层之间是顺序的。
 */
const hostPatch = [
	// 必须 insert 形态:补丁层里「裸 id 行」只能改**已存在**的行,引用缺席的 id 是硬错误。
	// 它只走 CLI 补丁层,不进发行物的 cordis.patch.yml——bundle 补丁的 insert 撞到已有 id
	// 是硬错误(duplicate loader entry id),而 web 自带这一行;headless 形态由这里按缺席补齐。
	...(present.has('subagent-model-selection-settings') ? [] : [{ insert: [MODEL_SELECTION_ROW] }]),
	// installed 模式:宿主行由**包的补丁层**提供(我们不再插,免得同一个 id 挂两行)
	...(installedHome !== null || !existsSync(HOST_PACKAGE) ? [] : [{ insert: [{ id: 'clearai-host', name: HOST_PACKAGE }] }]),
	/**
	 * **长测里把宿主的不变量面挂上**。
	 *
	 * `@deepseek-ai/dsh-invariants` 是诊断面:它由组合决定装不装(默认那套 bundle 不装它,
	 * 只有 DSH 自己的开发组合装)。长测是我们自己的跑动,正好是它该在场的地方——
	 * 内核那侧发现有这个服务就会把自己的五条契约注册进去,于是**每条事实在落账之前**就被判一道:
	 * 引用完整性 / 准入先于推进 / 结算必有派遣 / 升格有据 / 事实棘轮。
	 * 违反时宿主抛带稳定错误码与归属包名的 `InvariantError`,这场长测当场红,而不是等归档人肉核。
	 */
	...(present.has('invariants') ? [] : [{ insert: [{ id: 'invariants', name: '@deepseek-ai/dsh-invariants' }] }]),
]
const presetPatch = [
	...disabledRows.map((id) => ({ id, disabled: true })),
	...(personaRow === undefined
		? []
		: [{ id: 'system-prompt', config: { personaPrefix: personaRow.config?.prefix ?? '', personaSuffix: 'Your working directory is {{cwd}}.' } }]),
	{ insert: missing },
]
const patchDir = mkdtempSync(join(tmpdir(), 'clearai-e2e-patch-'))
const hostPatchFile = join(patchDir, 'host.patch.yml')
const patchFile = join(patchDir, 'preset.patch.yml')
writeFileSync(hostPatchFile, stringifyYaml(hostPatch), 'utf8')
writeFileSync(patchFile, stringifyYaml(presetPatch), 'utf8')

const freshAtStart = existsSync(useWorkspace === undefined ? '' : resolve(useWorkspace)) ? readdirSync(resolve(useWorkspace)).length === 0 : true
/**
 * **fail closed:工作区不许落在 git 仓库里**。
 *
 * 为什么:ClearAI 的设计是「工作区本身是 git 仓库时,每次交付往那个仓库落一条提交」。
 * 跑验收时若把工作区指到宿主的项目仓库内,内核就会往那个仓库写一串 `clearai: 交付 …`
 * 的提交(实测发生过:它连当时未提交的改动一起提交了)。所以这里当场拒绝,
 * 而不是让人事后去 `git reset`。
 */
if (useWorkspace !== undefined) {
	try {
		const top = execFileSync('git', ['-C', resolve(useWorkspace), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
		console.error(`✗ 工作区落在 git 仓库里(${top}):ClearAI 会把交付提交进那个仓库,跑验收会污染它。\n  请换到仓库之外的目录(例如 ~/.dsh/e2e-archive/…)。`)
		process.exit(2)
	} catch {
		/* 不在任何仓库里 = 正是我们要的 */
	}
}

const tempWorkspace = useWorkspace === undefined
const workspace = tempWorkspace ? mkdtempSync(join(tmpdir(), 'clearai-e2e-ws-')) : resolve(useWorkspace)
if (!existsSync(workspace)) {
	console.log(`✗ --workspace 指向的目录不存在:${workspace}`)
	process.exit(2)
}
/**
 * **不预先建 `lab/`**(2026-09-11 修正):内核把「工作区是不是空的」按**目录项数**判
 * (`bootstrapWorkspace` 的 `fresh = entries.length === 0`),预先建一个空 `lab/` 就把空文件夹
 * 变成「非空」——于是章程 `PROJECT.md` 不会铺,而本工具的断言却按「空文件夹」要求它铺。
 * 空工作区该由内核自己铺默认结构(`input/ lab/ products/` + PROJECT.md),这是它的一条设计。
 */
void tempWorkspace
/** 跑之前的读数:章程占位数 / 记忆条数 / 盘上产物数——跑完对比,才说得清「这一轮改了什么」。 */
const before = {
	constitution: readConstitution(workspace),
	memory: countMemoryEntries(workspace),
	products: listProducts(workspace),
	logs: countSessionLogs(workspace),
}
console.log(`  工作区:${workspace}${tempWorkspace ? '(临时)' : '(现成,跑完不动)'}`)
if (scenario !== null) console.log(`  剧本:${scenarioName} · ${scenario.title}\n  为什么要它:${scenario.why}`)
console.log(`  跑之前:章程占位 ${before.constitution.placeholders}/${before.constitution.items} · 记忆 ${before.memory} 条 · products/ ${before.products.length} 个文件 · 已有会话 ${before.logs} 个`)
if (autonomy !== undefined || maxTurns !== undefined) console.log(`  覆盖:autonomy=${autonomy ?? '(预设)'} maxAutoTurns=${maxTurns ?? '(预设)'}`)
const started = Date.now()
const profileName = installedHome === null ? (resident ? 'web' : 'headless') : installedProfile
const run = spawnSync('npx', ['--no-install', '@deepseek-ai/dsh', '--patch', hostPatchFile, '--patch', patchFile, '--profile', profileName, task], {
	cwd: workspace,
	env: { ...process.env, DSH_HOME },
	encoding: 'utf8',
	timeout: 15 * 60 * 1000,
})
const elapsed = Math.round((Date.now() - started) / 1000)
const stdout = String(run.stdout ?? '')
const stderr = String(run.stderr ?? '')
console.log(`  跑完:exit=${run.status} 用时 ${elapsed}s`)
if (stdout.trim() !== '') console.log(`  最终答复(前 200 字):${stdout.trim().slice(0, 200).replace(/\n/g, ' ')}`)
check('进程正常退出(exit 0)', run.status === 0, `exit=${run.status} stderr=${stderr.slice(-300)}`)

// ── ③ 找这次会话的日志并断言「该发生的事真的发生了」 ──────────────────────────

/**
 * 会话日志:按**工作区目录名**定位(sessions/ 下的目录名就是工作区路径的 slug,
 * 里面每个会话一个目录,日志是 session.v3.jsonl.zstd)。
 * 不靠 mtime 猜最近一份——并行跑两个 E2E 时会串。
 */
/**
 * 工作区路径 → 会话目录名。DSH 自己的 slug 规则:**字母数字、`_`、`.` 都保留**,其余折成 `-`,两端包 `--`。
 *
 * 这两条(保留 `_` 与 `.`)都是拿真实目录比对出来的,不是猜的:
 * 少保留下划线时,`/var/folders/_1/…` 找不到;少保留点号时,`~/.dsh/e2e-archive/…` 找不到。
 * 判据是「宿主真的把会话放在哪儿」,不是我们觉得它应该怎么折。
 */
function sessionSlug(workspaceDir) {
	/**
	 * 非 ASCII 的真实编码是 `~XXXX`(四个大写十六进制)——拿中文目录名的真项目(亨通)跑
	 * --workspace 时发现:宿主把 亨通 记成 ~4EA8~901A,而把它折成 - 的旧规则永远找不到日志,
	 * 于是「找不到日志」被误报成一排「什么都没发生」。规则从真实目录比对而来,不是猜的。
	 */
	const encoded = workspaceDir
		.replace(/^\//, '')
		.replace(/[^A-Za-z0-9_.]+/g, (run) => [...run].map((ch) => (ch.charCodeAt(0) > 127 ? `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}` : '-')).join(''))
		.replace(/-+$/, '')
	return `--${encoded}--`
}

/** 一个工作区下的所有会话(每个会话一个目录,日志可能是 `.jsonl` 或 `.jsonl.zstd`)。 */
function sessionLogsIn(workspaceDir) {
	// slug 的是**解析后的真实路径**:macOS 上 /var 是 /private/var 的软链,
	// 宿主按 realpath 记账,按未解析的路径 slug 会永远找不到(目录名差一个 private- 前缀)。
	const dir = join(DSH_HOME, 'sessions', sessionSlug(realpathSync(workspaceDir)))
	if (!existsSync(dir)) return []
	const found = []
	for (const entry of readdirSync(dir)) {
		const inner = join(dir, entry)
		let files = []
		try {
			files = readdirSync(inner)
		} catch {
			continue
		}
		const log = files.find((name) => name.startsWith('session') && (name.endsWith('.jsonl') || name.endsWith('.jsonl.zstd')))
		if (log !== undefined) found.push(join(inner, log))
	}
	return found
}

/** 解压一份日志的前若干字节(够读到第一条用户消息;子会话的日志也能整份读,几 MB 而已)。 */
function headOf(logPath, bytes = 400000) {
	try {
		if (logPath.endsWith('.zstd')) {
			const out = execFileSync('sh', ['-c', `zstd -dc ${JSON.stringify(logPath)} | head -c ${bytes}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
			return out
		}
		return readFileSync(logPath, 'utf8').slice(0, bytes)
	} catch {
		return ''
	}
}

/** 这份日志的第一条用户消息是不是我们发的那条任务(父会话的判据)。 */
function isParentSession(logPath, taskText) {
	const needle = String(taskText).replace(/\s+/g, '').slice(0, 24)
	if (needle === '') return false
	for (const line of headOf(logPath).split('\n')) {
		const trimmed = line.trim()
		if (trimmed === '' || !trimmed.includes('user/message')) continue
		let event = null
		try {
			event = JSON.parse(trimmed)
		} catch {
			continue
		}
		if (event.type !== 'user/message') continue
		const data = event.data ?? {}
		const text = (Array.isArray(data.content) ? data.content : []).map((block) => (block?.type === 'text' ? block.text : '')).join('').replace(/\s+/g, '')
		// 第一条用户消息就比对:是任务 → 父会话;是某个子角色的人格 → 子会话。
		return text.includes(needle)
	}
	return false
}

/**
 * 找**这一次跑动**的会话日志。
 *
 * 2026-09-11 长测抓到的坑:一个工作区里会有**多个**会话——父会话 + 每个子角色的会话
 * (Evaluator / 世界线执行者 / 侦察)。上一版取 `readdirSync` 里的第一个,于是折到了
 * Evaluator 子会话的日志,断言整排 ✗,而那次跑动其实完全成功(目标 achieved、两步 2/2、
 * 证据 2 条)。判据改成**按内容认**:第一条用户消息就是这次任务的那一份才是父会话。
 */
function sessionLogFor(workspaceDir, taskText) {
	const candidates = sessionLogsIn(workspaceDir)
	if (candidates.length === 0) return null
	/**
	 * 同一个工作区里把**同一个任务跑两遍**时(R3-c 踩到的):两份日志的首条用户消息一模一样,
	 * 于是「第一份对得上的」把第二场的报告折成了**第一场的日志**——报告看着一本正经,
	 * 读的却是上一场(现场是两条莫名其妙的 ✗,而里面的目标 id 是上一场的)。
	 * 所以「对得上」之后还要取**最新的那一份**:刚跑完的会话 mtime 必然最新。
	 */
	const matched = candidates.filter((log) => isParentSession(log, taskText))
	if (matched.length > 1) console.log(`  (提示:${matched.length} 份日志的首条用户消息都与任务对得上——取最新的那一份)`)
	if (matched.length > 0) return newest(matched)
	// 认不出来(比如任务文本被改写)就退回最新一份,并如实说明有几份候选。
	console.log(`  (警告:${candidates.length} 份会话日志里没有一份的首条用户消息与任务对得上——取最新那份)`)
	return newest(candidates)
}

/** 最新的一份(mtime 最大)。 */
function newest(logs) {
	return logs.map((log) => ({ log, mtime: statSync(log).mtimeMs })).sort((left, right) => right.mtime - left.mtime)[0].log
}

const logPath = sessionLogFor(workspace, task)
check('找得到这次会话的日志', typeof logPath === 'string', String(logPath))

let events = []
if (logPath !== null) {
	// 多帧 zstd:node 自带的解压只解第一帧(实测 10MB → 1 条事件),所以用系统的 zstd。
	if (!logPath.endsWith('.zstd')) {
		events = readFileSync(logPath, 'utf8')
			.split('\n')
			.filter((line) => line.trim() !== '')
			.map((line) => {
				try {
					return JSON.parse(line)
				} catch {
					return null
				}
			})
			.filter((event) => event !== null)
	} else {
		try {
			const raw = execFileSync('zstd', ['-d', '-c', logPath], { maxBuffer: 512 * 1024 * 1024 })
			events = raw
				.toString('utf8')
				.split('\n')
				.filter((line) => line.trim() !== '')
				.map((line) => {
					try {
						return JSON.parse(line)
					} catch {
						return null
					}
				})
				.filter((event) => event !== null)
		} catch (error) {
			check('会话日志可解压(zstd)', false, String(error?.message ?? error).slice(0, 120))
		}
	}
}
console.log(`  日志:${logPath} · ${events.length} 条事件`)

const toolCalls = events.filter((event) => event.type === 'tool/call')
const toolResults = events.filter((event) => event.type === 'tool/result')
const called = (name) => toolCalls.some((event) => event.data?.name === name)
const resultOf = (name) => {
	const call = toolCalls.find((event) => event.data?.name === name)
	if (call === undefined) return null
	return toolResults.find((event) => event.data?.message?.content?.[0]?.toolCallId === call.data.callId) ?? null
}

const planShaped = !skillsScenario && !freeform
check('模型真的用了意图工具(SetGoal)', planShaped ? called('SetGoal') : true, toolCalls.map((event) => event.data?.name).join(','))
check('模型真的建了计划(CreatePlan)—— 这正是 2026-09-10 全军覆没的那一件', planShaped ? called('CreatePlan') : true, toolCalls.map((event) => event.data?.name).join(','))
{
	const result = resultOf('CreatePlan')
	const text = JSON.stringify(result?.data ?? {})
	if (!skillsScenario && !freeform) {
		check('CreatePlan 没有契约错误(invalid output / not a declared property)', result !== null && !/invalid output|not a declared property/.test(text), text.slice(0, 200))
		check('CreatePlan 没有语义拒绝(is_error=false)', result !== null && result.data?.error === undefined, JSON.stringify(result?.data?.error ?? null))
	}
}
check(
	'没有任何工具调用因为输出契约被拒',
	!events.some((event) => /invalid output|is not a declared property/.test(JSON.stringify(event.data ?? {}))),
)
// 这一条是第一次跑 E2E 换来的:工具「成功」返回、内容却是降级说明(mutations 全空)。
// 只看「有没有报错」不够——要看**结果里说了什么**。
/**
 * 有一句「服务不可用」是**我们自己在这一次形态里选的**(不是意外降级):
 * 一次性形态不挂 `goal` 服务与 `goal-round-driver`(见 SECOND_LEDGER 的说明),
 * 内核于是如实报「续跑窗口未布防:goals 服务不可用」。它必须被允许,
 * 但**要报数**(容忍了几条、是哪一句),不能静默略过——否则真正的意外降级会藏在它后面。
 */
const DEGRADATION = /host_missing|没有挂载|服务不可用/
const DELIBERATE = /续跑窗口未布防:goals 服务不可用/
{
	const texts = toolResults.map((event) => JSON.stringify(event.data?.message?.content ?? []))
	const hits = texts.filter((text) => DEGRADATION.test(text))
	const unexpected = hits.filter((text) => !DELIBERATE.test(text.replace(/\\n/g, '\n')))
	const tolerated = hits.length - unexpected.length
	if (tolerated > 0) console.log(`  (这一形态**故意**不挂续跑驱动器:容忍 ${tolerated} 条「续跑窗口未布防:goals 服务不可用」——卡片上不再有假承诺)`)
	check(
		'没有工具返回**意外**降级说明(host_missing / 服务不可用)',
		unexpected.length === 0,
		unexpected.map((text) => text.slice(0, 80)).slice(0, 2).join(' | '),
	)
}
const allMutations = toolResults.flatMap((event) => event.data?.meta?.mutations ?? [])
{
	const mutations = allMutations
	console.log(`  变更记录:${mutations.length} 条(${[...new Set(mutations.map((mutation) => mutation.t))].join(',')})`)
	check('变更记录真的落了(goal/set)', skillsScenario || mutations.some((mutation) => mutation.t === 'goal/set'), mutations.map((mutation) => mutation.t).join(','))
	check('变更记录真的落了(plan/created)', skillsScenario || mutations.some((mutation) => mutation.t === 'plan/created'), mutations.map((mutation) => mutation.t).join(','))
}

// ── ③b 工作区引导(真跑之后目录真的长出来了) ───────────────────────────────
{
	// 这个临时工作区**不是空的**(我们预建了 lab/),所以按纪律:只加系统自己的 clear/,
	// 不铺默认结构、不写 PROJECT.md(不往别人的项目里塞章程)。
	check('非空工作区:只加 clear/ 骨架', existsSync(join(workspace, 'clear', 'skills')) && existsSync(join(workspace, 'clear', 'config.json')))
	// 空工作区会铺章程(那是设计);非空工作区**不**铺——本来就有一份的(真项目)当然还在。
const hasProjectMd = existsSync(join(workspace, 'PROJECT.md'))
check(
	freshAtStart ? '空工作区:铺上 PROJECT.md(章程)' : '非空工作区:不新建 PROJECT.md',
	freshAtStart ? hasProjectMd : before.constitution.exists === hasProjectMd,
	`freshAtStart=${freshAtStart} before=${before.constitution.exists} after=${hasProjectMd}`,
)
	check('非空工作区:模板技能仍然铺进去了(技能与章程是两件事)', readdirSync(join(workspace, 'clear', 'skills')).filter((name) => existsSync(join(workspace, 'clear', 'skills', name, 'SKILL.md'))).length === 18, String(readdirSync(join(workspace, 'clear', 'skills')).length))
}

// ── ③c 技能面:真日志里的**合并目录**(面板与模型看同一张表) ──────────────────
{
	const catalogOf = (event) => {
		if (event.type !== 'user/message') return null
		const section = (event.data?.source?.sections ?? []).find((item) => item?.name === 'clearai/brain')
		if (section === undefined || typeof section.text !== 'string') return null
		try {
			return JSON.parse(section.text).catalog ?? null
		} catch {
			return null
		}
	}
	const catalogs = events.map(catalogOf).filter((item) => item !== null)
	const catalog = catalogs.length === 0 ? null : catalogs[catalogs.length - 1]
	const entries = catalog === null || !Array.isArray(catalog.entries) ? [] : catalog.entries
	check('内核在真跑里取到了宿主的合并目录(随投影下发)', entries.length > 0, JSON.stringify(catalogs.length))
	{
		const bySource = {}
		for (const entry of entries) bySource[entry.source] = (bySource[entry.source] ?? 0) + 1
		console.log(`  合并目录:${entries.length} 条 · ${Object.entries(bySource).map(([source, count]) => `${source}:${count}`).join(' · ')}`)
		const template = entries.filter((entry) => entry.source === 'clearai-template')
		check('工作区模板的 18 条都在目录里(我们这一层不会漏)', template.length === 18, `${template.length} 条`)
		// 模型看到的那张表(原生 skill-catalog 消息)必须是**我们这张表的子集**:
		// 面板的表若比模型的表少,「现在能用哪些技能」这个问题就被答错了。
		const nativeNames = new Set(
			events
				.filter((event) => event.type === 'user/message' && event.data?.source?.kind === 'skill-catalog')
				.flatMap((event) => (event.data.content ?? []).filter((block) => block?.type === 'text').flatMap((block) => [...String(block.text).matchAll(/^- `([a-z0-9-]+)`:/gm)].map((match) => match[1]))),
		)
		const missing = [...nativeNames].filter((name) => !entries.some((entry) => entry.name === name))
		check('模型的技能目录一条不漏地出现在面板的表里', missing.length === 0, `模型有、面板没有:${missing.join(',')}(模型表 ${nativeNames.size} 条)`)
		check('目录里的每条都带调用策略(面板据此标「候选 / 仅人可引用」)', entries.every((entry) => typeof entry.model === 'boolean' && typeof entry.user === 'boolean'))
	}

	// 人引用技能(`/名字` 手势)→ 原生 pre-step 注入正文 → 我们的 fold 记为一次**人**的用法。
	if (skillsScenario) {
		const injections = events.filter((event) => event.type === 'user/message' && event.data?.source?.kind === 'skill-invocation')
		check('引用的技能正文真的被注入了(原生 pre-step 认那个手势)', injections.length >= 1, `${injections.length} 条注入`)
		const injected = injections.find((event) => event.data?.source?.name === QUOTED_SKILL)
		check(`注入的是被引用的那一条(${QUOTED_SKILL})`, injected !== undefined, injections.map((event) => String(event.data?.source?.name)).join(','))
		// 直接看**那条消息的文本**(JSON.stringify 会把 `name="` 里的引号转义掉,拿它匹配等于测自己)。
		const injectedText = (injected?.data?.content ?? [])
			.filter((block) => block?.type === 'text')
			.map((block) => String(block.text))
			.join('\n')
		check('注入的是**正文**(<skill_content> 块,不是一句「已加载」)', /<skill_content name="literature-review">/.test(injectedText) && /<skill_instructions>/.test(injectedText), injectedText.slice(0, 120))
	}
}

// ── ④ 用我们自己的 fold 折这份真日志:投影真的长出了目标与计划 ────────────────

if (events.length > 0) {
	const { applyEvent, emptyState, view, derive, renderCard } = await import(join(PORT, 'ui', 'lib', 'fold.js'))
	let state = emptyState()
	for (const event of events) state = applyEvent(state, event)
	const projected = view(state)
	const derived = derive(state)
	if (!skillsScenario && !freeform) {
		check('投影里有目标(claim 非空)', typeof projected.goal?.claim === 'string' && projected.goal.claim !== '', JSON.stringify(projected.goal?.claim ?? null))
		check('投影里有计划且步骤 ≥ 2', (projected.plan?.steps ?? []).length >= 2, `${(projected.plan?.steps ?? []).length} 步`)
		check('投影里的步骤带判据与物证(面板才画得出对照)', (projected.plan?.steps ?? []).every((step) => typeof step.doneCriteria === 'string' && Array.isArray(step.artifacts)))
	} else if (skillsScenario) {
		// 引用场景不该建目标/计划(任务是「别立目标、别建计划」):这本身是一条断言——
		// 引用一条技能不该顺手把状态机推起来。
		check('引用技能不顺手立目标/建计划(引用是引用)', projected.goal === null && projected.plan === null, JSON.stringify({ goal: projected.goal?.id ?? null, plan: projected.plan?.id ?? null }))
	} else {
		// 有界任务:该发生的事在「跑完的读数」里断言(章程 / 记忆 / 产物),这里只确认它没顺手把状态机推起来。
		check('有界任务没有顺手立目标建计划(任务是「只做这两件事」)', projected.goal === null && projected.plan === null, JSON.stringify({ goal: projected.goal?.id ?? null, plan: projected.plan?.id ?? null }))
	}
	check('运行态卡渲染得出来', typeof renderCard(state) === 'string' && renderCard(state).includes('运行态卡'))
	// 阶段是**跟着目标**派生的:没有目标就没有阶段——这正是 P2(不可表示优于不可违反),
	// 不是缺陷。所以引用场景里断言的恰好是「null」。
	check(
		skillsScenario || freeform ? '没有目标就没有阶段(阶段是派生量,不是可宣告的字段)' : '派生阶段不是空的',
		skillsScenario || freeform ? derived.phase === null : typeof derived.phase === 'string' && derived.phase !== '',
		String(derived.phase),
	)
	console.log(`  投影:阶段=${derived.phase} · 步骤=${(projected.plan?.steps ?? []).map((step) => `${step.id}/${step.status}`).join(',')}`)
	// 技能面:面板「外脑」页签的数据面也在这份真投影里(目录 + 本会话用量)。
	const skillView = projected.skills ?? {}
	const catalogEntries = skillView.catalog?.entries ?? []
	const usage = Array.isArray(skillView.usage) ? skillView.usage : []
	console.log(`  技能面:目录 ${catalogEntries.length} 条 · 本会话用量 ${usage.map((item) => `${item.name}(模型${item.model}/人${item.human})`).join(',') || '(无)'}`)
	check('真投影的技能面有合并目录(面板这才画得出「外脑」)', catalogEntries.length > 0, String(catalogEntries.length))
	if (skillsScenario) {
		const used = usage.find((item) => item.name === QUOTED_SKILL)
		check('人引用过一次 → 用量里记为**人**用过(从日志折的,零新账)', used !== undefined && used.human >= 1, JSON.stringify(used))
		check('用量带**指针**(落在哪一步或明确为空,不含糊)', used !== undefined && used.last !== null && typeof used.last.by === 'string', JSON.stringify(used?.last ?? null))
	}
}

// ── ⑤ 跑完之后的读数:有历史的工作区里,**这一轮真的改了什么** ────────────────

const after = {
	constitution: readConstitution(workspace),
	memory: countMemoryEntries(workspace),
	products: listProducts(workspace),
	logs: countSessionLogs(workspace),
}
console.log('\n【跑完的读数(与跑之前对比)】')
console.log(`  章程:占位 ${before.constitution.placeholders}/${before.constitution.items} → ${after.constitution.placeholders}/${after.constitution.items} · 变更记录 ${before.constitution.changeLog} → ${after.constitution.changeLog} 行`)
if (after.constitution.stage !== null) console.log(`  章程 §1 当前阶段:${after.constitution.stage.filled ? `已填「${after.constitution.stage.value}」` : '仍是占位'}`)
console.log(`  记忆:${before.memory} → ${after.memory} 条`)
const newProducts = after.products.filter((path) => !before.products.includes(path))
console.log(`  products/:${before.products.length} → ${after.products.length} 个文件${newProducts.length === 0 ? '' : `(新增 ${newProducts.join(', ')})`}`)
console.log(`  会话目录:${before.logs} → ${after.logs}`)

// 交付断言:声明过的产物是不是真在盘上(「声明 vs 实际」这条链的真数据版)
if (events.length > 0) {
	const { applyEvent, emptyState, view } = await import(join(PORT, 'ui', 'lib', 'fold.js'))
	let state = emptyState()
	for (const event of events) state = applyEvent(state, event)
	const projected = view(state)
	// view 把物证归一成 {path, exists} 对象(声明时则是纯字符串)——两种形状都认,取路径本身。
	const declared = (projected.plan?.steps ?? []).flatMap((step) => step.artifacts ?? []).map((artifact) => (typeof artifact === 'string' ? artifact : artifact?.path)).filter((path) => typeof path === 'string')
	if (declared.length > 0) {
		// 与产品**同一判据**:物证必须是**文件**(目录不算——准入就是这么判的)。
		const isArtifactFile = (artifact) => {
			try {
				return statSync(join(workspace, artifact)).isFile()
			} catch {
				return false
			}
		}
		const onDisk = declared.filter(isArtifactFile)
		console.log(`  声明 vs 实际:计划声明 ${declared.length} 个产物,盘上真在 ${onDisk.length} 个${onDisk.length === declared.length ? '' : `(缺:${declared.filter((artifact) => !onDisk.includes(artifact)).join(', ')})`}`)
	}
	const blocks = projected.blocks ?? {}
	const blockRows = Object.entries(blocks).flatMap(([plan, steps]) => Object.entries(steps ?? {}).map(([step, count]) => `${plan}/${step}=${count}`))
	console.log(`  世界树数据面:车道行 ${(projected.forks ?? []).reduce((sum, fork) => sum + (fork.branches ?? []).length, 0)} 条 · 闸门轮次 ${blockRows.join(',') || '(无)'} · 待裁评估 ${(projected.audits ?? []).filter((audit) => audit.verdict == null).length}`)
	/**
	 * **这一轮走完了,还是半路停下了**(2026-09-11 R3:静默截断以前是「看不出来」的)。
	 *
	 * 一次性形态里没有续跑窗口,所以「模型让出回合」就等于跑动结束——那一刻它可能
	 * 目标还开着、计划还有几步没落定、执行者还没回灌。这些都是**可读的事实**,
	 * 报告里必须自己说出来,而不是让读报告的人从「24 通过」里推断。
	 */
	const openSteps = (projected.plan?.steps ?? []).filter((step) => step.status === 'open')
	const unfinished = (projected.forks ?? []).flatMap((fork) => (fork.branches ?? []).filter((branch) => branch.execution !== null && branch.execution !== undefined && branch.execution.ok === null))
	const goalStatus = projected.goal?.status ?? '(无目标)'
	const settled = goalStatus === 'achieved' || (projected.plan === null && goalStatus === '(无目标)' && !freeform)
	console.log(
		`  收官:目标 ${goalStatus} · 计划${projected.plan === null ? '无' : `剩 ${openSteps.length} 步`} · 未回灌的执行者 ${unfinished.length} 条 · ${settled ? '走完了' : '半路停下'}`,
	)
	/**
	 * **常驻形态**:这里才验得到 §17 的那套东西——窗口的身份文本、我们的账、以及
	 * 「被驱动器叫醒的轮次」。叫醒的判据是**会话事实**:`source.kind === 'goal'` 的用户消息
	 * (驱动器排进来的自动回合带这个来源),不是我们猜它跑了几轮。
	 */
	if (resident) {
		const autoRounds = events.filter((event) => event.type === 'user/message' && event.data?.source?.kind === 'goal').length
		const windowLedger = projected.continuation ?? null
		console.log(`  续跑窗口:被窗口叫醒 ${autoRounds} 轮 · 我们的账 ${windowLedger === null ? '(没有)' : `${windowLedger.state}${windowLedger.why === null ? '' : `(${windowLedger.why})`} · 服务 ${windowLedger.target ?? '—'}`}`)
		check('常驻形态:窗口真的把会话叫醒过(至少一轮来自驱动器)', autoRounds >= 1, `叫醒 ${autoRounds} 轮`)
		check(
			'常驻形态:布防这件事落进了我们的账(armed,不是靠进程内存)',
			windowLedger !== null && ['armed', 'paused', 'stopped'].includes(windowLedger.state),
			JSON.stringify(windowLedger),
		)
	}
	if (expectComplete) {
		check(
			'这一轮跑到了收尾(目标结案且没有未落定的步骤)',
			goalStatus === 'achieved' && openSteps.length === 0,
			`目标 ${goalStatus} · 剩 ${openSteps.length} 步(${openSteps.map((step) => step.id).join(',') || '—'})· 未回灌 ${unfinished.length} 条 ⇒ 半路停下:一次性形态没有续跑窗口,让出回合就跑动结束`,
		)
	}
}

// ── ⑥ 长测:跨机制不变量 + 剧本自己的断言 ────────────────────────────────────
//
// 判据本体在 `tools/e2e-scenarios.mjs` 的 `evaluateLog()` 里——**同一份实现**也被
// `tools/e2e-replay.mjs` 用来离线重判同一份日志。放在那里而不是这里,是为了让
// 「跑一场」与「重判一场」永远不会漂移:判据只有一份。
if (events.length > 0) {
	const { evaluateLog } = SCENARIO_MODULE
	const exists = (rel) => artifactExists(workspace, rel)
	const evaluated = await evaluateLog({
		scenario,
		events,
		mutations: allMutations,
		workspace,
		exists,
		called,
		memoryEntries: countMemoryEntries(workspace),
	})
	console.log(`  变更直方图:${evaluated.stats.histogram || '(空)'}`)
	console.log('\n【跨机制不变量】')
	for (const item of evaluated.checks.filter((entry) => entry.kind === 'invariant')) check(item.label, item.ok, item.detail)
	if (scenario !== null) {
		console.log(`\n【剧本断言:${scenario.title}】`)
		for (const item of evaluated.checks.filter((entry) => entry.kind === 'scenario')) check(item.label, item.ok, item.detail)
	}
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
}
if (keep) {
	console.log(`\n保留现场:工作区 ${workspace}\n会话日志 ${logPath ?? '(未找到)'}${installedHome === null ? '' : `\n一次性 DSH_HOME(--installed 装出来的现场):${installedHome}`}`)
} else if (!tempWorkspace) {
	console.log(`\n现成工作区不动它:${workspace}`)
} else {
	/**
	 * 默认**真的收掉**(2026-09-11 的教训:这些临时工作区攒到把 /tmp 的 inode 用满,
	 * 报的却是「no space left on device」)。要看现场就加 `--keep`。
	 */
	try {
		rmSync(workspace, { recursive: true, force: true })
		rmSync(patchDir, { recursive: true, force: true })
		if (installedHome !== null) rmSync(installedHome, { recursive: true, force: true })
		console.log(`\n临时工作区已收掉(${workspace});要看现场加 --keep`)
	} catch (error) {
		console.log(`\n临时工作区没收干净(${String(error?.message ?? error).slice(0, 120)}):${workspace}`)
	}
}
process.exit(failed === 0 ? 0 : 1)
