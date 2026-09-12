# Release verification

What to run before handing this plugin to someone else. Order is priority. Every row states its criterion, how it is checked, and the passing line. Mechanical checks come first; the human gate is at the end, because some things only a real browser can settle.

The detailed Chinese working copy, including the per-component notes accumulated during development, is [release-verification.zh-CN.md](release-verification.zh-CN.md).

## How to run

```bash
npm test                                                  # all five suites
node tools/build-package.mjs && node tools/verify-package.mjs
node tools/verify-deploy.mjs                              # compose the deployed files for real
node tools/recheck.mjs --log <a real session.v3.jsonl.zstd>   # suites + deploy + per-surface text budgets
bash tools/capture-ui.sh start                            # isolated home + web + debuggable Chrome
```

`recheck.mjs` needs a session with real content (a goal, a plan, steps, evidence, facts, skills). Without one it says so and skips the text-budget section rather than inventing numbers.

## 1 · Data plane

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| `fold.js` | Changes → projection is pure and replayable | `test/host.test.mjs` | green |
| Cross-plan index | A proposition's evidence is found even in an earlier plan | same | green |
| Provenance | Every evidence row carries resolvable origins; `refs` are paths | kernel suite | green |
| Artifact shape | `steps[].artifacts` normalises to `{path, exists}`; never claims "missing" without checking disk | client suite | green |

## 2 · Middle column

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| **Deliverables** | One row per file, deduplicated by path; the two counting units stay separate | client suite + text budget | green · ≤ 1200 chars |
| **Facts** | Only confirmed propositions are shelved; unshelved ones group by ontology state; machine fields stay off screen | client suite + budget | green · ≤ 1500 chars |
| Proposition map | Horizontal trunk plus branches; only traversed transitions carry evidence ids | client suite + human look | green · ≤ 1600 chars |

## 3 · Right column

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| **Worldlines** | A selected row has detail; multiple plans are switchable | client suite + budget | green · ≤ 900 chars |
| **Skills · memory** | One row per recognisable entry; machine readings go to tooltips | client suite + budget | green · ≤ 2600 chars |

## 4 · Tools row and continuation note

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| Plan chip | Clickable while a plan awaits review or is blocked, in plain words | client suite | green |
| Continuation | Rides native `goals`; stops while any gate is open; the round cap is a fuse | kernel + host suites | green |
| Note text | Facts only; human gates first; no stale "step N" after closure | client suite + budget | green · ≤ 60 chars |

## 5 · Human gates and jumps

| Component | Criterion | Check | Passing line |
|---|---|---|---|
| Inbox | Anything waiting on a person is stated first | client suite | green |
| Native question card | Clicking our row raises the native card; the answer lands on the same gate message | host suite | green |
| Four origin kinds | Artifact / evaluation card → native preview; evaluator → observe the sub-session; approval → stated plainly | client suite | green |
| Forward jump | "See this step in the world tree" opens the tree with exactly that row selected | client suite + human click | green · human pass |
| Backward jump | "See the evidence for this step" switches to facts and expands the owning proposition | client suite + human click | green · human pass |

## 6 · Kernel behaviour

| Surface | Criterion | Check | Passing line |
|---|---|---|---|
| Intent tools (22) | Output-schema validation and semantic refusals are both asserted | `test/kernel.test.mjs` | green |
| Single completion verb | Progress only through `AdvancePlan`; the doer cannot judge its own result | same | green |
| L4 release | The native approval pair is the only authority | same | green |
| Shelves | Fact shelf and ontology shelf rebuild idempotently | same | green |

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

Then, in the browser:

1. **Start a session** and send one message — the model answers (the plugin does not break the app).
2. The middle column shows **deliverables** and **facts**; the right sidebar offers **worldlines** and **skills · memory**.
3. On a session with evidence: the proposition map marks traversed transitions with evidence ids; clicking an origin opens the real artifact.
4. Clicking **"see this step in the world tree"** opens the tree with **that row selected**.
5. In the tree detail, **"see the evidence for this step"** switches back to facts and expands the matching proposition.
6. Step artifacts show real paths, never `undefined`; nothing is labelled missing without a disk check.
7. With several plans, the header dropdown switches to an older tree and marks it archived.
8. After a goal closes, no stale "step N" remains anywhere.
9. There is **no** autonomy toggle in the tools row, and creating a plan **always** raises the native plan review — the run does not proceed until a human approves.

Any failure means: do not release. Go back to that component's suite and add a regression first.

## Clean-install checklist (the release gate)

`node tools/verify-clean-install.mjs --ui` builds the package, installs it into an empty home with the
real CLI and pnpm, and asserts the sixteen mechanical facts (dependency, bundles exactly once, exactly one
host row, roster root inside the package, shipped roots intact, preset self-contained, no machine paths).
Then, in the browser it prints:

1. a session opens on the **ClearAI** preset and the middle column shows **Deliverables / Facts**;
2. the right sidebar offers **Worldlines** and **Skills · Memory**;
3. send one small task (e.g. "copy `input.md` to `products/echo.md` and set a goal for it");
4. the ledger records `goal/set` and an audit pair, and `products/echo.md` exists;
5. the page console has no errors.

Two things the tool cannot do for you, both environmental rather than product: the native workspace
picker cannot be driven headless (the tool registers a scratch workspace instead), and the clean home
must borrow `~/.dsh/.credentials.yaml` — **nothing else**, because copying `settings.yaml` drags in a
provider that a clean profile does not have.

## Known unverified items

- **Backward/forward jumps clicked by a human.** Mechanism and data are verified; the end-to-end click needs a session that actually promoted a fact.
- **Skill descriptions remain longish** (18 entries × ~60 chars). Compressing further would make skills unrecognisable.
- **The memory pane grows** with entry count; a file-name-only default is the next step if it gets noisy.
- **The client half is cached inside the host process too.** After installing, restart `dsh web`; refreshing the browser is not enough.
