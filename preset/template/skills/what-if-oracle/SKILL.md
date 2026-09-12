---
name: what-if-oracle
description: |
  【情景推演·方案比选】多分支 What-If 分析（最好/最可能/最坏/二阶效应）。适用：实验方案变更、数据源替换、方法路线切换、资源投入决策前的情景压力测试。不适用：已有数据的统计验证（用 statistical-analysis）；深度关联与根因分析（用 data-analysis）。
license: CC BY-NC-SA 4.0
metadata:
  version: 1.1-clearai
  upstream: https://github.com/ashrafkahoush-ux/claude-consciousness-skills
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.412617+00:00'
---

# What-If Oracle Skill（科研情景版）

> 许可：CC BY-NC-SA 4.0，详见本目录 `LICENSE.txt`（若已复制）。

## 使用边界

- **适用**：决策分叉、不确定性高、需映射可能性空间而非单点预测。
- **不适用**：可凭历史数据直接检验的假设 → `statistical-analysis`；正式预研报告 → domain/process presearch。

## ClearAI 工具与路径映射

- 背景事实 → `web_search` / `read` 已有报告
- 情景文档 → `write` 到 `lab/knowledge/scenarios.md`
- 示意图 → mermaid → `lab/diagrams/`
- 经验回写 → `clear/memory/what_if_lessons.md`

## 核心原则：精确 IF

模糊「如果出问题怎么办」无效。须量化：
- **变量**：什么变？（如 主力数据集样本量 -30%）
- **幅度**：变多少？
- **时间窗**：本季度 / 6 个月？
- **当前态**：变更前基线？

## 工作流

### Phase 1：框定问题

分解为 Variable / Magnitude / Timeframe / Context。参见 `references/scenario-templates.md` 科研/数据段落。

### Phase 2：分支探索（4–6 条）

| 分支 | 说明 |
|------|------|
| Best | 乐观但需说明条件 |
| Likely | 基准情景 |
| Worst | 下行风险 |
| Wildcard | 低概率高影响 |
| Contrarian | 与共识相反 |
| Second-order | 一阶后果的连锁 |

### Phase 3：每条分支的逻辑链

- 触发条件 → 一阶影响（结果有效性/进度/成本）→ 二阶影响 → 可观测指标

### Phase 4：决策建议

- 不需替用户决策；列出「需监测的信号」与「建议的验证动作」（可链到 `hypothesis-generation`）

## 常见场景模板

- **实验方案变更**：条件/参数/流程调整对结果有效性与成本的影响
- **数据源替换**：换用新数据集或采集渠道后的可比性与偏差风险
- **方法路线切换**：更换分析/建模方法的收益、迁移成本与回退路径
- **资源投入决策**：加大算力/实验投入前的收益-风险压力测试

## 交付物 `lab/knowledge/scenarios.md`

含分支表、概率区间（定性高/中/低即可）、监测指标、下一步验证建议。
