"""Generate lab/raw.csv: 3 numeric columns x 20 rows, reproducible.

Uses only the Python standard library (numpy is not available here).
random.Random(SEED) with SEED = 20261002 draws, column by column:
  a ~ Normal(mean=10, sd=2)   (random.gauss), written with 4 decimals
  b ~ Uniform[0, 100)         (random.uniform), written with 4 decimals
  c ~ integer uniform on 1..6 (random.randint, a die roll)
"""
import random
from pathlib import Path

SEED = 20261002
N_ROWS = 20
OUT = Path(__file__).resolve().parents[1] / "raw.csv"


def main() -> None:
    rng = random.Random(SEED)
    a = [rng.gauss(10.0, 2.0) for _ in range(N_ROWS)]
    b = [rng.uniform(0.0, 100.0) for _ in range(N_ROWS)]
    c = [rng.randint(1, 6) for _ in range(N_ROWS)]
    lines = ["a,b,c"]
    lines += [f"{x:.4f},{y:.4f},{z}" for x, y, z in zip(a, b, c)]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
