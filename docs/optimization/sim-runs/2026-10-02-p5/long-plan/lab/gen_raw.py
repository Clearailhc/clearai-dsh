"""Generate lab/raw.csv: 3 numeric columns x 20 rows, reproducible (fixed seed).

a: uniform [0,100), rounded to 2 decimals
b: normal N(mean=50, sd=10), rounded to 2 decimals
c: integer randint(1, 10)
"""
import csv
import os
import random

SEED = 20261002
N = 20

rng = random.Random(SEED)
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "raw.csv")
with open(out, "w", newline="") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["a", "b", "c"])
    for _ in range(N):
        a = round(rng.uniform(0, 100), 2)
        b = round(rng.gauss(50, 10), 2)
        c = rng.randint(1, 10)
        w.writerow([f"{a:.2f}", f"{b:.2f}", c])
print(f"wrote {out} ({N} rows, seed={SEED})")
