# 数据质量评分卡 (Quality Scorecard)

**评估时间**: {{ analysis_date }}
**数据源**: {{ data_source }}

## 1. 总体评分 (Overall Score)
| 维度 (Dimension) | 得分 (0-100) | 权重 | 加权分 | 评级 (S/A/B/C/D) |
| :--- | :--- | :--- | :--- | :--- |
| **完整性 (Completeness)** | {{ score_completeness }} | 30% | - | - |
| **准确性 (Accuracy)** | {{ score_accuracy }} | 30% | - | - |
| **一致性 (Consistency)** | {{ score_consistency }} | 20% | - | - |
| **物理合理性 (Physicality)** | {{ score_physicality }} | 20% | - | - |
| **总分** | **{{ score_total }}** | **100%** | **-** | **-** |

## 2. 缺陷统计 (Defect Stats)
- **缺失率 (Missing Rate)**: {{ missing_rate }}% (Threshold: <1%)
- **异常值比例 (Outlier Rate)**: {{ outlier_rate }}% (Threshold: <3%)
- **时间戳跳变 (Time Jumps)**: {{ time_jumps_count }} 次
- **重复记录 (Duplicates)**: {{ duplicates_count }} 行

## 3. 物理/机理约束检查 (Physics Audit)
| 检查项 | 规则 | 结果 | 违规示例 |
| :--- | :--- | :--- | :--- |
| **极值检查** | Temp > 0 && Temp < 1000 | Pass/Fail | - |
| **变化率检查** | |dT/dt| < 50°C/s | Pass/Fail | Batch#123: 200°C/s |
| **状态一致性** | 停止状态下 Power == 0 | Pass/Fail | - |

## 4. 改进建议 (Recommendations)
1. 建议对 `{{ field_name }}` 进行插值处理。
2. 检查 `{{ time_range }}` 期间的观测通道状态。
