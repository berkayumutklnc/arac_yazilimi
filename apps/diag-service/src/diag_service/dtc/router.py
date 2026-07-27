from fastapi import APIRouter, HTTPException, UploadFile

from .catalog import lookup
from .parser import extract_codes
from .schemas import DtcMatch, DtcParseResponse

router = APIRouter(prefix="/dtc", tags=["dtc"])


@router.post("/parse", response_model=DtcParseResponse)
async def parse_dtc_file(file: UploadFile) -> DtcParseResponse:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Yüklenen dosya boş.")

    text = raw.decode("utf-8", errors="ignore")
    codes = extract_codes(text)

    matches: list[DtcMatch] = []
    unknown_codes: list[str] = []
    for code in codes:
        description = lookup(code)
        if description is None:
            unknown_codes.append(code)
        else:
            matches.append(DtcMatch(code=code, description=description, known=True))

    return DtcParseResponse(matches=matches, unknown_codes=unknown_codes)
