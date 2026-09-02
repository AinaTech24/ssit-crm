"use client";

/**
 * Reconciliation breaks table — selection + bulk actions + per-row fix.
 *
 *  - "Sync to CRM" posts an opening-balance transaction so the CRM ledger
 *    matches the feed (additive breaks: feed units > CRM units), then resolves.
 *  - Bulk bar: Sync selected / Resolve / Investigating / Ignore.
 *  - Per-row status dropdown (open / investigating / resolved / ignored).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Wand2 } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/utils";

type Row = {
  id: string;
  investor_id: string | null;
  investor_name: string | null;
  scheme_code: string | null;
  scheme_name: string | null;
  folio_number: string | null;
  exception_type: string;
  severity: string;
  status: string;
  crm_units: any;
  feed_units: any;
  delta_units: any;
  delta_value: any;
  detected_at: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  unit_mismatch: "Unit mismatch",
  missing_in_crm: "Missing in CRM",
  missing_in_feed: "Missing in feed",
  value_drift: "Value drift",
};
const SEV_TONE: Record<string, string> = {
  high: "bg-rose-50 text-rose-700 border-rose-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-50 text-slate-600 border-slate-200",
};

const TOLERANCE = 0.5;
const isAdditive = (r: Row) => Number(r.feed_units ?? 0) - Number(r.crm_units ?? 0) > TOLERANCE;

function fmtUnits(n: any): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function ReconTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null); // row id or "bulk"

  const additiveSelected = rows.filter((r) => sel.has(r.id) && isAdditive(r));

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function setStatus(id: string, next: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/reconciliation/exceptions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `Failed (${res.status})`, "Status");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sync(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/reconciliation/exceptions/${id}/sync`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Failed (${res.status})`, "Sync to CRM");
        return;
      }
      toast.success(`Posted +${j.addUnits} units to CRM and resolved the break`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function bulk(action: "status" | "sync", value?: string) {
    setBusy("bulk");
    try {
      const res = await fetch(`/api/reconciliation/exceptions/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...sel], action, value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Failed (${res.status})`, "Bulk action");
        return;
      }
      toast.success(
        action === "sync"
          ? `Synced ${j.updated} break(s)${j.skipped ? `, skipped ${j.skipped} non-additive` : ""}`
          : `Updated ${j.updated} break(s)`
      );
      setSel(new Set());
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan-light/20 px-3 py-2 text-xs">
          <span className="font-medium">{sel.size} selected</span>
          <button
            onClick={() => bulk("sync")}
            disabled={busy !== null || additiveSelected.length === 0}
            className="btn-primary text-xs disabled:opacity-50"
            title={additiveSelected.length === 0 ? "None of the selected breaks are additive (feed > CRM)" : "Post opening-balance txns to match the feed"}
          >
            {busy === "bulk" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            Sync to CRM ({additiveSelected.length})
          </button>
          <button onClick={() => bulk("status", "investigating")} disabled={busy !== null} className="btn-secondary text-xs">Investigating</button>
          <button onClick={() => bulk("status", "resolved")} disabled={busy !== null} className="btn-secondary text-xs">Resolve</button>
          <button onClick={() => bulk("status", "ignored")} disabled={busy !== null} className="btn-secondary text-xs">Ignore</button>
          <button onClick={() => setSel(new Set())} className="text-muted-foreground hover:underline ml-auto">Clear</button>
        </div>
      )}

      <div className="card-surface table-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Scheme / Folio</th>
              <th className="px-3 py-2">Break</th>
              <th className="px-3 py-2 text-right">CRM units</th>
              <th className="px-3 py-2 text-right">Feed units</th>
              <th className="px-3 py-2 text-right">Δ units</th>
              <th className="px-3 py-2 text-right">Δ value</th>
              <th className="px-3 py-2">Detected</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Fix</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-muted-foreground">
                  No reconciliation breaks for this filter. Run reconciliation, or import an RTA/CAS feed first.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={`border-b last:border-0 hover:bg-muted/30 ${sel.has(r.id) ? "bg-brand-cyan-light/10" : ""}`}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="Select break" />
                </td>
                <td className="px-3 py-2">
                  {r.investor_id ? (
                    <Link href={`/dashboard/investors/${r.investor_id}`} className="text-brand-cyan hover:underline">
                      {r.investor_name ?? "—"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.scheme_name ?? r.scheme_code ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {r.scheme_code}{r.folio_number ? ` · Folio ${r.folio_number}` : ""}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] ${SEV_TONE[r.severity] ?? SEV_TONE.low}`}>
                    {TYPE_LABEL[r.exception_type] ?? r.exception_type}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUnits(r.crm_units)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUnits(r.feed_units)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUnits(r.delta_units)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatINR(Math.abs(Number(r.delta_value ?? 0)))}</td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                  {r.detected_at ? new Date(r.detected_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                </td>
                <td className="px-3 py-2">
                  <SelectField
                    value={r.status}
                    disabled={busy === r.id}
                    onChange={(e) => setStatus(r.id, e.target.value)}
                    size="sm"
                    className="w-32"
                    aria-label="Update break status"
                  >
                    <option value="open">Open</option>
                    <option value="investigating">Investigating</option>
                    <option value="resolved">Resolved</option>
                    <option value="ignored">Ignored</option>
                  </SelectField>
                </td>
                <td className="px-3 py-2">
                  {isAdditive(r) && r.status !== "resolved" ? (
                    <button
                      onClick={() => sync(r.id)}
                      disabled={busy === r.id}
                      className="inline-flex items-center gap-1 rounded-md border border-brand-cyan/40 bg-brand-cyan-light/30 px-2 py-1 text-[11px] font-medium text-brand-cyan-deep hover:bg-brand-cyan-light/60 disabled:opacity-50"
                      title="Post an opening-balance transaction so the CRM matches the feed"
                    >
                      {busy === r.id ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />} Sync to CRM
                    </button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
