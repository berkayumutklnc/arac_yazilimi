"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createWorkOrderSchema, type CreateWorkOrderResponse } from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

export default function NewWorkOrderPage() {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createWorkOrderSchema.safeParse({ vehicleId });
    if (!parsed.success) {
      setError("Araç ID'si gerekli.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<CreateWorkOrderResponse>("/work-orders", {
        method: "POST",
        body: parsed.data,
      });
      router.push(`/work-orders/${result.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İş emri oluşturulamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Yeni İş Emri</h1>
      <Card className="max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormField
            label="Araç ID"
            value={vehicleId}
            onChange={setVehicleId}
            required
            placeholder="vehicle-uuid"
          />
          {error && <ErrorBanner message={error} />}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Oluşturuluyor…" : "Oluştur"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
