"""Read lab/raw.csv and write per-column arithmetic means to lab/means.json.

Means are rounded to 6 decimal places.
"""
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw.csv"
OUT = HERE / "means.json"


def column_means(path: Path) -> dict[str, float]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        columns = list(reader.fieldnames or [])
        sums = {c: 0.0 for c in columns}
        n = 0
        for row in reader:
            for c in columns:
                sums[c] += float(row[c])
            n += 1
    if n == 0:
        raise ValueError(f"no data rows in {path}")
    return {c: round(sums[c] / n, 6) for c in columns}


def main() -> None:
    means = column_means(RAW)
    OUT.write_text(json.dumps(means, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(means))


if __name__ == "__main__":
    main()
