"""apps/api (Node) ile paylaşılan iç servis sözleşmesini üretir.

Kullanım: apps/diag-service içinde `python scripts/export_openapi.py` (venv aktifken).
Endpoint/şema değiştiğinde bu script yeniden çalıştırılıp çıktısı commit edilmelidir —
aksi halde tests/test_openapi_contract.py kırmızı olur.
"""

import json
import sys
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))

from diag_service.main import app  # noqa: E402

OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent / "packages" / "shared" / "openapi" / "diag-service.json"
)


def main() -> None:
    spec = app.openapi()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"OpenAPI şeması yazıldı: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
