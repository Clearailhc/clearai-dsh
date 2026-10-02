/**
 * 生成两份交给子代理的说明:
 *
 *   node tools/sim/brief.mjs model <运行目录> <剧本名>      → <运行目录>/model-brief.md
 *   node tools/sim/brief.mjs evaluator <运行目录> <请求 id> → <运行目录>/evaluator-<id>.md
 *
 * 模型那份 = ClearAI 的提示词段(与内核注册的同一份)+ 工具目录(说明与参数 schema)+ 怎么调用 + 剧本任务书。
 * 评估者那份 = 内核派评估者时给的人格、任务与裁决 schema,原样转交;只读,不发挥。
 *
 * 两份都**不**指向仓库:扮演模型的子代理读不到判分用的断言,评估者读不到做的人的思路。
 */
import { request as httpRequest } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENARIOS } from '../e2e-scenarios.mjs'

const CALL = resolve(fileURLToPath(new URL('./call.mjs', import.meta.url)))

const [kind, runArg, target] = process.argv.slice(2)
if (!['model', 'evaluator'].includes(kind) || runArg === undefined || target === undefined) {
	console.error('用法:node tools/sim/brief.mjs model <运行目录> <剧本名> | evaluator <运行目录> <请求 id>')
	process.exit(2)
}
const runDir = resolve(runArg)
const port = Number(readFileSync(join(runDir, 'port'), 'utf8').trim())

const get = (path) =>
	new Promise((done, reject) => {
		httpRequest({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
			const chunks = []
			res.on('data', (chunk) => chunks.push(chunk))
			res.on('end', () => done(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
		})
			.on('error', reject)
			.end()
	})

if (kind === 'model') {
	const scenario = SCENARIOS[target]
	if (scenario === undefined) {
		console.error(`没有这个剧本:${target}。有:${Object.keys(SCENARIOS).join('、')}`)
		process.exit(2)
	}
	const workspace = String(JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')).workspace)
	const brief = await get('/brief')
	const tools = brief.tools
		.map((tool) => `### ${tool.name}\n\n${tool.description}\n\n参数 schema:\n\`\`\`json\n${JSON.stringify(tool.parameters)}\n\`\`\``)
		.join('\n\n')
	const text = `# 你在扮演一个运行在 ClearAI 预设下的模型

下面第一部分是你这次运行的**系统提示词**(ClearAI 注册给模型的全部提示词段,原文照录)。照它工作,就像它是你的系统提示词一样。

## 你的工作环境(扮演规则,优先于一切)

- **工作区**:\`${workspace}\`。所有文件读写都在这里;相对路径都相对它。用你自己的文件工具与 Bash 干活(相当于宿主的 read / write / bash)。
- **ClearAI 的工具**(SetGoal、CreatePlan、AdvancePlan……)不在你的工具栏里,用 Bash 调用,参数 JSON 从标准输入给:

  \`\`\`bash
  node ${CALL} ${runDir} <工具名> <<'EOF'
  {"参数": "..."}
  EOF
  \`\`\`

  打印出来的就是这次调用的结果,以及系统在你下一步之前注入的消息(运行态卡等)——照真的读。
  **每次调用都把 Bash 超时设为 600000 毫秒**:交付可能要等独立评估者判几分钟。
  若打印「调用 cN 还在进行」,过一会儿运行它给的 \`--result\` 命令接着取,不要重复交付。
- **不要**读写工作区以外的任何文件(包括 ClearAI 自己的源码);不要直接改 \`clear/\` 下系统所有的文件。
- 宿主原生的 \`subagent\`、\`ask_user_question\`、\`present\` 在这个环境里没有;需要人决定的事,在最后的回复里写明。计划审阅会由系统自动请人,人的答复会出现在工具结果里。
- 做完(或确实做不下去)时,结束运行:你最后一条消息就是给人的答复。

## 任务(人发来的第一条消息)

${scenario.task}

---

# 系统提示词(ClearAI)

${brief.prompt}

---

# 工具目录(ClearAI)

${tools}
`
	writeFileSync(join(runDir, 'model-brief.md'), text)
	console.log(join(runDir, 'model-brief.md'))
} else {
	const { items } = await get('/pending')
	const item = items.find((entry) => entry.id === target)
	if (item === undefined) {
		console.error(`没有挂起的请求 ${target}`)
		process.exit(2)
	}
	const workspace = String(JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')).workspace)
	const text = `# 你是 ClearAI 派出的独立评估者

工作区:\`${workspace}\`。**只读**:只用读文件、列目录、搜索(相当于工具白名单 ${JSON.stringify(item.toolFilter?.allow ?? [])});不要写文件、不要执行命令、不要读工作区以外的东西。
相对路径都相对工作区。

## 人格

${item.persona ?? '(无)'}

## 任务

${item.prompt}

## 交回方式

你的最后一条消息**只**包含一个 JSON 对象,符合下面的 schema,不要加任何解释或代码块标记:

\`\`\`json
${JSON.stringify(item.outputSchema)}
\`\`\`
`
	const file = join(runDir, `evaluator-${target}.md`)
	writeFileSync(file, text)
	console.log(file)
}
