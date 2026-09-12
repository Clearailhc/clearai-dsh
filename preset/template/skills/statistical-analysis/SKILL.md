---
name: statistical-analysis
description: |
  【假设验证·统计检验】选择合适检验方法、检查前提、执行分析并产出可审计结论。适用：验证两组条件差异、相关性、回归关系、组间对比。不适用：首触未知数据文件（用 exploratory-data-analysis）；深度关联分析与诊断（用 data-analysis）。
license: MIT license
metadata:
  version: 1.0-clearai
  skill-author: K-Dense Inc. (adapted for ClearAI)
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.410760+00:00'
---

# 统计分析 Skill（ClearAI 版）

## 使用边界

- **适用**：已有明确假设与干净表格数据，需统计检验支撑结论。
- **不适用**：数据尚未探查 → `exploratory-data-analysis`；需深度关联与根因分析 → `data-analysis`。

## ClearAI 工具与路径映射

- 数据 → `read` / `bash`（pandas 读 `input/` 或 `lab/`）
- 分析脚本 → `lab/scripts/stats_*.py`（可用已复制 `scripts/` 模板）
- 结果表 → `lab/extracted/stats_results.md` 或 `.csv`
- 图表 → `lab/diagrams/`
- 交付摘要 → `products/reports/`（若用户要求正式报告）
- 经验回写 → `clear/memory/statistical_analysis_lessons.md`

## 环境契约

```bash
python -c "import pandas, scipy, statsmodels, pingouin; print('statistics capability ready')"
```

上述统计栈属于 ClearAI 基础安装能力。若 import 验证失败，记录缺失包与当前 Python
路径并停止，提示用户修复部署；**禁止**在 Agent 运行中执行 `pip install` 或 `uv`。

## 工作流

### 1. 检验选型

| 问题类型 | 典型检验 |
|----------|----------|
| 两组均值 | t 检验 / Mann-Whitney |
| 多组均值 | ANOVA / Kruskal-Wallis |
| 分类关联 | 卡方 |
| 两变量关系 | Pearson/Spearman 相关、OLS 回归 |
| 时序对比 | 配对检验、变化点（简述） |

详见 `references/test_selection.md`、`references/assumptions_and_diagnostics.md`。

### 2. 前提检查

- 正态性、方差齐性、样本量、独立性
- 不满足时选用非参数或明确声明局限

### 3. 执行与报告（工程口径，非 APA）

每条结论须含：
- 检验名称、统计量、p 值/置信区间、效应量
- **物理证据**：基于哪份文件、哪几列、样本量 n=?
- 工程意义：差异是否在业务上显著？

### 4. 证据闭环

- 无统计输出文件/图表路径 → 不得宣称「已验证」
- 与 `hypothesis-generation` 产出的 H1/H2 逐条对应

## 报告模板（`lab/extracted/stats_results.md`）

```markdown
## 假设 H1: ...
- 方法：...
- 结果：stat=..., p=..., effect_size=...
- 证据：lab/diagrams/xxx.png, 输入=input/yyy.csv
- 结论：支持/拒绝/ inconclusive
- 局限：...
```
