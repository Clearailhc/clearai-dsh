# ClearAI Glossary

Stable ClearAI terms. Authoritative definitions of objects, levels and states live in the [Verification Loop](verification-loop.md); this list gives one line each. UI and reports use plain words, shown in parentheses.

## ClearAI
A local-first **ontology discovery and exploration platform**: AI grows a domain ontology in a real project, using the epistemic loop as its method of verification. Delivered as a native DSH plugin.

## Epistemic loop
Question → judgement (state what would prove it wrong) → a test that could fail → evidence → bounded conclusion → grows into the ontology.

## Scaffold
ClearAI supplies only what the model cannot and should not do for itself — the **fact boundary**: what counts as done, whose verdict counts, what may enter knowledge. Everything else is left to the model's judgement or to the host.

## Goal (question)
The question to answer. Text, continuation, pause and completion belong to the host's native goal; ClearAI attaches criteria and hypotheses through `Frame` and completes it through `Conclude` after an independent evaluation passes.

## Hypothesis (judgement)
A judgement to test, stating what result would refute it. Its status is computed from evidence, never scored by the model.

## Criteria (what counts as done)
Written in advance: what counts as done, or wrong. Written before the work; revisions keep the old versions.

## Verification
A step that tests one hypothesis, with a level and criteria. A step tests at most one hypothesis.

## Observation (what was delivered)
The artefacts and execution record a step delivers. It reports what was found; on its own it establishes nothing.

## Admission (accepted / blocked)
Answers only whether an artefact is accepted: it exists, is non-empty, is well-formed. Admission is not adjudication.

## Evaluation (independent review)
A verdict from comparing observations against the registered criteria. At L3+ an independent evaluator does it: fresh context, read-only, structured output.

## Evidence (why)
The result of an evaluation: supports, refutes or inconclusive, with a level and references. Never edited.

## Fact (a conclusion you can trust)
A hypothesis promoted once evidence suffices, with scope, level and evidence, optionally with assertions. A human may retract it; the record stays.

## Level (strength of the test)
L0–L4. Decides only who judges, and that L4 needs a person's approval.

## Human gate (to handle)
Decisions only a person can make: L4 approval, a plan blocked repeatedly, a fact meeting counter-evidence. The call that opened the gate asks the person directly and the answer never passes through the model; if nobody can answer, the goal waits.

## Domain ontology
The language layer of project knowledge: concepts, predicates, value forms. A convention, not an empirical claim: admitted with a basis, display details revisable, deprecation sticky, any change of meaning needs a new id. In product context "ontology" means this.

## Concept
An entry in the domain ontology: name, definition, aliases, parent. A node of the ontology graph.

## Predicate
A declared relation: domain, range (another concept or a value form), single-valued or not. An edge of the ontology graph.

## Instance
A concrete thing that was found. Recorded with provenance the moment it is observed. A node of the entity graph.

## Assertion
Subject–predicate–object (+ qualifiers). The content form of a fact, and additive: a fact without assertions is still valid and shows as "unstructured".

## Value form
The form of an assertion's object: statement, quantity (number + unit), formula, code (a re-runnable file in the workspace), reference.

## Conflict
Two unretracted confirmed facts disagreeing on the same single-valued predicate for the same subject. Surfaced, never adjudicated.

## Gap
A reading computed from the record, each pointing to an action that would close it. Shown to the model only.

## Ontology graph / entity graph
The ontology graph shows concepts and predicates — what the language allows. The entity graph shows instances and assertions — what has been said, each edge carrying its level and review state. They are drawn separately.

## Explore (UI)
Middle pane for the process: questions, candidate hypotheses with their predictions, the next step, unexplained observations, and a collapsed process record (judgments, the plan's steps and gates).

## Ontology (UI)
Middle pane for results: answer cards per question, the ontology and entity graphs, established facts, lessons.

## RSI (recursive self-improvement)
A system using its own output to improve how it works in future. ClearAI makes no RSI claim.
