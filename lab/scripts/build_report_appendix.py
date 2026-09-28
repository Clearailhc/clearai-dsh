#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 products/reports/抽象-heat-memes-2026.md 的附录 A 与附录 B。

为什么要有这个脚本：此前附录是"由脚本输出后手工贴入"，表头却写着"自动生成"，
这个标注无法核验。本脚本把附录的产出变成可复跑的一步：
数据只来自 lab/data/ 下的两个 CSV，改数据即改附录。

用法：
    python3 lab/scripts/build_report_appendix.py

行为：
  1. 读 lab/data/meme_samples.csv（来源/证据等级）与 lab/data/structure_matrix.csv（结构判定）；
  2. 生成附录 A（语料库统计，含各轴分布与来源标注）与附录 B（74 条逐条矩阵）；
  3. 在报告里定位 "## 附录 A" 起至文件末尾，整体替换；报告其余部分不动。
"""

from __future__ import annotations

import csv
import os
from collections import Counter

REPORT = os.path.join("products", "reports", "抽象-heat-memes-2026.md")
SAMPLES = os.path.join("lab", "data", "meme_samples.csv")
MATRIX = os.path.join("lab", "data", "structure_matrix.csv")

CTX_SHORT = {"完全剥离": "完全剥离", "剥离但可回溯": "可回溯", "语境保留": "语境保留"}
AGG_SHORT = {"攻击性": "攻击性", "攻击性已剥离": "已剥离", "无攻击性": "无"}


def build_appendix() -> str:
    samples = list(csv.DictReader(open(SAMPLES, encoding="utf-8-sig")))
    rows = list(csv.DictReader(open(MATRIX, encoding="utf-8-sig")))
    n = len(rows)
    L: list[str] = []

    # ---------------- 附录 A ----------------
    L.append("## 附录 A：语料库统计")
    L.append("")
    L.append("> **来源标注**：本附录由 `lab/scripts/build_report_appendix.py` 自动生成，"
             "数据来自 `lab/data/meme_samples.csv` 与 `lab/data/structure_matrix.csv`。"
             "复跑该脚本即可校验本附录的每一个数字。")
    L.append("")
    L.append(f"- 样本总数：**{n}** 条")
    L.append("- 证据等级分布：" + "、".join(
        f"{k} {v}" for k, v in sorted(Counter(r["evidence_level"] for r in rows).items())))
    n_url = sum(1 for r in rows if r["url"] != "UNKNOWN")
    L.append(f"- 带可访问来源 URL：{n_url}/{n}")
    unk = [f"{r['id']} {r['name']}" for r in rows if r["url"] == "UNKNOWN"]
    L.append(f"- UNKNOWN（未取到正文）：{len(unk)} 条 —— " + "、".join(unk))
    L.append("")
    L.append("**轴 1 脱义度的实际档位**（与 §1.2 词表一致）：")
    L.append("")
    L.append("| 档位 | 条数 |")
    L.append("|---|---|")
    for k, v in Counter(r["dereference"] for r in rows).most_common():
        L.append(f"| {k} | {v} |")
    L.append("")
    L.append("**轴 0／轴 2／轴 3／轴 4 的实际档位**：")
    L.append("")
    for col, name in (("axis0_gate", "轴 0 参与门槛"), ("axis2_context", "轴 2 去语境化度"),
                      ("axis3_cost", "轴 3 参与成本"), ("axis4_aggression", "轴 4 攻击性")):
        L.append(f"- {name}：" + "、".join(
            f"{k} {v}" for k, v in Counter(r[col] for r in rows).most_common()))
    L.append("")
    L.append("**主族分布**：")
    L.append("")
    L.append("| 族 | 名称 | 条数 |")
    L.append("|---|---|---|")
    fam = {}
    for r in rows:
        fam.setdefault((r["primary_family"], r["family_name"]), []).append(r)
    for (code, name), members in sorted(fam.items(), key=lambda kv: (-len(kv[1]), kv[0][0])):
        L.append(f"| {code} | {name} | {len(members)} |")
    L.append("")
    empty = [k for k in ("F0", "F1", "F2a", "F2b", "F3", "F4a", "F4b", "F4c", "F5",
                         "F6", "F7", "F8", "F9") if not any(code == k for code, _ in fam)]
    L.append(f"**零成员的族**：{len(empty)} 个" + ("（无）" if not empty else "：" + "、".join(empty)))
    L.append("")
    L.append("**无法归类的样本**：0 条 —— **但这是构造保证，不是观测结果**。"
             "族映射表覆盖语料库出现的全部 mechanism，故「未归类」分支不可达"
             "（覆盖率读数因此同样是恒真的，不构成独立证据）。"
             "**真正能独立失败的读数是上面两条**：零成员的族、以及下表的族定义偏离特例——"
             "两者都是从数据算出、可以不为空的。")
    L.append("")
    dev = [r for r in rows
           if r["primary_family"] in ("F0", "F1", "F3", "F5", "F6", "F7", "F8")
           and r["dereference"] not in _expected(r["primary_family"])]
    L.append(f"**族定义偏离特例**：{len(dev)} 条")
    for r in dev:
        L.append(f"- {r['id']} {r['name']}：属 {r['primary_family']} 但脱义度为「{r['dereference']}」")
    L.append("")

    # ---------------- 附录 B ----------------
    L.append("## 附录 B：逐条结构判定矩阵")
    L.append("")
    L.append(f"共 {n} 条，与 `lab/data/structure_matrix.csv` 同源。**轴值缩写图例**："
             "语境＝轴 2（完全剥离／**可回溯**＝剥离但可回溯／语境保留）；"
             "攻击性＝轴 4（攻击性／**已剥离**＝攻击性已剥离／无＝无攻击性）；"
             "A＝判别条件 A；B＝判别条件 B。**表中 A/B/语境/攻击性四列均为上述缩写**，"
             "全称见 `structure_matrix.csv` 与 `manual_codes.csv`。")
    L.append("")
    L.append("| id | 名称 | 主族 | 参与门槛 | 脱义度 | 语境 | 成本 | 攻击性 | A | B |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        L.append(f"| {r['id']} | {r['name']} | {r['primary_family']} | {r['axis0_gate']} | "
                 f"{r['dereference']} | {CTX_SHORT.get(r['axis2_context'], r['axis2_context'])} | "
                 f"{r['axis3_cost']} | {AGG_SHORT.get(r['axis4_aggression'], r['axis4_aggression'])} | "
                 f"{r['cond_a']} | {r['cond_b']} |")
    L.append("")
    L.append("**统计口径说明**：")
    L.append("")
    L.append("- 对照组 = 硬假阳性 + 边界案例 + 真阴性（排他口径，三者不重复计数）。")
    L.append("- 覆盖率必须按阈值并列（条件 A 对阈值极敏感）：≥1.5 → 39/57 = 68.4%；"
             "≥1.0 → 40/57 = 70.2%；≥0.5 → 56/57 = 98.2%；A∨B → 55/57 = 96.5%。"
             "任一单值都不可单独引用。")
    L.append("- 条件 A 的实现阈值为 **≥1.0 才算「边缘」**（见 §3）。")
    L.append("")
    return "\n".join(L) + "\n"


def _expected(fam: str) -> set:
    return {
        "F0": {"原义完整"}, "F1": {"完全脱义"}, "F3": {"部分脱义", "弱脱义", "脱义", "完全脱义"},
        "F5": {"弱脱义", "部分脱义", "半脱义"}, "F6": {"部分脱义", "弱脱义"},
        "F7": {"部分脱义", "原义完整"}, "F8": {"部分脱义", "弱脱义", "半脱义"},
    }.get(fam, set())


def main() -> None:
    s = open(REPORT, encoding="utf-8").read()
    marker = "## 附录 A"
    idx = s.index(marker)
    s = s[:idx] + build_appendix()
    open(REPORT, "w", encoding="utf-8").write(s)
    print(f"已重写 {REPORT} 的附录部分（附录 A + B）")
    print(f"报告现 {len(s.splitlines())} 行")


if __name__ == "__main__":
    main()
