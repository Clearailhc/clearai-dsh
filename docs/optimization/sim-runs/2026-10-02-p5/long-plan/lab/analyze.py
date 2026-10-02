"""Read lab/raw.csv, compute per-column arithmetic mean, write lab/means.json.

Means are sum/len over the 20 data rows, rounded to 6 decimals.
"""
import csv
import json
import os

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "raw.csv"), newline="") as f:
    rows = list(csv.DictReader(f))

cols = ["a", "b", "c"]
means = {c: round(sum(float(r[c]) for r in rows) / len(rows), 6) for c in cols}
out = {**means, "n_rows": len(rows)}
with open(os.path.join(here, "means.json"), "w") as f:
    json.dump(out, f, indent=2)
    f.write("\n")
print(json.dumps(out))
