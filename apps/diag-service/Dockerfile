# syntax=docker/dockerfile:1
#
# Build context bu dizin (apps/diag-service) — Python, npm workspaces'in
# dışında, kendi kendine yeterli (bkz. docs/adr/0015).

FROM python:3.11-slim AS build
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app/src
RUN addgroup --system app && adduser --system --ingroup app --no-create-home app
COPY --from=build /install /usr/local
COPY src ./src
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"
CMD ["uvicorn", "diag_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
