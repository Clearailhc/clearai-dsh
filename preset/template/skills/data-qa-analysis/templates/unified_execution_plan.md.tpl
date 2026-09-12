# 统一执行计划（Unified Plan，数据 QA & 分析版：Workflow01-05）

> **强制**：本 plan 覆盖本次任务将执行的**所有 workflows（仅限本 skill）**。执行第一个 workflow 前必须先让用户确认本 plan。

## 0. 基本信息

- **项目/系统**：${PROJECT_NAME}
- **边界范围（简述）**：${SCOPE_SUMMARY}
- **计划日期**：${DATE}
- **负责人**：${OWNER}

## 1. 前置依赖（来自结构 skill 的交付物）

> 本 skill 依赖“系统理解与结构提取”skill 的上游产物作为输入约束（不跨目录引用模板/清单，但必须满足这些文件已存在且可用）。

- `products/extracted/unit_inventory.md`（存在性三态 + 观测单元/流转关系 + 资源接口）
- `products/extracted/entity_map.json`（topology-only：节点=观测单元/支持设施/边界；边=物质或信号流/资源接口；含 evidence；不含通道号）

## 2. 产物分区（必须）

- **lab/**：过程文件/中间产物（临时表、探索性 notebook、截图等）
- **products/**：最终交付（推荐把 workflows 声明的 `products/extracted/*` 映射为 `products/extracted/*`）

> **规则**：任何 workflow 的“强制产出物”必须在 plan 中写清楚最终落点（`lab/` or `products/` + 具体文件路径）。

## 3. 本次将执行的 Workflows（顺序与原因）

| 顺序 | workflow | 目的 | 前置依赖 | 主要强制产出物（文件） |
|------|----------|------|----------|------------------------|
| 01 | `workflows/01-data-source-inventory-and-lineage.md` | ${WHY_WF01} | 结构产物 + 数据源 | `products/extracted/data_source_inventory.md`<br/>`products/extracted/data_lineage.mmd`<br/>`products/extracted/merge_contract.md`<br/>`products/extracted/mother_table_aligned.csv`<br/>`products/extracted/mother_table_registry.md` |
| 02 | `workflows/02-data-alignment-and-tag-semantics.md` | ${WHY_WF02} | wf01 + 结构产物 | `products/extracted/data_dictionary.md`<br/>`products/extracted/cleaning_rules.yaml`<br/>`products/extracted/missing_tags.md`<br/>`products/extracted/tag_map.csv`<br/>`products/extracted/entity_map_enriched.json` |
| 03 | `workflows/03-steady-state-identification.md` | ${WHY_WF03} | wf01/02 | `products/extracted/data_status_report.md`<br/>`products/extracted/time_gap_summary.csv`<br/>`products/extracted/continuous_segments.csv`<br/>`products/extracted/steady_state_basis.md`<br/>`products/extracted/steady_state_rules.yaml`<br/>`products/extracted/steady_state_mask.csv`<br/>`products/extracted/steady_state_segments.csv`<br/>`products/extracted/steady_state_table.csv`<br/>`products/extracted/steady_state_summary.md`<br/>`products/extracted/steady_state_validation.md` |
| 04 | `workflows/04-consumption-analysis.md` | ${WHY_WF04} | wf03 | `products/extracted/subsystem_registry.md`<br/>`products/extracted/consumption_summary.md`<br/>`products/extracted/load_distribution.csv`<br/>`products/extracted/variability_summary.md`<br/>`products/extracted/workflow06_figures.md` |
| 05 | `workflows/05-best-in-class-and-optimization-space.md` | ${WHY_WF05} | wf04 | `products/extracted/bic_thresholds.csv`<br/>`products/extracted/optimization_space_by_unit.csv`<br/>`products/extracted/improvement_space_summary.md` |

> 上表默认“执行 01-05 全链路”。若本次不执行某些 workflow，必须在下方“产出物对照表”里明确标记为 N/A，并说明原因与风险。

## 4. 产出物对照表（强制，逐条对照 workflow 的 `## 产出物`）

> **硬规则**：本表必须逐条对照你将执行的每个 workflow 文件中的 `## 产出物` 清单，**逐行复制**文件名/路径，不允许“概括/省略/合并同类项”。
> 若 workflow 的产出物有“可选”，也必须在本表明确是否产出（Yes/No）与原因。

### 4.1 Workflow 01

| 条目 | 来自 workflow 的产出物条目 | 本次是否产出 | 最终落点（lab/product + 路径） | 备注 |
|------|---------------------------|--------------|------------------------------|------|
| 01-1 | `products/extracted/data_source_inventory.md` | Yes | `products/extracted/data_source_inventory.md` |  |
| 01-2 | `products/extracted/data_lineage.mmd` | Yes | `products/extracted/data_lineage.mmd` |  |
| 01-3 | `products/extracted/merge_contract.md` | Yes | `products/extracted/merge_contract.md` |  |
| 01-4 | `products/extracted/mother_table_aligned.csv` | Yes | `products/extracted/mother_table_aligned.csv` |  |
| 01-5 | `products/extracted/mother_table_registry.md` | Yes | `products/extracted/mother_table_registry.md` | 推荐始终产出 |
| 01-6 | （可选，但推荐）`products/extracted/header_meta.csv` | ${YES_NO} | ${PATH} |  |
| 01-7 | （可选）`products/extracted/tag_map.csv` | ${YES_NO} | ${PATH} |  |

### 4.2 Workflow 02

| 条目 | 来自 workflow 的产出物条目 | 本次是否产出 | 最终落点（lab/product + 路径） | 备注 |
|------|---------------------------|--------------|------------------------------|------|
| 02-1 | `products/extracted/data_dictionary.md` | Yes | `products/extracted/data_dictionary.md` |  |
| 02-2 | `products/extracted/cleaning_rules.yaml` | Yes | `products/extracted/cleaning_rules.yaml` |  |
| 02-3 | `products/extracted/missing_tags.md` | Yes | `products/extracted/missing_tags.md` |  |
| 02-4 | `products/extracted/tag_map.csv` | Yes | `products/extracted/tag_map.csv` |  |
| 02-5 | `products/extracted/entity_map_enriched.json` | Yes | `products/extracted/entity_map_enriched.json` |  |

### 4.3 Workflow 03

| 条目 | 来自 workflow 的产出物条目 | 本次是否产出 | 最终落点（lab/product + 路径） | 备注 |
|------|---------------------------|--------------|------------------------------|------|
| 03-1 | `products/extracted/data_status_report.md` | Yes | `products/extracted/data_status_report.md` |  |
| 03-2 | `products/extracted/time_gap_summary.csv` | Yes | `products/extracted/time_gap_summary.csv` |  |
| 03-3 | `products/extracted/continuous_segments.csv` | Yes | `products/extracted/continuous_segments.csv` |  |
| 03-4 | `products/extracted/steady_state_basis.md` | Yes | `products/extracted/steady_state_basis.md` | 必须先确认后再继续 |
| 03-5 | `products/extracted/steady_state_rules.yaml` | Yes | `products/extracted/steady_state_rules.yaml` |  |
| 03-6 | `products/extracted/steady_state_mask.csv` | Yes | `products/extracted/steady_state_mask.csv` |  |
| 03-7 | `products/extracted/steady_state_segments.csv` | Yes | `products/extracted/steady_state_segments.csv` |  |
| 03-8 | `products/extracted/steady_state_table.csv` | Yes | `products/extracted/steady_state_table.csv` | 下游唯一输入 |
| 03-9 | `products/extracted/steady_state_summary.md` | Yes | `products/extracted/steady_state_summary.md` |  |
| 03-10 | `products/extracted/steady_state_validation.md` | Yes | `products/extracted/steady_state_validation.md` |  |

### 4.4 Workflow 04

| 条目 | 来自 workflow 的产出物条目 | 本次是否产出 | 最终落点（lab/product + 路径） | 备注 |
|------|---------------------------|--------------|------------------------------|------|
| 04-1 | `products/extracted/subsystem_registry.md` | Yes | `products/extracted/subsystem_registry.md` |  |
| 04-2 | `products/extracted/consumption_summary.md` | Yes | `products/extracted/consumption_summary.md` |  |
| 04-3 | `products/extracted/load_distribution.csv` | Yes | `products/extracted/load_distribution.csv` | 按子系统长周期外推 |
| 04-4 | `products/extracted/variability_summary.md` | Yes | `products/extracted/variability_summary.md` | 按 unit 逐一诊断 |
| 04-5 | `products/extracted/workflow06_figures.md` | Yes | `products/extracted/workflow06_figures.md` | 图表索引 |

### 4.5 Workflow 05

| 条目 | 来自 workflow 的产出物条目 | 本次是否产出 | 最终落点（lab/product + 路径） | 备注 |
|------|---------------------------|--------------|------------------------------|------|
| 05-1 | `products/extracted/bic_thresholds.csv` | Yes | `products/extracted/bic_thresholds.csv` | 系统 P20 |
| 05-2 | `products/extracted/optimization_space_by_unit.csv` | Yes | `products/extracted/optimization_space_by_unit.csv` | 单元改进空间 |
| 05-3 | `products/extracted/improvement_space_summary.md` | Yes | `products/extracted/improvement_space_summary.md` | 改进空间与长周期收益 |

## 5. 计划确认（用户确认后才允许执行）

- [ ] 用户确认 plan（日期/确认人/备注）：${PLAN_APPROVAL}
