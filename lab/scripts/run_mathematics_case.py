#!/usr/bin/env python3
"""Reproducible finite-prefix primality check with exact integer arithmetic."""
from __future__ import annotations

import csv
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "lab" / "cases" / "mathematics"
OUT.mkdir(parents=True, exist_ok=True)


def is_prime(n: int) -> bool:
    if n < 2:
        return False
    if n % 2 == 0:
        return n == 2
    divisor = 3
    while divisor * divisor <= n:
        if n % divisor == 0:
            return False
        divisor += 2
    return True


def sequence_term(index: int) -> int:
    # A deliberately simple recursive sequence: a_0=2, a_(n+1)=a_n+2.
    # It produces a finite prefix with both primes and composites, making
    # the boundary between calculation and proof explicit.
    return 2 + 2 * index


def main() -> None:
    count = 30
    rows = []
    for index in range(count):
        value = sequence_term(index)
        rows.append({"index": index, "value": value, "is_prime": is_prime(value)})

    with (OUT / "results.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    first_composite = next(row for row in rows if not row["is_prime"])
    metadata = {
        "case": "finite primality check",
        "definition": "a_0=2; a_(n+1)=a_n+2; equivalently a_n=2+2n",
        "checked_terms": count,
        "arithmetic": "exact Python integers",
        "primality_test": "trial division through floor(sqrt(n))",
        "first_composite": first_composite,
        "command": "python3 lab/scripts/run_mathematics_case.py",
        "python": platform.python_version(),
        "platform": platform.platform(),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    (OUT / "run_metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    print("index,value,is_prime")
    for row in rows:
        print(f"{row['index']},{row['value']},{str(row['is_prime']).lower()}")


if __name__ == "__main__":
    main()
