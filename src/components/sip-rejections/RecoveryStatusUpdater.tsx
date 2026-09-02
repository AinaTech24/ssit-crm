"use client";

/**
 * Inline status updater for a SIP rejection row.
 *
 * Renders a chip-shaped <select>. On change, PATCH /api/sip-rejections/[id]
 * with the new status. On the "Recovered" status, the server auto-stamps
 * recoveryDate = today.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const STATUSES = [
  ["pending", "Pending"],
  ["client_contacted", "Client Contacted"],
  ["bank_issue", "Bank Issue"],
  ["mandate_issue", "Mandate Issue"],
  ["reprocessed", "Reprocessed"],
  ["recovered", "Recovered"],
  ["not_recoverable", "Not Recoverable"],
] as const;

const TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  client_contacted: "bg-blue-50 text-blue-700 border-blue-200",
  bank_issue: "bg-brand-cyan-light/50 text-brand-cyan-deep border-brand-cyan/30",
  mandate_issue: "bg-brand-cyan-light/50 text-brand-cyan-deep border-brand-cyan/30",
  reprocessed: "bg-cyan-50 text-cyan-700 border-cyan-200",
  recovered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  not_recoverable: "bg-rose-50 text-rose-700 border-rose-200",
};

export function RecoveryStatusUpdater({
  rejectionId,
  currentStatus,
}: {
  rejectionId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [val, setVal] = useState(currentStatus);

  async function update(next: string) {
    setBusy(true);
    setVal(next);
    try {
      const res = await fetch(`/api/sip-rejections/${rejectionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recoveryStatus: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Update failed");
        setVal(currentStatus);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[val] ?? ""}`}>
      {busy && <Loader2 className="size-3 animate-spin" />}
      <select
        value={val}
        disabled={busy}
        onChange={(e) => update(e.target.value)}
        className="bg-transparent border-0 outline-none cursor-pointer pr-1 text-xs font-medium appearance-none"
      >
        {STATUSES.map(([k, l]) => (
          <option key={k} value={k} className="bg-white text-foreground">
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
