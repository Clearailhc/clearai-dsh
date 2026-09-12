# Workflow 4: 非结构化知识挖掘 (Unstructured Mining)

## 目标
从实验记录、运行日志、维护记录、专家访谈记录等文本数据中，提炼出结构化的专家规则和异常模式。

## 步骤

### Step 1: 文本预处理与分类
1. **分类**: 区分是"操作记录"（我做了什么）、"现象描述"（看到了什么）还是"原因分析"（为什么）。
2. **关键词提取**: 提取对象名、异常现象（"漂移"、"噪声异常"）、操作动作（"更换"、"重启"、"重新标定"）。

### Step 2: 规则提取 (Rule Extraction)
**目标**: 提取 **If-Then** 规则。
1. **模式匹配**: 寻找 "当...时"、"导致"、"因为" 等连接词。
2. **结构化**:
   - Condition: `P_inlet < 0.5` (从文本 "入口压力低" 映射到变量)
   - Action: `Check Filter` (从 "检查滤网" 提取)
   - Consequence: `Flow Rate Drop`

### Step 3: 异常模式库构建
1. **聚类**: 将相似的异常描述归为一类。
2. **统计**: 计算各类异常的发生频率（平均间隔时间）和平均处理时长。

### Step 4: 产出落地
- 更新 `products/extracted/domain_knowledge.md` 的「七、特殊业务逻辑」（结构参考 `templates/domain_knowledge_template.md.tpl`）。
- 生成 `products/extracted/expert_rules.json`。
