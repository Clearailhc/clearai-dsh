# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- 别的会话留下的事实被新证据推翻时不会问人:这一问只认本目标的判断编号。现在判断可带 `retests: "<事实 id>"`,复检被推翻就当场问人撤回还是维持,结论写回事实文件。

## [0.4.0] — 2026-10-02

这一版包括「少即是多」改造的全部六个阶段(见下面各段)、本体改成文件树,以及中英两种语言的完整支持。

**两种语言。** 系统自己写的每一句话都跟着人说话的语言走。`STATE_VERSION` 16(投影多了 `language`);旧会话不迁移。

### Added

- **语言跟着人走**:人用中文写就是中文,用英文写就是英文,按会话、按人写的消息判(系统注入的消息不算)。覆盖工具结果、运行态卡、问人的话(选项按两种语言都认)、三段提示词、六件工具的说明与参数说明(英文会话在装配提示词时换成英文版)、评估者任务书与裁决 schema、技能、`clear/` 下系统写的文件(目标文档、事实总览、阶段归档、过程本体货架)、本体文件的校验信息。面板跟着界面语言,命令行跟着 `--lang` 或系统语言。
- **两个真实案例**:[JEPA 世界模型](docs/cases/jepa-world-model.zh-CN.md)与 [Navier–Stokes](docs/cases/navier-stokes.zh-CN.md),原始记录在 `docs/cases/runs/`,中英截图在 `docs/shots/{zh,en}/`(在真 DSH 里回放两场真跑拍的)。

### Changed

- **文档只写现在的设计**:删掉改造方案、诊断与过程记录,旧的三个虚构案例换成两个真实案例。

**本体改成文件树。** 设计见 [领域本体](docs/domain-ontology.zh-CN.md) 第 5、6 节。

### Changed

- **本体是 `clear/ontology/` 下的 JSON 文件树**:`concepts/`、`relations/`、`entities/`,`X.json` 描述 X,孩子放在同级 `X/` 目录(概念嵌套 = is_a,实体嵌套 = 组成)。模型用原生文件工具写,系统写一份 `SCHEMA.json` 说明格式。
- **三道检查**:写时单文件校验(不合格拒写);读时跨文件校验(只标不拦,问题列在卡上与图下);升格时全量校验(不合格不升格)。
- **事实写成文件并跨会话累积**:每条一份 `clear/knowledge/facts/<id>.json`,带所用定义的指纹;定义改了,这条事实标「定义已变」进「待处理」。`INDEX.md` 从全部事实文件渲染。
- **图上目录嵌套成可收起的子图**:点多时默认收到第一层,+N 展开。
- 结案后提示模型把可复用的做法写成原生技能(`.agents/skills/<名字>/SKILL.md`)。

### Fixed

- 后一次 `Conclude` 会把之前目标的假设再升格一次。
- 相对路径能绕过受保护目录;读受保护目录的文件也被拦。

### Removed

- 4 件本体工具 `Define` / `Deprecate` / `RegisterInstance` / `Assert`(工具 10 → 6),以及 `clear/ontology/domain.md` 读面。


**「少即是多」第六阶段:呈现。** 按改造方案第六阶段的改动清单。机制、十件工具、账本事件与 `STATE_VERSION` 都不变。

### Changed

- **本体格改成图为主。** 页眉一行问题、一行计数、「待处理」和一条进度轨(判断 → 检验 → 已验证 → 入本体);中间是本体图 / 实体图二选一(星图式,已验证的关系实线、待核验虚线);下面是结论清单,一条一行,按 已验证 / 待核验 / 验证中 / 不确定 / 已推翻 / 已替换 分组。点开一条依次是 进度、可信度怎么变的、补充。
- **判断有短名。** `Frame` 的每条判断可带 `name`(十二字以内),没给就取主张开头;工具里引用判断时 id、短名、主张原文都认。账本里的 id 不变。
- **说人话。** 运行态卡与工具结果不再出现内部编号与 `support / refute`;单次结果只说 支持 / 推翻 / 不确定(`AdvancePlan` 也收这三个中文词),等级写成 自己推了一遍 / 引用已有材料 / 可复算 / 独立核验 / 人放行。卡没变就不再附。
- **世界树**改成目录式:每步一行,点开才看检验了哪条判断、结果是什么;页眉不带计划编号。
- 英文界面里右栏页签叫 World Tree(此前误作 Worldlines),结果与状态词首字母大写。

### Removed

- 面板上的命题货架、缺口栏、状态流转图、词汇维护区与本体编辑抽屉;`/api/clearai/gate` 整条路由(人门自第三阶段起由开门的那次调用当场问人)。
- 收件箱:换成派生的「待处理」(计划连拦停下、结论互相矛盾),只陈述、不放按钮;本体格页眉与输入框旁「待处理 N」读同一份。


**「少即是多」第五阶段:提示词收成三段。** 按改造方案第五阶段的改动清单。

### Changed

- **提示词 21 段 → 3 段**,约 1.5 万字收到 2 千字出头:身份(`clearai/identity`)、循环(`clearai/loop`)、对人说话(`clearai/speaking`)。每个工具怎么用写在工具自己的说明里,现在是什么状态由运行态卡给。
- 人格前缀只留一句身份;`clearai-loop` 技能只讲提示词与工具说明都没写的部分:准入核什么、被拦之后怎么走、评估卡怎么读。

### Removed

- 讲原生工具用法的段(文件读写、网页、技能、委派、Python 环境)、已删机制的残留说法(`lab/` 与 `products/` 目录约定、`PROJECT.md` 占位、`setup_cjk()`、`retract_fact` / `keep_fact`),以及只由提示词承载的「引擎级异常降权只读恢复」细则(身份段留一句:结局不明先看当前事实)。机制、工具、状态形状都不变。

**「少即是多」第四阶段:Conclude 门收紧,工具面收拢。** 按改造方案第四阶段的改动清单。

### Changed

- **Conclude 只剩一道实体门**(`requireLandedEntities`),而且只管**将要升格**的判断(存活、零推翻、支持等级够升格):它断言里的每个主体都得是实体图上的实例节点(登记过的实例,或 Assert / 已升格事实带出来的节点)。「落图」从「要有一条边」改成「节点在」,所以 `RegisterInstance` 一次就够,不必再 `Assert` 同一句话。门在派评估者之前判,拦下不花评估。
- **缺口 7 → 3**:留下 `untouched_claims`、`prose_only_claims`、`entities_unlanded`。`entities_unlanded` 的读数列出具体的 `类型|id`,出路写明 `RegisterInstance` 或 Frame 修订。
- **工具 19 → 10**:`Frame`、`Conclude`、`CreatePlan`、`AdvancePlan`、`RevisePlan`、`ClosePlan`、`Define`、`Deprecate`、`RegisterInstance`、`Assert`。`RevisePlan` 以 `action: add | refine | void` 合并了改计划、补判据、作废一步;`Define` 给了 `range` 是谓词、否则是概念,同 id 再 Define 是修订展示字段,改语义(上位、定义域、值域、函数性)拒为 `semantics_changed`;`Deprecate` 兼管概念与谓词。账本事件名不变。
- 投影状态版本升到 14:假设带 `unlanded`,不再有 `skips` / `untouchedLevels`。

### Removed

- 配置 `requireTypedPromotion`、`requireLevelReasons`(写了在组装时报 `unknown_config`);缺口 `no_language`、`unstructured_facts`、`levels_skipped`、`orphan_terms`。
- 整套跳级机制:`ExplainLevelSkip`、运行态卡的「未走过」、面板的等级导引。旧账本里的 `level/skipped` 折叠时静默跳过。
- `CheckPlan`(运行态卡每回合都在)与 `QueryKnowledge`(两轮六场模拟里一次没被调用;词表在 `clear/knowledge/`)。

**「少即是多」第三阶段:目标层挂到原生 goal,交付与裁决分开。** 按改造方案第三阶段的改动清单。

### Changed

- **完成与结果分开。** 交付成立 ⇒ 这一步完成,不论结果是支持、推翻还是说不清;推翻和说不清都是合法结果,各记一条证据(带 `hypothesis`)。此前推翻的那一步收不了尾,只能作废。
- **评估者给两份判断**:交付成不成立(`holds`: yes / no / unclear),以及对每条被检验判断的结果(`results[]`)。交付不成立才不推进、计一次连拦。评估卡版本 `clearai.audit.v2`;旧形状的 `verdict` 仍读得懂。
- **一步可以检验多条判断**:`tests: { hypotheses: [...], level }`(旧的 `tests.hypothesis` 仍接受)。`AdvancePlan` 的参数是 `basis` 与 `results`(L0–L2);L3 以上由评估者给结果。
- **`SetGoal` → `Frame`、`CloseGoal` → `Conclude`。** `Frame` 在宿主原生 goal 上建(或改)一条目标,续跑由原生 goal 驱动;`Conclude` achieved ⇒ 原生 goal 完成并声明交付物,abandoned ⇒ 原生 goal 置阻塞。守卫拦住原生 `update_goal` 直接完成目标。
- **人门当场问。** L4 放行、计划连拦到阈值、推翻证据碰到已确立的事实,都由开门的那次调用经原生提问卡(`userQuestions`)当场问人;没人能答 ⇒ 原生 goal 置阻塞(`clearai-needs-human`)。面板上的人门动词只剩本体四个;旧日志里的撤回 / 维持照样折得出来。
- 挂上原生 `tool-goal`、`command-goal`、`plan-mode`。工具面 19 件,提示词 21 段(澄清协议只剩一段)。投影状态版本升到 13。

### Removed

- ClearAI 自己的续跑窗口(`turnDemand`、布防 / 按住 / 收兵、`continuation/set`)与续跑额度(`maxAutoTurns`)。
- 运行档(`autonomy`)与两套澄清措辞。
- 计划审阅记号(`RequestPlanReview`、`plan/confirmed`、`confirmed_by`):它从来不是门;动手前给人看计划用原生 `/plan`。
- 收件箱里等人处置的条目与面板上的撤回 / 维持按钮;「连续两次无法判定就强制改」那条规则(说不清是合法结果)。

---

**「少即是多」第二阶段:宿主已经有的,交还宿主。** 按改造方案第二阶段的清单删除;机制骨架(目标 / 计划 / 准入 / 证据 / 本体)不动。

### Removed

- **世界线**(`ForkPlan` `AdvanceWorldline` `ConvergeFork` `WorldlineStatus` `AwaitWorldlines` `AbandonFork`、执行者子任务、横评仲裁、世界树里的车道)。并行探索改由原生 `subagent` 承担:做法迥异的路线就是竞争的假设,各由一个步骤检验。
- **旁路账本与文件恢复**(`FileHistory` `RestoreFile`、回合快照、交付点提交、`ledgerMaxFiles`)。下面「账本不再往用户的仓库里提交」那一节描述的旁路账本随之整体移除;每轮改了什么交给宿主的 `dsh-workspace-changes`。
- **侦察**(`SpawnScout` `MapScouts`、开工前侦察、资料面)、**外脑**(`brain.js`、`SaveSkill` `WriteMemory`、技能候选与扶正)、**模板技能与铺工作区**(`preset/template/`、空文件夹里的 `PROJECT.md` 与目录骨架)、**自己的 `/` 命令**(`commands.js`)。
- 界面:产物页签与 `/api/clearai/deliverables`、技能 · 记忆页签与 `/api/clearai/brain`、续跑状态行;人门里与上述机制相关的动作(`adopt_branch` `abandon_fork` `promote_skill` `confirm_provisional`)。
- 配置键:`templateDir` `scoutToolFilter` `gitWorldlines` `ledgerMaxFiles` `executorToolFilter` `precommitRecon` `mapScoutMax` `mapScoutConcurrency` `autoDispatchExecutors` `autoAdoptMinGap` `forkArbitration`。

### Added

- **同一计划里两步不许声明同一个产物路径**(`CreatePlan` / `AmendPlan` 立约时就拒):子任务共用一个工作区,撞路径的两条路线会互相覆盖。

### Changed

- 工具面 20 件(目标 2 · 计划 8 · 本体 10),提示词 21 段生效。
- 投影状态版本升到 12。旧会话照样读得开:被删机制的事件被安静跳过,不报错也不显示。
- 测试与长测剧本同步瘦身:世界线与侦察剧本换成「竞争路线」剧本;套件 17 份。

**账本不再往用户的仓库里提交。** 工作区本身是 git 仓库时,内核的账本(交付点、回合边界快照、恢复)与 git 世界线(分支、合并)此前**直接用那个仓库**:每个回合边界在用户**当前分支**上 `git add -A` 并以 `clearai <clearai@local>` 提交,世界线分支 `clearai/*` 也开在里面。于是用户没写完的改动、模型按技能约定写的 `lab/` `products/`、排查用的 `.tmp-*` 一起进了他的历史,下一次 push 就上了远端——本仓库自己就这样吃进过几十条「探索期快照」(独立验证员 2026-09 也记过同一件事,当时判为「不是源码缺陷」)。

> 过渡修复:后续计划把账本整体交给宿主(`dsh-workspace-changes`),届时本节描述的旁路账本会被移除。

### Fixed

- **账本与世界线一律住在旁路账本**(`$DSH_HOME/storages/clearai/ledger/<slug>`):`gitContext` 删掉「工作区是 git 仓库就直接用它」那条分支。旁路账本认工作树里的 `.gitignore`、自动跳过用户的 `.git/`,所以账本看见的内容与用户看见的一致;`FileHistory` / `RestoreFile` / 世界线的行为不变,只是记录的位置换了。对用户仓库做的**唯一**一件事:在它本地的 `.git/info/exclude` 里加一行 `clear/worldlines/`,让嵌套的工作副本不出现在 `git status` 里(不进历史、不外传)。
- **分叉前先记一笔工作区快照**:账本的 HEAD 只在回合边界与交付点前进,不记的话世界线从上一笔快照分出去,看不见这之后写下的文件。采纳时主线上有挡路的未跟踪文件,也按「先存快照再合并」处理(此前只认「本地修改」那一种拒绝)。
- **开场的残留读数两处都数**:旁路账本里的 `clearai/*` 分支,以及**升级前**留在用户仓库里的那些。

### Changed

- 旁路账本的文件数上限(`ledgerMaxFiles`,缺省 20000)从此对 git 工作区也生效:超过上限的大仓库里账本与 git 世界线退化成声明目录,并如实说明原因(此前 git 工作区不受这条限制,因为它写的是用户自己的仓库)。
- 仓库清理:删除误入版本库的 ClearAI 工作区残留(`lab/`、`products/`、`.tmp-fontdiag/`);案例证据搬到 `docs/cases/runs/`,营销卡片脚本搬到 `tools/marketing/`;`.gitignore` 挡住工作区约定的目录;新增 `tools/check-workspace-residue.mjs` 并接进 CI(不许跟踪工作区产物与根上的 `PROJECT.md`,PR 里不许有 `clearai@local` 的提交)。

## [0.3.1] — 2026-09-29

**两个死结:计划置 blocked 后再也解不开,续跑窗口的阻塞码收不了兵。** 两条都不是措辞问题,是机制自己在文档承诺的出口上焊死了——0.3.0 的「连拦达阈值 ⇒ 置 blocked、停下等人」写得没错,可人按卡上说的三条出路走,一条也走不出去。

### Fixed

- **`block/cleared` 只清了连拦计数,没清 `plan.blocked`**:计划一旦置 blocked,`AmendPlan`(换一条能过闸的路)与 `RefinePlan`(补齐判据)把话说得再对也解不开,`plan.blocked` 会一直挂着,收件箱那条等人处置的条目成了死结。现在 `block/cleared` 同时删掉 `blocks[plan:step]` 与指向该步的 `plan.blocked`;三条出路各自**真的**能解拦——`AmendPlan`、`RefinePlan`,以及 `VoidPlanStep`(只作废被拦的那一步时才清)。阻塞守卫的文案也随之只列**可执行**的动词(去掉「让人介入后重开」,补上 `VoidPlanStep`)。
- **续跑窗口的阻塞码用了下划线**:`clearai_loop_stalled` / `clearai_loop_abandoned` 不合宿主契约 —— `@deepseek-ai/dsh-goal` 要求 lower-kebab-case(`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`),`goals.block(...)` 当场拒收 ⇒ 收兵失败,窗口留在 `active` 上继续叫醒一个已经收尾的目标。现在改成 `clearai-loop-stalled` / `clearai-loop-abandoned`。测试桩 `makeHost().block` 也按同一条宿主规则抛错——桩与宿主同形,不然测的只是桩。
- **目录被声明成物证时报「空目录」**:目录不是空文件,两件事不一样,而错的那句话会把下一步动作指错。准入现在把目录**单独判为不可作为物证**(`verified_by: 'l1'`),并如实报出目录里的**文件数与字节数**;`CreatePlan` 的 `artifacts` 契约描述与 `clearai-loop` 技能文档同步写明「目录不是物证,要声明具体文件」。

### Verified

- **18 套件 1886 项检查全绿**(内核 834 · 宿主 119 · 客户端 248 · 领域语言 234 · 本体 96 · 长测 41 · 对照 41 · 可读性 35 …);`verify-package` 44 通过 / 1 失败,唯一那条仍是沙箱里 `npm pack` 的 `EROFS`(只读 `~/.npm/_cacache`),与 0.3.0 记录的是同一处环境限制。
- 续跑码那一条是**拿真宿主的契约核过**的:`node_modules/@deepseek-ai/dsh-goal/lib/index.js` 里就是那条 lower-kebab-case 正则,不是照着测试桩猜的。

## [0.3.0] — 2026-09-29

**从一次真跑的三条症状出发,把三件事从劝告变成机制。** 一位用户在真实会话里遇到的三个问题——`CloseGoal` 运行失败且要跑很久;命题晦涩、而且**从没走过认识论循环的便宜层级**;本体建得不错、**查到的实体却没进实体图谱**——每一条都追到了代码行:宿主半用**属性式**取服务(宿主 fiber 瞬态掉线就抛,而评估者刚跑完的那两分钟评审随栈帧一起没了);实体层的节点与边**唯一**来自「整条目标被独立裁决判 support」之后的升格;`supportedLevel` 只是支持证据的最大值,跳级**零代价**。这一版不是把话说重一点,而是把这三条各自换成一道**可清点的机制**——并在两场真模型 headless 长测里验过。

### Added

- **实体是一等写入口**(本轮的主修):`RegisterInstance`(观测:依据与出处必填)与 `Assert`(说一句关于某个**已登记实例**的带出处的话)。**断言在登记那一刻就产边**,不再等目标裁决;投影把三个来源合起来画,同键去重、节点与边都带 `source`(`registered` / `promoted` / `asserted`),两个新来源都为空时输出与 0.2.8 **逐字节相同**。`RegisterTerm` 与它的分工写死在工具描述里:**概念是约定,实例是观测**。
- **`ExplainLevelSkip`**:为「没走过的验证等级」留理由,`levels` 必须是卡上列出的未走过等级,`reason` 必须**点到该等级要检查的对象名**(「时间不够」过不了)。
- **缺口三条 + 三道门**:`entities_unlanded`(逐主体差集:**断言主体在图上有边**才算落地)、`levels_skipped`、`orphan_terms`;每条缺口都带 `nextAction`。门 `requireLandedEntities` / `requireLevelReasons` / `requireCriteriaVerdict` 机制缺省关、preset 里开到生产,各自两条诚实出口(补齐 或 `abandoned`)。
- **目标的一句话与可清点的判据**:`SetGoal` 新增 `headline`(≤120 字;省略时由 `claim` 首句现算,现算超长当场拒)、`criteria[]` / `criteria_note`;改判据文本要带一份**已落定独立裁决**的 auditKey。
- **`clear/goals/{goalId}.md`**:本体声明里 `goal.persistence` 早就写了这个落点、此前没人写;现在内核幂等落盘(判据逐条、假设、修订留痕),卡里给压缩版 + 指针。
- **单一叙述源 `ui/lib/knowledge-view.js`**:运行态卡、右栏面板、词汇货架读**同一份**投影(此前四处各写一遍,漂了要读者自己调和)。
- **事件命名空间 `entity/` · `level/` · `criteria/` · `host/`**;`host/inactive` 四步闭环:宿主按 scope+detail 算**内容寻址 id** → 内核 pre-step 把没上账的落成变更 → 折法按 id **幂等** → 宿主只交出还没上账的那几条。
- **真值表**补 4 条机制(共 71 条)与**代码→真值表**的反向检查(顶层 `events` + 4 项校验,总 29 项);工具面 **29 → 32 件**,领域动词 10 件。

### Changed

- **CloseGoal**:派发/结算事实**在 `await` 之前独立落账**(工具抛错、被 abort 都抹不掉);裁决按**材料** digest **同态复用**——digest 只盖目标修订号、计划步与判据、观测、原始假设、事实、非审计来源的证据与**产物摘要**,不含"上一次评审自己的回声";交付那一步同样适用,但**证据照旧落账**(步骤历史与既有的「连续两次无法判定 ⇒ 强制改法」都靠它),省掉的只是那两分钟子 run。复用仍带得出评估卡与评估者会话。
- **裁决卡设预算**:`basis` ≤1200 字,缺口的每条写成 `{criterion, what, missing}` 三格。真跑里一次裁决的 `basis` 是五千余字、末步单次生成 81 秒。
- **宿主读面降级不再抛**:`ui/lib/index.js` 禁属性式服务访问,取不到返回空态;`sessionCwd` 拿不到会话目录**不写盘**(删掉 `process.cwd()` 回退——"写不出去"与"写到别处"是两件事)。
- **运行态卡**:判据**逐条**渲染(每条 80 字、最多 6 条 + "还有 N 条" + 指针)、`claim` 压缩、**删掉时钟**(分钟级时间戳让"同一状态的卡"每分钟变一次,按内容去重因此永远失效)。

### Fixed

- **评审只写正文卡片时,裁决被整份丢掉**(真模型长测抓到):`refs` 曾被写进 `VERDICT_SCHEMA` 的 `required`,评估者在 markdown 里写清 `verdict: support` 却因形状被 runtime 拒收 ⇒ 账上只剩「无法判定」,**目标永远结不了案**。现在 `refs` 声明但不强制,并给 `parseLooseJson` 加了**正文卡片兜底**(只认 `verdict:` 后那三个词;取不到就如实说取不到——猜一份 support 比丢掉一份 refute 坏得多)。
- **三处「目录取不到就拿 `null` 拼路径」的崩溃**(立约前侦察 / 观测登记 / 准入)与 `WriteMemory` / `SaveSkill` 的同类问题:一律降级为如实返回,不再抛。
- **`entities_unlanded` 的判据从"图上有节点"改成"图上有边"**:只数节点时,登记一个无关实例就能把缺口压掉,而真正该落地的主体仍只在命题上。

### Verified

- **18 套件 1879 项检查全绿**;真值表 29 项 / 71 条机制;`verify-package` 除沙箱内的 `npm pack` 外全过。
- **两场真模型 headless 长测**(装出来的包、无人值守):`entity-graph` **41 通过 / 0 失败**(13 个实例、15 条断言边、3 处跳级理由)、`long-plan` **40 通过 / 0 失败**(5 步全交付、记忆 1 条、账本 5 次提交、目标 achieved,并自发用了 5 个实例 + 9 条断言)。现场(轨迹、会话日志、读数)归档在 `docs/optimization/e2e-logs/`。
- **独立验证员**(fresh context、未参与实现)三轮复验 + 变异测试:抓出并修掉 11 处缺陷(含 3 处必崩的 `null` 路径、一处时间死区、一处可绕过的门);诊断与验证全文见 `docs/optimization/2026-09-diagnosis.zh-CN.md` 与 `2026-09-independent-verification.zh-CN.md`。

## [0.2.8] — 2026-09-28

**四个面板消失的那条 bug:客户端半读了一个已经不存在的字段。** 客户端拿「当前会话」用的是 `sessions.list.getSnapshot().current`;宿主的 `SessionListState` 现在只有 `{ ids, byId, phase, projectionsBySession }` —— **没有 `current`**。读到 `undefined`,`isCurrentPreset()` 就恒为 `false`,`occupy()` / `syncRail()` **一个座位都不注册**。失效形态与症状完全一致:模式在、宿主半一切正常,中栏只剩「对话 / 轨迹」、右栏只剩宿主自带的页签,**而且不报错**(0.1.7-rc.2 与 0.2.0-rc.1 的宿主都是这个形状)。

### Fixed

- **客户端:当前会话的取法改成宿主自己的那一套** —— 在 `byId` 里找 `retainedBy.mainView > 0` 的那一行(`dsh-client-ui-open-in-app`、`dsh-client-ui-agent-preset` 都这么写);老宿主若还留着 `current`,照旧认它。`isCurrentPreset()` 与 `sessionIdFor()` 两处共用一个 `currentSessionRow()`。

### Changed

- **测试桩与宿主同形**(`test/client.test.mjs`):旧桩自己造了 `current: 's1'`,于是 240 条检查全绿,而真宿主上四个面板静默消失 —— 桩和宿主不一样,测的就是桩。现在桩用宿主的真实形状(`ids / byId / phase / projectionsBySession` + `retainedBy.mainView`),这条路径从此有断言看着。
- 版本 0.2.8。

### Verified on DSH 0.2.0-rc.1

- **会话格式仍是 v4**(没有 v4→v5),0.2.5 那次的消息署名改动不用再动;
- **预设声明行照旧**:名册读到 `standard, ptc, minimal, cordis, clearai`,且 clearai **没有 broken** —— `verify-clean-install` 指向 0.2.0-rc.1 是 22 通过 / 0 失败;
- **真会话**:`node tools/e2e-run.mjs --installed` 在 0.2.0-rc.1 上 35 通过 / 0 失败(工具、`goal/set`、`plan/created`、投影、跨机制不变量);
- **真浏览器**(隔离 DSH_HOME + 真 Chrome + 一轮真模型):中栏 `对话 | 轨迹 | 产物 | 本体`,右栏「新标签页」里有 `世界树` 与 `技能 · 记忆`;
- 0.2 **没有删掉**我们预设用到的官方包;客户端插座与服务名(`conversation.view`、`conversation.input.*`、`sidebarRightTabs`、`sidebarRight`、`sidebar.right.pane.tab(.title)`、`layout`)在 0.2 源码里都还在。

## [0.2.7] — 2026-09-28

**装完显示「成功」,装到的却是上一版——原因不在我们,但句子在我们这边。** pnpm ≥ 11 起 `minimumReleaseAge` 默认 **1440 分钟(一天)**,而这条内置默认是**非严格**的:一天内发布的版本不会被选中,但**不报错**——它静默回退到**一天以前的最新版**。于是刚发完 `0.2.6`,三条路装到的都是 **`0.2.2`**(2026-09-18):`dsh plugin --profile web add clearai-dsh`(裸包名)、`@latest`、以及**设置 → 插件列表**里填包名。一台 Mac 上实测如此,本机也用 pnpm 12.4.1 在干净工作区复现过(裸名 → 0.2.2;`clearai-dsh@0.2.6` → 0.2.6)。

这一版**不改包的行为**,只改用户会照抄的那几句,并加一条判据钉住它。

### Changed

- **README(中英)的推荐安装命令改成钉版本的** `dsh plugin --profile web add clearai-dsh@0.2.7`,并新增一段「为什么要钉版本」:机制、两种解法——写死版本(pnpm 会自己记下例外),或在 profile 的 `pnpm-workspace.yaml` 里 `minimumReleaseAgeExclude: [clearai-dsh]` 按**包名**豁免所有版本。「设置 → 插件列表」那条也改成填 `clearai-dsh@0.2.7`。
- **「一条命令的安装器」标注清楚**:`npx clearai-dsh install` 自己解析当前版本并钉住它(`bin/clearai.mjs` 一直传的是 `clearai-dsh@<自己的版本>`),本来就不受这条延迟影响。
- `docs/dsh-integration`(中英)的安装段同步;`docs/known-gaps`(中英)的「跑起来之前」补两条:pnpm 的这条年龄策略,以及**版本切换中途刷新插件列表可能看到的一次 `locale` 元信息错误**——那是宿主读到了换了一半的包(清单已声明 `locale/`、目录还没铺上),装稳后消失(装稳的 0.2.5 读出纯回退值,装稳的 0.2.6 读出中英标题、介绍与图标)。
- **自检门新增一条**:发行物里的 `README.md` / `README.zh-CN.md` 必须出现钉到**本版版本号**的安装命令,且不许出现教人敲裸包名的命令行。

**证据**:pnpm 12.4.1 干净工作区实测——裸名与 `@latest` → `0.2.2`;`clearai-dsh@0.2.6` → `0.2.6`,且 pnpm 自动往 `pnpm-workspace.yaml` 写入 `minimumReleaseAgeExclude: clearai-dsh@0.2.6`;把豁免改成按包名(`- clearai-dsh`)之后,裸名 → `0.2.6`。机制出处:pnpm 文档 `minimumReleaseAge`(默认 `1440`,v11 起)与 `minimumReleaseAgeStrict`(内置默认下为 false)。

## [0.2.6] — 2026-09-28

**插件列表里终于写了介绍。** 宿主从 `locale/<语言>.json` 的 `meta.title` / `meta.description` 与清单顶层的 `icon` 读一个插件的显示文字和图标;**三样都缺时回退到包名 + npm 的 description + 默认图**——而那正是我们一直显示的东西:标题 `clearai-dsh`(包名)、介绍 "ClearAI: The Epistemic Loop, native to DSH."(README 的 tagline)、一个通用图标。装上它的人在一个「插件市场」式的列表里看到的,是一句没有说清装上得到什么的英文。

这一版把这三样补上,并给顺带发现的两处过时改了账:`docs/dsh-integration` 里「预设怎么进名册」还写着 `0.2.4` 之前的 root 目录机制(名册换代时它没跟上);README 的安装段也没提现在这条官方路径。

### Added

- **`locale/en.json` + `locale/zh.json`**:标题 `ClearAI`,一句话介绍分中英两份(界面是中文时不读英文)。宿主按文件名认语言,`en.json` 是基准。
- **`brand/icon.svg`**:插件列表的图标。与 `logo.svg` 同一套几何,只把主笔颜色**写死**——主标那支是 `currentColor`,而列表里它是以 data URL 读进来的、没有可继承的 CSS 上下文,`currentColor` 会落到黑色,暗色卡片上只剩那颗点;品牌位图虽有两版,`icon` 却只能给一个文件。取中性环色 + emerald 点,明暗两套主题都读得出。
- **`engines.dsh: ">=0.1.7-alpha.1"`**:宿主下界写进清单,市场据此显示要求(此前只有描述里那句话)。
- **`screenshots.json`**:给市场卡片声明 5 张截图(四张英文面板 + 一张本体图工作区)。不声明时市场从 README 自动抽取,而我们的 README 里只有 logo 与星标图。

### Changed

- **构建把 `locale/` 打进发行物**(装配表与 `package.json` 的 `files` / `exports` 同步):`exports` 不放行 `./locale/*.json`,宿主解析不到;不进 `files`,发出去的包里就没有。图标走已有的 `brand/` 整目录拷贝。
- **自检门加了「可被发现」这一关**:`verify-package` 判文件在不在、标题是不是包名、`exports` / `files` / `engines.dsh` 齐不齐;`verify-clean-install` 则**调宿主自己的 `readPluginMeta`** 对装好的那个包算一遍——「插件列表里会显示什么」从此是算出来的,不是我们复述的规则。这一关是先有的诊断:同一段宿主代码在我们补之前返回的正是 `{title: "clearai-dsh", description: "ClearAI: The Epistemic Loop, native to DSH."}`。
- **文档跟上现状**:`docs/dsh-integration` 的「预设怎么进名册」按**声明行**重写(`preset-clearai` 那一条,构建期由 `preset/agent.cordis.yml` 派生,宿主 ≥ `0.1.7-alpha.1`),并给「源 → 包」表补上 `locale/` 与 `brand/` 两行;README(中英)的安装段补上不开终端的那条路(设置 → 插件列表填包名)与市场收录后的那条。

## [0.2.5] — 2026-09-28

**跟上了宿主的会话格式 v4(消息来源改成生产者自有)。** 宿主 `0.1.7-rc.2` 起,`source.kind` 就是**生产者自己的身份**:共享包装 `{ kind: 'plugin', plugin }` 已退役,原生接纳在落账那一步**当场拒绝**它,报 `format v4 message requires a producer-owned source kind`。内核一直用旧包装下发运行态卡与外脑事实(合并目录 / 运行档 / 候选技能 / 世界线回灌),于是**每一轮都在落账那一步整轮失败**——卡片与事实一条都进不去。而单测当时全绿:它们直接调 fold,不经过宿主的接纳。

**为什么是 `plugin:clearai` 这个值**:宿主读取已发布 V3 日志时,未知名插件正是按 `plugin:<插件名>` 抬升的。选同一个值,老会话折得出来、新会话写得进去,两侧只认一个名字;另起一个名字则要永远维护新旧两套(而且旧会话在面板上的署名会和新会话长得不一样)。

### Changed

- **内核署 `plugin:clearai`,不再写 `plugin` 字段**:`MESSAGE_SOURCE_KIND` 一处定义,运行态卡与无卡通知两条通道共用。
- **折叠层同时认两种署名**:`plugin:clearai`(现在写的)与退役前的 `{ kind: 'plugin', plugin: 'clearai' }`(事件被**直接**喂进来时仍带着它:测试、旧导出、重放工具)。退回到旧形状时身份在 `plugin` 字段上,**只认 `clearai`**——别的插件冒名不进这道门。
- 形态字段没动:`form: 'snapshot'` + `sections` 照旧,面板的上下文注入行仍按 `form` 渲染(署名只换了个名字,呈现不变)。
- **e2e 里按 v3 形状找工具结果的地方跟着改到 v4**:`toolCallId` 在 v4 挂在**结果消息本身**上(退役前嵌在第一个 content 块里),旧写法让 `CreatePlan` 的两条断言**永远假红**(进程 exit 0、变更记录也落了,断言却报「契约错误」);`--freeform` 那两场的目标/计划断言也改成随形态跳过——与同一份工具里其余断言的判据对齐。
- **本地「干净安装」门不再随手挑一份 npx 缓存里的宿主**:这台机器的缓存里躺着 0.1.5-rc.1 与 0.1.7-rc.2 两份,`readdir` 挑到旧的那份时 `--dump-config` 会因为我们的 bundle patch 是数组(宿主 0.1.7-alpha.1 起才支持)当场崩,四条组合断言全红——而真正的原因(验的根本不是要支持的宿主)一个字都不在输出里。现在按版本挑最新的一份,并把「dsh 来自哪里、是哪个版本」念出来(CI 走 `DSH_CLI_PREFIX`,不受影响)。

**证据**:拿宿主真代码(`dsh-session-format-v3-to-v4` 的 `assertV4RowAdmission`)验过——新署名接纳,旧署名以那条原话被拒;并确认转换表里没有 `clearai`(所以旧日志正好抬升成同一个值)。内核侧新增一节断言钉住每一条下发消息的署名(非空、不是 `plugin`、等于 `plugin:clearai`、无 `plugin` 字段、form/sections 照旧);旧署名在 `test/host.test.mjs` 与 `test/invariant.test.mjs` 各留一条「仍折得出来」的正向用例。真跑一场(`node tools/e2e-run.mjs --installed`:真宿主 + 装出来的包 + 真模型 + 真会话日志):运行态卡以 `plugin:clearai` 落在日志里、没有接纳报错,`goal/set` 与 `plan/created` 照旧落账、投影长出计划,跨机制不变量全绿(35 通过 / 0 失败)。干净安装门(真 pnpm + 真 `dsh plugin add` + 真宿主 0.1.7-rc.2)18 通过 / 0 失败:装到的是 `clearai-dsh@0.2.5`,组合里 `clearai-host` 恰好一行,名册里 `clearai` 在列表里且没有 broken。

## [0.2.4] — 2026-09-28

**跟上了宿主的预设换代。** 宿主 `0.1.7-alpha.1` 起把 agent 预设的注册从「root 目录扫描」换成了「组合里的声明行」,而 clearai-dsh 一直靠一条覆盖 `agent-presets` 行的补丁,把名册的 root 指到包内 `presets/`。那行 id 在新宿主里**已经不存在**,补丁没有落点——包照样装得上、宿主行照样起得来,但 **ClearAI 不进模式选择器**。这一版把它接上。

**`0.2.3` 没有发布。** 它以 `v0.2.3` 触发了发布流水线,在「干净安装」那道门被拦下(拦的正是上面这个断裂),publish、registry 回查、建 Release 三步全部 skipped——npm 上半点副作用都没有。它原本要带的三条文档改动(版本号、中英 README)并入本版,所以这一版也包含 0.2.3 的账。

> ⚠️ **宿主支持边界:本版要求宿主 ≥ `0.1.7-alpha.1`。** 在更早的宿主(≤ `0.1.6-alpha.2`,包括曾被当作 `latest` 的 `0.1.5-rc.3`)上,本版会因为找不到 `@deepseek-ai/dsh-agent-preset` 而**让 profile 起不来**。仍留在旧宿主的部署请继续用 `0.2.2`。

### Added

- **预设声明行**:`presets/clearai/clearai.patch.yml` —— 一条 `- id: preset-clearai` 声明行,`config.plugins` 里放整份插件列表。它由 `preset/agent.cordis.yml` **构建期派生**(与 `ui/vendor/*.js` 同一条纪律:生成物进仓库,包 = 源的纯函数),不手抄第二份。`package.json` 的 `dsh.bundle.patch` 随之由单文件改为**数组**。
- **干净安装验收新增两条运行态断言**:boot 一次 profile,直接读 `agentPresets.list()`,要求 `clearai` 在列表里**且没有 `broken`**。静态的 `--dump-config` 看不出这件事——探针实测过:preset 里放一个**根本不存在的插件**,boot 依然完全正常,只有名册记一条 broken,界面就不显示这个预设。

### Changed

- **包内插件改用包内子路径**:`clearai-kernel` 与 `clearai-commands` 由 `./plugins/*.js` 改为 `clearai-dsh/presets/clearai/plugins/*.js`(`exports` 里加 `"./presets/*"` 放行)。声明行 `plugins` 的相对基准与原来的 `agent.cordis.yml` 不同,不改就会在名册里一直记着「never started」。
- **workflow 引擎换包**:预设里那条 `@deepseek-ai/dsh-workflow-worker-thread` 在新宿主里**已经下线**,改为同 group 内的 `@deepseek-ai/dsh-workflow-ptc`(与官方 standard 预设同形,且必须与 `tool-workflow` / `tool-ralph` 同处那个 `isolate: { workflowEngine: true }` 的 realm,否则两条工具会一直「waiting for workflowEngine」)。
- `pack/cordis.patch.yml` 里那段 `- id: agent-presets` 覆盖**已删除**:它在新宿主上没有目标行,留着只会让下一个人以为预设还靠目录扫描。
- 文档与版本信息:项目版本更新至 `0.2.4`,中英 README 更新(原 0.2.3 的三条改动)。

## [0.2.3] — 2026-09-23(未发布)

> 本版**从未发布到 npm**。它是纯文档版本(版本号 + 中英 README),在发布流水线上被宿主换代造成的断裂拦下——原样发出去的话,用户在新宿主上装到的包不进预设选择器。改动已并入 [0.2.4]。


**文档与版本信息更新。**

### Changed

- 更新项目版本至 `0.2.3`。
- 更新中文 README。
- 更新 README。

## [0.2.2] — 2026-09-18

**装的时候不再吓人。** 0.2.1 的 `npx clearai-dsh install` 会打出一串 peer 警告(react / graphology-types …),读起来像装坏了——而它们一个字都不影响运行。这一版把安装面收窄到运行时真正需要的那一个依赖,并让安装侧 CLI 按系统语言出话。

### Changed

- **安装面只剩一个运行时依赖。** `@xyflow/react` / `graphology` / `graphology-layout-forceatlas2` / `docx` 挪进 `devDependencies`:前三个只在构建期打 vendor(`lib/client.js` 里是**内联**的,装机后不解析 npm),`docx` 只给营销 docx 脚本用。于是 profile 里不再多装一批包,也不会再有那些注定填不上的 peer 警告——React 由 **DSH 宿主**提供(客户端半 `require('react')` 是问宿主拿的),`graphology-types` 只是类型包。运行时唯一保留的是 `zod`(宿主半 `lib/host.js` 真的 `from 'zod'`)。
- **安装侧 CLI 跟系统语言走。** `doctor` / `install` / `root-yaml` / `seed` / `unseed` 的每一句都在中英两份文案表里(并排放在一处,改的时候不会只改一边);判据是 `--lang zh|en` > `CLEARAI_LANG` > `LC_ALL` / `LC_MESSAGES` / `LANG` > ICU 的默认 locale,`C` / `POSIX` 当「没有语言信息」按英文处理。0.2.1 之前是无论系统是什么都说中文。

## [0.2.1] — 2026-09-18

**知识任务是循环的原生行为,不是另一个模式。** 本体、实体、认识论早就在,但普通研究的最短路径仍然是「检索 → 总结 → 写报告」——要建本体得用户先想起来说一句。这一版修的是**接线缺口**:把知识任务的判据做成结构的(目标还开着 + 带着登记过的假设),系统自己进知识模式;并把图从手写 SVG 换成 React Flow,给了它一个真正的全屏工作区。

### Added

- **知识模式(分诊)**:判据是**结构的**——目标还开着,而且它带着登记过的命题。立约(`SetGoal`)本身就是模型已经做出的承诺;普通问答从不立约,于是从不进这一档(**零成本契约**)。词面启发式猜错了没人能复核,结构判据可以。
- **知识预检**:把「已知」自动送到模型面前——只读、有界、**词面命中不猜语义**;每条读数说得出它来自哪条事实。
- **缺口读数**:从已有事实算出还缺什么形态,每条指得出一个能补的动作。真跑的反直觉结论:改变行为的其实是**缺口的可见性**,不是门——所以两者都留(可见性让它想做,门不让它绕过)。
- **知识门**:结案之前、派评估者之前拦住**没有形态的核心结论**——纯散文不许升格。
- **知识 Inspector**:点节点或边 → 定义 / 关系 / 断言 / 证据链 / 登记与修订史;「按此筛选」是详情里的**显式动作**,不猜你点它的意思。新增宿主只读路由 `/api/clearai/inspector` 与行为测试。
- **图谱工作区**:图带可展开成全屏工作区,布局是力导向(知识图谱的原生形状);渲染交给 React Flow(`@xyflow/react` 12,vendor 行随构建走,与 `dist/` 同一条纪律)。
- **哲学 P6**:「本体生长是循环的原生行为,不是另一个模式」——写进[循环哲学](docs/loop-philosophy.zh-CN.md)与[认识论循环](docs/epistemic-loop.zh-CN.md)(中英)。
- **素材工具** `tools/panel-shots.mjs`:折一场真会话 → 挂**真组件** → 真 Chrome 截图(与 `tools/graph-shots.mjs` 同一条口径)——面板截图从此可复现,不用人去界面里手点。

### Changed

- **图 DTO 统一**:图带与工作区共用同一份投影,判据只有一处(`fold` → `view()` → `graphProjection()`);「同一份账本 ⇒ 同一张图」是投影的性质。
- **预设描述**收敛成一句中英并排:「利用认识论循环构建可信本体。Build a trustworthy ontology through the epistemic loop.」——名册只有这两行元数据,宿主不会替我们本地化,所以只能自己写死。
- **README 的「安装」改为「安装与使用」**:写明怎么在模式选择器里切到 `ClearAI`(默认标准模式不挂认识论循环),并把本体图 / 图带 / Inspector 的真机截图放进去。
- 营销物料换掉全部陈旧面板截图:知乎稿与 docx、小红书 9 张卡片改用真机会话的投影(统计同步为 15 套件 1618 条断言 · 29 个意图工具 · 6808 行内核 · 50 种事件分支)。

### Fixed

- **命题身份在修订时被重新签发**:同一句话在 id 空间里躺着两份读数(一份「已支持」、一份「未触及」),真会话的卡实测 4 条主张显示成 6~8 行。现在主张原文不变就复用原 id,换了主张才发新 id;并补上 `hypothesis/superseded` 一直缺席的生产者。
- **节点拖不动**(两次):受控 `nodes` 没接 `onNodesChange`;拖动键写成了对象,`[object Object]` 查不到。
- **React Flow 是 forwardRef 对象,不是函数**——守卫把合法组件判成「没装上」;并改为同作用域注入,不再依赖运行时模块行。
- **图带收不到 sessionId**;时间戳不再显示 1970。
- **工作区读面有主人**:子会话结构上写不进词汇 / 事实货架。
- 力导向布局的四个真机缺陷(评估者独立复核后逐条修掉)。

## [0.2.0] — 2026-09-17

**研究的产品形态是本体。** 认识论循环是本体的生产工艺,事实是它的内容单位——真值方向不变(世界 → 证据 → 事实 → 长成本体),所以**本体不裁决任何事,它只收留被裁决过的东西**。别的知识图谱靠抽取与断言堆边;这里的每一条边都要通过循环挣得。

### Added

- **领域本体(语言层)**:六个账本事件(`ontology/term_added / predicate_added / *_revised / *_deprecated`)折成 `state.lexicon`;概念与谓词带依据接纳、版本化修订、黏性废止(**没有删除**);语义变化必须换 id。判据只有一份(`ui/lib/domain-language.js` 纯函数),模型工具、人门动词与折法同源。
- **七个具名动词**:`RegisterTerm / RegisterPredicate / ReviseTerm / RevisePredicate / DeprecateTerm / DeprecatePredicate / QueryKnowledge`(意图工具 22 → 29 件)。
- **类型化断言**:假设可带 `assertions`(主词–谓词–宾语;值形态 statement/quantity/formula/code/reference + 关系宾语 instance);**提供即严校**(引用存在、形态合域、同一事实自洽,一律落账之前拒),不提供放行(旧事实显示「未结构化」,不回溯改写);升格时断言随事实定型,事实按 id 关联假设(修掉按文本匹配)。
- **冲突只暴露,不裁决**:同一单值谓词、同一主体、不同客体 ⇒ 派生一对冲突;卡片与货架各说一遍;不进闸门、不动任何一侧;处置走既有的人门。
- **本体格(中栏)**:图带(本体图|实体图、缩放平移、全景、点节点=按概念过滤)、断言芯片就地展开词条卡、冲突行+内联标记、过滤 N/M 行、折叠的词汇维护区(含登记抽屉与废止入口——经人门通道,判据与模型工具同一份);零成本契约:没有词条时这一格与从前逐像素相同。
- **词汇货架** `clear/ontology/domain.md`(概念/谓词/Mermaid 图/引用统计/废止缘由/冲突),幂等渲染,`clear/ontology/` 进系统拒写清单。
- **提示词** `clearai/domain-language`(hard;24 段定义 / 23 段在场)。

### Changed

- **定位**:「认识论工作台」→「基于认识论的本体研究平台」;口号「从证据,到改进」→「从证据,到本体」;中栏「事实」格更名「本体」格,事实货架更名**本体货架**(视图 id `clearai-facts` 与账本词汇不动——只有用户可见名词收敛)。
- 术语收敛:**本体图**(原词汇图)/ **实体图**(原知识图,「知识图谱」是业界词,指整体)。
- 事实货架 INDEX.md 头改「本体内容(已确立条目…)」。
- **README 整体重塑**:口号「你的研究，长成一个本体」;叙事从「认识论循环工作台」转向
  「本体发现与探索平台」——先讲你得到什么(本体),再讲凭什么可信(循环,折叠在 details 里);
  面板截图换为本体格为主角(待截);安装与案例后移。定位/术语表/CHANGELOG 同步。

### Fixed

- e2e 的会话目录 slug 不认中文路径(宿主把 亨通 编码为 ~4EA8~901A):真项目(中文工作区名)此前必被误报成一排 ✗。
- `--installed` 一次性形态:ClosePlan 之后交出回合即结束 ⇒ CloseGoal 必须同回合连续调用(已写进 e2e 记账)。

## [0.1.7] — 2026-09-16

**同一件事实只有一个来源。** 一轮"按真值表逐条核对 → 按症状打补丁 → 发现自己在打补丁 →
按权威归属复核 → 删掉补丁"的完整收敛。净效果是**更少的机制、更少的字段、更少的分支**。

### Fixed

- **"Ended" is not "lost": audits now have the same recovery path as scouts.** When the host's subagent catalog says an evaluator's run has ended, the kernel first **recovers the verdict from the child's own session log** (`recoverVerdictFromChildSession`) — the same path `sweepScouts` has always had — and only records `unknown` when recovery fails. Three honest outcomes replace the old single "lost, this verdict will have no result" (which induced re-delivery ⇒ the same evaluation was redone while its result lay on disk): recovered (verdict + audit card land), ended-but-incomplete (`audit_incomplete`), and log-unreadable (`auditor_ended_uncollected`). The settlement text no longer gives advice — whether to retry is a plan-level decision, not the ledger's to make.
- **The ruler's scale must be a nameable reference, not prose.** `decide_by_scale_not_reference`: the right side of `量 = 口径` must reference **a file that actually exists in the workspace**; prose and dead paths are rejected. `评分 = 按本路线情况评分` passed the old format check and guaranteed nothing. Whether the branches actually *used* the measuring instrument remains the evaluator's job — the string check stops here and no longer pretends to verify.
- **`runEvaluator`'s three `unknown` exits now push `audit/settled`.** An evaluator that crashed, didn't finish normally, or whose card could not be written previously left only a `audit/dispatched` on the ledger — looking like "still running" when it had already ended. All three paths now settle: a bad ending is still an ending.

### Changed

- **The host-invariant companion now advances state with the production fold.** It previously folded its own index of plans/steps/forks/branches/audits/hypotheses (ten Maps) — a second interpreter that needed two repairs in its first hour because its shapes disagreed with the main projection. It now calls `applyEvent` from `fold.js` on the same events, keeping only the five contract predicates and one `admitted` set (the fold deliberately keeps `admission/checked` as ledger-only). 386 → 190 lines. Two real contract holes fixed in the same pass: dispatch+settle and admission+advance legitimately occur **in the same batch** (the kernel emits them that way), so the judge now accumulates as it iterates.
- **Turn-end bookkeeping shrank to a workspace snapshot.** The `clearai/turn-ended` event, `turnEnds` state, the in-flight list, and the run-state card's "their conclusions will not come back" (an inference with no evidence — a parent turn ending proves only that the parent turn ended) are all **deleted**. The closing beat (`agent/turn-stopping` / `agent/error`) now only records a ledger commit of the turn's writes — the one thing that belongs to us. `STATE_VERSION` 8 → 9.
- **Sub-run settlement texts no longer give advice.** "Re-delivering this step dispatches a fresh evaluator" (audits) and "if you need that material, dispatch another scout" (scouts) are gone. The ledger states facts; retry decisions belong to the plan layer.

### Added

- **The authority map** (`docs/authority-map.zh-CN.md` + English): who produces each fact, where it lives, who consumes it, whether it can be derived — with the four confirmed findings (each now marked as fixed or under review) and the acceptance criterion: one failure class explained in one place; one fact one authority; the same run never re-executed because a read failed; the system can quietly say it does not know.
- **`subagent/end` as a settlement channel** (in-process): fires on the same promise settlement as the handle we already trust, so settlement is not lost when the handle is gone (restart, mode switch, early return). Unknown child ids are ignored — someone else's sub-run is not our fact.

## [0.1.6] — 2026-09-16

**机制不许再说自己没有的话。** 一轮「按真值表逐条核对文档 vs 代码」的清点,把三处
「文档写了、代码没有」补上了生产者;同时修掉四处在真跑里现形的缺陷——其中一个控件
**点了报成功、账上一字未改**,还有一把**只有方向、没有口径**的尺子。

### Fixed

- **A control that reported success and did nothing.** The inbox rendered the same `fork_adopt` gate twice: once by the worldline block (with each branch's reading) and again by the generic list, because `needs === 'click'` implied "give it a 裁决 button". The second button sent `fork: null`, so the fold's `forks.find(id === null)` matched nothing and the state did not change — while the host route answered `200 {ok:true}`. One criterion now drives both renderings, and the generic layer only offers what it can actually land: 采纳 for a skill candidate, 用提问卡决定 for a gate the worldline block cannot render, a sentence-prompt for word gates.
- **The ruler had a direction but no scale.** Two worldlines' `done_criteria` were byte-identical and each told the *branch* to publish its own 计分口径 — so two mutually invisible executors measured in different units (炉次 vs 等效炉次) and `min` compared the two conventions as if they were one quantity. `decide_by.metric` must now read `量 = 口径` (`decide_by_scale_required`), and the *sharing* is guaranteed by the existing "each branch's criteria must contain the metric verbatim" check — no new field, no new gate, refused at registration instead of after the work.
- **The declared evidence path was never told to the doer.** `ForkPlan` declares each branch's `artifacts`, and delivery requires those paths to exist inside the executor's worktree — but the executor's brief carried only criteria, approach and workspace. A fresh agent therefore wrote to `products/reports/` and delivery failed on the declaration, leaving "copy the file into the declared path" as the only way through: a copy in a place where the evidence was not produced. The brief now carries the declared paths, and the refusal names the two honest ways out instead of inviting the copy.
- **The delivery-point commit could be swallowed by an exploration snapshot.** A snapshot committed the tree, so the delivery commit became empty, `commitLedger` skipped it silently (its rule is "nothing changed → no commit") and the delivery point disappeared from the ledger. The delivery point is a *named* event ("what the workspace looked like when this step was delivered"): only it passes `allowEmpty`.
- **Receiving no verdict never escalated.** A lost or unavailable independent verdict failed closed forever: the model could re-deliver, fail closed, and repeat — the same action, no new fact — without ever reaching a person. It now shares the block counter with a failed admission, so repeating it blocks the plan and lands in the inbox door that already exists.
- **`retracted` had no producer** — the state was declared in the ontology, absent from it in code, and drawn in the panel. Refuting evidence now only *marks* a promoted fact (`refuted`, derived) and raises an inbox item; a human decides **撤回** or **维持原事实**, and both land as one `fact/reviewed` (retraction is terminal, the record is kept). "No decision" and "decided to keep" have to stay distinguishable, or the gate holds continuation forever.
- **Platform junk no longer enters the ledger.** `.DS_Store` is nobody's content, is binary, and changes whenever a directory is browsed — two worldlines' copies always differ, so a merge conflicts over something unrelated to the delivery (a person clicked adopt and the model spent a round aligning `.DS_Store` bytes). `LEDGER_JUNK` now goes into the same `info/exclude` (exclusion is per repository, so every worktree benefits), and files already tracked are unstaged with `git rm --cached` — index only, the file in the workspace is untouched.

### Added

- **`untouchedLevels`.** A level measures how much a conclusion depends on trusting the doer; the compensation ladder (independent evaluator → human release) is the mechanism. "One level at a time" is an economic order, not a permission — and a reason for skipping cannot be falsified, so requiring one would be a field nobody can check. What is mechanical: the levels a hypothesis never used are derived and shown.
- **`confirm_provisional`.** A provisional adoption could only be acknowledged by talking, while an open gate holds continuation — so the system waited for an action that could never arrive. Approval is a decision and now has a button.
- **`VoidPlanStep`-style exits for the two gates that had none**, and two new human-gate verbs `retract_fact` / `keep_fact` (the whitelist is enumerated verbatim, and every gate is now checkable for both outcomes).
- **Exploration snapshots** (`git/snapshot`): work written between deliveries is recorded, so exploration output is recoverable without asking anyone to declare it.

### Changed

- **The truth table tells the truth about itself.** Every `implemented` row must point at symbols that exist (`source.code` is now falsifiable and caught a dead identifier), every non-implemented row must name a destination, and the counts are 57 mechanisms: implemented 51 / partial 1 / design-only 1 / removed 4.
- **`verification-loop`'s state table is a landing-point record**, not a design target: each of the nine names says where it lives today (a fact / something `derive()` computes / deliberately unrepresentable), and a machine check goes red if a row is added without one. §6 now says what carries each rule and admits that rule 1 is a reading, not a gate.
- **Observation provenance declares only what has a producer** (`self`, `scout`); the type may not promise an origin nothing writes.
- Docs, counts and suites aligned: 13 suites, 1267 assertions, `verify-package` 31/0.

## [0.1.5] — 2026-09-16

**卡片读不出自己的名字。** 预设卡片显示成 `clearai` + 「暂无描述」,而不是 ClearAI 与它的说明 ——
根因不在界面,在文件:元数据根本没被读进去,而名册对读失败**静默降级**。

### Fixed

- **The preset card still read `clearai` with an empty description.** 0.1.2, 0.1.3 and 0.1.4 all shipped `preset.yml` with the description as a plain YAML scalar containing `English: state` — a colon followed by a space cannot appear in a plain scalar, so the file did not parse at all. DSH's preset roster treats *every* metadata read failure as "no metadata", silently, so the picker fell back to the directory id plus 「暂无描述」 and nothing on either side reported an error. The description is now a block scalar, and `verify-package` parses `preset.yml` with the host's own `yaml` library and requires a non-empty `name` and `description` — this can no longer ship silently.

## [0.1.4] — 2026-09-16

**子任务的交付链修好了。** 侦察与世界线执行者的结论此前只进账本、模型读不到
(账本里也有过「派出去就再也没人收」的挂空)。现在四类子任务(侦察 / 世界线执行者 /
评估者 / 横评仲裁)统一走原生 `subagents.start()` 的一次性句柄:账本只认本进程攥着的
`run.result`,结论正文由**收集那一刻的工具返回**交给模型,全文另落
`clear/knowledge/materials/<id>.md` 供模型、独立评估者与人共读。
试过的另一条路(拿运行时的结算通知当账本信号)已撤回——它是 best-effort,当不了承重结构。

### Added

- **ClearAI's own `/` command menu.** `/goal` `/plan` `/evidence` `/worldline` are read-only state windows computed from the ledger on the spot; `/plan-review` re-presents the active plan through the native review card instead of stamping anything itself (commands carry no mutation channel — the authority boundary test pins this).
- **Native working tools return.** todo, subagent (with model selection), workflow and ralph mount from the standard preset's own rows; the composition suite pins both directions — present: these four; absent: `tool-goal`, `command-goal`, `plan-mode` (the second ledger stays off).
- **`test/prompt-sections.test.mjs`.** All 23 prompt sections carry a `hard` / `native` / `advisory` class tag, and the suite pins that the classification matches the content (hard sections name a mechanism anchor; native sections name no kernel tool; advisory sections make no mechanism promises).

### Changed

- **Hypothesis floor is now a hard boundary.** `SetGoal` rejects zero or one hypotheses when `minHypotheses > 0` (kernel default 0 stays neutral; the preset sets 2). Revisions of an existing goal are exempt.
- **Authorization wording unified to one sentence everywhere.** Kernel messages, the runtime card and the prompts all say: an unapproved plan does not auto-continue; when you advance it explicitly, the first delivery records attribution as it happened (behaviour is authorization). The card says it in human words — ledger field names no longer appear.
- **Stale native-tool contracts rewritten.** `edit` is literal replacement, not unified diff; `web_search`/`web_fetch` parameter references that no longer exist were removed.
- **Comment debt cleared to zero.** ~310 comments rewritten to the style rule (why / what breaks / boundary — no dates, no internal section numbers, no incident narratives); the ratchet quotas are now {0, 0, 0}.

### Changed

- **Async sub-runs now deliver their conclusions through the runtime's own settlement notice.** `SpawnScout`, `MapScouts` and the worldline executors are started with `subagents.startContinuable()`, whose Activation delivers the child's closing message to the parent as a durable user message; the kernel keeps owning only what it must (the `scout/dispatched` / `scout/settled` ledger, the full-text material file under `clear/knowledge/materials/`, and the pointer on the runtime card). Evaluators and the arbitration reviewer stay on the one-shot path: the native durable-child descriptor deliberately omits `outputSchema`, which belongs to a one-shot activation's result contract.
- **Scout conclusions are persisted in full** to `clear/knowledge/materials/<id>.md` so the model, the independent evaluator and the human read the same copy; the ledger and the runtime card carry a pointer plus a bounded excerpt, and over-long text is marked `…truncated (N chars total, see <path>)` instead of being silently cut. The scout persona now caps its answer at 3000 characters.
- **A goal's closure records the hypotheses nobody touched.** `goal/closed` carries `unjudged`, the card writes `(untouched)` for a hypothesis with no evidence at all (distinct from "judged inconclusive"), and the loop contract asks for either one touch of evidence or an explicit note about why there was none — no verdict is ever forced.

### Fixed

- **`install.sh` aborted on macOS (bash 3.2).** It expanded an empty array as `"${OLD_PANEL_PKGS[@]}"` under `set -u`; bash only tolerates that from 4.4 on, while macOS ships 3.2 — so the documented developer install died at step ② for every macOS contributor. CI runs on Linux (bash 5), which is why it never caught it. Both expansions now use the portable `${arr[@]+"${arr[@]}"}` form.
- **Long-run evidence was overwritten or lost.** Every run now gets its own timestamped archive: the light half (stdout, structured result, provenance, decoded one-line-per-event trajectory, append-only index) is committed, while the heavy half (workspace, raw session log) stays on disk under `~/.dsh/e2e-archive/` so it can be re-judged offline with `tools/e2e-replay.mjs`. `--workspace` pointing inside any git repository is now refused outright: ClearAI commits each delivery into the workspace's own repository, so an in-repo workspace had the kernel commit its delivery snapshots — and the author's uncommitted work — into the host project.
- **Session-directory name derivation dropped dots.** DSH keeps `.` (and `_`) when it slugs a workspace path; the old rule folded both away, so a workspace under `~/.dsh/…` was reported as "no session log" (38 assertions red in one run). The rule is now taken from a real directory comparison.
- **Scout conclusions never came back in a scouts-only run.** `AwaitWorldlines` decided whether to keep waiting from the wait-lines produced by `sweepWorldlineExecutors()`, and `sweepScouts()` never produced one — so with only scouts in flight the loop exited on its first tick, even though `SpawnScout`'s own reply tells the model to "wait for it this turn with `AwaitWorldlines`". The one-shot form added a second layer: with no next turn, a conclusion that settled after the last tool call never met another collection point. `sweepScouts()` now reports how many scouts are still unsettled, `collectExecutors()` passes it through, and `AwaitWorldlines` counts it. Verified end to end: the same scenario that stalled twice (goal left open, evaluator refusing `inconclusive`) now finishes 36/36 with the conclusion in the material surface and the goal `achieved`.
- **Scout conclusions were invisible to the model even after they settled.** They landed only in the mutation record while the section the model reads every step is the runtime card — which had no material surface. Now delivery rides the native settlement notice, the card lists foreign observations (pointer + excerpt) plus the scouts still in flight, and a long-run invariant asserts that an async sub-run's conclusion appears in model-visible text rather than only in the ledger.
- **Scouts had no "lost" ending.** Worldline executors and evaluators already wrote one; a scout whose child was gone stayed "not yet reported" forever. The judgement now mirrors the evaluator's: in-process dispatches are alive, the native child catalog decides what is still running, and an unavailable read surface means *no judgement* rather than a fabricated one.
- **The prompt described `SpawnScout` as synchronous.** It said the conclusion comes straight back as the return value and that the tool waits; the kernel is deliberately asynchronous (the blocking wait used to lose the "dispatched" fact when a run was interrupted). The delegation table now teaches the real contract (fire-and-forget, conclusion replays into the material surface, wait with `AwaitWorldlines`), and a drift check pins it.
- **`AwaitWorldlines` counted mutations, not conclusions.** One scout writes two mutations (`scout/settled` plus the observation), so a single scout was reported as "回灌 2 条". The count and wording now speak of conclusions.
- **`clearai-commands` cross-plane import.** It imported `ui/lib/fold.js` from the preset plane; in the installed package the relative layout differs, so switching to the preset in a browser failed at import. The command renderers now use the host-provided `clearai` facade for `derive` as well, and the boundary suite pins that no preset plugin imports across planes.
- **macOS temp-path realpath mismatches.** Session-log lookup and clean-install workspace registration now resolve realpaths (`/var` is a symlink to `/private/var`), which had made e2e logs unfindable and browser session attach fail.

### Changed (sub-run lifecycle, unified)

- **All four sub-run kinds now share one native lifecycle.** Scout, worldline executor, evaluator and the arbitration reviewer all go through one-shot `subagents.start()` handles; the ledger settles from the `run.result` this process holds, and the conclusion text reaches the model in the tool return of the collecting call. The attempt to use the runtime's settlement notice as a ledger signal is withdrawn: a notice is best-effort, and a live kernel could not reliably see it through either the projection or its own session log. Role differences are now only persona, tool face, and how the result is interpreted — permission and authority boundaries are unchanged.
- **A scout's conclusion is recorded even when its in-memory entry exists.** The old collection guards skipped exactly the sub-runs the table was holding, so a scout could sit "dispatched, never collected" forever. The sweep now walks every unsettled sub-run in the projection, and de-duplication moved to a session+epoch map that also works after a restart.

### Tooling

- **Long-run end-to-end scenarios with offline re-judging.** Five scenarios (`worldline-arbitration`, `falsification`, `long-plan`, `scout-first`, `goal-chain`) plus a set of cross-mechanism invariants (no advance without admission, no dangling evaluator, no orphaned fork, promotion level consistency, no dangling scout, evidence bound to real steps, declared artifacts on disk). `tools/e2e-parallel.mjs` runs them concurrently (cap 3, because each run spawns its own worldline executors and evaluators), `tools/e2e-replay.mjs` re-judges a saved session log without spending tokens, and `test/e2e-scenarios.test.mjs` pins every invariant with a negative case so a mis-written judge cannot report a false green.

### Validated

- **deepseek-flash end-to-end, two headless scenarios** (24/24 plan-and-stop; 25/25 full completion including independent-evaluator settlement) and **one real-browser session** (clean install + Chrome): preset switching, native review-card approval landing `by='user'`, the full thirteen-beat chain, `/goal` rendering, and all four panels drawing — screenshots in `docs/shots/browser-e2e-*.png`.

## [0.1.3] — 2026-09-15

**一条命令的安装路径,以及一条从没被走通的发布路径。**

### Added

- **`npx clearai-dsh install` — one command, and the only prerequisite left is DSH's own.** The published package has always carried an install-side tool, but it only *diagnosed*: `doctor`, `root-yaml`, `seed`, `unseed`. The installer that could actually place the package lived in `tools/install-native.mjs`, which is not in the published files — so a stranger had nothing to run but `dsh plugin … add`, a command whose first word assumes a `dsh` that an `npx`-launched harness never puts on `PATH`. The new `install` verb resolves the CLI (a `dsh` on `PATH`, else `npx --yes @deepseek-ai/dsh`), installs into the profile, and then reads the composed config back to show that the `clearai-host` row really landed. `--dist` / `--tarball` / `--spec` point it at a local build instead of the registry, which is what the lifecycle check now exercises.

### Changed

- **The install instructions no longer teach a mechanism we do not own.** They handed the reader a `corepack enable` line as the way to get pnpm. Corepack is a version *router*, not an install: its 186-byte shim fetches a pnpm on first use, and corepack 0.34 — the one Node 24 ships — launches pnpm by looking for `bin/pnpm.cjs`, which pnpm 11 and later no longer provide. It can therefore fetch a version it is unable to run, and its shims can shadow a pnpm that already worked. The docs now name the requirement (a `pnpm` on `PATH`, which is DSH's rather than ours) and leave the choice of how to satisfy it to the reader.
- `install` does not bootstrap a profile or hand-reconcile one. The CLI initializes a profile the first time it is used for one (`initialized profile web at …`), and a second implementation of the host's reconcile step is exactly the duplication this project rejects. Passing a shipped profile name to `--from-default-profile` is an error in the CLI (`profile "web" is shipped and cannot be a custom profile target`), so the verb does not offer that flag at all.
- `install` stops when `pnpm` is missing instead of degrading: pnpm is DSH's prerequisite, not this plugin's. The degraded, pnpm-less path stays in `tools/install-native.mjs`, where it exists for one-shot E2E homes and labels itself as degraded.
- **`doctor` asks the composed config through a `dsh` on `PATH` first**, falling back to `npx --no-install`. It previously always went through npx, so a machine that had the CLI on `PATH` could still be told the composition could not be determined.
- **The lifecycle check had a gate that could never open.** Its byte-for-byte comparison included `INVENTORY.txt` — the build's own file manifest, which is not in `files` and is therefore never present in a pnpm-installed copy — so that assertion was red on every run, and because the lifecycle check is not part of CI, nobody saw it. It also drove every compose query through `npx --no-install`, which returns an empty string when npx cannot run: two positive assertions failed while the negative one ("the row is gone") passed on that empty output. Both are fixed — the CLI is resolved from `PATH` first, and the comparison ignores the build manifest — and the check now exercises the shipped `install` verb too (28 checks).

## [0.1.2] — 2026-09-12

### Fixed

- **A gate could be impossible to open.** The plan review is a real gate — only a person's approval writes the authorisation mark, and the kernel refuses to start work without it. But the review card was raised **only** when a plan was created, so after a person chose *revise first, then resubmit*, the model revised the plan and there was **no entry point left** to present it again. The plan stayed unauthorised while the kernel correctly refused to work: a mechanism turned into a dead end.

  Now `AmendPlan` and `RefinePlan` present an unauthorised plan again automatically, and the new **`RequestPlanReview`** tool is an explicit entry point for the model or a person to re-present it. Only approval writes the mark; every other outcome still writes nothing.

### Added

- `RequestPlanReview` — re-present the current plan for review without changing anything. Returns `already_confirmed` when the plan is already authorised.

### Changed

- **The continuation window no longer shows a machine id.** The native goal chip displayed `ClearAI 续跑窗口 · 目标 g-…` — a mechanism word plus an id, on a surface the platform renders for people. It now reads as a sentence about the work (`继续做完:<what you asked for>`). The window's identity is no longer the text: ownership is tracked in the ledger, and a change of wording goes through `goals.edit`, which **does not touch the round budget**, so revising a goal still cannot refresh it.

## [0.1.1] — 2026-09-12

### Fixed

- **The first delivery in a fresh workspace could lose its own ledger commit.** The ledger is created lazily, so if it happens to be created at the moment a step is delivered, that first commit was written as an anonymous "baseline" — the step itself then had no commit of its own in `FileHistory`. The baseline now carries the delivery's message, so the step is attributed either way. Found by CI running on the `v0.1.0` tag; the local machine never reproduced it, because another suite had already created the ledger first.

### Changed

- The file-history assertion in the kernel suite picks the commit by step id instead of by position, and reports the whole history on failure rather than a truncated slice.

## [0.1.0] — 2026-09-12

The first release: ClearAI as a native DSH plugin.

### Added

- **The Epistemic Loop, as mechanism.** One agent preset carrying 21 intent tools — goals, plans, steps, hypotheses, worldlines, evidence, evaluation, facts, skills, memory — where completion is computed from delivered evidence rather than declared by the model.
- **Admission without verdict.** Delivering a step checks whether the declared artifacts exist, are non-empty and well-formed. It never decides what they mean; that is the next evaluation's job.
- **Independent evaluation.** A step above L0–L2 that carries a criterion has its result judged by a fresh-context evaluator with a read-only tool face, and the verdict is written by the system, not by the doer.
- **Worldlines.** Mutually exclusive routes run as separate branches with their own working copies; the winner is decided by a metric registered before the work, and a decision the arithmetic cannot make stops and asks a person.
- **An append-only ledger.** Refuted hypotheses, voided steps, abandoned forks and superseded plans stay on record; nothing is deleted.
- **One host package, one preset, one client module.** The DSH engine is not modified: the host half rides the bundle patch layer, the preset rides the roster, and the panels ride the client module.
- **Bilingual surfaces.** Every panel string and every document ships in English and Chinese; the language follows the DSH locale and switches without a reload.
- **Verification tooling.** Five test suites, a byte-for-byte package rebuild check, a deployment composition check, a real-process end-to-end run, and `tools/verify-clean-install.mjs` — sixteen mechanical assertions against an empty `DSH_HOME` installed through the real CLI.

### Notes

- Requires `pnpm` on `PATH` (`dsh plugin …` is a pnpm forwarder) and Node ≥ 22.
- **Restart `dsh web` after installing**: both halves are cached in the running process, so a browser refresh is not enough.
- Known gaps — what is deliberately not implemented, and what has only been verified to a stated depth — are listed in [`docs/known-gaps.md`](docs/known-gaps.md).

[0.1.2]: https://github.com/Clearailhc/clearai-dsh/releases/tag/v0.1.2
[0.1.1]: https://github.com/Clearailhc/clearai-dsh/releases/tag/v0.1.1
[0.1.0]: https://github.com/Clearailhc/clearai-dsh/releases/tag/v0.1.0
