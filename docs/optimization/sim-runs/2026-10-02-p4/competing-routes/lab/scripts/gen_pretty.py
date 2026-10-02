"""Route pretty: write sample data as indented JSON and record its byte size."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sample_data import build_data  # noqa: E402

OUT = "lab/pretty/data.json"
with open(OUT, "w", encoding="utf-8") as f:
    f.write(json.dumps(build_data(), indent=2))
size = os.path.getsize(OUT)
with open("lab/pretty/size.txt", "w", encoding="utf-8") as f:
    f.write(f"{size}\n")
print(OUT, size)
