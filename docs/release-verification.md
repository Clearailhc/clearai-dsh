# Release verification

What to run before handing this plugin to someone else. Order is priority. Every row states its criterion, how it is checked, and the passing line. Mechanical checks come first; the human gate is at the end, because some things only a real browser can settle.

The detailed Chinese working copy, including the per-component notes accumulated during development, is [release-verification.zh-CN.md](release-verification.zh-CN.md).

## How to run

```bash
npm test                                                  # all 17 suites (list: test/run.sh)
node tools/build-package.mjs && node tools/verify-package.mjs
node tools/verify-deploy.mjs                              # compose the deployed files for real
node tools/recheck.mjs --log <a real session.v3.jsonl.zstd>   # suites + deploy + per-surface text budgets
bash tools/capture-ui.sh start                            # isolated home + web + debuggable Chrome
```

`recheck.mjs` needs a session with real content (a goal, a plan, steps, evidence, facts; a sim host `events.jsonl` works too). Without one it says so and skips the text-budget section rather than inventing numbers.

## 1 · Data plane

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| `fold.js` | Changes → projection is pure and replayable | `test/host.test.mjs` | green |
| Cross-plan index | A proposition's evidence is found even in an earlier plan | same | green |
| Provenance | Every evidence row carries resolvable origins; `refs` are paths | kernel suite | green |
| Artifact shape | `steps[].artifacts` normalises to `{path, exists}`; never claims "missing" without checking disk | client suite | green |

## 2 · Middle column: Ontology

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| **Header** | The question + one line of counts + "to handle" (statements only) + the progress rail (judgment → test → verified → in ontology) | client suite + text budget | green · ≤ 300 chars |
| **Graph** | Ontology graph / entity graph, one at a time; verified solid, awaiting check dashed; clicking a node opens its term card and filters the list | client suite + human look | green |
| **Conclusion list** | One line per conclusion, grouped verified / awaiting check / testing / uncertain / refuted / replaced; no internal ids on screen | client suite + text budget | green · ≤ 1500 chars |
| Opened conclusion | Progress → how trust changed → more; "see check" opens the evaluation card or the evaluator session | client suite + text budget | green · ≤ 1600 chars |

## 3 · Right column: World Tree

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| **World Tree** | One line per step (filled when done, outlined while running, hollow when not started); selecting a step shows which judgments it tested and what came out; **several plans switchable** (dropdown) | client suite + text budget | green · ≤ 900 chars |

## 4 · Tools row and continuation

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| Plan chip | One symbol only, progress; "to handle N" when something needs a person, one click opens the World Tree | client suite + text budget | green · ≤ 40 chars |
| Continuation | Driven by the native goal; ClearAI has no continuation window and no autonomy toggle; when a person is needed the native goal is set to blocked with the reason | kernel suite (native goal guard, blocking) | green |

## 5 · Human gates and jumps

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| Asked on the spot | L4 release, repeated plan rejections, a fact meeting counter-evidence: the call that opened the gate asks through the native question card; with nobody to answer, the goal waits as blocked | kernel suite | green |
| To handle | A plan stopped after repeated rejections, contradicting conclusions: one line each, statements only, no buttons; header and input box read the same list | client suite | green |
| Origins | Evaluation card ⇒ native preview; evaluator ⇒ spectator session | client suite (§27b) | green |
| **Forward jump** | "See this step in the World Tree" opens the tree with **that row selected** (switching plans if needed) | client suite + **human click** | green · human pass |
| **Backward jump** | Tree detail "see the evidence for this step" switches to the Ontology pane and opens the matching conclusion | client suite (§27e) + **human click** | green · human pass |

## 6 · Kernel behaviour

| Surface | Criterion | Check | Passing line |
|---|---|---|---|
| Ten tools | `Frame`, `Conclude`, `CreatePlan`, `AdvancePlan`, `RevisePlan`, `ClosePlan`, `Define`, `Deprecate`, `RegisterInstance`, `Assert`; output-schema validation and semantic refusals both asserted | `test/kernel.test.mjs` | green |
| Single completion verb | Progress only through `AdvancePlan`; completion means the delivery holds, the result is recorded separately as evidence; the doer cannot judge its own result (L3 and up go to an independent evaluator) | same | green |
| Closing | `Conclude` completes the native goal and promotes only after independent evaluation; one entity gate; the native `update_goal(complete)` is stopped by the guard | same | green |
| Shelves | Fact shelf and ontology shelf rebuild idempotently | same | green |
| Prompt | Three sections (identity / loop / speaking), classification matches content; no internal ids in cards or tool results | `test/prompt-sections.test.mjs`, `test/readability.test.mjs` | green |
| **Host-side invariants** | Five contracts (referential integrity / admission before advance / no settlement without dispatch / promotion is backed / the fact ratchet) judged **before the append**; a violation raises the host's `InvariantError` owned by `clearai-dsh`. **Scope**: a diagnostics surface — the shipped web/headless profiles do **not** mount the service; it is live only where the host already mounts it, plus our long runs. State advances through the production fold (`applyEvent` in `fold.js`); the file keeps only the five contracts plus one `admitted` accumulation (see [authority map](authority-map.md) §2④) | `test/invariant.test.mjs` | green · no `invariant violated` in long runs |

## 7 · Packaging and install

| Surface | Criterion | Check | Passing line |
|---|---|---|---|
| **Clean install (zero)** | Empty `DSH_HOME`, official template, **real pnpm**, real `dsh plugin add` — no file edits | `node tools/verify-clean-install.mjs` | 16/16 |
| Clean install (browser) | A real session on that home shows our views and runs a task | `--ui`, then the browser steps below | human pass |


| Surface | Criterion | Check | Passing line |
|---|---|---|---|
| Artifact | Byte-for-byte rebuildable, exports present, file inventory stable | `build-package.mjs` + `verify-package.mjs` | 25/0 |
| Install | Three landing points correct; automatic backup before overwrite; one-command rollback | `install.sh` + `backup-home.sh` | self-check passes |
| Isolated real start | Real `DSH_HOME`, real `dsh web`, real Chrome: session starts, panels mount | human gate below | all pass |

---

## Human gate

In an isolated home — never your own:

```bash
bash tools/capture-ui.sh start          # copies ~/.dsh to /tmp/clearai-shots and installs the built package
```

Then, in the browser (`node tools/recheck.mjs` prints the same list at the end):

1. **Start a session** and send one message — the model answers (the plugin does not break the app).
2. The middle column has one pane, **Ontology**; the right sidebar offers the **World Tree**.
3. On a session with evidence: the header shows the question, counts and the progress rail; the ontology and entity graphs toggle; conclusions are one line each, grouped by status, with no `h-…` ids on screen.
4. Opening a conclusion shows progress → how trust changed → more; "see check" opens the evaluation card or the evaluator session.
5. Clicking **"see this step in the World Tree"** opens the tree with **that row selected**.
6. In the tree detail, **"see the evidence for this step"** switches to the Ontology pane and opens the matching conclusion.
7. With several plans, the dropdown switches to an older tree and marks it archived.
8. When something needs a person, the header and the input box both show "to handle N", statements only, no buttons; the decision is asked through the native question card.

Any failure means: do not release. Go back to that component's suite and add a regression first.

## Clean-install checklist (the release gate)

`node tools/verify-clean-install.mjs --ui` builds the package, installs it into an empty home with the
real CLI and pnpm, and asserts the sixteen mechanical facts (dependency, bundles exactly once, exactly one
host row, roster root inside the package, shipped roots intact, preset self-contained, no machine paths).
Then, in the browser it prints:

1. a session opens on the **ClearAI** preset and the middle column shows **Ontology**;
2. the right sidebar offers the **World Tree**;
3. send one small task (e.g. "copy `input.md` to `lab/echo.md`, and frame a goal for it");
4. the ledger records `goal/set`, and `lab/echo.md` exists;
5. the page console has no errors.

Two things the tool cannot do for you, both environmental rather than product: the native workspace
picker cannot be driven headless (the tool registers a scratch workspace instead), and the clean home
must borrow `~/.dsh/.credentials.yaml` — **nothing else**, because copying `settings.yaml` drags in a
provider that a clean profile does not have.

## Known unverified items

- **Backward/forward jumps clicked by a human.** Mechanism and data are verified; the end-to-end click needs a session with a plan and evidence.
- **The client half is cached inside the host process too.** After installing, restart `dsh web`; refreshing the browser is not enough.
