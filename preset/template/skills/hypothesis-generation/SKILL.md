---
name: hypothesis-generation
description: |
  【假设形成·可证伪】从观察/文献/预研结论形成竞争假设与验证计划。适用：预研后需明确「待验证什么」、CM 分析中的可验证假设、根因候选排序。不适用：纯发散脑暴（用 scientific-brainstorming）；已有数据直接做统计检验（用 statistical-analysis）。
license: MIT license
metadata:
  version: 1.0-clearai
  skill-author: K-Dense Inc. (adapted for ClearAI)
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.408447+00:00'
---

# 科学假设形成 Skill（ClearAI 版）

## 使用边界

- **适用**：有初步观察、预研结论或数据模式，需形成 3–5 个可区分、可证伪的假设。
- **不适用**：尚无观察的早期探索 → `scientific-brainstorming`；自动化批量假设挖掘 → P1 `hypogenic`。

## ClearAI 工具与路径映射

- 文献 → `web_search` + `paper-lookup`（学术补充）
- 数据探查 → `read` / `bash`（pandas 摘要）
- 假设文档 → `write` 到 `lab/knowledge/hypotheses.md`
- 验证计划中的脚本 → `lab/scripts/`
- 经验回写 → `clear/memory/hypothesis_generation_lessons.md`

## 工作流

### 1. 澄清现象

- 核心观察是什么？范围与约束？已知 vs 未知？

### 2. 文献与事实检索

- `web_search` 获取行业实践与学术线索
- 需要 DOI/论文细节时加载 `paper-lookup`

检索策略见 `references/literature_search_strategies.md`。

### 3. 综合证据

- 当前共识、冲突证据、空白点

### 4. 生成竞争假设（3–5 个）

每条假设须含：
- **机制解释**（非仅描述）
- **可观测预测**
- **证伪条件**（什么结果可推翻它）

### 5. 质量评估

用 `references/hypothesis_quality_criteria.md` 评估：可检验性、可证伪性、简约性、解释力。

### 6. 设计验证步骤

- 需要什么数据/实验/统计检验？
- 下一步 Skill：`exploratory-data-analysis` → `statistical-analysis` 或 `data-analysis`

## 交付物 `lab/knowledge/hypotheses.md`

```markdown
## H1: ...
- 机制：...
- 预测：...
- 证伪：...
- 验证动作：...
- 优先级：高/中/低
```

与 NEXT「可验证假设」口径对齐：CM 分析、diagnosis 根因分析可直接引用本文档。
