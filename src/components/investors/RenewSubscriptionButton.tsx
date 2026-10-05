"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

/** Take a renewal: pushes the renewal date one subscription period on. */
export function RenewSubscriptionButton({ investorId }: { investorId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function renew() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/subscription`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "renew" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={renew} disabled={busy} className="btn-secondary text-xs">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Mark renewed
      </button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </span>
  );
}
