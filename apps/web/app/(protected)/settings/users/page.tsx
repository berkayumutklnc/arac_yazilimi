"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  inviteUserSchema,
  INVITABLE_ROLES,
  type InvitableRole,
  type TenantUserSummary,
  type TenantUserListResponse,
  type InvitationSummary,
  type InvitationListResponse,
  type CreateInvitationResponse,
} from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

const ROLE_OPTIONS = INVITABLE_ROLES.map((role) => ({ value: role, label: role }));

export default function TenantUsersPage() {
  const [users, setUsers] = useState<TenantUserSummary[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(() => {
    apiFetch<TenantUserListResponse>("/tenant/users")
      .then((res) => setUsers(res.items))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Kullanıcı listesi yüklenemedi."));
    apiFetch<InvitationListResponse>("/tenant/invitations")
      .then((res) => setInvitations(res.items))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Davet listesi yüklenemedi."));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Kullanıcılar</h1>

      {error && <ErrorBanner message={error} />}

      <InviteForm onInvited={loadAll} />
      <PendingInvitations invitations={invitations} />
      <UsersTable users={users} onChanged={loadAll} />
    </div>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("ENGINEER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = inviteUserSchema.safeParse({ email, role });
    if (!parsed.success) {
      setError("Lütfen tüm alanları doğru şekilde doldurun.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch<CreateInvitationResponse>("/tenant/users/invite", {
        method: "POST",
        body: parsed.data,
      });
      setEmail("");
      onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Davet gönderilemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Kullanıcı Davet Et</h2>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <FormField label="E-posta" type="email" value={email} onChange={setEmail} required />
        <FormField
          label="Rol"
          value={role}
          onChange={(value) => setRole(value as InvitableRole)}
          options={ROLE_OPTIONS}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? "Gönderiliyor…" : "Davet Gönder"}
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

function PendingInvitations({ invitations }: { invitations: InvitationSummary[] | null }) {
  const pending = invitations?.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt) ?? [];

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Bekleyen Davetler</h2>
      {invitations === null && <p className="text-sm text-slate-500">Yükleniyor…</p>}
      {invitations !== null && pending.length === 0 && (
        <p className="text-sm text-slate-500">Bekleyen davet yok.</p>
      )}
      {pending.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {pending.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-800">{invitation.email}</span>
              <div className="flex items-center gap-2">
                <Badge tone="info">{invitation.role}</Badge>
                <span className="text-xs text-slate-500">
                  Son geçerlilik: {new Date(invitation.expiresAt).toLocaleDateString("tr-TR")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function UsersTable({ users, onChanged }: { users: TenantUserSummary[] | null; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function runAction(id: string, action: () => Promise<unknown>) {
    setRowError(null);
    setBusyId(id);
    try {
      await action();
      onChanged();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  }

  function handleRoleChange(user: TenantUserSummary, newRole: string) {
    if (newRole === user.role) return;
    void runAction(user.id, () =>
      apiFetch(`/tenant/users/${user.id}/role`, { method: "PATCH", body: { role: newRole } }),
    );
  }

  function handleDeactivate(user: TenantUserSummary) {
    if (!window.confirm(`${user.email} kullanıcısını deaktive etmek istediğinize emin misiniz?`)) {
      return;
    }
    void runAction(user.id, () => apiFetch(`/tenant/users/${user.id}/deactivate`, { method: "POST" }));
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Kullanıcılar</h2>
      {rowError && (
        <div className="mb-3">
          <ErrorBanner message={rowError} />
        </div>
      )}
      {users === null && <p className="text-sm text-slate-500">Yükleniyor…</p>}
      {users && users.length === 0 && <p className="text-sm text-slate-500">Henüz kullanıcı yok.</p>}
      {users && users.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">E-posta</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{user.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      disabled={busyId === user.id || Boolean(user.deactivatedAt)}
                      onChange={(event) => handleRoleChange(user, event.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {INVITABLE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={user.deactivatedAt ? "danger" : "success"}>
                      {user.deactivatedAt ? "Pasif" : "Aktif"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!user.deactivatedAt && (
                      <Button
                        variant="danger"
                        disabled={busyId === user.id}
                        onClick={() => handleDeactivate(user)}
                      >
                        Deaktive Et
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
