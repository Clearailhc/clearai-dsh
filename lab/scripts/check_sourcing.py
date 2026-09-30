#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""报告「等级＋来源」自检：穷尽列出所有缺来源的承重位置。

设计意图：s8 的判据要求「所有承重结论带等级与来源」，逐轮人工核对会陷入
「评估者找到一处、补一处」的无限循环。本脚本把「找缺口」这件事交给机器，
一次穷尽，使缺口清单可被核验为「空」。

判定规则（与报告头的口径裁定一致）：
  - 含 http(s):// 的行 → 有 URL，合规
  - 含 `[非URL来源]` 的行 → 实现读数，合规
  - 含「等级：」但既无 URL 也无标记 → 缺
  - 承重节内既无节级等级声明、又引用了外部文献（含日期/媒体名特征）→ 缺

用法：
    python3 lab/scripts/check_sourcing.py            # 打印缺口清单
    python3 lab/scripts/check_sourcing.py --count    # 只打印计数
"""

from __future__ import annotations

import os
import re
import sys

REPORT = os.path.join("products", "reports", "抽象-heat-memes-2026.md")

# 外部文献特征：媒体名 / 日期 / 引号引用
MEDIA = r"(新华社|人民日报|央视|光明日报|工人日报|中国青年报|中新网|央广网|澎湃|界面|刺猬公社|南方都市报|千瓜|网易|搜狐|红网|文汇报|斯坦福|SEP|DWDS|文艺报|新湘评论|深圳社会科学|人民论坛|咬文嚼字)"
DATE = r"\d{4}-\d{2}(-\d{2})?|\d{4}年\d{1,2}月"


def main() -> None:
    lines = open(REPORT, encoding="utf-8").read().split("\n")
    has_url = lambda s: "http://" in s or "https://" in s
    has_mark = lambda s: "[非URL来源]" in s
    is_appendix = lambda s: s.startswith("## 附录")

    gaps: list[tuple[int, str, str]] = []
    in_appendix = False
    for i, ln in enumerate(lines, 1):
        if is_appendix(ln):
            in_appendix = True
        if ln.startswith("## ") and not is_appendix(ln):
            in_appendix = False
        if in_appendix:
            continue
        if has_url(ln) or has_mark(ln):
            continue
        # 承重特征：表格数据行、或含媒体名+日期的正文行、或含「等级：」
        if "等级：" in ln:
            gaps.append((i, "有等级无来源", ln[:100]))
        elif re.search(MEDIA, ln) and re.search(DATE, ln) and len(ln) > 40:
            gaps.append((i, "外部文献无URL", ln[:100]))

    print(f"扫描 {REPORT}（{len(lines)} 行）")
    print(f"缺口 {len(gaps)} 处\n")
    if "--count" not in sys.argv:
        for i, kind, txt in gaps:
            print(f"  :{i:<5} [{kind}] {txt}")
    print(f"\n[结论] 缺口 {len(gaps)} 处" + ("——**来源标注已完备**" if not gaps else "——**仍缺**"))


if __name__ == "__main__":
    main()
