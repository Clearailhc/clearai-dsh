# Workflow 2: 质量审计与物理一致性 (Quality & Consistency)

## 目标
评估数据不仅要"干净"，还要"物理正确"。检查时序对齐、机理守恒和数据质量。

## 步骤

### Step 1: 时序对齐检查 (Synchronization)
> **取证要求**：本步骤所有数值须先通过 read/bash 从源数据取得，并标注 `来源: <path>`；无法取得则写「待确认」。
**痛点**: 观测通道采样频率不同（1s vs 1min），或来自不同采集系统（不同仪器/平台）导致时间戳偏差。
1. **频率分析**: 统计各关键变量的平均采样间隔 `dt`。
2. **对齐策略**:
   - 如果 `dt` 差异大，建议重采样 (Resample) 到统一时间网格。
   - 检查是否存在时钟漂移 (Drift) 或时区不一致。

### Step 2: 物理一致性校验 (Physical Consistency)
**思考**: 数据是否违反了物理定律或量纲常识？
1. **范围约束**:
   - `0 <= 百分比/占空比 <= 100%`
   - `绝对温度 / 浓度 / 计数 >= 0`
2. **守恒/平衡关系**:
   - **物质平衡**: `Sum(Inflow) - Sum(Outflow) ≈ d(Storage)/dt`。
   - **能量平衡**: 输入功率应与升温速率正相关。
3. **死值检测 (Frozen Signals)**:
   - 观测通道读数长时间完全不变（方差为0），通常意味着断线或采集卡死。

### Step 3: 数据质量评分
> **取证要求**：本步骤所有数值须先通过 read/bash 从源数据取得，并标注 `来源: <path>`；无法取得则写「待确认」。
1. **完整性**: 缺失率。
2. **准确性**: 物理越限率。
3. **一致性**: 违反守恒/平衡关系的样本比例。

### Step 4: 产出落地
- 更新 `products/extracted/data_quality_report.md`。
- 更新 `products/extracted/domain_knowledge.md` 的「九、误差来源与不确定性」（结构参考 `templates/domain_knowledge_template.md.tpl`）。
- 生成清洗规则建议 `products/extracted/cleaning_rules.yaml`。
