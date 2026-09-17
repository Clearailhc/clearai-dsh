# Physical Experiment Case: Thermal Drift in a Sensor

## Question
Does a temperature change produce a measurable zero drift in a bench-top pressure sensor over a one-hour observation?

## Proposition
Within the specified temperature range and mounting arrangement, sensor zero may shift in a repeatable way, but the magnitude and cause remain to be measured.

## Criterion
Define an acceptable uncertainty budget, sampling interval, temperature range, stabilization time, and replicate count before starting. A result must distinguish sensor drift from room fluctuations, cable motion, power changes, and operator intervention.

## Execution
A trained human prepares the apparatus, inspects cables and manufacturer limits, applies only approved low-energy conditions, and stops on abnormal heat, noise, leakage, or damage. The agent may help draft a checklist and analyze exported readings, but does not connect hardware, handle materials, bypass interlocks, or authorize unattended operation.

## Observation / Evaluation
Compare zero readings with temperature logs across repeated runs and a sham or reference channel. Estimate effect size and uncertainty; do not infer causation from one correlated trace. Evaluation remains a preliminary bench observation unless controls and calibration are adequate.

## Revision
Improve thermal shielding, add a reference sensor, randomize run order, recalibrate, or shorten the range. Any physical change is reviewed and carried out by a responsible human under applicable laboratory procedures.

## What Is Retained
Retain the approved protocol, risk notes, device identity, calibration status, raw logs, environmental conditions, analysis notebook, deviations, and human sign-off. Preserve a clear boundary between agent suggestions and actions actually performed.

## Limitations
A bench result may not generalize across devices, materials, environments, or long-term aging. Safety, legal, institutional, and manufacturer requirements take priority. The agent cannot certify apparatus, materials, or human safety.


## The ontology in that run

That run predates the typed form ("fact = prose"). Under the 0.2.0 design the same chain grows like this (real-run evidence in the three Hengtong sessions of the development plan):

- **Words first**: `RegisterTerm` raises the concepts `sensor_unit` and `ambient_temp`, each basis pointing at the manufacturer's procedure; `RegisterPredicate` raises `zero_drift` (subject domain `sensor_unit`, value form `quantity` in mbar, **single-valued**) — single-valued is the point: one zero-drift reading per sensor in any conclusion.
- **Hypotheses carry assertions**: "zero drift < 0.2 mbar over a 10 °C rise" carries the assertion `zero_drift(sensor_unit#3) = 0.08 mbar`; an assertion naming an unregistered predicate is refused **before anything lands**.
- **Fixed at promotion**: once the two differently-criterized hypotheses are delivered, audited and promoted, and the second one reads `0.31 mbar` — same subject, same single-valued predicate, two values — the projection **derives a conflict pair automatically**: the runtime card says it, the ontology shelf says it, **the system retracts neither side**; retracting or keeping is a human press (through the human gate, record kept).
- **The graph that grows**: the ontology graph gains `sensor_unit --zero drift--> quantity(mbar)`; the entity graph shows `sensor #3` carrying two `[L0][live]` assertion edges (0.08 and 0.31) — where it hurts is visible at a glance.
- **Old facts stay**: facts promoted before any of this remain on the shelf, marked "unstructured"; assertions are additive, not a threshold.
## Stored run

The task book this case was run against, and everything the run produced — the session record, the artifacts it left, and an honest reading of both — are kept with the case workspace. Nothing from a run is deleted, including runs that stopped halfway.

