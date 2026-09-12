# Verification ontology: objects, lifecycle, and terms

How a conjecture becomes a fact that can be cited with confidence. This document defines the six objects in the system, their levels and states, the full flow from goal to fact, and the terminology used across the repository. When other documents, prompts, or code comments refer to these concepts, this document's names are authoritative.

> **Implementation status (code is the source of truth)**
>
> This document mixes two kinds of content: **behaviour that is implemented** and **design targets that are not**. Read it through this box.
>
> **This document is the authoritative source for terms and concepts; what follows is which part of it this plugin actually implements.**
>
> The ontology is declared in `preset/plugins/ontology.js`, and the same validator checks it at assembly time: initial/terminal states, reachability, and level-prefix monotonicity. `test/ontology.test.mjs` then **cross-checks** the declaration against the implementation — every edge's declared `event_kind` must be one the fold genuinely recognises, every named guard must genuinely exist in the kernel, and the state vocabulary in the declaration must be the same set the fold uses. Declared but unwired fails immediately.
>
> **Wired**: the nine objects (goal / plan / step / hypothesis / observation / evaluation / evidence / fact / release) and the five levels L0–L4; the single completion verb `AdvancePlan`; the three admission checks (artifact exists, non-empty, structurally valid) plus `needs_audit`; independent-evaluator dispatch and evaluation-card persistence; **a per-step/per-branch L4 human release** (release reads the native approval record); fact promotion with scope and support level; arithmetic adjudication of worldlines and adoption-only convergence.
>
> **Not there yet** (same line as [Known gaps](known-gaps.md)):
>
> 1. **The eight-state verification machine** is designed, not implemented; only the subset above actually runs.
> 2. **`retracted` has no producer** — the state is defined in the ontology, and no code path writes it today.
> 3. **A universal L4 gate over every evaluation** is not implemented; the human release that exists hangs on the step/branch axis.
> 4. **Observation provenance has only ever been written as `self` and `scout`**; other origins exist in the type with no producer.
>
> **One easily misread fact**: a step's declared level only decides **who may write a verdict** (L0–L2 self-judged by the doer, L3 and above refusing self-judgment) and **the L4 human gate**. It does **not** drive evaluator dispatch. Dispatch is triggered by admission deciding `needs_audit` (declared artifacts complete **and** `done_criteria` non-empty). So a step at L3 or above without `done_criteria` takes the deterministic release exit and **never passes through independent evaluation**.

## 1. The one-line principle

A conclusion is trustworthy exactly when it has survived a test that could have failed it.

The system's job is to guarantee the shape of that loop: every conclusion is preceded by a test that can fail, the test is registered before it runs, and the result is recorded honestly. The system does not supply the test itself — that is domain knowledge, and it comes from the charter, the skill library, and the people doing the research.

## 2. The six objects

| Object | What it is | What it must carry | Who may change it |
|---|---|---|---|
| Hypothesis | A conjecture to be tested | A one-line claim; what result would refute it | The model proposes and revises; the system computes state |
| Verification | One concrete action taken to test a hypothesis | Which hypothesis; level; criteria | The model registers; the system changes state |
| Observation | Raw results obtained while verifying | Content; provenance (who, when, how it was produced) | Append-only, never modified |
| Evaluation | Comparing a registered criterion against observations to reach a verdict | Which criteria were used; which observations were read; who judged | The evaluator writes; doer and judge are separated by level |
| Evidence | The outcome of an evaluation | Support / refute / inconclusive; level; the observations and evaluation it cites | Written once, never changed; re-evaluation produces new evidence |
| Fact | A hypothesis promoted once evidence suffices | The list of evidence supporting it | The system promotes; a human may retract |

Example: hypothesis "catalyst A gives a higher yield than B at 60 °C", refutation condition "mean yield over three repeats is not higher than B". The verification is "three repeated lab runs; a mean at least 5 points above B counts as support". The observation is the instrument's yield table plus who uploaded it. The evaluator reads the table and checks the mean difference. The evidence is "L4 · support · mean difference 6.2 points · based on observation #17". Evidence suffices, the hypothesis is promoted to a fact and written into the knowledge base.

Three common words are not listed separately:

- An experiment is simply a verification at a higher level. Numerical simulation, formal proof, lab work, and a production trial run are all verifications; only their level and cost differ.
- A conclusion is the final answer to the project's question, assembled from several facts in a report. It cites facts and needs no state of its own.
- A step is a unit of execution. A step carries at most one verification; a step that carries none is ordinary work and produces no evidence.

Hypotheses belong to the project and are shared across stages and sessions.

## 3. Levels

Levels are domain-independent and follow from three properties: whether the evidence already existed or was newly produced; whether an evaluator could re-run it and get the same result; and whether a machine can decide it.

| Level | Definition | Rough cost | Who judges | What observations count | Before starting |
|---|---|---|---|---|---|
| L0 | A quick plausibility check by reasoning alone | Minutes | The doer, with a reviewable basis | Calculations, derivations | Start immediately |
| L1 | Existing knowledge: whether the literature or a database has already answered or refuted it | Minutes | Same | Literature citations | Start immediately |
| L2 | Existing data or a small computation | Hours | Same | Data files, scripts and their output | Start immediately |
| L3 | Newly produced, reproducible evidence | Hours to days | An independent evaluator, or a machine | The doer's output; observations may be produced by the doer, but must be re-runnable | Register the criteria first |
| L4 | Newly produced, non-reproducible or externally sourced evidence | Days, or not repeatable | An independent evaluator, judging only against the registered criteria | Only human uploads, automatically landed files, and external pushes; files the doer wrote do not count | Register the criteria first; **human release hangs on the step/branch axis** (see the status box) |

A machine evaluator (a proof checker, a test, a statistics script) counts as an independent evaluator at any level: it compares the registered criteria against observations and writes evidence, with the same standing as an independent agent.

What the five levels mean in each domain is written in section 4 of the project charter and in the skill library; the engine only knows these five abstract levels. Three domains as examples:

| Level | Mathematics | Physics | Life sciences |
|---|---|---|---|
| L0 | Small-case substitution, parity, order of magnitude, boundary cases | Dimensions, limiting cases, symmetry, conservation laws | Dose ranges, whether known pathways make sense |
| L1 | Whether the literature has proved it or found a counterexample | Literature, handbook data | Literature, public databases |
| L2 | Numerical verification over some range, symbolic computation | Re-analysis of existing experimental data | Re-analysis of existing omics datasets |
| L3 | Systematic counterexample search, machine-checked formal proof | Numerical simulation, new computation | Computational simulation, new analysis of public data |
| L4 | Peer review, journal acceptance | Experiment, beam time at a large facility | Wet lab, animal study, clinical trial |

A production trial run in an engineering setting is what L4 is called there.

Where observations come from:

| Origin | How it happens | How the system knows | Provenance label |
|---|---|---|---|
| Produced by the doer | The agent runs a script in the workspace and artifacts land on disk | The event stream has the command, exit code and ledger commit | self |
| Uploaded by a human | Someone puts a result file into the project, or says so in conversation | An inbox item is completed, or a new file appears in the input directory | human_upload |
| Landed automatically by a file | An instrument or compute job writes results into an agreed directory | A directory check on a schedule | file_drop |
| Pushed by an external system | An external system pushes it in | The push carries a token dedicated to this verification | callback |
| Fetched by the system | At the appointed time the system calls an external API or reads a database | Woken on a schedule and pulled | pull |

L0 to L3 accept the first; L4 accepts only the last four.

## 4. Lifecycle: from goal to fact

Six segments. Each states what happens in the ontology, who does it, and which object and verb in the system it maps to.

### 4.1 Set the goal and hypotheses

A goal is the question the project must answer, with a statement of what would count as answering it. Hypotheses are registered under the goal: one line of claim plus a refutation condition each, at least two.

| Ontology | Who | System object and verb |
|---|---|---|
| Goal | A human gives it; the model transcribes the criteria | Goal; `SetGoal(done_criteria, phases, promote_at_level)` |
| Hypothesis proposed | The model | `SetGoal(hypotheses=[{claim, refute_when}])`, stored in the goal document's `hypotheses` |

### 4.2 Register the verification

One plan carries one stage of the goal. Steps in the plan may declare that they are a verification: which hypothesis, what level, what criteria. Criteria are written before the result appears — "write the criteria before doing the work". A step that declares nothing is ordinary work.

| Ontology | Who | System object and verb |
|---|---|---|
| Verification registered | The model | Step `tests: {hypothesis, level}` + `done_criteria`; `CreatePlan` / `AmendPlan` / `RefinePlan` |
| L4 release (**per step/branch**) | A human | Goes through `Confirm` (the goal mode's human gate); there is no level-wide release covering every evaluation |

### 4.3 Execute and produce observations

The model explores, writes scripts, computes. Every write enters the ledger; every execution leaves a command, exit code and commit in the event stream. Artifacts land in `lab/`. Nothing in this segment judges anything.

| Ontology | Who | System object |
|---|---|---|
| Observation (origin self) | The model | Artifact files + execution records in the event stream |
| Observation (external origin) | Humans, instruments, external systems | Input directories, inbox, timers, callback tokens |

### 4.4 Deliver, which is to send for evaluation

`AdvancePlan` is the only completion verb. It means "observed; please evaluate". The system first performs admission: the declared artifact exists, is non-empty, and is structurally valid. Admission only decides whether an observation is accepted, not what it means, so there is no contamination problem. Then the level decides who evaluates.

| Level | Who evaluates | How it goes in the system |
|---|---|---|
| L0 to L2 | The doer | `AdvancePlan(evidence, verdict, basis)`; the system records evidence with `evaluator=self` |
| L3 and above | An independent evaluator | The system dispatches an evaluator sub-run with a fresh context, read-only access to artifacts and execution records, producing an evaluation card; the system takes the verdict from the card and records evidence with `evaluator=independent`. **Note: dispatch is triggered by `needs_audit`, not by level** |

An evaluator does not execute. It compares the registered criteria against observations. To ask "would this reproduce in a clean environment", that is a new verification called reproduction, registered separately as L3.

### 4.5 Evidence returns to the hypothesis

Evidence is append-only and hangs on the goal document's `evidence` list, citing the step, the plan and the evaluation card. A hypothesis's state is computed from evidence, not scored: which level it passed, how many refutations, how many inconclusive results.

| Ontology | Who | System object |
|---|---|---|
| Evidence | Written by the system, content from self-judgment or an evaluation card | Goal document `evidence[]`; cards under `clear/evidence/audits/` |
| Hypothesis state | Computed by the system | `hypothesis_status`; shown both on the run card and in the task book's machine section |

### 4.6 Closing: promotion and settling

Closing a stage archives the plan; if the goal is not met the system wakes the model to open the next stage. When the goal closes, an evaluator checks the goal criteria and how faithfully they were transcribed; passing means achieved. A hypothesis that reached the promotion threshold with no refutation is promoted to a fact, written into the knowledge base under the system's identity; refuted hypotheses stay in the goal document.

| Ontology | Who | System object and verb |
|---|---|---|
| Goal achieved | An independent evaluator judges; the system closes | `CloseGoal` → goal evaluation → achieved |
| Fact | The system | `clear/knowledge/facts/<goal_id>.md` |
| Experience | The system | Skill statistics and memory |

### 4.7 Sequence

```
human        model (Goal)         system               evaluator          workspace/ledger
  │ goal ────▶│                    │                    │                  │
  │           │ SetGoal: criteria, hypotheses (each with a refutation condition) │
  │           │ CreatePlan: step = what to do + artifacts + criteria [+ tests]    │
  │           │──── auto-confirm ─▶│                    │                  │
  │  ┌─ each step ┼─────────────────┼────────────────────┼──────────────────┤
  │  │        │ execute ────────────────────────────────────────────────▶│ observations land, execution recorded
  │  │        │ AdvancePlan ──────▶│ admission (exists, structure)       │
  │  │        │                    │ L0–L2: record self-judged evidence ─▶│ goal document evidence
  │  │        │                    │ L3+: dispatch evaluator ───▶│ reads observations and records │
  │  │        │                    │◀── evaluation card ────────┤                  │
  │  │        │                    │ record independent evidence; converge or feed back gaps ──▶│
  │  │        │◀── gap / converged ┤                    │                  │
  │  └────────┼────────────────────┼────────────────────┼──────────────────┤
  │           │ ClosePlan ─────────────────────────────────────────────▶│ archive
  │           │◀── not met: open the next stage ┤                          │
  │           │ CloseGoal ────────▶│ dispatch goal evaluation ─▶│ check transcription, criteria one by one │
  │           │                    │◀── evaluation card ────────┤                  │
  │           │                    │ achieved: promote facts ──────────────▶│ clear/knowledge/facts
  │◀── Confirm (L4 release) / inbox (blocked, stalled) ┤                       │
```

A human appears in exactly three places: giving the goal at the start, the `Confirm` gate in the middle, and the inbox when a goal is blocked or stalled.

## 5. States

All states are changed by the system. The model makes requests through tools; humans decide through the inbox. Evidence has no state.

Goal: only one goal is open at a time within a run. A goal can be revised (`SetGoal` requires a reason; each revision bumps the version and the changed fields stay in the revision record; blueprint sections have stable identity, and rewritten sections are marked superseded rather than deleted). After a goal closes, the next human instruction forges a new goal and the old one goes to history. Which segment a goal is in is derived, never stored:

| Phase | Meaning | How it is decided |
|---|---|---|
| drafting | Criteria not yet written | `done_criteria` is empty |
| planning | Criteria exist, no plan opened yet | No active plan and no closed plan |
| confirming | A plan awaits authorization | An active plan is pending confirmation |
| executing | An active plan is advancing | The active plan wants a turn |
| waiting | The plan layer is waiting on a human or a worldline | The active plan does not want a turn |
| stage_boundary | The last stage closed, the next has not opened | The active plan is complete, or there is no active plan but there is a closed one |
| auditing | An evaluator is adjudicating the goal | audit.status = pending |
| stalled | The goal layer is stuck, waiting on a human | stalled.kind is non-empty |
| suspended | The goal is open but this is not goal mode | The run's execution mode is not goal |
| achieved / abandoned | Terminal | status |

Completion: with blueprint sections, = (closed sections + completed-step share of the current plan) / sections; without a blueprint, = confirmed hypotheses / valid hypotheses; if neither, no number is given. A section counts as closed when there is a closed plan under its name (`CreatePlan` stamps the plan's `phase_id`).

Hypotheses:

| State | Meaning | How it is entered | How it is left |
|---|---|---|---|
| proposed | Stated | Claim and refutation condition written | First evidence → alive |
| alive | Being verified | From proposed | Promotion threshold → confirmed; refuting evidence → refuted; rewritten → superseded |
| confirmed | Confirmed, becomes a fact | Project promotion threshold reached with no refutation | A human decides to retract → retracted |
| refuted | Refuted, record retained | Refuting evidence at any level | Terminal |
| superseded | Replaced by a new version | The old version when a hypothesis is revised | Terminal |
| retracted | Retracted, record retained | A human decides after review | Terminal |

Verification:

> **The table below is a design target; it is not implemented.** The code has no such state field or flow, and the values
> `registered`/`authorized`/`submitted`/`awaiting` do not exist. The entire machine representation of "one verification"
> today is `tests: {hypothesis, level}` on a step plus the point-in-time fact of `AdvancePlan`. The table is kept to record
> intent and terminology; do not infer runtime behaviour from it.

| State | Meaning | How it is entered | How it is left |
|---|---|---|---|
| planned | Criteria are a draft | On registration | Criteria written → registered |
| registered | Criteria registered | The system checks the previous level passed | L4 → authorized; L0 to L3 → submitted |
| authorized | A human released it; L4 only | A human releases it in the inbox | → submitted |
| submitted | Executing | The corresponding step starts | Needs to wait for an external result → awaiting; aborted without a result → aborted |
| awaiting | Waiting for a result | The action has been handed off | Result arrives from an eligible origin → observed; deadline passes → expired |
| observed | Result obtained | The observation was admitted | Evaluation completes → evaluated |
| evaluated | Evaluated, evidence written | The evaluator writes a verdict | Inconclusive returns to awaiting for one more try; a second inconclusive forces a change of hypothesis or criteria |
| expired | Deadline passed with no result | The deadline passed | Handed to a human |
| aborted | Stopped without a result | Deliberately stopped | Terminal |

L3 and above start at registered; changing criteria afterwards must leave a trace, keep the old version, and ask a human to confirm. Time spent waiting for a result does not count toward failure counts.

Observations: on arrival, origin is checked against the verification level. Eligible ones are admitted and wake the task; ineligible ones are kept but not accepted, and flagged in the inbox.

Facts: new refuting evidence only marks the fact and raises an inbox item. A human decides whether to retract it, or judges the evidence unreliable and leaves the fact alone. Data brought in from outside can itself be wrong, so retraction is never automatic.

## 6. Rules

The system checks these on state changes, not through prompts. A non-conforming operation is rejected and the reason returned to whoever initiated it.

1. One level at a time. To attempt a higher level, the previous level must already have supporting evidence. Skipping is allowed but must state a reason and is recorded.
2. Write the criteria before doing the work. Execution may not start until the criteria are registered. For L3 and above, changing them after registration keeps the old version and requires human confirmation.
3. L4 requires human release — **implemented on the step/branch axis**; a universal release covering every evaluation is not implemented (see the status box).
4. Look at the origin of a result. L3 observations may be produced by the doer but must be re-runnable. L4 observations must come from outside; files the doer wrote do not count.
5. The doer does not judge themselves. L3 and above evidence may only be written by a machine or an independent evaluator. L0 to L2 may be self-judged, and the basis must be reviewable.
6. Weight of refutation. One piece of refuting evidence carries its level by default. A project charter may declare "any counterexample is decisive", as mathematics projects usually do.
7. Nothing is deleted. Refuted hypotheses, rejected observations, retracted facts, and worldlines that were not chosen are all retained and inspectable.
8. Only the system changes state. Nobody can write a verdict directly.

## 7. Glossary

The whole repository uses the left column. The right column lists deprecated older names, which new documents, prompts and comments no longer use.

| Canonical | English | Code identifier | Deprecated older names |
|---|---|---|---|
| 目标 | Goal | `goal`, `SetGoal` / `CloseGoal` | 问题 (only when explaining what a goal answers) |
| 假设 | Hypothesis | goal document `hypotheses[]` | 猜想 (colloquial only) |
| 验证 | Verification | step `tests: {hypothesis, level}` | 验证步骤、实验步骤 |
| 判定标准 | Criteria | `done_criteria` (the code name stays) | 完成标准、验收判据、完成谓词 |
| 观测 | Observation | artifact files + execution records in the event stream | 产物、物证 |
| 观测准入 | Admission | the `l1` / `l2` layers of `check_step_evidence` | 证据门、证据闸门 |
| 评估者 | Evaluator | `agent_role=evaluator`; display label Evaluator | 审计员、裁判、评估子、审计子 |
| 评估卡 | Evaluation card | cards under `clear/evidence/audits/`, `lab/evaluations/` | 审计卡 |
| 证据 | Evidence | goal document `evidence[]` | distinct from a step's `step.evidence`, which is the convergence record |
| 收敛记录 | Convergence record | `step.evidence`, `converged_evidence` | 步骤证据 |
| 事实 | Fact | `clear/knowledge/facts/` | 已确认结论 |
| 等级 | Level | `L0` to `L4`, always uppercase | distinct from the admission layers `l1` / `l2`, always lowercase |
| 世界线 | Worldline | each branch of `ForkPlan` and its worktree | 分支 (only for "one of the worldlines") |
| 阶段 | Stage | one Plan | 计划 (still usable when referring to the object) |
| 升格门槛 | Promotion threshold | goal document `promote_at_level` | 验收门槛 |

## 8. Candidates for later

Everything below waits until a baseline has produced real trajectories; one line each.

- Reproduction as a registered L3 verification: an evaluator re-runs a delivered script in an independent worktree, and any mismatch refutes.
- A machine evaluator run by the system: a step declares a checking script and the system verifies against the ledger or runs it.
- L4 external observations: the four origins landing through one entry point, `interrupts` gaining `await` suspension, task state gaining `waiting`, and `scheduling` attaching to an existing goal.
- Criteria soft-lock: for L3 and above, changing criteria leaves a trace and asks a human to confirm.
- Refutation weight and the charter's "counterexamples are decisive" switch; section 4 of the charter becomes parsable.
- Evaluation verdicts enter skill statistics (`skill_lifecycle` gains `audit_pass` / `audit_fail`); goal-level experience (`policy_slots` gains `goal_finished`).
