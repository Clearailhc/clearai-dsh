/**
 * 预设组合:挂载表的契约。
 *
 * 钉两件事:
 *   ① 原生工作方式真的挂回来了(tool-todo / subagent / workflow / ralph),
 *      而两套「第二本账」(tool-goal / command-goal / plan-mode)仍然不在;
 *   ② 交还宿主的那几件真的不在了(自带的 `/` 命令、外脑、世界线 / 侦察 / 账本机制开关);
 *   ③ PTC 变体由同一份源派生:只多呈现行与 dsh-ops 两个可选行,workflow 关掉,
 *      两条 dsh-ops 行都带「装了才挂」的检查。
 *
 * 跑法:node test/preset-composition.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

const PRESET = readFileSync(join(PORT, 'preset', 'agent.cordis.yml'), 'utf8')

console.log('\n【① 挂载表:工作方式回来了,第二本账没有】')
{
	check('tool-todo 挂载且允许并行 in_progress', /@deepseek-ai\/dsh-tool-todo/.test(PRESET) && /allowParallelInProgress: true/.test(PRESET))
	check('tool-subagent 挂载且带模型选择设置', /@deepseek-ai\/dsh-tool-subagent'/.test(PRESET) && /modelSelectionSettings: true/.test(PRESET))
	check('tool-workflow 挂载', /@deepseek-ai\/dsh-tool-workflow/.test(PRESET))
	check('tool-ralph 挂载', /@deepseek-ai\/dsh-tool-ralph/.test(PRESET))
	/**
	 * 2026-09-28:workflow 引擎换代——旧宿主是 `dsh-workflow-worker-thread`(新宿主已无此包),
	 * 现在是 `dsh-workflow-ptc`。断言同时改成**按行匹配**:上一版是全文匹配,而删掉那行时留下的
	 * 注释里恰好写着旧包名,断言于是被自己的注释骗过(它显示 ✓,其实那行早就没了)。
	 */
	check('workflow 引擎与 delegation realm 在(workflows 服务要有自己的 realm)', /^ {4}- id: workflow-ptc$/m.test(PRESET) && /workflowEngine: true/.test(PRESET))
	// 第三阶段起挂上:目标层挂在原生 goal 上(Frame 建、Conclude 完成),动手前看计划交给原生 /plan。
	check('tool-goal 挂上了(原生 goal 是续跑与展示,完成只经 Conclude)', /name: '@deepseek-ai\/dsh-tool-goal'/.test(PRESET))
	check('command-goal 挂上了(人用原生 /goal 看目标)', /name: '@deepseek-ai\/dsh-command-goal'/.test(PRESET))
	check('plan-mode 挂上了(动手前给人看计划交给原生 /plan)', /name: '@deepseek-ai\/dsh-plan-mode'/.test(PRESET))
	check('自带的 / 命令插件已不挂(状态看界面,/goal /plan 由原生接管)', !/plugins\/commands\.js/.test(PRESET) && !/clearai-commands/.test(PRESET))
	/**
	 * 实体门是本部署的**产品立场**(内核缺省 false),也是第四阶段之后结案唯一的结构关口。
	 * 它必须真的写在 preset 里,否则「将升格的结论,主体要在图上」这条纪律在真跑里根本不存在。
	 * 删掉的两道门(没有断言形态、跳级没理由)也不许再出现在 preset 里——内核会在装配期炸。
	 */
	check('实体门在本部署里是开的(内核缺省关,立场写在 preset)', /requireLandedEntities: true/.test(PRESET))
	check('删掉的两道门不在 preset 里', !/requireTypedPromotion/.test(PRESET) && !/requireLevelReasons/.test(PRESET))
	check('不再设假设数量下限(0.5.2:至少两条候选催生了凑数的候选)', !/minHypotheses/.test(PRESET))
}

console.log('\n【② 交还宿主的那几件真的不在了】')
{
	const mechanisms = PRESET.slice(PRESET.indexOf('      mechanisms:'), PRESET.indexOf('\n\n', PRESET.indexOf('      mechanisms:')))
	check('机制开关只剩目标与计划(世界线 / 侦察 / 外脑 / 账本都删了)', /goal: true/.test(mechanisms) && /plan: true/.test(mechanisms) && !/worldline|scout|brain|ledger/.test(mechanisms), mechanisms.replace(/\n/g, ' '))
	check('外脑插件不再挂载', !/plugins\/brain\.js/.test(PRESET))
	check('原生技能目录与 skill 工具仍在(技能交给宿主)', /@deepseek-ai\/dsh-skill-filesystem/.test(PRESET) && /@deepseek-ai\/dsh-tool-skill/.test(PRESET))
	check('原生 present 仍在(交付卡片交给宿主)', /@deepseek-ai\/dsh-tool-present/.test(PRESET))
}

console.log('\n【③ PTC 变体:派生正确、dsh-ops 可选】')
{
	/**
	 * 声明行只出现在**生成物**里(pack/presets/clearai.patch.yml 由构建期派生,随包发行),
	 * 所以这几条断言读生成物,不读 `preset/agent.cordis.yml`;生成物与源同步由
	 * `tools/verify-package.mjs` 现场重建比对来保证。
	 */
	const DECLARATION = readFileSync(join(PORT, 'pack', 'presets', 'clearai.patch.yml'), 'utf8')
	/** 一条声明行到下一个声明行之间的内容(声明行 4 格,插件行 10 格)。 */
	const block = (id) => {
		const start = DECLARATION.indexOf(`    - id: ${id}\n`)
		if (start < 0) return ''
		const end = DECLARATION.indexOf('\n    - id: ', start + 1)
		return DECLARATION.slice(start, end < 0 ? undefined : end)
	}
	const pluginIds = (text) => [...text.matchAll(/^ {10}- id: ([A-Za-z0-9-]+)$/gm)].map((match) => match[1])
	const main = block('preset-clearai')
	const ptc = block('preset-clearai-ptc')

	check('名册里有三条声明行:ClearAI / ClearAI PTC / 评估者', ['preset-clearai', 'preset-clearai-ptc', 'preset-clearai-evaluator'].every((id) => DECLARATION.includes(`    - id: ${id}\n`)))
	check('PTC 预设用独立 id,不改宿主内置的 ptc', /^ {8}id: clearai-ptc$/m.test(ptc) && !/^ {8}id: ptc$/m.test(ptc))
	check('PTC 预设挂 tool-presentation 且 mode: ptc(宿主按这一行收成 SDK)', /^ {10}- id: tool-presentation$/m.test(ptc) && /^ {12}name: '@deepseek-ai\/dsh-agent-tool-presentation'$/m.test(ptc) && /^ {14}mode: ptc$/m.test(ptc))
	check('主预设没有 PTC 呈现行(标准模式照旧是原生工具面)', !/dsh-agent-tool-presentation/.test(main))

	const mainIds = pluginIds(main)
	const ptcIds = pluginIds(ptc)
	const extra = ptcIds.filter((id) => !mainIds.includes(id)).sort()
	const missing = mainIds.filter((id) => !ptcIds.includes(id)).sort()
	check('PTC 变体只多一组 dsh-ops realm 与呈现行(组内的两行按嵌套缩进单独断言)', JSON.stringify(extra) === JSON.stringify(['dsh-ops', 'tool-presentation']), JSON.stringify(extra))
	check('dsh-ops realm 里就是 PTC 与 shell 两个组件', ptc.indexOf('- id: dsh-ops-ptc') < ptc.indexOf('- id: dsh-ops-shell') && (ptc.match(/- id: dsh-ops-ptc/g) ?? []).length === 1 && (ptc.match(/- id: dsh-ops-shell/g) ?? []).length === 1)
	check('PTC 变体一行不少(权威行与工作方式都照旧)', missing.length === 0, JSON.stringify(missing))
	check('两条声明都没有重复的插件行 id(重复 id 会让加载器静默只认一个)', new Set(mainIds).size === mainIds.length && new Set(ptcIds).size === ptcIds.length)
	check('tool-workflow 在 PTC 变体里关掉(run_code 就是编排面)', /^ {14}- id: tool-workflow\n^ {16}disabled: true$/m.test(ptc))
	check('主预设的 tool-workflow 仍开着(标准模式的工作方式不变)', !/^ {14}- id: tool-workflow\n^ {16}disabled: true$/m.test(main))
	check('PTC 变体保留内核与实体门(变的是呈现,不是认识论)', /clearai-kernel/.test(ptc) && /requireLandedEntities: true/.test(ptc))

	check('dsh-ops 的两行都带可解析检查(没装就跳过,预设照常可用)', /dsh-ops\/ptc[\s\S]*?disabled: !!js/.test(ptc) && /dsh-ops\/shell[\s\S]*?disabled: !!js/.test(ptc))
	check('检查的基准是文件 URL(目录 URL 会多走一层 node_modules)', /new URL\('__installed__\.js', baseUrl\)/.test(ptc))
	check('dsh-ops PTC 行允许 native worker 缺席(不因可选依赖让整份预设起不来)', /^ {18}required: false$/m.test(ptc))
	check('声明行里没有未知的 {{…}} 模板变量(未知变量会让整轮抛错,issue #34)', [...DECLARATION.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n').matchAll(/\{\{([^{}]*)\}\}/g)].every((match) => match[1] === 'model' || match[1] === 'cwd'))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
