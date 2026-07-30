"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  proposeDealerLinkSchema,
  creditTopUpSchema,
  type DealerLinkSummary,
  type DealerLinkListResponse,
  type CreditTopUpResponse,
} from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { useAuth } from "@/lib/authContext";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

const STATUS_TONE = {
  PENDING: "warning",
  ACTIVE: "success",
  REJECTED: "danger",
} as const;

export default function DealerLinksPage() {
  const { auth } = useAuth();
  const [links, setLinks] = useState<DealerLinkSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLinks = useCallback(() => {
    apiFetch<DealerLinkListResponse>("/dealer/links")
      .then((res) => setLinks(res.items))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Bağlantılar yüklenemedi."));
  }, []);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const asHub = links?.filter((link) => link.hubTenantId === auth?.tenantId) ?? [];
  const asDealer = links?.filter((link) => link.dealerTenantId === auth?.tenantId) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Bayi Bağlantıları</h1>

      {error && <ErrorBanner message={error} />}

      <ProposeLinkForm onProposed={loadLinks} />

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Merkez Olarak Önerdiklerim</h2>
        {links === null && <p className="text-sm text-slate-500">Yükleniyor…</p>}
        {links !== null && asHub.length === 0 && (
          <p className="text-sm text-slate-500">Henüz bir bayi bağlantısı önermediniz.</p>
        )}
        <ul className="flex flex-col gap-3">
          {asHub.map((link) => (
            <HubLinkRow key={link.id} link={link} onChanged={loadLinks} />
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Bayi Olarak Gelen Bağlantılar</h2>
        {links === null && <p className="text-sm text-slate-500">Yükleniyor…</p>}
        {links !== null && asDealer.length === 0 && (
          <p className="text-sm text-slate-500">Gelen bağlantı isteği yok.</p>
        )}
        <ul className="flex flex-col gap-3">
          {asDealer.map((link) => (
            <DealerLinkRow key={link.id} link={link} onChanged={loadLinks} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ProposeLinkForm({ onProposed }: { onProposed: () => void }) {
  const [dealerTenantSlug, setDealerTenantSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = proposeDealerLinkSchema.safeParse({ dealerTenantSlug });
    if (!parsed.success) {
      setError("Lütfen bayi tenant slug'ını girin.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/dealer/links", { method: "POST", body: parsed.data });
      setDealerTenantSlug("");
      onProposed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Bağlantı önerisi gönderilemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Yeni Bayi Bağlantısı Öner</h2>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <FormField
          label="Bayi Tenant Slug"
          value={dealerTenantSlug}
          onChange={setDealerTenantSlug}
          placeholder="acme-dealer"
          required
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? "Gönderiliyor…" : "Bağlantı Öner"}
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
    </Card>
  );
}

function HubLinkRow({ link, onChanged }: { link: DealerLinkSummary; onChanged: () => void }) {
  const [amountKurus, setAmountKurus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleTopUp(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const kurus = Math.round(Number(amountKurus) * 100);
    const parsed = creditTopUpSchema.safeParse({ amountKurus: kurus });
    if (!parsed.success) {
      setError("Lütfen geçerli, pozitif bir tutar girin.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch<CreditTopUpResponse>(`/dealer/accounts/${link.id}/credit-topup`, {
        method: "POST",
        body: parsed.data,
      });
      setAmountKurus("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kredi yüklenemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-800">Bayi tenant: {link.dealerTenantId}</span>
        <Badge tone={STATUS_TONE[link.status]}>{link.status}</Badge>
      </div>
      {link.status === "ACTIVE" && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <span className="text-sm text-slate-600">
            Bakiye:{" "}
            <strong>
              {(link.creditBalanceKurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" })}
            </strong>
          </span>
          <form onSubmit={handleTopUp} className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Yüklenecek Tutar (TL)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amountKurus}
                onChange={(event) => setAmountKurus(event.target.value)}
                className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={submitting}>
              {submitting ? "Yükleniyor…" : "Kredi Yükle"}
            </Button>
          </form>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
    </li>
  );
}

function DealerLinkRow({ link, onChanged }: { link: DealerLinkSummary; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(approve: boolean) {
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/dealer/links/${link.id}/respond`, { method: "POST", body: { approve } });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İşlem başarısız.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-800">Merkez tenant: {link.hubTenantId}</span>
        <Badge tone={STATUS_TONE[link.status]}>{link.status}</Badge>
      </div>
      {link.status === "PENDING" && (
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
          <Button disabled={busy} onClick={() => void respond(true)}>
            Onayla
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void respond(false)}>
            Reddet
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
    </li>
  );
}
