import csv
import io

from .rules import RULES
from .schemas import Finding, WotRow

_FLOAT_COLUMNS = ("afr", "boost_target_bar", "boost_actual_bar", "ignition_retard_deg")


def _parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    try:
        return float(stripped)
    except ValueError:
        return None


def parse_wot_csv(text: str) -> list[WotRow]:
    reader = csv.DictReader(io.StringIO(text))
    rows: list[WotRow] = []
    for index, raw_row in enumerate(reader):
        normalized = {
            (key or "").strip().lower(): value for key, value in raw_row.items()
        }
        rows.append(
            WotRow(
                row_index=index,
                **{col: _parse_float(normalized.get(col)) for col in _FLOAT_COLUMNS},
            )
        )
    return rows


def analyze(rows: list[WotRow]) -> list[Finding]:
    findings: list[Finding] = []
    for row in rows:
        for rule in RULES:
            finding = rule(row)
            if finding is not None:
                findings.append(finding)
    return findings
