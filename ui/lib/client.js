/**
 * clearai-dsh —— 浏览器半(ClearAI 的面板)。
 *
 * 它注册四个座位,外加输入框那两个:
 *   中栏 `conversation.view`    产物(声明 vs 盘上实际)、事实(已确认事实 + 在流转的命题)
 *   右栏 `sidebarRightTabs`     世界树(步骤/分叉/车道的拓扑与闸门)、技能 · 记忆(合并目录 + 本会话用量)
 *   输入框 `conversation.input`  计划芯片(步数 + 「需要你 N」)、续跑状态行
 * 除此之外还有一个**只给人**的写入口:世界树详情里的人门动作(采纳 / 放弃),它走宿主半的
 * `POST /api/clearai/gate`,落成一条署名为人的消息——模型能调的工具面里没有这些动词。
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
		const LOCALE_ZH = {" · 交付 ": " · 交付 ", " · 人 ": " · 人 ", " · 在工作区外,面板不读正文": " · 在工作区外,面板不读正文", " · 尺子 ": " · 尺子 ", " · 执行没跑成": " · 执行没跑成", " · 支持到 ": " · 支持到 ", " · 最近 ": " · 最近 ", " · 证据 ": " · 证据 ", " · 车道 ": " · 车道 ", " · 随步骤作废而终止": " · 随步骤作废而终止", " 份)。": " 份)。", " 份产物,但没有任何计划声明过它们。点一条可以直接看(它们不计入交付)。": " 份产物,但没有任何计划声明过它们。点一条可以直接看(它们不计入交付)。", " 份没列出来(这一栏只列最近改动的 ": " 份没列出来(这一栏只列最近改动的 ", " 发起": " 发起", " 处声明": " 处声明", " 字节": " 字节", " 字节 · ": " 字节 · ", " 字节 · 未被任何计划声明": " 字节 · 未被任何计划声明", " 字节 · 资源 ": " 字节 · 资源 ", " 推翻:": " 推翻:", " 旁观 ": " 旁观 ", " 条": " 条", " 条)": " 条)", " 次侦察": " 次侦察", " 次评估者": " 次评估者", " 步": " 步", " 步)": " 步)", " 等 ": " 等 ", " 评估卡": " 评估卡", " 轮": " 轮", " 里打开": " 里打开", "(假设达到这一级且无推翻才升格为事实)": "(假设达到这一级且无推翻才升格为事实)", "(每次修订留痕,旧值不删)": "(每次修订留痕,旧值不删)", "(点一下开右栏「世界树」)": "(点一下开右栏「世界树」)", "(点一下开右栏「世界树」看拓扑)": "(点一下开右栏「世界树」看拓扑)", "(留档不删)": "(留档不删)", "(缺)": "(缺)", "(要独立评估)才达门槛": "(要独立评估)才达门槛", "),所以这个分叉没有归宿了:**随步骤作废而终止**——它既不是被人裁掉(没人做过这个决定),也不是被算术排掉(没有尺子排过它)。要收掉工作副本(保留 ref),对它调 AbandonFork(会弹人工确认)。": "),所以这个分叉没有归宿了:**随步骤作废而终止**——它既不是被人裁掉(没人做过这个决定),也不是被算术排掉(没有尺子排过它)。要收掉工作副本(保留 ref),对它调 AbandonFork(会弹人工确认)。", "),等目标验收时升格为事实": "),等目标验收时升格为事实", ")——它不是落选:落选意味着它跑完了、被尺子排到了后面;这一条是没跑成,所以也没有读数可以参与算术。": ")——它不是落选:落选意味着它跑完了、被尺子排到了后面;这一条是没跑成,所以也没有读数可以参与算术。", "**执行没跑成**(": "**执行没跑成**(", "**执行者未归**:这条世界线的执行者派出去之后没有回灌,而分叉已经收口——它再回来也没有归宿了,所以这里既不判它跑成也没跑成,也不再等它。它的产物(如果写过)还在它自己的工作副本里;要判断那条线到底做出了什么,直接看工作副本比看这条状态可靠。": "**执行者未归**:这条世界线的执行者派出去之后没有回灌,而分叉已经收口——它再回来也没有归宿了,所以这里既不判它跑成也没跑成,也不再等它。它的产物(如果写过)还在它自己的工作副本里;要判断那条线到底做出了什么,直接看工作副本比看这条状态可靠。", ":还差 ": ":还差 ", ";放弃缘由:": ";放弃缘由:", "clearai 面板:右栏页签类型注册失败 ": "clearai 面板:右栏页签类型注册失败 ", "clearai-loop: 席位跟着会话预设进出": "clearai-loop: 席位跟着会话预设进出", "世界树": "世界树", "世界线:": "世界线:", "为什么放弃?(留痕可考)": "为什么放弃?(留痕可考)", "事实": "事实", "产物": "产物", "人审查后决定撤回": "人审查后决定撤回", "人已撤回(记录保留)": "人已撤回(记录保留)", "人的裁决:": "人的裁决:", "仅人可引用": "仅人可引用", "会话日志里的原生审批对(不可伪造)": "会话日志里的原生审批对(不可伪造)", "依据": "依据", "侦 ": "侦 ", "侦察 · ": "侦察 · ", "候选": "候选", "做什么": "做什么", "做法": "做法", "停摆等人": "停摆等人", "其他(": "其他(", "出现推翻证据": "出现推翻证据", "出现推翻证据(终态,记录保留)": "出现推翻证据(终态,记录保留)", "分支": "分支", "切回历史的世界树(计划都还在,文档也归档在 clear/goals/plans/)": "切回历史的世界树(计划都还在,文档也归档在 clear/goals/plans/)", "判据": "判据", "判据:": "判据:", "判据待写": "判据待写", "升格门槛": "升格门槛", "原生预览打不开这条路(它在工作区外?)": "原生预览打不开这条路(它在工作区外?)", "原生预览打开它": "原生预览打开它", "原生预览打开它(计划声明的产物)": "原生预览打开它(计划声明的产物)", "合并目录、本会话用法、可引用可采纳": "合并目录、本会话用法、可引用可采纳", "命题": "命题", "命题 · ": "命题 · ", "在": "在", "在 ": "在 ", "在世界树里看这一步": "在世界树里看这一步", "在右栏预览": "在右栏预览", "声明的是目录;准入要求具体文件——目录不算物证": "声明的是目录;准入要求具体文件——目录不算物证", "多问我": "多问我", "完成度 ": "完成度 ", "完成度 —": "完成度 —", "审批记录": "审批记录", "工作区模板 · clear/skills": "工作区模板 · clear/skills", "工作区现状(本会话还没有第一轮对话,这份还没进投影)": "工作区现状(本会话还没有第一轮对话,这份还没进投影)", "已交付": "已交付", "已作废": "已作废", "已回灌": "已回灌", "已推翻": "已推翻", "已提出": "已提出", "已撤回": "已撤回", "已收尾 · 存档可看": "已收尾 · 存档可看", "已改版": "已改版", "已放弃": "已放弃", "已放弃探索:": "已放弃探索:", "已放弃的分叉": "已放弃的分叉", "已替代": "已替代", "已确认": "已确认", "已确认事实 · ": "已确认事实 · ", "已被下一版命题替代(版本留着,不参与当前推理)": "已被下一版命题替代(版本留着,不参与当前推理)", "已裁决": "已裁决", "已评估": "已评估", "已达成": "已达成", "已达门槛(": "已达门槛(", "已达门槛,已升格为事实": "已达门槛,已升格为事实", "已采纳": "已采纳", "待开计划": "待开计划", "待推进": "待推进", "待裁决": "待裁决", "我的 · ~/.dsh": "我的 · ~/.dsh", "打开 ": "打开 ", "打开「事实」那一格并展开这条命题": "打开「事实」那一格并展开这条命题", "打开世界树并选中产出这条事实的验证步": "打开世界树并选中产出这条事实的验证步", "打开世界树并选中产生这条证据的验证步": "打开世界树并选中产生这条证据的验证步", "打开失败:HTTP ": "打开失败:HTTP ", "打开计划文档(原生预览)": "打开计划文档(原生预览)", "技能 · 记忆": "技能 · 记忆", "把这道裁决摆到原生提问卡上(带你读到的判据与各分支读数)": "把这道裁决摆到原生提问卡上(带你读到的判据与各分支读数)", "探索中": "探索中", "推翻": "推翻", "推进中": "推进中", "提交中…": "提交中…", "提交失败:": "提交失败:", "支持": "支持", "支持到 ": "支持到 ", "收敛": "收敛", "收束:": "收束:", "收起": "收起", "收起详情": "收起详情", "放弃了这次探索": "放弃了这次探索", "放弃探索": "放弃探索", "放弃缘由(必填)": "放弃缘由(必填)", "放弃要留痕:先写缘由": "放弃要留痕:先写缘由", "放弃要留痕:点一下写缘由,写了才能提交": "放弃要留痕:点一下写缘由,写了才能提交", "放弃这条分叉": "放弃这条分叉", "放弃这次探索(留档不删,ref 保留)": "放弃这次探索(留档不删,ref 保留)", "放行": "放行", "旁观写这条裁决的评估者子会话(论证过程)": "旁观写这条裁决的评估者子会话(论证过程)", "旁观评估者": "旁观评估者", "旁观这条世界线的评估者会话(只读)": "旁观这条世界线的评估者会话(只读)", "无法判定": "无法判定", "是目录(不算物证)": "是目录(不算物证)", "最后改动 ": "最后改动 ", "有了第一条证据": "有了第一条证据", "有人在等你": "有人在等你", "未分类": "未分类", "未声明": "未声明", "未收口(随步骤作废而终止)": "未收口(随步骤作废而终止)", "未知": "未知", "未走:": "未走:", "未采纳": "未采纳", "本会话 模型 ": "本会话 模型 ", "本体声明还没随投影下发,这里用的是规范闭环的镜像;会话跑过一拍后会自动对齐声明。": "本体声明还没随投影下发,这里用的是规范闭环的镜像;会话跑过一拍后会自动对齐声明。", "本项目 · .dsh / .agents": "本项目 · .dsh / .agents", "本项目写的 · clear/skills": "本项目写的 · clear/skills", "核心产物(": "核心产物(", "步 ": "步 ", "没正常结束": "没正常结束", "没送出去:": "没送出去:", "派出 ": "派出 ", "派生 · ": "派生 · ", "点一条 → 右栏预览": "点一条 → 右栏预览", "点一行看细节": "点一行看细节", "点开看这一步的细节": "点开看这一步的细节", "版本": "版本", "状态": "状态", "独立评估者": "独立评估者", "用原生提问卡决定": "用原生提问卡决定", "用原生预览打开章程(它每回合整份注入模型上下文)": "用原生预览打开章程(它每回合整份注入模型上下文)", "用提问卡决定": "用提问卡决定", "盘上已有(": "盘上已有(", "盘上没有": "盘上没有", "盘上没有这个文件": "盘上没有这个文件", "目录": "目录", "目录还没到(内核下一次 pre-step 会发)": "目录还没到(内核下一次 pre-step 会发)", "目录里已经没有(": "目录里已经没有(", "目标": "目标", "目标挂起": "目标挂起", "看评估者": "看评估者", "看这一步的证据": "看这一步的证据", "确认放弃": "确认放弃", "确认放弃(留档不删,ref 保留)": "确认放弃(留档不删,ref 保留)", "等人或等世界线": "等人或等世界线", "等你说一句话": "等你说一句话", "等独立裁决": "等独立裁决", "策略暂停": "策略暂停", "策略暂停(理由没记下,已在日志里告警)": "策略暂停(理由没记下,已在日志里告警)", "算术推荐这条": "算术推荐这条", "续跑:多问我——每个阶段收尾就停下,等你给下一阶段(文档里叫「人在场」)。点一下切成「自己拿主意」。": "续跑:多问我——每个阶段收尾就停下,等你给下一阶段(文档里叫「人在场」)。点一下切成「自己拿主意」。", "续跑:自己拿主意——立约即授权,按轮数自己往下跑,只在不可约的判断上开门(文档里叫「无人值守」)。点一下切成「多问我」。": "续跑:自己拿主意——立约即授权,按轮数自己往下跑,只在不可约的判断上开门(文档里叫「无人值守」)。点一下切成「多问我」。", "续跑停着:": "续跑停着:", "续跑已撤回": "续跑已撤回", "缘由必填": "缘由必填", "缺": "缺", "能用的在上面,正在验的在下面": "能用的在上面,正在验的在下面", "自判": "自判", "自定义": "自定义", "自己拿主意": "自己拿主意", "被 ": "被 ", "被下一版命题改写": "被下一版命题改写", "裁决": "裁决", "裁决:采纳 ": "裁决:采纳 ", "要你": "要你", "观测": "观测", "计划": "计划", "计划 ": "计划 ", "计划受阻,等人处置": "计划受阻,等人处置", "计划在建,**等你确认**": "计划在建,**等你确认**", "计划已交付 ": "计划已交付 ", "计划已收尾(": "计划已收尾(", "计划待确认": "计划待确认", "计划文档": "计划文档", "计划的拓扑与闸门:脊柱、叉开的车道、收在哪、要你拍哪一下": "计划的拓扑与闸门:脊柱、叉开的车道、收在哪、要你拍哪一下", "让内核跑 ConvergeFork 落实它(合并是内核的活)": "让内核跑 ConvergeFork 落实它(合并是内核的活)", "记忆(": "记忆(", "记忆索引": "记忆索引", "证据": "证据", "证据 ": "证据 ", "评 ": "评 ", "评估": "评估", "评估卡": "评估卡", "评估者": "评估者", "评估者 ": "评估者 ", "评估者会话 ": "评估者会话 ", "评估者在裁决": "评估者在裁决", "说一句话就行 —— ": "说一句话就行 —— ", "读不到交付物:": "读不到交付物:", "读取中…": "读取中…", "读数": "读数", "读数(尺子 ": "读数(尺子 ", "起过 ": "起过 ", "跑着": "跑着", "车道 · ": "车道 · ", "边界:": "边界:", "达门槛且无推翻的命题,会在**目标验收**时由系统升格为事实(写在 clear/knowledge/facts/,模型读的 INDEX.md 同步)。": "达门槛且无推翻的命题,会在**目标验收**时由系统升格为事实(写在 clear/knowledge/facts/,模型读的 INDEX.md 同步)。", "运行时注册": "运行时注册", "还有 ": "还有 ", "还没交付": "还没交付", "还没有命题。人与模型都可以提出:每条要有一句话主张与一句「什么结果会推翻它」;通过验证的会升格到上面的事实货架。": "还没有命题。人与模型都可以提出:每条要有一句话主张与一句「什么结果会推翻它」;通过验证的会升格到上面的事实货架。", "还没有目标。目标带一份「怎样算回答了」的判据——判据在结果出现之前写下,由系统强制。": "还没有目标。目标带一份「怎样算回答了」的判据——判据在结果出现之前写下,由系统强制。", "还没有目标。立约并验证之后,达门槛且无推翻的命题会在目标验收时升格为事实。": "还没有目标。立约并验证之后,达门槛且无推翻的命题会在目标验收时升格为事实。", "还没有计划,所以还没有产物。立目标、建计划,交付过的每一步都会在这里按阶段排开。": "还没有计划,所以还没有产物。立目标、建计划,交付过的每一步都会在这里按阶段排开。", "还没有计划。计划立起来之后,这里画的是它的拓扑:脊柱上的步、叉开的车道、收在哪。": "还没有计划。计划立起来之后,这里画的是它的拓扑:脊柱上的步、叉开的车道、收在哪。", "还没有记忆。": "还没有记忆。", "还没有证据:先登记判据,再验证": "还没有证据:先登记判据,再验证", "这一步已作废(缘由:": "这一步已作废(缘由:", "这一步没有声明产物。": "这一步没有声明产物。", "这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示工作区的技能目录与记忆。": "这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示工作区的技能目录与记忆。", "这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示已确认的事实与正在流转的命题。": "这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示已确认的事实与正在流转的命题。", "这个会话还没有 ClearAI 的状态。": "这个会话还没有 ClearAI 的状态。", "这个工作区盘上已经有 ": "这个工作区盘上已经有 ", "这个工作区里还没有技能或记忆:用一次 `SaveSkill` 或 `WriteMemory`,或把技能放进 `clear/skills/`。": "这个工作区里还没有技能或记忆:用一次 `SaveSkill` 或 `WriteMemory`,或把技能放进 `clear/skills/`。", "这是系统对自己说的话(我们自己按的暂停 / 人清掉的窗口),不是运行档": "这是系统对自己说的话(我们自己按的暂停 / 人清掉的窗口),不是运行档", "进度": "进度", "采纳": "采纳", "采纳 ": "采纳 ", "采纳:改写 frontmatter,模型从此加载得到它": "采纳:改写 frontmatter,模型从此加载得到它", "采纳了某条世界线": "采纳了某条世界线", "采纳此世界线": "采纳此世界线", "问题:": "问题:", "阶段": "阶段", "阶段 ": "阶段 ", "阶段交界": "阶段交界", "需要你 ": "需要你 ", "面板动作失败:": "面板动作失败:", "项目章程": "项目章程", "预设自带": "预设自带", "验证": "验证", "验证中": "验证中", "这次采纳没有合并:": "这次采纳没有合并:", "(决定已登记,产物由一次普通交付落位)": "(决定已登记,产物由一次普通交付落位)", "分支或工作副本已不在": "分支或工作副本已不在"}
		const LOCALE_EN = {" · 交付 ": " · delivered ", " · 人 ": " · human ", " · 在工作区外,面板不读正文": " · outside the workspace; the panel will not read it", " · 尺子 ": " · metric ", " · 执行没跑成": " · execution did not complete", " · 支持到 ": " · supported to ", " · 最近 ": " · latest ", " · 证据 ": " · evidence ", " · 车道 ": " · lanes ", " · 随步骤作废而终止": " · ended when its step was voided", " 份)。": " files).", " 份产物,但没有任何计划声明过它们。点一条可以直接看(它们不计入交付)。": " artifacts on disk, but no plan declared them. Click one to open it (they do not count toward delivery).", " 份没列出来(这一栏只列最近改动的 ": " more not listed (this column lists only the ", " 发起": " started", " 处声明": " declared", " 字节": " bytes", " 字节 · ": " bytes · ", " 字节 · 未被任何计划声明": " bytes · declared by no plan", " 字节 · 资源 ": " bytes · resources ", " 推翻:": "refuted by:", " 旁观 ": " observe ", " 条": " entries", " 条)": " entries)", " 次侦察": " scouts", " 次评估者": " evaluators", " 步": " steps", " 步)": " steps)", " 等 ": " and ", " 评估卡": " evaluation card", " 轮": " rounds", " 里打开": "", "(假设达到这一级且无推翻才升格为事实)": " (a hypothesis is promoted to fact only at this level and with no refutation)", "(每次修订留痕,旧值不删)": " (every revision is kept; old values are not deleted)", "(点一下开右栏「世界树」)": " (click to open Worldlines)", "(点一下开右栏「世界树」看拓扑)": " (click to see the topology in Worldlines)", "(留档不删)": " (kept on record, not deleted)", "(缺)": " (missing)", "(要独立评估)才达门槛": " (independent evaluation required) to reach the threshold", "),所以这个分叉没有归宿了:**随步骤作废而终止**——它既不是被人裁掉(没人做过这个决定),也不是被算术排掉(没有尺子排过它)。要收掉工作副本(保留 ref),对它调 AbandonFork(会弹人工确认)。": "), so this fork has no destination left: **it ended when its step was voided** — it was neither decided by a person (nobody made that call) nor ranked out by arithmetic (no metric ever ranked it). To drop the working copy (keeping the ref), call AbandonFork on it (it asks for human confirmation).", "),等目标验收时升格为事实": "), and is promoted to fact when the goal is accepted", ")——它不是落选:落选意味着它跑完了、被尺子排到了后面;这一条是没跑成,所以也没有读数可以参与算术。": ") — this is not a loss: losing means it ran and was ranked behind; this one did not run, so it has no reading to enter into the arithmetic.", "**执行没跑成**(": "**Execution did not complete** (", "**执行者未归**:这条世界线的执行者派出去之后没有回灌,而分叉已经收口——它再回来也没有归宿了,所以这里既不判它跑成也没跑成,也不再等它。它的产物(如果写过)还在它自己的工作副本里;要判断那条线到底做出了什么,直接看工作副本比看这条状态可靠。": "**Executor never returned**: this worldline's executor was dispatched but never reported back, and the fork has already converged — if it returned now there would be nowhere to land, so it is neither judged done nor judged failed, and it is no longer awaited. Whatever it wrote still sits in its own working copy; to judge what that line actually produced, read the working copy rather than this status.", ":还差 ": ": short by ", ";放弃缘由:": "; reason for abandoning: ", "clearai 面板:右栏页签类型注册失败 ": "clearai panel: failed to register the right-sidebar tab type ", "clearai-loop: 席位跟着会话预设进出": "clearai-loop: seats come and go with the session's preset", "世界树": "Worldlines", "世界线:": "Worldline: ", "为什么放弃?(留痕可考)": "Why abandon it? (the record must be answerable)", "事实": "Facts", "产物": "Deliverables", "人审查后决定撤回": "withdrawn after human review", "人已撤回(记录保留)": "withdrawn by a person (record kept)", "人的裁决:": "Human decision: ", "仅人可引用": "user-invocable only", "会话日志里的原生审批对(不可伪造)": "the native approval pair in the session log (cannot be forged)", "依据": "Basis", "侦 ": "S", "侦察 · ": "Scout · ", "候选": "candidate", "做什么": "What it does", "做法": "Approach", "停摆等人": "stalled, waiting on a person", "其他(": "Other (", "出现推翻证据": "refuting evidence appeared", "出现推翻证据(终态,记录保留)": "refuting evidence appeared (terminal; record kept)", "分支": "Branch", "切回历史的世界树(计划都还在,文档也归档在 clear/goals/plans/)": "Switch back to an earlier worldline set (the plans are all still here, and their documents are archived under clear/goals/plans/)", "判据": "Criterion", "判据:": "Criterion: ", "判据待写": "criterion not written", "升格门槛": "Promotion threshold", "原生预览打不开这条路(它在工作区外?)": "The native preview cannot open this path (is it outside the workspace?)", "原生预览打开它": "Open it in the native preview", "原生预览打开它(计划声明的产物)": "Open it in the native preview (an artifact declared by the plan)", "合并目录、本会话用法、可引用可采纳": "Merged catalogue, usage in this session, invocable and adoptable", "命题": "Propositions", "命题 · ": "Propositions · ", "在": "in", "在 ": "in ", "在世界树里看这一步": "See this step in Worldlines", "在右栏预览": "Preview in the right sidebar", "声明的是目录;准入要求具体文件——目录不算物证": "This declares a directory; admission requires a concrete file — a directory is not physical evidence", "多问我": "Ask me more", "完成度 ": "Progress ", "完成度 —": "Progress —", "审批记录": "approval record", "工作区模板 · clear/skills": "Workspace template · clear/skills", "工作区现状(本会话还没有第一轮对话,这份还没进投影)": "Workspace as it stands (this session has no first turn yet, so this has not reached the projection)", "已交付": "delivered", "已作废": "voided", "已回灌": "reported back", "已推翻": "refuted", "已提出": "proposed", "已撤回": "withdrawn", "已收尾 · 存档可看": "closed · archived and readable", "已改版": "superseded", "已放弃": "abandoned", "已放弃探索:": "Exploration abandoned: ", "已放弃的分叉": "abandoned fork", "已替代": "superseded", "已确认": "confirmed", "已确认事实 · ": "Confirmed facts · ", "已被下一版命题替代(版本留着,不参与当前推理)": "superseded by a later version of the proposition (the version is kept but takes no part in current reasoning)", "已裁决": "decided", "已评估": "evaluated", "已达成": "achieved", "已达门槛(": "threshold reached (", "已达门槛,已升格为事实": "threshold reached; promoted to fact", "已采纳": "adopted", "待开计划": "no plan yet", "待推进": "to advance", "待裁决": "awaiting decision", "我的 · ~/.dsh": "Mine · ~/.dsh", "打开 ": "Open ", "打开「事实」那一格并展开这条命题": "Open the Facts pane and expand this proposition", "打开世界树并选中产出这条事实的验证步": "Open Worldlines and select the verification step that produced this fact", "打开世界树并选中产生这条证据的验证步": "Open Worldlines and select the verification step that produced this evidence", "打开失败:HTTP ": "Open failed: HTTP ", "打开计划文档(原生预览)": "Open the plan document (native preview)", "技能 · 记忆": "Skills · Memory", "把这道裁决摆到原生提问卡上(带你读到的判据与各分支读数)": "Put this decision on the native question card (carrying the criterion you read and each branch's reading)", "探索中": "exploring", "推翻": "refute", "推进中": "in progress", "提交中…": "Submitting…", "提交失败:": "Submit failed: ", "支持": "support", "支持到 ": "supported to ", "收敛": "converge", "收束:": "Closed with: ", "收起": "Collapse", "收起详情": "Collapse details", "放弃了这次探索": "abandoned this exploration", "放弃探索": "Abandon exploration", "放弃缘由(必填)": "Reason for abandoning (required)", "放弃要留痕:先写缘由": "Abandoning leaves a record: write the reason first", "放弃要留痕:点一下写缘由,写了才能提交": "Abandoning leaves a record: click to write the reason; it must be written before submitting", "放弃这条分叉": "Abandon this fork", "放弃这次探索(留档不删,ref 保留)": "Abandon this exploration (kept on record, ref preserved)", "放行": "release", "旁观写这条裁决的评估者子会话(论证过程)": "Observe the evaluator sub-session that wrote this verdict (the reasoning process)", "旁观评估者": "Observe evaluator", "旁观这条世界线的评估者会话(只读)": "Observe this worldline's evaluator session (read-only)", "无法判定": "inconclusive", "是目录(不算物证)": "is a directory (not physical evidence)", "最后改动 ": "Last changed ", "有了第一条证据": "the first piece of evidence arrived", "有人在等你": "someone is waiting on you", "未分类": "Uncategorised", "未声明": "not declared", "未收口(随步骤作废而终止)": "not closed (ended when its step was voided)", "未知": "unknown", "未走:": "Not taken: ", "未采纳": "not adopted", "本会话 模型 ": "This session — model ", "本体声明还没随投影下发,这里用的是规范闭环的镜像;会话跑过一拍后会自动对齐声明。": "The ontology declaration has not reached the projection yet; this shows a mirror of the canonical loop and will align with the declaration after one more step.", "本项目 · .dsh / .agents": "This project · .dsh / .agents", "本项目写的 · clear/skills": "Written by this project · clear/skills", "核心产物(": "Core deliverables (", "步 ": "step ", "没正常结束": "did not finish cleanly", "没送出去:": "Not sent: ", "派出 ": "dispatched ", "派生 · ": "derived · ", "点一条 → 右栏预览": "Click one → preview on the right", "点一行看细节": "Click a row for detail", "点开看这一步的细节": "Click to see this step's detail", "版本": "Version", "状态": "Status", "独立评估者": "independent evaluator", "用原生提问卡决定": "Decide with the native question card", "用原生预览打开章程(它每回合整份注入模型上下文)": "Open the charter in the native preview (it is injected whole into the model's context every turn)", "用提问卡决定": "Decide with a question card", "盘上已有(": "Already on disk (", "盘上没有": "not on disk", "盘上没有这个文件": "this file is not on disk", "目录": "directory", "目录还没到(内核下一次 pre-step 会发)": "The catalogue has not arrived yet (the kernel sends it on the next pre-step)", "目录里已经没有(": "no longer in the catalogue (", "目标": "Goal", "目标挂起": "goal suspended", "看评估者": "view evaluator", "看这一步的证据": "See the evidence for this step", "确认放弃": "Confirm abandon", "确认放弃(留档不删,ref 保留)": "Confirm abandon (kept on record, ref preserved)", "等人或等世界线": "waiting on a person or a worldline", "等你说一句话": "waiting for a word from you", "等独立裁决": "waiting for an independent verdict", "策略暂停": "paused by policy", "策略暂停(理由没记下,已在日志里告警)": "paused by policy (no reason recorded; a warning was logged)", "算术推荐这条": "arithmetic recommends this one", "续跑:多问我——每个阶段收尾就停下,等你给下一阶段(文档里叫「人在场」)。点一下切成「自己拿主意」。": "Continuation: ask me more — it stops at the end of each stage and waits for you to give the next one (called \"attended\" in the docs). Click to switch to \"decide for yourself\".", "续跑:自己拿主意——立约即授权,按轮数自己往下跑,只在不可约的判断上开门(文档里叫「无人值守」)。点一下切成「多问我」。": "Continuation: decide for yourself — committing a plan is the authorisation, and it keeps going for a set number of rounds, opening a gate only for decisions it cannot reduce (called \"unattended\" in the docs). Click to switch to \"ask me more\".", "续跑停着:": "Continuation is stopped: ", "续跑已撤回": "Continuation was withdrawn", "缘由必填": "A reason is required", "缺": "missing", "能用的在上面,正在验的在下面": "What you can use is on top; what is still being verified is below", "自判": "self-judged", "自定义": "custom", "自己拿主意": "Decide for yourself", "被 ": "by ", "被下一版命题改写": "rewritten by a later version of the proposition", "裁决": "Verdict", "裁决:采纳 ": "Verdict: adopt ", "要你": "needs you", "观测": "Observation", "计划": "Plan", "计划 ": "Plan ", "计划受阻,等人处置": "plan blocked, waiting for a person", "计划在建,**等你确认**": "plan is being built, **waiting for your confirmation**", "计划已交付 ": "Plan delivered ", "计划已收尾(": "Plan closed (", "计划待确认": "plan awaiting confirmation", "计划文档": "Plan document", "计划的拓扑与闸门:脊柱、叉开的车道、收在哪、要你拍哪一下": "The plan's topology and gates: the spine, the lanes that branch off, where it converges, and where you have to decide", "让内核跑 ConvergeFork 落实它(合并是内核的活)": "Let the kernel run ConvergeFork to apply it (merging is the kernel's job)", "记忆(": "Memory (", "记忆索引": "Memory index", "证据": "Evidence", "证据 ": "Evidence ", "评 ": "E", "评估": "Evaluation", "评估卡": "evaluation card", "评估者": "Evaluator", "评估者 ": "Evaluator ", "评估者会话 ": "Evaluator session ", "评估者在裁决": "an evaluator is deciding", "说一句话就行 —— ": "Just say a word — ", "读不到交付物:": "Cannot read deliverables: ", "读取中…": "Reading…", "读数": "Reading", "读数(尺子 ": "Reading (metric ", "起过 ": "ran ", "跑着": "running", "车道 · ": "Lane · ", "边界:": "Scope: ", "达门槛且无推翻的命题,会在**目标验收**时由系统升格为事实(写在 clear/knowledge/facts/,模型读的 INDEX.md 同步)。": "A proposition that reaches the threshold with no refutation is promoted to fact by the system when the **goal is accepted** (written under clear/knowledge/facts/, with the INDEX.md the model reads kept in sync).", "运行时注册": "registered at runtime", "还有 ": "and ", "还没交付": "not delivered yet", "还没有命题。人与模型都可以提出:每条要有一句话主张与一句「什么结果会推翻它」;通过验证的会升格到上面的事实货架。": "No propositions yet. Both the person and the model can raise one: each needs a one-line claim and a line saying what result would refute it; those that pass verification are promoted to the fact shelf above.", "还没有目标。目标带一份「怎样算回答了」的判据——判据在结果出现之前写下,由系统强制。": "No goal yet. A goal carries a criterion for what would count as an answer — written before any result appears, and enforced by the system.", "还没有目标。立约并验证之后,达门槛且无推翻的命题会在目标验收时升格为事实。": "No goal yet. After you commit a plan and verify it, propositions that reach the threshold with no refutation are promoted to fact when the goal is accepted.", "还没有计划,所以还没有产物。立目标、建计划,交付过的每一步都会在这里按阶段排开。": "No plan yet, so no deliverables. Set a goal and build a plan; every step you deliver will line up here by stage.", "还没有计划。计划立起来之后,这里画的是它的拓扑:脊柱上的步、叉开的车道、收在哪。": "No plan yet. Once one is committed, this draws its topology: the steps on the spine, the lanes that branch off, and where it converges.", "还没有记忆。": "No memory yet.", "还没有证据:先登记判据,再验证": "No evidence yet: register the criterion first, then verify", "这一步已作废(缘由:": "This step was voided (reason: ", "这一步没有声明产物。": "This step declares no artifacts.", "这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示工作区的技能目录与记忆。": "This session has not started: the panels read the session log, so after your first message this will show the workspace's skill catalogue and memory.", "这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示已确认的事实与正在流转的命题。": "This session has not started: the panels read the session log, so after your first message this will show confirmed facts and the propositions in flight.", "这个会话还没有 ClearAI 的状态。": "This session has no ClearAI state yet.", "这个工作区盘上已经有 ": "This workspace already has ", "这个工作区里还没有技能或记忆:用一次 `SaveSkill` 或 `WriteMemory`,或把技能放进 `clear/skills/`。": "This workspace has no skills or memory yet: use `SaveSkill` or `WriteMemory` once, or put a skill under `clear/skills/`.", "这是系统对自己说的话(我们自己按的暂停 / 人清掉的窗口),不是运行档": "This is the system talking to itself (a pause we pressed, or a window a person cleared) — not a run mode", "进度": "Progress", "采纳": "Adopt", "采纳 ": "Adopt ", "采纳:改写 frontmatter,模型从此加载得到它": "Adopt: rewrites the frontmatter so the model can load it from then on", "采纳了某条世界线": "adopted one worldline", "采纳此世界线": "Adopt this worldline", "问题:": "Question: ", "阶段": "Stage", "阶段 ": "Stage ", "阶段交界": "at a stage boundary", "需要你 ": "needs you ", "面板动作失败:": "Panel action failed: ", "项目章程": "Project charter", "预设自带": "shipped with the preset", "验证": "Verification", "验证中": "verifying", "这次采纳没有合并:": "This adoption was not merged: ", "(决定已登记,产物由一次普通交付落位)": " (the decision is on record; a normal delivery places the artifacts)", "分支或工作副本已不在": "its branch or working copy is gone"}

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
		 * (`slots` 是平台 seed,启动时就有),而 `sessions` / `sidebarRightTabs` 是**后来**
		 * 才由各自的插件 `provide` 的。只声明 `slots` 的话,我们的 `apply()` 会在它们之前跑,
		 * 读不到会话服务 → 早退 → **一个插座都不注册**,而且不报错:右栏只剩宿主自带的「文件」,
		 * 中栏没有「产物」。宿主那侧一切正常(模块图里有我们、bundle 正常送达),
		 * 所以这个 bug 只在浏览器里看得见——单测里的假 ctx 恰好把两个服务都给了,于是全绿。
		 *
		 * 声明之后 Cordis 会把插件**挂起**到这些服务就位再激活(原生插件同样是这么写的,
		 * 例如 `dsh-client-ui-sidebar-files` 声明 slots + sidebarRightTabs + remote + locale)。
		 */
		const inject = ['slots', 'sessions', 'sidebarRightTabs', 'sidebarRight']

		const PHASE = lazyTable(() => ({
			drafting: t('判据待写'),
			planning: t('待开计划'),
			executing: t('推进中'),
			waiting: t('等人或等世界线'),
			stage_boundary: t('阶段交界'),
			auditing: t('评估者在裁决'),
			stalled: t('停摆等人'),
			suspended: t('目标挂起'),
			achieved: t('已达成'),
			abandoned: t('已放弃'),
			superseded: t('已改版'),
		}))
		const HYPOTHESIS = lazyTable(() => ({
			proposed: t('已提出'),
			alive: t('验证中'),
			confirmed: t('已确认'),
			/** 规范词是「已替代」(与验证本体同词);「已改版」是旧写法。 */
			refuted: t('已推翻'),
			superseded: t('已替代'),
			retracted: t('已撤回'),
		}))
		const STEP = lazyTable(() => ({ open: t('待推进'), advanced: t('已交付'), void: t('已作废') }))
		const VERDICT = lazyTable(() => ({ support: t('支持'), refute: t('推翻'), inconclusive: t('无法判定') }))
		const EVALUATOR = lazyTable(() => ({ self: t('自判'), independent: t('独立评估者') }))
		const BRANCH_STATUS = lazyTable(() => ({ exploring: t('探索中'), evaluated: t('已评估'), adopted: t('已采纳'), pruned: t('未采纳') }))
		/** 人在面板上做过的裁决(树详情里要如实回放:谁、以什么理由)。 */
		const FORK_ACTION = lazyTable(() => ({ adopt_branch: t('采纳了某条世界线'), abandon_fork: t('放弃了这次探索') }))
		/** 侦察的三种结局(与 fold 的派生同源):跑着 / 正常回灌 / 没正常结束。 */
		const SCOUT = lazyTable(() => ({ running: t('跑着'), settled: t('已回灌'), failed: t('没正常结束') }))

		const STRONG = { refuted: true, stalled: true, refute: true }

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
`
		/** 把上面那段 CSS 挂进页面(带 data-plugin 标记,宿主按包名记账,卸载时收掉)。 */
		function installStyles() {
			if (typeof document === 'undefined') return () => {}
			const existing = document.querySelector('style[data-plugin="clearai-dsh"]')
			if (existing !== null) return () => {}
			const tag = document.createElement('style')
			tag.dataset.plugin = 'clearai-dsh'
			tag.textContent = CSS
			document.head.append(tag)
			return () => {
				tag.remove()
			}
		}

		// ── 样式:颜色一律用主题令牌(--dsw-alias-*),不写死色值 ─────────────────
		const S = {
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
		}

		/** 密集列表里用的那一档按钮(11px 圆角)。 */
		function Chip(props) {
			return h('button', { type: 'button', className: 'clearai-chip', disabled: props.disabled === true, title: props.title, onClick: props.onClick }, props.children)
		}
		/** 可点的文本(替代裸下划线 span)。 */
		function Link(props) {
			return h('span', { className: 'clearai-link', title: props.title, onClick: props.onClick }, props.children)
		}

		/**
		 * 读一个面板自己的 HTTP 响应。
		 *
		 * 为什么不能直接 `response.json()`:那条路上失败时返回的是**纯文本**
		 * (`connection` 层查不到 exact fetch route 就回 `404 "not found"`),
		 * 直接 parse 会抛出 `Unexpected token 'o', "not found" is not valid JSON`
		 * ——人看到的是解析器的抱怨,不是发生了什么。
		 * 这里统一成 `{ ok, status, payload, error }`,`error` 里带上状态码与原文。
		 */
		const readResponse = async (response) => {
			const text = await response.text()
			let payload = null
			try {
				payload = text === '' ? null : JSON.parse(text)
			} catch {
				payload = null
			}
			if (payload !== null && payload.ok === true) return { ok: true, status: response.status, payload, error: null }
			const reason = payload !== null && typeof payload.error === 'string' ? payload.error : `${response.status} ${text.slice(0, 80)}`.trim()
			return { ok: false, status: response.status, payload, error: reason }
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
		 * **目标那一行**:世界树页眉用。只放事实(主张 · 判据 · 阶段与完成度),
		 * 详情(结算单、推进次数)在各处自己的面上——页眉不该变成第二份面板。
		 */
		function GoalLine(props) {
			const goal = props.goal
			if (goal === null || goal === undefined) return null
			return h(
				'div',
				{ style: { ...S.rowFirst, ...S.inline } },
				h('span', null, dash(goal.claim)),
				// 阶段与完成度归**状态条**(常驻可见)⇒ 这里不重复(两处说同一件事 = 冗余)
				// 判据常常是五条清单(真数据里 ~400 字 ✗)⇒ 页眉只放一句,全文进 tooltip(页眉只放一句)
				h('span', { style: S.faint, title: String(goal.doneCriteria ?? '') }, `${t('判据:')}${brief(goal.doneCriteria, 56)}`),
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
			release: t('放行'),
		}))

		/**
		 * 命题的分组 = **本体声明的五个状态**,顺序即认识论的顺序。
		 *
		 * 用词有权威出处:[`docs/verification-loop.md`](../docs/verification-loop.md) 的状态表
		 * (那份文档明说「其他文档、提示词与代码注释提到这些概念时,以这里的叫法为准」)。
		 * 界面因此不另造一套产品词——「已确认」的命题不在这一列:它已经**升格为事实**,在事实货架上。
		 */
		const PROPOSITION_GROUPS = lazyTable(() => ([
			{ status: 'proposed', label: t('已提出') },
			{ status: 'alive', label: t('验证中') },
			{ status: 'refuted', label: t('已推翻') },
			{ status: 'superseded', label: t('已替代') },
			{ status: 'retracted', label: t('已撤回') },
		]))

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
		 * 一条命题的证据。链是**证据 → 步骤 → 命题**(`evidence.stepId` → `step.tests.hypothesis`),
		 * 与原始设计 `evidenceForHypothesis` 同一条链:证据挂在步骤上,不直接挂在命题上。
		 */
		function evidenceOf(data, hypothesisId) {
			/**
			 * 走**跨计划**的步骤索引:命题的验证步常常留在**已收尾的旧计划**里
			 * (真数据:两条计划,`tests` 全在旧的那条上)⇒ 只查活动计划会全断,
			 * 面板上五个命题的证据与判者全是「—」。索引由折法派生,不新增存储。
			 */
			const index = data?.stepIndex ?? {}
			const steps = new Set(
				Object.entries(index)
					.filter(([, meta]) => meta?.tests?.hypothesis === hypothesisId)
					.map(([stepId]) => stepId),
			)
			return (data?.evidence ?? []).filter((item) => steps.has(item.stepId)).slice().sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
		}

		/**
		 * 一条证据的**出处**。分两层:
		 *
		 *   ① **记账时定下的 `origins` 优先** —— 四类入口(产物 / 评估卡 / 评估者子会话 / 人放行)
		 *      是内核在写证据那一刻解析好的事实,界面只渲染;
		 *   ② 旧日志没有 `origins` 时走**只读回退**:材料 id → 材料表里的路径,换不出来的**丢掉** ——
		 *      绝不把裸 id 渲染成"能点"的样子(失效模式:整排出处因此点不开)。
		 */
		const ORIGIN_LABEL = lazyTable(() => ({ 'audit-card': t('评估卡'), 'evaluator-session': t('看评估者'), 'approval-record': t('审批记录') }))
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
				if (audit?.evaluatorSession !== null && audit?.evaluatorSession !== undefined) out.push({ kind: 'evaluator-session', label: t('看评估者'), session: String(audit.evaluatorSession) })
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

		/** 一条证据一句话:`e-1 · L2 · 支持 · 自判 · 依据… · 出处`。 */
		function evidenceLine(data, item) {
			return h(
				'div',
				{ key: item.id, style: S.evRow },
				h('span', { style: S.evHead }, `${item.id} · ${dash(item.level)} · ${gloss(VERDICT, item.verdict)} · ${gloss(EVALUATOR, item.evaluator)}`),
				h('span', { style: S.evBasis, title: String(item.basis ?? '') }, brief(item.basis, 160)),
				...originsOf(data, item).map((origin, index) => {
					/**
					 * 四类入口各自的去处:
					 *   产物 / 评估卡 → 右侧**原生预览**打开那个文件;
					 *   看评估者      → 旁观**评估者子会话**(论证过程在里面,harness 原生能力);
					 *   审批记录      → 没有文件(原生审批对在会话日志里),如实说明它凭什么不可伪造。
					 */
					const open =
						origin.kind === 'evaluator-session'
							? origin.session === null || data.openSpectator === undefined
								? undefined
								: () => data.openSpectator(origin.session)
							: origin.path === null || data.openPreview === undefined
								? undefined
								: () => data.openPreview(origin.path)
					const title =
						origin.kind === 'evaluator-session'
							? t('旁观写这条裁决的评估者子会话(论证过程)')
							: origin.kind === 'approval-record'
								? `${t('会话日志里的原生审批对(不可伪造)')}${origin.call === null ? '' : ` · ${origin.call}`}`
								: (origin.path ?? '')
					return h(
						'span',
						{
							key: `${item.id}-${origin.label}-${index}`,
							style: open === undefined ? S.faint : S.fileLink,
							onClick:
								open === undefined
									? undefined
									: (event) => {
											event?.stopPropagation?.()
											open()
										},
							title,
						},
						origin.label,
					)
				}),
			)
		}

		/** 当前处境一句话:这是这一格存在的理由——用户要知道「现在能不能当真」。 */
		function whereOf(data, row) {
			const evidence = evidenceOf(data, row.id)
			const threshold = data?.goal?.promoteAtLevel ?? 'L3'
			const refute = evidence.find((item) => item.verdict === 'refute')
			if (row.status === 'refuted') return refute === undefined ? t('出现推翻证据(终态,记录保留)') : `${t('被 ')}${refute.id}${t(' 推翻:')}${brief(refute.basis, 56)}`
			if (row.status === 'superseded') return t('已被下一版命题替代(版本留着,不参与当前推理)')
			if (row.status === 'confirmed') return t('已达门槛,已升格为事实')
			if (row.status === 'retracted') return t('人已撤回(记录保留)')
			if (row.supportedLevel === null || row.supportedLevel === undefined) return t('还没有证据:先登记判据,再验证')
			if (levelRank(row.supportedLevel) >= levelRank(threshold)) return `${t('已达门槛(')}${row.supportedLevel}${t('),等目标验收时升格为事实')}`
			return `${t('支持到 ')}${row.supportedLevel}${t(':还差 ')}${threshold}${t('(要独立评估)才达门槛')}`
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

		/** 一条事实的证据落在哪份计划里:多份计划各有自己的世界树,跳过去时要切到那一份。 */
		function rowPlanOf(data, fact) {
			for (const id of fact?.evidenceIds ?? []) {
				const item = (data?.evidence ?? []).find((entry) => entry.id === id)
				if (typeof item?.planId === 'string' && item.planId !== '') return item.planId
			}
			return null
		}

		/** 右侧那一列:最有力的一条证据给出的**等级 · 判者**——这就是「多可信」。 */
		function judgeOf(data, row) {
			const evidence = evidenceOf(data, row.id)
			const best = evidence.slice().sort((a, b) => levelRank(b.level) - levelRank(a.level))[0]
			return best === undefined ? '—' : `${dash(best.level)} · ${gloss(EVALUATOR, best.evaluator)}`
		}

		/** 实际**走过**的转移(不画未走的岔路:那是过程知识,不是「我现在能信什么」)。 */
		function transitionsOf(data, row) {
			const evidence = evidenceOf(data, row.id)
			const out = []
			/**
			 * `to` 一律用**声明里的原始状态键**(`alive` / `refuted` …),不做翻译——
			 * 翻译只在渲染时做。混用两套键是踩过的坑:流转图按原始键查「这一跳走没走过」,
			 * 而这里返回的是中文字面 ⇒ 命不中 ⇒ 走过的边全被画成"没走"。
			 */
			if (evidence.length > 0) {
				const first = evidence[0]
				out.push({ to: 'alive', on: t('有了第一条证据'), by: `${first.id} · ${dash(first.level)} ${gloss(VERDICT, first.verdict)}`, independent: first.evaluator === 'independent' })
			}
			if (row.status === 'refuted') {
				const refute = evidence.find((item) => item.verdict === 'refute')
				out.push({
					to: 'refuted',
					on: t('出现推翻证据'),
					by: refute === undefined ? '—' : `${refute.id} · ${gloss(EVALUATOR, refute.evaluator)}`,
					independent: refute !== undefined && refute.evaluator === 'independent',
				})
			}
			if (row.status === 'superseded') out.push({ to: 'superseded', on: t('被下一版命题改写'), by: row.version > 1 ? `v${row.version}` : '—', independent: false })
			if (row.status === 'retracted') out.push({ to: 'retracted', on: t('人审查后决定撤回'), by: '—', independent: false })
			return out
		}

		/**
		 * 流转图的**固定布局**(产品面,不是通用图布局器)。
		 *
		 * 主干一行(左→右):已提出 → 验证中 → 已确认;终态分支挂在下面一行。
		 * 这样无论声明有没有下发、有几条边,**横向主干都在** —— 不会退化成竖排。
		 * 声明下发后,边的 `on` / `actor` 从声明取(未走的边据此写清"这件事叫什么、谁发起");
		 * 声明还没下来的旧会话,用规范闭环的安全镜像,并在标题里如实标注。
		 */
		const FLOW_LAYOUT = {
			nodeW: 112,
			nodeH: 30,
			width: 600,
			height: 152,
			trunkY: 20,
			branchY: 100,
			place: {
				proposed: { x: 16, y: 20 },
				alive: { x: 166, y: 20 },
				confirmed: { x: 316, y: 20 },
				refuted: { x: 166, y: 100 },
				superseded: { x: 316, y: 100 },
				retracted: { x: 466, y: 100 },
			},
			/** 声明缺失时的规范镜像:只用来画图,标题会说明它不是实时声明。 */
			fallbackEdges: [
				['proposed', 'alive', 'system', 'evidence_appended'],
				['alive', 'confirmed', 'system', 'promotion_threshold'],
				['alive', 'refuted', 'system', 'refuting_evidence'],
				['proposed', 'superseded', 'model', 'hypothesis_revised'],
				['confirmed', 'retracted', 'human', 'retraction_request'],
			],
		}

		/**
		 * **流转图**:横向主干 + 分支的 SVG 状态机。
		 *
		 * 三条着色规矩(与世界树同一套视觉语言):
		 *   · **走过的边**:实线 + 颜色(独立裁决用品牌强调色、自判用前景色),旁边写清触发与凭据;
		 *   · **当前态**:品牌色描边 + 呼吸光环,并在节点上写「当前」;
		 *   · **没走的边**:虚线 + 低饱和,写明「这件事 · 谁发起」。
		 */
		function StateFlow(props) {
			const { data, row } = props
			const spec = (data?.ontology?.objects ?? []).find((object) => object.name === 'hypothesis') ?? null
			const declared = Array.isArray(spec?.edges) && spec.edges.length > 0 ? spec.edges : null
			const edges = declared ?? FLOW_LAYOUT.fallbackEdges
			const path = transitionsOf(data, row)
			const taken = new Map(path.map((step) => [step.to, step]))
			const current = row.status
			const L = FLOW_LAYOUT
			const items = []
			for (const [from, to, actor, on] of edges) {
				const a = L.place[from]
				const b = L.place[to]
				if (a === undefined || b === undefined || from === to) continue
				const step = taken.get(to)
				const done = step !== undefined
				const color = done ? (step.independent === true ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)') : 'var(--dsw-alias-border-l2)'
				const horizontal = a.y === b.y && b.x > a.x
				const x1 = horizontal ? a.x + L.nodeW : a.x + L.nodeW / 2
				const y1 = horizontal ? a.y + L.nodeH / 2 : a.y + L.nodeH
				const x2 = horizontal ? b.x : b.x + L.nodeW / 2
				const y2 = horizontal ? b.y + L.nodeH / 2 : b.y
				const midY = (y1 + y2) / 2
				items.push(
					h(
						'path',
						{
							key: `edge-${from}-${to}`,
							d: horizontal ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`,
							fill: 'none',
							stroke: color,
							strokeWidth: done ? 2 : 1,
							strokeDasharray: done ? undefined : '4 3',
						},
						h(
							'title',
							null,
							done ? `${step.on} · ${step.by}` : `${t('未走:')}${on ?? to} · ${actor ?? '?'}${t(' 发起')}`,
						),
					),
				)
				const label = done ? `${step.by.split(' · ')[0]} · ${step.by.split(' · ')[1] ?? ''}`.trim() : ''
				if (label !== '') {
					items.push(
						h(
							'text',
							{
								key: `label-${from}-${to}`,
								x: horizontal ? (x1 + x2) / 2 : x2 + 5,
								y: horizontal ? y1 - 7 : midY - 4,
								textAnchor: horizontal ? 'middle' : 'start',
								fontSize: 9.5,
								fill: color,
							},
							label,
						),
					)
				}
			}
			for (const [state, position] of Object.entries(L.place)) {
				const reached = state === 'proposed' || taken.has(state)
				const isNow = state === current
				items.push(
					h('rect', {
						key: `node-${state}`,
						x: position.x,
						y: position.y,
						width: L.nodeW,
						height: L.nodeH,
						rx: L.nodeH / 2,
						fill: isNow ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
						stroke: isNow ? 'var(--dsw-alias-brand-primary)' : reached ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-border-l2)',
						strokeWidth: isNow ? 2 : 1,
						strokeDasharray: reached || isNow ? undefined : '4 3',
						className: isNow ? 'clearai-breathe-stroke' : undefined,
					}),
				)
				items.push(
					h(
						'text',
						{
							key: `text-${state}`,
							x: position.x + L.nodeW / 2,
							y: position.y + L.nodeH / 2 + 4,
							textAnchor: 'middle',
							fontSize: 11,
							fill: isNow ? 'var(--dsw-alias-brand-primary)' : reached ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
						},
						`${gloss(HYPOTHESIS, state)}${isNow ? ' · 当前' : ''}`,
					),
				)
			}
			/**
			 * 图下那几行**来路**:图上只标走过那一跳的证据 id(窄间距里读得清),
			 * 完整的「这件事叫什么 + 谁做的」写在这里 —— 图管结构,文字管凭据,各占各的地方。
			 */
			const walked = path.filter((step) => step.to !== 'retracted' || current === 'retracted')
			return h(
				'div',
				{ style: { margin: '4px 0 8px', maxWidth: '100%' } },
				h(
					'div',
					{ style: { overflowX: 'auto' } },
					h(
						'svg',
						{ width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}`, style: { display: 'block', minWidth: L.width } },
						...items,
					),
				),
				walked.length === 0
					? null
					: h(
							'div',
							{ style: { display: 'flex', flexDirection: 'column', gap: 1, marginTop: 2 } },
							...walked.map((step) =>
								h(
									'div',
									{ key: `walked-${step.to}`, style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
									`${step.on} → ${gloss(HYPOTHESIS, step.to)} · ${step.by}`,
								),
							),
						),
				declared === null
					? h('div', { style: { ...S.faint, fontSize: 11, marginTop: 2 } }, t('本体声明还没随投影下发,这里用的是规范闭环的镜像;会话跑过一拍后会自动对齐声明。'))
					: null,
			)
		}

		/**
		 * **命题行**:一行一条命题,默认只有主张 + 当前处境 + 等级判者。
		 * 点开才出现「凭什么」——流转图 + 每条证据的出处。
		 */
		function PropositionRow(props) {
			const { data, row, open, onToggle } = props
			const evidence = evidenceOf(data, row.id)
			const path = transitionsOf(data, row)
			return h(
				'div',
				{ style: open === true ? S.propOpen : S.propRow },
				h(
					'div',
					{ style: S.propHead, onClick: onToggle },
					h('span', { style: { ...S.propClaim, ...(row.status === 'refuted' || row.status === 'superseded' ? S.stale : {}) } }, dash(row.claim)),
					h('span', { style: S.propWhere }, whereOf(data, row)),
					h('span', { style: S.propJudge }, `${gloss(HYPOTHESIS, row.status)} · ${judgeOf(data, row)}`),
				),
				open === true
					? h(
							'div',
							{ style: S.propBody },
							h(StateFlow, { data, row }),
							evidence.length === 0 ? null : h('div', { style: S.evList }, ...evidence.map((item) => evidenceLine(data, item))),
							/**
							 * 图上那一跳的完整凭据(触发 + 判者 + 两个可点入口)。
							 * 这里**不再**摆本体文件路径:那是文档坐标,不是面板上的动作 ——
							 * 「这句话不用了」——人拍板删的。
							 */
							evidence.length === 0
								? null
								: h(
										'div',
										{ style: S.pathFoot },
										h(
											Link,
											{
												onClick: () => {
													const last = evidence[evidence.length - 1]
													treeFocus.set({ plan: last.planId ?? null, step: last.stepId, branch: last.branch ?? null })
													if (data.openRail !== undefined) data.openRail('clearai-worldtree')
												},
												title: t('打开世界树并选中产生这条证据的验证步'),
											},
											t('在世界树里看这一步'),
										),
									),
						)
					: null,
			)
		}

		/** **命题货架**:按本体状态分组;空组不出现。已确认的不在这里(它已升格为事实)。 */
		function PropositionShelf(props) {
			/**
			 * 打开器**自己接**(不靠外层注入):谁渲染这个货架,点证据/点事实都能开原件。
			 * 踩过的坑:只有最外层 `Facts` 注入 `openPreview` 时,单独渲染货架(测试缝、
			 * 以后的复用)会让整排出处看着能点、点了没反应。
			 */
			/**
			 * `props.X ?? 已有值`:外层 `Facts` 只传 `{data}`,而打开器在 `data` 里 ——
			 * 直接写 `openRail: props.openRail` 会用 `undefined` 把它盖掉 ⇒ 链接永不渲染 ✗(踩过的坑)。
			 */
			const base = props.data ?? (typeof props.useProjection === 'function' ? props.useProjection('clearai') : undefined) ?? {}
			const data = { ...base, openPreview: props.openPreview ?? base.openPreview, openRail: props.openRail ?? base.openRail, openSpectator: props.openSpectator ?? base.openSpectator }
			const rows = (data.goal?.hypotheses ?? []).filter((row) => row.status !== 'confirmed')
			const groups = PROPOSITION_GROUPS.map((group) => ({ ...group, rows: rows.filter((row) => row.status === group.status) })).filter((group) => group.rows.length > 0)
			return h(
				Section,
				{ title: `${t('命题 · ')}${rows.length}` },
				rows.length === 0
					? h('div', { style: S.faint }, t('还没有命题。人与模型都可以提出:每条要有一句话主张与一句「什么结果会推翻它」;通过验证的会升格到上面的事实货架。'))
					: h(
							'div',
							null,
							...groups.map((group) =>
								h(
									'div',
									{ key: group.status },
									h('div', { style: S.group }, group.label, h('span', { style: S.groupN }, String(group.rows.length))),
									...group.rows.map((row) => h(PropositionRow, { key: row.id, data, row, open: props.open === row.id, onToggle: () => props.onToggle(row.id) })),
								),
							),
						),
			)
		}

		/** **事实货架**:已确认、可作已知的那一层。每条都带边界——没有边界的事实没人敢用。 */
		function FactShelf(props) {
			const base = props.data ?? (typeof props.useProjection === 'function' ? props.useProjection('clearai') : undefined) ?? {}
			const data = { ...base, openPreview: props.openPreview ?? base.openPreview, openRail: props.openRail ?? base.openRail, openSpectator: props.openSpectator ?? base.openSpectator }
			const facts = data.facts ?? []
			return h(
				Section,
				{ title: `${t('已确认事实 · ')}${facts.length}`, mark: true },
				facts.length === 0
					? h(
							'div',
							{ style: S.faint },
							data.goal === null || data.goal === undefined
								? t('还没有目标。立约并验证之后,达门槛且无推翻的命题会在目标验收时升格为事实。')
								: t('达门槛且无推翻的命题,会在**目标验收**时由系统升格为事实(写在 clear/knowledge/facts/,模型读的 INDEX.md 同步)。'),
						)
					: h(
							'div',
							null,
							...facts.map((row) =>
								h(
									'div',
									{
										key: row.id,
										style: S.factRow,
										/** 这一格**就是**事实库:点这条事实开它的原件(右侧原生预览),不再另挂一个「打开事实库」。 */
										onClick: row.path === null || row.path === undefined || data.openPreview === undefined ? undefined : () => data.openPreview(row.path),
										title: row.path === null || row.path === undefined ? '' : `${t('打开 ')}${row.path}`,
									},
									h('div', { style: S.factClaim }, dash(row.text)),
									h(
										'div',
										{ style: S.factMeta, title: row.scope === null || row.scope === undefined ? '' : String(row.scope) },
										/**
										 * 边界和证据的「依据」是同一类字段 ⇒ **同一条规矩**:列表放摘要、全文进 tooltip。
										 * 真数据里边界常是 200~300 字,三条事实就把这一格撑到一千多字 ✗(货架只放摘要)。
										 */
										`${t('边界:')}${row.scope === null || row.scope === undefined || String(row.scope).trim() === '' ? '(未写——引用前请谨慎)' : brief(row.scope, 80)}${t(' · 支持到 ')}${dash(row.level)}${t(' · 证据 ')}${(row.evidenceIds ?? []).length}${t(' 条')}`,
										/**
										 * 原件的标签用**文件名**(「打开原件」四平八稳,但一排下来同样认不出是谁)。
										 */
										/**
										 * 整行已经可点开原件 ⇒ 不再挂一个同样动作的「事实存档」✗(同一动作不开两条路)。
										 * 原件路径在整行的 tooltip 里(`打开 <path>`)。
										 */
										/**
										 * 跳去它那一步。**不把 `openRail` 当成渲染前提** ——
										 * 把渲染前提挂在它上面,整条链接会一起消失。
										 * 拿不到 `openRail` 也照常渲染:点了至少把聚焦设上、并试一次原生切视图。
										 */
										stepOfFact(data, row) === null
											? null
											: h(
													Link,
													{
														onClick: (event) => {
															event?.stopPropagation?.()
															treeFocus.set({ plan: rowPlanOf(data, row), step: stepOfFact(data, row), branch: null })
															if (data.openRail !== undefined) data.openRail('clearai-worldtree')
														},
														title: t('打开世界树并选中产出这条事实的验证步'),
													},
													t('在世界树里看这一步'),
												),
									),
								),
							),
						),
			)
		}

		/**
		 * **「事实」页签**:一个**知识货架**,不是机制说明页。
		 *
		 * 上架 = 已确认事实(可用作下一轮已知,按支持等级分级、每条带边界);
		 * 下架 = 命题(人与模型提出的候选知识,按本体状态分组流转)。
		 * 默认只回答一个问题:「我现在能信什么」;点开一条命题才回答「凭什么」。
		 */
		function Facts(props) {
			// 取数与 Panel/Deliverables 同一姿势:宿主半的会话投影单元 `clearai` 由插座作为标准 prop 交下来。
			const projected = typeof props.useProjection === 'function' ? props.useProjection('clearai') : undefined
			const [manual, setManual] = React.useState(null)
			const incoming = useFocus(factsFocus)
			if (projected === undefined || projected === null) {
				return h('div', { style: S.wrap }, h('div', { style: S.bar }, h('span', { style: S.title }, t('事实'))), h(Empty, null, t('这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示已确认的事实与正在流转的命题。')))
			}
			const data = { ...projected, openPreview: props.openPreview, openRail: props.openRail, openSpectator: props.openSpectator }
			const facts = data.facts ?? []
			const propositions = (data.goal?.hypotheses ?? []).filter((row) => row.status !== 'confirmed')
			/** 外面点进来的聚焦优先;手动点行仍然有效(聚焦为 null 时用它)。 */
			const focused = incoming === null || incoming === undefined ? null : propositionForStep(data, incoming.step)
			const open = focused ?? manual
			return h(
				'div',
				{ style: S.wrap },
				h(
					'div',
					{ style: S.bar },
					h('span', { style: S.title }, t('事实')),
					/**
					 * 页眉只说这一格是干什么的:计数在下面两段的标题里(同屏四个数字两两重复 = 噪声),
					 * 「模型读的是同一张表」是实现保证、不是用户信息 ✗。
					 */
					h('span', { style: S.faint }, t('能用的在上面,正在验的在下面')),
				),
				h(FactShelf, { data }),
				h(PropositionShelf, {
					data,
					open,
					onToggle: (id) => {
						// 手动点行:先清掉外面的聚焦(否则它一直压着手动选择,点了没反应 ✗)
						factsFocus.set(null)
						setManual(open === id ? null : id)
					},
				}),
			)
		}

		/**
		 * 「点开看」的目标:每个会话一份的小状态。
		 *
		 * 它只是**界面状态**(点了哪一条),不是事实——事实仍然只有投影与读面两个来源。
		 * 预览页签**第一次用到时才注册**:宁可少一张页签,也不放一张空的在那里。
		 */
		/**
		 * 打开 DSH **原生**的文档预览。
		 *
		 * 第一性原理:预览是「把一条路径渲染成人能看的东西」——而宿主已经有这件东西了,而且比我们全:
		 * `dsh-client-ui-sidebar-documentpreview` 注册了 **6 个实现**(text / markdown / html / image /
		 * pdf / code),自己按地址认领标签、自己按后缀挑实现、自己分页读盘。我们原来那套
		 * `<pre>` + 自己写读面,等于**把同一件事做第二遍,而且只做出了其中一种**(把 md 显示成源码、
		 * 根本打不开图)。
		 *
		 * 奥卡姆:不新造渲染器,也不新造读面——只按原生约定的地址把文件**递给**它:
		 *   `dsh-resource://file/session/<sessionId>/<逐段编码的路径>`
		 * (地址语法与编码规则照抄 `workspace-path/file-address`:`/#?` 之前、按 `/` 分段、逐段解码。)
		 * 路径是绝对路径时,分段里会自然出现一个空段,拼回来仍是绝对路径——原生就是这么分的。
		 *
		 * **第二参是会话 id,不是路径**(传错会直接读空):读面按它查工作区根
		 * (`workspaceFileScope`),拿错了就原样报
		 * `lookup provider "workspaceFileScope" did not resolve the requested identity`。
		 * 谁调用谁负责给对 —— 见 `apply` 里的 `openPreviewFor`,按**座位自己的** props 定型。
		 */
		/** 时间戳 → 「YYYY-MM-DD HH:mm」。与宿主半卡片里的写法一致:同一份事实在两处长得不一样,人就会怀疑其中一处。 */
		const stampOf = (value) => (typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') : t('未知'))

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
		 * 产物视图(中栏第一眼该看「我拿到了什么」)。
		 *
		 * 数据走宿主读面(`/api/clearai/deliverables`):交付物的**存在性是文件系统事实**,
		 * 浏览器读不了盘,所以由宿主在请求时即时 stat(顺带给出字节与修改时间)。
		 * 投影一变(推进了一步、多了一条证据)就重新取一次——面板不许比状态慢一拍。
		 *
		 * 这条读面回**两半**,这一栏也画两半:
		 *   · `stages`  = **声明**(计划里写了要交什么、谁验的、盘上在不在);
		 *   · `outputs` = **实际**(products/ 底下真有、但没有任何计划声明过的)。
		 * 为什么两半都要:在一个已经有产物的老项目里开新会话,原来这一栏
		 * 只有「阶段 0 · 交付 0/0」—— 可人此刻问的是「我拿到了什么」,盘上那份 46 KB 的 HTML
		 * 明明就在。声明与实际是两件事,少画一半就等于对着半张表回答。
		 */
		function Deliverables(props) {
			const data = typeof props.useProjection === 'function' ? props.useProjection('clearai') : undefined
			const sessionId = data === null || data === undefined ? null : data.sessionId
			const [stages, setStages] = React.useState(null)
			const [onDisk, setOnDisk] = React.useState([])
			const [error, setError] = React.useState(null)
			const stamp = data === null || data === undefined ? '' : `${data.plan?.id ?? ''}:${data.plan?.advancedCount ?? 0}:${data.plan?.totalCount ?? 0}:${(data.evidence || []).length}:${(data.facts || []).length}`
			React.useEffect(() => {
				if (typeof sessionId !== 'string' || sessionId === '') return
				let alive = true
				fetch(`/api/clearai/deliverables?sessionId=${encodeURIComponent(sessionId)}`)
					.then(readResponse)
					.then((result) => {
						if (!alive) return
						if (result.ok === true) {
							setStages(result.payload.stages ?? [])
							setOnDisk(result.payload.outputs ?? [])
						} else setError(result.error)
					})
					.catch((thrown) => {
						if (alive) setError(String(thrown?.message ?? thrown))
					})
				return () => {
					alive = false
				}
			}, [sessionId, stamp])

			const openStage = data === null || data === undefined ? null : data.plan
			// 点一条产物 → **原生预览**(md 渲染成 md、png 直接出图、html 直接看、pdf 用原生 pdf.js)
			const open = (path) => props.openPreview?.(path)
			if (sessionId === null) {
				return h('div', { style: S.wrap }, h('div', { style: S.bar }, h('span', { style: S.title }, t('产物'))), h(Empty, null, t('这个会话还没有 ClearAI 的状态。')))
			}
			const advanced = (stages ?? []).flatMap((stage) => stage.steps.filter((step) => step.status === 'advanced' && step.artifacts.length > 0))
			const delivered = advanced.reduce((sum, step) => sum + step.artifacts.filter((artifact) => artifact.exists).length, 0)
			const declared = (stages ?? []).flatMap((stage) => stage.steps).reduce((sum, step) => sum + step.artifacts.length, 0)
			/**
			 * 「核心产物」:**盘上真的在**的输出成果(products/),跨阶段汇总在最上面。
			 * 中间过程(lab/)不进这一栏——这正是 ClearAI 分类的用途:别让 100 个中间文件
			 * 淹没 3 份交付物。
			 */
			/**
			 * 「核心产物」= **一份文件一行**。
			 *
			 * 原先摊平的是「步骤 × 声明产物」这对组合 ⇒ 一个文件被几个步骤声明就出现几次 ✗
			 * (真数据:`qinrun-dipforming-3d.html` 被 build/verify-3d/rebuild/integrate 四步都声明了,
			 * 于是同一份 1153646 字节的文件列了四行,计数也跟着膨胀 ✗)。
			 * 「后面几步也声明了它」是**有用的信息**(那几步在验它、整合它),所以去重时把它收进 `steps`,
			 * 而不是丢掉。
			 */
			const byPath = new Map()
			for (const stage of stages ?? []) {
				for (const step of stage.steps) {
					for (const artifact of step.artifacts) {
						if (artifact.exists !== true) continue
						if (artifact.area?.key !== 'output' && artifact.area?.key !== 'other') continue
						const seen = byPath.get(artifact.path)
						if (seen === undefined) byPath.set(artifact.path, { ...artifact, stage: stage.plan, steps: [step.id] })
						else if (!seen.steps.includes(step.id)) seen.steps.push(step.id)
					}
				}
			}
			const coreOutputs = [...byPath.values()]
			/** 盘上已有的:不铺满一屏(它只是「第一眼」),但如实说还有多少没列。 */
			const ON_DISK_SHOWN = 25
			const shownOnDisk = onDisk.slice(0, ON_DISK_SHOWN)
			const hiddenOnDisk = onDisk.length - shownOnDisk.length
			const clickable = coreOutputs.length + onDisk.length
			return h(
				'div',
				{ style: S.wrap },
				h(
					'div',
					{ style: S.bar },
					h('span', { style: S.title }, t('产物')),
					/**
					 * 两个计数的**单位不同**,所以分开说:「处」= 步骤声明(一份文件被四步声明算四处),
					 * 「份」= 去重后的文件。混着写会让人以为盘上有四份。
					 */
					h('span', { style: S.faint }, `${t('阶段 ')}${(stages ?? []).length}${t(' · 交付 ')}${delivered}/${declared}${t(' 处声明')}${onDisk.length === 0 ? '' : ` · 盘上 ${onDisk.length} 份`}`),
					clickable === 0 ? null : h('span', { style: { ...S.faint, marginLeft: 'auto' } }, t('点一条 → 右栏预览')),
				),
				error !== null ? h('div', { style: S.faint }, `${t('读不到交付物:')}${error}`) : null,
				coreOutputs.length === 0
					? null
					: h(
							'div',
							{ style: S.section },
							h('div', { style: S.head }, `${t('核心产物(')}${coreOutputs.length})`),
							coreOutputs.map((artifact) =>
								h(
									'div',
									{ key: artifact.path, style: S.inline },
									h('span', { style: S.tagStrong }, artifact.area?.label ?? t('未分类')),
									h(Link, { onClick: () => open(artifact.path) }, h('span', { style: S.mono }, artifact.path)),
									h(
										'span',
										{ style: S.faint, title: artifact.steps.join(' · ') },
										`${artifact.bytes}${t(' 字节 · ')}${artifact.steps.length === 1 ? `步 ${artifact.steps[0]}` : `步 ${artifact.steps[0]} 等 ${artifact.steps.length} 步`}`,
									),
								),
							),
						),
				/**
				 * 「盘上已有」= 实际那一半。它**不进**交付计数(计数只认计划声明),
				 * 所以每条都带上这句交代,免得人以为计划多交了几份。
				 */
				onDisk.length === 0
					? null
					: h(
							'div',
							{ style: S.section },
							h('div', { style: S.head }, `${t('盘上已有(')}${onDisk.length})`),
							...shownOnDisk.map((item) =>
								h(
									'div',
									{ key: item.path, style: S.inline },
									h('span', { style: S.tag }, item.area?.label ?? t('未分类')),
									h(Link, { onClick: () => open(item.path) }, h('span', { style: S.mono }, item.path)),
									h('span', { style: S.faint }, `${item.bytes}${t(' 字节 · 未被任何计划声明')}`),
								),
							),
							hiddenOnDisk <= 0 ? null : h('div', { style: S.faint }, `${t('还有 ')}${hiddenOnDisk}${t(' 份没列出来(这一栏只列最近改动的 ')}${ON_DISK_SHOWN}${t(' 份)。')}`),
						),
				stages === null
					? h('div', { style: S.faint }, t('读取中…'))
					: stages.length === 0
						? h(
								Empty,
								null,
								onDisk.length === 0
									? t('还没有计划,所以还没有产物。立目标、建计划,交付过的每一步都会在这里按阶段排开。')
									: `${t('这个工作区盘上已经有 ')}${onDisk.length}${t(' 份产物,但没有任何计划声明过它们。点一条可以直接看(它们不计入交付)。')}`,
							)
						: stages.map((stage) =>
								h(
									'div',
									{ key: stage.plan, style: S.section },
									h(
										'div',
										{ style: S.head },
										// 「待确认」改成「授权记号未落账」:前者暗示有一道要人按的门,而门已经砍了——
										// 记号会在第一次交付时按事实补写(行为即授权)。
										`${openStage !== null && openStage.id === stage.plan ? '当前阶段 · ' : ''}${stage.plan} · ${dash(stage.status)}${stage.confirmedAt === null ? ' · 授权记号未落账(交付即落账)' : ''}`,
									),
									stage.brief === '' ? null : h('div', { style: S.faint }, stage.brief),
									stage.summary === null || stage.summary === undefined ? null : h('div', { style: S.faint }, `${t('收束:')}${stage.summary}`),
									stage.steps.map((step) =>
										h(
											'div',
											{ key: step.id, style: S.row },
											h(
												'div',
												{ style: S.inline },
												h('span', { style: step.status === 'advanced' ? S.tagStrong : S.tag }, gloss(STEP, step.status)),
												h('span', { style: S.mono }, `${step.ordinal}. ${step.id}`),
												step.level === null ? null : h('span', { style: S.faint }, step.level),
												h('span', null, step.do),
											),
											h('div', { style: S.faint }, `${t('判据:')}${step.doneCriteria}${step.voidReason === null || step.voidReason === undefined ? '' : `(作废:${step.voidReason})`}`),
											step.artifacts.length === 0
												? h('div', { style: S.faint }, t('这一步没有声明产物。'))
												: h(
														'div',
														null,
														step.artifacts.map((artifact) =>
															h(
																'div',
																{ key: artifact.path, style: S.inline },
																h('span', { style: artifact.exists ? S.tagStrong : S.tag }, artifact.exists ? t('在') : artifact.directory === true ? t('目录') : t('缺')),
																h('span', { style: S.faint }, artifact.area?.label ?? t('未分类')),
																/**
																 * 判据为「缺」的那条**不是链接**:点进去只会撞一个不存在的路径
																 * (原生预览会照实报错)。机制上不可点,胜过在文案里劝人别点。
																 * 它带来的信息仍然齐全:路径、分类、「盘上没有」。
																 */
																artifact.exists
																	? h('span', { className: 'clearai-link', onClick: () => open(artifact.path), title: t('在右栏预览') }, artifact.path)
																	: h(
																			'span',
																			{ style: S.mono, title: artifact.directory === true ? t('声明的是目录;准入要求具体文件——目录不算物证') : t('盘上没有这个文件') },
																			artifact.path,
																		),
																artifact.exists
																	? h('span', { style: S.faint }, `${artifact.bytes}${t(' 字节')}`)
																	: h('span', { style: S.faint }, artifact.directory === true ? t('是目录(不算物证)') : t('盘上没有')),
															),
														),
													),
										),
									),
								),
							),
			)
		}

		/**
		 * 世界树(右栏):计划即世界树——脊柱上一串步,到 fork 就地裂成并行车道,
		 * 收敛画成菱形,再回到同一条脊柱(git-graph 式)。
		 *
		 * 几何与**四条正交通道**照抄 ClearAI `PlanTree.tsx`(`ROW_H=30 / LANE_W=15 / NODE_R=6`):
		 * 行高固定 → 拓扑常驻不变;车道不移位 → 叉开与收敛看得清。四条通道各答一个问题、可任意叠加:
		 *
		 *   ① **填充**  已落定终局了吗      实心 = 是(于是「实心到哪儿就是做到哪儿」,进度成了一眼可读的形)
		 *   ② **颜色**  什么结局            绿=过/采纳 灰=待办/落选 蓝=在跑 琥珀=等你
		 *   ③ **光环**  此刻在动吗          呼吸 = 是(步骤与世界线共用同一惯用法)
		 *   ④ **分段**  被闸门裁断过几次    N>1 才分段,封顶 3 段,驳回的那几段画红
		 *
		 * 这一处曾丢过一批行为(分岔/推进/闪烁/选择/裁减/变灰)。必须都在的:
		 * 空心圈与实心核、呼吸光环与虚线审计环、轮次分段弧、落选/作废的**变灰划掉**、
		 * 虚线轨道(落选那条)、点行选中 → 树下详情(含给人的两个动作:采纳这条世界线 / 放弃探索)。
		 *
		 * 第一性原理:一棵树好不好读,取决于**每一条通道只答一个问题**。把「在动」「落定」
		 * 「结局」「几轮」挤进同一个实心点,读者就得靠记住上一次的颜色差——那不是可视化,是暗号。
		 *
		 * 奥卡姆:不画的东西也写清楚为什么——越位内环(我们的投影里没有「越位」这条事实)、
		 * run 级状态色(同上)、任务选择器与结算单(进展页签已有),都不引入。
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
			adopted: 'rgb(var(--dsw-color-success, 16 185 129))',
			recommend: 'rgb(var(--dsw-color-warning, 245 158 11))',
			evaluated: '#64748b',
			exploring: '#94a3b8',
			pruned: '#cbd5e1',
			/** 执行没跑成:低饱和红(照抄原设计的 branchFailed)。它不是落选,所以不能与灰混用。 */
			failed: '#c98f8f',
			/** 落选/作废那条轨道画虚线(3 3),与实线轨道分开。 */
			rail: 'hsla(220, 9%, 46%, 0.35)',
		}
		/** 一步/一条车道**被闸门裁断过几次**(`block/counted` 折出来的驳回次数 + 通过的那一次)。 */
		function treeLoops(blocks, planId, stepId, advanced) {
			const counted = Number(blocks?.[planId]?.[stepId] ?? 0)
			const fails = Number.isFinite(counted) && counted > 0 ? counted : 0
			return { fails, rounds: fails + (advanced ? 1 : 0) }
		}

		/**
		 * 把「计划 + 世界线」摊成带车道的行:脊柱 + fork 车道 + 收敛。纯函数,便于断言拓扑。
		 *
		 * 放弃过的分叉**画一行**(不铺车道):它是留档的事实,不是一条还在走的路;
		 * 原设计里那棵树也把它留着——「什么都不删」在图上就是「还在,但灰了」。
		 */
		/**
		 * **对外聚焦通道**:别的面点一个步骤/世界线,世界树要能**选中那一行**。
		 *
		 * 为什么需要它:树原先只有**内部**选中状态(点行看详情),外面够不着 ⇒
		 * 「在世界树里看这一步」只能把树打开,不定位 ✗ —— 这是"点击跳转闭环"里缺的那一环。
		 *
		 * 只做两件最小的事:
		 *   · 一个**纯函数** `rowIndexOf(rows, target)`:行身份 = `step.id`(+ 有分支时 `branch.id`),
		 *     返回行下标或 null(可单测 ✓);
		 *   · 一个**订阅式小 store**:聚焦是**界面状态**,不是事实 —— 不写任何变更、不进账本 ✓。
		 */
		function rowIndexOf(rows, target) {
			if (target === null || target === undefined || typeof target.step !== 'string' || target.step === '') return null
			const sameStep = rows.map((row, index) => ({ row, index })).filter((item) => item.row?.step?.id === target.step)
			if (sameStep.length === 0) return null
			if (typeof target.branch === 'string' && target.branch !== '') {
				const branch = sameStep.find((item) => item.row?.branch?.id === target.branch)
				return branch === undefined ? null : branch.index
			}
			// 没指定分支:优先"代表这一步"的那一行(step / fork / abandoned),否则退到第一行
			const head = sameStep.find((item) => item.row?.kind === 'step' || item.row?.kind === 'fork' || item.row?.kind === 'abandoned')
			return (head ?? sameStep[0]).index
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
		 * 唯一的关系就是**步骤上登记的 `tests.hypothesis`** —— 不猜:这一步没登记命题
		 * (自判的 L0 步骤常常没有)就返回 `null`,界面因此**不乱展开**任何一条命题 ✓。
		 * (第一版这里写过一个"退一步看证据挂谁"的回退,而它又去查同一个索引 ⇒ 循环 ✗,已删。)
		 */
		function propositionForStep(data, stepId) {
			if (typeof stepId !== 'string' || stepId === '') return null
			const hypothesis = (data?.stepIndex ?? {})[stepId]?.tests?.hypothesis
			return typeof hypothesis === 'string' && hypothesis !== '' ? hypothesis : null
		}

		function treeRows(plan, forks) {
			const rows = []
			for (const step of plan?.steps ?? []) {
				const fork = (forks ?? []).find((item) => item.stepId === step.id)
				if (fork === undefined) {
					rows.push({ kind: 'step', lane: 0, step })
					continue
				}
				// 放弃过的分叉画成**一行灰掉的留档**(不是消失:什么都不删在图上就是「还在,但灰了」)。
				// 判据是 fold 派生的 `phase === 'abandoned'`(它同时带 abandonReason)。
				if (fork.phase === 'abandoned') {
					rows.push({ kind: 'abandoned', lane: 0, step, fork })
					continue
				}
				rows.push({ kind: 'fork', lane: 0, step, fork })
				// 车道从 **1** 起(照抄原型):第 0 道是脊柱——第一条车道要是压在脊柱上,
				// 扇出去的四条线会缩成一条往下掉的蛇。
				fork.branches.forEach((branch, index) => {
					rows.push({ kind: 'branch', lane: 1 + index, step, fork, branch })
				})
				rows.push({ kind: 'converge', lane: 0, step, fork })
			}
			return rows
		}

		/**
		 * 行与行之间的**连接**(轨道):不是「相邻两行连一条」,而是显式的扇出/扇入。
		 *
		 * 按相邻行连线会把「脊柱裂成四条并行车道」——
		 * 被画成了一条往右下掉的**蛇**——分叉点只连到第一条车道,第二条连第三条……
		 * 那不是分叉,是排队。原设计用的是显式连接表(fork → 每条车道、每条车道 → 收敛菱形),
		 * 所以四条车道是从同一个点扇出去的。这里照它重写。
		 */
		function treeConns(rows) {
			const conns = []
			let prevMain = null
			let forkRow = null
			let branchRows = []
			rows.forEach((row, index) => {
				if (row.kind === 'step' || row.kind === 'abandoned' || row.kind === 'fork') {
					// 脊柱(含放弃的留档行)接上一段主线
					if (prevMain !== null) conns.push({ from: prevMain, fromLane: 0, to: index, toLane: 0 })
					prevMain = index
					if (row.kind === 'fork') {
						forkRow = index
						branchRows = []
					}
					return
				}
				if (row.kind === 'branch') {
					// 扇出:从**分叉点**连到这一条车道(不是从上一条车道连过来)
					if (forkRow !== null) conns.push({ from: forkRow, fromLane: 0, to: index, toLane: row.lane })
					branchRows.push({ idx: index, lane: row.lane })
					return
				}
				// 收敛:每条车道各收一条线进来,然后主线继续
				for (const branch of branchRows) conns.push({ from: branch.idx, fromLane: branch.lane, to: index, toLane: 0 })
				branchRows = []
				forkRow = null
				prevMain = index
			})
			return conns
		}

		/**
		 * 轨道该在节点**边缘**收住,不进节点内部(照抄原型):圆形让 NODE_R + 描边,
		 * 收敛菱形按对角让 NODE_R·√2(它是旋转 45° 的方,竖直方向的顶点比半径远)。
		 * 两端切线都是竖直的,所以直接在 y 上让开即可,不必求切向。
		 */
		const railClear = (row) => (row?.kind === 'converge' ? TREE.radius * Math.SQRT2 + 1 : TREE.radius + 1.5)

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
			const advanced = row.kind === 'branch' ? row.branch.status === 'adopted' : row.step?.status === 'advanced'
			const loops = treeLoops(blocks, planId, stepId, advanced)
			// ① 填充:落定终局了吗(与原设计同一条既有谓词:adopted|pruned 已是终局,advanced|void 同理)
			const settled =
				row.kind === 'branch'
					? row.branch.status === 'adopted' || row.branch.status === 'pruned'
					: row.kind === 'converge'
						? row.fork.phase === 'settled'
						: row.step.status === 'advanced' || row.step.status === 'void'
			// ③ 光环:此刻在动吗——两种事实,各自一条规则,都不猜
			//    · 虚线环 = 有 Evaluator 正在审这一步(audits 里 verdict 还没回来)
			//    · 实心呼吸 = 这条世界线还在探索(原设计的 run 级状态我们这侧没有,所以只画我们真有的)
			const auditing = row.kind !== 'branch' && audits.some((audit) => audit.stepId === stepId && (audit.verdict === null || audit.verdict === undefined))
			/**
			 * 光环 = 「此刻在动吗」。两个**必须**排除的假话:
			 *   · 步骤已经作废/交付了,它上面那条车道不可能还在跑(分叉没跟着收口时会留下这种孤儿);
			 *   · 分叉自己已经放弃了(它下面没有「在动」的东西)。
			 * 状态机那一侧该不该让分叉跟着步骤一起收口,是另一件事(记在 recon 里待定);
			 * 但**界面不许说假话**这一条不依赖那个决定。
			 */
			const ownerAlive = row.step?.status !== 'void' && row.step?.status !== 'advanced'
			// 失败的世界线不再「在动」:它死了,不是还在跑。
			const dead = row.kind === 'branch' && row.branch.failed === true
			/**
			 * 「执行者未归」也不在动:分叉已经收口(收敛或放弃),派出去的执行者**再回来也没有归宿**。
			 * 它既不是失败(没人知道它跑成没跑成),也不是在跑(「结论会自动回灌」那句承诺实现不了)——
			 * 所以它是第三个静止态:不判成败、不呼吸(不说破就会被读成还在跑)。
			 */
			const unreturned = row.kind === 'branch' && row.branch.unreturned === true
			const live = row.kind === 'branch' && row.branch.status === 'exploring' && ownerAlive && !dead && !unreturned
			// ② 颜色:什么结局
			const color =
				row.kind === 'branch'
					? row.branch.failed === true
						? TREE_COLOR.failed
						: row.branch.status === 'adopted'
							? TREE_COLOR.adopted
							: row.branch.status === 'pruned'
								? TREE_COLOR.pruned
							: row.branch.status === 'evaluated'
								? TREE_COLOR.evaluated
								: row.fork.recommended === row.branch.id && row.fork.phase !== 'settled'
									? TREE_COLOR.recommend
									: TREE_COLOR.exploring
					: row.kind === 'converge'
						? row.fork.phase === 'settled'
							? TREE_COLOR.adopted
							: row.fork.phase === 'deciding'
								? TREE_COLOR.recommend
								: TREE_COLOR.exploring
						: row.kind === 'abandoned'
							? TREE_COLOR.pruned
							: row.step.status === 'advanced'
								? TREE_COLOR.done
								: row.step.status === 'void'
									? TREE_COLOR.pruned
									: TREE_COLOR.pending
			// 变灰划掉:作废的步、落选的车道、放弃的分叉(单增:留档不删)
			const greyed =
				(row.kind === 'step' && row.step.status === 'void') ||
				row.kind === 'abandoned' ||
				(row.kind === 'branch' && (row.branch.status === 'pruned' || row.branch.failed === true || row.branch.orphaned === true))
			const done = row.kind === 'step' && row.step.status === 'advanced'
			return { settled, color, live, auditing, greyed, done, loops, ...loops }
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
		/** 要画的弧:只取闸门轮次,封顶 3 段(超出的轮数由行右的 `∞N` 徽标承载)。 */
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
			const data =
				typeof sessions === 'function' && typeof sessionId === 'string'
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
				return h('div', { style: S.wrap }, h('div', { style: S.bar }, h('span', { style: S.title }, t('世界树'))), h(Empty, null, t('还没有计划。计划立起来之后,这里画的是它的拓扑:脊柱上的步、叉开的车道、收在哪。')))
			}
			const rows = treeRows(plan, data.forks)
			/** 页眉那一句:计划的首个非空行,过长再截(整篇在 tooltip 与「计划文档」里)。 */
			const briefLine = String(plan.brief ?? '').split('\n').map((line) => line.trim()).find((line) => line !== '' && !line.startsWith('#')) ?? ''
			const briefText = String(plan.brief ?? '').trim()
			const titleText = briefLine === '' ? plan.id : `${brief(briefLine, 44)} · ${plan.id}`
			/** 外面点进来的聚焦优先;手动点行仍然有效(聚焦为 null 时用它)。 */
			const focused = rowIndexOf(rows, focus)
			const selected = focused === null ? manual : focused
			const context = { blocks: data.blocks ?? null, audits: data.audits ?? [], planId: plan.id }
			const laneCount = rows.reduce((max, row) => Math.max(max, row.lane), 0) + 1
			const gutter = TREE.padX * 2 + laneCount * TREE.laneWidth
			const x = (lane) => TREE.padX + lane * TREE.laneWidth
			const y = (index) => index * TREE.rowHeight + TREE.rowHeight / 2 + 4
			const marksOf = rows.map((row) => treeMarks(row, context))
			// 轨道:显式连接表(扇出/扇入)。落选那条画虚线(3 3)用灰——「这条路走过了,但没走通」。
			const svg = treeConns(rows).map((conn, index) => {
				const to = rows[conn.to]
				const dashed = marksOf[conn.to].greyed
				return h('path', { key: `rail-${index}`, d: railPath(conn, rows), fill: 'none', stroke: dashed ? TREE_COLOR.pruned : TREE_COLOR.rail, strokeWidth: 1, strokeDasharray: dashed && to.kind === 'branch' ? '3 3' : undefined })
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
				} else if (marks.live) {
					nodes.push(h('circle', { key: 'halo', cx, cy, r: TREE.halo, fill: marks.color, className: 'clearai-breathe' }))
				}
				if (row.kind === 'converge') {
					nodes.push(
						h('rect', {
							key: 'node',
							x: cx - TREE.radius,
							y: cy - TREE.radius,
							width: TREE.radius * 2,
							height: TREE.radius * 2,
							rx: 1,
							transform: `rotate(45 ${cx} ${cy})`,
							fill: marks.settled ? marks.color : 'transparent',
							stroke: marks.color,
							strokeWidth: 1.4,
						}),
					)
				} else {
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
				if (row.kind === 'branch' || row.kind === 'converge') return null
				const marks = treeMarks(row, context)
				const stepId = row.step.id
				const scouts = (data.scouts ?? []).filter((item) => item.stepId === stepId).length
				const judges = (data.audits ?? []).filter((item) => item.stepId === stepId).length
				return { marks, scouts, judges }
			}
			/**
			 * 行文只放**名字**,状态交给颜色/形状/标签说。但「失败」与「随步骤作废而终止」是两种
			 * 容易被误读成「还在跑」的状态,所以它们各带一个后缀(语义:
			 * 失败不是落选,孤儿不是被裁)。
			 */
			const rowSuffix = (row) =>
				row.kind === 'branch' && row.branch.failed === true
					? t(' · 执行没跑成')
					: row.kind === 'branch' && row.branch.orphaned === true
						? t(' · 随步骤作废而终止')
						: ''
			const rowLabel = (row) =>
				row.kind === 'branch'
					? `${row.branch.label || row.branch.id}${rowSuffix(row)}`
					: row.kind === 'converge'
						? row.fork.phase === 'settled'
							? t('已采纳')
							: row.fork.phase === 'orphaned'
								? t('未收口(随步骤作废而终止)')
								: row.fork.phase === 'deciding'
									? t('待裁决')
									: t('收敛')
						: row.kind === 'abandoned'
							? `${t('已放弃探索:')}${brief(row.fork.question, 24)}`
							: /**
							 * 行里只放**认得出这一步的那几个字**:`do` 常常是整句话(真数据里 ~100 字 ✗),
							 * 全文在点开的详情里。
							 */
								`${row.step.ordinal}. ${brief(row.step.do, 26)}`
			return h(
				'div',
				{ style: S.wrap },
				h(
					'div',
					{ style: S.bar },
					h('span', { style: S.title }, t('世界树')),
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
									title: t('切回历史的世界树(计划都还在,文档也归档在 clear/goals/plans/)'),
									style: { font: 'inherit', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', background: 'transparent', border: '.5px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '1px 4px' },
								},
								...plans.map((item, index) =>
									h('option', { key: item.id, value: item.id }, `${t('计划 ')}${index + 1}/${plans.length} · ${item.status === 'active' ? '推进中' : '已收尾'}`),
								),
							),
					chosen === null
						? null
						: h('span', { style: { ...S.faint, opacity: 0.8 } }, t('已收尾 · 存档可看')),
					h(
						'span',
						{ style: S.faint },
						`${t('步 ')}${rows.filter((row) => row.kind === 'step' || row.kind === 'fork').length}${t(' · 车道 ')}${laneCount}`,
					),
					props.openPreview === undefined
						? null
						: h(Link, { onClick: () => props.openPreview(`clear/goals/plans/${plan.id}.md`), title: t('打开计划文档(原生预览)') }, t('计划文档')),
					h('span', { style: { ...S.faint, marginLeft: 'auto' } }, t('点一行看细节')),
				),
				/**
				 * 这一格是**计划的一切**:目标是脊柱的起点、拓扑是它的形状、
				 * 要你拍板的那一下(人门)就发生在某条车道上——所以三样都在这张图上,
				 * 而不是散在三个页签里(「进展」那一格因此撤了)。
				 */
				h(GoalLine, { goal: data.goal }),
				h(Inbox, { data }),
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
									title: t('点开看这一步的细节'),
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
											fontWeight: row.kind === 'converge' || row.kind === 'fork' ? 600 : 400,
											...(marks.greyed
												? { color: 'var(--dsw-alias-label-secondary)', opacity: 0.55, textDecoration: 'line-through' }
												: marks.done
													? { opacity: 0.6, textDecoration: 'line-through' }
													: {}),
										},
									},
									rowLabel(row),
								),
								row.kind === 'branch' && row.fork.recommended === row.branch.id && row.fork.phase !== 'settled' ? h('span', { style: { color: TREE_COLOR.recommend, flex: '0 0 auto' }, title: t('算术推荐这条') }, '★') : null,
								row.kind === 'branch' && row.branch.reading !== null && row.branch.reading !== undefined
									? h('span', { style: { ...S.mono, color: marks.color, flex: '0 0 auto' }, title: `${t('读数(尺子 ')}${row.fork.decideBy?.metric ?? '—'})` }, String(row.branch.reading))
									: null,
								stat === null ? null : h(
									'span',
									{ style: { flex: '0 0 auto', display: 'flex', gap: 6, ...S.faint, marginLeft: 'auto' } },
									stat.marks.loops.rounds > 0
										? h('span', { title: `${stat.marks.loops.rounds}${t(' 轮')}${stat.marks.loops.fails > 0 ? ` · 其中 ${stat.marks.loops.fails} 次被驳回` : ''}` }, `∞${stat.marks.loops.rounds}`)
										: null,
									stat.scouts > 0 ? h('span', { title: `${t('派出 ')}${stat.scouts}${t(' 次侦察')}` }, `${t('侦 ')}${stat.scouts}`) : null,
									stat.judges > 0 ? h('span', { title: `${t('起过 ')}${stat.judges}${t(' 次评估者')}` }, `${t('评 ')}${stat.judges}`) : null,
								),
							)
						}),
					),
				),
				selected === null ? null : h(TreeDetail, { row: rows[selected], data, openPreview: props.openPreview, openSpectator: props.openSpectator, openFacts: props.openFacts, onClose: () => setManual(null) }),
			)
		}

		/**
		 * 树下的详情:选中行的**事实**都在这里(树上只有形状,文字细节在这里)。
		 *
		 * 分叉待裁决时,这里也是**给人的那两个动作**的落点(与原设计一致:
		 * 「采纳、改判、放弃探索的动作都在 PlanTree 里」)。放弃必须带缘由——
		 * 留痕可考,不是摆设(原设计用对话框强制必填,这里用同一个纪律:没缘由按钮不生效)。
		 */
		function TreeDetail(props) {
			const row = props.row
			const data = props.data ?? {}
			const [note, setNote] = React.useState('')
			const [busy, setBusy] = React.useState(null)
			const [error, setError] = React.useState(null)
			const send = (action, extra) => {
				setBusy(action)
				setError(null)
				fetch('/api/clearai/gate', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sessionId: data.sessionId, action, plan: data.plan?.id ?? null, step: row.step?.id ?? null, note: note.trim() === '' ? null : note.trim(), ...extra }),
				})
					.then(readResponse)
					.then((result) => {
						if (result.ok !== true) setError(result.error)
					})
					.catch((thrown) => setError(String(thrown?.message ?? thrown)))
					.finally(() => setBusy(null))
			}
			const step = row.step
			const fork = row.fork ?? null
			const evidence = (data.evidence ?? []).filter((item) => item.stepId === step?.id)
			const audits = (data.audits ?? []).filter((item) => item.stepId === step?.id)
			const scouts = (data.scouts ?? []).filter((item) => item.stepId === step?.id)
			const branch = row.kind === 'branch' ? row.branch : null
			const deciding = fork !== null && fork.phase === 'deciding' && fork.abandonReason === null
			return h(
				'div',
				{ style: { marginTop: 10, borderTop: '.5px solid var(--dsw-alias-border-l1)', paddingTop: 8 } },
				h(
					'div',
					{ style: S.inline },
					h('span', { style: S.head }, row.kind === 'branch' ? `${t('车道 · ')}${branch.label || branch.id}` : row.kind === 'converge' ? t('收敛') : row.kind === 'abandoned' ? t('已放弃的分叉') : `${t('步 ')}${step.ordinal} · ${step.id}`),
					h(Link, { onClick: () => props.onClose?.(), title: t('收起详情') }, h('span', { style: S.faint }, t('收起'))),
				),
				row.kind === 'abandoned'
					? h('div', { style: S.faint }, `${t('问题:')}${fork.question}${t(';放弃缘由:')}${fork.abandonReason ?? '未记'}${t('(留档不删)')}`)
					: null,
				fork?.orphaned === true
					? h(
							'div',
							{ style: S.faint },
							`${t('这一步已作废(缘由:')}${fork.ownerVoidReason ?? '未记'}${t('),所以这个分叉没有归宿了:**随步骤作废而终止**——它既不是被人裁掉(没人做过这个决定),也不是被算术排掉(没有尺子排过它)。要收掉工作副本(保留 ref),对它调 AbandonFork(会弹人工确认)。')}`,
						)
					: null,
				branch?.failed === true
					? h(
							'div',
							{ style: S.faint },
							`${t('**执行没跑成**(')}${branch.execution?.note ?? 'failed'}${t(')——它不是落选:落选意味着它跑完了、被尺子排到了后面;这一条是没跑成,所以也没有读数可以参与算术。')}${branch.execution?.conclusion === null || branch.execution?.conclusion === undefined || branch.execution.conclusion === '' ? '' : `执行者最后说的话:${String(branch.execution.conclusion).slice(0, 160)}`}`,
						)
					: null,
				branch?.unreturned === true
					? h(
							'div',
							{ style: S.faint },
							t('**执行者未归**:这条世界线的执行者派出去之后没有回灌,而分叉已经收口——它再回来也没有归宿了,所以这里既不判它跑成也没跑成,也不再等它。它的产物(如果写过)还在它自己的工作副本里;要判断那条线到底做出了什么,直接看工作副本比看这条状态可靠。'),
						)
					: null,
				branch !== null
					? h(
							'div',
							{ style: S.kv },
							h('span', { style: S.faint }, t('做法')), h('span', null, branch.approach ?? '—'),
							h('span', { style: S.faint }, t('判据')), h('span', null, branch.doneCriteria ?? '—'),
							h('span', { style: S.faint }, t('读数')), h('span', { style: S.mono }, branch.reading === null || branch.reading === undefined ? '—' : `${branch.reading}${branch.validity === 'usable' ? '' : '(不可用)'}`),
							h('span', { style: S.faint }, t('状态')), h('span', null, `${gloss(BRANCH_STATUS, branch.status)}${branch.verdict === null || branch.verdict === undefined ? '' : ` · 结论 ${branch.verdict}`}`),
							branch.basis === null || branch.basis === undefined ? null : h('span', { style: S.faint }, t('依据')),
							branch.basis === null || branch.basis === undefined ? null : h('span', null, branch.basis),
							branch.gitBranch === null || branch.gitBranch === undefined ? null : h('span', { style: S.faint }, t('分支')),
							branch.gitBranch === null || branch.gitBranch === undefined ? null : h('span', { style: S.mono }, `${branch.gitBranch}${branch.worktreeRemoved === true ? '(工作副本已清理,ref 保留)' : ''}`),
							branch.evaluatorSession === null || branch.evaluatorSession === undefined ? null : h('span', { style: S.faint }, t('评估者')),
							branch.evaluatorSession === null || branch.evaluatorSession === undefined
								? null
								: h(Link, { onClick: () => props.openSpectator?.(branch.evaluatorSession), title: t('旁观这条世界线的评估者会话(只读)') }, h('span', { style: S.mono }, branch.evaluatorSession)),
						)
					: null,
				step === null || step === undefined
					? null
					: h(
							'div',
							{ style: S.kv },
							h('span', { style: S.faint }, t('做什么')), h('span', null, step.do),
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
													? h('span', { style: { ...S.mono, opacity: 0.6 }, title: t('盘上没有这个文件') }, `${path}${t('(缺)')}`)
													: h(Link, { onClick: () => props.openPreview?.(path), title: exists === true ? t('原生预览打开它') : t('原生预览打开它(计划声明的产物)') }, h('span', { style: S.mono }, path)),
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
												title: t('打开「事实」那一格并展开这条命题'),
											},
											t('看这一步的证据'),
										),
									),
						),
				evidence.length === 0 && audits.length === 0 && scouts.length === 0
					? null
					: h(
							'div',
							{ style: { marginTop: 6 } },
							evidence.map((item) => h('div', { key: item.id, style: S.faint }, `${t('证据 ')}${item.id} · ${item.verdict ?? '—'}${item.level === null || item.level === undefined ? '' : ` · ${item.level}`} · ${item.evaluator ?? '—'}`)),
							audits.map((item) =>
								h(
									'div',
									{ key: item.id, style: S.faint },
									`${t('评估者 ')}${item.verdict === null || item.verdict === undefined ? '正在裁决' : item.verdict} · ${item.evaluator ?? '—'}`,
									item.evaluatorSession === null || item.evaluatorSession === undefined ? null : h(Link, { onClick: () => props.openSpectator?.(item.evaluatorSession) }, h('span', { style: S.mono }, `${t(' 旁观 ')}${item.evaluatorSession}`)),
									item.cardPath === null || item.cardPath === undefined ? null : h(Link, { onClick: () => props.openPreview?.(item.cardPath) }, h('span', { style: S.mono }, t(' 评估卡'))),
								),
							),
							scouts.map((item) => h('div', { key: item.id, style: S.faint }, `${t('侦察 · ')}${gloss(SCOUT, item.status)}${item.conclusion === null || item.conclusion === undefined ? '' : `:${String(item.conclusion).slice(0, 80)}`}`)),
						),
				fork === null
					? null
					: h(
							'div',
							{ style: { marginTop: 6 } },
							h('div', { style: S.faint }, `${t('世界线:')}${fork.question}${t(' · 尺子 ')}${fork.decideBy?.metric ?? '—'}(${fork.decideBy?.direction === 'min' ? '越小越好' : '越大越好'}) · ${fork.phase === 'settled' ? '已收敛' : fork.phase === 'deciding' ? '待裁决' : '探索中'}`),
							fork.verdict === null || fork.verdict === undefined
								? null
								: h('div', { style: S.faint }, `${t('裁决:采纳 ')}${fork.verdict.winner}${fork.verdict.tie === true ? '(并列)' : ''}${fork.verdict.margin === null || fork.verdict.margin === undefined ? '' : ` · 余量 ${fork.verdict.margin}`}${fork.provisional === true ? ' · 临时采纳,待复核' : ''}`),
							// 采纳了但没合并:如实说(账上写过分支、后来对象没了,合并就做不到)。
							fork.mergeSkipped === null || fork.mergeSkipped === undefined
								? null
								: h('div', { style: S.faint }, `${t('这次采纳没有合并:')}${fork.mergeSkipped.reason ?? t('分支或工作副本已不在')}${t('(决定已登记,产物由一次普通交付落位)')}`),
							fork.humanDecision === null || fork.humanDecision === undefined ? null : h('div', { style: S.faint }, `${t('人的裁决:')}${gloss(FORK_ACTION, fork.humanDecision.action)}${fork.humanDecision.note === null || fork.humanDecision.note === undefined ? '' : ` · ${fork.humanDecision.note}`}`),
						),
				deciding
					? h(
							'div',
							{ style: { marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
							h(Chip, { disabled: busy !== null, onClick: () => send('adopt_branch', { fork: fork.id, branch: branch === null ? fork.recommended ?? null : branch.id }), title: t('让内核跑 ConvergeFork 落实它(合并是内核的活)') }, busy === 'adopt_branch' ? t('提交中…') : t('采纳此世界线')),
							h('input', {
								value: note,
								placeholder: t('放弃缘由(必填)'),
								onChange: (event) => setNote(event.target.value),
								style: { fontSize: 11.5, padding: '2px 6px', borderRadius: 6, border: '.5px solid var(--dsw-alias-border-l3)', background: 'transparent', color: 'inherit', minWidth: 120 },
							}),
							h(
								Chip,
								{
									disabled: busy !== null || note.trim() === '',
									onClick: () => send('abandon_fork', { fork: fork.id }),
									title: note.trim() === '' ? t('放弃要留痕:先写缘由') : t('放弃这次探索(留档不删,ref 保留)'),
								},
								busy === 'abandon_fork' ? t('提交中…') : t('放弃探索'),
							),
							error === null ? null : h('span', { style: S.faint }, `${t('提交失败:')}${error}`),
						)
					: null,
			)
		}
		/**
		 * 技能目录的**来源分组**(人此刻在问「我现在能用哪些技能」)。
		 *
		 * 分组表是**照抄宿主的来源名**,不是我们自己编的层次;表外的来源如实显示成
		 * `其他(<来源>)`——宁可见到一个陌生的名字,也不把一条技能藏起来。
		 */
		const SOURCE_GROUPS = lazyTable(() => ([
			{ test: (source) => source === 'bundled', label: t('预设自带'), order: 10 },
			{ test: (source) => source === 'clearai-template', label: t('工作区模板 · clear/skills'), order: 20 },
			{ test: (source) => source === 'clearai-workspace', label: t('本项目写的 · clear/skills'), order: 30 },
			{ test: (source) => source === 'project-dsh' || source === 'project-agents', label: t('本项目 · .dsh / .agents'), order: 40 },
			{ test: (source) => source === 'user-dsh' || source === 'user-agents', label: t('我的 · ~/.dsh'), order: 50 },
			{ test: (source) => source === 'clearai-memory', label: t('记忆索引'), order: 60 },
			{ test: (source) => source === 'runtime', label: t('运行时注册'), order: 70 },
			{ test: (source) => source === 'custom', label: t('自定义'), order: 80 },
		]))
		const groupOf = (source) => SOURCE_GROUPS.find((group) => group.test(source)) ?? { label: `${t('其他(')}${source})`, order: 90 }
		/** 一步的当前结果(指针的落点):用量行要说清「那一步现在怎么样了」。 */
		const STEP_OUTCOME = lazyTable(() => ({ advanced: t('已交付'), open: t('还没交付'), void: t('已作废') }))

		/**
		 * 技能 · 记忆页签(右栏)。
		 *
		 * 技能清单 = **宿主原生的合并目录**(`projectionValues.clearai.skills.catalog`)——
		 * 内核每个 pre-step 调一次 `ctx.skills.snapshot`,于是面板与模型看的是**同一张表**
		 * (预设自带 / 我的 / 本项目的 / clear/skills 里的候选,合并后按 rank 取赢家)。
		 *
		 * 用法 = **本会话的加载记录**(`skills.usage`),从日志折出来的:模型加载是
		 * `tool/call name='skill'`,人引用是一条含 `/名字` 的用户消息。给的是**指针**
		 * (谁在第几步加载的、那一步现在什么结果),不是跨会话的比率——判据混杂的比率会冒充事实
		 * 归并而不是各写一份。
		 *
		 * 写动作只留**一个**,而且它走既有的原生机制:
		 *   · 「采纳」→ 人门动词 `promote_skill` → 内核改写 frontmatter(`status: active`)。
		 * 引用走**原生**的 `/` 技能触发器(输入框里打 `/`,出候选菜单,选一条即注入正文)——
		 * 我们原来在旁边又放了一个「引用」按钮,做的是同一件事,已砍掉(奥卡姆:重复不是能力)。
		 */
		function BrainTab(props) {
			const sessionId = props.sessionId
			const sessions = props.useSessions
			const data =
				typeof sessions === 'function' && typeof sessionId === 'string'
					? sessions((snapshot) => snapshot?.byId?.[sessionId]?.projectionValues?.clearai)
					: undefined
			const brain = data === null || data === undefined ? null : data.brain
			const skills = data === null || data === undefined || data.skills === null || data.skills === undefined ? null : data.skills
			const catalog = skills === null ? null : skills.catalog
			const usage = new Map((skills !== null && Array.isArray(skills.usage) ? skills.usage : []).map((item) => [item.name, item]))
			const [error, setError] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			/**
			 * 投影里还没有目录时,去问**工作区现状**(宿主读面 `GET /api/clearai/brain`)。
			 *
			 * 为什么要有这一条:面板的数据来自会话日志,而内核只在 pre-step 里落事实——
			 * 新建的会话在第一轮对话之前**没有任何日志**,于是页签是空的,可工作区里其实
			 * 已经躺着模板技能。这条读面直接问宿主的 skills 服务,
			 * 拿到的就是模型看到的那张合并目录;渲染仍走同一套分组,并如实标注「还没进投影」。
			 */
			const [live, setLive] = React.useState(null)
			const needsLive = catalog === null
			React.useEffect(() => {
				if (!needsLive || typeof sessionId !== 'string') return undefined
				let alive = true
				fetch(`/api/clearai/brain?sessionId=${encodeURIComponent(sessionId)}`)
					.then(readResponse)
					.then((result) => {
						if (alive && result.ok === true && Array.isArray(result.payload?.entries)) setLive({ entries: result.payload.entries })
					})
					.catch(() => {})
				return () => {
					alive = false
				}
			}, [sessionId, needsLive])
			const fromLive = catalog === null && live !== null
			const entries = catalog !== null && Array.isArray(catalog.entries) ? catalog.entries : fromLive ? live.entries : null
			/** 宿主装没装「用编辑器打开」那条原生路由:装了就多给一个入口,没装就不显示。 */
			const [apps, setApps] = React.useState(null)

			React.useEffect(() => {
				let alive = true
				fetch('/open-in-app/apps')
					.then((response) => (response.ok ? response.json() : null))
					.then((payload) => {
						if (alive) setApps(Array.isArray(payload?.apps) ? payload.apps.filter((id) => typeof id === 'string') : [])
					})
					.catch(() => {
						if (alive) setApps([])
					})
				return () => {
					alive = false
				}
			}, [])

			const promote = (name, viaAsk = false) => {
				setBusy(true)
				fetch('/api/clearai/gate', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(viaAsk ? { sessionId, action: 'ask', gate: 'promote_skill', skill: name } : { sessionId, action: 'promote_skill', skill: name }),
				})
					.then(readResponse)
					.then((result) => {
						if (result.ok !== true) setError(result.error)
					})
					.catch((thrown) => setError(String(thrown?.message ?? thrown)))
					.finally(() => setBusy(false))
			}

			/**
			 * 「引用」按钮已删掉(人门动词 `invoke_skill` 一并摘除)。
			 *
			 * 原生的 `/` 技能触发器做的正是同一件事,而且更好:`dsh-client-ui-skill` 注册
			 * `trigger: '/'`,`dsh-client-ui-input-trigger` 出候选菜单,选一条就把技能正文
			 * 作为指令注入这一回合——我们的按钮不过是在旁边又写了一遍同一个手势。
			 * 少一个入口 = 少一处会与原生菜单走偏的语义(面板仍保留「采纳」:那是模型做不到的写动作)。
			 */
			/** 工作区外的技能(比如 `~/.dsh/skills`):面板读不了,交给宿主的「用编辑器打开」原生路由。 */
			const openInApp = (dir) => {
				const app = Array.isArray(apps) ? apps[0] : undefined
				if (typeof app !== 'string') return
				fetch('/open-in-app/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app, path: dir }) })
					.then((response) => {
						if (!response.ok) setError(`${t('打开失败:HTTP ')}${response.status}`)
					})
					.catch((thrown) => setError(String(thrown?.message ?? thrown)))
			}
			/**
			 * 点技能名 → **原生**文档预览(markdown 会渲染成 markdown,不是源码)。
			 *
			 * 用内核随投影发下来的 `file`(技能目录下的 SKILL.md):虚拟条目(记忆索引)没有正文文件,
			 * `file` 是 null,面板就不画链接(点进去撞 404 是踩过的坑)。
			 */
			const pointAt = (skill) => {
				if (typeof skill.file !== 'string') return
				if (props.openPreview?.(skill.file) !== true) setError(t('原生预览打不开这条路(它在工作区外?)'))
			}

			if (brain === null || brain === undefined) {
				// 两种情况要分开说:会话还没开始(没有第一轮对话 = 还没有任何事实)vs 真的没有技能或记忆。
				const note =
					data === undefined
						? t('这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示工作区的技能目录与记忆。')
						: t('这个工作区里还没有技能或记忆:用一次 `SaveSkill` 或 `WriteMemory`,或把技能放进 `clear/skills/`。')
				return h('div', { style: S.wrap }, h('div', { style: S.bar }, h('span', { style: S.title }, t('技能 · 记忆'))), h(Empty, null, note))
			}
			const overview = Array.isArray(brain.skills) ? brain.skills : []
			const memory = brain.memory ?? { count: 0, files: [] }
			/** 章程读数(内核扫的)+ 打开它的那条原生预览通道。 */
			const constitution = data === null || data === undefined ? null : (data.constitution ?? null)
			const openAt = (path) => props.openPreview?.(path)
			const overviewOf = new Map(overview.map((skill) => [skill.name, skill]))
			// 目录还没到(内核下一次 pre-step 才发):如实说,不拿 brain.skills 冒充合并目录。
			const listed = entries === null ? overview.map((skill) => ({ name: skill.name, description: skill.description, source: skill.status === 'candidate' ? 'clearai-workspace' : 'clearai-template', model: skill.status !== 'candidate', user: true, dir: null, inside: null, stale: true })) : entries
			const groups = []
			for (const skill of listed) {
				const group = groupOf(String(skill.source ?? 'unknown'))
				const bucket = groups.find((item) => item.label === group.label) ?? { label: group.label, order: group.order, items: [] }
				if (!groups.includes(bucket)) groups.push(bucket)
				bucket.items.push(skill)
			}
			groups.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
			const quotedNames = new Set(listed.map((skill) => skill.name))
			const orphanUsage = (skills !== null && Array.isArray(skills.usage) ? skills.usage : []).filter((item) => !quotedNames.has(item.name))
			const usageLine = (item) => {
				if (item === undefined) return null
				const last = item.last
				const pointer = last === null ? '—' : `${last.by === 'model' ? '模型' : '人'}${last.ordinal === null ? '' : ` · 第 ${last.ordinal} 步`}${last.outcome === null || last.outcome === undefined ? '' : ` · ${STEP_OUTCOME[last.outcome] ?? last.outcome}`}`
				return `${t('本会话 模型 ')}${item.model}${t(' · 人 ')}${item.human}${t(' · 最近 ')}${pointer}`
			}
			const row = (skill) => {
				const own = overviewOf.get(skill.name)
				const candidate = own?.status === 'candidate'
				const item = usage.get(skill.name)
				const canOpen = typeof skill.file === 'string'
				return h(
					'div',
					{ key: skill.name, style: S.row },
					h(
						'div',
						{ style: S.inline },
						candidate ? h('span', { style: S.tagStrong }, t('候选')) : null,
						skill.model === false && !candidate ? h('span', { style: S.tag }, t('仅人可引用')) : null,
						h(
							'span',
							{
								style: S.mono,
								className: canOpen ? 'clearai-link' : undefined,
								onClick: canOpen ? () => pointAt(skill) : undefined,
								title: [
									String(skill.description ?? '').replace(/\s+/g, ' ').trim(),
									own === undefined ? '' : `${own.bytes}${t(' 字节 · 资源 ')}${own.resources} · ${dash(own.tier ?? own.version)}`,
								].filter((line) => line !== '').join('\n'),
							},
							skill.name,
						),
						/**
						 * 机器读数(字节 / 资源数 / 层级)**不渲染**:它们不帮人认出一条技能,
						 * 20 条排下来就是噪声(真数据这一格 4741 字里很大一份是它们 ✗),
						 * 而且藏成 `display:none` 也还是 DOM 里的噪声 ⇒ 干脆不画,挂到技能名的 tooltip。
						 */
						candidate ? h(Chip, { disabled: busy, onClick: () => promote(skill.name), title: t('采纳:改写 frontmatter,模型从此加载得到它') }, t('采纳')) : null,
						// 混合路径:同一件事也可以摆到原生提问卡上答(卡里带它的描述与后果)。
						candidate ? h('span', { className: busy ? undefined : 'clearai-link', style: S.faint, onClick: busy ? undefined : () => promote(skill.name, true), title: t('用原生提问卡决定') }, t('用提问卡决定')) : null,
					),
					/**
					 * 描述只留**认得出这条技能的那一句**(真数据里每条是一整段「适用/不适用」✗,
					 * 18 条一起看就是信息爆炸)。全文在技能名的 tooltip 里,要选技能用原生的 `/` 触发菜单。
					 */
					skill.description === null || skill.description === undefined || skill.description === ''
						? null
						: h('div', { style: S.faint }, brief(skill.description, 60)),
					usageLine(item) === null ? null : h('div', { style: S.dim }, usageLine(item)),
					// 工作区外的技能:面板读不到正文(路径守卫),所以如实给绝对路径 + 宿主的编辑器入口。
					skill.inside === false && typeof skill.dir === 'string' ? h('div', { style: S.faint }, `${skill.dir}${t(' · 在工作区外,面板不读正文')}`) : null,
					skill.inside === false && typeof skill.dir === 'string' && Array.isArray(apps) && typeof apps[0] === 'string'
						? h(Chip, { onClick: () => openInApp(skill.dir) }, `${t('在 ')}${apps[0]}${t(' 里打开')}`)
						: null,
				)
			}
			return h(
				'div',
				{ style: S.wrap },
				h(
					'div',
					{ style: S.bar },
					h('span', { style: S.title }, t('技能 · 记忆')),
					/**
					 * 计数在下面各段标题里(同屏重复计数 = 噪声);
					 * 「与模型看到的是同一张表」是实现保证、不是用户信息,与事实那一格同一条规矩 → 去掉。
					 * 只留**状态**:目录到没到、这份是不是"本会话还没有第一轮对话"的工作区现状。
					 */
					entries === null || fromLive ? h('span', { style: S.faint }, entries === null ? t('目录还没到(内核下一次 pre-step 会发)') : t('工作区现状(本会话还没有第一轮对话,这份还没进投影)')) : null,
				),
				error !== null ? h('div', { style: S.faint }, `${t('面板动作失败:')}${error}`) : null,
				/**
				 * 章程那一行(这个页签的第一层):**只有文件系统事实** + 一个点开就走的原生预览。
				 *
				 * 为什么不再有「占位 X/Y 条」:那是对文本做格式解析
				 * ——模型把章程第 5 节写成 `- **变更记录**（一行即…）`,条目数就会数错,
				 * **改一个标点「事实」就变**;而且它奖励的是「把数字清掉」而不是「把章程写实」。
				 * 章程每回合本来就被原生指令文件整份注入模型上下文,面板这边只需要说清
				 * 「它在哪、什么时候动过」——`mtime` 不依赖任何格式约定。
				 */
				constitution === null || constitution === undefined
					? null
					: h(
							'div',
							{ style: S.section },
							h('div', { style: S.head }, t('项目章程')),
							h(
								'div',
								{ style: S.inline },
								/**
								 * 文件名只在**链接**上说一次(原来段标题里还写一遍 ⇒ 同一行同一路径出现两遍 ✗)。
								 * 点它是**动作**(原生预览),字节数与改动时间是文件系统事实 —— 这些留着有意义。
								 */
								h(
									Link,
									{ onClick: () => openAt(constitution.legacy === true ? 'clear/project.md' : 'PROJECT.md'), title: t('用原生预览打开章程(它每回合整份注入模型上下文)') },
									h('span', { style: S.mono }, constitution.legacy === true ? 'clear/project.md' : 'PROJECT.md'),
								),
								h('span', { style: S.faint }, `${t('最后改动 ')}${stampOf(constitution.modifiedAt)} · ${constitution.bytes}${t(' 字节')}`),
							),
						),
				...groups.map((group) =>
					h(
						'div',
						{ key: group.label, style: S.section },
						h('div', { style: S.head }, `${group.label}(${group.items.length})`),
						group.items.map((skill) => row(skill)),
					),
				),
				orphanUsage.length === 0
					? null
					: h(
							'div',
							{ style: S.section },
							h('div', { style: S.head }, `${t('目录里已经没有(')}${orphanUsage.length})`),
							orphanUsage.map((item) => h('div', { key: item.name, style: S.row }, h('span', { style: S.mono }, item.name), h('span', { style: S.faint }, usageLine(item) ?? ''))),
						),
				h(
					'div',
					{ style: S.section },
					h('div', { style: S.head }, `${t('记忆(')}${memory.count}${t(' 条)')}`),
					(Array.isArray(memory.files) ? memory.files : []).map((file) =>
						h(
							'div',
							{ key: file.file, style: S.row },
							h(Link, { onClick: () => props.openPreview?.(file.path) }, h('span', { style: S.mono }, file.file)),
							/**
							 * 一个记忆文件里的条目可能十几条 ⇒ 行里只给**前两条 + 共几条**,
							 * 全文进 tooltip(默认少而准,细节靠悬停/点开)。
							 */
							h(
								'span',
								{ style: S.faint, title: (file.entries ?? []).map((entry) => `${entry.kind === 'lesson' ? '经验' : '事实'}:${entry.title}`).join('\n') },
								(() => {
									const all = (file.entries ?? []).map((entry) => `${entry.kind === 'lesson' ? '经验' : '事实'}:${entry.title}`)
									if (all.length === 0) return ''
									return all.length <= 2 ? all.join(' / ') : `${all.slice(0, 2).join(' / ')}${t(' 等 ')}${all.length}${t(' 条')}`
								})(),
							),
						),
					),
					memory.count === 0 ? h('div', { style: S.faint }, t('还没有记忆。')) : null,
				),
			)
		}

		/**
		 * 人门区(阶段 4,D2=B)。**人门优先于运行态**——ClearAI 的 UI 规则:等人的事永远最先说。
		 * 写通道只有五个动词,而且是**只给人**的:模型能调的工具面里没有它们(DESIGN 的
		 * 「读事实、只写人门」)。按下去之后由宿主平面把它变成一条带结构化标记的用户消息,
		 * 折进投影(`by:'user'`),面板随投影自己更新。
		 */
		function Inbox(props) {
			const data = props.data
			const sessionId = data === null || data === undefined ? null : data.sessionId
			const items = data === null || data === undefined || !Array.isArray(data.inbox) ? [] : data.inbox
			const [busy, setBusy] = React.useState(null)
			const [error, setError] = React.useState(null)
			// 放弃的分叉:要写缘由才提交(两步),缘由按分叉 id 存着——
			// 同一个屏上可能有两条分叉,不能共用一个输入框。
			const [abandonFork, setAbandon] = React.useState(null)
			const [abandonNote, setAbandonNote] = React.useState('')
			if (items.length === 0) return null
			const send = (item, extra) => {
				setBusy(`${item.kind}:${item.plan || ''}:${item.step || ''}`)
				setError(null)
				// `gate` 只有「用提问卡决定」那一步用得上:它是**界面手势**,不是事实动词。
				const body = { sessionId, action: item.human_action, plan: item.plan ?? null, fork: extra?.fork ?? null, branch: extra?.branch ?? null, gate: extra?.gate ?? null, skill: extra?.skill ?? null }
				fetch('/api/clearai/gate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
					.then(readResponse)
					.then((result) => {
						if (result.ok !== true) setError(result.error)
					})
					.catch((thrown) => setError(String(thrown?.message ?? thrown)))
					.finally(() => setBusy(null))
			}
			/**
			 * 收件箱里现在只有**真门**(计划确认已砍:它是记号不是闸门,见 fold 的 HUMAN_GATE_ACTIONS)。
			 *
			 * 门要什么由**数据**说(`item.needs`),不在这里按 kind 猜 ✗:
			 *   · `click` ⇒ 给按钮(白名单动词:裁决 / 采纳);
			 *   · `word`  ⇒ 给**一句提示**(「说一句话就行 —— <要说什么>」),
			 *     因为那种门本来就不是点击能表达的(复核 / 解除阻塞),而它照样会按住续跑。
			 */
			const label = (item) => (item.needs === 'click' ? (item.kind === 'skill_candidate' ? t('采纳') : t('裁决')) : null)
			return h(
				'div',
				{ style: S.gate },
				h('div', { style: S.head }, `${t('需要你 ')}${items.length}`),
				...(data.forks || []).filter((fork) => fork.phase === 'deciding').length > 0
					? (data.forks || [])
							.filter((fork) => fork.phase === 'deciding')
							.map((fork) =>
								h(
									'div',
									{ key: `adopt-${fork.id}`, style: S.gateRow },
									h('span', { style: S.mono }, `${fork.stepId} · ${fork.question}`),
									/**
									 * 混合路径:同一道门,也可以摆到**原生提问卡**上去答。
									 * 为什么两条路都留:面板这条是熟手的快路(一步到位);提问卡那条把
									 * 判据、各分支的读数与推荐**铺在对话框里**,而且它会挡住输入框——
									 * 人正在看对话时,那是最不会被忽略的位置。两条路的落账完全相同。
									 */
									h(
										'button',
										{
											type: 'button',
											className: 'clearai-btn',
											disabled: busy !== null,
											title: t('把这道裁决摆到原生提问卡上(带你读到的判据与各分支读数)'),
											onClick: () => send({ kind: 'fork_adopt', human_action: 'ask', plan: fork.plan ?? null, step: fork.stepId }, { gate: 'fork_adopt', fork: fork.id }),
										},
										t('用提问卡决定'),
									),
									...fork.branches.map((branch) =>
										h(
											'button',
											{
												key: branch.id,
												type: 'button',
												tone: 'warn',
												disabled: busy !== null,
												onClick: () => send({ kind: 'fork_adopt', human_action: 'adopt_branch', plan: fork.plan ?? null, step: fork.stepId }, { fork: fork.id, branch: branch.id }),
											},
											`${t('采纳 ')}${branch.label}${branch.reading === null || branch.reading === undefined ? '' : `(${branch.reading})`}`,
										),
									),
									/**
									 * 放弃要留痕:两下才生效(先点开缘由框,写了才能提交)。
									 * 单次点击就放弃会把「为什么」永远丢掉——而放弃正是最需要缘由的那一类决定。
									 * 与树下详情同一条纪律(那边是按钮 disabled,这里是两步)。
									 */
									h(
										'button',
										{
											type: 'button',
											className: 'clearai-btn',
											disabled: busy !== null,
											onClick: () => setAbandon(fork.id),
											title: t('放弃要留痕:点一下写缘由,写了才能提交'),
										},
										t('放弃这条分叉'),
									),
									abandonFork === fork.id
										? h(
												'span',
												{ style: { display: 'inline-flex', gap: 6, alignItems: 'center' } },
												h('input', {
													value: abandonNote,
													placeholder: t('为什么放弃?(留痕可考)'),
													onChange: (event) => setAbandonNote(event.target.value),
													style: { fontSize: 11.5, padding: '2px 6px', borderRadius: 6, border: '.5px solid var(--dsw-alias-border-l3)', background: 'transparent', color: 'inherit', minWidth: 140 },
												}),
												h(
													'button',
													{
														type: 'button',
														className: 'clearai-btn',
														disabled: busy !== null || abandonNote.trim() === '',
														onClick: () => send({ kind: 'fork_adopt', human_action: 'abandon_fork', plan: fork.plan ?? null, step: fork.stepId }, { fork: fork.id, note: abandonNote.trim() }),
														title: abandonNote.trim() === '' ? t('缘由必填') : t('确认放弃(留档不删,ref 保留)'),
													},
													t('确认放弃'),
												),
											)
										: null,
								),
							)
					: [],
				...items.map((item, index) =>
					h(
						'div',
						{ key: `${item.kind}-${index}`, style: S.gateRow, title: item.kind },
						/** 机器词(`provisional_review` 这类)**不上屏** ✗ —— 进 tooltip,给人看的是标题那句话。 */
						label(item) === null ? null : h('span', { style: S.tagStrong }, `${t('要你')}${label(item)}`),
						h('span', null, item.title),
						h('span', { style: S.faint }, item.summary),
						label(item) !== null
							? h(
									'button',
									{ type: 'button', className: 'clearai-btn', disabled: busy !== null, onClick: () => send(item, null) },
									label(item),
								)
							: item.needs === 'word'
								? h('span', { style: { ...S.faint, opacity: 0.9 } }, `${t('说一句话就行 —— ')}${item.ask ?? '说一句你的决定'}`)
								: null,
					),
				),
				error === null ? null : h('div', { style: S.faint }, `${t('没送出去:')}${error}`),
			)
		}

		/**
		 * 旁观入口(阶段 4 的 4.5):点一下跳到那个子会话,**只看不动手**。
		 * 判断不许匿名——评估者/仲裁是谁、在哪,面板上给得出入口。
		 * 拿不到会话服务就退化成一行文本 id:宁可少一个按钮,也不假装能跳。
		 */

		/**
		 * 续跑档的两个小工具(纯函数,便于直接断言文案)。
		 *
		 * **说行为,不说机制**:人要回答的是「我走开的时候它还接着干吗」,不是「这是哪个档」。
		 * 哲学词(人在场 / 无人值守)留在文档、运行态卡与提示词里——那些读者是模型和写文档的人;
		 * 给人点的那一格说人话,并在 tooltip 里注明两个词是一回事。
		 *
		 * 为什么是「多问我 / 自己拿主意」而不是「先问我 / 别问我」:两档都**会**为不可约的判断开门
		 * (湿实验、护栏级授权、L4 放行),所以只能写程度,不能写绝对——绝对的说法是假承诺。
		 */
		const TIER_TEXT = lazyTable(() => ({ attended: t('多问我'), unattended: t('自己拿主意') }))
		const TIER_HINT = lazyTable(() => ({
			attended: t('续跑:多问我——每个阶段收尾就停下,等你给下一阶段(文档里叫「人在场」)。点一下切成「自己拿主意」。'),
			unattended: t('续跑:自己拿主意——立约即授权,按轮数自己往下跑,只在不可约的判断上开门(文档里叫「无人值守」)。点一下切成「多问我」。'),
		}))
		const tierLabel = (value, pending) => `${TIER_TEXT[value] ?? value}${pending ? '(已切,下一步生效)' : ''}`

		/**
		 * 「多问我 / 自己跑」那个开关**删掉了**。
		 *
		 * 第一性原理 + 奥坎姆:「我要不要在场」是**运行时状态**——有没有门开着、有没有裁决在飞、
		 * 有没有开着的步;这些系统自己知道 ✗,不该要用户预先声明。
		 * 而且那一档还顺手把「计划经人确认」变成系统自己签的 ✗(与 L4「人放行」同一类病)。
		 * 续跑本身走**原生 goal**(宿主的回合驱动);我们只决定"什么时候该布防、给多大保险丝"。
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
			 * 一格只放**一个符号**:进度,或者一件要人注意的事。
			 * 要人动手的那件事(等你确认)由**输入框下那条**说「需要你 N」——它在事实面上,
			 * 而这里只是工具行里的一个指针,不能把两个事实挤在一格里。
			 */
			/**
			 * 输入框下**单独占一行**的派生状态条已删掉 ——
			 * 「已达成 · 100%」与原生目标提示、与这颗 chip 的 `3/8` 说的是同一件事 ✗,
			 * 却把输入框整行顶上去 ✗。留下的只有**可点、且只有我们知道**的两件:
			 *   需要你 N(人门计数,点了开世界树)· 续跑停着(为什么停,人是可以处置的)
			 */
			const inboxCount = Array.isArray(data?.inbox) ? data.inbox.length : 0
			const cont = data?.continuation ?? null
			const holdNote = cont === null || cont === undefined || cont.state !== 'paused' ? null : `${t('续跑停着:')}${HOLD_WHY[cont.why] ?? cont.why ?? '策略暂停'}`
			const pending = plan.confirmationPending === true
			const blocked = plan.blocked !== null && plan.blocked !== undefined
			const attention = pending || blocked
			/**
			 * 符号**恒定是进度**(形状稳定才学得会):要人注意不在符号上换字,
			 * 而是换颜色(与世界树同一条规矩:形状说状态,别让人去猜一个 '?')。
			 * 「需要你 N」由输入框下那条说——那才是事实面该管的事。
			 */
			const symbol = `${done}/${total}`
			const brief = typeof plan.brief === 'string' && plan.brief.trim() !== '' ? plan.brief.trim() : null
			const meaning = pending ? t('计划在建,**等你确认**') : blocked ? t('计划受阻,等人处置') : plan.status === 'closed' ? `${t('计划已收尾(')}${done}/${total}${t(' 步)')}` : `${t('计划已交付 ')}${done}/${total}${t(' 步')}`
			/**
			 * 等人时**只说一句**:先「需要你 N」(人门计数),没有门才说续跑停着的原因。
			 * 两者是同一根轴(为什么在等人)⇒ 一格只放一个,不并列。
			 */
			const waiting = inboxCount > 0 ? `${t('需要你 ')}${inboxCount}` : null
			const attentionNow = attention || waiting !== null
			return h(
				'button',
				{
					type: 'button',
					className: 'clearai-toolctl',
					disabled: props.locked === true,
					title: `${meaning}${waiting === null ? '' : ` · ${waiting}`} · ${plan.id}${brief === null ? '' : ` · ${brief}`}${t('(点一下开右栏「世界树」看拓扑)')}`,
					'aria-label': `${meaning}${waiting === null ? '' : ` · ${waiting}`}${t('(点一下开右栏「世界树」)')}`,
					// 「要人注意」用与世界树同一族的琥珀(同一套主题令牌,不新造颜色)。
					style: attentionNow ? { color: 'rgb(var(--dsw-color-warning, 245 158 11))', fontWeight: 600 } : undefined,
					onClick: () => props.openRail?.('clearai-worldtree'),
				},
				h(PlanGlyph, null),
				h('span', { style: { minWidth: 14, textAlign: 'center' } }, symbol),
				waiting === null ? null : h('span', { style: { marginLeft: 6, fontSize: 11.5 } }, waiting),
			)
		}

		/**
		 * 策略暂停的**理由**对照表(值来自内核 `holdReason`,不是这里自创的):
		 * 面板要说的正是「平台说不出的那一句」——为什么停。新增理由时这张表跟着补,
		 * 补漏了也不骗人:认不出来的值原样显示,而不是显示一个体面的空话。
		 */
		/** 窗口停下的理由 = **真的有人的事**(「一阶段收尾」那条已删:它是档位的表达,不是人的事)。 */
		const HOLD_WHY = lazyTable(() => ({
			audit: t('等独立裁决'),
			plan_confirm: t('计划待确认'),
			gate: t('有人在等你'),
			unknown: t('策略暂停(理由没记下,已在日志里告警)'),
		}))

		/**
		 * 一步的**人话**名字:`do` 是模型写的那句「做什么」,截短了放进一行。
		 * 内部步 id(`s-3`)只进 tooltip 与世界树——它在日志里是账,在界面上不是给人看的。
		 */
		function shortDo(text) {
			const value = String(text ?? '').trim()
			return value.length <= 12 ? value : `${value.slice(0, 12)}…`
		}

		/**
		 * **续跑注**:只在**有话要说**时出现的一格。
		 *
		 * 输入框下那条整行删掉之后,它说的三句话里有两句**别处无处可说** ✗:
		 *   · 「续跑已撤回」——人按下清除的那一瞬,dock 已经消失,而内核还没到下一拍;
		 *   · 「续跑停着:<理由>」——平台只会说"目标已暂停",说不出**为什么**;
		 * 所以把它们移到工具行(与计划 chip 同一行,**不占新行**):正常跑着时一个字都不说 ✓。
		 */
		function ContinuationNote(props) {
			const data = typeof props.useProjection === 'function' ? props.useProjection('clearai') : undefined
			const hostGoal = typeof props.useProjection === 'function' ? props.useProjection('goal') : undefined
			const cont = data === null || data === undefined ? null : (data.continuation ?? null)
			if (cont === null) return null
			const vanished = hostGoal === null || hostGoal === undefined
			/** 门要**一句话**时(dock 只会说"目标已暂停"),这句话说得更准:等你说一声 ✓ */
			const wordGate = Array.isArray(data?.inbox) && data.inbox.some((item) => item.needs === 'word')
			const holdText = wordGate ? t('等你说一句话') : (HOLD_WHY[cont.why] ?? cont.why ?? t('策略暂停'))
			const text =
				cont.state === 'withdrawn' || ((cont.state === 'armed' || cont.state === 'paused') && vanished)
					? t('续跑已撤回')
					: cont.state === 'paused'
						? `${t('续跑停着:')}${holdText}`
						: null
			if (text === null) return null
			return h(
				'span',
				{
					className: 'clearai-toolctl',
					style: { opacity: 0.8, fontSize: 11.5, cursor: 'default' },
					title: t('这是系统对自己说的话(我们自己按的暂停 / 人清掉的窗口),不是运行档'),
				},
				text,
			)
		}

		/**
		 * 输入框下那条派生状态条**删掉了**。
		 *
		 * 它说的事(阶段 / 完成度 / 当前步)与**原生目标提示**、与工具行那颗计划 chip 的 `N/M`
		 * 说的是同一件 ✗ —— 而它**独占一行,把输入框整个顶上去** ✗。
		 * 唯一可点、且只有我们知道的那一件(「需要你 N」)已经并进计划 chip:
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
		const LocalizedDeliverables = withLocale(Deliverables)
		const LocalizedFacts = withLocale(Facts)
		const LocalizedWorldTree = withLocale(WorldTree)
		const LocalizedBrainTab = withLocale(BrainTab)

		/** 会话预设的 id:面板只在这个模式的会话里出现。 */
		const PRESET_ID = 'clearai'

		function apply(ctx) {
			// 这四个服务都声明在 `inject` 里,所以这里直接用属性读(Cordis 保证就位);
			// 用 `ctx.get()` 也读得到,但属性形式同时受 inject 的「服务重载后重新激活」保护。
			const { slots, sessions, sidebarRightTabs, sidebarRight } = ctx
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

			const isCurrentPreset = () => {
				try {
					const state = sessions.list.getSnapshot()
					const session = state === undefined || state.current === undefined ? undefined : state.byId[state.current]
					const preset = session === undefined || session === null ? undefined : session.projectionValues?.agentPreset
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
			 * 右栏三张页签(定案)。
			 *
			 * 为什么在右栏而不是中栏:`conversation.view` 是「一次看一个」的视图——看树时看不到对话;
			 * 而右栏能与对话并排,还能拖出成浮窗、能全屏(树的车道是横向铺开的)。
			 *
			 * 注册契约(照抄 `dsh-client-ui-sidebar-files` 的写法):
			 *   · `sidebarRightTabs.register({id, kind, title, guide})` 注册**页签类型**;
			 *   · 体与标题各自注册在 `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title`(keyed,钥匙是类型 id);
			 *   · `sidebarRight.openTab(kind)` 程序化打开(跨面跳转靠它)。
			 */
			/**
			 * 图标挑法(原生那 75 个里选,语义要对得上):
			 *   · 世界树 = `IconBranchOutline16`(计划拓扑与分叉,原生就用它画分支)
			 *   · 技能 · 记忆 = `IconSkillOutline16`(原生专门有一枚技能图标)
			 * 拿不到就留空 ⇒ 原生默认字形。
			 */
			/**
			 * 右栏只剩两格:**世界树**(计划的一切:脊柱、车道、闸门、要你拍板的那一下)
			 * 与 **技能 · 记忆**(外脑)。
			 *
			 * 「进展」撤了:它原先装的四段各有归宿——计划与世界线的行归世界树,
			 * 假设/观测/证据/事实归中栏「事实」,目标与判据归世界树的页眉,
			 * 而"当下什么状态"由输入框下那条**常驻事实条**回答(它一直在,不用切页签)。
			 * 页签越少,越不需要向人解释每个页签该在什么时候看。
			 */
			const rightRail = [
				{ id: 'clearai-worldtree', kind: 'clearai-worldtree', label: t('世界树'), order: 15, description: t('计划的拓扑与闸门:脊柱、叉开的车道、收在哪、要你拍哪一下'), icon: NATIVE_ICONS.IconBranchOutline16 },
				{ id: 'clearai-brain', kind: 'clearai-brain', label: t('技能 · 记忆'), order: 20, description: t('合并目录、本会话用法、可引用可采纳'), icon: NATIVE_ICONS.IconSkillOutline16 },
			]
			const shown = new Set()
			const syncRail = () => {
				const wanted = isCurrentPreset()
				if (!wanted) {
					for (const id of [...shown]) {
						const entry = railDisposers.get(id)
						if (entry !== undefined) entry()
						railDisposers.delete(id)
						shown.delete(id)
					}
					return
				}
				for (const tab of rightRail) {
					if (shown.has(tab.id)) continue
					shown.add(tab.id)
					const own = []
					try {
						own.push(ctx.effect(() => sidebarRightTabs.register({
							id: tab.id,
							kind: tab.kind,
							title: () => tab.label,
							guide: [{ order: tab.order, title: () => tab.label, description: () => tab.description, icon: tab.icon }],
						}), `clearai: rail type ${tab.id}`))
					} catch (error) {
						// 类型已注册(同名同 layer)不是致命:如实记一笔,继续。
						console.warn?.(`${t('clearai 面板:右栏页签类型注册失败 ')}${String(error?.message ?? error)}`)
					}
					const body =
						tab.body ??
						(tab.id === 'clearai-worldtree'
							? (props) =>
									h(LocalizedWorldTree, {
										...props,
										openPreview: openPreviewFor(props),
										openSpectator,
										/**
										 * 反向跳:记住要展开哪条命题,再用**原生正门**切中栏视图。
										 * `layout` 走可选读法(契约里就给了 `ctx.get('layout')` 这一路);
										 * `selectPanel` 对未注册的 key 会抛 ⇒ 包起来,别把整棵树带下水。
										 */
										openFacts: (stepId) => {
											factsFocus.set({ step: stepId })
											const layout = ctx.get('layout')
											if (layout === undefined || typeof layout.selectPanel !== 'function') return false
											try {
												layout.selectPanel('clearai-facts')
												return true
											} catch {
												return false
											}
										},
									})
							: (props) => h(LocalizedBrainTab, { ...props, isCurrentPreset, openRail, openPreview: openPreviewFor(props) }))
					own.push(ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: tab.id }, body)), `clearai: rail body ${tab.id}`))
					own.push(ctx.effect(() => slots.inject('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: tab.id }, () => tab.label)), `clearai: rail title ${tab.id}`))
					railDisposers.set(tab.id, () => {
						for (const dispose of own) {
							try {
								dispose()
							} catch {
								/* 已经放过的不重复处理 */
							}
						}
					})
				}
			}
			const railDisposers = new Map()

			/**
			 * 打开右栏的某张页签(跨面跳转:点「需要你 N」→ 进展)。
			 * 不再有我们自己的「预览」页签了:预览走**原生**的文档预览(`openNativePreview`)——
			 * 那一条既有 markdown/图片/pdf/html 的渲染,也有它自己的分页读盘。
			 */
			const openRail = (kind) => {
				try {
					sidebarRight?.openTab?.(kind)
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
			 * (原生 chat 同款:`sessions.list.getSnapshot().current`)。兜底在这里成立,是因为
			 * 面板**只在当前会话的预设是 clearai 时挂载**(`isCurrentPreset`,见上),会话切走
			 * 时面板先注销 —— 不存在「面板还挂着、行的会话已经换了」的窗口。
			 */
			const sessionIdFor = (props) => {
				const fromProps = props === null || props === undefined ? undefined : props.sessionId
				if (typeof fromProps === 'string' && fromProps !== '') return fromProps
				try {
					const current = sessions.list.getSnapshot()?.current
					return typeof current === 'string' && current !== '' ? current : undefined
				} catch {
					return undefined
				}
			}
			/** 每个座位按自己的 props 造一个打开器:共用一个「反正差不多」的闭包就是上面那个 bug。 */
			const openPreviewFor = (props) => (path) => openNativePreview(sidebarRight, sessionIdFor(props), path)

			/**
			 * 中栏视图:**产物**(中栏第一眼该看「我拿到了什么」)。
			 * 原来占着中栏的「循环」面板搬进右栏「进展」——那种全景适合与对话并排,
			 * 而中栏这个位子(native 已有 chat / trajectory)该留给**结果**。
			 */
			occupy('conversation.view', () => ({ id: 'clearai-deliverables', order: 15, label: t('产物') }), (props) => h(LocalizedDeliverables, { ...props, openRail, openPreview: openPreviewFor(props) }))
			/**
			 * 中栏视图:**事实**——整条闭环一屏看完(假设是起点,事实是沉淀)。
			 * 放在「产物」之后:先看拿到了什么,再看**凭什么**(以及已经确认了什么)。
			 * 这一格与模型读的 `clear/knowledge/facts/INDEX.md` 是**同一张表**。
			 */
			/**
			 * 注册时必须把**打开器**交下去:这一格的证据出处、事实原件、跳世界树
			 * 全靠这两个回调。漏了它们,界面看着能点、点了什么也不会发生——
			 * 漏了它,「点击证据没反应」。
			 */
			/**
			 * 注册时必须把**打开器**都交下去:证据的四类出处、事实原件、跳世界树全靠它们。
			 * 漏了它们,界面看着能点、点了什么也不会发生。
			 */
			occupy('conversation.view', () => ({ id: 'clearai-facts', order: 20, label: t('事实') }), (props) => h(LocalizedFacts, { ...props, openRail, openSpectator, openPreview: openPreviewFor(props) }))
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
			occupy('conversation.input.plan', { priority: -1 }, (props) => h(PlanChip, { ...props, openRail }))
			occupy('conversation.input.left', { id: 'clearai-continuation', order: 110 }, (props) => h(ContinuationNote, props))
			/**
			 * **续跑档控制搬进工具行**(控制归工具行,事实归输入框下方)。
			 * `conversation.input.left` 是**加法**座位(list),与原生「完全权限」并排——
			 * 同一类东西(我能改的)放同一行,这是原生的排版,不是我们发明的。
			 */
			// 输入框下方的常驻派生条(运行态卡在人这一侧的对应物)
			/**
			 * **输入框下那一条不再注册**:它说的话(阶段 / 完成度 / 当前步)与原生目标提示、
			 * 与工具行那颗计划 chip 重复 ✗,却**独占一行把输入框顶上去** ✗。
			 * 唯一可点、且只有我们知道的那件事(「需要你 N」)已经并进计划 chip(同一行,一点直达世界树)。
			 */
			ctx.effect(() => sessions.list.subscribe(() => {
				for (const sync of seats) sync()
				syncRail()
			}), t('clearai-loop: 席位跟着会话预设进出'))
			syncRail()
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
		exports.__components = { PlanChip, ContinuationNote, Deliverables, WorldTree, BrainTab, Inbox, TreeDetail, Facts, FactShelf, PropositionShelf, ClearAIMark, LOOP_LABEL, PROPOSITION_GROUPS }
		/**
		 * 测试缝之三:命题那一列的**派生**是纯函数(分组、处境、来路、证据链),
		 * 渲染本身没法在没浏览器的地方细究——把它导出去,让测试直接断言派生结果。
		 */
		exports.__propositions = { evidenceOf, transitionsOf, whereOf, judgeOf, originsOf, stepOfFact }
		return module.exports
	},
})
