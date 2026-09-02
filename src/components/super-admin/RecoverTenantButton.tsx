"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Loader2 } from "lucide-react";

/** Restore a soft-deleted tenant (clears deleted_at, reactivates, restores ARN). */
export function RecoverTenantButton({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function recover() {
    if (!confirm(`Recover "${tenantName}"? Its data and access will be restored.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/recover`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(j.error ?? "Recover failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={recover}
      disabled={busy}
      className="rounded-md border px-2.5 py-1 text-xs font-medium flex items-center gap-1.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
      title="Recover this tenant"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Recover
    </button>
  );
}
