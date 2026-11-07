<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-lockup-dark.png">
    <img src="brand/logo-lockup.png" alt="ClearAI" width="360">
  </picture>
</p>

### 0.6 candidate: on-demand exploration

Explore with ordinary tools and native workers; review the claims that matter. `ReviewClaims` and `Conclude` share the same ontology grounding gate. Independent checks retain evidence, scope and counterevidence; rejected delivery can still preserve independently supported claims. [Workflow and limits](docs/optimization/0.6.0-agent-native/README.md).

**Release candidate:** 0.6.0 is not published yet. The registry commands below apply after release. To inspect this candidate now, run `npm run release` from this checkout and install the resulting `dist/clearai-dsh-0.6.0.tgz` with DSH’s plugin manager. This builds and checks a local package; it does not publish it.

**Complex-case acceptance: release blocked.** In the same three-stage supply-chain task, native DSH completed 3/3 stages in 20.30 cumulative minutes; ClearAI completed 2/3 in 109.91 minutes. Known processed tokens were 11.36M vs 78.64M (lower bounds, mostly cache reads). Both calculated the current exposure correctly, but ClearAI repeated final review for the same anomaly and left one stale graph edge. It retained 15 concepts, 63 entity records and 49 historical assertions; this is not full source-graph certification. [Case, screenshots and video](docs/cases/supply-chain-0.6.md) · [Results and costs](docs/optimization/0.6.0-agent-native/release-case-results.md) · [Release blockers](docs/optimization/0.6.0-agent-native/release-candidate.md).

<p align="center"><b>English</b> · <a href="README.zh-CN.md">中文</a></p>

<p align="center">
  <a href="https://trendshift.io/repositories/248415?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-248415" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/248415/weekly?language=JavaScript" alt="Clearailhc%2Fclearai-dsh | Trendshift" width="250" height="55"/></a>
</p>

**Your research, grown into an ontology.**

ClearAI is an **ontology discovery and exploration platform**, built on two core concepts:

- **Domain ontology** (what you get) — your project's own vocabulary, the knowledge entries established through the loop, and their graphs. At the end of a research session you hold a continuously growing knowledge structure, retrievable next round by concept.
- **Epistemic loop** (how you get it) — question → ontology (how the relevant quantities are measured and how they affect each other) → candidate hypotheses with their predictions → a test that could fail → evidence → bounded conclusion → grows into the ontology. L3/L4 supporting verdicts require independent evaluation with file references and criterion results. Vocabulary and structural edges are definitions, not independently verified claims.

> Keep structural definitions distinct from evidence-backed assertions; a valid citation alone does not establish truth.

> 0.6.0 uses official DSH research events and independent Research/Ontology tabs. [Release validation](docs/optimization/0.6.0-release/README.md) records the real end-to-end task, costs and limitations.

```bash
# Install (npm package, prebuilt — no build step, no allowBuilds prompt)
dsh plugin --profile web add clearai-dsh@0.6.0
# or in the app: Plugins → Add plugin → clearai-dsh@0.6.0
```

Restart `dsh web`, then pick **ClearAI** in the preset picker at the top of a new session. That is the whole setup. [Full install notes ↓](#install-and-use)


<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/shots/0.6.0-supply-chain/phase-2/entity-detail-dark-1440.png">
  <img src="docs/shots/0.6.0-supply-chain/phase-2/entity-detail-1440.png" alt="ClearAI supply-chain ontology in official DSH — recorded task replay" width="1200">
</picture>

*Production UI replaying this real three-stage supply-chain run in official DSH. The platform graph shows persisted objects and scoped assertions; the complete exported source graph is counted separately. [Case and limitations](docs/cases/supply-chain-0.6.md) · [Screenshot provenance](docs/shots/0.6.0-supply-chain/phase-2/provenance.json).*

---

## What you get: a domain ontology

A **domain ontology** that grows as you research:

- **Vocabulary** — the language your project speaks: concepts, predicates, value forms, units. Conventions themselves carry no truth value; sentences written with them do.
- **Established entries** — knowledge that passed the loop: each with its boundary, support level, and evidence chain. Each entry states its boundary explicitly, so it can be cited safely.
- **Ontology graph and entity graph** — what your domain looks like (structure), and what you have actually verified (the state of play).
- **Conflict readings** — contradictory conclusions surface automatically; the system reports them, and retracting or keeping is your decision.

## How you get it: the Epistemic Loop

Most agent loops track one thing: whether the task is done. The Epistemic Loop also tracks **what makes a conclusion trustworthy**:

| | Task loop | Epistemic loop |
|---|---|---|
| Driving question | What next? | What do we know, and on what grounds? |
| Completion | The model declares it | The system computes it from delivered evidence |
| Verdict | Whoever did it, says so | Separated — above a level, the doer cannot judge themselves |
| Failure | Deleted, retried, forgotten | Kept: a refuted hypothesis is a result, not noise |
| Stopping | The model feels it is done | Every candidate and anomaly that could change the answer is handled, or written into the open points |
| What accumulates | A chat transcript | **An ontology**: definitions alongside evidence-linked assertions |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/epistemic-loop-hero-dark.png">
  <img src="docs/diagrams/epistemic-loop-hero.png" alt="The Epistemic Loop" width="1000">
</picture>

*Inside the ring is the instrument's read-out: the L0–L4 axis, the **pre-registered** threshold as a dashed line, and five observations with error bars — the supported one filled, the inconclusive drawn as a dashed circle, the refuted left in place with a slash through it (nothing is deleted). The emerald dot at the opening is the one reading that crossed the threshold and settled as a fact.*

The ontology grows with the research; structure and evidence are checked before trusted knowledge is committed:

- **Set the goal, then model what matters.** Register the goal and checkable completion criteria first; hypotheses and ontology can grow incrementally. Before selected claims enter independent review, supply their concepts, relations, entities, units and assertions. `ReviewClaims` and `Conclude` share the same grounding gate.
- **Give candidates explicit boundaries.** Register useful claims with refutation conditions and scope, preserving alternatives and counterevidence. Ordinary reads, calculations and exploration do not require per-step review or a custom plan; historical plans retain their contracts.
- **Anomalies need a destination.** A reading that does not fit the prediction or the ontology becomes an unexplained item: explained, ruled out with a reason, or written into the answer. One that touches an established fact sends that fact back to awaiting check.
- **Answers are delivered per question.** Each in four parts: conclusion / basis / open points / for you to decide. While a candidate still under examination or an open unexplained item is missing from the answer, the goal cannot close as achieved.

Task state is derived from the session record; file-integrity receipts are persisted separately by the host; the tools the model holds contain no field in which it could declare a step complete, and a goal completes only after independent evaluation. ClearAI does only what the host cannot — the epistemic contract, the domain ontology, presentation; goal continuation, subagents, asking you, deliverable cards and file history all come from DSH itself.

ClearAI does **not** claim recursive self-improvement. It provides the epistemic substrate a self-improving system would need. See [Positioning](docs/positioning.md) and the [OpenRSI survey](docs/research-openrsi.md).

---

## Install and use

**Requirements:** DSH ≥ `0.2.2-rc.1`, the target host for 0.6.0. Evaluators use `startActivation` and the dedicated evaluator preset; older dispatch APIs are not supported.

**Recommended — install it in the app, with the version pinned:**

In the sidebar open **Plugins → Add plugin**, enter `clearai-dsh@0.6.0`, and install. That is DSH's own plugin manager: it hands what you type to pnpm, checks that the package declares a bundle and is compatible with this host, and applies it live. (The Settings page **插件列表 / Plugins** is the read-only inventory — installing happens on the sidebar's Plugins page.)

**Or from a terminal — the same install:**

```bash
dsh plugin --profile web add clearai-dsh@0.6.0
```

This installs the prebuilt package from the npm registry. Nothing is compiled on your machine, so there is no `allowBuilds` grant to approve — the plugin is ready the moment the command returns.

> **Why the version is pinned.** pnpm ≥ 11 holds back newly published versions: `minimumReleaseAge` defaults to 1440 minutes, and because that built-in default is non-strict, a bare package name (or `@latest`) **silently falls back to the newest version older than a day** — right after a release, the *previous* release. DSH's plugin manager forwards your spec to pnpm unchanged and does **not** compare what landed against what you asked for, so this downgrade is reported as a success. Its preview card is no help either: it reads the package with `pnpm view`, which ignores the age policy, so it can show the newest release while pnpm installs the one before it. Two ways to be exact:
>
> - **Pin the version**, as both commands above do — pnpm then records the exception itself.
> - **Or exempt the package once** in the profile's `pnpm-workspace.yaml`; a bare name works from then on:
>
>   ```yaml
>   minimumReleaseAgeExclude:
>     - clearai-dsh
>   ```

**Also available — one-command installer** (it resolves the current release and pins that version for you, so it is immune to the delay):

```bash
npx clearai-dsh install
```

Same install underneath; it resolves the DSH CLI from your PATH (or through npx), installs into the `web` profile, and reads the composed config back so you are not taking "success" on faith. Use this if you prefer a guided path, or `--lang zh|en` to force the installer's output language.

**Community market (third-party):** [dsh-market](https://github.com/dsh-market/dsh-market) lists whatever the curated [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) catalog carries and installs a pinned version for you; ClearAI's catalog entry is in review there. It is not part of DSH, and it is not needed to install this plugin.

**Install from source (for development, not the normal path):**

```bash
dsh plugin --profile web add github:Clearailhc/clearai-dsh
```

Git fetches source rather than build artifacts, so pnpm ≥10 will refuse to run the `prepare` script until you add an `allowBuilds` entry to the profile's `pnpm-workspace.yaml`. That grant means *permission for this package's code to execute on your machine at install time* — grant it only if you have read the source, and pin a commit. If you just want to use ClearAI, use the npm install above.

The installer's output follows your system language (`--lang zh|en` overrides it, and `doctor` takes the same flag). Its only runtime dependency is `zod`; the graph stack is bundled into the client half at build time.

Restart `dsh web` afterwards (`npx @deepseek-ai/dsh web`), then **create a session and switch to the `ClearAI` mode in the picker at the top**:

1. Open `dsh web` and click "New session";
2. Click the current mode name at the top (default: **Standard mode**) to open the preset list;
3. Pick **ClearAI** — its card reads "利用认识论循环构建可信本体。Build a trustworthy ontology through the epistemic loop.";
4. Just ask your question. Ordinary Q&A runs as usual; once a goal is set, the system enters knowledge mode by itself: what is already known comes to you, the ontology is written with the framing, and conclusions earn their place through evidence. The process is in the Explore pane, the conclusions in the Ontology pane. Only decisions only you can make are put to you.

<picture>
  <img src="docs/shots/en/jepa-ontology.png" alt="The Ontology pane in ClearAI mode" width="820">
</picture>

*The Ontology pane after the [JEPA world model](docs/cases/jepa-world-model.md) session (0.5.0 layout; from 0.5.1 the progress rail and the full judgment list move to the process record in the Explore pane, and the Ontology pane holds answer cards, graphs, established facts and lessons).*

If pnpm is not on PATH: `npm install -g pnpm` (do not `corepack enable` — it installs a version forwarder that may download a pnpm it cannot launch).

From the repository:

```bash
npm test                       # 17 suites
node tools/build-package.mjs   # assemble dist/ from source
node tools/verify-package.mjs  # rebuild on the spot, byte-compare
node docs/diagrams/build-hero.mjs   # redraw the product hero (needs google-chrome)
```

`dist/` is generated and never committed. See [DSH integration](docs/dsh-integration.md).

---

## What it looks like

Two panes in the middle: **Explore** and **Ontology**. Explore holds the process; Ontology holds only results. Plan progress mirrors to DSH's native todo dock.

**Explore** — what is being answered, which possibilities are still open, and what comes next. The header gives the topic and mode (survey / solve), the current question and plan progress. Below come the items awaiting you, the survey areas (in survey mode), each question's candidate hypotheses (being examined / excluded / adopted / set aside; open one for its source, refutation condition, prediction and related records), the next step with each candidate's prediction (with a note when the predictions are identical and the step cannot tell them apart), and unexplained observations. A newly found question carries two buttons, "Make it a question" and "Park"; pressing one sends a sentence to the model on your behalf, and the model revises the framing. At the bottom, a collapsed **process record**: judgment counts and the progress rail, every judgment, and the plan's steps and gates.

**Ontology** — knowledge map first, followed by conclusions with their evidence and established knowledge. Switch between structural definitions and entity assertions; use search or the list to select an object, inspect its neighbors and evidence, and read its complete name in details. The map retains the chosen viewport and dragged positions.

**Deliverables** — at close, the artefacts accepted for each step appear as DSH's native deliverable cards; what changed each turn is in DSH's native change cards.

**Language** — everything the system writes (tool results, the runtime card, questions to you, the files under `clear/`) follows the language you write in, Chinese or English. The panel follows the UI language.

<picture>
  <img src="docs/shots/0.5.8/jepa-en-ontology.png" alt="ClearAI 0.5.8 ontology panel replaying the JEPA session" width="820">
</picture>

*The current ontology panel, replaying the archived JEPA session. The default zoom keeps labels readable; Overview shows the complete graph. Dense graphs retain all nodes.*

<picture>
  <img src="docs/shots/0.5.8/jepa-en-explore.png" alt="ClearAI 0.5.8 research panel, replaying the historical JEPA session" width="820">
</picture>

*Research panel: archived JEPA session replayed with the current production build. See [dark](docs/shots/0.5.8/jepa-dark-explore.png), [narrow](docs/shots/0.5.8/jepa-mobile-explore.png) and [entity details](docs/shots/0.5.8/jepa-entity-ontology.png), and [narrow details](docs/shots/0.5.8/jepa-mobile-details-ontology.png).*

---

## Against the bare model

Same model, same tools and budget: one arm runs with ClearAI, one without it, on the same tasks with planted traps, graded blind. These are early dev-set results for 0.5.0 (the developers wrote the tasks, and the samples are small), not a formal validity result; the later 0.5.1 development comparison failed its stop-loss gate (see below).

| Experiment | ClearAI | Bare model |
|---|---|---|
| Reactor task: the control thermocouple drifts 8 °C mid-run, 4 runs each | 3/4 found it and corrected for the actual temperature | 1/4 |
| One rig, 3 lines in a row: the drift changes direction and onset each time, 3 series each | 5/6 corrected in the later tasks; task-3 mean 1.5 / 4 | 1/6; 1.17 / 4 |
| Electrolyte task: no data trap, 4 runs each | 2.25 / 5 | 2.25 / 5 |

Both arms **saw** the reference reading disagree. The difference is what came next. With ClearAI, the model writes a prediction before acting. A missed prediction cannot be explained away: it must be explained, ruled out with a reason, or handed to a person. An independent evaluator then checks the raw data again. Lessons left by an earlier task, once an evaluator has checked them, get cited when the next task writes its predictions.

What did not improve for either arm is exploration depth. Recipes landed just as far from the true optimum, and nobody found the coupling between temperature and a second factor. The cost is about 2.2× the tokens. The candidate hypotheses, per-candidate predictions and stop check in 0.5.1 target exactly this. The walkthrough and the graders' words are in [Case: against the bare model](docs/cases/bare-model-ab.md); every record is in [docs/optimization/sim-runs/](docs/optimization/sim-runs/).

---

Fully expanded native DSH views: [ontology panorama](docs/shots/0.5.8/jepa-panorama-ontology.png) · [entity panorama](docs/shots/0.5.8/jepa-panorama-entity.png). Historical replay: 24 ontology nodes and 72 entity/value nodes.

### 0.5.8 integrity and verification boundaries

The host records content digests and authoritative write origins for facts, lessons, negative entries, audit cards and goals. Workspace synchronization, knowledge reuse, delivery, closure and audit recovery check these receipts. Unexpected changes stop affected trust and progress; original files are preserved. Historical unregistered knowledge is visible but requires fresh verification before trusted reuse. Restore registered content or re-verify the material in a clean workspace; editing a receipt is not verification.

This is integrity detection at defined boundaries, not an operating-system sandbox. Shell commands can still write files, a change restored before inspection can escape detection, and effects outside the workspace are not covered. Evaluators rerun in a filtered copy; copy failure prevents criteria requiring a rerun from passing. Audit text limits, model generation budgets and runtime limits are separate controls.

Research puts questions and candidates in the main column, with next actions and anomalies beside them; narrow screens use one column. Ontology reads map → conclusions and evidence → established knowledge. Concepts use hollow diamonds, entities solid dots, and literals quiet labels. Search, list selection, neighborhood browsing, dragging, overview and keyboard controls share graph selection; Escape exits fullscreen and narrow details open below the graph.

0.5.8 release evidence and current gate status: [acceptance record](docs/optimization/0.5.8-release/README.md). Engineering checks and small model samples do not prove general correctness or greater efficiency.

The later [0.5.1 development comparison](docs/optimization/sim-runs/2026-10-08-0.5.1-dev/README.md) did **not** pass its stop-loss gate: total processed tokens including evaluators were **4.8–7.2×** the bare model. The earlier 0.5.0 result above and this negative result describe different versions and samples. Main-model, evaluator and other model usage must all count; token totals are not dollar bills. For 0.5.8, the user reduced acceptance to the first paired case. The bare model scored 99.98/100 and ClearAI 99.99/100; ClearAI used 20× the processed tokens, 14.6× the estimated peak-rate cost and 12.7× the run time, including two retained stops and continuations. The other two ClearAI cases were deferred. This small result provides no efficiency advantage; see the [full record](docs/optimization/0.5.8-release/first-pair-results.json).

## Cases

The first two are real-model sessions run end to end without asking anything; the screenshots replay them in real DSH. The third is a simulated A/B against the bare model.

- [JEPA world models](docs/cases/jepa-world-model.md): a literature review, a toy experiment judged by an independent evaluator, and an ontology of 21 concepts, 8 relations and 27 entities
- [Was Navier–Stokes solved?](docs/cases/navier-stokes.md): two popular claims refuted and kept, an intake rejection handled honestly, and an ontology of 24 concepts, 13 relations and 59 entities
- [Against the bare model](docs/cases/bare-model-ab.md): on the same drifting bench rig, how ClearAI and the bare model each handle a reference reading that disagrees (dev set, blind graded)

---

## Documentation

- [Positioning](docs/positioning.md) · [Domain ontology design](docs/domain-ontology.md)
- [Epistemic loop](docs/epistemic-loop.md) · [Verification ontology](docs/verification-loop.md) · [Loop philosophy](docs/loop-philosophy.md)
- [Design principles](docs/design-principles.md) · [Soul map](docs/soul-map.md) · [Glossary](docs/glossary.md)
- [Mechanism truth table](docs/optimization/truth-table.md) · [State machines](docs/optimization/state-machines.md) · [Timing diagrams](docs/optimization/timing-diagrams.md)
- [Known gaps](docs/known-gaps.md) · [Authority map](docs/authority-map.md) · [Release verification](docs/release-verification.md)

## Where it sits in DSH

ClearAI adds the epistemic layer on DSH's **composition plane** — one host package, one agent preset, one client module, with **zero changes to the DSH engine**. Working style is unrestricted, but nothing outside the governed path can write to the authoritative ledger (pinned by tests).

## Work attribution

This project's work attribution unit is [Jidian Qiyuan](https://jidianqiyuan.com/).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Clearailhc/clearai-dsh&type=Date)](https://star-history.com/#Clearailhc/clearai-dsh&Date)

## License

Apache-2.0, see [LICENSE](LICENSE).

## Status

A local-first ontology discovery and exploration platform delivered as a DSH plugin. What is not yet implemented, and what has not been verified in a real browser, is written in [Known gaps](docs/known-gaps.md).

### Evidence access and knowledge counts

The main agent can read and edit working materials through native tools. `ReadEvidence` batches bounded source reads; ordinary reads always return text. Set `ifUnchanged:true` only to check a range already read in the same session; changed bytes or new ranges return text. After compaction, read normally to restore the excerpt. A matching hash proves neither truth nor reuse applicability. Independent reviewers have their own read receipts and are instructed to treat originals as read-only, using isolated copies for writable reruns. They report findings and proposed repairs to the main agent; copy edits are not promoted into the main workspace. External file changes are not assumed to be present in the main agent’s context.

The knowledge overview separates facts from this goal, loaded facts, pending review, assertions within facts, and entity-file records. Definitions and entity records are not independently certified merely because they exist. These counters do not add model calls. Reuse claims must distinguish pre-existing artifacts actually inspected from snapshots created during the current task.

Read results also report `sourceOrigin`: observed before the session first used tools, created later, or unknown (including resumed sessions without a complete baseline). This is an observed file origin, not proof that its content was reused correctly.

Reviewer restrictions are a tool/authority boundary, not a filesystem sandbox: direct write tools are disabled, and changed referenced materials detected during settlement prevent acceptance. OS-level read-only enforcement depends on the host sandbox. Isolated rerun edits are never copied back as main-agent repairs.

Conclude and ReviewClaims share claim grounding checks. When final delivery fails, fully covered structured claims can still be saved only when the reviewer explicitly establishes independence from unresolved gaps; the goal stays open. Fix those gaps and call Conclude directly. Goal registration preserves a file baseline across revisions and replay, distinct from prior audit versions; unknown baselines remain unknown. Exported graphs are not automatically imported or certified.
