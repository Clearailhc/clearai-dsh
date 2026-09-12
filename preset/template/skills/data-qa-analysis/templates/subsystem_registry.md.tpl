# 子系统登记表 (Subsystem Registry)

> 目的：把“一个大系统如何拆分为多个子系统（按输入/负荷）”与“代价资源规格的消耗方覆盖检查”固化为可审计口径。
> 本文件一旦确认，将作为后续 `workflow04`（单位代价/外推/波动）的唯一边界与口径约束。

## 0. 基本信息

- **系统/观测段名称**：${SYSTEM_NAME}
- **登记日期**：${DATE}
- **负责人**：${OWNER}
- **稳态数据输入**：`products/extracted/steady_state_table.csv`
- **口径来源**：`products/extracted/unit_inventory.md`、`products/extracted/tag_map.csv`、`products/extracted/entity_map_enriched.json`

---

## 1. 代价资源口径（Primary Cost Driver Spec，必填）

- **资源类型**：${COST_MEDIUM}（power / coolant / reagent / compute / ...）
- **资源规格/等级**：${COST_GRADE}（例如 power@kW / reagent@gradeA / compute@GPUh）
- **消耗量 Q 定义**：${Q_DEFINITION}（单点/多点求和/换算规则）
- **单位**：${Q_UNIT}
- **净值规则**：${NET_RULES}（是否扣除回收/旁路/内循环等）

---

## 2. 子系统列表（按输入/负荷拆分，必填）

| subsystem_id | subsystem_name | 输入/负荷 tags（负荷口径） | unit 清单（边界内） | 备注 |
|-------------|----------------|----------------------------|---------------------------|------|
| S1 | ${SUBSYSTEM_1_NAME} | ${SUBSYSTEM_1_LOAD_TAGS} | ${SUBSYSTEM_1_UNITS} | ${SUBSYSTEM_1_NOTE} |
| S2 | ${SUBSYSTEM_2_NAME} | ${SUBSYSTEM_2_LOAD_TAGS} | ${SUBSYSTEM_2_UNITS} | ${SUBSYSTEM_2_NOTE} |

> **拆分依据（必填）**：说明为何需要拆分，并写出判定证据。建议至少覆盖以下通用原则：
> - **入口位置原则（强烈建议默认采用）**：若不同输入进入不同的“直接接收单元/入口位置”（例如分别进入不同处理单元/不同实验线路），则应拆分为不同子系统（每路输入对应一个子系统），避免把不同入口的系统硬合并造成口径错误。
>   - 证据优先来自上游结构 skill 输出的“输入去向映射表”（Feed → DirectReceivingUnit）与 `products/extracted/entity_map_enriched.json` 的边界输入边（Boundary_Feed_* → Unit）。
> - **互斥/分模式原则**：若多路输入在稳态数据中明显互斥（A 开时 B 基本为 0），应拆分为不同 mode/subsystem。
> - **合并的例外条件**：只有在能证明输入在上游很快汇合并共享同一套主要代价资源/主要单元链路时，才允许合并，并必须说明为何不会导致口径缺路或重复计入。
${SPLIT_RATIONALE}

---

## 3. 子系统负荷与系统总计规则（必填）

### 3.1 子系统负荷定义

对每个子系统写清楚：
- **L_s(t) 公式**：${LOAD_FORMULA}
- **多路输入合并规则**：sum / mode / other
- **互斥/并行判断**：${MUTUAL_EXCLUSION_RULE}

### 3.2 系统总计规则

- **L_total(t)**：${L_TOTAL_RULE}
- **Q_total(t)**：${Q_TOTAL_RULE}
- **共享项分摊/不分摊**：${ALLOCATION_RULES}（若无法分摊，必须标注风险）

---

## 4. 资源规格“消耗方覆盖完整性检查”（必填）

> 目标：确保所有“使用该资源规格”的单元都纳入 Q 统计，避免漏项（例如某些单元使用同一规格电力/试剂但未计入总量）。

### 4.1 expected_consumers（理论应计入）

来源：`products/extracted/unit_inventory.md` 的 `energy_interfaces`（资源接口）与/或 `products/extracted/entity_map_enriched.json` 的 resource edges。
| unit | resource_interface | medium@grade | 证据位置 |
|-----------|------------------|--------------|----------|
| ${UNIT_1} | ${IFACE_1} | ${GRADE_1} | ${EVID_1} |

### 4.2 metered_consumers（实际已计量并纳入 Q）

来源：`products/extracted/tag_map.csv`（资源边/节点对应 tag）。
| unit | q_tag(s) | unit | 来源/置信度 |
|-----------|----------|------|-------------|
| ${UNIT_1} | ${TAG_1} | ${UNIT} | ${SRC} |

### 4.3 缺口与处理

| unit | 缺口类型 | 影响 | 处理建议 |
|-----------|----------|------|----------|
| ${UNIT_X} | Unmetered / TagMissingInMotherTable / ObjectNotConfirmed | ${IMPACT} | ${ACTION} |

> **结论（必填）**：覆盖是否完整？若不完整，是否允许继续计算（需在 `products/extracted/consumption_summary.md` 与后续改进空间测算中标注风险）？
${COVERAGE_CONCLUSION}

---

## 5. 按子系统的资源计入规则（必填）

对每个子系统说明：
- 纳入哪些 unit 的资源消耗（与覆盖检查一致）
- 若有共享计量表/共享设施：如何分摊到子系统（或不分摊）

---

## 6. 确认记录（闸门）

- **确认日期**：${CONFIRM_DATE}
- **确认人**：${CONFIRMER}
- **结论**：[ ] 通过 / [ ] 需修改
- **变更记录**：${CHANGELOG}
