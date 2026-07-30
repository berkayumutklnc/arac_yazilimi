"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useParams } from "next/navigation";
import {
  uploadRequestSchema,
  type EcuFileListItem,
  type EcuFileListResponse,
  type UploadRequestResponse,
  type DownloadResponse,
} from "@arac-yazilim/shared";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { useAuth } from "@/lib/authContext";
import { sha256Hex } from "@/lib/sha256";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

const DOWNLOAD_ALLOWED_ROLES = new Set(["OWNER", "ENGINEER"]);

interface TreeNode extends EcuFileListItem {
  children: TreeNode[];
}

function buildTree(items: EcuFileListItem[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const item of items) {
    byId.set(item.id, { ...item, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const item of items) {
    const node = byId.get(item.id);
    if (!node) continue;
    if (item.id === item.stockRomRef) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(item.stockRomRef);
    // Orijinal (stock) dosya bu listede görünmüyorsa (ör. beklenmedik bir
    // durum) çocuğu kaybetmeden yine de kök seviyede göster.
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export default function VehicleEcuFilesPage() {
  const params = useParams<{ id: string }>();
  const { auth } = useAuth();
  const canDownload = auth ? DOWNLOAD_ALLOWED_ROLES.has(auth.role) : false;

  const [items, setItems] = useState<EcuFileListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    apiFetch<EcuFileListResponse>(`/vehicles/${params.id}/ecu-files`)
      .then((res) => setItems(res.items))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "ECU dosyaları yüklenemedi."),
      );
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    try {
      const parsed = uploadRequestSchema.safeParse({ fileName: file.name });
      if (!parsed.success) {
        throw new Error("Geçersiz dosya adı.");
      }

      const { uploadUrl, storageKey } = await apiFetch<UploadRequestResponse>(
        `/vehicles/${params.id}/ecu-files/upload-request`,
        { method: "POST", body: parsed.data },
      );

      const putResponse = await fetch(uploadUrl, { method: "PUT", body: file });
      if (!putResponse.ok) {
        throw new Error("Dosya depolamaya yüklenemedi.");
      }

      const checksum = await sha256Hex(file);

      // Faz 1 MVP: bu formdan yüklenen her dosya ORIGINAL_STOCK'tur — stage
      // dosyaları dealer fulfill akışıyla oluşuyor (bkz. /dealer sayfası).
      // Ayrı bir "stage yükle" formu kapsam dışı, gelecek bir görev.
      await apiFetch(`/vehicles/${params.id}/ecu-files/upload-confirm`, {
        method: "POST",
        body: { storageKey, fileType: "ORIGINAL_STOCK", claimedChecksum: checksum },
      });

      load();
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Yükleme başarısız.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(ecuFileId: string) {
    setError(null);
    setDownloadingId(ecuFileId);
    try {
      const { downloadUrl } = await apiFetch<DownloadResponse>(`/ecu-files/${ecuFileId}/download`);
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İndirme bağlantısı alınamadı.");
    } finally {
      setDownloadingId(null);
    }
  }

  const tree = items ? buildTree(items) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">ECU Dosya Arşivi</h1>
        <div>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "Yükleniyor…" : "Dosya Yükle"}
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {uploadError && <ErrorBanner message={uploadError} />}

      {items === null && !error && <p className="text-sm text-slate-500">Yükleniyor…</p>}
      {items && items.length === 0 && (
        <p className="text-sm text-slate-500">Bu araç için henüz ECU dosyası yok.</p>
      )}

      <div className="flex flex-col gap-3">
        {tree.map((root) => (
          <EcuFileTreeNode
            key={root.id}
            node={root}
            canDownload={canDownload}
            downloadingId={downloadingId}
            onDownload={handleDownload}
          />
        ))}
      </div>
    </div>
  );
}

function EcuFileTreeNode({
  node,
  canDownload,
  downloadingId,
  onDownload,
}: {
  node: TreeNode;
  canDownload: boolean;
  downloadingId: string | null;
  onDownload: (id: string) => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <Badge tone={node.fileType === "ORIGINAL_STOCK" ? "neutral" : "info"}>{node.fileType}</Badge>
          <p className="mt-1 text-sm text-slate-500">
            {new Date(node.createdAt).toLocaleString("tr-TR")} — {node.uploadedBy}
          </p>
          <p className="text-xs text-slate-400">SHA-256: {node.checksum}</p>
        </div>
        {canDownload && (
          <Button
            variant="secondary"
            disabled={downloadingId === node.id}
            onClick={() => onDownload(node.id)}
          >
            {downloadingId === node.id ? "…" : "İndir"}
          </Button>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="mt-3 flex flex-col gap-3 border-l-2 border-slate-200 pl-4">
          {node.children.map((child) => (
            <EcuFileTreeNode
              key={child.id}
              node={child}
              canDownload={canDownload}
              downloadingId={downloadingId}
              onDownload={onDownload}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
