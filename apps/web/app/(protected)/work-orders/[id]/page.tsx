"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getAllowedNextStatuses,
  requiresReason,
  invoiceStatusMachine,
  dtcParseResponseSchema,
  wotAnalysisResponseSchema,
  DIAGNOSTIC_REPORT_TYPES,
  WORK_ORDER_ITEM_TYPES,
  VAT_RATES,
  VAT_RATE_PERCENTAGES,
  addWorkOrderItemSchema,
  voidInvoiceSchema,
  type WorkOrderDetail,
  type WorkOrderStatus,
  type DiagnosticReportType,
  type WorkOrderDiagnosticReportSummary,
  type DiagnosticReportListResponse,
  type WorkOrderItemSummary,
  type WorkOrderItemListResponse,
  type WorkOrderItemType,
  type VatRate,
  type InvoiceDetail,
  type InvoiceStatus,
} from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { useAuth } from "@/lib/authContext";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  DRAFT: "Taslak",
  ACCEPTED: "Kabul Edildi",
  IN_PROGRESS: "Üretimde",
  AWAITING_PARTS: "Parça Bekleniyor",
  QUALITY_CHECK: "Kalite Kontrol",
  DELIVERED: "Teslim Edildi",
  CLOSED: "Kapandı",
  CANCELLED: "İptal Edildi",
};

const REPORT_TYPE_LABELS: Record<DiagnosticReportType, string> = {
  DTC: "DTC Log",
  WOT: "WOT/Dyno Log",
};

// bkz. ADR 0014 — DELIVERED anında kalemler donar (fatura o anki hâlin bir
// anlık görüntüsüdür), CLOSED/CANCELLED de aynı gerekçeyle kilitli.
const ITEMS_LOCKED_STATUSES: readonly WorkOrderStatus[] = ["DELIVERED", "CLOSED", "CANCELLED"];
// Fatura yalnızca DELIVERED geçişinde otomatik oluşur — CANCELLED asla DELIVERED'a ulaşmaz.
const HAS_INVOICE_STATUSES: readonly WorkOrderStatus[] = ["DELIVERED", "CLOSED"];

const ITEM_TYPE_LABELS: Record<WorkOrderItemType, string> = {
  SERVICE: "Hizmet",
  PART: "Parça",
};

const VAT_RATE_LABELS: Record<VatRate, string> = Object.fromEntries(
  VAT_RATES.map((rate) => [rate, `%${VAT_RATE_PERCENTAGES[rate]}`]),
) as Record<VatRate, string>;

const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Taslak",
  ISSUED: "Kesildi",
  PAID: "Ödendi",
  VOID: "İptal Edildi",
};

const INVOICE_STATUS_TONE: Record<InvoiceStatus, "neutral" | "info" | "success" | "danger"> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PAID: "success",
  VOID: "danger",
};

function formatKurus(kurus: number): string {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

// Sunucu, zod ile doğruladıktan sonra `result`'ı olduğu gibi yazıyor — burada
// da aynı sözleşme şemalarıyla (packages/shared) güvenle ayrıştırıyoruz,
// böylece görüntüleme katmanı da diag-service sözleşmesinden kopmuyor.
function summarizeDiagnosticReport(report: WorkOrderDiagnosticReportSummary): string {
  if (report.reportType === "DTC") {
    const parsed = dtcParseResponseSchema.safeParse(report.result);
    if (!parsed.success) {
      return "Beklenmeyen veri biçimi.";
    }
    return `${parsed.data.matches.length} bilinen, ${parsed.data.unknown_codes.length} bilinmeyen kod.`;
  }
  const parsed = wotAnalysisResponseSchema.safeParse(report.result);
  if (!parsed.success) {
    return "Beklenmeyen veri biçimi.";
  }
  const bySeverity = new Map<string, number>();
  for (const finding of parsed.data.findings) {
    bySeverity.set(finding.severity, (bySeverity.get(finding.severity) ?? 0) + 1);
  }
  const severityText =
    [...bySeverity.entries()].map(([severity, count]) => `${severity}: ${count}`).join(", ") || "bulgu yok";
  return `${parsed.data.row_count} satır, ${parsed.data.findings.length} bulgu (${severityText}).`;
}

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [workOrder, setWorkOrder] = useState<WorkOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<WorkOrderStatus | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [reports, setReports] = useState<WorkOrderDiagnosticReportSummary[] | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [selectedReportType, setSelectedReportType] = useState<DiagnosticReportType>("DTC");
  const [uploadingReport, setUploadingReport] = useState(false);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const reportFileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    apiFetch<WorkOrderDetail>(`/work-orders/${params.id}`)
      .then(setWorkOrder)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "İş emri yüklenemedi."));
  }, [params.id]);

  const loadReports = useCallback(() => {
    apiFetch<DiagnosticReportListResponse>(`/work-orders/${params.id}/diagnostic-reports`)
      .then((res) => setReports(res.items))
      .catch((err: unknown) =>
        setReportsError(err instanceof ApiError ? err.message : "Diagnostik raporları yüklenemedi."),
      );
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function handleReportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setUploadingReport(true);
    setReportsError(null);
    try {
      // reportType alanı dosyadan ÖNCE eklenir — @fastify/multipart yalnızca
      // dosya parçasından önce parse edilen alanları request.file()'da sunar.
      const formData = new FormData();
      formData.append("reportType", selectedReportType);
      formData.append("file", file);
      const created = await apiFetch<WorkOrderDiagnosticReportSummary>(
        `/work-orders/${params.id}/diagnostic-reports`,
        { method: "POST", body: formData },
      );
      setReports((prev) => [created, ...(prev ?? [])]);
    } catch (err) {
      // Backend'in Türkçe hata mesajı (503 diag-service erişilemez, 400/502) olduğu gibi gösterilir.
      setReportsError(err instanceof ApiError ? err.message : "Rapor yüklenemedi.");
    } finally {
      setUploadingReport(false);
    }
  }

  async function submitTransition(toStatus: WorkOrderStatus, reasonValue?: string) {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/work-orders/${params.id}/status`, {
        method: "PATCH",
        body: reasonValue ? { toStatus, reason: reasonValue } : { toStatus },
      });
      setPendingStatus(null);
      load();
    } catch (err) {
      // Backend'in Türkçe hata mesajı (ör. 409 geçersiz geçiş) olduğu gibi gösterilir.
      setError(err instanceof ApiError ? err.message : "Durum güncellenemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !workOrder) {
    return <ErrorBanner message={error} />;
  }
  if (!workOrder) {
    return <p className="text-sm text-slate-500">Yükleniyor…</p>;
  }

  const nextStatuses = getAllowedNextStatuses(workOrder.status);

  function startTransition(toStatus: WorkOrderStatus) {
    setError(null);
    if (requiresReason(workOrder!.status, toStatus)) {
      setPendingStatus(toStatus);
      setReason("");
      return;
    }
    void submitTransition(toStatus);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">İş Emri</h1>
          <p className="text-sm text-slate-500">Araç: {workOrder.vehicleId}</p>
        </div>
        <Badge tone="info">{STATUS_LABELS[workOrder.status]}</Badge>
      </div>

      {error && <ErrorBanner message={error} />}

      {workOrder.requiresAitmRegistration && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Bu iş emri için AİTM tadilat tescili gerekli.
        </div>
      )}

      {nextStatuses.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Durum Değiştir</h2>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((status) => (
              <Button
                key={status}
                variant={status === "CANCELLED" ? "danger" : "secondary"}
                disabled={submitting}
                onClick={() => startTransition(status)}
              >
                {STATUS_LABELS[status]}
              </Button>
            ))}
          </div>

          {pendingStatus && (
            <form
              className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submitTransition(pendingStatus, reason);
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">
                  {STATUS_LABELS[pendingStatus]} için gerekçe (zorunlu)
                </span>
                <textarea
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={submitting}>
                  Onayla
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPendingStatus(null)}>
                  Vazgeç
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Durum Geçmişi</h2>
        {workOrder.statusHistory.length === 0 ? (
          <p className="text-sm text-slate-500">Henüz bir durum değişikliği yok.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {workOrder.statusHistory.map((entry, index) => (
              <li key={index} className="border-l-2 border-slate-200 pl-3">
                <p className="font-medium text-slate-800">
                  {STATUS_LABELS[entry.fromStatus]} → {STATUS_LABELS[entry.toStatus]}
                </p>
                <p className="text-slate-500">
                  {new Date(entry.changedAt).toLocaleString("tr-TR")} — {entry.changedBy}
                </p>
                {entry.reason && <p className="mt-1 italic text-slate-600">&ldquo;{entry.reason}&rdquo;</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <WorkOrderItemsCard
        workOrderId={params.id}
        locked={ITEMS_LOCKED_STATUSES.includes(workOrder.status)}
      />

      {HAS_INVOICE_STATUSES.includes(workOrder.status) && <InvoiceCard workOrderId={params.id} />}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Diagnostik Raporları</h2>
          <div className="flex items-center gap-2">
            <select
              value={selectedReportType}
              onChange={(event) => setSelectedReportType(event.target.value as DiagnosticReportType)}
              disabled={uploadingReport}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {DIAGNOSTIC_REPORT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {REPORT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <input ref={reportFileInputRef} type="file" className="hidden" onChange={handleReportFileChange} />
            <Button onClick={() => reportFileInputRef.current?.click()} disabled={uploadingReport}>
              {uploadingReport ? "Yükleniyor…" : "Log Yükle"}
            </Button>
          </div>
        </div>

        {reportsError && <ErrorBanner message={reportsError} />}

        {reports === null && !reportsError && <p className="text-sm text-slate-500">Yükleniyor…</p>}
        {reports && reports.length === 0 && (
          <p className="text-sm text-slate-500">Henüz diagnostik raporu yok.</p>
        )}

        {reports && reports.length > 0 && (
          <ul className="flex flex-col gap-3 text-sm">
            {reports.map((report) => (
              <li key={report.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={report.reportType === "DTC" ? "info" : "neutral"}>
                      {REPORT_TYPE_LABELS[report.reportType]}
                    </Badge>
                    <span className="font-medium text-slate-800">{report.fileName}</span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {new Date(report.createdAt).toLocaleString("tr-TR")} — {report.uploadedBy}
                  </span>
                </div>
                <p className="mt-2 text-slate-600">{summarizeDiagnosticReport(report)}</p>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-indigo-600 hover:underline"
                  onClick={() => setExpandedReportId(expandedReportId === report.id ? null : report.id)}
                >
                  {expandedReportId === report.id ? "Ham veriyi gizle" : "Ham veriyi göster"}
                </button>
                {expandedReportId === report.id && (
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
                    {JSON.stringify(report.result, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Link href={`/vehicles/${workOrder.vehicleId}`} className="text-sm font-medium text-indigo-600 hover:underline">
        Araç ECU Dosya Arşivini Görüntüle →
      </Link>
    </div>
  );
}

function WorkOrderItemsCard({ workOrderId, locked }: { workOrderId: string; locked: boolean }) {
  const [items, setItems] = useState<WorkOrderItemSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<WorkOrderItemListResponse>(`/work-orders/${workOrderId}/items`)
      .then((res) => setItems(res.items))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Kalemler yüklenemedi."));
  }, [workOrderId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Kalemler</h2>

      {error && <ErrorBanner message={error} />}
      {items === null && !error && <p className="text-sm text-slate-500">Yükleniyor…</p>}
      {items && items.length === 0 && <p className="text-sm text-slate-500">Henüz kalem eklenmedi.</p>}

      {items && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2">Tür</th>
                <th className="py-2 pr-2">Açıklama</th>
                <th className="py-2 pr-2">Adet</th>
                <th className="py-2 pr-2">Birim Fiyat</th>
                <th className="py-2 pr-2">KDV</th>
                <th className="py-2 pr-2">Toplam</th>
                {!locked && <th className="py-2 pr-2" />}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <WorkOrderItemRow
                  key={item.id}
                  item={item}
                  workOrderId={workOrderId}
                  locked={locked}
                  onRemoved={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!locked && <AddWorkOrderItemForm workOrderId={workOrderId} onAdded={load} />}
    </Card>
  );
}

function WorkOrderItemRow({
  item,
  workOrderId,
  locked,
  onRemoved,
}: {
  item: WorkOrderItemSummary;
  workOrderId: string;
  locked: boolean;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function handleRemove() {
    setBusy(true);
    setRowError(null);
    try {
      await apiFetch(`/work-orders/${workOrderId}/items/${item.id}`, { method: "DELETE" });
      onRemoved();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Kalem silinemedi.");
      setBusy(false);
    }
  }

  return (
    <>
      <tr className="border-b border-slate-100">
        <td className="py-2 pr-2">{ITEM_TYPE_LABELS[item.itemType]}</td>
        <td className="py-2 pr-2">{item.description}</td>
        <td className="py-2 pr-2">{item.quantity}</td>
        <td className="py-2 pr-2">{formatKurus(item.unitPriceKurus)}</td>
        <td className="py-2 pr-2">{VAT_RATE_LABELS[item.vatRate]}</td>
        <td className="py-2 pr-2 font-medium">{formatKurus(item.lineTotalKurus)}</td>
        {!locked && (
          <td className="py-2 pr-2 text-right">
            <Button variant="danger" disabled={busy} onClick={() => void handleRemove()}>
              Kaldır
            </Button>
          </td>
        )}
      </tr>
      {rowError && (
        <tr>
          <td colSpan={locked ? 6 : 7} className="pb-2">
            <ErrorBanner message={rowError} />
          </td>
        </tr>
      )}
    </>
  );
}

function AddWorkOrderItemForm({ workOrderId, onAdded }: { workOrderId: string; onAdded: () => void }) {
  const [itemType, setItemType] = useState<WorkOrderItemType>("SERVICE");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPriceTl, setUnitPriceTl] = useState("");
  const [vatRate, setVatRate] = useState<VatRate>("RATE_20");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = addWorkOrderItemSchema.safeParse({
      itemType,
      description,
      quantity: Number(quantity),
      unitPriceKurus: Math.round(Number(unitPriceTl) * 100),
      vatRate,
    });
    if (!parsed.success) {
      setError("Lütfen tüm alanları geçerli değerlerle doldurun.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/work-orders/${workOrderId}/items`, { method: "POST", body: parsed.data });
      setDescription("");
      setQuantity("1");
      setUnitPriceTl("");
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kalem eklenemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
      <FormField
        label="Tür"
        value={itemType}
        onChange={(value) => setItemType(value as WorkOrderItemType)}
        options={WORK_ORDER_ITEM_TYPES.map((type) => ({ value: type, label: ITEM_TYPE_LABELS[type] }))}
      />
      <FormField label="Açıklama" value={description} onChange={setDescription} required />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Adet</span>
        <input
          type="number"
          min="1"
          step="1"
          required
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Birim Fiyat (TL)</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          required
          value={unitPriceTl}
          onChange={(event) => setUnitPriceTl(event.target.value)}
          className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
      <FormField
        label="KDV"
        value={vatRate}
        onChange={(value) => setVatRate(value as VatRate)}
        options={VAT_RATES.map((rate) => ({ value: rate, label: VAT_RATE_LABELS[rate] }))}
      />
      <Button type="submit" disabled={submitting}>
        {submitting ? "Ekleniyor…" : "Kalem Ekle"}
      </Button>
      {error && (
        <div className="w-full">
          <ErrorBanner message={error} />
        </div>
      )}
    </form>
  );
}

function InvoiceCard({ workOrderId }: { workOrderId: string }) {
  const { auth } = useAuth();
  const canManageBilling = auth?.role === "OWNER" || auth?.role === "RECEPTIONIST";

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  // null = gerekçe formu kapalı; boş string = form açık ama henüz yazılmadı.
  const [voidReason, setVoidReason] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<InvoiceDetail>(`/work-orders/${workOrderId}/invoice`)
      .then(setInvoice)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Fatura yüklenemedi."));
  }, [workOrderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(action: "issue" | "pay" | "void", body?: unknown) {
    if (!invoice) {
      return;
    }
    setActionSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/invoices/${invoice.id}/${action}`, { method: "POST", body });
      setVoidReason(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İşlem başarısız.");
    } finally {
      setActionSubmitting(false);
    }
  }

  function submitVoid(event: FormEvent) {
    event.preventDefault();
    const parsed = voidInvoiceSchema.safeParse({ reason: voidReason });
    if (!parsed.success) {
      setError("Lütfen bir gerekçe girin.");
      return;
    }
    void runAction("void", parsed.data);
  }

  if (error && !invoice) {
    return (
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Fatura</h2>
        <ErrorBanner message={error} />
      </Card>
    );
  }
  if (!invoice) {
    return (
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Fatura</h2>
        <p className="text-sm text-slate-500">Yükleniyor…</p>
      </Card>
    );
  }

  const nextStatuses = invoiceStatusMachine.getAllowedNextStatuses(invoice.status);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Fatura</h2>
        <div className="flex items-center gap-2">
          {invoice.invoiceNumber && <span className="text-sm text-slate-600">{invoice.invoiceNumber}</span>}
          <Badge tone={INVOICE_STATUS_TONE[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {invoice.lines.length === 0 ? (
        <p className="text-sm text-slate-500">Bu faturada kalem yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2">Açıklama</th>
                <th className="py-2 pr-2">Adet</th>
                <th className="py-2 pr-2">Birim Fiyat</th>
                <th className="py-2 pr-2">KDV</th>
                <th className="py-2 pr-2">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-b border-slate-100">
                  <td className="py-2 pr-2">{line.description}</td>
                  <td className="py-2 pr-2">{line.quantity}</td>
                  <td className="py-2 pr-2">{formatKurus(line.unitPriceKurus)}</td>
                  <td className="py-2 pr-2">{VAT_RATE_LABELS[line.vatRate]}</td>
                  <td className="py-2 pr-2 font-medium">{formatKurus(line.lineTotalKurus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-right text-sm font-semibold text-slate-800">
        Toplam: {formatKurus(invoice.totalKurus)}
      </p>

      {canManageBilling && nextStatuses.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          {nextStatuses.includes("ISSUED") && (
            <Button disabled={actionSubmitting} onClick={() => void runAction("issue")}>
              Onayla (Kes)
            </Button>
          )}
          {nextStatuses.includes("PAID") && (
            <Button disabled={actionSubmitting} onClick={() => void runAction("pay")}>
              Ödendi Olarak İşaretle
            </Button>
          )}
          {nextStatuses.includes("VOID") && (
            <Button variant="danger" disabled={actionSubmitting} onClick={() => setVoidReason("")}>
              İptal Et
            </Button>
          )}
        </div>
      )}

      {voidReason !== null && (
        <form onSubmit={submitVoid} className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">İptal gerekçesi (zorunlu)</span>
            <textarea
              required
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              rows={2}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={actionSubmitting}>
              İptali Onayla
            </Button>
            <Button type="button" variant="secondary" onClick={() => setVoidReason(null)}>
              Vazgeç
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
