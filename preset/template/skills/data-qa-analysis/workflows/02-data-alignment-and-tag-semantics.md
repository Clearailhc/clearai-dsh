# Workflow 2: 数据对齐与通道语义 (Data Alignment & Tag Semantics)

## 目标
把“能算”的数据变成“算得对”的数据：
- 时间戳可对齐、可去重、可定义连续性
- 通道名可统一、可匹配到语义与单位
- 多源数据可合并且冲突规则清晰

> **前置依赖**：必须先完成本 skill 的 `workflows/01-data-source-inventory-and-lineage.md`，明确“对齐母表规格（Spec）”与合并契约；并已具备上游结构 skill 的 `products/extracted/unit_inventory.md`（存在性三态）与 `products/extracted/entity_map.json`（单元级结构骨架，topology-only）。

## 步骤

### Step 1: 时间列识别与解析（Time Contract）
必须明确：
- 时间列字段名（通常为第 2 列）
- 时区与格式（`YYYY-MM-DD HH:MM:SS` 等）
- 非法时间处理（`errors='coerce'` → NaT → 后续剔除/回溯）
- 采样频率（1min/5min/1h），以及对“连续”的定义（如相邻间隔 ≤ 30min）

### Step 2: 重复时间点处理（Dedup）
常见原因：
- 导出重复
- 多文件拼接重复
- 通讯重传

规则必须写清楚：
- `drop_duplicates(subset=[timestamp], keep='first')` 或 `keep='last'`
- 如同一时间点来自多源，按 `merge_contract` 的优先级处理

### Step 3: 多行表头（元数据层）处理
如果表格存在“多行表头”（描述/要点/方案/设计值/告警限等），建议拆成两层：
- **元数据层 header_meta**：通道 → 描述/单位/量程/设计值/告警限/来源
- **数据层 data_table**：时间点 → 通道值

后续处理要确保：
- 表头行在输出中**整体保留**（若业务需要）
- 或以结构化元数据文件输出（推荐，便于治理）

### Step 4: 通道名归一化（Tag Normalization）
推荐最小归一化规则：
- 分隔符统一：`-` → `_`
- 后缀忽略：`.PV/.MV/.OUT/.VALUE/.SP/.OP` 等按需去除
- 大小写统一：建议 upper

> **注意**：后缀忽略只用于“匹配/映射”，不建议直接丢弃在最终列名中（否则 PV/MV/OUT 可能混淆）。

### Step 5: 通道语义来源优先级（Description Priority）
为每个通道填充“物理含义/单位/量程/来源”，建议优先级如下（从高到低，项目可调整）：
1. **权威通道清单/测点清单**（如仪器台账、传感器部署表、数据集官方 codebook）
2. **历史 CSV 的描述行**（常见结构：第 1 行通道名、第 2 行描述）
3. **报警/事件统计表、补充通道信息表**
4. **实验方案/操作说明文本抽取/AI 摘要**（必须标注来源路径与置信度）

### Step 6: 生成数据字典与清洗规则草案
输出：
- `products/extracted/data_dictionary.md`（通道、含义、单位、类型、频率、量程、备注）
- `products/extracted/cleaning_rules.yaml`（物理越限、冻结值、重复时间点、短缺口填补策略等）
- `products/extracted/missing_tags.md`（缺失/未匹配通道清单 + 建议补齐路径）

#### 6.1 通道“缺失/未匹配”的类型（必须区分）
为了避免把“没有列”与“有列但没值”混为一谈，必须把缺失拆开统计：
0. **存在性未确认（ObjectNotConfirmed）**：来自上游结构 skill 的 `products/extracted/unit_inventory.md` 中，条目为 **State_C（未确认存在）** 的观测单元/流转关系/产物。
   - 这类问题是“系统侧证据不足”，不是“通道缺失”，禁止在此阶段写成“无测量通道”。
   - 处理动作：回到上游结构 skill 补证据（系统叙述/结构图/设备或仪器清单/下游去向证据），把条目提升到 State_A 或 State_B 后再进入测量匹配。
1. **Schema 缺失（列缺失）**：母表中没有某个关键通道列（Tag 不存在）→ 属于对齐/合并问题，必须在此 workflow 解决。
2. **语义缺失（描述/单位缺失）**：列存在但没有可靠的含义/单位/量程 → 属于元数据治理问题，必须在此 workflow 补齐或标注来源等级。
3. **数据缺失（值缺失/NaN）**：列存在但某些时间段缺值 → 属于数据质量与稳态齐全性问题，需在 `workflows/03-steady-state-identification.md` 按连续段检查与处理。

建议在 `products/extracted/missing_tags.md` 中按上述各类分别输出清单与处理建议。

#### 6.2 “叙述口径 vs 测量口径”强制对齐（设备编号≠测量通道）
在很多观测/实验项目中，资料常以“设备/环节编号”描述（例如“由某泵输送样品/由某加热模块控温”），但数据计算必须以**实际测量通道**为准（流量计/温度计/计数器/功率计等）。

必须产出一份“测量口径映射”（建议以 `products/extracted/tag_map.csv` 与 `products/extracted/entity_map_enriched.json` 表达）：
- 资料对象（设备/环节/流转关系/资源注入） → 测量通道（流量/温度/压力/累计量/功率/计数等）
- 并指明“指标口径的唯一合法来源”（metric-of-record）：例如负荷口径必须使用流量计通道，而非设备运行信号

**存在性闸门（必须）**：
- 仅当对象在 `products/extracted/unit_inventory.md` 中为 **State_A/State_B** 时，才允许进入“测量通道匹配/metric-of-record 确认”。
- 若对象为 **State_C**，在 `products/extracted/missing_tags.md` 中归类为 **ObjectNotConfirmed**，并回到上游结构 skill 补证据；禁止将其写成“无测量通道/需要代理”。
- 若对象为 **State_A/State_B** 但确实无法匹配到任何测量通道，才允许将其标注为“**可能无测量通道（候选代理待定）**”，并给出候选代理规则与证据链（例如：累计量替代瞬时速率、下游合并通道替代、功率/状态信号作为弱代理等）。

> **Rule**：任何 KPI/单位代价/标杆计算，必须引用该映射中的“metric-of-record”通道；禁止直接用设备编号/环节编号替代测量通道。

#### 6.3 基于结构骨架补齐通道（Topology Enrichment）
输入：
- `products/extracted/entity_map.json`（来自上游结构 skill，节点=观测单元+支持设施，边=物质或信号流/资源接口；不含通道号）
- `products/extracted/unit_inventory.md`（来自上游结构 skill，存在性三态）
- `products/extracted/mother_table_aligned.csv` 的列名（来自本 skill workflow01）与/或权威通道清单

目标：把结构图变成“能计算”的映射，并进行可用性校验：
- **对每条物质/信号流边（material edge）**：补齐 `flow_tag`（优先流量/累计量类通道）与单位；必要时补齐 `composition_tags`（可选）。
- **对每条资源边（resource edge）**：补齐 `power_tag` / `coolant_flow_tag` / `reagent_usage_tag` 等，并标注规格/单位（如适用）。
- **对每个单元节点（unit node）**：按项目需要补齐 `temp_tag` / `pressure_tag` / `level_tag` / `status_tag` 等（用于稳态判据或诊断）。

校验（必须）：
- 补齐的每个 tag 必须能在母表列名或通道清单中找到；找不到则进入 `products/extracted/missing_tags.md`，并按本 workflow 的缺失类型分类输出。
- 若某对象在 `products/extracted/unit_inventory.md` 为 State_C，则该对象的任何“边/节点补齐”都应停下并归类为 `ObjectNotConfirmed`（不得写成无测量通道）。

输出（新增）：
- `products/extracted/tag_map.csv`：一行一个 mapping（对象/边/节点 → tag → role → 单位/来源/置信度）
- `products/extracted/entity_map_enriched.json`：在 `products/extracted/entity_map.json` 的 nodes/edges 上补齐 tags 与 role（用于自动校验与下游计算）

## 产出物
- `products/extracted/data_dictionary.md`（建议使用模板：`templates/data_dictionary.md.tpl`）
- `products/extracted/cleaning_rules.yaml`（建议使用模板：`templates/cleaning_rules_draft.yaml.tpl`）
- `products/extracted/missing_tags.md`
- `products/extracted/tag_map.csv`（结构补齐后的测量口径映射）
- `products/extracted/entity_map_enriched.json`（topology + tags）

## 闸门（确认后进入下一 Workflow）
在进入 `workflows/03-steady-state-identification.md`（稳态识别）或任何 KPI/单位代价/标杆计算前，必须确认本 workflow 产出无误，并在 `products/extracted/data_dictionary.md` 或 `products/extracted/missing_tags.md` 末尾追加“确认记录”（日期/确认人/结论/疑点与后续动作）。最少确认：
- **强制产出物是否齐全**：`products/extracted/data_dictionary.md`、`products/extracted/cleaning_rules.yaml`、`products/extracted/missing_tags.md`、`products/extracted/tag_map.csv`、`products/extracted/entity_map_enriched.json` 是否都已生成且内容完整。
- 通道语义来源优先级已执行：权威通道清单/描述行/补充通道信息表等来源记录清晰、置信度合理。
- `products/extracted/missing_tags.md` 已区分 `ObjectNotConfirmed` 与 schema/语义/数据缺失，避免“存在性未确认”被误写成“无测量通道”。
- `products/extracted/tag_map.csv`/`products/extracted/entity_map_enriched.json` 的 metric-of-record 映射可用于计算，且能在母表列名/通道清单中验证存在。

## 示例（Example）
常见做法示例（仅展示方法，不依赖具体项目文件）：
- 通道清单/仪器台账/数据集官方 codebook 作为“通道语义与单位”的第一权威来源
- 历史 CSV 第二行常包含“描述行”，可作为语义补齐来源之一
- 多行表头建议拆为 `header_meta`（元数据）+ `data_table`（数据层），避免后续误读
