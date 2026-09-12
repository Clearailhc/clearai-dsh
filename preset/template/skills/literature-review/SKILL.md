---
name: literature-review
description: |
  【文献综述·系统检索】按 PRISMA 思路做多库检索、主题综合与引用核验。适用：研究主题的系统性文献梳理、技术路线证据链。不适用：售前企业快研（用 domain-presearch）；单篇 DOI 查找（用 paper-lookup）。
license: MIT license
metadata:
  version: 1.0-clearai
  skill-author: K-Dense Inc. (adapted for ClearAI)
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.409207+00:00'
---

# 文献综述 Skill（ClearAI 版）

## 使用边界

- **适用**：需系统性梳理某技术/工艺/行业的学术与工程文献；撰写 `products/reports/literature_review.md`。
- **不适用**：快速企业预研 → `domain-presearch`；仅查几篇论文 → `paper-lookup`。

## ClearAI 工具与路径映射

- 广度检索 → `web_search`（领域/学术关键词，标注 sources）
- 关键来源核验 → `web_fetch`（只打开关键原始落地页、摘要页或公开附件，不浏览全部结果）
- 学术 API 检索 → `bash` + `paper-lookup` 参考（`references/`）
- 综述正文 → `write` 到 `products/reports/literature_review.md`
- 检索日志 → `lab/knowledge/lit_search_log.md`
- 引用库 → `lab/knowledge/references.bib`（配合 `citation-management`）
- PRISMA 图 → mermaid → `lab/diagrams/`
- 经验回写 → `clear/memory/literature_review_lessons.md`

## 来源优先级（对齐 domain-presearch）

P0 标准/手册 > P1 学术论文 > P2 专利 > P3 企业公开 > P4 行业报告 > P5 推断

## 工作流

### Phase 1：规划

- 明确研究问题（PICO 变体：Process / Intervention / Comparison / Outcome）
- 确定综述类型：叙述性 / 系统性 / 范围综述
- 时间、地域、文献类型边界

### Phase 2：检索

- `web_search` 多组并行关键词（中英文）
- 对纳入结论承重的候选，用 `web_fetch` 核验题名、作者、摘要、出处与公开附件语境
- 深度学术需求：`read` `paper-lookup/SKILL.md` 并按 `references/` 调用 API（`bash` curl）

检索策略见 `references/search_strategies.md`（若已复制）。

### Phase 3：筛选与综合

- 纳入/排除标准；记录于 `lab/knowledge/lit_search_log.md`
- 主题归类：方法、效果、局限、应用案例

### Phase 4：引用核验

加载 `citation-management`：DOI 校验、BibTeX 去重

### Phase 5：撰写与自检

- 输出 `products/reports/literature_review.md`
- 文末可点击来源列表 `[N]`
- 可选 PRISMA 流程 mermaid

## 交付清单

- [ ] 研究问题与检索式已记录
- [ ] 纳入文献表（标题、年份、来源、相关性）
- [ ] 综合结论与证据空白
- [ ] 引用与 `references.bib` 一致
