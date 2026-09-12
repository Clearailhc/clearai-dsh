---
name: citation-management
description: |
  【引用管理·BibTeX】检索论文元数据、DOI→BibTeX、校验与去重。适用：预研/综述报告文末引用统一、交付前引用准确性检查。不适用：全文综述撰写（用 literature-review）；一般网页来源（用 web_search sources 标注）。
license: MIT license
metadata:
  version: 1.0-clearai
  skill-author: K-Dense Inc. (adapted for ClearAI)
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.406842+00:00'
---

# 引用管理 Skill（ClearAI 版）

## 使用边界

- **适用**：构建/清洗 `references.bib`；验证 DOI/PMID；报告交付前引用去重与格式统一。
- **不适用**：替代 `paper-lookup` 做大规模检索；非学术网页引用（用手动 `[N]` 列表）。

## ClearAI 工具与路径映射

- 元数据获取 → `bash`（CrossRef/PubMed API，见 `scripts/` 若已复制）
- BibTeX 库 → `lab/knowledge/references.bib`
- 校验报告 → `lab/knowledge/citation_audit.md`
- 正式报告引用 → `products/reports/*.md` 文末 `[N]` + bib 键对应
- 经验回写 → `clear/memory/citation_management_lessons.md`

## 工作流

### 1. 收集待引用项

从 `literature-review`、`domain-presearch` 草稿提取 DOI/标题/URL。

### 2. 元数据解析

- DOI → CrossRef（`curl https://api.crossref.org/works/{doi}`）
- PMID → PubMed E-utilities
- 无 DOI：用 `paper-lookup` 或 `web_search` 补全

### 3. 生成 BibTeX

```bibtex
@article{key2024,
  title = {...},
  author = {...},
  journal = {...},
  year = {2024},
  doi = {...}
}
```

写入 `lab/knowledge/references.bib`，键名规范：`AuthorYearKeyword`。

### 4. 校验

- 作者/年份/期刊与原文一致
- 重复键合并
- 缺失 DOI 标注待补

### 5. 与报告对齐

- Markdown 正文 `[N]` 与 bib 键一一映射
- 交付前输出 `lab/knowledge/citation_audit.md`：通过/待修/删除

## 常用 bash 片段

```bash
# CrossRef DOI lookup
curl -s "https://api.crossref.org/works/10.XXXX/yyyy" | python -m json.tool
```

更多脚本见已复制 `scripts/` 目录（按需调整输出路径到 `lab/knowledge/`）。
