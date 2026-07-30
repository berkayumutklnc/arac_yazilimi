"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { loginSchema } from "@arac-yazilim/shared";
import { useAuth } from "@/lib/authContext";
import { ApiError } from "@/lib/apiClient";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField } from "@/components/ui/FormField";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = loginSchema.safeParse({ tenantSlug, email, password });
    if (!parsed.success) {
      setError("Lütfen tüm alanları doğru şekilde doldurun.");
      return;
    }

    setSubmitting(true);
    try {
      await login(parsed.data.tenantSlug, parsed.data.email, parsed.data.password);
      router.push("/work-orders");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Giriş başarısız, lütfen tekrar deneyin.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Oturum Aç</h1>
        <p className="mb-6 text-sm text-slate-500">Atölye Yazılım Platformu</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormField label="Atölye (tenant)" value={tenantSlug} onChange={setTenantSlug} placeholder="acme" required />
          <FormField label="E-posta" type="email" value={email} onChange={setEmail} required />
          <FormField label="Şifre" type="password" value={password} onChange={setPassword} required />
          {error && <ErrorBanner message={error} />}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Giriş yapılıyor…" : "Giriş Yap"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
