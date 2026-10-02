# Loop Philosophy: Let Mechanisms Hold the Fact Boundary

> **Being rebuilt.** This document describes the target design from the ["less is more" plan](less-is-more-plan.zh-CN.md).

This document answers: **why ClearAI looks the way it does**. Every principle should land in a mechanism or a test; one that does not is only a preference.

---

## 0. The thesis

> **Let the model make the intelligent judgements; let the system hold the fact boundary.**

This is an interface definition:

- **Given to the model**: understanding material, proposing judgements, choosing a route, weighing evidence, deciding what to do next.
- **Not given to the model**: what counts as done, what the current state is, whether a fact may enter knowledge, whose verdict counts.

Questions of the second kind have a correct answer that does not depend on who answers. Wherever that holds, the system computes it — asking the model to *say* something that could be computed downgrades certainty to probability.

**Origin.** The biggest risk of doing research with AI is not failing to answer but answering too smoothly: what is known, guessed and invented all come out in the same voice, people cannot tell which sentence to trust, and the next session starts from zero. Epistemology answers "why can I trust this sentence"; ontology answers "what do these conclusions add up to".

**The scaffold principle.** Models keep getting stronger. ClearAI supplies only what a model cannot and should not do for itself; the rest goes to the model or to the host. So this version's main move is subtraction: nothing the host already has gets a second copy, and the prompt keeps only the skeleton.

---

## 1. Six principles that live in mechanisms

### P1 · Mechanism over exhortation

Prompts are probabilistic: write "do not declare completion yourself" ten times and step 40 of a long context will still get around it. Mechanisms are deterministic.

| Constraint | Mechanism |
|---|---|
| A goal cannot declare itself complete | A guard rejects the model completing the native goal; only `Conclude` completes it, after independent evaluation |
| A step cannot declare itself done | `AdvancePlan` is the only completing action, and it requires the artefact |
| A conclusion cannot certify itself | Doer and judge are separated from L3 up |
| A human's decision cannot be relayed | The kernel asks the person directly; the answer does not pass through the model |
| Dangerous commands, leaving the workspace | The host's tool governance, sandbox and permission presets |

**Test**: a constraint that lives only in a prompt will fail eventually. Either add a mechanism or admit it is a preference.

### P2 · Unrepresentable beats forbidden

Stronger than "we defend against this error" is "this error cannot be written": step rank makes a downgrade unrepresentable; tools have no writable state fields; L3+ paths take no caller verdict at all.

### P3 · Separate fact from judgement

The model may **request**, not **declare**. Step state, hypothesis state and progress are folded from the log, never stored a second time. **Every stored state is a potential lie**; state that can be recomputed can never disagree with the facts.

### P4 · The doer does not judge their own work

Criteria are written before results exist; L0–L2 may self-judge with a reviewable basis; L3+ dispatches an independent evaluator with a fresh context reading artefacts only, and the system writes the evaluation card, not the evaluated party. Completing a goal also needs independent evaluation.

### P5 · Delete nothing

Refuted judgements, rejected artefacts and retracted facts all stay. A refuted judgement is an asset: it records a dead end, which is a real output of exploration. So refutation must cost nothing: the step that tested it completes as usual and never needs a void to close.

### P6 · Growing the ontology is native to the loop

A mechanism that is not part of the task's completion function is merely "available". So knowledge work has a **structural** trigger: when a goal is open with registered judgements, the system enters knowledge mode — the run-state card shows related known facts and gaps (model only, three kinds), and closing has one gate (entities named in assertions must be on the graph). Ordinary Q&A never enters it and pays nothing.

A real run gave a counter-intuitive result: what changed behaviour was mainly **seeing the gaps**, not the gate. Visibility makes the model want to do it; the gate stops it from going around.

---

## 2. One loop

> question → judgement (state what would prove it wrong) → a test that could fail → evidence → bounded conclusion → grows into the ontology

Every decision in this version uses this one ruler: what directly serves the loop stays; what does not is deleted or handed to the host. It replaces the old "seven stages" and "four runtime beats" — two descriptions of the same thing; we keep one.

**Admission does not adjudicate** — the part of this design we are most sure of. Admission checks only that an artefact exists, is non-empty and is well-formed. It answers "accept or not", never "what does it show", so admission cannot contaminate a conclusion; the verdict is left whole to the evaluator.

**One completing action**: `AdvancePlan` is the only action that advances a step; `RevisePlan` (add a step, change criteria, void) never changes progress. With one action that advances, "who advanced this step" always has an answer.

**Completion is separate from the result**: a step is an act, and whether it is done depends only on whether the delivery holds; a judgement is a claim, and whether it holds is computed from evidence. Deciding that an act is done by whether its result favours the judgement would penalise refutation and reward rewriting a refutation as support. So a delivery gets two judgments — does it hold, and what does it mean for each judgement — and supports, refutes and inconclusive all count as done.

**Parallel exploration needs no mechanism of its own.** Worldlines used to run routes in separate file copies, compare them on a pre-declared measure, and let a person adopt one. This version reduces that to the loop itself: competing routes are competing judgements, the measure is the criteria written in advance, the comparison step is the crucial test where one observation judges the competing judgements, losing is being refuted, contradiction is a conflict; the parallelism goes to native subagents. The cost is file isolation — the host's subagents share one working directory — so one cheap mechanism is added: steps in one plan may not declare the same artefact path.

---

## 3. Safety belongs to the host

This section used to say "after-the-fact restore replaces up-front approval", resting on our own git ledger. This version hands file history back to the host, which shows what changed each turn but **cannot restore**. So the premise moves: safety is carried up front by the host's **permission presets and approvals**, no longer after the fact by our ledger. This is an accepted cost, recorded in section 6 of the [plan](less-is-more-plan.zh-CN.md).

---

## 4. Handling failure

**One test: who wrote this data.**

- Provider, model parameters or external payloads broken → normalise and count at the boundary, do not echo it to the model, never let an external blip become the death of the run.
- State we wrote ourselves broken → the record is broken; never silent.

| Layer | Shape | Path |
|---|---|---|
| Ordinary tool error | An error in the same turn | The model corrects itself |
| Provider failure | A typed fact | Bounded backoff; if unavailable, pause and continue on "continue" |
| Engine-level exception | Marked "effect may have committed" | Observe first, then consider retrying |

Side-effecting tools run at most once; past the dispatch boundary an unknown outcome means: observe the current facts first.

---

## 5. Context is a governed resource

1. **A stable prefix is a hard constraint.** Tool order is frozen; the environment section carries no time; each tool result has one rendering definition.
2. **Injection is bounded.** The run-state card is injected once when state changes; the prompt is three sections, roughly three to four thousand characters; how to use a tool lives in the tool's description and appears when used.
3. **Every byte sent to the model is backed by the log.** Facts about the channel are broadcast only, never logged.

---

## 6. Engine and content are decoupled

**ClearAI does not modify the DSH engine.** The epistemic layer is added on DSH's composition surface as contributions: one host package, one preset, one client module. New behaviour = register a contribution + declare a row, never an engine branch. The return is that it can be trimmed, verified at assembly and replaced. This version goes further: **for capabilities the host already provides, we contribute nothing at all.**

---

## 7. Internal tensions

A philosophy document that lists only strengths is marketing. These are the **real** tensions in this design:

1. **Complete mechanisms ≠ complete implementation.** The documents describe the target design; what has landed is tracked in [Known Gaps](known-gaps.md).
2. **Handing work to the host means inheriting its limits.** We lose restore; changes in the host's goal, question and deliverable behaviour reach us directly. The prototype spikes show today's interfaces work, not that they will not change, so every dependency must be pinned by tests.
3. **There is no mechanical equivalence check between documentation and implementation.** The truth table, state-machine document tests and banned-phrase scans cover part of it; elsewhere drift is still possible.
4. **The ontology layer is convention; the fact layer is experience.** Once a term is cited as fact, disagreeing with a conclusion can look like disagreeing with the whole vocabulary. Mitigations: entries need a basis, deprecation is sticky, a change of meaning needs a new id, conflicts are surfaced and never adjudicated.

---

## 8. In one sentence

**Leave uncertainty to the model, put certainty in mechanisms, hand the host what the host can do; whatever can be computed should not be merely said.**
