#!/usr/bin/env python3
"""从 data/ 的权威 CSV 生成 artifacts/graph.json（主数据 + 追溯链）。

只导出 data/README.md 数据字典里的 8 个类型与 7 条关系；每个实体/边都带
源文件与 1-based 行号（表头为第 1 行）。同一 shipment 的重复 record_version
只产生一个实体，证据取该 shipment_id 首次出现的行。

阶段 3 起同时纳入 data/new-shipments.csv 的新出货（SHP121–SHP132）；用料更正
（usage-corrections.csv）不改写源记录，因此 uses_lot 边仍对应 material_usage 的原始行，
更正的生效视图记录在本体（usage_correction）。
"""

from __future__ import annotations

import json
from pathlib import Path

from trace_lib import ROOT, Case

CONCEPTS = [
    {"id": "supplier", "definition": "供应商，以 suppliers.csv 的 supplier_id 为唯一身份；trade_name 只是商标，不构成实体身份。"},
    {"id": "plant", "definition": "工厂，以 plants.csv 的 plant_id 为唯一身份。"},
    {"id": "line", "definition": "产线，以 lines.csv 的 line_id 为唯一身份；label 是重复的本地标签，不能当实体 ID。"},
    {"id": "product", "definition": "产品型号，以 products.csv 的 product_id 为唯一身份。"},
    {"id": "customer", "definition": "客户，以 customers.csv 的 customer_id 为唯一身份。"},
    {"id": "material_lot", "definition": "来料批次，以 material_lots.csv 的 lot_id 为唯一身份，含 component（seal/housing）与到货日。"},
    {"id": "production_batch", "definition": "生产批次，以 production_batches.csv 的 batch_id 为唯一身份；一个批次恰有 seal 与 housing 两条用料行。"},
    {"id": "shipment", "definition": "出货记录，以 shipments.csv 的 shipment_id 为唯一身份；同一 shipment_id 可有多个 record_version，最高版本为准。"},
]

RELATIONS = [
    {"id": "supplied_by", "domain": "material_lot", "range": "supplier", "definition": "来料批次由该供应商供货（material_lots.supplier_id）。"},
    {"id": "located_at", "domain": "line", "range": "plant", "definition": "产线位于该工厂（lines.plant_id）。"},
    {"id": "uses_lot", "domain": "production_batch", "range": "material_lot", "definition": "生产批次使用了该来料批次（material_usage 一行）。"},
    {"id": "produced_on", "domain": "production_batch", "range": "line", "definition": "生产批次在该产线上生产（production_batches.line_id）。"},
    {"id": "produces", "domain": "production_batch", "range": "product", "definition": "生产批次产出该产品型号（production_batches.product_id）。"},
    {"id": "from_batch", "domain": "shipment", "range": "production_batch", "definition": "出货记录来自该生产批次（shipments.batch_id）；一条出货只引用一个批次。"},
    {"id": "delivered_to", "domain": "shipment", "range": "customer", "definition": "出货记录发往该客户（shipments.customer_id）。"},
]


def build(case: Case) -> dict:
    entities: list[dict] = []
    edges: list[dict] = []

    def ent(eid: str, etype: str, row: dict):
        entities.append({"id": eid, "type": etype,
                         "evidence": [{"path": row["_path"], "row": row["_row"]}]})

    def edge(subj: str, pred: str, obj: str, row: dict):
        edges.append({"subject": subj, "predicate": pred, "object": obj,
                      "evidence": [{"path": row["_path"], "row": row["_row"]}]})

    for r in case.suppliers:
        ent(r["supplier_id"], "supplier", r)
    for r in case.plants:
        ent(r["plant_id"], "plant", r)
    for r in case.lines:
        ent(r["line_id"], "line", r)
        edge(r["line_id"], "located_at", r["plant_id"], r)
    for r in case.products:
        ent(r["product_id"], "product", r)
    for r in case.customers:
        ent(r["customer_id"], "customer", r)

    for r in case.lots:
        ent(r["lot_id"], "material_lot", r)
        edge(r["lot_id"], "supplied_by", r["supplier_id"], r)

    for r in case.batches:
        ent(r["batch_id"], "production_batch", r)
        edge(r["batch_id"], "produced_on", r["line_id"], r)
        edge(r["batch_id"], "produces", r["product_id"], r)

    for r in case.usage_effective:
        edge(r["batch_id"], "uses_lot", r["lot_id"], r)
        if r.get("_correction_id"):
            correction = case.corrections_by_usage[r["_correction_id"]]
            edges[-1]["evidence"].append({"path": correction["_path"], "row": correction["_row"]})

    # 出货：每个 shipment_id 一个实体，证据取首次出现的行；重复版本不新增实体
    first_seen: dict[str, dict] = {}
    for r in case.shipments:
        first_seen.setdefault(r["shipment_id"], r)
    for sid in sorted(first_seen):
        r = first_seen[sid]
        ent(sid, "shipment", r)
        edge(sid, "from_batch", r["batch_id"], r)
        edge(sid, "delivered_to", r["customer_id"], r)

    entities.sort(key=lambda e: (e["type"], e["id"]))
    edges.sort(key=lambda e: (e["predicate"], e["subject"], e["object"]))
    return {"concepts": CONCEPTS, "relations": RELATIONS, "entities": entities, "edges": edges}


def main() -> None:
    # NOTICE-2 的 as-of 视图：纳入新增出货；隔离判定不影响图的结构
    case = Case(notice_path=ROOT / "data" / "notice-v2.json", addenda=True)
    graph = build(case)
    out = ROOT / "artifacts" / "graph.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts: dict[str, int] = {}
    for e in graph["entities"]:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    print(f"wrote {out.relative_to(ROOT)}: {len(graph['entities'])} entities {counts}, "
          f"{len(graph['edges'])} edges")


if __name__ == "__main__":
    main()
