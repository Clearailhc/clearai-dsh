# DSH 集成

ClearAI 是一个原生 DSH 插件。它把认识论层加在 DSH 的**组合面**上，DSH 引擎一行不改。本文说明这份仓库如何映射到那一层、什么东西装到哪里、以及怎么构建与验证。

## 一个包，三个面

发布出去的包叫 `clearai-dsh`。一次安装把三样东西放到 DSH 的三个不同面上：

| 面 | 承载什么 | 来自哪里 |
|---|---|---|
| 宿主组合（补丁层） | `clearai-host` 行 → 宿主半：会话投影单元 `clearai`、它的读路由、浏览器模块声明 | `pack/cordis.patch.yml`、`ui/lib/index.js` |
| Agent 预设（名册） | ClearAI 的工具、提示词段、闸门、技能与工作区模板 | `preset/` |
| 客户端模块（浏览器） | 产物视图、世界线 / 命题与事实 / 外脑三个页签 | `ui/lib/client.js` |

这个分工不是装饰。客户端模块**只**通过**宿主** loader 的行被发现，所以浏览器那一半必须在补丁层；投影单元是进程级、只注册一次的，所以它不能待在会被重建的预设里。反过来，判断侧——工具、提示词段、技能——正好就是「一个会话的能力集」的定义，所以它属于预设。

## 源 → 包 的映射

包是源的**纯函数**：`node tools/build-package.mjs` 做下面这套映射，`node tools/verify-package.mjs` 会现场重建再逐字节比对。

| 源 | 包内 |
|---|---|
| `package.json` | `package.json`（唯一一份清单） |
| `pack/cordis.patch.yml` | `cordis.patch.yml` |
| `pack/bin/clearai.mjs` | `bin/clearai.mjs` |
| `preset/` | `presets/clearai/` |
| `preset/template/` | `presets/clearai/template/` |
| `ui/lib/index.js` | `lib/host.js` |
| `ui/lib/fold.js` | `lib/fold.js` |
| `ui/lib/client.js` | `lib/client.js` |

`dist/` 是生成物，不进版本库。

## 预设怎么进名册

宿主半随补丁层自动生效；agent 预设不能——DSH 的预设名册**只扫 root 目录**，而后端包没法自己声明一个 root。

于是补丁层现场把 root 算出来：

```yaml
- id: agent-presets
  config:
    roots:
      - path: !!js "…new URL('node_modules/clearai-dsh/presets/', baseUrl)…"
        trust: system
```

经 `dsh plugin add` 装的包一定落在 profile 的 `node_modules` 里，所以这个路径是可预测的。它不需要任何安装期写入、不往用户家目录塞副本，归属落在 `system` 信任层。想改预设的人可以把它复制到自己的预设根（或用 `bin/clearai.mjs seed` 播种——它记哈希、**不覆盖**人改过的文件）。

补丁层会替换**整份** `agent-presets` config，所以那里列的键要与部署里那份保持一致。

## 安装

```bash
dsh plugin --profile web add clearai-dsh
```

重启 DSH 进程（宿主半按模块 URL 缓存），然后在预设选择器里选 **ClearAI**。

开发形态用 `install.sh`：它把仓库里的源直接摊进真实 `DSH_HOME`，改内核立刻生效；它是**开发**工具，不是产品路径。

## 构建与验证

```bash
npm test                        # 内核 / 宿主 / 外脑 / 客户端 / 本体 五份套件
node tools/build-package.mjs    # 装配 dist/clearai-dsh
node tools/verify-package.mjs   # 现场重建并比对；25 项
node tools/verify-deploy.mjs    # 用部署出去的文件做一次真实装配（绕开 ESM 缓存）
```

浏览器那一面必须有浏览器：`tools/capture-ui.sh` 会建一次性 `DSH_HOME`、装好构建出来的包、起 `dsh web`、再拉起一个带调试端口的 Chrome；`tools/ui-drive.mjs` 负责点击与截图。之所以要有这条链路：客户端半在很长一段时间里只验到单测层面，而**第一次真的在浏览器里打开**就抓到插件根本没注册。

## 为什么不改引擎

DSH 的注册表、沙箱、审批栈、持久化与模型路由都是宿主不变量。ClearAI 只贡献行、工具、提示词段与一个客户端模块，然后交给 DSH 去组合。改引擎等于开一个分叉：升级被绑死在 ClearAI 内部实现上，还绕过了 DSH 的顺序、生命周期与可逆组合保证。把集成分量控制在一行补丁、一个预设目录、一个客户端入口，才是它可安装、可卸载、可安全升级的原因——也正是同一台机器上能同时存在别的预设的原因。
