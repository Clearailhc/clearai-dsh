---
name: response-surface
description: Compare additive and interaction response surfaces for a bounded two-variable optimization decision with measurements, constraints and experimental costs.
---

Use the bundled `response_surface.py` with Python and NumPy:

```sh
python3 response_surface.py observations.json --output model-check.json
```

Input: `observations` containing `{x,y,value,impurity}`, two input `bounds` such as `[[0,1],[0,1]]`, `impurity_limit`, and optionally `noise_sd`, `impurity_noise_sd`, `remaining_budget`, `experiment_cost`, `grid_size`. `candidate_costs` may specify one cost per grid point, ordered by x then y. Declare units, instruments, source files and calibration separately in your task evidence. Use at least seven varied observations; the six-parameter interaction fit usually needs more.

Output: validated model comparisons, a predicted feasible recommendation, useful experiment candidates, and the best measured point. Fit uses leave-one-out errors and prefers the additive model when improvement is within measurement noise. Predictions are not measurements. The observed bounding box does not establish causal validity or reliable interpolation. Missing coverage, rank deficiency or unsupported validation returns `need_data` rather than an invented optimum.

After a new raw measurement, refit without writing a merge script or overwriting the initial data:

```sh
python3 response_surface.py input.json --append lab/measurement.json --remaining-budget 21 --updated-input lab/input-updated.json --output lab/model-updated.json
```

Repeat `--append` for multiple raw measurements. Calibration records are separate evidence and cannot be appended as measurements. A refined model recommendation remains unverified until measured; the `best_measured` result identifies a measured point.

Choose experiments that can improve the decision under the remaining budget. Consider calibration, repeats and constraints. Perform a full measurement on any predicted recommendation before claiming it is verified. Preserve raw measurements; corrected data need an explicit method and calibration evidence. Update the fit and recommendation from new evidence. Save methods separately from site-specific parameters and record input/output versions through `uses`; do not reuse old instrument corrections on replacement instruments.
