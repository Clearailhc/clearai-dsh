/**
 * 长测剧本:给 `tools/e2e-run.mjs --scenario <name>` 用。
 *
 * 为什么单开一份:默认那一场只走「立约 → 建计划 → 停」十几拍,够验通不通,不够验**机制之间**。
 * 世界线分叉与算术裁决、证伪、长链多步、侦察先于计划、目标链——这些在真模型上从没跑过。
 *
 * 每个剧本给两样东西:
 *   · `task`  —— 写死的任务书。测试的是**装配**,不是模型的创造力;所以任务书明确点名要用哪个机制。
 *   · `asserts` —— 从真会话日志里取证的断言。返回 [{label, ok, detail}]。
 *
 * 共同不变量(所有剧本都跑,见 `INVARIANTS`)才是长测真正的价值:
 * 单点机制在单测里都绿,而「推进前有没有准入」「分叉有没有留孤儿」「评估者有没有悬空」
 * 这类**跨机制一致性**只有完整跑一场才看得出来。
 */

/** 剧本共用的一份任务书骨架片段。 */
const DISCIPLINE = '一路做完,不要在中途停下来问我;每一步交付时给观测与判据对照。'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SCENARIOS = {
	'worldline-arbitration': {
		title: '世界线:两条实现按尺子算术裁决',
		expectComplete: true,
		why: '分叉/世界线/读数/算术裁决/采纳,是这套机制里最深的一条链,单测只覆盖到内核函数边界。',
		task: [
			'这个工作区是空的。目标:用一把**事先登记的尺子**在两种实现之间择优,把赢家落成产物。',
			`要求(按顺序做;${DISCIPLINE}):`,
			'1. SetGoal:判据写清「lab/winner.txt 存在,且第一行是赢家路线的名字」;登记至少两条候选假设,每条写清什么结果会推翻它。',
			'2. CreatePlan 一份三步计划:第一步是「分叉择优」(判据里要写出裁决指标与方向),第二步把赢家落成 lab/winner.txt,第三步核对并结案。',
			'3. 第一步上用 ForkPlan 开**两条**世界线:',
			'   路线 compact:用 python3 写 lab/gen_compact.py,生成 lab/data_compact.json(紧凑 JSON,无空格);',
			'   路线 pretty:用 python3 写 lab/gen_pretty.py,生成 lab/data_pretty.json(缩进 JSON,带空格)。',
			'   两条的 done_criteria 都要写明「读数 = 生成文件的字节数」;decide_by 指标写「字节数」,方向取 min。',
			'4. 用 AdvanceWorldline 把两条世界线都交付,每条报一个**整串就是一个数**的读数(字节数)。',
			'5. ConvergeFork 让算术裁决;然后接着做第二步与第三步,最后 ClosePlan 收尾。',
		].join('\n'),
		asserts: ({ kinds, countOf, exists, mutations, readArtifact }) => {
			// **一条 `worldline/prepared` 携带全部世界线**(fold 里就是按 `branches` 展开的),
			// 所以这里数分支、不数变更——数变更会得出「只登记了一条」的假失败。
			const branches = mutations.filter((m) => m.t === 'worldline/prepared').flatMap((m) => m.branches ?? [])
			return [
			{ label: '分叉真的开了(fork/created)', ok: countOf('fork/created') >= 1, detail: `fork/created=${countOf('fork/created')}` },
			{ label: '两条世界线都登记了(prepared 里 ≥2 条分支)', ok: branches.length >= 2, detail: `分支=${branches.length}(${branches.map((b) => b.label ?? b.id).join(',')})` },
			{ label: '两条世界线都交付了读数(worldline/executed ≥ 2)', ok: countOf('worldline/executed') >= 2, detail: `executed=${countOf('worldline/executed')}` },
			/**
			 * **两种诚实结局都接受**:收敛(算术裁决出赢家)或**如实不可判**(读数不足/不可用)。
			 * 后者是设计里的路(「算不出来就停下问人」),把它判成失败等于要求内核编一个赢家。
			 * 但两条都不许:既不收敛又不留痕——那才是「默默停下」。
			 */
			{
				label: '分叉收口了:收敛 或 如实记下不可判(不许默默停下)',
				ok: kinds.has('fork/converged') || kinds.has('fork/undecidable') || kinds.has('fork/abandoned'),
				detail: [...kinds].filter((k) => k.startsWith('fork/')).join(','),
			},
			{
				label: '条件断言:收敛了就必须有赢家被采纳(merged 或如实登记未合并)',
				ok: !kinds.has('fork/converged') || kinds.has('fork/merged') || kinds.has('fork/merge_skipped'),
				detail: [...kinds].filter((k) => k.startsWith('fork/')).join(','),
			},
			{
				label: '条件断言:不可判时要写清原因(读数不足/不可用,而不是一句「没成」)',
				ok: !kinds.has('fork/undecidable') || String(mutations.find((m) => m.t === 'fork/undecidable')?.reason ?? '').length > 8,
				detail: String(mutations.find((m) => m.t === 'fork/undecidable')?.reason ?? '(没有不可判记录)').slice(0, 90),
			},
			{
				label: '条件断言:拿到赢家就落成产物;不可判则不落(不许把没裁出来的东西写成赢家)',
				ok: kinds.has('fork/converged') ? exists('lab/winner.txt') : true,
				detail: 'lab/winner.txt',
			},
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
			'1. SetGoal 登记**两条互斥**假设,每条写清什么结果会推翻它:',
			'   h-ok:「python3 能正常运行 `python3 -c "print(1+1)"` 并输出 2」;',
			'   h-no:「python3 不能正常运行上面那段脚本(不存在、或报错)」。',
			'   判据:lab/python3_verdict.md 存在,且里面写明了被推翻的是哪一条、依据是哪次观测。',
			'2. CreatePlan 两步计划:第一步做那次观测并把结论写进 lab/python3_verdict.md,第二步核对结论与观测一致。',
			'3. 真去跑那条命令(bash),把观测如实登记;交付时给每条假设一个 verdict:成立的给 support,**不成立的那条必须给 refute**。',
			'4. 做完两步:ClosePlan 收束计划,然后 CloseGoal 结案(判据达成了就结案,不要停在「计划已收尾」)。',
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
		title: '长链:五步交付,物证、准入、收尾',
		expectComplete: true,
		why: '多步长链才有机会暴露「跳步推进」「物证造假」「收尾不干净」这类只在长度上出现的问题。',
		task: [
			'这个工作区是空的。目标:走完一条五步的数据小链,最后交出 lab/report.md。',
			`要求(按顺序做;${DISCIPLINE}):`,
			'1. SetGoal:判据 = 「lab/report.md 存在,且里面给出的均值与 lab/means.json 完全一致」;登记至少两条候选假设。',
			'2. CreatePlan 五步:',
			'   ① 造 lab/raw.csv:3 列 × 20 行数值(自己生成,写清怎么生成的);',
			'   ② 写 lab/analyze.py,读 raw.csv 算出每列均值,输出 lab/means.json;',
			'   ③ 用**另一条独立路径**核对(例如 bash + awk/python 一行式再算一遍),把两次结果对照写进 lab/check.md;',
			'   ④ 写 lab/report.md 汇总:数据怎么来的、均值是多少、怎么核对的;',
			'   ⑤ 把这次流程里值得记住的一条经验用 WriteMemory 落盘。',
			'3. 每一步都声明 artifacts 与 done_criteria;交付时给观测(哪份文件、多大、什么内容)。',
			'4. 全部做完后 ClosePlan 收尾。',
		].join('\n'),
		asserts: ({ countOf, exists, memoryEntries, projectedSteps, kinds }) => [
			{ label: '推进了至少四步(step/advanced ≥ 4)', ok: countOf('step/advanced') >= 4, detail: `advanced=${countOf('step/advanced')}` },
			{ label: '计划真的是五步上下(投影里 ≥ 4 步)', ok: projectedSteps >= 4, detail: `${projectedSteps} 步` },
			{ label: '数据产物在盘上(lab/raw.csv)', ok: exists('lab/raw.csv'), detail: 'lab/raw.csv' },
			{ label: '计算产物在盘上(lab/means.json)', ok: exists('lab/means.json'), detail: 'lab/means.json' },
			{ label: '报告在盘上(lab/report.md)', ok: exists('lab/report.md'), detail: 'lab/report.md' },
			{ label: '经验落了记忆(≥1 条)', ok: memoryEntries >= 1, detail: `${memoryEntries} 条` },
			{ label: '账本提交过(git/committed)', ok: kinds.has('git/committed'), detail: [...kinds].filter((k) => k.startsWith('git/')).join(',') },
		],
	},
	'scout-first': {
		title: '侦察先于计划',
		expectComplete: true,
		why: 'SpawnScout 是「只读、派出去就不等、结论回灌进资料面」那条路;它与主线的衔接(收结论→据此立计划)没在真跑里验过。',
		task: [
			'这个工作区是空的(系统会铺好 clear/ 骨架)。我要一份「先看再动」的小交付。',
			`要求(按顺序做;${DISCIPLINE}):`,
			'1. **先派一次只读侦察**:用 SpawnScout 让一个子代理回答「工作区里有哪些现成技能(clear/skills/ 下各是什么)、有没有可用的数据文件、工作区根目录下有什么」。',
			'   侦察是异步的:**必须等它的结论回来**——用 AwaitWorldlines;到点还没回来就**再等一次**(最多等三次),',
			'   直到结论到手再往下做。等不到就如实说明,不要假装它有结论。',
			'2. 拿到侦察结论后,再 SetGoal:判据 = 「lab/inventory.md 存在,且(1)技能条数与**侦察结论报的条数**一致、(2)文件里**逐字引用侦察结论里的一句话**」;登记至少两条候选假设。',
			'3. CreatePlan 两步:第一步据侦察结论写 lab/inventory.md,第二步独立核对(自己再列一遍目录,与文件内容对照)。',
			'4. 做完两步,ClosePlan 收尾。',
		].join('\n'),
		asserts: ({ countOf, exists, called, readArtifact }) => [
			{ label: '真的派了侦察(scout/dispatched)', ok: countOf('scout/dispatched') >= 1, detail: `dispatched=${countOf('scout/dispatched')}` },
			{ label: '侦察结论收上来了(scout/settled)', ok: countOf('scout/settled') >= 1, detail: `settled=${countOf('scout/settled')}` },
			{ label: '侦察是走工具派的(SpawnScout)', ok: called('SpawnScout'), detail: 'SpawnScout' },
			{ label: '清单落成了产物(lab/inventory.md)', ok: exists('lab/inventory.md'), detail: 'lab/inventory.md' },
			// 判据**依赖**侦察结论:产物里必须留下引用它的痕迹——"结论送达了模型"因此有外部证据。
			{
				label: '产物里引用了侦察结论(送达不只是进了上下文,还被用上了)',
				ok: /侦察/.test(readArtifact('lab/inventory.md')),
				detail: readArtifact('lab/inventory.md').slice(0, 80),
			},
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
			'2. 为它建一份两步计划(写文件 → 核对行数),做完 ClosePlan,然后 CloseGoal 结案。',
			'3. 目标二:**基于目标一留下的文件**再做一个可核对的交付——把 lab/base.txt 每行加上行号,写成 lab/numbered.txt;判据 = 「lab/numbered.txt 行数与 lab/base.txt 相同,且每行以行号开头」。',
			'   同样:SetGoal(至少两条假设)→ CreatePlan(两步)→ 做完 → ClosePlan → CloseGoal。',
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
}

/**
 * 跨机制不变量:所有剧本都跑。
 *
 * 这些是「长测才看得见」的那一类:单点机制在单测里都绿,而推进与准入的**先后**、
 * 分叉与收敛的**配对**、评估者的**闭环**,只有一场完整跑动才给得出证据。
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
		label: '分叉不留孤儿(每个 fork/created 都以 converged/abandoned/undecidable 收口)',
		run: ({ countOf }) => {
			const opened = countOf('fork/created')
			const closed = countOf('fork/converged') + countOf('fork/abandoned') + countOf('fork/undecidable')
			return { ok: opened <= closed, detail: `created=${opened} 收口=${closed}` }
		},
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
			 *   · **合成锚点**:目标级审计的证据挂在 `goal:<目标id>` 上,世界线级挂在
			 *     `<forkId>:<branchId>` 上——它们不是计划里的步,但都是合法的落点。
			 *     锚点指向的目标/分叉必须真的存在,否则一样算孤儿。
			 */
			const goalIds = new Set(mutations.filter((m) => m.t === 'goal/set').map((m) => m.id))
			const forkIds = new Set(mutations.filter((m) => m.t === 'fork/created').map((m) => m.id))
			const isSyntheticAnchor = (id) => {
				if (typeof id !== 'string') return false
				if (id.startsWith('goal:')) return goalIds.has(id.slice('goal:'.length))
				const [left, right] = id.split(':')
				return right !== undefined && right !== '' && forkIds.has(left)
			}
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
		 * **升格与证据等级自洽**。升格只在 `CloseGoal` 发生,条件是「支持等级 ≥ promote_at_level
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
			 * **升格发生在 `CloseGoal` 那一刻**。所以目标还开着时,「到级了却没升格」是**正常的**
			 * (还没到升格那一步),不能判违规——只判反方向:没到级就绝不该有升格。
			 */
			if (!closed) return { ok: promoted === 0, detail }
			return { ok: reached ? promoted >= 1 : promoted === 0, detail }
		},
	},
	{
		/**
		 * **异步子 run 的结论必须对模型可见**。
		 *
		 * 这条是「账上有、心里没有」的墓志铭:修好之前,侦察与执行者的结论只落在
		 * `meta.mutations` 里,模型可见文本中出现 0 次——于是模型的判据写成
		 * 「与侦察结论一致」时,它和独立评估者都无处可读,只能裁 inconclusive。
		 * 判据必须查**模型可见文本**,查账本等于什么都没查(这正是上一轮假绿的成因)。
		 */
		label: '异步子 run 的结论对模型可见(侦察与执行者都不许只躺在账本里)',
		run: ({ mutations, modelVisibleText }) => {
			const settled = [
				...mutations.filter((m) => m.t === 'scout/settled' && String(m.conclusion ?? '').trim() !== '').map((m) => ({ who: `侦察 ${m.id}`, text: String(m.conclusion) })),
				...mutations.filter((m) => m.t === 'worldline/executed' && m.ok === true && String(m.conclusion ?? '').trim() !== '').map((m) => ({ who: `执行者 ${m.branch}`, text: String(m.conclusion) })),
			]
			// 正文可能被截断后进消息(带指针),所以取开头一段做特征串再找。
			// 归一空白再比:同一段正文在账本里带换行、进消息时可能被重排,逐字节比会假红。
			const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()
			const visible = norm(modelVisibleText)
			const missing = settled.filter((item) => {
				const fingerprint = norm(item.text).slice(0, 120)
				return fingerprint !== '' && !visible.includes(fingerprint)
			})
			return {
				ok: missing.length === 0,
				detail: settled.length === 0 ? '(这一场没有异步子 run 的结论)' : `共 ${settled.length} 条,模型看不到 ${missing.length} 条:${missing.map((item) => item.who).join(',')}`,
			}
		},
	},
	{
		label: '侦察没有悬空(每个 scout/dispatched 都有 scout/settled)',
		run: ({ countOf }) => ({ ok: countOf('scout/dispatched') <= countOf('scout/settled'), detail: `dispatched=${countOf('scout/dispatched')} settled=${countOf('scout/settled')}` }),
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
 * `exists` / `called` / `memoryEntries` 由调用方注入:这一层不碰文件系统,
 * 才能被快测用合成上下文直接验(见 `test/e2e-scenarios.test.mjs`)。
 */
export async function evaluateLog({ scenario, events, mutations, workspace, exists, called, memoryEntries = 0 }) {
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
		memoryEntries,
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
