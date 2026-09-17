# Loop philosophy: the mechanism protects the fact boundary

This document answers one question: **why ClearAI looks the way it does**. Each principle is expected to land on a mechanism or a test in this repository; a principle with no such landing point is a preference, not a system guarantee.

---

## 0. The premise

> **Let the model make the intelligent judgment; let the system hold the fact boundary.**

This is not a division-of-labour slogan; it is an **interface definition**. It says what may be handed to probability and what must be handed to determinism:

- **Given to the model:** understanding material, proposing hypotheses, choosing a route, judging which evidence is more credible, deciding what to do next.
- **Not given to the model:** what counts as complete, what the state is, whether a fact may be written into the knowledge base, whether a write can be retracted, whose verdict is valid.

What the second group shares is this: **each has a correct answer, and that answer does not depend on who gives it.** Whenever that holds, the system computes it — because asking a model to *say* a fact that could have been *computed* downgrades certainty into probability.

A conclusion is trustworthy exactly when it has survived a test that could have failed it. The system does not supply the test; it **guarantees the shape of the loop**: every conclusion is preceded by a test that can fail, the test is registered before it runs, and the result is recorded honestly.

---

## 1. Five principles that land in mechanisms

### P1 · Mechanism over exhortation

**Behavioural constraints belong in mechanisms, not in prompt text.**

Prompts are probabilistic: write "do not run dangerous commands" ten times and it will still be bypassed at step 40 of some long context. Mechanisms are deterministic. So in this system, every important constraint should have a **landing point in code**:

| Constraint | Landing point |
|---|---|
| Dangerous commands cannot run | DSH tool governance rejects disallowed commands before execution; ClearAI's policy contribution takes part |
| Writes cannot interleave | Workspace writes are bounded by runtime governance and the ledger |
| Tools cannot escape the workspace | DSH workspace boundaries and the sandbox constrain paths |
| A conclusion cannot certify itself | The kernel separates doer from evaluator by level (`SELF_JUDGE_MAX_INDEX`) |
| A step cannot declare itself complete | `AdvancePlan` is the only completion verb, and it must deliver evidence |

**The test:** if a constraint exists only in prompt text with no mechanism behind it, it will eventually fail. Either add the mechanism or admit it is a preference. The [soul map](soul-map.md) applies exactly this test, marking which principles are enforced and which are still preferences.

### P2 · Unrepresentable over unviolable

Stronger than "we added a defence so it cannot go wrong" is "this mistake cannot be expressed at all".

Two instances:

- The rank of a plan step (`open/blocked=0 < advanced/void=1`) makes **downgrade unrepresentable** — there is no "reject and redo" edge, and rather than adding a defensive edge, the design does not offer the path.
- The fold pushes done / void / verified / adopted back down on write, making "a fact going backwards" **unrepresentable on the write side**.

### P3 · Separate fact from judgment: intent tools cannot assert facts

The model may **request**; it may not **declare**.

- A plan step's `status` and `loops` **do not accept a caller declaration** — the model cannot mark a step done, only deliver evidence and let the system advance it.
- A goal's phase (drafting/planning/executing/auditing/stalled…) and its completion are **entirely derived**, with no second ledger; `goal_id` and `phase_id` are written only on the plan side.
- A hypothesis's state is **computed** from evidence, not scored: which level it passed, how many refutations, how many inconclusive results.

The direct payoff: **the system's state can always be recomputed**, so it can never disagree with the facts. Any stored state is a potential lie.

### P4 · The doer does not judge itself

- Criteria are written **before the result appears**. `done_criteria` is enforced at the entry point and checked for self-reference (a criterion may not cite itself).
- L0–L2 allow self-judgment by the doer, but **the basis must be reviewable**; L3 and above refuse self-judgment outright (`verdict_not_accepted`).
- An independent evaluator reads the artifacts with fresh context and produces a structured evaluation card; the system lands the card, **never passing through the evaluated party**.

### P5 · Nothing is deleted

Refuted hypotheses, rejected observations, retracted facts, losing worldlines — all are kept and inspectable.

- Ledger history **only moves forward**: a restore is a new commit, not a rollback.
- A losing worldline is marked `pruned` and kept; **only the working copy is removed, the branch ref stays** — later re-judgment depends on it remaining readable.
- Goal revisions keep their version and reason (`SetGoal` requires a reason; superseded sections are marked, not deleted), and the goal document is **not cleared** when it closes.

A refuted hypothesis is a valuable asset: it records one road that did not work, and that is a real product of exploration.

---

## 2. Seven stages, four runtime beats

The Epistemic Loop unfolds into **seven stages**: Frame → Hypothesize → Plan → Observe → Verify → Evaluate → Record and act (see [The Epistemic Loop](epistemic-loop.md)).

At runtime these compress into **four beats**: plan → execute → observe → reflect. The four beats are not a second ontology; they are the operating rhythm of model and system working together. **One loop advances; there is no multi-agent orchestration** — the sub-roles (Scout / Executor / Evaluator) are derived by the harness from triggers, not freely delegated.

| Beat | Stages it covers | What the model does | What the system guarantees |
|---|---|---|---|
| **Plan** | Frame + Hypothesize + Plan | Decompose steps, write criteria | Fine-grained, executable, evidence-acceptable; `done_criteria` enforced; ≤25 steps; artifacts declared |
| **Execute** | Observe | Explore, write scripts, compute | Read-only work in parallel, writes serial; sandbox; every write lands in the ledger (a snapshot at each turn boundary, plus a commit at each delivery) |
| **Observe** | Verify | Receive results | **Admission only decides whether to accept, never what it means** |
| **Reflect** | Evaluate + Record and act | Deliver, converge, amend | `AdvancePlan` is the only completion verb; evaluation is separated by level; conclusions land with their bounds |

**"Admission does not judge" is the part of this design I have most confidence in.** Admission checks exactly three things — a declared artifact **exists**, is **non-empty**, and is **structurally valid**. It answers "do we accept this observation", not "what does this observation show". Because it does not judge, there is no "admission contaminates the conclusion" problem; judgment is left entirely to the evaluator in the next stage.

Across the four beats there is a **single-verb principle**: `AdvancePlan` is the only verb that advances; the other three (`AmendPlan` adds a step, `RefinePlan` changes criteria without touching progress, `VoidPlanStep` voids with a reason) never change progress. **Only one verb advances the loop**, which keeps "who advanced this step" permanently answerable.

---

## 3. Three lines of defence at the fact boundary

Safety does not rest on any single mechanism but on a three-stage relay:

```
before: deterministic gate in tool governance  →  during: sandbox + ledger  →  after: recoverable ledger + per-turn change strip
```

One deliberately counter-intuitive trade-off: **execution is unapproved by default**, on the grounds that "recovery afterwards replaces approval beforehand" — if every write can be restored precisely, the cost of blocking every write exceeds the friction it removes. The safety net therefore becomes three things: block **genuinely dangerous** actions (not all of them), guarantee the ledger is **recoverable**, and keep changes **visible** in the turn strip.

That trade-off holds only if the ledger is reliable enough, so the ledger's requirements are stricter than elsewhere: fixed identity, fixed HEAD, explicit exclusions, and a single failure that does not block the main flow but is never silently swallowed.

It also holds only if the ledger's **coverage starts at the first turn**: a snapshot is taken at each turn boundary in which this session wrote something, so the window in which execution is unapproved and unrestorable is not "everything before the first delivery".

---

## 4. The philosophy of failure

### One test: who wrote this data

Boundary normalisation is not "swallowing faults"; it is **letting each layer digest the errors of its own layer**:

- **provider / model parameters / external responses** → silently normalised at the entry boundary **with a counter kept**. Not echoed to the model (echoing only seeds behavioural drift in the context), not panicked (that promotes an external hiccup to the death of an entire run).
- **Our own serialised state, approval records, plan data, snapshots** → if these break, the ledger is broken; **never silent**.

Corollary: **untrusted input must not be promoted into the death of a run.**

### Three paths, strictly separated

| Layer | Symptom | Path |
|---|---|---|
| Ordinary tool error | `ok=false` + `failure_class` in the same turn | Continue; the model self-corrects |
| Provider failure | Normalised into a **typed fact** | Bounded backoff; if finally unavailable the run is `paused` and one "continue" resumes it in place |
| Engine-level unclassified exception | Promoted to an engine fault, **marked as possibly having committed effects** | Downgraded to a **read-only** recovery turn |

### When the effect is uncertain, observe first

Side-effecting tools are **at-most-once**; once past the dispatch boundary an unknown outcome is treated as "effect unknown". There is one semantics: **observe the current facts first, then talk about retrying**. The safety precondition for a retry is "knowing whether the last attempt actually happened", and under an unknown effect that precondition does not hold.

---

## 5. Context is a governed resource, not a cache

Three disciplines, each with a landing point in code:

1. **A stable prefix is a hard constraint, not an optimisation.** The tool projection order is frozen; the environment section **deliberately contains no time** (time differs on every call and would cost the prompt and all history after it their prefix cache); rendering of a given tool result has exactly **one definition**, so the live path, the replay path and the history-rebuild path produce **the same bytes**.
2. **Every byte ever sent to the model must be accounted for in the transcript.** The "recorded" and "observed" states of an event are strictly separated: facts about the **channel** are broadcast but never land in the transcript, because they are facts about the channel, not about the **work**.
3. **Injection must be bounded, with hard caps.** The run card is rebuilt each turn; the compaction threshold is configurable; observation content is paged.

Discipline 2 has a neat corollary: after an SSE reconnect there is **no backlog owed**. Anything that does not land in the ledger never took part in the resume cursor, so what a reconnect fetches is always a complete sequence of facts.

---

## 6. Engine and content decoupled

**ClearAI does not modify the DSH engine.** Three supports:

- The epistemic layer is added as **contributions** on DSH's composition surface: one host package, one agent preset, one client module.
- Behaviour enters the runtime through a **frozen preset and kernel contract**; when declaration and implementation disagree, assembly fails rather than silently reinterpreting bad data as a different set of permissions.
- The ontology declaration (`preset/plugins/ontology.js`) validates its shape **at assembly time** and is cross-checked against the fold by tests.

**A new behaviour = register a contribution (Tool / policy / prompt section) + one declaration line, never a new engine branch.**

Why is this discipline worth its complexity? Three concrete returns:

1. **Trimmable**: a different distribution is a different manifest (fewer or different plugins), not a code branch.
2. **Verifiable**: every invariant can run at assembly time instead of surfacing on some runtime branch.
3. **Replaceable**: swap out every prompt and role configuration and the engine code is untouched.

---

## 7. The real tensions in this philosophy

A philosophy document that lists only strengths is marketing. These tensions genuinely exist:

1. **Mechanism completeness ≠ implementation completeness.** The clearest case is the verification loop: the documents describe an eight-state machine for verification and an "L4 requires human release" rule, while the latter is not a universal gate over every evaluation (see the implementation status at the top of [Verification ontology](verification-loop.md)). Designed completeness is easily mistaken for running completeness.
2. **The evidence gate rests on criteria, not levels, so a missing criterion changes the gate's shape (partially tightened, 2026-09).** Dispatching an independent evaluator is triggered by `needs_audit` (artifacts complete **and** `done_criteria` non-empty) — the criterion is a **structural precondition** of that gate. The old wording was "a step at L3 or above without `done_criteria` takes the deterministic release exit and never passes through independent evaluation"; **the normal entry point now closes that**: `CreatePlan` calls `validateSteps`, which requires every step's `done_criteria` to be a string of at least 4 trimmed characters, or the whole call is refused (`preset/plugins/clearai-kernel.js:2405-2426`, called at `:2745`). The soft spot therefore now applies only to **legacy logs, internally constructed plan objects, and any entry point added later** — it is an entry-point-consistency problem, no longer a "users may omit criteria" problem. The residual philosophical risk is that it still assumes **every path into the system** validates criteria, and that assumption is held by tests rather than by the type system.
3. **Nothing mechanically checks that documents match the implementation.** This repository has repeatedly shipped "the mechanism changed but the docs, comments or prompts did not" (the auto-confirm branch for plan authorization was deleted, the continuation budget moved from 6/512 to 128, `set_autonomy` was removed — while comments and prompts kept describing the old semantics). The fix is to turn it into executable checks: the [mechanism truth table](optimization/truth-table.md) (`node tools/verify-truth-table.mjs`), the state-machine document (`node test/state-machine.test.mjs`), and a banned-phrase scan over the docs. **Wherever those checks do not reach, drift is still possible.**
4. **Complexity and test density do not match.** The more complete the mechanism, the more tests are needed to show the mechanism is actually in effect — otherwise "a constraint that landed in a mechanism" and "a constraint believed to have landed in a mechanism" look identical in code. Current coverage lives in `test/`; known gaps are recorded in [Known gaps](known-gaps.md).
5. **Unrepresentability costs money.** Every "make it unrepresentable" moves complexity from runtime to assembly time or the type layer. In a small system that may not pay off — this design accepts the cost because it bets correctness on determinism.
6. **The vocabulary layer is convention and the fact layer is experience; conflating them turns "we decided to call it this" into "this is how things are".** The [domain ontology](domain-ontology.md) makes knowledge comparable and conflicts detectable, and the price is that it carries authority of its own — once a term is cited as fact, arguing against that conclusion starts to look like arguing against the whole vocabulary. Three mechanisms hold that in check: entries are admitted **with a basis**, deprecation is **sticky** (there is no delete), and a semantic change must **take a new id**; and conflicts are **surfaced, never adjudicated** — the vocabulary can tell you two assertions contradict each other, never which one is right.

---

## 8. In one sentence

**Leave the uncertainty to the model and collect the certainty into mechanisms; whatever can be computed should not be spoken; whatever can be recovered need not be blocked in advance.**

That is the whole intent of this loop.
