"use client";

import Link from "next/link";
import type { Role } from "@arac-yazilim/shared";
import { useAuth } from "@/lib/authContext";

export function NavBar({ auth }: { auth: { role: Role } | null }) {
  const { logout } = useAuth();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
          {auth?.role === "SUPER_ADMIN" ? (
            <Link href="/admin/tenants" className="hover:text-slate-900">
              Yönetim Paneli
            </Link>
          ) : (
            <>
              <Link href="/work-orders" className="hover:text-slate-900">
                İş Emirleri
              </Link>
              <Link href="/dealer" className="hover:text-slate-900">
                {auth?.role === "DEALER" ? "Bayi Portalı" : "Bayi Talepleri"}
              </Link>
              {auth?.role === "OWNER" && (
                <>
                  <Link href="/dealer-links" className="hover:text-slate-900">
                    Bayi Bağlantıları
                  </Link>
                  <Link href="/settings/users" className="hover:text-slate-900">
                    Kullanıcılar
                  </Link>
                </>
              )}
            </>
          )}
        </nav>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          {auth && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium">{auth.role}</span>}
          <button type="button" onClick={logout} className="hover:text-slate-900">
            Çıkış
          </button>
        </div>
      </div>
    </header>
  );
}
