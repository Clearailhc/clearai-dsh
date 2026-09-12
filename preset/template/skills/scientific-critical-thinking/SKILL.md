---
name: scientific-critical-thinking
description: |
  【调研·证据质量】评估研报、论文、环评、工艺手册等证据的可信度与偏倚。适用：交叉验证 web_search 结果、评级券商研报与学术来源、识别混杂与夸大结论。不适用：撰写正式同行评审（无此需求）；系统文献综述流程（用 literature-review）。
license: MIT license
metadata:
  version: 1.1-clearai
  skill-author: K-Dense Inc. (adapted for ClearAI)
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.410558+00:00'
---

# 科学批判性思维 Skill（ClearAI 版）

## 使用边界

- **适用**：审查调研来源质量；评估「某工艺参数/某 AI 案例」证据是否充分；售前材料事实核查。
- **不适用**：完整 PRISMA 综述 → `literature-review`；直接产出预研报告 → `domain-presearch` / `process-presearch`。

## ClearAI 工具与路径映射

- 广度发现 → `web_search`；关键原始网页 → `web_fetch` 逐页核验（不浏览全部结果）
- 用户/已下载材料 → `read` / `read`
- 评审记录 → `write` 到 `lab/knowledge/evidence_review.md`
- 框架图（可选）→ markdown mermaid，落盘 `lab/diagrams/`
- 经验回写 → `clear/memory/critical_thinking_lessons.md`

## 核心能力

### 1. 方法论评审

- 研究设计是否支持因果主张？
- 内部/外部/构念/统计效度
- 对照、盲法、测量工具是否可靠

详见 `references/scientific_method.md`、`references/experimental_design.md`。

### 2. 偏倚识别

- 确认偏倚、HARKing、发表偏倚、行业赞助偏倚
- 常见形态：选择性汇报指标、个案泛化、把相关当因果

详见 `references/common_biases.md`。

### 3. GRADE / 证据分级（简化口径）

| 等级 | 含义 | 调研动作 |
|------|------|--------------|
| 高 | 多源一致、可复核 | 可写入报告正文 |
| 中 | 单源权威或部分复核 | 标注来源，建议交叉验证 |
| 低 | 推断、媒体转述 | 标 `[推断]` 或 `[信息缺失]` |

详见 `references/evidence_grading.md`。

### 4. 统计有效性快检

- 样本量、多重比较、P-hacking 风险
- 效应量是否有工程意义（不只是 p<0.05）

详见 `references/statistical_pitfalls.md`。

## 工作流

1. 列出待审查声明（来自预研草稿或 `web_search` 候选摘要）
2. 对承重声明用 `web_fetch` 打开原始来源核验语境，再标注证据类型（P0–P5）
3. 应用 GRADE 或偏倚清单降级/升级
4. 输出 `lab/knowledge/evidence_review.md`：声明 | 证据 | 等级 | 建议

## 图示（可选）

仅当用户明确要求时生成 GRADE/偏倚决策图；**不**依赖外部 schematic API。
