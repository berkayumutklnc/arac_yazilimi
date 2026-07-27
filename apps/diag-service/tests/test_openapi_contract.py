import json
from pathlib import Path

from diag_service.main import app

CONTRACT_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "packages"
    / "shared"
    / "openapi"
    / "diag-service.json"
)


def test_committed_openapi_contract_matches_current_app():
    assert CONTRACT_PATH.exists(), (
        f"{CONTRACT_PATH} bulunamadı — apps/diag-service/scripts/export_openapi.py çalıştırılmalı."
    )
    committed = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    current = app.openapi()
    assert committed == current, (
        "packages/shared/openapi/diag-service.json güncel değil — "
        "scripts/export_openapi.py yeniden çalıştırıp commit edin."
    )
