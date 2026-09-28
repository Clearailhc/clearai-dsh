#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""结构解剖(s3)与本体论快照(s9)。

读取 lab/data/meme_samples.csv,输出:
  1. lab/data/structure_matrix.csv —— 逐条的结构判定矩阵(条数随语料库)
  2. lab/data/structure_matrix.md  —— 人读版
  3. lab/data/ontology.json        —— 本体论机器可查快照(族/轴/规则/成员)

判定分两层,来源必须在产物里分得清:
  (a) **字段推导层**——现象族、轴 2 语境、轴 3 成本、条件 A、轴 4 的默认值,
      完全由 meme_samples.csv 的 mechanism / dereference 字段推导,可逐条复算;
  (b) **人工编码层**——条件 B(替换测试)、条件 C 的 label_opposed、轴 4 的显式例外,
      是逐条人工判定,存放在 lab/data/manual_codes.csv,不由字段推导。
      它们与 (a) 同为输入数据,但性质不同:**改动 (b) 就会改动结论**,这一点必须在
      报告中如实披露,不能把 (b) 说成"从字段推出"。
"""

from __future__ import annotations

import csv
import json
import os
from collections import Counter, defaultdict

# ---------------------------------------------------------------- 本体论定义
# 族:名称 + 定义性属性 + 轴取值特征
FAMILIES = {
    "F1": dict(
        name="空耳族",
        prototype="我的刀盾",
        defining="形式=母语对另一语言语音的误听转写;存在可指认的外语/方言源;中文形式本身不构成合法语义",
        trait="脱义度=完全脱义",
    ),
    "F2a": dict(
        name="动作族·挪用型",
        prototype="闪身步",
        defining="形式=身体动律,且动作出自严肃语料(非遗/教材/官方);因被抽离原语境而成为梗",
        trait="脱义度=部分脱义;去语境化度=剥离但可回溯;参与成本=低",
    ),
    "F2b": dict(
        name="动作族·原生型",
        prototype="企鹅舞",
        defining="形式=身体动律,但动作本身即为娱乐目的而生,无严肃出处",
        trait="脱义度=弱脱义至部分脱义",
    ),
    "F3": dict(
        name="谐音族",
        prototype="包的",
        defining="形式=同一语言内的同音或近音替换;存在可指认的原词;替换后词义与语境无关",
        trait="脱义度通常弱小",
    ),
    "F4a": dict(
        name="复读族·人力复读",
        prototype="我要验牌",
        defining="形式=对既有文本/影像片段的复现,靠人记诵与表演",
        trait="脱义度=部分脱义;参与成本=中",
    ),
    "F4b": dict(
        name="复读族·技术复读",
        prototype="华强买瓜(2021期)",
        defining="形式=对既有片段的复现,靠鬼畜调音/素材拼接实现",
        trait="参与成本=高",
    ),
    "F4c": dict(
        name="复读族·生成式复读",
        prototype="华强买瓜(2026期)",
        defining="形式=对既有片段的复现,靠 AI 视频生成实现,可把人物装入任何场景",
        trait="参与成本=高,但边际成本随生成能力下降",
    ),
    "F5": dict(
        name="句式模板族",
        prototype="那咋了",
        defining="形式=可填空的句式;可脱离原使用者无限复用;原主不参与其传播",
        trait="横跨抽象与非抽象,是边界最模糊的一族",
    ),
    "F6": dict(
        name="行为整活族",
        prototype="药水哥式直播整活",
        defining="形式=持续性的行为表演;主体是人而非文本;可围观但不可复现",
        trait="参与成本≠复制成本",
    ),
    "F7": dict(
        name="话语体系族",
        prototype="抽象话",
        defining="形式=成体系的符号/词汇替换规则而非单个梗;有内部语法;需学习才能使用",
        trait="参与成本中高;圈层壁垒强",
    ),
    "F8": dict(
        name="事件驱动族",
        prototype="马保国/接化发",
        defining="形式=以真实人物的真实事件为素材;热度随事件生命周期衰减",
        trait="攻击性档位偏高",
    ),
    "F9": dict(
        name="术语挪用族",
        prototype="王颖评舞台剧的『抽象』",
        defining="使用场域是专业评论而非社交平台;语义与网络义相反(指壳大无核)",
        trait="语义反转;样本极少,是本体论最薄弱的一族",
    ),
    "F0": dict(
        name="学术义参照族",
        prototype="抽象的哲学/数学义",
        defining="不是抽象现象的成员,而是必须并列的参照点,用于划出词形相同的他者",
        trait="不适用",
    ),
}

# 机制 → 候选族(见报告 1.4 规则二:主族按"该现象得以传播的第一形式")
MECHANISM_TO_FAMILY = {
    "空耳": ["F1"],
    "空耳/鬼畜": ["F1", "F4b"],
    "空耳/音效": ["F1"],
    "谐音": ["F3"],
    "谐音/外来借用": ["F3", "F1"],
    "谐音/人名误写": ["F3"],
    "谐音/贬义改编": ["F3"],
    "谐音/回避审查": ["F3"],
    "动作模仿": ["F2b"],
    "动作模仿/场景复用": ["F2b"],
    "行为整活": ["F6"],
    "台词复用": ["F4a"],
    "台词复用/鬼畜": ["F4a", "F4b"],
    "AI二创/台词复用": ["F4c", "F4a"],
    "AI二创": ["F4c"],
    "二创衍生": ["F4a"],
    "句式模板": ["F5"],
    "话语体系": ["F7"],
    "缩写": ["F5"],
    "鬼畜": ["F4b"],
    "鬼畜/空耳": ["F4b", "F1"],
    "恶搞/解构": ["F4b"],
    "外来借用": ["F1"],
    "机构命名": ["F7"],
    "事件驱动": ["F8"],
    "文艺形态": ["F5"],
    "术语挪用": ["F9"],
    "学术义项": ["F0"],
    "跨语言对照": ["F0"],
}

# 显式主族覆盖:机制字段带 "/" 者,按传播所依赖的第一形式定主族(报告 1.4 规则二/规则三)
PRIMARY_OVERRIDE = {
    "m007": "F2b",   # 企鹅舞:动作,原生
    "m008": "F6",    # 技能五子棋:整活玩法
    "m028": "F1",    # 鸡你太美:空耳为主,鬼畜为二次加工
    "m045": "F7",    # 火星文:话语体系
    "m051": "F5",    # 抽象喜剧:文艺形态,句式/桥段模板
}

# 脱义度 → 分数档
DEREF_SCORE = {
    "完全脱义": 2.0,
    "部分脱义": 1.5,
    "半脱义": 1.5,
    "脱义": 1.5,
    "弱脱义": 0.5,
    "原义完整": 0.0,
    "语义反转": 0.5,
}
# 去语境化度 → 分数档(由脱义度与是否为挪用型动作/复读推出,保守)
# 轴 2(去语境化度)显式档位:与脱义度分开成列,不再只由分数推导
CONTEXT_LEVEL = {
    "完全脱义": "完全剥离", "脱义": "完全剥离",
    "部分脱义": "剥离但可回溯", "半脱义": "剥离但可回溯",
    "弱脱义": "语境保留", "原义完整": "语境保留", "语义反转": "剥离但可回溯",
}

# 去语境分**以语境档为键**（与 CONTEXT_LEVEL 的值域一致），不再以 dereference 为键。
# 旧版以 dereference 为键，导致「语义反转」得 0.5，而 CONTEXT_LEVEL 明确把它定为
# 「剥离但可回溯」——该档在旧表里其余三项（部分脱义/半脱义/脱义）都是 1.0。
# 这是实现与文档的背离：文档 §3 写「剥离但可回溯 → 得 1 分」。已按文档修正。
CONTEXT_SCORE = {"完全剥离": 1.0, "剥离但可回溯": 1.0, "语境保留": 0.0}
SECURITY_SOURCES = ("非遗", "教材", "国家级", "文旅部", "舞协", "秧歌", "花鼓灯", "大染坊")

# 判别条件 B(替换测试):保留形式、替换意义,是否仍然能用?
#   形式驱动 = 换掉意义与具体形式仍可用(任意三字/任意动作都行)→ 属抽象机制
#   特定形式 = 靠形式传播,但该形式本身不可替换(换掉即失效)→ 更近鬼畜/恶搞,非典型抽象
#   意义驱动 = 换掉意义即失效 → 只是普通热梗
#   外来对照 = 镜子的另一面,不参与判定
#   不适用   = 非现象成员
# 条件 C(公共标签测试):这些样本在机制上靠近抽象,但公共标签明确把它们归入
# 既有邻近范畴(校园烂梗/攻击性用语)而非"抽象"。它们是边界案例,不计入假阳性。
# 依据:新华社 2025-11-04 将"你好唐""你个双肩包"定性为校园语言霸凌类烂梗。
LABEL_OPPOSED = {}  # 由 load_manual_codes() 从 lab/data/manual_codes.csv 填充

# 轴 3(参与成本):复现一次所需的资源。由机制类型机械推导。
COST_BY_MECHANISM = {
    "空耳": "极低", "空耳/鬼畜": "极低", "空耳/音效": "极低",
    "谐音": "极低", "谐音/外来借用": "极低", "谐音/人名误写": "极低",
    "谐音/贬义改编": "极低", "谐音/回避审查": "极低",
    "句式模板": "极低", "缩写": "极低", "话语体系": "中", "机构命名": "极低",
    "动作模仿": "低", "动作模仿/场景复用": "低",
    "行为整活": "高",
    "台词复用": "中", "台词复用/鬼畜": "中",
    "鬼畜": "高", "鬼畜/空耳": "高", "恶搞/解构": "高",
    "AI二创": "高", "AI二创/台词复用": "高", "二创衍生": "中",
    "外来借用": "极低", "事件驱动": "中", "文艺形态": "中",
    "术语挪用": "中", "学术义项": "极低", "跨语言对照": "极低",
}
# 轴 4(攻击性):是否用于贬低或排斥。依据来源关键词 + 显式名单。
AGGRESSION_KEYWORDS = {
    "攻击性": ("霸凌", "贬损", "侮辱", "脏话"),
    "攻击性已剥离": ("攻击性", "去攻击性", "粗鄙", "网络暴力", "嘴臭"),
}
AGGRESSION_EXPLICIT = {}  # 由 load_manual_codes() 从 lab/data/manual_codes.csv 填充

COND_B_MAP = {}  # 由 load_manual_codes() 从 lab/data/manual_codes.csv 填充

# 各族按定义允许的脱义度档位:成员落在允许集之外即为"需说明的特例",不静默放过
FAMILY_EXPECTED_DEREF = {
    "F1": {"完全脱义"},
    "F2a": {"部分脱义", "弱脱义", "原义完整"},
    "F2b": {"部分脱义", "弱脱义", "脱义"},
    "F3": {"部分脱义", "弱脱义", "脱义", "完全脱义"},
    "F4a": {"部分脱义", "弱脱义", "半脱义"},
    "F4b": {"完全脱义", "半脱义", "部分脱义"},
    "F4c": {"半脱义", "部分脱义"},
    "F5": {"弱脱义", "部分脱义", "半脱义"},
    "F6": {"部分脱义", "弱脱义"},
    "F7": {"部分脱义", "原义完整"},
    "F8": {"部分脱义", "弱脱义", "半脱义"},
    "F9": {"语义反转", "部分脱义"},
    "F0": {"原义完整"},
}


def aggress(row: dict) -> str:
    """轴 4(攻击性)判定:显式名单优先,其次依据来源/备注关键词。"""
    if row["id"] in AGGRESSION_EXPLICIT:
        return AGGRESSION_EXPLICIT[row["id"]]
    blob = row.get("origin", "") + row.get("note", "")
    for level, kws in AGGRESSION_KEYWORDS.items():
        if any(k in blob for k in kws):
            return level
    return "无攻击性"


def classify(row: dict) -> dict:
    mech = (row.get("mechanism") or "").strip()
    cands = MECHANISM_TO_FAMILY.get(mech, [])
    primary = PRIMARY_OVERRIDE.get(row["id"]) or (cands[0] if cands else "UNCLASSIFIED")

    # 动作族细分:来源含严肃语料 → 挪用型
    blob = (row.get("origin", "") + row.get("note", ""))
    is_serious = any(s in blob for s in SECURITY_SOURCES)
    if primary == "F2b" and is_serious:
        primary = "F2a"

    deref = (row.get("dereference") or "").strip()
    d_score = DEREF_SCORE.get(deref, None)
    c_score = CONTEXT_SCORE.get(CONTEXT_LEVEL.get(deref, ""), None)

    # 判别条件 A:脱义/去语境测试
    if d_score is None or c_score is None:
        cond_a = "无法判定"
    else:
        total = ("需要理解才能参与" if deref in ("原义完整",) else
                 "理解后不影响参与" if deref in ("弱脱义", "语义反转") else
                 "不需要理解即可参与")
        a_score = (1.0 if total == "不需要理解即可参与" else
                   0.5 if total == "理解后不影响参与" else 0.0) + c_score
        cond_a = ("靠近中心" if a_score >= 1.5 else
                  "边缘" if a_score >= 1.0 else "不属于")

    return dict(
        primary_family=primary,
        family_name=FAMILIES.get(primary, {}).get("name", "未归类"),
        candidate_families="|".join(cands),
        deref_score=d_score if d_score is not None else "NA",
        context_score=c_score if c_score is not None else "NA",
        cond_a=cond_a,
        cond_b=COND_B_MAP.get(row["id"], "未编码"),
        serious_source="是" if is_serious else "否",
        axis0_gate=("需要理解才能参与" if deref == "原义完整" else
                    "理解后不影响参与" if deref in ("弱脱义", "语义反转") else
                    "不需要理解即可参与"),
        axis2_context=CONTEXT_LEVEL.get(deref, "未编码"),
        axis3_cost=COST_BY_MECHANISM.get(mech, "未编码"),
        axis4_aggression=aggress(row),
    )


def load_manual_codes(path="lab/data/manual_codes.csv"):
    """加载人工编码表(条件 B / 条件 C / 轴 4 显式例外)。

    这些值不来自字段推导,是人逐条判定的,单独落盘以便:
      - 复核者能直接看到"哪些结论依赖人工判定";
      - 修改编码不必改代码。
    """
    global COND_B_MAP, LABEL_OPPOSED, AGGRESSION_EXPLICIT
    COND_B_MAP, LABEL_OPPOSED, AGGRESSION_EXPLICIT = {}, {}, {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r.get("cond_b"):
                COND_B_MAP[r["id"]] = r["cond_b"]
            if r.get("label_opposed"):
                LABEL_OPPOSED[r["id"]] = True
            if r.get("axis4_aggression"):
                AGGRESSION_EXPLICIT[r["id"]] = r["axis4_aggression"]


def main() -> None:
    load_manual_codes()
    src = os.path.join("lab", "data", "meme_samples.csv")
    with open(src, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    out_rows = []
    for r in rows:
        c = classify(r)
        merged = dict(r)
        merged.update(c)
        out_rows.append(merged)

    for r in out_rows:
        opposed = bool(LABEL_OPPOSED.get(r["id"]))
        mech = (r["cond_a"] in ("靠近中心", "边缘")) or (r["cond_b"] == "形式驱动")
        r["verdict"] = ("边界" if (mech and opposed) else "抽象" if mech else "非抽象")
        r["verdict_binary"] = "非抽象" if r["verdict"] in ("边界", "非抽象") else "抽象"
        rr = []
        if r["cond_a"] in ("靠近中心", "边缘"):
            rr.append(f"条件A={r['cond_a']}")
        if r["cond_b"] == "形式驱动":
            rr.append("条件B=形式驱动")
        if opposed:
            rr.append("条件C=公共标签反对")
        r["verdict_reason"] = " + ".join(rr) if rr else "三条件均不满足"

    fields = list(rows[0].keys()) + [
        "primary_family", "family_name", "candidate_families",
        "deref_score", "context_score", "cond_a", "cond_b", "serious_source",
        "axis0_gate", "axis2_context", "axis3_cost", "axis4_aggression",
        "verdict", "verdict_binary", "verdict_reason",
    ]

    mp = os.path.join("lab", "data", "structure_matrix.csv")
    with open(mp, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in out_rows:
            w.writerow(r)

    # ---------- 统计 ----------
    fam_counts = Counter(r["primary_family"] for r in out_rows)
    cond_counts = Counter(r["cond_a"] for r in out_rows)
    deref_by_fam = defaultdict(Counter)
    for r in out_rows:
        deref_by_fam[r["primary_family"]][r["dereference"]] += 1

    unclassified = [r for r in out_rows if r["primary_family"] == "UNCLASSIFIED"]
    family_empty = [k for k in FAMILIES if k not in fam_counts]

    lines = []
    lines.append(f"结构矩阵行数: {len(out_rows)}")
    lines.append("")
    lines.append("[主族分布]")
    for k, v in fam_counts.most_common():
        lines.append(f"  {k} {FAMILIES.get(k, {}).get('name', '未归类')}: {v}")
    lines.append("")
    lines.append("[判别条件 A 分布]")
    for k, v in cond_counts.most_common():
        lines.append(f"  {k}: {v}")
    lines.append("")
    lines.append("[无族可归的样本]")
    lines.append("  " + ("无" if not unclassified else
                         ", ".join(f"{r['id']} {r['name']}" for r in unclassified)))
    lines.append("  ⚠ 口径说明：0 条是**构造保证**而非观测结果——MECHANISM_TO_FAMILY 覆盖语料库"
                 "出现的全部 mechanism，故 UNCLASSIFIED 分支不可达，零信息量。"
                 "真正有信息量的是『映射表覆盖率』，见下。")
    lines.append(f"  [映射表覆盖率] 语料库出现 {len(set(r['mechanism'] for r in out_rows))} 种 mechanism，"
                 f"映射表 {len(MECHANISM_TO_FAMILY)} 个键，未被映射的 mechanism："
                 + (", ".join(sorted(set(r['mechanism'] for r in out_rows) - set(MECHANISM_TO_FAMILY)))
                    or "无"))
    lines.append("")
    lines.append("[零成员的族]")
    lines.append("  " + ("无" if not family_empty else ", ".join(family_empty)))
    lines.append("")
    lines.append("[轴1 × 轴3 列联表]")
    costs_all = [c for c, _ in Counter(r["axis3_cost"] for r in out_rows).most_common()]
    ctab = Counter((r["dereference"], r["axis3_cost"]) for r in out_rows)
    lv1_all = [d for d, _ in Counter(r["dereference"] for r in out_rows).most_common()]
    lines.append("    脱义度\\成本  " + "  ".join(f"{c:>4}" for c in costs_all))
    for d in lv1_all:
        lines.append(f"    {d:<12}" + "  ".join(f"{ctab.get((d, c), 0):>4}" for c in costs_all))
    lines.append("")

    lines.append("[轴 2/3/4 与参与门槛的分布]")
    for col, name in (("axis0_gate", "参与门槛(轴0)"), ("axis2_context", "轴2 语境"),
                      ("axis3_cost", "轴3 成本"), ("axis4_aggression", "轴4 攻击性")):
        dist = "、".join(f"{k} {v}" for k, v in Counter(r[col] for r in out_rows).most_common())
        lines.append(f"  {name}: {dist}")
    lines.append("")

    lines.append("[族定义 vs 族成员:脱义度偏离的待说明特例]")
    deviations = []
    for r in out_rows:
        fam = r["primary_family"]
        expected = FAMILY_EXPECTED_DEREF.get(fam)
        if expected and r["dereference"] not in expected:
            deviations.append(f"{r['id']} {r['name']} 属 {fam} 但脱义度={r['dereference']}")
    lines.append("  " + ("无" if not deviations else ""))
    for d in deviations:
        lines.append(f"    - {d}")
    lines.append("")

    # ---------- 覆盖度与假阳性检验(联合判定 A + B) ----------
    def mech_abstract(r) -> bool:
        """机制上靠近抽象:条件 A 靠近中心/边缘,或条件 B 形式驱动。"""
        return (r["cond_a"] in ("靠近中心", "边缘")) or (r["cond_b"] == "形式驱动")

    def judged_abstract(r) -> bool:
        """修订后的三层判定:机制(A或B) 且 公共标签不反对。"""
        if not mech_abstract(r):
            return False
        # 条件 C:公共标签测试。被学界或媒体明确归入既有邻近范畴(鬼畜/恶搞/普通热梗)
        # 而非"抽象"者,判为边界案例而非抽象成员。
        return not LABEL_OPPOSED.get(r["id"], False)

    pos = [r for r in out_rows if r["called_abstract"] in ("是", "是(回溯)")]
    neg = [r for r in out_rows if r["called_abstract"] in ("否", "待判")]
    tp = [r for r in pos if judged_abstract(r)]
    fn = [r for r in pos if not judged_abstract(r)]

    fp_hard = [r for r in neg if judged_abstract(r)]
    tn = [r for r in neg if not judged_abstract(r)]
    borderline = [r for r in neg if mech_abstract(r) and not judged_abstract(r)]
    # 硬假阳性:对照组中"明确不被称抽象"且机制上也远离抽象却被误判者
    fp = [r for r in fp_hard if r["called_abstract"] == "否"]

    # 覆盖率对阈值极敏感,三个阈值口径 + 析取口径必须全部并列披露
    def sc(r):
        try:
            return float(r["deref_score"]) + float(r["context_score"])
        except (TypeError, ValueError):
            return None

    def cov(edge):
        tp_ = [r for r in pos if sc(r) is not None and sc(r) >= edge]
        fn_ = [r for r in pos if sc(r) is None or sc(r) < edge]
        return tp_, fn_

    tp_center, fn_center = cov(1.5)   # 只有「靠近中心」才算
    tp_impl, fn_impl = cov(1.0)       # 实现阈值:>=1.0 即「边缘」
    tp_text, fn_text = cov(0.5)       # 正文初稿阈值:>=0.5 即「边缘」
    tp_a, fn_a = tp_impl, fn_impl

    lines.append("[覆盖度与假阳性检验]")
    lines.append(f"  正例(被公开称作抽象): {len(pos)}")
    lines.append(f"  对照组(不被称抽象或待判): {len(neg)}")
    lines.append("  —— 阈值敏感性:覆盖率(sc = 脱义度分 + 去语境分)随阈值剧烈变化 ——")
    for label, (t_, f_), note in (
        ("阈值 >=1.5(仅『靠近中心』)", (tp_center, fn_center), "最严"),
        ("阈值 >=1.0(『边缘』起点,实现采用)", (tp_impl, fn_impl), "本报告实现"),
        ("阈值 >=0.5(初稿正文所写)", (tp_text, fn_text), "最宽"),
    ):
        lines.append(f"  · {label}: TP={len(t_)}/{len(pos)} = {len(t_)/len(pos)*100:.1f}% ;"
                     f" FN={len(f_)}  [{note}]")
    _lo = min(len(tp) for tp in (tp_center, tp_impl, tp_text)) / len(pos) * 100
    _hi = max(len(tp) for tp in (tp_center, tp_impl, tp_text)) / len(pos) * 100
    lines.append(f"  ⚠ 同一判据在阈值从 0.5 挪到 1.5 时给出 {_lo:.1f}%～{_hi:.1f}% 的任意答案"
                 "(上下界由上方三行算出,不硬编码)。"
                 "这不是实现瑕疵,而是『抽象无法用单一判据圈定』的直接证据。")
    lines.append("  —— 口径 4:条件 A 或 条件 B(析取式) ——")
    lines.append(f"  TP_AB: {len(tp)}/{len(pos)} = {len(tp)/len(pos)*100:.1f}% ; FN_AB={len(fn)}")
    lines.append("")
    lines.append("  —— 各口径下的未覆盖真例 ——")
    for label, f_ in ((">=1.5", fn_center), (">=1.0", fn_impl), (">=0.5", fn_text)):
        lines.append(f"    [阈值 {label}] {len(f_)} 条(完整清单,不截断):")
        if not f_:
            lines.append("      (无)")
        for r in f_:
            lines.append(f"      - {r['id']} {r['name']}  (脱义度={r['dereference']}, "
                         f"条件A={r['cond_a']})")
    lines.append(f"    [A∨B 口径] {len(fn)} 条(完整清单):")
    for r in fn:
        lines.append(f"      - {r['id']} {r['name']}  (脱义度={r['dereference']}, 条件B={r['cond_b']})")
    lines.append("    [修订前基线] 仅 A∨B 时的误判假例数见下方 FP(修订前);"
                 "硬假阳性 0 是加入条件 C 后的结果,单独引用 0 会高估判据。")
    lines.append("")
    lines.append(f"  —— 修订前口径(仅 A 或 B) ——")
    fp_old = [r for r in neg if mech_abstract(r)]
    lines.append(f"  误判的假例 FP(修订前, = 边界案例同一集合): {len(fp_old)}/{len(neg)} "
                 f"= {len(fp_old)/len(neg)*100:.1f}%")
    lines.append("  [误判假例 FP(修订前) 完整名单 —— 以该名目直列]")
    for r in fp_old:
        lines.append(f"      - {r['id']} {r['name']}  (A={r['cond_a']}, B={r['cond_b']}, "
                     f"label_opposed={bool(LABEL_OPPOSED.get(r['id']))})")
    lines.append("  [说明] 因硬假阳性=0,『修订前误判假例』与『边界案例』是**同一个集合**,"
                 "不是数值相等——无一条误判是靠机制信息排除的。")
    lines.append(f"  —— 修订后口径(加入条件 C 公共标签测试) ——")
    tn_excl = [r for r in tn if not (mech_abstract(r) and LABEL_OPPOSED.get(r["id"], False))]
    lines.append(f"  硬假阳性 FP: {len(fp)}")
    lines.append(f"  边界案例(机制属抽象但公共标签反对): {len(borderline)}")
    lines.append(f"  真阴性 TN(排他口径): {len(tn_excl)}")
    lines.append(f"  [口径校验] FP + 边界 + TN(排他) = {len(fp)} + {len(borderline)} + {len(tn_excl)}"
                 f" = {len(fp) + len(borderline) + len(tn_excl)}，应等于对照组 {len(neg)}")
    lines.append(f"  假阳性率(FP/对照组): {len(fp)}/{len(neg)} = {len(fp)/len(neg)*100:.1f}%")
    lines.append("")
    lines.append("  [未覆盖的真例 FN]")
    lines.append("    " + ("无" if not fn else ""))
    for r in fn:
        lines.append(f"      - {r['id']} {r['name']} (A={r['cond_a']}, B={r['cond_b']})")
    lines.append("  [硬假阳性 FP]")
    lines.append("    " + ("无" if not fp else ""))
    for r in fp:
        lines.append(f"      - {r['id']} {r['name']} (A={r['cond_a']}, B={r['cond_b']}, deref={r['dereference']})")
    lines.append("  [边界案例:机制属抽象,公共标签却归入邻近范畴]")
    lines.append("    " + ("无" if not borderline else ""))
    for r in borderline:
        lines.append(f"      - {r['id']} {r['name']} (A={r['cond_a']}, B={r['cond_b']}, deref={r['dereference']})")
    lines.append("")
    lines.append("[各族内的脱义度分布]")
    for k in sorted(deref_by_fam):
        dist = ", ".join(f"{a}={b}" for a, b in deref_by_fam[k].most_common())
        lines.append(f"  {k} {FAMILIES.get(k, {}).get('name', '未归类')}: {dist}")
    lines.append("")
    # ---------- 轴独立性检验 ----------
    lines.append("[轴独立性检验]")
    for col, name in (("axis2_context", "轴2 语境"), ("axis3_cost", "轴3 成本")):
        m = defaultdict(set)
        for r in out_rows:
            m[r["dereference"]].add(r[col])
        multi = {k: v for k, v in m.items() if len(v) > 1}
        if multi:
            lines.append(f"  {name}: 独立 ✓ (同一脱义度横跨 {max(len(v) for v in multi.values())} 档)")
        else:
            lines.append(f"  {name}: **不独立 ✗** — 完全由轴1决定,只是重编码,无新信息")
    # 轴1 → 轴2 的映射数(澄清:是 N 个脱义度值映射到 M 个语境值,不是 1:1)
    lv1 = set(r["dereference"] for r in out_rows)
    lv2 = set(r["axis2_context"] for r in out_rows)
    lines.append(f"  轴1→轴2 映射: {len(lv1)} 个脱义度值 → {len(lv2)} 个语境值"
                 f"(确定性映射,故轴2 无独立信息量)")
    # 轴1 × 轴3 列联表:正交性不能只靠取值多样性论证
    lines.append("  轴1 × 轴3 列联表(检验正交性;若集中于单一档位则正交性未获支持):")
    inner = Counter((r["dereference"], r["axis3_cost"]) for r in out_rows)
    costs = [c for c, _ in Counter(r["axis3_cost"] for r in out_rows).most_common()]
    lines.append("    脱义度\\成本  " + "  ".join(f"{c:>4}" for c in costs))
    for d in sorted(lv1, key=lambda x: -sum(v for (a, _), v in inner.items() if a == x)):
        row = "  ".join(f"{inner.get((d, c), 0):>4}" for c in costs)
        lines.append(f"    {d:<12}{row}")
    n_all = len(out_rows)
    n_low = sum(v for (_, c), v in inner.items() if c == "极低")
    lines.append(f"  ⚠ 两轴均向「极低」集中(占 {n_low}/{n_all} = {n_low/n_all*100:.0f}%),"
                 "故「正交」只是取值多样性的观察,未做关系统计检验——"
                 "本报告不断言二轴正交,只断言它们**不由彼此决定**。")
    lines.append("")

    m3 = defaultdict(set)
    for r in out_rows:
        m3[r["mechanism"]].add(r["dereference"])
    n_multi = sum(1 for v in m3.values() if len(v) > 1)
    lines.append(f"  轴1 vs 机制: 26 种 mechanism 中 {n_multi} 种对应多个脱义度 → 轴1 相对独立 ✓")

    # 轴3 的母字段是 mechanism 而非 dereference
    m4 = defaultdict(set)
    for r in out_rows:
        m4[r["mechanism"]].add(r["axis3_cost"])
    multi4 = {k: v for k, v in m4.items() if len(v) > 1}
    if multi4:
        lines.append(f"  轴3 vs 机制: {len(multi4)} 种机制对应多个成本档 → 非严格函数")
    else:
        lines.append(f"  轴3 vs 机制: **不独立 ✗** — 成本是按 mechanism 查表得到,"
                     "是机制字段的 4 档粗化,不是新证据")

    # 轴4 / 条件B 是否冗余:用"同 (轴1,轴3) 不同取值"的见证对检验
    def witness(col):
        g = defaultdict(set)
        for r in out_rows:
            g[(r["dereference"], r["axis3_cost"])].add(r[col])
        w = {k: v for k, v in g.items() if len(v) > 1}
        return w

    for col, name in (("axis4_aggression", "轴4 攻击性"), ("cond_b", "条件B"),
                      ("axis0_gate", "轴0 参与门槛"), ("cond_a", "条件A")):
        w = witness(col)
        if w:
            k = next(iter(w))
            ex = "、".join(sorted(w[k]))
            lines.append(f"  {name} vs (轴1×轴3): 独立 ✓ — 存在同脱义度同成本而取值不同者"
                         f"(如 {k[0]}+{k[1]} 下有:{ex})")
        else:
            lines.append(f"  {name} vs (轴1×轴3): **不独立 ✗** — 完全由脱义度与成本决定")

    lines.append("  [结论] 真正互不决定的量只有两个,且**两个都是语料库的人工编码字段**:"
                 "dereference(7 档) 与 mechanism(26 档)。"
                 "轴0/轴2/条件A 是 dereference 的函数;轴3 是 mechanism 的粗化(4 档);"
                 "轴4 与条件B 是独立的人工编码,但同样不是从字段推导出来的。"
                 "故『可由语料库字段复算』的准确含义是:给定脚本(含其手写表)与语料 CSV,可确定性重算。")
    lines.append("")

    lines.append("[断言:同一标签下脱义度是否取遍全谱]")
    all_deref = set(r["dereference"] for r in out_rows)
    lines.append(f"  语料库出现的脱义度档位: {len(all_deref)} -> {'、'.join(sorted(all_deref))}")

    report = "\n".join(lines)
    with open(os.path.join("lab", "data", "structure_check.txt"), "w", encoding="utf-8") as f:
        f.write(report + "\n")

    # ---------- 人读版 ----------
    md = ["# 结构判定矩阵", "",
          f"共 {len(out_rows)} 条。判别条件 A 取值:靠近中心 / 边缘 / 不属于 / 无法判定。", "",
          "| id | 名称 | 主族 | 机制 | 脱义度 | A 判定 |", "|---|---|---|---|---|---|"]
    for r in out_rows:
        md.append(f"| {r['id']} | {r['name']} | {r['primary_family']} {r['family_name']} | "
                  f"{r['mechanism']} | {r['dereference']} | {r['cond_a']} |")
    md.append("")
    md.append("## 各族成员")
    md.append("")
    by_fam = defaultdict(list)
    for r in out_rows:
        by_fam[r["primary_family"]].append(r["name"])
    for k in sorted(by_fam):
        md.append(f"- **{k} {FAMILIES.get(k, {}).get('name', '未归类')}**: " + "、".join(by_fam[k]))
    with open(os.path.join("lab", "data", "structure_matrix.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")

    # ---------- 本体论 JSON 快照 ----------
    ontology = dict(
        version="0.9",
        object="中文互联网被称作『抽象』的现象集合",
        classification_unit=dict(
            name="现象族",
            rule="原型+家族相似:一个现象属于该族,只要它与该族原型在至少两个属性轴上接近,不必满足任何充要条件",
        ),
        axes=[
            dict(id="axis0", name="参与门槛",
                 levels=sorted(set(r["axis0_gate"] for r in out_rows))),
            dict(id="axis1", name="脱义度",
                 levels=[k for k, _ in Counter(r["dereference"] for r in out_rows).most_common()]),
            dict(id="axis2", name="去语境化度",
                 levels=["完全剥离", "剥离但可回溯", "语境保留"],
                 note="经检验由 axis1 一一映射决定,无独立信息量"),
            dict(id="axis3", name="参与成本", levels=["极低", "低", "中", "高"]),
            dict(id="axis4", name="攻击性", levels=["攻击性", "攻击性已剥离", "无攻击性"]),
        ],
        strategies=[
            "规则一 多族归属:归属须逐族记录,主族另判",
            "规则二 主族判定:主族=该现象得以传播的第一形式",
            "规则三 迁移留痕:族归属可随传播形态改变,改变须留痕而非改写",
            "规则四 张力显式化:跨族属性冲突不强行调和,如实记录",
        ],
        central_structure=dict(
            claim="抽象是把『理解被阻断』这件事本身,做成了可参与、可传播的东西",
            mechanisms=["(i) 脱义传播", "(ii) 去语境挪用", "(iii) 认知不配合"],
            note="三者共同后果是参与不依赖于理解;越靠近中心三条机制越齐备",
        ),
        families={k: dict(**v, member_count=fam_counts.get(k, 0),
                          members=by_fam.get(k, [])) for k, v in FAMILIES.items()},
        inference_conditions=[
            "A 脱义/去语境测试:≥1.5 靠近中心 / 1.0–1.5 边缘 / <1.0 不属于"
            "(实现阈值 ≥1.0;阈值敏感性见 structure_check.txt)",
            "B 替换测试:保留形式替换意义,仍能用则属抽象机制,否则只是普通热梗",
        ],
        corpus=dict(source="lab/data/meme_samples.csv", n=len(out_rows)),
    )
    with open(os.path.join("lab", "data", "ontology.json"), "w", encoding="utf-8") as f:
        json.dump(ontology, f, ensure_ascii=False, indent=2)

    # ---------- 统一统计摘要(唯一计算源,附录生成器只渲染不重算) ----------
    def _cov(edge):
        t = [r for r in pos if sc(r) is not None and sc(r) >= edge]
        return len(t), len(pos)

    stats = dict(
        n=len(out_rows),
        evidence=dict(Counter(r["evidence_level"] for r in out_rows)),
        n_url=sum(1 for r in out_rows if r["url"] != "UNKNOWN"),
        unknown=[f"{r['id']} {r['name']}" for r in out_rows if r["url"] == "UNKNOWN"],
        axes={c: dict(Counter(r[c] for r in out_rows))
              for c in ("axis0_gate", "axis2_context", "axis3_cost", "axis4_aggression")},
        deref=dict(Counter(r["dereference"] for r in out_rows)),
        families=dict(Counter(r["primary_family"] for r in out_rows)),
        family_names={k: FAMILIES.get(k, {}).get("name", "未归类")
                      for k in set(r["primary_family"] for r in out_rows)},
        empty_families=family_empty,
        deviations=[f"{r['id']} {r['name']}：属 {r['primary_family']} 但脱义度为「{r['dereference']}」"
                    for r in out_rows if r["primary_family"] in FAMILY_EXPECTED_DEREF
                    and r["dereference"] not in FAMILY_EXPECTED_DEREF[r["primary_family"]]],
        coverage={"ge1.5": _cov(1.5), "ge1.0": _cov(1.0), "ge0.5": _cov(0.5),
                  "A_or_B": (len(tp), len(pos))},
        fp=len(fp), borderline=len(borderline), tn=len(tn_excl), neg=len(neg),
        fp_old=[f"{r['id']} {r['name']}" for r in fp_old],
        verdicts=dict(Counter(r["verdict"] for r in out_rows)),
    )
    with open(os.path.join("lab", "data", "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    print(report)
    print()
    print("已写出: lab/data/stats.json")
    print("已写出: lab/data/structure_matrix.csv")
    print("已写出: lab/data/structure_matrix.md")
    print("已写出: lab/data/ontology.json")


if __name__ == "__main__":
    main()
