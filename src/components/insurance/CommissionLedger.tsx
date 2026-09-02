"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { formatINR, formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { COMMISSION_TYPE_LABELS } from "./AddCommissionEntry";

export type CommissionRow = {
  id: string;
  entry_date: string;
  insurer: string | null;
  commission_type: string;
  investor_name?: string | null;
  policy_number?: string | null;
  gross_amount: string | number;
  tds_amount: string | number;
  net_amount: string | number;
  period_label?: string | null;
  reference_no?: string | null;
  recorded_by_name?: string | null;
};

const TYPE_TONE: Record<string, string> = {
  first_year: "bg-emerald-50 text-emerald-700",
  trail_renewal: "bg-blue-50 text-blue-700",
  override: "bg-violet-50 text-violet-700",
  bonus: "bg-amber-50 text-amber-700",
  reward: "bg-pink-50 text-pink-700",
  other: "bg-slate-100 text-slate-600",
};

export function CommissionLedger({ entries, canDelete }: { entries: CommissionRow[]; canDelete: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function del(id: string) {
    if (!confirm("Delete this commission entry?")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/insurance/commission-entries/${id}`, { method: "DELETE" });
      if (!res.ok) { toast.error("Could not delete"); return; }
      toast.success("Entry deleted");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (entries.length === 0) {
    return <div className="p-12 text-center text-sm text-muted-foreground">No commission recorded yet. Click <strong>Add commission</strong> to log a receipt.</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
        <tr>
          <th className="text-left px-4 py-2 font-medium">Date</th>
          <th className="text-left py-2 font-medium">Insurer</th>
          <th className="text-left py-2 font-medium">Type</th>
          <th className="text-left py-2 font-medium">Client / Policy</th>
          <th className="text-right py-2 font-medium">Gross</th>
          <th className="text-right py-2 font-medium">TDS</th>
          <th className="text-right py-2 font-medium">Net</th>
          <th className="text-left py-2 font-medium">Ref / Period</th>
          {canDelete && <th className="py-2 pr-4"></th>}
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-b last:border-0 hover:bg-secondary/40">
            <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-xs">{formatDate(e.entry_date)}</td>
            <td className="py-2.5">{e.insurer ?? "—"}</td>
            <td className="py-2.5">
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${TYPE_TONE[e.commission_type] ?? ""}`}>
                {COMMISSION_TYPE_LABELS[e.commission_type] ?? e.commission_type}
              </span>
            </td>
            <td className="py-2.5 text-xs">
              {e.investor_name || (e.policy_number ? <span className="font-mono">{e.policy_number}</span> : <span className="text-muted-foreground">—</span>)}
            </td>
            <td className="py-2.5 text-right tabular-nums">{formatINR(Number(e.gross_amount))}</td>
            <td className="py-2.5 text-right tabular-nums text-muted-foreground">{Number(e.tds_amount) > 0 ? formatINR(Number(e.tds_amount)) : "—"}</td>
            <td className="py-2.5 text-right tabular-nums font-semibold text-emerald-700">{formatINR(Number(e.net_amount))}</td>
            <td className="py-2.5 text-xs text-muted-foreground">{[e.reference_no, e.period_label].filter(Boolean).join(" · ") || "—"}</td>
            {canDelete && (
              <td className="py-2.5 pr-4 text-right">
                <button onClick={() => del(e.id)} disabled={busy === e.id} className="text-muted-foreground hover:text-rose-600 disabled:opacity-50" aria-label="Delete">
                  {busy === e.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
