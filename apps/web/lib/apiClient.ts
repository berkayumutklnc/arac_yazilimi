import type { ApiErrorBody } from "@arac-yazilim/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.error || `API hatası (${status})`);
    this.name = "ApiError";
  }
}

// Access token yalnızca bu modülün belleğinde tutulur — localStorage'da DEĞİL
// (15dk ömürlü JWT, XSS yüzeyini küçük tutmak için; refresh token zaten
// httpOnly+secure+sameSite=strict cookie, bkz. apps/api ADR 0006). Sayfa
// yenilemesinde authContext.tsx bu belleği /auth/refresh ile sessizce
// yeniden doldurur.
type AccessTokenListener = (token: string | null) => void;
let accessToken: string | null = null;
const listeners = new Set<AccessTokenListener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener(token);
}

export function subscribeAccessToken(listener: AccessTokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshAccessToken(): Promise<string | null> {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    setAccessToken(null);
    return null;
  }
  const body = (await response.json()) as { accessToken: string };
  setAccessToken(body.accessToken);
  return body.accessToken;
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | undefined>;
  // /auth/login gibi rotalar için — 401'de refresh denemesi anlamsız
  // (henüz bir oturum yok), yanlış şifre hatasının olduğu gibi geçmesi gerekir.
  skipAuthRetry?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  const isFormData = options.body instanceof FormData;

  const doFetch = (token: string | null) =>
    fetch(url, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: {
        // FormData için Content-Type ATANMAZ — tarayıcı boundary'li
        // multipart/form-data değerini kendisi ekler. Gövdesiz isteklerde de
        // (ör. PATCH .../start) ATANMAZ — Fastify, Content-Type: application/json
        // ile birlikte boş bir gövde gelirse FST_ERR_CTP_EMPTY_JSON_BODY ile
        // 400 döner (canlı Postgres+MinIO'ya karşı ilk gerçek Playwright
        // e2e çalıştırmasında, tarayıcıdan yapılan gövdesiz PATCH'lerin hep
        // "Bad Request" aldığı tespit edildi).
        ...(!isFormData && options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : isFormData ? (options.body as FormData) : JSON.stringify(options.body),
    });

  let response = await doFetch(getAccessToken());

  if (response.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await doFetch(refreshed);
    }
  }

  if (!response.ok) {
    const body: ApiErrorBody = await response
      .json()
      .catch(() => ({ error: response.statusText || "Bilinmeyen bir hata oluştu." }));
    throw new ApiError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
