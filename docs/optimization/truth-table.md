# ClearAI Mechanism Truth Table

> **This file is generated from `truth-table.json`; do not edit by hand.**
> The source of record is `docs/optimization/truth-table.json`; edit it and run `node tools/build-truth-table.mjs`.
> Cross-checking lives in `node tools/verify-truth-table.mjs`.

This table answers one question: **what the current code actually guarantees**. It does not describe wishes — `Design only` and `Removed` mean exactly that.

## Counts

- Mechanisms: **75**
- By status: Implemented 52 · Design only 1 · Removed 22
- By strength: Hard boundary 43 · Advisory 7 · Native 3 · Deprecated 22
- By destination: stays design-only 1 · deleted and accounted 22
- Actually blocking execution: **21**
- Carrying a known mismatch between docs/comments and code: **1**

## Code constant snapshot

This section is exported from code, not written by hand:

- Mechanisms: 3 (goal / plan / ontology)
- Intent tools: 10 (Frame Conclude CreatePlan AdvancePlan RevisePlan ClosePlan Define Deprecate RegisterInstance Assert)
- Config keys: 13
- Prompt sections: 3 defined, 3 mounted at any moment

## Summary

| id | Mechanism | Layer | Status | Strength | Authority | Actor | Blocks | Code |
|---|---|---|---|---|---|---|---|---|
| `goal-set` | Frame: goal set and revision, attached to the native goal | Epistemic | Implemented | Hard boundary | Authoritative | model | no | `preset/plugins/clearai-kernel.js Frame` |
| `goal-close` | Conclude: goal close with independent evaluation | Epistemic | Implemented | Hard boundary | Authoritative | model | yes | `preset/plugins/clearai-kernel.js Conclude` |
| `hypothesis-registry` | Hypothesis registry and derived state | Epistemic | Implemented | Hard boundary | Authoritative | model | no | `preset/plugins/clearai-kernel.js Frame hypotheses` |
| `criteria-required` | Criteria-before-work enforcement | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js validateSteps` |
| `formal-plan` | Formal plan | Epistemic | Implemented | Hard boundary | Authoritative | model | yes | `preset/plugins/clearai-kernel.js CreatePlan` |
| `plan-review` | Removed: plan review stamp | Epistemic | Removed | Deprecated | None | human | no | — |
| `plan-reauthorize` | Removed: re-present a plan for review | Epistemic | Removed | Deprecated | None | model | no | — |
| `advance-plan` | AdvancePlan: the only completion verb | Epistemic | Implemented | Hard boundary | Authoritative | model | yes | `preset/plugins/clearai-kernel.js AdvancePlan` |
| `plan-amend-no-progress` | RevisePlan (add / refine / void) does not move progress | Epistemic | Implemented | Hard boundary | Authoritative | model | no | `preset/plugins/clearai-kernel.js RevisePlan` |
| `admission` | Admission: intake only, never a verdict | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js admission` |
| `self-judge-limit` | Self-judgement capped at L2 | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js SELF_JUDGE_MAX_INDEX=2` |
| `independent-evaluator` | Independent evaluator, fresh context, read-only face | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js runEvaluator / resolveToolFace / evaluatorPrompt / writeAuditCard` |
| `l4-human-release` | L4 step/branch human release | Epistemic | Implemented | Hard boundary | Authoritative | human | yes | `preset/plugins/clearai-kernel.js l4Delivery` |
| `evidence-record` | Evidence recording | Epistemic | Implemented | Hard boundary | Authoritative | model | no | `preset/plugins/clearai-kernel.js buildEvidenceOrigins` |
| `fact-promotion` | Fact promotion | Epistemic | Implemented | Hard boundary | Authoritative | system | no | `preset/plugins/clearai-kernel.js persistFact` |
| `history-retention` | Append-only history | Epistemic | Implemented | Hard boundary | Authoritative | system | no | `ui/lib/fold.js（全体 case 无删除分支）` |
| `worldline-fork` | Removed: Worldline fork with independent working copies | Epistemic | Removed | Deprecated | Authoritative | model | no | — |
| `worldline-metric` | Removed: Pre-registered metric and arithmetic convergence | Epistemic | Removed | Deprecated | Authoritative | system | yes | — |
| `worldline-adopt` | Removed: Worldline adoption is a human act | Epistemic | Removed | Deprecated | Authoritative | human | no | — |
| `block-threshold` | Consecutive-block threshold, a quality gate | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js blockedThreshold` |
| `skill-candidate` | Removed: Skills default to candidate until a human promotes them | Epistemic | Removed | Deprecated | Authoritative | model | no | — |
| `memory-write` | Removed: Memory write with field contract and title dedup | Epistemic | Removed | Deprecated | Authoritative | model | no | — |
| `l4-universal-gate` | A universal L4 gate over every evaluation | Epistemic | Design only | Advisory | None | human | no | `docs/known-gaps.md` |
| `verification-lifecycle` | Verification lifecycle: which guarantees are live | Epistemic | Implemented | Advisory | None | system | no | `preset/plugins/clearai-kernel.js countBlock` |
| `fact-retraction` | Fact retraction by human decision | Epistemic | Implemented | Hard boundary | Authoritative | human | no | `preset/plugins/clearai-kernel.js reviewRefutedFacts` |
| `observation-provenance` | Observation provenance: declared sources vs producers | Epistemic | Implemented | Hard boundary | Authoritative | system | no | `preset/plugins/ontology.js VERIFICATION_LOOP` |
| `plan-auto-confirm` | Removed: unattended plans auto-confirmed themselves | Epistemic | Removed | Deprecated | None | system | no | — |
| `ontology-lexicon-events` | Domain vocabulary events fold into state.lexicon | Epistemic | Implemented | Hard boundary | Authoritative | system | no | `ui/lib/domain-language.js applyLexiconMutation` |
| `assertion-validation` | Assertion shape validation (before anything lands) | Epistemic | Implemented | Hard boundary | Authoritative | model | yes | `ui/lib/domain-language.js validateAssertions` |
| `conflict-derivation` | Conflict derivation (surfaced, never adjudicated) | Epistemic | Implemented | Hard boundary | Authoritative | system | no | `ui/lib/domain-language.js deriveConflicts` |
| `graph-projection` | Ontology and entity graph projection (deterministic layout) | Epistemic | Implemented | Hard boundary | Authoritative | system | no | `ui/lib/domain-language.js graphProjection` |
| `ontology-verbs` | Named verbs for the domain vocabulary, and the shelf | Epistemic | Implemented | Hard boundary | Authoritative | model | no | `preset/plugins/clearai-kernel.js Define` |
| `entity-registration` | Entity registration (instances as a first-class write path) | Epistemic | Implemented | Hard boundary | Authoritative | model | no | `preset/plugins/clearai-kernel.js RegisterInstance` |
| `entity-assertion` | Entity assertion (edge holds on record) | Epistemic | Implemented | Hard boundary | Authoritative | model | no | `preset/plugins/clearai-kernel.js Assert` |
| `entity-gate` | Entity gate (the only structural gate at Conclude) | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js Conclude` |
| `level-skip-reason` | Removed: level skips need a named reason | Epistemic | Removed | Deprecated | None | model | no | — |
| `criteria-revision-gate` | Criterion revisions need an independent verdict | Epistemic | Implemented | Hard boundary | Authoritative | model | no | `preset/plugins/clearai-kernel.js Frame` |
| `audit-digest-reuse` | Verdicts are reused by material digest (same state, no re-dispatch) | Epistemic | Implemented | Hard boundary | Authoritative | system | no | `preset/plugins/clearai-kernel.js auditDigest` |
| `workspace-files-sync` | Workspace file sync (accumulated facts and ontology live in files) | Epistemic | Implemented | Hard boundary | Authoritative | system | no | `preset/plugins/clearai-kernel.js syncWorkspace listWorkspaceFiles readWorkspaceFile` |
| `artifact-path-exclusive` | Exclusive artifact paths (no two steps in a plan declare the same artefact) | Epistemic | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js validateSteps` |
| `single-loop` | Single-loop persona, no free multi-agent orchestration | Harness | Implemented | Advisory | None | model | no | `preset/agent.cordis.yml persona` |
| `four-beats` | Four-beat rhythm | Harness | Implemented | Advisory | None | model | no | `preset/plugins/prompts.js loop` |
| `scout-precommit` | Removed: Pre-commit reconnaissance | Harness | Removed | Deprecated | Authoritative | system | no | — |
| `map-scouts` | Removed: Parallel scouting with caps | Harness | Removed | Deprecated | Non-authoritative | model | no | — |
| `evaluator-readonly-face` | Evaluator read-only tool face | Harness | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js resolveToolFace` |
| `executor-tool-face` | Removed: Worldline executor face, no plan/goal verbs | Harness | Removed | Deprecated | Authoritative | system | yes | — |
| `tool-trimming` | Tool face trimmed by the contribution table | Harness | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js MECHANISM_TOOLS` |
| `native-todo-disabled` | Native working tools (todo/subagent/workflow/ralph) mounted | Harness | Implemented | Hard boundary | None | system | no | `preset/agent.cordis.yml 工作方式段` |
| `native-goal-disabled` | Native goal tool and command mounted; the goal layer sits on the native goal | Harness | Implemented | Hard boundary | None | system | no | `preset/agent.cordis.yml` |
| `native-plan-mode-disabled` | Native plan mode mounted, for showing the plan before acting | Harness | Implemented | Hard boundary | None | system | no | `preset/agent.cordis.yml` |
| `subagent-trimmed` | Native working tools are mounted (todo / subagents / workflow / ralph) | Harness | Implemented | Hard boundary | None | system | no | `preset/agent.cordis.yml` |
| `bash-deny-rules` | Bash deny rules | Harness | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js 危险命令匹配` |
| `protected-roots` | Protected roots the model cannot write | Harness | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js protectedRoots` |
| `git-ledger` | Removed: Append-only git ledger, always a side ledger (never the user's repo) | Harness | Removed | Deprecated | Authoritative | system | no | — |
| `kernel-panic-recovery` | Removed: read-only downgraded recovery after engine-level failure | Harness | Removed | Deprecated | None | model | no | — |
| `auto-continuation` | Removed: ClearAI-owned continuation window | Harness | Removed | Deprecated | None | system | no | — |
| `max-auto-turns` | Removed: ClearAI continuation round budget | Harness | Removed | Deprecated | None | system | no | — |
| `autonomy-config` | Removed: autonomy run tier | Harness | Removed | Deprecated | None | system | no | — |
| `runtime-card` | Per-turn runtime card | Harness | Implemented | Advisory | None | system | no | `ui/lib/fold.js renderCard` |
| `prompt-sections` | Prompt sections (3 defined / 3 in place) | Harness | Implemented | Advisory | None | system | no | `preset/plugins/prompts.js SECTIONS` |
| `exploration-zone` | Removed: the exploration zone as a named mode | Harness | Removed | Deprecated | Non-authoritative | model | no | — |
| `subrun-lifecycle` | Evaluator sub-run lifecycle (one-shot handle, recovery from the child log) | Harness | Implemented | Hard boundary | Authoritative | system | no | `preset/plugins/clearai-kernel.js dispatchSubRun` |
| `host-invariants` | Host-side invariants (five contracts, judged before the append) | Harness | Implemented | Hard boundary | Authoritative | system | yes | `ui/lib/invariant.js（五条契约 + 用生产折法 applyEvent 推进）` |
| `set-autonomy` | Removed: switching the run tier from the panel | Harness | Removed | Deprecated | None | human | no | — |
| `budget-tiers` | Removed: 6-round / 512-round budget tiers | Harness | Removed | Deprecated | None | system | no | — |
| `non-authoritative-isolation` | Non-authoritative paths cannot write the authoritative ledger | Harness | Implemented | Hard boundary | None | system | yes | `test/authority-boundary.test.mjs` |
| `ledger-exploration-snapshots` | Removed: Workspace snapshot at the turn boundary | Harness | Removed | Deprecated | Authoritative | system | no | — |
| `durable-dispatch-facts` | Dispatch facts land independently, before the first await | Harness | Implemented | Hard boundary | Authoritative | system | no | `preset/plugins/clearai-kernel.js landFact pendingFacts withPendingFacts` |
| `goal-complete-guard` | Guard: the native goal completes only through Conclude | Harness | Implemented | Hard boundary | Authoritative | system | yes | `preset/plugins/clearai-kernel.js update_goal` |
| `human-gate-actions` | Removed: human-gate action whitelist | Host | Removed | Deprecated | None | human | no | — |
| `context-pruning` | Context pruning and compaction, native to the host | Host | Implemented | Native | None | system | no | `preset/agent.cordis.yml compaction` |
| `model-routing` | Model routing and switching, host-native and not owned by ClearAI | Host | Implemented | Native | None | host | no | `宿主平面（ClearAI 未注册任何 provider/model 状态）` |
| `host-read-face-degradation` | Host read faces degrade to empty state instead of throwing | Host | Implemented | Hard boundary | Authoritative | system | no | `ui/lib/index.js sessionsOf` |
| `commands-menu` | Human `/` command menu | UX | Implemented | Native | None | human | no | `preset/agent.cordis.yml command-compact（唯一的命令行）` |
| `ontology-panel-graph` | Ontology panel: graph-first, read-only | UX | Implemented | Advisory | None | human | no | `ui/lib/client.js GraphBand GraphInspector Atlas conclusionsOf` |

## Detail

### `goal-set` · Frame: goal set and revision, attached to the native goal

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 Frame 并给出 claim / done_criteria / hypotheses
- **Input**: claim, done_criteria, hypotheses[], reason(修订时必带)
- **Output**: mutation goal/set;同时在宿主原生 goal 上建(或改)一条目标,由原生的目标驱动负责续跑
- **Blocks execution**: no
- **Native alternative**: dsh-tool-goal / dsh-command-goal(目标的续跑与展示)
- **Rationale**: 目标与判据必须在工作开始前落账,否则完成度无从派生。续跑交给原生 goal:ClearAI 只决定「什么算完成」,不再自己维护一套续跑窗口。
- **Code**: preset/plugins/clearai-kernel.js Frame; attachNativeGoal; ui/lib/fold.js case 'goal/set'
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/epistemic-loop.zh-CN.md

### `goal-close` · Conclude: goal close with independent evaluation

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 Conclude(outcome=achieved|abandoned)
- **Input**: outcome, note
- **Output**: mutation audit/dispatched + audit/settled + goal/closed + fact/promoted;achieved ⇒ 原生 goal 完成并声明交付物,abandoned ⇒ 原生 goal 置阻塞
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 结案不能由做的人自己宣布;achieved 必须过独立评估者的结构化裁决。原生 goal 只能经 Conclude 完成(见 goal-complete-guard)。
- **Code**: preset/plugins/clearai-kernel.js Conclude; syntheticStep; runEvaluator; completeNativeGoal; blockNativeGoal; declareDeliverables; ui/lib/fold.js case 'goal/closed'
- **Tests**: test/kernel.test.mjs · **Config**: l4RequiresHumanRelease, auditProvider, auditTimeoutMs, auditToolFilter
- **Prompt**: clearai/loop · **Docs**: docs/verification-loop.zh-CN.md

### `hypothesis-registry` · Hypothesis registry and derived state

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: Frame 登记 hypotheses；证据到位后由 fold 派生支持等级
- **Input**: claim, refute_when
- **Output**: 派生 supportedLevel / refutation 计数（不落第二本账）
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 假设状态由证据算出来，模型不能打分。首次立目标至少登记 2 条候选（preset 强制，0 条一样拦）：只有一个猜想，检验容易退化成找证据支持自己。
- **Code**: preset/plugins/clearai-kernel.js Frame hypotheses; ui/lib/fold.js case 'hypothesis/superseded'
- **Tests**: test/kernel.test.mjs · **Config**: minHypotheses（内核默认 0 = 机制中立；preset 立 2 = 产品立场，与 blockedThreshold 同一模式）
- **Prompt**: clearai/loop · **Docs**: docs/epistemic-loop.zh-CN.md

### `criteria-required` · Criteria-before-work enforcement

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: CreatePlan / RevisePlan(add) 校验步骤
- **Input**: steps[].done_criteria
- **Output**: 装配期拒绝：缺少判据、长度 < 4、或判据自指
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 没有判据就没有可失败的检验，独立评估也无从触发。
- **Code**: preset/plugins/clearai-kernel.js validateSteps; CreatePlan 调用点
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/epistemic-loop.zh-CN.md
- **Known mismatch**: 「每条进入系统的路径都校验判据」靠**测试**维持,不由类型保证:正常入口(`CreatePlan` / `RevisePlan(add)` 经 `validateSteps`)强制判据,而旧会话日志、内部构造的计划对象、以及将来新增的入口不受它约束。

### `formal-plan` · Formal plan

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 CreatePlan
- **Input**: brief, steps[{id, do, artifacts, done_criteria, tests?}]
- **Output**: mutation plan/created（confirmed_at 仅在审阅通过后非空）
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 步骤、产物声明与判据必须在执行前落账，完成度由此派生。
- **Code**: preset/plugins/clearai-kernel.js CreatePlan; MAX_PLAN_STEPS=25; ui/lib/fold.js case 'plan/created'
- **Tests**: test/kernel.test.mjs · **Config**: minBriefChars
- **Prompt**: clearai/loop · **Docs**: docs/epistemic-loop.zh-CN.md

### `plan-review` · Removed: plan review stamp

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: human
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: dsh-plan-mode 的审阅卡（ClearAI 借用原生审阅界面，不借账）
- **Rationale**: 计划授权记号删了(第三阶段):它从来不是门——未授权不挡推进,第一次交付就按事实补写。要人在动手前看计划,用原生 /plan(plan-mode 已挂上);ClearAI 不再另起一张审阅卡。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `plan-reauthorize` · Removed: re-present a plan for review

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: model
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 审阅记号删了,重新呈递也就没有对象。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `advance-plan` · AdvancePlan: the only completion verb

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 AdvancePlan 并携带交付声明
- **Input**: step_id, basis, results[](L0–L2:每条被检验的判断一个结果;L3+ 由评估者给)
- **Output**: mutation admission/checked + evidence/recorded(每条结果一条) + step/advanced(或拒收)
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 只有一个动词能推进循环,「谁推进了这一步」才永远可回答。完成与结果分开:交付成立 ⇒ 这一步完成,不论结果是支持、推翻还是说不清——推翻和说不清都是合法结果,不让交付失败。
- **Code**: preset/plugins/clearai-kernel.js AdvancePlan; SELF_JUDGE_MAX_INDEX 自判上限; ui/lib/fold.js case 'step/advanced'
- **Tests**: test/kernel.test.mjs · **Config**: blockedThreshold, l4RequiresHumanRelease, l4RejectSelfWritten
- **Prompt**: clearai/loop · **Docs**: docs/loop-philosophy.zh-CN.md

### `plan-amend-no-progress` · RevisePlan (add / refine / void) does not move progress

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 RevisePlan 的三种动作之一
- **Input**: 步骤增补 / 判据修订 / 作废理由
- **Output**: plan/amended, plan/refined, plan/voided（进度不变）
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 进度只由 AdvancePlan 改变，避免多入口推进导致的归属不清。改约只有一个入口(第四阶段把 AmendPlan / RefinePlan / VoidPlanStep 合并为 RevisePlan,各自的校验不变,变更事件名不变)。
- **Code**: preset/plugins/clearai-kernel.js RevisePlan; ui/lib/fold.js/323/330
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/loop-philosophy.zh-CN.md

### `admission` · Admission: intake only, never a verdict

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: AdvancePlan 交付时
- **Input**: 声明的 artifacts
- **Output**: 存在 / 非空 / 结构合法 → 收；否则计一次冲闸，达 blockedThreshold 置 blocked
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 准入回答「这份观测收不收」，不回答「它说明了什么」；不裁决才没有污染结论的问题。
- **Code**: preset/plugins/clearai-kernel.js admission; verdict_not_accepted; ui/lib/fold.js case 'audit/dispatched'
- **Tests**: test/kernel.test.mjs · **Config**: blockedThreshold
- **Prompt**: clearai/loop · **Docs**: docs/loop-philosophy.zh-CN.md

### `self-judge-limit` · Self-judgement capped at L2

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: AdvancePlan 携带 tests.level
- **Input**: level（L0–L4）
- **Output**: level > L2 且调用方自带 verdict → verdict_not_accepted
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 做的人不判自己；等级越高，越不能自证。
- **Code**: preset/plugins/clearai-kernel.js SELF_JUDGE_MAX_INDEX=2; ;
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/verification-loop.zh-CN.md

### `independent-evaluator` · Independent evaluator, fresh context, read-only face

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 准入判定 needs_audit（产物齐备且 done_criteria 非空）时的 L3+ 步骤
- **Input**: 只读产物 + 结构化输出 schema
- **Output**: mutation audit/settled，评估卡由系统落盘
- **Blocks execution**: yes
- **Native alternative**: dsh-subagent spawn（内核只借用宿主子代理后端）
- **Rationale**: 执行者不能成为结果的唯一裁判；spawn 而非 fork 才能保证判者与做者不共享历史。
- **Code**: preset/plugins/clearai-kernel.js runEvaluator / resolveToolFace / evaluatorPrompt / writeAuditCard; ui/lib/fold.js case audit/dispatched
- **Tests**: test/kernel.test.mjs · **Config**: auditProvider=spawn, auditTimeoutMs, auditToolFilter
- **Prompt**: clearai/loop · **Docs**: docs/verification-loop.zh-CN.md

### `l4-human-release` · L4 step/branch human release

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: human
- **Trigger**: L4 步骤交付
- **Input**: 交付那次调用当场问人(宿主 userQuestions)的答复
- **Output**: 人放行 ⇒ 落 human/released 再交评估者;不放行 / 没人能答 ⇒ 拒收
- **Blocks execution**: yes
- **Native alternative**: 宿主 userQuestions(原生提问卡)
- **Rationale**: L4 意味着高代价或不可逆,必须有人按的那一下。门在交付那次调用里当场开、当场关,不再挂在收件箱里等。范围是步骤轴——覆盖每一次评估的通用门另立一行(见 l4-universal-gate)。
- **Code**: preset/plugins/clearai-kernel.js l4Delivery; askHuman; ui/lib/fold.js case 'human/released'
- **Tests**: test/kernel.test.mjs · **Config**: l4RequiresHumanRelease=true, l4RejectSelfWritten=true
- **Prompt**: clearai/loop · **Docs**: docs/known-gaps.zh-CN.md

### `evidence-record` · Evidence recording

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 步骤推进时携带 basis / 来源
- **Input**: basis, refs[], origins[]
- **Output**: mutation evidence/recorded
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 结论必须能追到来源；证据可 supersede，不可删除。
- **Code**: preset/plugins/clearai-kernel.js buildEvidenceOrigins; ui/lib/fold.js case 'evidence/recorded'
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/epistemic-loop.zh-CN.md

### `fact-promotion` · Fact promotion

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 目标结案且假设达到 promote_at_level 且无推翻
- **Input**: goal, hypothesis, 评估者裁决
- **Output**: 写入 clear/knowledge/facts/<事实 id>.json(带升格那一刻用到的词条含义指纹 definitions)+ mutation fact/promoted
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 事实由系统按门槛算出来，模型不能宣称。
- **Code**: preset/plugins/clearai-kernel.js persistFact; promote_at_level 门槛; ui/lib/fold.js case 'fact/promoted'
- **Tests**: test/kernel.test.mjs · **Config**: l4RejectSelfWritten
- **Prompt**: clearai/loop · **Docs**: docs/epistemic-loop.zh-CN.md

### `history-retention` · Append-only history

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 任何状态变更
- **Output**: 推翻 / 作废 / 修订全部留痕
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 被推翻的假设是资产：它记录了此路不通。
- **Code**: ui/lib/fold.js（全体 case 无删除分支）; preset/plugins/clearai-kernel.js RevisePlan
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/loop-philosophy.zh-CN.md

### `worldline-fork` · Removed: Worldline fork with independent working copies

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 ForkPlan 且给出互斥分支与预注册指标
- **Input**: branches[], decide_by（尺子:量 = 口径 + 方向）
- **Output**: mutation fork/created, worldline/prepared, worldline/executing, worldline/executed, branch/delivered
- **Blocks execution**: no
- **Native alternative**: dsh-tool-subagent / dsh-tool-workflow
- **Rationale**: 「少即是多」第二阶段交还宿主:并行探索就是并行检验——竞争路线是竞争的假设,各由一个步骤检验,判据事先写好;并行交给原生子任务。代价是失去每条路线各自的文件副本,由「产物路径不重叠」兜住各自的产出。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `worldline-metric` · Removed: Pre-registered metric and arithmetic convergence

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: Authoritative · **Actor**: system
- **Trigger**: ConvergeFork
- **Input**: 各分支读数 + 预注册尺子
- **Output**: mutation fork/recommended（读数凑齐即落推荐，只记事实）；fork/converged；算不出来 → fork/undecidable，交人
- **Blocks execution**: yes
- **Native alternative**: dsh-tool-subagent / dsh-tool-workflow
- **Rationale**: 「少即是多」第二阶段交还宿主:「同一把尺子」就是事先写下的判据;两条读数是否可比交给独立评估者。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `worldline-adopt` · Removed: Worldline adoption is a human act

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: Authoritative · **Actor**: human
- **Trigger**: 人在面板上执行 adopt_branch / abandon_fork
- **Input**: fork id, branch id, reason
- **Output**: user 来源消息折进投影，写 by:'user'
- **Blocks execution**: no
- **Native alternative**: dsh-tool-subagent / dsh-tool-workflow
- **Rationale**: 「少即是多」第二阶段交还宿主:落选就是被推翻的假设;两条都成立而互相矛盾时作为冲突交给人,不再有单独的采纳动作。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `block-threshold` · Consecutive-block threshold, a quality gate

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 同一件事连续冲闸未过
- **Input**: 连续未过次数
- **Output**: 达阈值 → 计划置 blocked,当场问人(按缺口再改 / 作废这一步);没人能答 ⇒ 原生 goal 置阻塞(clearai-needs-human)
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 它是质量闸不是预算，因此不再按档取值。
- **Code**: preset/plugins/clearai-kernel.js blockedThreshold; escalateBlocked; ui/lib/fold.js case 'block/counted'
- **Tests**: test/kernel.test.mjs · **Config**: blockedThreshold=2（预设显式值）
- **Prompt**: clearai/loop · **Docs**: docs/loop-philosophy.zh-CN.md

### `human-gate-actions` · Removed: human-gate action whitelist

- **Layer**: Host · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: human
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: 原生 ask_user_question(开门的那次调用当场问人)
- **Rationale**: 面板写入口 /api/clearai/gate 第六阶段整条拿掉:本体编辑抽屉删了,要改词汇就在对话里说,模型用 Define / Deprecate 落同一本账;其余要人拍板的事第三阶段起由开门的那次调用当场问人。旧日志里人按过的动作仍由 fold.js 的 parseHumanGate 照旧折出来。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `single-loop` · Single-loop persona, no free multi-agent orchestration

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: model
- **Trigger**: 每回合的 persona 与身份、循环两段
- **Output**: 模型被要求以单一主循环推进
- **Blocks execution**: no
- **Native alternative**: dsh 原生 subagent / workflow / ralph（已随预设挂回(阶段 5;权威边界测试钉死它们产不出 clearai 变更)）
- **Rationale**: 子角色由系统按触发派生,避免自由委派把「自己派人判自己」重新引入。这是**偏好**(hardness=advisory):工作方式本身不设限,约束在权威账本那一侧。
- **Code**: preset/agent.cordis.yml persona; preset/plugins/prompts.js identity / loop
- **Tests**: test/prompt-sections.test.mjs（阶段 6 新增） · **Config**: —
- **Prompt**: clearai/identity, clearai/loop · **Docs**: docs/loop-philosophy.zh-CN.md

### `four-beats` · Four-beat rhythm

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: model
- **Trigger**: 每回合注入
- **Output**: 模型据四拍组织行为
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 七阶段在运行时的压缩表达。
- **Code**: preset/plugins/prompts.js loop; preset/agent.cordis.yml
- **Tests**: test/prompt-sections.test.mjs（阶段 6 新增） · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/loop-philosophy.zh-CN.md

### `scout-precommit` · Removed: Pre-commit reconnaissance

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: Authoritative · **Actor**: system
- **Trigger**: Frame 落定判据，且 input/ 有材料
- **Input**: brief
- **Output**: mutation scout/dispatched + scout/settled
- **Blocks execution**: no
- **Native alternative**: dsh-tool-subagent
- **Rationale**: 「少即是多」第二阶段交还宿主:立约前要查资料,模型自己读,或派原生子任务只读去查。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `map-scouts` · Removed: Parallel scouting with caps

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: Non-authoritative · **Actor**: model
- **Trigger**: 模型调用 MapScouts
- **Input**: 任务清单
- **Output**: 多个只读子 run 的结论
- **Blocks execution**: no
- **Native alternative**: dsh-tool-subagent / dsh-tool-workflow
- **Rationale**: 「少即是多」第二阶段交还宿主:并行侦察由原生子任务承担。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `evaluator-readonly-face` · Evaluator read-only tool face

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 派遣评估者时
- **Input**: 候选工具名
- **Output**: 按部署实际工具注册表过滤；未知工具名 fail-closed
- **Blocks execution**: yes
- **Native alternative**: dsh-subagent 的 tools.restrict
- **Rationale**: 判的人不能改产物。
- **Code**: preset/plugins/clearai-kernel.js resolveToolFace; auditToolFilter
- **Tests**: test/kernel.test.mjs · **Config**: auditToolFilter=[read,glob,grep,read_image]
- **Prompt**: clearai/loop · **Docs**: docs/verification-loop.zh-CN.md

### `executor-tool-face` · Removed: Worldline executor face, no plan/goal verbs

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 派遣世界线执行者时
- **Input**: 候选工具名
- **Output**: 任务书即计划；执行者工具面里根本没有 CreatePlan/AdvancePlan/ClosePlan
- **Blocks execution**: yes
- **Native alternative**: dsh-tool-subagent
- **Rationale**: 「少即是多」第二阶段交还宿主:世界线执行者随世界线一起删除。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `tool-trimming` · Tool face trimmed by the contribution table

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 装配期
- **Input**: 贡献表
- **Output**: unknown_mechanism / unknown_tool / tool_of_disabled_mechanism 等装配期抛错
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 装了哪些工具是清单事实，不是散落在代码里的既成事实。
- **Code**: preset/plugins/clearai-kernel.js MECHANISM_TOOLS; resolveContributions; ctx.tools.register
- **Tests**: test/kernel.test.mjs · **Config**: contributions.{mechanisms,tools,sections}
- **Prompt**: — · **Docs**: docs/loop-philosophy.zh-CN.md

### `native-todo-disabled` · Native working tools (todo/subagent/workflow/ralph) mounted

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Output**: 四件原生工作方式在工具面里
- **Blocks execution**: no
- **Native alternative**: dsh-tool-todo（standard 预设挂载）
- **Rationale**: 工作方式交还原生:它们产不出一条 clearai 变更(权威边界测试钉死)。便签不是账本,进度永远以 AdvancePlan 落账为准。
- **Code**: preset/agent.cordis.yml 工作方式段
- **Tests**: test/preset-composition.test.mjs（阶段 5 新增） · **Config**: —
- **Prompt**: — · **Docs**: preset/agent.cordis.yml

### `native-goal-disabled` · Native goal tool and command mounted; the goal layer sits on the native goal

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Output**: tool-goal / command-goal 在面里;原生 goal 只能经 Conclude 完成
- **Blocks execution**: no
- **Native alternative**: dsh-tool-goal / dsh-command-goal
- **Rationale**: 第三阶段起不再是两本账:原生 goal 是续跑与展示,ClearAI 的目标账决定「什么算完成」。Frame 建原生目标,Conclude 完成或置阻塞,守卫拦住直接完成。
- **Code**: preset/agent.cordis.yml
- **Tests**: test/preset-composition.test.mjs（阶段 5 新增） · **Config**: —
- **Prompt**: — · **Docs**: preset/agent.cordis.yml

### `native-plan-mode-disabled` · Native plan mode mounted, for showing the plan before acting

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Output**: plan-mode 在面里
- **Blocks execution**: no
- **Native alternative**: dsh-plan-mode
- **Rationale**: plan-mode 管「动手前给人看」,CreatePlan/AdvancePlan 管「每一步凭什么算完成」——两件事,不是两套纪律。ClearAI 删了自己的审阅卡,交给原生。
- **Code**: preset/agent.cordis.yml
- **Tests**: test/preset-composition.test.mjs（阶段 5 新增） · **Config**: —
- **Prompt**: — · **Docs**: preset/agent.cordis.yml

### `subagent-trimmed` · Native working tools are mounted (todo / subagents / workflow / ralph)

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Output**: tool-subagent / tool-subagent-control / tool-workflow / tool-ralph 均不在面里
- **Blocks execution**: no
- **Native alternative**: dsh-tool-subagent / dsh-tool-workflow / dsh-tool-ralph
- **Rationale**: 自由委派会重新引入「自己派一个来判自己」。现在按**分层**处理:工作方式交还原生、产物停在非权威区;权威账本仍只能由主线过准入与唯一完成动词写入(见 authority-boundary 套件)。
- **Code**: preset/agent.cordis.yml
- **Tests**: test/preset-composition.test.mjs（阶段 5 新增） · **Config**: —
- **Prompt**: clearai/loop · **Docs**: preset/agent.cordis.yml

### `bash-deny-rules` · Bash deny rules

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 每次 bash 工具调用前
- **Input**: command 字符串
- **Output**: kind:'deny' + reason
- **Blocks execution**: yes
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
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 事实与评估卡只能由系统落盘。
- **Code**: preset/plugins/clearai-kernel.js protectedRoots; touchesProtected
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/identity · **Docs**: docs/design-principles.zh-CN.md

### `git-ledger` · Removed: Append-only git ledger, always a side ledger (never the user's repo)

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 步骤交付点 / 文件历史查询 / 恢复
- **Input**: 路径或交付点
- **Output**: mutation git/committed, git/restored, git/snapshot
- **Blocks execution**: no
- **Native alternative**: dsh-workspace-changes
- **Rationale**: 「少即是多」第二阶段交还宿主:文件改动历史由宿主的 workspace-changes 显示;不再维护自己的 git 账本,也不提供恢复(已接受的代价)。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `kernel-panic-recovery` · Removed: read-only downgraded recovery after engine-level failure

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: model
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 第五阶段随提示词收成三段删掉:它只由提示词承载(内核与宿主都没有对应的硬约束),细则是宿主异常类型的处置,属于宿主。身份段留下一句通用纪律:结局不明的操作先看当前事实,再谈重试。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `auto-continuation` · Removed: ClearAI-owned continuation window

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: system
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: dsh-goal-round-driver 执行轮数上限
- **Rationale**: 续跑交给原生 goal(第三阶段):ClearAI 不再自己布防 / 按住 / 收兵一个续跑窗口。要人的时候由开门的调用当场问;没人能答就把原生 goal 置阻塞,续跑自然停。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `max-auto-turns` · Removed: ClearAI continuation round budget

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: system
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: dsh-goal-round-driver
- **Rationale**: 续跑轮数上限归原生 goal 自己的缺省(maxGoalRounds),ClearAI 不再另设一个数。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `autonomy-config` · Removed: autonomy run tier

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: system
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 运行档删了(第三阶段):它剩下的唯一作用是挑两套澄清措辞之一,而「要不要人」本来就由门表达。澄清协议只剩一段。旧日志里人门消息形式的 `set_autonomy` 标记不再折进状态。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `runtime-card` · Per-turn runtime card

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: system
- **Trigger**: 状态变化时随回合注入
- **Input**: 派生状态
- **Output**: 一段状态卡文本
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 让模型每回合看到当前真实状态,而不是依赖记忆;仅在状态变化时注入以保持前缀稳定。卡里用的是人话,不出现账本字段名(`plan_confirmation_pending` / `confirmed_at`)或宿主 id。
- **Code**: ui/lib/fold.js renderCard; preset/plugins/clearai-kernel.js pluginNotice
- **Tests**: test/kernel.test.mjs, test/host.test.mjs · **Config**: runtimeCard=true
- **Prompt**: clearai/identity · **Docs**: docs/loop-philosophy.zh-CN.md

### `prompt-sections` · Prompt sections (3 defined / 3 in place)

- **Layer**: Harness · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: system
- **Trigger**: 装配期
- **Input**: 段清单
- **Output**: 系统提示词段集合
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 提示词解释行为,但按 P1 不是执行边界。第五阶段收成三段:身份(native)、循环(hard)、对人说话(advisory),每段的分类由 `test/prompt-sections.test.mjs` 与内容咬合。每个工具怎么用写在工具自己的说明里,现在是什么状态由运行态卡给。
- **Code**: preset/plugins/prompts.js SECTIONS; preset/plugins/clearai-kernel.js systemPrompt
- **Tests**: test/prompt-sections.test.mjs（阶段 6 新增） · **Config**: contributions.sections
- **Prompt**: 自身 · **Docs**: docs/design-principles.zh-CN.md

### `context-pruning` · Context pruning and compaction, native to the host

- **Layer**: Host · **Status**: Implemented · **Strength**: Native · **Authority**: None · **Actor**: system
- **Trigger**: 工具结果超阈值 / 手动 /compact
- **Input**: 工具结果
- **Output**: 剪枝后的结果
- **Blocks execution**: no
- **Native alternative**: dsh-compaction-basic / dsh-command-compact（即原生本体）
- **Rationale**: 上下文是受控资源；执行它的本来就是原生，ClearAI 只做装配声明。
- **Code**: preset/agent.cordis.yml compaction
- **Tests**: test/client.test.mjs（装配） · **Config**: thresholdChars=8192, headChars=4096, tailChars=1024
- **Prompt**: — · **Docs**: docs/loop-philosophy.zh-CN.md

### `skill-candidate` · Removed: Skills default to candidate until a human promotes them

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 SaveSkill
- **Input**: name, description, 正文
- **Output**: clear/skills/<name>/SKILL.md，status=candidate；人 promote_skill 后才 modelInvocable
- **Blocks execution**: no
- **Native alternative**: dsh-skill-filesystem / dsh-tool-skill
- **Rationale**: 「少即是多」第二阶段交还宿主:技能走原生技能目录与 skill 工具,不再自带候选技能与采纳动作。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `memory-write` · Removed: Memory write with field contract and title dedup

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 WriteMemory
- **Input**: lesson 的五字段 / fact 的四字段
- **Output**: clear/memory/**；按标题跨文件去重
- **Blocks execution**: no
- **Native alternative**: dsh-agent-instructions
- **Rationale**: 「少即是多」第二阶段交还宿主:已确立的结论就是长期记忆(本体);项目说明走原生 PROJECT.md。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `model-routing` · Model routing and switching, host-native and not owned by ClearAI

- **Layer**: Host · **Status**: Implemented · **Strength**: Native · **Authority**: None · **Actor**: host
- **Trigger**: 宿主原生入口
- **Blocks execution**: no
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
- **Blocks execution**: no
- **Native alternative**: dsh-commands 注册表
- **Rationale**: 菜单是 DSH 原生的人类命令通道。ClearAI 不再贡献自己的命令(第二阶段删除了 `/goal` `/plan` `/evidence` `/worldline` `/plan-review`):状态看界面,`/goal` 与 `/plan` 由原生接管。
- **Code**: preset/agent.cordis.yml command-compact（唯一的命令行）
- **Tests**: test/preset-composition.test.mjs · **Config**: —
- **Prompt**: — · **Docs**: —

### `exploration-zone` · Removed: the exploration zone as a named mode

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: Non-authoritative · **Actor**: model
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: dsh-tool-todo / dsh-tool-subagent
- **Rationale**: 这个名字底下其实捆了三件事,而它们的状态各不相同:**结构性隔离**(非权威路径写不进权威账本)是一条真机制,已实现并由边界套件钉住,现在有自己的一行;**「工作不设限」**是原生工具挂回之后的既成事实,不需要额外机制;**「一块可以自由停留的区域」**是措辞——把它做成机制等于拿劝告冒充机制(P1),做成界面又只是给同一件事起两个名字。所以它作为**概念**注销,而「探索期产出有据可查」这件事另有落点:回合边界的账本快照。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/epistemic-loop.zh-CN.md

### `subrun-lifecycle` · Evaluator sub-run lifecycle (one-shot handle, recovery from the child log)

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 内核派独立评估者
- **Input**: 人格 + 任务书 + 只读工具面 + 结构化输出 schema
- **Output**: audit/settled(结论取回或如实落 unknown)
- **Blocks execution**: no
- **Native alternative**: subagents.start()（原生一次性句柄）——不借用可续跑与结算通知：通知是 best-effort，不能当账本的承重结构
- **Rationale**: 子任务的生命周期由内核掌握,但**结束与存活的权威是宿主**:`subagents.listChildren` 与 `subagent/end`。宿主说已结束 ⇒ **先从子会话自己的日志取回**,取不回才如实落 unknown,理由写清(`ended_uncollected` ≠ `lost`)。结算只报事实不给建议:要不要重试是计划层的决定。
- **Code**: preset/plugins/clearai-kernel.js dispatchSubRun; sweepEndedAudits; recoverVerdictFromChildSession
- **Tests**: test/kernel.test.mjs（裁决落结算事实 / 先取回再落 unknown） · **Config**: auditProvider=spawn, auditTimeoutMs
- **Prompt**: clearai/loop · **Docs**: docs/optimization/e2e-longruns.zh-CN.md

### `host-invariants` · Host-side invariants (five contracts, judged before the append)

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 任何一条 clearai 事实要落进会话日志之前（宿主 internal/dispatch 那一拍）
- **Input**: 会话事件里的 clearai 变更（插件消息的 clearai/mutations 段、工具结果的 meta.mutations）
- **Output**: 违反时抛宿主 InvariantError（归属 clearai-dsh）；通过则什么都不做
- **Blocks execution**: yes
- **Native alternative**: @deepseek-ai/dsh-invariants（宿主自己的包级不变量注册表；不另造一套自检）
- **Rationale**: 把这五条契约交给宿主的包级不变量注册表（`register(packageName, installer)`，违反时抛带稳定错误码与归属包名的 `InvariantError`），判在宿主的 `internal/dispatch` 那一拍——**不合法的事实根本进不了日志**。**范围与代价，照实说**：①它是诊断面，**随包的 web/headless profile 并不挂这个服务**（宿主自己的开发组合才挂），所以它在用户那儿不生效；②它**不再自己折一套索引**——状态用生产折法（`fold.js` 的 `applyEvent`）推进，本文件只留五条契约与一个 admitted 累积，形状解释代码已删（见权威归属 §二④）；③已经发生的运行失败**必须允许入账**——"只允许好看的事实进入账本"是把一致性做成了不实陈述。
- **Code**: ui/lib/invariant.js（五条契约 + 用生产折法 applyEvent 推进）; ui/lib/index.js（有 invariants 服务就注册）; tools/e2e-run.mjs（长测里挂上服务）
- **Tests**: test/invariant.test.mjs（合法放行 / 每条契约的违反 / 落账之前拦下 / 伪步骤不误伤） · **Config**: 宿主 invariants 的 enabled / package_allowlist / package_blocklist
- **Prompt**: — · **Docs**: docs/release-verification.zh-CN.md

### `l4-universal-gate` · A universal L4 gate over every evaluation

- **Layer**: Epistemic · **Status**: Design only · **Strength**: Advisory · **Authority**: None · **Actor**: human
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: **不实现是一个决定,不是待办**:门要加在「正确答案取决于人」的地方。每一次评估都上门,等于把非承重的取舍塞给人——那正是这套设计反复要避免的。L4 的门挂在**等级**上(步骤/分支轴),见 l4-human-release。
- **Destination**: stays design-only
- **Code**: docs/known-gaps.md
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/known-gaps.md

### `verification-lifecycle` · Verification lifecycle: which guarantees are live

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: system
- **Trigger**: 拿不到裁决 / 判不了交付成不成立
- **Output**: block/counted ⇒ plan/blocked ⇒ 当场问人
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 文档里那台验证机是设计记录;它真正承诺的保证都有落点:①结果永远不来时不再无声重试——拿不到裁决、判不了交付成不成立,与准入没过共用同一个连拦计数,到阈值就当场问人;②「说不清」是合法的空结果,不是失败:交付成立的那一步照常完成,判断保持原状。等级只决定谁来判,以及 L4 要人放行;「从没走过的等级」这条读数第四阶段删了。
- **Code**: preset/plugins/clearai-kernel.js countBlock; docs/verification-loop.md
- **Tests**: test/kernel.test.mjs(拿不到裁决计数 / 说不清也是完成 / 跳级理由整套删除); test/ontology.test.mjs(状态表逐行有落点) · **Config**: —
- **Prompt**: — · **Docs**: docs/verification-loop.md

### `fact-retraction` · Fact retraction by human decision

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: human
- **Trigger**: 推翻证据碰到已确立的事实 ⇒ 落账的那次交付当场问人「撤回」还是「维持原事实」
- **Input**: 事实 id + 缘由(可空)
- **Output**: mutation fact/reviewed;事实文件追加一行;没人能答 ⇒ 事实标着待复核,原生 goal 置阻塞
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 事实带边界(scope):边界被触发时要有一个人能把它撤回,而撤回永不自动——数据自己也可能错,所以「判证据不可靠、维持原事实」同样是一次要落账的决定。两种结局都落 fact/reviewed,撤回是终态:记录留着、不再作为「已知」被引用。
- **Code**: preset/plugins/clearai-kernel.js reviewRefutedFacts; markFactReviewed; ui/lib/fold.js case 'fact/reviewed'; preset/plugins/ontology.js VERIFICATION_LOOP
- **Tests**: test/kernel.test.mjs(当场问人 / 两个结局 / 旧日志兼容) · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/verification-loop.zh-CN.md

### `observation-provenance` · Observation provenance: declared sources vs producers

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 交付时登记观测(主线或世界线)
- **Input**: ref + note
- **Output**: mutation observation/recorded（source 只有 self 与 scout）
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 类型的职责是**只声明今天真的可表示的东西**:内核只写过 `self`(主线/世界线的交付)与 `scout`(侦察),所以 `source` 只声明这两个。一个取值要存在,必须同时有**生产者**与**消费它的决策**——否则它就是类型里的一句假话(声明了「有种观测来自人上传」,而那条路不存在)。`test/ontology.test.mjs` 现在把声明的取值集合与内核真的写过的集合**逐一对齐**:将来真接上一个人上传入口,那条断言会红,那时回来把取值加进声明。
- **Code**: preset/plugins/ontology.js VERIFICATION_LOOP; preset/plugins/clearai-kernel.js buildEvidenceOrigins; ui/lib/fold.js case 'observation/recorded'
- **Tests**: test/kernel.test.mjs; test/ontology.test.mjs（声明取值与生产者逐一对齐） · **Config**: —
- **Prompt**: — · **Docs**: docs/verification-loop.md

### `set-autonomy` · Removed: switching the run tier from the panel

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: human
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 「要不要人在场」是**运行时状态**,不是面板上的一个开关:有事要拍板就有门开着,没门就继续跑。那个档位还顺手把「计划经人确认」变成系统自己签的——用门代替开关之后,它没有存在的理由。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/known-gaps.md

### `budget-tiers` · Removed: 6-round / 512-round budget tiers

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: system
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 轮数是**保险丝**,不是用户的档位。原先两档把「我在不在场」变成了配置项,还把「计划经人确认」变成系统自己签的。现在只有一个默认值(128),由**原生**的 round driver 执行上限。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/known-gaps.md

### `plan-auto-confirm` · Removed: unattended plans auto-confirmed themselves

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: system
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 让系统替人签「这份计划经人确认」,那条证据就是系统自己伪造的——与 L4「人放行」是同一类病。门的意义在于「这一下是人按的」,所以 `confirmed_by` 只剩 `user` 与 `progress`。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/known-gaps.md

### `non-authoritative-isolation` · Non-authoritative paths cannot write the authoritative ledger

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: None · **Actor**: system
- **Trigger**: 模型用 todo / 子代理 / workflow / ralph / 模型切换干活
- **Output**: 没有任何 `clearai` 变更
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 这是把「工作方式」与「确认知识」解耦的那条**负向保证**:干活不设限,但干活的路径结构上产不出一条权威变更——权威账本只能由主线过观测准入与唯一完成动词写入。它是「探索可以自由、事实必须严格」这句话里**承重**的那一半,所以它有一行。
- **Code**: test/authority-boundary.test.mjs; ui/lib/fold.js LEGACY_GATE_ACTIONS
- **Tests**: test/authority-boundary.test.mjs（14 项） · **Config**: —
- **Prompt**: — · **Docs**: docs/loop-philosophy.zh-CN.md

### `ledger-exploration-snapshots` · Removed: Workspace snapshot at the turn boundary

- **Layer**: Harness · **Status**: Removed · **Strength**: Deprecated · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 本会话调用过会改工作区的工具(write/edit/bash/pwsh),且工作区真的脏
- **Output**: 一次账本提交 + mutation git/snapshot（只留台账）
- **Blocks execution**: no
- **Native alternative**: dsh-workspace-changes
- **Rationale**: 「少即是多」第二阶段交还宿主:回合边界快照随账本一起删除;每轮改了什么看宿主的改动卡片。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `ontology-lexicon-events` · Domain vocabulary events fold into state.lexicon

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 账本里出现 ontology/term_added、ontology/predicate_added、*_revised、*_deprecated 六类事件之一
- **Input**: 变更记录 {t, id, label, gloss, aliases, parent, range, functional, reason, basis}
- **Output**: state.lexicon：概念表 / 谓词表 / 修订史 / 废止表
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 词汇是项目的语言层：接纳要带依据、修订留痕、废止是黏性终态且没有删除。折法只解释事件，校验发生在落账之前。
- **Code**: ui/lib/domain-language.js applyLexiconMutation; ui/lib/fold.js case 'ontology/term_added'
- **Tests**: test/domain-language.test.mjs · **Config**: —
- **Prompt**: — · **Docs**: docs/domain-ontology.zh-CN.md

### `assertion-validation` · Assertion shape validation (before anything lands)

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 为一条假设登记断言（不提供放行；提供即严校）
- **Input**: assertions[{predicate, subject, object, qualifiers?}] 与当前词汇
- **Output**: 问题清单（空 = 通过）；不通过则调用方拒收
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 引用不存在的谓词、值域不符或同一事实自相矛盾，必须在进账本之前被拒——先污染后治理不适用于知识库。
- **Code**: ui/lib/domain-language.js validateAssertions
- **Tests**: test/domain-language.test.mjs · **Config**: —
- **Prompt**: — · **Docs**: docs/domain-ontology.zh-CN.md

### `conflict-derivation` · Conflict derivation (surfaced, never adjudicated)

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 两条未撤回的已确认事实落在同一单值谓词、同一主体、而客体不同
- **Input**: 事实集（含断言与复核态）与词汇（谓词的 functional 声明）
- **Output**: derive().conflicts：成对读数（谓词 · 主体 · 两侧事实与取值）
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 同一单值谓词上的两个取值是一处必须看得见的不一致；但谁为真不是系统能裁的——它只报，不撤回任何一侧、也不进闸门。
- **Code**: ui/lib/domain-language.js deriveConflicts; ui/lib/fold.js deriveConflicts(factRows
- **Tests**: test/domain-language.test.mjs · **Config**: —
- **Prompt**: — · **Docs**: docs/domain-ontology.zh-CN.md

### `graph-projection` · Ontology and entity graph projection (deterministic layout)

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 每次投影（view() 计算读面时）
- **Input**: state.lexicon 与 state.facts 与 state.entities 与 state.entityAssertions
- **Output**: {nodes, edges, bounds}：本体层（概念 / is_a / 谓词）与实体层（实例 / 断言，边带 source=promoted|asserted），节点带确定性坐标
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 图是最自然的表现形式，但它是投影而不是存储：同一账本必得同一张图，坐标、缩放与筛选都不进账本。
- **Code**: ui/lib/domain-language.js graphProjection; ui/lib/fold.js graphProjection
- **Tests**: test/domain-language.test.mjs · **Config**: —
- **Prompt**: — · **Docs**: docs/domain-ontology.zh-CN.md

### `ontology-verbs` · Named verbs for the domain vocabulary, and the shelf

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调用 Define(不带 range 是概念,带 range 是谓词;同 id 再定义即修订)/ Deprecate
- **Input**: id / label / gloss / aliases / parent / domain / range / functional / basis / reason
- **Output**: mutation ontology/term_added（predicate_added / *_revised / *_deprecated 同理）+ clear/ontology/domain.md 重铺
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 词条只能经具名动词落账（判据经宿主 facade 与折法同源）；货架由系统幂等渲染，是读面不是权威。没有删除：修订留版本、废止留缘由且黏性，语义变化必须换 id——同 id 再定义只许改名字、释义、别名。第四阶段把六个写入口合并成 Define / Deprecate、删掉只读的 QueryKnowledge(知识预检已把相关已知送进运行态卡),变更事件名不变。
- **Code**: preset/plugins/clearai-kernel.js Define; preset/plugins/clearai-kernel.js Deprecate; preset/plugins/clearai-kernel.js ensureDomainShelf; ui/lib/fold.js case 'ontology/term_added'
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/domain-ontology.zh-CN.md

### `ontology-panel-graph` · Ontology panel: graph-first, read-only

- **Layer**: UX · **Status**: Implemented · **Strength**: Advisory · **Authority**: None · **Actor**: human
- **Trigger**: 人打开中栏「本体」
- **Input**: 会话投影 clearai(view)与 GET /api/clearai/inspector
- **Output**: 本体图 / 实体图、按可信度分组的结论(已验证 / 待核验 / 验证中 / 不确定 / 已推翻 / 已替换)、点开一条的进度 → 可信度怎么变的 → 补充、节点小卡
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 第六阶段:面板只读,图是主角。词条增删改的抽屉与 /api/clearai/gate 一起删了——它是模型工具之外的第二个写入口,而人要改词汇在对话里说一句就够。界面用词与运行态卡同一套,内部编号不上屏。
- **Code**: ui/lib/client.js GraphBand GraphInspector Atlas conclusionsOf; ui/lib/fold.js trustHistory inspectGraphSelection
- **Tests**: test/client.test.mjs(本体格:图、结论分组、三段展开、节点小卡) · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `entity-registration` · Entity registration (instances as a first-class write path)

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调 RegisterInstance
- **Input**: {id, type, label, basis, provenance:{kind,ref}}
- **Output**: entity/registered 变更 → state.entities[]（实体图节点，带出处）
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 概念是约定（不要依据），实例是观测（必须带出处）。把实体层绑在目标级裁决上时，"本体写得好、实体图是空的"会变成最省力的完成方式。
- **Code**: preset/plugins/clearai-kernel.js RegisterInstance; ui/lib/domain-language.js validateTerm; ui/lib/fold.js applyMutations
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: preset/plugins/prompts.js clearai/loop · **Docs**: docs/domain-ontology.zh-CN.md

### `entity-assertion` · Entity assertion (edge holds on record)

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: 模型调 Assert
- **Input**: {subject:{id,type}, predicate, object, evidence:{kind,ref}}
- **Output**: entity/asserted 变更 → state.entityAssertions[]；投影里 kind='assertion'、source='asserted' 的边
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 边在观测那一刻成立，与"独立裁决后才升格"的事实边并存但可区分（promoted 带等级与边界，asserted 带出处）。
- **Code**: preset/plugins/clearai-kernel.js Assert; ui/lib/domain-language.js graphProjection; ui/lib/fold.js applyMutations
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: preset/plugins/prompts.js clearai/loop · **Docs**: docs/domain-ontology.zh-CN.md

### `entity-gate` · Entity gate (the only structural gate at Conclude)

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: Conclude(achieved),知识模式下,在派评估者之前
- **Input**: 将要升格的判断(达门槛、无推翻)的断言主体
- **Output**: 有主体不是实体图节点 ⇒ 拒(entities_unlanded),点名判断与主体;否则放行去独立评估
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 「本体写得漂亮、实体图是空的」是最容易交付出来的假完成。门只看将要升格的判断:没到门槛的不是结论,只有散文的判断只在卡上列成缺口、不拦。判据是主体是不是图上的节点,不是有没有边——边由升格本身落下,不再要求另用 Assert 把同一句话说一遍。第四阶段把关口从三道收到这一道。
- **Code**: preset/plugins/clearai-kernel.js Conclude; ui/lib/fold.js subjectsOffGraph
- **Tests**: test/kernel.test.mjs(实体门); test/contrast.test.mjs(B 组) · **Config**: requireLandedEntities
- **Prompt**: preset/plugins/prompts.js clearai/loop · **Docs**: docs/less-is-more-plan.zh-CN.md

### `level-skip-reason` · Removed: level skips need a named reason

- **Layer**: Epistemic · **Status**: Removed · **Strength**: Deprecated · **Authority**: None · **Actor**: model
- **Trigger**: —
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 第四阶段整套删除(ExplainLevelSkip、level/skipped、untouchedLevels、levels_skipped 缺口与 requireLevelReasons 门):第三阶段重跑里它让小任务结案时多被拦一次、多写一段理由,而等级的职责只有两件——谁来判,以及 L4 要人放行。旧日志里的 level/skipped 安静跳过。
- **Destination**: deleted and accounted
- **Code**: —
- **Tests**: — · **Config**: —
- **Prompt**: — · **Docs**: docs/less-is-more-plan.zh-CN.md

### `criteria-revision-gate` · Criterion revisions need an independent verdict

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: model
- **Trigger**: Frame 修订且 done_criteria 文本变了
- **Input**: criteria_verdict = 一份已落定独立裁决的 auditKey
- **Output**: criteria/revised 变更 → goal.criteriaHistory[]；无裁决则拒（criteria_verdict_required）
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 判据是"怎样算完成"，它一变前面所有工作的验收含义跟着变；允许在同一次调用里顺手改掉，等于允许把"做不到"重新定义成"做到了"。
- **Code**: preset/plugins/clearai-kernel.js Frame; ui/lib/fold.js applyMutations
- **Tests**: test/kernel.test.mjs · **Config**: requireCriteriaVerdict
- **Prompt**: preset/plugins/prompts.js clearai/loop · **Docs**: docs/epistemic-loop.zh-CN.md

### `durable-dispatch-facts` · Dispatch facts land independently, before the first await

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 派评估者（audit/dispatched）或派侦察（scout/dispatched）时
- **Input**: sessionId + 一条已经发生的事实（派发动作本身,不依赖子任务返回什么）
- **Output**: pendingFacts 里一条待落账事实：本拍的 pre-step 兜底落账（drainPendingFacts）,同一个工具结果的 mutations 里也并进同一条（withPendingFacts,pending 在前、按 id 去重）
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 事实寄存在「工具成功返回」这个易失载体上时,一次已经算完的评审会随栈帧消失：子代理是异步的,工具进了 await 之后进程可能被 abort、宿主服务可能瞬态不可得,而那批 mutations 还没落账——`turnDemand` 的「有裁决在飞 ⇒ hold」不触发,`sweepEndedAudits` 看不见,账上没有这一笔。模型这一侧只会原样重试,于是同一份评审按分钟计地重烧,而每次都可能同样丢。所以「派发」这类事实在 await 之前写进独立通道,两条通道同源同形,宿主那一侧只有一个折法。
- **Code**: preset/plugins/clearai-kernel.js landFact pendingFacts withPendingFacts
- **Tests**: test/kernel.test.mjs（派遣事实立刻落账,不随工具结果的成败起落）; test/contrast.test.mjs（结构判据:第一次 await 之前就有独立落账调用） · **Config**: —
- **Prompt**: — · **Docs**: docs/optimization/2026-09-diagnosis.zh-CN.md

### `audit-digest-reuse` · Verdicts are reused by material digest (same state, no re-dispatch)

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 同一状态再次结案（Conclude / 证据审计）,算出来的 digest 与上一次相同
- **Input**: 裁决种类 + 步 id + 目标修订号 + 计划步与产物 + 观测 + 原始假设 + 已升格事实 + 非审计来源证据 + 准入坐标里的产物
- **Output**: 复用那条已经落定的裁决（verdict ∈ support/refute/inconclusive）并落一条 audit/reused,不再派评估者;材料一变 digest 就变,必然重派
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: digest 只盖材料,所以「重试一次就重烧两三分钟」这件事在机制上不可能发生。一次不确定的结案自己会落一条证据（anchor='auditor'）:把证据集合整个算进 digest,每重试一次 digest 就变一次,复用永远命中不了——而两次之间模型什么都没改,那不是新证据,是同一条评审自己的回声。派生读数（supportedLevel / refutations / inconclusive）同理被排除:它们由证据算出来,算进去等于把回声再算一遍。只有落定过、且真的给出了裁决的那一条才可复用:unknown 不是裁决,它说明那一次没成,正是该重派的理由。
- **Code**: preset/plugins/clearai-kernel.js auditDigest; preset/plugins/clearai-kernel.js reuseAudit pendingAudits
- **Tests**: test/kernel.test.mjs（状态逐字未变 ⇒ 第二次结案复用旧裁决,账上留 audit/reused） · **Config**: —
- **Prompt**: — · **Docs**: docs/optimization/state-machines.zh-CN.md

### `host-read-face-degradation` · Host read faces degrade to empty state instead of throwing

- **Layer**: Host · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 宿主读面取不到服务（取 sessions / sessionProjections 回 undefined,或取服务时抛错）
- **Input**: 服务名 + 会话 id；内核那一侧再吃宿主交出的观测 {id, scope, detail, at}
- **Output**: ①读面返回空态（emptyState）而不是异常;②宿主半把降级记成观测,id 由**内容**算出来（scope + detail ⇒ hostHealthId,同一条只记一次,封顶 20 条）;③内核在 pre-step 把还没上账的那几条落成 host/inactive 变更（landedHostHealth 挡重复）;④折法按 id 幂等折进 state.hostHealth[],宿主半只把还没上账的本地那几条随 state() / view() 合并交出——同一条事实在账上一条、读数上也一条
- **Blocks execution**: no
- **Native alternative**: Cordis 的方法式取服务 ctx.get(name)（取不到只回 undefined;属性式访问在 fiber 非 ACTIVE 时当场抛 cannot get required service in inactive context）
- **Rationale**: 「这一刻读不到」与「世上没有这件事」在界面上长得一模一样:降级抛出去会把一次跑了几分钟的评审整个作废,静默给 undefined 又会让空读数被读成「世上没有这件事」。所以读面一律走方法式取服务、取不到返回空态,并把降级这件事本身记成可观测的事实。只记在进程内还不够——**重启、换进程、离线复判都读不到它**,而这恰恰是最需要事后解释的一条;所以内核在 pre-step 把它落成账本事实,幂等靠内容寻址的 id,而不是靠「记得别写两次」。
- **Code**: ui/lib/index.js sessionsOf; ui/lib/index.js projectionsOf; ui/lib/index.js hostHealth hostHealthId; preset/plugins/clearai-kernel.js landedHostHealth; ui/lib/fold.js case 'host/inactive'
- **Tests**: test/host.test.mjs（A1/A6:降级不抛、给的就是空态、两个服务各一条健康事实、view() 同源）; test/kernel.test.mjs（pre-step 把观测落成 host/inactive,同一条反复观察只落一条）; test/contrast.test.mjs（属性式服务访问清零） · **Config**: —
- **Prompt**: — · **Docs**: docs/optimization/state-machines.zh-CN.md

### `workspace-files-sync` · Workspace file sync (accumulated facts and ontology live in files)

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 每个 pre-step(子会话除外)
- **Input**: clear/knowledge/facts/*.json 与 clear/ontology/{concepts,relations,entities}/**.json 的当前内容
- **Output**: 变了的文件连内容一起落成一条 workspace/synced,折进 state.workspace.files;派生的事实行合并别的会话的事实(foreign),并给出 definitionsChanged 与「待处理」里的复核提示
- **Blocks execution**: no
- **Native alternative**: none
- **Rationale**: 会话账本只活在一次会话里,而研究要跨会话攒下来。文件是唯一跨会话活着的东西;把它的变化落进账本,投影仍然只吃账本,重放读到的是那一刻的文件。
- **Code**: preset/plugins/clearai-kernel.js syncWorkspace listWorkspaceFiles readWorkspaceFile; ui/lib/fold.js case 'workspace/synced'; ui/lib/fold.js derive factRows; ui/lib/domain-language.js factFromFile changedDefinitions
- **Tests**: test/kernel.test.mjs(跨会话:另一个会话升格的事实在这里也是已知;定义改了要复核) · **Config**: —
- **Prompt**: — · **Docs**: docs/optimization/state-machines.zh-CN.md

### `artifact-path-exclusive` · Exclusive artifact paths (no two steps in a plan declare the same artefact)

- **Layer**: Epistemic · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: CreatePlan / RevisePlan(add)
- **Input**: 步骤的 artifacts
- **Output**: 撞上已有步骤(作废的不算)的产物路径即拒
- **Blocks execution**: yes
- **Native alternative**: none
- **Rationale**: 并行探索交给原生子任务,而原生子任务共用一个工作目录;没有这一条,两条并行的路线会互相覆盖产出,准入收下的就不一定是那一步自己做出来的东西。
- **Code**: preset/plugins/clearai-kernel.js validateSteps; normalizePath
- **Tests**: test/kernel.test.mjs（产物路径不重叠） · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/verification-loop.zh-CN.md

### `goal-complete-guard` · Guard: the native goal completes only through Conclude

- **Layer**: Harness · **Status**: Implemented · **Strength**: Hard boundary · **Authority**: Authoritative · **Actor**: system
- **Trigger**: 模型调用原生 update_goal(action=complete),而 ClearAI 目标还开着
- **Input**: 原生工具调用参数
- **Output**: tools/pre-execute 拒绝,理由指向 Conclude
- **Blocks execution**: yes
- **Native alternative**: dsh-tool-goal
- **Rationale**: 原生 goal 挂上之后,完成有两条路;只留经过独立评估的那条,目标就仍然只有一个完成动词。
- **Code**: preset/plugins/clearai-kernel.js update_goal; Conclude
- **Tests**: test/kernel.test.mjs · **Config**: —
- **Prompt**: clearai/loop · **Docs**: docs/less-is-more-plan.zh-CN.md

---

Generated: this file and `truth-table.zh-CN.md` both come from `truth-table.json`; equivalent content, two languages.
