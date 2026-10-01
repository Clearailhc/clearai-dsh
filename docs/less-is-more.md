# Less is more: what the person and the model should each perceive

This document anchors the "less is more" upgrade. It answers one question: **with the mechanisms already right, what should the person see, and what should the model be fed**. The skeleton (ledger, admission, independent judgment, append-only history, human gates) does not change by a single line; this round is subtraction only.

How it divides the work with the other two anchors:

- Internal names (code, ledger, prompts, the model's contract) remain governed by §7 of [Verification loop](verification-loop.md). That table gains a "what people hear" column, and that column is now authoritative for the interface.
- The layout of the Knowledge view is governed by §9 of [Domain ontology](domain-ontology.md).
- This document gives the **why**, the **decisions**, and the **checks** that prove each one.

---

## 1. Origin: what problem this solves

The biggest risk in researching with AI is not failing to answer, it is **answering too smoothly**: what is known, what is guessed and what is made up all come out in the same voice. People cannot tell which sentence to trust, and next time they start from zero again.

Epistemology and ontology each own half of the answer:

- **Epistemology** answers "why should I trust this sentence". A conclusion is trustworthy if and only if it survived a test that could have failed it, and it states when it would stop holding.
- **Ontology** answers "what do these conclusions add up to". Conclusions that hold settle into structure (concepts, relations, the concrete things found) so the next round starts from what is known, not from zero.

## 2. The person has only four questions

| Question | Answered by | Where |
|---|---|---|
| 1. **What can I trust right now?** (on what basis, when it would not hold) | Epistemology | The conclusion list in the Knowledge view; "conclusion / basis / scope" in reports |
| 2. **What was refuted, and what is still unclear?** | Epistemology | The last groups of the conclusion list; "refuted / still open" in reports |
| 3. **What has all this grown into?** | Ontology | The header graph of the Knowledge view (concept map / instance map) |
| 4. **What do I need to do?** | Human gates | "Needs you N" by the input box, gates in the process view, question cards |

Everything else (plans, steps, levels, admission, audit dispatch, worldlines, the ledger, term registration, gaps, continuation) is **the means that make those four answers trustworthy**. The means must be inspectable, but they should not be presented.

## 3. The perception budget

### Three layers for the person

| Layer | When it appears | What it holds |
|---|---|---|
| **Results** (always) | Always | Answers to questions 1–3: the conclusion list, the header graph, the files you got |
| **Needs you** (interrupts) | Only when truly needed | Question 4: approve a plan, choose between two routes, settle two conclusions that disagree, review a refuted fact. Absent when there is nothing to do |
| **Process** (on demand) | Only when opened | Evidence lines, plans and steps, route comparisons, vocabulary maintenance, file history, the skills catalogue |

**Test**: if a piece of information answers none of the four questions it does not belong in the results layer; if it needs no action from the person it does not interrupt them.

### Discipline for the model

The model has a perception budget too, and whatever it reads, it repeats.

1. **Inject a fact once.** The runtime card is injected by the pre-step when state changes; a tool result says only what this call did, and no longer carries the whole card.
2. **No self-contradicting readings on the card.** One number has one meaning; two meanings become two numbers.
3. **No repeated sermons.** Rules live in mechanisms, not restated in every reply.
4. **Speak the person's language.** Mechanism words are the language between the model and the system; reports to people translate them (D7).

## 4. Diagnosis: where the noise comes from (from the real UI and real sessions)

1. **The whole card rides on every tool result.** In two real-model long runs, 148 of 162 ClearAI tool calls returned the full runtime card, over 300,000 characters in total; registering one concept meant rereading every criterion and hypothesis. The same card is injected before each step anyway.
2. **Mechanism vocabulary leaks.** The panel used proposition, hypothesis, fact, promotion, threshold, L0–L4, self-judged, worldline, human gate, ontology shelf, read surface… People had to learn twenty-odd words before they could read their own research.
3. **Debt comes before knowledge.** The gap list (the model's to-do, phrased as "fill it with `RegisterInstance`") sat above what is known.
4. **Structural emptiness.** Facts are promoted only at close, so for most of a session the panel read "confirmed facts · 0" and every claim sat under "proposition · testing · L0 · self-judged".
5. **Internal identifiers leak.** Plan ids (`P-MTYCH5N1N02M · ACTIVE`), evidence ids (`e-1`), phase codes (`stage_boundary`), value forms (`statement`, `reference` drawn as nodes beside domain concepts).
6. **Self-contradicting readings.** The card said "stage boundary: all steps settled · completion 0%". The derived completion means "steps delivered" while a plan is active and "claims established" otherwise: one percentage sign, two meanings.
7. **Process drawn as a result.** Opening a claim first showed a state machine full of transitions that never happened.
8. **Sermons.** "It is a read surface, not an authority", "you cannot declare them", "never degrade into picking one at random" repeated in cards and replies.

## 5. Two layers of language

Internal names do not change (code, ledger and the model's contract stay as they are); **the interface and reports to people** use only the "what people hear" column. The full table is in §7 of [Verification loop](verification-loop.md); the common ones:

| Internal | What people hear |
|---|---|
| Hypothesis / proposition | Claim |
| Fact (promoted) | Established |
| Testing with support / with no evidence / tested but inconclusive | Supported, awaiting review / Not yet tested / Unclear |
| Refuted | Refuted |
| L0 / L1 / L2 / L3 / L4 | Reasoning / Checked sources / Recomputed / Independently reviewed / Confirmed by a person |
| Self-judged | Judged by the doer |
| Conflict | Conclusions disagree |
| Ontology shelf / "Ontology" tab | Knowledge |
| Gap | (not shown to people) |

## 6. Decisions

Each one names the path not taken and why.

**D1 Conclusions are one list, grouped by how far they can be trusted.** Established / supported, awaiting review / not yet tested / unclear / refuted; one sentence per row, with one line of basis below (the kind of evidence, and whether the doer judged it). Superseded and withdrawn items leave only an archive count.
*Not two shelves (facts + propositions)*: facts are promoted only at close, so the first shelf is empty for most of a session and everything the person wants is buried in mechanism words on the second. The person has one question, what can I trust, so there is one list.

**D2 The graph is the other half of the result, and stays in the header.** When terms exist, the header shows a compact graph (ontology graph / entity graph, one click apart); clicking a node filters the list below by that concept. The graph **draws only things in the domain**: value forms (`statement` / `quantity` / `reference` …) are grammar, not nodes.
*Not "graph collapsed by default"*: the first draft of this round did that, and it was wrong. It treated the ontology's answer (question 3) as process. The graph is both the face and the index, which matches the original judgment in §9 of Domain ontology.

**D3 Gaps are for the model only.** A gap is an account of "what shape this knowledge still lacks", and every remedy is a model verb; the person neither can nor needs to fill it. It stays on the runtime card, not in the Knowledge view. If a gap blocks closing, the model explains in plain words why it cannot close yet.

**D4 Process on demand.** Opening a row shows only: when it would not hold, each piece of evidence (in plain words, without evidence ids), what it asserts, open the original, see the process. The state machine in the expanded area is removed. The Deliverables view lists "what you got" first; each plan collapses to one line of how far along it is and opens to its brief and steps; no plan ids, authorization marks, full per-step criteria or bookkeeping counts.

**D5 The card is injected once.** A tool result's `message` says only what the call did; the card stays in the structured `card` field (`CheckPlan` still returns the card as its body, since that is its job). Removed from the card: the run mode (a deployment default, not an actionable fact), the closing sermon, the duplicated phase / completion line, the duplicated full goal text, and the criteria provenance line when nothing was revised; criteria appear once, under "done when".

**D6 One number, one meaning.** "Completion N%" becomes two concrete numbers: "plan a/b steps · claims established x/y". The derived `progress` itself is unchanged (other readers still use it); only how the card says it changes.

**D7 How to report.** The prompt asks the model to speak to people in their words and not to relay mechanism words or internal ids; conclusions follow "conclusion / basis / scope / refuted / still open", skipping what is absent; process is mentioned only when asked or when a decision is needed.

**D8 What does not change.** Mechanisms, the ledger, gates, event shapes, tool contracts and the definitions of derived quantities. Internal names in code stay.

## 7. How we know it is done

Every decision has a check that can fail, not an eyeball:

| Decision | Check |
|---|---|
| D1 | `test/client.test.mjs`: grouping and order; the Knowledge view contains no L0–L4, threshold, promotion, self-judged, proposition or ontology shelf |
| D2 | `test/client.test.mjs`: with terms, the header graph is present; value forms are not nodes; without terms there is no graph |
| D3 | `test/client.test.mjs`: the Knowledge view renders no gaps; the runtime card still carries them (`test/readability.test.mjs`) |
| D4 | `test/client.test.mjs`: no state machine in the expanded row; evidence lines show no ids; Deliverables shows no plan ids or bookkeeping counts |
| D5 | `test/kernel.test.mjs`: no runtime card in tool-result `message`; no run mode or sermon on the card |
| D6 | `test/kernel.test.mjs`: no "completion" percentage on the card |
| D7 | `test/prompt-sections.test.mjs`: the delivery section carries the plain-language rule |
| Two layers | `test/docs-consistency.test.mjs`: retired present-tense claims may not return; `test/readability.test.mjs`: new strings come in zh/en pairs |

## 8. Documents changed in this round

| Document | Change |
|---|---|
| [Verification loop](verification-loop.md) §7, §9 | The terminology table gains a "what people hear" column; the "shown to whom" row names the Knowledge view |
| [Domain ontology](domain-ontology.md) §2.2, §8, §9 | Layout of the Knowledge view (conclusion list + header graph); panel names |
| [Loop philosophy](loop-philosophy.md) | New P7 "Perception has a budget"; §5 adds "inject a fact once" |
| [Design principles](design-principles.md), [Soul map](soul-map.md) | New principle "Perception has a budget", with its code and test locations |
| [Glossary](glossary.md), [Positioning](positioning.md), [Epistemic loop](epistemic-loop.md) | "Ontology shelf" → "Knowledge"; the two layers of language |
| [Authority map](authority-map.md), [Release verification](release-verification.md), [Known gaps](known-gaps.md) | Panel names; manual acceptance steps; the new interface has not yet been seen in a real browser |
| [Mechanism truth table](optimization/truth-table.md) | `runtime-card` states that tool results carry no card; the panel row is renamed |
| README (zh/en) | "What it looks like" |

Each document is changed in both languages.

## 9. Open (needs a person's call)

1. **Is the tab called "Knowledge" or "Ontology"?** This document picks the plain word, "Knowledge"; the product positioning still speaks of research growing into an ontology. If the brand needs people to see "ontology" at a glance, switching back changes one label.
2. **Should the right-rail "Worldlines" tab become "Process"?** Not in this round: it is a metaphor, not a mechanism word, and renaming it is a brand decision.
3. **Screenshots in the README and release verification need retaking.** The new interface was checked against tests and real session data in this round, not in a real browser.
