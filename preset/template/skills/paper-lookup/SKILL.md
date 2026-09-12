---
name: paper-lookup
description: |
  【论文检索·学术 API】通过 REST API 查 PubMed/arXiv/OpenAlex/Crossref 等学术库。适用：DOI/PMID 解析、论文元数据、引用关系、开放获取链接。不适用：行业快研与商业信息（用 web_search + domain-presearch）；完整综述流程（用 literature-review）。
license: MIT license
metadata:
  version: 1.0-clearai
  skill-author: K-Dense Inc. (adapted for ClearAI)
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.409595+00:00'
---

# Paper Lookup Skill（ClearAI 版）

## 使用边界

- **适用**：需要学术论文元数据、DOI 互转、预印本、引用图；补充 `web_search` 的学术精度。
- **不适用**：替代 `web_search` 做行业新闻/企业情报；不单独产出完整综述。

## ClearAI 工具与路径映射

- API 调用 → `bash`（`curl` / Python `requests`），脚本可放 `lab/scripts/`
- 结果落盘 → `lab/knowledge/paper_lookup_results.json`
- 与综述衔接 → 供 `literature-review` / `citation-management` 消费
- 经验回写 → `clear/memory/paper_lookup_lessons.md`

## 核心工作流

1. **理解查询**：主题检索 / 特定 DOI / 作者 / OA PDF？
2. **选库**：见下表；详 endpoint 见 `references/` 各库文件
3. **并行查询**：独立库可用同轮多个 `bash`
4. **返回**：原始 JSON + 已查库列表 + 无结果须显式说明

## 数据库选择（摘要）

| 意图 | 主库 | 补充 |
|------|------|------|
| 生物医学主题 | PubMed | Semantic Scholar, OpenAlex |
| 物理/数学/CS 预印本 | arXiv | OpenAlex |
| 跨学科 | OpenAlex | Crossref, Semantic Scholar |
| DOI 元数据 | Crossref | Unpaywall |
| 开放获取链接 | Unpaywall | PMC, CORE |
| 引用关系 | Semantic Scholar | OpenAlex |

## 标识符

| 类型 | 示例 |
|------|------|
| DOI | `10.1038/nature12373` |
| PMID | `34567890` |
| arXiv | `2103.15348` |

## 与 web_search 分工

- 行业案例、企业动态、中文工艺资讯 → `web_search`
- 论文题名、摘要、DOI、引用链 → 本 Skill

详细 API 示例见 `references/pubmed.md`、`references/crossref.md` 等（已从上游复制）。
