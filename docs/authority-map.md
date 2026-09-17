# Authority map

This document answers one question: **who produces each fact, where it lives, who consumes it, and whether it can be derived.**

It exists because of a self-diagnosis. After several rounds of fixing defects we caught ourselves **patching by symptom** — one more branch per failure, one more field per branch, one more assertion per field. The assertion count grew; reliability did not. The root cause was not a single wrong predicate: it was that **the same thing was being inferred in two places**. The host already answers process facts, and we inferred them again from in-memory tables; the projection already computes state, and a second interpreter was built next to it.

**One rule** (this document's acceptance criterion):

> One failure class is explained in **one** place; one fact has **one** authority;
> the same run is **never re-executed because a read failed**; and with no evidence the system can
> **quietly say it does not know**.

## 1. Three planes, each owning its own facts

| Fact | Authority | What we do |
|---|---|---|
| Whether a sub-run was accepted, is running, has ended; why it ended; whether the session is running; whether to schedule more; which approval a human actually gave | **The DSH host** | Consume it. `subagents.listChildren` (`activity: running / inactive`), `subagent/end` (`stopReason` + closing message), `agent/turn-stopping` / `agent/error`, the persisted session log — **these are different reads of one fact, not three competing truths**. |
| Which proposition is under test; what criteria were committed in advance; which observation fed which evaluation; whether an evaluation supported, refuted or could not decide; why a fact gained or lost the right to be cited; what a human decided and on what question | **ClearAI** | This is the irreplaceable part. A finished task is not a proven proposition; a failed evaluation is not a refuted proposition. |
| What a file contained at a given time | **The git ledger** | It answers "what was there". It **cannot** answer "how was it produced, is it trustworthy" from a path alone. |
| What the UI shows ("running / trusted / waiting on you") | **The projection (derived)** | No second copy of the judgement: computed from the two kinds of fact above. |
| Which concepts and predicates exist in this domain, with what range and single-valuedness | **The ClearAI ledger** | Entries land only through named verbs (seven, implemented); the fold turns the six `ontology/*` events into `state.lexicon` — **there is no second vocabulary**. |
| One fact's assertion (subject–predicate–object) | **The ClearAI ledger** (`fact/promoted.assertions`) | It lands **only at promotion**; old facts are never rewritten retroactively. |
| Conflicts, the ontology graph, the entity graph, vocabulary health | **The projection (derived)** | All computed: a conflict is a paired reading rather than an object, the graphs are the output of `graphProjection()`, layout is a deterministic pure function, and coordinates never enter the ledger. |
| `clear/ontology/domain.md` and the panel's ontology tab | **Rendering** | Not authority: the shelf is rewritten idempotently by the system and the panel only invokes verbs (the panel itself is stages D–E). |

### One consequence we got wrong last batch

**A parent turn ending proves only that the parent turn ended.** It does not prove the sub-runs will never come back: they may still be running in the host, or may have **already ended with a result we have not collected**. Only an explicit host report of termination or failure licenses the corresponding judgement. Therefore:

| Observation | Correct reading |
|---|---|
| Parent turn ended, sub-run still running | Wait for the host's later result; **do not re-dispatch** |
| Sub-run ended, result not yet in ClearAI | **Collect that same run's result**; do not re-execute |
| Sub-run failed | Record the failure; whether to retry is the next decision |
| Evaluation ended but its card could not be written | The run ended, the file write failed — the ledger must **not** look as if the evaluation were still going |
| The host currently cannot report the run's state | The state is **unknown**, which is not the same as dead |
| Two readings cannot be shown to share a measurement scale | Show the raw readings; **do not claim a valid numeric ranking** |

## 2. Four things now confirmed (each with a code pointer)

### ① The closing beat announced something it had not checked (**fixed**: that claim, and the entire `clearai/turn-ended` mechanism with it, are deleted; the closing beat now only records a workspace ledger snapshot — no liveness judgement, no verdict, no waking anyone)

On the host's `agent/turn-stopping` we write into the run-state card:

> The previous turn ended with N sub-runs still in flight — **their conclusions will not come back** (either re-dispatch, or void that step).

"Still in flight" was **what our in-memory tables looked like at that moment**; "their conclusions will not come back" is an **inference with no evidence**: the sub-run may still be running (the host will report later), or may have ended with a result merely not yet collected. And the kernel **already asks the host**: `sweepLostScouts` / `sweepLostAudits` both read `subagents.listChildren`'s `activity`, which is the authoritative answer to "is it still running". The closing beat did not use it.

**Conclusion**: that sentence must retreat to "a snapshot taken at that moment", or — better — the beat should ask the host. **Not** add another field.

### ② Audits have no "ended but uncollected" recovery path; scouts do (**fixed**: `sweepEndedAudits` now recovers the verdict from the child's session log first and only records unknown when recovery fails; `ended_uncollected` and `lost` are written as two different things; the settlement text no longer gives advice)

- Scouts: `sweepScouts` first checks the in-process handle and, failing that, **reads the child's own session log** (`recoverFromChildSession`) — "the child ended but the result never arrived" can be recovered.
- Audits: `sweepLostAudits` looks at only two things — the projection says `verdict === null`, the child is not in our in-memory table, and the host says `activity !== 'running'` — and then writes:

  > The evaluator was lost: the process that dispatched it is gone and its sub-session is not running — **this verdict will have no result**.

  "Not running" does not imply "will have no result": **the sub-session may have finished normally with its verdict sitting in its log.** Worse, the model is then told "re-delivering this step dispatches a fresh evaluator" ⇒ **the same evaluation is redone**, while the original result may be lying on disk.

**Conclusion**: the right shape here is not "one more closing sweep" but **giving audits the same recovery path scouts have**: try to collect the same run's result first, and only then write a settlement fact — with an accurate reason (`ended_uncollected` and `lost` are two different things).

### ③ The ruler's "scale" check is a **format check** (**fixed**: the scale must now be **a file that exists in the workspace** — prose and dead paths are rejected; "the same ruler" went from a declaration to a nameable reference)

`ForkPlan` now requires `decide_by.metric` to read `quantity = scale`. What that guarantees is: **the declaration is registered and passed verbatim into every branch's criteria and brief**. It does **not** guarantee the two readings are comparable:

```
score = score it according to this route's situation      ← passes the check too
```

**Conclusion**: the value of this mechanism is turning "each branch invents its own scale" into "one declaration everyone can see". Every place in the docs and the truth table that calls it "a shared measurement scale guaranteed by construction" must be walked back to what it actually does; the rest belongs to an evaluator re-run, which is the only thing that can truly confirm it.

### ④ The host-invariant companion is growing into a **second interpreter** (**fixed**: it now advances state with the **production fold** (`applyEvent` from `fold.js`), keeping only the five contract predicates and one admitted-steps set — the index went from ten Maps to one Set, and all shape-interpretation code is gone)

To judge "before the append", `ui/lib/invariant.js` folds its own index of plans / steps / forks / branches / admissions / dispatches / scouts / audits / hypotheses / support levels. In its first hour of duty it needed two repairs for exactly that reason (mutations often carry `step` without `plan`; the goal and worldline axes use pseudo-steps) — both were "my interpreter disagrees with the main projection", not "the business is actually wrong".

**Conclusion**: the host offering a registration mechanism does not mean every business rule belongs as a pre-append hard block. The companion gets re-cut along the line in §4.

## 3. Where responsibility is duplicated (review targets)

| What we maintain | What the host / projection already has | Its **only** irreplaceable contribution |
|---|---|---|
| `scoutRuns` / `executorRuns` / `pendingAudits` (in-memory) | Host: `listChildren.activity`, `subagent/end`. Projection: `scout/dispatched`, `worldline/executing`, `audit/dispatched` | **The business binding**: which worldline / scout / step-evaluation this child belongs to, plus the in-process result handle |
| ~~`turnEnds` (turn-end record in the projection)~~ **Disposed: this cell was deleted together with the `clearai/turn-ended` event** | Host: `agent/turn-stopping` / `agent/error`; `subagents.listChildren` | The disposal is "keep nothing": turn-end only commits a workspace ledger snapshot (`git/snapshot`) — it **judges nothing in flight and writes no verdict**; "who is still in flight" is asked of the host on the next turn |
| The trace index inside `invariant.js` | The state `fold.js` already computes | Only the "before the append" timing; the index itself is a duplicate implementation |
| `lastWorkspaceSnapshot` (write counter → snapshot) | The git ledger itself | "after which write we committed" — but the ledger already has that history; this could shrink to de-duplication only |

## 4. What should be a hard block, and what should be a diagnostic

**"Block as early as possible" is wrong.** The line is:

| Kind | Treatment | Example |
|---|---|---|
| **Illegal business operation** | Reject at the tool entry | The model forging a human approval; delivering without criteria |
| **A run failure that already happened** | **Must be recordable** | An evaluator crashing, a card write failing, a sub-run interrupted |
| **A self-contradictory history** | **Report a diagnostic, keep the raw record** | A reference to a step that does not exist |
| **A business judgement that cannot be proven** | Mark unknown, hand to an evaluator | Whether two readings share a scale |

> Maintaining ledger consistency must not become **admitting only the facts that look good**.
> Refusing to record a failure that already happened is itself a false statement.

## 5. Domain vocabulary and graphs (authority in the new layer)

The four fact classes the table above gained follow the same rule, spelled out one by one — **one fact, one authority**:

| Fact | Authority | Who consumes it, and how |
|---|---|---|
| Which concepts and predicates exist, with what range and single-valuedness | Ledger events (`ontology/term_added`, `ontology/predicate_added`, plus one revision and one deprecation event each) | The fold → `state.lexicon`; the model (assertion validation), the shelf `clear/ontology/domain.md`, the panel's ontology tab |
| One fact's assertion | The ledger event `fact/promoted.assertions` (it travels with the fact) | The fold → `state.facts[].assertions`; the graph projection, the shelf, the panel |
| A conflict (two un-retracted facts contradicting each other) | **Derived**: `deriveConflicts()` recomputes it on every replay | One line on the runtime card, a conflict section on the panel; **it enters no gate** — it is a reading, not a gate awaiting a person |
| The ontology graph / entity graph | **Derived**: `graphProjection(state)` | The panel, the Mermaid shelf, the tests; layout is a pure function, so the same ledger always yields the same graph |

Three boundaries (written down here so the next reader does not have to guess):

- **Vocabulary events advance no process object.** Admitting a concept is not a step of a goal, plan or step; conversely, process events never change the vocabulary. The two state machines **do not nest** — which is why `state.ontology` (the process-ontology shape) and `state.lexicon` (the domain vocabulary) are two separate fields.
- **An assertion lands only at promotion.** Delivery and evaluation write none; a malformed assertion supplied when a hypothesis is registered is refused **before anything lands**.
- **Every arrow points at a read surface, and no read surface points back into the ledger.** The graphs, the card and the shelf are all renderings of the same fold; editing on the panel only invokes verbs.

## 6. What to do next (an architecture review that changes no code)

1. **Rebuild the causal chain from real trajectories**: pick three kinds — a normal completion, an evaluation failure, and a parent turn ending with a sub-run unfinished — and thread "run id → dispatch → result → business landing" through each, **separating confirmed causes from guesses**. Sources: the raw session logs in `~/.dsh/e2e-archive/` and the decoded copies in `docs/optimization/e2e-logs/`.
2. **Finish this ownership table**: for every field, who produces it, where it lives, who consumes it, whether it is derivable. The four rows in §3 are the review targets.
3. **Produce a keep / delete / delegate-to-host proposal**, applying it to the last four unreleased commits as well — **nothing is kept merely because I just wrote it**. Delete the wrong inferences, the duplicated state and the unsound hard blocks first; only then decide whether new code is needed.

The acceptance criterion is the one in the preamble, **not** how many assertions were added.
