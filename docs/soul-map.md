# Soul Map

| Principle | DSH surface / code | Tests / status |
|---|---|---|
| Mechanism over advice | `preset/plugins/clearai-kernel.js` (`MECHANISM_TOOLS`, `ctx.tools.guard()`); host sandbox/approval; `ui/lib/fold.js`; `ui/lib/index.js` projection registration | `test/kernel.test.mjs`, `test/host.test.mjs`; implemented. Constraints that live only in prompt text are marked as preferences here, not as enforced mechanisms. |
| Impossible-to-express over forbidden | Tool schemas in `MECHANISM_TOOLS`; `derive()` and fold monotonicity; no writable `status`/`progress`/`phase`, no L3+ caller verdict | `test/kernel.test.mjs` schema and monotonicity assertions; implemented. |
| Intent/fact separation | `admission()` artifact checks; `advance_plan`; `fold.js` event application and derived `wire` view; `conversation.view` consumes `useProjection('clearai')` | `test/kernel.test.mjs` admission, fabricated-evidence, and derived-progress assertions; implemented. |
| Doer not judge self | L3+ guard (`verdict_not_accepted`); evaluator dispatch via `subagents.start('spawn', ...)` with read-only face and `outputSchema`; audit records | `test/kernel.test.mjs` and host/e2e audit assertions; implemented for machine evaluation. A per-step/per-branch L4 human release is implemented; the full eight-state verification machine and a universal L4 gate over every evaluation are not. |
| Preserve history | Append-only session log and `fold.js`; `refine`/`void` mutations; supersession fields; git worldline refs and recovery commits; `FileHistory`/`RestoreFile` per-file restore | `test/kernel.test.mjs` preservation/worldline/restore assertions; implemented. |

## Authority boundary

Host-owned projection, persistence, client wiring, and safety policy live in the package's host half (`ui/lib/index.js` → `lib/host.js`); preset-owned tools, guards, and prompt sections live under `preset/`. The mapping between source and package is in [DSH integration](dsh-integration.md). End-to-end verification is `tools/e2e-run.mjs`; deployment composition is `tools/verify-deploy.mjs`.
