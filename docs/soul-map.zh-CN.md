# 灵魂地图

| 原则 | DSH 表面 / 代码 | 测试 / 状态 |
|---|---|---|
| 机制优于劝告 | `preset/plugins/clearai-kernel.js`（`MECHANISM_TOOLS`、`ctx.tools.guard()`）；宿主沙箱/审批；`ui/lib/fold.js`；`ui/lib/index.js` 投影注册 | `test/kernel.test.mjs`、`test/host.test.mjs`；已实现。只写在提示词里的约束在这张表里如实标成偏好，而不是被强制的机制。 |
| 不可表达优于不可违反 | `MECHANISM_TOOLS` 的工具 schema；`derive()` 与 fold 单调性；没有可写 `status`/`progress`/`phase`，也没有 L3+ 调用方 verdict | `test/kernel.test.mjs` 的 schema 与单调性断言；已实现。 |
| 意图与事实分离 | `admission()` 产物检查；`advance_plan`；`fold.js` 事件应用与派生 `wire` 视图；`conversation.view` 通过 `useProjection('clearai')` 读取 | `test/kernel.test.mjs` 的准入、伪造证据、派生进度断言；已实现。 |
| 做事的人不判自己 | L3+ 闸门（`verdict_not_accepted`）；`subagents.start('spawn', ...)` 派遣只读工具面、带 `outputSchema` 的评估者；审计记录 | `test/kernel.test.mjs` 及宿主/e2e 审计断言；机器评估已实现。L4 的步骤/分支级人类放行已实现；完整八状态验证机与覆盖每一次评估的通用 L4 闸门尚未实现。 |
| 保留历史 | 只追加的会话日志与 `fold.js`；`refine`/`void` 变更；supersession 字段；git 世界线引用与恢复提交；`FileHistory`/`RestoreFile` 单文件恢复 | `test/kernel.test.mjs` 的保留历史/世界线/恢复断言；已实现。 |

## 权威边界

宿主半（`ui/lib/index.js` → `lib/host.js`）负责投影、持久化、客户端接线与安全策略；预设 `preset/` 负责工具、guard 与提示词段。源到包的映射见 [DSH 集成](dsh-integration.zh-CN.md)。端到端验证是 `tools/e2e-run.mjs`，部署装配是 `tools/verify-deploy.mjs`。
