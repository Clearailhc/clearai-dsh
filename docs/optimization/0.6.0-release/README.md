# 0.6.0 final acceptance / 最终验收

Final six paired real-model tasks completed and objective verification passed. The official host is DSH **0.2.2-rc.1**, verified through a fresh installation; no newer official version was found and no host code was modified.

| Task | Native DSH score | ClearAI score | Native active seconds | ClearAI active seconds | Native processed tokens | ClearAI known processed tokens |
|---|---:|---:|---:|---:|---:|---:|
| Direct calculation | 100 | 100 | 5.971 | 8.256 | 17,536 | 52,438 |
| Additive optimization | 99.9638 | 99.9638 | 226.380 | 949.177 | 874,044 | 4,293,224 |
| Interaction optimization | 99.9976 | 99.9521 | 526.545 | 1,426.158 | 1,621,639 | ≥4,852,736 |

A is the official default agent with tools, C the same host/model with ClearAI. Each task/variant has one final observation, not statistical evidence of general superiority. Both optimization variants used identical initial observations and a 30-unit scientific experiment budget, with real full measurements at the submitted coordinates. No extra model judge was used.

The final interaction-C execution was interrupted by environment loss and resumed in the **same native session**. Its table includes 259.203 seconds and 1,428,091 known tokens before interruption plus 1,166.955 seconds and 3,424,645 tokens after recovery. One interrupted request has unknown usage, retained at the full USD 0.80 reserve. Sixteen simulator measurements were restored exactly and independently checked, preserving 29/30 scientific units already spent. No experiment budget was reset. Infrastructure downtime is excluded from active execution time.

## What this establishes

- All six final tasks completed; ClearAI complex tasks completed independent reviews with bounded evidence and native goal closure.
- Shared ontology grounding, partial-fact retention, stable same-goal anomaly identity and lossless lesson-scope JSON address the observed completion failures. Current evidence does **not** establish a speed, token or accuracy advantage over native DSH.
- The [supply-chain case](../../cases/supply-chain-0.6.md) and [targeted remediation](../../cases/supply-chain-remediation/README.md) show reusable concepts, entities, evidence and correction lineage. Structural definitions and historical records are not certified facts. Raw-source and effective graph views have different meanings.
- [Fresh-host compatibility](host-compatibility-2026-11-08.md): 115 Node tests, kernel 798, installed host 38, client 195, native contracts, upgrade/uninstall/reinstall/config preservation and production browser checks passed.
- Projection performance is measured separately in `projection-performance-final.json`: 10,000 historical keys and 1,000 duplicate events, P95 about 0.014 ms, zero model calls. This is duplicate processing time, not end-to-end UI latency or task speed.
- Official host boundaries remain unchanged: conversation nodes and independent native tabs; unsupported tool summaries, suggested replies and cross-tab actions are excluded. No DOM injection or host modification.

## Reproducible records and retained failures

- [Current comparison](comparison/comparison.json), [objective verification](comparison/verification.json), [protocol and frozen package](comparison/manifest.json), [public archive inventory](comparison/archive.json).
- [Final retest preregistration](final-retest/PROTOCOL.md), [failed round 1](final-retest/round-1/comparison.json), [original failed matrix](final-retest/original/comparison/comparison.json), [original acceptance](final-retest/original/acceptance.json). Failures were not relabeled as passes.
- Public logs retain tool activity, lifecycle, usage and artifacts; credentials and private reasoning are omitted. Recovery mount evidence records a marker and the original log hash, without publishing model system content. Sanitized logs have their own hashes.
- `budget.json` preserves the cumulative ledger and authorized increases to USD 240 total / 40 per task. All historical unknown requests retain the full reserve and explicit acceptance. Five old zero-usage placeholders were corrected to unknown with USD 4 additional conservative reserve; these are accounting bounds, not invented tokens or additional charges. Display added no model calls.
- `acceptance.json` binds the release source and evidence by SHA-256. CI on the final commit and tag additionally checks Linux Node 22/24, Windows Node 24, packaging and native lifecycle before publication.

Synthetic data with real DeepSeek execution is not an external-domain accuracy benchmark. Provider caching and latency are uncontrolled. Earlier long-wait/cancel/recovery paid checks remain historical; current regression coverage does not turn them into newly executed live tasks. Reviewer instructions and tool restrictions do not constitute OS filesystem write isolation.
