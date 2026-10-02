"""Generate lab/raw.csv: 3 columns (a, b, c) x 20 rows of numeric data.

Method: Python's random module seeded with 20261002.
  a ~ Uniform(0, 100)
  b ~ Normal(mean=50, sd=10)
  c ~ Uniform(-20, 20)
Each value is rounded to 2 decimal places. Re-running yields a byte-identical file.
"""
import csv
import random
from pathlib import Path

SEED = 20261002
N_ROWS = 20
OUT = Path(__file__).resolve().parent / "raw.csv"


def main() -> None:
    rng = random.Random(SEED)
    rows = []
    for _ in range(N_ROWS):
        a = round(rng.uniform(0, 100), 2)
        b = round(rng.gauss(50, 10), 2)
        c = round(rng.uniform(-20, 20), 2)
        rows.append((f"{a:.2f}", f"{b:.2f}", f"{c:.2f}"))
    with OUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["a", "b", "c"])
        writer.writerows(rows)


if __name__ == "__main__":
    main()
