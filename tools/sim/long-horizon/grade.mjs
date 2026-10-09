/**
 * 盲评说明:按答案打分,ClearAI 组与裸模型组用同一份说明。
 *
 *   node tools/sim/long-horizon/grade.mjs <答案目录名> <运行目录> [会话说明]
 *     答案目录名:math | reactor | factory | battery | binpack | cell
 *   → <运行目录>/grade-brief.md;评分子代理读它,把 JSON 写进 <运行目录>/grade.json
 *
 * 盲:评分者只拿到最后的答复(<运行目录>/final-reply.md)与交付目录里的文件,
 * 不给 clear/ 与 .agents/,免得认出是哪一组。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deliverableFiles } from './scenarios.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const [key, runArg, session = ''] = process.argv.slice(2)
if (key === undefined || runArg === undefined) {
	console.error('用法:node grade.mjs <math|reactor|factory|battery|binpack|cell|site-s1|site-s2|site-s3|loop-a1|loop-a2|loop-b1|loop-a3> <运行目录> [会话说明]')
	process.exit(2)
}
const runDir = resolve(runArg)
const workspace = String(JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')).workspace)
/** 现场序列的三题共用一个目录:`site-s1|s2|s3`。 */
const site = /^site-(s[123])$/.exec(key)
/** 0.5.2 闭环序列四题:`loop-a1|a2|b1|a3`,同一工作区,按各题的目录取产物。 */
const loop = /^loop-(a1|a2|b1|a3)$/.exec(key)
const LOOP_LINE = { a1: 'a-line', a2: 'a-line-batch2', b1: 'b-line', a3: 'a-line-drop' }
const answer = readFileSync(loop !== null ? join(HERE, 'loop', `answer-${loop[1]}.md`) : site === null ? join(HERE, key, 'answer-key.md') : join(HERE, 'site', `answer-${site[1]}.md`), 'utf8')
const reply = existsSync(join(runDir, 'final-reply.md')) ? readFileSync(join(runDir, 'final-reply.md'), 'utf8') : '(没有最后的答复)'
const SITE_LINE = { s1: 'a-line', s2: 'b-line', s3: 'c-line' }
/** 三题共用工作区:只给这一题的产物。 */
const files = deliverableFiles(workspace).filter((file) => (loop !== null ? file.includes(`/${LOOP_LINE[loop[1]]}/`) || file.endsWith(`/${LOOP_LINE[loop[1]]}.md`) : site === null || file.includes(`/${SITE_LINE[site[1]]}`)))
const extra =
	loop !== null
		? `\n真实响应面在 \`${join(HERE, 'loop', 'surface.mjs')}\`(\`VARIANTS.${loop[1]}.truth({...})\`,装置的漂移在 \`VARIANTS.${loop[1]}.drift\`:第 after 次之后实际温度 = 设定 − delta),实验记录在 \`${join(runDir, 'rig-state.json')}\`。把交出的配方按实际温度代入算真值。`
		: site !== null
		? `\n真实响应面在 \`${join(HERE, 'site', 'surface.mjs')}\`(\`VARIANTS.${site[1]}.truth({...})\`),实验记录在 \`${join(runDir, 'rig-state.json')}\`。把交出的配方按实际温度代入算真值。`
		: key === 'reactor'
		? `\n反应器的真实响应面在 \`${join(HERE, 'reactor', 'surface.mjs')}\`(\`truth({T,P,cat,t})\`),实验记录在 \`${join(runDir, 'reactor-state.json')}\`。把交出的配方按实际温度代入算真值。`
		: key === 'cell'
			? `\n真实响应在 \`${join(HERE, 'cell', 'surface.mjs')}\`(\`truth({c,a,b,Tf}).life\` 是真实寿命),测试记录在 \`${join(runDir, 'cell-state.json')}\`。把交出的配方代入算真实寿命。`
		: key === 'binpack'
			? `\n每个实例的最优值与 FFD 箱数:用 \`node ${join(HERE, 'binpack', 'gen.mjs')} <临时目录> set-a 7\`(或 set-b 11)生成 answers.json。要核对报告里的数字,可以运行交付里的代码。`
			: ''

writeFileSync(
	join(runDir, 'grade-brief.md'),
	`# 你是盲评者

一个研究助理做完了一项任务。你按下面的答案给它的结论打分。你不知道它用的是什么工具或框架,也不要猜。
${session === '' ? '' : `\n这次只评:${session}\n`}
## 答案
${answer}
${extra}

## 它最后的答复

${reply}

## 它交出的文件(只读;可以运行其中的脚本核对数字,不要改)

${files.map((file) => `- \`${file}\``).join('\n') || '(无)'}

## 怎么打分

逐条对照答案。每一条给:它的结论、得分(按答案里的计分规则)、是否「错而自信」(把假的或未知的说成已核实 / 已证明,或数字与可复查的结果对不上却说已验证)、一句理由。
最后把下面这个 JSON 写进 \`${join(runDir, 'grade.json')}\`(只写这一个文件),并在最后一条消息里复述它:

\`\`\`json
{"items":[{"id":"1","claimed":"…","score":1,"overconfident":false,"why":"…"}],"total":0,"max":0,"overconfident":0,"notes":"…"}
\`\`\`
`,
)
console.log(join(runDir, 'grade-brief.md'))
