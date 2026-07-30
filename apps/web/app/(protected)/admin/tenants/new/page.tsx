"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createTenantSchema, type CreateTenantResponse } from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export default function NewTenantPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdTenantName, setCreatedTenantName] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createTenantSchema.safeParse({ name, slug, ownerEmail });
    if (!parsed.success) {
      setError("Lütfen tüm alanları doğru şekilde doldurun.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<CreateTenantResponse>("/admin/tenants", {
        method: "POST",
        body: parsed.data,
      });
      // Ham davet token'ı burada YOK — yalnızca e-posta ile (ConsoleEmailSender
      // yerelde terminale) taşınır, bkz. ADR 0011.
      setCreatedTenantName(result.tenant.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Atölye oluşturulamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  if (createdTenantName) {
    return (
      <Card className="max-w-md">
        <h1 className="mb-2 text-xl font-semibold text-slate-900">Atölye oluşturuldu</h1>
        <p className="mb-6 text-sm text-slate-600">
          <strong>{createdTenantName}</strong> için davet gönderildi. İlk OWNER, e-postasındaki linkle şifresini
          belirleyip giriş yapabilir.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => router.push("/admin/tenants")}>Atölye Listesine Dön</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setCreatedTenantName(null);
              setName("");
              setSlug("");
              setOwnerEmail("");
            }}
          >
            Yeni Atölye Ekle
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="max-w-md">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Yeni Atölye</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField label="Atölye Adı" value={name} onChange={setName} required />
        <FormField label="Slug" value={slug} onChange={setSlug} placeholder="acme" required />
        <FormField label="İlk OWNER E-postası" type="email" value={ownerEmail} onChange={setOwnerEmail} required />
        {error && <ErrorBanner message={error} />}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Oluşturuluyor…" : "Atölyeyi Oluştur ve Davet Gönder"}
        </Button>
      </form>
    </Card>
  );
}
