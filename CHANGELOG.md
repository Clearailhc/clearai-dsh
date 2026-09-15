# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **ClearAI's own `/` command menu.** `/goal` `/plan` `/evidence` `/worldline` are read-only state windows computed from the ledger on the spot; `/plan-review` re-presents the active plan through the native review card instead of stamping anything itself (commands carry no mutation channel — the authority boundary test pins this).
- **Native working tools return.** todo, subagent (with model selection), workflow and ralph mount from the standard preset's own rows; the composition suite pins both directions — present: these four; absent: `tool-goal`, `command-goal`, `plan-mode` (the second ledger stays off).
- **`test/prompt-sections.test.mjs`.** All 23 prompt sections carry a `hard` / `native` / `advisory` class tag, and the suite pins that the classification matches the content (hard sections name a mechanism anchor; native sections name no kernel tool; advisory sections make no mechanism promises).

### Changed

- **Hypothesis floor is now a hard boundary.** `SetGoal` rejects zero or one hypotheses when `minHypotheses > 0` (kernel default 0 stays neutral; the preset sets 2). Revisions of an existing goal are exempt.
- **Authorization wording unified to one sentence everywhere.** Kernel messages, the runtime card and the prompts all say: an unapproved plan does not auto-continue; when you advance it explicitly, the first delivery records attribution as it happened (behaviour is authorization). The card says it in human words — ledger field names no longer appear.
- **Stale native-tool contracts rewritten.** `edit` is literal replacement, not unified diff; `web_search`/`web_fetch` parameter references that no longer exist were removed.
- **Comment debt cleared to zero.** ~310 comments rewritten to the style rule (why / what breaks / boundary — no dates, no internal section numbers, no incident narratives); the ratchet quotas are now {0, 0, 0}.

### Fixed

- **`clearai-commands` cross-plane import.** It imported `ui/lib/fold.js` from the preset plane; in the installed package the relative layout differs, so switching to the preset in a browser failed at import. The command renderers now use the host-provided `clearai` facade for `derive` as well, and the boundary suite pins that no preset plugin imports across planes.
- **macOS temp-path realpath mismatches.** Session-log lookup and clean-install workspace registration now resolve realpaths (`/var` is a symlink to `/private/var`), which had made e2e logs unfindable and browser session attach fail.

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
