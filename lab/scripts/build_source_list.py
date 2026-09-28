#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从语料库生成报告的「附录 C：来源清单」。

与 build_report_appendix.py 同一架构约定：本脚本只做渲染，不做统计之外的判断。
数据源为 lab/data/meme_samples.csv 的 url 列——报告引用的每个来源都在这里。

用法：
    python3 lab/scripts/build_source_list.py     # 生成 lab/data/source_list.md
"""

from __future__ import annotations

import csv
import os
from collections import defaultdict
from urllib.parse import urlparse

SAMPLES = os.path.join("lab", "data", "meme_samples.csv")
OUT = os.path.join("lab", "data", "source_list.md")


def build() -> str:
    rows = list(csv.DictReader(open(SAMPLES, encoding="utf-8-sig")))
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        u = r["url"]
        key = "UNKNOWN（未取到正文）" if u == "UNKNOWN" else urlparse(u).netloc.replace("www.", "")
        groups[key].append(r)

    n_url = sum(1 for r in rows if r["url"] != "UNKNOWN")
    L = ["## 附录 C：来源清单", "",
         f"本报告引用的全部来源，按域名分组。语料库共 {len(rows)} 条，其中 **{n_url} 条带 URL**、"
         f"**{len(rows) - n_url} 条未取到正文**（如实标出，未以其他来源替代）。",
         "本清单由 `lab/scripts/build_source_list.py` 从语料库自动生成，复跑即校验。", ""]

    for d in sorted(groups, key=lambda k: (-len(groups[k]), k)):
        members = groups[d]
        if d.startswith("UNKNOWN"):
            L += [f"### 未取到正文（{len(members)} 条）", "",
                  "这些样本的证据等级最低，其标签判定应视为**待核**：" +
                  "、".join(f"{r['id']} {r['name']}" for r in members), ""]
            continue
        L += [f"### {d}（{len(members)} 条）", ""]
        seen: dict[str, list] = {}
        for r in members:
            seen.setdefault(r["url"], []).append(f"{r['id']} {r['name']}")
        for u, ids in seen.items():
            L.append(f"- <{u}> —— {len(ids)} 条：" + "、".join(ids))
        L.append("")
    return "\n".join(L) + "\n"


def main() -> None:
    content = build()
    open(OUT, "w", encoding="utf-8").write(content)
    print(f"已生成 {OUT}（{len(content.splitlines())} 行）")


if __name__ == "__main__":
    main()
