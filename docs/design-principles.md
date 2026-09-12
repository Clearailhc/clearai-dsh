# Design Principles

These principles turn ClearAI’s epistemology into enforceable DSH behavior. They describe mechanisms, not aspirations; where a capability is not implemented, the companion soul map says so.

## Mechanism over advice

A rule belongs in schemas, guards, projections, lifecycle code, or tests—not only in prompt text. The preset contributes intent tools and guards; the host supplies sandbox, approval, persistence, projections, and client surfaces. Prompt guidance may explain behavior, but it is not the enforcement boundary.

## Impossible-to-express over forbidden

Prefer APIs that cannot represent an invalid claim. Intent tools omit writable `status`, `progress`, and `phase`; higher-level paths omit caller-supplied verdicts and evidence. Progress is derived by the projection, and only `advance_plan` can advance a step. This makes downgrade and self-certification structurally unavailable rather than merely rejected after the fact.

## Intent and fact must be separate

The model may request an action or submit an observation; it may not declare that work is complete or that an observation proves a claim. Admission checks declared artifacts for existence, non-emptiness, and basic structure. Evidence, phase, progress, and facts are produced by the kernel’s fold and derivation, not by model prose.

## The doer does not judge themselves

For L3+ work, caller-supplied verdicts are rejected. The kernel dispatches an independent, fresh-context evaluator with a read-only tool face and a structured output schema; its settled result becomes the audit record. Admission answers only whether material is admissible—it does not decide what the material means.

## Preserve history

The system is append-only in meaning. Refinements retain prior criteria, superseded hypotheses remain recorded, voiding records a reason, and re-evaluation creates new evidence that can reference what it supersedes. Settled steps and branch decisions cannot silently regress; recovery is represented by new events or commits, never by erasing the past.

## Consequences

These principles imply one authoritative loop ledger, derived state rather than a second mutable state store, explicit human gates where required, and a strict separation between host safety invariants and preset epistemic behavior. See `soul-map.md` for the implementation map and current status.
