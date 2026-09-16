# ClearAI 机制真值表

> **本文件由 `truth-table.json` 生成，不要手工编辑。**
> 权威源是 `docs/optimization/truth-table.json`；改内容改那里，然后跑 `node tools/build-truth-table.mjs`。
> 交叉校验见 `node tools/verify-truth-table.mjs`。

这份表回答一个问题：**当前代码真正保证的是什么**。它不描述愿望——`设计目标` 与 `已删除` 就是字面意思。

## 计数

- 机制条目：**48**
- 按状态：已实现 44 · 部分实现 3 · 设计目标 1
- 按强度：
- 真正阻断执行的：**16**
- 受 autonomy 影响的：**2**
- 存在已知不符（文档 / 注释与代码不一致）的：**14**

## 代码常量快照

这一节由代码导出，不是手写：

- 机制：6 个（goal / plan / worldline / scout / brain / ledger）
- 意图工具：22 件（SetGoal CloseGoal CreatePlan CheckPlan RequestPlanReview AmendPlan RefinePlan VoidPlanStep ClosePlan AdvancePlan ForkPlan AdvanceWorldline ConvergeFork WorldlineStatus AwaitWorldlines AbandonFork SpawnScout MapScouts SaveSkill WriteMemory FileHistory RestoreFile）
- 配置键：26 个
- 提示词段：定义 23 段，同一时刻在场 22 段（槽位 clarification 二选一）

## 总表

| id | 机制 | 层 | 状态 | 强度 | 权威 | 责任方 | 阻断执行 | 受 autonomy 影响 | 代码位置 |
|---|---|---|---|---|---|---|---|---|---|
| `goal-set` | 目标登记与修订 | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | 否 | `preset/plugins/clearai-kernel.js SetGoal` |
| `goal-close` | 目标结案与独立评估 | 认识论 | 已实现 | 硬边界 | 权威 | model | 是 | 否 | `preset/plugins/clearai-kernel.js CloseGoal` |
| `hypothesis-registry` | 假设登记与状态派生 | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | 否 | `preset/plugins/clearai-kernel.js SetGoal hypotheses` |
| `criteria-required` | 判据先写（done_criteria 强制） | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js-2426 validateSteps` |
| `formal-plan` | 正式计划 | 认识论 | 已实现 | 硬边界 | 权威 | model | 是 | 否 | `preset/plugins/clearai-kernel.js CreatePlan` |
| `plan-review` | 计划人工审阅（唯一授权来源） | 认识论 | 已实现 | 硬边界 | 权威 | human | 否 | 否 | `preset/plugins/clearai-kernel.js-2798 autoConfirmed=false + requestPlanReview` |
| `plan-reauthorize` | 计划重新呈递审阅 | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | 否 | `preset/plugins/clearai-kernel.js RequestPlanReview` |
| `advance-plan` | AdvancePlan：唯一完成动词 | 认识论 | 已实现 | 硬边界 | 权威 | model | 是 | 否 | `preset/plugins/clearai-kernel.js AdvancePlan` |
| `plan-amend-no-progress` | AmendPlan / RefinePlan / VoidPlanStep 不动进度 | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | 否 | `preset/plugins/clearai-kernel.js AmendPlan` |
| `admission` | 观测准入（只判收不收） | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js admission` |
| `self-judge-limit` | L0–L2 允许自判，L3+ 拒绝自判 | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js SELF_JUDGE_MAX_INDEX=2` |
| `independent-evaluator` | 独立评估者（fresh context + 只读工具面） | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js runEvaluator / resolveToolFace / evaluatorPrompt / writeAuditCard` |
| `l4-human-release` | L4 步骤/分支级人工放行 | 认识论 | 部分实现 | 硬边界 | 权威 | human | 是 | 否 | `preset/plugins/clearai-kernel.js-3178 l4Delivery` |
| `evidence-record` | 证据登记 | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | 否 | `preset/plugins/clearai-kernel.js buildEvidenceOrigins` |
| `fact-promotion` | 事实升格 | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | 否 | `preset/plugins/clearai-kernel.js persistFact` |
| `history-retention` | 只追加历史（什么都不删） | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | 否 | `ui/lib/fold.js（全体 case 无删除分支）` |
| `worldline-fork` | 世界线分叉（独立工作副本） | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | 否 | `preset/plugins/clearai-kernel.js ForkPlan` |
| `worldline-metric` | 预注册指标与算术收敛 | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js validateForkOptions` |
| `worldline-adopt` | 世界线采纳必须由人按下 | 认识论 | 已实现 | 硬边界 | 权威 | human | 否 | 否 | `ui/lib/index.js 人门通道（adopt_branch / abandon_fork）` |
| `block-threshold` | 连拦阈值（证据质量闸） | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js blockedThreshold` |
| `skill-candidate` | 技能默认候选态（人采纳才进目录） | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | 否 | `preset/plugins/brain.js LESSON_REQUIRED/FACT_REQUIRED` |
| `memory-write` | 记忆写入（字段校验 + 标题去重） | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | 否 | `preset/plugins/brain.js-39 字段契约` |
| `single-loop` | 单循环人格（不做多 Agent 编排） | Harness | 已实现 | 建议 | 无 | model | 否 | 否 | `preset/agent.cordis.yml-31 persona` |
| `four-beats` | 四拍节奏（计划→执行→观察→反思） | Harness | 已实现 | 建议 | 无 | model | 否 | 否 | `preset/plugins/prompts.js exploration-rhythm` |
| `scout-precommit` | 立约前侦察（一生一次） | Harness | 已实现 | 建议 | 权威 | system | 否 | 否 | `preset/plugins/clearai-kernel.js runScout / precommitRecon / scoutDigest / sweepScouts / persistMaterial / noticeBlock` |
| `map-scouts` | 并行侦察（有上限与并发） | Harness | 已实现 | 建议 | 非权威 | model | 否 | 否 | `preset/plugins/clearai-kernel.js MapScouts / sweepScouts / persistMaterial / noticeBlock` |
| `evaluator-readonly-face` | 评估者只读工具面 | Harness | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js resolveToolFace` |
| `executor-tool-face` | 世界线执行者工具面（不含计划/目标动词） | Harness | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js executorToolFilter` |
| `tool-trimming` | 工具面按贡献表裁剪 | Harness | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js MECHANISM_TOOLS` |
| `native-todo-disabled` | 原生工作方式(todo/subagent/workflow/ralph)挂载 | Harness | 已实现 | 硬边界 | 无 | system | 否 | 否 | `preset/agent.cordis.yml 工作方式段(刻意不挂表只剩 tool-goal/command-goal/plan-mode)` |
| `native-goal-disabled` | 原生 goal 工具与命令未挂载 | Harness | 已实现 | 硬边界 | 无 | system | 否 | 否 | `preset/agent.cordis.yml-222` |
| `native-plan-mode-disabled` | 原生 plan-mode 未挂载 | Harness | 已实现 | 硬边界 | 无 | system | 否 | 否 | `preset/agent.cordis.yml-226` |
| `subagent-trimmed` | 自由子代理 / workflow / ralph 未挂载 | Harness | 已实现 | 硬边界 | 无 | system | 否 | 否 | `preset/agent.cordis.yml-225` |
| `bash-deny-rules` | Bash 危险命令拒绝规则 | Harness | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js 危险命令匹配` |
| `protected-roots` | 系统受保护目录（模型不可直写） | Harness | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js-5255 protectedRoots / touchesProtected` |
| `git-ledger` | 只追加 git 账本（工作区仓库或旁路账本） | Harness | 已实现 | 硬边界 | 权威 | system | 否 | 否 | `preset/plugins/clearai-kernel.js-3446 git/ledger` |
| `kernel-panic-recovery` | 引擎级异常的降权只读恢复 | Harness | 已实现 | 建议 | 无 | model | 否 | 否 | `preset/plugins/prompts.js execution-discipline（KernelPanic / EffectOutcomeUnknown）` |
| `auto-continuation` | 自动续跑（由门状态驱动） | Harness | 已实现 | 硬边界 | 权威 | system | 否 | 否 | `preset/plugins/clearai-kernel.js turnDemand` |
| `max-auto-turns` | 续跑轮数上限（默认 128） | Harness | 已实现 | 硬边界 | 权威 | system | 是 | 否 | `preset/plugins/clearai-kernel.js DEFAULT_MAX_AUTO_TURNS=128` |
| `autonomy-config` | autonomy：部署初值 + clarification 槽位选择器 | Harness | 部分实现 | 仅提示词 | 无 | system | 否 | **是** | `preset/plugins/clearai-kernel.js CFG.autonomy` |
| `runtime-card` | 每回合派生的运行态卡 | Harness | 已实现 | 建议 | 无 | system | 否 | 否 | `ui/lib/fold.js renderCard` |
| `prompt-sections` | 提示词段（23 段定义 / 22 段在场） | Harness | 已实现 | 建议 | 无 | system | 否 | **是** | `preset/plugins/prompts.js-312` |
| `exploration-zone` | 非权威探索区（设计目标） | Harness | 设计目标 | 建议 | 非权威 | model | 否 | 否 | — |
| `subrun-lifecycle` | 子 run 统一生命周期（一次性句柄 + 一条收集通道） | Harness | 已实现 | 硬边界 | 权威 | system | 否 | 否 | `preset/plugins/clearai-kernel.js dispatchSubRun / startWorldlineExecutor / runScout / runEvaluator / runArbiter / sweepScouts / sweepWorldlineExecutors / sweepLostExecutors / sweepLostScouts / publishedInEpoch / noticeBlock` |
| `human-gate-actions` | 人门动作白名单 | 宿主 | 已实现 | 硬边界 | 权威 | human | 否 | 否 | `ui/lib/index.js 人门通道` |
| `context-pruning` | 上下文剪枝与压缩（宿主原生） | 宿主 | 已实现 | 原生 | 无 | system | 否 | 否 | `preset/agent.cordis.yml-110 compaction group` |
| `model-routing` | 模型路由与切换（宿主原生，ClearAI 不持有） | 宿主 | 已实现 | 原生 | 无 | host | 否 | 否 | `宿主平面（ClearAI 未注册任何 provider/model 状态）` |
| `commands-menu` | 人类 `/` 命令菜单 | 交互 | 部分实现 | 原生 | 无 | human | 否 | 否 | `preset/agent.cordis.yml command-compact（唯一的命令行）` |

## 逐条明细

### `goal-set` · 目标登记与修订

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 SetGoal 并给出 claim / done_criteria / hypotheses
- **输入**：claim, done_criteria, hypotheses[], reason(修订时必带)
- **输出**：mutation goal/set
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：目标与判据必须在工作开始前落账，否则完成度无从派生。
- **代码**：preset/plugins/clearai-kernel.js SetGoal; ui/lib/fold.js case 'goal/set'
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/state-protocol · **文档**：docs/epistemic-loop.zh-CN.md

### `goal-close` · 目标结案与独立评估

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 CloseGoal(outcome=achieved|abandoned)
- **输入**：outcome, note
- **输出**：mutation audit/dispatched + audit/settled + goal/closed + fact/promoted
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：结案不能由做的人自己宣布；achieved 必须过独立评估者的结构化裁决。
- **代码**：preset/plugins/clearai-kernel.js CloseGoal; syntheticStep; runEvaluator; ui/lib/fold.js case 'goal/closed'
- **测试**：test/kernel.test.mjs · **配置**：l4RequiresHumanRelease, auditProvider, auditTimeoutMs, auditToolFilter
- **提示词**：clearai/verification · **文档**：docs/verification-loop.zh-CN.md

### `hypothesis-registry` · 假设登记与状态派生

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：SetGoal 登记 hypotheses；证据到位后由 fold 派生支持等级
- **输入**：claim, refute_when
- **输出**：派生 supportedLevel / refutation 计数（不落第二本账）
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：假设状态由证据算出来，模型不能打分。首次立目标至少登记 2 条候选（preset 强制，0 条一样拦）：只有一个猜想，检验容易退化成找证据支持自己。
- **代码**：preset/plugins/clearai-kernel.js SetGoal hypotheses; ui/lib/fold.js case 'hypothesis/superseded'
- **测试**：test/kernel.test.mjs · **配置**：minHypotheses（内核默认 0 = 机制中立；preset 立 2 = 产品立场，与 blockedThreshold 同一模式）
- **提示词**：clearai/loop-contract · **文档**：docs/epistemic-loop.zh-CN.md

### `criteria-required` · 判据先写（done_criteria 强制）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：CreatePlan / AmendPlan 校验步骤
- **输入**：steps[].done_criteria
- **输出**：装配期拒绝：缺少判据、长度 < 4、或判据自指
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：没有判据就没有可失败的检验，独立评估也无从触发。
- **代码**：preset/plugins/clearai-kernel.js-2426 validateSteps; 调用点 CreatePlan
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/plan-governance · **文档**：docs/epistemic-loop.zh-CN.md
- **已知不符**：历史上的真实软肋：docs/loop-philosophy 曾称「L3+ 无 done_criteria 可绕过独立评估」。阶段 3 已把该段限缩为「只适用于旧日志/内部构造/未来入口」，并写明正常 CreatePlan 入口已强制判据（validateSteps，kernel.js:2405-2426）。残余风险是「每条进入系统的路径都校验判据」这条假设靠测试而非类型维持。

### `formal-plan` · 正式计划

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 CreatePlan
- **输入**：brief, steps[{id, do, artifacts, done_criteria, tests?}]
- **输出**：mutation plan/created（confirmed_at 仅在审阅通过后非空）
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：步骤、产物声明与判据必须在执行前落账，完成度由此派生。
- **代码**：preset/plugins/clearai-kernel.js CreatePlan; MAX_PLAN_STEPS=25; ui/lib/fold.js case 'plan/created'
- **测试**：test/kernel.test.mjs · **配置**：minBriefChars
- **提示词**：clearai/plan-rhythm, clearai/plan-governance · **文档**：docs/epistemic-loop.zh-CN.md

### `plan-review` · 计划人工审阅（唯一授权来源）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：human
- **触发**：CreatePlan 后机制自己发起原生审阅卡
- **输入**：原生 plan-review 答案：approved / declined / cancelled / unavailable
- **输出**：仅 approved 写 confirmed_at + confirmed_by='user'；其余三种一个字都不落。**注意：这不是硬阻断**——未授权只让自动续跑 hold（kernel:1898），AdvancePlan 本身仍可执行，并在同一条变更里补写 confirmed_by='progress'（kernel:3034-3038「行为即授权」）
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-plan-mode 的审阅卡（ClearAI 借用原生审阅界面，不借账）
- **理由**：计划授权必须是「人按的那一下」。若无此门，一切基于授权的推理都是空的。
- **代码**：preset/plugins/clearai-kernel.js-2798 autoConfirmed=false + requestPlanReview; requestPlanReview 走 ctx.userQuestions.ask('plan-review')
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/plan-governance · **文档**：docs/release-verification.md
- **已知不符**：**系统前后不一致（阶段 3 修掉了文案，语义冲突仍在，留给阶段 4 决定）**：同一回合里 `CreatePlan` 的结果消息写「计划仍未授权，**不要开工**，如实停下等人」（kernel.js:2775），而运行态卡写「授权记号未落账……**不需要任何人先按什么**」（fold.js:1510），两句都进模型上下文。根因是 fold 把授权当**记号**、CreatePlan 把它当**闸门**。阶段 3 已修正的漂移：preset/agent.cordis.yml 与 prompts.js 的「无人值守立约即授权 / Goal 档自动确认」、CHANGELOG 0.1.2 与 release-verification 的「未授权内核拒收工作」、fold.js 里 `by:'autonomy'` 的注释。

### `plan-reauthorize` · 计划重新呈递审阅

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 RequestPlanReview，或 AmendPlan/RefinePlan 之后
- **输入**：无
- **输出**：再次呈现审阅；已授权时返回 already_confirmed
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：没有重新呈递入口时，「先改再交」会变成死门。
- **代码**：preset/plugins/clearai-kernel.js RequestPlanReview; AmendPlan/RefinePlan 会自动重新呈递
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/plan-governance · **文档**：CHANGELOG.md 0.1.2

### `advance-plan` · AdvancePlan：唯一完成动词

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 AdvancePlan 并携带交付声明
- **输入**：step_id, artifacts, verdict（L0–L2）, basis
- **输出**：mutation admission/checked + step/advanced（或拒收）
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：只有一个动词能推进循环，「谁推进了这一步」才永远可回答。
- **代码**：preset/plugins/clearai-kernel.js AdvancePlan; SELF_JUDGE_MAX_INDEX 自判上限; ui/lib/fold.js case 'step/advanced'
- **测试**：test/kernel.test.mjs · **配置**：blockedThreshold, l4RequiresHumanRelease, l4RejectSelfWritten
- **提示词**：clearai/loop-contract · **文档**：docs/loop-philosophy.zh-CN.md

### `plan-amend-no-progress` · AmendPlan / RefinePlan / VoidPlanStep 不动进度

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用三者之一
- **输入**：步骤增补 / 判据修订 / 作废理由
- **输出**：plan/amended, plan/refined, plan/voided（进度不变）
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：进度只由 AdvancePlan 改变，避免多入口推进导致的归属不清。
- **代码**：preset/plugins/clearai-kernel.js AmendPlan; RefinePlan; VoidPlanStep; ui/lib/fold.js/323/330
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/plan-governance · **文档**：docs/loop-philosophy.zh-CN.md

### `admission` · 观测准入（只判收不收）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：AdvancePlan 交付时
- **输入**：声明的 artifacts
- **输出**：存在 / 非空 / 结构合法 → 收；否则计一次冲闸，达 blockedThreshold 置 blocked
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：准入回答「这份观测收不收」，不回答「它说明了什么」；不裁决才没有污染结论的问题。
- **代码**：preset/plugins/clearai-kernel.js admission; verdict_not_accepted; ui/lib/fold.js case 'audit/dispatched'
- **测试**：test/kernel.test.mjs · **配置**：blockedThreshold
- **提示词**：clearai/verification · **文档**：docs/loop-philosophy.zh-CN.md

### `self-judge-limit` · L0–L2 允许自判，L3+ 拒绝自判

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：AdvancePlan 携带 tests.level
- **输入**：level（L0–L4）
- **输出**：level > L2 且调用方自带 verdict → verdict_not_accepted
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：做的人不判自己；等级越高，越不能自证。
- **代码**：preset/plugins/clearai-kernel.js SELF_JUDGE_MAX_INDEX=2; ;
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/verification · **文档**：docs/verification-loop.zh-CN.md

### `independent-evaluator` · 独立评估者（fresh context + 只读工具面）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：准入判定 needs_audit（产物齐备且 done_criteria 非空）时的 L3+ 步骤
- **输入**：只读产物 + 结构化输出 schema
- **输出**：mutation audit/settled，评估卡由系统落盘
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：dsh-subagent spawn（内核只借用宿主子代理后端）
- **理由**：执行者不能成为结果的唯一裁判；spawn 而非 fork 才能保证判者与做者不共享历史。
- **代码**：preset/plugins/clearai-kernel.js runEvaluator / resolveToolFace / evaluatorPrompt / writeAuditCard; ui/lib/fold.js case audit/dispatched
- **测试**：test/kernel.test.mjs · **配置**：auditProvider=spawn, auditTimeoutMs, auditToolFilter
- **提示词**：clearai/verification · **文档**：docs/verification-loop.zh-CN.md

### `l4-human-release` · L4 步骤/分支级人工放行

- **层**：认识论 · **状态**：部分实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：human
- **触发**：L4 步骤交付 / 世界线分支交付
- **输入**：原生审批栈的放行记录（不可伪造的审批对）
- **输出**：无放行记录 → 拒收
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：宿主审批瀑布 ask
- **理由**：L4 意味着高代价或不可逆，必须有人按的那一下。
- **代码**：preset/plugins/clearai-kernel.js-3178 l4Delivery; -4067; ; ui/lib/fold.js case 'human/released'
- **测试**：test/kernel.test.mjs · **配置**：l4RequiresHumanRelease=true, l4RejectSelfWritten=true
- **提示词**：clearai/verification · **文档**：docs/known-gaps.zh-CN.md
- **已知不符**：只覆盖步骤/分支级放行；覆盖每一次评估的通用 L4 门未实现，属设计目标。

### `evidence-record` · 证据登记

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：步骤推进时携带 basis / 来源
- **输入**：basis, refs[], origins[]
- **输出**：mutation evidence/recorded
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：结论必须能追到来源；证据可 supersede，不可删除。
- **代码**：preset/plugins/clearai-kernel.js buildEvidenceOrigins; ui/lib/fold.js case 'evidence/recorded'
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/verification · **文档**：docs/epistemic-loop.zh-CN.md

### `fact-promotion` · 事实升格

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：目标结案且假设达到 promote_at_level 且无推翻
- **输入**：goal, hypothesis, 评估者裁决
- **输出**：写入 clear/knowledge/facts/<goal>.md + mutation fact/promoted
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：事实由系统按门槛算出来，模型不能宣称。
- **代码**：preset/plugins/clearai-kernel.js persistFact; promote_at_level 门槛; ui/lib/fold.js case 'fact/promoted'
- **测试**：test/kernel.test.mjs · **配置**：l4RejectSelfWritten
- **提示词**：clearai/verification · **文档**：docs/epistemic-loop.zh-CN.md

### `history-retention` · 只追加历史（什么都不删）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：任何状态变更
- **输出**：推翻 / 作废 / 落选 / 修订全部留痕
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：被推翻的假设是资产：它记录了此路不通。
- **代码**：ui/lib/fold.js（全体 case 无删除分支）; preset/plugins/clearai-kernel.js RestoreFile 走新 commit
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/context-discipline · **文档**：docs/loop-philosophy.zh-CN.md

### `worldline-fork` · 世界线分叉（独立工作副本）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 ForkPlan 且给出互斥分支与预注册指标
- **输入**：branches[], decide_by（指标）
- **输出**：mutation fork/created, worldline/prepared, worldline/executing, worldline/executed, branch/delivered
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：互斥路线各占一份工作副本，互不污染。
- **代码**：preset/plugins/clearai-kernel.js ForkPlan; prepareWorldlines; startWorldlineExecutor
- **测试**：test/kernel.test.mjs, tools/spike-git-worldlines.mjs · **配置**：gitWorldlines, autoDispatchExecutors, executorToolFilter, executorTimeoutMs
- **提示词**：clearai/worldline · **文档**：docs/epistemic-loop.zh-CN.md

### `worldline-metric` · 预注册指标与算术收敛

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：ConvergeFork
- **输入**：各分支读数 + 预注册尺子
- **输出**：mutation fork/converged；算不出来 → fork/undecidable，交人
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：尺子必须事先登记；算不出来就停下问人，绝不退化成随便挑一条。
- **代码**：preset/plugins/clearai-kernel.js validateForkOptions; decideWinner; ConvergeFork; runArbiter
- **测试**：test/kernel.test.mjs · **配置**：autoAdoptMinGap=0.15, forkArbitration
- **提示词**：clearai/worldline · **文档**：docs/epistemic-loop.zh-CN.md

### `worldline-adopt` · 世界线采纳必须由人按下

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：human
- **触发**：人在面板上执行 adopt_branch / abandon_fork
- **输入**：fork id, branch id, reason
- **输出**：user 来源消息折进投影，写 by:'user'
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：算术排序选出赢家；采纳是人按的那一下。两者不可合并。
- **代码**：ui/lib/index.js 人门通道（adopt_branch / abandon_fork）; preset/plugins/clearai-kernel.js AbandonFork; adoptWorldline
- **测试**：test/host.test.mjs · **配置**：—
- **提示词**：clearai/worldline · **文档**：docs/epistemic-loop.zh-CN.md

### `block-threshold` · 连拦阈值（证据质量闸）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：同一件事连续冲闸未过
- **输入**：连续未过次数
- **输出**：达阈值 → 计划置 blocked、停下等人
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：它是质量闸不是预算，因此不再按档取值。
- **代码**：preset/plugins/clearai-kernel.js blockedThreshold; ui/lib/fold.js case 'block/counted'
- **测试**：test/kernel.test.mjs · **配置**：blockedThreshold=2（预设显式值）
- **提示词**：clearai/verification · **文档**：docs/loop-philosophy.zh-CN.md

### `human-gate-actions` · 人门动作白名单

- **层**：宿主 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：human
- **触发**：面板提交人门动词
- **输入**：adopt_branch / abandon_fork / promote_skill
- **输出**：source.kind='user' 的消息；表外动词一律拒（400）
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：这些动词没有工具 schema，模型的工具面里不存在它们。
- **代码**：ui/lib/index.js 人门通道; ui/lib/fold.js HUMAN_GATE_ACTIONS; preset/plugins/clearai-kernel.js
- **测试**：test/host.test.mjs · **配置**：—
- **提示词**：clearai/state-protocol · **文档**：docs/design-principles.zh-CN.md

### `single-loop` · 单循环人格（不做多 Agent 编排）

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：model
- **触发**：每回合的 persona 与 foundation 段
- **输出**：模型被要求以单一主循环推进
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh 原生 subagent / workflow / ralph（已随预设挂回(阶段 5;权威边界测试钉死它们产不出 clearai 变更)）
- **理由**：子角色由系统按触发派生，避免自由委派把「自己派人判自己」重新引入。
- **代码**：preset/agent.cordis.yml-31 persona; preset/plugins/prompts.js foundation
- **测试**：test/prompt-sections.test.mjs（阶段 6 新增） · **配置**：—
- **提示词**：clearai/foundation · **文档**：docs/loop-philosophy.zh-CN.md
- **已知不符**：只由提示词承载，属偏好；阶段 5 计划以「非权威探索 / 权威评估」分层重新放开自由编排。

### `four-beats` · 四拍节奏（计划→执行→观察→反思）

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：model
- **触发**：每回合注入
- **输出**：模型据四拍组织行为
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：七阶段在运行时的压缩表达。
- **代码**：preset/plugins/prompts.js exploration-rhythm; preset/agent.cordis.yml
- **测试**：test/prompt-sections.test.mjs（阶段 6 新增） · **配置**：—
- **提示词**：clearai/exploration-rhythm · **文档**：docs/loop-philosophy.zh-CN.md
- **已知不符**：属提示词偏好，未落机制。

### `scout-precommit` · 立约前侦察（一生一次）

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：权威 · **责任方**：system
- **触发**：SetGoal 落定判据，且 input/ 有材料
- **输入**：brief
- **输出**：mutation scout/dispatched + scout/settled
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：侦察是低权威的读侧工作，先看清材料再立约。
- **代码**：preset/plugins/clearai-kernel.js runScout / precommitRecon / scoutDigest / sweepScouts / persistMaterial / noticeBlock; ui/lib/fold.js case scout/dispatched
- **测试**：test/kernel.test.mjs · **配置**：precommitRecon=true, scoutToolFilter
- **提示词**：clearai/delegation · **文档**：docs/epistemic-loop.zh-CN.md

### `map-scouts` · 并行侦察（有上限与并发）

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：非权威 · **责任方**：model
- **触发**：模型调用 MapScouts
- **输入**：任务清单
- **输出**：多个只读子 run 的结论
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh 原生 subagent 并行（已随预设挂回(阶段 5;权威边界测试钉死它们产不出 clearai 变更)）
- **理由**：放几十个子 run 出去不是并行，是把宿主打满。
- **代码**：preset/plugins/clearai-kernel.js MapScouts / sweepScouts / persistMaterial / noticeBlock
- **测试**：test/kernel.test.mjs · **配置**：mapScoutMax=50, mapScoutConcurrency=4
- **提示词**：clearai/delegation · **文档**：docs/epistemic-loop.zh-CN.md

### `evaluator-readonly-face` · 评估者只读工具面

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：派遣评估者时
- **输入**：候选工具名
- **输出**：按部署实际工具注册表过滤；未知工具名 fail-closed
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：dsh-subagent 的 tools.restrict
- **理由**：判的人不能改产物。
- **代码**：preset/plugins/clearai-kernel.js resolveToolFace; auditToolFilter
- **测试**：test/kernel.test.mjs · **配置**：auditToolFilter=[read,glob,grep,read_image]
- **提示词**：clearai/verification · **文档**：docs/verification-loop.zh-CN.md

### `executor-tool-face` · 世界线执行者工具面（不含计划/目标动词）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：派遣世界线执行者时
- **输入**：候选工具名
- **输出**：任务书即计划；执行者工具面里根本没有 CreatePlan/AdvancePlan/ClosePlan
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：把「不要自己开计划」从嘱咐变成不可表达。
- **代码**：preset/plugins/clearai-kernel.js executorToolFilter
- **测试**：test/kernel.test.mjs · **配置**：executorToolFilter
- **提示词**：clearai/delegation · **文档**：docs/epistemic-loop.zh-CN.md

### `tool-trimming` · 工具面按贡献表裁剪

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：装配期
- **输入**：贡献表
- **输出**：unknown_mechanism / unknown_tool / tool_of_disabled_mechanism 等装配期抛错
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：装了哪些工具是清单事实，不是散落在代码里的既成事实。
- **代码**：preset/plugins/clearai-kernel.js MECHANISM_TOOLS; resolveContributions; ctx.tools.register
- **测试**：test/kernel.test.mjs · **配置**：contributions.{mechanisms,tools,sections}
- **提示词**：— · **文档**：docs/loop-philosophy.zh-CN.md

### `native-todo-disabled` · 原生工作方式(todo/subagent/workflow/ralph)挂载

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输出**：四件原生工作方式在工具面里;第二本账三件仍不挂
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-tool-todo（standard 预设挂载）
- **理由**：工作方式交还原生:它们产不出一条 clearai 变更(权威边界测试钉死)。「todo 是第二本账」的旧判断在阶段 5 被修正——便签不是账本,进度永远以 AdvancePlan 落账为准。第二本账三件(goal 工具/命令、plan-mode)仍然不挂:那是真冲突。
- **代码**：preset/agent.cordis.yml 工作方式段(刻意不挂表只剩 tool-goal/command-goal/plan-mode)
- **测试**：test/preset-composition.test.mjs（阶段 5 新增） · **配置**：—
- **提示词**：— · **文档**：preset/agent.cordis.yml

### `native-goal-disabled` · 原生 goal 工具与命令未挂载

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输出**：tool-goal / command-goal 均不在面里
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-tool-goal / dsh-command-goal（standard 预设挂载）
- **理由**：ClearAI 的目标账是唯一一本；宿主 goals 只当续跑驱动器被内核程序化使用。
- **代码**：preset/agent.cordis.yml-222
- **测试**：test/preset-composition.test.mjs（阶段 5 新增） · **配置**：—
- **提示词**：— · **文档**：preset/agent.cordis.yml

### `native-plan-mode-disabled` · 原生 plan-mode 未挂载

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输出**：plan-mode 不在面里
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-plan-mode（standard 预设挂载）
- **理由**：与 CreatePlan/AdvancePlan 是两套计划纪律，同时挂上就是第二本账。
- **代码**：preset/agent.cordis.yml-226
- **测试**：test/preset-composition.test.mjs（阶段 5 新增） · **配置**：—
- **提示词**：— · **文档**：preset/agent.cordis.yml

### `subagent-trimmed` · 自由子代理 / workflow / ralph 未挂载

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输出**：tool-subagent / tool-subagent-control / tool-workflow / tool-ralph 均不在面里
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-tool-subagent / dsh-tool-workflow / dsh-tool-ralph
- **理由**：自由委派会重新引入「自己派一个来判自己」。
- **代码**：preset/agent.cordis.yml-225
- **测试**：test/preset-composition.test.mjs（阶段 5 新增） · **配置**：—
- **提示词**：clearai/delegation · **文档**：preset/agent.cordis.yml
- **已知不符**：阶段 5 计划以分层方式放开：非权威探索可自由编排，权威评估仍由内核派生。

### `bash-deny-rules` · Bash 危险命令拒绝规则

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：每次 bash 工具调用前
- **输入**：command 字符串
- **输出**：kind:'deny' + reason
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无重叠（已核实）：宿主 bash 只有沙箱路径域与审批升级，没有内容级威胁模式清单（dsh-tool-bash / dsh-bash-sandbox / dsh-bash-local 均无）；fork 炸弹这类在可写沙箱内完全合法的命令，只有内容规则拦得住
- **理由**：危险命令不可执行应落机制而不是提示词。与宿主治理分属三条轴：沙箱管「写哪」、审批管「谁同意」、这份清单管「命令本身是什么威胁」。
- **代码**：preset/plugins/clearai-kernel.js 危险命令匹配; / 受保护路径拒绝
- **测试**：test/kernel.test.mjs · **配置**：bashDenyRules=true
- **提示词**：— · **文档**：docs/loop-philosophy.zh-CN.md

### `protected-roots` · 系统受保护目录（模型不可直写）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：每次写类工具调用前
- **输入**：路径
- **输出**：clear/evidence、clear/knowledge/facts、clear/goals 由系统所有 → deny
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：事实与评估卡只能由系统落盘。
- **代码**：preset/plugins/clearai-kernel.js-5255 protectedRoots / touchesProtected
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/verification · **文档**：docs/design-principles.zh-CN.md

### `git-ledger` · 只追加 git 账本（工作区仓库或旁路账本）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：步骤交付点 / 文件历史查询 / 恢复
- **输入**：路径或交付点
- **输出**：mutation git/committed, git/restored, git/snapshot
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：事后可回滚取代事前审批的前提是账本足够可靠。
- **代码**：preset/plugins/clearai-kernel.js-3446 git/ledger; FileHistory; RestoreFile
- **测试**：test/kernel.test.mjs · **配置**：ledgerMaxFiles=20000
- **提示词**：clearai/context-discipline · **文档**：docs/loop-philosophy.zh-CN.md
- **已知不符**：旁路账本被删除会让仍存活的分叉变成孤儿（见 known-gaps）。

### `kernel-panic-recovery` · 引擎级异常的降权只读恢复

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：model
- **触发**：KernelPanic / EffectOutcomeUnknown
- **输出**：恢复回合只允许只读工具，禁止 bash/子 Agent 重放
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：效果未知时先观察当前事实，再谈重试。
- **代码**：preset/plugins/prompts.js execution-discipline（KernelPanic / EffectOutcomeUnknown）
- **测试**：test/prompt-sections.test.mjs（阶段 6 新增） · **配置**：—
- **提示词**：clearai/execution-discipline · **文档**：docs/loop-philosophy.zh-CN.md
- **已知不符**：只由提示词承载；宿主侧是否另有硬约束需要阶段 3 核实。

### `auto-continuation` · 自动续跑（由门状态驱动）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：回合结束时检查是否仍有工作且门都关着
- **输入**：派生状态：blocked / 授权 / 未决裁决 / hasOpenGate / 开着的步 / 目标是否开放
- **输出**：drive / hold / stop；对应宿主 goals 的 create/edit/resume/pause/block/clear
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-goal-round-driver 执行轮数上限
- **理由**：「要不要人」已经由门表达；再让用户预先声明是错的。
- **代码**：preset/plugins/clearai-kernel.js turnDemand; armContinuation; holdContinuation; stopContinuation
- **测试**：test/kernel.test.mjs · **配置**：runtimeCard, maxAutoTurns
- **提示词**：clearai/clarification-* · **文档**：docs/epistemic-loop.zh-CN.md

### `max-auto-turns` · 续跑轮数上限（默认 128）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：布防续跑窗口时
- **输入**：maxAutoTurns
- **输出**：传给宿主目标的 maxGoalRounds；到限由 dsh-goal-round-driver 自己 block(code='round-limit')
- **阻断执行**：是 · **受 autonomy 影响**：否
- **原生替代**：dsh-goal-round-driver
- **理由**：保险丝：够长到跑完一件真活，又短到不会无声烧掉一整夜。
- **代码**：preset/plugins/clearai-kernel.js DEFAULT_MAX_AUTO_TURNS=128; CFG.maxAutoTurns ?? DEFAULT_MAX_AUTO_TURNS
- **测试**：test/kernel.test.mjs · **配置**：maxAutoTurns（预设刻意不写，取默认）
- **提示词**：clearai/clarification-* · **文档**：docs/epistemic-loop.zh-CN.md

### `autonomy-config` · autonomy：部署初值 + clarification 槽位选择器

- **层**：Harness · **状态**：部分实现 · **强度**：仅提示词 · **权威**：无 · **责任方**：system
- **触发**：装配期选择澄清协议段；运行态卡展示
- **输入**：attended | unattended
- **输出**：一段澄清协议 + 一份运行态展示
- **阻断执行**：否 · **受 autonomy 影响**：是
- **原生替代**：无
- **理由**：「我在不在场」是运行时状态；档位现在只是部署初值。
- **代码**：preset/plugins/clearai-kernel.js CFG.autonomy; resolveSections; effectiveAutonomy; publishAutonomy
- **测试**：test/kernel.test.mjs · **配置**：autonomy=attended（预设初值）
- **提示词**：clearai/clarification-attended | clearai/clarification-unattended（槽位二选一） · **文档**：preset/agent.cordis.yml
- **已知不符**：阶段 3 已修掉 preset/agent.cordis.yml 与内核注释里「决定续跑与预算、可由面板切换」的表述。仍然 partial 的原因：状态里保留 `autonomy.override` 读取路径而**已无任何写入者**（set_autonomy 摘除），历史日志兼容性与「要不要彻底删掉这个字段」是阶段 4/5 的决定。

### `runtime-card` · 每回合派生的运行态卡

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：system
- **触发**：状态变化时随回合注入
- **输入**：派生状态
- **输出**：一段状态卡文本
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：无
- **理由**：让模型每回合看到当前真实状态，而不是依赖记忆；仅在状态变化时注入以保持前缀稳定。
- **代码**：ui/lib/fold.js renderCard; preset/plugins/clearai-kernel.js pluginNotice
- **测试**：test/kernel.test.mjs, test/host.test.mjs · **配置**：runtimeCard=true
- **提示词**：clearai/state-protocol · **文档**：docs/loop-philosophy.zh-CN.md
- **已知不符**：阶段 6 计划瘦身：移除内部机制名与宿主 id。

### `prompt-sections` · 提示词段（23 段定义 / 22 段在场）

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输入**：段清单（槽位 clarification 按 autonomy 收敛）
- **输出**：系统提示词段集合
- **阻断执行**：否 · **受 autonomy 影响**：是
- **原生替代**：无
- **理由**：提示词解释行为，但按 P1 不是执行边界。
- **代码**：preset/plugins/prompts.js-312; preset/plugins/clearai-kernel.js 段装配
- **测试**：test/prompt-sections.test.mjs（阶段 6 新增） · **配置**：contributions.sections
- **提示词**：自身 · **文档**：docs/design-principles.zh-CN.md
- **已知不符**：阶段 3 已修掉「Goal 档自动确认」「run.current_step（DSH 里不存在这个字段）」与计数漂移（preset 原写「20 件工具、22 段」）。仍待阶段 6 处理：段落过厚、与 DSH 原生重复的内容未下沉、未按 hard/native/advisory 分类。

### `context-pruning` · 上下文剪枝与压缩（宿主原生）

- **层**：宿主 · **状态**：已实现 · **强度**：原生 · **权威**：无 · **责任方**：system
- **触发**：工具结果超阈值 / 手动 /compact
- **输入**：工具结果
- **输出**：剪枝后的结果
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-compaction-basic / dsh-command-compact（即原生本体）
- **理由**：上下文是受控资源；执行它的本来就是原生，ClearAI 只做装配声明。
- **代码**：preset/agent.cordis.yml-110 compaction group
- **测试**：test/client.test.mjs（装配） · **配置**：thresholdChars=8192, headChars=4096, tailChars=1024
- **提示词**：clearai/context-discipline · **文档**：docs/loop-philosophy.zh-CN.md

### `skill-candidate` · 技能默认候选态（人采纳才进目录）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 SaveSkill
- **输入**：name, description, 正文
- **输出**：clear/skills/<name>/SKILL.md，status=candidate；人 promote_skill 后才 modelInvocable
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-skill / dsh-skill-filesystem（读侧全走原生）
- **理由**：模型写的 SOP 该由人过一道。
- **代码**：preset/plugins/brain.js LESSON_REQUIRED/FACT_REQUIRED; preset/plugins/clearai-kernel.js SaveSkill; ui/lib/fold.js promote_skill
- **测试**：test/brain.test.mjs · **配置**：—
- **提示词**：clearai/skill-protocol · **文档**：docs/epistemic-loop.zh-CN.md

### `memory-write` · 记忆写入（字段校验 + 标题去重）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 WriteMemory
- **输入**：lesson 的五字段 / fact 的四字段
- **输出**：clear/memory/**；按标题跨文件去重
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh 原生 skill 目录承载读侧
- **理由**：结构只有机制保证得了。
- **代码**：preset/plugins/brain.js-39 字段契约; WriteMemory
- **测试**：test/brain.test.mjs · **配置**：—
- **提示词**：clearai/memory-protocol · **文档**：docs/epistemic-loop.zh-CN.md

### `model-routing` · 模型路由与切换（宿主原生，ClearAI 不持有）

- **层**：宿主 · **状态**：已实现 · **强度**：原生 · **权威**：无 · **责任方**：host
- **触发**：宿主原生入口
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-client-ui-model-selection
- **理由**：ClearAI 不维护第二份模型状态账。
- **代码**：宿主平面（ClearAI 未注册任何 provider/model 状态）; preset/agent.cordis.yml 无相关行
- **测试**：— · **配置**：—
- **提示词**：— · **文档**：—
- **已知不符**：当前 ClearAI 预设未挂载任何模型选择相关的客户端行；运行态卡也不展示当前模型。阶段 5 计划只读展示。

### `commands-menu` · 人类 `/` 命令菜单

- **层**：交互 · **状态**：部分实现 · **强度**：原生 · **权威**：无 · **责任方**：human
- **触发**：人在输入框敲 /
- **输入**：命令名 + 参数
- **输出**：原生命令结果
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-commands 注册表
- **理由**：菜单是 DSH 原生的人类命令通道，应优先于自建协议。
- **代码**：preset/agent.cordis.yml command-compact（唯一的命令行）; preset/plugins/ 无 commands 贡献
- **测试**：test/preset-composition.test.mjs（阶段 5 新增） · **配置**：—
- **提示词**：— · **文档**：—
- **已知不符**：ClearAI 只贡献了 /compact，比 standard 预设少了 /goal，且没有任何自己的命令。阶段 5 计划新增 preset/plugins/commands.js 贡献 ClearAI 人侧命令。

### `exploration-zone` · 非权威探索区（设计目标）

- **层**：Harness · **状态**：设计目标 · **强度**：建议 · **权威**：非权威 · **责任方**：model
- **触发**：—
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：dsh-tool-todo / dsh-tool-subagent
- **理由**：把「组织工作」与「确认知识」解耦：探索可以自由，事实必须严格。
- **代码**：—
- **测试**：test/authority-boundary.test.mjs（阶段 4 新增） · **配置**：—
- **提示词**：— · **文档**：docs/optimization/plan.zh-CN.md
- **已知不符**：尚未实现；当前所有工作都被拉进正式循环。

### `subrun-lifecycle` · 子 run 统一生命周期（一次性句柄 + 一条收集通道）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：内核派任何子任务：侦察、世界线执行者、评估者、横评仲裁
- **输入**：人格 + 任务书 + 工具面 + （评估者/仲裁）结构化输出 schema
- **输出**：对应的事实变更（scout/settled、worldline/executed、audit/settled、fork/arbitrated）
- **阻断执行**：否 · **受 autonomy 影响**：否
- **原生替代**：subagents.start()（原生一次性句柄）——不借用可续跑与结算通知：通知是 best-effort，不能当账本的承重结构
- **理由**：子任务的生命周期必须由内核自己掌握:账本只认本进程攥着的句柄,结论送达由收集那一刻的返回完成;四种角色共用一套,差异只在人格、工具面与结果解释方式。
- **代码**：preset/plugins/clearai-kernel.js dispatchSubRun / startWorldlineExecutor / runScout / runEvaluator / runArbiter / sweepScouts / sweepWorldlineExecutors / sweepLostExecutors / sweepLostScouts / publishedInEpoch / noticeBlock
- **测试**：test/kernel.test.mjs（含会话隔离用例）; tools/e2e-scenarios.mjs（模型可见性不变量） · **配置**：auditProvider=spawn, collectRetryMs, auditTimeoutMs
- **提示词**：clearai/delegation · **文档**：docs/optimization/e2e-longruns.zh-CN.md

---

生成物：本文件与 `truth-table.md` 都来自 `truth-table.json`；两份内容等价，语言不同。
