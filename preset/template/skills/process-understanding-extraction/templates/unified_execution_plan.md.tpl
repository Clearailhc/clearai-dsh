# 统一执行计划（Unified Plan，流程提取版：Workflow01-02）

> **强制**：本 plan 覆盖本次任务将执行的**所有 workflows（仅限本 skill）**。执行第一个 workflow 前必须先让用户确认本 plan。

## 0. 基本信息

- **项目/系统**：${PROJECT_NAME}
- **边界范围（简述）**：${SCOPE_SUMMARY}
- **计划日期**：${DATE}
- **负责人**：${OWNER}

## 1. 产物分区（必须）

- **lab/**：过程文件/中间产物（raw dump、临时表、探索性 notebook、截图、原始转储等）
- **products/**：最终交付（推荐把 workflows 声明的 `products/extracted/*` 映射为 `products/extracted/*`）

> **规则**：任何 workflow 的“强制产出物”必须在 plan 中写清楚最终落点（`lab/` or `products/` + 具体文件路径）。

## 2. 本次将执行的 Workflows（顺序与原因）

| 顺序 | workflow | 目的 | 前置依赖 | 主要强制产出物（文件） |
|------|----------|------|----------|------------------------|
| 01 | `workflows/01-process-doc-discovery.md` | ${WHY_WF01} | - | `products/extracted/process_brief.md`<br/>`products/extracted/unit_inventory.md`<br/>`products/extracted/segment_boundary.md` |
| 02 | `workflows/02-process-understanding-and-diagramming.md` | ${WHY_WF02} | wf01 | `products/extracted/process_flow.md`<br/>`products/extracted/entity_map.json` |

## 3. 代码抽取与过程产物（建议写清楚，避免混入最终交付）

- **DOCX raw dump**（用于 `products/extracted/process_brief.md` 原文摘录）：`lab/raw_dumps/${DOC_NAME}.raw_dump.md`
- **临时脚本/Notebook**：`lab/notebooks/...` / `lab/scripts/...`

## 4. 产出物对照表（强制，逐条对照 workflow 的 `## 产出物`）

> **硬规则**：本表必须逐条对照你将执行的每个 workflow 文件中的 `## 产出物` 清单，**逐行复制**文件名/路径，不允许“概括/省略/合并同类项”。

### 4.1 Workflow 01

| 条目 | 来自 workflow 的产出物条目 | 本次是否产出 | 最终落点（lab/product + 路径） | 备注 |
|------|---------------------------|--------------|------------------------------|------|
| 01-1 | `products/extracted/process_brief.md` | Yes | `products/extracted/process_brief.md` | 原文摘录由 raw dump 代码生成 |
| 01-2 | `products/extracted/unit_inventory.md` | Yes | `products/extracted/unit_inventory.md` |  |
| 01-3 | `products/extracted/segment_boundary.md` | Yes | `products/extracted/segment_boundary.md` |  |

### 4.2 Workflow 02

| 条目 | 来自 workflow 的产出物条目 | 本次是否产出 | 最终落点（lab/product + 路径） | 备注 |
|------|---------------------------|--------------|------------------------------|------|
| 02-1 | `products/extracted/process_flow.md` | Yes | `products/extracted/process_flow.md` | 含输入去向映射表 + 两张 Mermaid 图 |
| 02-2 | `products/extracted/entity_map.json` | Yes | `products/extracted/entity_map.json` | topology-only，不含测点/字段名 |

## 5. 计划确认（用户确认后才允许执行）

- [ ] 用户确认 plan（日期/确认人/备注）：${PLAN_APPROVAL}

