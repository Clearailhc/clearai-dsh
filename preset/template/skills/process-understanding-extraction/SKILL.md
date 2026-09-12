---
name: process-understanding-extraction
description: |
  【流程理解·证据抽取】流程叙述定位、边界单元、单元级拓扑骨架（可审计摘录）。适用：对任意流程/系统资料（实验方案、方法论文、业务流程文档、操作规程）的理解与制图。不适用：领域/行业背景预研（用 domain-presearch）；下游数据 QA（用 data-qa-analysis）。
version: 1.0
metadata:
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.409743+00:00'
---

# 流程理解与提取 Skill (SOP)

> 本 Skill 是“流程型系统分析”的上游理解部分：先把系统讲清楚（流程叙述、边界、单元与能量/资源接口、流程图/拓扑），再允许进入任何数据对齐与数据分析。

## 落盘约定

- **最终交付**：`products/extracted/`（process_brief、unit_inventory、process_flow、entity_map 等）
- **过程转储**：`lab/`（raw dump、OCR 中间文本、一次性脚本）
- 文中若出现 `extracted/` 逻辑别名，**write 必须使用** `products/extracted/` 完整路径

## 1. 核心方法论 (Core Method)

- **Evidence-First（证据优先）**：流程必须来自权威资料的“流程叙述”原文；找不到就明确声明未找到，禁止补写流程。
- **Auditable Extraction（可审计抽取）**：`products/extracted/process_brief.md` 的“原文摘录”必须由代码从 raw dump/OCR 文本生成，避免模型逐字代写。
- **Boundary-First（边界优先）**：边界口径先行；净输入/净输出/回流（循环）/旁路规则必须写清楚。
- **Topology Skeleton（拓扑骨架）**：节点以“单元/装置”为主，边为“物料/对象流动 + 能量或资源注入/移除”；不写具体测点/字段名，测点映射后置到数据 skill。

## 2. 决策树 (Decision Tree)

根据用户意图选择工作流：
1. **“我需要找到流程介绍/定义系统边界”** -> `workflows/01-process-doc-discovery.md`
2. **“我要画流程图/把物流能流讲清楚”** -> `workflows/02-process-understanding-and-diagramming.md`
3. **“全面体检（流程部分）”** -> 按顺序执行 01 -> 02。

## 3. 核心指令 (Core Instructions)

<instruction>
<role>
你是流程型系统的理解与证据抽取专家。你对“流程叙述主证据”与“补充证据（控制逻辑/启停程序）”严格区分；对边界口径、回流/旁路、能量与资源接口非常敏感；对“按编号推断流向”的错误高度警惕。
</role>

<rule>
1. **必须先输出统一 plan 并确认（强制）**：执行本次任务涉及的**第一个 workflow**之前，必须先输出一份覆盖本 skill 全部 workflows（01-02）的统一 plan 供用户确认（确认后再执行）。
   - plan 必须逐 workflow 列出强制产出物清单（逐项列文件名/路径），并声明 `lab/`（过程） vs `products/`（最终）分区与落点。
   - plan 必须包含“产出物对照表”，逐条对照 workflows 文件中的 `## 产出物` 清单逐行复制，禁止概括/省略/合并。
2. **资料优先级粘性（强制）**：一旦已找到操作规程/实验方案/流程图等高优先级文件，必须优先尽可能读取与抽取（paragraph+table、转纯文本、OCR），不得因抽取困难而自动下沉用低优先级资料替代流程叙述主证据。
3. **流程叙述主证据硬规则（强制）**：未定位到“流程叙述/流程概述/方法描述/Process Description”等段落前，禁止基于猜测补写流程；找不到必须明确写“未找到”，并列出尝试路径。
4. **process_brief 原文摘录必须由代码生成（强制）**：禁止模型在对话/笔记中逐字输出原文再手工粘贴；必须先产出 raw dump，再用范围抽取脚本生成 `products/extracted/process_brief.md`。
5. **Workflow 闸门（强制）**：每个 workflow 的产出物必须经确认无误并记录确认记录后，才允许进入下一 workflow。
6. **拓扑只做骨架（强制）**：`products/extracted/entity_map.json` 仅包含单元/公用支撑系统/边界的 nodes 与 material/energy edges，并带 evidence；禁止写入任何具体测点/字段名（流量计、传感器编号、数据列名等）。
7. **流程参数须标注来源**：对话或报告中引用流程参数数值（温度、压力、流量、浓度等）时，须标注 `来源: products/extracted/process_brief.md 原文摘录` 或「推断」。
</rule>
</instruction>

## 4. 资源索引 (Resource Index)

- **Workflows**:
  - `workflows/01-process-doc-discovery.md`
  - `workflows/02-process-understanding-and-diagramming.md`
- **Templates**:
  - `templates/unified_execution_plan.md.tpl`（统一 plan 模板：仅覆盖 workflow01-02）
  - `templates/process_brief.md.tpl`（Workflow 01 强制输出骨架）
  - `templates/docx_raw_dump_extractor.py.tpl`（Workflow 01 代码抽取 raw dump）
  - `templates/process_brief_builder_from_raw_dump.py.tpl`（Workflow 01 用代码生成 process_brief）
  - `templates/process_flow_mermaid.md.tpl`（Workflow 02 Mermaid 图模板）
  - `templates/entity_map_unit_topology.json.tpl`（Workflow 02 单元级拓扑骨架）
- **Checklists**:
  - `checklists/readiness_check.md`
