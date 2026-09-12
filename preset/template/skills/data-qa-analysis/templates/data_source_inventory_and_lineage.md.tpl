# 数据源盘点与数据血缘模板 (Data Source Inventory & Lineage)

## 模板说明
用于观测/实验数据项目的“数据源盘点 + 母表血缘 + 合并契约”交付。目标是让任何 KPI/稳态/标杆结论都 **可追溯**。

**对象系统**: ${SYSTEM_NAME}
**分析日期**: ${DATE}
**负责人**: ${OWNER}

---

# 1. 数据源清单 (Inventory)

> 填写原则：先覆盖全量，再逐步标注“已纳入母表/未纳入但可补充/仅用于解释”。

| 数据源ID | 路径/文件模式 | 来源系统 | 数据类型 | 粒度/频率 | 时间范围 | 时间列 | 主键 | 编码 | 单位状态 | 表头结构 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S01 | ${PATH_1} | ${SYSTEM_1} | 时序模拟量 | 1min | ${RANGE_1} | ${TIME_COL_1} | - | gbk/utf-8 | 未统一/已统一 | 单行/多行 | - |
| S02 | ${PATH_2} | ${SYSTEM_2} | 报警/事件 | event | ${RANGE_2} | ${TIME_COL_2} | ${KEY_2} | - | - | - | - |

## 1.1 表头行定义（如存在多行表头）
若存在多行表头，请在此定义每一行含义（示例）：
- 第1行：列名/通道（Tag）
- 第2行：通道清单描述（Meaning）
- 第3行：要点（Key points）
- 第4行：方案/说明抽取描述（Protocol summary）
- 第5-11行：设计值/正常范围/告警限/仪器量程（如有）

---

# 2. 母表定义 (Mother Table)

**母表路径**: ${MOTHER_TABLE_PATH}

## 2.1 一行代表什么？
- [ ] 时间点（连续观测常见）
- [ ] 实验批次/轮次
- [ ] 事件/报警
- [ ] 其他：${ROW_SEMANTIC}

## 2.2 母表关键字段
- 时间列：${MOTHER_TIME_COL}
- 时间解析：${TIME_PARSE_RULE}
- 连续性定义：相邻间隔 ≤ ${CONTINUOUS_GAP} 视为连续

## 2.3 母表包含哪些信息层？
- [ ] 数据层（时间点 → 通道值）
- [ ] 元数据层（通道 → 描述/单位/量程/设计值/告警限）
- [ ] 两者混合（多行表头 + 数据行）

---

# 3. 数据血缘 (Lineage)

## 3.0 母表合成模式选择（必填，避免误解“母表如何来的”）
> 说明：不同项目拿到的上游数据形态不同，母表合成链路也不同。请从下列 Pattern 中选择最符合本项目实际情况的一种，并写明理由与各 stage 的输入/输出文件名模式（用占位路径表达即可）。

- 选用 Pattern：${PATTERN_ID}（P0/P1/P2/P3/P4/P5）
- 选型理由：${PATTERN_REASON}
- Stage 列表（输入/输出文件名模式 + 关键加工动作）：${STAGE_LIST}

Pattern 速查（填写时只需选一种）：
- **P0**：只拿到现成母表或等价对齐宽表（仍需补齐 Spec+Contract）
- **P1**：分阶段合并 `raw_history_exports/ → history_merged/ → project_merged/ → products/extracted/mother_table_aligned.csv`
- **P2**：已有项目级宽表直对齐 `project_merged/ → products/extracted/mother_table_aligned.csv`
- **P3**：直连历史库查询对齐 `historian_query → aligned_wide_table → products/extracted/mother_table_aligned.csv`
- **P4**：多观测段多母表 `mother_segment_* → system_mother`
- **P5**：增量追加滚动重算 `monthly_append/ → rolling_merged → products/extracted/mother_table_aligned.csv`

## 3.1 血缘图（Mermaid）

> 画你项目实际采用的那一种即可；边上必须标注关键动作（outer join/dedup/priority/meta header/alignSpec 等）。

### 示例块：Pattern P1（分阶段合并）

```mermaid
flowchart LR
  rawHistoryExports["raw_history_exports/ (raw)"] -->|"concat+sort+dedup + metaHeaderExtract"| historyMerged["history_merged/ (stage1)"]
  historyMerged -->|"outerJoinOnTime + priorityRule + tagNormalize"| projectMerged["project_merged/ (stage2)"]
  projectMerged -->|"alignSpec + protectAllTags + dataTableOnly"| motherAligned["products/extracted/mother_table_aligned.csv (aligned)"]

  supplementWide["supplement_wide_table.csv (optional)"] -.->|"outerJoinOnTime + fillNA_byPriority"| projectMerged
```

### 示例块：Pattern P2（已有项目级宽表直对齐）

```mermaid
flowchart LR
  projectMerged["project_merged/ (existing artifacts)"] -->|"alignSpec + protectAllTags + dataTableOnly"| motherAligned["products/extracted/mother_table_aligned.csv (aligned)"]
```

### 示例块：Pattern P3（直连历史库查询对齐）

```mermaid
flowchart LR
  historianQuery["historian_query(tags,time_range)"] -->|"timeAlign+resample + tagNormalize"| alignedWide["aligned_wide_table.csv"]
  alignedWide -->|"alignSpec + protectAllTags + dataTableOnly"| motherAligned["products/extracted/mother_table_aligned.csv (aligned)"]
```

## 3.2 节点说明
| 节点 | 含义 | 生成方式 | 负责人 | 版本/日期 |
|---|---|---|---|---|
| raw_history_exports/ | ${RAW_HISTORY_DESC} | 原始导出（可选：按月/按系统） | - | - |
| history_merged/ | ${HISTORY_MERGED_DESC} | concat+dedup（仅对 Pattern P1 常见） | - | - |
| project_merged/ | ${PROJECT_MERGED_DESC} | outer join + priority + tagNormalize | - | - |
| mother_table_aligned.csv | ${MOTHER_DESC} | alignSpec（对齐母表） | - | - |

---

# 4. 合并契约 (Merge Contract)

## 4.1 合并主键与方式
- 合并主键：${MERGE_KEY}（如时间列）
- 合并方式：outer join / left join / union all

## 4.2 冲突优先级（同 Tag + 同时间）
必须明确一条“可复现规则”：
- 优先级顺序：${PRIORITY_ORDER}
- 填空策略：${FILL_STRATEGY}（如“历史优先，补充填空”）

## 4.3 去重规则（同时间多行）
- 去重字段：${DEDUP_FIELDS}
- 保留策略：keep=first/last 或聚合（avg/median）

## 4.4 编码与单位
- 编码：${ENCODING_POLICY}
- 单位统一：${UNIT_POLICY}

---

# 5. 质量审计摘要 (Quick Audit)

| 检查项 | 结果 | 备注 |
|---|---|---|
| 时间列可解析率 | ${TIME_PARSE_RATE} | - |
| 重复时间点比例 | ${DUP_TIME_RATE} | - |
| 缺失率Top10通道 | ${MISSING_TOP10} | - |
| 多源重叠通道数 | ${OVERLAP_TAGS} | - |

---

# 6. 示例链路（可选，用于展示写法）
示例链路（仅用于展示结构，不要依赖任何特定项目路径）：
- Pattern P1：`lab/data/raw_history_exports/*` → `lab/data/history_merged/*` → `lab/data/project_merged/*` → `products/extracted/mother_table_aligned.csv`
- Pattern P2：`lab/data/project_merged/*` → `products/extracted/mother_table_aligned.csv`
- Pattern P3：`historian_query(...)` → `lab/data/aligned_wide_table.csv` → `products/extracted/mother_table_aligned.csv`
