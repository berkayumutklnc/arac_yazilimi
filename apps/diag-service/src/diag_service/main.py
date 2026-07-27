from fastapi import FastAPI

from .dtc.router import router as dtc_router
from .wot.router import router as wot_router

app = FastAPI(title="Diag Service", version="0.1.0")
app.include_router(dtc_router)
app.include_router(wot_router)
