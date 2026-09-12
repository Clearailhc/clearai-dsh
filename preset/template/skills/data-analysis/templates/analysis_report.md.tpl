# 数据深度分析报告 (Deep Data Analysis Report)

**分析对象**: `{{ file_name }}`
**分析时间**: `{{ analysis_time }}`
**分析师**: ClearAI

---

## 1. 核心结论 (Executive Summary)
> **一句话总结**: 数据质量评级为 **{{ quality_grade }}**，主要问题集中在 [XX] 方面，建议 [Action]。

- **数据可用性**: [High/Medium/Low]
- **关键发现**:
  1. ...
  2. ...

---

## 2. 四大维度视角分析 (Four-Lens Analysis)

### 2.1 过程视角 (Process) - 稳定性与能力
- **稳定性分析**: 关键参数 `{{ key_param }}` 的过程稳定性指标为 `{{ stability_value }}`（如 Cpk，目标: >1.33）。
- **过程状态**: 是否处于受控/稳定状态？[Yes/No]
- **过程异常**: 发现 `{{ anomaly_count }}` 次关键参数越限。

### 2.2 质量视角 (Quality) - 缺陷与关联
- **缺陷分布**: 主要缺陷类型为 `{{ top_defect }}`。
- **关联分析**: `{{ key_param }}` 的波动与 `{{ defect_type }}` 呈现 [正/负] 相关。
- **潜在风险**: ...

### 2.3 代价视角 (Cost) - 损失量化
- **质量损失估算**: 约 `{{ quality_loss_cost }}`（按项目约定的资源/成本单位）。
- **优化潜力**: 若将过程稳定性提升至目标水平，预计节约 `{{ potential_saving }}`。

### 2.4 连续性视角 (Continuity) - 覆盖与可用率
- **有效时长**: 数据覆盖率为 `{{ coverage_rate }}%`。
- **中断分析**: 识别出 `{{ downtime_count }}` 次异常中断/断数。

---

## 3. 详细画像 (Detailed Profiling)

### 3.1 基础统计
| 字段 | Min | Max | Mean | Std | Skew | Missing% |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| ... | ... | ... | ... | ... | ... | ... |

### 3.2 物理/业务键分析
- **Business Keys**: 识别出的主键为 `{{ primary_key }}`。
- **实体关联**: 包含 `{{ entity_count }}` 个唯一实体（如批次、样本、会话）。

---

## 4. 建模建议 (Modeling Recommendations)
1. **预处理建议**: ...
2. **特征工程**: 建议构建特征见 `products/extracted/feature_candidates.json`。
3. **模型选择**: 适合 [简单机理/复杂数据驱动] 建模。

---

## 5. 附录
- [数据字典](products/extracted/data_dictionary.md)
- [数据质量报告](products/extracted/data_quality_report.md)
