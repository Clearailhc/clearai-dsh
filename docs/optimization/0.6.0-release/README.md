# 0.6.0 review and acceptance / 审查与验收

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

Local engineering (including installed host/client), package, clean installation, lifecycle, production browser examples and one real native task passed. The paired comparison and remote cross-platform CI are still running. This file is not a passing release receipt until `acceptance.json` is present and validated.

The full regression's first run passed behavior suites but failed the new README link because this evidence file was not yet created. The first new browser launch found port 3091 occupied by the prior isolated preview; no preview results from that launch were accepted. Both failures are retained in the archived logs.

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
- Cross-platform CI passed on Linux Node 22/24 and Windows Node 24: [run 42218573043](https://github.com/Clearailhc/clearai-dsh/actions/runs/42218573043). The final merged/tagged commit must pass the same pipeline again.
- Package checks 45, clean-install checks 22 and lifecycle checks 26 passed. Production panel browsing, narrow layouts, themes, keyboard navigation and stable graph viewport passed.
- Official DSH example preview passed with no uncaught or console errors, eight correctly projected records, refresh and ten session switches. [Screenshots, video and module hashes](../0.6.0/README.md). Seven click-to-example-visible samples were 132–661 ms; this is an interaction check, not a measured client-event-arrival P95 or a screen-reader user study.
- A 10,000-key history with 1,000 duplicate events took 2757.8 ms before and 19.0 ms on the final projection in the recorded run (P95 per lookup 4.94 → 0.035 ms). [Raw measurements](projection-performance.json). No model calls and no whole-task speed claim.
- Native arithmetic end-to-end: 66.914 seconds, 19 calls, 253,367 processed tokens; one independent audit passed, no parent requests while waiting, verified usage with no missing or pending records. The input is an explicitly synthetic engineering fixture.

The additive ClearAI comparison hit its preregistered 5,000,000 processed-token limit before final closure. This is retained as `token_limit`, not a passing task. The release gate is blocked. The later UI-only structured-shortfall fix has its own focused regression; the frozen paid comparison still uses package `854dafb63da162c40a7cdefda6c7443710d949693804e5ccfed050a16ad79e4b`.
