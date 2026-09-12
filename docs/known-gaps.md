# Known gaps

What follows is the honest boundary of this release. Every line is either absent, partially implemented, or verified only to a stated depth. If something is not listed here and not demonstrated elsewhere in the documentation, treat it as unverified.

## Not implemented

- **The eight-state verification machine.** The ontology in [Verification ontology](verification-loop.md) describes a full state machine for verification objects. What ships is the subset the kernel actually enforces: hypotheses, observations, evaluations, evidence, and facts, with levels L0–L4. The richer lifecycle remains a design target.
- **A universal L4 human-release gate.** A per-step/per-branch human release for L4 deliveries is implemented: the kernel refuses delivery without that record. A blanket gate over every evaluation is not implemented.
- **A `retracted` producer.** The ontology defines the state; no code path currently produces it.
- **Observation provenance labels beyond `self` and `scout`.** Other origins exist in the type, but nothing writes them yet.
- **Machine evaluator self-running.** An independent evaluator is dispatched by the kernel when admission sets `needs_audit`. That evaluator runs as a real sub-session; there is no separate background re-evaluation loop.

## Verified only to a stated depth

- **Fact-row navigation.** Clicking a confirmed fact to jump to the step that produced it is verified at the node-render level, not yet in a live browser on a session that actually promoted a fact.
- **Plan review wording.** The human-gate wording was corrected in code and covered by tests, but the corrected copy has not been re-read in a live browser.
- **The packaged client bundle in a browser.** Running the plugin from `dsh plugin add` in a browser was, until this release's verification pass, untested. That pass found a real defect: the client bundle registered itself under the old package id, so the browser refused to register the plugin at all and every panel silently disappeared. It is fixed, and the check is now part of release verification.

## Structural limitations

- **The soul map is maintained by hand.** [Soul map](soul-map.md) maps each principle to the mechanism and test that carry it. There is no mechanical equivalence check between the written constitution and the implementation; the map can drift, and only review keeps it honest.
- **Some principles remain preferences.** Where a constraint lives only in prompt text and not in a mechanism, the map says so rather than implying it is enforced.
- **The case documents are illustrations, not evidence.** [`docs/cases/`](cases/) describes how the loop behaves on three kinds of question. They are not a benchmark suite, and no run records are shipped with this library.

## Open decisions

- **English UI and English prompts.** The browser panels are still Chinese-only, and the preset's prompt sections carry a Chinese-language rule. A foreign-language user therefore gets a Chinese interface. The native DSH locale service is the intended mechanism for fixing the panels; the prompt language is a design decision still open.

## Operational caveats

- **Worldline branches live in the ledger, not in your folder.** When the workspace is not a git repository, the kernel keeps a bypass ledger repo under `$DSH_HOME/storages/clearai/ledger/<slug>` and treats the workspace as its working tree. A fork's branch and worktree live **there**. Deleting or garbage-collecting that directory orphans live forks: the plan still shows an open fork, but its branch and working copy are gone.

  This used to block the whole plan: the fork had been recorded as a git fork, so convergence kept trying to merge a branch that no longer existed. Since 2026-09-12 the kernel checks whether the branch ref still resolves and the working copy still exists **at convergence time**; if not, it records the adoption, records that no merge happened, and leaves placing the winner's artifacts to a normal delivery. The plan no longer stalls on an object that can never converge.
- **Merging is how adoption lands the winner's files.** A worldline is an independent working copy on its own branch; adopting it means bringing it back into the workspace. DSH has no workspace-branching primitive of its own, so this layer is ClearAI's, layered on the harness's native subagents and session log. When there is no usable git context at all, the kernel does not merge: it records the adoption and leaves placing the artifacts to a normal delivery.
