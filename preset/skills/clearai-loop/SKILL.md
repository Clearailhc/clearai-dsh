---
name: clearai-loop
description: Use when working inside the ClearAI preset and you need the loop's contract rather than its prompt — how a claim becomes a fact (hypothesis → verification → observation → evaluation → evidence → fact), which tool is the only completion verb, what observation admission does and does not decide, who may write a verdict at each level (L0–L4), what "doer does not judge themselves" costs you, and what happens when a step fails admission. Load it before planning multi-step work, before declaring anything finished, or when a step keeps getting blocked.
---

# ClearAI 循环契约

这份技能是**机制的手册**,不是劝告。它描述的每条规则都已经在 `clearai-kernel` 里强制执行:你读它,是为了知道系统会替你做什么、以及你能做什么。

## 术语与状态

九个对象是:目标 → 计划 → 命题 → 验证 → 观测 → 评估 → 证据 → 事实 → 世界线(等级 L0–L4 只决定**谁可以写裁决**与是否需要人放行)。状态不存,全部由台账现算;本技能描述的规则就是当前契约的全部。

## 知识模式的启动协议(不等用户提醒)

目标一立、命题一登记,系统就把**知识预检**送进运行态卡:当前主张文本命中的概念 / 谓词 / 可复用事实。按这个顺序走:

| 情况 | 动作 |
|---|---|
| 命中的词条能表达 | 直接用 id 引用,不重复登记 |
| 要写断言但谓词不存在 | `RegisterTerm` / `RegisterPredicate` 立最小一组(每个带依据) |
| 核心假设准备登记 | `SetGoal` 里连 `assertions` 一起写 |
| 预检摘要不够精确 | `QueryKnowledge` 按概念 / 谓词 / 主体精确取 |
| 只出现一次且不需要比较 | 保留 claim,不造词 |
| 单步、一次性、无复用 | 不建本体(普通任务连知识模式都不进) |

**别为了让门放行而编词**:词汇是约定,它将长期约束这个项目怎么写结论。确实不值得留下形态的结论,如实 `CloseGoal(outcome="abandoned")`。

## 一句话

**让模型负责智能判断,让系统负责事实边界。** 你负责理解材料、提出假设、选择路线、判断哪条证据更可信。系统负责什么算完成、状态是什么、一个事实能不能写进知识库、谁的裁决有效。

推论很硬:**凡是被存储的状态都是潜在的谎言**,所以状态不存,全部由台账现算。你不能声明进度、不能声明阶段、不能声明假设成立——你只能交付。

## 四拍与唯一的完成动词

| 拍 | 你做什么 | 系统做什么 |
|---|---|---|
| 计划 | `CreatePlan`:每步写 `do`、`artifacts`(以何物为证)、`done_criteria`(判定标准) | 强制判据非空、自指检测、≤25 步、步骤 id 唯一 |
| 执行 | 用文件、bash、公网做实际工作;产物落盘 | 只读并行 / 写入串行;沙箱;每次写入进账 |
| 观察 | 拿到结果 | 登记观测(只追加) |
| 反思 | `AdvancePlan` 交付 | 观测准入 → 裁决 → 写证据 → 推进 |

`AdvancePlan` 是**唯一**能推进循环的动词。另外三个动词明确不动进度,并在返回值里告诉你 `progress_changed: false`:

- `AmendPlan` —— 补一步(漏了活)。
- `RefinePlan` —— 改判定标准(不改进度;旧判据留痕)。
- `VoidPlanStep` —— 带因作废(作废留痕光明正大;为凑完成而造证是大忌)。

## 观测准入:它只回答「收不收」

交付时系统按这个次序检查（以当前 ClearAI DSH 内核的准入契约为准）：

1. 声明的产物**存在**吗?不存在 → 硬拦 `l1`,并告诉你三条合法出路(做出来 / 改声明 / 带因作废)。
2. 存在但是**空**吗?空目录、零字节文件 → 同样硬拦:空文件不是观测。
3. **结构合法**吗?`.json` 必须能解析;`.md` 去掉标题行后实质文本不足 20 字符算「仅有标题」。其他扩展名不做结构判定(不误伤)。
4. 一个坐标都没声明 → `no_anchor` 硬拦:不改变世界的步骤没有可验收的东西。
5. 坐标齐备且判据非空 → **不是放行,是送评**(`needs_audit`)。

准入**不判**判据里的任何断言:数值、口径、一致性都不看。坐标齐备只是必要条件——`touch` 一个文件也能让坐标齐备,所以齐备绝不等于这一步做完了。判据里的断言由评估者逐条核对。

连续 3 次未过闸,计划会被置为 `blocked` 并停下等人。别硬试第四次:改产物、改判据,或者把这一步作废。

## 谁可以写裁决

| 等级 | 定义 | 谁判 |
|---|---|---|
| L0 | 只靠推理的快速合理性检查 | 你自己(`verdict` + `basis`,依据必须可复查) |
| L1 | 已有知识:文献、数据库是否已回答 | 你自己 |
| L2 | 已有数据或小规模计算 | 你自己 |
| L3 | 新产生的、可重复的证据 | **独立评估者**(系统派,fresh context,只读产物) |
| L4 | 新产生的、不可重复或来自外部的证据 | **独立评估者**,并且没有人放行不能开始;做的人自己写的文件不算观测 |

在 L3 以上交付时带上 `verdict` 会被直接拒绝(`verdict_not_accepted`):做的人不判自己。这不是建议——去掉 `verdict` 重新交付,系统会派评估者,你拿回的是评估卡上的裁决。

评估者只核对、不发挥、不执行,产出结构化评估卡;卡由系统落盘(写不进卡时裁决降级 `unknown`,这一步就不推进,绝不静默放行)。你也不能写 `clear/evidence`、`clear/knowledge/facts`、`clear/goals` 里的任何文件——那些是系统所有的面。

## 目标:跨计划的一等对象

目标带着一份「怎样算回答了」的判据(`done_criteria`)和候选假设。每条假设必须有**推翻条件**:没有推翻条件的假设无法被检验。

- `SetGoal` 修订必须带 `reason`,版本 +1,旧值全部留痕;同一时间只开一个目标。
- 一张 Plan 只承载目标的一个阶段。`ClosePlan` 之后目标若未达成,继续 `CreatePlan` 开下一阶段,不用等人说「继续」。
- `CloseGoal(outcome="achieved")` 会**无条件**触发一次目标级独立评估:评估者逐条核对判据与转写忠实度,只有它说达成才结案;它说没达成,目标保持开放并把缺口回注给你。
- 达升格门槛且无推翻的假设,在结案时由系统升格为事实,写进 `clear/knowledge/facts/`。被推翻的假设留在台账里——一条被推翻的假设是有价值的资产。

## 证据的形态

- 假设的状态由证据**算**出来,不打分:支持到第几级、有几条推翻、有几次无法判定。你读到的是派生结果。
- `inconclusive` 是诚实的答案。一次如实推翻假设的步骤照样可以通过验收——不要为了让步骤通过而写 support。
- 重评产生**新证据**,旧证据不改、不删。
- 结算单记四列:意图(判据)/ 事实(坐标)/ 评估者 / 差额(依据或缺口)。
