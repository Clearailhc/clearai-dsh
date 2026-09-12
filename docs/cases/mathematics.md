# Mathematics Case: A Finite Check Is Not a Proof

## Question
Do the first several values of a recursively defined integer sequence suggest that every term is prime?

## Proposition
The observed pattern may motivate a conjecture, but finite computation alone cannot establish primality for every term.

## Criterion
Separate claims into (1) verified values through a stated index, (2) a conjectural general pattern, and (3) a proof obligation such as an inductive invariant, factorization argument, or theorem with checked hypotheses.

## Execution
Generate terms with exact integer arithmetic, run independently implemented primality tests on a bounded range, and record code, seed, range, and test certificates where available. Then attempt proof strategies without treating the numerical table as evidence of universal truth.

## Observation / Evaluation
The checked prefix may contain no counterexample and may strongly suggest a pattern. Evaluation must say exactly “verified for n ≤ N,” not “true for all n.” A failed proof attempt is not a disproof; a discovered composite term is a counterexample to the universal claim.

## Revision
Narrow the proposition to the checked range, state a conjecture, or revise it after a counterexample. If a proof is claimed, expose each lemma and its hypotheses and seek an independent review.

## What Is Retained
Retain the exact recurrence, finite table, test method, certificates, conjecture wording, proof draft, and status labels distinguishing computation from proof.

## Limitations
Finite checks can miss rare failures, overflow or software bugs can corrupt results, and heuristic patterns have no deductive force. A proof requires a valid argument covering the stated domain.

## Stored run

The task book this case was run against, and everything the run produced — the session record, the artifacts it left, and an honest reading of both — are kept with the case workspace. Nothing from a run is deleted, including runs that stopped halfway.

