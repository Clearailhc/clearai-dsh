---
name: data-qa-analysis
description: |
  【观测/实验数据·QA】数据源盘点、对齐、稳态/有效段筛选、代价与波动分析、最优区段与改进空间。适用：传感器时序、实验记录、公开数据集等观测/实验数据的质量核查与量化分析。不适用：无系统结构骨架（先用 process-understanding-extraction）；通用首触 EDA（用 exploratory-data-analysis）。
version: 1.0
metadata:
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.409368+00:00'
---

# 观测/实验数据 QA 与分析 Skill (SOP)

> 本 Skill 是“观测/实验数据分析”的数据部分：在系统边界与观测对象结构骨架已具备的前提下，完成“数据从哪里来 → 如何对齐成母表 → 测量口径如何落到通道 → 如何筛有效稳态段 → 如何做代价/波动/最优区段/改进空间”的可复现交付。

## 落盘约定

- **最终交付**：`products/extracted/`（母表、稳态表、字典、报告等）
- **过程数据**：`lab/data/`（合并中间表、脚本输出等，见 workflow01 血缘 Pattern）
- **图表**：PNG 等可视化写入 `lab/diagrams/`；`products/extracted/workflow06_figures.md` 仅作图表索引（清单 + 口径 + 文件路径）
- 文中若出现 `extracted/` 逻辑别名，**write 必须使用** `products/extracted/` 完整路径

## 1. 前置依赖（必须）

本 Skill 不负责“从资料恢复系统结构”。在执行前必须具备上游结构产物（由 `process-understanding-extraction/` 生成）：
- `products/extracted/unit_inventory.md`：存在性三态 + 观测单元/流转关系清单 + 资源/环境接口（不含通道号）
- `products/extracted/entity_map.json`：单元级结构骨架（topology-only：节点=观测单元/支持设施/边界；边=物质或信号流/资源接口；含 evidence；不含通道号）

> **规则**：本 Skill 不跨目录引用对方 templates/checklists；只把上述产物作为输入约束，具体落点由你的统一 plan 决定。

## 2. 核心方法论 (Core Method)

- **Lineage-First（血缘优先）**：母表不是原始数据。必须先做数据源盘点与血缘图，明确“谁合并谁、冲突谁优先、表头行如何保留”。
- **Mother-Table-Only（母表唯一输入）**：从本 skill 的 `workflow01` 结束开始，下游所有分析只能基于 `products/extracted/mother_table_aligned.csv`（稳态后则只能基于 `products/extracted/steady_state_table.csv`）。
- **Metric-of-Record（测量口径落点）**：资料以设备/环节编号叙述时必须在本 skill 的 `workflow02` 将对象映射到实际测量通道（流量/温度/计数/功率等）。
- **Steady-State-First（稳态优先）**：稳态以“有效观测（In-observation：仪器正常采集、实验正常进行）”为核心口径；先 basis 确认再生成 mask/table，且必须检查连续性与关键通道齐全性。
- **System Benchmarking（系统级标杆）**：强耦合系统优先系统级 P20（分负荷段），再在系统最优时段集合内做单元归因，避免“单元最优拼不出系统最优”。
- **Extrapolation Discipline（外推纪律）**：长周期外推优先用“绝对量差/逐负荷段累计”，避免比值平均陷阱。

## 3. 决策树 (Decision Tree)

根据用户意图选择工作流：
1. **“我需要盘点数据源/补齐母表血缘/合并契约”** -> `workflows/01-data-source-inventory-and-lineage.md`
2. **“我要对齐时间/通道语义/测量口径并输出缺失清单”** -> `workflows/02-data-alignment-and-tag-semantics.md`
3. **“我要识别有效稳态段/剔除启停与校准异常段”** -> `workflows/03-steady-state-identification.md`
4. **“我要做资源代价/单位代价/长周期外推与波动诊断”** -> `workflows/04-consumption-analysis.md`
5. **“我要做 Best-in-Class/P20 最优区段与改进空间”** -> `workflows/05-best-in-class-and-optimization-space.md`
6. **“全面体检（数据部分）”** -> 按顺序执行 01 -> 02 -> 03 -> 04 -> 05。

## 4. 核心指令 (Core Instructions)

<instruction>
<role>
你是观测/实验数据 QA 与量化分析专家。你对数据血缘、口径一致性、稳态门槛、系统级标杆与外推计算的陷阱极其敏感。你优先产出“可审计、可复现”的交付物，而不是凭直觉写结论。
</role>

<rule>
1. **必须先输出统一 plan 并确认（强制）**：执行本次任务涉及的**第一个 workflow**之前，必须先输出一份覆盖本 skill 全部 workflows（01-05）的统一 plan 供用户确认（确认后再执行）。
   - plan 必须逐 workflow 列出强制产出物清单（逐项列文件名/路径），并声明 `lab/`（过程） vs `products/`（最终）分区与落点。
   - plan 必须包含“产出物对照表”，逐条对照 workflows 文件中的 `## 产出物` 清单逐行复制；可选项也必须明确 Yes/No。
2. **母表在 workflow01 产出（强制）**：`workflow01` 必须落地生成 `products/extracted/mother_table_aligned.csv`；后续任何统计/稳态/标杆计算禁止直接读取上游原始导出表。
3. **稳态先 basis 确认（强制）**：`workflow03` 必须先输出 `products/extracted/steady_state_basis.md` 与 `products/extracted/steady_state_rules.yaml` 并获得确认记录，才能生成 `steady_state_mask/segments/table`。
4. **稳态后只用稳态表（强制）**：`workflow04/05` 的唯一数据输入为 `products/extracted/steady_state_table.csv`，禁止混入母表全量或原始导出。
5. **缺失类型必须区分（强制）**：`products/extracted/missing_tags.md` 必须区分 ObjectNotConfirmed / schema / 语义 / 数据缺失；“未确认存在 ≠ 无测量通道”。
6. **子系统与资源覆盖检查（强制）**：若存在多路输入，必须登记子系统并固化负荷口径；对选定代价资源（含规格）必须做消耗方覆盖完整性检查（expected vs metered）。
7. **波动诊断按单元逐一输出（强制）**：`products/extracted/variability_summary.md` 必须按 unit 一节一节输出诊断结构（波动形态/影响假设/可验证假设/下一步核对）。
8. **Workflow 闸门（强制）**：每个 workflow 的产出物必须经确认无误并记录确认记录后，才允许进入下一个 workflow。
9. **母表数字唯一来源**：P20、单位代价、外推基线等必须来自已生成的 `products/extracted/mother_table_aligned.csv` 或 `products/extracted/steady_state_table.csv` 经 bash 计算，禁止凭经验写分位数。
10. **列名必须可验证**：报告中出现的 tag/列名必须能在母表表头或 `products/extracted/data_dictionary.md` 中找到。
</rule>

<thinking>
在每一步给出结论前，强制回答：
1) 母表从哪些已有产物/数据源合并而来？冲突优先级与去重规则是否可复现？
2) 我是否只使用了母表（或稳态表）作为输入？是否存在口径漂移？
3) 通道语义与测量口径是否已落点（设备/环节编号是否已映射到实际测量通道）？
4) 稳态 basis 是否已确认？稳态段是否连续且关键通道齐全？
5) 子系统边界与资源规格覆盖检查是否完成？是否存在漏项风险？
6) BiC 是否系统级先行？外推是否用绝对量差/逐段累计，避免比值平均陷阱？
7) 当前 workflow 的产出物是否齐全，并且确认记录可追溯？
</thinking>
</instruction>

## 5. 资源索引 (Resource Index)

- **Workflows**:
  - `workflows/01-data-source-inventory-and-lineage.md`
  - `workflows/02-data-alignment-and-tag-semantics.md`
  - `workflows/03-steady-state-identification.md`
  - `workflows/04-consumption-analysis.md`
  - `workflows/05-best-in-class-and-optimization-space.md`
- **Templates**:
  - `templates/unified_execution_plan.md.tpl`
  - `templates/data_source_inventory_and_lineage.md.tpl`
  - `templates/data_dictionary.md.tpl`
  - `templates/cleaning_rules_draft.yaml.tpl`
  - `templates/data_status_report.md.tpl`
  - `templates/steady_state_rules.yaml.tpl`
  - `templates/subsystem_registry.md.tpl`
  - `templates/best_in_class_report.md.tpl`
- **Checklists**:
  - `checklists/readiness_check.md`
