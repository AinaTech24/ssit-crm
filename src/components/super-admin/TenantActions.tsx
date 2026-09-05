"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";

export function TenantActions({
  tenantId,
  currentStatus,
}: {
  tenantId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(action: "suspend" | "activate", extra?: Record<string, any>) {
    setBusy(true);
    try {
      const reason = action === "suspend" ? prompt("Reason for suspending?") ?? undefined : undefined;
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason, ...extra }),
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

  // Suspending is the only off-switch now — packages, trials and renewals are
  // gone, so there is no license to extend or subscription to cancel.
  const isActive = currentStatus === "active";

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
          <Play className="size-3.5" /> Activate
        </button>
      )}
    </div>
  );
}
