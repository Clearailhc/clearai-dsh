/**
 * clearai-dsh —— 浏览器半(ClearAI 的面板)。
 *
 * 它注册三个座位:
 *   中栏 `conversation.view`    本体(页眉图 + 已确认事实 + 在流转的命题)
 *   右栏 `sidebarRightTabs`     世界树(计划的步骤与闸门)
 *   输入框 `conversation.input`  计划芯片(步数 + 「需要你 N」)
 * 交付与文件改动走 DSH 原生的卡片,技能走原生技能目录,这里都不另做一份。
 * 除此之外还有一个**只给人**的写入口:人门动作(事实复核等),它走宿主半的
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
		const LOCALE_ZH = {"个节点":"个节点","条边":"条边","适配":"适配","打开图谱工作区":"打开图谱工作区","关闭工作区":"关闭工作区","图组件不可用":"图组件不可用","点节点看知识详情":"点节点看知识详情","按此筛选":"按此筛选","关闭":"关闭","正在取这条知识的读数…":"正在取这条知识的读数…","取不到读数":"取不到读数","宿主没有这个对象的读数(可能刚被废止,或它不在当前词汇里)。":"宿主没有这个对象的读数(可能刚被废止,或它不在当前词汇里)。","父概念":"父概念","形态":"形态","取值":"取值","引用":"引用","子概念":"子概念","相关谓词":"相关谓词","实例":"实例","关系边":"关系边","主词":"主词","相关事实":"相关事实","(还有更多,未列出)":"(还有更多,未列出)","历史":"历史","这条事实没有命题关联(旧账本):不拿文本相等去猜身份。":"这条事实没有命题关联(旧账本):不拿文本相等去猜身份。","推翻条件":"推翻条件","支持到":"支持到","断言":"断言","没有证据引用(旧事实或自判)。":"没有证据引用(旧事实或自判)。","出处":"出处","产生步骤":"产生步骤","复核":"复核","这条事实参与了一对冲突读数(只暴露,不裁决)":"这条事实参与了一对冲突读数(只暴露,不裁决)","滚轮缩放 · 拖动平移 · 拖节点挪位":"滚轮缩放 · 拖动平移 · 拖节点挪位","类型":"类型","被推翻 · 待裁决":"被推翻 · 待裁决","等待中":"等待中","等待人工":"等待人工","发送失败:":"发送失败:","已获首条证据":"已获首条证据","填写缘由后提交":"填写缘由后提交","请填写缘由":"请填写缘由","点击查看详情":"点击查看详情","查看步骤详情":"查看步骤详情","查看词条":"查看词条","撤回需填写缘由后提交":"撤回需填写缘由后提交","暂无数据。发送第一条消息后,此处显示已确立条目与在验命题。":"暂无数据。发送第一条消息后,此处显示已确立条目与在验命题。","暂无命题。每条需一句主张与一句推翻条件;通过验证后升格为事实。":"暂无命题。每条需一句主张与一句推翻条件;通过验证后升格为事实。","暂无目标。目标携带验收判据;判据在结果出现之前登记。":"暂无目标。目标携带验收判据;判据在结果出现之前登记。","暂无目标。验证达门槛且无推翻的命题在验收时升格为事实。":"暂无目标。验证达门槛且无推翻的命题在验收时升格为事实。","暂无证据。先登记判据,后执行验证。":"暂无证据。先登记判据,后执行验证。","此层暂无节点。":"此层暂无节点。","达门槛且无推翻的命题在目标验收时升格为事实(写入 clear/knowledge/facts/)。":"达门槛且无推翻的命题在目标验收时升格为事实(写入 clear/knowledge/facts/)。","修改判据需重新建立世界线":"修改判据需重新建立世界线","在世界树中查看此步骤":"在世界树中查看此步骤","查看此步骤的证据":"查看此步骤的证据","查看评估者":"查看评估者","本体声明尚未进入投影;当前显示规范闭环的镜像,下一拍自动对齐。":"本体声明尚未进入投影;当前显示规范闭环的镜像,下一拍自动对齐。","这些等级尚无证据:跳级不违规,但需说明原因":"这些等级尚无证据:跳级不违规,但需说明原因","此谓词已不在词汇中(可能已废止);存量断言仍可读。":"此谓词已不在词汇中(可能已废止);存量断言仍可读。","未升格:断言仍在命题上":"未升格:断言仍在命题上","撤回缘由(必填)":"撤回缘由(必填)","登记概念":"登记概念","登记谓词":"登记谓词","名称":"名称","单位":"单位","提交":"提交","取消":"取消","废止":"废止","为什么?":"为什么?","提交中…":"提交中…","点节点按概念过滤 · 滚轮缩放 · 拖拽平移":"点节点按概念过滤 · 滚轮缩放 · 拖拽平移","复位":"复位","全景":"全景","还原":"还原","展开图带":"展开图带","图里只画了前":"图里只画了前"," 个节点;全景可看全部":" 个节点;全景可看全部","一条边":"一条边","词汇":"词汇","概念":"概念","谓词":"谓词","已废止":"已废止","健康":"健康","单值":"单值","打开词汇货架(原生预览)":"打开词汇货架(原生预览)","冲突":"冲突"," 对":" 对","只暴露,不裁决;撤回或维持由人决定":"只暴露,不裁决;撤回或维持由人决定","按":"按","过滤":"","清除":"清除","按此谓词过滤":"按此谓词过滤","在图里看":"在图里看"," · 未升格":" · 未升格","释义":"释义","主词域":"主词域","值域":"值域","本体":"本体","本体货架 · ":"本体货架 · ","这里会长出你的本体:已确立的条目与在验的命题。":"这里会长出你的本体:已确立的条目与在验的命题。","本体图":"本体图","实体图":"实体图"," · 支持到 ":" · 支持到 "," · 证据 ":" · 证据 "," 发起":" 发起"," 推翻:":" 推翻:"," 旁观 ":" 旁观 "," 条":" 条"," 次评估者":" 次评估者"," 步":" 步"," 步)":" 步)"," 评估卡":" 评估卡"," 轮":" 轮","(假设达到这一级且无推翻才升格为事实)":"(假设达到这一级且无推翻才升格为事实)","(每次修订留痕,旧值不删)":"(每次修订留痕,旧值不删)","(点一下开右栏「世界树」)":"(点一下开右栏「世界树」)","(点一下开右栏「世界树」看拓扑)":"(点一下开右栏「世界树」看拓扑)","(缺)":"(缺)","(要独立评估)才达门槛":"(要独立评估)才达门槛","),等目标验收时升格为事实":"),等目标验收时升格为事实",":还差 ":":还差 ","clearai 面板:右栏页签类型注册失败 ":"clearai 面板:右栏页签类型注册失败 ","clearai-loop: 席位跟着会话预设进出":"clearai-loop: 席位跟着会话预设进出","世界树":"世界树","事实":"事实","产物":"产物","人审查后决定撤回":"人审查后决定撤回","人已撤回(记录保留)":"人已撤回(记录保留)","撤回事实":"撤回事实","维持原事实":"维持原事实","未走过 ":"未走过 ","确认撤回":"确认撤回","确认撤回(记录保留,不再作为「已知」引用)":"确认撤回(记录保留,不再作为「已知」引用)","会话日志里的原生审批对(不可伪造)":"会话日志里的原生审批对(不可伪造)","依据":"依据","候选":"候选","做什么":"做什么","做法":"做法","出现推翻证据":"出现推翻证据","出现推翻证据(终态,记录保留)":"出现推翻证据(终态,记录保留)","分支":"分支","切回历史的世界树(计划都还在,文档也归档在 clear/goals/plans/)":"切回历史的世界树(计划都还在,文档也归档在 clear/goals/plans/)","判据":"判据","判据:":"判据:","判据待写":"判据待写","升格门槛":"升格门槛","原生预览打开它":"原生预览打开它","原生预览打开它(计划声明的产物)":"原生预览打开它(计划声明的产物)","命题":"命题","命题 · ":"命题 · ","在":"在","在 ":"在 ","多问我":"多问我","完成度 ":"完成度 ","完成度 —":"完成度 —","审批记录":"审批记录","已交付":"已交付","已作废":"已作废","已推翻":"已推翻","已提出":"已提出","已撤回":"已撤回","已收尾 · 存档可看":"已收尾 · 存档可看","已改版":"已改版","已放弃":"已放弃","已替代":"已替代","已确认":"已确认","已确认事实 · ":"已确认事实 · ","已被下一版命题替代(版本留着,不参与当前推理)":"已被下一版命题替代(版本留着,不参与当前推理)","已裁决":"已裁决","已达成":"已达成","已达门槛(":"已达门槛(","已达门槛,已升格为事实":"已达门槛,已升格为事实","待开计划":"待开计划","待推进":"待推进","待裁决":"待裁决","打开 ":"打开 ","打开「事实」那一格并展开这条命题":"打开「事实」那一格并展开这条命题","打开世界树并选中产出这条事实的验证步":"打开世界树并选中产出这条事实的验证步","打开世界树并选中产生这条证据的验证步":"打开世界树并选中产生这条证据的验证步","打开计划文档(原生预览)":"打开计划文档(原生预览)","技能 · 记忆":"技能 · 记忆","推翻":"推翻","推进中":"推进中","支持":"支持","支持到 ":"支持到 ","收敛":"收敛","收起":"收起","收起详情":"收起详情","放行":"放行","旁观写这条裁决的评估者子会话(论证过程)":"旁观写这条裁决的评估者子会话(论证过程)","旁观评估者":"旁观评估者","无法判定":"无法判定","未声明":"未声明","未走:":"未走:","步 ":"步 ","派生 · ":"派生 · ","版本":"版本","状态":"状态","独立评估者":"独立评估者","盘上没有":"盘上没有","盘上没有这个文件":"盘上没有这个文件","目录":"目录","目标":"目标","目标挂起":"目标挂起","续跑:多问我——每个阶段收尾就停下,等你给下一阶段(文档里叫「人在场」)。点一下切成「自己拿主意」。":"续跑:多问我——每个阶段收尾就停下,等你给下一阶段(文档里叫「人在场」)。点一下切成「自己拿主意」。","续跑:自己拿主意——立约即授权,按轮数自己往下跑,只在不可约的判断上开门(文档里叫「无人值守」)。点一下切成「多问我」。":"续跑:自己拿主意——立约即授权,按轮数自己往下跑,只在不可约的判断上开门(文档里叫「无人值守」)。点一下切成「多问我」。","缘由必填":"缘由必填","缺":"缺","自判":"自判","自己拿主意":"自己拿主意","被 ":"被 ","被下一版命题改写":"被下一版命题改写","裁决":"裁决","要你":"要你","观测":"观测","计划":"计划","计划 ":"计划 ","计划受阻,等人处置":"计划受阻,等人处置","计划在建,**等你确认**":"计划在建,**等你确认**","计划已交付 ":"计划已交付 ","计划已收尾(":"计划已收尾(","计划文档":"计划文档","证据":"证据","证据 ":"证据 ","评 ":"评 ","评估":"评估","评估卡":"评估卡","评估者":"评估者","评估者 ":"评估者 ","评估者会话 ":"评估者会话 ","评估者在裁决":"评估者在裁决","读数":"读数","起过 ":"起过 ","边界:":"边界:","这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示已确认的事实与正在流转的命题。":"这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示已确认的事实与正在流转的命题。","进度":"进度","问题:":"问题:","阶段":"阶段","阶段 ":"阶段 ","阶段交界":"阶段交界","需要你 ":"需要你 ","验证":"验证","验证中":"验证中","怎么补这一级?":"怎么补这一级?","收起这一级要交的东西":"收起这一级要交的东西","读不到等级说明":"读不到等级说明","这一级看什么:":"这一级看什么:","这一级要交什么:":"这一级要交什么:","这一级要检查的对象:":"这一级要检查的对象:","这条命题还没写明断言主体:先用 RegisterInstance 把实例连出处登记下来。":"这条命题还没写明断言主体:先用 RegisterInstance 把实例连出处登记下来。","reason 怎么写:":"reason 怎么写:","reason 里必须点到上面这些对象名,不能写「时间不够」。":"reason 里必须点到上面这些对象名,不能写「时间不够」。","跳级本身不违规:要交的是「这一级为什么不适用」的理由,不是这一级的读数。":"跳级本身不违规:要交的是「这一级为什么不适用」的理由,不是这一级的读数。","缺口":"缺口","语言还没立:概念与谓词都还是空的":"语言还没立:概念与谓词都还是空的","命题只有散文主张:没有能被机器比对的断言":"命题只有散文主张:没有能被机器比对的断言","升格的事实没带断言:它进不了实体图":"升格的事实没带断言:它进不了实体图","命题没被任何证据碰过":"命题没被任何证据碰过","断言主体还没落到实体图":"断言主体还没落到实体图","跳级没写理由":"跳级没写理由","概念没有任何结论引用":"概念没有任何结论引用","未登记的缺口类型":"未登记的缺口类型","下一步:":"下一步:","看实体图":"看实体图","切到实体图那一层,看有哪些实例节点":"切到实体图那一层,看有哪些实例节点","这一层还没有实例节点。":"这一层还没有实例节点。","实例靠 RegisterInstance 登记(带出处);断言挂在命题上不算「已知」。":"实例靠 RegisterInstance 登记(带出处);断言挂在命题上不算「已知」。"," 个断言主体还没落到这一层:":" 个断言主体还没落到这一层:","先 RegisterInstance 把实例连出处登记下来;确实不值得留下形态就如实说清":"先 RegisterInstance 把实例连出处登记下来;确实不值得留下形态就如实说清","用 ExplainLevelSkip 写明「为什么这一级在本项目里不适用」":"用 ExplainLevelSkip 写明「为什么这一级在本项目里不适用」","要么在断言里用起来,要么在货架上如实标出「未被引用」":"要么在断言里用起来,要么在货架上如实标出「未被引用」","交给模型的写法:":"交给模型的写法:","推理自检:结论只是自己推了一遍,没有引入任何外部输入":"推理自检:结论只是自己推了一遍,没有引入任何外部输入","已有知识:引用自己或别人手上已有的材料":"已有知识:引用自己或别人手上已有的材料","可复算:照一份能重跑的步骤自己算一遍":"可复算:照一份能重跑的步骤自己算一遍","独立裁决:由另一个评估者读产物后给结论":"独立裁决:由另一个评估者读产物后给结论","人放行:交付前有人看过并批准":"人放行:交付前有人看过并批准","还没建计划:先想清楚要怎么回答":"还没建计划:先想清楚要怎么回答","执行中:有活动计划且还有未落定的步":"执行中:有活动计划且还有未落定的步","阶段边界:当前计划的步都落定了,该结案或起新计划":"阶段边界:当前计划的步都落定了,该结案或起新计划","在等裁决:有交付/结案在飞,或上一次裁决还没回来":"在等裁决:有交付/结案在飞,或上一次裁决还没回来","卡住了:连续几次没通过观测准入,停下等人":"卡住了:连续几次没通过观测准入,停下等人","目标已达成(终局)":"目标已达成(终局)","目标已如实放弃(终局)":"目标已如实放弃(终局)","已登记:某实例在某出处下被登记下来(一等写入口)":"已登记:某实例在某出处下被登记下来(一等写入口)","已升格:来自过了独立裁决的事实断言":"已升格:来自过了独立裁决的事实断言","实体断言:登记那一刻就成立的边,有出处但未经独立裁决":"实体断言:登记那一刻就成立的边,有出处但未经独立裁决","支持到哪一级:所有支持证据里最高的那一级":"支持到哪一级:所有支持证据里最高的那一级","从没走过的等级:已用到最高级之下、一条证据都没有的级":"从没走过的等级:已用到最高级之下、一条证据都没有的级","被推翻次数:收到过几条推翻证据":"被推翻次数:收到过几条推翻证据","无法判定次数:判过但判不出来":"无法判定次数:判过但判不出来","还没有概念与谓词:换一轮只能靠重读散文取用结论":"还没有概念与谓词:换一轮只能靠重读散文取用结论","命题只有散文主张:两条结论是不是在说同一件事只能靠重读判断":"命题只有散文主张:两条结论是不是在说同一件事只能靠重读判断","已升格事实没带断言:进不了实体图,也不能按概念取用":"已升格事实没带断言:进不了实体图,也不能按概念取用","有命题一条证据都没碰过:没看过不等于没问题":"有命题一条证据都没碰过:没看过不等于没问题","断言的主体还没有落到实体图上:句子只挂在命题上,不构成「已知」":"断言的主体还没有落到实体图上:句子只挂在命题上,不构成「已知」","有等级被跳过而没写理由:跳级不违规,但要说清为什么不适用":"有等级被跳过而没写理由:跳级不违规,但要说清为什么不适用","有概念没有任何结论引用:它们还只是约定,不是已知":"有概念没有任何结论引用:它们还只是约定,不是已知","判据没改过:它还是立约时那一份(要原文读账本里的 done_criteria)":"判据没改过:它还是立约时那一份(要原文读账本里的 done_criteria)","判据改动要有一份独立裁决:改「怎样算完成」不能被顺手做掉":"判据改动要有一份独立裁决:改「怎样算完成」不能被顺手做掉","宿主会话服务读不到:这一刻拿不到会话,写盘可能写到错地方":"宿主会话服务读不到:这一刻拿不到会话,写盘可能写到错地方","投影服务读不到:这一刻的读数是空的,不是「没有」":"投影服务读不到:这一刻的读数是空的,不是「没有」"," · 改过 ":" · 改过 "," 次":" 次"," · 最近一次修订的独立裁决:":" · 最近一次修订的独立裁决:","全文在 ":"全文在 ","打开目标文档(原生预览)":"打开目标文档(原生预览)","背景(不参与判定):":"背景(不参与判定):"}
		const LOCALE_EN = {"个节点":" nodes","条边":" edges","适配":"Fit","打开图谱工作区":"Open the graph workspace","关闭工作区":"Close the workspace","图组件不可用":"The graph component is unavailable","点节点看知识详情":"Click a node to see what it means","按此筛选":"Filter by this","关闭":"Close","正在取这条知识的读数…":"Fetching this entry’s readings…","取不到读数":"Could not fetch the readings","宿主没有这个对象的读数(可能刚被废止,或它不在当前词汇里)。":"The host has no readings for this object (it may have just been deprecated, or it is not in the current vocabulary).","父概念":"Parent concept","形态":"Value form","取值":"Value","引用":"Used by","子概念":"Child concepts","相关谓词":"Related predicates","实例":"Instances","关系边":"Relation edges","主词":"Subjects","相关事实":"Related facts","(还有更多,未列出)":" (more not listed)","历史":"History","这条事实没有命题关联(旧账本):不拿文本相等去猜身份。":"This fact has no proposition link (old ledger); text equality is not used to guess identity.","推翻条件":"Refutation condition","支持到":"Supported to","断言":"Assertion","没有证据引用(旧事实或自判)。":"No evidence cites it (an old fact, or self-judged).","出处":"Provenance","产生步骤":"Producing step","复核":"Review","这条事实参与了一对冲突读数(只暴露,不裁决)":"This fact takes part in a conflict reading (surfaced, never adjudicated)","滚轮缩放 · 拖动平移 · 拖节点挪位":"wheel to zoom · drag to pan · drag a node to move it","类型":"Type","被推翻 · 待裁决":"refuted · awaiting decision","等待中":"waiting","等待人工":"awaiting human","发送失败:":"send failed: ","已获首条证据":"first evidence received","填写缘由后提交":"fill in the reason, then submit","请填写缘由":"reason required","点击查看详情":"click for details","查看步骤详情":"view step details","查看词条":"view term","撤回需填写缘由后提交":"fill in the reason before retracting","暂无数据。发送第一条消息后,此处显示已确立条目与在验命题。":"No data yet. After your first message this shows established entries and propositions in verification.","暂无命题。每条需一句主张与一句推翻条件;通过验证后升格为事实。":"No propositions yet. Each needs a one-line claim and a refutation condition; verified ones are promoted to facts.","暂无目标。目标携带验收判据;判据在结果出现之前登记。":"No goal yet. A goal carries its acceptance criterion; the criterion is registered before any result.","暂无目标。验证达门槛且无推翻的命题在验收时升格为事实。":"No goal yet. Verified propositions reaching the threshold without refutation are promoted at acceptance.","暂无证据。先登记判据,后执行验证。":"No evidence yet. Register the criterion first, then verify.","此层暂无节点。":"No nodes on this layer yet.","达门槛且无推翻的命题在目标验收时升格为事实(写入 clear/knowledge/facts/)。":"Propositions reaching the threshold with no refutation are promoted to fact at goal acceptance (written under clear/knowledge/facts/).","修改判据需重新建立世界线":"changing the criterion requires a new worldline","在世界树中查看此步骤":"see this step in Worldlines","查看此步骤的证据":"see the evidence for this step","查看评估者":"view evaluator","本体声明尚未进入投影;当前显示规范闭环的镜像,下一拍自动对齐。":"The ontology declaration has not reached the projection; a canonical-loop mirror is shown and will align at the next step.","这些等级尚无证据:跳级不违规,但需说明原因":"no evidence at these levels: skipping is not a violation, but state why","此谓词已不在词汇中(可能已废止);存量断言仍可读。":"this predicate is no longer in the vocabulary (possibly deprecated); existing assertions remain readable.","未升格:断言仍在命题上":"not yet promoted: the assertion is still on a proposition","撤回缘由(必填)":"Reason for retracting (required)","登记概念":"Register a concept","登记谓词":"Register a predicate","名称":"Label","单位":"Unit","提交":"Submit","取消":"Cancel","废止":"Deprecate","为什么?":"Why?","提交中…":"Submitting…","点节点按概念过滤 · 滚轮缩放 · 拖拽平移":"Click a node to filter by concept · wheel to zoom · drag to pan","复位":"Reset view","全景":"Panorama","还原":"Restore","展开图带":"Show the graph band","图里只画了前":"Showing the first"," 个节点;全景可看全部":" nodes; the panorama shows all","一条边":"An edge","词汇":"Vocabulary","概念":"concepts","谓词":"predicates","已废止":"deprecated","健康":"Health","单值":"single-valued","打开词汇货架(原生预览)":"Open the vocabulary shelf (native preview)","冲突":"Conflict"," 对":" pair(s)","只暴露,不裁决;撤回或维持由人决定":"surfaced, never adjudicated; retracting or keeping is a human decision","按":"Filtered by","过滤":"","清除":"Clear","按此谓词过滤":"Filter by this predicate","在图里看":"See it in the graph"," · 未升格":" · not yet promoted","释义":"Gloss","主词域":"Subject domain","值域":"Range","本体":"Ontology","本体货架 · ":"Ontology shelf · ","这里会长出你的本体:已确立的条目与在验的命题。":"This is where your ontology grows: established entries and propositions still in verification.","本体图":"Ontology graph","实体图":"Entity graph"," · 支持到 ":" · supported to "," · 证据 ":" · evidence "," 发起":" started"," 推翻:":"refuted by:"," 旁观 ":" observe "," 条":" entries"," 次评估者":" evaluators"," 步":" steps"," 步)":" steps)"," 评估卡":" evaluation card"," 轮":" rounds","(假设达到这一级且无推翻才升格为事实)":" (a hypothesis is promoted to fact only at this level and with no refutation)","(每次修订留痕,旧值不删)":" (every revision is kept; old values are not deleted)","(点一下开右栏「世界树」)":" (click to open Worldlines)","(点一下开右栏「世界树」看拓扑)":" (click to see the topology in Worldlines)","(缺)":" (missing)","(要独立评估)才达门槛":" (independent evaluation required) to reach the threshold","),等目标验收时升格为事实":"), and is promoted to fact when the goal is accepted",":还差 ":": short by ","clearai 面板:右栏页签类型注册失败 ":"clearai panel: failed to register the right-sidebar tab type ","clearai-loop: 席位跟着会话预设进出":"clearai-loop: seats come and go with the session's preset","世界树":"Worldlines","事实":"Facts","产物":"Deliverables","人审查后决定撤回":"withdrawn after human review","人已撤回(记录保留)":"withdrawn by a person (record kept)","撤回事实":"Retract the fact","维持原事实":"Keep the fact","未走过 ":"untouched: ","确认撤回":"Confirm retraction","确认撤回(记录保留,不再作为「已知」引用)":"Confirm retraction (the record is kept; it can no longer be cited as known)","会话日志里的原生审批对(不可伪造)":"the native approval pair in the session log (cannot be forged)","依据":"Basis","候选":"candidate","做什么":"What it does","做法":"Approach","出现推翻证据":"refuting evidence appeared","出现推翻证据(终态,记录保留)":"refuting evidence appeared (terminal; record kept)","分支":"Branch","切回历史的世界树(计划都还在,文档也归档在 clear/goals/plans/)":"Switch back to an earlier worldline set (the plans are all still here, and their documents are archived under clear/goals/plans/)","判据":"Criterion","判据:":"Criterion: ","判据待写":"criterion not written","升格门槛":"Promotion threshold","原生预览打开它":"Open it in the native preview","原生预览打开它(计划声明的产物)":"Open it in the native preview (an artifact declared by the plan)","命题":"Propositions","命题 · ":"Propositions · ","在":"in","在 ":"in ","多问我":"Ask me more","完成度 ":"Progress ","完成度 —":"Progress —","审批记录":"approval record","已交付":"delivered","已作废":"voided","已推翻":"refuted","已提出":"proposed","已撤回":"withdrawn","已收尾 · 存档可看":"closed · archived and readable","已改版":"superseded","已放弃":"abandoned","已替代":"superseded","已确认":"confirmed","已确认事实 · ":"Confirmed facts · ","已被下一版命题替代(版本留着,不参与当前推理)":"superseded by a later version of the proposition (the version is kept but takes no part in current reasoning)","已裁决":"decided","已达成":"achieved","已达门槛(":"threshold reached (","已达门槛,已升格为事实":"threshold reached; promoted to fact","待开计划":"no plan yet","待推进":"to advance","待裁决":"awaiting decision","打开 ":"Open ","打开「事实」那一格并展开这条命题":"Open the Facts pane and expand this proposition","打开世界树并选中产出这条事实的验证步":"Open Worldlines and select the verification step that produced this fact","打开世界树并选中产生这条证据的验证步":"Open Worldlines and select the verification step that produced this evidence","打开计划文档(原生预览)":"Open the plan document (native preview)","技能 · 记忆":"Skills · Memory","推翻":"refute","推进中":"in progress","支持":"support","支持到 ":"supported to ","收敛":"converge","收起":"Collapse","收起详情":"Collapse details","放行":"release","旁观写这条裁决的评估者子会话(论证过程)":"Observe the evaluator sub-session that wrote this verdict (the reasoning process)","旁观评估者":"Observe evaluator","无法判定":"inconclusive","未声明":"not declared","未走:":"Not taken: ","步 ":"step ","派生 · ":"derived · ","版本":"Version","状态":"Status","独立评估者":"independent evaluator","盘上没有":"not on disk","盘上没有这个文件":"this file is not on disk","目录":"directory","目标":"Goal","目标挂起":"goal suspended","续跑:多问我——每个阶段收尾就停下,等你给下一阶段(文档里叫「人在场」)。点一下切成「自己拿主意」。":"Continuation: ask me more — it stops at the end of each stage and waits for you to give the next one (called \"attended\" in the docs). Click to switch to \"decide for yourself\".","续跑:自己拿主意——立约即授权,按轮数自己往下跑,只在不可约的判断上开门(文档里叫「无人值守」)。点一下切成「多问我」。":"Continuation: decide for yourself — committing a plan is the authorisation, and it keeps going for a set number of rounds, opening a gate only for decisions it cannot reduce (called \"unattended\" in the docs). Click to switch to \"ask me more\".","缘由必填":"A reason is required","缺":"missing","自判":"self-judged","自己拿主意":"Decide for yourself","被 ":"by ","被下一版命题改写":"rewritten by a later version of the proposition","裁决":"Verdict","要你":"needs you","观测":"Observation","计划":"Plan","计划 ":"Plan ","计划受阻,等人处置":"plan blocked, waiting for a person","计划在建,**等你确认**":"plan is being built, **waiting for your confirmation**","计划已交付 ":"Plan delivered ","计划已收尾(":"Plan closed (","计划文档":"Plan document","证据":"Evidence","证据 ":"Evidence ","评 ":"E","评估":"Evaluation","评估卡":"evaluation card","评估者":"Evaluator","评估者 ":"Evaluator ","评估者会话 ":"Evaluator session ","评估者在裁决":"an evaluator is deciding","读数":"Reading","起过 ":"ran ","边界:":"Scope: ","这个会话还没开始:面板的数据来自会话日志,发第一句话之后,这里会显示已确认的事实与正在流转的命题。":"This session has not started: the panels read the session log, so after your first message this will show confirmed facts and the propositions in flight.","进度":"Progress","问题:":"Question: ","阶段":"Stage","阶段 ":"Stage ","阶段交界":"at a stage boundary","需要你 ":"needs you ","验证":"Verification","验证中":"verifying","怎么补这一级?":"How do I fill in this level?","收起这一级要交的东西":"Hide what this level requires","读不到等级说明":"Level descriptions are unavailable","这一级看什么:":"What this level looks at: ","这一级要交什么:":"What this level must hand in: ","这一级要检查的对象:":"Objects this level must check: ","这条命题还没写明断言主体:先用 RegisterInstance 把实例连出处登记下来。":"This proposition names no assertion subject yet: use RegisterInstance to register the instance together with its provenance.","reason 怎么写:":"How to write the reason: ","reason 里必须点到上面这些对象名,不能写「时间不够」。":"The reason must name those objects above; \"not enough time\" does not count.","跳级本身不违规:要交的是「这一级为什么不适用」的理由,不是这一级的读数。":"Skipping a level is not itself a violation: what is owed is why this level does not apply here, not a reading for it.","缺口":"Gaps","语言还没立:概念与谓词都还是空的":"No language yet: both concepts and predicates are empty","命题只有散文主张:没有能被机器比对的断言":"Prose-only proposition: it has no assertion a machine can compare","升格的事实没带断言:它进不了实体图":"A promoted fact carries no assertion, so it cannot enter the entity graph","命题没被任何证据碰过":"No evidence has touched this proposition","断言主体还没落到实体图":"Assertion subjects have not landed on the entity graph","跳级没写理由":"A level was skipped without a reason","概念没有任何结论引用":"No conclusion cites this concept","未登记的缺口类型":"Unregistered gap type","下一步:":"Next: ","看实体图":"Show the entity graph","切到实体图那一层,看有哪些实例节点":"Switch to the entity layer to see which instance nodes exist","这一层还没有实例节点。":"No instance nodes have landed on this layer yet.","实例靠 RegisterInstance 登记(带出处);断言挂在命题上不算「已知」。":"Instances arrive through RegisterInstance, with provenance; an assertion left on a proposition does not count as known."," 个断言主体还没落到这一层:":" assertion subjects have not landed on this layer: ","先 RegisterInstance 把实例连出处登记下来;确实不值得留下形态就如实说清":"First register the instance with RegisterInstance, provenance included; if it truly does not deserve a lasting shape, say so plainly","用 ExplainLevelSkip 写明「为什么这一级在本项目里不适用」":"Use ExplainLevelSkip to state why this level does not apply in this project","要么在断言里用起来,要么在货架上如实标出「未被引用」":"Either put it to use in an assertion, or mark it plainly on the shelf as uncited","交给模型的写法:":"How to hand it to the model: ","推理自检:结论只是自己推了一遍,没有引入任何外部输入":"Reasoning self-check: the conclusion is only your own derivation, with no external input brought in","已有知识:引用自己或别人手上已有的材料":"Existing knowledge: citing material you or someone else already has at hand","可复算:照一份能重跑的步骤自己算一遍":"Reproducible: work it through yourself from a set of steps that can be re-run","独立裁决:由另一个评估者读产物后给结论":"Independent verdict: another evaluator reads the artifact and gives the conclusion","人放行:交付前有人看过并批准":"Human release: a person has looked at it and approved before delivery","还没建计划:先想清楚要怎么回答":"No plan yet: work out how the question will be answered first","执行中:有活动计划且还有未落定的步":"Executing: there is an active plan with steps still open","阶段边界:当前计划的步都落定了,该结案或起新计划":"Stage boundary: every step of the current plan has landed; close the goal or plan the next stage","在等裁决:有交付/结案在飞,或上一次裁决还没回来":"Awaiting verdict: a delivery or closure is in flight, or the last verdict has not returned","卡住了:连续几次没通过观测准入,停下等人":"Stalled: admission failed several times in a row; stopped and waiting for a person","目标已达成(终局)":"Goal achieved (terminal)","目标已如实放弃(终局)":"Goal abandoned honestly (terminal)","已登记:某实例在某出处下被登记下来(一等写入口)":"Registered: an instance was recorded against a provenance (a first-class write path)","已升格:来自过了独立裁决的事实断言":"Promoted: an assertion from a fact that passed an independent verdict","实体断言:登记那一刻就成立的边,有出处但未经独立裁决":"Asserted edge: holds from the moment it was recorded, with provenance but no independent verdict","支持到哪一级:所有支持证据里最高的那一级":"Supported to: the highest level among supporting evidence","从没走过的等级:已用到最高级之下、一条证据都没有的级":"Untouched levels: levels below the highest one used that have no evidence at all","被推翻次数:收到过几条推翻证据":"Refutations: how many refuting pieces of evidence arrived","无法判定次数:判过但判不出来":"Inconclusive: judged, but the material would not settle it","还没有概念与谓词:换一轮只能靠重读散文取用结论":"No concepts or predicates yet: reusing conclusions means re-reading prose","命题只有散文主张:两条结论是不是在说同一件事只能靠重读判断":"Prose-only claim: whether two conclusions say the same thing can only be decided by re-reading","已升格事实没带断言:进不了实体图,也不能按概念取用":"A promoted fact carries no assertion: it cannot enter the entity graph or be fetched by concept","有命题一条证据都没碰过:没看过不等于没问题":"Some claim has never been touched by evidence: unlooked is not the same as fine","断言的主体还没有落到实体图上:句子只挂在命题上,不构成「已知」":"Assertion subjects have not landed on the entity graph: the sentence hangs on a proposition and is not yet known","有等级被跳过而没写理由:跳级不违规,但要说清为什么不适用":"A level was skipped with no reason recorded: skipping is allowed, but say why it does not apply","有概念没有任何结论引用:它们还只是约定,不是已知":"A concept is cited by no conclusion: it is still only a convention, not knowledge","判据没改过:它还是立约时那一份(要原文读账本里的 done_criteria)":"The criterion has not changed: it is still the one registered at commit time (read done_criteria from the ledger)","判据改动要有一份独立裁决:改「怎样算完成」不能被顺手做掉":"Changing the criterion needs an independent verdict: redefining done must not happen as a side effect","宿主会话服务读不到:这一刻拿不到会话,写盘可能写到错地方":"The host session service is unreadable: no session right now, so writing could land in the wrong place","投影服务读不到:这一刻的读数是空的,不是「没有」":"The projection service is unreadable: readings are empty right now, which is not the same as nothing"," · 改过 ":" · changed "," 次":" times"," · 最近一次修订的独立裁决:":" · latest revision decided by an independent verdict: ","全文在 ":"Full text at ","打开目标文档(原生预览)":"Open the goal document (native preview)","背景(不参与判定):":"Background (not part of the verdict): "}

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
			waiting: t('等待中'),
			stage_boundary: t('阶段交界'),
			auditing: t('评估者在裁决'),
			stalled: t('等待人工'),
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

		/**
		 * **缺口 code → 人话标签**。code 是机器词(`no_language` 这类),**不上屏**——
		 * 人看到的是这一句。允许的 code 在这里是**显式清单**:表本身是惰性代理,
		 * 用 `in` 判会把 `toString` 这类原型上的键也认成缺口类型。
		 * 表里的每一句都在 LOCALE_ZH / LOCALE_EN 里成对登记(与其余面向人的串同一规矩)。
		 */
		const GAP_CODES = ['no_language', 'prose_only_claims', 'unstructured_facts', 'untouched_claims', 'entities_unlanded', 'levels_skipped', 'orphan_terms']
		const GAP_LABEL = lazyTable(() => ({
			no_language: t('语言还没立:概念与谓词都还是空的'),
			prose_only_claims: t('命题只有散文主张:没有能被机器比对的断言'),
			unstructured_facts: t('升格的事实没带断言:它进不了实体图'),
			untouched_claims: t('命题没被任何证据碰过'),
			entities_unlanded: t('断言主体还没落到实体图'),
			levels_skipped: t('跳级没写理由'),
			orphan_terms: t('概念没有任何结论引用'),
		}))

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
			/** 未走过等级那一行:安静,但**可点**——所以给下划线,颜色用链接令牌(它是一条通道)。 */
			levelChannel: { fontSize: 11.5, flex: '0 0 auto', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, color: 'var(--dsw-alias-brand-primary)' },
			/** 等级说明展开区:与 propBody 同一族的左侧竖线,但不占证明那一栏的位。 */
			levelGuide: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--dsw-alias-border-l2)' },
			levelRow: { display: 'flex', flexDirection: 'column', gap: 1, fontSize: 11.5 },
			levelHead: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
			/** 世界树页眉的判据小节:逐条带序号;左侧竖线说明它是「目标的一部分」而不是新面板。 */
			criteria: { display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 8, marginTop: 2, borderLeft: '2px solid var(--dsw-alias-border-l2)' },
			criteriaRow: { display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5 },
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
		 * **目标那一块**(世界树页眉):主张一行 + **判据小节**(逐条带序号)。
		 *
		 * 判据是**多条**的清点清单(`SetGoal` 收 `criteria: string[]`)⇒ 挤成一句「判据:均值差…」
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
								`${t('判据')} · ${criteriaLines.length}${history.length === 0 ? '' : `${t(' · 改过 ')}${history.length}${t(' 次')}${lastAudit === null || lastAudit === undefined ? '' : `${t(' · 最近一次修订的独立裁决:')}${String(lastAudit)}`}`}`,
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
			if (row.supportedLevel === null || row.supportedLevel === undefined) return t('暂无证据。先登记判据,后执行验证。')
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
				out.push({ to: 'alive', on: t('已获首条证据'), by: `${first.id} · ${dash(first.level)} ${gloss(VERDICT, first.verdict)}`, independent: first.evaluator === 'independent' })
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
					? h('div', { style: { ...S.faint, fontSize: 11, marginTop: 2 } }, t('本体声明尚未进入投影;当前显示规范闭环的镜像,下一拍自动对齐。'))
					: null,
			)
		}

		/**
		 * 一条断言里的人与物:**等级说明要点名「这一级要检查的对象」**,名字就从这里来。
		 * 只做展示用拼装,不重算账本(断言在账本里已经是定型的形状)。
		 */
		const assertionSubjectName = (assertion) => {
			const subject = assertion?.subject ?? {}
			const id = String(subject.id ?? '')
			if (id === '') return ''
			const type = String(subject.type ?? '')
			return type === '' ? id : `${type}|${id}`
		}
		const assertionObjectName = (object) => {
			if (object === null || object === undefined) return ''
			const value = String(object.value ?? '')
			if (object.kind !== 'quantity') return value
			const unit = String(object.unit ?? '')
			return unit === '' ? value : `${value} ${unit}`
		}
		const assertionName = (assertion) => {
			const chip = String(assertion?.chip ?? '')
			if (chip !== '') return chip
			const subject = assertionSubjectName(assertion)
			const predicate = String(assertion?.predicate ?? '')
			const object = assertionObjectName(assertion?.object)
			return `${subject} · ${predicate} = ${object}`
		}

		/**
		 * 等级说明**只有一个来源**:折法侧经宿主投影下发的 `knowledgeView`;
		 * 它的底稿是 `preset/plugins/prompts.js` 里那五级说明。
		 * 客户端**绝不手抄第二份**——两处各写一套,漂移是迟早的事。
		 * 取不到就返回 null,由调用点如实说「读不到等级说明」。
		 */
		const levelTableOf = (data) => {
			const view = data?.knowledgeView ?? null
			const table = view?.levels ?? view?.glossary ?? null
			return table !== null && typeof table === 'object' ? table : null
		}

		/**
		 * **等级通道**:未走过的等级不再是一句陈述,而是一行**可点**的东西。
		 *
		 * 点开看到的是 `ExplainLevelSkip` 要交的三件:
		 *   ① 这一级要检查的对象(这条命题自己的断言主体——reason 里必须点到它们);
		 *   ② reason 该怎么写(以及模板);
		 *   ③ 这一级在这一档里可能不适用的理由从哪来说(等级说明的 `plain` / `where`)。
		 *
		 * 「跳过」本身不违规,所以这里**不劝、不拦**:只把要交的东西摆出来。
		 */
		const LevelGuide = ({ row, data }) => {
			const untouched = Array.isArray(row?.untouchedLevels) ? row.untouchedLevels : []
			const table = levelTableOf(data)
			const objects = (Array.isArray(row?.assertions) ? row.assertions : []).map(assertionName).filter((text) => text !== '')
			const hypothesis = String(row?.id ?? '')
			return h(
				'div',
				{ style: S.levelGuide },
				...untouched.map((level) => {
					const info = table === null ? null : table[level] ?? null
					const plain = info === null ? null : String(info.plain ?? '')
					const where = info === null ? null : String(info.where ?? '')
					const nextAction = info === null ? null : String(info.nextAction ?? '')
					return h(
						'div',
						{ key: level, style: S.levelRow },
						h('div', { style: S.levelHead }, `${level} · ${plain === null || plain === '' ? t('读不到等级说明') : t(plain)}`),
						where === null || where === '' ? null : h('div', { style: S.faint }, `${t('这一级看什么:')}${t(where)}`),
						nextAction === null || nextAction === '' ? null : h('div', { style: S.faint }, `${t('这一级要交什么:')}${t(nextAction)}`),
						h(
							'div',
							{ style: S.faint },
							`${t('这一级要检查的对象:')}${objects.length === 0 ? t('这条命题还没写明断言主体:先用 RegisterInstance 把实例连出处登记下来。') : objects.join(';')}`,
						),
						h('div', { style: S.faint }, `${t('reason 怎么写:')}${t('reason 里必须点到上面这些对象名,不能写「时间不够」。')}`),
						h('div', { style: S.faint }, t('跳级本身不违规:要交的是「这一级为什么不适用」的理由,不是这一级的读数。')),
						/**
						 * 模板本身是**代码**,不翻译;它前面那句话是人话,走 t()。
						 * (verb 名与字段名是模型的接口,换语言也不该换。)
						 */
						h('div', { style: S.faint }, t('交给模型的写法:'), h('span', { style: S.mono }, ` ExplainLevelSkip { hypothesis: '${hypothesis}', levels: ['${level}'], reason: '…' }`)),
					)
				}),
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
			const untouched = Array.isArray(row.untouchedLevels) ? row.untouchedLevels : []
			/**
			 * 等级通道的展开是**界面状态**(点了哪一条,不进账本)。
			 * `levelsOpen` 是给测试缝的显式覆盖:真 React 里点不动的地方,测试要能直接渲染展开态。
			 */
			const [levelsShown, setLevelsShown] = React.useState(false)
			const levelsOpen = props.levelsOpen ?? levelsShown
			return h(
				'div',
				{ style: open === true ? S.propOpen : S.propRow },
				h(
					'div',
					{ style: S.propHead, onClick: onToggle },
					h('span', { style: { ...S.propClaim, ...(row.status === 'refuted' || row.status === 'superseded' ? S.stale : {}) } }, dash(row.claim)),
					h('span', { style: S.propWhere }, whereOf(data, row)),
					h('span', { style: S.propJudge }, `${gloss(HYPOTHESIS, row.status)} · ${judgeOf(data, row)}`),
					/**
					 * **从没被走过的等级**:等级越往上,系统补的独立性越多(独立裁决、人放行),
					 * 所以「直接跳到高等级」这件事本身不违规(首次测量没有廉价路),但必须看得见——
					 * 与「这条假设从没被证据碰过」标成「未触及」同一条规矩。
					 *
					 * 它同时是**通道**,不是陈述:点开就是 `ExplainLevelSkip` 要交的东西
					 * (要检查哪些对象、reason 怎么写、这一级为什么可能不适用)。
					 * 只说「尚无证据」而不给出口,读者只会知道欠账、不知道还法。
					 */
					untouched.length === 0
						? null
						: h(
								'span',
								{
									style: S.levelChannel,
									title: t('这些等级尚无证据:跳级不违规,但需说明原因'),
									onClick: (event) => {
										event?.stopPropagation?.()
										setLevelsShown(levelsOpen !== true)
									},
								},
								`${t('未走过 ')}${untouched.join('/')} · ${levelsOpen === true ? t('收起这一级要交的东西') : t('怎么补这一级?')}`,
							),
				),
				h(AssertionChips, { assertions: row.assertions, ui: data.assertionUI, promoted: false }),
				levelsOpen === true ? h(LevelGuide, { row, data }) : null,
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
											t('在世界树中查看此步骤'),
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
					? h('div', { style: S.faint }, t('暂无命题。每条需一句主张与一句推翻条件;通过验证后升格为事实。'))
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

		/**
		 * 一条缺口的**去处**(没有就返回 null,由行里如实只写「下一步」)。
		 *
		 * 「可点则跳」不是每条都能跳:缺口是**账本自己算出来的欠账**,有的欠在模型那一侧
		 * (要用哪个动词补),有的欠在本面板别处。能跳到具体去处的才挂链接;
		 * 跳不到的**不假装可点**——那会教人学会「点了没反应」。
		 */
		const gapTarget = (code, data, onShowEntity) => {
			if (code === 'entities_unlanded' && typeof onShowEntity === 'function') return { label: t('看实体图'), title: t('切到实体图那一层,看有哪些实例节点'), run: onShowEntity }
			if ((code === 'no_language' || code === 'orphan_terms') && typeof data?.openPreview === 'function') return { label: t('打开词汇货架(原生预览)'), title: t('原生预览打开它'), run: () => data.openPreview('clear/ontology/domain.md') }
			return null
		}

		/**
		 * **缺口行**:「结构完整」这类结论之外,这一栏把**欠账**摆出来。
		 *
		 * 每条 = code 的人话 + 计数 + 现状(折法侧写好的 `detail`)+ 下一步(`nextAction`),
		 * 能跳的去处挂成链接。缺口的算法在折法侧(账本是唯一生产者),这里**不重算**——
		 * 客户端自己再算一套,两边迟早各说各话。
		 */
		const GapShelf = ({ data, onShowEntity }) => {
			const gaps = Array.isArray(data?.knowledge?.gaps) ? data.knowledge.gaps : []
			if (gaps.length === 0) return null
			return h(
				Section,
				{ title: `${t('缺口')} ${gaps.length}` },
				...gaps.map((gap, index) => {
					const code = String(gap?.code ?? '')
					const label = GAP_CODES.includes(code) ? GAP_LABEL[code] : null
					const count = typeof gap?.count === 'number' ? gap.count : null
					const target = gapTarget(code, data, onShowEntity)
					const detail = String(gap?.detail ?? '')
					const nextAction = String(gap?.nextAction ?? '')
					return h(
						'div',
						{ key: `${code}-${index}`, style: S.row },
						h(
							'div',
							{ style: S.inline },
							label === null
								? h('span', { style: S.tagStrong, title: code }, t('未登记的缺口类型'))
								: h('span', { style: S.tagStrong }, label),
							count === null ? null : h('span', { style: S.faint }, String(count)),
							target === null ? null : h(Link, { title: target.title, onClick: target.run }, target.label),
						),
						detail === '' ? null : h('div', { style: S.faint }, t(detail)),
						nextAction === '' ? null : h('div', { style: S.dim }, `${t('下一步:')}${t(nextAction)}`),
					)
				}),
			)
		}

		/** **事实货架**:已确认、可作已知的那一层。每条都带边界——没有边界的事实没人敢用。 */
		function FactShelf(props) {
			const base = props.data ?? (typeof props.useProjection === 'function' ? props.useProjection('clearai') : undefined) ?? {}
			const data = { ...base, openPreview: props.openPreview ?? base.openPreview, openRail: props.openRail ?? base.openRail, openSpectator: props.openSpectator ?? base.openSpectator }
			const facts = data.facts ?? []
			return h(
				Section,
				{ title: `${t('本体货架 · ')}${facts.length}`, mark: true },
				facts.length === 0
					? h(
							'div',
							{ style: S.faint },
							data.goal === null || data.goal === undefined
								? t('暂无目标。验证达门槛且无推翻的命题在验收时升格为事实。')
								: t('达门槛且无推翻的命题在目标验收时升格为事实(写入 clear/knowledge/facts/)。'),
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
									h(
										'div',
										{ style: S.factClaim },
										/**
										 * 复核状态直接说在标题旁边:一条**已撤回**的事实仍留在这里(P5:记录不删),
										 * 但它已经不能当「已知」引用了——不写出来,读者会照旧引用它。
										 */
										dash(row.text),
										row.review?.decision === 'retracted'
											? h('span', { style: { ...S.tag, marginLeft: 6 } }, t('人已撤回(记录保留)'))
											: row.refuted === true
												? h('span', { style: { ...S.tag, marginLeft: 6 } }, t('被推翻 · 待裁决'))
												: null,
									),
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
													t('在世界树中查看此步骤'),
												),
									/**
									 * **冲突内联标记**:冲突行只给指针,受害的条目自己也要亮出来——
									 * 读者扫到这一行时不必回头去对那一行指针。
									 */
									data.conflictOf !== undefined && data.conflictOf.has(row.id)
										? h('div', { style: S.row }, h('span', { style: { ...S.tag, borderColor: 'rgba(220,38,38,0.7)', color: '#dc2626' } }, `${t('冲突')} · ${String(data.conflictOf.get(row.id).predicate)}`), h('span', { style: S.faint }, ` ${data.conflictOf.get(row.id).sides.map((side) => `${side.fact}(${side.value})`).join(' ')}`))
										: null,
									h(AssertionChips, { assertions: row.assertions, ui: data.assertionUI, promoted: true }),
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
			/** 本体格的界面状态:图层次/全景/图带开关/过滤/芯片展开/词汇区开关。全是界面状态,不进账本。 */
			const [layer, setLayer] = React.useState('ontology')
			/** 图谱工作区是否打开(真正的全屏 overlay,不是把图带拉高)。界面状态,不进账本。 */
			const [workspace, setWorkspace] = React.useState(false)
			const [bandOpen, setBandOpen] = React.useState(true)
			const [filter, setFilter] = React.useState(null)
			const [chipKey, setChipKey] = React.useState(null)
			const [vocabOpen, setVocabOpen] = React.useState(null)
			const incoming = useFocus(factsFocus)
			if (projected === undefined || projected === null) {
				return h('div', { style: S.wrap }, h('div', { style: S.bar }, h('span', { style: S.title }, t('本体'))), h(Empty, null, t('暂无数据。发送第一条消息后,此处显示已确立条目与在验命题。')))
			}
			const data = { ...projected, openPreview: props.openPreview, openRail: props.openRail, openSpectator: props.openSpectator }
			const facts = data.facts ?? []
			const propositions = (data.goal?.hypotheses ?? []).filter((row) => row.status !== 'confirmed')
			/** 外面点进来的聚焦优先;手动点行仍然有效(聚焦为 null 时用它)。 */
			const focused = incoming === null || incoming === undefined ? null : propositionForStep(data, incoming.step)
			const open = focused ?? manual
			/**
			 * **本体层**:没有词条时下面这一切都不存在(零成本契约)——
			 * 图带、冲突行、过滤、芯片、维护区,每一个都以「有东西可说」为前提。
			 */
			const lexicon = data.lexicon ?? null
			const hasVocabulary = lexicon !== null && ((lexicon.terms ?? []).length > 0 || (lexicon.predicates ?? []).length > 0)
			const conflicts = hasVocabulary === true ? (lexicon.conflicts ?? []) : []
			/** factId → 它卷入的那对冲突(内联标记用;同一事实卷多对时取第一对)。 */
			const conflictOf = new Map()
			for (const conflict of conflicts) for (const side of conflict.sides) if (typeof side.fact === 'string' && !conflictOf.has(side.fact)) conflictOf.set(side.fact, conflict)
			/** 过滤词条:图带点概念节点或芯片动作都会给词条 id;文本兜底匹配。 */
			const filterTerm = filter === null ? null : ((lexicon?.terms ?? []).find((item) => item.id === filter) ?? (lexicon?.predicates ?? []).find((item) => item.id === filter) ?? { id: filter, label: filter, aliases: [] })
			const matchedFacts = filterTerm === null ? facts : facts.filter((row) => termMatches(filterTerm, row))
			const matchedPropositions = filterTerm === null ? propositions : propositions.filter((row) => termMatches(filterTerm, row))
			const filteredData = filterTerm === null ? data : { ...data, facts: matchedFacts, goal: { ...data.goal, hypotheses: matchedPropositions } }
			/** 断言芯片的公共道具:词条卡从词汇里查,动作回连过滤与图带。 */
			const assertionUI = hasVocabulary === true ? { lexicon, openKey: chipKey, onToggle: (key) => setChipKey(chipKey === key ? null : key), onFilter: (id) => { setFilter(id); setChipKey(null) }, onGraph: () => { setBandOpen(true); setChipKey(null) } } : null
			filteredData.assertionUI = assertionUI
			filteredData.conflictOf = conflictOf
			/** 语言先于句子:0 条目 0 命题而有词条时,维护区自动展开。 */
			const vocabAutoOpen = vocabOpen === null ? (facts.length === 0 && propositions.length > 0 === false && hasVocabulary === true) : vocabOpen
			const vocabActuallyOpen = vocabOpen === null ? (facts.length === 0 && propositions.length === 0 && hasVocabulary === true) : vocabOpen
			/**
			 * **缺口**:折法侧算好的欠账(客户端的唯一来源是投影)。空数组 = 不欠,这一栏整块不出现。
			 * 实体图空态要用的那条读数也从这里取:`entities_unlanded` 的 count
			 * 就是「多少个断言主体还没有落到实体图」。
			 */
			const gaps = Array.isArray(data.knowledge?.gaps) ? data.knowledge.gaps : []
			const unlandedRow = gaps.find((gap) => gap?.code === 'entities_unlanded')
			const unlanded = typeof unlandedRow?.count === 'number' ? unlandedRow.count : null
			/** 缺口行的去处之一:把图带切到实体层(空态的出口就在这一层)。 */
			const showEntity = () => {
				setLayer('entity')
				setBandOpen(true)
			}
			const bar = h(
				'div',
				{ style: S.bar },
				h('span', { style: S.title }, t('本体')),
			)
			if (hasVocabulary === false) {
				/** 零成本:没有词条时,这一格与从前逐像素相同(两个货架 + 页眉)——但缺口照报。 */
				return h('div', { style: S.wrap }, bar, h(GapShelf, { data, onShowEntity: showEntity }), h(FactShelf, { data }), h(PropositionShelf, {
					data,
					open,
					onToggle: (id) => {
						factsFocus.set(null)
						setManual(open === id ? null : id)
					},
				}))
			}
			return h(
				'div',
				{ style: S.wrap },
				bar,
				/** 缺口行:欠账摆在最前面(它决定这个目标现在能不能收口),每条都带下一步。 */
				h(GapShelf, { data, onShowEntity: showEntity }),
				/** 冲突行:仅当有冲突。一行指针 + 内联标记,不做大区块(例外才打扰)。 */
				conflicts.length > 0
					? h(
							'div',
							{ style: S.section },
							h('div', { style: S.head }, `${t('冲突')} ${conflicts.length}${t(' 对')}`),
							...conflicts.map((conflict, index) =>
								h('div', { key: `cf-${index}`, style: S.row }, `${String(conflict.predicate)} · ${String(conflict.subject)}:`, ...conflict.sides.map((side, sideIndex) => h('span', { key: `cf-${index}-${sideIndex}`, style: S.faint }, ` ${String(side.fact ?? '?')}(${String(side.value)})`)), ` —— ${t('只暴露,不裁决;撤回或维持由人决定')}`),
							),
						)
					: null,
				bandOpen === false
					? h('div', { style: S.section }, h('span', { style: S.chipAction, onClick: () => setBandOpen(true) }, t('展开图带')))
					: h(GraphBand, { lexicon, layer, unlanded, onLayer: setLayer, onFilter: (id) => setFilter(filter === id ? null : id), sessionId: data.sessionId, fullscreen: workspace, onToggleFullscreen: () => setWorkspace(workspace !== true) }),
				/** 过滤状态行:仅当过滤激活;N/M 说真话,✕ 一键清除。 */
				filterTerm === null
					? null
					: h(
							'div',
							{ style: S.inline },
							h('span', { style: S.tag }, `${t('按')}「${String(filterTerm.label ?? filterTerm.id)}」${t('过滤')}:${matchedFacts.length + matchedPropositions.length}/${facts.length + propositions.length}${t(' 条')}`),
							h('span', { style: S.chipAction, onClick: () => setFilter(null) }, t('清除')),
						),
				h(FactShelf, { data: filteredData }),
				h(PropositionShelf, {
					data: filteredData,
					open,
					onToggle: (id) => {
						// 手动点行:先清掉外面的聚焦(否则它一直压着手动选择,点了没反应 ✗)
						factsFocus.set(null)
						setManual(open === id ? null : id)
					},
				}),
				h(VocabBlock, { lexicon, open: vocabActuallyOpen, onToggle: () => setVocabOpen(vocabActuallyOpen !== true), openPreview: props.openPreview, sessionId: data.sessionId }),
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
		 * 唯一的关系就是**步骤上登记的 `tests.hypothesis`** —— 不猜:这一步没登记命题
		 * (自判的 L0 步骤常常没有)就返回 `null`,界面因此**不乱展开**任何一条命题 ✓。
		 * (第一版这里写过一个"退一步看证据挂谁"的回退,而它又去查同一个索引 ⇒ 循环 ✗,已删。)
		 */
		function propositionForStep(data, stepId) {
			if (typeof stepId !== 'string' || stepId === '') return null
			const hypothesis = (data?.stepIndex ?? {})[stepId]?.tests?.hypothesis
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
				return h('div', { style: S.wrap }, h('div', { style: S.bar }, h('span', { style: S.title }, t('世界树'))), h(Empty, null, t('暂无计划。建立后此处显示计划的步骤与闸门。')))
			}
			const rows = treeRows(plan)
			/** 页眉那一句:计划的首个非空行,过长再截(整篇在 tooltip 与「计划文档」里)。 */
			const briefLine = String(plan.brief ?? '').split('\n').map((line) => line.trim()).find((line) => line !== '' && !line.startsWith('#')) ?? ''
			const briefText = String(plan.brief ?? '').trim()
			const titleText = briefLine === '' ? plan.id : `${brief(briefLine, 44)} · ${plan.id}`
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
													? { opacity: 0.6, textDecoration: 'line-through' }
													: {}),
										},
									},
									rowLabel(row),
								),
								stat === null ? null : h(
									'span',
									{ style: { flex: '0 0 auto', display: 'flex', gap: 6, ...S.faint, marginLeft: 'auto' } },
									stat.marks.loops.rounds > 0
										? h('span', { title: `${stat.marks.loops.rounds}${t(' 轮')}${stat.marks.loops.fails > 0 ? ` · 其中 ${stat.marks.loops.fails} 次被驳回` : ''}` }, `∞${stat.marks.loops.rounds}`)
										: null,
									stat.judges > 0 ? h('span', { title: `${t('起过 ')}${stat.judges}${t(' 次评估者')}` }, `${t('评 ')}${stat.judges}`) : null,
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
					h('span', { style: S.head }, `${t('步 ')}${step.ordinal} · ${step.id}`),
					h(Link, { onClick: () => props.onClose?.(), title: t('收起详情') }, h('span', { style: S.faint }, t('收起'))),
				),
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
											t('查看此步骤的证据'),
										),
									),
						),
				evidence.length === 0 && audits.length === 0
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
						),
			)
		}

		/**
		 * 人门区。**人门优先于运行态**——等人的事永远最先说。
		 * 写通道只给人:模型能调的工具面里没有这些动词。按下去之后由宿主平面把它变成一条
		 * 带结构化标记的用户消息,折进投影(`by:'user'`),面板随投影自己更新。
		 */
		function Inbox(props) {
			const data = props.data
			const sessionId = data === null || data === undefined ? null : data.sessionId
			const items = data === null || data === undefined || !Array.isArray(data.inbox) ? [] : data.inbox
			const [busy, setBusy] = React.useState(null)
			const [error, setError] = React.useState(null)
			/**
			 * 撤回一条事实要写缘由,按事实 id 分开存(同一屏上可能有多条被推翻的事实)。
			 * **机制只记录**,「值得索要理由」这条规矩在界面上——
			 * 撤回改变的是下一轮模型会引用什么,而「维持原事实」不改任何面,所以它是一键。
			 */
			const [retractFact, setRetract] = React.useState(null)
			const [retractNote, setRetractNote] = React.useState('')
			if (items.length === 0) return null
			const send = (item, extra) => {
				setBusy(`${item.kind}:${item.plan || ''}:${item.step || ''}`)
				setError(null)
				/**
				 * `value` 是**标的**(比如被推翻的那条事实的 id):宿主据此先核它还在不在,
				 * 核不到就回 409,而不是收下一条什么都不改的动作。
				 */
				const body = { sessionId, action: item.human_action, plan: item.plan ?? null, value: item.value ?? null, note: extra?.note ?? null }
				fetch('/api/clearai/gate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
					.then(readResponse)
					.then((result) => {
						if (result.ok !== true) setError(result.error)
					})
					.catch((thrown) => setError(String(thrown?.message ?? thrown)))
					.finally(() => setBusy(null))
			}
			/**
			 * 收件箱里只有**真门**。门要什么由**数据**说(`item.needs`),不在这里按 kind 猜:
			 *   · `click` ⇒ 给按钮(事实复核:撤回 / 维持);
			 *   · `word`  ⇒ 给**一句提示**(解除阻塞这类门本来就不是点击能表达的)。
			 */
			const label = (item) => (item.needs === 'click' && item.kind === 'fact_refutation' ? t('撤回事实') : null)
			return h(
				'div',
				{ style: S.gate },
				h('div', { style: S.head }, `${t('需要你 ')}${items.length}`),
				...items.map((item, index) => {
					return h(
						'div',
						{ key: `${item.kind}-${index}`, style: S.gateRow, title: item.kind },
						/** 机器词**不上屏** —— 进 tooltip,给人看的是标题那句话。 */
						label(item) === null ? null : h('span', { style: S.tagStrong }, `${t('要你')}${label(item)}`),
						h('span', null, item.title),
						h('span', { style: S.faint }, item.summary),
						label(item) !== null
							? h(
									'button',
									{
										type: 'button',
										className: 'clearai-btn',
										disabled: busy !== null,
										/** 撤回先开缘由框(两步):「为什么撤回」是最值得留下的那句话。 */
										onClick: () => setRetract(item.value),
										title: t('撤回需填写缘由后提交'),
									},
									label(item),
								)
							: item.needs === 'word'
								? h('span', { style: { ...S.faint, opacity: 0.9 } }, `${t('')}${item.ask ?? '说一句你的决定'}`)
								: null,
						/**
						 * 事实复核那道门有**两个**结局,而且两个都必须能一键落地:
						 * 只给「撤回」的话,「判定证据不可靠、维持原事实」就只能靠不说话——
						 * 而门开着会按住续跑,于是系统一直等一个永远不会来的动作。
						 */
						item.kind === 'fact_refutation'
							? h(
									'button',
									{ type: 'button', className: 'clearai-btn', disabled: busy !== null, onClick: () => send({ ...item, human_action: 'keep_fact' }, null) },
									t('维持原事实'),
								)
							: null,
						item.kind === 'fact_refutation' && retractFact === item.value
							? h(
									'span',
									{ style: { display: 'inline-flex', gap: 6, alignItems: 'center' } },
									h('input', {
										value: retractNote,
										placeholder: t('撤回缘由(必填)'),
										onChange: (event) => setRetractNote(event.target.value),
										style: { fontSize: 11.5, padding: '2px 6px', borderRadius: 6, border: '.5px solid var(--dsw-alias-border-l3)', background: 'transparent', color: 'inherit', minWidth: 140 },
									}),
									h(
										'button',
										{
											type: 'button',
											className: 'clearai-btn',
											disabled: busy !== null || retractNote.trim() === '',
											onClick: () => send(item, { note: retractNote.trim() }),
											title: retractNote.trim() === '' ? t('缘由必填') : t('确认撤回(记录保留,不再作为「已知」引用)'),
										},
										t('确认撤回'),
									),
								)
							: null,
					)
				}),
				error === null ? null : h('div', { style: S.faint }, `${t('发送失败:')}${error}`),
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
			 * 一格只放**一个符号**:进度。要人注意的事不换符号,只换颜色。
			 *
			 * 这条工具行上的格子只承担**可点、且只有我们知道**的两句:
			 *   需要你 N(人门计数,点了开世界树)· 续跑停着(为什么停,人是可以处置的)。
			 * 「已达成 · 100%」那一类与原生目标提示说的是同一件事,不在这里重复。
			 */
			const inboxCount = Array.isArray(data?.inbox) ? data.inbox.length : 0
			const pending = plan.confirmationPending === true
			const blocked = plan.blocked !== null && plan.blocked !== undefined
			const attention = pending || blocked
			/**
			 * 符号**恒定是进度**(形状稳定才学得会):要人注意不在符号上换字,
			 * 而是换颜色(与世界树同一条规矩:形状说状态,别让人去猜一个 '?')。
			 * 「需要你 N」就在这一格(`waiting`):门开着是**事实面**上最要紧的一句,
			 * 而它可点——点一下开世界树,那里才看得到要裁什么。
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
		 * **断言芯片行**:一条已确立条目(或命题)的断言,点开就地展开词条卡。
		 *
		 * 为什么是「就地展开」而不是跳走:芯片的用途就是**读这条结论时**顺手看清
		 * 「这个谓词什么意思、是不是单值、依据是什么」——跳一步,读者的上下文就断了。
		 * 词条卡的两个人物(筛选此概念 / 在图里看)由外层经 `ui` 递进来。
		 */
		const AssertionChips = ({ assertions, ui, promoted }) => {
			const rows = Array.isArray(assertions) ? assertions : []
			if (ui === null || ui === undefined || rows.length === 0) return null
			return h(
				'div',
				{ style: S.chipRow },
				...rows.map((assertion, index) => {
					const key = `${promoted === false ? 'p' : 'f'}-${index}`
					const open = ui.openKey === key
					const predicate = (ui.lexicon?.predicates ?? []).find((item) => item.id === assertion?.predicate) ?? null
					const label = String(assertion?.chip ?? `${String(assertion?.subject?.id ?? '')} · ${String(assertion?.predicate ?? '')}`)
					const card =
						open === false
							? null
							: h(
									'div',
									{ style: S.chipCard },
									predicate === null
										? h('div', { style: S.faint }, t('此谓词已不在词汇中(可能已废止);存量断言仍可读。'))
										: h('div', null,
												h('div', { style: S.chipCardTitle }, `${predicate.label ?? predicate.id} · ${predicate.id}`),
												h('div', { style: S.kv }, h('span', { style: S.faint }, `${t('释义')}:`), ` ${String(predicate.gloss ?? '—')}`),
												h('div', { style: S.kv }, h('span', { style: S.faint }, `${t('主词域')}:`), ` ${String(predicate.domain ?? '—')}`),
												h('div', { style: S.kv }, h('span', { style: S.faint }, `${t('值域')}:`), ` ${predicate.range?.term ?? (predicate.range?.form ?? '—') + (predicate.range?.unit ?? '')}`),
												h('div', { style: S.kv }, h('span', { style: S.faint }, `${t('单值')}:`), ` ${predicate.functional === true ? '✓' : '—'}`),
												h('div', { style: S.kv }, h('span', { style: S.faint }, `${t('依据')}:`), ` ${String(predicate.basis ?? '—')}`),
											),
									h(
										'div',
										{ style: S.chipActions },
										h('span', { style: S.chipAction, onClick: () => ui.onFilter(assertion?.predicate ?? null) }, t('按此谓词过滤')),
										h('span', { style: S.chipAction, onClick: () => ui.onGraph() }, t('在图里看')),
									),
								)
					return h(
						'div',
						{ key, style: S.chipWrap },
						h(
							'span',
							{
								style: open === true ? { ...S.chip, borderColor: 'rgba(74,163,255,0.9)' } : S.chip,
								onClick: () => ui.onToggle(key),
								title: promoted === false ? t('未升格:断言仍在命题上') : t('查看词条'),
							},
							`${label}${promoted === false ? t(' · 未升格') : ''}`,
						),
						card,
					)
				}),
			)
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
		 * **知识 Inspector**:点击图上的节点或边之后,回答「这是什么、凭什么信、谁改过它」。
		 *
		 * 为什么要有它:图能画出来不等于图是知识入口。从前点一个节点只得到「按此过滤」——
		 * 读的人仍然不知道这个词是什么意思。现在那条链补齐:
		 *
		 * ```text
		 * 概念 → 定义 / 父概念 / 子概念 / 用它的谓词 / 实例 / 相关事实 / 登记修订史
		 * 断言边 → 事实 → 命题 → 证据 → 出处 → 产生步骤 → 复核态
		 * ```
		 *
		 * 数据**不在这里拼**:组装住在宿主半的 `inspectGraphSelection`(判据只有一处),
		 * 这一层只请求与渲染。请求失败不清空旧详情——把上一次的结果换成一片空白,
		 * 读的人会以为「这条知识没了」。
		 */
		const GraphInspector = ({ selection, sessionId, onFilter, onClose, inspector: injected }) => {
			const [state, setState] = React.useState({ loading: false, inspector: null, error: null })
			const key = selection === null ? '' : `${selection.kind}:${selection.id}`
			React.useEffect(() => {
				/**
				 * 宿主已经把这份读数喂进来时不再问一次。这条缝同时服务两件事:
				 * 全屏工作区(一次取好、两处渲染)与测试(同步渲染桩里等不到异步结果)。
				 */
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
			const line = (label, value) => (value === null || value === undefined || value === '' ? null : h('div', { style: S.kv }, h('span', { style: S.faint }, `${t(label)}:`), ` ${String(value)}`))
			/** 事实的一张卡:链的每一段都在这里,读的人不必再去别处找。 */
			const factCard = (fact, index) =>
				h(
					'div',
					{ key: `f-${fact.id ?? index}`, style: { ...S.chipCard, marginTop: 6 } },
					h('div', { style: S.chipCardTitle }, `${String(fact.id ?? '')} · ${String(fact.text ?? '')}`),
					h('div', { style: S.faint }, `${String(fact.level ?? '—')} · ${String(fact.status ?? '')}${fact.at === null || fact.at === undefined ? '' : ` · ${new Date(fact.at).toISOString().slice(0, 19)}`}`),
					line('边界', fact.scope),
					fact.hypothesis === null
						? h('div', { style: S.faint }, t('这条事实没有命题关联(旧账本):不拿文本相等去猜身份。'))
						: h(
								'div',
								null,
								line('命题', `${fact.hypothesis.id} — ${String(fact.hypothesis.claim ?? '')}`),
								line('推翻条件', fact.hypothesis.refuteWhen),
								line('支持到', `${String(fact.hypothesis.supportedLevel ?? '—')}${fact.hypothesis.refutations > 0 ? ` · 推翻 ${fact.hypothesis.refutations}` : ''}`),
							),
					...fact.assertions.map((assertion, position) => h('div', { key: `a-${position}`, style: S.kv }, h('span', { style: S.faint }, `${t('断言')}:`), ` ${String(assertion.chip ?? '')}`)),
					fact.evidence.length === 0
						? h('div', { style: S.faint }, t('没有证据引用(旧事实或自判)。'))
						: h(
								'div',
								null,
								...fact.evidence.map((item) =>
									h(
										'div',
										{ key: `e-${item.id}` },
										line('证据', `${item.id} · ${item.verdict} · ${item.level} · ${item.evaluator}`),
										item.basis === null ? null : line('依据', item.basis),
										item.origins.length === 0 ? null : line('出处', item.origins.map((origin) => `${origin.kind}${origin.path === undefined ? '' : `:${origin.path}`}${origin.session === undefined ? '' : `:${origin.session}`}`).join('、')),
										item.step === null ? null : line('产生步骤', `${item.step.plan}/${item.step.id} · ${String(item.step.doneCriteria ?? '')}`),
									),
								),
							),
					fact.review === null ? null : line('复核', `${fact.review.decision}${fact.review.reason === null ? '' : ` — ${fact.review.reason}`}`),
					fact.conflicts.length === 0 ? null : line('冲突', t('这条事实参与了一对冲突读数(只暴露,不裁决)')),
				)
			return h(
				'div',
				{ style: { ...S.chipCard, marginTop: 6, maxHeight: 360, overflow: 'auto' } },
				h(
					'div',
					{ style: S.inline },
					h('span', { style: S.chipCardTitle }, data === null ? `${String(selection.label ?? selection.id)}` : `${String(data.selection.label ?? data.selection.id)}`),
					h('span', { style: S.faint }, `${String(selection.kind)} · ${String(selection.id)}`),
					h('span', { style: { flex: '1 1 auto' } }),
					h('span', { style: S.chipAction, onClick: onFilter }, t('按此筛选')),
					h('span', { style: S.chipAction, onClick: onClose }, t('关闭')),
				),
				busy === true ? h('div', { style: S.faint }, t('正在取这条知识的读数…')) : null,
				failure !== null ? h('div', { style: S.faint }, `${t('取不到读数')}:${failure}`) : null,
				busy === false && failure === null && data === null ? h('div', { style: S.faint }, t('宿主没有这个对象的读数(可能刚被废止,或它不在当前词汇里)。')) : null,
				data === null
					? null
					: h(
							'div',
							null,
							data.definition?.gloss === undefined || data.definition.gloss === null ? null : h('div', { style: S.kv }, h('span', { style: S.faint }, `${t('释义')}:`), ` ${String(data.definition.gloss)}`),
							line('依据', data.definition?.basis),
							line('状态', data.definition?.status),
							line('父概念', data.definition?.parentLabel ?? data.definition?.parent),
							line('主词域', data.definition?.domainLabel ?? data.definition?.domain),
							line('值域', data.definition?.range === null || data.definition?.range === undefined ? null : JSON.stringify(data.definition.range)),
							line('形态', data.definition?.form),
							line('取值', data.definition?.value === undefined || data.definition?.value === null ? null : `${String(data.definition.value)}${data.definition.unit === null || data.definition.unit === undefined ? '' : ` ${String(data.definition.unit)}`}`),
							line('类型', data.definition?.typeLabel ?? data.definition?.type),
							line('引用', data.definition?.uses),
							data.note === null || data.note === undefined ? null : h('div', { style: S.faint }, String(data.note)),
							data.relations === undefined || data.relations === null
								? null
								: h(
										'div',
										null,
										(data.relations.children ?? []).length === 0 ? null : line('子概念', data.relations.children.map((item) => item.label).join('、')),
										(data.relations.predicates ?? []).length === 0 ? null : line('相关谓词', data.relations.predicates.map((item) => `${item.label}(${item.id})`).join('、')),
										(data.relations.instances ?? []).length === 0 ? null : line('实例', data.relations.instances.map((item) => `${item.label}×${item.factCount}`).join('、')),
										(data.relations.edges ?? []).length === 0 ? null : line('关系边', data.relations.edges.map((edge) => `${edge.direction === 'out' ? '→' : '←'}${edge.chip}`).join('、')),
										(data.relations.subjects ?? []).length === 0 ? null : line('主词', data.relations.subjects.map((item) => item.ref).join('、')),
									),
							(data.facts ?? []).length === 0 ? null : h('div', { style: { ...S.faint, marginTop: 6 } }, `${t('相关事实')} ${data.facts.length}${data.factsTruncated > 0 ? t('(还有更多,未列出)') : ''}:`),
							...(data.facts ?? []).map(factCard),
							(data.conflicts ?? []).length === 0 ? null : h('div', { style: { ...S.faint, marginTop: 6 } }, `${t('冲突')} ${data.conflicts.length}:${data.conflicts.map((conflict) => `${conflict.predicate} · ${conflict.subject}`).join('、')}`),
							(data.history ?? []).length === 0 ? null : h('div', { style: { ...S.faint, marginTop: 6 } }, `${t('历史')}:`),
							...(data.history ?? []).map((event, index) =>
								h('div', { key: `h-${index}`, style: S.kv }, h('span', { style: S.faint }, event.at === null || event.at === undefined ? '—' : new Date(event.at).toISOString().slice(0, 19)), ` ${String(event.summary ?? event.kind)}${event.reason === null || event.reason === undefined ? '' : ` — ${String(event.reason)}`}`),
							),
						),
			)
		}

		/**
		 * **图带 / 图谱工作区(React Flow)**。
		 *
		 * 渲染交给 @xyflow/react——拖节点、拖画布、滚轮缩放、框选、MiniMap 都是库的事,
		 * 我们不再手写 SVG 交互。这一层只做三件 ClearAI 自己的事:
		 *   · **适配投影**:graphProjection() 的节点 / 边 → React Flow 的 nodes / edges,
		 *     类型 / 冲突 / 状态的视觉编码在这里(不在投影里,投影是语义不是样式);
		 *   · **点击语义**:点节点 / 边 = 打开 Inspector;过滤是 Inspector 里的显式动作;
		 *   · **全屏工作区**:position: fixed 的真 overlay,打开时自动 fit。
		 *
		 * 数据不在这里拼:Inspector 的证据链住在宿主半(inspectGraphSelection),
		 * 这一层只拿投影与路由的结果。所有交互状态(viewport / 选中 / 拖动)是界面状态,
		 * 一个字节都不进账本。
		 */
		const GraphBand = ({ lexicon, layer, onLayer, fullscreen, onToggleFullscreen, onFilter, sessionId, unlanded }) => {
			const [picked, setPicked] = React.useState(null)
			const graph = lexicon?.graph ?? { nodes: [], edges: [], bounds: { width: 0, height: 0 } }
			const conflicts = Array.isArray(lexicon?.conflicts) ? lexicon.conflicts : []
			const conflicted = new Set(conflicts.flatMap((item) => item.sides.map((side) => side.fact)).filter((id) => typeof id === 'string'))
			const allNodes = graph.nodes.filter((node) => node.layer === layer)
			const allEdges = graph.edges.filter((edge) => edge.layer === layer && typeof edge.from === 'string' && typeof edge.to === 'string')
			const nodeById = new Map(allNodes.map((node) => [node.id, node]))

		/** 图上的标签只放得下一小段:截断加省略号,全文在 Inspector 里(点开就有)。 */
		const trimLabel = (text, limit) => {
			const value = String(text ?? '')
			return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
		}

			/** 视觉编码:类型 → 颜色(概念蓝 / 值形态橙 / 实例绿 / 字面值紫)。 */
			const nodeStyle = (node) => ({
				background: node.kind === 'concept' ? 'rgba(74,163,255,0.16)' : node.kind === 'value_type' ? 'rgba(217,119,6,0.16)' : node.kind === 'instance' ? 'rgba(22,163,74,0.16)' : 'rgba(147,51,234,0.16)',
				border: node.status === 'deprecated' ? '1px dashed rgba(127,127,127,0.4)' : `1px solid ${node.kind === 'concept' ? 'rgba(74,163,255,0.4)' : node.kind === 'value_type' ? 'rgba(217,119,6,0.4)' : node.kind === 'instance' ? 'rgba(22,163,74,0.4)' : 'rgba(147,51,234,0.4)'}`,
				borderRadius: 6,
				padding: '6px 12px',
				fontSize: 12,
				width: 168,
				textAlign: 'center',
			})

		/**
		 * **节点位置是受控的,所以必须自己接住拖动**。
		 *
		 * React Flow 的 `nodes` 是受控 prop:不给 `onNodesChange`,它内部的拖动**没有地方落地**——
		 * 表现就是**节点根本拖不动**(拖前拖后 transform 一模一样)。
		 * 位置是**界面状态**(布局不是知识,不进账本),所以它住在这里;
		 * 换层或图变了就清掉,免得上一张图的拖动痕迹贴到新图上。
		 */
		const [dragged, setDragged] = React.useState({})
		const graphKey = `${layer}|${allNodes.length}|${allEdges.length}`
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

			/**
			 * 投影节点 → React Flow 节点。
			 *
			 * 坐标 = **力导向松弛过的投影坐标**:投影给的按层折行排布作起点(确定性、读得懂),
			 * FA2 再把它松弛成这个图**自己的形状**(枢纽、簇)。拿不到 FA2 时就是起点本身。
			 */
			const rfNodes = forceLayout(allNodes.map((node) => ({
								id: node.id,
				type: 'default',
				/** 拖过的以拖动为准(界面状态);没拖过的用布局算出来的。 */
				position: dragged[node.id] ?? { x: node.x ?? 0, y: node.y ?? 0 },
				/**
				 * **尺寸要显式给**。只写在 `style` 里的话,React Flow 要等测量完成才知道它多大,
				 * 而 **MiniMap 在测量完成之前拿不到宽高就直接跳过这些节点**——缩略图因此是一块空白
				 * (真机截图里就是那样)。`initialWidth/initialHeight` 是官方的「测量前尺寸」。
				 */
				initialWidth: 168,
				initialHeight: 34,
				/** 图上只放得下一小段;全文在 Inspector 里,点开就有。 */
				data: { label: trimLabel(`${node.label ?? node.ref ?? node.id}${node.uses > 0 ? ` (${node.uses})` : ''}`, 22) },
				style: nodeStyle(node),
				/** 冲突节点标红。 */
				...(Array.isArray(node.facts) && node.facts.some((id) => conflicted.has(id)) ? { className: 'clearai-node-conflict' } : {}),
			})), allEdges.map((edge) => ({ source: edge.from, target: edge.to })))

			/** 投影边 → React Flow 边(类型 / 冲突的视觉编码)。 */
			const rfEdges = allEdges.map((edge) => ({
				id: edge.id,
				source: edge.from,
				target: edge.to,
				label: edge.label ?? '',
				labelStyle: { fontSize: 9 },
				labelBgStyle: { fill: 'var(--dsw-alias-bg-layer-1)', fillOpacity: 0.85 },
				animated: edge.kind === 'assertion' && edge.status === 'live',
				style: {
					stroke: edge.kind === 'assertion' && conflicted.has(edge.fact) ? '#dc2626' : edge.kind === 'is_a' ? 'rgba(127,127,127,0.4)' : 'rgba(74,163,255,0.5)',
					strokeWidth: edge.kind === 'assertion' ? 1.5 : 1,
					...(edge.kind === 'is_a' ? { strokeDasharray: '4 3' } : {}),
				},
			}))

			/** 点击语义:点节点 / 边 = 打开 Inspector。 */
			const onNodeClick = (_event, node) => {
				const original = nodeById.get(node.id)
				if (original === undefined) return
				setPicked({ kind: 'node', node: original })
			}
			const onEdgeClick = (_event, edge) => {
				const original = allEdges.find((item) => item.id === edge.id)
				if (original === undefined) return
				setPicked({ kind: 'edge', edge: original })
			}

			/** Inspector 要看的对象。 */
			const inspection =
				picked === null
					? null
					: picked.kind === 'edge'
						? { kind: 'edge', id: picked.edge.id, label: picked.edge.label }
						: { kind: picked.node.kind, id: picked.node.kind === 'concept' ? String(picked.node.ref ?? '') : picked.node.id, label: picked.node.label ?? picked.node.ref ?? picked.node.id }
			/** 「按此筛选」:概念筛概念、实例筛实体、断言边筛谓词。 */
			const filterTarget = picked === null ? null : picked.kind === 'edge' ? picked.edge.predicate ?? null : String(picked.node.ref ?? '')

			/**
			 * React Flow 的**实例**(用来 fit / 重新适配)。
			 *
			 * 注意:v12 里给 `<ReactFlow ref={…}>` 传 ref 拿到的是 DOM 节点,不是带 `fitView` 的
			 * 实例——这样写调用会**静默变成空操作**。实例要从 `onInit` 拿。
			 * 真机上踩到过:内联图带先按小画布 fit 了一次,切到全屏后画布大了十倍却没重新适配,
			 * 于是图缩在左上角一小块(截图里一眼可见)。
			 */
			const rfRef = React.useRef(null)
			/**
			 * **什么时候重新适配**:画布的**几何**或**内容**变了就得重来一次。
			 *
			 * 三件都会让刚才那张图不在眼前:打开/关闭工作区(画布尺寸变了)、
			 * 切层(整套节点换了)、开/关详情抽屉(画布变窄)。
			 * React Flow 的视口变换**不会自己跟**这些变化——不重算就得到「详情读得到、图却空了」
			 * (真机截图里就是这个样子)。这里只在**这几件事发生**时重算,人自己拖过/缩过的视角
			 * 不会因为数据刷新被夺走。
			 */
			React.useEffect(() => {
				const timer = setTimeout(() => rfRef.current?.fitView?.({ padding: 0.15, duration: 200 }), 60)
				return () => clearTimeout(timer)
			}, [fullscreen, layer, picked !== null, allNodes.length])

			const shell = fullscreen === true ? { position: 'fixed', inset: 0, zIndex: 40, background: 'var(--dsw-alias-bg-layer-1)', padding: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { ...S.section, padding: 6 }
			const canvasBox = fullscreen === true ? { flex: '1 1 auto', minHeight: 240, minWidth: 0, overflow: 'hidden', border: '1px solid rgba(127,127,127,0.18)', borderRadius: 6 } : { height: 208, overflow: 'hidden', border: '1px solid rgba(127,127,127,0.18)', borderRadius: 6 }
			/**
			 * **工作区里详情走右侧抽屉,不占画布的高度。**
			 *
			 * 这条不是审美:详情摆在画布下方时,它一出现画布就变矮,而 React Flow 的视口变换
			 * 不会跟着变——于是**刚点开的那个节点直接掉出可视区**(真机上就是这样:详情读得到,
			 * 图却空了)。侧栏只压缩宽度,而宽度方向的适配本来就有 `fitView` 管。
			 * 内联图带不适用:那里只有两百来像素高,横向没地方放抽屉。
			 */
			const sideBySide = fullscreen === true

			return h(
				'div',
				{ style: shell },
				h(
					'div',
					{ style: S.inline },
					h('span', { style: { ...S.tag, cursor: 'pointer', opacity: layer === 'ontology' ? 1 : 0.5 }, onClick: () => { setPicked(null); onLayer('ontology') } }, t('本体图')),
					h('span', { style: { ...S.tag, cursor: 'pointer', opacity: layer === 'entity' ? 1 : 0.5 }, onClick: () => { setPicked(null); onLayer('entity') } }, t('实体图')),
					h('span', { style: { ...S.faint, flex: '1 1 auto' } }, t('点节点看知识详情')),
					h('span', { style: S.chipAction, onClick: () => rfRef.current?.fitView({ padding: 0.15, duration: 200 }) }, t('适配')),
					h('span', { style: S.chipAction, onClick: onToggleFullscreen }, fullscreen === true ? t('关闭工作区') : t('打开图谱工作区')),
				),
				h(
					'div',
					{ style: { display: 'flex', flexDirection: sideBySide ? 'row' : 'column', gap: 8, flex: '1 1 auto', minHeight: 0, alignItems: 'stretch' } },
					h(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 auto', minWidth: 0, minHeight: 0 } },
				XYFlow === null || XYFlow.ReactFlow === undefined || XYFlow.ReactFlow === null
					? h('div', { style: S.faint }, `${t('图组件不可用')}(${String(XYFLOW_LOAD.reason ?? '')}):${t('投影还在,事实与命题照常可读。')}`)
					: allNodes.length === 0
					? h(
							'div',
							{ style: S.faint },
							/**
							 * **空态要说清"这一层的东西从哪来"**,不能只说「暂无」。
							 * 实体层尤其:它是本项目里唯一需要**独立写入口**的一层(RegisterInstance),
							 * 而图上看不见它时,人最容易得出的错结论是「断言都写了,图迟早会自己长出来」。
							 * 所以两句:为什么是空的 + 什么不算数。
							 * 别的层仍是一句平静的「暂无」:那里确实只是还没登记。
							 */
							layer === 'entity'
								? `${typeof unlanded === 'number' && unlanded > 0 ? `${unlanded}${t(' 个断言主体还没落到这一层:')}` : t('这一层还没有实例节点。')}${t('实例靠 RegisterInstance 登记(带出处);断言挂在命题上不算「已知」。')}`
								: t('此层暂无节点。'),
						)
					: h(
							'div',
							{ style: canvasBox },
							h(XYFlow.ReactFlow, {
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
							h(XYFlow.MiniMap, {
								pannable: true,
								zoomable: true,
								/**
								 * **缩略图要看得懂**:默认节点是灰白的,在大图上等于一块空白方块——
								 * 这里按类型给实色(与画布上的淡色底不同:缩略图里小块面积小,淡色看不见)。
								 * 遮罩(视口指示)也调淡一点,别把整张缩略图盖成一个白框。
								 */
								nodeColor: (node) => {
									const layerKind = nodeById.get(node.id)?.kind ?? ''
									if (layerKind === 'concept') return '#6ea8fe'
									if (layerKind === 'value_type') return '#e0a458'
									if (layerKind === 'instance') return '#4caf7d'
									if (layerKind === 'literal') return '#a97fe0'
									return '#9aa4b2'
								},
								maskColor: 'rgba(127,127,127,0.18)',
								maskStrokeColor: 'rgba(127,127,127,0.45)',
								style: { background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid rgba(127,127,127,0.25)' },
							}),
							h(XYFlow.Background, { variant: 'dots', gap: 20, size: 1, color: 'rgba(127,127,127,0.15)' }),
						),
					),
				allNodes.length > 0
					? h('div', { style: S.faint }, `${allNodes.length} ${t('个节点')} · ${allEdges.length} ${t('条边')}${conflicts.length > 0 ? ` · ${t('冲突')} ${conflicts.length}` : ''}`)
					: null,
					),
					picked === null
						? null
						: h(
								'div',
								{ style: sideBySide ? { width: 380, flex: '0 0 auto', overflowY: 'auto', minHeight: 0 } : { flex: '0 0 auto' } },
								h(GraphInspector, {
									selection: inspection,
									sessionId,
									onFilter: () => onFilter(filterTarget),
									onClose: () => setPicked(null),
								}),
							),
				),
			)
		}

		/**
		 * **词汇维护区**(折叠):词条表、健康度、废止列表、货架入口。
		 * 默认收起——它是参考材料,不挡结论;**0 条目 0 命题而有词条时自动展开**:
		 * 语言先于句子时,立好的词得有地方站。
		 */
		const VocabBlock = ({ lexicon, open, onToggle, openPreview, sessionId }) => {
			const terms = Array.isArray(lexicon?.terms) ? lexicon.terms : []
			const predicates = Array.isArray(lexicon?.predicates) ? lexicon.predicates : []
			const health = Array.isArray(lexicon?.health) ? lexicon.health : []
			const warnings = health.filter((issue) => issue.severity === 'warning')
			const deprecated = [...terms, ...predicates].filter((entry) => entry.status === 'deprecated')
			/** 编辑是**具名动词的图形前端**:抽屉里填字段,提交走人门通道,面板从不写文件。 */
			const [drawer, setDrawer] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const [error, setError] = React.useState(null)
			const submitOnto = (action, entry) => {
				setBusy(true)
				setError(null)
				fetch('/api/clearai/gate', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sessionId, action, entry }),
				})
					.then((response) => response.json())
					.then((result) => {
						if (result.ok !== true) setError((result.problems ?? [result.error ?? 'failed']).join(';').slice(0, 200))
						else setDrawer(null)
					})
					.catch((thrown) => setError(String(thrown?.message ?? thrown)))
					.finally(() => setBusy(false))
			}
			if (terms.length === 0 && predicates.length === 0) return null
			return h(
				'div',
				{ style: S.section },
				h(
					'div',
					{ style: { ...S.head, cursor: 'pointer' }, onClick: onToggle },
					`${t('词汇')}(${terms.length} ${t('概念')} · ${predicates.length} ${t('谓词')}${deprecated.length > 0 ? ` · ${deprecated.length} ${t('已废止')}` : ''}) ${open === true ? '▾' : '▸'}`,
				),
				open === false
					? null
					: h(
							'div',
							null,
							...terms.map((term) => h('div', { key: `vt-${term.id}`, style: S.row }, h('span', { style: S.mono }, term.id), h('span', { style: S.faint }, ` ${String(term.label ?? '')}${term.status === 'deprecated' ? ` · ${t('已废止')}` : ''}${term.parent ? ` ↖${term.parent}` : ''}`), term.status === 'deprecated' ? null : h('span', { style: S.chipAction, onClick: () => { const reason = window?.prompt?.(`${t('废止')} ${term.id}:${t('为什么?')}`) ; if (typeof reason === 'string' && reason.trim() !== '') submitOnto('deprecate_entry', { id: term.id, reason: reason.trim() }) } }, t('废止')))),
							...predicates.map((predicate) => h('div', { key: `vp-${predicate.id}`, style: S.row }, h('span', { style: S.mono }, predicate.id), h('span', { style: S.faint }, ` ${String(predicate.label ?? '')}${predicate.functional === true ? ` · ${t('单值')}` : ''}${predicate.status === 'deprecated' ? ` · ${t('已废止')}` : ''}`), predicate.status === 'deprecated' ? null : h('span', { style: S.chipAction, onClick: () => { const reason = window?.prompt?.(`${t('废止')} ${predicate.id}:${t('为什么?')}`) ; if (typeof reason === 'string' && reason.trim() !== '') submitOnto('deprecate_entry', { id: predicate.id, reason: reason.trim() }) } }, t('废止')))),
							warnings.length > 0 ? h('div', { style: S.row }, `${t('健康')}:`, ...warnings.map((issue, index) => h('div', { key: `vh-${index}`, style: S.faint }, `  ${issue.id}:${issue.detail}`))) : null,
							deprecated.length > 0
								? h('div', { style: S.row }, ...deprecated.map((entry) => h('div', { key: `vd-${entry.id}`, style: S.faint }, `  ${entry.id} — ${String(entry.deprecated?.reason ?? '')}`)))
								: null,
							openPreview === undefined ? null : h('span', { style: S.chipAction, onClick: () => openPreview('clear/ontology/domain.md') }, t('打开词汇货架(原生预览)')),
							/**
							 * **编辑入口(阶段 E)**:登记概念 / 登记谓词两个表单抽屉;条目行的
							 * 修订与废止在各自那行(见下)。提交 = 一次人门动词;判据在宿主半,
							 * 界面只把表单递过去、把问题清单带回来。
							 */
							h('div', { style: S.inline },
								h('span', { style: S.chipAction, onClick: () => setDrawer({ kind: 'term' }) }, `+ ${t('概念')}`),
								h('span', { style: S.chipAction, onClick: () => setDrawer({ kind: 'predicate' }) }, `+ ${t('谓词')}`),
							),
							drawer === null
								? null
								: h(OntoDrawer, { drawer, setDrawer, busy, error, onSubmit: submitOnto }),
						),
			)
		}

		/**
		 * **词汇抽屉**:登记概念/谓词的最小表单。字段与动词参数一一对应;
		 * 判据不在这里重复——服务端拒了就把问题清单原样亮出来。
		 */
		const OntoDrawer = ({ drawer, setDrawer, busy, error, onSubmit }) => {
			const [form, setForm] = React.useState({ id: '', label: '', gloss: '', basis: '', parent: '', domain: '', unit: '', form: 'quantity', functional: false })
			const field = (key, placeholder) =>
				h('input', {
					value: form[key] ?? '',
					placeholder,
					style: { ...S.chip, cursor: 'text', width: '100%' },
					onInput: (event) => setForm({ ...form, [key]: event?.target?.value ?? '' }),
				})
			const isTerm = drawer.kind === 'term'
			const entry = isTerm
				? { id: form.id, label: form.label, gloss: form.gloss, basis: form.basis, parent: form.parent === '' ? undefined : form.parent }
				: { id: form.id, label: form.label, gloss: form.gloss, basis: form.basis, domain: form.domain === '' ? undefined : form.domain, range: { form: form.form, unit: form.unit === '' ? undefined : form.unit }, functional: form.functional === true ? true : undefined }
			return h(
				'div',
				{ style: S.chipCard },
				h('div', { style: S.chipCardTitle }, isTerm ? t('登记概念') : t('登记谓词')),
				field('id', 'id(snake_case)'),
				field('label', isTerm ? t('名称') : t('名称')),
				field('gloss', t('释义(一句话)')),
				isTerm ? field('parent', `${t('父概念')} id(可选)`) : field('domain', `${t('主词域')} id(可选)`),
				isTerm === true ? null : field('unit', `${t('单位')}(可选)`),
				isTerm === true ? null : h('label', { style: S.faint }, h('input', { type: 'checkbox', checked: form.functional === true, onChange: (event) => setForm({ ...form, functional: event?.target?.checked === true }) }), ` ${t('单值')}`),
				field('basis', `${t('依据')}(必填)`),
				error === null ? null : h('div', { style: { color: '#dc2626', fontSize: 11 } }, String(error)),
				h('div', { style: S.chipActions },
					h('span', { style: S.chipAction, onClick: busy === true ? undefined : () => onSubmit(isTerm === true ? 'register_term' : 'register_predicate', entry) }, busy === true ? t('提交中…') : t('提交')),
					h('span', { style: S.chipAction, onClick: () => setDrawer(null) }, t('取消')),
				),
			)
		}
		const LocalizedFacts = withLocale(Facts)
		const LocalizedWorldTree = withLocale(WorldTree)

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
			 * 而"当下什么状态"由工具行那颗**计划芯片**回答(它一直在,不用切页签)。
			 * 页签越少,越不需要向人解释每个页签该在什么时候看。
			 */
			/**
			 * 标签与说明必须是**函数**:页签类型只在预设生效时注册一次,而语言座位是**随后**才切到
			 * 用户偏好的——写成 `label: t('世界树')` 就把注册那一刻的语言固化了(界面中文、
			 * 右栏页签却是 Worldlines)。惰性取值让原生每次渲染现问一次,切换语言立刻跟上。
			 */
			const rightRail = [
				{ id: 'clearai-worldtree', kind: 'clearai-worldtree', label: () => t('世界树'), order: 15, description: () => t('计划的步骤与闸门'), icon: NATIVE_ICONS.IconBranchOutline16 },
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
							title: tab.label,
							guide: [{ order: tab.order, title: tab.label, description: tab.description, icon: tab.icon }],
						}), `clearai: rail type ${tab.id}`))
					} catch (error) {
						// 类型已注册(同名同 layer)不是致命:如实记一笔,继续。
						console.warn?.(`${t('clearai 面板:右栏页签类型注册失败 ')}${String(error?.message ?? error)}`)
					}
					const body =
						tab.body ??
						((props) =>
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
									}))
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
			 * 中栏视图:**事实**——整条闭环一屏看完(假设是起点,事实是沉淀)。
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
			occupy('conversation.view', () => ({ id: 'clearai-facts', order: 20, label: t('本体') }), (props) => h(LocalizedFacts, { ...props, openRail, openSpectator, openPreview: openPreviewFor(props) }))
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
		exports.__components = { PlanChip, WorldTree, GraphBand, GraphInspector, VocabBlock, AssertionChips, Inbox, TreeDetail, Facts, FactShelf, PropositionShelf, PropositionRow, GapShelf, LevelGuide, ClearAIMark, LOOP_LABEL, PROPOSITION_GROUPS }
		/**
		 * 测试缝之三:命题那一列的**派生**是纯函数(分组、处境、来路、证据链),
		 * 渲染本身没法在没浏览器的地方细究——把它导出去,让测试直接断言派生结果。
		 */
		exports.__propositions = { evidenceOf, transitionsOf, whereOf, judgeOf, originsOf, stepOfFact }
		/** 测试缝之四:本体格的过滤判据(纯函数)。 */
		exports.__ontology = { termMatches }
		return module.exports
	},
})
