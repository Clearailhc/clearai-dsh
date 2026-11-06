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
| Responsive layout | Wide window forced two columns inside a narrow pane | Use pane container width |
| Lifecycle | Locale callback retained after plugin disposal | Scope registration and cleanup to plugin effect |
| Update latency | Repeated seat scheduling could postpone updates through a burst | Coalesce pending updates without resetting the timer |

## Evidence status

Final engineering, package, browser and native-task evidence is being collected. This file is not a passing release receipt until `acceptance.json` is present and validated.

The full regression's first run passed behavior suites but failed the new README link because this evidence file was not yet created. The first new browser launch found port 3091 occupied by the prior isolated preview; no preview results from that launch were accepted. Both failures are retained in the archived logs.

## Limits

- The real task uses synthetic fixture data, real DeepSeek execution and an independent evaluator. It is not external-domain accuracy evidence.
- A small number of sequential model runs cannot establish a general cost or speed improvement.
- UI duplicate-event timings measure projection work only, not model task duration.
- Browser examples are explicitly labeled and use no paid models or real knowledge base.
- DSH 0.2.2-rc.1 capabilities remain the 0.5.9 boundary: independent native tabs and official conversation nodes. Unsupported cross-tab inline actions, custom tool summaries and suggested replies remain excluded.
- Earlier long-wait, cancel and recovery live evidence is historical. Current kernel regressions cover those paths; this release does not claim to rerun every previous paid scenario.
- Integrity checks operate at defined trust boundaries; they do not provide filesystem isolation for evaluator shell access.
