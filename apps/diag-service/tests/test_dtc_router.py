from fastapi import FastAPI
from fastapi.testclient import TestClient

from diag_service.dtc.router import router as dtc_router


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(dtc_router)
    return TestClient(app)


def test_parse_returns_known_and_unknown_codes():
    client = make_client()
    log_content = b"log: P0420 detected, also saw P9999 which is not catalogued. P0300 too."

    response = client.post(
        "/dtc/parse",
        files={"file": ("session.log", log_content, "text/plain")},
    )

    assert response.status_code == 200
    body = response.json()
    codes = {m["code"] for m in body["matches"]}
    assert codes == {"P0420", "P0300"}
    assert body["unknown_codes"] == ["P9999"]
    match_by_code = {m["code"]: m for m in body["matches"]}
    assert match_by_code["P0420"]["known"] is True
    assert "catalyst" in match_by_code["P0420"]["description"].lower()


def test_parse_rejects_empty_file():
    client = make_client()

    response = client.post(
        "/dtc/parse",
        files={"file": ("empty.log", b"", "text/plain")},
    )

    assert response.status_code == 400


def test_parse_returns_empty_matches_when_no_codes_found():
    client = make_client()

    response = client.post(
        "/dtc/parse",
        files={"file": ("clean.log", b"engine running normally, no faults", "text/plain")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["matches"] == []
    assert body["unknown_codes"] == []
