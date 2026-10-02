"""Generate lab/raw.csv: 3 numeric columns (a, b, c) x 20 rows.

Method: Python's random module with fixed seed 42.
  a ~ Uniform(0, 100)
  b ~ Normal(mean=50, sd=10)
  c ~ Uniform(-20, 20)
Each value is rounded to 2 decimals. Rerunning reproduces the file byte-for-byte.
"""
import csv
import random
from pathlib import Path

SEED = 42
N_ROWS = 20
OUT = Path(__file__).resolve().parent / "raw.csv"


def main() -> None:
    rng = random.Random(SEED)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["a", "b", "c"])
        for _ in range(N_ROWS):
            a = round(rng.uniform(0, 100), 2)
            b = round(rng.gauss(50, 10), 2)
            c = round(rng.uniform(-20, 20), 2)
            writer.writerow([f"{a:.2f}", f"{b:.2f}", f"{c:.2f}"])


if __name__ == "__main__":
    main()
