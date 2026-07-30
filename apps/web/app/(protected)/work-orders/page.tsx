"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { WorkOrderListResponse, WorkOrderSummary } from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  DRAFT: "neutral",
  ACCEPTED: "info",
  IN_PROGRESS: "info",
  AWAITING_PARTS: "warning",
  QUALITY_CHECK: "warning",
  DELIVERED: "success",
  CLOSED: "success",
  CANCELLED: "danger",
};

export default function WorkOrdersPage() {
  const [items, setItems] = useState<WorkOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<WorkOrderListResponse>("/work-orders")
      .then((res) => setItems(res.items))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "İş emirleri yüklenemedi."));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">İş Emirleri</h1>
        <Link href="/work-orders/new">
          <Button>Yeni İş Emri</Button>
        </Link>
      </div>

      {error && <ErrorBanner message={error} />}
      {items === null && !error && <p className="text-sm text-slate-500">Yükleniyor…</p>}
      {items && items.length === 0 && <p className="text-sm text-slate-500">Henüz iş emri yok.</p>}

      {items && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Araç</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">AİTM</th>
                <th className="px-4 py-3">Oluşturulma</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((workOrder) => (
                <tr key={workOrder.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/work-orders/${workOrder.id}`}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {workOrder.vehicleId}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[workOrder.status] ?? "neutral"}>{workOrder.status}</Badge>
                  </td>
                  <td className="px-4 py-3">{workOrder.requiresAitmRegistration ? "Gerekli" : "—"}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(workOrder.createdAt).toLocaleDateString("tr-TR")}
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
