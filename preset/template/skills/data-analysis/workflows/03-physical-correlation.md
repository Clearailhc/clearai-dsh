# Workflow 3: 机理关联与因果发现 (Causal Discovery)

## 目标
挖掘变量间的机理因果关系，识别滞后效应，为后续建模筛选特征。

## 步骤

### Step 1: 滞后相关性分析 (Lag Correlation)
**痛点**: 扰动从输入传导到输出需要时间，直接相关性可能为 0。
1. **互相关函数 (CCF)**: 计算 `X(t)` 与 `Y(t+k)` 的相关系数，寻找最佳滞后 `k`。
2. **机理验证**: 滞后时间 `k` 是否与系统的传导/响应时间 (Response Time) 吻合？

### Step 2: 非线性关系探索
> **取证要求**：本步骤所有数值须先通过 read/bash 从源数据取得，并标注 `来源: <path>`；无法取得则写「待确认」。
1. **散点图矩阵**: 观察 X-Y 是否呈现线性、指数、S形或无规律。
2. **互信息 (Mutual Information)**: 捕捉非线性依赖。

### Step 3: 影响因子排序
针对关键结果指标 (如产率、误差率、能耗)：
1. 使用 **Random Forest** 或 **XGBoost** 计算特征重要性 (Feature Importance)。
2. 结合领域机理剔除"伪相关"（如：X 与 Y 同涨同跌，其实是共同受第三变量 Z 驱动的混杂效应，而非 X 导致 Y）。

### Step 4: 产出落地
- 生成 `products/extracted/feature_candidates.json`。
- 更新 `products/extracted/domain_knowledge.md` 的「十、数据关联规则」（结构参考 `templates/domain_knowledge_template.md.tpl`）。
