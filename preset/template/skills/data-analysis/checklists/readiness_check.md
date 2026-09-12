# 建模准入自检清单 (Readiness Checklist)

> 在宣布分析完成并建议进入 Modeling 阶段前，必须通过以下所有检查。

## 1. 物理语义自检
- [ ] 所有字段的 **物理单位** 已确认且合理（如：没有出现“负的绝对温度”）。
- [ ] 已识别出 **Business Keys**（如批次号、样本编号、会话 ID），并验证了其唯一性。
- [ ] 已确认数据的 **采样频率**，并评估其是否足以捕捉目标过程（奈奎斯特定理）。

## 2. 数据质量自检
- [ ] **Data Dictionary** 已生成且完整。
- [ ] `products/extracted/data_quality_report.md` 已生成，且无致命数据质量缺陷。
- [ ] 所有识别出的异常模式（卡死、丢包）都有对应的 **Cleaning Rule** 建议。

## 3. 建模可行性自检
- [ ] 已识别出至少 1 个 **Target** (预测目标) 和 3 个以上的强相关 **Features**。
- [ ] 已评估数据量是否满足建模需求（如：复杂模型至少需要 1000+ 样本）。
- [ ] 已明确区分 **训练集** 和 **测试集** 的划分策略（如：按时间切分，而非随机 Shuffle）。

## 4. 交付物完整性
- [ ] `products/extracted/domain_knowledge.md` 已汇总各 workflow 章节
- [ ] `products/extracted/analysis_report.md` 包含四大维度视角的分析结论。
- [ ] `products/extracted/feature_candidates.json` 包含机理特征建议。
