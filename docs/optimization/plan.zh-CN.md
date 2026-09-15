# ClearAI 认识论核心收敛与 Harness 瘦身：落盘计划

> 这份文件是**已批准的执行计划**，也是后续所有工作的依据与进度台账的母本。
> 进度与每阶段跑过的命令记在 [`progress.zh-CN.md`](progress.zh-CN.md)。
> 英文版见 [`plan.md`](plan.md)。

## 0. 成功标准

1. 仓库内存在一份**权威真值表**，其内容由代码常量生成或校验，能一眼回答「每条机制当前是否实现、是硬边界还是建议、由谁触发、是否受 autonomy 影响、对应哪条测试」。
2. 仓库内存在**状态转移图**与**时序图**，且明确区分 `implemented / partial / design-only / removed`，不再把设计目标写成已交付行为。
3. 文档、注释、prompt 中所有与现行代码不符的表述被清除或标注为「历史行为」。
4. 已确认的 dead code（旧 autonomy 分叉、6/512 预算、旧 toggle 写入路径）被删除；核心机制（fold / admission / evaluator / human gate / ledger / protected roots）零删减。
5. `/` 菜单由 ClearAI 自己通过 DSH 原生 `commands` 注册表贡献条目，菜单不再比 `standard` 预设更薄。
6. 非权威探索能力（todo / subagent / workflow / 模型切换）以 DSH 原生方式回归，且**结构性无法**写入权威账本。
7. `npm test`、`npm run build`、`npm run verify`、`npm run verify:deploy`、`npm run verify:install` 全绿。
8. 仓库内存在一份**不缩水的覆盖设计**（[`epistemic-coverage.zh-CN.md`](epistemic-coverage.zh-CN.md)）：完整循环的每一拍都标注承载机制、硬度、状态与验证；它是阶段 4 及以后所有改动的验收基线——`已实现` 的认识论行为不许倒退。

## 1. 已核实的关键事实（计划基线）

这些是**代码事实**，不是文档说法；后续所有对齐以它们为准：

| 事实 | 位置 |
|---|---|
| 计划**永远**需要人工确认，`autoConfirmed = false` | `preset/plugins/clearai-kernel.js:2764-2798` |
| 续跑由**门状态**决定，不再按 autonomy 分叉；`blocked→stop`、未授权 / 未决审计 / 开门 → `hold` | `clearai-kernel.js:1892-1917` |
| 默认续跑额度 `DEFAULT_MAX_AUTO_TURNS = 128` | `clearai-kernel.js:516`、`:2001` |
| 旧 `{attended:6, unattended:512}` 已被 §34 删除，但注释仍残留 | `clearai-kernel.js:492-516`、`:1920-1928` |
| `set_autonomy` 与 `autonomyFromMessages / turnAutonomy / autonomyForTurn` 已摘除 | `clearai-kernel.js:2230-2235` |
| `validateSteps` 已强制每步 `done_criteria` 长度 ≥ 4 | `clearai-kernel.js:2405-2426`，`CreatePlan` 调用见 `:2745` |
| prompt 语言已改为**跟随用户语言** | `preset/plugins/prompts.js:33-36` |
| prompt 共 22 段，其中澄清协议为槽位 `clarification`（两套互斥措辞） | `prompts.js:23-312` |
| ClearAI 预设**没有任何 `commands` 贡献** | `preset/plugins/` 全目录 |
| `standard` 预设挂 `command-goal`，并挂 todo / subagent / workflow / ralph / plan-mode | `@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml:95-99,105-125,169-234,241-244` |
| 原生人类命令注册表 API 为 `inject:['commands']` + `ctx.commands.register({name, description, input?, handler})` | `@deepseek-ai/dsh-commands/lib/types/index.d.ts`、`dsh-command-compact/lib/index.js` |
| 原生模型切换能力已存在（`dsh-client-ui-model-selection`、subagent 的 `modelSelectionSettings`） | DSH checkout `node_modules/@deepseek-ai/` |

**结论**：「ClearAI 模式下 `/` 菜单不如创造模式」的判断成立——ClearAI 只有 `command-compact`，没有 `command-goal`，也没有自己的任何命令贡献。

## 2. 设计原则

- **第一性原理**：ClearAI 只保证「什么可以被相信」，DSH 负责「怎么工作」。凡能被算出来的，不要被说出来。
- **奥卡姆剃刀**：一条约束如果只存在于 prompt，就承认它是偏好；如果要成为边界，就落进 schema / 注册表 / 投影 / 测试。不为已删除的机制保留兼容代码，除非有真实日志迁移需求。
- **不可表达优于不可违反**：非权威探索路径应**结构上无法**写权威账本，而不是靠提示词劝阻。
- **每阶段独立可验证**：每个阶段结束时 `npm test` 必须绿；行为变更必须与清理变更分开提交。

## 3. 阶段与交付物

### 阶段 0：落盘计划

- `docs/optimization/plan.zh-CN.md`（本文件）、`plan.md`
- `docs/optimization/progress.zh-CN.md`
- `README.md` / `README.zh-CN.md` 文档索引加入指向本计划的入口

### 阶段 1：建立真值层（不改运行行为）

- `docs/optimization/truth-table.json` —— 机器可读权威源
- `docs/optimization/truth-table.zh-CN.md` / `truth-table.md` —— 由 JSON 生成
- `tools/build-truth-table.mjs` —— 生成 markdown，并从代码常量交叉填充 `code:` 字段
- `tools/verify-truth-table.mjs` —— 校验代码常量、preset、prompt、工具清单与真值表一致

每条机制字段：

```yaml
id, name, name_en, layer, status, hardness, authority, actor,
source: {code, tests, config, prompt, docs},
trigger, input, output, blocks_execution,
affected_by_autonomy, native_dsh_alternative, rationale, known_mismatch
```

首批登记机制（认识论核心 + 上层框架）：目标创建 / 修订、假设登记、判据、正式计划、`done_criteria` 校验、计划审阅、`RequestPlanReview`、`AdvancePlan`、观测准入、L0–L2 自评、L3+ 独立评估、L4 步骤 / 分支放行、目标结案评估、事实升格、历史保留、世界线、预注册指标、人工采纳、单循环、四拍、Scout / Executor / Evaluator、子代理裁剪、workflow / ralph 裁剪、原生 plan / todo 裁剪、bash deny rules、受保护目录、git / ledger、KernelPanic 恢复、自动续跑、`maxAutoTurns`、`autonomy`、运行态卡、22 段 prompt、上下文剪枝、技能候选态、记忆写入、原生模型路由、`commands` 菜单。

### 阶段 2：状态机与时序图

- `docs/optimization/state-machines.zh-CN.md` / `.md`：目标、计划、步骤、假设、观测、评估、证据、事实、世界线、自动续跑共 10 张
- `docs/optimization/timing-diagrams.zh-CN.md` / `.md`：轻量探索、正式认识论、失败恢复、世界线收敛共 4 张
- 节点名与边必须来自 `ui/lib/fold.js` 的事件类型与 `derive()` 派生字段
- 计划状态机必须体现：`CreatePlan → 审阅 → 仅 approved 授权`；`AmendPlan` / `RefinePlan` / `RequestPlanReview` 不授权
- 自动续跑图必须写明默认 128、`turnDemand` 的门优先顺序、`goals` 仅为驱动器
- `test/state-machine.test.mjs`：断言 fold 中出现的事件类型集合与文档所列转移的 event 名称一致

### 阶段 3：mismatch 清理（行为不变）

**3a 文档 / 注释修正**

- `clearai-kernel.js:492-516`、`:1920-1928`：删除 6/512 与「两档差别在额度」的表述
- `clearai-kernel.js:1897`、`:2760-2762`：删除「无人值守档立约即自动确认」的残留说法
- `prompts.js` 中「Goal 档自动确认」之类表述
- `preset/agent.cordis.yml:166-182`：改写为「仅 clarification 槽位随 autonomy 收敛；计划授权不随 autonomy 变化」
- `docs/known-gaps.zh-CN.md:28`：修正「全程中文」
- `docs/loop-philosophy.zh-CN.md:170`：把「无 done_criteria 可绕过评估」限缩为适用于旧日志 / 内部构造路径
- 全文清除「通用 L4 人门已实现」「八状态验证机已交付」这类越界表述

**3b 死代码删除**

- `autoConfirmed` 常量及其三分支（固定 `'user'`）
- `continuationService()` 中「两档都有窗口」的过时注释块
- 仅服务旧档位的预算常量与注释
- 确认无迁移需求后删除 `autonomy` 兼容读取路径中的死分支

阶段 3 结束时：`npm test` 绿，且 `git diff` 中不出现 `fold.js` 语义变更。

### 阶段 4：最小硬边界重构（探索区 / 正式区）

**4a 保留为硬约束**：模型不能直接写 `clear/evidence`、`clear/knowledge/facts`、`clear/goals`；不能声明正式 state / progress / phase；事实由 fold + derive 派生；L3+ 不由执行者自判；人工裁决不可伪造；世界线算术与人工采纳分离；未知副作用先观察；历史只追加。

**4b 放松非权威过程**：允许先低权威探索再正式立约；允许非权威子代理并行；允许一次性完成多个低风险步骤；计划粒度、是否先 Scout、是否用世界线降为建议。

**4c 结构性隔离**：非权威产物写入面与权威事件写入面在代码上分开；`test/authority-boundary.test.mjs` 断言非权威路径无法产生 `clearai` mutation。

### 阶段 5：以 DSH 原生方式恢复能力与菜单

**5a `/` 菜单**：新增 `preset/plugins/commands.js`，`inject: ['commands']`，通过原生 `ctx.commands.register` 贡献 `/plan-review`、`/goal`、`/plan`、`/evidence`、`/worldline`、`/skill-save`（名字待定稿）。命令只做**人侧读取与放行**，不新增模型可调用的权威写入面；handler 复用现有内核函数。评估是否加回 `@deepseek-ai/dsh-command-feedback`。

**5b 非权威工具回归**：重新挂载 `tool-todo`、`tool-subagent` / `tool-subagent-fork` / `tool-subagent-control`、`tool-workflow`、`tool-ralph`，以及 subagent 的 `modelSelectionSettings: true`。**保持不挂** `tool-goal` / `command-goal`（单一目标账本）与 `plan-mode`（两套计划纪律）。

**5c 原生模型切换**：ClearAI 不维护 provider / model 状态；切换走 DSH 原生入口；运行态卡只读展示当前模型；评估者仍可用独立 provider，但只记录来源身份。

**5d 验收**：`test/preset-composition.test.mjs` 断言 tools 行集合与真值表一致、三个禁用行仍未挂载；端到端验证临时 todo 不改 progress、自由 subagent 不能写权威事件、模型切换不改状态。

### 阶段 6：Prompt 瘦身与上下文注入

**6a 三段分类**（每段打标签写进真值表）：`hard`（最小事实边界）、`native`（删除与 DSH 重复的内容）、`advisory`（单循环、四拍、计划先行、不自由委派、先侦察后计划、交付粒度、语言风格 → 移到菜单帮助、工具 description、运行态卡）。

**6b 运行态卡瘦身**：注入当前目标、当前计划、当前步骤、当前判据、证据状态、待人处理、阻塞原因、可继续原因、推荐下一步；移除内部机制名、宿主 goal id、失效模式术语。

**6c 验收**：`test/prompt-sections.test.mjs` 断言每段有标签、`hard` 段不含流程风格描述。

### 阶段 7：文档整体对齐与一致性测试

- 全量修正 `README*`、`docs/design-principles*`、`docs/loop-philosophy*`、`docs/epistemic-loop*`、`docs/verification-loop*`、`docs/release-verification*`、`docs/known-gaps*`、`docs/soul-map*`、`docs/positioning*`
- 所有表述统一三标签：`当前实现` / `设计目标` / `已删除`
- `test/docs-consistency.test.mjs` 对禁用词扫描，含 `设计目标` / `已删除` 标签的段落豁免

### 阶段 8：最终验收与发布

```bash
npm test
node tools/build-truth-table.mjs && node tools/verify-truth-table.mjs
node tools/build-package.mjs && node tools/verify-package.mjs
node tools/verify-clean-install.mjs
npm run verify:deploy
```

加一次真浏览器核对（`/` 菜单条目出现、面板不回归），更新 `CHANGELOG.md` 与 `README` 定位。

### 阶段 9：注释质量整体梳理（不可省）

**问题**：当前代码注释有大量**流水账**。阶段 3 时点的实测计数：

| 反模式 | 出现次数 |
|---|---|
| 日期戳（`2026-09-11` 之类） | 79 |
| 内部章节号（`§34` 之类） | 164 |
| 事故叙事标签（「长测」「实测」「现场」） | 74 |
| 注释总行数 | 约 2,900 |

共同毛病是：**读者无法从语气上分辨它讲的是现在还是过去**，而且它们把 git 已经记着的历史又抄了一遍。日期戳与 `§NN` 对读者没有信息量——`§34` 在本仓库里没有可查的对照表。

**规则**（落成 `docs/optimization/comment-style.zh-CN.md`，作为可引用的判据）

一条注释只写三件事：

1. **为什么这样做**——这个选择换来什么、拒绝了什么；
2. **不这样做会怎样**——具体的失败模式，但**不带日期、不带事故编号**；
3. **边界在哪**——什么条件下这套不成立。

**不写**：日期戳；`§NN` 章节号；「长测／实测现场」这类事故叙事；「原先…现在…」「阶段 N 已修正」的变更流水；被删代码的历史——**git 就是历史账本，注释不是**。

**做法**

1. 先写 `comment-style.zh-CN.md`（规则 + 正反例各一段）；
2. 新增 `test/comment-style.test.mjs`：对 `preset/plugins/*.js` 与 `ui/lib/*.js` 统计四类反模式的**基线配额**，配额只能降不能升（棘轮）——"暂未清完"因此是一笔**有账的债**，而不是"没人管"；
3. 按欠账分布逐个文件清零（实测分布，2026-09 时点）：`clearai-kernel.js` 130 处 → `ui/lib/client.js` 105 处 → `ui/lib/fold.js` 48 处 → `ui/lib/index.js` 22 处 → `brain.js` / `ontology.js` 各 1–2 处；
4. 每一步**只改注释，不改一行代码**；改完跑 `npm test`，并重跑 `build-package` + 重新部署（宿主套件比的是部署出去的那份）；
5. 收尾把配额降到 0，或对确实要保留的少数几处写明豁免理由。

**验收**

- `node test/comment-style.test.mjs` 通过，四类计数为 0（或有写明理由的豁免）；
- 人工抽读 10 处注释：都能在**不看 git 历史**的前提下读懂；
- `npm test` 全绿。

### 阶段 10：收尾陈述

在 `progress.zh-CN.md` 写一份总账：做了什么、没做什么、哪些仍是设计目标、下一步最该做什么。**这份总账是给未来的人读的，不是给自己的纪念册**——只写结论与依据，不写过程。

## 4. 提交与回滚策略

- 阶段 0–2：纯新增文档与工具，单次提交
- 阶段 3：`docs(align)` 与 `refactor(remove-dead-code)` 两次提交，后者不触碰 `fold.js`
- 阶段 4–6：每阶段独立提交，行为变更与配置变更分开
- 任一阶段 `npm test` 变红即回滚该阶段，不带着红灯进入下一阶段
- `dist/` 始终由 `build-package.mjs` 生成，不手工编辑

## 5. 明确假设与不做的事

**假设**

1. 可能有真实历史日志含 `confirmed_by: 'autonomy'`；阶段 3b 删除该分支前先 grep 测试与 fixture，若存在则写入侧固定 `'user'`、仅在读取侧保留兼容。
2. `tool-todo` / `subagent` / `workflow` / `ralph` 回归不与 ClearAI 机制冲突，因为其产物默认停留在非权威区；阶段 5 的测试负责证明。
3. `/` 命令需中英双语，风格与现有面板一致（由 `dsh-client-locale` 承载）。

**不做**

- 不改 DSH 引擎
- 不新增第二本目标账或计划账
- 不删除 fold / admission / evaluator / human gate / ledger / worldline / protected roots
- 本计划内不实现「验证八状态机」或「通用 L4 门」，只保证文档不再冒称已实现
- 不在本计划内拆分 `clearai-kernel.js`（5540 行重构是独立议题）

## 6. 交付物清单

```text
docs/optimization/plan.zh-CN.md
docs/optimization/plan.md
docs/optimization/progress.zh-CN.md
docs/optimization/epistemic-coverage.zh-CN.md
docs/optimization/epistemic-coverage.md
docs/optimization/truth-table.json
docs/optimization/truth-table.zh-CN.md
docs/optimization/truth-table.md
docs/optimization/state-machines.zh-CN.md
docs/optimization/state-machines.md
docs/optimization/timing-diagrams.zh-CN.md
docs/optimization/timing-diagrams.md
tools/build-truth-table.mjs
tools/verify-truth-table.mjs
preset/plugins/commands.js            （新）
test/truth-table.test.mjs             （新）
test/state-machine.test.mjs           （新）
test/docs-consistency.test.mjs        （新）
test/authority-boundary.test.mjs      （新）
test/preset-composition.test.mjs      （新）
test/prompt-sections.test.mjs         （新）
docs/optimization/comment-style.zh-CN.md
test/comment-style.test.mjs           （新）
preset/agent.cordis.yml               （改）
preset/plugins/prompts.js             （改）
preset/plugins/clearai-kernel.js      （改）
ui/lib/*.js                           （改：仅当菜单 / 运行态卡需要）
docs/**（对齐）
README.md / README.zh-CN.md / CHANGELOG.md
```

## 7. 执行方式

从阶段 0 开始逐阶段执行，并在 `progress.zh-CN.md` 记录每阶段跑过的命令与结果；每阶段结束向用户汇报一次（完成项、验证命令输出、下一阶段）。遇到需要产品决策的点（例如 `/` 命令最终命名、是否加回 `dsh-command-feedback`）单独确认，不阻塞其余阶段推进。
