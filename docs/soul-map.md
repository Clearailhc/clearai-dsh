# Soul Map

> **Being rebuilt.** This table records target mechanisms from the ["less is more" plan](less-is-more-plan.zh-CN.md). "Phase" is the implementation phase in section 8 of the plan; until a phase lands, [Known Gaps](known-gaps.md) is authoritative.

Each principle maps to the mechanism and tests that carry it. Where no mechanism exists, it is marked as a preference.

| Principle | Mechanism | Tests | Phase |
|---|---|---|---|
| Do only what the host cannot | The preset composes native goal, plan mode, subagent, user-questions, deliverables, workspace-changes, skill and PROJECT.md; the kernel no longer ships its own versions | Composition test: the kernel registers no tool duplicating a native one | 2–3 |
| Mechanism over exhortation | `ctx.tools.guard()`; kernel intent-tool schemas; `ui/lib/fold.js` | `test/kernel.test.mjs`, `test/host.test.mjs` | Exists; narrowed per phase |
| Make invalid claims unrepresentable | No writable `status`/`progress`/`phase`; no caller verdict at L3+; monotonic step rank | Schema and monotonicity assertions | Exists |
| Separate intent from fact | `admission()`; `AdvancePlan` as the only completing action; progress and facts derived by the fold | Admission, forged-evidence and derived-progress assertions | Exists |
| The doer does not judge their own work | L3+ dispatches an independent evaluator; `Conclude` calls `ctx.goals.complete()` only after independent evaluation; a guard rejects the model's direct `update_goal(complete)`, including nested PTC calls | Guard tests (prototype: `tools/spikes/goal-guard.plugin.mjs`) | 3 |
| Only a human makes a human's decision | The call that opens a gate calls `ctx.userQuestions.ask()`; the answer returns in-process; on `NO_PROVIDER` the native goal is set to blocked | Human-gate tests (prototype: `tools/spikes/human-gate.plugin.mjs`) | 3–4 |
| Preserve history | Append-only session log and fold; `RevisePlan` keeps old criteria; retraction only marks; vocabulary revisions recorded, deprecation sticky | History assertions, `test/domain-language.test.mjs` | Exists |
| The graph is a projection | `ui/lib/domain-language.js` (`graphProjection` / `deriveConflicts`); deterministic layout | `test/domain-language.test.mjs` | Exists |
| A change of meaning is detected | Each fact carries fingerprints of the definitions it used; when a definition file changes, the fact is flagged "definition changed" | Vocabulary revision and deprecation assertions | 4 |
| Speak about process only when needed | The Ontology pane holds only the conclusion list and graph; the run-state card is injected only on change; deliverable cards only at close | Client snapshot tests, run-state dedup tests | 6 |
| A scaffold, not a script | Three prompt sections (identity / loop / talking to people) | Prompt length and section tests | 5 |

## Authority boundary

The host half (`ui/lib/index.js` → `lib/host.js`) owns the projection and client wiring; the preset `preset/` owns tools, guards and prompts. Source-to-package mapping: [DSH Integration](dsh-integration.md).
