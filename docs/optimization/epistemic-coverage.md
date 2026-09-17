# ClearAI epistemic loop: full-coverage design (the no-shrinkage baseline)

> This document answers one question: **what the complete epistemic loop looks like, and which
> existing mechanism carries each beat.**
> It is the acceptance baseline for Phase 4 and everything after: no "slimming" may regress any
> epistemic behavior marked `implemented` here.
> The per-field authority for every mechanism is the [truth table](truth-table.md); state
> transitions live in [state machines](state-machines.zh-CN.md); interaction order lives in
> [timing diagrams](timing-diagrams.md). This document makes only the **coverage argument**:
> every beat of the loop has a home.

## 0. Three reading rules

1. **Epistemic core ≠ working style.** The core answers "what may be believed"; working style
   answers "how work gets done" (todo, subagents, model switching, the `/` menu). Slimming may
   only touch the latter; handing working style back to native DSH is **not** shrinkage — as long
   as it structurally cannot touch the authoritative ledger.
2. **Covered ≠ implemented.** Every beat is marked `implemented / partial / design-only /
   removed`. A design-only beat must never appear in a statement about what the system does.
3. **No shrinkage = three non-retreats.** No behavior retreat (nothing implemented disappears),
   no hardness downgrade (a hard boundary never becomes a prompt preference), no honesty loss
   (gaps are never hidden).

## 1. The canonical shape of the full loop

Thirteen beats of main line, four failure branches, two side paths:

```text
① Set the goal (with criteria for "what counts as answered")
② Register hypotheses (one claim + falsification condition each, at least two)
③ Contract (plan = steps × levels × done_criteria; criteria registered before execution)
④ Human review (the native review card always appears; approval writes the stamp)
⑤ Execute (artifacts land in the workspace; protected roots are unwritable)
⑥ Observation admission (artifact exists, non-empty, structurally valid)
⑦ Routed evaluation:
     L0–L2 → the doer self-judges, leaving reviewable grounds
     L3+   → an independent evaluator (human or machine); doer ≠ judge
     L4    → independent evaluation + step/branch-level human release
⑧ Evidence (supports / refutes / undecidable; written once, never edited)
⑨ Fact promotion (enough evidence; enters the knowledge base with scope and support level)
⑩ Closing evaluation (judges whether the goal is achieved)
⑪ Learning (skill candidate → only a human promotes; memory validated and de-duplicated)
⑫ Continuation ruling (gate state decides: continue / hold / stop)
⑬ Next round, or archive

Failure branches:
  F1 Same point rejected ≥ threshold → plan blocked, stop and wait for a human (a quality
     gate, never tier-dependent)
  F2 Hypothesis refuted → supersede by appending, never delete
  F3 Step voided → kept in history, complete
  F4 Kernel crash → refold from the log on restart, re-arm the continuation token

Side paths:
  B1 Worldlines: mutually exclusive options each own a working copy; convergence is arithmetic
     (ranked by pre-registered metrics); if arithmetic cannot decide → human gate; losing
     branches are all kept
  B2 Non-authoritative exploration: todo / subagents / workflow / model switching — work is
     unrestricted, but it structurally cannot write into the authoritative ledger
```

## 2. Coverage matrix

One row per beat. "Hardness" = hard boundary (enforced by schema / registry / projection /
tests) or advisory (carried by prompts). "Verified by" = the test pinning the beat; "—" means it
currently rests on prompts or is missing.

### Main line

| Beat | Expected behavior | Carried by | Hardness | Status | Verified by |
|---|---|---|---|---|---|
| ① | Goal with criteria; refinement appends, never overwrites | `SetGoal` / `RefineGoal` | hard | implemented | kernel suite |
| ② | ≥2 hypotheses, each with a falsification condition | `SetGoal` entry gate + preset `minHypotheses: 2` | hard | implemented | kernel suite (0/1/2/revision forms + neutral default) |
| ③ | Criteria enforced: every step's `done_criteria` ≥ 4 chars | `validateSteps` ← `CreatePlan` | hard | implemented | kernel suite |
| ④ | Plan always raises native review; `confirmed_by` is only `user`/`progress` | `CreatePlan` → native review | hard | implemented | kernel + host suites |
| ⑤ | Artifacts land on disk; `clear/` is protected | bash deny rules + host sandbox | hard | implemented | kernel + host suites |
| ⑥ | Three admission criteria for observations | `check_step_evidence` admission layers | hard | implemented | kernel suite |
| ⑦a | L0–L2 self-judgment with reviewable grounds | registered criteria + append-only log | hard (shape) | implemented | kernel suite |
| ⑦b | L3+ doer ≠ judge; evaluator carries `outputSchema` | evaluator dispatch | hard | implemented | kernel + host suites |
| ⑦c | L4 step/branch-level human release reading native approvals | human release on the step/branch axis | hard | implemented | kernel + host suites |
| ⑧ | Evidence has three verdicts, is append-only, cites observations and evaluations | evaluation cards on disk | hard | implemented | kernel suite |
| ⑨ | Fact promotion carries scope and support level | `clear/knowledge/facts/` | hard | implemented | kernel suite |
| ⑩ | Closing evaluation judges goal achievement | goal-closing evaluation | hard | implemented | kernel suite |
| ⑪ | Only a human promotes a skill candidate; memory is validated and de-duplicated | `promote_skill` gate + `WriteMemory` | hard | implemented | kernel suite |
| ⑫ | Continuation derives from gate state: blocked→stop; unauthorized / arbitration in flight / open gate → hold | `turnDemand` + host goals | hard | implemented | kernel + host suites |
| ⑬ | The 128-round fuse is enforced by the native driver itself | `DEFAULT_MAX_AUTO_TURNS` | hard | implemented | kernel suite |

### Failure branches

| Beat | Expected behavior | Carried by | Hardness | Status | Verified by |
|---|---|---|---|---|---|
| F1 | Block threshold → blocked, wait for a human; never tier-dependent | `blockedThreshold` | hard | implemented | kernel suite |
| F2 | Refutation never deletes: supersession chain | append-only fold | hard | implemented | kernel suite |
| F3 | Voided steps stay in history | append-only fold | hard | implemented | kernel suite |
| F4 | Refold after crash + re-arm continuation | fold + continuationService | hard | implemented | kernel + host suites |

### Side paths

| Beat | Expected behavior | Carried by | Hardness | Status | Verified by |
|---|---|---|---|---|---|
| B1a | Each worldline owns a working copy | `ForkPlan` + worktree | hard | implemented | kernel suite |
| B1b | Convergence is arithmetic; undecidable → human gate; losers kept | `ConvergeFork` + human gate | hard | implemented | kernel suite |
| B2a | todo / subagents / workflow / ralph return natively, products stay non-authoritative | `preset/agent.cordis.yml` working-style rows | hard | implemented | `authority-boundary` (14 checks) + `preset-composition` |
| B2b | Model switching via native `modelSelectionSettings` | `dsh-tool-subagent` row config | hard | implemented | `preset-composition` |
| B2c | ClearAI's own `/` menu (command-registry contributions) | `preset/plugins/commands.js` | hard | implemented | `preset-composition` |

### Pervasive supports

| Behavior | Carried by | Hardness | Status | Verified by |
|---|---|---|---|---|
| Intent/fact separation: no writable status/progress fields | schema inexpressibility | hard | implemented | kernel suite |
| Projection is the only truth: state = log fold, monotonically increasing | `fold.js` + monotone RANKs | hard | implemented | client suite |
| Runtime card derived each turn, injected only on prefix-stable change | `renderCard` | hard | implemented | client suite |
| 22 prompt sections manifest-driven, slot wording mutually exclusive | `SECTIONS` + contribution table | hard | implemented | truth-table verifier |
| Ontology declarations cross-checked against implementation | `ontology.js` + assembly check | hard | implemented | ontology suite |

### Domain ontology (vocabulary / assertions / conflicts / graphs)

| Behavior | Carried by | Hardness | Status | Verified by |
|---|---|---|---|---|
| Six vocabulary events fold into `state.lexicon` (revisions kept, deprecation sticky, no delete) | `ui/lib/domain-language.js` + `fold.js` | hard | fold implemented; producer verbs are design targets (stage C) | `test/domain-language.test.mjs` |
| An assertion lands with promotion (references exist, form fits the range, one fact self-consistent) | `fact/promoted` + `validateAssertions` | hard | fold implemented; `SetGoal` / `CloseGoal` not wired | same suite; wiring in stage C |
| Conflicts are surfaced, never adjudicated (single-valued predicate + same subject + different objects + neither retracted) | `deriveConflicts` + the runtime card | hard | implemented | same suite |
| Vocabulary and knowledge graphs derive from one fold (deterministic layout, coordinates never ledgered) | `graphProjection` + `view().lexicon` | hard | fold implemented; the panel does not render yet (stages D–E) | same suite |

### Known non-coverage (listed honestly; destinations in §5)

| Beat | Expected behavior | Status | Destination |
|---|---|---|---|
| ⑦+ | A universal L4 gate covering **every** evaluation | design-only | truth-table row `l4-universal-gate` · destination `stay-design-only` (a decision, not a backlog item) |
| — | The eight-state verification machine | design-only | truth-table row `verification-lifecycle` · destination `become-mechanism` — only its two missing **guarantees** are planned, not the nine stored states |
| — | Observation sources `human_upload` / `file_drop` / `callback` / `pull` | design-only | truth-table row `observation-provenance` · destination `become-mechanism` (the type gets narrowed to the producers that exist) |

## 3. The no-shrinkage list and the hand-back list

**No shrinkage (epistemic core)** — touching any of these changes the product definition:

1. Criteria registered before execution (③)
2. Plans always face human review (④)
3. Three admission criteria (⑥)
4. Doer ≠ judge: no L3+ self-judgment (⑦b)
5. Evidence/log append-only; refutation never deletes (⑧, F2, F3)
6. Fact promotion carries scope (⑨)
7. Continuation derives from gate state (⑫)
8. Worldline convergence is arithmetic, losers kept (B1)
9. Only a human promotes a skill (⑪)
10. Intent and fact are not mutually writable (schema level)

**Hand back to DSH (working style)** — native is better, provided §4's authority boundary holds:

- todo, subagents, workflow, ralph, plan-mode, model switching, `/` menu, command palette,
  the **read side** of skills/memory (already handed over), context budgets (already handed to
  `dsh-token-meter`).

**The procedure for judging whether a change shrinks anything**: find its row in §2 first.
If that row is `implemented` and belongs to the list above → do not touch it.
If it is working style → it may change, but you must prove "non-authoritative paths cannot write
the authoritative ledger" still holds.

## 4. Unified semantics: authorization is a stamp; the review is the gate

Two texts once contradicted each other (the `CreatePlan` result said "do not start work", the
runtime card said "nobody needs to press anything first"). The unification — **behavior
unchanged, wording and reasoning aligned** (landed: the CreatePlan result, the runtime card and
the prompts now say one sentence):

1. **The gate is the native review card itself**: `CreatePlan` always raises it; that is the only
   human gate. Approval → `confirmed_by='user'`.
2. **The authorization stamp is attribution, not an execution permit**: being unauthorized does
   not block `AdvancePlan`; the first advance back-fills `confirmed_by='progress'` in the same
   mutation (action is authorization).
3. **The only real consequence of being unauthorized**: auto continuation `hold`s — the system
   will not drive itself onward, but a human may explicitly advance. All three texts (the
   `CreatePlan` result, the runtime card, the prompts) therefore say one sentence: "an unapproved
   plan is never auto-continued; when you advance it explicitly, the first advance records
   attribution."
4. `planIsAuthorized`'s two branches (the stamp / already advanced) are exactly this semantics
   folded, and stay unchanged.

## 5. Destinations for gaps (every gap gets exactly one of three)

- **Landed as a mechanism**: the `retracted` producer (truth-table row `fact-retraction` — refuting
  evidence only marks the fact, and a person decides retract or keep with `retract_fact` / `keep_fact`,
  landing one `fact/reviewed`).
- **Become mechanism**: the dead `autonomy.override` read path (Phase 4/5 decides delete or
  keep — decided: keep, read-only for old logs).
  (Landed: the hypothesis count floor — preset sets 2, kernel gate + prompt discipline, see
  row ②; the authority-boundary test; the five `/` commands and the returned native working
  tools todo/subagent/workflow/ralph — see the Phase 4/5 ledger entries.)
- **Retired as a concept**: the "exploration zone" as a *named mode*. Its negative half is the
  `non-authoritative-isolation` row (implemented, pinned by the authority-boundary suite); its
  positive half — "exploration output must be accounted for" — is the
  `ledger-exploration-snapshots` row (a workspace snapshot at each turn boundary). Naming a region
  would have added a second name for the same thing, not a mechanism.
- **Stay design-only, honestly labelled**: the universal L4 gate. The criterion: it has a
  truth-table row with the correct `status` and a `destination`, and no document claims it is
  implemented. Every non-`implemented` row now carries that destination, so "not yet" and
  "decided against" are no longer spelled the same way.
- **Deleted and accounted**: removed mechanisms (`set_autonomy`, the 6/512 budgets,
  `autoConfirmed`) leave traces only in the truth table and the CHANGELOG; code and comments no
  longer narrate them.

## 6. End-to-end timing (the canonical sequence)

One full round (details in the five [timing diagrams](timing-diagrams.md); this is their
concatenation):

```text
Human: sets the goal
Model→Kernel: clarification (slot wording) → SetGoal → register hypotheses → CreatePlan
        (criteria validation)
Kernel→Host→Human: the native review card (always raised; approval → confirmed_by='user')
Human: approve / request changes / withdraw
Kernel→Host: arm the continuation token (goals service)
Model: execute steps → artifacts land in the workspace
Kernel: observation admission → needs_audit? → dispatch an independent evaluator via the host
        (read-only tool surface + outputSchema)
Evaluator: evaluation card on disk (supports / refutes / undecidable)
Kernel: rejected? → count+1 → ≥ threshold blocks the plan and waits for a human
Kernel: evidence complete → fact promotion → closing evaluation → disarm / re-arm (mutations
        enter the fact ledger; the projection folds the state out)
Kernel→Host: turnDemand: gate open → hold; gates closed → the host drives the next round (≤128)
Human (any time): gate verbs / ask_user_question answers / native approvals / `/` commands
```

## 7. Verification map and the missing tests

| Existing test | Beats pinned |
|---|---|
| `test/kernel.test.mjs` | ①③④⑤⑥⑦⑧⑨⑩⑪⑫⑬ F1–F4 B1 |
| `test/host.test.mjs` | ④⑫ F4 (deployed form) |
| `test/ontology.test.mjs` | ontology ↔ implementation |
| `test/client.test.mjs` | projection, runtime card |
| `test/truth-table.test.mjs` + `tools/verify-truth-table.mjs` | mechanism inventory, counts, orphan copies |
| `test/state-machine.test.mjs` | transitions ↔ fold |
| `test/docs-consistency.test.mjs` | historical wording never poses as present tense |

| Missing test (already planned) | Beats to pin |
|---|---|
| `test/authority-boundary.test.mjs` | B2a: non-authoritative paths structurally cannot emit `clearai` mutations |
| `test/preset-composition.test.mjs` | B2b/B2c: menu and model-switching mount shape |
| `test/prompt-sections.test.mjs` | section tags (hard/native/advisory) do not drift |
| hypothesis-floor cases (in `test/kernel.test.mjs`) | ②: the floor as a mechanism, not prompt text |
