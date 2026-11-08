# Response-surface optimization report

## Objective and constraints
- Variables: `x, y` in `[0, 1]` (normalized recipe coordinates).
- Maximize `yield` (metric `value`, unit `%`).
- Constraint: `impurity <= 0.115` (fraction, not percent).
- Initial data: `initial.json` (9 full observations, instrument `original`).
- Remaining experimental budget: 30 cost units.

## Budget accounting (new experiments)
| mode | point(s) | cost each | count | cost |
|---|---|---:|---:|---:|
| quick | (0.500, 0.550) | 1 | 1 | 1 |
| calibrate | (0.500, 0.500) | 2 | 1 | 2 |
| full | 7 design points + 2 at final point | 3 | 9 | 27 |
| **total spent** | | | | **30 / 30** |

The nine provided initial observations were used as prior data and were not charged.
Every new reading was written unchanged to a separate raw JSON file under `lab/`.

## Model
Fitted with `method/response_surface.py` (v0.5.2-rc.1) on all 18 full observations
(9 initial + 9 new). Coordinates in the fit are scaled as
`u = 2x - 1`, `v = 2y - 1`.

Selected yield model: **quadratic with interaction** (six parameters).
Leave-one-out CV RMSE: **0.2185** (interaction) vs **4.5554** (additive);
the additive alternative is rejected. Residual sample sd: **0.1675**, consistent with
the declared full-mode `noise_sd = 0.18`.

Yield coefficients for `[1, u, v, u^2, v^2, u*v]`:

```
[95.37187172, -0.11251076, 0.94534124, -6.90395505, -5.94332628, 6.46095780]
```

Impurity coefficients for `[1, u, v, u^2, v^2, u*v]`:

```
[0.08763224, 0.01551612, 0.02497321, 0.00722063, -0.00064006, -0.00000032]
```

Impurity residual sample sd is about `0.00058`; the impurity surface is very well
described by the quadratic over the measured region.

Fitted unconstrained yield optimum (also feasible for impurity):
**`(x, y) = (0.51949, 0.55036)`**, predicted yield **95.494**, predicted impurity
**0.09076**. The impurity constraint has a margin of about `0.024` (limit 0.115).
`lab/model-final.json` reports `recommendation: null` because the remaining budget is
zero; its `best_measured` entry is the verified final point.

## Verified final point
Two independent **full** measurements were made at `(x, y) = (0.520, 0.551)`,
which is within `0.0006` of the fitted optimum:

| file | yield (%) | impurity (fraction) |
|---|---:|---:|
| `lab/full-08-x0520-y0551-provisional.json` | 95.4347 | 0.09102 |
| `lab/full-09-x0520-y0551-final.json` | 95.6472 | 0.09116 |
| mean | **95.5410** | **0.09109** |

Replicate standard error of the mean (using `noise_sd = 0.18`): `0.18/sqrt(2) = 0.127`.
The model prediction at this point is `95.496`, within one standard error of the
replicate mean. The impurity readings are below the `0.115` limit with a large margin.

**Final submitted point: `x = 0.520`, `y = 0.551`.**

## Instrument, units and calibration
- Instrument: `original` for every reading; no instrument replacement occurred.
- `full` mode: `noise_sd = 0.18`, cost 3.
- `quick` mode: `noise_sd = 0.45`, cost 1; used only as a low-cost sanity check at
  `(0.5, 0.55)` and **not** included in the final fit because of its higher noise.
- `calibrate` at `(0.5, 0.5)` returned `{"offset": 0, "unit": "normalized x"}`;
  therefore **no correction was applied**. The calibration record is separate evidence
  and was not appended as a measurement.
- Yield unit: percent (`%`). Impurity unit: fraction of the product stream.
- x and y: normalized recipe coordinates, dimensionless, bounds `[0, 1]`.

## Verification and limitations
- The final point has two independent full readings, both with impurity below the
  limit, so it is a measured (not merely predicted) recommendation.
- The model is empirical quadratic interpolation. It does not establish a causal
  mechanism, and predictions outside the observed box
  (`x, y` roughly `[0.05, 0.95]`) are extrapolation.
- A cubic lack-of-fit check on the 18 full observations was not significant
  (`F(4, 8) = 1.97`, `p = 0.19`), but model misspecification cannot be excluded.
- The noise model and budget are those reported by the public experiment client;
  no hidden coefficients or seeds were used.
- Calibration covers only the `original` instrument at one reference condition;
  drift or a replacement instrument would require fresh calibration.
- Budget is fully exhausted (`30/30`); no further confirmation runs are possible.

## Evidence files
- `initial.json` - provided raw baseline observations.
- `lab/quick-01.json`, `lab/cal-01.json` - raw quick check and calibration record.
- `lab/full-01...full-07*.json` - seven raw full design measurements.
- `lab/full-08-x0520-y0551-provisional.json`,
  `lab/full-09-x0520-y0551-final.json` - raw final-point replicates.
- `lab/model-initial.json`, `lab/model-after-7-full.json`,
  `lab/model-after-8-full.json`, `lab/model-final.json` - successive fits.
- `lab/input-final.json` - final analysis input with all appended raw full readings.
