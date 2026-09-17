<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-lockup-dark.png">
    <img src="brand/logo-lockup.png" alt="ClearAI" width="360">
  </picture>
</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">中文</a></p>

**From answers to evidence. From evidence to ontology.**

ClearAI is a **native DSH plugin** that brings the Epistemic Loop to DeepSeek Harness.

A language model can produce a plausible answer in seconds. ClearAI is about what happens next: stating what would test the idea, running the work, recording what happened, evaluating the evidence, and revising what is believed — so that a conclusion has to *earn* its status instead of asserting it. All of it settles into an **ever-growing ontology**: the project's domain vocabulary, the entries established through the loop, and their graphs — other knowledge graphs pile up edges by extraction and assertion; here every edge has to be earned.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/epistemic-loop-hero-dark.png">
  <img src="docs/diagrams/epistemic-loop-hero.png" alt="The Epistemic Loop" width="1200">
</picture>

> Let the model explore. Let the mechanism protect the boundary of fact.

---

## Install

One command, and it needs nothing but Node:

```bash
npx clearai-dsh install
```

It resolves the DSH CLI (from your `PATH`, or through `npx`), installs the plugin into your `web` profile, and reads the composed config back so you are not taking "success" on faith. Underneath it is the host's own install, so this is the same command: `dsh plugin --profile web add clearai-dsh`.

**Restart `dsh web` after that** (`npx @deepseek-ai/dsh web`). Both halves of the plugin are cached inside the running process, so refreshing the browser is not enough. Then open a session and pick **ClearAI** in the preset picker.

If it stops because **pnpm is not on your `PATH`**: DSH manages a profile by driving pnpm, so it needs one. Install it with `npm install -g pnpm`, or your system package manager. Prefer that to `corepack enable`, which installs a version *router* rather than pnpm, and the corepack shipped with current Node can fetch a pnpm it is unable to launch.

From a checkout (development, not the install path):

```bash
npm test                       # 15 suites — the list lives in test/run.sh
node tools/build-package.mjs   # assemble dist/ from source
node tools/verify-package.mjs  # rebuild and compare byte-for-byte
node tools/verify-clean-install.mjs   # install into an empty DSH_HOME through the real CLI
node docs/diagrams/build.mjs   # regenerate the loop diagram (needs google-chrome)
```

`dist/` is generated and never committed. See [DSH integration](docs/dsh-integration.md).

## Why this is not just another agent loop

Most agent loops track one thing: whether the task is done. The Epistemic Loop also tracks **how a conclusion came to be trusted**:

| | Task loop | Epistemic Loop |
|---|---|---|
| Driving question | What do I do next? | What do we know, and on what grounds? |
| Completion | The model declares it | The system computes it from delivered evidence |
| Judgment | Whoever did the work | Separated — above a level, the doer cannot judge its own result |
| Failure | Deleted, retried, forgotten | Kept: a refuted hypothesis is a result, not noise |
| What accumulates | A chat transcript | **An ontology**: vocabulary, established entries carrying assertions, and their graphs — every edge earned through the loop |

ClearAI implements that loop as mechanism, not advice. State is derived from the session record rather than stored twice, progress and phases are computed, and the tools the model holds contain **no field in which it could declare a step complete**.

ClearAI does **not** claim recursive self-improvement. It provides the epistemic substrate that a self-improving system would need: an honest account of what changed, what supports it, who evaluated it, and what failed. See [Positioning](docs/positioning.md) and the [OpenRSI survey](docs/research-openrsi.md) for where that boundary sits.

## The loop, stage by stage

The Epistemic Loop has seven stages. At runtime, these stages compress into four beats—plan, execute, observe, reflect—for a simpler operating rhythm.

| Stage | What the model does | What the mechanism guarantees | What you see |
|---|---|---|---|
| Frame | Bounds the question, assumptions, scope, and outcome | The inquiry starts with an explicit frame | Scope and assumptions |
| Hypothesize | Records candidate explanations or routes | Propositions remain distinct from admitted facts | Hypotheses |
| Plan | Defines executable, evidence-bearing steps and criteria | Completion is advanced only through governed paths | Inspectable plan |
| Observe | Runs permitted work and records what happened | Admission checks eligibility, never truth | Observations and artifacts |
| Verify | Tests observations against the stated criteria | Verification remains tied to the proposition and its limits | Checks and evidence |
| Evaluate | Assesses support, uncertainty, and conflicts | Higher-level work can require independent evaluation | Evaluation and basis |
| Record and act | Preserves the result and chooses the next bounded action | History is retained; unresolved claims stay qualified | Facts, limits, and next step |

Full version: [The Epistemic Loop](docs/epistemic-loop.md)

## What it looks like

The plugin contributes these surfaces on top of stock DSH: a **deliverables** view and an **ontology** view (graph band · ontology shelf · propositions in verification · vocabulary) in the middle column, plus **worldlines** and **external brain** panes on the right.

**Ontology shelf** — one row per established claim: its level, its scope, and who judged it; older unstructured entries stay on the shelf. Refuted ones stay where they were, with the evidence that refuted them.

![Propositions and facts](docs/shots/en/facts.png)

**Worldlines** — when two routes genuinely disagree, they run as separate branches with their own readings; the record keeps the ones that lost, and adoption is a human decision.

![Worldlines](docs/shots/en/worldlines.png)

**Deliverables** — the middle column shows what a plan declared and what actually exists on disk, and refuses to conflate the two.

![Deliverables](docs/shots/en/deliverables.png)

**External brain** — skills and memory appear as native DSH entries in one merged catalogue, with the usage of this session next to them.

![External brain](docs/shots/en/skills.png)

## Where it lands in DSH

ClearAI adds an epistemic layer on the DSH **composition surface** — one host package, one agent preset, one client module. The DSH engine is not modified. `/goal` `/plan` `/evidence` `/worldline` `/plan-review` are the human's read-only state windows in the `/` menu (computed from the ledger on the spot); todo, subagents, workflows and model switching are DSH-native — working style is unbounded, but none of it can write the authoritative ledger (the authority boundary is pinned by tests).

![ClearAI in DSH](docs/diagrams/loop-to-dsh-planes.svg)

## Cases

Three cases, written to show what the loop does on questions where the honest answer is not a clean result:

- [AI for Science](docs/cases/ai4sci.md) — convergence order of WENO reconstructions near critical points, and what "we could not resolve it" honestly means.
- [Mathematics](docs/cases/mathematics.md) — keeping finite numerical evidence strictly separate from proof.
- [Physical-world process experiment](docs/cases/physical-experiment.md) — keeping the loop intact when execution leaves the computer.

They are illustrations of the mechanism, not shipped run records.

## Documentation

- [Positioning](docs/positioning.md)
- [Design principles](docs/design-principles.md)
- [Soul map: principle → mechanism → test](docs/soul-map.md)
- [Glossary](docs/glossary.md)
- [Loop philosophy](docs/loop-philosophy.md) · [Verification ontology](docs/verification-loop.md)
- [Domain ontology](docs/domain-ontology.md) · [Development plan](docs/optimization/domain-ontology-plan.md)
- [Known gaps](docs/known-gaps.md) · [Authority map](docs/authority-map.md) · [Release verification](docs/release-verification.md)
- [Convergence and slimming plan](docs/optimization/plan.md) · [Full-coverage design](docs/optimization/epistemic-coverage.md) · [Execution progress](docs/optimization/progress.zh-CN.md)

## Work attribution

This project is developed and maintained under the work attribution of [基点起源](https://jidianqiyuan.com/).

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=Clearailhc/clearai-dsh&type=Date)](https://star-history.com/#Clearailhc/clearai-dsh&Date)

## License

Apache-2.0. See [LICENSE](LICENSE).

## Status

This repository is the DSH-native ClearAI plugin library: a local-first epistemic workspace delivered through DSH. What is not implemented, and what has not yet been verified in a real browser, is listed explicitly in [known gaps](docs/known-gaps.md).
