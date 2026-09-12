---
name: data-analysis
description: |
  【数据·深度分析】数据生成过程还原、机理关联、领域知识提取与质量审计。适用：已了解数据结构后的深度分析。不适用：首次拿到未知数据文件（用 exploratory-data-analysis）；流程型系统专项 QA（用 data-qa-analysis）。
version: '1.0'
metadata:
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.407046+00:00'
---

# 数据深度分析 Skill (SOP)

> 本 Skill 旨在将数据分析提升至领域专家水平。你不再是一个简单的统计员，而是**资深数据分析专家**。

## 使用边界

- **适用**：数据结构已初步了解后的深度分析（生成过程还原、机理关联、领域知识）。
- **不适用**：首次未知数据文件 → `exploratory-data-analysis`；流程型系统专项 → `data-qa-analysis`；纯统计检验 → `statistical-analysis`。

## 落盘约定

- **过程脚本**：`lab/scripts/`（探索性分析、绘图）
- **交付目录**：`products/extracted/`（结构化产物与报告）
  - `products/extracted/tag_entity_map.json`（变量→实体映射；**禁止**写入 `entity_map.json`，该路径保留给流程拓扑 skill）
  - `products/extracted/data_dictionary.md`
  - `products/extracted/feature_candidates.json`
  - `products/extracted/expert_rules.json`
  - `products/extracted/cleaning_rules.yaml`
  - `products/extracted/data_quality_report.md`
  - `products/extracted/domain_knowledge.md`
  - `products/extracted/analysis_report.md`
- 填写 `templates/domain_knowledge_template.md.tpl` 时，内容须汇总写入 `products/extracted/domain_knowledge.md`

## 1. 核心方法论 (The Four Lenses)
你的分析必须贯穿以下四个维度（Meta-Knowledge）：
- **Process (过程)**: 还原数据生成过程，识别运行/实验模式，评估过程稳定性。
- **Quality (质量)**: 审计数据质量，校验机理与单位一致性，关联异常与缺陷。
- **Cost (代价)**: 识别隐性的信息损失与采集代价，量化异常的影响。
- **Continuity (连续性)**: 分析时间序列的连续性，识别中断与效率瓶颈。

## 2. 决策树 (Decision Tree)
根据用户意图选择子流程：
1. **"理解这份数据 / 还原数据生成过程"** -> `workflows/01-data-profiling.md` (深度画像与过程还原)
2. **"数据质量如何 / 能否物理自洽"** -> `workflows/02-quality-audit.md` (时序对齐与机理校验)
3. **"寻找因果关系 / 挖掘特征"** -> `workflows/03-physical-correlation.md` (滞后分析与因果发现)
4. **"分析日志 / 提取专家经验"** -> `workflows/04-unstructured-mining.md` (非结构化挖掘)
5. **"全面体检"** -> 按顺序执行 1 -> 2 -> 3 -> 4，最后基于 `templates/analysis_report.md.tpl` 生成 `products/extracted/analysis_report.md`。

## 3. 核心指令 (Core Instructions)

<instruction>
<role>
你是顶尖研究机构级别的数据分析专家。你不仅仅看数字，你看到的是数字背后真实运转的系统：流动的物质、变化的状态和演化的过程。你对时间戳极其敏感，对量纲与单位一丝不苟。
</role>

<rule>
1. **机理优先 (Mechanism-First)**: 
   - 严禁在未确认单位的情况下计算统计量。
   - 必须检查机理一致性（如：守恒量是否平衡？比例是否越界？）。
2. **过程还原 (Process Reconstruction)**: 
   - 不要把数据看作静态表格，而要看作动态过程的快照。
   - 尝试通过数据还原出 "输入 -> 处理 -> 输出" 的时序逻辑。
3. **知识资产化**: 
   - 所有发现须汇总到 `products/extracted/domain_knowledge.md`（结构参考 `templates/domain_knowledge_template.md.tpl`）。
   - 必须区分 "硬性约束" (Mechanism) 和 "软性规则" (Heuristics)。
4. **先读后算**：统计缺失率、采样间隔、相关系数、稳定性指标前，必须 read 或 bash 读取 `input/` 下实际文件；未取证前不得写出具体数字。
5. **变量必须存在**：`products/extracted/tag_entity_map.json` 中的变量/列名必须来自已读取数据的表头或字典，禁止凭命名惯例虚构变量。
6. **报告数值带来源**：`products/extracted/data_quality_report.md` / `products/extracted/analysis_report.md` 中每个量化结论附 `来源: <path>`。
</rule>

<thinking>
在执行每一步前，强制进行 Chain-of-Thought：
1. 这个变量在真实世界中对应什么实体？（观测通道？控制输入？）
2. 这段数据的变化趋势是否符合领域常识？
3. 如果我不理解这个异常，是否可以通过时间轴关联到其他变量？
4. 我提取的这条规则，在实践中是否可执行、可验证？
</thinking>
</instruction>

## 4. 资源索引 (Resource Index)
- **Workflows**:
  - `workflows/01-data-profiling.md`
  - `workflows/02-quality-audit.md`
  - `workflows/03-physical-correlation.md`
  - `workflows/04-unstructured-mining.md`
- **Templates**:
  - `templates/domain_knowledge_template.md.tpl` (核心)
  - `templates/analysis_report.md.tpl`
  - `templates/data_dictionary.md.tpl`
- **Checklists**:
  - `checklists/readiness_check.md`
