# Case: against the bare model (the drifting thermometer)

[中文](bare-model-ab.zh-CN.md)

Same model, same tools and budget: one arm runs with ClearAI, the other without it (the bare model). Both arms work the same tasks with planted traps, and a blind grader scores them. These are the dev-set results from before the 0.5.0 release. The tasks were written by the developers and the samples are small, so this is early evidence, not a formal validity result. Full records are in [docs/optimization/sim-runs/](../optimization/sim-runs/).

## What the tasks hide

A simulated bench reactor with a budget of 30 runs. The goal is the highest-yield recipe that keeps impurity within spec. The true response surface lives inside the simulator, and the model cannot see it. There are two traps:

- **The control thermocouple drifts.** After a certain run, the actual temperature is 6–8 °C away from the setpoint. Every fifth run carries a reference probe reading, `T_ref`, which is the only clue.
- **Temperature is coupled to a second factor along a ridge.** Moving one factor at a time stops at the wrong point.

## Results

| Experiment | ClearAI | Bare model | Where the gap is |
|---|---|---|---|
| Reactor task, 4 runs each | 3/4 found the drift and corrected for the actual temperature | 1/4 | Entirely the drift item |
| Electrolyte task, 4 runs each (no data trap) | mean 2.25 / 5 | 2.25 / 5 | Tie |
| One rig, 3 lines in a row, 3 series each | task-3 mean 1.5 / 4; drift corrected in 5/6 later tasks | 1.17 / 4; 1/6 | Entirely the drift item |

**What did not improve for either arm:** recipes landed just as far from the true optimum, and nobody found the coupling ridge. ClearAI kept conclusions from being misled by bad data, but it did not make exploration deeper. That is the next design problem; the draft is [exploration-depth.zh-CN.md](../optimization/0.5-plan/exploration-depth.zh-CN.md).

## Why that item

Both arms **saw** that `T_ref` disagreed with the setpoint. The difference is what they did next.

The grader's notes on the bare model's three task-3 runs:

- "Saw the difference but neither trusted nor corrected it; the recipe was not converted."
- "Found the anomaly and suggested a repair, but did not conclude it was a stable −8 °C drift, and played down its effect."
- "Called runs 22, 26, 27 and 28 clean, though all of them had drifted."

One ClearAI task-3 run went like this:

1. **An expectation before acting.** The second step's expectation read "raising T raises impurity; yield may show a T×t interaction from curvature (from lessons l-7m96i2, l-2gbzvh)". Both lessons were left by the two earlier tasks and checked by an evaluator.
2. **A missed expectation gets recorded.** On the centre-point repeat, impurity fell from 0.148 to 0.064 and yield dropped too, which the expectation did not predict. Instead of explaining it away, the model recorded an unexplained item: "run 10 T_ref = 156.8 against setpoint 165, 8.2 °C low … the rig's reading is changing".
3. **An unexplained item needs an outcome.** The model lined up `T_ref` from runs 10, 15, 20, 25 and 30 (offsets −8.2, −8.4, −7.9, −7.5, −7.8), matched them against two centre-point repeats, marked the drift as verified, and wrote the recipe at the actual temperature (about 142 °C).
4. **An independent evaluator checks again.** The evaluator found two more gaps in the raw data: three repeats had no `T_ref`, and the drift onset fell somewhere between runs 5 and 10. It sent them back as unexplained items. The report added them as "unclear" and drew no conclusion from them.
5. **A lesson for the next line.** Among the lessons proposed at close: "drift is not always upward; on line C the furnace actually ran low, so don't assume the direction from an earlier line". It was written to `clear/knowledge/lessons/` only after the evaluator supported it.

The bare model was just as honest and cautious, and neither arm made many overconfident claims. ClearAI adds one thing: **a missed expectation cannot be explained away. It must be explained, ruled out with a reason, or handed to a person.**

## Cost

ClearAI used about 2.2× the bare model's tokens, plus 2–3 independent evaluations per run. On the task without a data trap (electrolyte), it neither won nor lost.
