# 0.6.0 review and acceptance / 审查与验收

> Historical first 0.6 engineering pass and its original budget/results. The current repaired candidate uses the separately preregistered [complex release-case protocol](../../../0.6.0-agent-native/release-case-protocol.md); the limits below are historical, not the current ledger limits.

Scope: small fixes on released 0.5.9. No workflow redesign, graph redesign or DSH host changes. The user requested an overall performance and experience review, then a 0.6 release. Paid runs retain the existing $5/test and $30 campaign limits and historical expense reservations.

## Findings / 本轮问题

| Area | Confirmed issue | Resolution |
| --- | --- | --- |
| Evaluator protocol | First 0.5.9 audit invented C1 subcriteria, rejected after completing evidence work | Bind criterion IDs in native structured output schema; evidence and completeness validation unchanged |
| Projection performance | Every duplicate scanned all historical keys | Direct own-key lookup; synthetic comparison below |
| History robustness | Null hypotheses and evidence origins could crash replay | Validate entries before reading fields |
| Handoff truthfulness | Preparing dispatch was displayed as already handed off | Show handoff only with a confirmed child session |
| Task isolation | Delayed dispatch completion could overwrite original task ownership | Persist pending audit ownership; inherit it on confirmed dispatch and settlement |
| Reading | Refutation condition ran into claim prose; achieved/reused appeared as raw status | Label condition separately; translate statuses |
| Review gaps | Structured shortfalls used criterion/what/missing, but display looked only for detail | Preserve structured gaps alongside legacy strings; targeted regression passed |
| Responsive layout | Wide window forced two columns inside a narrow pane | Use pane container width |
| Lifecycle | Locale callback retained after plugin disposal | Scope registration and cleanup to plugin effect |
| Update latency | Repeated seat scheduling could postpone updates through a burst | Coalesce pending updates without resetting the timer |

## Evidence status

Engineering and UI checks passed. **Release acceptance failed:** both complex ClearAI runs reached the preregistered 5,000,000 processed-token ceiling before final task closure. No 0.6.0 tag or npm publication was made. Measurement verification passed for all six rows; this verifies the comparison records, not successful completion of every task.

The first engineering pass found a missing new documentation link; the corrected full suite passed. The first preview launch found the previous isolated preview occupying port 3091. An initial capture expected the old nine-event count; projection v4 correctly suppresses the nonexistent example child handoff and produces eight records. These failures are preserved alongside the later passing checks.

## Limits

- The real task uses synthetic fixture data, real DeepSeek execution and an independent evaluator. It is not external-domain accuracy evidence.
- A small number of sequential model runs cannot establish a general cost or speed improvement.
- UI duplicate-event timings measure projection work only, not model task duration.
- Browser examples are explicitly labeled and use no paid models or real knowledge base.
- DSH 0.2.2-rc.1 capabilities remain the 0.5.9 boundary: independent native tabs and official conversation nodes. Unsupported cross-tab inline actions, custom tool summaries and suggested replies remain excluded.
- Earlier long-wait, cancel and recovery live evidence is historical. Current kernel regressions cover those paths; this release does not claim to rerun every previous paid scenario.
- Integrity checks operate at defined trust boundaries; they do not provide filesystem isolation for evaluator shell access.

## Paired comparison protocol / 配对方法

User explicitly expanded acceptance to multiple tasks versus the bare model. Six runs are preregistered before execution: direct calculation A→C, additive optimization C→A, interaction optimization A→C. A is official DSH default agent with its native tools; C is the same host/model with ClearAI mounted. This is a tool-using baseline, not a tool-free chat answer. Each run has a fresh workspace and no prior knowledge reuse. Both sides receive identical task text and initial observations, the same experiment budget and the same model/reasoning settings (`deepseek-flash`, requested `medium`).

The two optimization tasks use a newly generated private world key. Real read, shell, symlink and parent-scan isolation probes run before model execution. The 30-unit experimental budget is separate from the monetary API budget. Objective quality uses the hidden noiseless objective and impurity limit; score is normalized improvement over a fixed starting point to a 401×401 feasible-grid optimum, bounded to 0–100. Score does not by itself certify the quality of the written explanation. Evidence references and audit outcomes are inspected separately.

All runs are sequential, preserving failed outcomes without quality-based reruns. Model latency/load and provider caching are uncontrolled; these are six task observations, not a statistical efficiency claim. Total processed tokens include input, output, cache-read and cache-write tokens. Wall time includes the task and its independent reviews; summed per-role request time can overlap and is not wall time. Provider-confirmed cache usage uses the recorded peak price table, so token ratios need not equal fee ratios. Titles are listed under other calls, and no extra model judge is added.

The controller preserves each original run, exact prompt, raw session events, usage and submission. Truth is disclosed for reproducibility only after every worker has exited. The frozen comparison manifest and candidate package digest identify what was actually tested.

## Engineering and UI / 工程与界面

- Full local regression passed: 74 Node test cases plus kernel 704, host 38, client 193 and the remaining domain/ontology/documentation suites. Installed host and client checks were required, not skipped.
- Cross-platform CI passed on Linux Node 22/24 and Windows Node 24: [run 42222837113](https://github.com/Clearailhc/clearai-dsh/actions/runs/42222837113). The final merged/tagged commit must pass the same pipeline again.
- Package checks 45, clean-install checks 22 and lifecycle checks 26 passed. Production panel browsing, narrow layouts, themes, keyboard navigation and stable graph viewport passed.
- Official DSH example preview passed with no uncaught or console errors, eight correctly projected records, refresh and ten session switches. [Screenshots, video and module hashes](../../../0.6.0/README.md). Seven click-to-example-visible samples were 132–661 ms; this is an interaction check, not a measured client-event-arrival P95 or a screen-reader user study.
- A 10,000-key history with 1,000 duplicate events took 2757.8 ms before and 19.0 ms on the final projection in the recorded run (P95 per lookup 4.94 → 0.035 ms). [Raw measurements](projection-performance.json). No model calls and no whole-task speed claim.
- Native arithmetic end-to-end: 66.914 seconds, 19 calls, 253,367 processed tokens; one independent audit passed, no parent requests while waiting, verified usage with no missing or pending records. The input is an explicitly synthetic engineering fixture.

The additive ClearAI comparison hit its preregistered 5,000,000 processed-token limit before final closure. This is retained as `token_limit`, not a passing task. The release gate is blocked. The later UI-only structured-shortfall fix has its own focused regression; the frozen paid comparison still uses package `854dafb63da162c40a7cdefda6c7443710d949693804e5ccfed050a16ad79e4b`.

**Release status: BLOCKED — at least one paired task did not complete within its preregistered limits.**

## Paired results / 配对结果

| Task / 任务 | Variant | Objective score | Processed tokens | Wall seconds | Modeled USD | Independent audits |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| direct | Bare DSH | 100.00 | 23,410 | 6.916 | 0.001053 | 0 |
| direct | ClearAI | 100.00 | 49,525 | 7.472 | 0.001109 | 0 |
| additive | Bare DSH | 99.98 | 1,094,141 | 228.189 | 0.052422 | 0 |
| additive | ClearAI | 0.00 | 5,017,521 | 1272.310 | 0.335093 | 4 |
| interaction | Bare DSH | 100.00 | 549,161 | 191.895 | 0.034145 | 0 |
| interaction | ClearAI | 0.00 | 5,015,508 | 860.222 | 0.229717 | 1 |

| Task | Variant | Main tokens | Evaluator tokens | Other tokens |
| --- | --- | ---: | ---: | ---: |
| direct | A | 23,040 | 0 | 370 |
| direct | C | 49,255 | 0 | 270 |
| additive | A | 1,093,794 | 0 | 347 |
| additive | C | 2,231,420 | 2,785,664 | 437 |
| interaction | A | 548,731 | 0 | 430 |
| interaction | C | 3,735,488 | 1,279,608 | 412 |

Comparison modeled cost: **$0.653539440**. Cumulative historical and current cost upper bound: **$2.870741084**, with no pending or new unknown usage. Historical accepted reservations remain charged.

Raw session records, submissions, frozen protocol and objective verification are in `comparison/` . Ephemeral local experiment-service credentials are redacted in archived text; the API key is absent. Reasoning blocks are omitted from public session archives; tool activity, public outputs and usage remain available. Original sessions remain in the private local test root. Synthetic grading truth was disclosed only after every worker exited.

## Joint interpretation / 合并判断

The second task changes the diagnosis: evaluator overhead is substantial, but it is not the only bottleneck. There were **no failed-audit retries** in either complex run.

| ClearAI task | Main calls / request seconds | Evaluator calls / request seconds | Independent audits | Main / evaluator modeled USD |
| --- | --- | --- | ---: | --- |
| additive | 40 / 330.4 | 70 / 916.4 | 4 | 0.084473 / 0.250381 |
| interaction | 49 / 468.6 | 23 / 370.3 | 1 | 0.131035 / 0.098473 |

- In the additive task, three L3 verification steps plus final-goal review triggered four distinct audits. None was a duplicate dispatch or failed retry. Individual audits took 10, 25, 18 and 17 model calls; their scopes and material inspections overlap. Evaluators accounted for approximately 75% of modeled cost.
- In the interaction task, one audit still required 23 model calls. Main-agent work used 49 calls and approximately 57% of modeled cost. Its public tool trace includes four `Frame` calls with ontology/assertion corrections, two `CreatePlan` calls, five `Anomaly` calls (two openings and three resolutions), and one rejected write to a system-owned ontology path. Some anomaly work corrected the agent's own copied/calculated plan predictions. These are task framing and interface costs, not evaluator retries.
- Independent verification requirements should not simply be weakened. The next bounded investigation should address task/claim scope, schema guidance before rejected mutations, batch evidence reads and calculations, and reuse only when the material, criteria, configuration and trust checks are unchanged. A final review should identify what remains to verify instead of implicitly reopening the whole research history. None of these strategy changes was applied during this frozen comparison.

Completion-aware scores assign zero to both limited runs by the preregistered rule. This does **not** mean both parameter solutions were wrong: additive C had a valid `submission.json` with feasible objective score **99.98313**, essentially the same as bare A's **99.98273**, but the goal remained open. Interaction C had not written `submission.json`; no final submitted recipe can be scored. Both bare-model complex tasks completed. No quality advantage was established in this sample.

The ClearAI runs used 12 and 23 experiment-budget units, while both bare-model runs used 30; extra experiment execution does not explain the ClearAI wall-time overhead. Most cumulative tokens were cached input: 4,655,360 of 5,017,521 for additive C and 4,792,064 of 5,015,508 for interaction C. These are processed-token counts, not newly generated text counts. Output generation and repeated model/tool turns also matter; cache discounts mean token ratios and monetary ratios differ.

The 5M token ceiling is a fixed benchmark resource limit, not the $5 monetary ceiling. Neither monetary ceiling was exhausted, and no unknown or pending usage remained. We did not raise the token ceiling or restart a failed sample to manufacture completion. Each task/variant has one sample; long-term knowledge reuse was not evaluated.

Reproduce the archived deterministic grading and metering checks without any model call:

```bash
node tools/verify-polish-comparison.mjs docs/optimization/0.6.0-release/comparison
```

The public archive omits model reasoning blocks and ephemeral local service credentials. Public tool activity, outputs, usage and submissions remain; original sessions are preserved in the local test directory.
