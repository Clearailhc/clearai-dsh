---
name: exploratory-data-analysis
description: |
  【数据初探·首触文件】对数据文件做结构/质量/分布初探并产出 EDA 报告。适用：首次拿到 CSV/Excel/Parquet/JSON、需了解字段与缺失再决定下游分析。不适用：深度过程还原与机理关联（用 data-analysis）；观测/实验数据专项 QA（用 data-qa-analysis）。
license: MIT license
metadata:
  version: 1.0-clearai
  skill-author: K-Dense Inc. (adapted for ClearAI)
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.408002+00:00'
---

# 探索性数据分析 Skill（ClearAI 版）

## 使用边界

- **适用**：用户给出数据文件路径，需快速了解结构、质量、统计摘要、下游分析建议。
- **不适用**：已熟悉数据后的深度分析 → `data-analysis`；观测数据对齐/稳态筛选 → `data-qa-analysis`。

## ClearAI 工具与路径映射

- 列目录确认路径 → `bash` / `bash`（`ls`）
- 表格/文档 → `read`（小样本）/ `read`（xlsx）/ `bash`（pandas 脚本）
- 分析脚本 → `lab/scripts/eda_*.py`
- 报告 → `write` 到 `lab/extracted/eda_report.md`
- 图表 → `lab/diagrams/`
- 经验回写 → `clear/memory/eda_lessons.md`

## 支持格式（主路径）

| 格式 | 处理方式 |
|------|----------|
| `.csv` / `.tsv` | `bash` + pandas：`head`, `dtypes`, `describe`, 缺失率 |
| `.parquet` | pandas `read_parquet` |
| `.xlsx` / `.xls` | `read` 或 pandas |
| `.json` | pandas `read_json` 或 `read` |
| 纯文本日志 | `read` + `grep` 抽样 |

> 生物/化学专用格式（FASTA、VCF 等）非本 Skill 主路径；见 `references/` 仅作扩展参考。

## 工作流

### 1. 文件识别

- `bash` 确认路径；大文件禁止全量 `read`

### 2. 结构剖析

```bash
# 示例：放 lab/scripts/eda_profile.py
python lab/scripts/eda_profile.py --input input/data.csv --out lab/extracted/
```

输出：行数、列名、dtype、缺失率、数值列分位数、时间列范围。

### 3. 质量评估

- 重复行、常量列、明显异常值（IQR）
- 时间戳单调性、采样间隔

### 4. 可视化建议

- 分布图、时序图、相关性热力图（matplotlib → `lab/diagrams/`）

### 5. 下游建议

在报告中明确推荐：
- 需工艺理解 → `process-understanding-extraction`
- 需深度分析 → `data-analysis`
- 需假设验证 → `statistical-analysis` / `hypothesis-generation`

## 交付物 `lab/extracted/eda_report.md`

- 文件概览、字段字典草稿、质量评分、问题列表、推荐下一步 Skill

脚本模板可参考已复制的 `scripts/`（按需裁剪为常用 CSV 路径）。
