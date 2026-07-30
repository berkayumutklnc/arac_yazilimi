import {
  dtcParseResponseSchema,
  wotAnalysisResponseSchema,
  type DtcParseResponse,
  type WotAnalysisResponse,
} from "@arac-yazilim/shared";

const REQUEST_TIMEOUT_MS = 30_000;

// diag-service'e ulaşılamadı (bağlantı reddedildi/DNS/30sn timeout) — bkz.
// ADR 0009: kuyruğa alma/retry YOK, çağıran taraf net bir hatayla bilgilendirilir.
export class DiagServiceUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Diagnostik servise ulaşılamadı. Lütfen daha sonra tekrar deneyin.");
    this.name = "DiagServiceUnavailableError";
    this.cause = cause;
  }
}

// diag-service 2xx dışı bir HTTP durum koduyla yanıt verdi (ör. bozuk/boş
// dosya → 400/422) — istemcinin kendi girdisi hatalı, servis erişilebilir.
export class DiagServiceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagServiceRequestError";
  }
}

// diag-service 200 döndü ama gövde beklenen şemayla uyuşmadı — sözleşme
// drift'i (apps/diag-service/tests/test_openapi_contract.py'nin
// YAKALAYAMADIĞI, iki servisin farklı commit'lerde olduğu bir çalışma zamanı
// sürprizi).
export class DiagServiceContractError extends Error {
  constructor(cause: unknown) {
    super("Diagnostik servis yanıtı beklenen şemayla uyuşmuyor.");
    this.name = "DiagServiceContractError";
    this.cause = cause;
  }
}

function formatDetailEntry(entry: unknown): string {
  if (entry && typeof entry === "object" && "msg" in entry) {
    const msg = entry.msg;
    if (typeof msg === "string") {
      return msg;
    }
  }
  return JSON.stringify(entry);
}

function extractDetailMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("detail" in body)) {
    return null;
  }
  const detail = body.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail.map((entry: unknown) => formatDetailEntry(entry)).join("; ");
  }
  return null;
}

export interface DiagServiceClientConfig {
  baseUrl: string;
}

// Node 22'nin yerleşik fetch/FormData/Blob/AbortSignal.timeout'u kullanılır —
// yeni bir HTTP kütüphanesi bağımlılığı eklenmedi (bkz. ADR 0009).
export class DiagServiceClient {
  constructor(private readonly config: DiagServiceClientConfig) {}

  async parseDtcFile(file: Buffer, fileName: string): Promise<DtcParseResponse> {
    const json = await this.postFile("/dtc/parse", file, fileName);
    const parsed = dtcParseResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new DiagServiceContractError(parsed.error);
    }
    return parsed.data;
  }

  async analyzeWotFile(file: Buffer, fileName: string): Promise<WotAnalysisResponse> {
    const json = await this.postFile("/wot/analyze", file, fileName);
    const parsed = wotAnalysisResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new DiagServiceContractError(parsed.error);
    }
    return parsed.data;
  }

  private async postFile(path: string, file: Buffer, fileName: string): Promise<unknown> {
    // Buffer'ın altındaki ArrayBufferLike, DOM'un BlobPart tipiyle (yalnızca
    // ArrayBuffer, SharedArrayBuffer değil) doğrudan uyuşmuyor — Uint8Array.from
    // sade bir ArrayBuffer'a kopyalar (küçük log dosyaları için önemsiz maliyet).
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(file)]), fileName);

    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.baseUrl), {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Bağlantı reddedildi, DNS hatası, timeout (Abort/TimeoutError) — hepsi
      // "servise ulaşılamadı" olarak ele alınır (bkz. sınıf yorumu).
      throw new DiagServiceUnavailableError(err);
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = extractDetailMessage(body) ?? `Diagnostik servis hata döndü (HTTP ${response.status}).`;
      throw new DiagServiceRequestError(detail);
    }

    return response.json();
  }
}
