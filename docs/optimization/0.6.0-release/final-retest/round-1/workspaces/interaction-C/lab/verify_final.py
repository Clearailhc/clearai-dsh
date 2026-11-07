#!/usr/bin/env python3
"""Deterministic self-check for the final recommendation.

Reads the consolidated input (initial + appended full measurements) and the
method's fitted model, recomputes replicate statistics, the model optimum and
impurity margin, and writes lab/verification.json. No experiments are run here.
"""
import json
import statistics as st
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
LAB = ROOT / "lab"

data = json.loads((LAB / "input-all.json").read_text())
model = json.loads((LAB / "model-all.json").read_text())
rows = data["observations"]

P = np.array([[r["x"], r["y"]] for r in rows], float)
V = np.array([r["value"] for r in rows], float)
I = np.array([r["impurity"] for r in rows], float)
S = 2 * P - 1

def design(s):
    x, y = s[:, 0], s[:, 1]
    return np.column_stack([np.ones(len(s)), x, y, x * x, y * y, x * y])

A = design(S)
coef_v = np.linalg.lstsq(A, V, rcond=None)[0]
coef_i = np.linalg.lstsq(A, I, rcond=None)[0]
res = V - A @ coef_v
dof = len(rows) - A.shape[1]
resid_rmse = float(np.sqrt(res @ res / dof))

def pred(x, y):
    s = np.array([2 * x - 1, 2 * y - 1])
    return (float((design(s.reshape(1, 2)) @ coef_v).item()),
            float((design(s.reshape(1, 2)) @ coef_i).item()))

# numeric optimum of the fitted yield surface over the declared box
grid = np.linspace(0, 1, 2001)
best = None
for x in grid:
    s = np.column_stack([np.full_like(grid, 2 * x - 1), 2 * grid - 1])
    vals = design(s) @ coef_v
    k = int(np.argmax(vals))
    if best is None or vals[k] > best[2]:
        best = (float(x), float(grid[k]), float(vals[k]))
opt_x, opt_y, opt_v = best
opt_imp = pred(opt_x, opt_y)[1]

reps = []
for name in ["f-0.71-0.61.json", "f-0.71-0.61-r2.json", "f-0.71-0.61-r3.json"]:
    r = json.loads((LAB / name).read_text())
    reps.append({"file": f"lab/{name}", "x": r["x"], "y": r["y"],
                 "value": r["value"], "impurity": r["impurity"]})
vals = [r["value"] for r in reps]
imps = [r["impurity"] for r in reps]
mean_v = st.mean(vals)
sd_v = st.stdev(vals)
mean_i = st.mean(imps)

out = {
    "method_version": model.get("method_version"),
    "n_full_observations": len(rows),
    "chosen_point": {"x": 0.71, "y": 0.61},
    "model": {
        "kind": model["selected_model"],
        "yield_coefficients_scaled": coef_v.tolist(),
        "impurity_coefficients_scaled": coef_i.tolist(),
        "resid_rmse": resid_rmse,
        "stated_noise_sd": data.get("noise_sd"),
        "loo_cv_rmse": model["models"][0]["cv_rmse"],
    },
    "fitted_optimum": {"x": opt_x, "y": opt_y, "predicted_yield": opt_v,
                       "predicted_impurity": opt_imp},
    "predicted_at_chosen": dict(zip(["yield", "impurity"], pred(0.71, 0.61))),
    "replicates_at_chosen": reps,
    "replicate_summary": {"n": len(vals), "mean_yield": mean_v,
                          "sd_yield": sd_v, "mean_impurity": mean_i,
                          "max_impurity": max(imps)},
    "impurity_limit": data["impurity_limit"],
    "impurity_margin": data["impurity_limit"] - mean_i,
    "checks": {
        "all_replicates_feasible": bool(max(imps) <= data["impurity_limit"]),
        "residual_consistent_with_noise": bool(
            abs(resid_rmse - data["noise_sd"]) <= 0.1
        ),
        "chosen_near_fitted_optimum": bool(
            abs(0.71 - opt_x) <= 0.05 and abs(0.61 - opt_y) <= 0.05
        ),
    },
}
(LAB / "verification.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps(out, indent=2))
