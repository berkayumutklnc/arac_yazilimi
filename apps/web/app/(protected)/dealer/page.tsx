"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  createFileRequestSchema,
  type FileRequestListItem,
  type FileRequestListResponse,
  type DealerAccountBalance,
  type CreateFileRequestResponse,
  type UploadRequestResponse,
} from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { useAuth } from "@/lib/authContext";
import { sha256Hex } from "@/lib/sha256";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  PENDING: "neutral",
  ACCEPTED: "info",
  IN_PROGRESS: "warning",
  FULFILLED: "success",
  REJECTED: "danger",
};

export default function DealerPortalPage() {
  const { auth } = useAuth();
  const isDealer = auth?.role === "DEALER";

  const [requests, setRequests] = useState<FileRequestListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(() => {
    apiFetch<FileRequestListResponse>("/dealer/file-requests")
      .then((res) => setRequests(res.items))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Talepler yüklenemedi."));
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">
        {isDealer ? "Bayi Portalı" : "Gelen Bayi Talepleri"}
      </h1>

      {error && <ErrorBanner message={error} />}

      {isDealer ? (
        <DealerView requests={requests} onChanged={loadRequests} />
      ) : (
        <HubView requests={requests} onChanged={loadRequests} />
      )}
    </div>
  );
}

function DealerView({
  requests,
  onChanged,
}: {
  requests: FileRequestListItem[] | null;
  onChanged: () => void;
}) {
  const [hubTenantId, setHubTenantId] = useState("");
  const [balance, setBalance] = useState<DealerAccountBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [vehicleId, setVehicleId] = useState("");
  const [readFileId, setReadFileId] = useState("");
  const [requestedStage, setRequestedStage] = useState<"STAGE1" | "STAGE2" | "CUSTOM">("STAGE1");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function checkBalance() {
    setBalanceError(null);
    setBalance(null);
    if (!hubTenantId) {
      setBalanceError("Önce merkez (hub) tenant ID girin.");
      return;
    }
    try {
      const result = await apiFetch<DealerAccountBalance>("/dealer/account", {
        query: { hubTenantId },
      });
      setBalance(result);
    } catch (err) {
      setBalanceError(err instanceof ApiError ? err.message : "Bakiye alınamadı.");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = createFileRequestSchema.safeParse({ hubTenantId, vehicleId, readFileId, requestedStage });
    if (!parsed.success) {
      setFormError("Lütfen tüm alanları doğru şekilde doldurun.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch<CreateFileRequestResponse>("/dealer/file-requests", {
        method: "POST",
        body: parsed.data,
      });
      setVehicleId("");
      setReadFileId("");
      onChanged();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Talep oluşturulamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Kredi Bakiyesi</h2>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Merkez (hub) Tenant ID" value={hubTenantId} onChange={setHubTenantId} />
          <Button type="button" variant="secondary" onClick={() => void checkBalance()}>
            Bakiyeyi Sorgula
          </Button>
          {balance && (
            <span className="text-lg font-semibold text-slate-900">
              {(balance.creditBalanceKurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}
            </span>
          )}
        </div>
        {balanceError && <div className="mt-3">{<ErrorBanner message={balanceError} />}</div>}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Yeni Dosya Talebi</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormField label="Merkez (hub) Tenant ID" value={hubTenantId} onChange={setHubTenantId} required />
          <FormField label="Araç ID" value={vehicleId} onChange={setVehicleId} required />
          <FormField label="Orijinal Dosya (readFileId)" value={readFileId} onChange={setReadFileId} required />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">İstenen Stage</span>
            <select
              value={requestedStage}
              onChange={(event) => setRequestedStage(event.target.value as typeof requestedStage)}
              className="rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="STAGE1">STAGE1</option>
              <option value="STAGE2">STAGE2</option>
              <option value="CUSTOM">CUSTOM</option>
            </select>
          </label>
          {formError && <ErrorBanner message={formError} />}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? "Gönderiliyor…" : "Talebi Gönder"}
          </Button>
        </form>
      </Card>

      <RequestsTable title="Taleplerim" requests={requests} />
    </div>
  );
}

function HubView({
  requests,
  onChanged,
}: {
  requests: FileRequestListItem[] | null;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [costDraftId, setCostDraftId] = useState<string | null>(null);
  const [costValue, setCostValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fulfillTargetRef = useRef<FileRequestListItem | null>(null);

  async function runAction(id: string, action: () => Promise<unknown>) {
    setError(null);
    setBusyId(id);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  }

  function startFulfill(request: FileRequestListItem) {
    fulfillTargetRef.current = request;
    fileInputRef.current?.click();
  }

  async function handleFulfillFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const request = fulfillTargetRef.current;
    if (!file || !request) return;

    await runAction(request.id, async () => {
      const { uploadUrl, storageKey } = await apiFetch<UploadRequestResponse>(
        `/vehicles/${request.vehicleId}/ecu-files/upload-request`,
        { method: "POST", body: { fileName: file.name } },
      );
      const putResponse = await fetch(uploadUrl, { method: "PUT", body: file });
      if (!putResponse.ok) {
        throw new Error("Dosya depolamaya yüklenemedi.");
      }
      const checksum = await sha256Hex(file);
      await apiFetch(`/dealer/file-requests/${request.id}/fulfill`, {
        method: "POST",
        body: { storageKey, checksum },
      });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void handleFulfillFile(event)} />
      {error && <ErrorBanner message={error} />}

      {requests === null && <p className="text-sm text-slate-500">Yükleniyor…</p>}
      {requests && requests.length === 0 && <p className="text-sm text-slate-500">Gelen talep yok.</p>}

      <div className="flex flex-col gap-3">
        {requests?.map((request) => (
          <Card key={request.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-slate-800">
                  Araç {request.vehicleId} — {request.requestedStage}
                </p>
                <p className="text-sm text-slate-500">
                  {new Date(request.createdAt).toLocaleString("tr-TR")}
                  {request.costKurus !== null &&
                    ` — ${(request.costKurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}`}
                </p>
              </div>
              <Badge tone={STATUS_TONE[request.status] ?? "neutral"}>{request.status}</Badge>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {request.status === "PENDING" && costDraftId !== request.id && (
                <Button
                  variant="secondary"
                  disabled={busyId === request.id}
                  onClick={() => {
                    setCostDraftId(request.id);
                    setCostValue("");
                  }}
                >
                  Kabul Et
                </Button>
              )}
              {request.status === "PENDING" && costDraftId === request.id && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const costKurus = Math.round(Number(costValue) * 100);
                    void runAction(request.id, () =>
                      apiFetch(`/dealer/file-requests/${request.id}/accept`, {
                        method: "PATCH",
                        body: { costKurus },
                      }),
                    ).then(() => setCostDraftId(null));
                  }}
                >
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={costValue}
                    onChange={(event) => setCostValue(event.target.value)}
                    placeholder="Ücret (TL)"
                    aria-label="Ücret (TL)"
                    className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <Button type="submit" disabled={busyId === request.id}>
                    Onayla
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setCostDraftId(null)}>
                    Vazgeç
                  </Button>
                </form>
              )}
              {request.status === "PENDING" && (
                <Button
                  variant="danger"
                  disabled={busyId === request.id}
                  onClick={() =>
                    void runAction(request.id, () =>
                      apiFetch(`/dealer/file-requests/${request.id}/reject`, { method: "PATCH" }),
                    )
                  }
                >
                  Reddet
                </Button>
              )}
              {request.status === "ACCEPTED" && (
                <Button
                  variant="secondary"
                  disabled={busyId === request.id}
                  onClick={() =>
                    void runAction(request.id, () =>
                      apiFetch(`/dealer/file-requests/${request.id}/start`, { method: "PATCH" }),
                    )
                  }
                >
                  Üretime Al
                </Button>
              )}
              {request.status === "IN_PROGRESS" && (
                <Button variant="primary" disabled={busyId === request.id} onClick={() => startFulfill(request)}>
                  {busyId === request.id ? "Gönderiliyor…" : "Kalibre Dosyayı Yükle ve Tamamla"}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RequestsTable({ title, requests }: { title: string; requests: FileRequestListItem[] | null }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {requests === null && <p className="text-sm text-slate-500">Yükleniyor…</p>}
      {requests && requests.length === 0 && <p className="text-sm text-slate-500">Henüz talep yok.</p>}
      {requests && requests.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Araç</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Ücret</th>
                <th className="px-4 py-3">Oluşturulma</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.map((request) => (
                <tr key={request.id}>
                  <td className="px-4 py-3">{request.vehicleId}</td>
                  <td className="px-4 py-3">{request.requestedStage}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[request.status] ?? "neutral"}>{request.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {request.costKurus !== null
                      ? (request.costKurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(request.createdAt).toLocaleDateString("tr-TR")}
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
