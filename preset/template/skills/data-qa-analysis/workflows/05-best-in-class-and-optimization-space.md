# Workflow 5: Best-in-Class 与改进空间 (BiC/P20 & Improvement Space)

## 目标
把“历史上最好能做到多好”变成可落地的标杆，并量化改进空间（能耗/机时/试剂/样本代价等）与长周期收益（物理量优先，成本换算可选）。

> **强制输入**：本 workflow 的唯一数据输入是 `products/extracted/steady_state_table.csv`（来自 `workflows/03-steady-state-identification.md`）。
> 标杆、P20、外推收益必须基于稳态数据计算，并在报告中引用稳态文件与稳态规则版本。

## 核心原则
1. **强耦合系统优先系统级 BiC**：先在系统 KPI 上定义 P20（分负荷段），再归因到单元。
2. **避免比值平均陷阱**：
   - *Bad*: 用 `avg(单位代价差) * avg(负荷)` 估算节省
   - *Good*: 在每个负荷段先求“绝对消耗差”（或逐时差），再按负荷段权重累计
3. **负荷分段要足够细**：bin 太宽会导致“同 bin 内最优点负荷更高/更低”引入偏差。
4. **并行冗余单元先合并再分析**：如两路并行的加热/冷却回路 A/B 应合并为一个对象（消耗相加）再参与单位代价与节省计算。

## 步骤

> **取证要求**：本 workflow 所有数值（P20、单位代价、外推收益等）须先通过 read/bash 从 `products/extracted/steady_state_table.csv` 计算取得，并标注 `来源: <path>`；无法取得则写「待确认」。

### Step 1: 定义系统 KPI 与负荷段（Load Binning）
1. 定义系统负荷（输入通量/产出量）与系统消耗（能耗/机时等）
2. 将负荷按区间划分（bin 宽度建议从小到大试：如 3、5、10 单位）
3. 在每个负荷段内计算系统单位代价分布，并取 **P20** 作为 BiC（Best-in-Class）

输出：`products/extracted/bic_thresholds.csv`

### Step 2: 系统级 P20 时刻集合（System-BiC Hours）
构造集合：
- `System_BiC = { t | 系统单位代价(t) <= P20(负荷段(t)) }`

该集合表示“系统整体处于历史最优前 20%”的时间点，后续归因应在此集合内进行。

### Step 3: 单元归因（Attribution）
在 `System_BiC` 集合内，对每个观测单元计算：
- 其资源消耗/单位代价的“可达水平”（在系统最优时段中的均值/分位数）
- 与全稳态均值的差异（改进空间）

> **注意**：不要把各单元各自的 P20 直接相加当作系统潜力；这会产生“拼不出来的最优”。

### Step 4: 改进空间计算（推荐用绝对差）
对每个负荷段 \(b\)：
- \(\\Delta Q_b = \\overline{Q}_{all,b} - \\overline{Q}_{bic,b}\\)
- 长周期节省（物理量）：\(Saving = \\sum_b (\\Delta Q_b \\times Hours_{ref} \\times Weight_b)\\)

其中 `Weight_b` 可以用“该负荷段的出现比例（小时占比）”或“负荷加权占比”（按业务口径选择，但必须写清楚）；`Hours_ref` 为基准期运行小时（reference_hours）。

### Step 5: 成本换算（可选）
若项目关心成本口径，给定：
- 基准期运行小时：如 8000 h/周期
- 单位成本：如 电价/试剂单价/机时费率等

则：
- `CostSaving = Saving * UnitCost`

若无成本口径需求，改进空间以物理量交付即可（并注明口径）。

输出：`products/extracted/improvement_space_summary.md`

### Step 6: 输出“百分比改进速查表”（管理/汇报友好，可选）
生成 0%~10%（1% 步长）的改进量速查表，便于在不同改进难度假设下快速换算收益。

## 产出物
- `products/extracted/bic_thresholds.csv`：系统 P20（按负荷段）
- `products/extracted/optimization_space_by_unit.csv`：各单元改进空间（物理量，成本换算可选）
- `products/extracted/improvement_space_summary.md`：系统与分单元的改进空间与长周期收益（含假设）

## 闸门（确认后结束或进入报告撰写）
在对外提交结论前，必须确认本 workflow 产出无误，并在 `products/extracted/improvement_space_summary.md` 末尾追加“确认记录”（日期/确认人/结论/疑点与后续动作）。最少确认：
- **强制产出物是否齐全**：`products/extracted/bic_thresholds.csv`、`products/extracted/optimization_space_by_unit.csv`、`products/extracted/improvement_space_summary.md` 是否都已生成且内容完整。
- BiC/P20 的计算基于稳态数据，且若系统强耦合，已按系统级 P20 先选最优时刻集合再归因。
- 外推采用“绝对量差/逐负荷段累计”或逐时累计，未使用会引入偏差的 `avg(A/B)*avg(B)` 近似。
- 单位成本（如启用）、基准期运行小时、权重口径等假设已显式声明，且与边界契约一致。

## 示例（Example）
可在项目报告中保留一段“口径固化示例”，但不要依赖任何固定文件名/路径。建议写法：
- 系统级 P20：按负荷段输出（表格或 CSV）
- 外推假设：基准期运行小时 + 单位成本（可选） + 权重口径
