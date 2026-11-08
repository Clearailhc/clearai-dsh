#!/usr/bin/env python3
"""Deterministic post-hoc analysis of the final measurements (no new experiments).

Reads the accumulated input (lab/input-final.json) and the response-surface fit
(lab/model-final.json), and reports:
  * the quadratic stationary point and its predicted yield / impurity,
  * repeat statistics for the centre point,
  * paired quick-vs-full differences (same x,y),
  * the measurement ledger and remaining budget.
Writes lab/analysis-final.json.
"""
import glob
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / 'lab' / 'input-final.json'
MODEL = ROOT / 'lab' / 'model-final.json'


def design_scaled(x, y, interaction=True):
    """Same design as method/response_surface.py (bounds 0..1 -> scaled -1..1)."""
    X = 2.0 * np.asarray(x, float) - 1.0
    Y = 2.0 * np.asarray(y, float) - 1.0
    cols = [np.ones_like(X), X, Y, X * X, Y * Y]
    if interaction:
        cols.append(X * Y)
    return np.column_stack(cols)


def predict_value(coeff, x, y):
    return float((design_scaled(np.array([x]), np.array([y])) @ np.asarray(coeff, float)).item())


data = json.loads(INPUT.read_text())
model = json.loads(MODEL.read_text())

value_coeff = next(m['coefficients'] for m in model['models'] if m['kind'] == model['selected_model'])
impurity_coeff = None
# impurity fit coefficients are not exported by the script; refit here with the same design.
rows = data['observations']
x = np.array([r['x'] for r in rows])
y = np.array([r['y'] for r in rows])
imp = np.array([r['impurity'] for r in rows])
A = design_scaled(x, y)
impurity_coeff = np.linalg.lstsq(A, imp, rcond=None)[0]

# Stationary point of the quadratic yield model: grad = 0.
b1, b2 = value_coeff[1], value_coeff[2]
q11, q22, q12 = 2 * value_coeff[3], 2 * value_coeff[4], value_coeff[5]
M = np.array([[q11, q12], [q12, q22]])
stat_scaled = np.linalg.solve(M, -np.array([b1, b2]))
stat_x, stat_y = (stat_scaled + 1) / 2

stations = {
    'quadratic_stationary_point': {
        'x': float(stat_x), 'y': float(stat_y),
        'predicted_yield': predict_value(value_coeff, stat_x, stat_y),
        'predicted_impurity': float((design_scaled(np.array([stat_x]), np.array([stat_y])) @ impurity_coeff).item()),
    },
    'centre_0.5_0.5': {
        'predicted_yield': predict_value(value_coeff, 0.5, 0.5),
        'predicted_impurity': float((design_scaled(np.array([0.5]), np.array([0.5])) @ impurity_coeff).item()),
    },
}

# Repeat statistics at the centre (full mode only, including the initial grid reading).
centre_full = [r for r in rows if abs(r['x'] - 0.5) < 1e-9 and abs(r['y'] - 0.5) < 1e-9 and r['mode'] == 'full']
vals = np.array([r['value'] for r in centre_full])
stations['centre_full_repeats'] = {
    'n': int(len(vals)), 'values': vals.tolist(),
    'mean': float(vals.mean()), 'sd': float(vals.std(ddof=1)) if len(vals) > 1 else None,
    'se': float(vals.std(ddof=1) / math.sqrt(len(vals))) if len(vals) > 1 else None,
    'impurity_range': [float(min(r['impurity'] for r in centre_full)), float(max(r['impurity'] for r in centre_full))],
}

# Paired quick-vs-full differences at identical (x,y).
pairs = []
for q in [r for r in rows if r['mode'] == 'quick']:
    for f in [r for r in rows if r['mode'] == 'full' and abs(r['x'] - q['x']) < 1e-9 and abs(r['y'] - q['y']) < 1e-9]:
        pairs.append({'x': q['x'], 'y': q['y'], 'quick': q['value'], 'full': f['value'], 'diff_quick_minus_full': q['value'] - f['value']})
stations['paired_quick_full'] = pairs

# Impurity head-room at the recommendation and the boundary along y at x=0.5.
limit = float(data['impurity_limit'])
grid = np.linspace(0, 1, 1001)
pi_centre_line = design_scaled(np.full_like(grid, 0.5), grid) @ impurity_coeff
stations['impurity_limit'] = limit
stations['feasible_y_upper_at_x_0.5'] = float(grid[pi_centre_line <= limit].max())
pi_diag = design_scaled(grid, grid) @ impurity_coeff
stations['feasible_t_upper_on_diagonal'] = float(grid[pi_diag <= limit].max())

# Budget ledger from every endpoint response we kept.
ledger = []
for path in sorted(glob.glob(str(ROOT / 'lab' / '*.json'))):
    d = json.loads(Path(path).read_text())
    if 'spent' in d and 'cost' in d:
        ledger.append({'file': Path(path).name, 'mode': d.get('mode', 'calibrate'), 'cost': d['cost'], 'spent': d['spent']})
ledger.sort(key=lambda r: r['spent'])
stations['ledger'] = ledger
stations['spent_final'] = max(r['spent'] for r in ledger)
stations['budget'] = data.get('remaining_budget', 1) + stations['spent_final']

out = {'note': 'post-hoc analysis only; predictions are not measurements',
       'input': str(INPUT.relative_to(ROOT)), 'model': str(MODEL.relative_to(ROOT)),
       'value_coefficients_scaled': value_coeff, 'impurity_coefficients_scaled': impurity_coeff.tolist(),
       **stations}
(ROOT / 'lab' / 'analysis-final.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps(out, indent=1))
