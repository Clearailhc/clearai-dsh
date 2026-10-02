"""Deterministic sample data shared by both JSON routes."""


def sample_data():
    return {
        "dataset": "json-size-lab",
        "version": 1,
        "records": [
            {"id": i, "name": f"item-{i}", "value": i * 1.5, "active": i % 2 == 0, "tags": ["a", "b", "c"][: i % 3 + 1]}
            for i in range(50)
        ],
    }
