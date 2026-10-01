# Design Principles

> **Being rebuilt.** This document describes the target design from the ["less is more" plan](less-is-more-plan.zh-CN.md).

These principles turn ClearAI's epistemology into behaviour DSH can enforce. They describe mechanisms, not wishes; the implementation mapping is in the [Soul Map](soul-map.md).

## Do only what the host cannot

ClearAI does three things: the epistemic contract, the domain ontology, and presentation. Goals and continuation, plan review, subagents, asking the human, deliverable cards, file change history, skills and project instructions all come from the host. Rebuilding something the host already has adds one more thing to keep aligned and one more place to drift.

## A scaffold, not a script

Models keep getting better at knowing themselves and at long tasks. The prompt carries only a first-principles skeleton: identity, the loop, how to talk to people. How to use each tool lives in the tool's own description and appears when it is used; current state comes from the run-state card, injected once when it changes.

## Mechanism over exhortation

Rules live in schemas, guards, projections or tests, not only in prompts. A constraint that exists only in a prompt is marked as a preference in the Soul Map.

## Make invalid claims unrepresentable

Prefer APIs where an invalid claim cannot be written: tools have no writable `status`, `progress` or `phase`; L3+ paths take no caller-supplied verdict; steps have no downgrade path.

## Separate intent from fact

The model may request and deliver, but cannot declare completion or declare what an observation proves. Admission only accepts or rejects; evidence, progress and facts come from the fold.

## The doer does not judge their own work

L3+ dispatches an independent evaluator; completing a goal needs an independent evaluation, and a guard rejects the model completing the native goal directly.

## Only a human makes a human's decision

A gate that needs a person is asked by the call that opened it, and the answer returns to the kernel in-process without passing through the model. With nobody to answer, nothing is decided on the person's behalf: the gate stays open and the goal waits.

## Preserve history

Semantically append-only: revised criteria keep old versions, refuted hypotheses stay, voids carry reasons, retraction only marks.

## The graph is a projection, not storage

The ontology and entity graphs are computed from the same fold, with a deterministic layout; a read surface never becomes the authority.

## A change of meaning needs a new id

Quietly changing what a stable id means rewrites every old fact with today's definition.

## Speak about process only when needed

A user has four questions: what can I trust now; what was refuted and what is unclear; what does it add up to; what do you need from me. The UI and reports answer those four; process appears only when the person asks or must decide.
