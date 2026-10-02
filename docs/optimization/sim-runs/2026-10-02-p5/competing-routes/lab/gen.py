import json, sys
DATA = {"name": "sample", "version": 1, "tags": ["a", "b", "c"],
        "items": [{"id": i, "label": f"item-{i}", "ok": i % 2 == 0} for i in range(10)]}
mode, out = sys.argv[1], sys.argv[2]
with open(out, "w") as f:
    if mode == "compact":
        json.dump(DATA, f, separators=(",", ":"))
    else:
        json.dump(DATA, f, indent=2)
