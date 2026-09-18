import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
	Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
	ShadingType, PageNumber, PageBreak,
} from 'docx'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const D = join(ROOT, 'docs')

// ── 图片尺寸读取(PNG IHDR) ─────────────────────────────────────────────
function pngSize(p) {
	const b = readFileSync(p)
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), buf: b }
}

// ── 样式常量 ───────────────────────────────────────────────────────────
const FONT = 'PingFang SC'
const INK = '1C1A18'
const ACCENT = '2E75B6'
const MUTED = '6B6862'
const CODE_BG = 'F5F4F0'
const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'DDD9D3' }
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
// US Letter with 0.8" margins → content width = 12240 - 2304 = 9936 DXA
const CW = 9936

// ── 构建器工具 ─────────────────────────────────────────────────────────
const t = (text, opts = {}) => new TextRun({ text, font: FONT, size: 22, color: INK, ...opts })
const bold = (text) => t(text, { bold: true })
const muted = (text) => t(text, { color: MUTED, size: 20 })
const accent = (text) => t(text, { color: ACCENT, bold: true })

const para = (content, opts = {}) => {
	const kids = typeof content === 'string' ? [t(content)] : Array.isArray(content) ? content : [content]
	return new Paragraph({ children: kids, spacing: { after: 160, line: 340 }, ...opts })
}

const h2 = (text) =>
	new Paragraph({
		heading: HeadingLevel.HEADING_2,
		spacing: { before: 400, after: 200 },
		children: [t(text, { bold: true, size: 30, color: INK })],
		border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT, space: 4 } },
	})

const h3 = (text) =>
	new Paragraph({
		heading: HeadingLevel.HEADING_3,
		spacing: { before: 300, after: 140 },
		children: [t(text, { bold: true, size: 25, color: INK })],
	})

const code = (lines) =>
	lines.map((line) =>
		new Paragraph({
			spacing: { after: 0, line: 280 },
			shading: { fill: CODE_BG, type: ShadingType.CLEAR },
		 indent: { left: 360, right: 360 },
			children: [t(line, { font: 'SF Mono', size: 18, color: '333333' })],
		}),
	)
	const codeBlock = (lines) => {
		const paras = code(lines)
		// 前后加空行做间距
		return [
			new Paragraph({ spacing: { after: 60 }, shading: { fill: CODE_BG, type: ShadingType.CLEAR }, indent: { left: 360, right: 360 }, children: [] }),
			...paras,
			new Paragraph({ spacing: { after: 160 }, shading: { fill: CODE_BG, type: ShadingType.CLEAR }, indent: { left: 360, right: 360 }, children: [] }),
		]
	}

const quote = (children) =>
	new Paragraph({
		children: Array.isArray(children) ? children : [children],
		spacing: { before: 120, after: 160 },
	 indent: { left: 480 },
		border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } },
	})

const img = (path, maxW = 920) => {
	const { w, h, buf } = pngSize(join(ROOT, path))
	const scale = Math.min(1, maxW / w)
	const iw = Math.round(w * scale)
	const ih = Math.round(h * scale)
	return new Paragraph({
		alignment: AlignmentType.CENTER,
		spacing: { before: 200, after: 80 },
		children: [new ImageRun({ type: 'png', data: buf, transformation: { width: iw / 9525, height: ih / 9525 }, altText: { title: path, description: path, name: path } })],
	})
}
const caption = (text) =>
	new Paragraph({
		alignment: AlignmentType.CENTER,
		spacing: { after: 240 },
		children: [muted(text)],
	})

const cell = (children, width, opts = {}) =>
	new TableCell({
		borders: BORDERS,
		width: { size: width, type: WidthType.DXA },
		margins: { top: 60, bottom: 60, left: 100, right: 100 },
		...opts,
		children: Array.isArray(children) ? children : [children],
	})

const table = (rows, widths) =>
	new Table({
		width: { size: CW, type: WidthType.DXA },
		columnWidths: widths,
		rows,
	})

const headerRow = (labels, widths) =>
	new TableRow({
		children: labels.map((label, i) =>
			cell(new Paragraph({ children: [bold(label)] }), widths[i], { shading: { fill: 'EAF1F8', type: ShadingType.CLEAR } }),
		),
	})

const dataRow = (cells, widths) =>
	new TableRow({
		children: cells.map((c, i) => cell(new Paragraph({ children: Array.isArray(c) ? c : [t(c)] }), widths[i])),
	})

const bullet = (children, level = 0) =>
	new Paragraph({
		bullet: { level },
		spacing: { after: 100, line: 320 },
		children: Array.isArray(children) ? children : [children],
	})

const hr = () =>
	new Paragraph({
		spacing: { before: 200, after: 200 },
		border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DDD9D3', space: 1 } },
		children: [],
	})

const pageBreak = () => new Paragraph({ children: [new PageBreak()] })

// ── 文档 ───────────────────────────────────────────────────────────────
const children = []

// 封面区域
children.push(
	new Paragraph({ spacing: { before: 1200, after: 100 }, children: [] }),
	new Paragraph({
		alignment: AlignmentType.CENTER,
		spacing: { after: 120 },
		children: [t('clearai-dsh', { bold: true, size: 52, color: INK })],
	}),
	new Paragraph({
		alignment: AlignmentType.CENTER,
		spacing: { after: 200 },
		children: [t('在 DeepSeek Harness 上走通可信本体的构建路径', { size: 32, color: MUTED })],
	}),
	new Paragraph({
		alignment: AlignmentType.CENTER,
		spacing: { after: 400 },
		children: [muted('认识论是路径 · 本体是终点 · 每条边都要挣得它的位置')],
	}),
	img('docs/diagrams/ontology-hero.zh-CN.png', 880),
	caption('认识论循环（左）长出领域本体（右）——绿点是循环落定的事实，也是本体的第一个节点'),
	img('brand/logo-lockup.png', 320),
	new Paragraph({
		alignment: AlignmentType.CENTER,
		spacing: { before: 200, after: 100 },
		children: [
			muted('15 套件 1372 条断言 · 29 个意图工具 · 6694 行内核 · Apache-2.0'),
		],
	}),
	new Paragraph({
		alignment: AlignmentType.CENTER,
		children: [accent('npx clearai-dsh install')],
	}),
	pageBreak(),
)

// ══════════════════════════════════════════════════════════════════════
// 第 1 节：我们在解决什么问题
// ══════════════════════════════════════════════════════════════════════
children.push(h2('1、我们在解决什么问题'))

children.push(para('用 AI Agent 做过正经研究的人大概都撞过这堵墙。'))
children.push(para('你让模型调研一个技术选型，它给你一份漂亮的分析。有结构、有数据、有结论。你读完觉得有道理，准备拿去汇报。'))
children.push(para([t('然后有人问：'), bold('"这个结论怎么验证的？证据在哪？"')]))
children.push(para('你翻聊天记录。证据散落在十几轮对话里，有的在工具输出里，有的在模型自己的推理链里，有的根本没有。你甚至不确定模型是推理出来的还是编出来的。'))
children.push(para([
	t('这件事的本质：'),
	bold('Agent 架构里没有一个地方存放"这个结论凭什么成立"。'),
	t('聊天记录不存这个，向量数据库不存这个，LangGraph 的 state graph 也不存这个。'),
]))
children.push(para([
	t('同时，你希望研究产出能'),
	bold('积累'),
	t('——今天做完的调研，明天换一个人还能接着用。积累需要一个结构化的形态。'),
]))
children.push(para([
	t('我们的判断：这个形态是'),
	bold('领域本体'),
	t('（domain ontology），而让本体里的每条边都可信的那套工艺是'),
	bold('认识论循环'),
	t('（epistemic loop）。ClearAI 把两者做成了一个 DSH 插件：'),
]))
children.push(quote([
	bold('AI 在你的项目里长出一个活的领域本体，每条边都通过验证循环挣得它的位置。'),
]))

// ══════════════════════════════════════════════════════════════════════
// 第 2 节：本体是终点，认识论是到达终点的路
// ══════════════════════════════════════════════════════════════════════
children.push(h2('2、本体是终点，认识论是到达终点的路'))
children.push(para('两个词经常被混着用，先把关系说清楚。'))
children.push(para([
	bold('本体论'),
	t('（ontology）回答的问题是：这个世界有哪些类的东西？它们之间有什么关系？在工程语境里，本体的产出是'),
	bold('一组概念、一组谓词、一组实例和它们之间的关系'),
	t('——一个结构化的知识库。'),
]))
children.push(para([
	bold('认识论'),
	t('（epistemology）回答的问题是：一个信念凭什么算知识？证据怎么支持结论？在工程语境里，认识论的产出是'),
	bold('一套验证机制'),
	t('——判据怎么登记、证据怎么分级、结论怎么裁决。'),
]))
children.push(para('两者的关系用一个比喻：'))
children.push(bullet([bold('本体是房子'), t('——你要住的地方，最终交付的东西。')]))
children.push(bullet([bold('认识论是施工规范'), t('——地基怎么打、钢筋怎么焊、验收怎么做。')]))
children.push(para('没有施工规范的房子也能盖起来，看起来像模像样。但你敢住吗？'))
children.push(para([
	t('市面上绝大多数"AI + 知识图谱"的做法是：让 LLM 从文本里抽取实体和关系，直接画到图上。这相当于'),
	bold('让一个没有资质的承包商凭感觉盖房子'),
	t('。速度很快，外观很漂亮，但你不知道墙里有没有钢筋。'),
]))
children.push(para('ClearAI 的做法：每一块砖（每一条断言）都要过验收（验证循环），验收记录（证据链）跟着砖走，房子盖完时每面墙都可以追溯到验收单。'))
children.push(para([bold('本体是交付物，认识论是质量体系。缺了质量体系的交付物，不敢用。')]))

// ══════════════════════════════════════════════════════════════════════
// 第 3 节：可信本体的三条判据
// ══════════════════════════════════════════════════════════════════════
children.push(h2('3、可信本体的三条判据'))
children.push(para('一个本体要配得上"可信"这两个字，至少满足三条：'))
children.push(para([bold('① 每条边有出处。'), t(' 这条断言"铸锭的氧含量是 10 ppm"——谁测的？怎么测的？在哪条证据链上？没有出处的边和编造的边没有区别。')]))
children.push(para([bold('② 矛盾能被自动发现。'), t(' 两条已确认的事实挂在同一个单值谓词、同一个主体、不同取值上——数学上不可能同时为真——系统必须自动报出来。')]))
children.push(para([bold('③ 状态可以回放到零。'), t(' 从当前的完整状态出发，能一步步还原回最初的事件流。每一条边的诞生过程都可审计。')]))
children.push(para('ClearAI 的全部架构都在为这三条服务。'))

// ══════════════════════════════════════════════════════════════════════
// 第 4 节：本体的形态
// ══════════════════════════════════════════════════════════════════════
children.push(h2('4、本体的形态：词汇先于句子'))
children.push(para([t('一个可信本体的地基是'), bold('领域语言'), t('——先定好用什么词，再用这些词说话。')]))

children.push(h3('概念与谓词'))
children.push(...codeBlock([
	'RegisterTerm({',
	'  id: "ingot",',
	'  label: "铸锭",',
	'  gloss: "立式半连续铸造产出的单根金属锭",',
	'  basis: "工艺手册第 6.1 节"       // ← 必填：这个词的出处',
	'})',
	'',
	'RegisterPredicate({',
	'  id: "oxygen_ppm",',
	'  label: "氧含量检测值",',
	'  domain: "ingot",                  // 主词域',
	'  range: { form: "quantity", unit: "ppm" },',
	'  functional: true,                 // ← 单值：同一铸锭只有一个读数',
	'  basis: "ASTM E2575"',
	'})',
]))
children.push(para([
	t('注意 '),
	accent('functional: true'),
	t('。这是本体工程里的经典约束（描述逻辑里叫 functional property）：'),
	bold('同一主体只能有一个取值'),
	t('。它的作用马上会看到——冲突检测靠它。'),
]))
children.push(para('每条词汇带 basis 登记。没有依据不收。修订留版本（旧值不删）。废止写原因（黏性废止，没有删除操作）。语义变化必须换 id。'))
children.push(para([t('这是本体工程的底线：'), bold('如果一个词的含义可以随时变，建立在它之上的所有断言都是沙上城堡。')]))

children.push(h3('类型化断言'))
children.push(...codeBlock([
	'{',
	'  predicate: "oxygen_ppm",',
	'  subject:   { id: "INGOT-3", type: "ingot" },',
	'  object:    { kind: "quantity", value: 10, unit: "ppm" }',
	'}',
]))
children.push(para('值形态有五种，每种有明确的工程语义：'))
children.push(table([
	headerRow(['形态', '含义', '工程价值'], [1800, 3600, 4536]),
	dataRow(['statement', '一句可验证的陈述', '最低门槛的结构化'], [1800, 3600, 4536]),
	dataRow(['quantity', '数值 + 单位', '可比较、可检冲突'], [1800, 3600, 4536]),
	dataRow(['formula', '指向可重跑的公式文件', '可复现'], [1800, 3600, 4536]),
	dataRow(['code', '指向可执行的代码', '可执行验证'], [1800, 3600, 4536]),
	dataRow(['reference', '指向外部来源（DOI / 标准号）', '可追溯'], [1800, 3600, 4536]),
], [1800, 3600, 4536]))
children.push(para(''))

children.push(h3('两张图'))
children.push(para([bold('本体图'), t('：概念是节点，is_a 和谓词是边。回答"这个领域允许表达什么"。它可以在零事实的状态下存在——先立词，再提假设。语言先于句子。')]))
children.push(para([bold('实体图'), t('：实例是节点，断言是边，每条边带支持等级。回答"已经验证出了什么"。它只在事实升格后才有内容。挣得多少，画多少。')]))
children.push(para('两张图都是纯函数投影——从事件流算出来的。改不了，也不用同步。'))
children.push(img('docs/shots/zh/facts.png', 660))
children.push(caption('本体格：图带（本体图|实体图切换）+ 本体货架（已确立条目，每条带断言芯片与冲突标记）+ 命题'))

// 循环主图
children.push(img('docs/diagrams/epistemic-loop-hero.zh-CN.png', 880))
children.push(caption('认识论循环的读数面：L0–L4 等级轴、事先登记的阈值虚线、五个带误差棒的观测——被支持的填实、被推翻的留在原位打斜杠'))

// ══════════════════════════════════════════════════════════════════════
// 第 5 节：认识论
// ══════════════════════════════════════════════════════════════════════
children.push(h2('5、认识论：让每条边"挣"到位置的那套工艺'))
children.push(img('docs/shots/zh/worldlines.png', 620))
children.push(caption('世界树：计划的拓扑与闸门——脊柱步、叉开的车道、收敛点、要你拍板的那一下'))
children.push(para([t('认识论循环在 ClearAI 里'), bold('不是流程图，是写进工具 schema 的强制约束'), t('。')]))

children.push(h3('判据先行（Pre-registration）'))
children.push(...codeBlock([
	'SetGoal({',
	'  claim: "催化剂 A 的转化率优于 B",',
	'  refute_when: "复测显示 A 的转化率低于 B",    // ← 必填',
	'  done_criteria: "三次独立实验的均值差 > 5%",   // ← 必填',
	'  promote_at_level: "L3"                        // ← 至少过独立评估',
	'})',
]))
children.push(para('refute_when 不填，schema 拒绝。你无法在看到结果之后再编一个恰好命中的判据。'))
children.push(para('在科学方法论里这叫 pre-registration，是防 HARKing 的金标准。临床试验、心理学预注册——凡是出过"可重复性危机"的领域，最后都走到这一步。'))

children.push(h3('模型没有"宣告完成"的字段'))
children.push(para('29 个意图工具里，没有任何一个接受 status: "done" 之类的参数。推进只经 AdvancePlan，它需要 evidenceId——指向一条已落盘的证据。'))
children.push(para([t('效果：'), bold('模型没法"说它做完了"'), t('。要么交出证据，要么那步就还开着。')]))

children.push(h3('高等级不能自判'))
children.push(para([t('结论分五级（L0–L4）。'), bold('L3 以上必须有独立评估者'), t('——一个 fresh-context 子会话，只有只读工具面，看不到做这件事的模型的推理过程。做的人不判自己。')]))
children.push(para('这在认识论里叫 inter-rater reliability。ClearAI 的实现：每个 L3+ 步骤自动派遣评估者子代理，它的裁决落在自己的证据链上。'))

children.push(h3('证伪保留'))
children.push(para('推翻 ≠ 删除。被推翻的假设留在原位，标"已推翻"，连同推翻它的证据一起展示。'))
children.push(para([t('波普尔说一个理论的价值在于它能被证伪。ClearAI 的实现：'), bold('证伪了的结论也是知识'), t('——"哪条路不通"和"哪条路通"同样有价值。它们都留在本体里。')]))

// ══════════════════════════════════════════════════════════════════════
// 第 6 节：冲突
// ══════════════════════════════════════════════════════════════════════
children.push(h2('6、冲突：可信本体的试金石'))
children.push(para('说一个具体场景（虚构，机制输出是真实的）。'))
children.push(para('一个材料实验室在研究某个合金的热处理工艺。两个假设分别验证后升格成了事实：'))
children.push(bullet([t('事实 f-001：quench_rate(specimen-3) = 45 °C/s（L2，两条证据）')]))
children.push(bullet([t('事实 f-002：quench_rate(specimen-3) = 62 °C/s（L3，独立评估者确认）')]))
children.push(para('quench_rate 被登记为单值谓词——同一试样只有一个淬冷速率。两条事实同主体、同谓词、不同取值。'))
children.push(para('系统自动报出：'))
children.push(...codeBlock([
	'冲突 1 对',
	'quench_rate · specimen-3:',
	'  f-001 (quantity:45:°C/s)  L2',
	'  f-002 (quantity:62:°C/s)  L3',
	'—— 只暴露，不裁决；撤回或维持由人决定',
]))
children.push(para([t('系统'), bold('不动任何一侧'), t('。因为系统没有能力裁决真值。也许 f-001 的测量方法有系统误差，也许 f-002 的试样其实不是同一块。判断需要人来做——但'), bold('发现冲突不需要人来做，数学就够了'), t('。')]))
children.push(para([
	t('注意：这件事的前提是谓词有 functional: true 的 schema 声明。'),
	bold('抽取出来的图没有 schema'),
	t('——所以抽取式的知识图谱工具做不了这件事。这是"登记本体"和"抽取本体"的根本区别。'),
]))

// ══════════════════════════════════════════════════════════════════════
// 第 7 节：架构
// ══════════════════════════════════════════════════════════════════════
children.push(h2('7、架构：三条纪律'))
children.push(para('浅看源码结构：'))
children.push(...codeBlock([
	'ui/lib/domain-language.js        740 行   判据纯函数（词汇/断言/冲突/投影）',
	'ui/lib/fold.js                  1971 行   事件折叠（44 个分支，纯函数）',
	'ui/lib/client.js                3537 行   面板（React，只读投影）',
	'preset/plugins/clearai-kernel.js  6694 行  内核（29 个意图工具 + 货架）',
	'preset/plugins/prompts.js         370 行   提示词段（23 段在场）',
]))
children.push(img('docs/diagrams/loop-to-dsh-planes.zh-CN.png', 800))
children.push(caption('ClearAI 在 DSH 中的位置：认识论层加在组合面上——宿主包 + agent 预设 + 客户端模块'))
children.push(para('总量 13,000 行出头。三条架构纪律挡住了大量复杂度：'))

children.push(h3('账本是唯一权威，面板只是投影'))
children.push(para('所有状态变更落成事件（event sourcing）。面板读的是投影——fold.js 从事件流算出当前状态的纯函数。没有第二份存储。你看到的每一个数字都是现场算出来的。状态可从零重放，审计就是读事件流。'))
children.push(para('这一条直接对应可信判据第三条：状态可以回放到零。'))

children.push(h3('DSH 引擎一行没改'))
children.push(para('ClearAI 跑在 DeepSeek Harness 的组合面上——宿主包 + agent 预设 + 客户端模块。没有 fork，没有 patch。'))

children.push(h3('判据只有一份'))
children.push(para('词汇校验、断言校验、值形态检查、冲突推导——全部在 domain-language.js 一个纯函数模块里。模型工具、人门动词（面板编辑）、折法三个面调同一份判据。'))
children.push(para([t('规则如果写在两处，一定漂移。漂移那一刻，'), bold('可信承诺就塌了'), t('。')]))

// ══════════════════════════════════════════════════════════════════════
// 第 8 节：对比
// ══════════════════════════════════════════════════════════════════════
children.push(h2('8、和现有方案比什么'))
const cmpW = [1800, 2200, 2000, 3936]
children.push(table([
	headerRow(['维度', '抽取式图谱', '手动本体', 'ClearAI'], cmpW),
	dataRow(['边的来源', '模型抽取', '专家录入', '验证循环产出'], cmpW),
	dataRow(['边的可信度', '无法保证', '依赖专家', '每条边带证据链（L0–L4）'], cmpW),
	dataRow(['冲突检测', '不做', '需手动约束', '单值谓词违反自动报出'], cmpW),
	dataRow(['负知识', '丢弃', '不存', '被推翻的留作本体的一部分'], cmpW),
	dataRow(['可审计性', '不可审计', '部分可审计', '全量回放到零'], cmpW),
], cmpW))
children.push(para(''))
children.push(para('ClearAI 的定位是在单个项目里，让 AI 产出的知识经过验证后沉淀为可信本体。抽取式图谱擅长广度覆盖，手动编辑器适合标准化委员会——它们和 ClearAI 解决的是不同层面的问题。'))

// ══════════════════════════════════════════════════════════════════════
// 第 9 节：适合谁
// ══════════════════════════════════════════════════════════════════════
children.push(h2('9、适合谁'))
const fitW = [2600, 1400, 5936]
children.push(table([
	headerRow(['场景', '适配度', '价值'], fitW),
	dataRow(['科研探索', '极高', '事前登记判据 + 证据分级 + 结论按概念检索 + 负知识保留'], fitW),
	dataRow(['业务建模 / DDD', '高', '概念与谓词即业务契约 + 单值约束自动检冲突 + 本体图可视化'], fitW),
	dataRow(['技术调研 / 竞品分析', '高', '结论带出处 + 矛盾自动报出 + 多轮积累不丢失'], fitW),
	dataRow(['大规模知识图谱构建', '低', '这是项目级工具，不是基础设施'], fitW),
	dataRow(['日常代码生成', '不适用', '它是认识论工作台，Code Copilot 的活它不干'], fitW),
], fitW))
children.push(para(''))

// ══════════════════════════════════════════════════════════════════════
// 第 10 节：上手
// ══════════════════════════════════════════════════════════════════════
children.push(img('docs/shots/zh/deliverables.png', 660))
children.push(caption('产物格：计划的声明交付与盘上真有的分开摆——按阶段排开，每步带判据'))

children.push(h2('10、五分钟上手'))
children.push(...codeBlock([
	'npx clearai-dsh install',
]))
children.push(para('装完重启 dsh web（插件两半在运行中的进程里按 URL 缓存），新建会话选 ClearAI 预设。'))
children.push(para('发第一句话之前想好你的领域大概有哪几个概念。不用想全——词汇增量登记，漏了随时补。然后正常对话。该验证的时候系统走循环；该你裁决的时候（冲突、计划审阅），它在面板上等你。'))

// ══════════════════════════════════════════════════════════════════════
// 第 11 节：边界
// ══════════════════════════════════════════════════════════════════════
children.push(h2('11、如实说边界'))
children.push(bullet([bold('本体不跨项目。'), t(' 一个项目一个本体。跨项目复用是 OWL 层的事。')]))
children.push(bullet([bold('没有删除。'), t(' 废止是黏性的——留痕、标原因、不再被引用，但它还在。历史不可篡改是审计的前提。')]))
children.push(bullet([bold('不宣称 RSI。'), t(' 我们提供自我改进系统需要的认识论底座，不宣称自己是 RSI。')]))
children.push(bullet([bold('浏览器长测还在收尾。'), t(' 面板交互在结构级测试里全绿，真浏览器的长时间走查在 docs/known-gaps.md 里如实挂着。')]))

// ══════════════════════════════════════════════════════════════════════
// 总结
// ══════════════════════════════════════════════════════════════════════
children.push(h2('总结：本体是结果，认识论是路'))
children.push(para('回到开头的问题：AI 做完研究，产出怎么积累、结论怎么取信。'))
children.push(para('ClearAI 给出的答案：'))
children.push(quote([
	bold('用认识论循环（判据先行 + 独立评估 + 证伪保留）做质量体系，让每一条边都带着证据链和验证等级进入本体——这样的本体，你敢在上面推理。'),
]))
children.push(para('13,000 行代码。29 个工具。44 种事件。1372 条断言。每一行都在回答同一个问题：'))
children.push(para([accent('这条边是怎么挣来的。')], { alignment: AlignmentType.CENTER }))
children.push(para(''))

// 页脚链接
children.push(hr())
children.push(para([muted('项目地址：'), t('github.com/Clearailhc/clearai-dsh', { color: ACCENT })], { alignment: AlignmentType.CENTER }))
children.push(para([muted('工作署名单位：基点起源 jidianqiyuan.com')], { alignment: AlignmentType.CENTER }))

// ── 打包 ───────────────────────────────────────────────────────────────
const doc = new Document({
	styles: {
		default: {
			document: { run: { font: FONT, size: 22, color: INK } },
		},
		paragraphStyles: [
			{ id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
				run: { size: 30, bold: true, font: FONT, color: INK },
				paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 1 } },
			{ id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
				run: { size: 25, bold: true, font: FONT, color: INK },
				paragraph: { spacing: { before: 300, after: 140 }, outlineLevel: 2 } },
		],
	},
	sections: [{
		properties: {
			page: {
				size: { width: 12240, height: 15840 },
				margin: { top: 1152, right: 1152, bottom: 1152, left: 1152 },
			},
		},
		headers: {
			default: new Header({
				children: [new Paragraph({
					alignment: AlignmentType.RIGHT,
					children: [t('clearai-dsh · 可信本体构建路径', { size: 16, color: MUTED })],
				})],
			}),
		},
		footers: {
			default: new Footer({
				children: [new Paragraph({
					alignment: AlignmentType.CENTER,
					children: [t('第 ', { size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: MUTED }), t(' 页', { size: 16, color: MUTED })],
				})],
			}),
		},
		children,
	}],
})

const outPath = join(ROOT, 'docs', 'marketing', 'clearai-dsh-知乎稿.docx')
const buffer = await Packer.toBuffer(doc)
writeFileSync(outPath, buffer)
console.log(`✓ ${outPath} (${Math.round(buffer.length / 1024)} KB)`)
