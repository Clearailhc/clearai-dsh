# Domain Ontology and Typed Facts: the execution plan

> This is the **approved execution plan** and the basis for all `0.2.0` work.
> Concept and design live in [`domain-ontology.md`](../domain-ontology.md); at the end of each stage **append one line to that stage's section below** — deliverables / commands run / actual output / blockers. No second progress ledger is kept.
> Chinese master: [`domain-ontology-plan.zh-CN.md`](domain-ontology-plan.zh-CN.md).

## 0. Goal and success criteria

1. A project can build a **domain ontology graph**: concepts are nodes, predicates are directed edges with domain/range, and value forms and constraints are checkable.
2. Facts gain **content form**: `fact = assertion + epistemic metadata`; plain text, formulae, code, numbers and references are the five value forms of an assertion, not five kinds of fact.
3. Hypotheses and facts are linked **by id**, fixing today's fragile `text`-equality match.
4. The graph can be **rendered** (a Markdown + Mermaid shelf, and the **graph band inside the facts view**: ontology graph / entity graph) and **edited** — and every edit lands as a **named governance verb**; graph editing writes no files and produces no layout events.
5. Add/revise/deprecate has exactly three semantics: **registration with a basis / versioned revision (a semantic change takes a new id) / sticky deprecation (no delete)**.
6. Conflicts are **mechanically derived**: the same single-valued predicate, the same subject, different objects, neither side retracted. They are **surfaced only — never auto-adjudicated and never auto-retracted**.
7. Every read surface (shelf / panels / runtime card / graph) comes from **the same fold projection**; no second account. Old ledgers (no ontology events, no assertions) replay unchanged.
8. `npm test` (15 suites with the new one), `npm run build`, `npm run verify`, `npm run verify:install` all green, with an end-to-end scenario that includes the graph-editing chain.

## 1. Verified code facts (plan baseline)

These are **code facts** (as of `0.1.7`; line numbers drift, symbol names are authoritative):

| Fact | Location |
|---|---|
| Projection state version `STATE_VERSION = 9` | `ui/lib/fold.js:40` |
| Fact promotion folds into `facts[]` (`text/scope/level/evidence/path`) | `ui/lib/fold.js:474` |
| **Hypotheses and facts match by text equality**: `fact.text === mutation.claim` | `ui/lib/fold.js:293` |
| The ontology declaration is **data**: nine objects + five levels, `validateOntology` at assembly, `describeOntology` for rendering | `preset/plugins/ontology.js` |
| Model tools are defined with `defineTool`; `SetGoal` / `CloseGoal` live here | `preset/plugins/clearai-kernel.js:2676` / `:2786` |
| Promotion happens inside `CloseGoal`: `t: 'fact/promoted'` carries only `goal/text/scope/level/evidence/path` | `clearai-kernel.js:2908` |
| Fact shelf render/write: `renderFactsIndex` / `ensureFactsShelf` → `clear/knowledge/facts/INDEX.md` | `clearai-kernel.js:2556` / `:2589` |
| Process-ontology shelf `ensureOntologyShelf` → `clear/ontology/verification-loop.md` | `clearai-kernel.js:2617` |
| System-owned paths the model may not write (`clear/evidence`, `clear/knowledge/facts`, `clear/goals`) | `clearai-kernel.js:5847` |
| Host HTTP surfaces go through `connection.fetch.register`: `/api/clearai/gate` (the human-signed ledger door) | `ui/lib/index.js:367` |
| Read-only surfaces: `/api/clearai/deliverables`, `/api/clearai/brain` | `ui/lib/index.js:502` / `:574` |
| Sidebar tab registration `sidebarRightTabs.register({id, kind, title, guide})`; injected `slots/sessions/sidebarRightTabs/sidebarRight` | `ui/lib/client.js:2895` / `:119` |
| **23** prompt sections, classified hard/native/advisory and pinned by the `prompt-sections` suite | `preset/plugins/prompts.js`, `test/prompt-sections.test.mjs` |
| **14** test suites, listed in `test/run.sh` | `test/run.sh` |

## 2. Design principles

- **First principles**: the loop governs *why believe it*, the ontology governs *in what language it is said*. Anything computable (state, progress, conflict, layout) is neither spoken nor stored.
- **Occam's razor**: no machinery for consumers that do not exist. No OWL/RDF/SHACL/SPARQL, graph databases, reasoners or entity resolution; no `Proposal/Review` state machine (this version has no batch induction).
- **A graph is a projection, not storage**: the ontology and entity graphs are both computed by `fold`; layout is a deterministic pure function and never enters the ledger.
- **Inexpressible beats unviolatable**: the ontology only lands through named verbs; neither the model nor the UI can structurally write `clear/ontology/`.
- **No delete — only versioned revision and sticky deprecation**; a semantic change must take a new id, and the meaning of a stable id may not drift through history.
- **Lenient plus validated**: assertions are optional; omission passes, and supplying one is checked strictly (unknown predicate/term, out-of-domain types, an invalid object form, or a self-conflicting fact is refused).
- **Each stage independently verifiable**: `npm test` is green at the end of every stage; behaviour changes and cleanups are separate commits, rollback per stage.

## 3. Stages and deliverables

### Stage A: concept and model settled (documents first)

**Deliverables**

- `docs/domain-ontology.zh-CN.md` / `docs/domain-ontology.md` (landed)
- This plan (`docs/optimization/domain-ontology-plan.zh-CN.md` / `.md`)
- The event vocabulary, the assertion JSON shape and the `graphProjection` contract, written into the design document

**Acceptance**

- A worked example explains concepts / predicates / assertions / facts / ontology graph / entity graph;
- The boundary is explicit: the process ontology is the backend flow — not ledgered, not runtime-editable, visible only as a state shape.

**Rollback**: documents only; delete them.

### Stage B: pure functions and fold (no behaviour change yet)

**Deliverables**

- A new pure-function module shared by kernel and client: value-form enumeration, term/predicate/assertion validation, domain and range checks, `is_a` cycle detection, deterministic layout, `graphProjection`, `lexiconHealth`;
- `ui/lib/fold.js`: fold six ontology event kinds into `state.lexicon`; `fact/promoted` gains `hypothesis` and `assertions`; hypothesis↔fact keyed by id; derived `conflicts`; `STATE_VERSION` 9 → 10;
  (`state.ontology` is **already taken** — it is the process-ontology shape. The domain vocabulary gets its own `state.lexicon`; two fields, two kinds of authority.)
- `test/domain-language.test.mjs` (new suite) and a line in `test/run.sh`.

**Acceptance**

- The new suite is green: unique ids, references exist, value-form enumeration, acyclic `is_a`, deprecated entries unusable for new assertions, a semantic revision must take a new id, per-form validation for all five value forms, intra-fact consistency;
- The same ledger replays to the same graph data and the same default layout;
- Old ledgers (no ontology events, no assertions) fold **field-for-field unchanged**;
- `npm test` green (no new kernel verbs are wired yet).

**Rollback**: revert the stage commit; `STATE_VERSION` returns to 9 and old ledgers are unaffected.

**Progress — done**

Delivered:

- `ui/lib/domain-language.js` (new): value-form and object-kind enumerations, `applyLexiconMutation`, `validateTerm` / `validatePredicate` / `validateAssertion(s)`, `objectKey` / `subjectKey`, `deriveConflicts`, `lexiconHealth`, `graphProjection` (with deterministic layout and bounds), `formatAssertion` / `formatObject`;
- `ui/lib/fold.js`: `STATE_VERSION` 9 → 10; `emptyState().lexicon`; six ontology event kinds fold into `state.lexicon`; `fact/promoted` gains `hypothesis` and `assertions`; hypothesis↔fact keyed by id (legacy ledgers still match by text); `derive()` gains `lexicon` / `conflicts` / `lexiconIssues`; `view()` gains `lexicon` (including the graph projection); the runtime card gains a vocabulary line and a conflict line;
- `tools/build-package.mjs`: copies `domain-language.js` into the package (without it, the packaged fold fails to resolve its import);
- `test/domain-language.test.mjs` (new, 92 assertions) and the `domain-language` column in `test/run.sh`;
- `docs/optimization/state-machines.{zh-CN,md}`: new §12 Domain lexicon (six events + state diagram + four points), six rows added to the event coverage table;
- suite count 14 → 15 (README both languages · dsh-integration both languages · release-verification).

Verification:

```text
$ node test/domain-language.test.mjs                     → 92 passed, 0 failed
$ node test/state-machine.test.mjs                       → 43 passed, 0 failed
$ node test/docs-consistency.test.mjs                    → 13 passed, 0 failed
$ node tools/build-package.mjs
$ npm_config_cache=… node tools/verify-package.mjs       → 32 passed, 0 failed · 157 files
$ DSH_HOME=<temp home + built package> bash test/run.sh
  round 1 · kernel:686 · host:89 · brain:40 · client:200 · domain-language:92 · ontology:96 ·
  truth-table:24 · state-machine:43 · docs:13 · comments:7 · boundary:14 · composition:20 ·
  sections:13 · long-run:41 · invariant:27 → all green (1 round)
```

Notes (three things actually hit in this stage):

- **`state.ontology` was already taken**: it is the process-ontology shape pushed with the projection (design doc §2.2), so the domain vocabulary gets its own `state.lexicon` — two fields, two kinds of authority. The plan's original `state.ontology` wording was corrected in place.
- **The cross-check regexes cannot see hyphenated event names**: two existing suites extract event names with `[a-z_]+`; an event named `ontology/term-added` would be invisible on **both** the declaration side and the document side, so "declared but never checked" would hold silently. The names were changed to the repository's snake_case (`ontology/term_added`) and the new suite pins that naming.
- **Local deployment is not synced (not a defect of this stage)**: the host and client suites run against the **deployed** artifact, and `~/.dsh` currently holds the 0.1.7 package. This stage verified with the built package plus a temporary `DSH_HOME`; making `npm test` green in place needs the product-form reinstall `node tools/build-package.mjs && node tools/install-native.mjs --profile web` (it would modify the local profile, so it was not run unasked).


### Stage C: kernel governance actions

**Deliverables**

- New tools: `RegisterTerm`, `RegisterPredicate`, `ReviseTerm`, `RevisePredicate`, `DeprecateTerm`, `DeprecatePredicate`, `QueryKnowledge`;
- `SetGoal` hypotheses accept optional `assertions` (validated when supplied); `CloseGoal` promotion carries the `hypothesis` id and `assertions`;
- Conflict derivation wired into the card and the projection (surfaced only);
- `clear/ontology/` added to the model-side protected-path list;
- `ensureOntologyShelf()` extended to render the domain ontology Markdown + Mermaid read surface.

**Acceptance**

- Positive and negative cases for every tool: an unknown predicate, an unknown or deprecated term, an out-of-domain type, an invalid object form, or a self-conflicting fact is refused;
- A promoted fact carries the `hypothesis` id and its assertions;
- A hypothesis without assertions still promotes (lenient plus validated);
- With two conflicting facts present, the projection reports the pair and **neither fact is modified automatically**;
- A direct model write under `clear/ontology/` is refused.

**Rollback**: revert the stage commit; no new events are produced, `state.lexicon` is empty, and nothing else is affected.

**Progress — done**

Delivered:

- The host-half facade gained `domain`: `validateTerm` / `validatePredicate` / `validateAssertions` /
  `renderShelf(sessionId, mutations)` / `format` — **one set of rules** (`ui/lib/domain-language.js`) that the
  preset plane calls through this door instead of copying.
- Seven named verbs (`preset/plugins/clearai-kernel.js`): `RegisterTerm` / `RegisterPredicate` / `ReviseTerm` /
  `RevisePredicate` / `DeprecateTerm` / `DeprecatePredicate` / `QueryKnowledge`; `MECHANISM_TOOLS` gained an
  `ontology` entry (22 → 29 tools, still cross-checked both ways against `defineTool` at assembly).
- `SetGoal` hypotheses may carry `assertions` (strict once supplied: references exist, forms fit the range,
  one fact self-consistent — all refused before anything lands); `CloseGoal` promotion carries the
  `hypothesis` id and the `assertions`, so **identity and content are fixed together**.
- One fold gap closed: hypotheses in `goal/set` carry `assertions` (otherwise promotion could not see them).
- Shelf: `ensureDomainShelf` renders `clear/ontology/domain.md` (concepts / predicates / Mermaid graph /
  usage counts / deprecations / conflicts), rewritten after every verb and once per pre-step (idempotent);
  `clear/ontology/` joined the model-side write-protection list.
- Prompt: a new `clearai/domain-language` section (hard; 24 defined / 23 in place).
- Tests: 32 new assertions in the kernel suite (verb positive/negative cases, the assertion chain, conflicts
  surfaced but never adjudicated, the shelf, write protection, queries); two truth-table rows moved from
  design-target to implemented (`ontology-verbs` / `assertion-validation`).

Verification:

```text
$ node test/kernel.test.mjs                          → 718 passed, 0 failed
$ node tools/verify-truth-table.mjs                  → 25/25 (64 mechanisms; snapshot 7 mechanisms / 29 tools / 23 sections in place)
$ DSH_HOME=<temp home + built package> bash test/run.sh → all 15 suites green
```

Notes:

- When the door is absent (a host half without `domain`) the seven verbs **refuse explicitly**
  (`domain_unavailable`) instead of throwing a TypeError — the real cause should not be disguised as a bad argument.
- Dimensional conversion and formula semantics are still not attempted; assertion validation stops at **shape**
  (see the "verified only to a stated depth" section of Known gaps).
- The ontology tab and graph editing remain stages D–E: today the vocabulary and graphs have only the shelf
  and two card lines as read surfaces.


### Stage D: the ontology fused into the facts view (band + index + chips)

> **The settled design is [Domain ontology §9](../domain-ontology.md)**: the ontology gets no tab of its own; it grows into the middle column's facts view. The layout, the six "no explosion" contracts, and the defaults for the two graphs all live in that section.

**Deliverables**

- A **graph band** at the top of the facts view (middle column `conversation.view`, **no new tab or view**): ontology graph ｜ entity graph toggle (~200px, zoom and pan, `⤢` panorama that lifts the node cap and offers "fit"), where **clicking a node filters** the shelves below by concept;
- Conflicts: one pointer line (only when they exist) plus **inline conflict marks on the affected fact rows**;
- **Assertion chips** on fact and proposition rows that expand a term card **in place** (gloss / basis / subject domain / range / single-valuedness / uses; actions: filter by this concept, see it in the graph);
- A collapsed **vocabulary maintenance block** (term table / health / deprecations / "open the shelf"; auto-expanded when there are 0 facts and 0 propositions but vocabulary exists);
- A filter status line (N/M + clear);
- Assertions exposed in the projection (`view().facts[].assertions`, `view().goal.hypotheses[].assertions`).

**Acceptance**

- **Zero-cost contract**: with no vocabulary this view is pixel-for-pixel what it was (pinned by a fixture whose projection has an empty lexicon);
- The same ledger shows the **same nodes / edges / states** in the Markdown shelf, the runtime card and the band;
- After a node click the N/M line tells the truth and `✕` clears in one action;
- An assertion chip expands **in place**, never jumping to another view;
- Deprecated entries are dashed ghosts in the graph and carry their reason in the maintenance block;
- Locale keys exist in both languages.

**Rollback**: revert the stage commit; the facts view returns to its two shelves (the band and the chips are purely additive).
**Progress — done (panel side)**

Delivered:

- the projection gained `chip` (one human line per assertion, computed by `formatAssertion` on the projection side; the client only renders);
- the ontology view assembled: conflict line (only when present) → graph band → filter line → ontology shelf → propositions → collapsed vocabulary maintenance; the zero-cost contract (pixel-identical without vocabulary) is pinned by a test;
- **graph band**: ontology | entity toggle, wheel zoom, drag pan, "reset"/"panorama" (panorama lifts the 40-node cap); clicking a concept/instance node filters by concept; an edge click shows a one-line detail; conflict edges are red;
- **assertion chips**: on fact rows and proposition rows (propositions marked "not yet promoted"), expanding a term card **in place** (gloss / subject domain / range / single-valuedness / basis; actions: filter by this predicate, see it in the graph);
- **conflicts**: one pointer line plus inline marks on the affected rows;
- **filtering**: assertion hit ∨ text/alias hit (the `termMatches` predicate is a pure function exported through the `__ontology` seam); the N/M line tells the truth and clears in one click;
- **maintenance block**: term table / health / deprecations (with reasons) / "open the vocabulary shelf"; auto-expands at 0 facts, 0 propositions with vocabulary present;
- ~30 bilingual locale keys.

Verification:

```text
$ node test/client.test.mjs   → 211 passed, 0 failed (11 new ontology-view assertions)
$ bash test/run.sh            → all 15 suites green
```

Notes:

- zoom/pan/panorama interaction is not verified in a real browser (the string-render stub checks structure only) — listed for the stage-G walkthrough;
- the README panel screenshots still carry pre-rename copy; retake them together with the ontology-view walkthrough (already recorded in known-gaps).


### Stage E: graph editing and the host route

**Deliverables**

- `POST /api/clearai/ontology`: accepts only a whitelist of named verbs, reuses the kernel's own validation, lands mutations with the human actor;
- An edit drawer: add concept / add predicate / revise / deprecate, with a basis field; local draft → apply;
- The graph and the shelf refresh after an apply.

**Acceptance**

- One graph edit traces to exactly one named event, signed as human;
- A panel refresh loses nothing (replaying the ledger yields the same result);
- Dragging, zooming and filtering produce **no** ledger event (pinned by the authority-boundary suite);
- The UI and the model tools give the same rejection reason for the same invalid input (one shared validation function).

**Rollback**: revert the route and the client editing surface; read-only rendering (stage D) is unaffected.

### Stage F: documents, case and quality checks

> **The document half landed early (a dedicated documentation sweep)**: the design document gained an
> "Interaction with the state machines and the flows" section (§8: three non-nesting state machines, four
> handshake points, the read-surface table, where it stands today); `state-machines` gained a vocabulary
> section and an interaction subsection; `timing-diagrams` gained a sixth path (domain-ontology path ·
> partially implemented); `verification-loop` gained the process/domain ontology comparison; and the
> glossary (22 entries), authority map (the four new fact classes), soul map (a graph is a projection /
> a semantic change takes a new id), design principles (the same two), the epistemic loop (a boundary),
> the coverage matrix and the truth table (58 → 64 mechanisms) were all aligned.
> A batch of stale statements was removed at the same time: the `retracted` producer, observation
> provenance, turn-end bookkeeping (`clearai/turn-ended` is deleted), the remaining dangling-audit risk,
> and one leftover `turn-ended` reference inside the truth table itself.
> One more mechanical gate was added for this class of drift: `test/docs-consistency.test.mjs` now checks that
> **every relative `.md` link resolves to a real file** (the dead link found in this sweep is exactly what it
> catches, and it carries a negative self-test).
> **What remains**: the case write-up (physical-experiment, both languages, adding "typed fact → conflict →
> human decision"), the README version story, and the CHANGELOG.


**Deliverables**

- Design and plan documents kept bilingual; glossary gains domain ontology / concept / predicate / assertion / value form / instance / ontology graph / entity graph / conflict;
- `docs/epistemic-loop.*.md`, `docs/design-principles.*.md`, `docs/authority-map.*.md`, `docs/known-gaps.*.md` aligned;
- New truth-table rows (admission / revision / deprecation / assertion validation / conflict derivation / graph projection / ontology route), each with a code anchor;
- One case document (physical-experiment, bilingual): register concepts → typed hypothesis → promotion → a conflict on the graph → a human decision;
- `README.md` / `README.zh-CN.md` doc index and `CHANGELOG.md`.

**Acceptance**

- Every "implemented" statement in the docs points at code and a test; everything else is marked a design target;
- The `docs-consistency`, `truth-table` and `state-machine` suites are green.

**Rollback**: document changes revert independently of behaviour.

### Stage G: full verification and release

```text
npm test                      # 15 suites green
npm test 2                    # twice in a row
node tools/build-package.mjs
node tools/verify-package.mjs
node tools/verify-clean-install.mjs
node tools/e2e-parallel.mjs
```

Real-browser walkthrough: register a concept and a predicate → edit on the graph → raise a typed hypothesis → promote → entity graph → conflict → retract → refresh.

**Release conditions**: all of the above green; the built package is byte-identical to source; clean install passes; the end-to-end graph-editing chain passes; known gaps updated.

## 4. Test matrix

| Layer | Suite | Coverage |
|---|---|---|
| Pure functions | `domain-language` (new) | Value forms, domain/range, `is_a` cycles, intra-fact consistency, deterministic layout, `graphProjection`, `lexiconHealth` |
| Projection | `kernel` / `state-machine` | Six event kinds fold, id-based linking, derived `conflicts`, old ledgers unchanged, `STATE_VERSION` |
| Kernel | `kernel` | Positive/negative cases for seven new tools, the `SetGoal`/`CloseGoal` typed chain, conflicts surfaced only |
| Client | `client` | Tab registration, both graphs, ghosts/conflicts/truncation, cross-navigation, locale |
| Authority | `authority-boundary` | Neither model nor UI can write `clear/ontology/`; layout never lands in the ledger |
| Documents | `docs-consistency` / `truth-table` / `state-machine` | New mechanism rows match code anchors; no stale statements |
| Long run | `e2e-scenarios` / `invariant` | Typed facts end to end; conflicts never auto-adjudicated; the same graph on replay |

## 5. Risks and rollback points

| Risk | Handling |
|---|---|
| The ontology becomes a second account (someone hand-edits `domain.json`) | The file is not created; the shelf is a rendering; the authority suite pins it |
| Assertion validation too strict, blocking promotion | Lenient plus validated: assertions optional, strict only when supplied |
| Graph editing produces untraceable state | Edits only invoke verbs; a whitelisted route; layout never lands in the ledger |
| New fold events break old ledgers | They are purely additive; old ledgers never contain them; stage B asserts field-for-field equality |
| A graph in a narrow column is unusable | The first version is drawer-driven; drag-to-connect is a later enhancement |
| A conflict mistaken for a verdict | Conflicts are derived readings; they never modify facts; retraction goes through the existing `fact/reviewed` |

## 6. Explicitly not doing

OWL/RDF/SHACL/SPARQL and reasoners; graph and triple stores; automatic ontology induction and batch proposals; large-scale extraction and entity resolution; complex rule reasoning and transitive closure; cross-project or user-level ontology libraries; dimensional conversion and numeric tolerances; automatic overwriting, retraction or conflict adjudication; direct editing of authoritative ontology files; drag-to-connect as the only editing mechanism in the first version.

## 7. Relation to the existing plan

This plan follows [`plan.md`](plan.md) (epistemic-core convergence and harness slimming): that round raised the **loop**; this round gives the loop's output its **form**. Both share one discipline — anything computable is not spoken, and anything that must be a boundary lands in schema, registry, projection or tests.
