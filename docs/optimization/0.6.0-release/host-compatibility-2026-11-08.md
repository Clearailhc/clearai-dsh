# DSH official-latest compatibility check

Checked on 2026-11-08 (Asia/Shanghai). Official npm latest/next and the latest queried GitHub Release resolve to **0.2.2-rc.1**, which is already the supported target. A fresh `@latest` install has the same versions for all 331 compared official components. No host source changes or version requirement changes were needed.

The fresh installation passed 115 Node tests, 798 kernel checks, installed host 38/client 195, the official schema/session/replay contract, production browser checks, and native installation lifecycle including 0.5.9→0.6.0 upgrade, uninstall/reinstall and configuration preservation. No paid model calls were made.

[Machine-readable results](host-compatibility-2026-11-08.json). Browser checks use the production bundle with deterministic fixtures. Fresh runtime tests ran on Linux/Node24. This does not establish compatibility with an unidentified newer desktop or alternative-channel build; its version or official link is needed for further testing.
