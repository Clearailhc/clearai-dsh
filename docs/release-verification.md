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

## 2 · Middle column: Explore

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| **Header** | The topic + tags for mode, survey areas, current question and plan progress | client suite | green |
| **Questions and candidates** | One block per question; candidates listed as being examined / excluded / adopted / set aside; opening one shows its source, refutation condition, prediction and related records; no internal ids on screen | client suite | green |
| **Next step** | What to do + each candidate's prediction; a note when the predictions are identical and the step cannot tell them apart | client suite | green |
| **Newly found questions** | "Make it a question" / "Park" only send a sentence to the model on the person's behalf and write no state; when sending fails, the pane says so | client suite | green |
| **Process record** | Collapsed by default; expanded it shows judgment counts and the progress rail, every judgment, and the plan's steps and gates (one line per step, several plans switchable) | client suite + text budget | green |

## 3 · Middle column: Ontology

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| **Answer cards** | Switchable per question, four parts: conclusion / basis / open points / for you to decide | client suite | green |
| **Graph** | Ontology graph / entity graph, one at a time; verified solid, awaiting check dashed; clicking a node opens its term card and filters the list | client suite + human look | green |
| **Established facts** | Only verified conclusions, one line each; opening one shows progress → trust changes → notes; "View check" opens the evaluation card or the evaluator session | client suite + text budget | green · ≤ 1600 chars |
| **Lessons** | Listed as common pitfalls / checks first / shortcuts to avoid / prior knowledge | client suite | green |

## 4 · Tools row and continuation

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| Native todo | Mirrors actual ClearAI plan progress through native `todo/write`; no obsolete plan chip; void steps excluded; restores after turn start | native-todos suite + real UI | green |
| Continuation | Driven by the native goal; ClearAI has no continuation window and no autonomy toggle; when a person is needed the native goal is set to blocked with the reason | kernel suite (native goal guard, blocking) | green |

## 5 · Human gates and jumps

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| Asked on the spot | L4 approval, repeated plan rejections, a fact meeting counter-evidence: the call that opened the gate asks through the native question card; with nobody to answer, the goal waits as blocked | kernel suite | green |
| To handle | A plan stopped after repeated rejections, contradicting conclusions: one line each, statements only, no buttons; Explore and the input box read the same list | client suite | green |
| Origins | Evaluation card ⇒ native preview; evaluator ⇒ spectator session | client suite (§27b) | green |
| **Pane jumps** | "View the exploration record" on an answer card opens Explore; "view the conclusion" on a question opens Ontology | client suite + **human click** | green · human pass |
| **Step → judgment** | "see the evidence for this step" in the plan detail of the process record opens the matching judgment | client suite (§27e) + **human click** | green · human pass |

## 6 · Kernel behaviour

| Surface | Criterion | Check | Passing line |
|---|---|---|---|
| Six tools | `Frame`, `Conclude`, `CreatePlan`, `AdvancePlan`, `RevisePlan`, `ClosePlan` (the ontology is written as files); output-schema validation and semantic refusals both asserted | `test/kernel.test.mjs` | green |
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
| Install (dev) | Builds the package and installs it through `dsh plugin add` (the same path as the product); `clearai-host` and `preset-clearai` both in the composition | `install.sh` (calls `build-package` + `install-native` + `verify-deploy`) | self-check passes |
| Isolated real start | Real `DSH_HOME`, real `dsh web`, real Chrome: session starts, panels mount | human gate below | all pass |

---

## Human gate

In an isolated home — never your own:

```bash
bash tools/capture-ui.sh start          # copies ~/.dsh to /tmp/clearai-shots and installs the built package
```

Then, in the browser (`node tools/recheck.mjs` prints the same list at the end):

1. **Start a session** and send one message — the model answers (the plugin does not break the app).
2. The middle column has two panes, **Explore** and **Ontology**; the right sidebar has no ClearAI tab.
3. On a session with evidence: the Explore header shows the topic and its tags, each question lists its candidate hypotheses, and the next step shows each candidate's prediction; no `h-…` ids on screen.
4. In Ontology: the answer card has all four parts; the ontology and entity graphs toggle; opening an established fact shows progress → trust changes → notes, and "View check" opens the evaluation card or the evaluator session.
5. On an answer card, **"View the exploration record"** switches to Explore.
6. Expanding the process record, **"see the evidence for this step"** in the plan detail opens the matching judgment.
7. With several plans, the dropdown in the process record switches to an older plan and marks it archived.
8. When something needs a person, Explore and the input box both show "to handle N", statements only, no buttons; the decision is asked through the native question card.
9. On a newly found question, **"Make it a question"** puts the sentence sent on your behalf into the conversation.

Any failure means: do not release. Go back to that component's suite and add a regression first.

## Clean-install checklist (the release gate)

`node tools/verify-clean-install.mjs --ui` builds the package, installs it into an empty home with the
real CLI and pnpm, and asserts the sixteen mechanical facts (dependency, bundles exactly once, exactly one
host row, roster root inside the package, shipped roots intact, preset self-contained, no machine paths).
Then, in the browser it prints:

1. a session opens on the **ClearAI** preset and the middle column shows **Explore** and **Ontology**;
2. the right sidebar has no ClearAI tab;
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
