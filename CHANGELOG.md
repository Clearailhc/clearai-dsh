# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-09-12

### Fixed

- **A gate could be impossible to open.** The plan review is a real gate — only a person's approval writes the authorisation mark, and the kernel refuses to start work without it. But the review card was raised **only** when a plan was created, so after a person chose *revise first, then resubmit*, the model revised the plan and there was **no entry point left** to present it again. The plan stayed unauthorised while the kernel correctly refused to work: a mechanism turned into a dead end.

  Now `AmendPlan` and `RefinePlan` present an unauthorised plan again automatically, and the new **`RequestPlanReview`** tool is an explicit entry point for the model or a person to re-present it. Only approval writes the mark; every other outcome still writes nothing.

### Added

- `RequestPlanReview` — re-present the current plan for review without changing anything. Returns `already_confirmed` when the plan is already authorised.

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
