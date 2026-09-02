"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Ban, Clock } from "lucide-react";

export function TenantActions({
  tenantId,
  currentStatus,
}: {
  tenantId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(action: "suspend" | "activate" | "extend" | "cancel", extra?: Record<string, any>) {
    setBusy(true);
    try {
      const reason =
        action === "suspend" || action === "cancel"
          ? prompt(`Reason for ${action}?`) ?? undefined
          : undefined;
      let extendDays: number | undefined;
      if (action === "extend") {
        const v = prompt("Extend license by how many days?", "30");
        if (!v) return;
        extendDays = Number(v);
      }
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason, extendDays, ...extra }),
      });
      const j = await res.json();
      if (!res.ok) {
        alert(j.error ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const isActive = currentStatus === "active" || currentStatus === "trial";
  const isCancelled = currentStatus === "cancelled";

  return (
    <div className="flex gap-2">
      {isActive && (
        <button
          onClick={() => call("suspend")}
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 text-amber-700 hover:bg-amber-50"
        >
          <Pause className="size-3.5" /> Suspend
        </button>
      )}
      {!isActive && (
        <button
          onClick={() => call("activate")}
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 text-emerald-700 hover:bg-emerald-50"
        >
          <Play className="size-3.5" /> {isCancelled ? "Reactivate" : "Activate"}
        </button>
      )}
      <button
        onClick={() => call("extend")}
        disabled={busy}
        className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5"
      >
        <Clock className="size-3.5" /> Extend license
      </button>
      {!isCancelled && (
        <button
          onClick={() => call("cancel")}
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 text-rose-700 hover:bg-rose-50"
        >
          <Ban className="size-3.5" /> Cancel
        </button>
      )}
    </div>
  );
}
