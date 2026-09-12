# elkjs 来源记录

| 项 | 值 |
|---|---|
| 包名 | elkjs |
| 版本 | 0.12.0 |
| 来源 | https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz |
| 仓库 | https://github.com/kieler/elkjs |
| 文件 | `lib/elk.bundled.js`（原样取用，未修改） |
| sha256 | `1222e44f953ce7746af23801e723708f8e6f436b8b377a6a5fc7552f34a307b3` |
| 获取日期 | 2026-08-22 |

## 许可

上游声明为 **`EPL-2.0 OR GPL-3.0-or-later`** 双许可。**本仓库按 EPL-2.0 使用**，
LICENSE 文件即 EPL-2.0 原文。EPL-2.0 是 weak copyleft：使用与再分发不传染，要求保留
版权声明并提供源码获取途径（上游仓库地址已在上表）。

选择 EPL 分支这件事需要写在这里，否则后来者看到 `GPL-3.0-or-later` 会误判为传染性
许可，触发 `app-forging` 的人门流程。

## 修改纪律

不修改 `elk.bundled.js`。需要调整布局行为时改传给 `elk.layout()` 的参数，
见 `../../references/when-drawing-a-topology.md`。升级版本时重新执行本页记录的获取
步骤并更新 sha256。
