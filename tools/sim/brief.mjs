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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENARIOS } from '../e2e-scenarios.mjs'
import { LONG_HORIZON } from './long-horizon/scenarios.mjs'

const CALL = resolve(fileURLToPath(new URL('./call.mjs', import.meta.url)))

const [kind, runArg, target] = process.argv.slice(2)
if (!['model', 'evaluator', 'bare'].includes(kind) || runArg === undefined || target === undefined) {
	console.error('用法:node tools/sim/brief.mjs model <运行目录> <剧本名> | evaluator <运行目录> <请求 id> | bare <运行目录> <剧本名> <工作区>')
	process.exit(2)
}
const runDir = resolve(runArg)
/** 剧本:短测剧本与长程剧本(`long-horizon/scenarios.mjs`)同一个名字空间。 */
const scenarioOf = (name) => SCENARIOS[name] ?? LONG_HORIZON[name]
/** 长程剧本的任务书是函数(要知道运行目录);准备数据也在生成说明时做。 */
const taskOf = (scenario, workspace, field = 'task') => {
	const task = scenario[field] ?? scenario.task
	return typeof task === 'function' ? task({ runDir, workspace }) : task
}

if (kind === 'bare') {
	// 对照组:同一份任务书,不装 ClearAI,不起模拟宿主。
	const scenario = scenarioOf(target)
	const workspace = resolve(process.argv[5] ?? join(runDir, 'ws'))
	if (scenario === undefined) {
		console.error(`没有这个剧本:${target}`)
		process.exit(2)
	}
	mkdirSync(workspace, { recursive: true })
	writeFileSync(join(runDir, 'meta.json'), JSON.stringify({ workspace, scenario: target, bare: true }))
	scenario.setup?.({ runDir, workspace })
	const text = `# 任务

- **工作区**:\`${workspace}\`。所有文件读写都在这里;相对路径都相对它。用你自己的文件工具与 Bash 干活。
- **网络**:要查资料就用你自己的网页搜索与抓取工具;被挡住就换来源,并如实写明出处。
- **不要**读写工作区以外的任何文件(任务书里明确给出的命令除外)。
- 没有人能中途回答你的问题;需要人决定的事,在最后的回复里写明。
- 做完(或确实做不下去)时结束运行:你最后一条消息就是给人的答复。

## 人发来的第一条消息

${taskOf(scenario, workspace, 'bareTask')}
`
	writeFileSync(join(runDir, 'bare-brief.md'), text)
	console.log(join(runDir, 'bare-brief.md'))
	process.exit(0)
}
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
	const scenario = scenarioOf(target)
	if (scenario === undefined) {
		console.error(`没有这个剧本:${target}。有:${[...Object.keys(SCENARIOS), ...Object.keys(LONG_HORIZON)].join('、')}`)
		process.exit(2)
	}
	const workspace = String(JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')).workspace)
	scenario.setup?.({ runDir, workspace })
	const brief = await get('/brief')
	const tools = brief.tools
		.map((tool) => `### ${tool.name}\n\n${tool.description}\n\n参数 schema:\n\`\`\`json\n${JSON.stringify(tool.parameters)}\n\`\`\``)
		.join('\n\n')
	const text = `# 你在扮演一个运行在 ClearAI 预设下的模型

下面第一部分是你这次运行的**系统提示词**(ClearAI 注册给模型的全部提示词段,原文照录)。照它工作,就像它是你的系统提示词一样。

## 你的工作环境(扮演规则,优先于一切)

- **工作区**:\`${workspace}\`。所有文件读写都在这里;相对路径都相对它。用你自己的文件工具与 Bash 干活(相当于宿主的 read / write / bash)。
- **网络**:要查资料就用你自己的网页搜索与抓取工具(相当于宿主的网络工具);有的站点会被网络策略挡住,挡住了就换来源,并在依据里如实写明出处。
- **ClearAI 的工具**(Frame、CreatePlan、AdvancePlan、Conclude……)不在你的工具栏里,用 Bash 调用,参数 JSON 从标准输入给:

  \`\`\`bash
  node ${CALL} ${runDir} <工具名> <<'EOF'
  {"参数": "..."}
  EOF
  \`\`\`

  打印出来的就是这次调用的结果,以及系统在你下一步之前注入的消息(运行态卡等)——照真的读。
  **每次调用都把 Bash 超时设为 600000 毫秒**:交付可能要等独立评估者判几分钟。
  若打印「调用 cN 还在进行」,过一会儿运行它给的 \`--result\` 命令接着取,不要重复交付。
- **本体文件**(\`clear/ontology/concepts|relations|entities/\` 下的 \`.json\`)要用**宿主的原生 write / edit** 写——它们在这里也走 call.mjs,参数与宿主同形,写之前系统会校验:

  \`\`\`bash
  node ${CALL} ${runDir} write <<'EOF'
  {"file_path": "clear/ontology/concepts/xxx.json", "content": "{...JSON 文本...}"}
  EOF
  node ${CALL} ${runDir} edit <<'EOF'
  {"file_path": "clear/ontology/concepts/xxx.json", "old_string": "...", "new_string": "..."}
  EOF
  \`\`\`

  读它们(以及 \`clear/\` 下的其他文件)用你自己的工具就行。
- **不要**读写工作区以外的任何文件(包括 ClearAI 自己的源码);不要直接改 \`clear/\` 下系统所有的文件(本体那三个目录除外,且只经上面的 write / edit)。
- 宿主原生的 \`subagent\`、\`ask_user_question\`、\`present\`、\`update_goal\`、\`/plan\` 在这个环境里没有;需要人决定的事,在最后的回复里写明。系统自己要问人的时候(L4 放行、计划卡住、事实被推翻)会当场问,人的答复出现在那次工具结果里。
- 做完(或确实做不下去)时,结束运行:你最后一条消息就是给人的答复。

## 任务(人发来的第一条消息)

${taskOf(scenario, workspace)}

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

工作区:\`${workspace}\`。${(item.toolFilter?.allow ?? []).includes('bash') ? `**原工作区只读**:可以读文件、列目录、搜索(相当于工具白名单 ${JSON.stringify(item.toolFilter.allow)});要复跑脚本,只在任务里给的副本目录里用 Bash 运行,不要在原工作区写文件或运行命令。` : `**只读**:只用读文件、列目录、搜索(相当于工具白名单 ${JSON.stringify(item.toolFilter?.allow ?? [])});不要写文件、不要执行命令、不要读工作区以外的东西。`}
相对路径都相对工作区。

## 人格

${item.persona ?? '(无)'}

## 任务

${item.prompt}

## 交回方式

裁决是一个 JSON 对象,符合下面的 schema:

\`\`\`json
${JSON.stringify(item.outputSchema)}
\`\`\`

判完之后,用这条命令把裁决交回(它只把裁决交给系统,不碰工作区):

\`\`\`bash
node ${CALL} ${runDir} --settle ${target} <<'EOF'
{"structured": <你的裁决 JSON>}
EOF
\`\`\`

看到 \`{"ok":true}\` 就结束;你的最后一条消息复述那个 JSON 即可。
`
	const file = join(runDir, `evaluator-${target}.md`)
	writeFileSync(file, text)
	console.log(file)
}
