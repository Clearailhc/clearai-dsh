# Optimization report

## Objective and search space
- Maximize yield (value, %) over x, y in [0, 1].
- Constraint: impurity (fraction) <= 0.115.
- Initial evidence: `initial.json` (9 full observations, 3x3 grid over x,y = 0.1, 0.5, 0.9).

## Instrument conventions
- All returned records use `instrument: "original"`, `metric: "yield"`.
- `value` is yield in percent; `impurity` is a fraction (not percent).
- Full mode: `noise_sd = 0.18`; cost 3.
- Quick mode: `noise_sd = 0.45`; cost 1. Quick readings were used only as diagnostics, not in the final fit
  (two quick readings at 0.5,0.5 averaged ~96.08 versus ~95.40 for full readings, so quick has extra noise/
  apparent positive offset and is not suitable for precise final selection).
- Calibration: cost 2; both calibrations returned `instrument: "original"`, `offset: 0`,
  `unit: "normalized x"`. No offset correction was applied to any reading.
- Budget: 30 units. Spent = 8 full (24) + 2 quick (2) + 2 calibrate (4) = 30; remaining 0.

## Model and parameters
Bundled method: `method/response_surface.py` v0.5.2-rc.1.
The interaction (full quadratic) surface was selected over the additive surface by leave-one-out CV.

Final yield model, with scaled u = 2x-1, v = 2y-1:

```
yield = 95.381937
      + 3.812367 u
      - 1.597874 v
      - 6.836549 u^2
      - 5.691298 v^2
      + 5.085731 u v
```

- Interaction CV RMSE = 0.2007 % (additive CV RMSE = 3.3425 %).
- Residual sd on 17 full observations = 0.155 % (consistent with the 0.18 % full-mode noise).
- Stationary point: u = 0.27177, v = -0.01895 -> x = 0.63589, y = 0.49052;
  predicted yield = 95.915 %.
- Impurity model (additive, fraction):
  `0.087398 + 0.015013 u + 0.024403 v + 0.009061 u^2 - 0.000465 v^2`.
  Predicted impurity at the optimum = 0.0917, below the 0.115 limit.
- Conservative method recommendation using impurity upper bound `mean + 1.96 sd` is (0.65, 0.50);
  its predicted yield is effectively identical to the stationary point. The submitted (0.64, 0.49)
  is the fitted stationary point and has a direct full verification.

## Verification
- Full measurement at (0.64, 0.49): yield = 95.8588 %, impurity = 0.09264 (feasible).
- This is a fresh full measurement of the submitted coordinate, not a model prediction.

## Limitations
- The quadratic is a local response-surface approximation; it is not proof of causal validity.
- Observations cover the bounding box [0.1, 0.9]^2. Points outside that box, even inside [0,1]^2,
  are extrapolations and less reliable.
- Single instrument ("original"); results are conditional on this instrument/calibration.
- Measurement noise remains (full sd 0.18 %); the reported verification is one realization.
- The impurity model is an approximation; the measured verification impurity is the direct check.
- Budget is exhausted, so no further full replicate at the final coordinate was possible.
