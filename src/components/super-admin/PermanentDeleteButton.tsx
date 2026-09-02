"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * Permanent-delete action for an already-soft-deleted tenant. Trash icon →
 * confirmation dialog → POST /purge (runs the platform_purge_tenant function).
 */
export function PermanentDeleteButton({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function purge() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/purge`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        setBusy(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "error");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setErr(null); setOpen(true); }}
        title="Permanently delete"
        aria-label="Permanently delete tenant"
        className="size-8 grid place-items-center rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
      >
        <Trash2 className="size-4" />
      </button>

      <ConfirmDialog
        open={open}
        title={`Permanently delete "${tenantName}"?`}
        message="This irreversibly erases the tenant and ALL of its data — users, clients, folios, transactions, documents, workflows and everything else. This cannot be undone."
        confirmLabel={busy ? "Deleting…" : "Delete permanently"}
        cancelLabel="Cancel"
        tone="danger"
        busy={busy}
        onConfirm={purge}
        onCancel={() => setOpen(false)}
      />
      {err && <span className="block text-[11px] text-rose-600 mt-1">{err}</span>}
    </>
  );
}
