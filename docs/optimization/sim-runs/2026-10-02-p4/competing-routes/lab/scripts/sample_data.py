"""Shared deterministic sample data for the compact vs pretty JSON comparison."""


def build_data():
    return {
        "name": "sample",
        "version": 1,
        "tags": ["alpha", "beta", "gamma"],
        "items": [
            {"id": i, "label": f"item-{i}", "value": i * 1.5, "active": i % 2 == 0}
            for i in range(20)
        ],
        "meta": {"source": "lab/scripts/sample_data.py", "count": 20},
    }
