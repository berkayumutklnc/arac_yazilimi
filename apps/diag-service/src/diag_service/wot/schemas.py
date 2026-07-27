from pydantic import BaseModel


class WotRow(BaseModel):
    row_index: int
    afr: float | None = None
    boost_target_bar: float | None = None
    boost_actual_bar: float | None = None
    ignition_retard_deg: float | None = None


class Finding(BaseModel):
    rule_id: str
    severity: str
    message: str
    row_index: int
    details: dict[str, float]


class WotAnalysisResponse(BaseModel):
    row_count: int
    findings: list[Finding]
