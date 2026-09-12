# Workflow 3: 稳态识别与异常段剔除 (Steady-State Identification)

## 目标
在连续观测/长期实验中，很多项目把“稳态”用于表达**系统处于正常有效观测（In-observation）**：即已过启停/校准/维护等异常状态、输入通量达到一定水平后进入可代表的运行区间。
本 workflow 的目标是：
- 先固化“有效观测/非启停校准”的可复现判据（以输入通量/负荷阈值为核心）
- 在对齐母表上筛出“有效（稳态口径）”时间点集合（并检查连续性与通道齐全性）
- 产出可审计的剔除段落、稳态表格与规则文件

> **强制输入**：本 workflow 的唯一数据输入是 `products/extracted/mother_table_aligned.csv`（来自 `workflows/01-data-source-inventory-and-lineage.md`）。禁止直接使用上游原始导出表。

## 步骤

### Step 0: 输出数据状况报告（稳态前强制）
在写任何稳态判据前，必须先回答“这份母表数据是否适合找稳态？”并输出可审计报告（类似数据集的概览页）。

**必须统计的最小项**：
- **时间范围**：最小/最大时间、总点数、覆盖天数/小时数
- **时间间隔**：相邻时间差分布（P50/P90/P95/Max）、是否存在固定采样周期、是否存在大间隔断点
- **重复时间点**：重复行数与占比、去重策略（在 `products/extracted/merge_contract.md` 对应）
- **连续时间段**：按连续性定义（例如相邻间隔 ≤ 30min）切分段，输出段数、最长/最短/平均段长、TopN 段列表
- **关键通道齐全性（仅针对稳态判据所需通道集合）**：非空率、最大连续缺失时长、缺失最严重的 TopN 通道

**强制产出**：
- `products/extracted/data_status_report.md`（上述摘要 + 关键表格）
- `products/extracted/time_gap_summary.csv`（时间差分布统计）
- `products/extracted/continuous_segments.csv`（连续段清单：start/end/duration/points）

> **Rule**：如果数据状况报告显示“采样间隔高度不稳定/大段缺失/关键通道长期缺失”，必须先回到 `workflows/01-data-source-inventory-and-lineage.md` / `workflows/02-data-alignment-and-tag-semantics.md` 修正母表对齐或通道语义，再进入稳态判定。

### Step 1: 定义“稳态=有效观测”的工程判据（In-observation Contract）
本 Skill 默认把“稳态”定义为：**系统处于有效观测状态（非启停/非校准维护/非明显失真）**，核心判据是**输入通量/负荷高于阈值**（或等价的“实验/采集正常进行”指标）。

> **说明（保持通用性）**：
> - 在许多连续观测场景中，“波动小/方差小”更像是“高质量稳态/深稳态”的精细筛选，并非“是否有效观测”的必要条件。
> - 本 workflow 的强制交付以“有效稳态（In-observation）”为主；如项目确实需要“深稳态（波动小）”，请把它作为可选的二级筛选（见 Step 3 的可选项）。

本步骤必须先输出“稳态识别依据”（让用户确认后再跑后续识别与拆解），避免“规则一边跑一边改”导致结果不可复现。

**强制产出（先产出，先确认）**：
- `products/extracted/steady_state_basis.md`：稳态识别依据（判据口径、关键通道集合、窗口/连续性/NaN 策略、阈值选型依据、与边界契约的一致性说明）
- `products/extracted/steady_state_rules.yaml`：基于 `templates/steady_state_rules.yaml.tpl` 的规则草案（阈值需结合数据分布校准）

`products/extracted/steady_state_basis.md` 至少应包含：
- **输入母表**：`products/extracted/mother_table_aligned.csv`（时间范围、采样间隔特征，引用 `products/extracted/data_status_report.md` 的结论）
- **有效判据口径**：负荷/输入通量口径 \(L\)（来自 `workflow02` 的语义/role）与阈值 \(L_{min}\) 的选型依据
- **状态切换过渡段处理**：过渡剔除窗口半径（±X 分钟），以及为何需要（避免刚启动/刚停止的瞬态）
- **窗口与连续性定义**：连续段切分规则（continuous_gap）、短段处理规则
- **缺失值策略**：NaN 视为异常/跳过/插值（必须选一种并解释原因）
- **阈值选型依据**：基于分布（Pxx/直方图/实验设计的最小工作点）或领域经验；写明默认值与待校准项
- **验证计划**：抽检策略（保留段/剔除段各抽多少、看哪些关键曲线）

### Step 1.5: 用户确认闸门（必须通过，才能继续）
在执行 Step 2~Step 6（生成 mask/segments/table 等）之前，必须让用户确认：
- `products/extracted/steady_state_basis.md` 已完整填写，且所有口径/阈值/窗口/缺失值策略可复现
- `products/extracted/steady_state_rules.yaml` 与 basis 一致

确认方式（二选一，必须有记录）：
1. 在 `products/extracted/steady_state_basis.md` 末尾追加“确认记录”（日期/确认人/结论/是否允许继续）
2. 在统一 plan 的确认区记录本步骤已确认（并引用 `products/extracted/steady_state_basis.md` 路径）

### Step 2: 有效观测标记（In-observation Mask）
用“黄金指标”生成有效标记（mask），推荐优先级：
- **首选**：输入通量/负荷（系统净输入） \(L > L_{min}\)
- **备选（辅助证据）**：关键资源消耗 \(Q > Q_{min}\)（如功率/流速）、工作条件已建立（温度/压力/真空进入运行区间）等

> **关键点**：本步骤生成的是“有效稳态口径”的主判据（不是可选项）。后续所有稳态表格均基于该 mask 及过渡窗口剔除。

### Step 3: 状态切换过渡段窗口剔除（Transition Window Exclusion）
对有效标记的“进入/退出边界”（on/off transition），按系统惯性剔除过渡段，推荐：
- 过渡窗口半径：±30min 或 ±60min（取决于系统响应/热惯性时间尺度）
- 规则：在“on→off”或“off→on”的切换点附近，窗口内时间点不计入稳态样本

必须写清楚：
- **过渡窗口大小**与依据（例如升温平衡/建立真空/换批切换的时间尺度）
- **NaN 的处理**：NaN 视为 off / abnormal / skip（必须选一种并解释原因）
- **连续性定义**：相邻时间间隔 ≤ 30min 视为连续

> **可选（仅当业务需要“深稳态”）**：在完成“有效 + 过渡剔除”后，可再叠加二级筛选（例如关键状态变量 CV/变化率阈值）。若启用，必须在 `products/extracted/steady_state_basis.md` 中明确声明其目的（例如用于建模而非用于覆盖统计）。

### Step 4: 连续性与齐全性检查（必须）
对“被判定为稳态”的时间点集合，必须再做两类工程约束检查：
1. **时间段连续性**：将稳态时间点按“相邻时间间隔 ≤ continuous_gap”切分为连续段（segment）。
   - 短段（例如 < 1h 或 < N 点）通常代表瞬态残留/通讯断点，应按业务规则处理（剔除或单独标注）。
2. **通道齐全性（针对用于稳态判据的通道）**：对每个连续段，检查稳态判据所需通道的非空率。
   - 若某段内关键通道缺失严重（例如非空率 < 95% 或连续缺失超过阈值），该段不能作为稳态分析样本。

> **注意**：齐全性检查只针对“稳态判据所需通道集合”，不要把全通道缺失率当作稳态门槛（否则会误删大量可用信息）。
> 这里检查的是 **数据缺失（值缺失/NaN）**，不是 **列缺失（Schema 缺失）**；列缺失必须回到 `workflows/02-data-alignment-and-tag-semantics.md` 解决。

### Step 5: 产出稳态表格 + 说明文档（强制）
必须输出：
- **稳态掩码**：时间点 → 是否稳态、所属连续段 ID、剔除原因（如有）
- **稳态段表**：每段起止、时长、样本数、关键通道齐全性、是否通过
- **稳态数据表**：从 `products/extracted/mother_table_aligned.csv` 过滤得到的“稳态母表”

### Step 6: 人工抽检闭环（建议）
抽检建议：
- 每条规则随机抽 5 段（剔除段与保留段各抽），对照关键曲线确认合理性，并记录证据

## 产出物
- `products/extracted/data_status_report.md`（稳态前数据状况报告：时间范围/间隔/连续段/关键通道齐全性）
- `products/extracted/time_gap_summary.csv`（时间差分布统计）
- `products/extracted/continuous_segments.csv`（连续段清单：start/end/duration/points）
- `products/extracted/steady_state_basis.md`（稳态识别依据 + 用户确认记录）
- `products/extracted/steady_state_rules.yaml`
- `products/extracted/steady_state_mask.csv`（时间点 → 是否稳态 + segment_id + reason）
- `products/extracted/steady_state_segments.csv`（连续段统计 + 齐全性）
- `products/extracted/steady_state_table.csv`（稳态母表：从 mother_table_aligned 过滤得到）
- `products/extracted/steady_state_summary.md`（稳态识别结果说明：样本覆盖、连续段分布、剔除原因 TopN）
- `products/extracted/steady_state_validation.md`（抽检记录与结论）

## 闸门（确认后进入下一 Workflow）
在进入 `workflows/04-consumption-analysis.md` 或 `workflows/05-best-in-class-and-optimization-space.md` 前，必须确认本 workflow 产出无误，并在 `products/extracted/steady_state_summary.md` 或 `products/extracted/steady_state_validation.md` 末尾追加“确认记录”（日期/确认人/结论/疑点与后续动作）。最少确认：
- **强制产出物是否齐全**：`products/extracted/data_status_report.md`、`products/extracted/time_gap_summary.csv`、`products/extracted/continuous_segments.csv`、`products/extracted/steady_state_basis.md`、`products/extracted/steady_state_rules.yaml`、`products/extracted/steady_state_mask.csv`、`products/extracted/steady_state_segments.csv`、`products/extracted/steady_state_table.csv`、`products/extracted/steady_state_summary.md` 是否都已生成且内容完整。
- `products/extracted/steady_state_basis.md` 是否包含“用户确认记录”，且确认发生在生成 `steady_state_mask/segments/table` 之前（可追溯）。
- 稳态规则文件版本已固化（阈值/窗口/连续性/NaN 策略清晰），且与 `steady_state_mask/segments` 的输出一致。
- 稳态段连续性与关键通道齐全性检查已通过（或已明确剔除/标注未通过段）。
- 抽检记录存在：保留段与剔除段各有证据，能解释为何进入/退出稳态。

## 示例（Example：异常段剔除的“窗口逻辑”）
在连续观测数据中，常用“关键指标阈值 + ±30min 窗口”做预剔除，其关键特征是：
- **异常条件（OR）**：某些关键通量低于阈值，或关键列存在 NaN
- **窗口规则**：对每个时间点检查 ±30min，若窗口内全异常则剔除；若窗口内存在至少 1 个正常点则保留

该类规则适合作为“预剔除/质量门槛”，再叠加稳态判据进入代价/效率分析。
