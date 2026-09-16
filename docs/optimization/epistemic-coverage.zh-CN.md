# ClearAI 认识论循环：全覆盖设计（不缩水基线）

> 这份文件回答一个问题：**完整的认识论循环长什么样，每一拍由哪条现有机制承载。**
> 它是阶段 4 及以后所有改动的验收基线：任何「瘦身」都不许让本文中 `已实现` 的认识论行为倒退。
> 每条机制的逐字段权威源在 [真值表](truth-table.zh-CN.md)；状态转移细节在 [状态机](state-machines.zh-CN.md)；交互顺序在 [时序图](timing-diagrams.zh-CN.md)。本文只做**覆盖论证**：循环的每一拍都有家。

## 0. 三条判读规则

1. **认识论核心 ≠ 工作方式。** 核心回答「什么可以被相信」；工作方式回答「活怎么干」（todo、子代理、模型切换、`/` 菜单）。瘦身只准动后者；把工作方式交还 DSH 原生**不算缩水**——只要它结构上碰不到权威账本。
2. **覆盖 ≠ 实现。** 每一拍都标注 `已实现 / 部分 / 仅设计 / 已删除`。仅设计的拍不许出现在「系统能做什么」的陈述里。
3. **不缩水 = 三个不退让。** 行为不退（已实现的不许消失）、硬度不降（硬边界不许降级成提示词）、诚实不减（缺口不许藏）。

## 1. 完整循环的规范形状

十三拍主线，加四条失败支线、两条旁路：

```text
① 立目标（带「怎样算回答了」的判定标准）
② 登记假设（每条一句话主张 + 推翻条件，至少两条）
③ 立约（计划 = 步骤 × 等级 × done_criteria，判据先登记后执行）
④ 人审（原生审阅卡，永远弹；批准才落授权记号）
⑤ 执行（产物落盘到工作区，受保护目录不可写）
⑥ 观测准入（产物存在、非空、结构合法）
⑦ 分流评估：
     L0–L2 → 做的人自判，留可复查依据
     L3+   → 独立评估者（人或机器），做判分离
     L4    → 独立评估 + 步骤/分支级人放行
⑧ 证据（支持 / 推翻 / 无法判定，写下不改）
⑨ 事实升格（证据够了，带边界与支持等级进知识库）
⑩ 结案评估（目标达成判定）
⑪ 学习沉淀（技能候选 → 人扶正；记忆校验去重）
⑫ 续跑裁决（门状态决定：继续 / hold / 停）
⑬ 下一轮，或归档

失败支线：
  F1 同一处连续驳回 ≥ 阈值 → 计划 blocked，停下等人（质量闸，不按档）
  F2 假设被推翻 → supersede 追加，不删除
  F3 步骤作废 → void 保留，历史完整
  F4 内核崩溃 → 重启后从日志折叠恢复，自动补防续跑令牌

旁路：
  B1 世界线：互斥方案各占工作副本，收敛是算术（预注册指标排序），
     算不出 → 人门裁决，落选分支全部保留
  B2 非权威探索：todo / 子代理 / workflow / 模型切换——干活不设限，
     但结构上写不进权威账本
```

## 2. 覆盖矩阵

每一拍一行。「硬度」= 硬边界（schema/注册表/投影/测试强制）还是建议（提示词承载）。
「验证」= 钉住这一拍的测试；写「—」表示当前靠提示词或缺失。

### 主线

| 拍 | 预期行为 | 承载机制 | 硬度 | 状态 | 验证 |
|---|---|---|---|---|---|
| ① | 立目标带判定标准；修订追加不覆盖 | `SetGoal` / `RefineGoal` | 硬 | 已实现 | kernel 套件 |
| ② | 假设 ≥2，各带推翻条件 | `SetGoal` 入口门 + preset `minHypotheses: 2` | 硬 | 已实现 | kernel 套件（0/1/2/修订四形态 + 默认中立） |
| ③ | 判据强制：每步 `done_criteria` ≥4 字 | `validateSteps` ← `CreatePlan` | 硬 | 已实现 | kernel 套件 |
| ④ | 计划永远弹原生审阅；`confirmed_by` 只有 `user`/`progress` | `CreatePlan` → 原生审阅 | 硬 | 已实现 | kernel + host 套件 |
| ⑤ | 产物落盘；`clear/` 受保护 | bash deny rules + 宿主沙箱 | 硬 | 已实现 | kernel + host 套件 |
| ⑥ | 观测准入三条判据 | `check_step_evidence` 准入层 | 硬 | 已实现 | kernel 套件 |
| ⑦a | L0–L2 自判留据 | 登记标准 + 只追加日志 | 硬（形状） | 已实现 | kernel 套件 |
| ⑦b | L3+ 做判分离，独立评估者带 `outputSchema` | evaluator 派遣 | 硬 | 已实现 | kernel + host 套件 |
| ⑦c | L4 步骤/分支级人放行，读原生审批记录 | 人放行挂步骤/分支轴 | 硬 | 已实现 | kernel + host 套件 |
| ⑧ | 证据三态、只追加、引用观测与评估 | 评估卡落盘 | 硬 | 已实现 | kernel 套件 |
| ⑨ | 事实升格带边界与支持等级 | 事实库 `clear/knowledge/facts/` | 硬 | 已实现 | kernel 套件 |
| ⑩ | 结案评估判目标达成 | 目标结案评估 | 硬 | 已实现 | kernel 套件 |
| ⑪ | 技能候选只有人能扶正；记忆字段校验 + 标题去重 | `promote_skill` 人门 + `WriteMemory` | 硬 | 已实现 | kernel 套件 |
| ⑫ | 续跑由门状态算：blocked→停；未授权/裁决在飞/门开→hold | `turnDemand` + 宿主 goals | 硬 | 已实现 | kernel + host 套件 |
| ⑬ | 128 保险丝到限由原生 driver 自己 block | `DEFAULT_MAX_AUTO_TURNS` | 硬 | 已实现 | kernel 套件 |

### 失败支线

| 拍 | 预期行为 | 承载机制 | 硬度 | 状态 | 验证 |
|---|---|---|---|---|---|
| F1 | 连拦阈值 → blocked 等人；不按档取值 | `blockedThreshold` | 硬 | 已实现 | kernel 套件 |
| F2 | 推翻不删除：supersession 链 | fold 只追加 | 硬 | 已实现 | kernel 套件 |
| F3 | void 步骤保留在历史 | fold 只追加 | 硬 | 已实现 | kernel 套件 |
| F4 | 崩溃后折叠恢复 + 重启补防 | fold + continuationService | 硬 | 已实现 | kernel + host 套件 |

### 旁路

| 拍 | 预期行为 | 承载机制 | 硬度 | 状态 | 验证 |
|---|---|---|---|---|---|
| B1a | 世界线各占工作副本 | `ForkPlan` + worktree | 硬 | 已实现 | kernel 套件 |
| B1b | 收敛是算术；算不出 → 人门；落选保留 | `ConvergeFork` + 人门 | 硬 | 已实现 | kernel 套件 |
| B2a | todo / 子代理 / workflow / ralph 原生回归，产物留在非权威区 | `preset/agent.cordis.yml` 工作方式段 | 硬 | 已实现 | `authority-boundary`（14 条）+ `preset-composition` |
| B2b | 模型切换走原生 `modelSelectionSettings` | `dsh-tool-subagent` 行的配置 | 硬 | 已实现 | `preset-composition` |
| B2c | ClearAI 自己的 `/` 菜单（命令注册表贡献） | `preset/plugins/commands.js` | 硬 | 已实现 | `preset-composition` |

### 贯穿支撑

| 行为 | 承载机制 | 硬度 | 状态 | 验证 |
|---|---|---|---|---|
| 意图与事实分离：没有可写 status/progress 的字段 | schema 不可表达 | 硬 | 已实现 | kernel 套件 |
| 投影是唯一真相：状态 = 日志折叠，单调只增 | `fold.js` + RANK 单调 | 硬 | 已实现 | client 套件 |
| 运行态卡每回合派生、前缀稳定才注入 | `renderCard` | 硬 | 已实现 | client 套件 |
| 提示词 22 段清单驱动、槽位互斥收敛 | `SECTIONS` + 贡献表 | 硬 | 已实现 | truth-table 校验 |
| 本体声明与实现交叉核对 | `ontology.js` + 装配校验 | 硬 | 已实现 | ontology 套件 |

### 已知不覆盖（如实列出，归宿见 §5）

| 拍 | 预期行为 | 状态 | 归宿 |
|---|---|---|---|
| ⑦+ | 覆盖**每一次**评估的通用 L4 闸门 | 仅设计 | 保持 design-only，文档不冒称 |
| — | 验证八状态机 | 仅设计 | 保持 design-only |
| — | `retracted`（已撤回）有产生者 | 仅设计 | 保持 design-only |
| — | 观测来源 `human_upload` / `file_drop` / `callback` / `pull` | 仅设计 | 保持 design-only；当前只有 `self`/`scout` 生产者 |

## 3. 不可缩水清单 与 可交还清单

**不可缩水（认识论核心）**——动任何一条都等于改变产品定义：

1. 判据先登记后执行（③）
2. 计划永远经人审（④）
3. 观测准入三条（⑥）
4. 做判分离：L3+ 不许自判（⑦b）
5. 证据/日志只追加，推翻不删除（⑧、F2、F3）
6. 事实升格带边界（⑨）
7. 续跑由门状态决定（⑫）
8. 世界线算术收敛、落选保留（B1）
9. 技能扶正只有人能触发（⑪）
10. 意图与事实不可互写（schema 层）

**可交还 DSH（工作方式）**——交还原生反而更好，前提是 §4 的权威边界成立：

- todo、子代理、workflow、ralph、plan-mode、模型切换、`/` 菜单、命令面板、
  技能/记忆**读侧**（已交还）、上下文预算（已交还 `dsh-token-meter`）。

**判断一条改动是否缩水的程序**：改之前先在 §2 找到它所在的行；
该行 `状态=已实现` 且属于上表 → 不许动；
该行是工作方式 → 可以动，但必须证明「非权威路径写不进权威账本」仍然成立。

## 4. 语义归一：授权是记号，审阅才是闸门

两处文案曾经互相矛盾（`CreatePlan` 结果说「不要开工」，运行态卡说「不需要任何人先按什么」）。
归一决定如下，**行为不变，文案与推理统一**（已落地：CreatePlan 结果、运行态卡、提示词
三处说同一句话）：

1. **闸门是原生审阅卡本身**：`CreatePlan` 一定弹，这是唯一的人门。批准 → `confirmed_by='user'`。
2. **授权记号是归属，不是执行许可**：未授权不阻止 `AdvancePlan`；第一次推进按事实补写
   `confirmed_by='progress'`（行为即授权）。
3. **未授权的真实后果只有一个**：自动续跑 `hold`——系统不会自己往下跑，但人不反对时可以
   显式推进。于是三处文案（`CreatePlan` 结果、运行态卡、提示词）统一成同一句话：
   「未经人批准的计划，系统不会自动续跑；你显式推进时，第一次推进会记下归属。」
4. `planIsAuthorized` 的两个分支（记号 / 已推进过）正是这个语义的折叠表达，保持不变。

## 5. 缺口的归宿（每条缺口只有三种结局）

- **落为机制**：`autonomy.override` 死路径（阶段 4/5 决定删或留，留则写明只读旧日志——已决定留）。
  （已落地：假设数量下限——preset 立 2，内核门 + 提示词纪律，见行 ②；权威边界测试；
  `/` 菜单五个命令与非权威能力 todo/subagent/workflow/ralph 挂回——见阶段 4/5 台账。）
- **作为概念注销**：「探索区」这个**被命名的模式**。它的负半是 `non-authoritative-isolation`
  那一行（已实现，边界套件钉住）；正半——「探索期的产出必须有据可查」——是
  `ledger-exploration-snapshots` 那一行（回合边界的工作区快照）。给一块区域起名字，只是给同一件事
  添第二个称呼，不是机制。
- **保持 design-only 并如实标注**：通用 L4 门。判据：真值表里各有一行、`status` 与
  `destination` 都正确、任何文档不冒称已实现。现在**每一条非 implemented 的行都带归宿**
  （变成机制 / 保持设计目标 / 已删除并记账），「还没做」与「决定不做」不再写成同一个样子。
- **变成机制**：`retracted` 产生者（真值表行 `fact-retraction`）、观测来源收窄
  （`observation-provenance`）、验证生命周期里**缺的那两条保证**（`verification-lifecycle`）、
  以及探索区（`exploration-zone`）。
- **删除并记账**：已删机制（`set_autonomy`、6/512 预算、`autoConfirmed`）在真值表里各有
  一行 `status=removed`、`destination=deleted`，另在 CHANGELOG 留痕；代码与注释不再叙述。

## 6. 端到端时序（规范序列）

一张完整回合的顺序（细节见 [时序图](timing-diagrams.zh-CN.md) 的五张图，此处是它们的串联）：

```text
人: 立目标
模型→内核: 澄清(槽位措辞) → SetGoal → 登记假设 → CreatePlan(判据校验)
内核→宿主→人: 原生审阅卡(永远弹;批准 → confirmed_by='user')
人: 批准 / 改意见 / 撤下
内核→宿主: 布防续跑令牌(goals 服务)
模型: 执行步骤 → 产物落盘工作区
内核: 观测准入 → needs_audit? → 经宿主派独立评估者(只读工具面+outputSchema)
评估者: 评估卡落盘(支持/推翻/无法判定)
内核: 驳回? → 计数+1 → ≥阈值则 blocked 等人
内核: 证据齐 → 事实升格 → 结案评估 → 收兵/补防(变更进事实账本,投影折出状态)
内核→宿主: turnDemand: 门开→hold;门关→宿主开下一轮(≤128)
人(任意时刻): 人门动词 / ask_user_question 答复 / 原生审批 / `/` 命令
```

## 7. 验证映射与缺失的测试

| 已有测试 | 钉住的拍 |
|---|---|
| `test/kernel.test.mjs` | ①③④⑤⑥⑦⑧⑨⑩⑪⑫⑬ F1–F4 B1 |
| `test/host.test.mjs` | ④⑫ F4（部署形态） |
| `test/ontology.test.mjs` | 本体声明 ↔ 实现 |
| `test/client.test.mjs` | 投影、运行态卡 |
| `test/truth-table.test.mjs` + `tools/verify-truth-table.mjs` | 机制清单、计数、孤儿副本 |
| `test/state-machine.test.mjs` | 状态转移 ↔ 折法 |
| `test/docs-consistency.test.mjs` | 历史说法不冒充现状 |

| 已补齐的测试 | 要钉住的拍 |
|---|---|
| `test/authority-boundary.test.mjs` | B2a：非权威路径结构上写不出 `clearai` 变更 |
| `test/preset-composition.test.mjs` | B2b/B2c：菜单与模型切换挂载形态 |
| `test/prompt-sections.test.mjs` | 段落分类（hard/native/advisory）不漂移 |
| 假设数量下限用例（在 `test/kernel.test.mjs` 里） | ②：下限是机制，不是文案 |
