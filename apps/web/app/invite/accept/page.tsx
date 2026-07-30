"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { redeemInvitationSchema, type InvitationPreviewResponse } from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

// (protected) DIŞINDA, herkese açık — davet edilen kullanıcı henüz sisteme
// hiç giremiyor (bkz. ADR 0011). Önizleme (GET) ve redemption (POST) aynı
// generic hata şeklini paylaşır — enumeration direnci.
export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 text-sm text-slate-500">
          Yükleniyor…
        </div>
      }
    >
      <AcceptInvitationForm />
    </Suspense>
  );
}

function AcceptInvitationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [preview, setPreview] = useState<InvitationPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreviewError("Davet linki geçersiz.");
      return;
    }
    apiFetch<InvitationPreviewResponse>(`/invitations/${encodeURIComponent(token)}`, { skipAuthRetry: true })
      .then(setPreview)
      .catch((err: unknown) =>
        setPreviewError(err instanceof ApiError ? err.message : "Davet linki doğrulanamadı."),
      );
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const parsed = redeemInvitationSchema.safeParse({ token, newPassword });
    if (!parsed.success) {
      setSubmitError("Şifre en az 8 karakter olmalıdır.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/invitations/redeem", {
        method: "POST",
        body: parsed.data,
        skipAuthRetry: true,
      });
      setSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Şifre belirlenemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-sm">
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Hesabınız hazır</h1>
          <p className="mb-6 text-sm text-slate-600">Şifreniz belirlendi — şimdi giriş yapabilirsiniz.</p>
          <Button onClick={() => router.push("/login")}>Giriş Yap</Button>
        </Card>
      </div>
    );
  }

  if (previewError) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-sm">
          <ErrorBanner message={previewError} />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Şifrenizi Belirleyin</h1>
        {preview && (
          <p className="mb-6 text-sm text-slate-500">
            {preview.email} — {preview.role}
          </p>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormField
            label="Yeni Şifre"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            required
          />
          {submitError && <ErrorBanner message={submitError} />}
          <Button type="submit" disabled={submitting || !preview}>
            {submitting ? "Kaydediliyor…" : "Şifreyi Belirle ve Hesabı Etkinleştir"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
