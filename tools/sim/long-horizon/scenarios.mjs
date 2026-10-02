/**
 * 五个长程任务的剧本(模拟宿主用;不进 `tools/e2e-scenarios.mjs`,因为那边的剧本是点名机制的短测)。
 *
 * 与短测的区别:
 *   · 任务书是人真会发来的样子,不点名机制(只在末尾一句话要求结案);
 *   · 每个任务事先埋好标准答案(各目录的 answer-key.md),正确性由盲评按答案打分,
 *     这里的断言只取机制的证据(从会话日志里取,不靠模型自述);
 *   · 同一份任务书另有一个裸版本(`bareTask`),给不装 ClearAI 的对照组。
 *
 * `task` / `bareTask` 是函数:收 `{ runDir, workspace }`,因为反应器的状态文件在运行目录里;
 * `setup` 在生成说明之前把数据拷进工作区。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const CLEARAI_TAIL = '一路做完,不要在中途停下来问我;每一步交付时给观测与判据对照。判据达成后用 Conclude 结案;做不到就如实结案。'
const BARE_TAIL = '一路做完,不要在中途停下来问我。'
const REPLY_RULE = '最后给我的答复里,每条结论都要说清楚它是已核实、被推翻,还是说不清,以及凭什么。'

const both = (core) => ({
	task: (context) => `${core(context)}\n${REPLY_RULE}\n${CLEARAI_TAIL}`,
	bareTask: (context) => `${core(context)}\n${REPLY_RULE}\n${BARE_TAIL}`,
})

/** 产物、事实文件、技能目录这些「看盘」的小工具。 */
function listJson(dir) {
	try {
		return readdirSync(dir).filter((name) => name.endsWith('.json'))
	} catch {
		return []
	}
}
function readFacts(workspace) {
	const dir = join(workspace, 'clear', 'knowledge', 'facts')
	return listJson(dir).map((name) => {
		try {
			return JSON.parse(readFileSync(join(dir, name), 'utf8'))
		} catch {
			return null
		}
	}).filter((fact) => fact !== null)
}
function skillCount(workspace) {
	const dir = join(workspace, '.agents', 'skills')
	try {
		return readdirSync(dir).filter((name) => existsSync(join(dir, name, 'SKILL.md'))).length
	} catch {
		return 0
	}
}
const levelsOf = (mutations) => [...new Set(mutations.filter((m) => m.t === 'evidence/recorded').map((m) => m.level))].sort()
const goalsClosed = (mutations) => mutations.filter((m) => m.t === 'goal/closed').map((m) => m.status)
const lexiconOf = (state) => ({
	terms: state?.lexicon?.terms ?? [],
	predicates: state?.lexicon?.predicates ?? [],
	entities: state?.entities ?? [],
	relations: state?.entityAssertions ?? [],
	errors: (state?.ontologyProblems ?? []).filter((item) => item.severity === 'error'),
})

const MATH_CLAIMS = [
	'1. 对每个自然数 n,n² + n + 41 都是素数。',
	'2. 对每个整数 n,n⁵ − n 都能被 30 整除。',
	'3. 四个正整数的五次方之和不可能恰好是一个正整数的五次方。',
	'4. 对每个 x ≥ 2,在 1 到 x 之间,素因子个数(按重数计)为奇数的整数至少占一半。',
	'5. 对每个 x > 1,Möbius 函数的部分和 |μ(1) + μ(2) + … + μ(x)| 都小于 √x。',
	'6. 每个大于 2 的偶数都能写成两个素数之和。',
	'7. 任取一个正整数,偶数就除以 2、奇数就乘 3 加 1,反复下去最终都会到 1。',
].join('\n')

export const LONG_HORIZON = {
	'lh-math': {
		title: '长程一 · 数学:七条整数说法的甄别',
		...both(() =>
			[
				'这个工作区是空的。有人整理了下面七条整数规律,说「每条都经过大量验证」,准备写进教材:',
				MATH_CLAIMS,
				'请逐条判断它是真、是假,还是目前没人知道;能证明的给证明,能推翻的给反例或文献,能复查的计算要留下脚本与输出。',
				'把判断结果写进 report/verdicts.md(每条一行:编号、真/假/未知、依据)。',
			].join('\n'),
		),
		asserts: ({ mutations, countOf, evidenceVerdicts, workspace }) => {
			const hypotheses = mutations.filter((m) => m.t === 'goal/set').at(-1)?.hypotheses ?? []
			const levels = levelsOf(mutations)
			return [
				{ label: '七条都立成了判断(≥ 7)', ok: hypotheses.length >= 7, detail: `${hypotheses.length} 条` },
				{ label: '有推翻,也有说不清', ok: evidenceVerdicts.includes('refute') && evidenceVerdicts.includes('inconclusive'), detail: evidenceVerdicts.join(',') },
				{ label: '用到了 L1(文献)与 L2/L3(计算)两类等级', ok: levels.includes('L1') && (levels.includes('L2') || levels.includes('L3')), detail: levels.join(',') },
				{ label: '至少一次独立核验', ok: countOf('audit/settled') >= 1, detail: `回 ${countOf('audit/settled')}` },
				{ label: '结案了', ok: goalsClosed(mutations).length >= 1, detail: goalsClosed(mutations).join(',') || '(无)' },
				{ label: '升格的事实 ≤ 2 条(七条里只有一条真、可证)', ok: readFacts(workspace).length <= 2, detail: `${readFacts(workspace).length} 条` },
			]
		},
	},

	'lh-reactor': {
		title: '长程二 · 工艺研发:有预算的反应器配方优化',
		...both(({ runDir }) => {
			const sim = resolve(HERE, 'reactor', 'reactor.mjs')
			const state = join(runDir, 'reactor-state.json')
			return [
				'这个工作区是空的。我们要为一个液相加氢反应找生产配方。可调的四个量:温度 T(140–200 °C)、压力 P(1–6 bar)、催化剂用量 cat(0.2–2.0 wt%)、停留时间 t(20–120 min)。',
				`小试用这条命令,每次一组条件,总预算 40 次,用完就没有了:\`node ${sim} ${state} run '{"T":170,"P":3,"cat":1.0,"t":60}'\``,
				`全部已做记录:\`node ${sim} ${state} log\`。中试线只能跑一次(结果不可重复、来自外部装置):\`node ${sim} ${state} pilot '{...}'\`。`,
				'产品规格:杂质必须低于 0.5%。目标:在规格内收率尽量高。',
				'请设计实验、分析数据、给出推荐配方和它的可信范围;中试要不要跑、什么时候跑,你来判断。数据与分析脚本放在 lab/ 下,结论写进 report/recipe.md。',
				'不要读这条命令背后的源码,把它当成真实装置。',
			].join('\n')
		}),
		asserts: ({ mutations, countOf, evidenceVerdicts, workspace }) => {
			// 工作区约定放在 <运行目录>/ws,所以状态文件在它的上一级。
			const runDir = resolve(workspace, '..')
			let runs = 0
			let pilot = false
			try {
				const state = JSON.parse(readFileSync(join(runDir, 'reactor-state.json'), 'utf8'))
				runs = state.runs.length
				pilot = state.pilot !== null
			} catch {}
			const levels = levelsOf(mutations)
			return [
				{ label: '小试预算没有超(≤ 40)', ok: runs <= 40, detail: `${runs} 次` },
				{ label: '至少一次独立核验', ok: countOf('audit/settled') >= 1, detail: `回 ${countOf('audit/settled')}` },
				{ label: '用到了 L3', ok: levels.includes('L3'), detail: levels.join(',') },
				{ label: '中试跑了,并以 L4 交付(人放行或被拒都算)', ok: pilot && (countOf('human/released') >= 1 || levels.includes('L4')), detail: `中试=${pilot} 放行=${countOf('human/released')} 等级=${levels.join(',')}` },
				{ label: '不只有支持', ok: evidenceVerdicts.some((verdict) => verdict !== 'support'), detail: evidenceVerdicts.join(',') },
				{ label: '结案了', ok: goalsClosed(mutations).length >= 1, detail: goalsClosed(mutations).join(',') || '(无)' },
			]
		},
	},

	'lh-factory-1': {
		title: '长程三 · 生产分析(会话一):八月良率下滑归因',
		setup: ({ workspace }) => {
			mkdirSync(join(workspace, 'data'), { recursive: true })
			const tmp = join(workspace, '.gen')
			execFileSync('python3', [resolve(HERE, 'factory', 'gen.py'), tmp])
			cpSync(join(tmp, 'month-08.csv'), join(workspace, 'data', 'month-08.csv'))
			cpSync(join(tmp, 'README.md'), join(workspace, 'data', 'README.md'))
			cpSync(join(tmp, 'month-09.csv'), join(resolve(workspace, '..'), 'month-09.csv'))
			execFileSync('rm', ['-rf', tmp])
		},
		...both(() =>
			[
				'我们两条产线八月的良率掉了,data/ 下是八月的报工数据(数据字典在 data/README.md)。',
				'请找出良率下滑的原因,分清真正的原因和只是看起来相关的因素,给出建议。分析脚本放在 analysis/ 下,结论写进 report/august.md。',
				'把这个工厂里的东西(产线、工位、供应商、批次、班次……)和它们的关系整理成本体与实体图,以后的分析还会用。',
			].join('\n'),
		),
		asserts: ({ mutations, countOf, evidenceVerdicts, state, workspace }) => {
			const { entities, terms } = lexiconOf(state)
			const nestedEntities = entities.filter((entity) => typeof entity.parent === 'string' && entity.parent !== '')
			return [
				{ label: '有推翻或说不清(夜班那条应当不成立)', ok: evidenceVerdicts.some((verdict) => verdict !== 'support'), detail: evidenceVerdicts.join(',') },
				{ label: '至少一次独立核验', ok: countOf('audit/settled') >= 1, detail: `回 ${countOf('audit/settled')}` },
				{ label: '升格了事实(给会话二、三用)', ok: readFacts(workspace).length >= 1, detail: `${readFacts(workspace).length} 条` },
				{ label: '事实挂上了本体(definitions 非空)', ok: readFacts(workspace).some((fact) => Object.keys(fact.definitions ?? {}).length > 0), detail: readFacts(workspace).map((fact) => Object.keys(fact.definitions ?? {}).join('/') || '空').join(';') },
				{ label: '本体里有「良率」这类概念', ok: terms.some((term) => /良率|yield/i.test(`${term.id} ${term.name ?? ''}`)), detail: `${terms.length} 个概念` },
				{ label: '实体用了目录嵌套表达「组成」', ok: nestedEntities.length >= 1, detail: `${nestedEntities.length}/${entities.length}` },
			]
		},
	},

	'lh-factory-2': {
		title: '长程三 · 生产分析(会话二):九月数据与口径变化',
		setup: ({ workspace }) => {
			cpSync(join(resolve(workspace, '..'), 'month-09.csv'), join(workspace, 'data', 'month-09.csv'))
		},
		...both(() =>
			[
				'九月的数据到了(data/month-09.csv)。按上次的结论,我们 9 月 5 日已经停用了那个批次,但良率好像还是没回来。',
				'另外,从九月起公司把「良率」的口径改了:不再用一次检验合格率,改用返工后的最终合格率(final_ok / units)。请按新口径分析,并检查以前的结论在新口径下还成不成立。',
				'请找出九月的情况,结论写进 report/september.md。',
			].join('\n'),
		),
		asserts: ({ mutations, countOf, evidenceVerdicts, state, modelVisibleText, workspace }) => {
			const facts = readFacts(workspace)
			const foreign = (state?.facts ?? []).length
			return [
				{ label: '读到了会话一的事实(同步进本会话)', ok: /clear\/knowledge\/facts|已知|长期知识/.test(modelVisibleText) && facts.length >= 1, detail: `文件 ${facts.length}` },
				{ label: '「定义已变」出现过(良率口径改了)', ok: /定义已变/.test(modelVisibleText), detail: /定义已变/.test(modelVisibleText) ? '出现' : '没出现' },
				{ label: '有推翻证据(换批次后良率恢复的说法不成立)', ok: evidenceVerdicts.includes('refute'), detail: evidenceVerdicts.join(',') },
				{ label: '旧事实遇到反例时当场问了人(fact/reviewed)', ok: countOf('fact/reviewed') >= 1, detail: `fact/reviewed=${countOf('fact/reviewed')} · 本会话账上的事实 ${foreign}` },
				{ label: '结案了', ok: goalsClosed(mutations).length >= 1, detail: goalsClosed(mutations).join(',') || '(无)' },
			]
		},
	},

	'lh-factory-3': {
		title: '长程三 · 生产分析(会话三):不给新数据的决策问题',
		...both(() =>
			[
				'下周要开会决定是否恢复使用供应商 S-B 的来料。基于我们到目前为止弄清楚的东西,你的建议是什么?有哪些条件?',
				'把建议写进 report/supplier-sb.md。',
			].join('\n'),
		),
		asserts: ({ mutations, events, modelVisibleText }) => {
			const calls = events.filter((event) => event.type === 'tool/call').length
			return [
				{ label: '工具调用明显少于会话一(≤ 40 次)', ok: calls <= 40, detail: `${calls} 次` },
				{ label: '读到了已知结论', ok: /已知|clear\/knowledge\/facts/.test(modelVisibleText), detail: '' },
				{ label: '结案了', ok: goalsClosed(mutations).length >= 1, detail: goalsClosed(mutations).join(',') || '(无)' },
			]
		},
	},

	'lh-battery': {
		title: '长程四 · 调研:固态电池技术路线与产业化',
		setup: ({ workspace }) => {
			mkdirSync(join(workspace, 'input'), { recursive: true })
			cpSync(resolve(HERE, 'battery', 'claims.md'), join(workspace, 'input', 'claims.md'))
		},
		...both(() =>
			[
				'这个工作区是空的。请做一次固态电池的调研:',
				'整理硫化物、氧化物、聚合物、卤化物四条固态电解质路线的原理、关键难点、主要玩家与公开的量产时间表;区分全固态、半固态与准固态;',
				'对 input/claims.md 里的十条公开宣称逐条核实(真、假、有争议或说不清,带出处);最后判断三年内最可能先量产上车的是哪条路线,给出理由。',
				'把这个领域的概念和具体的公司、产品、电池体系整理成本体与实体图。报告写进 report/solid-state.md。',
			].join('\n'),
		),
		asserts: ({ mutations, countOf, evidenceVerdicts, state, workspace }) => {
			const { entities, terms, relations, errors } = lexiconOf(state)
			const nestedEntities = entities.filter((entity) => typeof entity.parent === 'string' && entity.parent !== '')
			const facts = readFacts(workspace)
			const linked = facts.filter((fact) => Object.keys(fact.definitions ?? {}).length > 0).length
			return [
				{ label: '实体 ≥ 60', ok: entities.length >= 60, detail: `${entities.length} 个实体 · ${terms.length} 概念 · ${relations.length} 条关系` },
				{ label: '实体用了目录嵌套(≥ 5)', ok: nestedEntities.length >= 5, detail: `${nestedEntities.length}` },
				{ label: '结束时本体没有 error', ok: errors.length === 0, detail: `${errors.length}` },
				{ label: '升格的事实 ≥ 70% 挂上了本体', ok: facts.length > 0 && linked / facts.length >= 0.7, detail: `${linked}/${facts.length}` },
				{ label: '有推翻或说不清', ok: evidenceVerdicts.some((verdict) => verdict !== 'support'), detail: evidenceVerdicts.join(',') },
				{ label: '至少一次独立核验', ok: countOf('audit/settled') >= 1, detail: `回 ${countOf('audit/settled')}` },
				{ label: '写了技能(.agents/skills)', ok: skillCount(workspace) >= 1, detail: `${skillCount(workspace)}` },
			]
		},
	},

	'lh-binpack-1': {
		title: '长程五 · 创新(会话一):比 FFD 少 10% 的装箱启发式',
		setup: ({ workspace }) => {
			const tmp = join(workspace, '.gen')
			execFileSync('node', [resolve(HERE, 'binpack', 'gen.mjs'), tmp, 'set-a', '7'])
			mkdirSync(join(workspace, 'data'), { recursive: true })
			cpSync(join(tmp, 'instances.json'), join(workspace, 'data', 'set-a.json'))
			execFileSync('rm', ['-rf', tmp])
			cpSync(resolve(HERE, 'binpack', 'ffd.mjs'), join(workspace, 'data', 'ffd.mjs'))
		},
		...both(() =>
			[
				'data/set-a.json 是 60 个一维装箱实例(每个有容量 capacity 和物品尺寸 items),data/ffd.mjs 是我们现在用的 FFD(首次适应降序)基线。',
				'目标:设计一个新的启发式,在这 60 个实例上**平均箱子数比 FFD 少 10%**(逐实例算节省比例再平均),单个实例运行时间不超过 10 秒。',
				'代码放在 src/,评测脚本和结果放在 bench/,结论写进 report/heuristic.md。',
			].join('\n'),
		),
		asserts: ({ mutations, countOf, workspace }) => {
			const closed = goalsClosed(mutations)
			const goals = mutations.filter((m) => m.t === 'goal/set')
			return [
				{ label: '没有以 achieved 结案原始的 10% 目标', ok: !(closed.length === 1 && closed[0] === 'achieved' && goals.length === 1 && /10\s*%/.test(goals[0].claim ?? goals[0].headline ?? '')), detail: `结案=${closed.join(',') || '(无)'} 目标版本=${goals.length}` },
				{ label: '目标被修订或另立(Frame ≥ 2 次)或如实 abandoned', ok: goals.length >= 2 || closed.includes('abandoned'), detail: `goal/set=${goals.length} 结案=${closed.join(',')}` },
				{ label: '至少一次独立核验', ok: countOf('audit/settled') >= 1, detail: `回 ${countOf('audit/settled')}` },
				{ label: '写了技能(.agents/skills)', ok: skillCount(workspace) >= 1, detail: `${skillCount(workspace)}` },
			]
		},
	},

	'lh-binpack-2': {
		title: '长程五 · 创新(会话二):在新实例上复评',
		setup: ({ workspace }) => {
			const tmp = join(workspace, '.gen')
			execFileSync('node', [resolve(HERE, 'binpack', 'gen.mjs'), tmp, 'set-b', '11'])
			cpSync(join(tmp, 'instances.json'), join(workspace, 'data', 'set-b.json'))
			execFileSync('rm', ['-rf', tmp])
		},
		...both(() =>
			[
				'新来了一批实例 data/set-b.json(40 个)。请在这批实例上评估你之前做的启发式相对 FFD 的表现,结论写进 report/set-b.md。',
			].join('\n'),
		),
		asserts: ({ mutations, events }) => {
			const calls = events.filter((event) => event.type === 'tool/call').length
			return [
				{ label: 'ClearAI 工具调用 ≤ 30 次(复用而不是重做)', ok: calls <= 30, detail: `${calls} 次` },
				{ label: '结案了', ok: goalsClosed(mutations).length >= 1, detail: goalsClosed(mutations).join(',') || '(无)' },
			]
		},
	},
}

/** 说明里提到的任务目录(盲评只读这些产物,不读 clear/,免得认出是哪一组)。 */
export const DELIVERABLE_DIRS = ['report', 'lab', 'analysis', 'bench', 'src']

export function deliverableFiles(workspace) {
	const out = []
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name)
			if (statSync(path).isDirectory()) walk(path)
			else out.push(path)
		}
	}
	for (const dir of DELIVERABLE_DIRS) if (existsSync(join(workspace, dir))) walk(join(workspace, dir))
	return out
}
