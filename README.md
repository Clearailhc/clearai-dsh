<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-lockup-dark.png">
    <img src="brand/logo-lockup.png" alt="ClearAI" width="360">
  </picture>
</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">中文</a></p>

<p align="center">
  <a href="https://trendshift.io/repositories/248415?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-248415" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/248415/weekly?language=JavaScript" alt="Clearailhc%2Fclearai-dsh | Trendshift" width="250" height="55"/></a>
</p>

**Your research, grown into an ontology.**

ClearAI is an **ontology discovery and exploration platform**, built on two core concepts:

- **Domain ontology** (what you get) — your project's own vocabulary, the knowledge entries established through the loop, and their graphs. At the end of a research session you hold a continuously growing knowledge structure, retrievable next round by concept.
- **Epistemic loop** (how you get it) — a disciplined seven-stage path: frame, hypothesize, plan, observe, verify, evaluate, record. Every edge is tested by evidence and independent evaluation.

> Other knowledge graphs pile up edges by extraction and assertion; here every edge has to be earned through the loop.

```bash
# Install (npm package, prebuilt — no build step, no allowBuilds prompt)
dsh plugin --profile web add clearai-dsh@0.3.1
# or in the app: Plugins → Add plugin → clearai-dsh@0.3.1
```

Restart `dsh web`, then pick **ClearAI** in the preset picker at the top of a new session. That is the whole setup. [Full install notes ↓](#install-and-use)


<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/ontology-hero-dark.png">
  <img src="docs/diagrams/ontology-hero.png" alt="The epistemic loop (left) growing a domain ontology (right)" width="1200">
</picture>

*Left: the Epistemic Loop — seven stages. Its emerald fact dot is also the first node of the domain ontology on the right. Right: the ontology graph — dark is a concept, light is a value form, emerald an instance; the instance carries two contradictory assertions — **the two readings are tinted amber**, marking that they do not agree. The system reports the conflict; retracting or keeping is a human decision.*

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
| What accumulates | A chat transcript | **An ontology**: every edge earned through the loop |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/epistemic-loop-hero-dark.png">
  <img src="docs/diagrams/epistemic-loop-hero.png" alt="The Epistemic Loop" width="1000">
</picture>

*Inside the ring is the instrument's read-out: the L0–L4 axis, the **pre-registered** threshold as a dashed line, and five observations with error bars — the supported one filled, the inconclusive drawn as a dashed circle, the refuted left in place with a slash through it (nothing is deleted). The emerald dot at the opening is the one reading that crossed the threshold and settled as a fact.*

At runtime, the seven stages compress into four beats — plan, execute, observe, reflect. State is derived from the session record with no second store; the tools the model holds contain no field in which it could declare a step complete.

ClearAI does **not** claim recursive self-improvement. It provides the epistemic substrate a self-improving system would need. See [Positioning](docs/positioning.md) and the [OpenRSI survey](docs/research-openrsi.md).

---

## Install and use

**Requirements:** DSH ≥ `0.1.7-alpha.1` — that generation introduced the composition declaration line this preset rides on. Verified against the host's `0.1.7-rc.2` and `0.2.0-rc.1`.

**Recommended — install it in the app, with the version pinned:**

In the sidebar open **Plugins → Add plugin**, enter `clearai-dsh@0.3.1`, and install. That is DSH's own plugin manager: it hands what you type to pnpm, checks that the package declares a bundle and is compatible with this host, and applies it live. (The Settings page **插件列表 / Plugins** is the read-only inventory — installing happens on the sidebar's Plugins page.)

**Or from a terminal — the same install:**

```bash
dsh plugin --profile web add clearai-dsh@0.3.1
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

The installer's output follows your system language (`--lang zh|en` overrides it, `doctor` / `seed` / `unseed` take the same flag). Its only runtime dependency is `zod`; the graph stack is bundled into the client half at build time.

Restart `dsh web` afterwards (`npx @deepseek-ai/dsh web`), then **create a session and switch to the `ClearAI` mode in the picker at the top**:

1. Open `dsh web` and click "New session";
2. Click the current mode name at the top (default: **Standard mode**) to open the preset list;
3. Pick **ClearAI** — its card reads "利用认识论循环构建可信本体。Build a trustworthy ontology through the epistemic loop.";
4. Just ask your question. Ordinary Q&A runs as usual; once you set a goal and register hypotheses, the system enters knowledge mode by itself: known facts come to you, gaps stay visible, and conclusions earn their place.

<picture>
  <img src="docs/shots/zh/jepa-ontology.png" alt="The knowledge graph in ClearAI mode" width="820">
</picture>

*The ontology graph in ClearAI mode — this real session grew 21 concepts and 9 predicates; the same ledger always yields the same picture. (UI shown is Chinese.)*

If pnpm is not on PATH: `npm install -g pnpm` (do not `corepack enable` — it installs a version forwarder that may download a pnpm it cannot launch).

From the repository:

```bash
npm test                       # 18 suites
node tools/build-package.mjs   # assemble dist/ from source
node tools/verify-package.mjs  # rebuild on the spot, byte-compare
node docs/diagrams/build-hero.mjs   # redraw the product hero (needs google-chrome)
```

`dist/` is generated and never committed. See [DSH integration](docs/dsh-integration.md).

---

## What it looks like

The middle column has two switchable views: **Deliverables** and **Ontology**. The right sidebar: **Worldlines** and **External Brain**.

**Ontology** — this view is your knowledge home. At the top, a **graph band**: the ontology graph (what your domain looks like) and the entity graph (what you have actually verified) toggle with one click; clicking a node or edge opens the **knowledge inspector** (definition / relations / assertions / evidence chain / history), and "filter by this" is an explicit action inside the detail view. Below that, the **ontology shelf**: established entries, each with assertion chips (click to see what the term means), boundary, and support level; contradictions surface automatically. The vocabulary maintenance block sits collapsed at the bottom — it auto-expands when a language exists before any sentence does.

<picture>
  <img src="docs/shots/zh/jepa-band.png" alt="The graph band: ontology graph and entity graph" width="820">
</picture>

*The band — the ontology graph and the entity graph share one deterministic projection, so the same ledger always yields the same picture (captured from a real session: 21 concepts, 9 predicates).*

<picture>
  <img src="docs/shots/zh/jepa-inspector.png" alt="Knowledge inspector: definition, relations, assertions, evidence chain" width="820">
</picture>

*Open any node or edge: definition, relations, assertions, evidence chain, registration and revision history, all in one place. (UI shown is Chinese.)*

**Worldlines** — when two routes genuinely disagree, they run as separate branches with their own readings; the losing one stays on record, and adoption is a human press.

**Deliverables** — the middle column keeps "what the plan declared" and "what actually exists on disk" apart.

**External Brain** — skills and memory as DSH-native entries in one merged catalogue.

---

## Cases

- [Physical-world process experiment](docs/cases/physical-experiment.md) — sensor thermal drift: the full chain from raising terms to a conflict surfacing
- [AI for Science](docs/cases/ai4sci.md) — convergence order of WENO reconstructions, and what "we could not resolve it" honestly means
- [Mathematics](docs/cases/mathematics.md) — keeping finite numerical evidence strictly separate from proof

---

## Documentation

- [Positioning](docs/positioning.md) · [Domain ontology design](docs/domain-ontology.md)
- [Epistemic loop](docs/epistemic-loop.md) · [Verification ontology](docs/verification-loop.md) · [Loop philosophy](docs/loop-philosophy.md)
- [Design principles](docs/design-principles.md) · [Soul map](docs/soul-map.md) · [Glossary](docs/glossary.md)
- [Knowledge-native loop ledger](docs/optimization/knowledge-native-loop.zh-CN.md) (this round: triage / preflight / knowledge gate / graph / inspector; zh-CN)
- [Development plan](docs/optimization/domain-ontology-plan.md) (with real-run evidence from the Hengtong project)
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
