# AI4Sci case run: periodic smooth reconstruction

## Question

Does the implemented face reconstruction show the expected high-order convergence on a smooth periodic manufactured solution with a critical point?

## Reproduce

From the repository root:

```bash
python3 lab/scripts/run_ai4sci_case.py
```

The script uses `u(x)=cos(2*pi*x)` on `[0,1)`, exact cell averages, periodic indexing, the L-infinity face error, and grids from 16 through 512 cells. It writes `results.csv` and `run_metadata.json` in this directory.

## Observed result

The measured orders are approximately 3.98, 4.00, 4.00, 4.00, and 4.00 as the grid is refined. This run therefore supports fourth-order convergence for this specific four-point reconstruction and setup.

It does not establish fifth-order convergence for WENO in general. The script is a controlled reconstruction demonstration rather than a full WENO implementation study; it does not cover nonlinear weights, multidimensional cases, shocks, boundary closures, time integration, or all critical-point alignments.

## Evidence boundary

`results.csv` is the numerical observation, while `run_metadata.json` records the stated method and environment. A stronger claim requires a separately registered experiment with the exact WENO variant, implementation details, boundary treatment, norm, time-step policy, and independent review of the source and raw outputs.
