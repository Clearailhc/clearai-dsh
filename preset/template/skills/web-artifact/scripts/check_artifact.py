#!/usr/bin/env python3
"""单文件网页制品的确定性检查。

能规则化的判断不交给 LLM。全部 PASS 才算可交付。

    python3 check_artifact.py out/topology.html [--source data.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FAILED: list[str] = []
PASSED = 0
RESULTS: list[dict] = []

# SVG/XML 命名空间是标识符，浏览器不会去取它
ALLOWED_URLS = {
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/XML/1998/namespace",
}


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASSED
    RESULTS.append({"check": name, "ok": bool(ok), "detail": detail})
    if ok:
        PASSED += 1
    else:
        FAILED.append(name)


def check_offline(html: str) -> None:
    """运行时零网络请求：产物在没网的环境里也要完整打开。"""
    urls = {u.rstrip('\'").,;') for u in re.findall(r"https?://[^\s\"'<>)]+", html)}
    leaked = sorted(u for u in urls if u not in ALLOWED_URLS)
    check("offline.no_external_url", not leaked,
          f"{len(leaked)} 处外部引用：{leaked[:3]}")

    tags = re.findall(r"<(script|link|img|iframe|source|video|audio)\b[^>]*>", html, re.I)
    external = [t for t in tags if re.search(r"\b(src|href)\s*=\s*[\"'](?!#|data:)", t)]
    check("offline.no_external_asset_tag", not external, f"{external[:2]}")

    check("offline.no_import_map", "importmap" not in html)
    check("offline.no_bare_import",
          not re.search(r"\bimport\s+.*\bfrom\s+[\"'](?!\.|/|data:)", html))


def check_provenance(html: str) -> dict:
    """制品要自陈来历：从什么生成、什么时候、生成器是谁。"""
    m = re.search(r'<script id="artifact-data"[^>]*>(.*?)</script>', html, re.S)
    check("data.embedded", bool(m), "找不到内嵌数据块")
    if not m:
        return {}
    try:
        data = json.loads(m.group(1).replace("\\u003c", "<"))
    except json.JSONDecodeError as exc:
        check("data.valid_json", False, str(exc))
        return {}
    check("data.valid_json", True)

    prov = data.get("provenance") or {}
    check("provenance.generated_at", bool(prov.get("generatedAt")))
    check("provenance.generator", bool(prov.get("generator")))

    footer = re.search(r"<footer>(.*?)</footer>", html, re.S)
    check("provenance.visible_in_page",
          bool(footer and prov.get("generator", "?") in footer.group(1)),
          "页脚没有把来历写出来，读者看不到")
    return data


def check_graph(data: dict, source: Path | None) -> None:
    graph = data.get("graph") or {}
    nodes, edges = graph.get("nodes") or [], graph.get("edges") or []
    check("graph.non_empty", bool(nodes), "没有任何节点")

    ids = [n.get("id") for n in nodes] + [e.get("id") for e in edges]
    check("graph.ids_present", all(ids), "存在缺 id 的元素")
    check("graph.ids_unique", len(ids) == len(set(ids)),
          "id 重复会让标注对不回来")

    node_ids = {n.get("id") for n in nodes}
    dangling = [e.get("id") for e in edges
                if e.get("source") not in node_ids or e.get("target") not in node_ids]
    check("graph.no_dangling_edge", not dangling, f"悬挂边 {dangling[:3]}")

    no_points = [e.get("id") for e in edges if len(e.get("points") or []) < 2]
    check("graph.edges_have_geometry", not no_points,
          f"{len(no_points)} 条边没有布局器给的路径点")

    if source and source.exists():
        try:
            src = json.loads(source.read_text())
        except json.JSONDecodeError:
            return
        sn, se = len(src.get("children") or []), len(src.get("edges") or [])
        check("graph.node_count_matches_source", sn == len(nodes), f"源 {sn} / 产物 {len(nodes)}")
        check("graph.edge_count_matches_source", se == len(edges), f"源 {se} / 产物 {len(edges)}")


def check_theme(html: str) -> None:
    """三态都要有：显式 light、显式 dark、以及什么都没标的系统态。"""
    check("theme.root_tokens", ":root {" in html or ":root{" in html)
    check("theme.system_dark",
          bool(re.search(r"prefers-color-scheme:\s*dark", html)),
          "缺了未标记的系统态，最常见的漏配")
    check("theme.explicit_dark", '[data-theme="dark"]' in html)
    check("theme.body_background",
          bool(re.search(r"body\s*\{[^}]*background", html, re.S)),
          "body 不上底色会借用宿主的底，深浅主题下会串")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("artifact", type=Path)
    ap.add_argument("--source", type=Path, default=None,
                    help="源数据，给了就比对计数")
    ap.add_argument("--json", type=Path, default=None,
                    help="把结果写成 JSON，供 done_criteria 引用")
    args = ap.parse_args()

    if not args.artifact.exists():
        print(f"找不到 {args.artifact}")
        return 2

    html = args.artifact.read_text(encoding="utf-8")
    size_kb = args.artifact.stat().st_size / 1024

    check_offline(html)
    data = check_provenance(html)
    if data:
        check_graph(data, args.source)
    check_theme(html)

    print(f"检查 {args.artifact}（{size_kb:.0f} KB）\n")
    for r in RESULTS:
        mark = "PASS" if r["ok"] else "FAIL"
        line = f"  {mark}  {r['check']}"
        if not r["ok"] and r["detail"]:
            line += f" — {r['detail']}"
        print(line)

    total = PASSED + len(FAILED)
    print(f"\n{PASSED}/{total} 通过" + (f"，失败：{', '.join(FAILED)}" if FAILED else ""))

    if args.json:
        args.json.write_text(json.dumps({
            "artifact": str(args.artifact),
            "size_kb": round(size_kb, 1),
            "passed": PASSED,
            "total": total,
            "ok": not FAILED,
            "failed": FAILED,
            "checks": RESULTS,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"结果已写入 {args.json}")

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
