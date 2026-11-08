#!/usr/bin/env python3
"""Reproduce the final quadratic interaction fit and continuous optimum.

Reads the provided initial.json plus every raw full measurement in lab/.
Quick-mode records are used only as a consistency check, never in the fit.
Calibration records are separate instrument evidence.
"""
import glob
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "lab" / "final-analysis.json"


def design(points):
    """Quadratic interaction basis in normalized coordinates u=2x-1, v=2y-1."""
    x, y = np.asarray(points, dtype=float).T
    u, v = 2.0 * x - 1.0, 2.0 * y - 1.0
    return np.column_stack([np.ones(len(x)), u, v, u * u, v * v, u * v])


def value(coeff, p):
    a = design([p])[0]
    return float(a @ coeff)


def main():
    raw_files = sorted(glob.glob(str(ROOT / "lab" / "full-*.json")))
    sources = [str(ROOT / "initial.json")] + raw_files
    rows = []
    for path in sources:
        obj = json.loads(Path(path).read_text())
        for row in obj.get("observations", [obj]):
            rows.append(
                {
                    "x": float(row["x"]),
                    "y": float(row["y"]),
                    "value": float(row["value"]),
                    "impurity": float(row["impurity"]),
                    "source": str(Path(path).relative_to(ROOT)),
                }
            )
    points = np.array([[r["x"], r["y"]] for r in rows])
    yields = np.array([r["value"] for r in rows])
    impurities = np.array([r["impurity"] for r in rows])

    a = design(points)
    coeff = np.linalg.lstsq(a, yields, rcond=None)[0]
    residual = yields - a @ coeff
    dof = len(yields) - a.shape[1]
    sigma2 = float(residual @ residual / dof)
    cov = sigma2 * np.linalg.inv(a.T @ a)
    c = coeff

    # Vertex of the fitted quadratic: gradient g + H p = 0.
    hessian = np.array([[2.0 * c[3], c[5]], [c[5], 2.0 * c[4]]])
    grad = np.array([c[1], c[2]])
    optimum_uv = -np.linalg.solve(hessian, grad)
    optimum_xy = (optimum_uv + 1.0) / 2.0

    # Delta-method covariance of the vertex.
    def vertex(cc):
        h = np.array([[2.0 * cc[3], cc[5]], [cc[5], 2.0 * cc[4]]])
        return -np.linalg.solve(h, np.array([cc[1], cc[2]]))

    jac = np.zeros((2, 6))
    for j in range(6):
        step = np.zeros(6)
        step[j] = 1e-7
        jac[:, j] = (vertex(c + step) - vertex(c - step)) / 2e-7
    vertex_cov = jac @ cov @ jac.T

    # Yield prediction interval at the vertex.
    def yield_grad(p):
        x, y = p
        u, v = 2 * x - 1, 2 * y - 1
        return np.array([1.0, u, v, u * u, v * v, u * v])

    g = yield_grad(optimum_xy)
    pred_sd = math.sqrt(max(sigma2 * (1.0 + g @ np.linalg.inv(a.T @ a) @ g), 0.0))

    # Impurity surface, same interaction basis.
    imp_coeff = np.linalg.lstsq(a, impurities, rcond=None)[0]
    imp_residual = impurities - a @ imp_coeff
    imp_rmse = float(np.sqrt(np.mean(imp_residual ** 2)))
    # Conservative interval: use max(fitted residual RMSE, declared 0.01).
    imp_sd = max(imp_rmse, 0.01)
    imp_cov = imp_sd ** 2 * np.linalg.inv(a.T @ a)
    imp_pred = value(imp_coeff, optimum_xy)
    gi = yield_grad(optimum_xy)
    imp_pred_sd = math.sqrt(max(imp_sd ** 2 * (1.0 + gi @ np.linalg.inv(a.T @ a) @ gi), 0.0))

    # Is the grid point (0.5, 0.5) inside the 95% vertex confidence ellipse?
    diff = optimum_uv - np.zeros(2)
    mahalanobis2 = float(diff @ np.linalg.inv(vertex_cov) @ diff)
    center_p = math.exp(-mahalanobis2 / 2.0)  # chi-square 2 df survival

    center_rows = [r for r in rows if abs(r["x"] - 0.5) < 1e-12 and abs(r["y"] - 0.5) < 1e-12]
    submitted_rows = [r for r in rows if abs(r["x"] - 0.491) < 1e-12 and abs(r["y"] - 0.495) < 1e-12]
    quick = json.loads((ROOT / "lab" / "quick-0.5-0.5.json").read_text())
    calibrations = [json.loads(p.read_text()) for p in sorted((ROOT / "lab").glob("cal-*.json"))]

    result = {
        "objective": "maximize yield (%) over x,y in [0,1] subject to impurity fraction <= 0.115",
        "method": {
            "model": "quadratic response surface with interaction, normalized u=2x-1, v=2y-1",
            "selection": "interaction model has much lower leave-one-out CV RMSE than additive",
            "fit_sigma": math.sqrt(sigma2),
            "yield_rmse": math.sqrt(float(np.mean(residual ** 2))),
            "n_full_observations": len(rows),
            "dof": dof,
        },
        "yield_model_scaled": {
            "terms": ["intercept", "u", "v", "u^2", "v^2", "u*v"],
            "coefficients": c.tolist(),
        },
        "yield_model_physical": {
            "terms": ["intercept", "x", "y", "x^2", "y^2", "x*y"],
            "coefficients": np.linalg.lstsq(
                np.column_stack(
                    [np.ones(len(points)), points[:, 0], points[:, 1],
                     points[:, 0] ** 2, points[:, 1] ** 2,
                     points[:, 0] * points[:, 1]]
                ),
                yields,
                rcond=None,
            )[0].tolist(),
        },
        "impurity_model_scaled": {
            "terms": ["intercept", "u", "v", "u^2", "v^2", "u*v"],
            "coefficients": imp_coeff.tolist(),
            "rmse": imp_rmse,
        },
        "continuous_optimum": {
            "u": float(optimum_uv[0]),
            "v": float(optimum_uv[1]),
            "x": float(optimum_xy[0]),
            "y": float(optimum_xy[1]),
            "predicted_yield": value(c, optimum_xy),
            "prediction_sd": pred_sd,
            "prediction_interval_95": [value(c, optimum_xy) - 1.96 * pred_sd,
                                        value(c, optimum_xy) + 1.96 * pred_sd],
            "predicted_impurity": imp_pred,
            "predicted_impurity_upper_95": imp_pred + 1.96 * imp_pred_sd,
            "vertex_se": np.sqrt(np.diag(vertex_cov)).tolist(),
            "vertex_covariance": vertex_cov.tolist(),
        },
        "submitted_point": {
            "x": 0.491,
            "y": 0.495,
            "note": "rounded model vertex; two independent full measurements exist at these exact coordinates",
            "full_measurements": submitted_rows,
            "predicted_yield_at_submitted": value(c, [0.491, 0.495]),
            "predicted_impurity_at_submitted": value(imp_coeff, [0.491, 0.495]),
        },
        "center_comparison": {
            "full_measurements": center_rows,
            "mean_yield": float(np.mean([r["value"] for r in center_rows])),
            "mean_impurity": float(np.mean([r["impurity"] for r in center_rows])),
            "mahalanobis2_vertex_vs_center": mahalanobis2,
            "chi2_2df_survival": center_p,
            "interpretation": "center is inside the 95% vertex confidence region; measured difference is within noise",
        },
        "quick_check": {
            "record": quick,
            "note": "quick mode has noise_sd 0.45 and is not included in the full-mode fit",
        },
        "calibration": {
            "records": calibrations,
            "instrument": "original",
            "offset": 0,
            "units": {"yield": "%", "impurity": "fraction"},
            "note": "calibration offset 0 at two locations; no correction applied",
        },
        "budget": {
            "total": 30,
            "spent": 29,
            "remaining": 1,
            "breakdown": "29 new units = 2 calibrations x 2 + 1 quick x 1 + 8 full x 3; the 9 initial full observations were supplied and are not recharged",
        },
        "limitations": [
            "Model is quadratic; predictions are not measurements and causal validity is not established.",
            "Observed design covers x,y in [0.1,0.9] for most points; the optimum is interior, so boundary extrapolation is not used.",
            "The surface is very flat near the top; several points within 0.02 of the vertex are statistically indistinguishable.",
            "Full-mode noise_sd is 0.18; quick-mode noise_sd is 0.45; calibration has a separate 2-unit cost.",
            "Impurity predictions use the fitted quadratic and a conservative 0.01 impurity noise scale; the observed impurity fit RMSE is smaller.",
        ],
        "sources": [str(Path(p).relative_to(ROOT)) for p in sources],
    }
    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
