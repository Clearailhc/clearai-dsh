#!/usr/bin/env python3
"""Reproducible convergence experiment for a periodic smooth reconstruction case."""
from __future__ import annotations

import csv
import json
import math
import platform
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "lab" / "cases" / "ai4sci"
OUT.mkdir(parents=True, exist_ok=True)


def cell_average(left: float, right: float) -> float:
    # Exact average of cos(2*pi*x) over one cell.
    return (math.sin(2 * math.pi * right) - math.sin(2 * math.pi * left)) / (2 * math.pi * (right - left))


def reconstruct_fourth(values: list[float], i: int) -> float:
    # Periodic four-point polynomial reconstruction at the right face.
    stencil = [values[(i + j) % len(values)] for j in (-1, 0, 1, 2)]
    return (-stencil[0] + 7 * stencil[1] + 7 * stencil[2] - stencil[3]) / 12


def main() -> None:
    ns = [16, 32, 64, 128, 256, 512]
    rows: list[dict[str, object]] = []
    for n in ns:
        dx = 1.0 / n
        averages = [cell_average(i * dx, (i + 1) * dx) for i in range(n)]
        errors = []
        for i, value in enumerate(averages):
            x_face = (i + 1) * dx
            exact = math.cos(2 * math.pi * x_face)
            errors.append(abs(reconstruct_fourth(averages, i) - exact))
        error = max(errors)
        previous = rows[-1]["error_linf"] if rows else None
        order = math.log(float(previous) / error, 2) if previous is not None else None
        rows.append({"n_cells": n, "dx": dx, "error_linf": error, "observed_order": order})

    with (OUT / "results.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    metadata = {
        "case": "periodic smooth reconstruction convergence",
        "function": "u(x)=cos(2*pi*x)",
        "domain": "[0,1)",
        "method": "four-point polynomial face reconstruction from exact cell averages",
        "boundary": "periodic",
        "norm": "L-infinity face error",
        "grid_sizes": ns,
        "command": "python lab/scripts/run_ai4sci_case.py",
        "python": platform.python_version(),
        "platform": platform.platform(),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    (OUT / "run_metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    print("n_cells,error_linf,observed_order")
    for row in rows:
        order = "-" if row["observed_order"] is None else f"{row['observed_order']:.6f}"
        print(f"{row['n_cells']},{row['error_linf']:.12e},{order}")


if __name__ == "__main__":
    main()
