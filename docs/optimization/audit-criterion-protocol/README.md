# Exact audit criterion IDs

The 0.5.9 live task registered a single compound criterion C1. Its first evaluator invented C1(1)…C1(4). The tool schema accepted arbitrary strings; settlement correctly rejected the response as missing C1 and containing invalid criteria. The valid evidence check was therefore followed by another full audit.

The candidate binds the output schema to the registered ID enum and instructs the evaluator to put subchecks in basis. It does not infer mappings from prose, waive duplicate/missing criteria, reuse rejected verdicts, or change evidence/trust validation. The native structured-output tool can reject invented IDs before settlement.

Eight audit-material/protocol cases and 704 kernel assertions passed. One real installed candidate run completed with a first-pass audit. comparison.json records 2→1 audits and 35→22 calls, with all usage settled. This is one sequential run per variant with model variance, not a statistical claim. Candidate artifact is isolated from the immutable v0.5.9 tag; no follow-up release is performed.
