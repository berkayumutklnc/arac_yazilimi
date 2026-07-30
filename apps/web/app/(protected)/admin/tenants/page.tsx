"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TenantSummary, TenantListResponse } from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTenants = useCallback(() => {
    apiFetch<TenantListResponse>("/admin/tenants")
      .then((res) => setTenants(res.items))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Atölye listesi yüklenemedi."));
  }, []);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Atölyeler</h1>
        <Link href="/admin/tenants/new">
          <Button>+ Yeni Atölye</Button>
        </Link>
      </div>

      {error && <ErrorBanner message={error} />}

      {tenants === null && !error && <p className="text-sm text-slate-500">Yükleniyor…</p>}
      {tenants && tenants.length === 0 && <p className="text-sm text-slate-500">Henüz atölye yok.</p>}

      {tenants && tenants.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Ad</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Oluşturulma</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{tenant.name}</td>
                  <td className="px-4 py-3 text-slate-500">{tenant.slug}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(tenant.createdAt).toLocaleDateString("tr-TR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
