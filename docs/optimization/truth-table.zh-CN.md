# ClearAI 机制真值表

> **本文件由 `truth-table.json` 生成，不要手工编辑。**
> 权威源是 `docs/optimization/truth-table.json`；改内容改那里，然后跑 `node tools/build-truth-table.mjs`。
> 交叉校验见 `node tools/verify-truth-table.mjs`。

这份表回答一个问题：**当前代码真正保证的是什么**。它不描述愿望——`设计目标` 就是字面意思。

## 计数

- 机制条目：**54**
- 按状态：已实现 53 · 设计目标 1
- 按强度：硬边界 42 · 建议 9 · 原生 3
- 按归宿：保持设计目标 1
- 真正阻断执行的：**20**
- 存在已知不符（文档 / 注释与代码不一致）的：**1**

## 代码常量快照

这一节由代码导出，不是手写：

- 机制：2 个（goal / plan）
- 意图工具：7 件（Frame Conclude CreatePlan AdvancePlan RevisePlan ClosePlan Anomaly）
- 配置键：14 个
- 提示词段：定义 3 段，同一时刻在场 3 段

## 总表

| id | 机制 | 层 | 状态 | 强度 | 权威 | 责任方 | 阻断执行 | 代码位置 |
|---|---|---|---|---|---|---|---|---|
| `goal-set` | 立约:目标登记与修订(挂到原生 goal) | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | `preset/plugins/clearai-kernel.js Frame` |
| `goal-close` | 结案:目标完成与独立评估 | 认识论 | 已实现 | 硬边界 | 权威 | model | 是 | `preset/plugins/clearai-kernel.js Conclude` |
| `hypothesis-registry` | 假设登记与状态派生 | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | `preset/plugins/clearai-kernel.js Frame hypotheses` |
| `criteria-required` | 判据先写（done_criteria 强制） | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js validateSteps` |
| `formal-plan` | 正式计划 | 认识论 | 已实现 | 硬边界 | 权威 | model | 是 | `preset/plugins/clearai-kernel.js CreatePlan` |
| `advance-plan` | AdvancePlan：唯一完成动词 | 认识论 | 已实现 | 硬边界 | 权威 | model | 是 | `preset/plugins/clearai-kernel.js AdvancePlan` |
| `plan-amend-no-progress` | RevisePlan(补一步 / 改判据 / 作废)不动进度 | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | `preset/plugins/clearai-kernel.js RevisePlan` |
| `admission` | 观测准入（只判收不收） | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js admission` |
| `self-judge-limit` | L0–L2 允许自判，L3+ 拒绝自判 | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js SELF_JUDGE_MAX_INDEX=2` |
| `independent-evaluator` | 独立评估者（fresh context + 只读工具面） | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js runEvaluator / resolveToolFace / evaluatorPrompt / writeAuditCard` |
| `expectation-anomaly` | 预期与未解释项(反常):步骤可写预期,落空记成未解释项挂在卡上,只有三个去处 | 认识论 | 已实现 | 建议 | 权威 | model | 否 | `preset/plugins/clearai-kernel.js STEP_SCHEMA.expect / RevisePlan(expect) / AdvancePlan.anomalies / Anomaly / anomalyBrief / verdictSchema.anomalies` |
| `l4-human-release` | L4 步骤/分支级人工放行 | 认识论 | 已实现 | 硬边界 | 权威 | human | 是 | `preset/plugins/clearai-kernel.js l4Delivery` |
| `irreversible-command-release` | 不可逆动作拦在命令上:Frame 声明命令特征,匹配的 bash 执行前当场问人 | 认识论 | 已实现 | 硬边界 | 权威 | human | 是 | `preset/plugins/clearai-kernel.js releaseIrreversible / guardTool` |
| `evidence-record` | 证据登记 | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | `preset/plugins/clearai-kernel.js buildEvidenceOrigins` |
| `fact-promotion` | 事实升格 | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | `preset/plugins/clearai-kernel.js persistFact` |
| `lessons` | 经验:结案时提议「下次怎么做」,结案评估者对照记录逐条核,支持的写进 clear/knowledge/lessons/,在立题、定计划、写预期前摆上卡 | 认识论 | 已实现 | 建议 | 权威 | model | 否 | `preset/plugins/clearai-kernel.js Conclude.lessons / lessonBrief / verdictSchema.lessons / persistLesson` |
| `history-retention` | 只追加历史（什么都不删） | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | `ui/lib/fold.js（全体 case 无删除分支）` |
| `block-threshold` | 连拦阈值（证据质量闸） | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js blockedThreshold` |
| `l4-universal-gate` | 覆盖每一次评估的通用 L4 门 | 认识论 | 设计目标 | 建议 | 无 | human | 否 | `docs/known-gaps.md` |
| `verification-lifecycle` | 验证生命周期:哪些保证是活的 | 认识论 | 已实现 | 建议 | 无 | system | 否 | `preset/plugins/clearai-kernel.js countBlock` |
| `fact-retraction` | 事实撤回:人审查后决定 | 认识论 | 已实现 | 硬边界 | 权威 | human | 否 | `preset/plugins/clearai-kernel.js reviewRefutedFacts` |
| `observation-provenance` | 观测来源:声明必须与生产者对得上 | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | `preset/plugins/ontology.js VERIFICATION_LOOP` |
| `ontology-lexicon-events` | 领域词汇事件折成 state.lexicon | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | `ui/lib/domain-language.js applyLexiconMutation` |
| `assertion-validation` | 断言形态校验（落账之前） | 认识论 | 已实现 | 硬边界 | 权威 | model | 是 | `ui/lib/domain-language.js validateAssertions` |
| `conflict-derivation` | 冲突派生（只暴露，不裁决） | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | `ui/lib/domain-language.js deriveConflicts` |
| `graph-projection` | 本体图 / 实体图投影（确定性布局） | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | `ui/lib/domain-language.js graphProjection` |
| `ontology-files` | 领域本体写成文件(三道校验) | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | `ui/lib/domain-language.js checkOntologyFile materializeOntology ontologyOutline ONTOLOGY_SCHEMA` |
| `entity-gate` | 实体门(结案唯一的结构关口) | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js Conclude` |
| `criteria-revision-gate` | 判据修订要一份独立裁决 | 认识论 | 已实现 | 硬边界 | 权威 | model | 否 | `preset/plugins/clearai-kernel.js Frame` |
| `audit-digest-reuse` | 裁决按材料 digest 复用（同态不重派） | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | `preset/plugins/clearai-kernel.js auditDigest` |
| `workspace-files-sync` | 工作区文件同步(攒下来的事实与本体住在文件里) | 认识论 | 已实现 | 硬边界 | 权威 | system | 否 | `preset/plugins/clearai-kernel.js syncWorkspace listWorkspaceFiles readWorkspaceFile` |
| `artifact-path-exclusive` | 产物路径不重叠(同一计划里两步不许声明同一个产物) | 认识论 | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js validateSteps` |
| `single-loop` | 单循环人格（不做多 Agent 编排） | Harness | 已实现 | 建议 | 无 | model | 否 | `preset/agent.cordis.yml persona` |
| `four-beats` | 四拍节奏（计划→执行→观察→反思） | Harness | 已实现 | 建议 | 无 | model | 否 | `preset/plugins/prompts.js loop` |
| `evaluator-readonly-face` | 评估者只读工具面 | Harness | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js resolveToolFace` |
| `tool-trimming` | 工具面按贡献表裁剪 | Harness | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js MECHANISM_TOOLS` |
| `native-todo-disabled` | 原生工作方式(todo/subagent/workflow/ralph)挂载 | Harness | 已实现 | 硬边界 | 无 | system | 否 | `preset/agent.cordis.yml 工作方式段` |
| `native-goal-disabled` | 原生 goal 工具与命令挂载(目标层挂在原生 goal 上) | Harness | 已实现 | 硬边界 | 无 | system | 否 | `preset/agent.cordis.yml` |
| `native-plan-mode-disabled` | 原生 plan-mode 挂载(动手前给人看计划) | Harness | 已实现 | 硬边界 | 无 | system | 否 | `preset/agent.cordis.yml` |
| `subagent-trimmed` | 原生工作方式已挂回(todo / 子代理 / workflow / ralph) | Harness | 已实现 | 硬边界 | 无 | system | 否 | `preset/agent.cordis.yml` |
| `bash-deny-rules` | Bash 危险命令拒绝规则 | Harness | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js 危险命令匹配` |
| `protected-roots` | 系统受保护目录（模型不可直写） | Harness | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js protectedPath` |
| `runtime-card` | 每回合派生的运行态卡 | Harness | 已实现 | 建议 | 无 | system | 否 | `ui/lib/fold.js renderCard` |
| `prompt-sections` | 提示词段(3 段定义 / 3 段在场) | Harness | 已实现 | 建议 | 无 | system | 否 | `preset/plugins/prompts.js SECTIONS` |
| `subrun-lifecycle` | 评估者子 run 的生命周期（一次性句柄 + 从子会话日志取回） | Harness | 已实现 | 硬边界 | 权威 | system | 否 | `preset/plugins/clearai-kernel.js dispatchSubRun` |
| `host-invariants` | 宿主不变量（五条契约，落账之前判） | Harness | 已实现 | 硬边界 | 权威 | system | 是 | `ui/lib/invariant.js（五条契约 + 用生产折法 applyEvent 推进）` |
| `non-authoritative-isolation` | 非权威路径写不进权威账本 | Harness | 已实现 | 硬边界 | 无 | system | 是 | `test/authority-boundary.test.mjs` |
| `durable-dispatch-facts` | 派发事实独立落账（在 await 之前） | Harness | 已实现 | 硬边界 | 权威 | system | 否 | `preset/plugins/clearai-kernel.js landFact pendingFacts withPendingFacts` |
| `goal-complete-guard` | 守卫:原生 goal 只能经 Conclude 完成 | Harness | 已实现 | 硬边界 | 权威 | system | 是 | `preset/plugins/clearai-kernel.js update_goal` |
| `context-pruning` | 上下文剪枝与压缩（宿主原生） | 宿主 | 已实现 | 原生 | 无 | system | 否 | `preset/agent.cordis.yml compaction` |
| `model-routing` | 模型路由与切换（宿主原生，ClearAI 不持有） | 宿主 | 已实现 | 原生 | 无 | host | 否 | `宿主平面（ClearAI 未注册任何 provider/model 状态）` |
| `host-read-face-degradation` | 宿主读面降级（取不到就空态,不抛） | 宿主 | 已实现 | 硬边界 | 权威 | system | 否 | `ui/lib/index.js sessionsOf` |
| `commands-menu` | 人类 `/` 命令菜单 | 交互 | 已实现 | 原生 | 无 | human | 否 | `preset/agent.cordis.yml command-compact（唯一的命令行）` |
| `ontology-panel-graph` | 面板「本体」:图为主的只读读面 | 交互 | 已实现 | 建议 | 无 | human | 否 | `ui/lib/client.js GraphBand GraphInspector Atlas conclusionsOf` |

## 逐条明细

### `goal-set` · 立约:目标登记与修订(挂到原生 goal)

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 Frame 并给出 claim / done_criteria / hypotheses
- **输入**：claim, done_criteria, hypotheses[], reason(修订时必带)
- **输出**：mutation goal/set;同时在宿主原生 goal 上建(或改)一条目标,由原生的目标驱动负责续跑
- **阻断执行**：否
- **原生替代**：dsh-tool-goal / dsh-command-goal(目标的续跑与展示)
- **理由**：目标与判据必须在工作开始前落账,否则完成度无从派生。续跑交给原生 goal:ClearAI 只决定「什么算完成」。
- **代码**：preset/plugins/clearai-kernel.js Frame; attachNativeGoal; ui/lib/fold.js case 'goal/set'
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `goal-close` · 结案:目标完成与独立评估

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 Conclude(outcome=achieved|abandoned)
- **输入**：outcome, note
- **输出**：mutation audit/dispatched + audit/settled + goal/closed + fact/promoted;achieved ⇒ 原生 goal 完成并声明交付物,abandoned ⇒ 原生 goal 置阻塞
- **阻断执行**：是
- **原生替代**：无
- **理由**：结案不能由做的人自己宣布;achieved 必须过独立评估者的结构化裁决。原生 goal 只能经 Conclude 完成(见 goal-complete-guard)。
- **代码**：preset/plugins/clearai-kernel.js Conclude; syntheticStep; runEvaluator; completeNativeGoal; blockNativeGoal; declareDeliverables; ui/lib/fold.js case 'goal/closed'
- **测试**：test/kernel.test.mjs · **配置**：l4RequiresHumanRelease, auditProvider, auditTimeoutMs, auditToolFilter
- **提示词**：clearai/loop · **文档**：docs/verification-loop.zh-CN.md

### `hypothesis-registry` · 假设登记与状态派生

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：Frame 登记 hypotheses；证据到位后由 fold 派生支持等级
- **输入**：claim, refute_when
- **输出**：派生 supportedLevel / refutation 计数（不落第二本账）
- **阻断执行**：否
- **原生替代**：无
- **理由**：假设状态由证据算出来，模型不能打分。首次立目标至少登记 2 条候选（preset 强制，0 条一样拦）：只有一个猜想，检验容易退化成找证据支持自己。
- **代码**：preset/plugins/clearai-kernel.js Frame hypotheses; ui/lib/fold.js case 'hypothesis/superseded'
- **测试**：test/kernel.test.mjs · **配置**：minHypotheses（内核默认 0 = 机制中立；preset 立 2 = 产品立场，与 blockedThreshold 同一模式）
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `criteria-required` · 判据先写（done_criteria 强制）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：CreatePlan / RevisePlan(add) 校验步骤
- **输入**：steps[].done_criteria
- **输出**：装配期拒绝：缺少判据、长度 < 4、或判据自指
- **阻断执行**：是
- **原生替代**：无
- **理由**：没有判据就没有可失败的检验，独立评估也无从触发。
- **代码**：preset/plugins/clearai-kernel.js validateSteps; CreatePlan 调用点
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md
- **已知不符**：「每条进入系统的路径都校验判据」靠**测试**维持,不由类型保证:正常入口(`CreatePlan` / `RevisePlan(add)` 经 `validateSteps`)强制判据,而旧会话日志、内部构造的计划对象、以及将来新增的入口不受它约束。

### `formal-plan` · 正式计划

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 CreatePlan
- **输入**：brief, steps[{id, do, artifacts, done_criteria, tests?}]
- **输出**：mutation plan/created（confirmed_at 仅在审阅通过后非空）
- **阻断执行**：是
- **原生替代**：无
- **理由**：步骤、产物声明与判据必须在执行前落账，完成度由此派生。
- **代码**：preset/plugins/clearai-kernel.js CreatePlan; MAX_PLAN_STEPS=25; ui/lib/fold.js case 'plan/created'
- **测试**：test/kernel.test.mjs · **配置**：minBriefChars
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `advance-plan` · AdvancePlan：唯一完成动词

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 AdvancePlan 并携带交付声明
- **输入**：step_id, basis, results[](L0–L2:每条被检验的判断一个结果;L3+ 由评估者给)
- **输出**：mutation admission/checked + evidence/recorded(每条结果一条) + step/advanced(或拒收)
- **阻断执行**：是
- **原生替代**：无
- **理由**：只有一个动词能推进循环,「谁推进了这一步」才永远可回答。完成与结果分开:交付成立 ⇒ 这一步完成,不论结果是支持、推翻还是说不清——推翻和说不清都是合法结果,不让交付失败。
- **代码**：preset/plugins/clearai-kernel.js AdvancePlan; SELF_JUDGE_MAX_INDEX 自判上限; ui/lib/fold.js case 'step/advanced'
- **测试**：test/kernel.test.mjs · **配置**：blockedThreshold, l4RequiresHumanRelease, l4RejectSelfWritten
- **提示词**：clearai/loop · **文档**：docs/loop-philosophy.zh-CN.md

### `plan-amend-no-progress` · RevisePlan(补一步 / 改判据 / 作废)不动进度

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型调用 RevisePlan 的三种动作之一
- **输入**：步骤增补 / 判据修订 / 作废理由
- **输出**：plan/amended, plan/refined, plan/voided（进度不变）
- **阻断执行**：否
- **原生替代**：无
- **理由**：进度只由 AdvancePlan 改变，避免多入口推进导致的归属不清。改约只有一个入口 RevisePlan(补步、改判据、作废,各有自己的校验)。
- **代码**：preset/plugins/clearai-kernel.js RevisePlan; ui/lib/fold.js/323/330
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/loop-philosophy.zh-CN.md

### `admission` · 观测准入（只判收不收）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：AdvancePlan 交付时
- **输入**：声明的 artifacts
- **输出**：存在 / 非空 / 结构合法 → 收；否则计一次冲闸，达 blockedThreshold 置 blocked
- **阻断执行**：是
- **原生替代**：无
- **理由**：准入回答「这份观测收不收」，不回答「它说明了什么」；不裁决才没有污染结论的问题。
- **代码**：preset/plugins/clearai-kernel.js admission; verdict_not_accepted; ui/lib/fold.js case 'audit/dispatched'
- **测试**：test/kernel.test.mjs · **配置**：blockedThreshold
- **提示词**：clearai/loop · **文档**：docs/loop-philosophy.zh-CN.md

### `self-judge-limit` · L0–L2 允许自判，L3+ 拒绝自判

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：AdvancePlan 携带 tests.level
- **输入**：level（L0–L4）
- **输出**：level > L2 且调用方自带 verdict → verdict_not_accepted
- **阻断执行**：是
- **原生替代**：无
- **理由**：做的人不判自己；等级越高，越不能自证。
- **代码**：preset/plugins/clearai-kernel.js SELF_JUDGE_MAX_INDEX=2; ;
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/verification-loop.zh-CN.md

### `independent-evaluator` · 独立评估者（fresh context + 只读工具面）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：准入判定 needs_audit（产物齐备且 done_criteria 非空）时的 L3+ 步骤
- **输入**：只读产物 + 结构化输出 schema
- **输出**：mutation audit/settled，评估卡由系统落盘
- **阻断执行**：是
- **原生替代**：dsh-subagent spawn（内核只借用宿主子代理后端）
- **理由**：执行者不能成为结果的唯一裁判；spawn 而非 fork 才能保证判者与做者不共享历史。
- **代码**：preset/plugins/clearai-kernel.js runEvaluator / resolveToolFace / evaluatorPrompt / writeAuditCard; ui/lib/fold.js case audit/dispatched
- **测试**：test/kernel.test.mjs · **配置**：auditProvider=spawn, auditTimeoutMs, auditToolFilter
- **提示词**：clearai/loop · **文档**：docs/verification-loop.zh-CN.md

### `expectation-anomaly` · 预期与未解释项(反常):步骤可写预期,落空记成未解释项挂在卡上,只有三个去处

- **层**：认识论 · **状态**：已实现 · **强度**：建议 · **权威**：权威 · **责任方**：model
- **触发**：模型写预期、交付时登记不符、用 Anomaly 登记或消解;评估者在裁决里报没登记的异常
- **输入**：预期文本;哪里不符;去处(explained / ruled_out / escalated)与理由
- **输出**：step/expected, anomaly/opened, anomaly/resolved;audit/settled 带 anomalies 时折成评估者发现的未解释项
- **阻断执行**：否
- **原生替代**：无
- **理由**：失分最多的不是没核,而是看见了异常却把它解释过去。写下的预期让落空可见;未解释项不阻塞结案,但随交付交给评估者,由评估者判它动不动摇结论。
- **代码**：preset/plugins/clearai-kernel.js STEP_SCHEMA.expect / RevisePlan(expect) / AdvancePlan.anomalies / Anomaly / anomalyBrief / verdictSchema.anomalies; ui/lib/fold.js case 'anomaly/opened' / 'anomaly/resolved' / 'audit/settled'
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `l4-human-release` · L4 步骤/分支级人工放行

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：human
- **触发**：L4 步骤交付
- **输入**：交付那次调用当场问人(宿主 userQuestions)的答复
- **输出**：人放行 ⇒ 落 human/released 再交评估者;不放行 / 没人能答 ⇒ 拒收
- **阻断执行**：是
- **原生替代**：宿主 userQuestions(原生提问卡)
- **理由**：L4 意味着高代价或不可逆,必须有人按的那一下。门在交付那次调用里当场开、当场关。范围是步骤轴——覆盖每一次评估的通用门另立一行(见 l4-universal-gate)。
- **代码**：preset/plugins/clearai-kernel.js l4Delivery; askHuman; ui/lib/fold.js case 'human/released'
- **测试**：test/kernel.test.mjs · **配置**：l4RequiresHumanRelease=true, l4RejectSelfWritten=true
- **提示词**：clearai/loop · **文档**：docs/known-gaps.zh-CN.md

### `irreversible-command-release` · 不可逆动作拦在命令上:Frame 声明命令特征,匹配的 bash 执行前当场问人

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：human
- **触发**：bash 命令里出现 Frame 声明过的命令特征
- **输入**：那次调用当场问人(宿主 userQuestions)的答复
- **输出**：放行 ⇒ 落 human/released(带 action)并执行;不放行 / 没人能答 ⇒ 拒(没人能答时原生 goal 停下等人)
- **阻断执行**：是
- **原生替代**：宿主 userQuestions(原生提问卡)
- **理由**：步骤级的放行挂在交付上,而不可逆的动作往往就是一条命令:先跑了再交付,门就晚了。拦在命令上,门才在动作之前。
- **代码**：preset/plugins/clearai-kernel.js releaseIrreversible / guardTool; ui/lib/fold.js case 'human/released'
- **测试**：test/kernel.test.mjs · **配置**：l4RequiresHumanRelease=true
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `evidence-record` · 证据登记

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：步骤推进时携带 basis / 来源
- **输入**：basis, refs[], origins[]
- **输出**：mutation evidence/recorded
- **阻断执行**：否
- **原生替代**：无
- **理由**：结论必须能追到来源；证据可 supersede，不可删除。
- **代码**：preset/plugins/clearai-kernel.js buildEvidenceOrigins; ui/lib/fold.js case 'evidence/recorded'
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `fact-promotion` · 事实升格

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：目标结案且假设达到 promote_at_level 且无推翻
- **输入**：goal, hypothesis, 评估者裁决
- **输出**：写入 clear/knowledge/facts/<事实 id>.json(带升格那一刻用到的词条含义指纹 definitions)+ mutation fact/promoted
- **阻断执行**：否
- **原生替代**：无
- **理由**：事实由系统按门槛算出来，模型不能宣称。
- **代码**：preset/plugins/clearai-kernel.js persistFact; promote_at_level 门槛; ui/lib/fold.js case 'fact/promoted'
- **测试**：test/kernel.test.mjs · **配置**：l4RejectSelfWritten
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `lessons` · 经验:结案时提议「下次怎么做」,结案评估者对照记录逐条核,支持的写进 clear/knowledge/lessons/,在立题、定计划、写预期前摆上卡

- **层**：认识论 · **状态**：已实现 · **强度**：建议 · **权威**：权威 · **责任方**：model
- **触发**：模型在 Conclude(outcome=achieved) 里给 lessons
- **输入**：每条:text、kind(trap/check/shortcut/prior)、about、evidence、boundary
- **输出**：写入 clear/knowledge/lessons/<经验 id>.json + mutation lesson/recorded;没被支持的在回执里列出,不写
- **阻断执行**：否
- **原生替代**：无
- **理由**：单次任务里 ClearAI 多出来的主要是对反常的纪律;探索深度要靠跨任务带过来的做法(哪台装置要先核、哪类体系先斜向扫)。经验改变注意力与做法,事实改变信念,所以分开放;两者都要独立评估过才写。放弃的目标不核,也不写。
- **代码**：preset/plugins/clearai-kernel.js Conclude.lessons / lessonBrief / verdictSchema.lessons / persistLesson; ui/lib/fold.js case 'lesson/recorded' / derive lessonRows; ui/lib/knowledge-view.js 经验段
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `history-retention` · 只追加历史（什么都不删）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：任何状态变更
- **输出**：推翻 / 作废 / 修订全部留痕
- **阻断执行**：否
- **原生替代**：无
- **理由**：被推翻的假设是资产：它记录了此路不通。
- **代码**：ui/lib/fold.js（全体 case 无删除分支）; preset/plugins/clearai-kernel.js RevisePlan
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/loop-philosophy.zh-CN.md

### `block-threshold` · 连拦阈值（证据质量闸）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：同一件事连续冲闸未过
- **输入**：连续未过次数
- **输出**：达阈值 → 计划置 blocked,当场问人(按缺口再改 / 作废这一步);没人能答 ⇒ 原生 goal 置阻塞(clearai-needs-human)
- **阻断执行**：是
- **原生替代**：无
- **理由**：它是质量闸不是预算，因此不按档取值。
- **代码**：preset/plugins/clearai-kernel.js blockedThreshold; escalateBlocked; ui/lib/fold.js case 'block/counted'
- **测试**：test/kernel.test.mjs · **配置**：blockedThreshold=2（预设显式值）
- **提示词**：clearai/loop · **文档**：docs/loop-philosophy.zh-CN.md

### `single-loop` · 单循环人格（不做多 Agent 编排）

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：model
- **触发**：每回合的 persona 与身份、循环两段
- **输出**：模型被要求以单一主循环推进
- **阻断执行**：否
- **原生替代**：dsh 原生 subagent / workflow / ralph（已随预设挂回(阶段 5;权威边界测试钉死它们产不出 clearai 变更)）
- **理由**：子角色由系统按触发派生,避免自由委派把「自己派人判自己」重新引入。这是**偏好**(hardness=advisory):工作方式本身不设限,约束在权威账本那一侧。
- **代码**：preset/agent.cordis.yml persona; preset/plugins/prompts.js identity / loop
- **测试**：test/prompt-sections.test.mjs（阶段 6 新增） · **配置**：—
- **提示词**：clearai/identity, clearai/loop · **文档**：docs/loop-philosophy.zh-CN.md

### `four-beats` · 四拍节奏（计划→执行→观察→反思）

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：model
- **触发**：每回合注入
- **输出**：模型据四拍组织行为
- **阻断执行**：否
- **原生替代**：无
- **理由**：认识论循环在运行时的压缩表达。
- **代码**：preset/plugins/prompts.js loop; preset/agent.cordis.yml
- **测试**：test/prompt-sections.test.mjs（阶段 6 新增） · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/loop-philosophy.zh-CN.md

### `evaluator-readonly-face` · 评估者只读工具面

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：派遣评估者时
- **输入**：候选工具名
- **输出**：按部署实际工具注册表过滤；未知工具名 fail-closed
- **阻断执行**：是
- **原生替代**：dsh-subagent 的 tools.restrict
- **理由**：判的人不能改产物。
- **代码**：preset/plugins/clearai-kernel.js resolveToolFace; auditToolFilter
- **测试**：test/kernel.test.mjs · **配置**：auditToolFilter=[read,glob,grep,read_image]
- **提示词**：clearai/loop · **文档**：docs/verification-loop.zh-CN.md

### `tool-trimming` · 工具面按贡献表裁剪

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：装配期
- **输入**：贡献表
- **输出**：unknown_mechanism / unknown_tool / tool_of_disabled_mechanism 等装配期抛错
- **阻断执行**：是
- **原生替代**：无
- **理由**：装了哪些工具是清单事实，不是散落在代码里的既成事实。
- **代码**：preset/plugins/clearai-kernel.js MECHANISM_TOOLS; resolveContributions; ctx.tools.register
- **测试**：test/kernel.test.mjs · **配置**：contributions.{mechanisms,tools,sections}
- **提示词**：— · **文档**：docs/loop-philosophy.zh-CN.md

### `native-todo-disabled` · 原生工作方式(todo/subagent/workflow/ralph)挂载

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输出**：四件原生工作方式在工具面里
- **阻断执行**：否
- **原生替代**：dsh-tool-todo（standard 预设挂载）
- **理由**：工作方式交还原生:它们产不出一条 clearai 变更(权威边界测试钉死)。便签不是账本,进度永远以 AdvancePlan 落账为准。
- **代码**：preset/agent.cordis.yml 工作方式段
- **测试**：test/preset-composition.test.mjs（阶段 5 新增） · **配置**：—
- **提示词**：— · **文档**：preset/agent.cordis.yml

### `native-goal-disabled` · 原生 goal 工具与命令挂载(目标层挂在原生 goal 上)

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输出**：tool-goal / command-goal 在面里;原生 goal 只能经 Conclude 完成
- **阻断执行**：否
- **原生替代**：dsh-tool-goal / dsh-command-goal
- **理由**：只有一本账的分工:原生 goal 是续跑与展示,ClearAI 的目标账决定「什么算完成」。Frame 建原生目标,Conclude 完成或置阻塞,守卫拦住直接完成。
- **代码**：preset/agent.cordis.yml
- **测试**：test/preset-composition.test.mjs（阶段 5 新增） · **配置**：—
- **提示词**：— · **文档**：preset/agent.cordis.yml

### `native-plan-mode-disabled` · 原生 plan-mode 挂载(动手前给人看计划)

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输出**：plan-mode 在面里
- **阻断执行**：否
- **原生替代**：dsh-plan-mode
- **理由**：plan-mode 管「动手前给人看」,CreatePlan/AdvancePlan 管「每一步凭什么算完成」——两件事,不是两套纪律。ClearAI 删了自己的审阅卡,交给原生。
- **代码**：preset/agent.cordis.yml
- **测试**：test/preset-composition.test.mjs（阶段 5 新增） · **配置**：—
- **提示词**：— · **文档**：preset/agent.cordis.yml

### `subagent-trimmed` · 原生工作方式已挂回(todo / 子代理 / workflow / ralph)

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输出**：tool-subagent / tool-subagent-control / tool-workflow / tool-ralph 均不在面里
- **阻断执行**：否
- **原生替代**：dsh-tool-subagent / dsh-tool-workflow / dsh-tool-ralph
- **理由**：自由委派会重新引入「自己派一个来判自己」。现在按**分层**处理:工作方式交还原生、产物停在非权威区;权威账本仍只能由主线过准入与唯一完成动词写入(见 authority-boundary 套件)。
- **代码**：preset/agent.cordis.yml
- **测试**：test/preset-composition.test.mjs（阶段 5 新增） · **配置**：—
- **提示词**：clearai/loop · **文档**：preset/agent.cordis.yml

### `bash-deny-rules` · Bash 危险命令拒绝规则

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：每次 bash 工具调用前
- **输入**：command 字符串
- **输出**：kind:'deny' + reason
- **阻断执行**：是
- **原生替代**：无重叠（已核实）：宿主 bash 只有沙箱路径域与审批升级，没有内容级威胁模式清单（dsh-tool-bash / dsh-bash-sandbox / dsh-bash-local 均无）；fork 炸弹这类在可写沙箱内完全合法的命令，只有内容规则拦得住
- **理由**：危险命令不可执行应落机制而不是提示词。与宿主治理分属三条轴：沙箱管「写哪」、审批管「谁同意」、这份清单管「命令本身是什么威胁」。
- **代码**：preset/plugins/clearai-kernel.js 危险命令匹配; / 受保护路径拒绝
- **测试**：test/kernel.test.mjs · **配置**：bashDenyRules=true
- **提示词**：— · **文档**：docs/loop-philosophy.zh-CN.md

### `protected-roots` · 系统受保护目录（模型不可直写）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：每次写类工具调用前(write / edit / 带写操作的 bash)
- **输入**：路径
- **输出**：写类工具(write / edit)或带写操作的 bash 碰到 clear/evidence、clear/knowledge/facts、clear/goals、clear/ontology(三支本体目录除外)→ deny;相对路径与绝对路径一样判;只读不拦。写三支本体目录里的 .json 时先在内存里得出全文,单文件校验不过 → deny
- **阻断执行**：是
- **原生替代**：无
- **理由**：事实与评估卡只能由系统落盘。
- **代码**：preset/plugins/clearai-kernel.js protectedPath; bashTouchesProtected; ontologyWriteProblems
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/identity · **文档**：docs/design-principles.zh-CN.md

### `runtime-card` · 每回合派生的运行态卡

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：system
- **触发**：状态变化时随回合注入
- **输入**：派生状态
- **输出**：一段状态卡文本
- **阻断执行**：否
- **原生替代**：无
- **理由**：让模型每回合看到当前真实状态,而不是依赖记忆;仅在状态变化时注入以保持前缀稳定。卡里用的是人话,不出现账本字段名(`plan_confirmation_pending` / `confirmed_at`)或宿主 id。
- **代码**：ui/lib/fold.js renderCard; preset/plugins/clearai-kernel.js pluginNotice
- **测试**：test/kernel.test.mjs, test/host.test.mjs · **配置**：runtimeCard=true
- **提示词**：clearai/identity · **文档**：docs/loop-philosophy.zh-CN.md

### `prompt-sections` · 提示词段(3 段定义 / 3 段在场)

- **层**：Harness · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：system
- **触发**：装配期
- **输入**：段清单
- **输出**：系统提示词段集合
- **阻断执行**：否
- **原生替代**：无
- **理由**：提示词解释行为,但按 P1 不是执行边界。提示词分三段:身份(native)、循环(hard)、对人说话(advisory),每段的分类由 `test/prompt-sections.test.mjs` 与内容咬合。每个工具怎么用写在工具自己的说明里,现在是什么状态由运行态卡给。
- **代码**：preset/plugins/prompts.js SECTIONS; preset/plugins/clearai-kernel.js systemPrompt
- **测试**：test/prompt-sections.test.mjs（阶段 6 新增） · **配置**：contributions.sections
- **提示词**：自身 · **文档**：docs/design-principles.zh-CN.md

### `context-pruning` · 上下文剪枝与压缩（宿主原生）

- **层**：宿主 · **状态**：已实现 · **强度**：原生 · **权威**：无 · **责任方**：system
- **触发**：工具结果超阈值 / 手动 /compact
- **输入**：工具结果
- **输出**：剪枝后的结果
- **阻断执行**：否
- **原生替代**：dsh-compaction-basic / dsh-command-compact（即原生本体）
- **理由**：上下文是受控资源；执行它的本来就是原生，ClearAI 只做装配声明。
- **代码**：preset/agent.cordis.yml compaction
- **测试**：test/client.test.mjs（装配） · **配置**：thresholdChars=8192, headChars=4096, tailChars=1024
- **提示词**：— · **文档**：docs/loop-philosophy.zh-CN.md

### `model-routing` · 模型路由与切换（宿主原生，ClearAI 不持有）

- **层**：宿主 · **状态**：已实现 · **强度**：原生 · **权威**：无 · **责任方**：host
- **触发**：宿主原生入口
- **阻断执行**：否
- **原生替代**：dsh-client-ui-model-selection
- **理由**：ClearAI 不维护第二份模型状态账:切换走原生入口(`dsh-tool-subagent` 的 `modelSelectionSettings`),运行态卡不展示当前模型——它不参与任何判断。
- **代码**：宿主平面（ClearAI 未注册任何 provider/model 状态）; preset/agent.cordis.yml 无相关行
- **测试**：— · **配置**：—
- **提示词**：— · **文档**：—

### `commands-menu` · 人类 `/` 命令菜单

- **层**：交互 · **状态**：已实现 · **强度**：原生 · **权威**：无 · **责任方**：human
- **触发**：人在输入框敲 /
- **输入**：命令名 + 参数
- **输出**：原生命令结果
- **阻断执行**：否
- **原生替代**：dsh-commands 注册表
- **理由**：菜单是 DSH 原生的人类命令通道。ClearAI 不贡献自己的命令:状态看界面,`/goal` 与 `/plan` 由原生接管。
- **代码**：preset/agent.cordis.yml command-compact（唯一的命令行）
- **测试**：test/preset-composition.test.mjs · **配置**：—
- **提示词**：— · **文档**：—

### `subrun-lifecycle` · 评估者子 run 的生命周期（一次性句柄 + 从子会话日志取回）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：内核派独立评估者
- **输入**：人格 + 任务书 + 只读工具面 + 结构化输出 schema
- **输出**：audit/settled(结论取回或如实落 unknown)
- **阻断执行**：否
- **原生替代**：subagents.start()（原生一次性句柄）——不借用可续跑与结算通知：通知是 best-effort，不能当账本的承重结构
- **理由**：子任务的生命周期由内核掌握,但**结束与存活的权威是宿主**:`subagents.listChildren` 与 `subagent/end`。宿主说已结束 ⇒ **先从子会话自己的日志取回**,取不回才如实落 unknown,理由写清(`ended_uncollected` ≠ `lost`)。结算只报事实不给建议:要不要重试是计划层的决定。
- **代码**：preset/plugins/clearai-kernel.js dispatchSubRun; sweepEndedAudits; recoverVerdictFromChildSession
- **测试**：test/kernel.test.mjs（裁决落结算事实 / 先取回再落 unknown） · **配置**：auditProvider=spawn, auditTimeoutMs
- **提示词**：clearai/loop · **文档**：docs/optimization/e2e-longruns.zh-CN.md

### `host-invariants` · 宿主不变量（五条契约，落账之前判）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：任何一条 clearai 事实要落进会话日志之前（宿主 internal/dispatch 那一拍）
- **输入**：会话事件里的 clearai 变更（插件消息的 clearai/mutations 段、工具结果的 meta.mutations）
- **输出**：违反时抛宿主 InvariantError（归属 clearai-dsh）；通过则什么都不做
- **阻断执行**：是
- **原生替代**：@deepseek-ai/dsh-invariants（宿主自己的包级不变量注册表；不另造一套自检）
- **理由**：把这五条契约交给宿主的包级不变量注册表（`register(packageName, installer)`，违反时抛带稳定错误码与归属包名的 `InvariantError`），判在宿主的 `internal/dispatch` 那一拍——**不合法的事实根本进不了日志**。**范围与代价，照实说**：①它是诊断面，**随包的 web/headless profile 并不挂这个服务**（宿主自己的开发组合才挂），所以它在用户那儿不生效；②它**不再自己折一套索引**——状态用生产折法（`fold.js` 的 `applyEvent`）推进，本文件只留五条契约与一个 admitted 累积，形状解释代码已删（见权威归属 §二④）；③已经发生的运行失败**必须允许入账**——"只允许好看的事实进入账本"是把一致性做成了不实陈述。
- **代码**：ui/lib/invariant.js（五条契约 + 用生产折法 applyEvent 推进）; ui/lib/index.js（有 invariants 服务就注册）; tools/e2e-run.mjs（长测里挂上服务）
- **测试**：test/invariant.test.mjs（合法放行 / 每条契约的违反 / 落账之前拦下 / 伪步骤不误伤） · **配置**：宿主 invariants 的 enabled / package_allowlist / package_blocklist
- **提示词**：— · **文档**：docs/release-verification.zh-CN.md

### `l4-universal-gate` · 覆盖每一次评估的通用 L4 门

- **层**：认识论 · **状态**：设计目标 · **强度**：建议 · **权威**：无 · **责任方**：human
- **触发**：—
- **阻断执行**：否
- **原生替代**：无
- **理由**：**不实现是一个决定,不是待办**:门要加在「正确答案取决于人」的地方。每一次评估都上门,等于把非承重的取舍塞给人——那正是这套设计反复要避免的。L4 的门挂在**等级**上(步骤/分支轴),见 l4-human-release。
- **归宿**：保持设计目标
- **代码**：docs/known-gaps.md
- **测试**：— · **配置**：—
- **提示词**：— · **文档**：docs/known-gaps.md

### `verification-lifecycle` · 验证生命周期:哪些保证是活的

- **层**：认识论 · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：system
- **触发**：拿不到裁决 / 判不了交付成不成立
- **输出**：block/counted ⇒ plan/blocked ⇒ 当场问人
- **阻断执行**：否
- **原生替代**：无
- **理由**：验证机承诺的保证都有落点:①结果永远不来时不无声重试——拿不到裁决、判不了交付成不成立,与准入没过共用同一个连拦计数,到阈值就当场问人;②「说不清」是合法的空结果,不是失败:交付成立的那一步照常完成,判断保持原状。等级只决定谁来判,以及 L4 要人放行。
- **代码**：preset/plugins/clearai-kernel.js countBlock; docs/verification-loop.md
- **测试**：test/kernel.test.mjs(拿不到裁决计数 / 说不清也是完成 / 跳级理由整套删除); test/ontology.test.mjs(状态表逐行有落点) · **配置**：—
- **提示词**：— · **文档**：docs/verification-loop.md

### `fact-retraction` · 事实撤回:人审查后决定

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：human
- **触发**：推翻证据碰到已确立的事实 ⇒ 落账的那次交付当场问人「撤回」还是「维持原事实」
- **输入**：事实 id + 缘由(可空)
- **输出**：mutation fact/reviewed;事实文件追加一行;没人能答 ⇒ 事实标着待复核,原生 goal 置阻塞
- **阻断执行**：否
- **原生替代**：无
- **理由**：事实带边界(scope):边界被触发时要有一个人能把它撤回,而撤回永不自动——数据自己也可能错,所以「判证据不可靠、维持原事实」同样是一次要落账的决定。两种结局都落 fact/reviewed,撤回是终态:记录留着、不作为「已知」被引用。
- **代码**：preset/plugins/clearai-kernel.js reviewRefutedFacts; markFactReviewed; ui/lib/fold.js case 'fact/reviewed'; preset/plugins/ontology.js VERIFICATION_LOOP
- **测试**：test/kernel.test.mjs(当场问人 / 两个结局 / 旧日志兼容) · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/verification-loop.zh-CN.md

### `observation-provenance` · 观测来源:声明必须与生产者对得上

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：交付时登记观测
- **输入**：ref + note
- **输出**：mutation observation/recorded（source 只有 self）
- **阻断执行**：否
- **原生替代**：无
- **理由**：类型的职责是**只声明今天真的可表示的东西**:内核只写 `self`(交付),所以 `source` 只声明这一个。一个取值要存在,必须同时有**生产者**与**消费它的决策**——否则它就是类型里的一句假话(声明了「有种观测来自人上传」,而那条路不存在)。`test/ontology.test.mjs` 现在把声明的取值集合与内核真的写过的集合**逐一对齐**:将来真接上一个人上传入口,那条断言会红,那时回来把取值加进声明。
- **代码**：preset/plugins/ontology.js VERIFICATION_LOOP; preset/plugins/clearai-kernel.js buildEvidenceOrigins; ui/lib/fold.js case 'observation/recorded'
- **测试**：test/kernel.test.mjs; test/ontology.test.mjs（声明取值与生产者逐一对齐） · **配置**：—
- **提示词**：— · **文档**：docs/verification-loop.md

### `non-authoritative-isolation` · 非权威路径写不进权威账本

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：无 · **责任方**：system
- **触发**：模型用 todo / 子代理 / workflow / ralph / 模型切换干活
- **输出**：没有任何 `clearai` 变更
- **阻断执行**：是
- **原生替代**：无
- **理由**：这是把「工作方式」与「确认知识」解耦的那条**负向保证**:干活不设限,但干活的路径结构上产不出一条权威变更——权威账本只能由主线过观测准入与唯一完成动词写入。它是「探索可以自由、事实必须严格」这句话里**承重**的那一半,所以它有一行。
- **代码**：test/authority-boundary.test.mjs; ui/lib/fold.js LEGACY_GATE_ACTIONS
- **测试**：test/authority-boundary.test.mjs（14 项） · **配置**：—
- **提示词**：— · **文档**：docs/loop-philosophy.zh-CN.md

### `ontology-lexicon-events` · 领域词汇事件折成 state.lexicon

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：账本里出现 ontology/term_added、ontology/predicate_added、*_revised、*_deprecated 六类事件之一
- **输入**：变更记录 {t, id, label, gloss, aliases, parent, range, functional, reason, basis}
- **输出**：state.lexicon：概念表 / 谓词表 / 修订史 / 废止表
- **阻断执行**：否
- **原生替代**：无
- **理由**：词汇是项目的语言层：接纳要带依据、修订留痕、废止是黏性终态且没有删除。折法只解释事件，校验发生在落账之前。
- **代码**：ui/lib/domain-language.js applyLexiconMutation; ui/lib/fold.js case 'ontology/term_added'
- **测试**：test/domain-language.test.mjs · **配置**：—
- **提示词**：— · **文档**：docs/domain-ontology.zh-CN.md

### `assertion-validation` · 断言形态校验（落账之前）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：为一条假设登记断言（不提供放行；提供即严校）
- **输入**：assertions[{predicate, subject, object, qualifiers?}] 与当前词汇
- **输出**：问题清单（空 = 通过）；不通过则调用方拒收
- **阻断执行**：是
- **原生替代**：无
- **理由**：引用不存在的谓词、值域不符或同一事实自相矛盾，必须在进账本之前被拒——先污染后治理不适用于知识库。
- **代码**：ui/lib/domain-language.js validateAssertions
- **测试**：test/domain-language.test.mjs · **配置**：—
- **提示词**：— · **文档**：docs/domain-ontology.zh-CN.md

### `conflict-derivation` · 冲突派生（只暴露，不裁决）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：两条未撤回的已确认事实落在同一单值谓词、同一主体、而客体不同
- **输入**：事实集（含断言与复核态）与词汇（谓词的 functional 声明）
- **输出**：derive().conflicts：成对读数（谓词 · 主体 · 两侧事实与取值）
- **阻断执行**：否
- **原生替代**：无
- **理由**：同一单值谓词上的两个取值是一处必须看得见的不一致；但谁为真不是系统能裁的——它只报，不撤回任何一侧、也不进闸门。
- **代码**：ui/lib/domain-language.js deriveConflicts; ui/lib/fold.js deriveConflicts(factRows
- **测试**：test/domain-language.test.mjs · **配置**：—
- **提示词**：— · **文档**：docs/domain-ontology.zh-CN.md

### `graph-projection` · 本体图 / 实体图投影（确定性布局）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：每次投影（view() 计算读面时）
- **输入**：state.lexicon 与 state.facts 与 state.entities 与 state.entityAssertions
- **输出**：{nodes, edges, bounds}：本体层（概念 / is_a / 谓词）与实体层（实例 / 断言，边带 source=promoted|asserted），节点带确定性坐标
- **阻断执行**：否
- **原生替代**：无
- **理由**：图是最自然的表现形式，但它是投影而不是存储：同一账本必得同一张图，坐标、缩放与筛选都不进账本。
- **代码**：ui/lib/domain-language.js graphProjection; ui/lib/fold.js graphProjection
- **测试**：test/domain-language.test.mjs · **配置**：—
- **提示词**：— · **文档**：docs/domain-ontology.zh-CN.md

### `ontology-files` · 领域本体写成文件(三道校验)

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：模型用 write / edit / bash 写 clear/ontology/{concepts,relations,entities}/**.json;每个 pre-step;Frame 与 Conclude 按需同步
- **输入**：概念 / 关系 / 实体文件(X.json 描述 X,子节点放在同级 X/ 目录;id = 文件名)
- **输出**：①写入时单文件校验不过 → 拒写;②读取时从文件折出词汇、实体、实体关系与跨文件问题(有问题的节点或边不进图,卡上列出);③升格时断言涉及的本体不成立 → 这条判断不升格;卡上有本体大纲(前两层与节点数)
- **阻断执行**：否
- **原生替代**：原生文件工具(write / edit / bash)
- **理由**：目录天生是嵌套,文件天生跨会话留下,模型天生会读写和挪文件。约束只放在非守不可的三处:格式不对就读不了,引用不对图就断,升格不对真假就混。层次怎么分、词怎么起,系统一概不管。
- **代码**：ui/lib/domain-language.js checkOntologyFile materializeOntology ontologyOutline ONTOLOGY_SCHEMA; preset/plugins/clearai-kernel.js ontologyWriteProblems ensureOntologySchema syncWorkspace; ui/lib/fold.js case 'workspace/synced'
- **测试**：test/kernel.test.mjs(写入时拒、读取时折图与问题、升格时不成立就不升格、改义标复核) · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/domain-ontology.zh-CN.md

### `ontology-panel-graph` · 面板「本体」:图为主的只读读面

- **层**：交互 · **状态**：已实现 · **强度**：建议 · **权威**：无 · **责任方**：human
- **触发**：人打开中栏「本体」
- **输入**：会话投影 clearai(view)与 GET /api/clearai/inspector
- **输出**：本体图 / 实体图、按可信度分组的结论(已验证 / 待核验 / 验证中 / 不确定 / 已推翻 / 已替换)、点开一条的进度 → 可信度怎么变的 → 补充、节点小卡
- **阻断执行**：否
- **原生替代**：无
- **理由**：面板只读,图是主角。面板不提供第二个写入口:人要改词汇,在对话里说一句,或直接改文件。界面用词与运行态卡同一套,内部编号不上屏。
- **代码**：ui/lib/client.js GraphBand GraphInspector Atlas conclusionsOf; ui/lib/fold.js trustHistory inspectGraphSelection
- **测试**：test/client.test.mjs(本体格:图、结论分组、三段展开、节点小卡) · **配置**：—
- **提示词**：— · **文档**：docs/epistemic-loop.zh-CN.md

### `entity-gate` · 实体门(结案唯一的结构关口)

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：Conclude(achieved),知识模式下,在派评估者之前
- **输入**：将要升格的判断(达门槛、无推翻)的断言主体
- **输出**：有主体不是实体图节点 ⇒ 拒(entities_unlanded),点名判断与主体;否则放行去独立评估
- **阻断执行**：是
- **原生替代**：无
- **理由**：「本体写得漂亮、实体图是空的」是最容易交付出来的假完成。门只看将要升格的判断:没到门槛的不是结论,只有散文的判断只在卡上列成缺口、不拦。判据是主体是不是图上的节点,不是有没有边——边由升格本身落下,不要求另用 Assert 把同一句话说一遍。
- **代码**：preset/plugins/clearai-kernel.js Conclude; ui/lib/fold.js subjectsOffGraph
- **测试**：test/kernel.test.mjs(实体门); test/contrast.test.mjs(B 组) · **配置**：requireLandedEntities
- **提示词**：preset/plugins/prompts.js clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `criteria-revision-gate` · 判据修订要一份独立裁决

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：model
- **触发**：Frame 修订且 done_criteria 文本变了
- **输入**：criteria_verdict = 一份已落定独立裁决的 auditKey
- **输出**：criteria/revised 变更 → goal.criteriaHistory[]；无裁决则拒（criteria_verdict_required）
- **阻断执行**：否
- **原生替代**：无
- **理由**：判据是"怎样算完成"，它一变前面所有工作的验收含义跟着变；允许在同一次调用里顺手改掉，等于允许把"做不到"重新定义成"做到了"。
- **代码**：preset/plugins/clearai-kernel.js Frame; ui/lib/fold.js applyMutations
- **测试**：test/kernel.test.mjs · **配置**：requireCriteriaVerdict
- **提示词**：preset/plugins/prompts.js clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

### `durable-dispatch-facts` · 派发事实独立落账（在 await 之前）

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：派评估者（audit/dispatched）时
- **输入**：sessionId + 一条已经发生的事实（派发动作本身,不依赖子任务返回什么）
- **输出**：pendingFacts 里一条待落账事实：本拍的 pre-step 兜底落账（drainPendingFacts）,同一个工具结果的 mutations 里也并进同一条（withPendingFacts,pending 在前、按 id 去重）
- **阻断执行**：否
- **原生替代**：无
- **理由**：事实寄存在「工具成功返回」这个易失载体上时,一次已经算完的评审会随栈帧消失：子代理是异步的,工具进了 await 之后进程可能被 abort、宿主服务可能瞬态不可得,而那批 mutations 还没落账——`turnDemand` 的「有裁决在飞 ⇒ hold」不触发,`sweepEndedAudits` 看不见,账上没有这一笔。模型这一侧只会原样重试,于是同一份评审按分钟计地重烧,而每次都可能同样丢。所以「派发」这类事实在 await 之前写进独立通道,两条通道同源同形,宿主那一侧只有一个折法。
- **代码**：preset/plugins/clearai-kernel.js landFact pendingFacts withPendingFacts
- **测试**：test/kernel.test.mjs（派遣事实立刻落账,不随工具结果的成败起落）; test/contrast.test.mjs（结构判据:第一次 await 之前就有独立落账调用） · **配置**：—
- **提示词**：— · **文档**：docs/optimization/2026-09-diagnosis.zh-CN.md

### `audit-digest-reuse` · 裁决按材料 digest 复用（同态不重派）

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：同一状态再次结案（Conclude / 证据审计）,算出来的 digest 与上一次相同
- **输入**：裁决种类 + 步 id + 目标修订号 + 计划步与产物 + 观测 + 原始假设 + 已升格事实 + 非审计来源证据 + 准入坐标里的产物
- **输出**：复用那条已经落定的裁决（verdict ∈ support/refute/inconclusive）并落一条 audit/reused,不派评估者;材料一变 digest 就变,必然重派
- **阻断执行**：否
- **原生替代**：无
- **理由**：digest 只盖材料,所以「重试一次就重烧两三分钟」这件事在机制上不可能发生。一次不确定的结案自己会落一条证据（anchor='auditor'）:把证据集合整个算进 digest,每重试一次 digest 就变一次,复用永远命中不了——而两次之间模型什么都没改,那不是新证据,是同一条评审自己的回声。派生读数（supportedLevel / refutations / inconclusive）同理被排除:它们由证据算出来,算进去等于把回声再算一遍。只有落定过、且真的给出了裁决的那一条才可复用:unknown 不是裁决,它说明那一次没成,正是该重派的理由。
- **代码**：preset/plugins/clearai-kernel.js auditDigest; preset/plugins/clearai-kernel.js reuseAudit pendingAudits
- **测试**：test/kernel.test.mjs（状态逐字未变 ⇒ 第二次结案复用旧裁决,账上留 audit/reused） · **配置**：—
- **提示词**：— · **文档**：docs/optimization/state-machines.zh-CN.md

### `host-read-face-degradation` · 宿主读面降级（取不到就空态,不抛）

- **层**：宿主 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：宿主读面取不到服务（取 sessions / sessionProjections 回 undefined,或取服务时抛错）
- **输入**：服务名 + 会话 id；内核那一侧再吃宿主交出的观测 {id, scope, detail, at}
- **输出**：①读面返回空态（emptyState）而不是异常;②宿主半把降级记成观测,id 由**内容**算出来（scope + detail ⇒ hostHealthId,同一条只记一次,封顶 20 条）;③内核在 pre-step 把还没上账的那几条落成 host/inactive 变更（landedHostHealth 挡重复）;④折法按 id 幂等折进 state.hostHealth[],宿主半只把还没上账的本地那几条随 state() / view() 合并交出——同一条事实在账上一条、读数上也一条
- **阻断执行**：否
- **原生替代**：Cordis 的方法式取服务 ctx.get(name)（取不到只回 undefined;属性式访问在 fiber 非 ACTIVE 时当场抛 cannot get required service in inactive context）
- **理由**：「这一刻读不到」与「世上没有这件事」在界面上长得一模一样:降级抛出去会把一次跑了几分钟的评审整个作废,静默给 undefined 又会让空读数被读成「世上没有这件事」。所以读面一律走方法式取服务、取不到返回空态,并把降级这件事本身记成可观测的事实。只记在进程内还不够——**重启、换进程、离线复判都读不到它**,而这恰恰是最需要事后解释的一条;所以内核在 pre-step 把它落成账本事实,幂等靠内容寻址的 id,而不是靠「记得别写两次」。
- **代码**：ui/lib/index.js sessionsOf; ui/lib/index.js projectionsOf; ui/lib/index.js hostHealth hostHealthId; preset/plugins/clearai-kernel.js landedHostHealth; ui/lib/fold.js case 'host/inactive'
- **测试**：test/host.test.mjs（A1/A6:降级不抛、给的就是空态、两个服务各一条健康事实、view() 同源）; test/kernel.test.mjs（pre-step 把观测落成 host/inactive,同一条反复观察只落一条）; test/contrast.test.mjs（属性式服务访问清零） · **配置**：—
- **提示词**：— · **文档**：docs/optimization/state-machines.zh-CN.md

### `workspace-files-sync` · 工作区文件同步(攒下来的事实与本体住在文件里)

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：每个 pre-step(子会话除外)
- **输入**：clear/knowledge/facts/*.json 与 clear/ontology/{concepts,relations,entities}/**.json 的当前内容
- **输出**：变了的文件连内容一起落成一条 workspace/synced,折进 state.workspace.files;派生的事实行合并别的会话的事实(foreign),并给出 definitionsChanged 与「待处理」里的复核提示
- **阻断执行**：否
- **原生替代**：无
- **理由**：会话账本只活在一次会话里,而研究要跨会话攒下来。文件是唯一跨会话活着的东西;把它的变化落进账本,投影仍然只吃账本,重放读到的是那一刻的文件。
- **代码**：preset/plugins/clearai-kernel.js syncWorkspace listWorkspaceFiles readWorkspaceFile; ui/lib/fold.js case 'workspace/synced'; ui/lib/fold.js derive factRows; ui/lib/domain-language.js factFromFile changedDefinitions
- **测试**：test/kernel.test.mjs(跨会话:另一个会话升格的事实在这里也是已知;定义改了要复核) · **配置**：—
- **提示词**：— · **文档**：docs/optimization/state-machines.zh-CN.md

### `artifact-path-exclusive` · 产物路径不重叠(同一计划里两步不许声明同一个产物)

- **层**：认识论 · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：CreatePlan / RevisePlan(add)
- **输入**：步骤的 artifacts
- **输出**：撞上已有步骤(作废的不算)的产物路径即拒
- **阻断执行**：是
- **原生替代**：无
- **理由**：并行探索交给原生子任务,而原生子任务共用一个工作目录;没有这一条,两条并行的路线会互相覆盖产出,准入收下的就不一定是那一步自己做出来的东西。
- **代码**：preset/plugins/clearai-kernel.js validateSteps; normalizePath
- **测试**：test/kernel.test.mjs（产物路径不重叠） · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/verification-loop.zh-CN.md

### `goal-complete-guard` · 守卫:原生 goal 只能经 Conclude 完成

- **层**：Harness · **状态**：已实现 · **强度**：硬边界 · **权威**：权威 · **责任方**：system
- **触发**：模型调用原生 update_goal(action=complete),而 ClearAI 目标还开着
- **输入**：原生工具调用参数
- **输出**：tools/pre-execute 拒绝,理由指向 Conclude
- **阻断执行**：是
- **原生替代**：dsh-tool-goal
- **理由**：原生 goal 挂上之后,完成有两条路;只留经过独立评估的那条,目标就仍然只有一个完成动词。
- **代码**：preset/plugins/clearai-kernel.js update_goal; Conclude
- **测试**：test/kernel.test.mjs · **配置**：—
- **提示词**：clearai/loop · **文档**：docs/epistemic-loop.zh-CN.md

---

生成物：本文件与 `truth-table.md` 都来自 `truth-table.json`；两份内容等价，语言不同。
