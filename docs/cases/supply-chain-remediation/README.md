# Post-failure remediation

The original acceptance records remain unchanged. `build_graph.py` is the corrected case exporter: run it in a copy of the phase-3 workspace with its existing `analysis/trace_lib.py` and source data. It uses `usage_effective`, preserves original source rows, and appends correction-row citations. The independently recomputed graph now matches 246 entities and 532 relationships; see graph-check.json. This is a script repair, not a new paid-model acceptance.

The product now lets an independent evaluator reference an existing same-goal anomaly with `existing_id` and `disposition`. `maintain` needs current independent impact evidence; other decisions reopen the original item. Each review is retained. Unknown/cross-goal identities create open findings. State projection v28 invalidates old projections. No fuzzy-text merging or automatic author-side disposition is added.

Local checks: three identity/replay/reopening tests and the full repository suite pass; package verification 45/45. Real-model closure acceptance remains required before publication. Neither the previous failed case nor an offline correction authorizes release.
