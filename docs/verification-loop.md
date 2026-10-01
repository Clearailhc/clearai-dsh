# Verification Loop: Objects, Levels, Flow and Terms

> **Being rebuilt.** This document describes the target design from the ["less is more" plan](less-is-more-plan.zh-CN.md). Code follows in phases; what has landed is tracked in [Known Gaps](known-gaps.md).

How a judgement becomes a fact you can safely cite. This document defines the objects, levels, flow and vocabulary; other documents, prompts and code comments defer to it.

## 1. The principle

A conclusion is trustworthy if and only if it survived a test that could have made it fail, and it states where it stops holding.

The system does not supply the tests — that is domain knowledge, from the researcher and the model. The system guarantees the shape of the loop: criteria are written before the work, the doer does not judge their own work, and results are recorded as they happened.

## 2. Objects

| Object | What it is | Must carry | Who may change it |
|---|---|---|---|
| Goal | The question to answer | Criteria (what counts as answered) | Text and continuation belong to the host's native goal; criteria are attached by `Frame`, and changing them needs an independent verdict |
| Hypothesis | A judgement to test (the UI calls it a "judgement") | A one-line claim; what result would refute it | Proposed and revised by the model via `Frame`; status computed by the system |
| Verification | A step that tests one hypothesis | Which hypothesis; level; criteria | Registered by the model; step state changed by the system |
| Observation | The artefacts and execution record a step delivers | Content; source | Append-only |
| Evaluation | A verdict from comparing observations against the registered criteria | Which criteria; which observations; who judged | By level: the doer, or an independent evaluator |
| Evidence | The result of an evaluation | Supports / refutes / inconclusive; level; references | Never edited; re-evaluation produces new evidence |
| Fact | A hypothesis promoted once evidence suffices | Scope; level; evidence; optional assertions | Promoted by the system; a human may retract it |

- A **step** is the unit of execution. It tests at most one hypothesis; a step that tests none is ordinary work and produces no evidence.
- A **conclusion** answers the goal, assembled from facts in the report to the person; it cites facts and has no state of its own.
- **Hypotheses belong to the project.** Established facts stay in the workspace across sessions and are retrieved by concept next time.

## 3. Levels

A level decides two things only: **who judges**, and **that L4 needs a human release**. It follows from three properties: is the evidence existing or newly produced; can it be re-run with the same result; can a machine judge it.

| Level | Definition | Who judges | Accepted observations |
|---|---|---|---|
| L0 | A quick plausibility check by reasoning | The doer, with a reviewable basis | Derivations, calculations |
| L1 | Existing knowledge: literature, databases | The doer, with a reviewable basis | Citations |
| L2 | Existing data or small computation | The doer, with a reviewable basis | Data, scripts and output |
| L3 | New, reproducible evidence | An independent evaluator, or a machine | The doer's output, which must be re-runnable |
| L4 | New evidence that cannot be repeated or comes from outside | An independent evaluator, after a human release | Files the doer wrote do not count |

A machine evaluator (proof checker, test, statistics script) counts as independent at every level. What the five levels mean in a given field lives in project skills; the engine knows only the five abstract levels.

| Level | Mathematics | Physics | Life sciences |
|---|---|---|---|
| L0 | Small cases, magnitude, edge cases | Dimensions, limits, conservation | Dose ranges, pathway plausibility |
| L1 | Already proved or refuted in the literature | Literature, handbook data | Literature, public databases |
| L2 | Numerical checks, symbolic computation | Re-analysis of existing data | Re-analysis of existing omics data |
| L3 | Systematic counterexample search, machine-checked proof | Numerical simulation | Computational models, new analysis of public data |
| L4 | Peer review | Experiments, facility time | Wet lab, clinical |

## 4. Flow: from question to fact

```
Human     Model                      System                      Independent evaluator
 │ ask ──▶ │ native goal + Frame: criteria, hypotheses (each with a refutation condition)
 │         │ CreatePlan: step = work + artefact + criteria [+ which hypothesis, level]
 │  ┌ each ┤ do the work
 │  │      │ AdvancePlan ──────────▶ │ admission: exists, non-empty, well-formed
 │◀─┼──────┼── L4: asks the human to release
 │  │      │                         │ L0–L2: record self-judged evidence
 │  │      │                         │ L3+: dispatch evaluator ─▶ │ reads artefacts and record only
 │  │      │                         │ ◀──────── evaluation card ─┤
 │  │      │ ◀── accepted / blocked (what is missing)  record evidence, compute hypothesis status
 │◀─┴──────┼── blocked repeatedly: asks the human
 │         │ Conclude ─────────────▶ │ dispatch evaluator on goal criteria ─▶ │
 │         │                         │ ◀──────── evaluation card ─┤
 │         │                         │ pass: complete native goal, promote facts, declare deliverables
 │◀────────┼── refuting evidence hits a promoted fact: asks the human to retract or keep
```

A human appears in three places: asking the question; the gates that need a person (L4 release, repeated blocks, a fact meeting counter-evidence), asked directly by the call that opened them; and at any time through `/goal` or the native UI to pause or end the goal — a human ending the goal establishes nothing.

## 5. State

All state is folded from the session log; the model has no writable state field.

**Goal**: phase belongs to the native goal (active / paused / blocked / complete). ClearAI adds one derived note: criteria not written yet, or the closing evaluation is running.

**Hypothesis**:

| State | Enters when | Leaves when |
|---|---|---|
| proposed | Claim and refutation condition are written | First evidence → alive |
| alive | From proposed | Threshold reached → confirmed; refuting evidence → refuted; rewritten → superseded |
| confirmed (a fact) | At close, threshold reached and nothing refutes it | A human retracts it → retracted |
| refuted (kept) | Refuting evidence at any level | Terminal |
| superseded | Old version when a hypothesis is revised | Terminal |
| retracted (kept) | A human decides after review | Terminal |

**Step**: `open → advanced` or `open → void` (voiding needs a reason). A downgrade cannot be expressed: there is no "reject and redo" path.

**Verification** — derived, not stored. These nine names were once the design of a stored state machine; none of them is stored. Each is either a recorded fact, computed by `derive()`, or unrepresentable on purpose:

| State | Meaning | Where it lives today |
|---|---|---|
| planned | Draft criteria | Unrepresentable by design: `CreatePlan` rejects steps without criteria, so they are never stored |
| registered | Criteria registered | The step itself — `tests: {hypothesis, level}` plus criteria; `plan/created` is the moment of registration |
| authorized | A human released it (L4 only) | Not a state: a release fact (`human/released`) recorded when `AdvancePlan` asks the person |
| submitted | Running | Derived: the step is open; `inFlight` marks the delivery in progress |
| awaiting | Waiting for a result | The child's own facts: `audit/dispatched` |
| observed | Result received | `observation/recorded`, registered on delivery |
| evaluated | Evaluated, evidence written | `audit/settled` + `evidence/recorded`; `derive()` computes support / refute / inconclusive per hypothesis |
| expired | No result in time | Not a state: `audit/settled` with verdict `unknown`, sharing the block counter (`block/counted`) |
| aborted | Stopped without a result | Facts, not a state: a void with a reason (`VoidPlanStep`, reached through `RevisePlan`), or the child's recorded stop reason |

**Fact**: new refuting evidence only **flags** it for review and asks the human on the spot; retract and keep both land the same review record. Data from outside can be wrong too, so nothing is retracted automatically.

## 6. Rules and where they live

| Rule | Mechanism |
|---|---|
| Criteria before work | `CreatePlan` rejects missing or too-short criteria; `RevisePlan` keeps old versions; changing goal criteria needs an independent verdict |
| A step cannot declare itself done | `AdvancePlan` is the only completing action; tools have no writable state fields |
| Admission only accepts or rejects | Artefact exists, is non-empty, well-formed; no judgement of what it shows |
| The doer does not judge their own work | L3+ rejects caller-supplied verdicts and dispatches an independent evaluator (read-only, fresh context, structured output) |
| L4 needs a human release | `AdvancePlan` asks the human when delivering an L4 step; files the doer wrote do not count as L4 observations |
| Stop for a human after repeated blocks | At the threshold, `AdvancePlan` asks the human; revising criteria or changing approach releases it |
| Completing a goal needs independent evaluation | Only `Conclude` completes the native goal; a guard rejects the model completing it directly |
| Nothing is deleted | Refuted hypotheses, rejected artefacts, retracted facts all remain; the session log is append-only |
| A human's decision is never relayed by the model | Gates ask the human from kernel code; the answer returns in-process |
| No answerer, no decision on the human's behalf | The gate stays open; the native goal is set to blocked with the reason |

## 7. Vocabulary

Use the left column across the repository. UI and reports use the plain words in the third column; internal names do not change.

| Term | Code identifier | Plain word in the UI | Deprecated |
|---|---|---|---|
| Goal | native goal; `Frame` / `Conclude` | question | — |
| Hypothesis | `hypotheses[]` | judgement | conjecture, proposition (as an object name) |
| Criteria | `done_criteria` | what counts as done / wrong | acceptance criteria |
| Observation | artefact files + execution record | what was delivered | exhibit |
| Admission | `admission()` | accepted / blocked | evidence gate |
| Evaluator | `agent_role=evaluator` | independent review | auditor, judge |
| Evaluation card | `clear/evidence/audits/` | review record | audit card |
| Evidence | `evidence[]` | why | — |
| Fact | `fact/promoted` | a conclusion you can trust | confirmed conclusion |
| Level | `L0`–`L4` (upper case) | strength of the test | — |
| Promotion threshold | `promote_at_level` | — | acceptance threshold |

## 8. Relation to the domain ontology

This document is the **process**: rules of knowing, versioned with the plugin, not editable at runtime. The [domain ontology](domain-ontology.md) is the **language**: the project's vocabulary and the graph it grows, governed by named verbs. They meet in exactly four places: assertion shape checked when a hypothesis is registered, fixed at promotion, conflicts derived on replay, and new assertions refused after deprecation.
