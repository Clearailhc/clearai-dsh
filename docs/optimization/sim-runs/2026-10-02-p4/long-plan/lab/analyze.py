"""Read lab/raw.csv and write per-column means to lab/means.json.

Standard library only (pandas is not available here). Means are rounded
to 6 decimals; the row count is recorded as "n".
"""
import csv
import json
from pathlib import Path

LAB = Path(__file__).resolve().parent
RAW = LAB / "raw.csv"
OUT = LAB / "means.json"
DECIMALS = 6


def column_means(path: Path) -> tuple[dict[str, float], int]:
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        columns = list(reader.fieldnames or [])
        sums = dict.fromkeys(columns, 0.0)
        n = 0
        for row in reader:
            for col in columns:
                sums[col] += float(row[col])
            n += 1
    if n == 0:
        raise ValueError(f"{path} has no data rows")
    return {col: round(total / n, DECIMALS) for col, total in sums.items()}, n


def main() -> None:
    means, n = column_means(RAW)
    OUT.write_text(json.dumps({"n": n, "means": means}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
