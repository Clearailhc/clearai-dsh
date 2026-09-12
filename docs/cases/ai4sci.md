# AI4Sci Case: WENO Accuracy Near a Critical Point

## Question
Does a fifth-order WENO reconstruction retain its advertised order of accuracy when the solution has a smooth critical point where the first derivative vanishes?

## Proposition
For a smooth test function with a deliberately chosen critical point, the selected WENO variant should approach fifth-order convergence in a norm measured away from boundary and implementation artifacts. This is an illustrative test proposition, not a replacement for the published theorem or a claim about all WENO implementations.

## Criterion
Run a refinement study on successively finer uniform meshes. Record the error and observed order, check stencil and boundary handling, and compare with a lower-order baseline. A result is informative only if the manufactured solution, norm, time step, precision, and stopping rule are documented.

## Execution
Use a periodic one-dimensional manufactured solution such as `u(x)=cos(2πx)` and place a critical point at a known grid location when possible. Reconstruct from cell averages, compute errors against the analytic solution, and repeat over at least four mesh sizes. Keep reconstruction, quadrature, and floating-point settings fixed.

## Observation / Evaluation
A plausible run may show near-fifth-order behavior on intermediate meshes, followed by order loss on the coarsest or finest meshes. If the critical-point setup is misaligned, under-resolved, contaminated by boundaries, or dominated by roundoff, the result is inconclusive. In particular, an inconclusive setup does not refute the literature; it only fails to test the proposition cleanly. Independent review should inspect scripts, exact data, and convergence plots.

## Revision
If the study is inconclusive, revise one factor at a time: align the critical point, use exact cell averages, enlarge the periodic domain, increase precision, or separate spatial from temporal error. Do not silently change the claim to fit a plot.

## What Is Retained
Retain the proposition, parameter manifest, source code, mesh/error table, plots, environment details, and an explicit label such as `illustrative / inconclusive` or `supportive within tested regime`. Retain citations to the relevant WENO literature separately from local observations.

## Limitations
This case tests one-dimensional manufactured data and one implementation. It does not establish multidimensional accuracy, shock behavior, positivity, stability, or universal critical-point performance. Numerical evidence is not a proof of a general theorem.

## Stored run

The task book this case was run against, and everything the run produced — the session record, the artifacts it left, and an honest reading of both — are kept with the case workspace. Nothing from a run is deleted, including runs that stopped halfway.

