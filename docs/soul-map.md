# Soul Map

Each principle maps to the mechanism and tests that carry it. Where no mechanism exists, it is marked as a preference.

| Principle | Mechanism | Tests |
|---|---|---|
| Do only what the host cannot | The preset composes native goal, plan mode, subagent, user-questions, deliverables, workspace-changes, skill and PROJECT.md | Composition test: the kernel registers no tool duplicating a native one |
| Mechanism over exhortation | `ctx.tools.guard()`; kernel intent-tool schemas; `ui/lib/fold.js` | `test/kernel.test.mjs`, `test/host.test.mjs` |
| Make invalid claims unrepresentable | No writable `status`/`progress`/`phase`; no caller verdict at L3+; monotonic step rank | Schema and monotonicity assertions |
| Separate intent from fact | `admission()`; `AdvancePlan` as the only completing action; progress and facts derived by the fold | Admission, forged-evidence and derived-progress assertions |
| The doer does not judge their own work | L3+ dispatches an independent evaluator; `Conclude` calls `ctx.goals.complete()` only after independent evaluation; a guard rejects the model's direct `update_goal(complete)`, including nested PTC calls | Guard tests |
| Only a human makes a human's decision | The call that opens a gate calls `ctx.userQuestions.ask()`; the answer returns in-process; on `NO_PROVIDER` the native goal is set to blocked | Human-gate tests |
| Preserve history | Append-only session log and fold; `RevisePlan` keeps old criteria; retraction only marks; vocabulary revisions recorded, deprecation sticky | History assertions, `test/domain-language.test.mjs` |
| The graph is a projection | `ui/lib/domain-language.js` (`graphProjection` / `deriveConflicts`); deterministic layout | `test/domain-language.test.mjs` |
| A change of meaning is detected | Each fact carries fingerprints of the definitions it used; when a definition file changes, the fact is flagged "definition changed" | Vocabulary revision and deprecation assertions |
| Speak about process only when needed | The Ontology pane holds only the conclusion list and graph; the run-state card is injected only on change; deliverable cards only at close | Client snapshot tests, run-state dedup tests |
| A scaffold, not a script | Three prompt sections (identity / loop / talking to people) | Prompt length and section tests |

## Authority boundary

The host half (`ui/lib/index.js` → `lib/host.js`) owns the projection and client wiring; the preset `preset/` owns tools, guards and prompts. Source-to-package mapping: [DSH Integration](dsh-integration.md).
