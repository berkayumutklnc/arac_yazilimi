import json
from pathlib import Path
from functools import lru_cache

_CATALOG_PATH = Path(__file__).parent / "catalog_data.json"


@lru_cache(maxsize=1)
def _catalog() -> dict[str, str]:
    with _CATALOG_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def lookup(code: str) -> str | None:
    return _catalog().get(code)
