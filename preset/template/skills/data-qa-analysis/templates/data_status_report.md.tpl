# 数据状况报告模板（稳态前必备）

**对象系统**: ${SYSTEM_NAME}
**母表**: ${MOTHER_TABLE}
**分析日期**: ${DATE}

---

## 1. 基本信息
| 项目 | 值 |
|---|---|
| 总时间点数 | ${N_POINTS} |
| 时间范围 | ${T_START} ~ ${T_END} |
| 覆盖时长 | ${COVERAGE} |
| 采样期望 | ${EXPECTED_SAMPLING} |

---

## 2. 时间间隔与连续性

### 2.1 时间间隔分布（相邻点差分）
| 指标 | 值 |
|---|---:|
| P50 | ${GAP_P50} |
| P90 | ${GAP_P90} |
| P95 | ${GAP_P95} |
| Max | ${GAP_MAX} |

### 2.2 连续段统计（连续性定义：相邻间隔 ≤ ${CONTINUOUS_GAP}）
| 指标 | 值 |
|---|---:|
| 连续段数量 | ${N_SEGMENTS} |
| 最长连续段 | ${MAX_SEGMENT} |
| 最短连续段 | ${MIN_SEGMENT} |
| 平均连续段 | ${AVG_SEGMENT} |

Top 段列表（示例）：
| 序号 | 开始时间 | 结束时间 | 时长 | 点数 |
|---:|---|---|---:|---:|
| 1 | ${S1_START} | ${S1_END} | ${S1_DUR} | ${S1_N} |

---

## 3. 重复时间点与去重
| 项目 | 值 |
|---|---:|
| 重复时间点行数 | ${N_DUP_ROWS} |
| 重复占比 | ${DUP_RATE} |
| 去重策略 | ${DEDUP_POLICY} |

---

## 4. 关键通道齐全性（仅稳态判据所需通道）
| 通道 | 非空率 | 最大连续缺失 | 备注 |
|---|---:|---:|---|
| ${TAG_1} | ${TAG_1_RATE} | ${TAG_1_MAX_GAP} | - |

结论（是否满足进入稳态分析）：
- [ ] 满足
- [ ] 不满足（需要回到 `workflows/01-data-source-inventory-and-lineage.md` / `workflows/02-data-alignment-and-tag-semantics.md` 修正母表/通道语义）
