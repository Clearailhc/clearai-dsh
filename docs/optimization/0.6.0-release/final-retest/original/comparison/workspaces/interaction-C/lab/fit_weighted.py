#!/usr/bin/env python3
"""Reproducible weighted quadratic fit for the interaction-C campaign.

Reads initial.json plus every raw measurement JSON under lab/ that has
x,y,value,impurity,mode.  Weights by mode noise (full sd=0.18, quick sd=0.45).
Writes lab/model-weighted.json.  This is an analysis aid, not a measuring tool.
"""
import glob
import json
import math
from pathlib import Path

import numpy as np

NOISE = {"full": 0.18, "quick": 0.45}
LOCKED = {"initial.json"}


def design(x, y):
    xp, yp = 2.0 * x - 1.0, 2.0 * y - 1.0
    return np.array([1.0, xp, yp, xp * xp, yp * yp, xp * yp])


def load():
    rows = []
    for r in json.loads(Path("initial.json").read_text())["observations"]:
        rows.append({"x": r["x"], "y": r["y"], "value": r["value"],
                     "impurity": r["impurity"], "mode": r.get("mode", "full"),
                     "source": "initial.json"})
    for path in sorted(glob.glob("lab/*.json")):
        try:
            d = json.loads(Path(path).read_text())
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if not all(k in d for k in ("x", "y", "value", "impurity")):
            continue
        rows.append({"x": d["x"], "y": d["y"], "value": d["value"],
                     "impurity": d["impurity"], "mode": d.get("mode", "full"),
                     "source": path})
    return rows


def fit(rows, key):
    X = np.array([design(r["x"], r["y"]) for r in rows])
    y = np.array([r[key] for r in rows], float)
    sd = np.array([NOISE.get(r["mode"], 0.18) for r in rows])
    W = np.diag(1.0 / sd ** 2)
    coeff = np.linalg.solve(X.T @ W @ X, X.T @ W @ y)
    resid = y - X @ coeff
    dof = len(y) - X.shape[1]
    chi2 = float(np.sum((resid / sd) ** 2))
    M = np.array([[2 * coeff[3], coeff[5]], [coeff[5], 2 * coeff[4]]])
    scaled = np.linalg.solve(M, -np.array([coeff[1], coeff[2]]))
    phys = (scaled + 1.0) / 2.0
    at = design(*phys)
    # covariance of the stationary point by the delta method
    cov = np.linalg.inv(X.T @ W @ X)
    eps, J = 1e-4, np.zeros((2, 6))
    for j in range(6):
        c2 = coeff.copy()
        c2[j] += eps
        M2 = np.array([[2 * c2[3], c2[5]], [c2[5], 2 * c2[4]]])
        J[:, j] = (np.linalg.solve(M2, -np.array([c2[1], c2[2]])) - scaled) / eps
    cov_s = J @ cov @ J.T
    z = resid / sd
    return {
        "n": len(y),
        "dof": dof,
        "coeff_scaled": [float(v) for v in coeff],
        "chi2": chi2,
        "reduced_chi2": chi2 / dof,
        "resid_rmse": float(np.sqrt(np.mean(resid ** 2))),
        "max_abs_z": float(np.max(np.abs(z))),
        "stationary_phys": [float(v) for v in phys],
        "stationary_sd_phys": [float(v) / 2.0 for v in np.sqrt(np.diag(cov_s))],
        "stationary_corr": float(cov_s[0, 1] / math.sqrt(cov_s[0, 0] * cov_s[1, 1])),
        "at_stationary": float(at @ coeff),
    }


def predict(coeff, x, y):
    return float(design(x, y) @ coeff)


def main():
    rows = load()
    out = {"note": "weighted quadratic fit; weights 1/sd^2 with full sd=0.18, quick sd=0.45",
           "observations": len(rows),
           "by_mode": {m: sum(1 for r in rows if r["mode"] == m) for m in NOISE},
           "yield": fit(rows, "value"),
           "impurity": fit(rows, "impurity")}
    cy = out["yield"]["coeff_scaled"]
    ci = out["impurity"]["coeff_scaled"]
    ystar = out["yield"]["stationary_phys"]
    out["impurity"]["at_yield_optimum"] = predict(ci, *ystar)
    out["impurity"]["note"] = ("impurity is monotone increasing in x and y over [0,1]; "
                               "its quadratic stationary point is a saddle outside the domain "
                               "and is not a process optimum")
    pts = [(0.5, 0.5), (0.5, 0.55), (0.52, 0.55), (0.55, 0.55),
           (0.6, 0.6), (0.6, 0.55), (0.48, 0.55), (0.52, 0.5), (0.52, 0.6)]
    out["predictions"] = [
        {"x": x, "y": y, "yield": predict(cy, x, y), "impurity": predict(ci, x, y)}
        for x, y in pts
    ]
    Path("lab/model-weighted.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    print(json.dumps({k: out[k] for k in ("observations", "by_mode", "yield", "impurity")},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
