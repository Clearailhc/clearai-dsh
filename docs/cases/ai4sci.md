# AI4Sci Case: A Convergence Claim Under Test

## Question and expected effect
Can a reproducible numerical experiment justify the claim that a reconstruction is fifth-order accurate near a smooth critical point? This case shows ClearAI narrowing an attractive claim when the actual implementation and measurements support a different order.

## Initial proposition
A selected WENO implementation should show fifth-order convergence for a smooth manufactured solution with a critical point. This proposition is intentionally stronger than the local demonstration and is allowed to fail.

## Registered criterion and execution
Use `u(x)=cos(2*pi*x)` on `[0,1)`, exact cell averages, periodic indexing, the L-infinity face error, and successively refined meshes. Keep the method, precision, boundary treatment, and error definition fixed. Reproduce the run with:

```bash
python3 lab/scripts/run_ai4sci_case.py
```

The script and its outputs are in [`lab/cases/ai4sci/`](../../lab/cases/ai4sci/). It records the source, method, grid sizes, errors, observed orders, and runtime metadata.

## Observation and evaluation

The run covers 16, 32, 64, 128, 256, and 512 cells. The observed orders are approximately 3.98, 4.00, 4.00, 4.00, and 4.00. Within this exact setup, the observation supports fourth-order convergence of the implemented four-point reconstruction.

This is not evidence that every WENO implementation is fourth-order or fifth-order. The experiment is a controlled reconstruction demonstration; it does not include nonlinear WENO weights, multidimensional flow, shocks, time integration, boundary closures, or all critical-point alignments. The first run is therefore a useful local observation, not a universal accuracy result.

## Revision and bounded conclusion

The original proposition is revised to: **for this periodic manufactured solution, exact cell-average input, four-point reconstruction, face L-infinity error, and tested mesh range, the measured convergence is approximately fourth order.** A fifth-order WENO claim remains untested by this run. A stronger result requires the exact WENO variant, a declared baseline, implementation review, independent rerun, and explicit treatment of spatial, temporal, boundary, and roundoff errors.

## What was not proved

The run does not prove a general theorem, fifth-order accuracy, multidimensional accuracy, shock behavior, positivity, stability, or performance for other implementations and problem classes. Numerical evidence remains conditional on the registered setup.

## Retained evidence

- [`lab/scripts/run_ai4sci_case.py`](../../lab/scripts/run_ai4sci_case.py): reproducible execution;
- [`lab/cases/ai4sci/results.csv`](../../lab/cases/ai4sci/results.csv): raw tabular readings;
- [`lab/cases/ai4sci/run_metadata.json`](../../lab/cases/ai4sci/run_metadata.json): parameters and environment;
- [`lab/cases/ai4sci/README.md`](../../lab/cases/ai4sci/README.md): reproduction notes and evidence boundary.

The proposition, the stronger claim it failed to establish, and the local observation are all retained rather than silently rewritten.
