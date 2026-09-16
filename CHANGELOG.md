# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] — 2026-09-16

**本版重点:子任务的交付链修好了。** 侦察与世界线执行者的结论此前只进账本、模型读不到
(账本里也有过「派出去就再也没人收」的挂空)。现在四类子任务(侦察 / 世界线执行者 /
评估者 / 横评仲裁)统一走原生 `subagents.start()` 的一次性句柄:账本只认本进程攥着的
`run.result`,结论正文由**收集那一刻的工具返回**交给模型,全文另落
`clear/knowledge/materials/<id>.md` 供模型、独立评估者与人共读。
试过的另一条路(拿运行时的结算通知当账本信号)已撤回——它是 best-effort,当不了承重结构。

### Added

- **ClearAI's own `/` command menu.** `/goal` `/plan` `/evidence` `/worldline` are read-only state windows computed from the ledger on the spot; `/plan-review` re-presents the active plan through the native review card instead of stamping anything itself (commands carry no mutation channel — the authority boundary test pins this).
- **Native working tools return.** todo, subagent (with model selection), workflow and ralph mount from the standard preset's own rows; the composition suite pins both directions — present: these four; absent: `tool-goal`, `command-goal`, `plan-mode` (the second ledger stays off).
- **`test/prompt-sections.test.mjs`.** All 23 prompt sections carry a `hard` / `native` / `advisory` class tag, and the suite pins that the classification matches the content (hard sections name a mechanism anchor; native sections name no kernel tool; advisory sections make no mechanism promises).

### Changed

- **Hypothesis floor is now a hard boundary.** `SetGoal` rejects zero or one hypotheses when `minHypotheses > 0` (kernel default 0 stays neutral; the preset sets 2). Revisions of an existing goal are exempt.
- **Authorization wording unified to one sentence everywhere.** Kernel messages, the runtime card and the prompts all say: an unapproved plan does not auto-continue; when you advance it explicitly, the first delivery records attribution as it happened (behaviour is authorization). The card says it in human words — ledger field names no longer appear.
- **Stale native-tool contracts rewritten.** `edit` is literal replacement, not unified diff; `web_search`/`web_fetch` parameter references that no longer exist were removed.
- **Comment debt cleared to zero.** ~310 comments rewritten to the style rule (why / what breaks / boundary — no dates, no internal section numbers, no incident narratives); the ratchet quotas are now {0, 0, 0}.

### Changed

- **Async sub-runs now deliver their conclusions through the runtime's own settlement notice.** `SpawnScout`, `MapScouts` and the worldline executors are started with `subagents.startContinuable()`, whose Activation delivers the child's closing message to the parent as a durable user message; the kernel keeps owning only what it must (the `scout/dispatched` / `scout/settled` ledger, the full-text material file under `clear/knowledge/materials/`, and the pointer on the runtime card). Evaluators and the arbitration reviewer stay on the one-shot path: the native durable-child descriptor deliberately omits `outputSchema`, which belongs to a one-shot activation's result contract.
- **Scout conclusions are persisted in full** to `clear/knowledge/materials/<id>.md` so the model, the independent evaluator and the human read the same copy; the ledger and the runtime card carry a pointer plus a bounded excerpt, and over-long text is marked `…truncated (N chars total, see <path>)` instead of being silently cut. The scout persona now caps its answer at 3000 characters.
- **A goal's closure records the hypotheses nobody touched.** `goal/closed` carries `unjudged`, the card writes `(untouched)` for a hypothesis with no evidence at all (distinct from "judged inconclusive"), and the loop contract asks for either one touch of evidence or an explicit note about why there was none — no verdict is ever forced.

### Fixed

- **`install.sh` aborted on macOS (bash 3.2).** It expanded an empty array as `"${OLD_PANEL_PKGS[@]}"` under `set -u`; bash only tolerates that from 4.4 on, while macOS ships 3.2 — so the documented developer install died at step ② for every macOS contributor. CI runs on Linux (bash 5), which is why it never caught it. Both expansions now use the portable `${arr[@]+"${arr[@]}"}` form.
- **Long-run evidence was overwritten or lost.** Every run now gets its own timestamped archive: the light half (stdout, structured result, provenance, decoded one-line-per-event trajectory, append-only index) is committed, while the heavy half (workspace, raw session log) stays on disk under `~/.dsh/e2e-archive/` so it can be re-judged offline with `tools/e2e-replay.mjs`. `--workspace` pointing inside any git repository is now refused outright: ClearAI commits each delivery into the workspace's own repository, so an in-repo workspace had the kernel commit its delivery snapshots — and the author's uncommitted work — into the host project.
- **Session-directory name derivation dropped dots.** DSH keeps `.` (and `_`) when it slugs a workspace path; the old rule folded both away, so a workspace under `~/.dsh/…` was reported as "no session log" (38 assertions red in one run). The rule is now taken from a real directory comparison.
- **Scout conclusions never came back in a scouts-only run.** `AwaitWorldlines` decided whether to keep waiting from the wait-lines produced by `sweepWorldlineExecutors()`, and `sweepScouts()` never produced one — so with only scouts in flight the loop exited on its first tick, even though `SpawnScout`'s own reply tells the model to "wait for it this turn with `AwaitWorldlines`". The one-shot form added a second layer: with no next turn, a conclusion that settled after the last tool call never met another collection point. `sweepScouts()` now reports how many scouts are still unsettled, `collectExecutors()` passes it through, and `AwaitWorldlines` counts it. Verified end to end: the same scenario that stalled twice (goal left open, evaluator refusing `inconclusive`) now finishes 36/36 with the conclusion in the material surface and the goal `achieved`.
- **Scout conclusions were invisible to the model even after they settled.** They landed only in the mutation record while the section the model reads every step is the runtime card — which had no material surface. Now delivery rides the native settlement notice, the card lists foreign observations (pointer + excerpt) plus the scouts still in flight, and a long-run invariant asserts that an async sub-run's conclusion appears in model-visible text rather than only in the ledger.
- **Scouts had no "lost" ending.** Worldline executors and evaluators already wrote one; a scout whose child was gone stayed "not yet reported" forever. The judgement now mirrors the evaluator's: in-process dispatches are alive, the native child catalog decides what is still running, and an unavailable read surface means *no judgement* rather than a fabricated one.
- **The prompt described `SpawnScout` as synchronous.** It said the conclusion comes straight back as the return value and that the tool waits; the kernel is deliberately asynchronous (the blocking wait used to lose the "dispatched" fact when a run was interrupted). The delegation table now teaches the real contract (fire-and-forget, conclusion replays into the material surface, wait with `AwaitWorldlines`), and a drift check pins it.
- **`AwaitWorldlines` counted mutations, not conclusions.** One scout writes two mutations (`scout/settled` plus the observation), so a single scout was reported as "回灌 2 条". The count and wording now speak of conclusions.
- **`clearai-commands` cross-plane import.** It imported `ui/lib/fold.js` from the preset plane; in the installed package the relative layout differs, so switching to the preset in a browser failed at import. The command renderers now use the host-provided `clearai` facade for `derive` as well, and the boundary suite pins that no preset plugin imports across planes.
- **macOS temp-path realpath mismatches.** Session-log lookup and clean-install workspace registration now resolve realpaths (`/var` is a symlink to `/private/var`), which had made e2e logs unfindable and browser session attach fail.

### Changed (sub-run lifecycle, unified)

- **All four sub-run kinds now share one native lifecycle.** Scout, worldline executor, evaluator and the arbitration reviewer all go through one-shot `subagents.start()` handles; the ledger settles from the `run.result` this process holds, and the conclusion text reaches the model in the tool return of the collecting call. The attempt to use the runtime's settlement notice as a ledger signal is withdrawn: a notice is best-effort, and a live kernel could not reliably see it through either the projection or its own session log. Role differences are now only persona, tool face, and how the result is interpreted — permission and authority boundaries are unchanged.
- **A scout's conclusion is recorded even when its in-memory entry exists.** The old collection guards skipped exactly the sub-runs the table was holding, so a scout could sit "dispatched, never collected" forever. The sweep now walks every unsettled sub-run in the projection, and de-duplication moved to a session+epoch map that also works after a restart.

### Tooling

- **Long-run end-to-end scenarios with offline re-judging.** Five scenarios (`worldline-arbitration`, `falsification`, `long-plan`, `scout-first`, `goal-chain`) plus a set of cross-mechanism invariants (no advance without admission, no dangling evaluator, no orphaned fork, promotion level consistency, no dangling scout, evidence bound to real steps, declared artifacts on disk). `tools/e2e-parallel.mjs` runs them concurrently (cap 3, because each run spawns its own worldline executors and evaluators), `tools/e2e-replay.mjs` re-judges a saved session log without spending tokens, and `test/e2e-scenarios.test.mjs` pins every invariant with a negative case so a mis-written judge cannot report a false green.

### Validated

- **deepseek-flash end-to-end, two headless scenarios** (24/24 plan-and-stop; 25/25 full completion including independent-evaluator settlement) and **one real-browser session** (clean install + Chrome): preset switching, native review-card approval landing `by='user'`, the full thirteen-beat chain, `/goal` rendering, and all four panels drawing — screenshots in `docs/shots/browser-e2e-*.png`.

## [0.1.3] — 2026-09-15

### Added

- **`npx clearai-dsh install` — one command, and the only prerequisite left is DSH's own.** The published package has always carried an install-side tool, but it only *diagnosed*: `doctor`, `root-yaml`, `seed`, `unseed`. The installer that could actually place the package lived in `tools/install-native.mjs`, which is not in the published files — so a stranger had nothing to run but `dsh plugin … add`, a command whose first word assumes a `dsh` that an `npx`-launched harness never puts on `PATH`. The new `install` verb resolves the CLI (a `dsh` on `PATH`, else `npx --yes @deepseek-ai/dsh`), installs into the profile, and then reads the composed config back to show that the `clearai-host` row really landed. `--dist` / `--tarball` / `--spec` point it at a local build instead of the registry, which is what the lifecycle check now exercises.

### Changed

- **The install instructions no longer teach a mechanism we do not own.** They handed the reader a `corepack enable` line as the way to get pnpm. Corepack is a version *router*, not an install: its 186-byte shim fetches a pnpm on first use, and corepack 0.34 — the one Node 24 ships — launches pnpm by looking for `bin/pnpm.cjs`, which pnpm 11 and later no longer provide. It can therefore fetch a version it is unable to run, and its shims can shadow a pnpm that already worked. The docs now name the requirement (a `pnpm` on `PATH`, which is DSH's rather than ours) and leave the choice of how to satisfy it to the reader.
- `install` does not bootstrap a profile or hand-reconcile one. The CLI initializes a profile the first time it is used for one (`initialized profile web at …`), and a second implementation of the host's reconcile step is exactly the duplication this project rejects. Passing a shipped profile name to `--from-default-profile` is an error in the CLI (`profile "web" is shipped and cannot be a custom profile target`), so the verb does not offer that flag at all.
- `install` stops when `pnpm` is missing instead of degrading: pnpm is DSH's prerequisite, not this plugin's. The degraded, pnpm-less path stays in `tools/install-native.mjs`, where it exists for one-shot E2E homes and labels itself as degraded.
- **`doctor` asks the composed config through a `dsh` on `PATH` first**, falling back to `npx --no-install`. It previously always went through npx, so a machine that had the CLI on `PATH` could still be told the composition could not be determined.
- **The lifecycle check had a gate that could never open.** Its byte-for-byte comparison included `INVENTORY.txt` — the build's own file manifest, which is not in `files` and is therefore never present in a pnpm-installed copy — so that assertion was red on every run, and because the lifecycle check is not part of CI, nobody saw it. It also drove every compose query through `npx --no-install`, which returns an empty string when npx cannot run: two positive assertions failed while the negative one ("the row is gone") passed on that empty output. Both are fixed — the CLI is resolved from `PATH` first, and the comparison ignores the build manifest — and the check now exercises the shipped `install` verb too (28 checks).

## [0.1.2] — 2026-09-12

### Fixed

- **A gate could be impossible to open.** The plan review is a real gate — only a person's approval writes the authorisation mark, and the kernel refuses to start work without it. But the review card was raised **only** when a plan was created, so after a person chose *revise first, then resubmit*, the model revised the plan and there was **no entry point left** to present it again. The plan stayed unauthorised while the kernel correctly refused to work: a mechanism turned into a dead end.

  Now `AmendPlan` and `RefinePlan` present an unauthorised plan again automatically, and the new **`RequestPlanReview`** tool is an explicit entry point for the model or a person to re-present it. Only approval writes the mark; every other outcome still writes nothing.

### Added

- `RequestPlanReview` — re-present the current plan for review without changing anything. Returns `already_confirmed` when the plan is already authorised.

### Changed

- **The continuation window no longer shows a machine id.** The native goal chip displayed `ClearAI 续跑窗口 · 目标 g-…` — a mechanism word plus an id, on a surface the platform renders for people. It now reads as a sentence about the work (`继续做完:<what you asked for>`). The window's identity is no longer the text: ownership is tracked in the ledger, and a change of wording goes through `goals.edit`, which **does not touch the round budget**, so revising a goal still cannot refresh it.

## [0.1.1] — 2026-09-12

### Fixed

- **The first delivery in a fresh workspace could lose its own ledger commit.** The ledger is created lazily, so if it happens to be created at the moment a step is delivered, that first commit was written as an anonymous "baseline" — the step itself then had no commit of its own in `FileHistory`. The baseline now carries the delivery's message, so the step is attributed either way. Found by CI running on the `v0.1.0` tag; the local machine never reproduced it, because another suite had already created the ledger first.

### Changed

- The file-history assertion in the kernel suite picks the commit by step id instead of by position, and reports the whole history on failure rather than a truncated slice.

## [0.1.0] — 2026-09-12

The first release: ClearAI as a native DSH plugin.

### Added

- **The Epistemic Loop, as mechanism.** One agent preset carrying 21 intent tools — goals, plans, steps, hypotheses, worldlines, evidence, evaluation, facts, skills, memory — where completion is computed from delivered evidence rather than declared by the model.
- **Admission without verdict.** Delivering a step checks whether the declared artifacts exist, are non-empty and well-formed. It never decides what they mean; that is the next evaluation's job.
- **Independent evaluation.** A step above L0–L2 that carries a criterion has its result judged by a fresh-context evaluator with a read-only tool face, and the verdict is written by the system, not by the doer.
- **Worldlines.** Mutually exclusive routes run as separate branches with their own working copies; the winner is decided by a metric registered before the work, and a decision the arithmetic cannot make stops and asks a person.
- **An append-only ledger.** Refuted hypotheses, voided steps, abandoned forks and superseded plans stay on record; nothing is deleted.
- **One host package, one preset, one client module.** The DSH engine is not modified: the host half rides the bundle patch layer, the preset rides the roster, and the panels ride the client module.
- **Bilingual surfaces.** Every panel string and every document ships in English and Chinese; the language follows the DSH locale and switches without a reload.
- **Verification tooling.** Five test suites, a byte-for-byte package rebuild check, a deployment composition check, a real-process end-to-end run, and `tools/verify-clean-install.mjs` — sixteen mechanical assertions against an empty `DSH_HOME` installed through the real CLI.

### Notes

- Requires `pnpm` on `PATH` (`dsh plugin …` is a pnpm forwarder) and Node ≥ 22.
- **Restart `dsh web` after installing**: both halves are cached in the running process, so a browser refresh is not enough.
- Known gaps — what is deliberately not implemented, and what has only been verified to a stated depth — are listed in [`docs/known-gaps.md`](docs/known-gaps.md).

[0.1.2]: https://github.com/Clearailhc/clearai-dsh/releases/tag/v0.1.2
[0.1.1]: https://github.com/Clearailhc/clearai-dsh/releases/tag/v0.1.1
[0.1.0]: https://github.com/Clearailhc/clearai-dsh/releases/tag/v0.1.0
