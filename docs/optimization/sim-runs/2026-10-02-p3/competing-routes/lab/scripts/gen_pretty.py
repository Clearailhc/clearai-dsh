import json
import os
import sys

sys.path.insert(0, "lab/scripts")
from sample_data import sample_data  # noqa: E402

path = "lab/pretty/data.json"
with open(path, "w", encoding="utf-8") as f:
    json.dump(sample_data(), f, indent=2)
size = os.path.getsize(path)
with open("lab/pretty/size.txt", "w", encoding="utf-8") as f:
    f.write(f"{size}\n")
print(path, size)
