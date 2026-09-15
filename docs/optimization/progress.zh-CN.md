# 优化执行进度台账

> 母本：[`plan.zh-CN.md`](plan.zh-CN.md)。
> 每阶段结束后在此追加一行：完成项、跑过的命令、实际输出、阻塞点。
> 状态取值：`未开始` / `进行中` / `已完成` / `回滚`。

## 总览

| 阶段 | 内容 | 状态 | 验证命令 | 结果 |
|---|---|---|---|---|
| 0 | 落盘计划 | 已完成 | `ls docs/optimization/` | 三份文档就位 |
| 1 | 真值层（JSON + 生成器 + 校验器） | 已完成 | `node tools/verify-truth-table.mjs` | 18 项全过（47 条机制） |
| 2 | 状态机与时序图 | 已完成 | `node test/state-machine.test.mjs` | 33 通过,0 失败 |
| 3 | mismatch 清理（行为不变） | 已完成 | `npm test` | 9 份套件全绿 |
| 3′ | 一致性检查（提前于阶段 7） | 已完成 | `node test/docs-consistency.test.mjs` | 11 通过,0 失败 |
| 3″ | 不缩水覆盖设计（阶段 4 的验收基线） | 已完成 | 人工通读 + 真值表交叉 | 两语落盘，42 行覆盖矩阵 |
| 9′ | 注释风格棘轮（提前立规则） | 进行中 | `node test/comment-style.test.mjs` | 8 通过,0 失败；债务 79/159/70 |
| 4 | 最小硬边界重构 | 已完成 | `node test/authority-boundary.test.mjs` | 13 通过,0 失败 |
| 5 | DSH 原生菜单与能力回归 | 已完成 | `node test/preset-composition.test.mjs` | 20 通过,0 失败 |
| 6 | Prompt 瘦身与上下文注入 | 未开始 | `node test/prompt-sections.test.mjs` | — |
| 7 | 文档对齐（一致性测试部分已完成） | 未开始 | `node test/docs-consistency.test.mjs` | — |
| 8 | 最终验收与发布准备 | 未开始 | 五条验收命令 | — |
| 9 | 注释质量整体梳理（清账到 0） | 未开始 | `node test/comment-style.test.mjs` | 债务台账已立 |
| 10 | 收尾陈述 | 未开始 | 人工通读 | — |

## 基线

优化开始前的测试基线（阶段 0 之前实测）：

```text
$ bash test/run.sh
第 1 遍 · 内核:结果:571 通过,0 失败 · 宿主:结果:69 通过,0 失败 · 外脑:结果:40 通过,0 失败 · 客户端:结果:192 通过,0 失败 · 本体:结果:85 通过,0 失败
全绿(1 遍)。
```

## 阶段 0 · 落盘计划

**完成项**

- `docs/optimization/plan.zh-CN.md` —— 已批准计划全文（中文，母本）
- `docs/optimization/plan.md` —— 英文版
- `docs/optimization/progress.zh-CN.md` —— 本台账
- `README.md` / `README.zh-CN.md` 文档索引加入本计划入口

**验证**

```text
$ ls docs/optimization/
plan.md  plan.zh-CN.md  progress.zh-CN.md
```

**备注**

- 计划基线中的代码事实来自本次勘察（`clearai-kernel.js` 定点阅读 + `standard` 预设对照），
  不采信旧文档表述。

## 阶段 1 · 真值层

**完成项**

- `docs/optimization/truth-table.json` —— 47 条机制的权威源（8 个字段族，枚举受校验）
- `tools/build-truth-table.mjs` —— 生成中英两份 markdown，并附**代码常量快照**（由代码导出）
- `docs/optimization/truth-table.zh-CN.md` / `truth-table.md` —— 生成物
- `tools/verify-truth-table.mjs` —— 14 项交叉校验
- `test/truth-table.test.mjs` —— 22 项（含「生成物与源同步」「校验器不是空跑」）

**验证**

```text
$ node tools/build-truth-table.mjs
【真值表】47 条机制 → truth-table.zh-CN.md / truth-table.md
  代码快照: 6 机制 / 22 工具 / 26 配置键 / 22 段在场
  状态分布: implemented=43 partial=3 design-only=1 removed=0

$ node tools/verify-truth-table.mjs
✓ ① 工具目录 ↔ defineTool 双向一致
✓ ② preset 配置键都在 CONFIG_KEYS 白名单里
✓ ③ 提示词段在常数与槽位之间自洽
✓ ④ status=implemented 的条目都给了代码位置
✓ ⑤ 已删除的机制没有仍留在工具目录里
✓ ⑥ 刻意不挂的原生行确实没有挂载
✓ ⑦ 默认续跑额度是 128
✓ ⑦ 布防点回落到 DEFAULT_MAX_AUTO_TURNS
✓ ⑧ 已摘除的 set_autonomy 没有回到工具目录
✓ ⑨ 三条计数一致性检查
真值表校验：14 项全过（47 条机制）

$ node test/truth-table.test.mjs
结果:22 通过,0 失败
```

**这一阶段抓到的新事实（真值表第一次生效）**

1. 校验器一开始就红了：布防点不是 `CFG.maxAutoTurns ?? DEFAULT_MAX_AUTO_TURNS`，
   而是 `CFG.maxAutoTurns` 只记「人写没写」，真正的回落发生在 `kernel.js:2001`。
2. 授权门的真实语义比文档更弱也更精确：**未授权不是硬阻断**。
   未授权只让续跑 `hold`（`kernel.js:1898`），`AdvancePlan` 照常执行并在同一条变更里
   补写 `confirmed_by='progress'`（`kernel.js:3034-3038`）。CHANGELOG 0.1.2 与
   `release-verification` 写的「未授权内核拒收工作」是过度表述。
3. `ui/lib/fold.js:297-299` 注释仍称无人值守档自动确认（`by:'autonomy'`），
   而该来源已被删除——第三处独立漂移点。
4. 计数漂移：`preset/agent.cordis.yml:189` 写「20 件意图工具、22 段提示词」，
   实际是 **22 件工具、23 段定义（22 段在场）**。

## 阶段 2 · 状态机与时序图

**完成项**

- `docs/optimization/state-machines.zh-CN.md` / `state-machines.md` —— 11 张状态机
  （目标 / 计划 / 步骤 / 假设 / 观测 / 评估 / 证据 / 事实 / 世界线 / 自动续跑 / 侦察）
  + 事件清单覆盖表（42 个变更类型逐个归属）
- `docs/optimization/timing-diagrams.zh-CN.md` / `timing-diagrams.md` —— 5 张时序图
  （轻量探索 / 正式认识论 / 失败恢复 / 世界线 / 人门）
- `test/state-machine.test.mjs` —— 33 项（图↔折法双向核对、中英一致性、不变量必须写明）

**验证**

```text
$ node test/state-machine.test.mjs
结果:33 通过,0 失败

$ bash test/run.sh
第 1 遍 · 内核:571 · 宿主:69 · 外脑:40 · 客户端:192 · 本体:85 · 真值表:22 · 状态机:33
全绿(1 遍)。
```

**这一阶段抓到的精确语义（写进文档，避免再漂移）**

1. `fold.js:907-911` 的 `planIsAuthorized` 有**两个分支**：记号，或「已经真的推进过」。
2. `fork/arbitrated` **不设 `settled`**：它只把仲裁判决落账，采纳由内核据判决重判后
   再写 `fork/converged`。
3. 三条「不是落选」的派生状态（`failed` / `orphaned` / `unreturned`）全部零新账，
   都是已有事实的推论——这条设计纪律写进了图里。
4. 轻量探索路径当前只算**部分实现**：低权威探索物理上可行，但提示词把它写成正式循环的前置，
   且临时计划工具未挂载。

## 阶段 3 · mismatch 清理（行为不变）

**3a 文档 / 注释对齐（7 处漂移点）**

| 位置 | 改前 | 改后 |
|---|---|---|
| `clearai-kernel.js` 预算注释块 | 「dialogue 档 6 轮 / max 档 512 轮」两段并存 | 一个保险丝 `DEFAULT_MAX_AUTO_TURNS = 128` |
| `clearai-kernel.js:616` | 「没写则由当档决定（6/512）」 | 「没写回落到 128；这里只存人写没写」 |
| `clearai-kernel.js` `turnDemand` | 「无人值守那一档在立约时已自动确认」 | 「与档无关，没有任何一档会替你签记号」 |
| `clearai-kernel.js` `continuationService` | 「两档差别在额度（6 轮 vs 512 轮）」 | 「不按 autonomy 分叉；由门状态算」 |
| `clearai-kernel.js` `CreatePlan` | `autoConfirmed` 常量 + 「立约即授权」两段注释 | 只有一道人门；`confirmed_by` 固定 `'user'` |
| `clearai-kernel.js:698` | 「档决定缺省的连拦阈值（对话档 2、目标档 3）」 | 「连拦阈值不按档取，它是质量闸」 |
| `preset/agent.cordis.yml` | 运行档四条机制 + 面板开关 + 6/512 + 「20 件工具、22 段」 | 只决定澄清协议；22 件工具、23 段定义/22 段在场；并修掉「无人值守才布防续跑令牌」这处**未被测试覆盖**的旧断言 |
| `ui/lib/fold.js` | 面板开关、`by:'autonomy'`、档位开关 | 只读容忍旧日志；写明当前无写入者 |
| `ui/lib/index.js` | 「人刚在面板上切过档」 | 覆盖通道保留的理由（旧日志 + 卡片与机制同源） |
| `ui/lib/fold.js` `HUMAN_GATE_ACTIONS` 注释 | 把 `set_autonomy` 列为「留下的四个」 | 写明已摘除 + 旧日志容忍分支的理由 |
| `prompts.js` plan-governance | 「Goal 档自动确认」 | 「永远要人敲；没有任何一档会自动确认」 |
| `prompts.js` state-protocol | 「Plan 的事实源是 `run.current_step`」 | 「`CheckPlan` 与运行态卡」（DSH 里没有 `current_step` 这个字段） |
| 文档 | `known-gaps`「全程中文」、`loop-philosophy`「无判据可绕过」、`release-verification`「未授权内核拒收工作」 | 各自限缩为准确表述 |

**3b 死代码 / 孤儿副本**

- `autoConfirmed` 常量与三分支删除（`confirmed_by` 固定 `'user'`）。
- 删除仓库根的**孤儿副本**：`clearai-kernel.js`（310KB，还带着已删的 `autoConfirmed`/`set_autonomy`/6-512）与 `kernel.test.mjs`（与 `test/` 下那份逐字节相同）。两者都被 git 跟踪、都不在任何 `files` 清单里、都没有 import 方——是典型的第二本账。

**提前于阶段 7/9 立的两道检查**

- `test/docs-consistency.test.mjs`：被写错过的短语可以留在仓库里，但**那一行必须标明是历史**。第一次运行就抓到 `kernel.js:2751` 一处未标记的旧说法。
- `test/comment-style.test.mjs`：四类「流水账」反模式（日期戳 / `§NN` / 事故叙事 / 变更流水）的**配额棘轮**，只能降不能升。当前债务：日期戳 79、章节号 159、事故叙事 70，集中在 `clearai-kernel.js` 130 / `client.js` 105 / `fold.js` 48。
- `tools/verify-truth-table.mjs` 扩到 18 项：新增「文档里写的工具数与代码一致」「仓库根没有孤儿副本」两组。

**验证**

```text
$ bash test/run.sh
第 1 遍 · 内核:571 · 宿主:69 · 外脑:40 · 客户端:192 · 本体:85 · 真值表:22 · 状态机:33 · 文档:11 · 注释:8
全绿(1 遍)。
```

**环境作业（需要记录）**

宿主套件比的是**部署出去的那一份**（`~/.dsh/profiles/web/node_modules/clearai-dsh/lib/`）。改完源文件后执行：

```bash
node tools/build-package.mjs
node tools/install-native.mjs --profile web
```

注意：`dsh plugin add file:` 按**版本号**幂等——同版本不会重新拷贝。版本不变时若要让部署跟上，需要先删掉 `node_modules/clearai-dsh` 再装一次（本次即如此）。这一点值得在设计里处理：开发循环需要一个「强制重装」的显式动作，否则会出现"测试测的是旧部署"这种最难查的假绿。

**阶段 3 未做完、明确留给后续的三件**

1. `bash deny rules` 与宿主已有治理的重叠范围（阶段 4 决定哪些交还宿主）。
2. `autonomy.override` 读取路径：已无写入者，但旧日志可能仍有记录；删不删是阶段 4/5 的决定。
3. `CreatePlan` 说「不要开工」而运行态卡说「不需要任何人先按什么」——**同一回合里两句矛盾的话都会进模型上下文**，根因是 fold 把授权当记号、`CreatePlan` 把它当闸门。语义归一留给阶段 4。

## 阶段 3″ · 不缩水覆盖设计（阶段 4 的验收基线）

**完成项**

- `docs/optimization/epistemic-coverage.zh-CN.md` / `epistemic-coverage.md` —— 完整循环的规范形状
  （十三拍主线 + 四条失败支线 + 两条旁路）、42 行覆盖矩阵（每拍 → 承载机制 → 硬度 → 状态 → 验证）、
  不可缩水清单（10 条认识论核心）与可交还清单（工作方式）、缺口三归宿、验证映射与缺失测试。
- 语义归一决定落盘（§4）：**授权是记号，审阅才是闸门**——`CreatePlan` 一定弹原生审阅卡（唯一人门）；
  未授权的唯一后果是自动续跑 hold；显式推进时第一次推进补写 `confirmed_by='progress'`。
  三处文案（CreatePlan 结果 / 运行态卡 / 提示词）在阶段 4 统一为同一句话，行为不变。
- 计划成功标准新增第 8 条（覆盖设计存在且作为验收基线）；README 文档索引加入覆盖设计入口。

**设计过程中确认的关键判断**

1. 「不缩水」的操作定义 = 三个不退让：行为不退、硬度不降、诚实不减。
2. 覆盖矩阵里只有一处 `已实现` 却自相矛盾：授权语义（CreatePlan 说「不要开工」、
   运行态卡说「不需要任何人先按什么」）——这是阶段 4 的第一件。
3. 假设数量下限（≥2）是主线十三拍里唯一的 `部分` 覆盖：`minHypotheses: 0` 让它只是提示词。
   归宿二选一：阶段 4b 落为硬边界，或明示降级为偏好——不许停在模糊地带。
4. 把 todo / 子代理 / 模型切换交还 DSH 原生**不算缩水**，前提是「非权威路径写不进权威账本」
   由测试证明（`authority-boundary`，阶段 4）——这就是「不可表达优于不可违反」的操作化。

**分支与提交**

工作移到 `optimize/epistemic-core-harness` 分支，按逻辑分段提交（见 git log）。

## 时序图重写（阶段 2 返工，由读者反馈驱动）

**问题**：读者分不清「内核」「Agent」「投影」各是什么；同一角色在五张图里有不同的名字
（ClearAI 内核 / 内核、投影 / 面板、DSH 原生工具 / DSH），「Agent」把两件不同的事
（发出意图的模型、执行回合的引擎）糊成了一个参与者。

**改动**

- 图首立**固定角色表**（八位，所有图共用，不再有别名）：人 / 模型 / DSH 宿主 /
  ClearAI 内核 / 事实账本 / 投影 / 独立评估者 / 世界线执行者，每位都写「是什么 / 不是什么」。
- 「Agent」拆成**模型**（发出意图，不执行）与 **DSH 宿主**（执行回合、调度工具、写日志）。
- 命名裁决：**事实账本**（不用「认知账本」）——账本不存认知，只存发生的事；
  「什么可以被相信」是投影从它折出来的。图例写明：**内容是我们的**（clearai 变更事件 +
  `clear/` 文件），**载体是宿主的**（会话日志 + 文件系统）。
- 新增第 0 张图「一次意图工具调用的完整链路」（模型→宿主→内核→账本→投影），
  后五张图的每一段都是它的局部。
- 每张图的箭头全部按真实物理路径重画（例：CreatePlan 是 模型→宿主→内核，
  审阅卡是 内核→宿主→人；人门是 人→面板→宿主半白名单→账本→投影）。
- 保留旧名词对照（Agent / 内核 / 投影·面板 / 账本），老读者找得回来。
- `epistemic-coverage.*` §6 的规范序列同步换成同一套角色（不再用笼统的「系统」）。
- `state-machine.test.mjs` 新增 ⑤b（10 项）：角色表存在、八位齐全、
  「Agent」不许作为 mermaid 参与者回归、「内容是我们的」写明、旧名词对照保留。

**验证**：`node test/state-machine.test.mjs` → 43 通过,0 失败（原 33 项）。

## 阶段 4 · 最小硬边界重构（权威边界）

**4-1 授权语义归一（行为不变）**

覆盖设计 §4 的决定落地：授权是**归属记号**，审阅卡才是闸门。同一回合里两句矛盾的话
（CreatePlan 说「不要开工」、运行态卡说「不需要任何人先按什么」）统一为同一语义：
「未经人批准的计划，系统不会自动续跑；显式推进时，第一次交付会按事实记下归属。」
改了 6 处：内核 CreatePlan 四结局消息、requestPlanReviewAndStamp 的 unavailable 分支、
两处注释（§19-A 与 §34 的旧表述）、fold 运行态卡、prompts 的 plan-governance 段。
kernel 测试同步更新（无通道形态断言新语义：不自动续跑 + 可 RequestPlanReview 重呈）。

**4-2 假设数量下限落为硬边界（行为变更）**

主线十三拍里唯一的「部分」覆盖升格：门在 `SetGoal`（`hypotheses_too_few`，0 条一样拦，
修订不受限），产品立场在 preset（`minHypotheses: 2`，与 blockedThreshold 同一模式，
内核默认 0 保持机制中立），提示词补上了此前完全缺失的假设纪律（loop-contract
「假设至少两条，各带推翻条件」）。kernel 新增 5 个用例（0/1/2/修订/默认中立），
校验器新增 ⑫ 组 3 项。真值表 hypothesis-registry 的 known_mismatch 消除。

**4-3 权威边界测试（13 项）**

`test/authority-boundary.test.mjs` 把「不可表达优于不可违反」变成可执行断言：
变更字面量只出现在 clearai-kernel.js（brain/ontology/prompts 一件不产）；
投影侧 applyMutations 恰好两个调用点，各被 `meta.kind === MUTATION_KIND` 与
`clearai/mutations` 段名把守；人门动词没有工具 schema（模型工具面不存在它们）；
标记常量两侧同源；fold.js 只读账本（无任何写文件调用）。
阶段 5 交还原生能力之后，这份测试保证探索区结构上写不进权威账本。

**4-4 bash deny 与宿主治理的重叠核实（结论：无重叠）**

逐一核查 `dsh-tool-bash` / `dsh-bash-sandbox` / `dsh-bash-local`：宿主只有沙箱路径域与
审批升级，**没有内容级威胁模式清单**。fork 炸弹这类在可写沙箱内完全合法的命令，
只有内容规则拦得住。三条轴分清楚：沙箱管「写哪」、审批管「谁同意」、
deny 清单管「命令本身是什么威胁」。真值表该条的 known_mismatch 消除（原「部分重叠」
的怀疑不成立），没有条目需要交还。

**4-5 autonomy.override 死路径的决定**

保留只读容忍：旧会话日志里可能仍有 `set_autonomy` 记录，历史必须继续读得通；
当前没有任何写入者（fold 与 kernel 注释均已写明）。删除它是引入迁移风险换一个
注释问题，不值。

**验证**

```text
第 1 遍 · 内核:576 · 宿主:69 · 外脑:40 · 客户端:192 · 本体:85 · 真值表:22 · 状态机:43 · 文档:11 · 注释:8 · 边界:13
全绿(1 遍)。真值表校验:21 项全过。部署与源逐字节一致。
```

## 阶段 5 · DSH 原生菜单与能力回归

**5-1 `/` 菜单(新插件 `preset/plugins/commands.js`)**

五个命令,全部经过 `dsh-commands` 注册表(客户端菜单自动出现):
`/goal` `/plan` `/evidence` `/worldline` 四个**只读状态窗**——从宿主半的 `clearai`
门面现算现渲染,一个字都不落账;`/plan-review` 是**呈审捷径**——它先查先决条件
(有活动计划且未授权),再把一句结构化请求 steer 给模型,真正的呈审与授权记号落账
仍走 `RequestPlanReview` 工具。为什么命令自己不写账:变更只能随工具结果的
`meta.mutations` 进日志,命令处理器没有那条通道——这是权威边界,不是缺功能。

**5-2 工作方式挂回(非权威能力)**

`tool-todo`(允许并行 in_progress)、`tool-subagent`(+fork/control/list-agents,
`modelSelectionSettings: true` = 执行者自选模型)、`tool-workflow`(+worker thread)、
`tool-ralph` 全部挂回,与 standard 预设同形(delegation realm 隔离 `workflowEngine`)。
仍然不挂的只有真·第二本账三件:`tool-goal` / `command-goal` / `plan-mode`
(目标账与计划纪律各只有一本)。校验器 ⑥ 改成双向断言:不挂的不许回来,挂回的不许被手滑摘掉。

**5-3 提示词同步**

delegation 段重写为「四个委派面」分工表(SpawnScout 只读侦察 / subagent 干活 /
workflow 批量编排 / ralph 迭代冲刺)+「委派出去的是活,不是账」纪律;
execution-discipline 给 `todo_write` 定位:工作便签,不是账本。

**5-4 顺手修掉的三个移植性地雷(独立提交)**

`verify-deploy.mjs`、`verify-clean-install.mjs`、`e2e-run.mjs` 各有一处写死的
旧机器绝对路径(`/home/lhc/.npm/...`)——换台机器就是「模块找不到 / cwd 不存在」。
改为从 `~/.npm/_npx/*` 现找 DSH 宿主位置。干净安装验收因此首次在本机跑通(16/16)。

**验证**

`test/preset-composition.test.mjs`(20 项):挂载表双向断言 + 命令注册形状 +
命令行为(空账如实说、待授权才 steer、已授权不打扰、门面缺席报错不炸)。
11 份套件全绿;`verify:deploy` 通过(22 工具/22 段);`verify-clean-install` 16/16。

## 阶段 5 尾声 · deepseek-flash 端到端(目标要求的验收方式)

用内置 **deepseek-flash** 跑了两场真 e2e(headless,真模型真账本):

1. **建计划即停场**(默认任务):24/24。模型按新纪律立目标时**主动登记了两条候选假设**
   (下限机制 + loop-contract 提示词第一次被真模型走通),CreatePlan 一次过。
2. **全程收尾场**(`--expect-complete`):25/25。13 拍主链在真模型上走完一遍:
   goal/set(2 假设)→ plan/created → plan/confirmed(headless 无审阅通道,
   第一次交付按事实补写 by='progress'——阶段 4 的统一语义真跑成立)→
   observation/recorded → admission/checked → evidence/recorded → step/advanced ×2 →
   audit/dispatched → audit/settled(**独立评估者真跑了**)→ plan/closed → goal/closed(achieved)。
   声明 vs 实际:2/2 产物在盘上;结案前列表清空。

途中修掉四个 e2e 自身的坑(已提交 `73029c0`):CHECKOUT 硬编码、会话 slug 丢下划线、
macOS realpath 前缀、同层补丁并发加载竞态(宿主面行拆成先行补丁层)。

## 阶段 6 · Prompt 分类瘦身与运行态卡

**6a 段分类落地**:23 段全部打上 `class` 标签(hard 10 · native 5 · advisory 8),
语义写进 `test/prompt-sections.test.mjs` 头部注释。分类与内容咬合由测试钉:
hard 段必须带机制锚点、native 段不许背内核工具名、advisory 段不许伪装成机制承诺。

**抓到两处真漂移**(提示词描述的原生工具契约已经过期):
- `edit` 早就是字面替换(old_string/new_string),builder-tools 还在教 unified diff——
  模型照做会当场契约失败;
- `web_search` 没有 freshness/search_strategy,`web_fetch` 没有 view/next_offset——
  web-research 段的四个参数引用全是旧契约残留。
两处都已按现行原生 schema 改写。这就是为什么分类里要有「native 契约不漂移」这一组断言。

**6b 运行态卡瘦身**:授权三态从账本字段名(plan_confirmation_pending / confirmed_at:)
改成人话(「授权:记号未落账 / 已于 X 落账(人显式批准)」),语义一字未丢
(不自动续跑 + 按事实补写归属仍在)。卡片上的机制名就此清零。

**验证**:12 份套件全绿(新增「段」10 项)。

## 阶段 7 · 仓库级文档对齐(第二轮)

这一轮要修的面比预想小——阶段 3 已经对齐过一轮主体。本轮实际改动:

- `docs/verification-loop.*`:L4 放行的「走 `Confirm`(目标模式的人门)」是幽灵工具名,
  改为现行机制(交付 L4 步骤/分支触发宿主审批卡);「至少两条假设」补上**入口强制**的现行语义。
- `docs/known-gaps.*`:关闭两条已被阶段 4/5 解决的「缺口」——`/` 命令菜单(已落地,
  换成「真浏览器逐屏走查未做」的诚实表述);授权是否升级成真闸门(已拍板:卡就是闸门,
  记号是归属,三处文案同一句话)。
- `README.*`:层节补一行菜单与原生工作方式的现状(带权威边界的指针)。
- `tools/verify-deploy.mjs` 头部注释:删掉过期的「20 件工具」计数与两轮实测引子
  (计数以真值表为权威,注释只留「为什么」)。

**验证**:12 份套件全绿。
