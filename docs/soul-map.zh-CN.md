# 灵魂地图

> **改造中。** 本表按[「少即是多」方案](less-is-more-plan.zh-CN.md)写目标落点。「阶段」一列是方案第八节的实施阶段；该阶段落地前，以[已知缺口](known-gaps.zh-CN.md)为准。

每条原则映到承载它的机制与测试。找不到机制的，如实标为偏好。

| 原则 | 机制 | 测试 | 阶段 |
|---|---|---|---|
| 只做宿主做不了的 | 预设组合里用原生 goal、plan mode、subagent、user-questions、deliverables、workspace-changes、skill、PROJECT.md；内核不再自带对应实现 | 装配测试：内核不注册与原生重名或重复的工具 | 2–3 |
| 机制优于劝告 | `ctx.tools.guard()`；内核意图工具的 schema；`ui/lib/fold.js` | `test/kernel.test.mjs`、`test/host.test.mjs` | 已有，随阶段收窄 |
| 不可表达优于不可违反 | 工具没有可写的 `status`/`progress`/`phase`；L3 以上无调用方裁决；步骤秩单调 | schema 与单调性断言 | 已有 |
| 意图与事实分离 | `admission()`；`AdvancePlan` 唯一完成动作；折法派生进度与事实 | 准入、伪造证据、派生进度断言 | 已有 |
| 做的人不判自己 | L3 以上派独立评估者；`Conclude` 先过独立评估才调 `ctx.goals.complete()`；守卫拒绝模型直接 `update_goal(complete)`（含 PTC 嵌套调用） | 守卫测试（原型见 `tools/spikes/goal-guard.plugin.mjs`） | 3 |
| 人的决定只由人做 | 开门的那次调用直接 `ctx.userQuestions.ask()`；答案进程内交回；`NO_PROVIDER` 时置原生 goal 为阻塞 | 人门测试（原型见 `tools/spikes/human-gate.plugin.mjs`） | 3–4 |
| 保留历史 | 只追加的会话日志与折法；`RevisePlan` 留判据旧版；撤回只标记；词汇修订留痕、废止黏性 | 保留历史断言、`test/domain-language.test.mjs` | 已有 |
| 图是投影，不是存储 | `ui/lib/domain-language.js`（`graphProjection` / `deriveConflicts`）；确定性布局 | `test/domain-language.test.mjs` | 已有 |
| 语义变化要被看见 | 事实带着所用定义的指纹；定义文件改了，这条事实标「定义已变」 | 词汇修订与废止断言 | 4 |
| 过程只在需要时说 | 本体格只放结论清单与图；运行态卡只在状态变化时注入；交付卡片只在结案时出 | 客户端快照测试、运行态卡去重测试 | 6 |
| 脚手架，不是剧本 | 提示词三段（身份 / 循环 / 对人说话） | 提示词长度与段落测试 | 5 |

## 权威边界

宿主半（`ui/lib/index.js` → `lib/host.js`）负责投影与客户端接线；预设 `preset/` 负责工具、守卫与提示词。源到包的映射见 [DSH 集成](dsh-integration.zh-CN.md)。
