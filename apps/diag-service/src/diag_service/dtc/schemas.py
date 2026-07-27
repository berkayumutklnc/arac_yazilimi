from pydantic import BaseModel


class DtcMatch(BaseModel):
    code: str
    description: str | None
    known: bool


class DtcParseResponse(BaseModel):
    matches: list[DtcMatch]
    unknown_codes: list[str]
