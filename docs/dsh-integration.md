# DSH integration

ClearAI is a native DSH plugin. It adds an epistemic layer on DSH's **composition surface** and leaves the DSH engine untouched. This document explains how the repository maps onto that surface, what installs where, and how to build and verify it.

## One package, three surfaces

The published package is `clearai-dsh`. A single install places three things on three different DSH surfaces:

| Surface | What it carries | Where it comes from |
|---|---|---|
| Host composition (patch layer) | Row `clearai-host` → the host half: the session projection unit `clearai`, its read routes, and the browser module declaration | `pack/cordis.patch.yml`, `ui/lib/index.js` |
| Agent preset (roster) | ClearAI's tools, prompt sections, guards, skills, and the workspace template | `preset/` |
| Client module (browser) | The deliverables view, the worldline / propositions / external-brain panes | `ui/lib/client.js` |

The split is not cosmetic. Client modules are only discovered through rows of the **host** loader, so the browser half must sit in the patch layer. The projection unit is process-wide and registers once, so it cannot live in a preset that gets rebuilt. Conversely, the judgment side — tools, prompt sections, skills — is exactly what "one session's capabilities" means, so it belongs to the preset.

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
| `ui/lib/client.js` | `lib/client.js` |

`dist/` is generated and never committed.

## How the preset reaches the roster

The host half travels in the patch layer automatically. The agent preset does not: DSH's preset roster only scans **root directories**, and a package cannot declare one by itself.

The patch therefore computes the root on the spot:

```yaml
- id: agent-presets
  config:
    roots:
      - path: !!js "…new URL('node_modules/clearai-dsh/presets/', baseUrl)…"
        trust: system
```

A package installed through `dsh plugin add` always lands in the profile's `node_modules`, so that path is predictable. This needs no install-time writes, no seeding into the user's home, and keeps provenance in the `system` trust layer. Users who want to edit the preset can copy it to their own preset root (or use `bin/clearai.mjs seed`, which records hashes and never overwrites edits).

The patch layer replaces the whole `agent-presets` config, so the keys listed there must stay aligned with the deployment's own values.

## Install

```bash
npx clearai-dsh install
```

The shipped `bin/clearai.mjs` grows exactly one mutating verb for this. It resolves the DSH CLI (a `dsh` on `PATH`, else `npx --yes @deepseek-ai/dsh`), runs the host's own install against the default `web` profile, then reads the composed config back and reports whether the `clearai-host` row actually landed. `--dist` / `--tarball` / `--spec` point it at a local build instead of the registry, `--profile` / `--home` override the defaults, and `dsh plugin --profile web add clearai-dsh` stays the equivalent command if you would rather drive the CLI yourself.

It deliberately does **not** bootstrap a profile or hand-reconcile one. The CLI initializes a profile the first time it is used for one (`initialized profile web at …`), and a second implementation of the host's reconcile step is exactly the duplication this project rejects. For the same reason it stops when `pnpm` is missing instead of working around it: pnpm is DSH's prerequisite, not this plugin's. The degraded, pnpm-less path stays in `tools/install-native.mjs`, where it exists for one-shot E2E homes and labels itself as degraded.

Restart the DSH process (the host half is cached per module URL), then pick **ClearAI** in the preset picker.

For development, `install.sh` lays the repository's source directly into a real `DSH_HOME` so kernel edits take effect immediately; it is a developer tool, not the product path.

## Build and verify

```bash
npm test                        # 13 suites — the list lives in test/run.sh
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
