"""Serialize one fixed dataset as compact or pretty JSON and record its byte size.

Usage: python3 lab/scripts/gen_json.py {compact|pretty}
Writes lab/<style>/data.json and lab/<style>/bytes.txt (relative to the cwd).
"""
import json
import os
import sys

DATA = {
    "project": "json-size-lab",
    "version": 1,
    "tags": ["alpha", "beta", "gamma"],
    "records": [
        {"id": i, "name": f"item-{i}", "value": i * 1.5, "active": i % 2 == 0}
        for i in range(20)
    ],
}

STYLES = {
    "compact": {"separators": (",", ":")},
    "pretty": {"indent": 2},
}


def main() -> None:
    style = sys.argv[1] if len(sys.argv) > 1 else ""
    if style not in STYLES:
        sys.exit(f"usage: gen_json.py {{{'|'.join(STYLES)}}}")
    out_dir = os.path.join("lab", style)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "data.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(DATA, **STYLES[style]))
    size = os.path.getsize(path)
    with open(os.path.join(out_dir, "bytes.txt"), "w", encoding="utf-8") as f:
        f.write(f"{size}\n")
    print(f"{style}: {path} = {size} bytes")


if __name__ == "__main__":
    main()
