/**
 * 长测剧本:给 `tools/e2e-run.mjs --scenario <name>` 用。
 *
 * 为什么单开一份:默认那一场只走「立约 → 建计划 → 停」十几拍,够验通不通,不够验**机制之间**。
 * 竞争路线并行检验、证伪、长链多步、目标链、本体与实体图——这些要在真模型上跑过才算数。
 *
 * 每个剧本给两样东西:
 *   · `task`  —— 写死的任务书。测试的是**装配**,不是模型的创造力;所以任务书明确点名要用哪个机制。
 *   · `asserts` —— 从真会话日志里取证的断言。返回 [{label, ok, detail}]。
 *
 * 共同不变量(所有剧本都跑,见 `INVARIANTS`)才是长测真正的价值:
 * 单点机制在单测里都绿,而「推进前有没有准入」「评估者有没有悬空」
 * 这类**跨机制一致性**只有完整跑一场才看得出来。
 */

/** 剧本共用的一份任务书骨架片段。 */
const DISCIPLINE = '一路做完,不要在中途停下来问我;每一步交付时给观测与判据对照。'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SCENARIOS = {
	'competing-routes': {
		title: '竞争路线:两条假设并行检验,产物各占各的路径',
		expectComplete: true,
		why: '世界线删了之后,「两条路线比一比」就是两条竞争假设各由一个步骤检验(可以交给原生子任务并行跑)。这条链要在真跑里验:两步各声明不同的产物、各自交付、证据各挂各的假设,而撞路径的计划在立约时就被拦下。',
		task: [
			'这个工作区是空的。目标:比较两种 JSON 写法哪种生成的文件更小,把结论写成 lab/winner.txt。',
			`要求(按顺序做;${DISCIPLINE}):`,
			'1. Frame:判据写清「lab/winner.txt 存在,第一行是更小那种写法的名字,第二行是两份文件的字节数」;登记**两条竞争假设**:',
			'   h-compact:「紧凑 JSON(无空格)比缩进 JSON 小」;h-pretty:「缩进 JSON 比紧凑 JSON 小」。每条写清什么结果会推翻它。',
			'2. CreatePlan 三步:',
			'   ① 路线 compact:用 python3 生成 lab/compact/data.json(紧凑写法),并量出字节数;',
			'   ② 路线 pretty:用 python3 生成 lab/pretty/data.json(缩进写法),并量出字节数;',
			'   ③ 对照两份读数,写 lab/winner.txt。',
			'   ① 与 ② 互不依赖,**各自声明不同的产物路径**;你可以用原生子任务把它们并行做完。',
			'3. 每一步交付时写清依据(哪份文件、多少字节);检验假设的那一步,给它检验的每条假设一个结果(results):成立的给 support,不成立的给 refute。',
			'4. 做完三步:ClosePlan 收束计划,然后 Conclude 结案。',
		].join('\n'),
		asserts: ({ mutations, exists, readArtifact, evidenceVerdicts }) => {
			const created = mutations.filter((m) => m.t === 'plan/created')
			const artifacts = created.flatMap((m) => (m.steps ?? []).flatMap((step) => (step.artifacts ?? []).map((path) => ({ step: step.id, path: String(path) }))))
			const owners = new Map()
			const clashes = []
			for (const { step, path } of artifacts) {
				const owner = owners.get(path)
				if (owner !== undefined && owner !== step) clashes.push(path)
				owners.set(path, step)
			}
			return [
				{ label: '计划立住了(plan/created)', ok: created.length >= 1, detail: `created=${created.length}` },
				{ label: '同一计划里没有两步声明同一产物(并行路线不互相覆盖)', ok: clashes.length === 0, detail: clashes.join(',') || `${artifacts.length} 条产物各占一处` },
				{ label: '两条路线的产物都在盘上', ok: exists('lab/compact/data.json') && exists('lab/pretty/data.json'), detail: `compact=${exists('lab/compact/data.json')} pretty=${exists('lab/pretty/data.json')}` },
				{ label: '竞争假设有输有赢(support 与 refute 都记了)', ok: evidenceVerdicts.includes('support') && evidenceVerdicts.includes('refute'), detail: evidenceVerdicts.join(',') },
				{ label: '结论落成了产物(lab/winner.txt 第一行点名一种写法)', ok: /compact|pretty|紧凑|缩进/i.test(readArtifact('lab/winner.txt').split('\n')[0] ?? ''), detail: readArtifact('lab/winner.txt').slice(0, 80) },
			]
		},
	},
	falsification: {
		title: '证伪:两条互斥假设,一条被推翻',
		expectComplete: true,
		why: '推翻是有价值的结果,但「记录下来」与「只升格成立的那条」是两件事——真跑里没人验过。',
		task: [
			'这个工作区是空的。目标:用一次**可复查的观测**,判定这台机器的 python3 能不能正常运行一段最小脚本。',
			`要求(按顺序做;${DISCIPLINE}):`,
			'1. Frame 登记**两条互斥**假设,每条写清什么结果会推翻它:',
			'   h-ok:「python3 能正常运行 `python3 -c "print(1+1)"` 并输出 2」;',
			'   h-no:「python3 不能正常运行上面那段脚本(不存在、或报错)」。',
			'   判据:lab/python3_verdict.md 存在,且里面写明了被推翻的是哪一条、依据是哪次观测。',
			'2. CreatePlan 两步计划:第一步做那次观测并把结论写进 lab/python3_verdict.md,第二步核对结论与观测一致。',
			'3. 真去跑那条命令(bash),把观测如实登记;交付时给这一步检验的每条假设一个结果(results):成立的给 support,**不成立的那条必须给 refute**。',
			'4. 做完两步:ClosePlan 收束计划,然后 Conclude 结案(判据达成了就结案,不要停在「计划已收尾」)。',
		].join('\n'),
		asserts: ({ evidenceVerdicts, promotedIds, hypothesisStatus, exists }) => [
			{ label: '至少记了一条「推翻」证据(verdict=refute;这条考的是模型的判断,不是机制)', ok: evidenceVerdicts.includes('refute'), detail: evidenceVerdicts.join(',') },
			{ label: '至少记了一条「支持」证据(verdict=support)', ok: evidenceVerdicts.includes('support'), detail: evidenceVerdicts.join(',') },
			{ label: '有假设被判定为 refuted(由证据算出;同样取决于模型肯不肯写下推翻)', ok: Object.values(hypothesisStatus).includes('refuted'), detail: JSON.stringify(hypothesisStatus) },
			{
				/**
				 * 这是**安全性质**:被推翻的假设绝不许进事实库。
				 * 空事实集上它恒真,这是允许的——「该不该升格」是**活性**问题,
				 * 由跨机制的『升格与证据等级自洽』不变量管(证据没到 promote_at_level 就不该升格,
				 * 到了就必须升格)。一条断言只管一件事。
				 */
				label: '被推翻的假设**没有**被升格成事实(安全性质;活性由等级自洽不变量管)',
				ok: promotedIds.every((id) => hypothesisStatus[id] !== 'refuted'),
				detail: `升格=${promotedIds.join(',') || '(无)'} 状态=${JSON.stringify(hypothesisStatus)}`,
			},
			{ label: '结论落成了产物(lab/python3_verdict.md 在盘上)', ok: exists('lab/python3_verdict.md'), detail: 'lab/python3_verdict.md' },
		],
	},
	'long-plan': {
		title: '长链:四步交付,物证、准入、收尾',
		expectComplete: true,
		why: '多步长链才有机会暴露「跳步推进」「物证造假」「收尾不干净」这类只在长度上出现的问题。',
		task: [
			'这个工作区是空的。目标:走完一条四步的数据小链,最后交出 lab/report.md。',
			`要求(按顺序做;${DISCIPLINE}):`,
			'1. Frame:判据 = 「lab/report.md 存在,且里面给出的均值与 lab/means.json 完全一致」;登记至少两条候选假设。',
			'2. CreatePlan 四步:',
			'   ① 造 lab/raw.csv:3 列 × 20 行数值(自己生成,写清怎么生成的);',
			'   ② 写 lab/analyze.py,读 raw.csv 算出每列均值,输出 lab/means.json;',
			'   ③ 用**另一条独立路径**核对(例如 bash + awk/python 一行式再算一遍),把两次结果对照写进 lab/check.md;',
			'   ④ 写 lab/report.md 汇总:数据怎么来的、均值是多少、怎么核对的;',
			'3. 每一步都声明 artifacts 与 done_criteria;交付时给观测(哪份文件、多大、什么内容)。',
			'4. 全部做完后 ClosePlan 收尾。',
		].join('\n'),
		asserts: ({ countOf, exists, projectedSteps }) => [
			{ label: '推进了至少三步(step/advanced ≥ 3)', ok: countOf('step/advanced') >= 3, detail: `advanced=${countOf('step/advanced')}` },
			{ label: '计划真的是四步上下(投影里 ≥ 3 步)', ok: projectedSteps >= 3, detail: `${projectedSteps} 步` },
			{ label: '数据产物在盘上(lab/raw.csv)', ok: exists('lab/raw.csv'), detail: 'lab/raw.csv' },
			{ label: '计算产物在盘上(lab/means.json)', ok: exists('lab/means.json'), detail: 'lab/means.json' },
			{ label: '报告在盘上(lab/report.md)', ok: exists('lab/report.md'), detail: 'lab/report.md' },
		],
	},
	'goal-chain': {
		title: '目标链:结案后再立一个,复用前一环的产物',
		expectComplete: true,
		why: '「一个对话多个目标」是面板与投影里的一等公民,但真跑里从没验过第二个目标会不会把状态机搞乱。',
		task: [
			'这个工作区是空的。这一场要**连着做两个目标**。',
			`要求(按顺序做;${DISCIPLINE}):`,
			'1. 目标一:在 lab/base.txt 里写下三行文本(自己定内容,但写清规则);判据 = 「lab/base.txt 恰好三行、非空」。登记至少两条候选假设。',
			'2. 为它建一份两步计划(写文件 → 核对行数),做完 ClosePlan,然后 Conclude 结案。',
			'3. 目标二:**基于目标一留下的文件**再做一个可核对的交付——把 lab/base.txt 每行加上行号,写成 lab/numbered.txt;判据 = 「lab/numbered.txt 行数与 lab/base.txt 相同,且每行以行号开头」。',
			'   同样:Frame(至少两条假设)→ CreatePlan(两步)→ 做完 → ClosePlan → Conclude。',
			'4. 两个目标都要真的结案,不要只结一个。',
		].join('\n'),
		asserts: ({ countOf, exists, kinds }) => [
			{ label: '立了两个目标(goal/set ≥ 2)', ok: countOf('goal/set') >= 2, detail: `set=${countOf('goal/set')}` },
			{ label: '两个目标都结了案(goal/closed ≥ 2)', ok: countOf('goal/closed') >= 2, detail: `closed=${countOf('goal/closed')}` },
			{ label: '建了两份计划(plan/created ≥ 2)', ok: countOf('plan/created') >= 2, detail: `created=${countOf('plan/created')}` },
			{ label: '两份计划都收尾了(plan/closed ≥ 2)', ok: countOf('plan/closed') >= 2, detail: `closed=${countOf('plan/closed')}` },
			{ label: '第一环的产物还在(lab/base.txt)', ok: exists('lab/base.txt'), detail: 'lab/base.txt' },
			{ label: '第二环复用了它(lab/numbered.txt)', ok: exists('lab/numbered.txt'), detail: 'lab/numbered.txt' },
		],
	},
	'entity-graph': {
		title: '本体与实体图:概念是约定,实例是观测',
		// 这一场**不要求**跑到底:实体门与判据修订门开着,
		// 模型找不到出口就会停在"目标还开着"——那正是要观测的现象,不该被判成失败。
		expectComplete: false,
		why: 'entity/registered 与 entity/asserted 是本轮新增的一等写入口:实体图从此不依赖目标裁决。这条链在真模型上一次都没跑过,而单测只能证明"机制在那儿"。',
		task: [
			'这个工作区是空的。目标:把「一家三口共用的家用网络」整理成本体(概念与关系)与实体图(具体设备),并给出带出处的断言。',
			`要求(按顺序做;${DISCIPLINE}):`,
			'1. Frame:`headline` 一句话(≤120 字)说清要建什么;判据写成可清点的形态:`lab/ontology.md` 与 `lab/entities.md` 都存在,且 `entities.md` 里每个实例都带出处;登记至少两条候选假设。',
			'2. 在 `clear/ontology/concepts/` 下写至少 4 个概念文件(例如 设备 / 接口 / 网络 / 厂商),在 `clear/ontology/relations/` 下写至少 2 个关系文件(带 `range`,例如 属于 / 支持),每条都写依据;字段看 `clear/ontology/SCHEMA.json`。',
			'3. 在 `clear/ontology/entities/` 下写至少 3 个**具体实体**(每台设备一个文件):`type` 用你写的概念,`basis` 写清哪份材料,`provenance` 用 `{kind:"named", ref:"…"}` 指向一份具名资料(可以是你自己编的登记表,但要在 lab/ 下落成文件)。',
			'4. 给这 3 个实体各在自己文件的 `relations` 里写一条**带出处**的关系(关系用第 2 步写的),让实体图上真的长出边。',
			'5. 写两份产物:`lab/ontology.md`(概念与谓词清单,逐条写依据)与 `lab/entities.md`(每个实例一行:实例 · 断言 · 出处)。',
			'6. 用 `CreatePlan` 把上面这些拆成可交付的步骤并逐步 `AdvancePlan` 交付(产物声明这两份文件),然后 `ClosePlan`;最后 `Conclude` 结案。',
			'   如果结案被门挡下(卡上会点名是哪一道),按它给的下一步补上再结;确实做不到就如实说明。',
		].join('\n'),
		asserts: ({ kinds, countOf, exists, readArtifact, mutations, projected, modelVisibleText }) => {
			/** 本体由模型写文件、经 `workspace/synced` 进账:实体与关系都从投影里读。 */
			const registered = Array.isArray(projected?.lexicon?.entities) ? projected.lexicon.entities : []
			const asserted = (projected?.lexicon?.graph?.edges ?? []).filter((edge) => edge.kind === 'assertion' && edge.status === 'asserted')
			/**
			 * 图的投影挂在 `view().lexicon.graph` 上(不是 `view().graph`)——判据必须读**真的那份**:
			 * 读错位置会得到"0 节点"这种假失败,而它看起来像产品缺陷。
			 */
			const projectedGraph = projected?.lexicon?.graph ?? projected?.graph ?? { nodes: [], edges: [] }
			const entityNodes = (projectedGraph.nodes ?? []).filter((node) => node.layer === 'entity')
			const entityEdges = (projectedGraph.edges ?? []).filter((edge) => edge.kind === 'assertion')
			return [
				{ label: '写了至少 3 个实体文件且进了图', ok: registered.length >= 3, detail: `entities=${registered.length}(${registered.map((m) => m.id ?? m.ref).join(',')})` },
				{ label: '每个实例都带出处(kind+ref 非空)', ok: registered.length > 0 && registered.every((m) => typeof m.provenance?.ref === 'string' && m.provenance.ref !== ''), detail: JSON.stringify(registered.map((m) => m.provenance ?? null)).slice(0, 160) },
				{ label: '写了至少 3 条带出处的实体关系', ok: asserted.length >= 3, detail: `asserted=${asserted.length}` },
				{ label: '实体图上有节点(投影 entity 层非空)', ok: entityNodes.length >= 3, detail: `${entityNodes.length} 个节点` },
				{ label: '实体图上有边(断言真的进了图)', ok: entityEdges.length >= 3, detail: `${entityEdges.length} 条边` },
				{ label: '两份产物在盘上', ok: exists('lab/ontology.md') && exists('lab/entities.md'), detail: `ontology=${exists('lab/ontology.md')} entities=${exists('lab/entities.md')}` },
				{ label: 'entities.md 里逐条带出处字样', ok: /出处|来源|provenance/i.test(readArtifact('lab/entities.md')), detail: readArtifact('lab/entities.md').slice(0, 120) },
				/**
				 * **条件断言(这才是这道门的意义)**:如果目标结案成了 achieved,那么实体图上必须已经有边——
				 * 换句话说"本体建好了、实体图是空的"这种交付**过不了门**。
				 */
				{
					label: '条件断言:结案成功 ⇒ 实体图上必须有边(空实体图不许结案)',
					ok: !kinds.has('goal/closed') || asserted.length >= 1,
					detail: `goal/closed=${countOf('goal/closed')} asserted=${asserted.length}`,
				},
				{ label: '卡上确实把实体这条路指给过模型(可读性不是装饰)', ok: /clear\/ontology\/entities|实体图/.test(modelVisibleText), detail: modelVisibleText.includes('clear/ontology/entities') ? '点名过实体文件' : '只提过实体图' },
			]
		},
	},
	'jepa-research': {
		title: '开放研究:JEPA 世界模型的调研、探索与方向',
		expectComplete: true,
		why: '前面几场都是点名机制的小任务。这一场是人真会发来的开放研究题,只在最后点名结案:判断、检验、独立核验、推翻与说不清、本体与实体图、答复的说法,要靠提示词与工具面自己走出来。改造六个阶段落地之后,用它看整体是否符合设计。',
		task: [
			'这个工作区是空的。请以 JEPA 世界模型为题做一次完整的研究:',
			'把相关工作调研清楚(从 I-JEPA、V-JEPA 到最新进展,以及它和生成式世界模型、其他自监督方法的区别);',
			'动手做一点能复查的探索;最后给出未来值得做的研究方向。',
			'结论要能信:哪些已经核实、哪些被推翻、哪些还说不清,都要分清楚;把这个领域的概念和具体工作整理成本体与实体图。',
			`${DISCIPLINE}判据达成后用 Conclude 结案。`,
		].join('\n'),
		asserts: ({ mutations, countOf, evidenceVerdicts, events }) => {
			const framed = [...mutations].reverse().find((m) => m.t === 'goal/set')
			const hypotheses = framed?.hypotheses ?? []
			const registered = mutations.filter((m) => m.t === 'entity/registered')
			const closed = [...mutations].reverse().find((m) => m.t === 'goal/closed')
			/** 第六阶段:工具结果与运行态卡里不该出现内核起的编号(`h-xxxxxx`)与机制词。 */
			const resultText = events
				.filter((event) => event.type === 'tool/result')
				.map((event) => JSON.stringify(event.data?.message?.content ?? ''))
				.join('\n')
			const leakedIds = [...new Set(resultText.match(/\bh-[a-z0-9]{6}\b/g) ?? [])]
			return [
				{ label: '立了至少三条判断', ok: hypotheses.length >= 3, detail: `${hypotheses.length} 条` },
				{ label: '立了领域词汇(概念 ≥ 5,关系 ≥ 2)', ok: countOf('ontology/term_added') >= 5 && countOf('ontology/predicate_added') >= 2, detail: `概念 ${countOf('ontology/term_added')} · 关系 ${countOf('ontology/predicate_added')}` },
				{ label: '登记了具体工作(实例 ≥ 5,都带出处)', ok: registered.length >= 5 && registered.every((m) => typeof m.provenance?.ref === 'string' && m.provenance.ref !== ''), detail: `${registered.length} 个` },
				{ label: '写了带出处的断言(≥ 3)', ok: countOf('entity/asserted') >= 3, detail: `${countOf('entity/asserted')} 条` },
				{ label: '至少一次独立核验', ok: countOf('audit/settled') >= 1, detail: `派 ${countOf('audit/dispatched')} · 回 ${countOf('audit/settled')}` },
				{ label: '不只有支持(有推翻或说不清的结果)', ok: evidenceVerdicts.some((verdict) => verdict !== 'support'), detail: evidenceVerdicts.join(',') },
				{ label: '结案达成,并有结论写进长期知识', ok: closed?.status === 'achieved' && countOf('fact/promoted') >= 1, detail: `结案=${closed?.status ?? '(无)'} 升格=${countOf('fact/promoted')}` },
				{ label: '工具结果与卡里没有内部编号(第六阶段)', ok: leakedIds.length === 0, detail: leakedIds.join(',') || '无' },
			]
		},
	},
}

/**
 * 跨机制不变量:所有剧本都跑。
 *
 * 这些是「长测才看得见」的那一类:单点机制在单测里都绿,而推进与准入的**先后**、
 * 评估者的**闭环**,只有一场完整跑动才给得出证据。
 */
export const INVARIANTS = [
	{
		label: '没有跳过准入的推进(每个 step/advanced 之前都有该步的 admission/checked)',
		run: ({ mutations }) => {
			const admitted = new Set(mutations.filter((m) => m.t === 'admission/checked').map((m) => m.step))
			const offenders = mutations.filter((m) => m.t === 'step/advanced' && m.step !== undefined && !admitted.has(m.step))
			return { ok: offenders.length === 0, detail: offenders.map((m) => m.step).join(',') }
		},
	},
	{
		label: '评估者没有悬空(每个 audit/dispatched 都有 audit/settled)',
		run: ({ countOf }) => ({ ok: countOf('audit/dispatched') <= countOf('audit/settled'), detail: `dispatched=${countOf('audit/dispatched')} settled=${countOf('audit/settled')}` }),
	},
	{
		label: '证据都挂在存在的步骤上(evidence/recorded 的 step 属于本计划)',
		run: ({ mutations }) => {
			/**
			 * 步骤集要**按时间折**,而且要在**那一条证据发生的当时**判它挂在不在:
			 *   · 计划会被修订(`plan/amended` / `plan/refined` 加步)——只看 `plan/created` 会误报;
			 *   · 步骤会在记过证据之后被作废(`plan/voided`)——**那是历史,不是孤儿**:
			 *     证据确实在那一刻记在了一个当时合法的步上,后来的作废不追溯。
			 * 两次误报都是这条判据教出来的,所以它现在按顺序折、就地问。
			 */
			/**
			 * 三种「步」都要认(每一种都是真日志教出来的):
			 *   · `plan/created` 带 `steps` 数组;`plan/amended` 带**单个** `step` 对象(补一步);
			 *   · `plan/voided` 带**单个** `step` 字符串(作废一步);
			 *   · **合成锚点**:目标级审计的证据挂在 `goal:<目标id>` 上——它不是计划里的步,
			 *     但是合法的落点。锚点指向的目标必须真的存在,否则一样算孤儿。
			 */
			const goalIds = new Set(mutations.filter((m) => m.t === 'goal/set').map((m) => m.id))
			const isSyntheticAnchor = (id) => typeof id === 'string' && id.startsWith('goal:') && goalIds.has(id.slice('goal:'.length))
			const steps = new Set()
			const orphans = []
			for (const mutation of mutations) {
				if (mutation.t === 'plan/created') {
					for (const step of mutation.steps ?? []) if (step?.id !== undefined) steps.add(step.id)
				}
				if (mutation.t === 'plan/amended' && mutation.step?.id !== undefined) steps.add(mutation.step.id)
				if (mutation.t === 'plan/voided' && mutation.step !== undefined) steps.delete(mutation.step)
				if (mutation.t === 'evidence/recorded' && mutation.step !== undefined && steps.size > 0 && !steps.has(mutation.step) && !isSyntheticAnchor(mutation.step)) orphans.push(mutation.step)
			}
			return { ok: orphans.length === 0, detail: orphans.join(',') }
		},
	},
	{
		/**
		 * **升格与证据等级自洽**。升格只在 `Conclude` 发生,条件是「支持等级 ≥ promote_at_level
		 * 且没有被推翻」。所以「没升格」有两种成因:门槛没到(对)与门槛到了却没升(错)——
		 * 这一条把两者分开:没到级就必须一条都不升,到了级就必须至少升一条。
		 *
		 * 已知边界:若达级的那条支持证据所对应的假设**同时**有推翻记录,内核不会升格,
		 * 而这里会误报。剧本目前不构造这种组合;真撞上再细化判据,而不是放宽它。
		 */
		label: '升格与证据等级自洽(没到级不升格,到了级必须升格)',
		run: ({ mutations }) => {
			const RANK = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 }
			const goal = [...mutations].reverse().find((m) => m.t === 'goal/set')
			const threshold = goal?.promote_at_level
			const support = mutations.filter((m) => m.t === 'evidence/recorded' && m.verdict === 'support')
			const best = support.reduce((max, m) => Math.max(max, RANK[m.level] ?? -1), -1)
			const promoted = mutations.filter((m) => m.t === 'fact/promoted').length
			if (threshold === undefined || RANK[threshold] === undefined) return { ok: true, detail: `promote_at_level 不可读(${String(threshold)})⇒ 不判` }
			const closed = mutations.some((m) => m.t === 'goal/closed')
			const reached = best >= RANK[threshold]
			const bestLabel = Object.keys(RANK).find((key) => RANK[key] === best) ?? '无'
			const detail = `promote_at_level=${threshold} 最高支持证据=${bestLabel} 升格=${promoted}${reached ? '(到级了)' : '(没到级)'}${closed ? '' : ' · 目标未结案'}`
			/**
			 * **升格发生在 `Conclude` 那一刻**。所以目标还开着时,「到级了却没升格」是**正常的**
			 * (还没到升格那一步),不能判违规——只判反方向:没到级就绝不该有升格。
			 */
			if (!closed) return { ok: promoted === 0, detail }
			return { ok: reached ? promoted >= 1 : promoted === 0, detail }
		},
	},
	{
		label: '声明的物证真的在盘上(主线步骤的 artifacts)',
		run: ({ mutations, exists }) => {
			const declared = mutations.filter((m) => m.t === 'plan/created').flatMap((m) => (m.steps ?? []).flatMap((step) => step.artifacts ?? []))
			// 只有**已推进**的步骤才该有物证;未推进的步骤声明了也正常。
			const advanced = new Set(mutations.filter((m) => m.t === 'step/advanced').map((m) => m.step))
			const advancedDeclared = mutations
				.filter((m) => m.t === 'plan/created')
				.flatMap((m) => (m.steps ?? []).filter((step) => advanced.has(step.id)).flatMap((step) => step.artifacts ?? []))
			const missing = advancedDeclared.filter((path) => typeof path === 'string' && !path.includes('*') && !exists(path))
			return { ok: missing.length === 0, detail: `声明 ${declared.length} 条,已推进步缺 ${missing.length} 条:${missing.join(',')}` }
		},
	},
]

/**
 * 用一份**真会话日志**跑判据:不变量 + 剧本断言。
 *
 * 为什么把它抽出来(而不是留在 e2e-run 里):判据要能被**离线复算**。
 * 同一份日志、同一个判官,换台机器也能得出同样的结论——否则「长测发现了什么」
 * 只能靠信跑它的人。`tools/e2e-replay.mjs` 与 `tools/e2e-run.mjs` 共用这一个函数,
 * 于是「跑一场」与「重判一场」永远不会漂移。
 *
 * `exists` / `called` 由调用方注入:这一层不碰文件系统,
 * 才能被快测用合成上下文直接验(见 `test/e2e-scenarios.test.mjs`)。
 */
export async function evaluateLog({ scenario, events, mutations, workspace, exists, called }) {
	const { applyEvent, emptyState, view, derive } = await import(new URL('../ui/lib/fold.js', import.meta.url))
	let state = emptyState()
	for (const event of events) state = applyEvent(state, event)
	const projected = view(state)
	const derived = derive(state)

	const kinds = new Set(mutations.map((mutation) => mutation.t))
	const countOf = (kind) => mutations.filter((mutation) => mutation.t === kind).length
	// 升格的事实只带 claim 文本(不带假设 id),所以按文本回指——假设的 claim 在 goal/set 里。
	const hypotheses = mutations.filter((m) => m.t === 'goal/set').flatMap((m) => m.hypotheses ?? [])
	const claimToId = new Map(hypotheses.map((h) => [h.claim, h.id]))
	const promotedIds = mutations
		.filter((m) => m.t === 'fact/promoted')
		.map((m) => claimToId.get(m.text) ?? `(对不上:${String(m.text).slice(0, 16)}…)`)
	const hypothesisStatus = Object.fromEntries((derived.hypotheses ?? []).map((h) => [h.id, h.status]))
	/**
	 * **模型看得到的文本**:判「一条事实有没有送达模型」只能用这个,不能用账本。
	 *
	 * 三类都算:工具结果的消息体(`tool/result.message.content`)、用户消息
	 * (**原生结算通知就走这条**——`subagent-settled` 是一条 user message)、助手消息。
	 * 排除的是变更记录(`meta.mutations`)——账上有、心里没有,不算送达。
	 */
	/**
	 * 把内容块里的**全部文本**取出来。
	 *
	 * 为什么不能只看 `type === 'text'`:工具结果的内容块是**套娃**的——外层是
	 * `{type:'tool-result', content:[{type:'text', text}]}`,真正的文本在里层。
	 * 只认外层会把"送到了"判成"没送到"(这正是这条不变量此前误报的原因)。
	 */
	const textOf = (blocks) =>
		(Array.isArray(blocks) ? blocks : [])
			.flatMap((block) => {
				if (block?.type === 'text') return [String(block.text ?? '')]
				if (Array.isArray(block?.content)) return textOf(block.content)
				return []
			})
			.join('\n')
	const modelVisibleText = [
		...events.filter((event) => event.type === 'tool/result').flatMap((event) => [textOf(event.data?.message?.content)]),
		...events
			.filter((event) => event.type === 'user/message' || event.type === 'assistant/message')
			.flatMap((event) => [textOf(event.data?.content ?? event.data?.message?.content)]),
	].join('\n')

	/** 读产物正文(判据要验「引用」这类文本性质时用)。读不到就给空串,判据自己红。 */
	const readArtifact = (relative) => {
		try {
			return readFileSync(join(workspace, relative), 'utf8')
		} catch {
			return ''
		}
	}
	const context = {
		mutations,
		kinds,
		countOf,
		exists,
		readArtifact,
		called,
		events,
		modelVisibleText,
		workspace,
		projected,
		derived,
		state,
		evidenceVerdicts: mutations.filter((m) => m.t === 'evidence/recorded').map((m) => m.verdict),
		promotedIds,
		hypothesisStatus,
		projectedSteps: (projected.plan?.steps ?? []).length,
	}
	const checks = INVARIANTS.map((invariant) => {
		const outcome = invariant.run(context)
		return { label: invariant.label, ok: outcome.ok === true, detail: outcome.detail ?? '', kind: 'invariant' }
	})
	if (scenario !== null && scenario !== undefined) {
		for (const assertion of scenario.asserts(context)) {
			checks.push({ label: assertion.label, ok: assertion.ok === true, detail: assertion.detail ?? '', kind: 'scenario' })
		}
	}
	const goalStatus = projected.goal?.status ?? '(无目标)'
	const openSteps = (projected.plan?.steps ?? []).filter((step) => step.status === 'open')
	return {
		checks,
		stats: {
			mutationCount: mutations.length,
			kinds,
			histogram: [...kinds].map((kind) => `${kind}×${countOf(kind)}`).join(' '),
			goalStatus,
			openSteps: openSteps.map((step) => step.id),
			projectedSteps: (projected.plan?.steps ?? []).length,
		},
	}
}
