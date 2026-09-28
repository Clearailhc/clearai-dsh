#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「族 → 成员 id 对照表」，供报告 §1.3 就地核对「每族典型样本 ≥2 条」。

只读 lab/data/structure_matrix.csv 的 primary_family 列，不做判断。
输出追加到 lab/data/family_map.md，由调用方插入报告正文（正文区不会被附录生成器覆写）。
"""
import csv, os
ROWS = os.path.join("lab", "data", "structure_matrix.csv")
OUT = os.path.join("lab", "data", "family_map.md")

def build() -> str:
    rows = list(csv.DictReader(open(ROWS, encoding="utf-8-sig")))
    by = {}
    for r in rows:
        fam = (r.get("primary_family") or "").split()[0]
        if fam:
            by.setdefault(fam, []).append(f"{r['id']} {r['name']}")
    L = ["#### 1.3.2 族 → 成员 id 对照表（机器生成）", "",
         "> 本表由 `lab/scripts/build_family_map.py` 从 `lab/data/structure_matrix.csv` 的 `primary_family` 列直接生成，"
         "**可复跑** **`[非URL来源]`**。用途：让 §1.3 的「每族典型样本 ≥2 条」**可被就地核对**，不必反查附录 B。", "",
         "| 族（权威名） | 成员数 | 成员（id 名称） | 是否达立族门槛（≥2） |", "|---|---|---|---|"]
    for f in sorted(by, key=lambda k: (-len(by[k]), k)):
        mem = by[f]
        L.append(f"| {f} | {len(mem)} | " + "、".join(mem) + f" | {'✓ 达' if len(mem) >= 2 else '**✗ 不达——已降级为边缘现象**'} |")
    L += ["", f"> **合计**：{len(by)} 个族编号、{sum(len(v) for v in by.values())} 条样本；"
          f"其中不达门槛者：{'、'.join(f for f in by if len(by[f]) < 2)}。", ""]
    return "\n".join(L)

if __name__ == "__main__":
    c = build()
    open(OUT, "w", encoding="utf-8").write(c)
    print(f"已生成 {OUT}（{len(c.splitlines())} 行）")
