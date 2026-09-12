# Best-in-Class (BiC/P20) 与改进空间报告模板

**对象系统**: ${SYSTEM_NAME}
**分析周期**: ${DATE_RANGE}
**数据集**: ${DATASET_DESC}（稳态口径：${STEADY_STATE_DESC}）

---

## 1. 口径与定义

### 1.1 系统边界
${BOUNDARY_SUMMARY}

### 1.2 KPI 定义
- 系统负荷：${LOAD_DEF}
- 系统消耗：${CONS_DEF}
- 系统单位代价：${SSC_DEF}

### 1.3 标杆定义（P20）
${BIC_DEF}

---

## 2. 分负荷段标杆（系统级）

| 负荷段 | 样本数 | 平均负荷 | 单位代价P20 | 单位代价P50 | 备注 |
|---|---:|---:|---:|---:|---|
| ${BIN_1} | ${N_1} | ${LOAD_AVG_1} | ${P20_1} | ${P50_1} | - |

---

## 3. 系统最优时段集合（System_BiC Hours）
- 定义：系统单位代价(t) ≤ P20(负荷段(t))
- 样本占比：${BIC_HOUR_RATE}

---

## 4. 单元归因（在 System_BiC Hours 内）

| 单元 | 当前均值消耗 | BiC集合内均值消耗 | 绝对差 | 长周期节省(物理量) | 长周期节省(成本，可选) | 备注 |
|---|---:|---:|---:|---:|---:|---|
| ${UNIT_1} | ${CUR_1} | ${BIC_1} | ${DIFF_1} | ${SAVE_Q_1} | ${SAVE_C_1} | - |

---

## 5. 外推假设
- 基准期运行小时：${HOURS_REF} h
- 单位成本（如启用）：${UNIT_COST}

---

## 6. Pitfalls（必读反例）
- 系统级 vs 单元级：${PITFALL_COUPLING}
- 比值平均陷阱：`avg(A/B) * avg(B) != avg(A)`（需使用绝对差/逐段累计）
- 负荷段过宽：${PITFALL_BINNING}
- 并行冗余单元未合并：${PITFALL_PARALLEL}
