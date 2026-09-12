# Workflow 1: 深度数据画像与过程还原 (Deep Data Understanding)

## 目标
超越简单的数据统计，建立对数据背后真实系统的"数字孪生"认知。还原数据生成过程，映射真实实体，理解运行/实验模式。

## 步骤

### Step 1: 多维数据接入与概览
> **取证要求**：本步骤所有数值须先通过 read/bash 从源数据取得，并标注 `来源: <path>`；无法取得则写「待确认」。
1. **结构化时序数据**：使用 `read` 读取 Header 和样本行，识别时间戳、变量名、Value。
2. **离散事件/日志**：读取告警记录、操作/实验日志，识别 EventType, Message。
3. **元数据/清单**：如果有，读取观测通道清单、仪器/设备清单或样本清单。

### Step 2: 实体映射 (Entity Mapping)
**思考**: 这个变量代表什么真实含义？它属于哪个观测对象？
1. **语义推断**: 从变量名 (e.g., `site3_temp_02`) 推断：
   - `temp` -> Temperature (温度类观测)
   - `02` -> 通道/仪器编号
   - `site3` -> 站点/分组
2. **角色分类**:
   - **控制变量 (Controlled)**: 设定值、实验条件、干预输入。
   - **观测变量 (Observed)**: 实际测量/反馈值。
   - **关键结果 (Outcome)**: 结果指标、目标量。

### Step 3: 过程还原 (Process Mining)
**思考**: 对象是如何流转的？状态是如何变迁的？
1. **阶段识别 (Stage Identification)**:
   - 观察关键状态变量（如功率、温度、活动量）的突变点。
   - 定义阶段：`Idle` -> `Ramping` -> `Stable` -> `Cooling`。
2. **批次/轮次切分 (Batch Segmentation)**:
   - 如果是分批/分轮次采集，寻找开始/结束信号（如 `Run_Start` 标记，或某状态量从 0 突变）。
   - 将连续时间序列切分为 Batch/Run 片段。

### Step 4: 运行状态识别 (Regime Detection)
1. **稳态 vs 瞬态**: 区分系统是在稳定运行还是在转换状态。
2. **多状态聚类**: 是否存在不同的运行/实验模式（如：条件 A vs 条件 B）？
   - 依据：设定值/实验条件的不同组合。

### Step 5: 产出落地
- 填写 `products/extracted/domain_knowledge.md` 的「一、业务背景与目标」与「二、系统与对象结构」（结构参考 `templates/domain_knowledge_template.md.tpl`）。
- 生成 `products/extracted/tag_entity_map.json`（变量 → Entity 映射表；与流程拓扑 `entity_map.json` 分离）。
- 生成或更新 `products/extracted/data_dictionary.md`（结构参考 `templates/data_dictionary.md.tpl`，含变量/字段含义与单位）。
