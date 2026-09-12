{
  "schema_version": "1.0",
  "description": "Unit-level topology for process-style systems. Nodes are units/utilities/boundaries; edges are material/energy. No measurement tag or field names in this file; tags are added in the data skill workflow02 enrichment. Each edge should carry an evidence object that points to products/extracted/process_brief.md or products/extracted/unit_inventory.md; inferred edges must be explicitly marked.",
  "nodes": [
    {
      "id": "Unit_S201",
      "type": "unit",
      "label": "S201",
      "notes": "Separation unit (example)"
    },
    {
      "id": "SteamHeader_HP",
      "type": "utility",
      "label": "SteamHeader_HP",
      "notes": "High-pressure steam header (example utility)"
    },
    {
      "id": "Boundary_Feed",
      "type": "boundary",
      "label": "Feed",
      "notes": "Net input boundary"
    },
    {
      "id": "Boundary_Product",
      "type": "boundary",
      "label": "Product",
      "notes": "Net output boundary"
    }
  ],
  "edges": [
    {
      "id": "Edge_Feed_to_S201",
      "kind": "material",
      "from": "Boundary_Feed",
      "to": "Unit_S201",
      "stream_name": "Feed",
      "direction": "in",
      "measurement_slots": [
        "flow"
      ],
      "evidence": {
        "type": "process_brief_quote",
        "source": "products/extracted/process_brief.md",
        "location": "§2 原文摘录, 第x段",
        "excerpt": "在此粘贴支持该连接的逐字引用（或说明来自 products/extracted/unit_inventory.md）"
      },
      "notes": "Data skill workflow02 should enrich this edge with flow_tag and unit."
    },
    {
      "id": "Edge_S201_to_Product",
      "kind": "material",
      "from": "Unit_S201",
      "to": "Boundary_Product",
      "stream_name": "Product",
      "direction": "out",
      "measurement_slots": [
        "flow"
      ],
      "evidence": {
        "type": "process_brief_quote",
        "source": "products/extracted/process_brief.md",
        "location": "§2 原文摘录, 第x段",
        "excerpt": "在此粘贴支持该连接的逐字引用（或说明来自 products/extracted/unit_inventory.md）"
      },
      "notes": "Avoid treating reflux/internal recycle as net product."
    },
    {
      "id": "Edge_HPSteam_to_S201",
      "kind": "energy",
      "from": "SteamHeader_HP",
      "to": "Unit_S201",
      "energy_medium": "steam",
      "direction": "in",
      "measurement_slots": [
        "steam_flow"
      ],
      "evidence": {
        "type": "process_brief_quote",
        "source": "products/extracted/process_brief.md",
        "location": "§2 原文摘录, 第x段",
        "excerpt": "在此粘贴支持该连接的逐字引用；若为推断，type 写 inferred 并说明验证方法"
      },
      "notes": "Data skill workflow02 should enrich with steam_flow_tag, pressure_level, unit."
    }
  ]
}
