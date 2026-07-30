"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";

// Yalnızca UX yönlendirmesi — gerçek kontrol backend'in requireRole(SUPER_ADMIN)
// 403'leri (bkz. apps/api ADR 0010). auth.role, JWT'den imzası doğrulanmadan
// çözülüyor (bkz. authContext.tsx), bu yüzden burada asla güvenlik kararı verilmez.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { auth, status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && auth?.role !== "SUPER_ADMIN") {
      router.replace("/work-orders");
    }
  }, [status, auth, router]);

  if (auth?.role !== "SUPER_ADMIN") {
    return null;
  }

  return <>{children}</>;
}
