# ClearAI Glossary

This glossary defines the stable terms used by ClearAI. No other product or brand terms are normative.

## ClearAI
A local-first ontology discovery and exploration platform: AI grows a living domain ontology inside real projects — with the epistemic loop as its process, settling research into an ever-growing knowledge structure (domain vocabulary + established entries + graphs). In this repository it is delivered as a DSH-native plugin.

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

## process ontology
The epistemic harness's own backend flow: which objects exist, which states they take, who may push which transition, and who judges at each level. It is a code declaration (`preset/plugins/ontology.js`), validated at assembly and changed per plugin release; it **never enters the project ledger and is not editable at runtime**. A human sees it as a state shape (worldlines, proposition groups); the model reads it as a charter (`clear/ontology/verification-loop.md`).

## domain ontology
A project knowledge base's **language layer**: a governed set of conventions about which concepts exist in this domain, which predicates relate them, and what value form a relation takes. Its authority is ledger events (`ontology/*`), folded into `state.lexicon`; entries are admitted with a basis, revised with versions, and only ever deprecated (never deleted), and a semantic change must take a new id. It is not itself an empirical claim — empirical claims use it as vocabulary and pass the loop to become facts. In product contexts, "the ontology" means this by default.

## concept (term)
One entry in the domain ontology: a domain concept's name, gloss, aliases and parent. It is a node in the ontology graph and what an assertion's `subject.type` may reference; admission requires a basis.

## predicate
A relation declaration in the domain ontology: its subject domain (a concept), its range (another concept, or one of the five value forms), and whether it is single-valued. It is an edge in the ontology graph; only multiple values on a single-valued predicate derive a **conflict**.

## assertion
The content form of a fact: subject–predicate–object (plus qualifiers). It is **additive** — a fact without one stays valid and simply shows as "unstructured". An assertion lands with the fact at promotion and is never rewritten retroactively.

## value form
The form of an assertion's object: statement, quantity (a number plus a unit), formula, code (a path to a re-runnable file in the workspace), or reference. A relation predicate's object is instead an **instance** of another concept.

## conflict
The paired reading the projection produces when two **un-retracted** confirmed facts fall on the same single-valued predicate, the same subject, and different objects. It is **surfaced, never adjudicated**: it retracts no side, decides nothing about which is true, and enters no gate; handling one goes through the existing human gate.

## ontology shelf
The shelf view of the ontology's established content: every entry carries its boundary and support level, and older unstructured entries stay on the shelf, marked as such. It is the renamed "fact shelf" — what sits on it did not change; what changed is that entries are read as content of the ontology rather than scattered conclusions.

## ontology graph
The graphical reading of the domain ontology: concepts are nodes, `is_a` and predicates are edges. It answers what this language **may** express — which is why it can exist before any fact does (a language before its sentences). It is drawn apart from the [entity graph](#entity-graph): their edges look alike, but one is a **declaration** and the other a **claim**.

## entity graph
The graph projected out of facts: instances are nodes, assertions are edges, and every edge carries that fact's support level and review state. It is drawn apart from the **ontology graph** (concepts and predicates) — one says "what may be expressed", the other "what has been expressed".

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
