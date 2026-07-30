"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Role } from "@arac-yazilim/shared";
import { apiFetch, getAccessToken, setAccessToken, subscribeAccessToken, refreshAccessToken } from "./apiClient";

interface DecodedAccessToken {
  userId: string;
  tenantId: string;
  role: Role;
}

// İmza DOĞRULANMAZ — yalnızca UI'da rol/tenant gösterimi için. Güvenlik
// kararları her zaman backend'de, gerçek doğrulamayla verilir (bkz.
// apps/api ADR 0006). Base64url decode (JWT segment ayracı '.'), tarayıcı
// dışı ortamlarda (SSR) çalışmaz — bu dosya yalnızca client component'lerde kullanılır.
function decodeAccessToken(token: string): DecodedAccessToken | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    const parsed = JSON.parse(json) as Partial<DecodedAccessToken>;
    if (!parsed.userId || !parsed.tenantId || !parsed.role) return null;
    return { userId: parsed.userId, tenantId: parsed.tenantId, role: parsed.role };
  } catch {
    return null;
  }
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  auth: DecodedAccessToken | null;
  login: (tenantSlug: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function subscribe(listener: () => void): () => void {
  return subscribeAccessToken(() => listener());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(subscribe, getAccessToken, () => null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  // Sayfa yenilendiğinde/ilk yüklemede token bellekte yok — refresh cookie
  // hâlâ geçerliyse sessizce yeni bir access token alınır.
  useEffect(() => {
    let cancelled = false;
    if (getAccessToken()) {
      setStatus("authenticated");
      return;
    }
    void refreshAccessToken().then((newToken) => {
      if (!cancelled) {
        setStatus(newToken ? "authenticated" : "unauthenticated");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const auth = useMemo(() => (token ? decodeAccessToken(token) : null), [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      auth,
      async login(tenantSlug, email, password) {
        const result = await apiFetch<{ accessToken: string }>("/auth/login", {
          method: "POST",
          body: { tenantSlug, email, password },
          skipAuthRetry: true,
        });
        setAccessToken(result.accessToken);
        setStatus("authenticated");
      },
      logout() {
        setAccessToken(null);
        setStatus("unauthenticated");
      },
    }),
    [status, auth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth yalnızca AuthProvider içinde kullanılabilir.");
  }
  return ctx;
}
