# ClearAI: Converging on the Epistemic Core and Slimming the Harness

> This file is the **approved execution plan**. It is the basis for all follow-up work and the source
> for the progress ledger. Progress and the commands run in each phase live in
> [`progress.zh-CN.md`](progress.zh-CN.md). The Chinese version is
> [`plan.zh-CN.md`](plan.zh-CN.md).

## 0. Success criteria

1. The repository carries one **authoritative truth table**, generated from or verified against code
   constants, that answers at a glance: is this mechanism implemented, is it a hard boundary or a
   preference, who triggers it, does `autonomy` affect it, which test covers it.
2. The repository carries **state machines** and **timing diagrams** that explicitly label each item
   `implemented / partial / design-only / removed`, so a design goal is never presented as delivered
   behaviour again.
3. Every statement in docs, comments and prompts that contradicts the current code is either removed
   or labelled as historical.
4. Confirmed dead code is deleted (the old autonomy fork, the 6/512 budget, the removed toggle write
   path). Core mechanisms (fold / admission / evaluator / human gate / ledger / protected roots) lose
   nothing.
5. The `/` menu gains entries ClearAI contributes itself through DSH's native `commands` registry, so
   it is no longer thinner than the `standard` preset's menu.
6. Non-authoritative exploration (todo / subagent / workflow / model switching) returns through native
   DSH rows, and is **structurally unable** to write the authoritative ledger.
7. `npm test`, `npm run build`, `npm run verify`, `npm run verify:deploy`, `npm run verify:install` are
   all green.
8. The repository carries a **no-shrinkage coverage design**
   ([`epistemic-coverage.md`](epistemic-coverage.md)): every beat of the full loop names its carrier
   mechanism, hardness, status and verification. It is the acceptance baseline for Phase 4 onward —
   no `implemented` epistemic behavior may regress.

## 1. Verified facts (the plan's baseline)

These are **code facts**, not documentation claims. Every later alignment defers to them:

| Fact | Location |
|---|---|
| A plan **always** requires human confirmation; `autoConfirmed = false` | `preset/plugins/clearai-kernel.js:2764-2798` |
| Continuation is decided by **gate state**, not by autonomy; `blocked→stop`, unauthorized / pending audit / open gate → `hold` | `clearai-kernel.js:1892-1917` |
| Default continuation budget `DEFAULT_MAX_AUTO_TURNS = 128` | `clearai-kernel.js:516`, `:2001` |
| The old `{attended:6, unattended:512}` was deleted by §34, but comments remain | `clearai-kernel.js:492-516`, `:1920-1928` |
| `set_autonomy` and `autonomyFromMessages / turnAutonomy / autonomyForTurn` are gone | `clearai-kernel.js:2230-2235` |
| `validateSteps` already forces `done_criteria` length ≥ 4 on every step | `clearai-kernel.js:2405-2426`, called at `:2745` |
| Prompt language already **follows the user** | `preset/plugins/prompts.js:33-36` |
| 22 prompt sections; the clarification protocol is the `clarification` slot (two mutually exclusive wordings) | `prompts.js:23-312` |
| The ClearAI preset contributes **no `commands` at all** | whole `preset/plugins/` tree |
| The `standard` preset mounts `command-goal`, plus todo / subagent / workflow / ralph / plan-mode | `@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml:95-99,105-125,169-234,241-244` |
| Native human command API: `inject:['commands']` + `ctx.commands.register({name, description, input?, handler})` | `@deepseek-ai/dsh-commands/lib/types/index.d.ts`, `dsh-command-compact/lib/index.js` |
| Native model switching already exists (`dsh-client-ui-model-selection`, subagent `modelSelectionSettings`) | DSH checkout `node_modules/@deepseek-ai/` |

**Conclusion**: the report that "the `/` menu under ClearAI is thinner than in the creation preset" is
correct — ClearAI carries only `command-compact`, no `command-goal`, and no command contribution of
its own.

## 2. Design principles

- **First principles**: ClearAI guarantees *what may be believed*; DSH owns *how work happens*.
  Anything computable must not be asserted.
- **Occam's razor**: a constraint that lives only in a prompt is a preference, and is labelled one. To
  become a boundary it must land in a schema, a registry, a projection or a test. No compatibility
  code is kept for a removed mechanism unless a real log-migration need exists.
- **Inexpressible beats unviolable**: a non-authoritative path must be *structurally unable* to write
  the authoritative ledger, not merely advised against it.
- **Each phase verifies itself**: `npm test` is green at the end of every phase, and behaviour changes
  are committed separately from cleanup.

## 3. Phases and deliverables

### Phase 0 — Land the plan

- `docs/optimization/plan.zh-CN.md` (this plan), `plan.md`
- `docs/optimization/progress.zh-CN.md`
- Entries in `README.md` / `README.zh-CN.md` document indexes

### Phase 1 — Build the truth layer (no behaviour change)

- `docs/optimization/truth-table.json` — the machine-readable source of record
- `docs/optimization/truth-table.zh-CN.md` / `truth-table.md` — generated from the JSON
- `tools/build-truth-table.mjs` — generates markdown and cross-fills `code:` fields from code constants
- `tools/verify-truth-table.mjs` — asserts code constants, preset rows, prompt sections and the tool
  catalog agree with the table

Fields per mechanism:

```yaml
id, name, name_en, layer, status, hardness, authority, actor,
source: {code, tests, config, prompt, docs},
trigger, input, output, blocks_execution,
affected_by_autonomy, native_dsh_alternative, rationale, known_mismatch
```

First batch of mechanisms (epistemic core plus upper framework): goal creation/revision, hypotheses,
criteria, formal plan, `done_criteria` validation, plan review, `RequestPlanReview`, `AdvancePlan`,
admission, L0–L2 self-judgement, L3+ independent evaluation, L4 step/branch release, goal-close
evaluation, fact promotion, history retention, worldlines, pre-registered metrics, human adoption,
single loop, four beats, Scout/Executor/Evaluator, subagent trimming, workflow/ralph trimming, native
plan/todo trimming, bash deny rules, protected roots, git/ledger, KernelPanic recovery, auto
continuation, `maxAutoTurns`, `autonomy`, runtime card, the 22 prompt sections, context pruning, skill
candidate state, memory writes, native model routing, the `commands` menu.

### Phase 2 — State machines and timing diagrams

- `docs/optimization/state-machines.zh-CN.md` / `.md`: ten machines (goal, plan, step, hypothesis,
  observation, evaluation, evidence, fact, worldline, auto continuation)
- `docs/optimization/timing-diagrams.zh-CN.md` / `.md`: four diagrams (light exploration, formal
  epistemic flow, failure recovery, worldline convergence)
- Node and edge names must come from `ui/lib/fold.js` event types and `derive()` fields
- The plan machine must show `CreatePlan → review → only approved authorizes`; `AmendPlan` /
  `RefinePlan` / `RequestPlanReview` authorize nothing
- The continuation machine must state the default 128, `turnDemand`'s gate order, and that `goals` is
  only a driver
- `test/state-machine.test.mjs`: the event-name set in fold matches the transitions the docs list

### Phase 3 — Mismatch cleanup (no behaviour change)

**3a Docs and comments**

- `clearai-kernel.js:492-516`, `:1920-1928`: drop the 6/512 wording and "the two tiers differ in budget"
- `clearai-kernel.js:1897`, `:2760-2762`: drop the residual "unattended authorizes at goal creation"
- `prompts.js`: any "Goal tier auto-confirms" wording
- `preset/agent.cordis.yml:166-182`: rewrite as "only the clarification slot follows autonomy; plan
  authorization does not"
- `docs/known-gaps.zh-CN.md:28`: fix the "Chinese throughout" claim
- `docs/loop-philosophy.zh-CN.md:170`: narrow "a missing done_criteria bypasses evaluation" to legacy
  logs / internal construction
- Sweep out "a universal L4 gate is implemented" and "the eight-state verification machine shipped"

**3b Dead code**

- The `autoConfirmed` constant and its branches (pin `'user'`)
- The stale "both tiers have a window" comment block in `continuationService()`
- Budget constants and comments serving only the old tiers
- Dead branches in the `autonomy` compatibility read path, once no migration need is found

At the end of Phase 3: `npm test` green, and `git diff` contains no semantic change to `fold.js`.

### Phase 4 — Minimal hard boundary (exploration zone / formal zone)

**4a Kept as hard constraints**: the model cannot write `clear/evidence`,
`clear/knowledge/facts`, `clear/goals` directly; cannot declare formal state / progress / phase;
facts derive from fold + derive; L3+ is not self-judged by the doer; human rulings cannot be forged;
worldline arithmetic is separate from human adoption; an unknown side effect is observed first;
history is append-only.

**4b Relaxed non-authoritative process**: explore before formalizing; non-authoritative parallel
subagents; several low-risk steps in one pass; plan granularity, whether to scout, whether to use
worldlines become advice.

**4c Structural isolation**: the non-authoritative write surface is separated from the authoritative
event surface in code; `test/authority-boundary.test.mjs` asserts a non-authoritative path cannot
produce a `clearai` mutation.

### Phase 5 — Restore capability and the menu the native way

**5a `/` menu**: add `preset/plugins/commands.js` with `inject: ['commands']`, contributing
`/plan-review`, `/goal`, `/plan`, `/evidence`, `/worldline`, `/skill-save` (final names TBD) through
`ctx.commands.register`. Commands are **human-side reads and releases only**; they add no
model-callable authoritative write surface, and their handlers reuse existing kernel functions rather
than copying logic. Evaluate adding `@deepseek-ai/dsh-command-feedback`.

**5b Non-authoritative tools return**: `tool-todo`, `tool-subagent` / `tool-subagent-fork` /
`tool-subagent-control`, `tool-workflow`, `tool-ralph`, and subagent `modelSelectionSettings: true`.
**Still not mounted**: `tool-goal` / `command-goal` (single goal ledger) and `plan-mode` (two plan
disciplines).

**5c Native model switching**: ClearAI keeps no provider/model state; switching goes through the
native entry point; the runtime card shows the current model read-only; an evaluator may still use an
independent provider, recording only its origin.

**5d Acceptance**: `test/preset-composition.test.mjs` asserts the mounted tool rows match the truth
table and the three excluded rows stay out; end-to-end checks that a scratch todo does not move
progress, a free subagent cannot write authoritative events, and a model switch changes no state.

### Phase 6 — Prompt slimming and context injection

**6a Three-way classification** (each section tagged in the truth table): `hard` (the minimal fact
boundary), `native` (drop what duplicates DSH), `advisory` (single loop, four beats, plan-first, no
free delegation, scout-before-committing, delivery granularity, language style → moved to menu help,
tool descriptions, the runtime card).

**6b Runtime card slimming**: inject current goal, plan, step, criteria, evidence state, items awaiting
a human, blocking reason, reason continuation is allowed, suggested next step. Remove internal
mechanism names, host goal ids and retired mode vocabulary.

**6c Acceptance**: `test/prompt-sections.test.mjs` asserts every section carries a tag and no `hard`
section contains process-style guidance.

### Phase 7 — Repository-wide doc alignment and consistency tests

- Correct `README*`, `docs/design-principles*`, `docs/loop-philosophy*`, `docs/epistemic-loop*`,
  `docs/verification-loop*`, `docs/release-verification*`, `docs/known-gaps*`, `docs/soul-map*`,
  `docs/positioning*`
- Every statement carries one of three labels: `current implementation` / `design goal` / `removed`
- `test/docs-consistency.test.mjs` scans for banned phrases; paragraphs carrying a `design goal` or
  `removed` label are exempt

### Phase 8 — Final acceptance and release prep

```bash
npm test
node tools/build-truth-table.mjs && node tools/verify-truth-table.mjs
node tools/build-package.mjs && node tools/verify-package.mjs
node tools/verify-clean-install.mjs
npm run verify:deploy
```

Plus one real-browser check (menu entries present, panels unregressed), a `CHANGELOG.md` entry, and a
`README` positioning that says "epistemic core, not process controller".

### Phase 9 — Comment quality sweep (not optional)

**The problem**: a large share of the code comments are a **running log**. Measured at the Phase 3
checkpoint:

| Anti-pattern | Occurrences |
|---|---|
| Date stamps (`2026-09-11` and the like) | 79 |
| Internal section numbers (`§34` and the like) | 164 |
| Incident tags ("long soak", "measured live", "on site") | 74 |
| Comment lines in total | ~2,900 |

The shared defect: **a reader cannot tell from the tense whether this describes now or then**, and the
comments retell history that git already keeps. Date stamps and `§NN` carry no information for a
reader — `§34` has no lookup table anywhere in this repository.

**The rule** (landed as `docs/optimization/comment-style.zh-CN.md`, citable as a criterion)

A comment says three things at most:

1. **Why it is this way** — what the choice buys, what it refuses;
2. **What happens otherwise** — the concrete failure mode, with **no date and no incident number**;
3. **Where the boundary is** — when the whole thing stops holding.

**Never**: date stamps; `§NN` references; "long soak / measured live" incident narration;
"it used to … now …" or "Phase N fixed it" change logs; the history of deleted code — **git is the
history ledger, comments are not**.

**How**

1. Write `comment-style.zh-CN.md` first (the rule plus one good and one bad example);
2. Add `test/comment-style.test.mjs`: count the four anti-patterns across `preset/plugins/*.js` and
   `ui/lib/*.js` against a **baseline quota** that may only go down (a ratchet) — unfinished cleanup
   then becomes **a debt on the books** rather than "nobody's job";
3. Clear file by file in order of outstanding debt (measured at the 2026-09 checkpoint):
   `clearai-kernel.js` 130 → `ui/lib/client.js` 105 → `ui/lib/fold.js` 48 → `ui/lib/index.js` 22 →
   `brain.js` / `ontology.js` 1–2 each;
4. Each step **changes comments only, not one line of code**; then `npm test`, and re-run
   `build-package` plus redeploy (the host suite compares the deployed copy);
5. Finish by driving the quota to 0, or by writing an explicit exemption for the few that must stay.

**Acceptance**

- `node test/comment-style.test.mjs` passes with all four counts at 0 (or with reasoned exemptions);
- A human reads 10 comments at random and can understand each **without consulting git**;
- `npm test` is green.

### Phase 10 — Closing statement

Write the final account in `progress.zh-CN.md`: what was done, what was not, what remains a design
goal, what the next most valuable step is. **That account is written for whoever comes next, not as a
keepsake** — conclusions and evidence only, not process.

## 4. Commit and rollback policy

- Phases 0–2: docs and tooling only, one commit
- Phase 3: two commits, `docs(align)` then `refactor(remove-dead-code)`, the latter never touching `fold.js`
- Phases 4–6: one commit per phase, behaviour changes separate from configuration changes
- A red `npm test` rolls the phase back; no phase starts on a red suite
- `dist/` is always produced by `build-package.mjs`, never hand-edited

## 5. Assumptions and non-goals

**Assumptions**

1. Real logs may contain `confirmed_by: 'autonomy'`; Phase 3b greps tests and fixtures first. If any
   exist, the write side pins `'user'` and only the read side keeps compatibility.
2. Returning `tool-todo` / `subagent` / `workflow` / `ralph` does not conflict with ClearAI, because
   their output stays in the non-authoritative zone; Phase 5's tests prove it.
3. `/` commands need both languages, styled like the existing panels, carried by `dsh-client-locale`.

**Non-goals**

- No change to the DSH engine
- No second goal or plan ledger
- No removal of fold / admission / evaluator / human gate / ledger / worldline / protected roots
- The eight-state verification machine and the universal L4 gate are out of scope; this plan only
  stops the docs from claiming they shipped
- Splitting `clearai-kernel.js` (5,540 lines) is a separate effort

## 6. Deliverables

```text
docs/optimization/plan.zh-CN.md
docs/optimization/plan.md
docs/optimization/progress.zh-CN.md
docs/optimization/epistemic-coverage.zh-CN.md
docs/optimization/epistemic-coverage.md
docs/optimization/truth-table.json
docs/optimization/truth-table.zh-CN.md
docs/optimization/truth-table.md
docs/optimization/state-machines.zh-CN.md
docs/optimization/state-machines.md
docs/optimization/timing-diagrams.zh-CN.md
docs/optimization/timing-diagrams.md
tools/build-truth-table.mjs
tools/verify-truth-table.mjs
preset/plugins/commands.js            (new)
test/truth-table.test.mjs             (new)
test/state-machine.test.mjs           (new)
test/docs-consistency.test.mjs        (new)
test/authority-boundary.test.mjs      (new)
test/preset-composition.test.mjs      (new)
test/prompt-sections.test.mjs         (new)
docs/optimization/comment-style.zh-CN.md
test/comment-style.test.mjs           (new)
preset/agent.cordis.yml               (changed)
preset/plugins/prompts.js             (changed)
preset/plugins/clearai-kernel.js      (changed)
ui/lib/*.js                           (changed only if the menu / runtime card needs it)
docs/**                               (aligned)
README.md / README.zh-CN.md / CHANGELOG.md
```

## 7. How execution proceeds

Phase by phase from Phase 0, recording the commands run and their results in
`progress.zh-CN.md`, reporting to the user at the end of each phase (what shipped, the verification
output, the next phase). Product decisions that need a human (the final `/` command names, whether to
add `dsh-command-feedback`) are raised separately and do not block the other phases.
