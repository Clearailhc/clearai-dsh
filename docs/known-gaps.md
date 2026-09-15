# Known gaps

What follows is the honest boundary of this release. Every line is either absent, partially implemented, or verified only to a stated depth. If something is not listed here and not demonstrated elsewhere in the documentation, treat it as unverified.

**How to read this**: wherever the repository describes a mechanism in the future or ideal tense, this file and the
[mechanism truth table](optimization/truth-table.md) take precedence. The truth table labels every entry
`implemented / partial / design only` and records each place where "the docs say A, the code does B". Mixing `current`
with `design goal` in the same tense was this documentation set's worst habit.

## Not implemented

- **The eight-state verification machine.** The ontology in [Verification ontology](verification-loop.md) describes a full state machine for verification objects. What ships is the subset the kernel actually enforces: hypotheses, observations, evaluations, evidence, and facts, with levels L0–L4. The richer lifecycle remains a design target.
- **A universal L4 human-release gate.** A per-step/per-branch human release for L4 deliveries is implemented: the kernel refuses delivery without that record. A blanket gate over every evaluation is not implemented.
- **Plan authorization is attribution, not a gate (a settled design decision, not an open one).** The review card **always** asks a person to approve (`CreatePlan` has no auto-confirm branch, and the third `confirmed_by` source `'autonomy'` is deleted) — the card itself is the gate, and only a human approval writes the `by='user'` stamp. But **being unauthorized does not block explicit delivery**: it only makes auto continuation `hold`, while `AdvancePlan` proceeds and back-fills `confirmed_by='progress'` in the same mutation (behaviour is authorization). In one sentence: an unapproved plan does not auto-continue; when you advance it explicitly, the first delivery records attribution as it happened. The kernel messages, the runtime card and the prompts say this one same sentence.
- **A `retracted` producer.** The ontology defines the state; no code path currently produces it.
- **Observation provenance labels beyond `self` and `scout`.** Other origins exist in the type, but nothing writes them yet.
- **Machine evaluator self-running.** An independent evaluator is dispatched by the kernel when admission sets `needs_audit`. That evaluator runs as a real sub-session; there is no separate background re-evaluation loop.
- **A real-browser walkthrough is still undone.** The `/` command menu (`/goal` `/plan` `/evidence` `/worldline` `/plan-review`) and the returned native working tools (todo/subagent/workflow/ralph) are covered by the composition suite and headless e2e, but nobody has yet clicked through the menu rendering, command output, and panel-command consistency in a real browser.

## Verified only to a stated depth

- **Fact-row navigation.** Clicking a confirmed fact to jump to the step that produced it is verified at the node-render level, not yet in a live browser on a session that actually promoted a fact.
- **Plan review wording.** The human-gate wording was corrected in code and covered by tests, but the corrected copy has not been re-read in a live browser.
- **The packaged client bundle in a browser.** Running the plugin from `dsh plugin add` in a browser was, until this release's verification pass, untested. That pass found a real defect: the client bundle registered itself under the old package id, so the browser refused to register the plugin at all and every panel silently disappeared. It is fixed, and the check is now part of release verification.

## Structural limitations

- **The soul map is maintained by hand.** [Soul map](soul-map.md) maps each principle to the mechanism and test that carry it. There is no mechanical equivalence check between the written constitution and the implementation; the map can drift, and only review keeps it honest.
- **Some principles remain preferences.** Where a constraint lives only in prompt text and not in a mechanism, the map says so rather than implying it is enforced.
- **The case documents are illustrations, not evidence.** [`docs/cases/`](cases/) describes how the loop behaves on three kinds of question. They are not a benchmark suite, and no run records are shipped with this library.

## Open decisions

- **English UI and English prompts (partially corrected, aligned 2026-09).** The install-side CLI (`doctor`, `install`, `seed`) still prints Chinese, and the browser panels still use Chinese as their source text (English tables exist but have not been proofread screen by screen in a real browser) — so a non-Chinese user may still get a Chinese interface.
  **The half that is already fixed**: the preset prompts **no longer require Chinese throughout**. They now say "follow the user's current language, one language per turn" (the language subsection in `preset/plugins/prompts.js`), so "the prompts lock everyone into Chinese" is no longer true.
  One design decision remains open: which language the CLI prints in. (The panels can reuse the native DSH locale service; that mechanism is already in place.)

## Before you can run it

- **pnpm is a prerequisite — and it is DSH's, not ours.** `dsh plugin …` forwards to pnpm, so an executable `pnpm` has to be on `PATH`; without it the CLI stops with `pnpm not found on PATH` and no profile can be managed. Install it directly (`npm install -g pnpm`, or your system package manager). `corepack enable` is the tempting shortcut, and it is not an install: it drops a version **router** on `PATH` that fetches a pnpm the first time it is invoked. Corepack 0.34 — the one Node 24 ships — launches pnpm by looking for `bin/pnpm.cjs`, which pnpm 11 onwards no longer ships (`bin/pnpm.mjs`, then a native binary at the package root), so it can fetch a version it is unable to run; and its shims can sit earlier on `PATH` than a pnpm that already worked, shadowing it.
- **The DSH CLI is what adds the plugin, and it ships in the npm package `@deepseek-ai/dsh`.** Starting the harness with `npx` does **not** put `dsh` on your `PATH` — that copy lives in the npx cache and exists only for that one process. So either borrow it for the install (`npx @deepseek-ai/dsh plugin --profile web add clearai-dsh`), or install the CLI once with `npm install -g @deepseek-ai/dsh`.
- **Restart `dsh web` after installing.** The host half and the client half are both cached inside the running process; refreshing the browser is not enough, and a process that keeps running while its package is replaced will serve a broken client bundle.

## Fixed after the first release

- **A gate could be impossible to open.** The plan review is a real gate: only a person's approval writes the authorisation mark, and the kernel refuses to start work without it. But the review card was raised **only** when a plan was created — so after a person chose "revise first, then resubmit", the model revised the plan and there was **no entry point left** to present it again. The plan stayed unauthorised forever while the kernel correctly refused to work. A gate that cannot be opened is worse than no gate: it turns a mechanism into a dead end.
  Since 0.1.2 `AmendPlan` and `RefinePlan` present an unauthorised plan again automatically, and `RequestPlanReview` is an explicit entry point for either the model or a person to re-present it. Only approval writes the mark; every other outcome still writes nothing.

## Operational caveats

- **Worldline branches live in the ledger, not in your folder.** When the workspace is not a git repository, the kernel keeps a bypass ledger repo under `$DSH_HOME/storages/clearai/ledger/<slug>` and treats the workspace as its working tree. A fork's branch and worktree live **there**. Deleting or garbage-collecting that directory orphans live forks: the plan still shows an open fork, but its branch and working copy are gone.

  This used to block the whole plan: the fork had been recorded as a git fork, so convergence kept trying to merge a branch that no longer existed. Since 2026-09-12 the kernel checks whether the branch ref still resolves and the working copy still exists **at convergence time**; if not, it records the adoption, records that no merge happened, and leaves placing the winner's artifacts to a normal delivery. The plan no longer stalls on an object that can never converge.
- **Merging is how adoption lands the winner's files.** A worldline is an independent working copy on its own branch; adopting it means bringing it back into the workspace. DSH has no workspace-branching primitive of its own, so this layer is ClearAI's, layered on the harness's native subagents and session log. When there is no usable git context at all, the kernel does not merge: it records the adoption and leaves placing the artifacts to a normal delivery.
