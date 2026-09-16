# ClearAI Mechanism Truth Table

> **This file is generated from `truth-table.json`; do not edit by hand.**
> The source of record is `docs/optimization/truth-table.json`; edit it and run `node tools/build-truth-table.mjs`.
> Cross-checking lives in `node tools/verify-truth-table.mjs`.

This table answers one question: **what the current code actually guarantees**. It does not describe wishes — `Design only` and `Removed` mean exactly that.

## Counts

- Mechanisms: **55**
- By status: Implemented 46 · Partial 2 · Design only 4 · Removed 3
- By strength: Hard boundary 38 · Advisory 10 · Native 3 · Prompt only 1 · Deprecated 3
- By destination: becomes a mechanism 4 · stays design-only 2 · deleted and accounted 3
- Actually blocking execution: **16**
- Affected by autonomy: **2**
- Carrying a known mismatch between docs/comments and code: **6**

## Code constant snapshot

This section is exported from code, not written by hand:

- Mechanisms: 6 (goal / plan / worldline / scout / brain / ledger)
- Intent tools: 22 (SetGoal CloseGoal CreatePlan CheckPlan RequestPlanReview AmendPlan RefinePlan VoidPlanStep ClosePlan AdvancePlan ForkPlan AdvanceWorldline ConvergeFork WorldlineStatus AwaitWorldlines AbandonFork SpawnScout MapScouts SaveSkill WriteMemory FileHistory RestoreFile)
- Config keys: 24
- Prompt sections: 23 defined, 22 mounted at any moment (the clarification slot picks one of two)

## Summary

| id | Mechanism | Layer | Status | Strength | Authority | Actor | Blocks | autonomy | Code |
|---|---|---|---|---|---|---|---|---|---|
| `goal-set` | Goal set and revision | Epistemic | Implemented | Hard boundary | Authoritative | model | no | no | `preset/plugins/clearai-kernel.js SetGoal` |
| `goal-close` | Goal close with independent evaluation | Epistemic | Implemented | Hard boundary | Authoritative | model | yes | no | `preset/plugins/clearai-kernel.js CloseGoal` |
| `hypothesis-registry` | Hypothesis registry and derived state | Epistemic | Implemented | Hard boundary | Authoritative | model | no | no | `preset/plugins/clearai-kernel.js SetGoal hypotheses` |
| `criteria-required` | Criteria-before-work enforcement | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js validateSteps` |
| `formal-plan` | Formal plan | Epistemic | Implemented | Hard boundary | Authoritative | model | yes | no | `preset/plugins/clearai-kernel.js CreatePlan` |
| `plan-review` | Plan human review, the only authorization source | Epistemic | Implemented | Hard boundary | Authoritative | human | no | no | `preset/plugins/clearai-kernel.js requestPlanReview` |
| `plan-reauthorize` | Re-present a plan for review | Epistemic | Implemented | Hard boundary | Authoritative | model | no | no | `preset/plugins/clearai-kernel.js RequestPlanReview` |
| `advance-plan` | AdvancePlan: the only completion verb | Epistemic | Implemented | Hard boundary | Authoritative | model | yes | no | `preset/plugins/clearai-kernel.js AdvancePlan` |
| `plan-amend-no-progress` | Amend/Refine/Void do not move progress | Epistemic | Implemented | Hard boundary | Authoritative | model | no | no | `preset/plugins/clearai-kernel.js AmendPlan` |
| `admission` | Admission: intake only, never a verdict | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js admission` |
| `self-judge-limit` | Self-judgement capped at L2 | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js SELF_JUDGE_MAX_INDEX=2` |
| `independent-evaluator` | Independent evaluator, fresh context, read-only face | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js runEvaluator / resolveToolFace / evaluatorPrompt / writeAuditCard` |
| `l4-human-release` | L4 step/branch human release | Epistemic | Implemented | Hard boundary | Authoritative | human | yes | no | `preset/plugins/clearai-kernel.js l4Delivery` |
| `evidence-record` | Evidence recording | Epistemic | Implemented | Hard boundary | Authoritative | model | no | no | `preset/plugins/clearai-kernel.js buildEvidenceOrigins` |
| `fact-promotion` | Fact promotion | Epistemic | Implemented | Hard boundary | Authoritative | system | no | no | `preset/plugins/clearai-kernel.js persistFact` |
| `history-retention` | Append-only history | Epistemic | Implemented | Hard boundary | Authoritative | system | no | no | `ui/lib/fold.js（全体 case 无删除分支）` |
| `worldline-fork` | Worldline fork with independent working copies | Epistemic | Implemented | Hard boundary | Authoritative | model | no | no | `preset/plugins/clearai-kernel.js ForkPlan` |
| `worldline-metric` | Pre-registered metric and arithmetic convergence | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js validateForkOptions` |
| `worldline-adopt` | Worldline adoption is a human act | Epistemic | Implemented | Hard boundary | Authoritative | human | no | no | `ui/lib/index.js 人门通道（adopt_branch / abandon_fork）` |
| `block-threshold` | Consecutive-block threshold, a quality gate | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js blockedThreshold` |
| `skill-candidate` | Skills default to candidate until a human promotes them | Epistemic | Implemented | Hard boundary | Authoritative | model | no | no | `preset/plugins/brain.js LESSON_REQUIRED/FACT_REQUIRED` |
| `memory-write` | Memory write with field contract and title dedup | Epistemic | Implemented | Hard boundary | Authoritative | model | no | no | `preset/plugins/brain.js 字段契约` |
| `l4-universal-gate` | A universal L4 gate over every evaluation | Epistemic | Design only | Advisory | None | human | no | no | `docs/known-gaps.md` |
| `verification-lifecycle` | Verification lifecycle: which guarantees are live | Epistemic | Design only | Advisory | None | system | no | no | `docs/verification-loop.md` |
| `fact-retraction` | Fact retraction by human decision | Epistemic | Design only | Hard boundary | Authoritative | human | no | no | `preset/plugins/ontology.js hypothesis` |
| `observation-provenance` | Observation provenance: declared sources vs producers | Epistemic | Partial | Hard boundary | Authoritative | system | no | no | `preset/plugins/clearai-kernel.js buildEvidenceOrigins` |
| `plan-auto-confirm` | Removed: unattended plans auto-confirmed themselves | Epistemic | Removed | Deprecated | None | system | no | no | — |
| `single-loop` | Single-loop persona, no free multi-agent orchestration | Harness | Implemented | Advisory | None | model | no | no | `preset/agent.cordis.yml persona` |
| `four-beats` | Four-beat rhythm | Harness | Implemented | Advisory | None | model | no | no | `preset/plugins/prompts.js exploration-rhythm` |
| `scout-precommit` | Pre-commit reconnaissance | Harness | Implemented | Advisory | Authoritative | system | no | no | `preset/plugins/clearai-kernel.js runScout / precommitRecon / scoutDigest / sweepScouts / persistMaterial / noticeBlock` |
| `map-scouts` | Parallel scouting with caps | Harness | Implemented | Advisory | Non-authoritative | model | no | no | `preset/plugins/clearai-kernel.js MapScouts / sweepScouts / persistMaterial / noticeBlock` |
| `evaluator-readonly-face` | Evaluator read-only tool face | Harness | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js resolveToolFace` |
| `executor-tool-face` | Worldline executor face, no plan/goal verbs | Harness | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js executorToolFilter` |
| `tool-trimming` | Tool face trimmed by the contribution table | Harness | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js MECHANISM_TOOLS` |
| `native-todo-disabled` | Native working tools (todo/subagent/workflow/ralph) mounted | Harness | Implemented | Hard boundary | None | system | no | no | `preset/agent.cordis.yml 工作方式段(刻意不挂表只剩 tool-goal/command-goal/plan-mode)` |
| `native-goal-disabled` | Native goal tool and command not mounted | Harness | Implemented | Hard boundary | None | system | no | no | `preset/agent.cordis.yml` |
| `native-plan-mode-disabled` | Native plan mode not mounted | Harness | Implemented | Hard boundary | None | system | no | no | `preset/agent.cordis.yml` |
| `subagent-trimmed` | Native working tools are mounted (todo / subagents / workflow / ralph) | Harness | Implemented | Hard boundary | None | system | no | no | `preset/agent.cordis.yml` |
| `bash-deny-rules` | Bash deny rules | Harness | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js 危险命令匹配` |
| `protected-roots` | Protected roots the model cannot write | Harness | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js protectedRoots` |
| `git-ledger` | Append-only git ledger, workspace repo or side ledger | Harness | Implemented | Hard boundary | Authoritative | system | no | no | `preset/plugins/clearai-kernel.js commitLedger` |
| `kernel-panic-recovery` | Read-only downgraded recovery after engine-level failure | Harness | Implemented | Advisory | None | model | no | no | `preset/plugins/prompts.js execution-discipline（KernelPanic / EffectOutcomeUnknown）` |
| `auto-continuation` | Auto continuation driven by gate state | Harness | Implemented | Hard boundary | Authoritative | system | no | no | `preset/plugins/clearai-kernel.js turnDemand` |
| `max-auto-turns` | Continuation round budget, default 128 | Harness | Implemented | Hard boundary | Authoritative | system | yes | no | `preset/plugins/clearai-kernel.js DEFAULT_MAX_AUTO_TURNS=128` |
| `autonomy-config` | autonomy: deployment initial value and clarification slot selector | Harness | Partial | Prompt only | None | system | no | **yes** | `preset/plugins/clearai-kernel.js CFG.autonomy` |
| `runtime-card` | Per-turn runtime card | Harness | Implemented | Advisory | None | system | no | no | `ui/lib/fold.js renderCard` |
| `prompt-sections` | Prompt sections: 23 defined, 22 mounted at a time | Harness | Implemented | Advisory | None | system | no | **yes** | `preset/plugins/prompts.js SECTIONS` |
| `exploration-zone` | Non-authoritative exploration zone (design goal) | Harness | Design only | Advisory | Non-authoritative | model | no | no | — |
| `subrun-lifecycle` | Unified sub-run lifecycle (one-shot handle, one collection channel) | Harness | Implemented | Hard boundary | Authoritative | system | no | no | `preset/plugins/clearai-kernel.js dispatchSubRun / startWorldlineExecutor / runScout / runEvaluator / runArbiter / sweepScouts / sweepWorldlineExecutors / sweepLostExecutors / sweepLostScouts / publishedInEpoch / noticeBlock` |
| `set-autonomy` | Removed: switching the run tier from the panel | Harness | Removed | Deprecated | None | human | no | no | — |
| `budget-tiers` | Removed: 6-round / 512-round budget tiers | Harness | Removed | Deprecated | None | system | no | no | — |
| `human-gate-actions` | Human-gate action whitelist | Host | Implemented | Hard boundary | Authoritative | human | no | no | `ui/lib/index.js 人门通道` |
| `context-pruning` | Context pruning and compaction, native to the host | Host | Implemented | Native | None | system | no | no | `preset/agent.cordis.yml compaction` |
| `model-routing` | Model routing and switching, host-native and not owned by ClearAI | Host | Implemented | Native | None | host | no | no | `宿主平面（ClearAI 未注册任何 provider/model 状态）` |
| `commands-menu` | Human `/` command menu | UX | Implemented | Native | None | human | no | no | `preset/agent.cordis.yml command-compact（唯一的命令行）` |

## Detail

### `goal-set` · Goal set and revision

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 SetGoal 并给出 claim / done_criteria / hypotheses
- **Input**: claim, done_criteria, hypotheses[], reason(修订时必带)
- **Output**: mutation goal/set
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 目标与判据必须在工作开始前落账，否则完成度无从派生。
- **Code**: preset/plugins/clearai-kernel.js SetGoal; ui/lib/fold.js case 'goal/set'
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/state-protocol · **Docs**: docs/epistemic-loop.zh-CN.md

### `goal-close` · Goal close with independent evaluation

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 CloseGoal(outcome=achieved|abandoned)
- **Input**: outcome, note
- **Output**: mutation audit/dispatched + audit/settled + goal/closed + fact/promoted
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 结案不能由做的人自己宣布；achieved 必须过独立评估者的结构化裁决。
- **Code**: preset/plugins/clearai-kernel.js CloseGoal; syntheticStep; runEvaluator; ui/lib/fold.js case 'goal/closed'
- **Tests**: test/kernel.test.mjs · **Config**: l4RequiresHumanRelease, auditProvider, auditTimeoutMs, auditToolFilter
- **Prompt**: clearai/verification · **Docs**: docs/verification-loop.zh-CN.md

### `hypothesis-registry` · Hypothesis registry and derived state

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: SetGoal 登记 hypotheses；证据到位后由 fold 派生支持等级
- **Input**: claim, refute_when
- **Output**: 派生 supportedLevel / refutation 计数（不落第二本账）
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 假设状态由证据算出来，模型不能打分。首次立目标至少登记 2 条候选（preset 强制，0 条一样拦）：只有一个猜想，检验容易退化成找证据支持自己。
- **Code**: preset/plugins/clearai-kernel.js SetGoal hypotheses; ui/lib/fold.js case 'hypothesis/superseded'
- **Tests**: test/kernel.test.mjs · **Config**: minHypotheses（内核默认 0 = 机制中立；preset 立 2 = 产品立场，与 blockedThreshold 同一模式）
- **Prompt**: clearai/loop-contract · **Docs**: docs/epistemic-loop.zh-CN.md

### `criteria-required` · Criteria-before-work enforcement

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: CreatePlan / AmendPlan 校验步骤
- **Input**: steps[].done_criteria
- **Output**: 装配期拒绝：缺少判据、长度 < 4、或判据自指
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 没有判据就没有可失败的检验，独立评估也无从触发。
- **Code**: preset/plugins/clearai-kernel.js validateSteps; CreatePlan 调用点
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/plan-governance · **Docs**: docs/epistemic-loop.zh-CN.md
- **Known mismatch**: 「每条进入系统的路径都校验判据」靠**测试**维持,不由类型保证:正常入口(`CreatePlan` / `AmendPlan` 经 `validateSteps`)强制判据,而旧会话日志、内部构造的计划对象、以及将来新增的入口不受它约束。

### `formal-plan` · Formal plan

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 CreatePlan
- **Input**: brief, steps[{id, do, artifacts, done_criteria, tests?}]
- **Output**: mutation plan/created（confirmed_at 仅在审阅通过后非空）
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 步骤、产物声明与判据必须在执行前落账，完成度由此派生。
- **Code**: preset/plugins/clearai-kernel.js CreatePlan; MAX_PLAN_STEPS=25; ui/lib/fold.js case 'plan/created'
- **Tests**: test/kernel.test.mjs · **Config**: minBriefChars
- **Prompt**: clearai/plan-rhythm, clearai/plan-governance · **Docs**: docs/epistemic-loop.zh-CN.md

### `plan-review` · Plan human review, the only authorization source

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: human
- **Trigger**: CreatePlan 后机制自己发起原生审阅卡
- **Input**: 原生 plan-review 答案：approved / declined / cancelled / unavailable
- **Output**: 仅 approved 写 confirmed_at + confirmed_by='user'；其余三种一个字都不落。**注意：这不是硬阻断**——未授权只让自动续跑 hold（kernel:1898），AdvancePlan 本身仍可执行，并在同一条变更里补写 confirmed_by='progress'（kernel:3034-3038「行为即授权」）
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-plan-mode 的审阅卡（ClearAI 借用原生审阅界面，不借账）
- **Rationale**: 计划授权必须是「人按的那一下」。唯一的门是原生审阅卡;授权记号只是**归属**——未授权不挡显式推进,只让自动续跑 hold,第一次交付按事实补写 `by=progress`。
- **Code**: preset/plugins/clearai-kernel.js requestPlanReview; CreatePlan 的审阅门; ctx.userQuestions.ask
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/plan-governance · **Docs**: docs/release-verification.md

### `plan-reauthorize` · Re-present a plan for review

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 RequestPlanReview，或 AmendPlan/RefinePlan 之后
- **Input**: 无
- **Output**: 再次呈现审阅；已授权时返回 already_confirmed
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 没有重新呈递入口时，「先改再交」会变成死门。
- **Code**: preset/plugins/clearai-kernel.js RequestPlanReview; AmendPlan/RefinePlan 会自动重新呈递
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/plan-governance · **Docs**: CHANGELOG.md 0.1.2

### `advance-plan` · AdvancePlan: the only completion verb

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 AdvancePlan 并携带交付声明
- **Input**: step_id, artifacts, verdict（L0–L2）, basis
- **Output**: mutation admission/checked + step/advanced（或拒收）
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 只有一个动词能推进循环，「谁推进了这一步」才永远可回答。
- **Code**: preset/plugins/clearai-kernel.js AdvancePlan; SELF_JUDGE_MAX_INDEX 自判上限; ui/lib/fold.js case 'step/advanced'
- **Tests**: test/kernel.test.mjs · **Config**: blockedThreshold, l4RequiresHumanRelease, l4RejectSelfWritten
- **Prompt**: clearai/loop-contract · **Docs**: docs/loop-philosophy.zh-CN.md

### `plan-amend-no-progress` · Amend/Refine/Void do not move progress

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用三者之一
- **Input**: 步骤增补 / 判据修订 / 作废理由
- **Output**: plan/amended, plan/refined, plan/voided（进度不变）
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 进度只由 AdvancePlan 改变，避免多入口推进导致的归属不清。
- **Code**: preset/plugins/clearai-kernel.js AmendPlan; RefinePlan; VoidPlanStep; ui/lib/fold.js/323/330
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/plan-governance · **Docs**: docs/loop-philosophy.zh-CN.md

### `admission` · Admission: intake only, never a verdict

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: AdvancePlan 交付时
- **Input**: 声明的 artifacts
- **Output**: 存在 / 非空 / 结构合法 → 收；否则计一次冲闸，达 blockedThreshold 置 blocked
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 准入回答「这份观测收不收」，不回答「它说明了什么」；不裁决才没有污染结论的问题。
- **Code**: preset/plugins/clearai-kernel.js admission; verdict_not_accepted; ui/lib/fold.js case 'audit/dispatched'
- **Tests**: test/kernel.test.mjs · **Config**: blockedThreshold
- **Prompt**: clearai/verification · **Docs**: docs/loop-philosophy.zh-CN.md

### `self-judge-limit` · Self-judgement capped at L2

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: AdvancePlan 携带 tests.level
- **Input**: level（L0–L4）
- **Output**: level > L2 且调用方自带 verdict → verdict_not_accepted
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 做的人不判自己；等级越高，越不能自证。
- **Code**: preset/plugins/clearai-kernel.js SELF_JUDGE_MAX_INDEX=2; ;
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/verification · **Docs**: docs/verification-loop.zh-CN.md

### `independent-evaluator` · Independent evaluator, fresh context, read-only face

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 准入判定 needs_audit（产物齐备且 done_criteria 非空）时的 L3+ 步骤
- **Input**: 只读产物 + 结构化输出 schema
- **Output**: mutation audit/settled，评估卡由系统落盘
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: dsh-subagent spawn（内核只借用宿主子代理后端）
- **Rationale**: 执行者不能成为结果的唯一裁判；spawn 而非 fork 才能保证判者与做者不共享历史。
- **Code**: preset/plugins/clearai-kernel.js runEvaluator / resolveToolFace / evaluatorPrompt / writeAuditCard; ui/lib/fold.js case audit/dispatched
- **Tests**: test/kernel.test.mjs · **Config**: auditProvider=spawn, auditTimeoutMs, auditToolFilter
- **Prompt**: clearai/verification · **Docs**: docs/verification-loop.zh-CN.md

### `l4-human-release` · L4 step/branch human release

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: human
- **Trigger**: L4 步骤交付 / 世界线分支交付
- **Input**: 原生审批栈的放行记录（不可伪造的审批对）
- **Output**: 无放行记录 → 拒收
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: 宿主审批瀑布 ask
- **Rationale**: L4 意味着高代价或不可逆,必须有人按的那一下。**范围是步骤/分支轴**——这是已定的范围,不是待办:覆盖每一次评估的通用门另立一行(见 l4-universal-gate)。
- **Code**: preset/plugins/clearai-kernel.js l4Delivery; witnessedRelease; ui/lib/fold.js case 'human/released'
- **Tests**: test/kernel.test.mjs · **Config**: l4RequiresHumanRelease=true, l4RejectSelfWritten=true
- **Prompt**: clearai/verification · **Docs**: docs/known-gaps.zh-CN.md

### `evidence-record` · Evidence recording

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 步骤推进时携带 basis / 来源
- **Input**: basis, refs[], origins[]
- **Output**: mutation evidence/recorded
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 结论必须能追到来源；证据可 supersede，不可删除。
- **Code**: preset/plugins/clearai-kernel.js buildEvidenceOrigins; ui/lib/fold.js case 'evidence/recorded'
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/verification · **Docs**: docs/epistemic-loop.zh-CN.md

### `fact-promotion` · Fact promotion

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 目标结案且假设达到 promote_at_level 且无推翻
- **Input**: goal, hypothesis, 评估者裁决
- **Output**: 写入 clear/knowledge/facts/<goal>.md + mutation fact/promoted
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 事实由系统按门槛算出来，模型不能宣称。
- **Code**: preset/plugins/clearai-kernel.js persistFact; promote_at_level 门槛; ui/lib/fold.js case 'fact/promoted'
- **Tests**: test/kernel.test.mjs · **Config**: l4RejectSelfWritten
- **Prompt**: clearai/verification · **Docs**: docs/epistemic-loop.zh-CN.md

### `history-retention` · Append-only history

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 任何状态变更
- **Output**: 推翻 / 作废 / 落选 / 修订全部留痕
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 被推翻的假设是资产：它记录了此路不通。
- **Code**: ui/lib/fold.js（全体 case 无删除分支）; preset/plugins/clearai-kernel.js RestoreFile 走新 commit
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/context-discipline · **Docs**: docs/loop-philosophy.zh-CN.md

### `worldline-fork` · Worldline fork with independent working copies

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 ForkPlan 且给出互斥分支与预注册指标
- **Input**: branches[], decide_by（指标）
- **Output**: mutation fork/created, worldline/prepared, worldline/executing, worldline/executed, branch/delivered
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 互斥路线各占一份工作副本，互不污染。
- **Code**: preset/plugins/clearai-kernel.js ForkPlan; prepareWorldlines; startWorldlineExecutor
- **Tests**: test/kernel.test.mjs, tools/spike-git-worldlines.mjs · **Config**: gitWorldlines, autoDispatchExecutors, executorToolFilter
- **Prompt**: clearai/worldline · **Docs**: docs/epistemic-loop.zh-CN.md

### `worldline-metric` · Pre-registered metric and arithmetic convergence

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: ConvergeFork
- **Input**: 各分支读数 + 预注册尺子
- **Output**: mutation fork/recommended（读数凑齐即落推荐，只记事实）；fork/converged；算不出来 → fork/undecidable，交人
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 尺子必须事先登记；算不出来就停下问人，绝不退化成随便挑一条。
- **Code**: preset/plugins/clearai-kernel.js validateForkOptions; decideWinner; pushRecommendation; ConvergeFork; runArbiter
- **Tests**: test/kernel.test.mjs · **Config**: autoAdoptMinGap=0.15, forkArbitration
- **Prompt**: clearai/worldline · **Docs**: docs/epistemic-loop.zh-CN.md

### `worldline-adopt` · Worldline adoption is a human act

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: human
- **Trigger**: 人在面板上执行 adopt_branch / abandon_fork
- **Input**: fork id, branch id, reason
- **Output**: user 来源消息折进投影，写 by:'user'
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 算术排序选出赢家；采纳是人按的那一下。两者不可合并。
- **Code**: ui/lib/index.js 人门通道（adopt_branch / abandon_fork）; preset/plugins/clearai-kernel.js AbandonFork; adoptWorldline
- **Tests**: test/host.test.mjs · **Config**: —
- **Prompt**: clearai/worldline · **Docs**: docs/epistemic-loop.zh-CN.md

### `block-threshold` · Consecutive-block threshold, a quality gate

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 同一件事连续冲闸未过
- **Input**: 连续未过次数
- **Output**: 达阈值 → 计划置 blocked、停下等人
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 它是质量闸不是预算，因此不再按档取值。
- **Code**: preset/plugins/clearai-kernel.js blockedThreshold; ui/lib/fold.js case 'block/counted'
- **Tests**: test/kernel.test.mjs · **Config**: blockedThreshold=2（预设显式值）
- **Prompt**: clearai/verification · **Docs**: docs/loop-philosophy.zh-CN.md

### `human-gate-actions` · Human-gate action whitelist

- **Layer**: Host · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: human
- **Trigger**: 面板提交人门动词
- **Input**: adopt_branch / abandon_fork / promote_skill
- **Output**: source.kind='user' 的消息；表外动词一律拒（400）
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 这些动词没有工具 schema，模型的工具面里不存在它们。
- **Code**: ui/lib/index.js 人门通道; ui/lib/fold.js HUMAN_GATE_ACTIONS; preset/plugins/clearai-kernel.js
- **Tests**: test/host.test.mjs · **Config**: —
- **Prompt**: clearai/state-protocol · **Docs**: docs/design-principles.zh-CN.md

### `single-loop` · Single-loop persona, no free multi-agent orchestration

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: model
- **Trigger**: 每回合的 persona 与 foundation 段
- **Output**: 模型被要求以单一主循环推进
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh 原生 subagent / workflow / ralph（已随预设挂回(阶段 5;权威边界测试钉死它们产不出 clearai 变更)）
- **Rationale**: 子角色由系统按触发派生,避免自由委派把「自己派人判自己」重新引入。这是**偏好**(hardness=advisory):工作方式本身不设限,约束在权威账本那一侧。
- **Code**: preset/agent.cordis.yml persona; preset/plugins/prompts.js foundation
- **Tests**: test/prompt-sections.test.mjs（阶段 6 新增） · **Config**: —
- **Prompt**: clearai/foundation · **Docs**: docs/loop-philosophy.zh-CN.md

### `four-beats` · Four-beat rhythm

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: model
- **Trigger**: 每回合注入
- **Output**: 模型据四拍组织行为
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 七阶段在运行时的压缩表达。
- **Code**: preset/plugins/prompts.js exploration-rhythm; preset/agent.cordis.yml
- **Tests**: test/prompt-sections.test.mjs（阶段 6 新增） · **Config**: —
- **Prompt**: clearai/exploration-rhythm · **Docs**: docs/loop-philosophy.zh-CN.md

### `scout-precommit` · Pre-commit reconnaissance

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: Authoritative · **Actor**: system
- **Trigger**: SetGoal 落定判据，且 input/ 有材料
- **Input**: brief
- **Output**: mutation scout/dispatched + scout/settled
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 侦察是低权威的读侧工作，先看清材料再立约。
- **Code**: preset/plugins/clearai-kernel.js runScout / precommitRecon / scoutDigest / sweepScouts / persistMaterial / noticeBlock; ui/lib/fold.js case scout/dispatched
- **Tests**: test/kernel.test.mjs · **Config**: precommitRecon=true, scoutToolFilter
- **Prompt**: clearai/delegation · **Docs**: docs/epistemic-loop.zh-CN.md

### `map-scouts` · Parallel scouting with caps

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: Non-authoritative · **Actor**: model
- **Trigger**: 模型调用 MapScouts
- **Input**: 任务清单
- **Output**: 多个只读子 run 的结论
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh 原生 subagent 并行（已随预设挂回(阶段 5;权威边界测试钉死它们产不出 clearai 变更)）
- **Rationale**: 放几十个子 run 出去不是并行，是把宿主打满。
- **Code**: preset/plugins/clearai-kernel.js MapScouts / sweepScouts / persistMaterial / noticeBlock
- **Tests**: test/kernel.test.mjs · **Config**: mapScoutMax=50, mapScoutConcurrency=4
- **Prompt**: clearai/delegation · **Docs**: docs/epistemic-loop.zh-CN.md

### `evaluator-readonly-face` · Evaluator read-only tool face

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 派遣评估者时
- **Input**: 候选工具名
- **Output**: 按部署实际工具注册表过滤；未知工具名 fail-closed
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: dsh-subagent 的 tools.restrict
- **Rationale**: 判的人不能改产物。
- **Code**: preset/plugins/clearai-kernel.js resolveToolFace; auditToolFilter
- **Tests**: test/kernel.test.mjs · **Config**: auditToolFilter=[read,glob,grep,read_image]
- **Prompt**: clearai/verification · **Docs**: docs/verification-loop.zh-CN.md

### `executor-tool-face` · Worldline executor face, no plan/goal verbs

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 派遣世界线执行者时
- **Input**: 候选工具名
- **Output**: 任务书即计划；执行者工具面里根本没有 CreatePlan/AdvancePlan/ClosePlan
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 把「不要自己开计划」从嘱咐变成不可表达。
- **Code**: preset/plugins/clearai-kernel.js executorToolFilter
- **Tests**: test/kernel.test.mjs · **Config**: executorToolFilter
- **Prompt**: clearai/delegation · **Docs**: docs/epistemic-loop.zh-CN.md

### `tool-trimming` · Tool face trimmed by the contribution table

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 装配期
- **Input**: 贡献表
- **Output**: unknown_mechanism / unknown_tool / tool_of_disabled_mechanism 等装配期抛错
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 装了哪些工具是清单事实，不是散落在代码里的既成事实。
- **Code**: preset/plugins/clearai-kernel.js MECHANISM_TOOLS; resolveContributions; ctx.tools.register
- **Tests**: test/kernel.test.mjs · **Config**: contributions.{mechanisms,tools,sections}
- **Prompt**: — · **Docs**: docs/loop-philosophy.zh-CN.md

### `native-todo-disabled` · Native working tools (todo/subagent/workflow/ralph) mounted

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Output**: 四件原生工作方式在工具面里;第二本账三件仍不挂
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-tool-todo（standard 预设挂载）
- **Rationale**: 工作方式交还原生:它们产不出一条 clearai 变更(权威边界测试钉死)。「todo 是第二本账」的旧判断在阶段 5 被修正——便签不是账本,进度永远以 AdvancePlan 落账为准。第二本账三件(goal 工具/命令、plan-mode)仍然不挂:那是真冲突。
- **Code**: preset/agent.cordis.yml 工作方式段(刻意不挂表只剩 tool-goal/command-goal/plan-mode)
- **Tests**: test/preset-composition.test.mjs（阶段 5 新增） · **Config**: —
- **Prompt**: — · **Docs**: preset/agent.cordis.yml

### `native-goal-disabled` · Native goal tool and command not mounted

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Output**: tool-goal / command-goal 均不在面里
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-tool-goal / dsh-command-goal（standard 预设挂载）
- **Rationale**: ClearAI 的目标账是唯一一本；宿主 goals 只当续跑驱动器被内核程序化使用。
- **Code**: preset/agent.cordis.yml
- **Tests**: test/preset-composition.test.mjs（阶段 5 新增） · **Config**: —
- **Prompt**: — · **Docs**: preset/agent.cordis.yml

### `native-plan-mode-disabled` · Native plan mode not mounted

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Output**: plan-mode 不在面里
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-plan-mode（standard 预设挂载）
- **Rationale**: 与 CreatePlan/AdvancePlan 是两套计划纪律，同时挂上就是第二本账。
- **Code**: preset/agent.cordis.yml
- **Tests**: test/preset-composition.test.mjs（阶段 5 新增） · **Config**: —
- **Prompt**: — · **Docs**: preset/agent.cordis.yml

### `subagent-trimmed` · Native working tools are mounted (todo / subagents / workflow / ralph)

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Output**: tool-subagent / tool-subagent-control / tool-workflow / tool-ralph 均不在面里
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-tool-subagent / dsh-tool-workflow / dsh-tool-ralph
- **Rationale**: 自由委派会重新引入「自己派一个来判自己」。现在按**分层**处理:工作方式交还原生、产物停在非权威区;权威账本仍只能由主线过准入与唯一完成动词写入(见 authority-boundary 套件)。
- **Code**: preset/agent.cordis.yml
- **Tests**: test/preset-composition.test.mjs（阶段 5 新增） · **Config**: —
- **Prompt**: clearai/delegation · **Docs**: preset/agent.cordis.yml

### `bash-deny-rules` · Bash deny rules

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 每次 bash 工具调用前
- **Input**: command 字符串
- **Output**: kind:'deny' + reason
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: 无重叠（已核实）：宿主 bash 只有沙箱路径域与审批升级，没有内容级威胁模式清单（dsh-tool-bash / dsh-bash-sandbox / dsh-bash-local 均无）；fork 炸弹这类在可写沙箱内完全合法的命令，只有内容规则拦得住
- **Rationale**: 危险命令不可执行应落机制而不是提示词。与宿主治理分属三条轴：沙箱管「写哪」、审批管「谁同意」、这份清单管「命令本身是什么威胁」。
- **Code**: preset/plugins/clearai-kernel.js 危险命令匹配; / 受保护路径拒绝
- **Tests**: test/kernel.test.mjs · **Config**: bashDenyRules=true
- **Prompt**: — · **Docs**: docs/loop-philosophy.zh-CN.md

### `protected-roots` · Protected roots the model cannot write

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 每次写类工具调用前
- **Input**: 路径
- **Output**: clear/evidence、clear/knowledge/facts、clear/goals 由系统所有 → deny
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 事实与评估卡只能由系统落盘。
- **Code**: preset/plugins/clearai-kernel.js protectedRoots; touchesProtected
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/verification · **Docs**: docs/design-principles.zh-CN.md

### `git-ledger` · Append-only git ledger, workspace repo or side ledger

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 步骤交付点 / 文件历史查询 / 恢复
- **Input**: 路径或交付点
- **Output**: mutation git/committed, git/restored, git/snapshot
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 事后可回滚取代事前审批的前提是账本足够可靠。
- **Code**: preset/plugins/clearai-kernel.js commitLedger; FileHistory; RestoreFile
- **Tests**: test/kernel.test.mjs · **Config**: ledgerMaxFiles=20000
- **Prompt**: clearai/context-discipline · **Docs**: docs/loop-philosophy.zh-CN.md
- **Known mismatch**: 旁路账本被删除会让仍存活的分叉变成孤儿（见 known-gaps）。

### `kernel-panic-recovery` · Read-only downgraded recovery after engine-level failure

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: model
- **Trigger**: KernelPanic / EffectOutcomeUnknown
- **Output**: 恢复回合只允许只读工具，禁止 bash/子 Agent 重放
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 效果未知时先观察当前事实,再谈重试。**只由提示词承载**(`prompts.js` 的 execution-discipline);内核与宿主两半都没有针对它的硬约束——这是 hardness=advisory 的含义,不是缺口。
- **Code**: preset/plugins/prompts.js execution-discipline（KernelPanic / EffectOutcomeUnknown）
- **Tests**: test/prompt-sections.test.mjs（阶段 6 新增） · **Config**: —
- **Prompt**: clearai/execution-discipline · **Docs**: docs/loop-philosophy.zh-CN.md

### `auto-continuation` · Auto continuation driven by gate state

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 回合结束时检查是否仍有工作且门都关着
- **Input**: 派生状态：blocked / 授权 / 未决裁决 / hasOpenGate / 开着的步 / 目标是否开放
- **Output**: drive / hold / stop；对应宿主 goals 的 create/edit/resume/pause/block/clear
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-goal-round-driver 执行轮数上限
- **Rationale**: 「要不要人」已经由门表达；再让用户预先声明是错的。
- **Code**: preset/plugins/clearai-kernel.js turnDemand; armContinuation; holdContinuation; stopContinuation
- **Tests**: test/kernel.test.mjs · **Config**: runtimeCard, maxAutoTurns
- **Prompt**: clearai/clarification-* · **Docs**: docs/epistemic-loop.zh-CN.md

### `max-auto-turns` · Continuation round budget, default 128

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 布防续跑窗口时
- **Input**: maxAutoTurns
- **Output**: 传给宿主目标的 maxGoalRounds；到限由 dsh-goal-round-driver 自己 block(code='round-limit')
- **Blocks execution**: yes · **Affected by autonomy**: no
- **Native alternative**: dsh-goal-round-driver
- **Rationale**: 保险丝：够长到跑完一件真活，又短到不会无声烧掉一整夜。
- **Code**: preset/plugins/clearai-kernel.js DEFAULT_MAX_AUTO_TURNS=128; CFG.maxAutoTurns ?? DEFAULT_MAX_AUTO_TURNS
- **Tests**: test/kernel.test.mjs · **Config**: maxAutoTurns（预设刻意不写，取默认）
- **Prompt**: clearai/clarification-* · **Docs**: docs/epistemic-loop.zh-CN.md

### `autonomy-config` · autonomy: deployment initial value and clarification slot selector

- **Layer**: Harness · **Status**: Partial · **Strength**: Prompt only · **Authority**: None · **Actor**: system
- **Trigger**: 装配期选择澄清协议段；运行态卡展示
- **Input**: attended | unattended
- **Output**: 一段澄清协议 + 一份运行态展示
- **Blocks execution**: no · **Affected by autonomy**: yes
- **Native alternative**: none
- **Rationale**: 「我在不在场」是运行时状态:要不要继续由**门**算出来(计划待确认 / 裁决在飞 / 有人在等),档位只剩一个作用——决定澄清协议装哪一段。`autonomy.override` 的读取路径**保留但只读**(旧会话日志里可能有 `set_autonomy` 记录),当前没有任何写入者;更完整的「模式系统」是刻意不做的。
- **Destination**: stays design-only
- **Code**: preset/plugins/clearai-kernel.js CFG.autonomy; resolveSections; effectiveAutonomy; publishAutonomy
- **Tests**: test/kernel.test.mjs · **Config**: autonomy=attended（预设初值）
- **Prompt**: clearai/clarification-attended | clearai/clarification-unattended（槽位二选一） · **Docs**: preset/agent.cordis.yml

### `runtime-card` · Per-turn runtime card

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: system
- **Trigger**: 状态变化时随回合注入
- **Input**: 派生状态
- **Output**: 一段状态卡文本
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 让模型每回合看到当前真实状态,而不是依赖记忆;仅在状态变化时注入以保持前缀稳定。卡里用的是人话,不出现账本字段名(`plan_confirmation_pending` / `confirmed_at`)或宿主 id。
- **Code**: ui/lib/fold.js renderCard; preset/plugins/clearai-kernel.js pluginNotice
- **Tests**: test/kernel.test.mjs, test/host.test.mjs · **Config**: runtimeCard=true
- **Prompt**: clearai/state-protocol · **Docs**: docs/loop-philosophy.zh-CN.md

### `prompt-sections` · Prompt sections: 23 defined, 22 mounted at a time

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Input**: 段清单（槽位 clarification 按 autonomy 收敛）
- **Output**: 系统提示词段集合
- **Blocks execution**: no · **Affected by autonomy**: yes
- **Native alternative**: none
- **Rationale**: 提示词解释行为,但按 P1 不是执行边界。每一段都带 `hard` / `native` / `advisory` 分类,并由 `test/prompt-sections.test.mjs` 咬合内容与分类。剩下来的是**厚薄**上的取舍(与原生重复的说明还能再下沉),属编辑口味,不是机制缺口。
- **Code**: preset/plugins/prompts.js SECTIONS; preset/plugins/clearai-kernel.js systemPrompt
- **Tests**: test/prompt-sections.test.mjs（阶段 6 新增） · **Config**: contributions.sections
- **Prompt**: 自身 · **Docs**: docs/design-principles.zh-CN.md

### `context-pruning` · Context pruning and compaction, native to the host

- **Layer**: Host · **Status**: Implemented · **Strength**: Native · **Authority**: None · **Actor**: system
- **Trigger**: 工具结果超阈值 / 手动 /compact
- **Input**: 工具结果
- **Output**: 剪枝后的结果
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-compaction-basic / dsh-command-compact（即原生本体）
- **Rationale**: 上下文是受控资源；执行它的本来就是原生，ClearAI 只做装配声明。
- **Code**: preset/agent.cordis.yml compaction
- **Tests**: test/client.test.mjs（装配） · **Config**: thresholdChars=8192, headChars=4096, tailChars=1024
- **Prompt**: clearai/context-discipline · **Docs**: docs/loop-philosophy.zh-CN.md

### `skill-candidate` · Skills default to candidate until a human promotes them

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 SaveSkill
- **Input**: name, description, 正文
- **Output**: clear/skills/<name>/SKILL.md，status=candidate；人 promote_skill 后才 modelInvocable
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-skill / dsh-skill-filesystem（读侧全走原生）
- **Rationale**: 模型写的 SOP 该由人过一道。
- **Code**: preset/plugins/brain.js LESSON_REQUIRED/FACT_REQUIRED; preset/plugins/clearai-kernel.js SaveSkill; ui/lib/fold.js promote_skill
- **Tests**: test/brain.test.mjs · **Config**: —
- **Prompt**: clearai/skill-protocol · **Docs**: docs/epistemic-loop.zh-CN.md

### `memory-write` · Memory write with field contract and title dedup

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 WriteMemory
- **Input**: lesson 的五字段 / fact 的四字段
- **Output**: clear/memory/**；按标题跨文件去重
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh 原生 skill 目录承载读侧
- **Rationale**: 结构只有机制保证得了。
- **Code**: preset/plugins/brain.js 字段契约; WriteMemory
- **Tests**: test/brain.test.mjs · **Config**: —
- **Prompt**: clearai/memory-protocol · **Docs**: docs/epistemic-loop.zh-CN.md

### `model-routing` · Model routing and switching, host-native and not owned by ClearAI

- **Layer**: Host · **Status**: Implemented · **Strength**: Native · **Authority**: None · **Actor**: host
- **Trigger**: 宿主原生入口
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-client-ui-model-selection
- **Rationale**: ClearAI 不维护第二份模型状态账:切换走原生入口(`dsh-tool-subagent` 的 `modelSelectionSettings`),运行态卡不展示当前模型——它不参与任何判断。
- **Code**: 宿主平面（ClearAI 未注册任何 provider/model 状态）; preset/agent.cordis.yml 无相关行
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: —

### `commands-menu` · Human `/` command menu

- **Layer**: UX · **Status**: Implemented · **Strength**: Native · **Authority**: None · **Actor**: human
- **Trigger**: 人在输入框敲 /
- **Input**: 命令名 + 参数
- **Output**: 原生命令结果
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-commands 注册表
- **Rationale**: 菜单是 DSH 原生的人类命令通道,应优先于自建协议。ClearAI 贡献五个**只读**命令(`/goal` `/plan` `/evidence` `/worldline` 现算状态窗,`/plan-review` 把呈审 steer 给模型);命令处理器没有变更通道,那是权威边界。
- **Code**: preset/agent.cordis.yml command-compact（唯一的命令行）; preset/plugins/ 无 commands 贡献
- **Tests**: test/preset-composition.test.mjs（阶段 5 新增） · **Config**: —
- **Prompt**: — · **Docs**: —

### `exploration-zone` · Non-authoritative exploration zone (design goal)

- **Layer**: Harness · **Status**: Design only · **Strength**: Advisory · **Authority**: Non-authoritative · **Actor**: model
- **Trigger**: —
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: dsh-tool-todo / dsh-tool-subagent
- **Rationale**: 把「组织工作」与「确认知识」解耦：探索可以自由，事实必须严格。
- **Destination**: becomes a mechanism
- **Code**: —
- **Tests**: test/authority-boundary.test.mjs（阶段 4 新增） · **Config**: —
- **Prompt**: — · **Docs**: docs/optimization/plan.zh-CN.md
- **Known mismatch**: 尚未实现；当前所有工作都被拉进正式循环。

### `subrun-lifecycle` · Unified sub-run lifecycle (one-shot handle, one collection channel)

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 内核派任何子任务：侦察、世界线执行者、评估者、横评仲裁
- **Input**: 人格 + 任务书 + 工具面 + （评估者/仲裁）结构化输出 schema
- **Output**: 对应的事实变更（scout/settled、worldline/executed、audit/settled、fork/arbitrated）
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: subagents.start()（原生一次性句柄）——不借用可续跑与结算通知：通知是 best-effort，不能当账本的承重结构
- **Rationale**: 子任务的生命周期必须由内核自己掌握:账本只认本进程攥着的句柄,结论送达由收集那一刻的返回完成;四种角色共用一套,差异只在人格、工具面与结果解释方式。
- **Code**: preset/plugins/clearai-kernel.js dispatchSubRun / startWorldlineExecutor / runScout / runEvaluator / runArbiter / sweepScouts / sweepWorldlineExecutors / sweepLostExecutors / sweepLostScouts / publishedInEpoch / noticeBlock
- **Tests**: test/kernel.test.mjs（含会话隔离用例）; tools/e2e-scenarios.mjs（模型可见性不变量） · **Config**: auditProvider=spawn, auditTimeoutMs
- **Prompt**: clearai/delegation · **Docs**: docs/optimization/e2e-longruns.zh-CN.md

### `l4-universal-gate` · A universal L4 gate over every evaluation

- **Layer**: Epistemic · **Status**: Design only · **Strength**: Advisory · **Authority**: None · **Actor**: human
- **Trigger**: —
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: **不实现是一个决定,不是待办**:门要加在「正确答案取决于人」的地方。每一次评估都上门,等于把非承重的取舍塞给人——那正是这套设计反复要避免的。L4 的门挂在**等级**上(步骤/分支轴),见 l4-human-release。
- **Destination**: stays design-only
- **Code**: docs/known-gaps.md
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/known-gaps.md

### `verification-lifecycle` · Verification lifecycle: which guarantees are live

- **Layer**: Epistemic · **Status**: Design only · **Strength**: Advisory · **Authority**: None · **Actor**: system
- **Trigger**: —
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 文档里那台「八状态验证机」是**设计记录**,不是运行时保证:它要求把九个生命周期态**存下来**,而本系统的状态必须能由日志重算(P3)。逐条对照后,它承诺的保证大部分已由既有事实与派生覆盖(判据登记 / L4 放行 / 观测准入 / 评估 / 无果终止),**还缺两条**:结果永远不来时把决定摆到人面前(expired),以及同一步连续无法判定时强制改判据(inconclusive 重试政策)。§6 的 rule 1(逐级推进)同样没有落点。
- **Destination**: becomes a mechanism
- **Code**: docs/verification-loop.md; preset/plugins/ontology.js VERIFICATION_LOOP; ui/lib/fold.js derive
- **Tests**: test/ontology.test.mjs · **Config**: —
- **Prompt**: — · **Docs**: docs/verification-loop.md
- **Known mismatch**: 文档以现在时把整台状态机标为设计目标是对的,但 §6 开头那句「系统在状态变更时检查这些,而不是靠提示词」对 rule 1 不成立:它**零实现、零提示词**。

### `fact-retraction` · Fact retraction by human decision

- **Layer**: Epistemic · **Status**: Design only · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: human
- **Trigger**: 已升格事实的假设收到推翻证据
- **Input**: 事实 + 缘由
- **Output**: —(没有生产者)
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 事实带边界(scope):边界被触发时,要有一个人能把它撤回,而且撤回永不自动。**声明与实现三方不一致**:文档说 ontology 定义了 `retracted`,实际 `preset/plugins/ontology.js` 的 hypothesis states 里没有它,而 `ui/lib/client.js` 已经在画这个状态、`fold.js` 的派生也已经把它排除在有效命题之外。
- **Destination**: becomes a mechanism
- **Code**: preset/plugins/ontology.js hypothesis; ui/lib/client.js PROPOSITION_GROUPS
- **Tests**: — · **Config**: —
- **Prompt**: clearai/verification · **Docs**: docs/verification-loop.md
- **Known mismatch**: `docs/verification-loop.md` 与 `docs/known-gaps.md` 都说「ontology 定义了 `retracted`」,而 `preset/plugins/ontology.js` 的 hypothesis states 是 proposed/alive/confirmed/refuted/superseded——**没有** `retracted`;界面却已经渲染它。

### `observation-provenance` · Observation provenance: declared sources vs producers

- **Layer**: Epistemic · **Status**: Partial · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 交付时登记观测(主线或世界线)
- **Input**: ref + note
- **Output**: mutation observation/recorded（source 只写过 self 与 scout）
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 类型的职责是**只声明今天真的可表示的东西**:内核只有两处写 `self`、一处写 `scout`,而 ontology 的 `source.values` 列了五个取值。多出来的那四个既没有生产者,也没有任何决策消费它们。
- **Destination**: becomes a mechanism
- **Code**: preset/plugins/clearai-kernel.js buildEvidenceOrigins; ui/lib/fold.js case 'observation/recorded'
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: — · **Docs**: docs/verification-loop.md
- **Known mismatch**: ontology 声明 `source` 可取 `human_upload` / `file_drop` / `callback` / `pull`,而这四个**没有任何生产者**,也没有任何决策消费它们——类型里的假话。

### `set-autonomy` · Removed: switching the run tier from the panel

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: human
- **Trigger**: —
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 「要不要人在场」是**运行时状态**,不是面板上的一个开关:有事要拍板就有门开着,没门就继续跑。那个档位还顺手把「计划经人确认」变成系统自己签的——用门代替开关之后,它没有存在的理由。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/known-gaps.md

### `budget-tiers` · Removed: 6-round / 512-round budget tiers

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: system
- **Trigger**: —
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 轮数是**保险丝**,不是用户的档位。原先两档把「我在不在场」变成了配置项,还把「计划经人确认」变成系统自己签的。现在只有一个默认值(128),由**原生**的 round driver 执行上限。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/known-gaps.md

### `plan-auto-confirm` · Removed: unattended plans auto-confirmed themselves

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: system
- **Trigger**: —
- **Blocks execution**: no · **Affected by autonomy**: no
- **Native alternative**: none
- **Rationale**: 让系统替人签「这份计划经人确认」,那条证据就是系统自己伪造的——与 L4「人放行」是同一类病。门的意义在于「这一下是人按的」,所以 `confirmed_by` 只剩 `user` 与 `progress`。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/known-gaps.md

---

Generated: this file and `truth-table.zh-CN.md` both come from `truth-table.json`; equivalent content, two languages.
