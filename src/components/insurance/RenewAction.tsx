"use client";

/**
 * RenewAction — "mark renewed" for an insurance policy. Advances the next
 * premium due date by the policy's frequency and stamps last-premium = today
 * via the existing insurance PATCH. The insurance agent's one-click renewal.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";

export function RenewAction({ policyId, frequency }: { policyId: string; frequency: string; nextDue?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function renew() {
    if (frequency === "single") return;
    setBusy(true);
    try {
      // The server computes the next due date authoritatively from the policy's
      // frequency, stamps the payment, and clears the lapse marker.
      const res = await fetch(`/api/insurance/${policyId}/renew`, { method: "POST" });
      if (res.ok) { setDone(true); router.refresh(); }
    } finally { setBusy(false); }
  }

  if (frequency === "single") return <span className="text-[10px] text-muted-foreground">single-pay</span>;
  return (
    <button onClick={renew} disabled={busy || done} className="btn-secondary text-xs inline-flex items-center gap-1" title="Mark this premium as paid + advance the due date">
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} {done ? "Renewed ✓" : "Mark renewed"}
    </button>
  );
}
