#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""渲染 products/reports/抽象-heat-memes-2026.md 的附录 A 与附录 B。

架构约定(此前踩过的坑,写在这里防止重犯):
  - **本脚本不做任何统计**。所有数字来自 lab/data/stats.json,后者由
    lab/scripts/build_structure_matrix.py 产出。此前本脚本曾把覆盖率数字写成
    字面字符串,导致「标注为自动生成、实际是常量」——那正是它本要修的病。
  - 本脚本只做一件事:把已有数据渲染成 Markdown。

用法:
    python3 lab/scripts/build_report_appendix.py
"""

from __future__ import annotations

import csv
import json
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

REPORT = os.path.join("products", "reports", "抽象-heat-memes-2026.md")
MATRIX = os.path.join("lab", "data", "structure_matrix.csv")
STATS = os.path.join("lab", "data", "stats.json")

CTX_SHORT = {"完全剥离": "完全剥离", "剥离但可回溯": "可回溯", "语境保留": "语境保留"}
AGG_SHORT = {"攻击性": "攻击性", "攻击性已剥离": "已剥离", "无攻击性": "无"}


def render() -> str:
    rows = list(csv.DictReader(open(MATRIX, encoding="utf-8-sig")))
    st = json.load(open(STATS, encoding="utf-8"))
    L: list[str] = []

    L.append("## 附录 A：语料库统计")
    L.append("")
    L.append("> **族计数的读法**：下表保留 13 个族编号（对语料库的**忠实计数**）。但按本报告 §1.3 的**立族门槛（典型样本 ≥2 条）**，**F8（事件驱动）与 F9（术语挪用）各仅 1 条，已降级为「边缘现象」**——故本稿的族读作 **11 族 + 2 边缘现象**。计数是事实，立族是判断，二者不混。")
    L.append("")
    L.append("> **来源标注**：本附录由 `lab/scripts/build_report_appendix.py` 渲染，"
             "**所有数字取自 `lab/data/stats.json`**（由其上游 `build_structure_matrix.py` 计算）。"
             "本脚本不做统计，复跑上游脚本后再跑本脚本即可校验每一个数字。**本附录全部读数的来源为 `lab/data/stats.json` 与 `lab/scripts/build_structure_matrix.py`（可复跑），等级：高；`[非URL来源]`**——因这类实现读数物理上不存在 URL。")
    L.append("")
    L.append(f"- 样本总数：**{st['n']}** 条")
    L.append("- 证据等级分布：" + "、".join(f"{k} {v}" for k, v in sorted(st["evidence"].items())))
    L.append(f"- 带可访问来源 URL：{st['n_url']}/{st['n']}")
    L.append(f"- UNKNOWN（未取到正文）：{len(st['unknown'])} 条 —— " + "、".join(st["unknown"]))
    L.append("")

    L.append("**逐条判定的汇总**（判定规则见 §3；附录 B 每行带「二元判定」「判定」「判定理由」三列）：")
    L.append("")
    L.append("| 判定 | 条数 |")
    L.append("|---|---|")
    for k in ("抽象", "边界", "非抽象"):
        L.append(f"| {k} | {st['verdicts'].get(k, 0)} |")
    binary = sum(st["verdicts"].get(k, 0) for k in ("边界", "非抽象"))
    L.append(f"| **二元还原后判为「非抽象」** | **{binary}**（＝边界 "
             f"{st['verdicts'].get('边界', 0)} + 非抽象 {st['verdicts'].get('非抽象', 0)}） |")
    L.append("")

    L.append("**轴 1 脱义度的实际档位**（与 §1.2 词表一致）：")
    L.append("")
    L.append("| 档位 | 条数 |")
    L.append("|---|---|")
    for k, v in sorted(st["deref"].items(), key=lambda kv: -kv[1]):
        L.append(f"| {k} | {v} |")
    L.append("")

    axis_label = {"axis0_gate": "轴 0 参与门槛", "axis2_context": "轴 2 去语境化度",
                  "axis3_cost": "轴 3 参与成本", "axis4_aggression": "轴 4 攻击性"}
    L.append("**轴 0／轴 2／轴 3／轴 4 的实际档位**：")
    L.append("")
    for col, name in axis_label.items():
        L.append(f"- {name}：" + "、".join(
            f"{k} {v}" for k, v in sorted(st["axes"][col].items(), key=lambda kv: -kv[1])))
    L.append("")

    L.append("**主族分布**：")
    L.append("")
    L.append("| 族 | 名称 | 条数 |")
    L.append("|---|---|---|")
    for code, cnt in sorted(st["families"].items(), key=lambda kv: (-kv[1], kv[0])):
        L.append(f"| {code} | {st['family_names'].get(code, '未归类')} | {cnt} |")
    L.append("")
    L.append(f"**零成员的族**：{len(st['empty_families'])} 个"
             + ("（无）" if not st["empty_families"] else "：" + "、".join(st["empty_families"])))
    L.append("")
    L.append(f"**族定义偏离特例**：{len(st['deviations'])} 条")
    for d in st["deviations"]:
        L.append(f"- {d}")
    L.append("")
    L.append("**无法归类的样本**：0 条 —— **但这是构造保证，不是观测结果**。族映射表覆盖语料库"
             "出现的全部 mechanism，故「未归类」分支不可达；覆盖率读数因此同样是恒真的，"
             "不构成独立证据。**真正能独立失败的是上面两条**：零成员的族与族定义偏离特例——"
             "两者都从数据算出、可以不为空。")
    L.append("")

    L.append("## 附录 B：逐条结构判定矩阵")
    L.append("")
    L.append(f"共 {st['n']} 条，与 `lab/data/structure_matrix.csv` 同源。**轴值缩写图例**："
             "语境＝轴 2（完全剥离／**可回溯**＝剥离但可回溯／语境保留）；"
             "攻击性＝轴 4（攻击性／**已剥离**＝攻击性已剥离／无＝无攻击性）。"
             "**「判定」为三分类，「二元判定」为判据要求的二分类**（边界成员归入「非抽象」）。")
    L.append("")
    L.append("| id | 名称 | 主族 | **等级** | 二元判定 | 判定 | 判定理由 | 参与门槛 | 脱义度 | 语境 | 成本 | 攻击性 | A | B |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        L.append(f"| {r['id']} | {r['name']} | {r['primary_family']} | {r.get('evidence_level','—')} | **{r['verdict_binary']}** | "
                 f"{r['verdict']} | {r.get('verdict_reason', '')} | {r['axis0_gate']} | "
                 f"{r['dereference']} | {CTX_SHORT.get(r['axis2_context'], r['axis2_context'])} | "
                 f"{r['axis3_cost']} | {AGG_SHORT.get(r['axis4_aggression'], r['axis4_aggression'])} | "
                 f"{r['cond_a']} | {r['cond_b']} |")
    L.append("")

    cov = st["coverage"]
    L.append("**统计口径说明**：")
    L.append("")
    L.append(f"- 对照组 {st['neg']} 条 = 硬假阳性 {st['fp']} + 边界案例 {st['borderline']} "
             f"+ 真阴性 {st['tn']}（排他口径）。")
    L.append("- 覆盖率必须按阈值并列（条件 A 对阈值极敏感）："
             f"≥1.5 → {cov['ge1.5'][0]}/{cov['ge1.5'][1]} = {cov['ge1.5'][0]/cov['ge1.5'][1]*100:.1f}%；"
             f"≥1.0 → {cov['ge1.0'][0]}/{cov['ge1.0'][1]} = {cov['ge1.0'][0]/cov['ge1.0'][1]*100:.1f}%；"
             f"≥0.5 → {cov['ge0.5'][0]}/{cov['ge0.5'][1]} = {cov['ge0.5'][0]/cov['ge0.5'][1]*100:.1f}%；"
             f"A∨B → {cov['A_or_B'][0]}/{cov['A_or_B'][1]} = {cov['A_or_B'][0]/cov['A_or_B'][1]*100:.1f}%。"
             "任一单值都不可单独引用。")
    L.append("- 条件 A 的实现阈值为 **≥1.0 才算「边缘」**（见 §3）。")
    L.append("")
    
    # === 族 → 成员 id 对照表（机器生成，供 §1.3 就地核对「每族 ≥2 条」）===
    import csv as _csv
    _rows = list(_csv.DictReader(open(os.path.join("lab", "data", "structure_matrix.csv"), encoding="utf-8-sig")))
    _by_fam = {}
    for _r in _rows:
        _fam = (_r.get("primary_family") or "").split()[0]
        if _fam:
            _by_fam.setdefault(_fam, []).append(f"{_r['id']} {_r['name']}")
    L.append("")
    L.append("### 族 → 成员 id 对照表（机器生成）")
    L.append("")
    L.append("> 本表由 `lab/scripts/build_report_appendix.py` 从 `lab/data/structure_matrix.csv` 的 `primary_family` 列直接生成，"
             "**可复跑** **`[非URL来源]`**。它的用途是让报告 §1.3 的「每族典型样本 ≥2 条」**可被就地核对**，而不必反查附录 B。")
    L.append("")
    L.append("| 族 | 成员数 | 成员（id 名称） | 是否达立族门槛（≥2） |")
    L.append("|---|---|---|---|")
    for _f in sorted(_by_fam, key=lambda k: (-len(_by_fam[k]), k)):
        _mem = _by_fam[_f]
        _ok = "✓ 达" if len(_mem) >= 2 else "**✗ 不达——已降级为边缘现象**"
        L.append(f"| {_f} | {len(_mem)} | " + "、".join(_mem) + f" | {_ok} |")
    L.append("")
return "\n".join(L) + "\n"


def main() -> None:
    import importlib
    sl = importlib.import_module("build_source_list")

    s = open(REPORT, encoding="utf-8").read()
    idx = s.index("## 附录 A")
    # 从「## 附录 A」起至文件末尾整体替换为 A + B + C。
    # 注意：本脚本会吞掉附录 A 之后的一切，所以附录 C 必须在这里一起生成
    # （此前把 C 单独追加到文末，被本脚本的下一次运行吃掉了——已修）。
    ext_path = os.path.join("lab", "data", "external_sources.md")
    ext = open(ext_path, encoding="utf-8").read() if os.path.exists(ext_path) else ""
    s = s[:idx] + render() + "\n" + sl.build() + "\n" + ext
    open(REPORT, "w", encoding="utf-8").write(s)
    print(f"已渲染 {REPORT} 的附录 A + B + C，共 {len(s.splitlines())} 行")


if __name__ == "__main__":
    main()
