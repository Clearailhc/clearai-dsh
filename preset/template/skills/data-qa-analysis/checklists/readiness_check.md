# 数据 QA & 分析交付自检清单（Readiness Checklist：Workflow01-05）

> 在宣布“数据对齐/稳态/代价&波动/BiC 改进空间完成”前，必须通过以下所有检查。

## 0. 上游依赖（来自结构 skill）
- [ ] 已具备 `products/extracted/unit_inventory.md`（存在性三态 + 观测单元/流转关系 + 资源接口），且内容覆盖关键单元。
- [ ] 已具备 `products/extracted/entity_map.json`（topology-only），节点=观测单元/支持设施/边界，边=物质或信号流/资源接口，且每条边带 evidence（不含通道号）。

## 1. 执行计划与交付分区 (Plan & Delivery)
- [ ] 已在执行第一个 workflow 前输出“覆盖本次所有 workflows（仅限本 skill）的统一 plan”并获得用户确认（确认后再执行）。
- [ ] plan 已逐 workflow 列出 01-05，且每一步明确标注强制产出物清单（含文件路径）。
- [ ] plan 已显式声明产物分区：过程文件/中间产物输出至 `lab/`，最终交付输出至 `products/`，且每一步标明输出落点。
- [ ] plan 包含“产出物对照表”，并已逐条对照所选 workflows 的 `## 产出物` 清单逐行复制（无漏项、无概括省略）；可选项也已明确 Yes/No 与原因。
- [ ] 若执行中新增/删除 workflow 或调整交付物，已更新统一 plan 并再次获得用户确认（有记录可追溯）。
- [ ] 最终交付物（workflows 声明的 `products/extracted/*`）已按 plan 约定落在 `products/`（推荐 `products/extracted/*`）。

## 2. 数据源与血缘 (Lineage)
- [ ] 已完成数据源盘点：`products/extracted/data_source_inventory.md` 字段完整（路径模式/来源系统/粒度/时间范围/表头结构/编码/单位等）。
- [ ] 已绘制 `products/extracted/data_lineage.mmd`，且已声明 Pattern 选型（P0~P5）并解释每个 stage 的输入/输出与关键动作。
- [ ] 已明确 `products/extracted/merge_contract.md`：按时间 outer join / 去重规则 / 冲突优先级（同通道同时间）/ 多行表头处理策略可复现。
- [ ] 已输出 `products/extracted/mother_table_aligned.csv`，且后续所有分析均以其作为唯一母表输入。
- [ ] 若存在多张母表：已输出并维护 `products/extracted/mother_table_registry.md`（母表用途/边界/粒度/关系清楚）。

## 3. 通道语义与测量口径 (Tag Semantics & Metric-of-Record)
- [ ] 已输出 `products/extracted/data_dictionary.md`，通道语义/单位/角色(PV/MV/KPI)/来源优先级清楚。
- [ ] 已输出 `products/extracted/cleaning_rules.yaml`，并覆盖：时间解析/去重/物理越限/冻结值/缺口处理等。
- [ ] 已输出 `products/extracted/missing_tags.md`，并明确区分：
  - ObjectNotConfirmed（观测对象存在性未确认，禁止写成无测量通道）
  - Schema 缺失（列缺失）
  - 语义缺失（描述/单位缺失）
  - 数据缺失（值缺失/NaN）
- [ ] “设备编号≠测量通道”：已通过 `products/extracted/tag_map.csv` / `products/extracted/entity_map_enriched.json` 固化 metric-of-record（对象→测量通道），且 tag 可在母表列名/通道清单中验证存在。
- [ ] 任何“可能无测量通道/需代理”结论都满足：对象存在性为 State_A/State_B 且已尝试映射仍无任何可用 tag，并附证据链与候选代理规则。

## 4. 稳态与代表性 (Steady State)
- [ ] 已先输出 `products/extracted/data_status_report.md`（时间范围/间隔/连续段/重复时间点/稳态关键通道齐全性），并确认满足稳态分析条件。
- [ ] 已先输出并确认 `products/extracted/steady_state_basis.md`（有效判据：负荷阈值 + 过渡窗口剔除 + 连续性/NaN/阈值依据/验证计划），且确认记录发生在生成 mask/table 之前。
- [ ] 已输出 `products/extracted/steady_state_rules.yaml` 且与 basis 一致。
- [ ] 已输出 `products/extracted/steady_state_table.csv`，并确认后续所有分析均使用该文件（不是母表/原始导出）。
- [ ] 已输出 `products/extracted/steady_state_segments.csv` 并检查稳态段连续性与关键通道齐全性。
- [ ] 已输出 `products/extracted/steady_state_summary.md` 与 `products/extracted/steady_state_validation.md`（抽检记录可追溯）。

## 5. 代价与波动分析 (Cost & Variability)
- [ ] 已在 `products/extracted/subsystem_registry.md` 固化：最大代价口径（含资源规格，如 power@kW / reagent@gradeA）、子系统边界/负荷口径、共享项分摊规则。
- [ ] 已完成“资源规格消耗方覆盖完整性检查”（expected vs metered 差集与处理策略）并写入 `products/extracted/subsystem_registry.md`。
- [ ] 已输出 `products/extracted/consumption_summary.md`（按子系统 + 系统总计），且外推假设与风险已显式声明。
- [ ] 已输出 `products/extracted/load_distribution.csv`，包含 `subsystem_id`，并基于 `reference_hours` 外推基准期小时与消耗基线。
- [ ] 波动分析覆盖范围完整：SSC/Q/L（系统+子系统）+ 系统状态 PV + 控制/干预动作 MV/CO；并对“均值接近 0 的变量”做 CV 防错。
- [ ] `products/extracted/variability_summary.md` 已按 unit 逐一诊断（每节含：波动形态、影响假设、可验证假设、下一步核对动作）。
- [ ] 已输出 `products/extracted/workflow06_figures.md`（必选图表索引：口径 + 文件落点可追溯）。

## 6. Best-in-Class 与改进空间 (BiC & Improvement Space)
- [ ] 若系统强耦合，BiC 使用系统级 P20 先选最优时段集合，再进行单元归因（避免“单元最优拼不出系统最优”）。
- [ ] 外推计算采用“绝对量差/逐负荷段累计”或逐时累计，避免 `avg(A/B)*avg(B)` 偏差。
- [ ] 并行冗余单元（A/B 两路）已按物理意义合并后再计算（如两路并行回路消耗相加）。
- [ ] 外推假设（基准期运行小时、单位成本【如启用】、权重口径）已显式声明并与边界契约一致。

---

**自检结论**:
- [ ] 通过 (Ready to Submit)
- [ ] 需返工 (Needs Rework)
