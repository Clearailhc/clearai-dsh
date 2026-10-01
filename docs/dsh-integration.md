# DSH integration

> **Being rebuilt.** This document describes the target design from the ["less is more" plan](less-is-more-plan.zh-CN.md); the install, build and verification sections reflect the currently published form.

ClearAI is a native DSH plugin. It adds an epistemic layer on DSH's **composition surface** and leaves the DSH engine untouched. This document explains how the repository maps onto that surface, what installs where, and how to build and verify it.

## One package, three surfaces

The published package is `clearai-dsh`. A single install places three things on three different DSH surfaces:

| Surface | What it carries | Where it comes from |
|---|---|---|
| Host composition (patch layer) | Row `clearai-host` → the host half: the session projection unit `clearai`, its read routes, and the browser module declaration | `pack/cordis.patch.yml`, `ui/lib/index.js` |
| Agent preset (roster) | ClearAI's ten tools, three prompt sections and guards, plus the native DSH capabilities it composes | `preset/` |
| Client module (browser) | The Ontology pane in the middle, the World Tree pane on the right | `ui/lib/client.js` |

The split is not cosmetic. Client modules are only discovered through rows of the **host** loader, so the browser half must sit in the patch layer. The projection unit is process-wide and registers once, so it cannot live in a preset that gets rebuilt. Conversely, the judgment side — tools, prompt sections, skills — is exactly what "one session's capabilities" means, so it belongs to the preset.

## Use the host, do not rebuild it

Besides ClearAI's own plugins, the preset composes these native DSH capabilities; ClearAI no longer ships its own versions:

| Capability | Native package | How ClearAI uses it |
|---|---|---|
| Goals and continuation | `dsh-goal`, `dsh-tool-goal`, `dsh-goal-round-driver` | `Frame` attaches criteria and judgements; `Conclude` calls `ctx.goals.complete()` after independent evaluation; a guard rejects the model completing it directly |
| Plan review | `dsh-plan-mode` | `/plan` when the person wants to review a plan |
| Subagents and orchestration | `dsh-subagent`, `dsh-tool-workflow` | Dispatching independent evaluators; the model tests competing judgements in parallel (replacing worldlines) |
| Asking the person | `dsh-user-questions` | The call that opens a gate calls `ctx.userQuestions.ask()` |
| Deliverables | `dsh-tool-present`, deliverable cards | At close the kernel appends one `deliverables/presented` |
| File changes | `dsh-workspace-changes` | No own ledger |
| Skills and project instructions | `dsh-skill`, `PROJECT.md` | No bundled templates or memory |

## Source → package mapping

The package is a pure function of the source; `node tools/build-package.mjs` performs this mapping, and `node tools/verify-package.mjs` rebuilds and compares byte-for-byte.

| Source | In the package |
|---|---|
| `package.json` | `package.json` (the single manifest) |
| `pack/cordis.patch.yml` | `cordis.patch.yml` |
| `pack/bin/clearai.mjs` | `bin/clearai.mjs` |
| `preset/` | `presets/clearai/` |
| `preset/template/` | `presets/clearai/template/` |
| `ui/lib/index.js` | `lib/host.js` |
| `ui/lib/fold.js` | `lib/fold.js` |
| `ui/lib/invariant.js` | `lib/invariant.js` |
| `ui/lib/domain-language.js` | `lib/domain-language.js` |
| `ui/lib/client.js` | `lib/client.js` |
| `locale/` | `locale/` — the plugin list's title and one-line description, one file per language |
| `brand/` | `brand/` — README artwork plus the plugin-list icon (`brand/icon.svg`) |

`dist/` is generated and never committed.

## How the preset reaches the picker

The host half travels in the patch layer automatically. The agent preset does not: a preset is a **declaration line in the composition**, and the package has to contribute that line itself.

Since host `0.1.7-alpha.1` the roster no longer scans root directories. Each preset is one `- id: preset-<id>` row (`@deepseek-ai/dsh-agent-preset`) whose `config.plugins` carries the whole plugin list:

```yaml
- insert:
    - id: preset-clearai
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: clearai
        plugins:
          - name: clearai-dsh/presets/clearai/plugins/clearai-kernel.js
          # …
```

That file — `presets/clearai/clearai.patch.yml` — is **derived from `preset/agent.cordis.yml` at build time** (one source, never a hand-copied second list) and is mounted through the manifest's `dsh.bundle.patch`. Nothing is written at install time and no copy lands in the user's home.

Hosts at or below `0.1.6-alpha.2` have no such row and scan a root directory instead; `0.2.3` is the last release that could serve them. Users who want to edit the preset can still seed it into their own root with `bin/clearai.mjs seed`, which records hashes and never overwrites edits.

## Install

In the app: the sidebar's **Plugins → Add plugin** takes `clearai-dsh@0.3.1` and installs it through DSH's own plugin manager — the Settings **Plugins** page is the read-only inventory, not the install surface. With a terminal, the same install:

```bash
dsh plugin --profile web add clearai-dsh@0.3.1
```

The version is pinned on purpose: pnpm ≥ 11 holds back versions published within the last day, and a bare package name falls back to the previous release instead of failing. The plugin manager forwards the spec unchanged (`pnpm add <spec>` in `@deepseek-ai/dsh-plugin-manager`) and never compares the version that landed with the one asked for, so that downgrade is reported as a success. The README's *Why the version is pinned* has the mechanism and the one-line exemption that makes a bare name work.

The guided variant is the same install with the composition read back afterwards, and it resolves and pins the current release itself:

```bash
npx clearai-dsh install
```

The community market ([dsh-market](https://github.com/dsh-market/dsh-market)) is a third-party bundle that lists what the curated [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) catalog carries; ClearAI's entry is in review there. It is not part of DSH and not needed for this install.

The shipped `bin/clearai.mjs` grows exactly one mutating verb for this. It resolves the DSH CLI (a `dsh` on `PATH`, else `npx --yes @deepseek-ai/dsh`), runs the host's own install against the default `web` profile, then reads the composed config back and reports whether the `clearai-host` row actually landed. `--dist` / `--tarball` / `--spec` point it at a local build instead of the registry, `--profile` / `--home` override the defaults, and `dsh plugin --profile web add clearai-dsh@<version>` stays the equivalent command if you would rather drive the CLI yourself.

It deliberately does **not** bootstrap a profile or hand-reconcile one. The CLI initializes a profile the first time it is used for one (`initialized profile web at …`), and a second implementation of the host's reconcile step is exactly the duplication this project rejects. For the same reason it stops when `pnpm` is missing instead of working around it: pnpm is DSH's prerequisite, not this plugin's. The degraded, pnpm-less path stays in `tools/install-native.mjs`, where it exists for one-shot E2E homes and labels itself as degraded.

Restart the DSH process (the host half is cached per module URL), then pick **ClearAI** in the preset picker.

For development, `install.sh` lays the repository's source directly into a real `DSH_HOME` so kernel edits take effect immediately; it is a developer tool, not the product path.

## Build and verify

```bash
npm test                        # 18 suites — the list lives in test/run.sh
node tools/build-package.mjs    # assemble dist/clearai-dsh
node tools/verify-package.mjs   # rebuild and compare byte-for-byte
node tools/verify-deploy.mjs    # compose the deployed files for real (bypasses the ESM cache)
node tools/verify-truth-table.mjs   # the truth table against the code constants
node tools/verify-clean-install.mjs # install into an empty DSH_HOME through the real CLI
node tools/verify-lifecycle.mjs     # upgrade / uninstall / user fork / the install verb
```

Confirming the browser surface needs a browser: `tools/capture-ui.sh` boots an isolated `DSH_HOME`, installs the built package, starts `dsh web`, and launches a debuggable Chrome; `tools/ui-drive.mjs` then clicks and screenshots it. This exists because the packaged client half was verified only at unit level for a long time, and the first real browser run found the plugin failing to register at all.

## Why the engine is not modified

DSH's registries, sandbox, approval stack, persistence, and model routing are host invariants. ClearAI contributes rows, tools, prompt sections, and a client module, then lets DSH compose them. Changing the engine would create a fork, tie upgrades to ClearAI internals, and bypass DSH's ordering, lifecycle, and reversible-composition guarantees. Keeping the integration to one patch row, one preset directory, and one client entry is what makes it installable, removable, and upgrade-safe — and it is why the same epistemic loop can coexist with other presets on one machine.
