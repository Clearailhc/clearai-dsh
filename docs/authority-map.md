# Authority Map

> **Being rebuilt.** This document describes the target design from the ["less is more" plan](less-is-more-plan.zh-CN.md).

One question: **who produces each fact, where it lives, and who consumes it.**

> Every fact has **one authoritative source**; each kind of failure is explained in **one place**; without evidence the system can **quietly say it does not know**.

It came from a self-diagnosis: after several rounds of fixes we were patching symptoms, and the root cause was **the same fact inferred twice** — the host already answered it and we inferred it again in an in-memory table. So this round's main move is subtraction: wherever the host is already authoritative, hand it back.

## 1. The map

| Fact | Authority | What ClearAI does |
|---|---|---|
| Goal text, continuation rounds, paused / blocked / complete | **Host**: native goal | Consumes it. Completes it only through `Conclude`; sets it blocked while a gate is open |
| Plan review (does the person approve this plan) | **Host**: plan mode | No separate review card |
| Whether a subtask is running and how it ended | **Host**: subagent service and `subagent/end` | Keeps only the business binding: which step's evaluation this child is |
| A person's answer to a question | **Host**: user-questions | The kernel asks itself, receives the answer in-process, records a review or release |
| Which files were handed to the person | **Host**: `deliverables/presented` in the session log | Written once by the kernel at close; anything else the model hands over goes through native `present` |
| What files changed each turn | **Host**: workspace-changes | No own ledger or snapshots; no restore |
| Skills, project instructions | **Host**: skill directory, `PROJECT.md` | No bundled skill templates or memory |
| Which judgement is tested; criteria committed in advance; which observation feeds which evaluation; supports / refutes / inconclusive; why a fact gains or loses citability | **ClearAI**: kernel events in the session log | The irreplaceable part. A task finishing ≠ a hypothesis holding; an evaluation failing ≠ a hypothesis refuted |
| Domain vocabulary, instances, assertions | **ClearAI**: `ontology/*`, `entity/*`, `fact/promoted.assertions` | Recorded only through named verbs |
| Conflicts, ontology graph, entity graph, progress, gaps | **Projection (derived)** | Computed every time, never stored |
| Shelves under `clear/` and the Ontology pane | **Rendering** | Not authoritative; rewritten idempotently, the UI is read-only |

## 2. Consequences

- **A parent turn ending proves only that the parent turn ended.** The child may still be running, or may have finished with its result uncollected; only the host reporting an end allows a conclusion. If the host cannot tell, the state is **unknown**, not dead.
- **If an evaluator ended but its result did not arrive, recover it from its own session log first**; only if that fails record "unknown", and keep "ended, uncollected" separate from "lost".
- **A failure that already happened must be recordable.** An evaluator crash or a failed card write is a fact; refusing to record it is itself a misstatement.
- **If two readings cannot be shown to share a measure, show the raw readings** and claim no ranking.

## 3. Block or diagnose

| Kind | Handling | Example |
|---|---|---|
| Illegal business operation | Rejected at the tool | The model completing the goal directly, delivering without criteria, self-judging at L3+ |
| Runtime failure that already happened | Must be recordable | Evaluator crash, interrupted subtask |
| Self-contradictory history | Diagnose, keep the original | A reference to a step that does not exist |
| Unprovable business judgement | Mark unknown, leave to the evaluator | Whether two readings are comparable |

## 4. Vocabulary boundaries

- **Vocabulary events advance no process object**, and process events never change the vocabulary; the two state machines do not nest.
- **Assertions land with a fact only at promotion**; instances and observed assertions land with provenance when observed.
- **Every arrow points to a read surface**; no read surface points back into the record.
