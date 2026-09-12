# 数据字典 (Data Dictionary)

## 模板说明
用于观测/实验母表的通道语义固化。建议“通道-语义-单位-角色-来源”一次写清楚，避免后续口径漂移。

| 通道 (Tag) | 物理含义 (Meaning) | 单位 (Unit) | 角色 (PV/MV/SP/KPI) | 采样频率 | 正常范围 | 设计值 | 告警限LL/L/H/HH | 来源优先级 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| `${TAG_1}` | ${MEANING_1} | ${UNIT_1} | ${ROLE_1} | ${FREQ_1} | ${RANGE_1} | ${DESIGN_1} | ${ALARM_1} | ${SOURCE_1} | ${REMARK_1} |
| `${TAG_2}` | ${MEANING_2} | ${UNIT_2} | ${ROLE_2} | ${FREQ_2} | ${RANGE_2} | ${DESIGN_2} | ${ALARM_2} | ${SOURCE_2} | ${REMARK_2} |

## 补充说明
- **通道归一化规则**：${NORMALIZATION_RULES}
- **缺失值语义**：${MISSING_VALUE_CODES}
