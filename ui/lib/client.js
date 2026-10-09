/**
 * clearai-dsh —— 浏览器半(ClearAI 的面板)。
 *
 * 它注册三个座位:
 *   中栏 `conversation.view`    探索(问题 → 候选假设 → 下一步;过程记录里有判断列表与计划的世界树)
 *   中栏 `conversation.view`    本体(结论四部分 + 本体图 / 实体图 + 已确立的事实 + 经验)
 *   输入框 `conversation.input`  计划芯片(「问题 1/2 · 待检验假设 N 个」+ 「待处理 N」,点击打开探索货架)
 * 交付与文件改动走 DSH 原生的卡片,技能走原生技能目录,这里都不另做一份。
 * 面板**只读**:没有写入口。要人拍板的事由开门的那次工具调用当场问人;「立为问题 / 暂缓」只替人往对话里发一句话。
 *
 * 面板自己不取数、不重算:宿主半注册的**会话投影单元** `clearai`(见 `lib/index.js`)把算好的
 * 视图推下来,`useProjection('clearai')` 读它。投影为空(`undefined`)时渲染平静的空态,
 * 绝不抛错、不显示堆栈。
 */

window.__ModuleLoader__.load({
	id: 'clearai-dsh',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		/**
		 * **图渲染交给 React Flow**(`@xyflow/react`)。
		 *
		 * 它由 `tools/build-vendor.mjs` 打包成 `ui/vendor/xyflow.js`,build 时与这一文件
		 * **拼成同一份** lib/client.js——于是它是一个**同作用域的函数**,不是模块行。
		 *
		 * 为什么不做成模块行:模块系统的 `require` 只认**平台种子字**(react 之类)
		 * 与**启动图里的行**;运行时动态 `load()` 的行不在启动图里,`require` 会直接不认。
		 * 声明成函数就绕开了整张表,而它内部的 `require('react')` 绑定的正是宿主给工厂的那个。
		 *
		 * 拿不到时不炸整块面板:**把真实原因也说出来**——只说「不可用」而不说为什么,
		 * 读的人(和下一次修它的人)就得自己猜。原因同时进 console,便于排查。
		 *
		 * 判「有没有」**不能写 `typeof === 'function'`**:React 的组件可以是函数、也可以是
		 * `forwardRef` / `memo` 造出来的**对象**(v12 的 `ReactFlow` 正是 `forwardRef` 对象)。
		 * 按函数判会把一个完全合法的组件判成不可用——而这个错会伪装成「依赖没装上」。
		 */
		const XYFLOW_LOAD = (() => {
			try {
				if (typeof __clearaiXyflow !== 'function') return { module: null, reason: 'vendor 没打进来(ui/vendor/xyflow.js 缺失?)' }
				return { module: __clearaiXyflow(require), reason: null }
			} catch (error) {
				const reason = String(error?.message ?? error).slice(0, 160)
				try {
					console.warn('[clearai] React Flow 加载失败:', error)
				} catch {
					/* console 不在也不该让面板挂掉 */
				}
				return { module: null, reason }
			}
		})()
		const XYFlow = XYFLOW_LOAD.module

		/**
		 * **原生图标**(与本体页签同一族):dsh 右栏页签的 guide 吃一个 `icon` 组件,原生那几张页签用的是
		 * `@deepseek-ai/dsh-client-ui-primitives` 里那套(文件页签 = FileTypeIcon ✓)。
		 * 我们照同一套用,于是"面包屑"与"世界树"在视觉上属于同一个家族。
		 *
		 * 拿不到那个模块时**不报错**:`icon` 留空,原生会用它自己的默认字形——
		 * 图标是装饰,不该让整块面板挂掉(与我们"降级要如实、不要崩"同一条纪律)。
		 */
		const NATIVE_ICONS = (() => {
			try {
				return require('@deepseek-ai/dsh-client-ui-primitives')
			} catch {
				return {}
			}
		})()
		const h = React.createElement
		/**
		 * **我们自己的标记**(与 `brand/logo.svg` 同一几何:开口的 c + 一颗事实点)。
		 *
		 * 为什么可以自画:右栏页签的 `guide.icon` 收的就是一个**组件**(原生那几张页签传的也是组件)。
		 * 之前我们借的是原生 `IconBranchOutline16` / `IconSkillOutline16` —— 那时讲的是"与原生同族";
		 * 现在这两个页签是我们自己的面,带我们自己的记号更诚实(它是 ClearAI 的面,不是宿主的面)。
		 *
		 * 几何是**主源里那一份**,不为小尺寸重画:16px 是品牌规则的唯一裁判(开口朝右上 -35°、
		 * 点在开口里、主笔 currentColor、点固定 emerald)。取不到标记组件时页面照常(它只是装饰)。
		 */
		const ClearAIMark = ({ size = 14, className }) =>
			h(
				'svg',
				{ viewBox: '0 0 1024 1024', width: size, height: size, className, fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
				h('circle', { cx: 512, cy: 512, r: 326, stroke: 'currentColor', strokeWidth: 118, pathLength: 360, strokeDasharray: '270 90', strokeLinecap: 'round', transform: 'rotate(10 512 512)' }),
				h('circle', { cx: 792, cy: 308, r: 104, fill: '#10B981' }),
			)
		/**
		 * 惰性表:语言是**运行时**的事,而这些表在模块加载时就被求值了——直接写 `t(...)`
		 * 会把语言冻在加载那一刻(失效模式:面板标题跟着语言换了,表里的词还停在中文)。
		 * 这个代理每次取键都重新求值,读起来仍与普通对象一样。
		 */
		const lazyTable = (make) =>
			new Proxy(
				{},
				{
					get: (_target, key) => make()[key],
					has: (_target, key) => key in make(),
					ownKeys: () => Reflect.ownKeys(make()),
					getOwnPropertyDescriptor: (_target, key) => ({ configurable: true, enumerable: true, value: make()[key] }),
				},
			)

		/** 语言命名空间。表按**源文**索引:键就是中文原文,所以漏翻译一条只会退回中文,不会把 key 显示给人。 */
		const LOCALE_NS = 'clearai'
		const LOCALE_ZH = {"待执行":"待执行","已交付":"已交付","已作废":"已作废","支持":"支持","推翻":"推翻","不确定":"不确定","第 n 步":"第 n 步","判据:":"判据:","判据":"判据"," · 已修订 ":" · 已修订 "," 次":" 次"," · 最近一次修订的独立裁决:":" · 最近一次修订的独立裁决:","打开目标文档(原生预览)":"打开目标文档(原生预览)","全文在 ":"全文在 ","背景(不参与判定):":"背景(不参与判定):","目标":"目标","命题":"命题","计划":"计划","验证":"验证","观测":"观测","评估":"评估","证据":"证据","事实":"事实","批准":"批准","未解释":"未解释","评估卡":"评估卡","查看评估者":"查看评估者","审批记录":"审批记录","产物":"产物","已验证":"已验证","待核验":"待核验","验证中":"验证中","已推翻":"已推翻","已替换":"已替换","自行检验":"自行检验","独立核验":"独立核验","人工批准":"人工批准","判断":"判断","检验":"检验","纳入本体":"纳入本体","下一步:安排步骤对其进行检验":"下一步:安排步骤对其进行检验","下一步:通过独立核验后标记为已验证":"下一步:通过独立核验后标记为已验证","下一步:改用其他方法重新检验":"下一步:改用其他方法重新检验","下一步:结案时写入长期知识":"下一步:结案时写入长期知识","陈述":"陈述","数值":"数值","公式":"公式","代码":"代码","引用":"引用","概念":"概念","取值形态":"取值形态","实例":"实例","取值":"取值","关系":"关系","在检验阶段被推翻,不再推进。":"在检验阶段被推翻,不再推进。","已被替换,不再推进。":"已被替换,不再推进。","提出":"提出","单步检验":"单步检验",":":":","写入长期知识":"写入长期知识","人工撤回":"人工撤回","进度":"进度","可信度变化":"可信度变化","补充说明":"补充说明","依据":"依据","查看核验":"查看核验","查看记录":"查看记录","范围":"范围","推翻条件":"推翻条件","相关":"相关","在图中定位":"在图中定位","来源":"来源","收起":"收起","点击查看进度与来源":"点击查看进度与来源","暂无结论。模型提出判断后,将在此逐条列出。":"暂无结论。模型提出判断后,将在此逐条列出。","尚未设立目标":"尚未设立目标","暂无内容。发送第一条消息后,此处将显示本体图与结论。":"暂无内容。发送第一条消息后,此处将显示本体图与结论。","仅显示与「":"仅显示与「","」相关的内容":"」相关的内容","清除":"清除","已确立的事实":"已确立的事实","暂无已确立的事实。判断经检验与独立核验后,将在此列出;检验过程见探索货架。":"暂无已确立的事实。判断经检验与独立核验后,将在此列出;检验过程见探索货架。","经验(":"经验(",")":")","广度调研":"广度调研","定向求解":"定向求解","先调研后求解":"先调研后求解","考察中":"考察中","已排除":"已排除","已采纳":"已采纳","暂不考察":"暂不考察","未开始":"未开始","调研中":"调研中","已厘清":"已厘清","常见误区":"常见误区","前置核查":"前置核查","不可取的捷径":"不可取的捷径","先验知识":"先验知识","提出依据":"提出依据","未注明(直觉)":"未注明(直觉)","直觉":"直觉","本体关系「":"本体关系「","」":"」","主张":"主张","预测":"预测","排除依据":"排除依据","采纳依据":"采纳依据","关联记录":"关联记录","支持 ":"支持 "," 条 · 推翻 ":" 条 · 推翻 "," 条 · 无法判定 ":" 条 · 无法判定 "," 条":" 条","在本体货架中展开此结论":"在本体货架中展开此结论","已得出结论 · 查看结论":"已得出结论 · 查看结论","已暂缓":"已暂缓","新发现,待您决定":"新发现,待您决定","尚无候选假设":"尚无候选假设","候选假设 ":"候选假设 "," 个:":" 个:","问题 ":"问题 ","候选假设":"候选假设","展开":"展开","已请求立为问题,待模型修订立题后生效。":"已请求立为问题,待模型修订立题后生效。","已请求暂缓,结案时列入「尚未确定的事项」。":"已请求暂缓,结案时列入「尚未确定的事项」。","无法自动发送,请在对话中说明。":"无法自动发送,请在对话中说明。","新发现的问题":"新发现的问题","请将新发现的问题「":"请将新发现的问题「","」立为问题深入研究(问题 ":"」立为问题深入研究(问题 ",")。":")。","立为问题":"立为问题","请暂缓问题「":"请暂缓问题「","」(问题 ":"」(问题 ","),结案时列入「尚未确定的事项」。":"),结案时列入「尚未确定的事项」。","暂缓":"暂缓","调研板块":"调研板块","判断 ":"判断 "," 条 · 已采纳 ":" 条 · 已采纳 ","未解释的现象 ":"未解释的现象 "," 项":" 项","下一步":"下一步","预测:":"预测:","若「":"若「","」成立,预测":"」成立,预测","各候选假设的预测相同,此步骤无法区分它们。":"各候选假设的预测相同,此步骤无法区分它们。","如需调整计划,请在对话中说明。":"如需调整计划,请在对话中说明。","未解释的现象(":"未解释的现象(","结案前须解释、排除或写入「尚未确定的事项」":"结案前须解释、排除或写入「尚未确定的事项」","独立评估发现":"独立评估发现","涉及:":"涉及:","、":"、","暂无内容。发送第一条消息后,此处将显示问题、候选假设与下一步。":"暂无内容。发送第一条消息后,此处将显示问题、候选假设与下一步。","尚未设立目标。模型立题后,此处将显示问题、候选假设与下一步。":"尚未设立目标。模型立题后,此处将显示问题、候选假设与下一步。","阶段 · ":"阶段 · ","调研板块 ":"调研板块 "," 个 · 已厘清 ":" 个 · 已厘清 "," 个":" 个","当前问题 ":"当前问题 "," / 共 ":" / 共 ","计划 已完成 ":"计划 已完成 "," / ":" / "," 步":" 步","独立评估 ":"独立评估 ","计划共 ":"计划共 ","(":"(","进行中)":"进行中)","课题":"课题","待您处理(":"待您处理(","过程记录":"过程记录","结论":"结论","未能回答:":"未能回答:","查看探索记录":"查看探索记录","尚未确定的事项":"尚未确定的事项","待您决策":"待您决策","不适用:":"不适用:","暂无计划。建立计划后,此处将显示计划的步骤与闸门。":"暂无计划。建立计划后,此处将显示计划的步骤与闸门。","切换到以前的计划(计划均保留,文档归档在 clear/goals/plans/)":"切换到以前的计划(计划均保留,文档归档在 clear/goals/plans/)","计划 ":"计划 ","已完成 · 可查看存档":"已完成 · 可查看存档","步 ":"步 ","打开计划文档(原生预览)":"打开计划文档(原生预览)","计划文档":"计划文档","点击查看详情":"点击查看详情","查看步骤详情":"查看步骤详情"," 轮":" 轮","已派出评估者 ":"已派出评估者 ","收起详情":"收起详情","任务内容":"任务内容","状态":"状态","未声明":"未声明","磁盘上未找到该文件":"磁盘上未找到该文件","(缺失)":"(缺失)","在原生预览中打开":"在原生预览中打开","在原生预览中打开(计划声明的产物)":"在原生预览中打开(计划声明的产物)","查看此步骤的证据":"查看此步骤的证据","检验结果:":"检验结果:","独立核验:":"独立核验:","正在裁决":"正在裁决"," 查看核验过程":" 查看核验过程"," 查看核验记录":" 查看核验记录","待处理":"待处理","板块 ":"板块 "," · ":" · "," 个问题待您决定":" 个问题待您决定"," · 待检验假设 ":" · 待检验假设 ","计划受阻,待人工处理":"计划受阻,待人工处理","计划已收尾(":"计划已收尾("," 步)":" 步)","计划已交付 ":"计划已交付 ","待处理 ":"待处理 ","(点击打开探索货架)":"(点击打开探索货架)","仅显示相关项":"仅显示相关项","关闭":"关闭","正在加载…":"正在加载…","无法获取":"无法获取","该项已不在当前词表中(可能已被废止)。":"该项已不在当前词表中(可能已被废止)。","释义":"释义","上位":"上位","下位":"下位","主体":"主体","类型":"类型","该术语已废止,既有结论中的用法仍可查看。":"该术语已废止,既有结论中的用法仍可查看。","引用此项的结论":"引用此项的结论","有矛盾":"有矛盾","范围:":"范围:","展开下一层":"展开下一层","收起下一层":"收起下一层","共 ":"共 "," 条断言的主体尚未建立实体文件。":" 条断言的主体尚未建立实体文件。","实体图暂无内容。":"实体图暂无内容。","clear/ontology/entities/ 下的实体文件与写入长期知识的断言将在此显示。":"clear/ontology/entities/ 下的实体文件与写入长期知识的断言将在此显示。","本体图暂无内容。模型在 clear/ontology/concepts/ 与 relations/ 下建立概念与关系文件后,将在此显示。":"本体图暂无内容。模型在 clear/ontology/concepts/ 与 relations/ 下建立概念与关系文件后,将在此显示。","本体图":"本体图","实体图":"实体图","矛盾":"矛盾","适配":"适配","退出全屏":"退出全屏","全屏":"全屏","图组件不可用":"图组件不可用","结论仍可正常查看。":"结论仍可正常查看。","本体文件有 ":"本体文件有 "," 项问题(不纳入图中)":" 项问题(不纳入图中)","已提出":"已提出","探索":"探索","本体":"本体","clearai-loop: 席位跟着会话预设进出":"clearai-loop: 席位跟着会话预设进出","适用":"适用","超出适用范围":"超出适用范围","超出取值范围":"超出取值范围","本次条件未声明":"本次条件未声明","条目未声明适用范围":"条目未声明适用范围","口径已变更":"口径已变更","已撤回":"已撤回","本次不能直接沿用,需重新检验":"本次不能直接沿用,需重新检验","补充本次条件后重新判定":"补充本次条件后重新判定","沿用时需自行确认":"沿用时需自行确认","按新口径换算或重新检验":"按新口径换算或重新检验","先复检再沿用":"先复检再沿用","不得沿用":"不得沿用","已确立":"已确立","初步排除":"初步排除","测量或方法缺陷":"测量或方法缺陷","已解释":"已解释","已判定无关":"已判定无关","已提交您处理":"已提交您处理","请求复检":"请求复检","请复检条目「":"请复检条目「","」(":"」(","请求撤回":"请求撤回","请撤回条目「":"请撤回条目「","),并说明对已有结论的影响。":"),并说明对已有结论的影响。","请求修改适用范围":"请求修改适用范围","请与我确认条目「":"请与我确认条目「",")的适用范围应如何修改。":")的适用范围应如何修改。","推翻证据 ":"推翻证据 "," · 独立核验 ":" · 独立核验 ","受质疑":"受质疑","已发送请求,由模型处理后更新。":"已发送请求,由模型处理后更新。","适用边界":"适用边界","测量与口径":"测量与口径","校准关系":"校准关系","未解释的现象":"未解释的现象","经验":"经验","该实体暂无沉淀的知识。":"该实体暂无沉淀的知识。","引用的已有知识(":"引用的已有知识(","引用的已有知识":"引用的已有知识","引用者:":"引用者:","将沉淀的内容":"将沉淀的内容","已写入的排除与未解释项;结案时待独立核验的结论":"已写入的排除与未解释项;结案时待独立核验的结论","待独立核验":"待独立核验","已确立 ":"已确立 ","已排除 ":"已排除 ","未解释 ":"未解释 ","经验 ":"经验 ","本次沉淀":"本次沉淀","点击查看可发出的请求":"点击查看可发出的请求","初步排除(":"初步排除(","测量或方法缺陷 ":"测量或方法缺陷 "}
		const LOCALE_EN = {"待执行":"to do","已交付":"delivered","已作废":"voided","支持":"Support","推翻":"Refute","不确定":"Uncertain","第 n 步":"Step n","判据:":"Criterion: ","判据":"Criterion"," · 已修订 ":" · revised "," 次":" times"," · 最近一次修订的独立裁决:":" · latest revision decided by an independent verdict: ","打开目标文档(原生预览)":"Open the goal document (native preview)","全文在 ":"Full text at ","背景(不参与判定):":"Background (not part of the verdict): ","目标":"Goal","命题":"Propositions","计划":"Plan","验证":"Verification","观测":"Observation","评估":"Evaluation","证据":"Evidence","事实":"Facts","批准":"approval","未解释":"Unexplained","评估卡":"evaluation card","查看评估者":"view evaluator","审批记录":"approval record","产物":"Deliverables","已验证":"Verified","待核验":"Awaiting check","验证中":"Testing","已推翻":"Refuted","已替换":"Replaced","自行检验":"Self-tested","独立核验":"Independent check","人工批准":"Approved by a person","判断":"Judgment","检验":"Test","纳入本体":"In ontology","下一步:安排步骤对其进行检验":"Next: schedule a step to test it","下一步:通过独立核验后标记为已验证":"Next: marked Verified after an independent check","下一步:改用其他方法重新检验":"Next: test it again by another method","下一步:结案时写入长期知识":"Next: written to long-term knowledge at close","陈述":"Statement","数值":"Quantity","公式":"Formula","代码":"Code","引用":"Reference","概念":"concepts","取值形态":"Value form","实例":"Instances","取值":"Value","关系":"Relation","在检验阶段被推翻,不再推进。":"Refuted at the test stage; it goes no further.","已被替换,不再推进。":"Replaced; it goes no further.","提出":"Proposed","单步检验":"A single test",":":": ","写入长期知识":"Written to long-term knowledge","人工撤回":"Withdrawn by a person","进度":"Progress","可信度变化":"Trust history","补充说明":"Details","依据":"Basis","查看核验":"View check","查看记录":"View record","范围":"Scope","推翻条件":"Refuted if","相关":"Related","在图中定位":"Locate on the graph","来源":"Source","收起":"Collapse","点击查看进度与来源":"Click to view progress and source","暂无结论。模型提出判断后,将在此逐条列出。":"No judgments yet. Each judgment the model proposes is listed here.","尚未设立目标":"No goal set yet","暂无内容。发送第一条消息后,此处将显示本体图与结论。":"Nothing yet. After the first message, the ontology graph and conclusions appear here.","仅显示与「":"Showing only items related to \"","」相关的内容":"\"","清除":"Clear","已确立的事实":"ESTABLISHED FACTS","暂无已确立的事实。判断经检验与独立核验后,将在此列出;检验过程见探索货架。":"No established facts yet. Judgments appear here once tested and independently checked; the testing process is in the Explore shelf.","经验(":"LESSONS (",")":")","广度调研":"Broad survey","定向求解":"Targeted solving","先调研后求解":"Survey, then solve","考察中":"Being examined","已排除":"Excluded","已采纳":"Adopted","暂不考察":"Set aside","未开始":"Not started","调研中":"In progress","已厘清":"Clarified","常见误区":"Common pitfall","前置核查":"Check first","不可取的捷径":"Misleading shortcut","先验知识":"Prior knowledge","提出依据":"Proposed from","未注明(直觉)":"Not stated (intuition)","直觉":"Intuition","本体关系「":"Ontology relation \"","」":"\"","主张":"Claim","预测":"Prediction","排除依据":"Grounds for exclusion","采纳依据":"Grounds for adoption","关联记录":"Related records","支持 ":"Support "," 条 · 推翻 ":" · refute "," 条 · 无法判定 ":" · inconclusive "," 条":"","在本体货架中展开此结论":"Expand this conclusion in the Ontology shelf","已得出结论 · 查看结论":"Concluded · view the conclusion","已暂缓":"Parked","新发现,待您决定":"Newly found, awaiting your decision","尚无候选假设":"No candidate hypotheses yet","候选假设 ":"Candidate hypotheses: "," 个:":" — ","问题 ":"Question ","候选假设":"Candidate hypotheses","展开":"Expand","已请求立为问题,待模型修订立题后生效。":"Requested as a question; it takes effect once the model revises the framing.","已请求暂缓,结案时列入「尚未确定的事项」。":"Requested to park; it will be listed under open points at conclusion.","无法自动发送,请在对话中说明。":"Could not send automatically; please say it in the conversation.","新发现的问题":"Newly found question","请将新发现的问题「":"Please make the newly found question \"","」立为问题深入研究(问题 ":"\" a question to pursue (question ",")。":").","立为问题":"Make it a question","请暂缓问题「":"Please park the question \"","」(问题 ":"\" (question ","),结案时列入「尚未确定的事项」。":") and list it under open points at conclusion.","暂缓":"Park","调研板块":"Survey areas","判断 ":"Judgments: "," 条 · 已采纳 ":" · adopted ","未解释的现象 ":"Unexplained observations: "," 项":"","下一步":"Next step","预测:":"Prediction: ","若「":"If \"","」成立,预测":"\" holds, the prediction is","各候选假设的预测相同,此步骤无法区分它们。":"All candidate hypotheses predict the same result, so this step cannot tell them apart.","如需调整计划,请在对话中说明。":"To change the plan, say so in the conversation.","未解释的现象(":"Unexplained observations (","结案前须解释、排除或写入「尚未确定的事项」":"Before concluding, each must be explained, ruled out, or written into the open points","独立评估发现":"Found by the independent evaluator","涉及:":"Concerns: ","、":", ","暂无内容。发送第一条消息后,此处将显示问题、候选假设与下一步。":"Nothing yet. After the first message, questions, candidate hypotheses and the next step appear here.","尚未设立目标。模型立题后,此处将显示问题、候选假设与下一步。":"No goal set yet. Once the model frames the goal, questions, candidate hypotheses and the next step appear here.","阶段 · ":"Mode · ","调研板块 ":"Survey areas: "," 个 · 已厘清 ":" · clarified "," 个":"","当前问题 ":"Current question "," / 共 ":" of ","计划 已完成 ":"Plan: completed "," / ":" / "," 步":" steps","独立评估 ":"Independent evaluations: ","计划共 ":"Plan: ","(":" (","进行中)":" in progress)","课题":"Topic","待您处理(":"Awaiting you (","过程记录":"Process record","结论":"Conclusion","未能回答:":"Could not be answered: ","查看探索记录":"View the exploration record","尚未确定的事项":"Open points","待您决策":"For you to decide","不适用:":"Does not apply: ","暂无计划。建立计划后,此处将显示计划的步骤与闸门。":"No plan yet. Once a plan is created, its steps and gates appear here.","切换到以前的计划(计划均保留,文档归档在 clear/goals/plans/)":"Switch to an earlier plan (all plans are kept; documents are archived under clear/goals/plans/)","计划 ":"Plan ","已完成 · 可查看存档":"closed · archive available","步 ":"step ","打开计划文档(原生预览)":"Open the plan document (native preview)","计划文档":"Plan document","点击查看详情":"click for details","查看步骤详情":"view step details"," 轮":" rounds","已派出评估者 ":"Evaluators dispatched: ","收起详情":"Collapse details","任务内容":"Task","状态":"Status","未声明":"not declared","磁盘上未找到该文件":"this file was not found on disk","(缺失)":" (missing)","在原生预览中打开":"Open in the native preview","在原生预览中打开(计划声明的产物)":"Open in the native preview (an artifact declared by the plan)","查看此步骤的证据":"see the evidence for this step","检验结果:":"Result: ","独立核验:":"Independent check: ","正在裁决":"Deciding"," 查看核验过程":" View the review"," 查看核验记录":" View the review record","待处理":"To handle","板块 ":"Areas "," · ":" · "," 个问题待您决定":" question(s) awaiting your decision"," · 待检验假设 ":" · hypotheses to test: ","计划受阻,待人工处理":"plan blocked, awaiting a person","计划已收尾(":"Plan closed ("," 步)":" steps)","计划已交付 ":"Plan delivered ","待处理 ":"to handle ","(点击打开探索货架)":" (click to open the Explore shelf)","仅显示相关项":"Related only","关闭":"Close","正在加载…":"Loading…","无法获取":"Unavailable","该项已不在当前词表中(可能已被废止)。":"This item is no longer in the vocabulary (it may have been deprecated).","释义":"Gloss","上位":"Broader","下位":"Narrower","主体":"Subject","类型":"Type","该术语已废止,既有结论中的用法仍可查看。":"This term is deprecated; its use in existing conclusions remains readable.","引用此项的结论":"Conclusions citing it","有矛盾":"Conflicting","范围:":"Scope: ","展开下一层":"Expand the next level","收起下一层":"Collapse the next level","共 ":""," 条断言的主体尚未建立实体文件。":" assertion subjects have no entity file yet. ","实体图暂无内容。":"The entity graph is empty. ","clear/ontology/entities/ 下的实体文件与写入长期知识的断言将在此显示。":"Entity files under clear/ontology/entities/ and assertions in long-term knowledge appear here.","本体图暂无内容。模型在 clear/ontology/concepts/ 与 relations/ 下建立概念与关系文件后,将在此显示。":"The ontology graph is empty. Concepts and relations appear once the model creates files under clear/ontology/concepts/ and relations/.","本体图":"Ontology graph","实体图":"Entity graph","矛盾":"Conflicts","适配":"Fit","退出全屏":"Exit full screen","全屏":"Full screen","图组件不可用":"The graph component is unavailable","结论仍可正常查看。":"conclusions remain readable.","本体文件有 ":"Ontology files have "," 项问题(不纳入图中)":" problems (kept off the graph)","已提出":"proposed","探索":"Explore","本体":"Ontology","clearai-loop: 席位跟着会话预设进出":"clearai-loop: seats come and go with the session's preset","适用":"Applies","超出适用范围":"Outside its scope","超出取值范围":"Outside its value range","本次条件未声明":"Conditions of this run not declared","条目未声明适用范围":"Item declares no scope","口径已变更":"Definition changed","已撤回":"Retracted","本次不能直接沿用,需重新检验":"Cannot be reused as is here; test it again","补充本次条件后重新判定":"Declare this run's conditions, then judge again","沿用时需自行确认":"Confirm it applies before reusing it","按新口径换算或重新检验":"Convert to the new definition or test it again","先复检再沿用":"Re-check it before reusing it","不得沿用":"Must not be reused","已确立":"Established","初步排除":"Preliminarily excluded","测量或方法缺陷":"Measurement or method defect","已解释":"Explained","已判定无关":"Ruled irrelevant","已提交您处理":"Handed to you","请求复检":"Request a re-check","请复检条目「":"Please re-check the item \"","」(":"\" (","请求撤回":"Request retraction","请撤回条目「":"Please retract the item \"","),并说明对已有结论的影响。":") and state the effect on existing conclusions.","请求修改适用范围":"Request a scope change","请与我确认条目「":"Please confirm with me how the scope of the item \"",")的适用范围应如何修改。":") should be changed.","推翻证据 ":"Refuting evidence: "," · 独立核验 ":" · independently checked: ","受质疑":"Challenged","已发送请求,由模型处理后更新。":"Request sent; it updates once the model handles it.","适用边界":"Limits of applicability","测量与口径":"Measurement and definitions","校准关系":"Calibration","未解释的现象":"Unexplained observations","经验":"Lessons","该实体暂无沉淀的知识。":"No knowledge has been recorded for this entity yet.","引用的已有知识(":"Existing knowledge cited (","引用的已有知识":"Existing knowledge cited","引用者:":"Cited by: ","将沉淀的内容":"To be recorded","已写入的排除与未解释项;结案时待独立核验的结论":"Exclusions and unexplained items already written; conclusions awaiting an independent check at close","待独立核验":"Awaiting independent check","已确立 ":"Established: ","已排除 ":"Excluded: ","未解释 ":"Unexplained: ","经验 ":"Lessons: ","本次沉淀":"Recorded this time","点击查看可发出的请求":"Click to see the requests you can send","初步排除(":"Preliminarily excluded (","测量或方法缺陷 ":"Measurement or method defects: "}

		/**
		 * 翻译函数:**由原生 locale 座位绑定**(`ctx.locale.bind`),不是我们自建的一套 i18n。
		 * 座位不在(老宿主 / 测试桩)时退化成恒等函数 —— 面板照常显示中文,不会炸。
		 */
		let localeBound = (key) => key
		const t = (key) => localeBound(key)
		/** 语言变了要让组件重画:订阅者集合 + 一个极小的外部 store。 */
		const localeListeners = new Set()
		/** 语言变了需要**重新注册**的那些座位(标签在注册时求值)。 */
		const localeResyncs = new Set()
		function useLocaleTick() {
			const [, bump] = React.useState(0)
			React.useEffect(() => {
				const listener = () => bump((value) => value + 1)
				localeListeners.add(listener)
				return () => {
					localeListeners.delete(listener)
				}
			}, [])
		}
		/** 把注册出去的面板包一层:语言一变就重画(不重载页面)。 */
		function withLocale(Component) {
			return function Localized(props) {
				useLocaleTick()
				return h(Component, props)
			}
		}

		/**
		 * 依赖的客户端服务,**必须全部声明在这里**。
		 *
		 * 这不是洁癖,是行为约束:客户端模块在 `slots` 一出现就被激活
		 * (`slots` 是平台 seed,启动时就有),而 `sessions` / `sidebarRight` 是**后来**
		 * 才由各自的插件 `provide` 的。只声明 `slots` 的话,我们的 `apply()` 会在它们之前跑,
		 * 读不到会话服务 → 早退 → **一个插座都不注册**,而且不报错:右栏只剩宿主自带的「文件」,
		 * 中栏没有「产物」。宿主那侧一切正常(模块图里有我们、bundle 正常送达),
		 * 所以这个 bug 只在浏览器里看得见——单测里的假 ctx 恰好把两个服务都给了,于是全绿。
		 *
		 * 声明之后 Cordis 会把插件**挂起**到这些服务就位再激活(原生插件同样是这么写的,
		 * 例如 `dsh-client-ui-sidebar-files` 声明 slots + sidebarRightTabs + remote + locale)。
		 */
		const inject = ['slots', 'sessions', 'sidebarRight']

		const STEP = lazyTable(() => ({ open: t('待执行'), advanced: t('已交付'), void: t('已作废') }))
		const VERDICT = lazyTable(() => ({ support: t('支持'), refute: t('推翻'), inconclusive: t('不确定') }))
		
		/** 「第 n 步」:整句做一个词条,英文才排得成 Step n。 */
		const nth = (n) => t('第 n 步').replace('n', String(n))
		const dash = (value) => (value === null || value === undefined || value === '' ? '—' : String(value))
		const gloss = (table, value) => (value === null || value === undefined ? '—' : `${table[value] ?? value}`)
		const when = (at) => {
			if (typeof at !== 'number' || at <= 0) return '—'
			const d = new Date(at)
			const pad = (n) => String(n).padStart(2, '0')
			return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
		}

		/**
		 * 面板的 CSS:按钮与标签照抄**原生那一套**(取自宿主自己的包,不是我们编的):
		 *   · 28px 药丸(设置页的「Add model」):`.5px solid var(--dsw-alias-border-l3)` + `border-radius:14px`
		 *     + `bg:0 0` + `label-primary` + `font-size:12px;line-height:18px;padding:0 10px`
		 *   · 11px 小药丸(技能卡上的「inspect」):`.5px solid var(--dsw-alias-border-l4)`
		 *     + `border-radius:999px` + `bg-base` + `label-secondary` + `padding:2px 8px`
		 *   · 悬停一律 `var(--dsw-alias-interactive-bg-hover)`(原生包里的同名令牌)
		 * 颜色**只用主题令牌**,不写死色值——深色/浅色跟着宿主走。
		 */
		const CSS = `
.clearai-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.clearai-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.clearai-btn:disabled{color:var(--dsw-alias-label-secondary);opacity:.5;cursor:default}
.clearai-btn[data-tone="warn"]{border-color:var(--dsw-alias-state-warn-primary)}
/* 工具行里的控制(控制归工具行):照原生那一行的形状——无边框、次级文字色、悬浮才出底。
   刻意不做成我们自己那种药丸:它坐在原生「完全权限」旁边,长得像原生才不突兀。 */
.clearai-toolctl{box-sizing:border-box;display:inline-flex;align-items:center;gap:2px;padding:2px 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer}
.clearai-toolctl:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.clearai-chip{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;cursor:pointer}
.clearai-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.clearai-tag{display:inline-block;padding:0 6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap}
.clearai-tag[data-strong="1"]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary)}
.clearai-link{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.clearai-link:hover{color:var(--dsw-alias-brand-primary)}
/* 世界树的**唯一**活性惯用法(照抄 ClearAI PlanTree 的 globals.css):
   节点外的柔光环一呼一吸 = 这东西此刻在动;步骤与世界线共用它——两种闪法并存的话,
   读者得学两次「什么在动」。透明度区间刻意压在 0.22–0.07:光环是底噪级的存在感,
   不该盖过节点自己的语义色。 */
@keyframes clearai-breathe{0%,100%{opacity:.22}50%{opacity:.07}}
.clearai-breathe{animation:clearai-breathe 1.6s ease-in-out infinite}
/* Evaluator 正在审这一步:**虚线**描边环呼吸。与上面是两件事——填充柔光=它在跑,
   虚线描边=有外部观察者在看它。区分走**形状**不走颜色:颜色通道只表达结局。 */
@keyframes clearai-breathe-stroke{0%,100%{opacity:.85}50%{opacity:.35}}
.clearai-breathe-stroke{animation:clearai-breathe-stroke 1.6s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.clearai-breathe,.clearai-breathe-stroke{animation:none}}
/* 树的行(可选中):悬停与选中都是背景,不改变字形——字形只被状态占用。 */
.clearai-treerow{display:flex;align-items:center;gap:6px;padding:0 6px;cursor:pointer;border-radius:4px;transition:background .12s}
.clearai-treerow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.clearai-treerow[data-sel="1"]{background:var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover))}
/* ── 本体格(第六阶段):期刊式排版 + 进度轨。颜色只用主题令牌,深浅色跟着宿主走。 ── */
.clearai-atlas{height:100%;overflow-y:auto;box-sizing:border-box;padding:22px 26px 180px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary)}
.clearai-serif,.clearai-question,.clearai-row-title,.clearai-card-title,.clearai-star>span{font-family:ui-serif,"Songti SC","Noto Serif SC","Source Han Serif SC",Georgia,serif}
.clearai-head{display:flex;flex-direction:column;gap:6px;padding-bottom:16px;margin-bottom:16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.clearai-question{font-size:19px;font-weight:600;line-height:1.45;letter-spacing:.01em}
.clearai-counts{font-size:12px;color:var(--dsw-alias-label-secondary)}
.clearai-need{display:flex;gap:8px;align-items:baseline;font-size:12.5px;padding:4px 10px;border-left:2px solid var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-1);border-radius:0 6px 6px 0}
.clearai-need b{font-weight:600;color:var(--dsw-alias-state-warn-primary);white-space:nowrap}
.clearai-track{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.clearai-track-stop{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.clearai-track-stop i{width:7px;height:7px;border-radius:50%;border:1px solid var(--dsw-alias-border-l3);box-sizing:border-box}
.clearai-track-stop[data-on="1"]{color:var(--dsw-alias-label-primary)}
.clearai-track-stop[data-on="1"] i{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary)}
.clearai-track-line{flex:1 1 18px;max-width:56px;height:1px;background:var(--dsw-alias-border-l2)}
.clearai-track-line[data-on="1"]{background:var(--dsw-alias-label-secondary)}
/* 图 */
.clearai-graph{margin-bottom:18px}
.clearai-graph[data-full="1"]{position:fixed;inset:0;z-index:40;background:var(--dsw-alias-bg-base);padding:16px 20px;display:flex;flex-direction:column;margin:0}
.clearai-graph-bar{display:flex;align-items:center;gap:14px;margin-bottom:8px;font-size:12px}
.clearai-seg{display:inline-flex;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;padding:2px}
.clearai-seg>span{padding:2px 12px;border-radius:999px;cursor:pointer;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.clearai-seg>span[data-on="1"]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted)}
.clearai-legend{display:inline-flex;gap:12px;color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.clearai-legend>span{display:inline-flex;align-items:center;gap:5px}
.clearai-legend>span::before{content:"";width:16px;border-top:1.3px solid var(--dsw-alias-label-secondary)}
.clearai-legend>span[data-l="dash"]::before{border-top-style:dashed;border-top-color:var(--dsw-alias-label-tertiary)}
.clearai-legend>span[data-l="warn"]::before{border-top-color:var(--dsw-alias-state-warn-primary)}
.clearai-graph-body{display:flex;flex-direction:column;gap:10px;min-height:0}
.clearai-graph[data-full="1"] .clearai-graph-body{flex:1 1 auto}
.clearai-graph-body[data-side="1"]{flex-direction:row}
.clearai-graph-canvas{height:340px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.clearai-graph[data-full="1"] .clearai-graph-canvas{height:auto;flex:1 1 auto;min-width:0}
.clearai-graph-side{flex:0 0 auto}
.clearai-graph-body[data-side="1"] .clearai-graph-side{width:380px;overflow-y:auto}
.clearai-graph-problems{margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}.clearai-graph-problems summary{cursor:pointer;color:var(--dsw-alias-state-warn-primary)}.clearai-graph-problems>div{padding:2px 0 2px 12px;line-height:1.5}.clearai-graph-problems>div[data-sev=info]{opacity:.7}.clearai-graph-problems code{font-size:11px}
.clearai-fold{margin-left:2px;padding:0 4px;border-radius:6px;font-weight:500;font-size:10.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-l2,rgba(127,127,127,.12));cursor:pointer}
.clearai-graph-empty{height:150px;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 24px;border:.5px dashed var(--dsw-alias-border-l3);border-radius:10px;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.react-flow__node.clearai-star-node .react-flow__handle{opacity:0;pointer-events:none;left:4.5px;top:50%;transform:translate(-50%,-50%);min-width:0;min-height:0;width:1px;height:1px;border:0}
.react-flow__node.clearai-star-node.selected,.react-flow__node.clearai-star-node:focus{box-shadow:none;outline:none}
.clearai-star{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:12.5px;color:var(--dsw-alias-label-primary);cursor:pointer}
.clearai-star>i{flex:0 0 auto;width:9px;height:9px;border-radius:50%;box-sizing:border-box;border:1.4px solid var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.clearai-star[data-kind="instance"]>i{background:var(--dsw-alias-label-primary)}
.clearai-star[data-kind="literal"]>i{width:6px;height:6px;border:0;background:var(--dsw-alias-label-secondary)}
.clearai-star[data-kind="literal"]{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.clearai-star[data-kind="value_type"]>i{border-radius:2px;width:8px;height:8px;border-color:var(--dsw-alias-label-tertiary)}
.clearai-star[data-kind="value_type"]{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.clearai-star[data-state="pending"]>i{border-style:dashed;background:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-label-secondary)}
.clearai-star[data-state="off"]{opacity:.45}
.clearai-star[data-state="off"]>i{border-style:dashed}
.clearai-star[data-state="conflict"]>i{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-primary)}
.clearai-star[data-sel="1"]>i{box-shadow:0 0 0 4px var(--dsw-alias-interactive-bg-hover)}
.clearai-star[data-sel="1"]>span{font-weight:600}
/* 小卡 */
.clearai-card{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.clearai-card-head{display:flex;align-items:baseline;gap:8px;font-size:12px}
.clearai-card-kind{font-size:11px;color:var(--dsw-alias-label-tertiary);letter-spacing:.06em}
.clearai-card-title{font-size:15px;font-weight:600}
.clearai-card-facts{display:flex;flex-direction:column;gap:4px}
.clearai-card-fact{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:12.5px}
/* 结论 */
.clearai-section-head{font-size:11px;letter-spacing:.14em;color:var(--dsw-alias-label-tertiary);margin:4px 0 4px}
.clearai-filter{display:flex;gap:10px;align-items:baseline;font-size:12px;color:var(--dsw-alias-label-secondary);margin:-8px 0 12px}
.clearai-list{display:flex;flex-direction:column;gap:10px}
.clearai-group-head{display:flex;gap:6px;align-items:baseline;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:6px 0 2px}
.clearai-group-head>span{color:var(--dsw-alias-label-tertiary)}
.clearai-row{border-top:.5px solid var(--dsw-alias-border-l1)}
.clearai-row[data-open="1"]{background:var(--dsw-alias-bg-layer-1);border-radius:8px;border-top-color:transparent}
.clearai-row-head{display:flex;align-items:baseline;gap:10px;padding:7px 8px;cursor:pointer;border-radius:8px}
.clearai-row-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.clearai-row-title{font-size:14px;font-weight:500;white-space:nowrap}
.clearai-row-sub{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.clearai-row-step{margin-left:auto;font-size:11.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.clearai-row[data-trust="replaced"] .clearai-row-title{text-decoration:line-through;color:var(--dsw-alias-label-tertiary)}
.clearai-trust{flex:0 0 auto;display:inline-block;font-size:11px;line-height:16px;padding:0 7px;border-radius:999px;border:.5px solid var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary);white-space:nowrap}
.clearai-trust[data-trust="credible"]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted)}
.clearai-trust[data-trust="testing"]{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.clearai-trust[data-trust="unclear"]{border-style:dashed;border-color:var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-secondary)}
.clearai-trust[data-trust="refuted"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.clearai-trust[data-trust="replaced"]{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.clearai-trust[data-trust="conflict"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
/* 点开一条:三段 */
.clearai-detail{display:flex;flex-direction:column;gap:16px;padding:6px 12px 14px 12px}
.clearai-part-head{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px}
.clearai-part-head b{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.clearai-stations-bar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}
.clearai-stations-bar span{height:5px;border-radius:3px;background:var(--dsw-alias-border-l1)}
.clearai-stations-bar span[data-state="done"]{background:var(--dsw-alias-label-primary)}
.clearai-stations-bar span[data-state="next"]{background:repeating-linear-gradient(90deg,var(--dsw-alias-label-secondary) 0 4px,var(--dsw-alias-border-l1) 4px 8px)}
.clearai-stations-bar span[data-state="broken"]{background:var(--dsw-alias-state-error-primary)}
.clearai-stations-names{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.clearai-stations-names span[data-now="1"]{color:var(--dsw-alias-label-primary);font-weight:600}
.clearai-stations-note{margin-top:6px;font-size:12px;color:var(--dsw-alias-state-error-primary)}
.clearai-tl{position:relative;display:flex;flex-direction:column}
.clearai-tl::before{content:"";position:absolute;left:4px;top:9px;bottom:9px;width:1px;background:var(--dsw-alias-border-l2)}
.clearai-tl-row{position:relative;display:grid;grid-template-columns:9px 76px 1fr;gap:10px;align-items:baseline;padding:2px 0;font-size:12.5px}
.clearai-tl-dot{width:9px;height:9px;border-radius:50%;box-sizing:border-box;align-self:center;background:var(--dsw-alias-label-primary)}
.clearai-tl-row[data-kind="proposed"] .clearai-tl-dot{background:var(--dsw-alias-bg-base);border:1.4px solid var(--dsw-alias-label-tertiary)}
.clearai-tl-row[data-verdict="refute"] .clearai-tl-dot{background:var(--dsw-alias-state-error-primary)}
.clearai-tl-row[data-verdict="inconclusive"] .clearai-tl-dot{background:var(--dsw-alias-bg-base);border:1.4px dashed var(--dsw-alias-label-secondary)}
.clearai-tl-row[data-kind="promoted"] .clearai-tl-dot{background:var(--dsw-alias-brand-primary)}
.clearai-tl-row[data-kind="next"]{color:var(--dsw-alias-label-tertiary)}
.clearai-tl-row[data-kind="next"] .clearai-tl-dot{background:var(--dsw-alias-bg-base);border:1px dashed var(--dsw-alias-label-tertiary)}
.clearai-tl-time{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.clearai-tl-move{font-weight:600}
.clearai-kv{display:grid;grid-template-columns:44px 1fr;gap:5px 14px;font-size:12.5px;line-height:1.6}
.clearai-kv>span:nth-child(odd){color:var(--dsw-alias-label-tertiary)}
.clearai-chips{display:inline-flex;gap:6px;flex-wrap:wrap}
.clearai-quiet{color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:6px 0}
/* ── 探索货架:问题 → 候选假设 → 下一步;过程记录默认折叠。颜色只用主题令牌。 ── */
.clearai-head-kind{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.clearai-pills{display:flex;flex-wrap:wrap;gap:6px;font-size:12px}
.clearai-pill{padding:1px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.clearai-waiting{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;padding:8px 12px;margin-bottom:14px;border-radius:8px;border:.5px solid var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-1);font-size:12.5px}
.clearai-waiting b{color:var(--dsw-alias-state-warn-primary);font-weight:600}
.clearai-box{display:flex;flex-direction:column;margin-bottom:14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.clearai-box-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;padding:10px 14px;background:var(--dsw-alias-bg-layer-1)}
.clearai-box[data-compact="1"] .clearai-box-head{background:transparent}
.clearai-box-kind{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.clearai-box-title{flex:1 1 220px;font-size:14px;font-weight:600}
.clearai-box-note{font-size:12px;color:var(--dsw-alias-label-secondary)}
.clearai-box-foot{display:flex;flex-direction:column;gap:4px;padding:8px 14px;font-size:12px;color:var(--dsw-alias-label-tertiary);border-top:.5px solid var(--dsw-alias-border-l1)}
.clearai-parked{display:inline-flex;gap:8px;align-items:baseline}
.clearai-cand{border-top:.5px solid var(--dsw-alias-border-l1)}
.clearai-cand-head{width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:9px 14px;border:0;background:transparent;text-align:left;font:inherit;color:inherit;cursor:pointer}
.clearai-cand-head[data-static="1"]{cursor:default}
.clearai-cand-head:not([data-static="1"]):hover{background:var(--dsw-alias-interactive-bg-hover)}
.clearai-cand-name{font-weight:500}
.clearai-cand[data-s="excluded"] .clearai-cand-name{text-decoration:line-through;color:var(--dsw-alias-label-tertiary)}
.clearai-cand-note{flex:1 1 220px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.clearai-cand-chevron{margin-left:auto;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.clearai-cand-detail{display:flex;flex-direction:column;gap:3px;padding:0 14px 12px}
.clearai-kvrow{display:grid;grid-template-columns:64px 1fr;gap:10px;font-size:12.5px}
.clearai-kvrow>span:first-child{color:var(--dsw-alias-label-tertiary)}
.clearai-state{flex:0 0 auto;display:inline-block;font-size:11px;line-height:16px;padding:0 7px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.clearai-state[data-s="examining"],.clearai-state[data-s="in_progress"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.clearai-state[data-s="excluded"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.clearai-state[data-s="adopted"],.clearai-state[data-s="clear"]{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted)}
.clearai-state[data-s="set_aside"]{border-style:dashed}
.clearai-emergent{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:0 14px 10px;padding:8px 10px;border-radius:8px;border:.5px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}
.clearai-emergent-kind{font-size:11.5px;font-weight:600;color:var(--dsw-alias-brand-primary)}
.clearai-emergent-text{flex:1 1 200px;font-weight:500}
.clearai-emergent-actions{display:inline-flex;gap:8px}
.clearai-emergent-done{margin:0 14px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.clearai-btn{min-height:30px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer}
.clearai-btn[data-primary="1"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.clearai-next{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;padding:12px 14px;border-radius:10px;border:.5px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}
.clearai-next-head{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}
.clearai-next-kind{font-size:11.5px;font-weight:600;color:var(--dsw-alias-brand-primary)}
.clearai-next-title{font-size:14px;font-weight:600}
.clearai-preds{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.clearai-pred{padding:8px 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.clearai-pred-if{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.clearai-pred-value{font-size:13.5px;font-weight:600}
.clearai-next-note{font-size:12px;color:var(--dsw-alias-label-secondary)}
.clearai-next-warn{font-size:12px;color:var(--dsw-alias-state-warn-primary);font-weight:600}
.clearai-anomaly{display:flex;flex-wrap:wrap;gap:4px 12px;padding:7px 14px;border-top:.5px solid var(--dsw-alias-border-l1);font-size:12.5px}
.clearai-anomaly-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.clearai-process{border-top:.5px solid var(--dsw-alias-border-l2);padding-top:4px}
.clearai-process-head{width:100%;min-height:38px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:0;border:0;background:transparent;text-align:left;font:inherit;color:inherit;cursor:pointer}
.clearai-process-head span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.clearai-process-body{display:flex;flex-direction:column;gap:14px;padding:6px 0}
.clearai-judgments-head{display:flex;flex-direction:column;gap:4px}
/* 本体货架的结论卡:四部分 */
.clearai-answers{display:flex;flex-direction:column;gap:8px;margin-bottom:18px}
.clearai-qtab{min-height:28px;padding:0 12px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.clearai-qtab[aria-pressed="true"]{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-inverted)}
.clearai-answer{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.clearai-answer-part{display:flex;flex-direction:column;gap:4px;padding:10px 14px;border-top:.5px solid var(--dsw-alias-border-l1)}
.clearai-answer-part:first-child{border-top:0}
.clearai-answer-part[data-warm="1"]{background:var(--dsw-alias-bg-layer-1)}
.clearai-answer-label{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.clearai-answer-part[data-warm="1"] .clearai-answer-label{color:var(--dsw-alias-state-warn-primary)}
.clearai-answer-main{font-size:15px;font-weight:600}
.clearai-answer-lines{display:flex;flex-direction:column;gap:3px;font-size:12.5px}
.clearai-lesson{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;font-size:12.5px}
.clearai-lesson-kind{font-size:11px;padding:0 7px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.clearai-lesson-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
/* 沉淀与取用:条目、实体卡、图上的计数 */
.clearai-kitem{display:flex;flex-direction:column;gap:3px;padding:7px 14px;border-top:.5px solid var(--dsw-alias-border-l1);font-size:12.5px}
.clearai-kitem-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.clearai-kitem-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.clearai-kitem-asks{display:flex;flex-wrap:wrap;gap:6px}
.clearai-btn[data-small="1"]{min-height:24px;padding:0 9px;font-size:11.5px}
.clearai-state[data-s="preliminary_excluded"]{border-style:dashed;border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.clearai-state[data-s="established"],.clearai-state[data-s="applies"]{border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary)}
.clearai-state[data-s="pending"],.clearai-state[data-s="undeclared"],.clearai-state[data-s="unscoped"]{border-style:dashed}
.clearai-state[data-s="bounded"],.clearai-state[data-s="out_of_scope"],.clearai-state[data-s="out_of_range"],.clearai-state[data-s="definition_changed"],.clearai-state[data-s="defect"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.clearai-state[data-s="retracted"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.clearai-state[data-s="unresolved"],.clearai-state[data-s="escalated"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.clearai-ecard{display:flex;flex-direction:column;gap:6px;margin-bottom:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 0 4px}
.clearai-ecard-title{display:flex;align-items:center;gap:8px;padding:0 14px;font-size:14px;font-weight:600}
.clearai-ecard-head{padding:4px 14px 2px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.clearai-kcount{display:inline-flex;gap:2px;font-family:ui-sans-serif,system-ui,sans-serif}
.clearai-kcount>em{font-style:normal;font-size:10px;line-height:13px;padding:0 4px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.clearai-kcount>em[data-b="excluded"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.clearai-kcount>em[data-b="bounded"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.clearai-kcount>em[data-b="pending"]{border-style:dashed}
.clearai-kcount>em[data-b="unresolved"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.clearai-kitem-head[data-click="1"]{cursor:pointer}
.clearai-ecard-fold>summary{padding:4px 14px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.clearai-kcount-legend{display:inline-flex;gap:8px;margin-left:6px}
.clearai-kcount-legend>span{display:inline-flex;align-items:center;gap:3px}
.clearai-kcount-legend em{display:inline-block;width:8px;height:8px;border-radius:2px;border:.5px solid var(--dsw-alias-border-l3)}
.clearai-kcount-legend em[data-b="excluded"]{border-color:var(--dsw-alias-state-error-primary)}
.clearai-kcount-legend em[data-b="bounded"]{border-color:var(--dsw-alias-state-warn-primary)}
.clearai-kcount-legend em[data-b="pending"]{border-style:dashed}
.clearai-kcount-legend em[data-b="unresolved"]{border-color:var(--dsw-alias-brand-primary)}
.clearai-settled{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;padding:2px 2px 0;font-size:12.5px}
`
		/** 把上面那段 CSS 挂进页面(带 data-plugin 标记,宿主按包名记账,卸载时收掉)。 */
		function installStyles() {
			if (typeof document === 'undefined') return () => {}
			/** 只认自己那一张:图组件的样式表也挂着 data-plugin="clearai-dsh"(data-clearai="xyflow"),按包名查会误以为已经挂过。 */
			const existing = document.querySelector('style[data-plugin="clearai-dsh"][data-clearai="panel"]')
			if (existing !== null) return () => {}
			const tag = document.createElement('style')
			tag.dataset.plugin = 'clearai-dsh'
			tag.dataset.clearai = 'panel'
			tag.textContent = CSS
			document.head.append(tag)
			return () => {
				tag.remove()
			}
		}

		// ── 样式:颜色一律用主题令牌(--dsw-alias-*),不写死色值 ─────────────────
		const S = {
		/** 断言芯片:一条断言的一行;点开就地展开词条卡。 */
		chipRow: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 },
		chipWrap: { display: 'inline-flex', flexDirection: 'column', gap: 2, maxWidth: '100%' },
		chip: { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, border: '1px solid rgba(127,127,127,0.35)', fontSize: 11, cursor: 'pointer', lineHeight: '20px' },
		chipCard: { display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.22)', background: 'var(--dsw-alias-bg-layer-1)', fontSize: 11 },
		chipCardTitle: { fontWeight: 600 },
		chipActions: { display: 'flex', gap: 10, marginTop: 2 },
		chipAction: { color: 'var(--dsh-alias-link-primary, #4a8dff)', cursor: 'pointer', fontSize: 11 },

			/** 空态里的标记行:quiet,只陈述"这一格是谁的",不跟正文抢。 */
			emptyMark: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--dsw-alias-label-tertiary)' },
			emptyName: { fontSize: 13, fontWeight: 600, letterSpacing: '.02em' },
			/** 小节标题前的小标:与标题同基线,quiet。 */
			headMark: { display: 'inline-flex', verticalAlign: '-2px', marginRight: 6 },
		/** 人门区:等人的事永远最先说,所以它排在最上面,用一条竖线标出来。 */
		gate: { display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', margin: '0 0 8px', borderLeft: '3px solid var(--dsw-alias-state-warn-primary)', background: 'var(--dsw-alias-bg-layer-1)', borderRadius: 6 },
		gateRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' },
		row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', padding: '3px 0' },
		pre: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', font: 'inherit', fontSize: 12, maxHeight: 320, overflow: 'auto', background: 'var(--dsw-alias-bg-layer-2)', padding: 8, borderRadius: 6, margin: '4px 0 0', color: 'var(--dsw-alias-label-primary)' },
			wrap: { height: '100%', overflowY: 'auto', padding: '14px 16px 24px', fontSize: 12.5, lineHeight: 1.55, color: 'var(--dsw-alias-label-primary)' },
			bar: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '.5px solid var(--dsw-alias-border-l1)', marginBottom: 14 },
			title: { fontSize: 13, fontWeight: 600, letterSpacing: 0.3 },
			dim: { color: 'var(--dsw-alias-label-secondary)' },
			faint: { color: 'var(--dsw-alias-label-secondary)', opacity: 0.7 },
			mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5 },
			section: { marginBottom: 16 },
			head: { fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--dsw-alias-label-secondary)', marginBottom: 6 },
			row: { padding: '5px 0', borderTop: '.5px solid var(--dsw-alias-border-l1)' },
			rowFirst: { padding: '5px 0' },
			tag: { display: 'inline-block', padding: '0 6px', border: '.5px solid var(--dsw-alias-border-l3)', borderRadius: 999, color: 'var(--dsw-alias-label-secondary)', fontSize: 11, lineHeight: '16px', marginRight: 6, whiteSpace: 'nowrap' },
			tagStrong: { display: 'inline-block', padding: '0 6px', border: '.5px solid var(--dsw-alias-label-primary)', borderRadius: 999, color: 'var(--dsw-alias-label-primary)', fontSize: 11, lineHeight: '16px', marginRight: 6, fontWeight: 600, whiteSpace: 'nowrap' },
			inline: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' },
			kv: { display: 'grid', gridTemplateColumns: 'minmax(64px, max-content) 1fr', gap: '2px 10px', marginTop: 4 },
			empty: { padding: '28px 4px', color: 'var(--dsw-alias-label-secondary)', fontSize: 12.5, lineHeight: 1.7 },
			table: { width: '100%', borderCollapse: 'collapse', marginTop: 4 },
			th: { textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--dsw-alias-label-secondary)', padding: '3px 6px 3px 0', borderBottom: '.5px solid var(--dsw-alias-border-l1)' },
			td: { verticalAlign: 'top', padding: '4px 6px 4px 0', borderTop: '.5px solid var(--dsw-alias-border-l1)' },
			strip: { display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', padding: '2px 2px 4px', flexWrap: 'wrap' },
			branch: { marginTop: 4, paddingLeft: 10, borderLeft: '2px solid var(--dsw-alias-border-l2)' },
			branchFirst: { marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--dsw-alias-border-l2)' },
			progressTrack: { display: 'inline-block', width: 90, height: 4, background: 'var(--dsw-alias-border-l1)', borderRadius: 2, verticalAlign: 'middle', marginLeft: 4 },
			progressBar: { display: 'block', height: 4, background: 'var(--dsw-alias-brand-primary)', borderRadius: 2 },
			/**
			 * 「事实」那一格:一个知识货架(上架=已确认事实,下架=命题)。
			 * 默认一行一条命题,只有主张 + 当前处境 + 等级判者;点开才展开来路与证据。
			 */
			group: { display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11, fontWeight: 600, letterSpacing: 1, color: 'var(--dsw-alias-label-secondary)', margin: '10px 0 2px' },
			groupN: { fontWeight: 400, color: 'var(--dsw-alias-label-secondary)', opacity: 0.7 },
			factRow: { padding: '6px 0', borderTop: '.5px solid var(--dsw-alias-border-l1)' },
			factClaim: { color: 'var(--dsw-alias-label-primary)' },
			factMeta: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', opacity: 0.85, marginTop: 1 },
			propRow: { padding: '6px 0', borderTop: '.5px solid var(--dsw-alias-border-l1)' },
			propOpen: { padding: '6px 0 2px', borderTop: '.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', borderRadius: 6 },
			propHead: { display: 'grid', gridTemplateColumns: '1fr minmax(120px, auto) minmax(120px, auto)', gap: 10, alignItems: 'baseline', cursor: 'pointer' },
			propClaim: { color: 'var(--dsw-alias-label-primary)' },
			stale: { color: 'var(--dsw-alias-label-secondary)', opacity: 0.6 },
			propWhere: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', opacity: 0.85, textAlign: 'left' },
			propJudge: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', textAlign: 'right', whiteSpace: 'nowrap' },
			propBody: { marginTop: 8, paddingLeft: 10, borderLeft: '2px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', gap: 4 },
			/** 流转图:竖排的状态机,走过的边实线、未走的虚线灰,当前态高亮。 */
			flow: { display: 'flex', flexDirection: 'column', gap: 0, margin: '2px 0 6px' },
			flowStep: { display: 'flex', flexDirection: 'column' },
			flowNode: { alignSelf: 'flex-start', display: 'inline-flex', gap: 6, alignItems: 'baseline', padding: '1px 10px', border: '.5px solid var(--dsw-alias-border-l2)', borderRadius: 999, fontSize: 11.5 },
			flowNow: { borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 },
			flowReached: { color: 'var(--dsw-alias-label-primary)', borderColor: 'var(--dsw-alias-label-secondary)' },
			flowOff: { color: 'var(--dsw-alias-label-secondary)', opacity: 0.45, borderStyle: 'dashed' },
			flowEdgeOn: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', padding: '1px 0 1px 8px' },
			flowEdgeOff: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', opacity: 0.35, padding: '1px 0 1px 8px' },
			flowTag: { fontSize: 10, opacity: 0.75 },
			pathLine: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5 },
			pathKey: { color: 'var(--dsw-alias-label-secondary)', opacity: 0.7, minWidth: 34 },
			pathVal: { color: 'var(--dsw-alias-label-secondary)' },
			pathArrow: { color: 'var(--dsw-alias-label-secondary)', opacity: 0.7 },
			pathNode: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
			evList: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 },
			evRow: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5 },
			evHead: { color: 'var(--dsw-alias-label-primary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, whiteSpace: 'nowrap' },
			evBasis: { color: 'var(--dsw-alias-label-secondary)', opacity: 0.85, flex: '1 1 auto', minWidth: 0 },
			fileLink: { color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer', whiteSpace: 'nowrap' },
			pathFoot: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', opacity: 0.7, marginTop: 2 },
			/** 世界树页眉的判据小节:逐条带序号;左侧竖线说明它是「目标的一部分」而不是新面板。 */
			criteria: { display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 8, marginTop: 2, borderLeft: '2px solid var(--dsw-alias-border-l2)' },
			criteriaRow: { display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5 },
		}
		/** 可点的文本(替代裸下划线 span)。 */
		function Link(props) {
			return h('span', { className: 'clearai-link', title: props.title, onClick: props.onClick }, props.children)
		}



		function Tag(props) {
			return h('span', { style: props.strong === true ? S.tagStrong : S.tag }, props.children)
		}

		/**
		 * 小节。`mark: true` 时在标题前放我们的标记 —— **只有事实货架要它**:
		 * 那一格是这套系统真正的产物(已确认、可引用),标一下是"这一格由 ClearAI 维护"的陈述。
		 * 别的标题不标:标滥了就只是装饰(同类同一规矩,而不是到处贴)。
		 */
		function Section(props) {
			return h(
				'div',
				{ style: S.section },
				h(
					'div',
					{ style: S.head },
					props.mark === true ? h('span', { style: S.headMark }, h(ClearAIMark, { size: 13 })) : null,
					props.title,
				),
				props.children,
			)
		}

		/**
		 * 空态。**每一格空态都带我们的标记**——同类空态同一规矩,不是逐处装饰。
		 *
		 * 为什么标在这里而不是页签图标那一排:一排里两个一样的标是**重复**(试过,退了);
		 * 而空态一次只看得见一个,标记在这里是"这一格是我们的"这一句陈述,克制且不抢。
		 */
		function Empty(props) {
			return h(
				'div',
				{ style: S.empty },
				h(
					'div',
					{ style: S.emptyMark },
					h(ClearAIMark, { size: 22 }),
					h('span', { style: S.emptyName }, 'ClearAI'),
				),
				props.children,
			)
		}

		/**
		 * **目标那一块**(世界树页眉):主张一行 + **判据小节**(逐条带序号)。
		 *
		 * 判据是**多条**的清点清单(`Frame` 收 `criteria: string[]`)⇒ 挤成一句「判据:均值差…」
		 * 会把「第 3 条没做到」抹平。所以逐条列出来,修订史与全文指针各占一行。
		 * 读的是 `knowledgeView` 那一份(与运行态卡**同一份**);拿不到(旧宿主 / 测试桩)时
		 * 退回原来那句摘要——面板不许因为缺一份投影而空白,也不许自己再拼一套判据。
		 */
		function GoalLine(props) {
			const goal = props.goal
			if (goal === null || goal === undefined) return null
			const viewGoal = props.view?.goal ?? null
			/** 空清单与「没有这一份」是同一件事:都得退回旧式那一句摘要,不能显示一个「判据 · 0」的小节。 */
			const criteriaLines = Array.isArray(viewGoal?.criteriaLines) && viewGoal.criteriaLines.length > 0 ? viewGoal.criteriaLines : null
			const note = String(viewGoal?.criteriaNote ?? '')
			const history = Array.isArray(viewGoal?.criteriaHistory) ? viewGoal.criteriaHistory : []
			const lastAudit = history.length === 0 ? null : history[history.length - 1]?.audit
			const docPath = typeof viewGoal?.docPath === 'string' && viewGoal.docPath !== '' ? viewGoal.docPath : null
			const open = typeof props.openPreview === 'function' ? props.openPreview : null
			return h(
				'div',
				{ style: { ...S.rowFirst, display: 'flex', flexDirection: 'column', gap: 4 } },
				h(
					'div',
					{ style: S.inline },
					h('span', null, dash(goal.claim)),
					// 阶段与完成度归**状态条**(常驻可见)⇒ 这里不重复(两处说同一件事 = 冗余)
					// 旧式判据(整段 done_criteria、或投影里没有逐条那份):一句摘要 + 全文进 tooltip
					criteriaLines === null ? h('span', { style: S.faint, title: String(goal.doneCriteria ?? '') }, `${t('判据:')}${brief(goal.doneCriteria, 56)}`) : null,
				),
				criteriaLines === null
					? null
					: h(
							'div',
							{ style: S.criteria },
							h(
								'div',
								{ style: S.head },
								`${t('判据')} · ${criteriaLines.length}${history.length === 0 ? '' : `${t(' · 已修订 ')}${history.length}${t(' 次')}${lastAudit === null || lastAudit === undefined ? '' : `${t(' · 最近一次修订的独立裁决:')}${String(lastAudit)}`}`}`,
							),
							...criteriaLines.map((line, index) => h('div', { key: `criteria-${index}`, style: S.criteriaRow }, `${index + 1}. ${line}`)),
							// 全文的家与卡上那句指针是同一个路径(不各自拼一遍);沿用计划文档那条既有做法
							docPath === null || open === null ? null : h(Link, { onClick: () => open(docPath), title: t('打开目标文档(原生预览)') }, `${t('全文在 ')}${docPath}`),
							note === '' ? null : h('div', { style: S.faint }, `${t('背景(不参与判定):')}${brief(note, 120)}`),
						),
			)
		}

		/**
		 * 对象的**人话名字**。与本体声明里的对象名一一对应——交叉校验测试里
		 * 有一条「声明里每个对象都必须在这里有名字」,少一个就红(界面不许漏对象)。
		 */
		const LOOP_LABEL = lazyTable(() => ({
			goal: t('目标'),
			hypothesis: t('命题'),
			plan: t('计划'),
			step: t('验证'),
			observation: t('观测'),
			evaluation: t('评估'),
			evidence: t('证据'),
			fact: t('事实'),
			release: t('批准'),
			anomaly: t('未解释'),
		}))

		/**
		 * 一行够用的摘要。**真数据逼出来的**:评估者的依据常常是几百字的一整段
		 * (逐条对照判据 + 隔离标注),原样内联会把那一行撑到没法看。
		 * 摘要进列表,全文进 tooltip——「可查」不等于「必须占屏」。
		 */
		function brief(value, max = 64) {
			const text = String(value ?? '').replace(/\s+/g, ' ').trim()
			if (text === '') return '—'
			return text.length <= max ? text : `${text.slice(0, max)}…`
		}

		const LEVEL_RANK = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 }
		const levelRank = (value) => LEVEL_RANK[value] ?? -1

		/**
		 * 一条命题的证据。新账上每条证据写明它针对哪条命题(`evidence.hypothesis`);
		 * 旧账没有这一格,走**证据 → 步骤 → 命题**(`evidence.stepId` → `step.tests.hypotheses`)那条链。
		 */
		/** 一个步骤检验的命题 id(新形状 `tests.hypotheses`;旧形状单条 `tests.hypothesis` 照旧认)。 */
		function testedOf(meta) {
			const tests = meta?.tests
			if (Array.isArray(tests?.hypotheses)) return tests.hypotheses
			return typeof tests?.hypothesis === 'string' && tests.hypothesis !== '' ? [tests.hypothesis] : []
		}

		function evidenceOf(data, hypothesisId) {
			/**
			 * 走**跨计划**的步骤索引:命题的验证步常常留在**已收尾的旧计划**里
			 * (真数据:两条计划,`tests` 全在旧的那条上)⇒ 只查活动计划会全断,
			 * 面板上五个命题的证据与判者全是「—」。索引由折法派生,不新增存储。
			 */
			const index = data?.stepIndex ?? {}
			const steps = new Set(
				Object.entries(index)
					.filter(([, meta]) => testedOf(meta).includes(hypothesisId))
					.map(([stepId]) => stepId),
			)
			return (data?.evidence ?? [])
				.filter((item) => (item.hypothesis === null || item.hypothesis === undefined ? steps.has(item.stepId) : item.hypothesis === hypothesisId))
				.slice()
				.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
		}

		/**
		 * 一条证据的**出处**。分两层:
		 *
		 *   ① **记账时定下的 `origins` 优先** —— 四类入口(产物 / 评估卡 / 评估者子会话 / 人放行)
		 *      是内核在写证据那一刻解析好的事实,界面只渲染;
		 *   ② 旧日志没有 `origins` 时走**只读回退**:材料 id → 材料表里的路径,换不出来的**丢掉** ——
		 *      绝不把裸 id 渲染成"能点"的样子(失效模式:整排出处因此点不开)。
		 */
		const ORIGIN_LABEL = lazyTable(() => ({ 'audit-card': t('评估卡'), 'evaluator-session': t('查看评估者'), 'approval-record': t('审批记录') }))
		/**
		 * 出处的**可点标签**:产物用**文件名**,不用「产物」三个字 ——
		 * 一条证据常常挂着两三个产物,都叫「产物」就没人知道该点谁。
		 * 同名不同目录时才补路径片段(仍然是"一眼能认出点的是哪个")。
		 */
		function fileLabel(path, others) {
			const text = String(path ?? '')
			if (text === '') return t('产物')
			const name = text.split('/').filter(Boolean).pop() ?? text
			const sameName = (others ?? []).filter((other) => String(other ?? '').split('/').filter(Boolean).pop() === name)
			if (sameName.length <= 1) return name
			// 有重名:带上最后一层目录(products/report.md → products/report.md)
			const parts = text.split('/').filter(Boolean)
			return parts.length >= 2 ? parts.slice(-2).join('/') : text
		}
		function originsOf(data, item) {
			if (Array.isArray(item.origins) && item.origins.length > 0) {
				const paths = item.origins.filter((origin) => origin.kind === 'artifact').map((origin) => origin.path)
				return item.origins.map((origin) => ({
					kind: origin.kind,
					label: origin.kind === 'artifact' ? fileLabel(origin.path, paths) : (ORIGIN_LABEL[origin.kind] ?? origin.kind),
					path: typeof origin.path === 'string' && origin.path !== '' ? origin.path : null,
					session: typeof origin.session === 'string' && origin.session !== '' ? origin.session : null,
					call: typeof origin.call === 'string' && origin.call !== '' ? origin.call : null,
				}))
			}
			const materials = new Map((data?.materials ?? []).map((row) => [row.id, row.ref]))
			const asPath = (ref) => {
				const text = String(ref ?? '').trim()
				if (text === '') return null
				if (materials.has(text)) return String(materials.get(text))
				return /[/.]/.test(text) ? text : null
			}
			const out = []
			if (item.anchor === 'auditor') {
				/**
				 * 评估卡按**步骤**归属;世界线证据的卡按 `分支` 归属(形如 `k-…:b-…`),
				 * 与证据的 `stepId` 不是同一个 id —— 所以两种都要认(只认 stepId 时,
				 * 世界线的五条独立证据一条都指不到卡)。
				 */
				const audits = (data?.audits ?? []).filter((row) => row.evaluator === 'independent')
				const audit =
					audits.find((row) => row.stepId === item.stepId) ??
					(item.branch === null || item.branch === undefined ? undefined : audits.find((row) => String(row.stepId ?? '').endsWith(`:${item.branch}`)))
				if (audit?.cardPath !== null && audit?.cardPath !== undefined) out.push({ kind: 'audit-card', label: t('评估卡'), path: String(audit.cardPath) })
				if (audit?.evaluatorSession !== null && audit?.evaluatorSession !== undefined) out.push({ kind: 'evaluator-session', label: t('查看评估者'), session: String(audit.evaluatorSession) })
			}
			const fallbackPaths = (item.refs ?? []).map((ref) => asPath(ref)).filter((path) => path !== null)
			for (const ref of item.refs ?? []) {
				const path = asPath(ref)
				if (path !== null) out.push({ kind: 'artifact', label: fileLabel(path, fallbackPaths), path })
			}
			const released = (data?.releases ?? []).find((row) => row.step === item.stepId)
			if (released !== undefined) out.push({ kind: 'approval-record', label: t('审批记录'), path: null, call: released.call ?? null })
			return out
		}

		/**
		 * 一条**事实**的证据落在哪一步(纯函数:可单测)。
		 *
		 * 为什么需要:会话结案后命题已升格为事实、离开命题货架 ⇒ 命题 drill 里那条
		 * 「在世界树里看这一步」就够不着了 ✗。事实这一层同样要能跳回它那一步。
		 */
		function stepOfFact(data, fact) {
			for (const id of fact?.evidenceIds ?? []) {
				const item = (data?.evidence ?? []).find((entry) => entry.id === id)
				const stepId = item?.stepId
				if (typeof stepId === 'string' && stepId !== '') return stepId
			}
			return null
		}

		/**
		 * ═══ 本体格(第六阶段:图为主) ═══
		 *
		 * 一屏三层,自上而下越来越细:
		 *   ① 页眉:在回答什么 · 一行计数 · 待处理(只陈述)· 迷你进度轨(判断 → 检验 → 已验证 → 入本体);
		 *   ② 图:本体图 / 实体图二选一,星图式(点 + 衬线标签;实线已验证、虚线待核验);
		 *   ③ 结论:一行一条,按可信度分组;点开依次是 进度 → 可信度怎么变的 → 补充。
		 *
		 * 用词与运行态卡**同一套**(`knowledge-view.js` 的 TRUST / VERDICT_WORD / LEVEL_WORD):
		 * 单次检验的结果是 支持 / 推翻 / 不确定;一条结论的状态是 已验证 / 待核验 / 验证中 / 不确定 / 已推翻 / 已替换。
		 * 内部编号(h-… / e-… / s-…)不上屏:人认的是短名和「第几步」。
		 */
		const TRUST_ORDER = ['credible', 'pending', 'testing', 'unclear', 'refuted', 'replaced']
		const TRUST_WORD = lazyTable(() => ({ credible: t('已验证'), pending: t('待核验'), testing: t('验证中'), unclear: t('不确定'), refuted: t('已推翻'), replaced: t('已替换') }))
		const LEVEL_WORD = lazyTable(() => ({ L0: t('自行检验'), L1: t('自行检验'), L2: t('自行检验'), L3: t('独立核验'), L4: t('人工批准') }))
		/** 进度轨的四站。顺序即一条结论要走的路。 */
		const STATIONS = () => [t('判断'), t('检验'), t('已验证'), t('纳入本体')]
		/** 还没走完时,下一步是什么(时间线末尾那条虚点)。 */
		const NEXT_STEP = lazyTable(() => ({
			testing: t('下一步:安排步骤对其进行检验'),
			pending: t('下一步:通过独立核验后标记为已验证'),
			unclear: t('下一步:改用其他方法重新检验'),
			credible: t('下一步:结案时写入长期知识'),
		}))
		/** 值的形态(本体图上的小方块):内部词换成人话。 */
		const FORM_WORD = lazyTable(() => ({ statement: t('陈述'), quantity: t('数值'), formula: t('公式'), code: t('代码'), reference: t('引用') }))
		const KIND_WORD = lazyTable(() => ({ concept: t('概念'), value_type: t('取值形态'), instance: t('实例'), literal: t('取值'), edge: t('关系') }))

		/** 一步检验是怎么做的:独立核验直接说;自己做的,说到了哪一级(可复算 / 引用材料 / 推了一遍)。 */
		const howOf = (row) => (row.evaluator === 'independent' ? t('独立核验') : (LEVEL_WORD[row.level] ?? t('自行检验')))

		/**
		 * **结论行的模型**(纯函数,导出给测试)。
		 *
		 * 一条判断一行;旧账本里没有判断关联的事实也各占一行(它们已经写进长期知识,只是不知道出自哪条判断)。
		 * 站位:写进长期知识 = 4,已验证 = 3,检验过 = 2,只是提出 = 1;被推翻的停在「检验」那一站。
		 */
		function conclusionsOf(data) {
			const facts = Array.isArray(data?.facts) ? data.facts : []
			const ordinalOf = new Map()
			for (const plan of [...(Array.isArray(data?.plans) ? data.plans : []), ...(data?.plan ? [data.plan] : [])]) {
				for (const step of plan?.steps ?? []) if (typeof step?.id === 'string') ordinalOf.set(step.id, step.ordinal ?? null)
			}
			const testingStep = (id) => {
				for (const [stepId, meta] of Object.entries(data?.stepIndex ?? {})) if (testedOf(meta).includes(id)) return ordinalOf.get(stepId) ?? null
				return null
			}
			const linked = new Set()
			const rows = (Array.isArray(data?.goal?.hypotheses) ? data.goal.hypotheses : []).map((hypothesis) => {
				const history = Array.isArray(hypothesis.history) ? hypothesis.history : []
				const fact = facts.find((item) => item.hypothesis === hypothesis.id) ?? null
				if (fact !== null) linked.add(fact.id)
				const lastEvidence = [...history].reverse().find((row) => row.kind === 'evidence') ?? null
				const promoted = fact !== null && fact.review?.decision !== 'retracted'
				const trust = TRUST_ORDER.includes(hypothesis.trust) ? hypothesis.trust : 'testing'
				const station = trust === 'refuted' ? 2 : promoted ? 4 : trust === 'credible' ? 3 : lastEvidence !== null ? 2 : 1
				return {
					key: hypothesis.id,
					hypothesis: hypothesis.id,
					name: String(hypothesis.name ?? ''),
					claim: String(hypothesis.claim ?? ''),
					trust,
					station,
					history,
					refuteWhen: hypothesis.refuteWhen ?? null,
					scope: fact?.scope ?? hypothesis.fact?.scope ?? null,
					basis: lastEvidence?.basis ?? null,
					evidenceId: lastEvidence?.id ?? null,
					step: lastEvidence?.ordinal ?? testingStep(hypothesis.id),
					assertions: fact?.assertions ?? hypothesis.assertions ?? null,
					fact: fact?.id ?? null,
				}
			})
			for (const fact of facts) {
				if (linked.has(fact.id)) continue
				const trust = fact.review?.decision === 'retracted' ? 'replaced' : fact.refuted === true ? 'refuted' : 'credible'
				rows.push({
					key: fact.id,
					hypothesis: null,
					name: '',
					claim: String(fact.text ?? ''),
					trust,
					station: trust === 'credible' ? 4 : 2,
					history: [{ kind: 'promoted', at: fact.at ?? null, level: fact.level ?? null, to: 'credible' }],
					refuteWhen: null,
					scope: fact.scope ?? null,
					basis: null,
					evidenceId: (fact.evidenceIds ?? [])[0] ?? null,
					step: null,
					assertions: fact.assertions ?? null,
					fact: fact.id,
				})
			}
			return rows
		}

		/** 短名与主张重复时只说一遍(没起短名的旧判断,短名就是主张的开头)。 */
		const titleOf = (row) => {
			const name = row.name.trim()
			if (name === '' || name.endsWith('…') || row.claim.startsWith(name)) return { title: brief(row.claim, 40), sub: null }
			return { title: name, sub: brief(row.claim, 60) }
		}

		/** 状态小签:实心 = 已验证,描边 = 待核验,淡描边 = 验证中,虚边 = 不确定,红 = 已推翻,删除线 = 已替换。 */
		function TrustTag(props) {
			return h('span', { className: 'clearai-trust', 'data-trust': props.trust }, TRUST_WORD[props.trust] ?? props.trust)
		}

		/** 四站进度条:走过的实心,在路上的那一段斜纹,当前站名加粗。 */
		function StationBar(props) {
			const reached = props.station
			const stopped = props.trust === 'refuted' || props.trust === 'replaced'
			const names = STATIONS()
			return h(
				'div',
				{ className: 'clearai-stations', 'data-stopped': stopped ? '1' : '0' },
				h(
					'div',
					{ className: 'clearai-stations-bar' },
					...names.map((_, index) => h('span', { key: `seg-${index}`, 'data-state': index < reached ? (stopped && index === reached - 1 ? 'broken' : 'done') : index === reached && !stopped ? 'next' : 'todo' })),
				),
				h('div', { className: 'clearai-stations-names' }, ...names.map((name, index) => h('span', { key: `name-${index}`, 'data-now': index === reached - 1 ? '1' : '0' }, name))),
				stopped ? h('div', { className: 'clearai-stations-note' }, props.trust === 'refuted' ? t('在检验阶段被推翻,不再推进。') : t('已被替换,不再推进。')) : null,
			)
		}

		/** 可信度怎么变的:一笔一行,变了的那一笔写出「之前 → 之后」。 */
		function TrustTimeline(props) {
			const rows = props.history
			const lines = rows.map((row, index) => {
				let text = ''
				if (row.kind === 'proposed') text = t('提出')
				else if (row.kind === 'evidence') text = `${row.ordinal === null || row.ordinal === undefined ? t('单步检验') : `${nth(row.ordinal)}`}${t(':')}${VERDICT[row.verdict] ?? row.verdict} · ${howOf(row)}`
				else if (row.kind === 'promoted') text = t('写入长期知识')
				else if (row.kind === 'retracted') text = `${t('人工撤回')}${row.reason ? `:${brief(row.reason, 40)}` : ''}`
				const moved = row.from !== undefined && row.from !== row.to
				return h(
					'div',
					{ key: `tl-${index}`, className: 'clearai-tl-row', 'data-kind': row.kind, 'data-verdict': row.verdict ?? '' },
					h('span', { className: 'clearai-tl-dot' }),
					h('span', { className: 'clearai-tl-time' }, when(row.at)),
					h('span', null, text, moved ? h('b', { className: 'clearai-tl-move' }, ` · ${TRUST_WORD[row.from] ?? row.from} → ${TRUST_WORD[row.to] ?? row.to}`) : null),
				)
			})
			const next = props.station >= 4 || props.trust === 'refuted' || props.trust === 'replaced' ? null : (NEXT_STEP[props.trust] ?? null)
			if (next !== null) lines.push(h('div', { key: 'tl-next', className: 'clearai-tl-row', 'data-kind': 'next' }, h('span', { className: 'clearai-tl-dot' }), h('span', { className: 'clearai-tl-time' }, ''), h('span', null, next)))
			return h('div', { className: 'clearai-tl' }, ...lines)
		}

		/** 点开一条:进度 → 可信度怎么变的 → 补充,依次往下。 */
		function ConclusionDetail(props) {
			const { row, data } = props
			const evidence = row.evidenceId === null ? null : ((data?.evidence ?? []).find((item) => item.id === row.evidenceId) ?? null)
			const origins = evidence === null ? [] : originsOf(data, evidence)
			const subjects = [...new Set((Array.isArray(row.assertions) ? row.assertions : []).map((assertion) => String(assertion?.subject?.id ?? '')).filter((id) => id !== ''))]
			const part = (index, title, body) => h('div', { className: 'clearai-part' }, h('div', { className: 'clearai-part-head' }, h('b', null, String(index)), title), body)
			const kv = (label, value) => (value === null || value === undefined || value === '' ? [] : [h('span', { key: `k-${label}` }, label), h('span', { key: `v-${label}` }, value)])
			return h(
				'div',
				{ className: 'clearai-detail' },
				part(1, t('进度'), h(StationBar, { station: row.station, trust: row.trust })),
				part(2, t('可信度变化'), h(TrustTimeline, { history: row.history, station: row.station, trust: row.trust })),
				part(
					3,
					t('补充说明'),
					h(
						'div',
						{ className: 'clearai-kv' },
						...kv(
							t('依据'),
							row.basis === null
								? null
								: h(
										'span',
										null,
										h('span', { title: String(row.basis) }, brief(row.basis, 120)),
										...origins
											.filter((origin) => origin.path !== null || origin.session !== null)
											.slice(0, 2)
											.map((origin, index) =>
												h(
													'span',
													{
														key: `o-${index}`,
														className: 'clearai-link',
														style: { marginLeft: 8 },
														onClick: () => (origin.session !== null && origin.kind === 'evaluator-session' ? data.openSpectator?.(origin.session) : data.openPreview?.(origin.path)),
														title: origin.path ?? '',
													},
													origin.kind === 'audit-card' || origin.kind === 'evaluator-session' ? t('查看核验') : t('查看记录'),
												),
											),
									),
						),
						...kv(t('范围'), row.scope === row.refuteWhen ? null : row.scope),
						...kv(t('推翻条件'), row.refuteWhen),
						...kv(
							t('相关'),
							subjects.length === 0
								? null
								: h('span', { className: 'clearai-chips' }, ...subjects.map((id) => h('span', { key: id, className: 'clearai-chip', onClick: () => props.onFocus?.(id), title: t('在图中定位') }, labelOfEntity(data, id)))),
						),
						...kv(t('来源'), row.step === null ? null : `${nth(row.step)}`),
					),
				),
			)
		}

		/** 实例在图上的名字(登记时给的 label);图上没有它就退回 id。 */
		const labelOfEntity = (data, id) => String((data?.lexicon?.graph?.nodes ?? []).find((node) => node.layer === 'entity' && String(node.ref ?? '') === id)?.label ?? id)

		/** 一条结论一行:状态签 + 短名(+ 主张)+ 出自第几步。 */
		function ConclusionRow(props) {
			const { row, open } = props
			const { title, sub } = titleOf(row)
			return h(
				'div',
				{ className: 'clearai-row', 'data-open': open ? '1' : '0', 'data-trust': row.trust },
				h(
					'div',
					{ className: 'clearai-row-head', onClick: () => props.onToggle(row.key), title: open ? t('收起') : t('点击查看进度与来源') },
					h(TrustTag, { trust: row.trust }),
					h('span', { className: 'clearai-row-title' }, title),
					sub === null ? null : h('span', { className: 'clearai-row-sub' }, sub),
					h('span', { className: 'clearai-row-step' }, row.step === null ? '' : `${nth(row.step)}`),
				),
				open ? h(ConclusionDetail, { row, data: props.data, onFocus: props.onFocus }) : null,
			)
		}

		/** 结论列表:按可信度分组,空组不出现。 */
		function ConclusionList(props) {
			const rows = props.rows
			if (rows.length === 0) return h('div', { className: 'clearai-quiet' }, props.empty ?? t('暂无结论。模型提出判断后,将在此逐条列出。'))
			return h(
				'div',
				{ className: 'clearai-list' },
				...TRUST_ORDER.map((trust) => {
					const group = rows.filter((row) => row.trust === trust)
					if (group.length === 0) return null
					return h(
						'div',
						{ key: trust, className: 'clearai-group' },
						h('div', { className: 'clearai-group-head' }, TRUST_WORD[trust], h('span', null, String(group.length))),
						...group.map((row) => h(ConclusionRow, { key: row.key, row, open: props.open === row.key, onToggle: props.onToggle, data: props.data, onFocus: props.onFocus })),
					)
				}),
			)
		}

		/** 页眉:在回答什么(计数、待处理与进度轨归探索货架)。 */
		function AtlasHeader(props) {
			const { data } = props
			return h(
				'div',
				{ className: 'clearai-head' },
				h('div', { className: 'clearai-question', title: String(data?.goal?.claim ?? '') }, data?.goal ? String(data.knowledgeView?.goal?.headline ?? data.goal.claim ?? '') : t('尚未设立目标')),
			)
		}

		/**
		 * **本体格**(中栏视图)。
		 *
		 * 取数与从前一样:宿主半的会话投影单元 `clearai` 由插座作为 `useProjection` 交下来。
		 * 界面状态(图层、全屏、选中、展开哪条、只看哪个词)全是界面的事,一个字节都不进账本。
		 */
		function Atlas(props) {
			const projected = typeof props.useProjection === 'function' ? props.useProjection('clearai') : undefined
			const [manual, setManual] = React.useState(null)
			const [layer, setLayer] = React.useState('ontology')
			const [workspace, setWorkspace] = React.useState(false)
			const [filter, setFilter] = React.useState(null)
			const [focusNode, setFocusNode] = React.useState(null)
			const incoming = useFocus(factsFocus)
			/** 样式表由 `apply` 挂;面板被单独挂载(截图、预览)时也自己挂一次——同一个标记,不会挂两份。 */
			React.useEffect(() => {
				installStyles()
			}, [])
			if (projected === undefined || projected === null) {
				return h('div', { className: 'clearai-atlas' }, h(Empty, null, t('暂无内容。发送第一条消息后,此处将显示本体图与结论。')))
			}
			const data = { ...projected, openPreview: props.openPreview, openSpectator: props.openSpectator }
			/** 本体货架只放结果:已确立的事实(判断的全部过程在探索货架的「过程记录」里)。 */
			const rows = conclusionsOf(data).filter((row) => row.trust === 'credible')
			const lexicon = data.lexicon ?? null
			/** 世界树那边点进来的聚焦优先;手动点行仍然有效。 */
			const focused = incoming === null || incoming === undefined ? null : propositionForStep(data, incoming.step)
			const open = focused ?? manual
			const filterTerm = filter === null ? null : ((lexicon?.terms ?? []).find((item) => item.id === filter) ?? (lexicon?.predicates ?? []).find((item) => item.id === filter) ?? { id: filter, label: filter, aliases: [] })
			const shown = filterTerm === null ? rows : rows.filter((row) => termMatches(filterTerm, row))
			const gaps = Array.isArray(data.knowledge?.gaps) ? data.knowledge.gaps : []
			const unlandedRow = gaps.find((gap) => gap?.code === 'entities_unlanded')
			return h(
				'div',
				{ className: 'clearai-atlas' },
				h(AtlasHeader, { data }),
				h(AnswerCards, { data, openExplore: props.openExplore }),
				h(GraphBand, {
					lexicon,
					data,
					send: props.send,
					layer,
					unlanded: typeof unlandedRow?.count === 'number' ? unlandedRow.count : null,
					onLayer: setLayer,
					onFilter: (id) => setFilter(filter === id ? null : id),
					focus: focusNode,
					sessionId: data.sessionId,
					fullscreen: workspace,
					onToggleFullscreen: () => setWorkspace(workspace !== true),
				}),
				filterTerm === null
					? null
					: h(
							'div',
							{ className: 'clearai-filter' },
							`${t('仅显示与「')}${String(filterTerm.label ?? filterTerm.id)}${t('」相关的内容')}${t(':')}${shown.length}/${rows.length}`,
							h('span', { className: 'clearai-link', onClick: () => setFilter(null) }, t('清除')),
						),
				h('div', { className: 'clearai-section-head' }, t('已确立的事实')),
				h(ConclusionList, {
					rows: shown,
					empty: t('暂无已确立的事实。判断经检验与独立核验后,将在此列出;检验过程见探索货架。'),
					open,
					data,
					onToggle: (key) => {
						factsFocus.set(null)
						setManual(open === key ? null : key)
					},
					onFocus: (id) => {
						const node = (lexicon?.graph?.nodes ?? []).find((item) => item.layer === 'entity' && String(item.ref ?? '') === id)
						if (node !== undefined) {
							setLayer('entity')
							setFocusNode(node.id)
						}
					},
				}),
				(data.lessons ?? []).length === 0 ? null : h('div', { className: 'clearai-section-head' }, `${t('经验(')}${data.lessons.length}${t(')')}`),
				h(LessonList, { data }),
			)
		}

		/**
		 * **探索货架**(中栏视图,紧挨「本体」):过程在这里,结果在本体货架。
		 *
		 * 主轴是 问题 → 候选假设(定向求解)或 调研板块 → 新发现的问题(广度调研),
		 * 读的是宿主算好的 `exploration`(与运行态卡上「当前位置」同一份派生)。
		 * 候选的状态只从证据来;界面不写任何状态。「立为问题 / 暂缓」两个按钮只是**替人发一句话**
		 * 给模型,由模型用 Frame 修订落账——与「要改什么就在对话里说」是同一条路。
		 */
		const MODE_WORD = lazyTable(() => ({ survey: t('广度调研'), solve: t('定向求解'), survey_then_solve: t('先调研后求解') }))
		const CANDIDATE_WORD = lazyTable(() => ({ examining: t('考察中'), excluded: t('已排除'), adopted: t('已采纳'), set_aside: t('暂不考察') }))
		const AREA_WORD = lazyTable(() => ({ not_started: t('未开始'), in_progress: t('调研中'), clear: t('已厘清') }))
		const LESSON_WORD = lazyTable(() => ({ trap: t('常见误区'), check: t('前置核查'), shortcut: t('不可取的捷径'), prior: t('先验知识') }))


		/** 一条候选最近一条某种结论的依据(排除依据 / 采纳依据都从证据里来)。 */
		const latestBasis = (data, hypothesis, verdict) => {
			const rows = (Array.isArray(data?.evidence) ? data.evidence : []).filter((item) => item.hypothesis === hypothesis && item.verdict === verdict)
			return rows.length === 0 ? null : String(rows[rows.length - 1].basis ?? '') || null
		}

		/** 候选假设展开后的几行(标签按界面用语规范:引用的已有知识 / 主张 / 推翻条件 / 预测 / 排除依据 / 采纳依据 / 关联记录)。 */
		function candidateDetail(data, candidate, prediction) {
			const rows = []
			const push = (label, value) => {
				if (value !== null && value !== undefined && value !== '') rows.push([label, value])
			}
			/** 引用的已有条目与系统的判定(取代原来的「提出依据」):判断写了 `uses` 才有。 */
			const hypothesis = (Array.isArray(data?.goal?.hypotheses) ? data.goal.hypotheses : []).find((item) => item.id === candidate.id)
			const uses = Array.isArray(hypothesis?.uses) ? hypothesis.uses : []
			const byKey = itemsByKey(data)
			push(t('引用的已有知识'), uses.length === 0 ? null : uses.map((use) => `${byKey.get(`${use.kind}:${use.id}`)?.text ? brief(byKey.get(`${use.kind}:${use.id}`).text, 40) : use.id}(${VERDICT_WORD[use.verdict] ?? use.verdict})`).join(t('、')))
			push(t('主张'), candidate.claim !== candidate.name ? candidate.claim : null)
			push(t('推翻条件'), candidate.refuteWhen)
			push(t('预测'), prediction)
			if (candidate.state === 'excluded') push(t('排除依据'), latestBasis(data, candidate.id, 'refute'))
			if (candidate.state === 'adopted') push(t('采纳依据'), latestBasis(data, candidate.id, 'support'))
			const support = (Array.isArray(data?.evidence) ? data.evidence : []).filter((item) => item.hypothesis === candidate.id && item.verdict === 'support').length
			push(t('关联记录'), `${t('支持 ')}${support}${t(' 条 · 推翻 ')}${candidate.refutations}${t(' 条 · 无法判定 ')}${candidate.inconclusive}${t(' 条')}`)
			return rows
		}

		/** 状态小签:候选与板块各用自己的一套词,颜色按状态族走(进行中 / 否定 / 肯定 / 搁置)。 */
		function StateTag(props) {
			return h('span', { className: 'clearai-state', 'data-s': props.state }, props.children)
		}

		/** 一个问题:标题、计数、候选列表(可展开)、暂不考察的放在页脚。 */
		function QuestionBox(props) {
			const { data, question, index, next, open, onToggle } = props
			const shown = question.candidates.filter((candidate) => candidate.state !== 'set_aside')
			const parked = question.candidates.filter((candidate) => candidate.state === 'set_aside')
			const counts = ['examining', 'excluded', 'adopted'].filter((key) => (question.counts?.[key] ?? 0) > 0).map((key) => `${CANDIDATE_WORD[key]} ${question.counts[key]}`)
			const predictionOf = (id) => (next?.predictions ?? []).find((item) => item.hypothesis === id)?.expect ?? null
			const status =
				question.status === 'answered'
					? h('span', { className: 'clearai-link', onClick: () => props.openFacts?.(), title: t('在本体货架中展开此结论') }, t('已得出结论 · 查看结论'))
					: question.status === 'parked'
						? h('span', null, t('已暂缓'))
						: question.status === 'emergent'
							? h('span', null, t('新发现,待您决定'))
							: h('span', null, shown.length === 0 ? t('尚无候选假设') : `${t('候选假设 ')}${question.candidates.length}${t(' 个:')}${counts.join(' · ')}`)
			const compact = shown.length === 0 && question.status !== 'emergent'
			return h(
				'section',
				{ className: 'clearai-box', 'data-compact': compact ? '1' : '0', 'data-current': props.current ? '1' : '0' },
				h(
					'div',
					{ className: 'clearai-box-head' },
					question.implicit ? null : h('span', { className: 'clearai-box-kind' }, `${t('问题 ')}${index + 1}`),
					h('span', { className: 'clearai-box-title' }, question.implicit ? t('候选假设') : question.text),
					h('span', { className: 'clearai-box-note' }, status),
				),
				question.status === 'emergent' ? h(EmergentActions, { question, send: props.send, sent: props.sent, onSent: props.onSent }) : null,
				...shown.map((candidate) => {
					const isOpen = open === candidate.id
					return h(
						'div',
						{ key: candidate.id, className: 'clearai-cand', 'data-open': isOpen ? '1' : '0', 'data-s': candidate.state },
						h(
							'button',
							{ type: 'button', className: 'clearai-cand-head', 'aria-expanded': isOpen ? 'true' : 'false', onClick: () => onToggle(isOpen ? null : candidate.id) },
							h(StateTag, { state: candidate.state }, CANDIDATE_WORD[candidate.state] ?? candidate.state),
							h('span', { className: 'clearai-cand-name' }, candidate.name),
							candidate.claim !== candidate.name ? h('span', { className: 'clearai-cand-note' }, brief(candidate.claim, 80)) : null,
							h('span', { className: 'clearai-cand-chevron', 'aria-hidden': 'true' }, isOpen ? t('收起') : t('展开')),
						),
						isOpen
							? h(
									'div',
									{ className: 'clearai-cand-detail' },
									...candidateDetail(data, candidate, predictionOf(candidate.id)).map(([label, value]) => h('div', { key: label, className: 'clearai-kvrow' }, h('span', null, label), h('span', null, value))),
								)
							: null,
					)
				}),
				parked.length === 0
					? null
					: h(
							'div',
							{ className: 'clearai-box-foot' },
							...parked.map((candidate) => h('span', { key: candidate.id, className: 'clearai-parked' }, h(StateTag, { state: 'set_aside' }, CANDIDATE_WORD.set_aside), h('s', null, candidate.name))),
						),
			)
		}

		/**
		 * 「立为问题 / 暂缓」:替人发一句话给模型(模型用 Frame 修订落账),界面自己不写状态。
		 * 发不出去(拿不到会话的对话服务)就如实说请在对话中说明,不假装发了。
		 */
		function EmergentActions(props) {
			const { question } = props
			const sent = props.sent?.[question.id] ?? null
			if (sent === 'pursue') return h('div', { className: 'clearai-emergent-done' }, t('已请求立为问题,待模型修订立题后生效。'))
			if (sent === 'park') return h('div', { className: 'clearai-emergent-done' }, t('已请求暂缓,结案时列入「尚未确定的事项」。'))
			if (sent === 'failed') return h('div', { className: 'clearai-emergent-done' }, t('无法自动发送,请在对话中说明。'))
			const ask = (kind, text) => props.onSent?.(question.id, typeof props.send === 'function' && props.send(text) === true ? kind : 'failed')
			return h(
				'div',
				{ className: 'clearai-emergent' },
				h('span', { className: 'clearai-emergent-kind' }, t('新发现的问题')),
				h('span', { className: 'clearai-emergent-text' }, question.text),
				h(
					'span',
					{ className: 'clearai-emergent-actions' },
					h('button', { type: 'button', className: 'clearai-btn', 'data-primary': '1', onClick: () => ask('pursue', `${t('请将新发现的问题「')}${question.text}${t('」立为问题深入研究(问题 ')}${question.id}${t(')。')}`) }, t('立为问题')),
					h('button', { type: 'button', className: 'clearai-btn', onClick: () => ask('park', `${t('请暂缓问题「')}${question.text}${t('」(问题 ')}${question.id}${t('),结案时列入「尚未确定的事项」。')}`) }, t('暂缓')),
				),
			)
		}

		/** 广度调研:调研板块一行一个,板块下挂新发现的问题。 */
		function AreaBox(props) {
			const { exploration } = props
			const areas = exploration.areas ?? []
			const counts = ['clear', 'in_progress', 'not_started'].map((key) => [key, areas.filter((area) => area.state === key).length]).filter(([, count]) => count > 0)
			return h(
				'section',
				{ className: 'clearai-box' },
				h('div', { className: 'clearai-box-head' }, h('span', { className: 'clearai-box-title' }, t('调研板块')), h('span', { className: 'clearai-box-note' }, counts.map(([key, count]) => `${AREA_WORD[key]} ${count}`).join(' · '))),
				...areas.map((area) => {
					const emergent = (exploration.questions ?? []).filter((question) => question.area === area.id && question.status === 'emergent')
					const note = [`${t('判断 ')}${area.judgments}${t(' 条 · 已采纳 ')}${area.verified}${t(' 条')}`, area.openAnomalies > 0 ? `${t('未解释的现象 ')}${area.openAnomalies}${t(' 项')}` : null].filter((item) => item !== null).join(' · ')
					return h(
						'div',
						{ key: area.id, className: 'clearai-cand', 'data-s': area.state },
						h('div', { className: 'clearai-cand-head', 'data-static': '1' }, h(StateTag, { state: area.state }, AREA_WORD[area.state] ?? area.state), h('span', { className: 'clearai-cand-name' }, area.name), h('span', { className: 'clearai-cand-note' }, note)),
						...emergent.map((question) => h(EmergentActions, { key: question.id, question, send: props.send, sent: props.sent, onSent: props.onSent })),
					)
				}),
			)
		}

		/** 下一步:做什么,以及各候选的预测;预测相同就如实说这一步区分不了。 */
		function NextBox(props) {
			const next = props.next
			if (next === null || next === undefined) return null
			const predictions = Array.isArray(next.predictions) ? next.predictions : []
			return h(
				'section',
				{ className: 'clearai-next' },
				h('div', { className: 'clearai-next-head' }, h('span', { className: 'clearai-next-kind' }, t('下一步')), h('span', { className: 'clearai-next-title' }, `${nth(next.ordinal)}${t(':')}${next.do}`)),
				predictions.length === 0
					? next.expect
						? h('div', { className: 'clearai-next-note' }, `${t('预测:')}${next.expect}`)
						: null
					: h(
							'div',
							{ className: 'clearai-preds' },
							...predictions.map((item, index) => h('div', { key: `p-${index}`, className: 'clearai-pred' }, h('div', { className: 'clearai-pred-if' }, `${t('若「')}${item.name}${t('」成立,预测')}`), h('div', { className: 'clearai-pred-value' }, item.expect))),
						),
				next.indistinct === true
					? h('div', { className: 'clearai-next-warn' }, t('各候选假设的预测相同,此步骤无法区分它们。'))
					: h('div', { className: 'clearai-next-note' }, t('如需调整计划,请在对话中说明。')),
			)
		}

		/** 未解释的现象:开着的逐条列出(结案时必须写进「尚未确定的事项」或先有去处)。 */
		function AnomalyBox(props) {
			const open = (Array.isArray(props.data?.anomalies) ? props.data.anomalies : []).filter((item) => item.status === 'open')
			if (open.length === 0) return null
			return h(
				'section',
				{ className: 'clearai-box' },
				h('div', { className: 'clearai-box-head' }, h('span', { className: 'clearai-box-title' }, `${t('未解释的现象(')}${open.length}${t(')')}`), h('span', { className: 'clearai-box-note' }, t('结案前须解释、排除或写入「尚未确定的事项」'))),
				...open.map((item) =>
					h(
						'div',
						{ key: item.id, className: 'clearai-anomaly' },
						h('span', null, item.what),
						item.by === 'evaluator' ? h('span', { className: 'clearai-anomaly-meta' }, t('独立评估发现')) : null,
						(item.touches ?? []).length > 0 ? h('span', { className: 'clearai-anomaly-meta' }, `${t('涉及:')}${item.touches.join(t('、'))}`) : null,
					),
				),
			)
		}

		/** 判断的计数与四站进度轨(原在本体货架页眉;过程信息归探索货架)。 */
		function JudgmentSummary(props) {
			const rows = props.rows
			const live = rows.filter((row) => row.trust !== 'replaced')
			const counts = TRUST_ORDER.filter((trust) => trust !== 'replaced')
				.map((trust) => [trust, rows.filter((row) => row.trust === trust).length])
				.filter(([, count]) => count > 0)
			const stations = STATIONS().map((name, index) => [name, live.filter((row) => row.station >= index + 1).length])
			return h(
				'div',
				{ className: 'clearai-judgments-head' },
				counts.length === 0 ? null : h('div', { className: 'clearai-counts' }, counts.map(([trust, count]) => `${TRUST_WORD[trust]} ${count}`).join(' · ')),
				live.length === 0
					? null
					: h(
							'div',
							{ className: 'clearai-track' },
							...stations.flatMap(([name, count], index) => [
								index === 0 ? null : h('span', { key: `line-${index}`, className: 'clearai-track-line', 'data-on': count > 0 ? '1' : '0' }),
								h('span', { key: `st-${index}`, className: 'clearai-track-stop', 'data-on': count > 0 ? '1' : '0' }, h('i', null), `${name} ${count}`),
							]),
						),
			)
		}

		function ExploreView(props) {
			const projected = typeof props.useProjection === 'function' ? props.useProjection('clearai') : undefined
			const [open, setOpen] = React.useState(null)
			const [processOpen, setProcessOpen] = React.useState(false)
			const [manual, setManual] = React.useState(null)
			const [sent, setSent] = React.useState({})
			const incoming = useFocus(factsFocus)
			React.useEffect(() => {
				installStyles()
			}, [])
			if (projected === undefined || projected === null) return h('div', { className: 'clearai-atlas' }, h(Empty, null, t('暂无内容。发送第一条消息后,此处将显示问题、候选假设与下一步。')))
			const data = { ...projected, openPreview: props.openPreview, openSpectator: props.openSpectator }
			const exploration = data.exploration ?? null
			const goal = data.goal ?? null
			const rows = conclusionsOf(data)
			const openFacts = () => props.openFacts?.()
			const onSent = (id, kind) => setSent({ ...sent, [id]: kind })
			const focused = incoming === null || incoming === undefined ? null : propositionForStep(data, incoming.step)
			const opened = focused ?? manual
			const showProcess = processOpen || focused !== null
			if (goal === null) {
				return h('div', { className: 'clearai-atlas' }, h(Empty, null, t('尚未设立目标。模型立题后,此处将显示问题、候选假设与下一步。')))
			}
			const questions = Array.isArray(exploration?.questions) ? exploration.questions : []
			const declared = questions.filter((question) => !question.implicit)
			const areas = Array.isArray(exploration?.areas) ? exploration.areas : []
			const currentIndex = declared.findIndex((question) => question.id === exploration?.current)
			const plan = data.plan ?? null
			const steps = plan === null ? [] : (plan.steps ?? []).filter((step) => step.status !== 'void')
			const doneSteps = steps.filter((step) => step.status === 'advanced').length
			const chips = [
				exploration?.mode ? `${t('阶段 · ')}${MODE_WORD[exploration.mode] ?? exploration.mode}` : null,
				areas.length > 0 ? `${t('调研板块 ')}${areas.length}${t(' 个 · 已厘清 ')}${areas.filter((area) => area.state === 'clear').length}${t(' 个')}` : null,
				declared.length > 0 && currentIndex >= 0 ? `${t('当前问题 ')}${currentIndex + 1}${t(' / 共 ')}${declared.length}` : null,
				steps.length > 0 ? `${t('计划 已完成 ')}${doneSteps}${t(' / ')}${steps.length}${t(' 步')}` : null,
			].filter((item) => item !== null)
			const needYou = Array.isArray(data.needYou) ? data.needYou : []
			const audits = (Array.isArray(data.audits) ? data.audits : []).length
			const openAnomalies = (Array.isArray(data.anomalies) ? data.anomalies : []).filter((item) => item.status === 'open').length
			const running = steps.find((step) => step.status === 'open') ?? null
			const summary = [`${t('判断 ')}${rows.length}${t(' 条')}`, `${t('独立评估 ')}${audits}${t(' 次')}`, `${t('未解释的现象 ')}${openAnomalies}${t(' 项')}`, steps.length > 0 ? `${t('计划共 ')}${steps.length}${t(' 步')}${running === null ? '' : `${t('(')}${nth(running.ordinal)}${t('进行中)')}`}` : null].filter((item) => item !== null).join(' · ')
			const questionList = questions.filter((question) => question.implicit || question.area === null || question.area === undefined || question.status !== 'emergent')
			return h(
				'div',
				{ className: 'clearai-atlas' },
				h(
					'div',
					{ className: 'clearai-head' },
					h('div', { className: 'clearai-head-kind' }, t('课题')),
					h('div', { className: 'clearai-question', title: String(goal.claim ?? '') }, String(goal.headline ?? data.knowledgeView?.goal?.headline ?? goal.claim ?? '')),
					chips.length === 0 ? null : h('div', { className: 'clearai-pills' }, ...chips.map((chip, index) => h('span', { key: `c-${index}`, className: 'clearai-pill' }, chip))),
				),
				needYou.length === 0
					? null
					: h(
							'section',
							{ className: 'clearai-waiting' },
							h('b', null, `${t('待您处理(')}${needYou.length}${t(')')}`),
							...needYou.map((item, index) => h('span', { key: `need-${index}` }, String(item?.text ?? ''))),
						),
				areas.length > 0 ? h(AreaBox, { exploration, send: props.send, sent, onSent }) : null,
				...questionList.map((question) => h(QuestionBox, { key: question.id, data, question, index: declared.indexOf(question), current: question.id === exploration?.current, next: exploration?.next ?? null, open, onToggle: setOpen, openFacts, send: props.send, sent, onSent })),
				h(NextBox, { next: exploration?.next ?? null }),
				h(AnomalyBox, { data }),
				h(KnowledgeFlowBox, { data, openPreview: props.openPreview }),
				h(
					'section',
					{ className: 'clearai-process' },
					h(
						'button',
						{ type: 'button', className: 'clearai-process-head', 'aria-expanded': showProcess ? 'true' : 'false', onClick: () => {
							factsFocus.set(null)
							setProcessOpen(!showProcess)
						} },
						h('b', null, t('过程记录')),
						h('span', null, summary),
						h('span', { className: 'clearai-cand-chevron', 'aria-hidden': 'true' }, showProcess ? t('收起') : t('展开')),
					),
					showProcess
						? h(
								'div',
								{ className: 'clearai-process-body' },
								h(JudgmentSummary, { rows }),
								h(ConclusionList, {
									rows,
									open: opened,
									data,
									onToggle: (key) => {
										factsFocus.set(null)
										setManual(opened === key ? null : key)
									},
									onFocus: () => openFacts(),
								}),
								h(WorldTree, { data, openPreview: props.openPreview, openSpectator: props.openSpectator, openFacts: (stepId) => factsFocus.set({ step: stepId }) }),
							)
						: null,
				),
			)
		}

		/**
		 * **沉淀与取用**(0.5.2):条目、它在这次情形下是否适用、这次会留下什么。
		 * 读的是投影算好的 `knowledgeItems` / `entityKnowledge` / `knowledgeFlow`;界面不判定适用性,
		 * 条目上的按钮只替人向模型发一句话,由模型复检、撤回或修改后落账。
		 */
		const VERDICT_WORD = lazyTable(() => ({ applies: t('适用'), out_of_scope: t('超出适用范围'), out_of_range: t('超出取值范围'), undeclared: t('本次条件未声明'), unscoped: t('条目未声明适用范围'), definition_changed: t('口径已变更'), pending: t('待核验'), retracted: t('已撤回') }))
		const VERDICT_NEXT = lazyTable(() => ({ out_of_scope: t('本次不能直接沿用,需重新检验'), out_of_range: t('本次不能直接沿用,需重新检验'), undeclared: t('补充本次条件后重新判定'), unscoped: t('沿用时需自行确认'), definition_changed: t('按新口径换算或重新检验'), pending: t('先复检再沿用'), retracted: t('不得沿用') }))
		const ITEM_WORD = lazyTable(() => ({ established: t('已确立'), pending: t('待核验'), excluded: t('已排除'), preliminary_excluded: t('初步排除'), unresolved: t('未解释'), defect: t('测量或方法缺陷'), explained: t('已解释'), ruled_out: t('已判定无关'), escalated: t('已提交您处理') }))
		const COUNT_WORD = lazyTable(() => ({ established: t('已确立'), excluded: t('已排除'), bounded: t('超出适用范围'), pending: t('待核验'), unresolved: t('未解释') }))
		const COUNT_ORDER = ['established', 'excluded', 'bounded', 'pending', 'unresolved']

		/** 条目键(`kind:id`)→ 条目。 */
		const itemsByKey = (data) => new Map((Array.isArray(data?.knowledgeItems) ? data.knowledgeItems : []).map((item) => [`${item.kind}:${item.id}`, item]))

		/** 一条条目的出处:文件路径,没有就是 id。发给模型的话里用它,模型据此找到文件。 */
		const itemRef = (item) => String(item.path ?? item.id)

		/** 条目上的三个请求:只发一句话,不写任何状态。 */
		const ITEM_ASKS = () => [
			['retest', t('请求复检'), (item) => `${t('请复检条目「')}${item.text}${t('」(')}${itemRef(item)}${t(')。')}`],
			['retract', t('请求撤回'), (item) => `${t('请撤回条目「')}${item.text}${t('」(')}${itemRef(item)}${t('),并说明对已有结论的影响。')}`],
			['rescope', t('请求修改适用范围'), (item) => `${t('请与我确认条目「')}${item.text}${t('」(')}${itemRef(item)}${t(')的适用范围应如何修改。')}`],
		]

		function KnowledgeItemRow(props) {
			const { item } = props
			const meta = []
			if (item.scope) meta.push(`${t('范围:')}${item.scope}`)
			if (item.kind === 'negative' && item.strength && typeof item.strength.count === 'number') meta.push(`${t('推翻证据 ')}${item.strength.count}${t(' 条')}${item.strength.independent > 0 ? `${t(' · 独立核验 ')}${item.strength.independent}${t(' 条')}` : ''}`)
			if (item.basis) meta.push(`${t('依据')}${t(':')}${brief(item.basis, 80)}`)
			if (item.challenged === true) meta.push(t('受质疑'))
			const sent = props.sent ?? {}
			const [open, setOpen] = React.useState(false)
			const asks = props.asks === true && typeof props.send === 'function' && (open || props.open === true) ? ITEM_ASKS() : []
			const canAsk = props.asks === true && typeof props.send === 'function'
			const done = asks.find(([key]) => sent[`${item.kind}:${item.id}:${key}`] !== undefined)
			return h(
				'div',
				{ className: 'clearai-kitem', 'data-open': open ? '1' : '0' },
				h('div', { className: 'clearai-kitem-head', 'data-click': canAsk ? '1' : '0', title: canAsk ? (open ? t('收起') : t('点击查看可发出的请求')) : undefined, onClick: canAsk ? () => setOpen(!open) : undefined }, h(StateTag, { state: item.status }, item.kind === 'lesson' ? (LESSON_WORD[item.status] ?? item.status) : (ITEM_WORD[item.status] ?? item.status)), h('span', null, item.text), item.path ? h('span', { className: 'clearai-link', onClick: () => props.openPreview?.(item.path), title: item.path }, t('查看记录')) : null),
				meta.length === 0 ? null : h('div', { className: 'clearai-kitem-meta' }, meta.join(' · ')),
				asks.length === 0
					? null
					: done !== undefined
						? h('div', { className: 'clearai-kitem-meta' }, sent[`${item.kind}:${item.id}:${done[0]}`] === 'failed' ? t('无法自动发送,请在对话中说明。') : t('已发送请求,由模型处理后更新。'))
						: h('div', { className: 'clearai-kitem-asks' }, ...asks.map(([key, label, say]) => h('button', { key, type: 'button', className: 'clearai-btn', 'data-small': '1', onClick: () => props.onSent?.(`${item.kind}:${item.id}:${key}`, props.send(say(item)) === true ? 'sent' : 'failed') }, label))),
			)
		}

		/** 图上实体旁的条目计数(只列非零的格)。 */
		function CountMarks(props) {
			const counts = props.counts ?? {}
			const shown = COUNT_ORDER.filter((key) => (counts[key] ?? 0) > 0)
			if (shown.length === 0) return null
			return h('span', { className: 'clearai-kcount', title: shown.map((key) => `${COUNT_WORD[key]} ${counts[key]}`).join(' · ') }, ...shown.map((key) => h('em', { key, 'data-b': key }, String(counts[key]))))
		}

		/**
		 * **实体卡**:点实体图上的实例打开。六栏:已确立的事实 / 已排除 / 适用边界 / 测量与口径 / 未解释的现象 / 经验。
		 * 空栏不出现;全空就如实说还没有沉淀。
		 */
		function EntityCard(props) {
			const { node, data } = props
			const byKey = itemsByKey(data)
			const items = (data?.entityKnowledge?.[node.id]?.items ?? []).map((key) => byKey.get(key)).filter((item) => item !== undefined)
			const facts = items.filter((item) => item.kind === 'fact')
			const excluded = items.filter((item) => item.kind === 'negative' && (item.status === 'excluded' || item.status === 'preliminary_excluded'))
			const bounds = facts.flatMap((item) => item.boundaries.map((bound, index) => ({ key: `${item.id}#${index}`, text: item.text, bound })))
			const defects = items.filter((item) => item.kind === 'negative' && item.status === 'defect')
			const measures = (Array.isArray(data?.lexicon?.predicates) ? data.lexicon.predicates : []).filter((predicate) => predicate.kind === 'measures' && node.type !== null && (predicate.domain === node.type || predicate.range?.term === node.type))
			const unresolved = items.filter((item) => item.kind === 'negative' && (item.status === 'unresolved' || item.status === 'escalated'))
			const lessons = items.filter((item) => item.kind === 'lesson')
			const row = (item) => h(KnowledgeItemRow, { key: `${item.kind}:${item.id}`, item, asks: item.kind !== 'lesson', send: props.send, sent: props.sent, onSent: props.onSent, openPreview: data?.openPreview })
			const section = (title, children, count = children.length) => (children.length === 0 ? null : h('div', { className: 'clearai-ecard-sec' }, h('div', { className: 'clearai-ecard-head' }, `${title}(${count})`), ...children))
			const sections = [
				section(t('已确立的事实'), facts.map(row)),
				section(t('已排除'), [
					...excluded.filter((item) => item.status === 'excluded').map(row),
					...(excluded.some((item) => item.status === 'preliminary_excluded')
						? [h('details', { key: 'preliminary', className: 'clearai-ecard-fold' }, h('summary', null, `${t('初步排除(')}${excluded.filter((item) => item.status === 'preliminary_excluded').length}${t(')')}`), ...excluded.filter((item) => item.status === 'preliminary_excluded').map(row))]
						: []),
				], excluded.length),
				section(
					t('适用边界'),
					bounds.map(({ key, text, bound }) => h('div', { key, className: 'clearai-kitem' }, h('div', { className: 'clearai-kitem-head' }, h(StateTag, { state: 'bounded' }, VERDICT_WORD[bound.verdict] ?? bound.verdict), h('span', null, text)), bound.basis ? h('div', { className: 'clearai-kitem-meta' }, brief(bound.basis, 120)) : null)),
				),
				section(t('测量与口径'), [
					...measures.map((predicate) => h('div', { key: `m-${predicate.id}`, className: 'clearai-kitem' }, h('div', { className: 'clearai-kitem-head' }, h('span', null, String(predicate.label ?? predicate.id))), predicate.check ? h('div', { className: 'clearai-kitem-meta' }, `${t('校准关系')}${t(':')}${predicate.check}`) : null)),
					...defects.map(row),
				]),
				section(t('未解释的现象'), unresolved.map(row)),
				section(t('经验'), lessons.map(row)),
			].filter((item) => item !== null)
			return h(
				'div',
				{ className: 'clearai-ecard' },
				h('div', { className: 'clearai-ecard-title' }, String(node.label ?? node.ref ?? node.id), h(CountMarks, { counts: data?.entityKnowledge?.[node.id]?.counts })),
				sections.length === 0 ? h('div', { className: 'clearai-quiet' }, t('该实体暂无沉淀的知识。')) : null,
				...sections,
			)
		}

		/** 探索货架:引用的已有知识(系统判定)与将沉淀的内容。两节都空就不出现。 */
		function KnowledgeFlowBox(props) {
			const flow = props.data?.knowledgeFlow ?? null
			if (flow === null) return null
			const cited = Array.isArray(flow.cited) ? flow.cited : []
			const negatives = Array.isArray(flow.settling?.negatives) ? flow.settling.negatives : []
			const awaiting = Array.isArray(flow.settling?.awaiting) ? flow.settling.awaiting : []
			return h(
				React.Fragment,
				null,
				cited.length === 0
					? null
					: h(
							'section',
							{ className: 'clearai-box' },
							h('div', { className: 'clearai-box-head' }, h('span', { className: 'clearai-box-title' }, `${t('引用的已有知识(')}${cited.length}${t(')')}`)),
							...cited.map((item) =>
								h(
									'div',
									{ key: `${item.id}|${item.verdict}`, className: 'clearai-kitem' },
									h('div', { className: 'clearai-kitem-head' }, h(StateTag, { state: item.verdict }, VERDICT_WORD[item.verdict] ?? item.verdict), h('span', null, item.text ?? item.id), item.path ? h('span', { className: 'clearai-link', onClick: () => props.openPreview?.(item.path), title: item.path }, t('查看记录')) : null),
									h('div', { className: 'clearai-kitem-meta' }, [`${t('引用者:')}${item.by.join(t('、'))}`, VERDICT_NEXT[item.verdict] ?? null].filter((line) => line !== null).join(' · ')),
								),
							),
						),
				negatives.length === 0 && awaiting.length === 0
					? null
					: h(
							'section',
							{ className: 'clearai-box' },
							h('div', { className: 'clearai-box-head' }, h('span', { className: 'clearai-box-title' }, t('将沉淀的内容')), h('span', { className: 'clearai-box-note' }, t('已写入的排除与未解释项;结案时待独立核验的结论'))),
							...negatives.map((item) => h(KnowledgeItemRow, { key: item.id, item, openPreview: props.openPreview })),
							...awaiting.map((item) => h('div', { key: item.id, className: 'clearai-kitem' }, h('div', { className: 'clearai-kitem-head' }, h(StateTag, { state: 'examining' }, t('待独立核验')), h('span', null, item.name), item.claim !== item.name ? h('span', { className: 'clearai-kitem-meta' }, brief(item.claim, 80)) : null))),
						),
			)
		}

		/** 结论卡底部:本目标已沉淀的条数。 */
		function SettledLine(props) {
			const settled = props.data?.knowledgeFlow?.settled ?? null
			if (settled === null) return null
			const parts = [
				settled.established > 0 ? `${t('已确立 ')}${settled.established}${t(' 条')}` : null,
				settled.excluded > 0 ? `${t('已排除 ')}${settled.excluded}${t(' 条')}` : null,
				settled.unresolved > 0 ? `${t('未解释 ')}${settled.unresolved}${t(' 项')}` : null,
				(settled.defects ?? 0) > 0 ? `${t('测量或方法缺陷 ')}${settled.defects}${t(' 项')}` : null,
				settled.lessons > 0 ? `${t('经验 ')}${settled.lessons}${t(' 条')}` : null,
			].filter((item) => item !== null)
			if (parts.length === 0) return null
			return h('div', { className: 'clearai-settled' }, h('span', { className: 'clearai-answer-label' }, t('本次沉淀')), h('span', null, parts.join(' · ')))
		}

		/** 本体货架的结论卡:按问题切换,四部分(结论 / 依据 / 尚未确定的事项 / 待您决策)。 */
		function AnswerCards(props) {
			const answers = Array.isArray(props.data?.goal?.answers) ? props.data.goal.answers : []
			const [picked, setPicked] = React.useState(null)
			if (answers.length === 0) return null
			const questions = Array.isArray(props.data?.exploration?.questions) ? props.data.exploration.questions : []
			const textOf = (id) => questions.find((question) => question.id === id && !question.implicit)?.text ?? null
			const chosen = answers.find((answer) => answer.question === picked) ?? answers[0]
			const part = (label, body, warm = false) => h('div', { className: 'clearai-answer-part', 'data-warm': warm ? '1' : '0' }, h('span', { className: 'clearai-answer-label' }, label), body)
			const open = Array.isArray(chosen.open) ? chosen.open : []
			const decide = Array.isArray(chosen.decide) ? chosen.decide : []
			const basis = Array.isArray(chosen.basis) ? chosen.basis : []
			return h(
				'div',
				{ className: 'clearai-answers' },
				answers.length < 2
					? null
					: h(
							'div',
							{ className: 'clearai-pills' },
							...answers.map((answer, index) =>
								h(
									'button',
									{ key: `q-${index}`, type: 'button', className: 'clearai-qtab', 'aria-pressed': answer === chosen ? 'true' : 'false', onClick: () => setPicked(answer.question) },
									`${t('问题 ')}${index + 1}${textOf(answer.question) ? ` · ${brief(textOf(answer.question), 16)}` : ''}`,
								),
							),
						),
				h(
					'section',
					{ className: 'clearai-answer' },
					part(t('结论'), h('span', { className: 'clearai-answer-main' }, chosen.conclusion || `${t('未能回答:')}${chosen.unanswered ?? ''}`)),
					basis.length === 0 ? null : part(t('依据'), h('div', { className: 'clearai-answer-lines' }, ...basis.map((line, index) => h('div', { key: `b-${index}` }, h('span', null, line), ' ', h('span', { className: 'clearai-link', onClick: () => props.openExplore?.() }, t('查看探索记录')))))),
					open.length === 0 ? null : part(t('尚未确定的事项'), h('div', { className: 'clearai-answer-lines' }, ...open.map((entry, index) => h('div', { key: `o-${index}` }, entry.effect)))),
					decide.length === 0 ? null : part(t('待您决策'), h('div', { className: 'clearai-answer-lines' }, ...decide.map((line, index) => h('div', { key: `d-${index}` }, line))), true),
				),
				h(SettledLine, { data: props.data }),
			)
		}

		/** 经验:以前结案时核过的「下次怎么做」(含别的会话留下的)。 */
		function LessonList(props) {
			const lessons = Array.isArray(props.data?.lessons) ? props.data.lessons : []
			if (lessons.length === 0) return null
			return h(
				'div',
				{ className: 'clearai-list' },
				...lessons.map((lesson) =>
					h('div', { key: lesson.id, className: 'clearai-lesson' }, h('span', { className: 'clearai-lesson-kind' }, LESSON_WORD[lesson.kind] ?? lesson.kind), h('span', null, lesson.text), lesson.boundary ? h('span', { className: 'clearai-lesson-meta' }, `${t('不适用:')}${lesson.boundary}`) : null),
				),
			)
		}

		/** 逐段编码:照抄原生的 `encodeSegment`——`:` 保持字面(Windows 盘符),其余交给 encodeURIComponent。 */
		const encodeAddressSegment = (segment) => encodeURIComponent(segment).replace(/%3A/gi, ':')
		const fileAddress = (sessionId, path) => {
			// 归一化也照抄原生(`sessionFileAddress`):反斜杠→`/`,去掉开头的 `./`。
			const normalized = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
			const segments = normalized.split('/').map(encodeAddressSegment)
			return `dsh-resource://file/session/${encodeAddressSegment(sessionId)}/${segments.join('/')}`
		}
		const openNativePreview = (sidebarRight, sessionId, path) => {
			if (typeof sessionId !== 'string' || sessionId === '' || typeof path !== 'string' || path === '') return false
			const address = fileAddress(sessionId, path)
			try {
				// 原生那两个入口:当前会话用 `openResource`,指定会话用 `openResourceIn`
				// (原生 chat 与 files 都是前者)。
				if (sidebarRight !== undefined && typeof sidebarRight.openResource === 'function') {
					sidebarRight.openResource(address)
					return true
				}
				if (sidebarRight !== undefined && typeof sidebarRight.openResourceIn === 'function') {
					sidebarRight.openResourceIn(sessionId, address)
					return true
				}
			} catch {
				return false
			}
			return false
		}

		/**
		 * 世界树(右栏):计划的步骤与闸门,一条脊柱从上往下。
		 *
		 * 几何照抄 ClearAI `PlanTree.tsx`(`ROW_H=30 / NODE_R=6`):行高固定 → 拓扑常驻不变。
		 * 四条正交通道各答一个问题、可任意叠加:
		 *
		 *   ① **填充**  已落定终局了吗      实心 = 是(于是「实心到哪儿就是做到哪儿」,进度成了一眼可读的形)
		 *   ② **颜色**  什么结局            绿=过 灰=待办/作废 蓝=在跑 琥珀=等你
		 *   ③ **光环**  此刻在动吗          虚线环 = 独立评估者正在审这一步
		 *   ④ **分段**  被闸门裁断过几次    N>1 才分段,封顶 3 段,驳回的那几段画红
		 *
		 * 第一性原理:一棵树好不好读,取决于**每一条通道只答一个问题**。
		 * 并行探索不在这里画车道:竞争路线是竞争的假设,各由一个步骤检验,所以它们就是脊柱上的几步。
		 */
		const TREE = {
			rowHeight: 30,
			laneWidth: 15,
			padX: 10,
			radius: 6,
			arcWidth: 1.5,
			arcGap: 2,
			maxArcs: 3,
			halo: 9,
		}
		const TREE_COLOR = {
			done: 'rgb(var(--dsw-color-success, 16 185 129))',
			running: '#7dd3fc',
			pending: '#cbd5e1',
			pruned: '#cbd5e1',
			rail: 'hsla(220, 9%, 46%, 0.35)',
		}
		/** 一步**被闸门裁断过几次**(`block/counted` 折出来的驳回次数 + 通过的那一次)。 */
		function treeLoops(blocks, planId, stepId, advanced) {
			const counted = Number(blocks?.[planId]?.[stepId] ?? 0)
			const fails = Number.isFinite(counted) && counted > 0 ? counted : 0
			return { fails, rounds: fails + (advanced ? 1 : 0) }
		}

		/**
		 * **对外聚焦通道**:别的面点一个步骤,世界树要能**选中那一行**。
		 *
		 *   · 一个**纯函数** `rowIndexOf(rows, target)`:行身份 = `step.id`,返回行下标或 null(可单测 ✓);
		 *   · 一个**订阅式小 store**:聚焦是**界面状态**,不是事实 —— 不写任何变更、不进账本 ✓。
		 */
		function rowIndexOf(rows, target) {
			if (target === null || target === undefined || typeof target.step !== 'string' || target.step === '') return null
			const index = rows.findIndex((row) => row?.step?.id === target.step)
			return index === -1 ? null : index
		}

		/**
		 * 聚焦通道的**统一形状**:一个值 + 一组订阅者。
		 * 它是**界面状态**(点了哪一行),不是事实 —— 不写变更、不进账本。
		 */
		function makeFocusStore() {
			const store = {
				value: null,
				listeners: new Set(),
				set(target) {
					store.value = target
					for (const listener of store.listeners) listener(target)
				},
				subscribe(listener) {
					store.listeners.add(listener)
					return () => store.listeners.delete(listener)
				},
			}
			return store
		}

		/** 聚焦变了就重渲染的读法(两个面各一份)。 */
		function useFocus(store) {
			const [value, setValue] = React.useState(store.value)
			React.useEffect(() => store.subscribe(setValue), [])
			return value
		}

		const treeFocus = makeFocusStore()
		/**
		 * **反向聚焦**:从世界树的某一步跳回「事实」那一格,并**展开对应的命题**。
		 * 与 treeFocus 同一个形状、同一条纪律(界面状态,不进账本)。
		 */
		const factsFocus = makeFocusStore()

		/**
		 * 哪条命题的证据来自这一步(纯函数:可单测)。
		 *
		 * 唯一的关系就是**步骤上登记的 `tests.hypotheses`**(检验几条就取第一条展开)—— 不猜:这一步没登记命题
		 * (自判的 L0 步骤常常没有)就返回 `null`,界面因此**不乱展开**任何一条命题 ✓。
		 * (第一版这里写过一个"退一步看证据挂谁"的回退,而它又去查同一个索引 ⇒ 循环 ✗,已删。)
		 */
		function propositionForStep(data, stepId) {
			if (typeof stepId !== 'string' || stepId === '') return null
			const hypothesis = testedOf((data?.stepIndex ?? {})[stepId])[0]
			return typeof hypothesis === 'string' && hypothesis !== '' ? hypothesis : null
		}

		/** 计划摊成行:一步一行,全在脊柱上。纯函数,便于断言拓扑。 */
		function treeRows(plan) {
			return (plan?.steps ?? []).map((step) => ({ kind: 'step', lane: 0, step }))
		}

		/** 行与行之间的连接:相邻两步连一段脊柱。 */
		function treeConns(rows) {
			return rows.slice(1).map((_, index) => ({ from: index, fromLane: 0, to: index + 1, toLane: 0 }))
		}

		/** 轨道在节点**边缘**收住,不进节点内部(照抄原型)。 */
		const railClear = () => TREE.radius + 1.5

		/**
		 * 一条连接画成什么路径:同车道 = 直线;跨车道 = 三次贝塞尔(控制点与端点同 x,
		 * 所以两端仍是竖直的,与节点的净空对得上)。
		 */
		function railPath(conn, rows) {
			const x1 = TREE.padX + conn.fromLane * TREE.laneWidth
			const x2 = TREE.padX + conn.toLane * TREE.laneWidth
			const y1 = conn.from * TREE.rowHeight + TREE.rowHeight / 2 + 4 + railClear(rows[conn.from])
			const y2 = conn.to * TREE.rowHeight + TREE.rowHeight / 2 + 4 - railClear(rows[conn.to])
			if (y2 <= y1) return '' // 两行挨太近,净空吃掉了整段:不画残线
			if (x1 === x2) return `M${x1} ${y1} L${x2} ${y2}`
			const my = (y1 + y2) / 2
			return `M${x1} ${y1} C${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`
		}

		/**
		 * 四条通道的**唯一来源**:给一行,算出它该怎么画。
		 *
		 * 为什么收成一个纯函数:原设计的教训(它自己的注释里写着)——分段节点曾经走独立的
		 * early-return 分支,于是那个分支悄悄漏掉了活性光环,「一个正在跑的步骤只要磨过轮次
		 * 就再也不显示它在动」。通道一多,漏项就难发现;所以**一条代码路径**算完再叠加。
		 */
		function treeMarks(row, context) {
			const blocks = context?.blocks ?? null
			const audits = context?.audits ?? []
			const planId = context?.planId ?? null
			const stepId = row.step?.id ?? null
			const advanced = row.step?.status === 'advanced'
			const loops = treeLoops(blocks, planId, stepId, advanced)
			// ① 填充:落定终局了吗(advanced | void)
			const settled = row.step.status === 'advanced' || row.step.status === 'void'
			// ③ 光环:有 Evaluator 正在审这一步(audits 里 verdict 还没回来)
			const auditing = audits.some((audit) => audit.stepId === stepId && (audit.verdict === null || audit.verdict === undefined))
			// ② 颜色:什么结局
			const color = row.step.status === 'advanced' ? TREE_COLOR.done : row.step.status === 'void' ? TREE_COLOR.pruned : TREE_COLOR.pending
			// 变灰划掉:作废的步(单增:留档不删)
			const greyed = row.step.status === 'void'
			const done = row.step.status === 'advanced'
			return { settled, color, live: false, auditing, greyed, done, loops, ...loops }
		}

		/**
		 * 圆环上第 `i`/`total` 段弧的 dash 参数(照抄原设计):用 dasharray 而不是手写
		 * `<path d="M… A…">`——同一个圆复制 N 份、各自偏移一格,每份只显出一段,
		 * 于是每段可独立着色,而且**不必算三角函数**。
		 */
		function arcDash(index, total, r = TREE.radius) {
			const circumference = 2 * Math.PI * r
			const slot = circumference / Math.max(1, total)
			const gap = total <= 1 ? 0 : Math.min(TREE.arcGap, slot * 0.5)
			return { strokeDasharray: `${slot - gap} ${circumference - slot + gap}`, strokeDashoffset: -(index * slot) }
		}
		/** 要画的弧:只取闸门轮次,封顶 3 段(超出的轮数由行右的 「N 轮」承载)。 */
		function treeArcs(marks) {
			// 无事发生(一次就过)= 不画弧:节点保持一个干净的圆点。
			if (marks.fails === 0 && marks.rounds <= 1) return []
			const shown = Math.min(TREE.maxArcs, marks.rounds)
			/**
			 * 弧要画**最近**的几轮(越靠近现在越有解释力),而驳回总是发生在前几轮——
			 * 所以「这一弧是不是驳回」要按**绝对轮次**算:`start + index < fails`。
			 * 按相对位置算会把「驳回 3 次后终于过了」画成三个红弧,而那一步其实已经通过了。
			 */
			const start = marks.rounds - shown
			return Array.from({ length: shown }, (_, index) => ({ key: `arc-${index}`, index, fail: start + index < marks.fails }))
		}
		/** 世界树页签。选中一行 → 树下详情(结构在上、细节在下,树本身不动)。 */
		function WorldTree(props) {
			const sessions = props.useSessions
			const sessionId = props.sessionId
			/** 探索货架里直接把投影交下来(`data`);旧的独立挂法仍按会话快照取。 */
			const data =
				props.data !== undefined
					? props.data
					: typeof sessions === 'function' && typeof sessionId === 'string'
						? sessions((snapshot) => snapshot?.byId?.[sessionId]?.projectionValues?.clearai)
						: undefined
			const [manual, setManual] = React.useState(null)
			const [picked, setPicked] = React.useState(null)
			const focus = useFocus(treeFocus)
			/**
			 * **一个对话会有多个世界树**:活动的那份默认显示,已收尾的可以切回去看
			 * (它们没被删:文档归档在 `clear/goals/plans/<id>.md`)。
			 * 优先级:外面点进来的聚焦所指的那份 > 手动切的 > 活动的。
			 */
			const plans = data === null || data === undefined || !Array.isArray(data.plans) ? [] : data.plans
			const wanted = (focus !== null && focus !== undefined && typeof focus.plan === 'string' ? focus.plan : null) ?? picked
			const chosen = wanted === null ? null : plans.find((item) => item.id === wanted) ?? null
			const plan = chosen ?? (data === null || data === undefined ? null : data.plan)
			if (plan === null || plan === undefined) {
				return h('div', { style: S.wrap }, h('div', { style: S.bar }, h('span', { style: S.title }, t('计划'))), h(Empty, null, t('暂无计划。建立计划后,此处将显示计划的步骤与闸门。')))
			}
			const rows = treeRows(plan)
			/** 页眉那一句:计划的首个非空行,过长再截(整篇在 tooltip 与「计划文档」里)。 */
			const briefLine = String(plan.brief ?? '').split('\n').map((line) => line.trim()).find((line) => line !== '' && !line.startsWith('#')) ?? ''
			const briefText = String(plan.brief ?? '').trim()
			/** 计划编号(p-…)不上屏:人认的是那一句思路。 */
			const titleText = briefLine === '' ? '' : brief(briefLine, 44)
			/** 外面点进来的聚焦优先;手动点行仍然有效(聚焦为 null 时用它)。 */
			const focused = rowIndexOf(rows, focus)
			const selected = focused === null ? manual : focused
			const context = { blocks: data.blocks ?? null, audits: data.audits ?? [], planId: plan.id }
			const gutter = TREE.padX * 2 + TREE.laneWidth
			const x = (lane) => TREE.padX + lane * TREE.laneWidth
			const y = (index) => index * TREE.rowHeight + TREE.rowHeight / 2 + 4
			const marksOf = rows.map((row) => treeMarks(row, context))
			// 轨道:相邻两步连一段脊柱;通向作废步的那段画灰。
			const svg = treeConns(rows).map((conn, index) => {
				const dashed = marksOf[conn.to].greyed
				return h('path', { key: `rail-${index}`, d: railPath(conn, rows), fill: 'none', stroke: dashed ? TREE_COLOR.pruned : TREE_COLOR.rail, strokeWidth: 1 })
			})
			rows.forEach((row, index) => {
				const marks = marksOf[index]
				const cx = x(row.lane)
				const cy = y(index)
				const arcs = treeArcs(marks)
				const nodes = []
				// ③ 光环(先画,在节点下面)
				if (marks.auditing) {
					nodes.push(h('circle', { key: 'halo', cx, cy, r: TREE.halo, fill: 'none', stroke: TREE_COLOR.running, strokeWidth: 1.4, strokeDasharray: '2 2.5', className: 'clearai-breathe-stroke' }))
				}
				{
					// ① 填充:落定的画实心核(有分段时核再小一圈,不与弧粘连)
					if (marks.settled) {
						nodes.push(h('circle', { key: 'core', cx, cy, r: arcs.length > 0 ? TREE.radius - TREE.arcWidth - 1 : TREE.radius, fill: marks.color }))
					}
					// ④ 分段:每段一次闸门裁断,驳回的画红
					if (arcs.length > 0) {
						for (const arc of arcs) {
							nodes.push(
								h('circle', {
									key: arc.key,
									cx,
									cy,
									r: TREE.radius,
									fill: 'none',
									stroke: arc.fail ? '#c98f8f' : marks.color,
									strokeWidth: TREE.arcWidth,
									transform: `rotate(-90 ${cx} ${cy})`,
									...arcDash(arc.index, arcs.length),
								}),
							)
						}
					} else if (!marks.settled) {
						// 还没落定又没故事:一个干净的空心圈(实心到哪儿就是做到哪儿)
						nodes.push(h('circle', { key: 'node', cx, cy, r: TREE.radius, fill: 'transparent', stroke: marks.color, strokeWidth: 1.4 }))
					}
				}
				svg.push(h('g', { key: `node-${index}` }, nodes))
			})
			const counts = (row) => {
				const marks = treeMarks(row, context)
				const judges = (data.audits ?? []).filter((item) => item.stepId === row.step.id).length
				return { marks, judges }
			}
			/** 行里只放**认得出这一步的那几个字**:`do` 常常是整句话,全文在点开的详情里。 */
			const rowLabel = (row) => `${row.step.ordinal}. ${brief(row.step.do, 26)}`
			return h(
				'div',
				{ style: S.wrap },
				h(
					'div',
					{ style: S.bar },
					h('span', { style: S.title }, t('计划')),
					/**
					 * 页眉只放**一句话**:`brief` 常常是整篇 markdown 计划(真数据里这一行渲染出 1794 字 ✗),
					 * 全文进 tooltip,要读整篇点「打开计划」(原生预览 `clear/goals/plans/<id>.md`)——
					 * 默认少而准,细节靠点开。
					 */
					h('span', { style: S.faint, title: briefText }, titleText),
					/**
					 * **历史世界树的入口**:一个对话会有多个计划。
					 * 只有一份时不出现 ✓;多份时用**一个原生下拉**(一行,不铺一排标签 —— 真数据里有 8 份 ✗)。
					 * 默认停在最近那份;切到旧的会在下面标出「已收尾 · 存档可看」。
					 */
					plans.length <= 1
						? null
						: h(
								'select',
								{
									value: plan?.id ?? '',
									onChange: (event) => {
										setPicked(event.target.value)
										setManual(null)
									},
									title: t('切换到以前的计划(计划均保留,文档归档在 clear/goals/plans/)'),
									style: { font: 'inherit', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', background: 'transparent', border: '.5px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '1px 4px' },
								},
								...plans.map((item, index) =>
									h('option', { key: item.id, value: item.id }, `${t('计划 ')}${index + 1}/${plans.length} · ${item.status === 'active' ? '推进中' : '已收尾'}`),
								),
							),
					chosen === null
						? null
						: h('span', { style: { ...S.faint, opacity: 0.8 } }, t('已完成 · 可查看存档')),
					h(
						'span',
						{ style: S.faint },
						`${t('步 ')}${rows.length}`,
					),
					props.openPreview === undefined
						? null
						: h(Link, { onClick: () => props.openPreview(`clear/goals/plans/${plan.id}.md`), title: t('打开计划文档(原生预览)') }, t('计划文档')),
					h('span', { style: { ...S.faint, marginLeft: 'auto' } }, t('点击查看详情')),
				),
				/**
				 * 这一格是**计划的一切**:目标是脊柱的起点、步骤是它的形状、
				 * 要你拍板的那一下(人门)就发生在某一步上——所以三样都在这张图上,
				 * 而不是散在三个页签里(「进展」那一格因此撤了)。
				 */
				h(GoalLine, { goal: data.goal, view: data.knowledgeView, openPreview: props.openPreview }),
				h(NeedYou, { data }),
				h(
					'div',
					{ style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
					h('svg', { width: gutter, height: rows.length * TREE.rowHeight + 8, style: { flex: '0 0 auto' } }, svg),
					h(
						'div',
						{ style: { flex: 1, minWidth: 0 } },
						rows.map((row, index) => {
							const marks = marksOf[index]
							const stat = counts(row)
							const isSel = selected === index
							return h(
								'div',
								{
									key: `t-${index}`,
									className: 'clearai-treerow',
									'data-sel': isSel ? '1' : '0',
									style: { height: TREE.rowHeight, overflow: 'hidden' },
									onClick: () => {
										// 手动点行:先清掉外面的聚焦(否则它一直压着手动选择,点了没反应 ✗)
										treeFocus.set(null)
										setManual(isSel ? null : index)
									},
									title: t('查看步骤详情'),
								},
								h(
									'span',
									{
										style: {
											flex: 1,
											minWidth: 0,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
											fontWeight: 400,
											...(marks.greyed
												? { color: 'var(--dsw-alias-label-secondary)', opacity: 0.55, textDecoration: 'line-through' }
												: marks.done
													? { color: 'var(--dsw-alias-label-secondary)' }
													: {}),
										},
									},
									rowLabel(row),
								),
								stat === null ? null : h(
									'span',
									{ style: { flex: '0 0 auto', display: 'flex', gap: 6, ...S.faint, marginLeft: 'auto' } },
									/** 说人话:只有返工过才说「做了 N 轮」;起过独立核验就写「独立核验」。 */
									stat.marks.loops.rounds > 1
										? h('span', { title: `${stat.marks.loops.rounds}${t(' 轮')}${stat.marks.loops.fails > 0 ? ` · 其中 ${stat.marks.loops.fails} 次被驳回` : ''}` }, `${stat.marks.loops.rounds}${t(' 轮')}`)
										: null,
									stat.judges > 0 ? h('span', { title: `${t('已派出评估者 ')}${stat.judges}${t(' 次')}` }, t('独立核验')) : null,
								),
							)
						}),
					),
				),
				selected === null ? null : h(TreeDetail, { row: rows[selected], data, openPreview: props.openPreview, openSpectator: props.openSpectator, openFacts: props.openFacts, onClose: () => setManual(null) }),
			)
		}

		/** 树下的详情:选中那一步的**事实**都在这里(树上只有形状,文字细节在这里)。 */
		function TreeDetail(props) {
			const row = props.row
			const data = props.data ?? {}
			const step = row.step
			const evidence = (data.evidence ?? []).filter((item) => item.stepId === step?.id)
			const audits = (data.audits ?? []).filter((item) => item.stepId === step?.id)
			return h(
				'div',
				{ style: { marginTop: 10, borderTop: '.5px solid var(--dsw-alias-border-l1)', paddingTop: 8 } },
				h(
					'div',
					{ style: S.inline },
					h('span', { style: S.head, title: step.id }, `${nth(step.ordinal)}`),
					h(Link, { onClick: () => props.onClose?.(), title: t('收起详情') }, h('span', { style: S.faint }, t('收起'))),
				),
				step === null || step === undefined
					? null
					: h(
							'div',
							{ style: S.kv },
							h('span', { style: S.faint }, t('任务内容')), h('span', null, step.do),
							h('span', { style: S.faint }, t('判据')), h('span', null, `${step.doneCriteria}${step.voidReason === null || step.voidReason === undefined ? '' : `(作废:${step.voidReason})`}`),
							h('span', { style: S.faint }, t('状态')), h('span', null, `${gloss(STEP, step.status)}${step.level === null || step.level === undefined ? '' : ` · ${step.level}`}`),
							h(
								'span',
								{ style: S.faint },
								t('产物'),
							),
							h(
								'span',
								null,
								...(step.artifacts ?? []).length === 0
									? [t('未声明')]
									: (step.artifacts ?? []).map((artifact, index) => {
											/**
											 * 两种形状都吃:声明里是**字符串**,宿主路由 stat 过的是**对象**。
											 * 而且 `exists` 有三态:true / false(查过、不在) / null(**没查过**)——
											 * 「没查过」不许说成「缺」(真数据里树详情因此把每个产物都写成 `undefined(缺)` ✗)。
											 */
											const path = typeof artifact === 'string' ? artifact : artifact?.path
											const exists = typeof artifact === 'string' ? null : (artifact?.exists ?? null)
											if (typeof path !== 'string' || path === '') return null
											return h(
												'span',
												{ key: `${path}-${index}`, style: { marginRight: 8 } },
												exists === false
													? h('span', { style: { ...S.mono, opacity: 0.6 }, title: t('磁盘上未找到该文件') }, `${path}${t('(缺失)')}`)
													: h(Link, { onClick: () => props.openPreview?.(path), title: exists === true ? t('在原生预览中打开') : t('在原生预览中打开(计划声明的产物)') }, h('span', { style: S.mono }, path)),
											)
										}),
							),
							/**
							 * **反向跳**:从树里的这一步跳到「事实」那一格,并展开对应的命题。
							 * 切中栏视图走**原生正门** selectPanel(经可选读法拿到的 layout 服务;守卫:
							 * 没注册的 key 它会抛,而抛了不该把整棵树带下水)。
							 */
							props.openFacts === undefined
								? null
								: h('span', { style: S.faint }, t('证据')),
							props.openFacts === undefined
								? null
								: h(
										'span',
										null,
										h(
											Link,
											{
												onClick: () => props.openFacts(step.id),
												title: t('在本体货架中展开此结论'),
											},
											t('查看此步骤的证据'),
										),
									),
						),
				evidence.length === 0 && audits.length === 0
					? null
					: h(
							'div',
							{ style: { marginTop: 6 } },
							evidence.map((item) => h('div', { key: item.id, style: S.faint }, `${t('检验结果:')}${VERDICT[item.verdict] ?? '—'} · ${howOf(item)}${item.basis ? ` · ${brief(item.basis, 60)}` : ''}`)),
							audits.map((item) =>
								h(
									'div',
									{ key: item.id, style: S.faint },
									`${t('独立核验:')}${item.verdict === null || item.verdict === undefined ? t('正在裁决') : (VERDICT[item.verdict] ?? item.verdict)}`,
									item.evaluatorSession === null || item.evaluatorSession === undefined ? null : h(Link, { onClick: () => props.openSpectator?.(item.evaluatorSession) }, h('span', null, t(' 查看核验过程'))),
									item.cardPath === null || item.cardPath === undefined ? null : h(Link, { onClick: () => props.openPreview?.(item.cardPath) }, h('span', null, t(' 查看核验记录'))),
								),
							),
						),
			)
		}

		/** 待处理:只陈述的几行(计划停下、结论矛盾),没有按钮——要怎么办,在对话里说。 */
		function NeedYou(props) {
			const items = Array.isArray(props.data?.needYou) ? props.data.needYou : []
			if (items.length === 0) return null
			return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, margin: '0 0 8px' } }, ...items.map((item, index) => h('div', { key: `need-${index}`, className: 'clearai-need' }, h('b', null, t('待处理')), String(item?.text ?? ''))))
		}

		/**
		 * 旁观入口(阶段 4 的 4.5):点一下跳到那个子会话,**只看不动手**。
		 * 判断不许匿名——评估者/仲裁是谁、在哪,面板上给得出入口。
		 * 拿不到会话服务就退化成一行文本 id:宁可少一个按钮,也不假装能跳。
		 */

		/**
		 * 计划的小图形:一棵**迷你世界树**——一根脊柱、一条岔、两个节点。
		 * 用 `currentColor`:颜色留给状态(等人确认 = 琥珀,受阻 = 琥珀,收尾 = 灰),形状留给语义。
		 * 为什么要有它:工具行是要抢地盘的地方(两个字面项能占掉整行近三成,
		 * 窄窗口下会把发送键挤到第二行)。图标能省一半宽度,而它指向的正是「世界树」那一页。
		 */
		function PlanGlyph() {
			return h(
				'svg',
				{ width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true', style: { flex: '0 0 auto', display: 'block' } },
				h('path', { d: 'M3 2.2 V10.2', stroke: 'currentColor', strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round' }),
				h('path', { d: 'M3 5.2 H8.4', stroke: 'currentColor', strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round' }),
				h('circle', { cx: 3, cy: 2.2, r: 1.5, fill: 'currentColor' }),
				h('circle', { cx: 3, cy: 9.4, r: 1.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 }),
				h('circle', { cx: 9.2, cy: 5.2, r: 1.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 }),
			)
		}

		/**
		 * 计划芯片:坐在原生 plan 座位上的那一格。
		 *
		 * 只说**计划**这一件事(进度、受阻、待确认),不重复状态条已经说过的话——
		 * 一个事实只在一块面上说,是这个面板与原生 dock 之间的分工。
		 * 没有计划时渲染 `null`:座位保持空着,而不是显一个「什么都没有」的假控件。
		 * 它也不造第二个动词:推进的唯一动词是 `AdvancePlan`,那属于模型,不属于界面;
		 * 这一格能做的只有一件——把右栏的「世界树」打开。
		 */
		function PlanChip(props) {
			const data = typeof props.useProjection === 'function' ? props.useProjection('clearai') : undefined
			const plan = data === null || data === undefined ? null : data.plan
			if (plan === null || plan === undefined) return null
			const total = plan.totalCount ?? 0
			const done = plan.advancedCount ?? 0
			/**
			 * 说人话:内部 id(`p-xxxx`)不进这一格——它对人没有信息量,只让芯片变长;
			 * 状态优先于数字(等人确认 / 受阻 / 已收尾都是**要人注意**的那一类)。
			 */
			/**
			 * 一格只放**一个符号**:进度。要人注意的事不换符号,只换颜色。
			 *
			 * 这条工具行上的格子只承担**可点、且只有我们知道**的两句:
			 *   待处理 N(人门计数,点了开世界树)· 续跑停着(为什么停,人是可以处置的)。
			 * 「已达成 · 100%」那一类与原生目标提示说的是同一件事,不在这里重复。
			 */
			const inboxCount = Array.isArray(data?.needYou) ? data.needYou.length : 0
			const blocked = plan.blocked !== null && plan.blocked !== undefined
			const attention = blocked
			/**
			 * 符号**恒定是进度**(形状稳定才学得会):要人注意不在符号上换字,
			 * 而是换颜色(与世界树同一条规矩:形状说状态,别让人去猜一个 '?')。
			 * 「待处理 N」就在这一格(`waiting`):门开着是**事实面**上最要紧的一句,
			 * 而它可点——点一下开世界树,那里才看得到要裁什么。
			 */
			/**
			 * 符号说**探索到了哪**:调研时是「板块 已厘清/总数」,求解时是「问题 当前/总数 · 待检验假设 N 个」;
			 * 没列问题也没列板块的目标(旧会话、单问题)退回步数 `N/M`。
			 */
			const exploration = data?.exploration ?? null
			const areas = Array.isArray(exploration?.areas) ? exploration.areas : []
			const declared = (Array.isArray(exploration?.questions) ? exploration.questions : []).filter((question) => !question.implicit)
			const current = (Array.isArray(exploration?.questions) ? exploration.questions : []).find((question) => question.id === exploration?.current) ?? null
			const emergent = declared.filter((question) => question.status === 'emergent').length
			const examining = current === null ? 0 : (current.counts?.examining ?? 0)
			const symbol =
				areas.length > 0
					? `${t('板块 ')}${areas.filter((area) => area.state === 'clear').length}/${areas.length}${emergent > 0 ? `${t(' · ')}${emergent}${t(' 个问题待您决定')}` : ''}`
					: declared.length > 0 && current !== null
						? `${t('问题 ')}${declared.indexOf(current) + 1}/${declared.length}${t(' · 待检验假设 ')}${examining}${t(' 个')}`
						: `${done}/${total}`
			const brief = typeof plan.brief === 'string' && plan.brief.trim() !== '' ? plan.brief.trim() : null
			const meaning = blocked ? t('计划受阻,待人工处理') : plan.status === 'closed' ? `${t('计划已收尾(')}${done}/${total}${t(' 步)')}` : `${t('计划已交付 ')}${done}/${total}${t(' 步')}`
			/**
			 * 等人时**只说一句**:先「待处理 N」(人门计数),没有门才说续跑停着的原因。
			 * 两者是同一根轴(为什么在等人)⇒ 一格只放一个,不并列。
			 */
			const waiting = inboxCount > 0 ? `${t('待处理 ')}${inboxCount}` : null
			const attentionNow = attention || waiting !== null
			return h(
				'button',
				{
					type: 'button',
					className: 'clearai-toolctl',
					disabled: props.locked === true,
					title: `${meaning}${waiting === null ? '' : ` · ${waiting}`} · ${plan.id}${brief === null ? '' : ` · ${brief}`}${t('(点击打开探索货架)')}`,
					'aria-label': `${meaning}${waiting === null ? '' : ` · ${waiting}`}${t('(点击打开探索货架)')}`,
					// 「要人注意」用与世界树同一族的琥珀(同一套主题令牌,不新造颜色)。
					style: attentionNow ? { color: 'rgb(var(--dsw-color-warning, 245 158 11))', fontWeight: 600 } : undefined,
					onClick: () => props.openExplore?.(),
				},
				h(PlanGlyph, null),
				h('span', { style: { minWidth: 14, textAlign: 'center' } }, symbol),
				waiting === null ? null : h('span', { style: { marginLeft: 6, fontSize: 11.5 } }, waiting),
			)
		}

		/**
		 * 一步的**人话**名字:`do` 是模型写的那句「做什么」,截短了放进一行。
		 * 内部步 id(`s-3`)只进 tooltip 与世界树——它在日志里是账,在界面上不是给人看的。
		 */
		function shortDo(text) {
			const value = String(text ?? '').trim()
			return value.length <= 12 ? value : `${value.slice(0, 12)}…`
		}

		/**
		 * 输入框下那条派生状态条**删掉了**。
		 *
		 * 它说的事(阶段 / 完成度 / 当前步)与**原生目标提示**、与工具行那颗计划 chip 的 `N/M`
		 * 说的是同一件 ✗ —— 而它**独占一行,把输入框整个顶上去** ✗。
		 * 唯一可点、且只有我们知道的那一件(「待处理 N」)已经并进计划 chip:
		 * 同一行、一点直达世界树。剩下的「为什么停」也在那颗 chip 上只说一句。
		 */
		/**
		 * 席位跟着会话预设进出。
		 *
		 * 为什么必须这样:`conversation.view` 是**产品级**插座,它的主人遍历全部注册项投影出
		 * 视图导航,不按会话过滤(宿主原生那个视图页签组件的 viewTabs() 只读 id 与 label)。
		 * 所以一个宿主平面的插件一旦注册,每个会话、每种模式都会多出一个页。
		 * 这个面板是循证模式的一部分,它只在那个模式里该出现——于是注册与注销都跟着
		 * 当前会话的 `projectionValues.agentPreset` 走。
		 */
		/** 包一层**只做一次**:现造会让 React 每次渲染都当成新组件,把面板整个重挂。 */

		/**
		 * **过滤的判据**(纯函数,导出给测试):一条事实/命题与一个词条是否相关。
		 *
		 * 匹配范围刻意放宽到「文本包含词条名/别名」:只按断言匹配更「纯」,但用户会觉得
		 * 「明明有条条目说到炉次,过滤出来没有」。断言命中优先,文本命中兜底——两种都算,
		 * 数字行(N/M)会把没匹配的说清楚,不会静默消失。
		 */
		const termMatches = (term, row) => {
			const id = String(term?.id ?? '')
			if (id === '') return false
			const labels = [term.label, ...(Array.isArray(term.aliases) ? term.aliases : [])].filter((item) => typeof item === 'string' && item !== '')
			const hitsText = [String(row?.text ?? ''), String(row?.claim ?? '')].some((text) => text.includes(id) || labels.some((label) => text.includes(label)))
			const hitsAssertion = (Array.isArray(row?.assertions) ? row.assertions : []).some((assertion) => {
				const subject = assertion?.subject ?? {}
				const object = assertion?.object ?? {}
				if (String(subject.type ?? '') === id || String(subject.id ?? '') === id || String(assertion?.predicate ?? '') === id) return true
				if (String(object.kind) === 'instance' && (String(object.type ?? '') === id || String(object.value ?? '') === id)) return true
				return false
			})
			return hitsAssertion || hitsText
		}

		/**
		 * **力导向布局**(graphology + ForceAtlas2),与参考实现 `refs/semantica/explorer` 同一套。
		 *
		 * 为什么不是分层布局:分层只认得「父子」这一种关系,而知识图谱里大量边是**非层级**的
		 * (谓词、断言)。真数据里 21 个概念只有 9 条 `is_a`,按层排就退化成一排——那不是图的形状,
		 * 是硬套的形状。力导向让**结构自己长出形状**:枢纽聚成中心、相关的东西聚成簇。
		 *
		 * **确定性**:起点用投影给的坐标(`graphProjection` 的按层折行排布)。
		 * FA2 从同一起点、同一参数出发必得同一结果,所以「同一份账本 ⇒ 同一张图」仍然成立;
		 * 而且首屏不用先看一团随机散点——它从一个读得懂的排布**松弛**到自然的形状。
		 *
		 * 拿不到它时退回投影坐标:图照样画得出来(同一条「降级要如实、不要崩」)。
		 */
		const Force = (() => {
			try {
				if (typeof __clearaiForce !== 'function') return null
				const loaded = __clearaiForce(require)
				return typeof loaded?.forceAtlas2?.assign === 'function' && typeof loaded?.Graph === 'function' ? loaded : null
			} catch (error) {
				try {
					console.warn('[clearai] 力导向布局加载失败:', error)
				} catch {
					/* console 不在也不该让面板挂掉 */
				}
				return null
			}
		})()
		/**
		 * 跑一次力导向。参数照参考实现(`FORCE_ATLAS_SETTINGS`);
		 * 迭代数按规模给,但有上限——大图上一次别把整帧卡住。
		 */
		const forceLayout = (nodes, edges) => {
			if (Force === null || nodes.length < 2) return nodes
			try {
				const graph = new Force.Graph({ multi: true, type: 'directed' })
				for (const node of nodes) graph.addNode(node.id, { x: node.position.x, y: node.position.y, size: 34 })
				for (const edge of edges) {
					if (edge.source === edge.target) continue
					if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
					try {
						graph.addEdge(edge.source, edge.target)
					} catch {
						/* 平行边之类:真发生了也不该让整张图排不出来 */
					}
				}
				Force.forceAtlas2.assign(graph, {
					iterations: Math.min(300, Math.max(60, nodes.length * 3)),
					settings: {
						barnesHutOptimize: true,
						barnesHutTheta: 0.6,
						linLogMode: true,
						outboundAttractionDistribution: true,
						strongGravityMode: false,
						gravity: 0.14,
						scalingRatio: 4.8,
						slowDown: 6,
						edgeWeightInfluence: 1,
						adjustSizes: true,
					},
				})
				return nodes.map((node) => {
					const x = graph.getNodeAttribute(node.id, 'x')
					const y = graph.getNodeAttribute(node.id, 'y')
					return Number.isFinite(x) && Number.isFinite(y) ? { ...node, position: { x, y } } : node
				})
			} catch (error) {
				try {
					console.warn('[clearai] 力导向布局失败,退回投影坐标:', error)
				} catch {
					/* 同上 */
				}
				return nodes
			}
		}

		/**
		 * **节点小卡**:点图上的一个点或一条边,回答「这是什么、哪些结论用到它」。
		 *
		 * 数据仍然不在这里拼:组装住在宿主半的 `inspectGraphSelection`(经 `/api/clearai/inspector`),
		 * 这一层只请求与渲染。卡上只说人话:种类、释义、上下位、关系、用到它的结论;
		 * 编号、等级代码、证据 id 都不上屏(结论的来历在下面的结论列表里点开看)。
		 * 请求失败不清空旧内容——把上一次的结果换成一片空白,读的人会以为「这条知识没了」。
		 */
		const GraphInspector = ({ selection, sessionId, onFilter, onClose, inspector: injected, names }) => {
			const [state, setState] = React.useState({ loading: false, inspector: null, error: null })
			const key = selection === null ? '' : `${selection.kind}:${selection.id}`
			React.useEffect(() => {
				/** 宿主已经把读数喂进来时不再问一次(全屏工作区与测试都走这条缝)。 */
				if (injected !== undefined) return undefined
				if (key === '' || typeof sessionId !== 'string' || sessionId === '') return undefined
				let live = true
				setState((current) => ({ ...current, loading: true, error: null }))
				const url = `/api/clearai/inspector?sessionId=${encodeURIComponent(sessionId)}&kind=${encodeURIComponent(selection.kind)}&id=${encodeURIComponent(selection.id)}`
				fetch(url)
					.then((response) => response.json())
					.then((result) => {
						if (!live) return
						if (result?.ok !== true) setState({ loading: false, inspector: null, error: String(result?.error ?? 'failed') })
						else setState({ loading: false, inspector: result.found === true ? result.inspector : null, error: null })
					})
					.catch((thrown) => {
						if (live) setState({ loading: false, inspector: null, error: String(thrown?.message ?? thrown) })
					})
				return () => {
					live = false
				}
			}, [key, injected])
			if (selection === null) return null
			const data = injected === undefined ? state.inspector : injected
			const busy = injected === undefined && state.loading === true
			const failure = injected === undefined ? state.error : null
			const definition = data?.definition ?? {}
			const relations = data?.relations ?? {}
			const kv = (label, value) => (value === null || value === undefined || value === '' ? [] : [h('span', { key: `k-${label}` }, label), h('span', { key: `v-${label}` }, String(value))])
			const value = definition.value === undefined || definition.value === null ? null : `${String(definition.value)}${definition.unit ? ` ${String(definition.unit)}` : ''}`
			/** 用到它的结论:写进长期知识的那几条;被人撤回的标「已替换」,卷进矛盾的标「有矛盾」。 */
			const factTrust = (fact) => (fact.review?.decision === 'retracted' ? 'replaced' : (fact.conflicts ?? []).length > 0 ? 'conflict' : 'credible')
			const facts = Array.isArray(data?.facts) ? data.facts : []
			const title = String(selection.label ?? data?.selection?.label ?? selection.id)
			/** 关系串里的主语 / 宾语是实例 id(`i_jepa`):换成图上的名字(`I-JEPA`)再上屏。 */
			const named = (text) => [...(names ?? new Map()).entries()].sort((left, right) => right[0].length - left[0].length).reduce((out, [ref, label]) => out.split(ref).join(label), String(text ?? ''))
			return h(
				'div',
				{ className: 'clearai-card' },
				h(
					'div',
					{ className: 'clearai-card-head' },
					h('span', { className: 'clearai-card-kind' }, KIND_WORD[selection.kind] ?? t('关系')),
					h('span', { className: 'clearai-card-title' }, title),
					h('span', { style: { flex: '1 1 auto' } }),
					h('span', { className: 'clearai-link', onClick: onFilter }, t('仅显示相关项')),
					h('span', { className: 'clearai-link', onClick: onClose }, t('关闭')),
				),
				busy === true ? h('div', { className: 'clearai-quiet' }, t('正在加载…')) : null,
				failure !== null ? h('div', { className: 'clearai-quiet' }, `${t('无法获取')}${t(':')}${failure}`) : null,
				busy === false && failure === null && data === null ? h('div', { className: 'clearai-quiet' }, t('该项已不在当前词表中(可能已被废止)。')) : null,
				data === null
					? null
					: h(
							'div',
							{ className: 'clearai-kv' },
							...kv(t('释义'), definition.gloss),
							...kv(t('上位'), definition.parentLabel ?? definition.parent),
							...kv(t('下位'), (relations.children ?? []).map((item) => item.label).join('、')),
							...kv(t('主体'), definition.domainLabel ?? definition.domain),
							...kv(t('类型'), definition.typeLabel ?? definition.type),
							...kv(t('取值'), value),
							...kv(t('依据'), definition.basis),
							...kv(t('关系'), (relations.edges ?? []).slice(0, 6).map((edge) => named(edge.chip)).join('、')),
							...kv(t('实例'), (relations.instances ?? []).slice(0, 6).map((item) => item.label).join('、')),
							definition.status === 'deprecated' ? h('span', { key: 'dep', style: { gridColumn: '1 / -1' }, className: 'clearai-quiet' }, t('该术语已废止,既有结论中的用法仍可查看。')) : null,
						),
				facts.length === 0
					? null
					: h(
							'div',
							{ className: 'clearai-card-facts' },
							h('div', { className: 'clearai-group-head' }, t('引用此项的结论'), h('span', null, `${facts.length}${data.factsTruncated > 0 ? '+' : ''}`)),
							...facts.slice(0, 4).map((fact, index) =>
								h(
									'div',
									{ key: `f-${index}`, className: 'clearai-card-fact' },
									factTrust(fact) === 'conflict' ? h('span', { className: 'clearai-trust', 'data-trust': 'conflict' }, t('有矛盾')) : h(TrustTag, { trust: factTrust(fact) }),
									h('span', null, brief(fact.text, 60)),
									fact.scope && fact.scope !== fact.hypothesis?.refuteWhen ? h('span', { className: 'clearai-row-sub' }, `${t('范围:')}${brief(fact.scope, 40)}`) : null,
								),
							),
						),
			)
		}

		/**
		 * **星图(React Flow)**:本体图 / 实体图二选一。
		 *
		 * 渲染交给 @xyflow/react——拖节点、拖画布、滚轮缩放都是库的事。这一层只做三件 ClearAI 自己的事:
		 *   · **适配投影**:graphProjection() 的节点 / 边 → React Flow 的 nodes / edges;
		 *     视觉编码在这里(投影是语义不是样式):点 + 衬线标签;概念是空心圈、实例是实心点、
		 *     取值是小点;边实线 = 已验证(写进长期知识的断言),虚线 = 待核验(登记了、没过独立裁决),
		 *     淡线 = 上下位;卷进矛盾的点和边用告警色。
		 *   · **点击语义**:点节点 / 边 = 打开小卡;「只看相关」是卡上的显式动作。
		 *   · **全屏**:position: fixed 的真 overlay,打开时自动适配。
		 */
		const GraphBand = ({ lexicon, data, send, layer, onLayer, fullscreen, onToggleFullscreen, onFilter, sessionId, unlanded, focus }) => {
			const [picked, setPicked] = React.useState(null)
			const [asked, setAsked] = React.useState({})
			const graph = lexicon?.graph ?? { nodes: [], edges: [], bounds: { width: 0, height: 0 } }
			const conflicts = Array.isArray(lexicon?.conflicts) ? lexicon.conflicts : []
			const conflicted = new Set(conflicts.flatMap((item) => item.sides.map((side) => side.fact)).filter((id) => typeof id === 'string'))
			const layerNodes = graph.nodes.filter((node) => node.layer === layer)
			const layerEdges = graph.edges.filter((edge) => edge.layer === layer && typeof edge.from === 'string' && typeof edge.to === 'string')
			const nodeById = new Map(layerNodes.map((node) => [node.id, node]))
			const problems = Array.isArray(lexicon?.problems) ? lexicon.problems : []

			/**
			 * **目录嵌套就是子图**:概念的父是 `node.parent`(is_a),实体的父是 `node.container`(组成)。
			 * 一个父可以收起,收起后它的整棵子树藏起来,子树上的边改连到这个父身上(去掉自环、去重)。
			 * 点多(> 40)时默认收到第一层,点开 +N 再往下看;点少时全展开。
			 */
			const parentOf = (node) => {
				const id = node.kind === 'concept' ? (typeof node.parent === 'string' && node.parent !== '' ? `term:${node.parent}` : null) : (node.container ?? null)
				return id !== null && id !== node.id && nodeById.has(id) ? id : null
			}
			const parentById = new Map(layerNodes.map((node) => [node.id, parentOf(node)]))
			const childCount = new Map()
			for (const [, parent] of parentById) if (parent !== null) childCount.set(parent, (childCount.get(parent) ?? 0) + 1)
			const depthOfNode = (id) => {
				let depth = 0
				const seen = new Set([id])
				for (let at = parentById.get(id); at !== null && at !== undefined && !seen.has(at); at = parentById.get(at)) {
					seen.add(at)
					depth += 1
				}
				return depth
			}
			const [toggled, setToggled] = React.useState({})
			React.useEffect(() => {
				setToggled({})
			}, [layer])
			const crowded = layerNodes.length > 40
			const isCollapsed = (id) => (childCount.get(id) ?? 0) > 0 && (toggled[id] ?? (crowded && depthOfNode(id) >= 1))
			/** 往上找第一个没被收起的祖先挡住的点:自己可见就是自己。 */
			const shownAs = (id) => {
				let shown = id
				const seen = new Set([id])
				for (let at = parentById.get(id); at !== null && at !== undefined && !seen.has(at); at = parentById.get(at)) {
					seen.add(at)
					if (isCollapsed(at)) shown = at
				}
				return shown
			}
			const hiddenUnder = new Map()
			for (const node of layerNodes) {
				const shown = shownAs(node.id)
				if (shown !== node.id) hiddenUnder.set(shown, (hiddenUnder.get(shown) ?? 0) + 1)
			}
			const allNodes = layerNodes.filter((node) => shownAs(node.id) === node.id)
			const allEdges = (() => {
				const out = []
				const seen = new Set()
				for (const edge of layerEdges) {
					const from = nodeById.has(edge.from) ? shownAs(edge.from) : edge.from
					const to = nodeById.has(edge.to) ? shownAs(edge.to) : edge.to
					if (from === to) continue
					if (from === edge.from && to === edge.to) {
						out.push(edge)
						continue
					}
					const key = `${edge.kind}|${edge.label ?? ''}|${from}|${to}`
					if (seen.has(key)) continue
					seen.add(key)
					out.push({ ...edge, id: `${edge.id}@${from}>${to}`, from, to })
				}
				return out
			})()
			const toggle = (id) => setToggled((current) => ({ ...current, [id]: !isCollapsed(id) }))
			const countOf = (name) => graph.nodes.filter((node) => node.layer === name).length
			const entityNames = new Map(graph.nodes.filter((node) => node.kind === 'instance' && typeof node.ref === 'string' && node.ref !== '' && node.label !== node.ref).map((node) => [String(node.ref), String(node.label)]))

			/** 图上的标签只放得下一小段:截断加省略号,全文在小卡里。 */
			const trimLabel = (text, limit) => {
				const value = String(text ?? '')
				return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
			}

			/**
			 * **节点位置是受控的,所以必须自己接住拖动**:不给 `onNodesChange`,
			 * React Flow 内部的拖动没有地方落地,节点根本拖不动。位置是界面状态,换层或图变了就清掉。
			 */
			const [dragged, setDragged] = React.useState({})
			const graphKey = `${layer}|${layerNodes.length}|${layerEdges.length}`
			React.useEffect(() => {
				setDragged({})
			}, [graphKey])
			const onNodesChange = React.useCallback((changes) => {
				setDragged((current) => {
					let next = current
					for (const change of changes) {
						if (change?.type !== 'position' || change.position === undefined) continue
						if (next === current) next = { ...current }
						next[change.id] = change.position
					}
					return next
				})
			}, [])

			/** 一个点的状态:矛盾 > 废止 > 待核验(只登记、没有写进长期知识的事实)> 平常。 */
			const nodeState = (node) => {
				if (Array.isArray(node.facts) && node.facts.some((id) => conflicted.has(id))) return 'conflict'
				if (node.status === 'deprecated') return 'off'
				if (node.kind !== 'concept' && node.kind !== 'value_type' && node.source === 'asserted' && (node.facts ?? []).length === 0) return 'pending'
				return 'on'
			}
			const selectedId = picked?.kind === 'node' ? picked.node.id : (focus ?? null)

			/**
			 * 投影节点 → React Flow 节点。坐标 = 力导向松弛过的投影坐标(起点确定 ⇒ 同一份账本同一张图)。
			 * 尺寸显式给:只写在 style 里的话,React Flow 要等测量完成才知道它多大。
			 */
			/**
			 * 小图(十来个点)不跑力导向:几个点、几条边时它常常把点排成一条线。
			 * 改成一圈:连得最多的那个点居中(它是这张图的主语),其余按投影顺序绕一圈——确定、好读。
			 * 点少(六个以内)时不放中心:边都是圈上的弦,不会从某个点身上穿过去、压住它的标签。
			 */
			const small = allNodes.length <= 14
			const ring = (() => {
				if (!small) return null
				const degree = new Map(allNodes.map((node) => [node.id, 0]))
				for (const edge of allEdges) {
					if (degree.has(edge.from)) degree.set(edge.from, degree.get(edge.from) + 1)
					if (degree.has(edge.to)) degree.set(edge.to, degree.get(edge.to) + 1)
				}
				const hub = allNodes.length >= 7 ? [...allNodes].sort((left, right) => degree.get(right.id) - degree.get(left.id))[0] : null
				const around = allNodes.filter((node) => node !== hub)
				const radius = 120 + around.length * 14
				const out = new Map()
				if (hub !== null) out.set(hub.id, { x: 0, y: 0 })
				around.forEach((node, index) => {
					const angle = -Math.PI / 2 + (index / around.length) * Math.PI * 2
					out.set(node.id, { x: Math.cos(angle) * radius * 1.6, y: Math.sin(angle) * radius })
				})
				return out
			})()
			const layout = small ? (nodes) => nodes : forceLayout
			const rfNodes = layout(
				allNodes.map((node) => ({
					id: node.id,
					type: 'default',
					position: dragged[node.id] ?? ring?.get(node.id) ?? { x: node.x ?? 0, y: node.y ?? 0 },
					initialWidth: 120,
					initialHeight: 26,
					selected: node.id === selectedId,
					data: {
						label: h(
							'span',
							{ className: 'clearai-star', 'data-kind': node.kind, 'data-state': nodeState(node), 'data-sel': node.id === selectedId ? '1' : '0' },
							h('i', null),
							h('span', null, trimLabel(node.kind === 'value_type' ? (FORM_WORD[node.ref] ?? node.label ?? node.ref) : (node.label ?? node.ref ?? node.id), 16)),
							node.layer === 'entity' ? h(CountMarks, { counts: data?.entityKnowledge?.[node.id]?.counts }) : null,
							(childCount.get(node.id) ?? 0) > 0
								? h(
										'b',
										{
											className: 'clearai-fold',
											title: isCollapsed(node.id) ? t('展开下一层') : t('收起下一层'),
											onClick: (event) => {
												event.stopPropagation()
												toggle(node.id)
											},
										},
										isCollapsed(node.id) ? `+${hiddenUnder.get(node.id) ?? 0}` : '−',
									)
								: null,
						),
					},
					className: 'clearai-star-node',
					style: { background: 'transparent', border: 0, padding: 0, width: 'auto', boxShadow: 'none' },
				})),
				allEdges.map((edge) => ({ source: edge.from, target: edge.to })),
			)

			/** 投影边 → React Flow 边:实线已验证、虚线待核验、淡线上下位、告警色是矛盾。 */
			const edgeTone = (edge) => {
				if (edge.kind === 'assertion' && conflicted.has(edge.fact)) return { stroke: 'var(--dsw-alias-state-warn-primary)', strokeWidth: 1.4 }
				if (edge.kind === 'is_a') return { stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 1, strokeDasharray: '1 3' }
				if (edge.status === 'retracted') return { stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1, strokeDasharray: '2 4' }
				if (edge.kind === 'assertion' && edge.status !== 'live') return { stroke: 'var(--dsw-alias-label-tertiary)', strokeWidth: 1.1, strokeDasharray: '5 4' }
				return { stroke: edge.kind === 'assertion' ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-tertiary)', strokeWidth: edge.kind === 'assertion' ? 1.3 : 1 }
			}
			const rfEdges = allEdges.map((edge) => ({
				id: edge.id,
				source: edge.from,
				target: edge.to,
				type: 'straight',
				label: edge.kind === 'is_a' ? '' : (edge.label ?? ''),
				labelStyle: { fontSize: 10, fill: 'var(--dsw-alias-label-secondary)' },
				labelBgStyle: { fill: 'var(--dsw-alias-bg-base)', fillOpacity: 0.9 },
				labelBgPadding: [3, 1],
				style: edgeTone(edge),
			}))

			const onNodeClick = (_event, node) => {
				const original = nodeById.get(node.id)
				if (original !== undefined) setPicked({ kind: 'node', node: original })
			}
			const onEdgeClick = (_event, edge) => {
				const original = allEdges.find((item) => item.id === edge.id)
				if (original !== undefined) setPicked({ kind: 'edge', edge: original })
			}
			/** 结论那边点了「相关」里的一个主语:当成在图上点了它。 */
			React.useEffect(() => {
				if (focus === null || focus === undefined) return
				const original = nodeById.get(focus)
				if (original !== undefined) setPicked({ kind: 'node', node: original })
			}, [focus])

			const inspection =
				picked === null
					? null
					: picked.kind === 'edge'
						? { kind: 'edge', id: picked.edge.id, label: picked.edge.label }
						: { kind: picked.node.kind, id: picked.node.kind === 'concept' ? String(picked.node.ref ?? '') : picked.node.id, label: picked.node.label ?? picked.node.ref ?? picked.node.id }
			/** 「只看相关」:概念筛概念、实例筛实体、断言边筛谓词。 */
			const filterTarget = picked === null ? null : picked.kind === 'edge' ? (picked.edge.predicate ?? null) : String(picked.node.ref ?? '')

			/**
			 * React Flow 的**实例**(用来适配)要从 `onInit` 拿:v12 里 ref 拿到的是 DOM 节点,
			 * 在它上面调 `fitView` 会静默变成空操作。画布的几何或内容变了就重新适配一次。
			 */
			const rfRef = React.useRef(null)
			React.useEffect(() => {
				const timer = setTimeout(() => rfRef.current?.fitView?.({ padding: 0.18, duration: 200 }), 60)
				return () => clearTimeout(timer)
			}, [fullscreen, layer, picked !== null, allNodes.length])

			/** 全屏时小卡走右侧抽屉:摆在画布下方会把画布压矮,刚点开的那个点直接掉出可视区。 */
			const sideBySide = fullscreen === true
			const empty =
				layer === 'entity'
					? `${typeof unlanded === 'number' && unlanded > 0 ? `${t('共 ')}${unlanded}${t(' 条断言的主体尚未建立实体文件。')}` : t('实体图暂无内容。')}${t('clear/ontology/entities/ 下的实体文件与写入长期知识的断言将在此显示。')}`
					: t('本体图暂无内容。模型在 clear/ontology/concepts/ 与 relations/ 下建立概念与关系文件后,将在此显示。')
			return h(
				'div',
				{ className: 'clearai-graph', 'data-full': fullscreen === true ? '1' : '0' },
				h(
					'div',
					{ className: 'clearai-graph-bar' },
					h(
						'span',
						{ className: 'clearai-seg' },
						h('span', { 'data-on': layer === 'ontology' ? '1' : '0', onClick: () => { setPicked(null); onLayer('ontology') } }, `${t('本体图')} ${countOf('ontology')}`),
						h('span', { 'data-on': layer === 'entity' ? '1' : '0', onClick: () => { setPicked(null); onLayer('entity') } }, `${t('实体图')} ${countOf('entity')}`),
					),
					h(
						'span',
						{ className: 'clearai-legend' },
						h('span', { 'data-l': 'solid' }, t('已验证')),
						h('span', { 'data-l': 'dash' }, t('待核验')),
						layer === 'entity' ? h('span', { className: 'clearai-kcount-legend' }, ...COUNT_ORDER.map((key) => h('span', { key }, h('em', { 'data-b': key }), COUNT_WORD[key]))) : null,
						conflicts.length > 0 ? h('span', { 'data-l': 'warn' }, `${t('矛盾')} ${conflicts.length}`) : null,
					),
					h('span', { style: { flex: '1 1 auto' } }),
					allNodes.length === 0 ? null : h('span', { className: 'clearai-link', onClick: () => rfRef.current?.fitView?.({ padding: 0.18, duration: 200 }) }, t('适配')),
					h('span', { className: 'clearai-link', onClick: onToggleFullscreen }, fullscreen === true ? t('退出全屏') : t('全屏')),
				),
				h(
					'div',
					{ className: 'clearai-graph-body', 'data-side': sideBySide ? '1' : '0' },
					XYFlow === null || XYFlow.ReactFlow === undefined || XYFlow.ReactFlow === null
						? h('div', { className: 'clearai-graph-empty' }, `${t('图组件不可用')}(${String(XYFLOW_LOAD.reason ?? '')}):${t('结论仍可正常查看。')}`)
						: allNodes.length === 0
							? h('div', { className: 'clearai-graph-empty' }, empty)
							: h(
									'div',
									{ className: 'clearai-graph-canvas' },
									h(
										XYFlow.ReactFlow,
										{
											onInit: (instance) => {
												rfRef.current = instance
											},
											onNodesChange,
											nodes: rfNodes,
											edges: rfEdges,
											onNodeClick,
											onEdgeClick,
											onPaneClick: () => setPicked(null),
											fitView: true,
											minZoom: 0.2,
											maxZoom: 3,
											proOptions: { hideAttribution: true },
											style: { background: 'transparent' },
											nodesDraggable: true,
											nodesConnectable: false,
											elementsSelectable: true,
											panOnDrag: true,
											zoomOnScroll: true,
											zoomOnDoubleClick: false,
										},
										h(XYFlow.Controls, { showInteractive: false }),
										h(XYFlow.Background, { variant: 'dots', gap: 22, size: 1, color: 'var(--dsw-alias-border-l2)' }),
									),
								),
					picked === null
						? null
						: h(
								'div',
								{ className: 'clearai-graph-side' },
								picked.kind === 'node' && picked.node.layer === 'entity' && picked.node.kind === 'instance' ? h(EntityCard, { node: picked.node, data, send, sent: asked, onSent: (key, kind) => setAsked({ ...asked, [key]: kind }) }) : null,
								h(GraphInspector, { selection: inspection, sessionId, names: entityNames, onFilter: () => onFilter(filterTarget), onClose: () => setPicked(null) }),
							),
				),
				/** 读时的跨文件检查只标不拦:有问题的那一份不进图,这里说清是哪个文件、哪里不对。 */
				problems.length === 0
					? null
					: h(
							'details',
							{ className: 'clearai-graph-problems' },
							h('summary', null, `${t('本体文件有 ')}${problems.length}${t(' 项问题(不纳入图中)')}`),
							...problems.slice(0, 12).map((item, index) =>
								h('div', { key: `${item.path ?? ''}#${index}`, 'data-sev': item.severity === 'error' ? 'error' : item.severity === 'info' ? 'info' : 'warning' }, h('code', null, String(item.path ?? '')), ` ${String(item.detail ?? item.code ?? '')}`),
							),
							problems.length > 12 ? h('div', null, `… ${problems.length - 12}`) : null,
						),
			)
		}

		const LocalizedFacts = withLocale(Atlas)
		const LocalizedExplore = withLocale(ExploreView)

		/** 会话预设的 id:面板只在这个模式的会话里出现。 */
		const PRESET_ID = 'clearai'

		function apply(ctx) {
			// 这四个服务都声明在 `inject` 里,所以这里直接用属性读(Cordis 保证就位);
			// 用 `ctx.get()` 也读得到,但属性形式同时受 inject 的「服务重载后重新激活」保护。
			const { slots, sessions, sidebarRight } = ctx
			/**
			 * 语言:接 DSH 原生的 locale 座位(可选 —— 老宿主或测试桩里没有它,面板退化成中文)。
			 * 词典以**源文**为键注册进那个座位,于是 `t('已提出')` 走的是宿主那条查找链:
			 * 缺一条英文就落回中文,而不是显示成 key。
			 */
			const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
			if (locale !== undefined && typeof locale.bind === 'function') {
				ctx.effect(() => locale.register(LOCALE_NS, { zh: LOCALE_ZH, en: LOCALE_EN }), 'clearai: locale dictionaries')
				localeBound = locale.bind(LOCALE_NS)
				/**
				 * 语言变了要做两件事:① 让**组件**重画;② 把**座位重挂**一遍。
				 *
				 * ② 不是洁癖:座位上的标签是**注册那一刻**求值的,只重画组件的话,中栏页签会
				 * 停在上一种语言(失效模式:整页已经切成中文,页签还写着 Deliverables / Facts)。
				 * 走宿主自己的 `locale/change` 事件(它声明了这个事件,也正是为这种情况留的)。
				 */
				ctx.effect(() => {
					const onLocaleChange = () => {
						localeBound = locale.bind(LOCALE_NS)
						for (const listener of localeListeners) listener()
						for (const resync of localeResyncs) resync()
					}
					// 事件的订阅走宿主自己的 ctx.on;拿不到就退化成"只绑一次"(老宿主仍然能用,只是切语言要刷新)。
					if (typeof ctx.on !== 'function') return () => {}
					const off = ctx.on('locale/change', onLocaleChange)
					return typeof off === 'function' ? off : () => {}
				}, 'clearai: locale change')
			}
			// 面板的 CSS(原生那套药丸按钮与主题令牌):带 data-plugin 标记,插件卸载时一起收掉。
			ctx.effect(installStyles, 'clearai: panel css')

			/**
			 * **当前主视图里的那个会话**。
			 *
			 * 这里原来是 `sessions.list.getSnapshot().current`(照抄当年的原生 chat)。宿主的
			 * `SessionListState` 现在只有 `{ ids, byId, phase, projectionsBySession }` —— **没有
			 * `current`**:读到的永远是 `undefined`,于是 `isCurrentPreset()` 恒为 false,
			 * `occupy()` / `syncRail()` **一个座位都不注册**。失效形态:模式在、宿主半一切正常、
			 * 右栏只剩宿主自带的页签、中栏没有「产物」——而且不报错。
			 *
			 * 宿主自己的取法(两处都用它):在 `byId` 里找 `retainedBy.mainView > 0` 的那一行
			 * (`dsh-client-ui-open-in-app`、`dsh-client-ui-agent-preset`)。老宿主若还留着
			 * `current`,照旧认它——那一份更精确。
			 */
			const currentSessionRow = () => {
				try {
					const state = sessions.list.getSnapshot()
					if (state === undefined || state === null) return undefined
					if (typeof state.current === 'string' && state.current !== '') return state.byId?.[state.current]
					return Object.values(state.byId ?? {}).find((row) => (row?.retainedBy?.mainView ?? 0) > 0)
				} catch {
					return undefined
				}
			}
			const isCurrentPreset = () => {
				try {
					const preset = currentSessionRow()?.projectionValues?.agentPreset
					return typeof preset === 'string' && preset === PRESET_ID
				} catch {
					return false
				}
			}

			/** 打开一个子会话(旁观)。两个服务都问一遍,拿不到就返回 undefined——组件会退化成文本。 */
			const openSpectator = (id) => {
				if (typeof sessions.open === 'function') return sessions.open(id)
				const workspace = ctx.get('uiWorkspace')
				if (workspace !== undefined && typeof workspace.openSession === 'function') return workspace.openSession(id)
				return undefined
			}

			const seats = []
			/**
			 * `options` 可以是对象,也可以是**函数**。为什么要有函数这一路:座位上的标签在
			 * 注册那一刻就被求值了,传对象等于把语言冻住(失效模式:整页切成中文,页签还写着英文)。
			 * 传函数就让每次注册都重新求值——语言一变重挂一次,标签跟着走。
			 */
			const occupy = (name, options, component) => {
				let disposer = null
				const sync = () => {
					const wanted = isCurrentPreset()
					const resolved = typeof options === 'function' ? options() : options
					if (wanted && disposer === null) {
						disposer = slots.register({ name, ...resolved }, component)
					} else if (!wanted && disposer !== null) {
						disposer()
						disposer = null
					}
				}
				// 注册属于这个 fiber:`ctx.effect` 拿的是 `slots.inject` 的 disposer,
				// 插件被卸载时插座的等待与已经落下的席位一起收掉(原生插件同一写法)。
				ctx.effect(() => slots.inject(name, sync), `clearai: seat ${name}`)
				seats.push(sync)
				localeResyncs.add(() => {
					if (disposer === null) return
					disposer()
					disposer = null
					sync()
				})
			}

			/**
			 * **右栏不再注册页签**:世界树(计划的步骤与闸门)并入探索货架的「过程记录」。
			 * 过程与结果各占中栏一格(探索 / 本体),人不必在右栏与中栏之间来回找。
			 *
			 * 切中栏视图走原生正门 `layout.selectPanel`;座位自己的 props 里有 `openView` 时优先用它。
			 * `selectPanel` 对未注册的 key 会抛 ⇒ 包起来,点不动也不把面板带下水。
			 */
			const openPanel = (props, id) => {
				if (typeof props?.openView === 'function') {
					try {
						props.openView(id)
						return true
					} catch {
						/* 退到 layout 那一路 */
					}
				}
				const layout = ctx.get('layout')
				if (layout === undefined || typeof layout.selectPanel !== 'function') return false
				try {
					layout.selectPanel(id)
					return true
				} catch {
					return false
				}
			}
			/**
			 * 「立为问题 / 暂缓」:替人往这个会话里发一句话(与人在输入框里打字同一条路)。
			 * 对话服务按会话作用域取(`sessions.scope(id)` 上的 `conversation`);拿不到就返回 false,
			 * 界面如实说「请在对话中说明」。这里不写任何账:状态由模型的 Frame 修订落下。
			 */
			const sendFor = (props) => (text) => {
				const id = sessionIdFor(props)
				if (typeof id !== 'string' || typeof sessions.scope !== 'function') return false
				try {
					const scoped = sessions.scope(id)
					const conversation = typeof scoped?.get === 'function' ? scoped.get('conversation') : scoped?.conversation
					if (conversation === undefined || conversation === null || typeof conversation.send !== 'function') return false
					Promise.resolve(conversation.send(text)).catch(() => {})
					return true
				} catch {
					return false
				}
			}

			/**
			 * 这条行所属的会话 id —— 预览地址里那一段**必须是它**。
			 *
			 * 一个修过的 bug:原来这里是
			 * `openPreview = (path) => openNativePreview(sidebarRight, typeof path === 'string' ? path : '', path)` ——
			 * 第二参本该是**会话 id**,却把路径塞了进去。于是地址成了
			 * `dsh-resource://file/session/products%2Freport.html`,原生读面按 SessionId 查不到
			 * 工作区根,点每一条产物都报
			 * `lookup provider "workspaceFileScope" did not resolve the requested identity`。
			 * 三处入口(产物 / 技能 / 记忆文件)共用这一个闭包,所以是一处坏、三处全坏。
			 *
			 * 取法:座位自己的 `props.sessionId` 优先(更精确);props 没有时兜底读当前会话
			 * (`currentSessionRow`,见上)。兜底在这里成立,是因为面板**只在当前会话的预设是
			 * clearai 时挂载**(`isCurrentPreset`,见上),会话切走时面板先注销 ——
			 * 不存在「面板还挂着、行的会话已经换了」的窗口。
			 */
			const sessionIdFor = (props) => {
				const fromProps = props === null || props === undefined ? undefined : props.sessionId
				if (typeof fromProps === 'string' && fromProps !== '') return fromProps
				const id = currentSessionRow()?.id
				return typeof id === 'string' && id !== '' ? id : undefined
			}
			/** 每个座位按自己的 props 造一个打开器:共用一个「反正差不多」的闭包就是上面那个 bug。 */
			const openPreviewFor = (props) => (path) => openNativePreview(sidebarRight, sessionIdFor(props), path)

			/**
			 * 中栏两格:**探索**(过程:问题、候选假设、下一步、过程记录)与**本体**(结果:结论、本体图、
			 * 已确立的事实、经验)。本体货架与模型读的 `clear/knowledge/facts/INDEX.md` 是**同一张表**。
			 *
			 * 注册时必须把**打开器**都交下去:证据的出处、事实原件、两格之间的跳转全靠它们。
			 * 漏了它们,界面看着能点、点了什么也不会发生。
			 */
			occupy('conversation.view', () => ({ id: 'clearai-explore', order: 19, label: t('探索') }), (props) =>
				h(LocalizedExplore, { ...props, openSpectator, openPreview: openPreviewFor(props), send: sendFor(props), openFacts: () => openPanel(props, 'clearai-facts') }),
			)
			occupy('conversation.view', () => ({ id: 'clearai-facts', order: 20, label: t('本体') }), (props) => h(LocalizedFacts, { ...props, openSpectator, openPreview: openPreviewFor(props), send: sendFor(props), openExplore: () => openPanel(props, 'clearai-explore') }))
			/**
			 * **计划面坐在原生 plan 那个座位上**。
			 *
			 * 为什么是这个座位:DSH 把「计划」这件事的控件固定在 composer 工具行的
			 * `conversation.input.plan` 上(`dsh-client-ui-plan` 的「Plan ×」),而它只在
			 * `plan/mode` 投影存在时才渲染——我们的预设不挂 `plan-mode`(计划是我们自己的事实,
			 * 不是每回合的策略),所以那个座位在本模式下**一直空着**:位置在,没人说话。
			 * 把自己的计划面放进去,就是「同一个位置、两种预设各自的计划面」,而不是另起一块浮层。
			 *
			 * 两条实现约束(读原生实现量出来的,不是猜的):
			 *   · 这个座位是 `single`:同 priority 再注册会**直接抛错**(核心的报错原文是
			 *     「register at a different priority to shadow it (lowest renders)」),
			 *     所以必须给一个更低的 priority 才遮蔽得住;
			 *   · 遮蔽的代价是零——原生那个 occupant 在本模式下本来 `return null`。
			 * 而我们只在**当前会话是本预设**时占座(`occupy`),会话切走就还给它。
			 */
			occupy('conversation.input.plan', { priority: -1 }, (props) => h(PlanChip, { ...props, openExplore: () => openPanel(props, 'clearai-explore') }))
			// 输入框下方的常驻派生条(运行态卡在人这一侧的对应物)
			/**
			 * **输入框下那一条不再注册**:它说的话(阶段 / 完成度 / 当前步)与原生目标提示、
			 * 与工具行那颗计划 chip 重复 ✗,却**独占一行把输入框顶上去** ✗。
			 * 唯一可点、且只有我们知道的那件事(「待处理 N」)已经并进计划 chip(同一行,一点直达探索货架)。
			 */
			ctx.effect(() => sessions.list.subscribe(() => {
				for (const sync of seats) sync()
			}), t('clearai-loop: 席位跟着会话预设进出'))
		}

		exports.apply = apply
		exports.inject = inject
		/**
		 * 测试缝:世界树的拓扑摊平是**纯函数**,而渲染本身没法在没浏览器的地方验。
		 * 把它导出,好让 `test/client.test.mjs` 直接断言拓扑(线性 / 分叉 / 收敛三种形态)。
		 * 不是给别的包用的接口——真要复用,该搬进宿主侧的 fold。
		 */
		exports.__topology = { treeRows, treeConns, railPath, treeMarks, treeArcs, arcDash, treeLoops, TREE, TREE_COLOR, rowIndexOf, treeFocus, factsFocus, propositionForStep }
		/**
		 * 测试缝之二:把组件本身交出去,好让测试用一个「渲染成字符串」的 React 桩
		 * 真的跑一遍渲染路径(捕 undefined 字段访问这类只有渲染时才炸的错)。
		 * 仍然不是给别的包用的接口。
		 */
		exports.__components = { PlanChip, WorldTree, ExploreView, AnswerCards, QuestionBox, NextBox, EmergentActions, GraphBand, GraphInspector, NeedYou, TreeDetail, Atlas, AtlasHeader, ConclusionList, ConclusionRow, ConclusionDetail, StationBar, TrustTimeline, ClearAIMark, LOOP_LABEL, EntityCard, KnowledgeFlowBox, KnowledgeItemRow, SettledLine, CountMarks }
		/**
		 * 测试缝之三:命题那一列的**派生**是纯函数(分组、处境、来路、证据链),
		 * 渲染本身没法在没浏览器的地方细究——把它导出去,让测试直接断言派生结果。
		 */
		exports.__propositions = { evidenceOf, originsOf, stepOfFact, conclusionsOf }
		/** 测试缝之四:本体格的过滤判据(纯函数)。 */
		exports.__ontology = { termMatches }
		return module.exports
	},
})
