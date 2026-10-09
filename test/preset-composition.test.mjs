/**
 * 预设组合:挂载表的契约。
 *
 * 钉两件事:
 *   ① 原生工作方式真的挂回来了(tool-todo / subagent / workflow / ralph),
 *      而两套「第二本账」(tool-goal / command-goal / plan-mode)仍然不在;
 *   ② 交还宿主的那几件真的不在了(自带的 `/` 命令、外脑、世界线 / 侦察 / 账本机制开关)。
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

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
