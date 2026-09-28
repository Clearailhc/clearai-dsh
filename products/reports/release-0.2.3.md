# clearai-dsh 0.2.3 发布报告

- 报告时间:2026-09-28
- 发布动作:创建并推送 annotated tag `v0.2.3`(指向 `e362acc`),由 `.github/workflows/release.yml` 自动执行
- **结论:0.2.3 没有发布。** 发布流水线在「干净安装」这道门被拦下,npm 与 GitHub 两侧都没有产生任何副作用。

## 一、三个对象的最终状态

| 对象 | 期望 | 实测 | 状态 |
|---|---|---|---|
| 远端 tag `v0.2.3` | 存在,解引用 → `e362acc` | `41e6f7450c8fa4dbf67d40075fd60d8d3f17001d refs/tags/v0.2.3` | ✅ 已达成 |
| npm `clearai-dsh@0.2.3` | tarball 可下载且与本 commit 构建逐文件一致 | `dist-tags.latest = 0.2.2`;`versions` 止于 `0.2.2`;`has 0.2.3: false` | ❌ 不存在 |
| GitHub Release `v0.2.3` | 存在,说明取自 CHANGELOG 0.2.3 段 | `release not found` | ❌ 不存在 |

证据与逐条命令:`lab/release/0.2.3-verify.md`、`lab/release/0.2.3-verify-raw.txt`。

**没有发出任何东西。** registry 的 `modified` 时间戳仍停留在 `2026-09-18T11:23:13Z`(0.2.2 那次发布),本次未触碰 registry;npm 上不存在 `0.2.3`,也不存在被覆盖或撤回的版本。

## 二、中断在哪一步

release workflow run [36370225052](https://github.com/Clearailhc/clearai-dsh/actions/runs/36370225052) 结论 `failure`:

| # | 步骤 | 结论 |
|---|---|---|
| 1–7 | Set up / checkout / setup-node / Install deps / npm 版本门 / Enable pnpm / **Tag must match the manifest** | ✓ |
| 8 | **Suites**(全部套件) | ✓ |
| 9 | Build and self-check | ✓ |
| 10 | Install the DSH CLI | ✓ |
| 11 | **Clean install (mechanical half)** | ✗ |
| 12–15 | OIDC claims / **Publish** / Registry 回查 / **Create GitHub Release** | 全部 skipped |

失败原文:

```
✓ ③′ 宿主行用的是包名(不是路径)
✗ ④ 名册 root 指向包内 presets/,且 trust 是 system
✗ ④′ 没有把发行版 root 挤掉(includeShippedRoot 仍为 true)
结果:13 通过,2 失败
```

## 三、根因:宿主换掉了预设注册机制

`@deepseek-ai/dsh` 的 `latest` 在 2026-09-23T13:44Z 从 `0.1.5-rc.3` 前进到 `0.1.7-rc.1`,而 **0.1.7-alpha.1 起宿主把 agent 预设的注册方式整个换掉了**:

| | 旧机制(≤ 0.1.6-alpha.2) | 新机制(≥ 0.1.7-alpha.1) |
|---|---|---|
| 行 | `- id: agent-presets` | `- id: agent-preset-registry` |
| 插件 | `@deepseek-ai/dsh-agent-presets` | `@deepseek-ai/dsh-agent-preset-registry` |
| config | `default` / `includeShippedRoot` / `includeUserRoot` / `roots:[{path, trust}]` | 只剩 `default` / `selectedDefault` |
| 预设从哪来 | **目录扫描**(root + trust) | **组合声明行** `- id: preset-<id>`,`plugins:` 里放整份插件列表 |
| 包怎么声明 | `dsh.bundle.patch` 单文件 | `dsh.bundle.patch` **数组**,每个预设一个补丁文件 |

我们 `pack/cordis.patch.yml` 里那段按 id 覆盖 `agent-presets` 的补丁在新宿主上**没有落点**:profile 照样起(所以「宿主行恰好一行」「宿主行用包名」两条断言仍绿),但名册不再指向包内 `presets/`——**预设不进模式选择器**。

这不是 0.2.3 引入的缺陷:0.2.3 的包内容与 0.2.2 一致(版本号 + 中英 README),0.2.2 及以前在 ≥0.1.7 宿主上同样受影响。

完整证据链(两代补丁原文对比、切换版本边界实测、影响面):`lab/release/0.2.3-release-blocker.md`。

## 四、这次中断的性质

**门禁起了作用,不是事故。**

控方证据:这一步红的理由是对的——在 ≥0.1.7 宿主上,这个包装出来的预设确实不会出现。如果这道门不存在,0.2.3 会被推到 npm,而后续的「registry 逐文件一致」核对**不会发现这个问题**:那条核对验的是「registry 上那一份 == 本 commit 构建的那一份」,不验「装上之后能不能用」。一次看起来全绿的发布会把一个在新宿主上不可用的包交给用户。

同样值得注意的是:0.2.3 的源码侧本身没有问题。**同一 commit、同一份包**,在 09-23 的 CI run 35857872272 上是绿的;本次 suites、构建自检、版本一致性三道门也全绿。差别只在宿主——绿的那次装到的还是旧机制的 `0.1.5-rc.3`。

## 五、遗留状态与下一步

**遗留:**

- 远端 tag `v0.2.3` 仍存在(指向 `e362acc`),它没有对应的 npm 版本,也没有 GitHub Release。处置方式见下阶段计划(候选:删除该远端 tag,或保留为「一次被门拦下的发布」的痕迹)。
- 假设 `h-ktdr8g`(「打 tag 并推送后能经 OIDC 完成发布并通过回查」)已被独立评估者判 **refute**,留在账上——它记录了一次「此路不通」的准确位置。
- 假设 `h-izclhl`(「源码侧已就位、唯一缺口是存在」)支持到 L2,但它没预见到宿主换代这一层,所以本次发布的全部预期被后一条推翻覆盖。

**下一步(已与用户确认):以 0.2.4 发布,内容是适配新宿主机制**

1. 把预设从「root 目录」迁到「声明行」:新增 `pack/presets/clearai.patch.yml`,形态为 `- id: preset-clearai, name: '@deepseek-ai/dsh-agent-preset', config: {id, name, description, order, plugins: [...整份预设的插件行...]}`。
2. `package.json` 的 `dsh.bundle.patch` 由字符串改为数组。
3. `tools/verify-clean-install.mjs` 的 ④/④′ 断言改为按宿主版本分档(旧宿主验 root,新宿主验 registry 行 + `preset-clearai` 行 + 预设条目可列出)。
4. 版本号 → `0.2.4`,CHANGELOG 写明这是宿主机制的适配;0.2.3 那三条文档改动并入。
5. 待调研:能否单包兼容两代宿主(旧宿主没有 `@deepseek-ai/dsh-agent-preset`,新宿主没有 `dsh-agent-presets`)。

**发布路径本身不需要改证明方式**:本次失败不是发布身份、OIDC 或 registry 的问题——那些步骤根本没被执行到。适配完成后重跑同一条 tag 流程即可。
