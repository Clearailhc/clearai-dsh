# 0.6.0 release candidate review

Status: real acceptance failed; publication blocked. Local review package is prepared; no tag, npm publication or GitHub Release.

## Evidence

- [Complex case protocol](release-case-protocol.md): same frozen supply-chain world, native DSH and ClearAI, fresh sessions for build / reuse / changed sources.
- [Case explanation](../../cases/supply-chain-0.6.md): business output, exchange graph, internal ontology and independently retained assertions are measured separately.
- Two transport failures had all-zero fallback usage after provider invocation. They remain unknown, with USD 0.80 reserved each. The metering fix blocks new unknown usage; it does not reconstruct missing token counts.
- Runtime tested: official DSH 0.2.2-rc.1, deepseek-flash / medium. No host source changes. Recorded-session screenshot replay makes zero model calls.

## Engineering checks

- Full regression: 93 Node tests plus kernel 796 and repository domain/lifecycle suites passed. The generic invocation skipped host/client integration; separate checks against the installed candidate passed host 38 and client 195.
- Targeted zero-usage/accounting regression: 21 passed.
- Documentation consistency: 15 passed after final results insertion.
- Official DSH replay: all three stages each produced 9 screenshots, including 375/768/1440 px, keyboard object inspection and dark mode; no browser errors or display model calls.
- Production build passed; package verification 45/45 and official DSH clean installation 23/23 passed. Final package runtime matches all 49 compared tested files; all screenshot production hashes match. [Package proof and SHA256](release-package-checks.json).
- CI for the candidate branch is tracked on [draft PR #46](https://github.com/Clearailhc/clearai-dsh/pull/46). Green engineering checks do not override the failed real-task acceptance.

## Known limitations and release decision

This single synthetic task can demonstrate retained evidence and reuse behavior, not general accuracy superiority or speed gains. Native DSH also produces reusable scripts and a complete exported graph. ClearAI adds substantial work in this case. Main-agent exploration and repeated representation of numerical claims contribute alongside evaluation.

A malformed structured verdict caused repeated review. Criteria revision also exposed confusion between a child session ID and a settled audit ID. The exact valid IDs are present in error feedback, but repeated misuse still occurred. A supporting goal audit also introduced unresolved-item IDs that the submitted answers had not yet covered; after disposition and changes to the script/submission evidence lists, another final audit was dispatched. This is additional closure work, not a claim of cache reuse. These are retained observations, not silently repaired test attempts.

Historical fact counts are not current-scope coverage. A changed notice requires new support. Explicit source anomalies and unresolved causal explanations must remain visible even when administrative calculations pass.

Screenshots are production UI replaying actual recorded state, not original live execution. This run does not measure event-render P95, screen-reader behavior, or savings against a cold-start ablation.

**Observed release blocker:** two successive supporting final audits registered the same USE001 component anomaly under fresh audit-specific IDs. `Conclude` then rejected the answers because the newly created ID was absent. The main agent escalated that item and concluded again, dispatching another review. Numerical delivery is correct; the task stopped at 50,086,584 known processed tokens with the goal open. A third supporting audit repeated the same closure rejection. More budget does not resolve this protocol behavior.

A safe repair must preserve the original anomaly identity, evidence, scope and disposition across unchanged reviews, or allow a narrowly defined post-review acknowledgment without repeating an unchanged audit. It must still reopen when evidence or the assessed impact changes; it must never suppress genuinely new counterevidence or auto-escalate it on the user's behalf. Reproduce this path deterministically before another paid acceptance. Publication remains blocked pending that repair and acceptance.

The changed-source graph also retains BAT001→MAT017 instead of MAT002 (531/532 current core relations match). This must be repaired and tested alongside closure before release. [Final measured results](release-case-results.md).

## Retained CI failure

The first final-candidate Windows job failed in the four-process budget reservation test: `mkdir ledger.json.lock` returned transient `EPERM` during lock release. Linux jobs passed. The harness now retries Windows-only `EPERM` within the existing five-second acquisition deadline, always acquiring the lock before entering the transaction. Permanent errors still fail; no budget or knowledge guard is relaxed. Local budget tests pass 13/13; subsequent Windows results remain visible on the PR. This harness-only change occurred after paid execution and does not change the tested product runtime or overwrite the failure.
