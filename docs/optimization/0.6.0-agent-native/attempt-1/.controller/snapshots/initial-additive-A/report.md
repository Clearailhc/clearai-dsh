# Yield optimization report

## Objective and constraints

- Decision variables: `x, y ∈ [0, 1]`.
- Objective: maximize yield (`value`, reported in percent).
- Constraint: impurity (`impurity`, reported as a fraction) must not exceed **0.115**.
- Total experimental budget: **30** cost units. Final spend: **30 / 30**.

## Instrument and calibration conventions

- All reported measurements used `instrument = "original"` with `metric = "yield"`.
- `full` mode: cost 3, yield noise sd ≈ 0.18 %, impurity in fraction.
- `quick` mode: cost 1, yield noise sd ≈ 0.45 % (noisier; used only as a cross-check, not in the final fit).
- `calibrate` mode: cost 2. The calibration run at `(x, y) = (0.5, 0.5)`
  (`lab/cal-01.json`) returned `offset = 0` and `unit = "normalized x"`,
  i.e. no additive instrument offset was applied/reported. Calibration records were
  kept separate and were **not** appended as yield measurements.
- No replacement instrument or retroactive correction was used. Yield values are raw
  readings in percent; impurity values are raw readings as fractions.

## Budget ledger

| Mode | Runs | Unit cost | Spend |
|---|---:|---:|---:|
| calibrate | 1 | 2 | 2 |
| quick | 1 | 1 | 1 |
| full | 9 | 3 | 27 |
| **total** |  |  | **30** |

- Initial data: 9 full observations (3×3 grid) supplied in `initial.json`.
- New full measurements: `lab/full-01.json` … `lab/full-09.json`.
- Raw quick cross-check: `lab/quick-01.json` at `(0.45, 0.45)`, value 95.53145 %,
  impurity 0.08402 (consistent with the full readings within its 0.45 % noise sd).

## Model

The bundled `method/response_surface.py` was used for model comparison and refitting
(`lab/model-initial.json`, `lab/model-updated.json`, `lab/model-final.json`).

Final fit uses the 18 full observations (initial 9 + 9 new). The additive quadratic
surface is preferred over the interaction model because its leave-one-out CV RMSE is
lower and the interaction is statistically negligible:

- additive: CV RMSE 0.15795
- interaction: CV RMSE 0.16860
- residual sd (additive, 18 full points): 0.16465

Additive quadratic in physical coordinates
`yield ≈ c0 + b·x + c·y + d·x² + e·y²`:

| term | coefficient | std. error |
|---|---:|---:|
| c0 | 84.82099 | 0.17610 |
| x | 24.06392 | 0.62596 |
| y | 21.13713 | 0.62639 |
| x² | −26.53203 | 0.59807 |
| y² | −23.54363 | 0.59836 |

Implied unconstrained stationary point: `(x, y) ≈ (0.4535, 0.4489)`.
Predicted yield there: **95.0215 %**. The interaction coefficient is only −0.062
(std. error 0.535), so it does not materially move the optimum.

Impurity over the same full data is well described by an additive quadratic:

`impurity ≈ 0.05538 + 0.000383·x + 0.046521·y + 0.030400·x² + 0.003505·y²`

with residual sd 0.00079. At the optimum this predicts impurity ≈ 0.0834, and the
method's 1.96·prediction-interval upper bound (using the method's impurity noise
sd = 0.01) is ≈ 0.1039, below the 0.115 limit.

## Verification and final choice

| Point | Full readings (yield %) | Impurity | Feasible? |
|---|---|---:|---|
| (0.45, 0.45) | 95.0982 (`lab/full-01.json`), 95.1784 (`lab/full-08.json`); mean 95.1383 | 0.08342, 0.08452 | yes |
| (0.46, 0.45) | 95.2592 (`lab/full-09.json`) | 0.08426 | yes |

The single highest raw reading is at `(0.46, 0.45)`, but it differs from the replicated
`(0.45, 0.45)` mean by only 0.12 %, which is well inside the 0.18 % full-mode noise sd.
The final quadratic model puts the stationary point at `(0.4535, 0.4489)`, so
`(0.45, 0.45)` is marginally closer to the fitted optimum than `(0.46, 0.45)` and is
supported by two independent full measurements. The final reported point is therefore
the measured, replicated point **(0.45, 0.45)**.

Predicted yield at `(0.45, 0.45)`: 95.0211 %; measured mean: 95.1383 %.
Predicted impurity at `(0.45, 0.45)`: 0.0834 (limit 0.115), with both measured
impurities below 0.085.

## Limitations

- Predictions come from a local quadratic response surface over the observed bounding
  box `[0.1, 0.9] × [0.1, 0.9]`; the corners/edges of `[0, 1]²` were not all measured,
  and extrapolation outside the observed box is unsupported.
- The fit is observational; it does not establish causal validity or guarantee
  interpolation accuracy away from measured locations.
- Full-mode yield noise (sd ≈ 0.18 %) is larger than the fitted differences among
  `(0.45, 0.45)`, `(0.46, 0.45)` and the estimated stationary point. The choice among
  these near-tied points is therefore not statistically decisive; the selected point
  is the replicated near-optimum, not a claim of a unique true maximum.
- Calibration evidence is a single `offset = 0` check at `(0.5, 0.5)`. No drift or
  replacement-instrument correction can be assessed from one calibration record.
- The quick reading has a larger noise sd (0.45 %) and was excluded from the final
  model fit to avoid mixing noise levels; it is retained as raw evidence only.
- The impurity upper bound uses the method's stated impurity noise model; measured
  impurity is comfortably below the limit, so the decision is not sensitive to it.

## Artifacts

- `initial.json` — original raw data, unchanged.
- `lab/cal-01.json` — calibration record (offset 0).
- `lab/quick-01.json` — raw quick cross-check.
- `lab/full-01.json` … `lab/full-09.json` — raw full measurements.
- `lab/model-initial.json`, `lab/model-updated.json`, `lab/model-final.json` —
  response-surface fits and model comparison.
- `lab/input-updated.json`, `lab/input-final.json` — fit inputs with appended raw
  measurements (original `initial.json` never overwritten).
- `submission.json` — final decision and evidence list.
