import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagServiceClient, DiagServiceContractError, DiagServiceUnavailableError } from "./diagServiceClient.js";

const baseUrl = "http://localhost:8000";

function createClient() {
  return new DiagServiceClient({ baseUrl });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DiagServiceClient.parseDtcFile", () => {
  it("geçerli bir yanıtı döner ve doğru endpoint'e/gövdeyle POST atar", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { matches: [{ code: "P0300", description: "Ateşleme hatası", known: true }], unknown_codes: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient();

    const result = await client.parseDtcFile(Buffer.from("P0300\n"), "log.txt");

    expect(result.matches).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:8000/dtc/parse");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("bağlantı hatasında/timeout'ta DiagServiceUnavailableError fırlatır — retry/kuyruk yok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED")),
    );
    const client = createClient();

    await expect(client.parseDtcFile(Buffer.from("x"), "log.txt")).rejects.toBeInstanceOf(
      DiagServiceUnavailableError,
    );
  });

  it("diag-service 400 ile boş dosya hatası döndürürse DiagServiceRequestError fırlatır, mesajı taşır", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { detail: "Yüklenen dosya boş." })));
    const client = createClient();

    await expect(client.parseDtcFile(Buffer.from(""), "log.txt")).rejects.toMatchObject({
      name: "DiagServiceRequestError",
      message: "Yüklenen dosya boş.",
    });
  });

  it("diag-service 422 validation error listesi döndürürse mesajları birleştirir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, { detail: [{ loc: ["body", "file"], msg: "field required", type: "missing" }] }),
      ),
    );
    const client = createClient();

    await expect(client.parseDtcFile(Buffer.from("x"), "log.txt")).rejects.toMatchObject({
      name: "DiagServiceRequestError",
      message: "field required",
    });
  });

  it("200 döner ama gövde sözleşmeyle uyuşmazsa DiagServiceContractError fırlatır (sözleşme drift'i)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true })));
    const client = createClient();

    await expect(client.parseDtcFile(Buffer.from("x"), "log.txt")).rejects.toBeInstanceOf(
      DiagServiceContractError,
    );
  });
});

describe("DiagServiceClient.analyzeWotFile", () => {
  it("geçerli bir WotAnalysisResponse'u doğru endpoint'ten döner", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { row_count: 3, findings: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient();

    const result = await client.analyzeWotFile(Buffer.from("csv"), "wot.csv");

    expect(result.row_count).toBe(3);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.toString()).toBe("http://localhost:8000/wot/analyze");
  });

  it("sözleşme dışı bir yanıtta DiagServiceContractError fırlatır", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { rowCount: 3 })));
    const client = createClient();

    await expect(client.analyzeWotFile(Buffer.from("csv"), "wot.csv")).rejects.toBeInstanceOf(
      DiagServiceContractError,
    );
  });
});
