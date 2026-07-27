from fastapi import APIRouter, HTTPException, UploadFile

from .analyzer import analyze, parse_wot_csv
from .schemas import WotAnalysisResponse

router = APIRouter(prefix="/wot", tags=["wot"])


@router.post("/analyze", response_model=WotAnalysisResponse)
async def analyze_wot_file(file: UploadFile) -> WotAnalysisResponse:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Yüklenen dosya boş.")

    text = raw.decode("utf-8", errors="ignore")
    rows = parse_wot_csv(text)
    findings = analyze(rows)

    return WotAnalysisResponse(row_count=len(rows), findings=findings)
