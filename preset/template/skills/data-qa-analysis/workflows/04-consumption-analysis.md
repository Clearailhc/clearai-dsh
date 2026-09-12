# Workflow 4: 代价/效率与波动分析 (Cost & Variability Analysis)

## 目标
在稳态数据集上，完成两类任务（同一 workflow 内交付，但必须分别写清楚方法与结论）：
1. **代价/单位代价（Cost & Specific Cost）**：按系统与子系统分别给出资源消耗水平、单位代价分布、负荷影响与长周期基线外推。资源可以是能耗、机时、试剂用量、算力时长、采样成本等。
2. **波动（Variability）**：不仅是单位代价波动，也包括系统状态指标（温度/压力/信号强度等）与控制/干预动作（设定值/控制输出）的波动；并要求按观测单元逐一输出诊断与下一步核对建议（不是只列高波动通道）。

> **强制输入**：本 workflow 的唯一数据输入是 `products/extracted/steady_state_table.csv`（来自 `workflows/03-steady-state-identification.md`）。
> 禁止直接使用 `products/extracted/mother_table_aligned.csv` 或上游原始导出表进行代价/单位代价/波动统计（否则会混入无效/过渡段）。

> **强制依赖（口径与清单）**：
> - `workflows/02-data-alignment-and-tag-semantics.md` 的 `products/extracted/tag_map.csv` / `products/extracted/entity_map_enriched.json`（用于负荷口径、代价口径、系统状态指标的 tag 选择与校验）
> - 上游结构 skill 的 `products/extracted/unit_inventory.md`（用于识别资源接口与“哪些单元应计入某类资源消耗”）

## 步骤

> **取证要求**：本 workflow 所有数值须先通过 read/bash 从 `products/extracted/steady_state_table.csv` 等源数据取得，并标注 `来源: <path>`；无法取得则写「待确认」。

### Part A：代价 / 单位代价（Cost & Specific Cost）

### Step 1: 识别“最大代价口径”（Primary Cost Driver）并做覆盖完整性检查
不同场景的最大代价资源可能不同：
- 运行资源：电力/冷却水/压缩气体/机时
- 消耗品：关键试剂、溶剂、标准品、耗材
- 其他：算力时长、存储、人工采样工时等

你需要选定“最大代价资源”并明确其 **测量口径**（可追溯）：
- 消耗量 \(Q\)：kW、mL/h、样本/h、GPU·h/d 等
- 负荷 \(L\)：样本/h、m³/h、次/h、mol/h（通常优先选**输入通量/系统净输入**）
- 单位代价 \(SSC\)：\(Q/L\)

**额外强制（用于分规格资源）**：必须显式声明资源“类型 + 规格/等级”，例如：
- `power@kW` / `coolant@m3h` / `reagent@gradeA` / `compute@GPUh`

并必须做一次 **消耗方覆盖完整性检查**（确保没有遗漏“使用该资源/规格的单元”）：
1) 从上游 `products/extracted/unit_inventory.md` 的 `energy_interfaces`（资源接口）与/或 `products/extracted/entity_map_enriched.json` 的 resource edges，列出“理论上应计入该资源规格消耗”的单元清单（expected_consumers）。
2) 从 `products/extracted/tag_map.csv` 列出“实际已计量且将纳入 Q 汇总”的单元清单（metered_consumers）。
3) 输出缺口：expected_consumers - metered_consumers，并分类：
   - `ObjectNotConfirmed`（单元未确认存在）
   - `Unmetered`（单元确认存在但找不到任何测量 tag）
   - `TagMissingInMotherTable`（tag 有但母表列缺失）

> 覆盖检查结果必须写入 `products/extracted/subsystem_registry.md`（见 Step 2）。

### Step 2: 子系统登记（Subsystem Registry，强制）
当系统存在多路输入、并且可以合理拆成多个子系统时，必须先落地“子系统登记表”，作为后续单位代价/外推/波动分析的唯一口径约束。

强制产出：`products/extracted/subsystem_registry.md`（建议使用模板：`templates/subsystem_registry.md.tpl`）。

**拆分原则（强制，保持通用性）**：
- 如果多路输入进入**不同的直接接收单元/不同入口位置**（例如分别进入不同处理单元/不同实验线路），则默认应拆分为不同子系统（每路输入对应一个子系统），分别建立负荷口径与代价口径。
  - “直接接收单元/入口位置”优先以**上游结构 skill**的“输入去向映射表”（Feed → DirectReceivingUnit）与 `products/extracted/entity_map_enriched.json` 的边界输入边（Boundary_Feed_* → Unit）为证据。
- 只有在能提供明确证据证明“这些输入在上游很快汇合、共享同一套主要资源/主要单元链路、且合并不会导致口径缺路或重复计入”时，才允许合并为单一子系统。
- 若存在共享计量表/共享设备，必须在登记表中明确分摊或不分摊规则与风险（禁止默认忽略）。

`products/extracted/subsystem_registry.md` 至少包含：
- **子系统列表**：子系统 id/name、输入/负荷 tags、包含的 unit 清单。
- **负荷定义**：子系统负荷公式（单路/多路求和/模式拆分），以及“为何这样拆分”的判定依据（互斥/并行、系统边界等）。
- **代价口径定义**：本 workflow 选定的代价资源（含规格/等级），以及子系统内“应计入的消耗方单元清单”。
- **覆盖完整性检查**：expected vs metered 的差集与处理策略（补测/代理/风险）。
- **共享项处理**：共享计量表/共享设备/共享测量通道如何分摊（或不分摊并标注风险）。

> **规则**：后续 Step 3~Step 6 的所有统计必须以 `products/extracted/subsystem_registry.md` 为准，禁止“临时改变子系统边界”。

### Step 3: 子系统负荷口径（Load Contract）与系统总计规则（强制）
基于 `products/extracted/subsystem_registry.md`，固化：
- 每个子系统的负荷 \(L_s(t)\) 与消耗 \(Q_s(t)\)
- 系统总计：
  - `L_total = sum(L_s)`（若子系统互斥，需避免重复计入）
  - `Q_total = sum(Q_s)`（共享项按登记表分摊/不分摊规则执行）

> 强制写入：在 `products/extracted/consumption_summary.md` 中必须明确写出子系统口径、系统总计规则与任何分摊假设。

### Step 4: 单位代价分布与去极值（Trimming，按子系统分别输出）
对每个子系统 \(s\)，在稳态数据上输出：
- SSC 分布（均值/中位数/P10/P20/P80/P90）
- trim 规则（P1-P99 / P5-P95）与 trim 前后对比

### Step 5: 负荷-单位代价关系（Load vs SSC，按子系统分别输出）
对每个子系统 \(s\)：
- 分负荷段（binning）比较 SSC 分布
- 输出：每个 bin 的样本数、平均负荷、SSC 的 P20/P50/P80

### Step 6: 用历史负荷分布外推长周期负荷分布与消耗基线（按子系统）
基于历史稳态负荷分布推测长周期（如全年/全实验周期）的负荷分布与消耗基线，用于管理口径与后续改进空间测算输入。

**输入锚点（强制）**：基准期运行小时 `reference_hours`（例如 8000 h/周期）。

**方法（推荐）**：对每个子系统 \(s\)：
1) 统计每个 bin 的历史小时占比 `share_hist_bin`。
2) 外推基准期小时：`hours_ref_bin = reference_hours * share_hist_bin`。
3) 外推基准期消耗基线：`Q_ref = sum(Q_mean_bin * hours_ref_bin)`。

**强制产出**：`products/extracted/load_distribution.csv`（必须包含 `subsystem_id` 字段；至少包含：subsystem_id、bin、hours_hist、share_hist、reference_hours、hours_ref、L_mean、Q_mean、SSC_mean）。

> **风险声明（强制）**：若历史数据覆盖不足以代表整个基准期（季节性/维护停机/条件切换/换批期等），必须在 `products/extracted/consumption_summary.md` 写出风险与可能修正方案。

### Part B：波动（Variability）

### Step 7: SSC/Q/L 的波动（系统 + 子系统）
在系统总计与每个子系统上输出：
- SSC、Q、L 的波动强度（CV / IQR / MAD / P90-P10 等）
- 负荷扰动强度（例如 dL/dt 的分布、扰动方向一致性线索）

### Step 8: 按观测单元逐一做波动诊断（必选结构）
本 workflow 要求 **分别对每个关键观测单元（unit）** 做波动诊断，而不是只列 TopN 通道。

写入 `products/extracted/variability_summary.md` 的强制结构（建议一单元一节，且每节至少包含下列字段）：
- **Unit 基本信息**：unit_id、所属子系统（来自 `products/extracted/subsystem_registry.md`）
- **关键状态指标（PV）**：温度/压力/信号强度/液位等（来自 `workflow02` 语义）
- **关键控制/干预动作（MV/CO）**：设定值/控制输出/干预记录等
- **波动强度摘要**：PV/MV 的 CV/稳健指标
- **波动形态**：趋势/周期/突变/与负荷关系（至少写一种可复核的描述）
- **对结论的影响假设**：该波动可能如何影响 SSC/Q/产出量/测量偏差（允许假设，但必须可验证）
- **解释/假设**：扰动来源/控制策略/设备或环境约束（允许多条假设，但必须可验证）
- **证据与下一步核对**：需要对照的曲线/需要补齐的 tag/需要核对的工况或事件（必须给出下一步动作）

> **防错**：对均值接近 0 的变量直接计算 CV 会失真，应使用稳健指标或设置最小均值门槛。

### Step 9: 波动与单位代价的对应分析（必选）
必须至少完成一次“单位代价异常段 ↔ 单元波动特征”的对应分析：
- 在同负荷 bin 内，挑选 SSC 高/低的样本段
- 对照各 unit 的 PV/MV 波动特征，形成可核对的解释线索（不强制因果，但必须可复核）

### Step 10: 图表与可视化交付（必选）
以下图表必须产出（可嵌入 Markdown 或单独成图并在索引中引用）：
- 子系统级：负荷-单位代价散点（含 trim 前后对比）、负荷分段箱线图/分位数图、历史负荷分布 + 长周期外推
- 单元级：每个子系统 TopN 高波动 unit 的 PV/MV 时序或分布图

强制产出：`products/extracted/workflow06_figures.md`（图表索引：图表清单 + 口径 + 文件路径；PNG 落 `lab/diagrams/`）。

### Step 11: 形成“解释性结论”（不写方法，只写原因）
将发现落成结论句式（示例）：
- “单位代价改善/变差是否主要由负荷变化驱动？”
- “同负荷差异是否与某子系统/某单元的波动相关？”
- “哪些单元/回路是系统波动的主要贡献者？对应的可验证假设是什么？”

## 产出物
- `products/extracted/subsystem_registry.md`：子系统登记（边界、负荷口径、代价资源规格、覆盖检查与分摊规则）
- `products/extracted/consumption_summary.md`：代价与单位代价摘要（按子系统 + 系统总计；含外推假设与风险）
- `products/extracted/load_distribution.csv`：历史负荷分布与长周期外推（按子系统）
- `products/extracted/variability_summary.md`：波动指标与诊断（系统 + 子系统 + 按 unit 逐一诊断）
- `products/extracted/workflow06_figures.md`：图表索引（必选图表清单 + 口径 + 文件路径/嵌入位置）

## 闸门（确认后进入下一 Workflow）
在进入 `workflows/05-best-in-class-and-optimization-space.md` 前，必须确认本 workflow 产出无误，并在 `products/extracted/consumption_summary.md` 末尾追加“确认记录”（日期/确认人/结论/疑点与后续动作）。最少确认：
- **强制产出物是否齐全**：`products/extracted/subsystem_registry.md`、`products/extracted/consumption_summary.md`、`products/extracted/load_distribution.csv`、`products/extracted/variability_summary.md`、`products/extracted/workflow06_figures.md` 是否都已生成且内容完整。
- Step 1 的“资源规格 + 消耗方覆盖完整性检查”已完成，且覆盖检查结论写入 `products/extracted/subsystem_registry.md`（无遗漏或已明确缺口与风险）。
- 子系统边界、负荷口径、共享项分摊规则已固化（`products/extracted/subsystem_registry.md`），且与 `products/extracted/consumption_summary.md` 一致。
- 基准期运行小时（reference_hours）与外推口径已显式声明，且 `products/extracted/load_distribution.csv` 可复现。
- 波动分析已覆盖：SSC/Q/L（系统+子系统）+ 系统状态 PV + 控制/干预动作 MV/CO，并且 `products/extracted/variability_summary.md` 含“按 unit 逐一诊断”的必选结构。
- 必选图表已产出，且 `products/extracted/workflow06_figures.md` 可追溯口径与文件落点。
