from fastapi import FastAPI
from fastapi.testclient import TestClient

from diag_service.wot.router import router as wot_router


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(wot_router)
    return TestClient(app)


def test_analyze_returns_findings_and_row_count():
    client = make_client()
    csv_text = (
        "afr,boost_target_bar,boost_actual_bar,ignition_retard_deg\n"
        "12.0,1.0,1.0,0.0\n"
        "12.0,1.0,0.8,0.0\n"
    )

    response = client.post(
        "/wot/analyze",
        files={"file": ("wot.csv", csv_text.encode("utf-8"), "text/csv")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["row_count"] == 2
    assert any(f["rule_id"] == "boost_leak" for f in body["findings"])


def test_analyze_rejects_empty_file():
    client = make_client()

    response = client.post(
        "/wot/analyze",
        files={"file": ("empty.csv", b"", "text/csv")},
    )

    assert response.status_code == 400
