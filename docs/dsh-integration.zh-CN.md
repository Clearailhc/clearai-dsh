# DSH 集成

ClearAI 是一个原生 DSH 插件。它把认识论层加在 DSH 的**组合面**上，DSH 引擎一行不改。本文说明这份仓库如何映射到那一层、什么东西装到哪里、以及怎么构建与验证。

## 一个包，三个面

发布出去的包叫 `clearai-dsh`。一次安装把三样东西放到 DSH 的三个不同面上：

| 面 | 承载什么 | 来自哪里 |
|---|---|---|
| 宿主组合（补丁层） | `clearai-host` 行 → 宿主半：会话投影单元 `clearai`、它的读路由、浏览器模块声明 | `pack/cordis.patch.yml`、`ui/lib/index.js` |
| Agent 预设（名册） | ClearAI 的十件工具、三段提示词、守卫；以及它组合进来的 DSH 原生能力 | `preset/` |
| 客户端模块（浏览器） | 中栏「本体」一格、右栏「世界树」一格 | `ui/lib/client.js` |

这个分工不是装饰。客户端模块**只**通过**宿主** loader 的行被发现，所以浏览器那一半必须在补丁层；投影单元是进程级、只注册一次的，所以它不能待在会被重建的预设里。反过来，判断侧——工具、提示词段、技能——正好就是「一个会话的能力集」的定义，所以它属于预设。

## 用宿主的，不自己做

预设除了 ClearAI 自己的插件，还组合了这些 DSH 原生能力；对应的东西 ClearAI 不自带：

| 能力 | 原生包 | ClearAI 怎么用 |
|---|---|---|
| 目标与续跑 | `dsh-goal`、`dsh-tool-goal`、`dsh-goal-round-driver` | `Frame` 挂判据与判断；`Conclude` 过独立评估后调 `ctx.goals.complete()`；守卫拒绝模型直接完成 |
| 计划审阅 | `dsh-plan-mode` | 人想审计划时用 `/plan` |
| 子代理与编排 | `dsh-subagent`、`dsh-tool-workflow` | 派独立评估者；模型并行检验多条竞争判断 |
| 问人 | `dsh-user-questions` | 开门的那次调用直接 `ctx.userQuestions.ask()` |
| 交付 | `dsh-tool-present`、交付卡片 | 结案时内核追加一条 `deliverables/presented` |
| 文件改动 | `dsh-workspace-changes` | 不维护自己的账本 |
| 技能与项目说明 | `dsh-skill`、`PROJECT.md` | 不自带模板与记忆 |

## 源 → 包 的映射

包是源的**纯函数**：`node tools/build-package.mjs` 做下面这套映射，`node tools/verify-package.mjs` 会现场重建再逐字节比对。

| 源 | 包内 |
|---|---|
| `package.json` | `package.json`（唯一一份清单） |
| `pack/cordis.patch.yml` | `cordis.patch.yml` |
| `pack/bin/clearai.mjs` | `bin/clearai.mjs` |
| `preset/` | `presets/clearai/` |
| `ui/lib/index.js` | `lib/host.js` |
| `ui/lib/fold.js` | `lib/fold.js` |
| `ui/lib/invariant.js` | `lib/invariant.js` |
| `ui/lib/domain-language.js` | `lib/domain-language.js` |
| `ui/lib/client.js` | `lib/client.js` |
| `locale/` | `locale/` —— 插件列表里的标题与一句话介绍，一个语言一个文件 |
| `brand/` | `brand/` —— README 的位图，加上插件列表的图标 `brand/icon.svg` |

`dist/` 是生成物，不进版本库。

## 预设怎么进选择器

宿主半随补丁层自动生效；agent 预设不能——预设是**组合里的一条声明行**，这条行得由包自己贡献。

一个预设就是一条 `- id: preset-<id>` 行（`@deepseek-ai/dsh-agent-preset`），插件列表整个放在它的 `config.plugins` 里：

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

这份文件（`presets/clearai/clearai.patch.yml`）**由 `preset/agent.cordis.yml` 在构建期派生**（一个源，不手抄第二份），经清单里的 `dsh.bundle.patch` 挂上。安装期不写任何东西，也不往用户家目录塞副本。

宿主的预设名册不扫目录、也不收预设路径，所以「播种到自己的根」这条路已经没有了。想改预设，就把声明行复制一份、换一个 id，作为自己的 bundle patch 装上。

## 安装

在应用里：侧栏**「插件」→ 添加插件**填 `clearai-dsh@0.4.0`，走的是 DSH 自己的插件管理器——设置里的**插件列表**是**只读清单**，不是安装入口。开终端则是同一次安装：

```bash
dsh plugin --profile web add clearai-dsh@0.4.0
```

版本是**刻意钉住**的：pnpm ≥ 11 会压住一天内发布的版本，而裸包名不会报错、会**回退到上一版**。插件管理器把 spec 原样转下去（`@deepseek-ai/dsh-plugin-manager` 里就是 `pnpm add <spec>`），并且**不比对**装到的是不是你要求的，于是这次降级被报成安装成功。机制与那句一次性豁免写在 README 的「为什么要钉版本」里。

下面这条引导式的是同一次安装，只是装完把组合读回来报一遍；它自己解析并钉住当前版本：

```bash
npx clearai-dsh install
```

社区市场（[dsh-market](https://github.com/dsh-market/dsh-market)）是第三方 bundle，只列 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 目录里的条目；ClearAI 的条目正在那边评审。它不属于 DSH，也不是这次安装的必要步骤。

随包的 `bin/clearai.mjs` 为此只长了**一个会动 profile 的动词**:它自己解析 DSH CLI(PATH 上有 `dsh` 就用,没有走 `npx --yes @deepseek-ai/dsh`),对缺省的 `web` profile 调宿主自己的安装动作,然后把组合读回来,报出 `clearai-host` 那一行到底有没有进去。`--dist` / `--tarball` / `--spec` 让它改从本地构建装(开发用),`--profile` / `--home` 覆盖缺省;想自己驱动 CLI 的话,`dsh plugin --profile web add clearai-dsh@<版本>` 仍然是等价的那条命令。

它**刻意不做 profile bootstrap,也不手工对账 profile**:CLI 第一次用到某个 profile 时会自己初始化它(`initialized profile web at …`),而把宿主的 reconcile 再写一遍正是这个项目拒绝的重复。同样的理由,缺 `pnpm` 时它**停下**而不是绕过去 —— pnpm 是 DSH 的前置,不是本插件的。那条没有 pnpm 的降级路径留在 `tools/install-native.mjs` 里,它的用途是一次性 DSH_HOME 上的 E2E,并且如实标注自己是降级。

重启 DSH 进程（宿主半按模块 URL 缓存），然后在预设选择器里选 **ClearAI**。

开发形态用 `install.sh`：它从仓库里的源构建出包，再用 `dsh plugin add` 装进去——就是产品那条路，只是包来自本地构建。旧的开发形态（把预设拷进 `~/.dsh/.agent-presets`）已经不起作用：宿主的预设名册不扫目录，预设只能经包里的声明行进名册。

## 构建与验证

```bash
npm test                        # 17 份套件 —— 清单在 test/run.sh
node tools/build-package.mjs    # 装配 dist/clearai-dsh
node tools/verify-package.mjs   # 现场重建并逐字节比对
node tools/verify-deploy.mjs    # 用部署出去的文件做一次真实装配（绕开 ESM 缓存）
node tools/verify-truth-table.mjs   # 真值表与代码常量对账
node tools/verify-clean-install.mjs # 空 DSH_HOME + 真 CLI 装一遍
node tools/verify-lifecycle.mjs     # 换版本重装 / 卸载 / 用户分叉 / 随包的 install 动词
```

浏览器那一面必须有浏览器：`tools/capture-ui.sh` 会建一次性 `DSH_HOME`、装好构建出来的包、起 `dsh web`、再拉起一个带调试端口的 Chrome；`tools/ui-drive.mjs` 负责点击与截图。之所以要有这条链路：客户端半在很长一段时间里只验到单测层面，而**第一次真的在浏览器里打开**就抓到插件根本没注册。

## 为什么不改引擎

DSH 的注册表、沙箱、审批栈、持久化与模型路由都是宿主不变量。ClearAI 只贡献行、工具、提示词段与一个客户端模块，然后交给 DSH 去组合。改引擎等于开一个分叉：升级被绑死在 ClearAI 内部实现上，还绕过了 DSH 的顺序、生命周期与可逆组合保证。把集成分量控制在一行补丁、一个预设目录、一个客户端入口，才是它可安装、可卸载、可安全升级的原因——也正是同一台机器上能同时存在别的预设的原因。
