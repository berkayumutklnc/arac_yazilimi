"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";

// Yalnızca UX yönlendirmesi — gerçek kontrol backend'in requireRole(OWNER)
// 403'leri. bkz. apps/web/app/(protected)/admin/layout.tsx'deki aynı desen.
export default function DealerLinksLayout({ children }: { children: ReactNode }) {
  const { auth, status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && auth?.role !== "OWNER") {
      router.replace("/work-orders");
    }
  }, [status, auth, router]);

  if (auth?.role !== "OWNER") {
    return null;
  }

  return <>{children}</>;
}
