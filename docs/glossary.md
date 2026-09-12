# ClearAI Glossary

This glossary defines the stable terms used by ClearAI. No other product or brand terms are normative.

## ClearAI
A local-first epistemic workspace for exploring scientific questions and the unknown, helping a person understand material, form propositions, verify them in stages, and retain conclusions with explicit fact boundaries. In this repository it is delivered as a DSH-native plugin.

## Epistemic Loop
The repeatable cycle of Frame → Hypothesize → Plan → Observe → Verify → Evaluate → Record and act. At runtime it compresses into four beats: plan, execute, observe, reflect.

## Epistemic Harness
The operational framework around the Epistemic Loop: it records propositions, hypotheses, verifications, observations, evidence, evaluations, and admissions, while preserving the boundaries between them and keeping human judgment in the loop where required.

## DSH native plugin
A plugin implemented for the DeepSeek Harness (DSH) runtime and composed through its native plugin model. It extends the running harness through declared capabilities and lifecycle-managed effects rather than by changing ClearAI's core content or engine rules.

## proposition
A claim stated clearly enough to be examined. A proposition is not yet a fact.

## hypothesis
A proposition carrying an explicit refutation condition and preparing to enter verification. A hypothesis's state is computed from evidence, never scored by the model.

## verification
A registered action taken to test a hypothesis, carrying a level and criteria. A step carries at most one verification.

## fact
A conclusion that has been admitted under the applicable evidence and evaluation rules. A fact remains traceable to the proposition, observations, evidence, and admission that support it.

## evidence
Material used to support or challenge a proposition, such as a source, record, measurement, or other traceable artifact. Evidence is not itself a conclusion.

## observation
A recorded result of examining the world, a source, or a system. An observation reports what was encountered; it does not by itself establish a fact.

## evaluation
An explicit assessment of observations and evidence in relation to a proposition, including the strength, limitations, and uncertainty of that support.

## admission
The governed decision to accept a proposition as a fact at a stated level or scope. Admission is distinct from evaluation and must preserve the basis for the decision.

## human gate
A required point at which a person reviews and authorizes an admission or other consequential epistemic decision. Automation may prepare the decision, but it does not replace the human gate.

## RSI
Recursive self-improvement: a process in which a system uses its own outputs or capabilities to improve how it performs future work. In ClearAI, RSI remains subject to the Epistemic Loop, traceability, and applicable human gates.
