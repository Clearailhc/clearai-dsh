# Known gaps

These are the **honest boundaries** of this release. Each item is either not built, or built only to the depth stated. Anything not listed here and not demonstrated elsewhere should be treated as unverified.

**How to read this**: wherever another document describes a mechanism, this page and the [mechanism truth table](optimization/truth-table.md) win. The truth table marks every entry `Implemented / Partial / Design only` and lists every place where the docs say A and the code does B.

## Not built

- **The eight-state verification machine.** [The verification ontology](verification-loop.md) describes the full state machine for verification objects. What is built is the part the kernel actually executes: propositions, observations, audits, evidence, facts, and the three levels L2 / L3 / L4. The fuller lifecycle is a design goal.
- **A universal L4 human-release gate.** **Step-level** L4 release is built: the delivering call asks a person on the spot; only a release hands the work to the evaluator, and a refusal or no answer rejects it. A global gate covering every audit is not built.
- **The four external sources (human upload / file drop / callback / pull).** The level table (L4) lists them, but **observations have exactly one source, `self`** — the type declares only values that have a real producer. When those inputs exist, the values go into the declaration.
- **No manual ontology editing in the panel.** The ontology panel is read-only: to change the ontology, say so in the conversation and the model edits the files under `clear/ontology/` (or edit the files yourself); the same three checks apply.
- **No cross-project reuse of the domain ontology.** Ontology files and fact files are **workspace-scoped**: a new session in the same workspace reads the existing ontology and facts; a new workspace starts empty. A user-level vocabulary library is out of scope.
- **Only the file tree counts as ontology.** Concepts and entities are read only from `clear/ontology/`; there are no ontology events in the session log to read, and nothing is converted.
- **Cross-file problems are flagged at read time, not blocked.** A dangling parent concept, range, entity type or relation object is listed under the graph and on the card, and that file stays out of the graph, but the model is not stopped from writing; only promotion blocks an assertion that depends on it.
- **No entity resolution in the entity graph.** Same name means same node; two names for the same thing are not merged.
- **No background re-audit loop.** When admission returns `needs_audit` the kernel dispatches one independent evaluator (a real child session); there is no periodic re-evaluation.

## Verified only to the stated depth

- **The evidence against the bare model comes from a dev set only.** The tasks in [against the bare model](cases/bare-model-ab.md) were written by the developers, with 3–4 runs per arm, graded blind, with no significance test; ClearAI wins on finding and correcting the drift, and recipes and exploration depth are a tie. A formal validation on tasks written by someone who has not seen the code, with 6 runs per arm and ablations, has not been done.
- **The two long runs are samples, not statistics.** The [JEPA world model](cases/jepa-world-model.md) and [Navier–Stokes](cases/navier-stokes.md) cases are complete sessions a real model ran in the simulated host (`tools/sim/`): ontology, entities, layering and promotion all worked, with zero rejected writes. They show the path works, not that the model always takes it; entity nesting (`contains`) was used once across both runs, and the skill reminder was never taken up.
- **The entity gate's blocking branch is covered by unit and replay tests only.** `entities_unlanded` (a judgement about to be promoted whose subject is not on the entity graph is refused) never fired in the two real runs — the model wrote the entities first both times. The risk of "creating an empty entity just to pass the gate" has not been observed.
- **Domain-vocabulary validation stops at "shape".** Value forms, subject domains, ranges, `is_a` cycles and self-conflicting facts are checked before promotion; unit conversion and numeric tolerance are **not** checked, formula semantics are **not** parsed, and whether a `code`-form value points to an existing file is **not** checked.
- **Conflicts are surfaced, not resolved.** When two unretracted confirmed facts give different objects for the same single-valued predicate and subject, the projection reports a conflict pair: it **retracts neither side**, does not judge which is true, and is not a gate. Only the delivery that lands refuting evidence asks a person, on the spot, whether to retract or keep (`fact/reviewed`).
- **Facts link to the ontology by wording.** At promotion, the terms used by the assertions plus the terms **mentioned by name** in the claim and refutation condition go into the fact's fingerprint; a synonym or abbreviation not listed as an alias does not link.
- **Facts without assertions cannot gain them.** Assertions land only at promotion; a fact without them always shows as "unstructured" and is not counted as debt.
- **Screenshots come from replays.** The screenshots in the README and cases were taken in real DSH replaying the sessions of the two real runs (model calls scripted). A full real-model, real-browser walkthrough, panel interaction in long sessions (source jumps, proposition expansion) and touch gestures were not verified in this release.
- **Graph rendering uses React Flow (@xyflow/react 12), packed by `tools/build-vendor.mjs` into the plugin's own module row.** Upgrading it goes through `npm run vendor`, not just package.json; the vendor bundle is generated and not committed, and the tests that need it skip honestly when it is missing. `npm run check:browser` mounts `GraphBand` in real Chrome; it catches loading and shape errors, not look and feel.
- **Language follows the person, per session.** Everything the system writes (tool results, the runtime card, questions to the person, prompt sections, tool descriptions, files under `clear/`) is in the language the person writes in, judged from their messages: Chinese if the message has Chinese characters and they are not a small minority, English if it is Latin letters only. Mixed sessions follow the latest clear signal; text in other languages falls back to Chinese. Panel chrome follows the UI locale, and the CLI follows `--lang` or the system locale. Model-written content (claims, ontology labels) stays in whatever language the model wrote it.

## Child runs and process lifecycle

- **The kernel collects evaluator conclusions itself.** An evaluator child run uses the one-shot handle from `subagents.start()`: the conclusion is the `run.result` this process holds, and the text reaches the model through the tool result at collection time. The native settlement notice (`subagent/end`) is best-effort and only supplementary.
- **Recovery after a process restart is guaranteed by unit tests only.** `sweepEndedAudits` first recovers the verdict from the child session log (`recoverVerdictFromChildSession`) and records `audit/settled{verdict:'unknown'}` only when that fails; this slow path has no real-run evidence in the deployed form.
- **A hard kill leaves a dangling audit.** On SIGKILL or a timeout kill there is no one to execute that beat, and only `audit/dispatched` remains; the long-run invariants mark it as dangling.
- **The one-shot form has no "next turn".** A child run that settles after the parent's last collection point is not collected; the resident form has a next turn and is not affected.

## Structural limits

- **The soul map is maintained by hand.** [The soul map](soul-map.md) maps each principle to the mechanism and test that carry it. There is **no mechanical equivalence check** between the written constitution and the implementation; the table can drift and stays honest only through review.
- **Some principles are only preferences.** Where a constraint lives only in the prompt with no mechanism behind it, the map says so.
- **Keeping the Chinese and English docs in sync is manual.** Both are maintained; a change made on one side only is not detected automatically.

## Before you run it

- **pnpm is a prerequisite — and it is DSH's, not ours.** `dsh plugin …` forwards to pnpm, so an executable `pnpm` must be on `PATH`; without it the CLI stops with `pnpm not found on PATH`. Install it directly (`npm install -g pnpm`, or your system package manager). `corepack enable` is not an install: it puts a version forwarder on `PATH`, and the corepack 0.34 bundled with Node 24 looks for `bin/pnpm.cjs`, which pnpm 11+ no longer ships, so it can download a version it cannot start and can shadow a pnpm that works.
- **Installing the plugin needs the DSH CLI itself, shipped in the npm package `@deepseek-ai/dsh`.** Starting the harness with `npx` does **not** put `dsh` on `PATH`. Either install through it (`npx @deepseek-ai/dsh plugin --profile web add clearai-dsh@<version>`) or run `npm install -g @deepseek-ai/dsh`.
- **pnpm ≥ 11 will not install a version published within the last day, and it does not say so.** `minimumReleaseAge` defaults to 1440 minutes and is **non-strict**: a bare package name or `@latest` **silently resolves to the newest version older than a day**. Pin the version, or exempt the package in the profile's `pnpm-workspace.yaml`:

  ```yaml
  minimumReleaseAgeExclude:
    - clearai-dsh
  ```

  The bundled installer (`npx clearai-dsh install`) resolves the current version and passes it on exactly, so it is not affected.
- **Refreshing the plugin list mid-upgrade can show one `locale` metadata error.** The host read a half-replaced package; it goes away once the install settles.
- **Restart `dsh web` after installing.** Both halves of the plugin are cached in the running process; refreshing the browser is not enough.
