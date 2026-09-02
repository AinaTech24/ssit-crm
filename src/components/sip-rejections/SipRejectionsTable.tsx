"use client";

/**
 * SIP-rejections recovery table — row selection + bulk recovery actions on top
 * of the existing inline status/remark editors + 1-click Auto-Recovery trigger.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, X, UserCog, PhoneCall, CalendarClock, Ban, Zap, CheckCircle2 } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { RecoveryStatusUpdater } from "@/components/sip-rejections/RecoveryStatusUpdater";
import { RemarkEditor } from "@/components/sip-rejections/RemarkEditor";
import { formatINR, formatDate, formatRelative } from "@/lib/utils";

export type SipRejectionRow = {
  id: string;
  investor_id: string;
  investor_name: string | null;
  investor_pan: string | null;
  rejection_date: string;
  created_at: string;
  scheme_name: string | null;
  amc_name: string | null;
  folio_number: string | null;
  rejection_amount: string;
  rejection_reason: string | null;
  reason_category: string | null;
  rm_name: string | null;
  follow_up_date: string | null;
  recovery_date: string | null;
  recovery_status: string;
  remarks: string | null;
  escalation_overdue: boolean;
};

const CAT_LABEL: Record<string, string> = {
  insufficient_balance: "Balance",
  mandate_expired: "Mandate",
  technical: "Technical",
};
const CAT_TONE: Record<string, string> = {
  insufficient_balance: "bg-amber-50 text-amber-700 border-amber-200",
  mandate_expired: "bg-brand-cyan-light/50 text-brand-cyan-deep border-brand-cyan/30",
  technical: "bg-slate-50 text-slate-600 border-slate-200",
};

export function SipRejectionsTable({ rows }: { rows: SipRejectionRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | "assign" | "contacted" | "follow_up" | "close">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [assignRm, setAssignRm] = useState<string | null>(null);
  const [followDate, setFollowDate] = useState("");
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [recoverySuccess, setRecoverySuccess] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function handleAutoRecover(id: string) {
    setRecoveringId(id);
    setRecoverySuccess(null);
    try {
      const res = await fetch(`/api/sip-rejections/${id}/auto-recover`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Auto-recovery failed");
      } else {
        setRecoverySuccess(id);
        setTimeout(() => setRecoverySuccess(null), 3000);
        router.refresh();
      }
    } catch {
      alert("Network error while triggering auto-recovery");
    } finally {
      setRecoveringId(null);
    }
  }

  async function runBulk() {
    if (!bulk) return;
    let value: string | null = null;
    if (bulk === "assign") value = assignRm;
    if (bulk === "follow_up") {
      if (!followDate) {
        setErr("Pick a follow-up date.");
        return;
      }
      value = followDate;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sip-rejections/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action: bulk, value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      setBulk(null);
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface overflow-hidden">
      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap border-b bg-brand-cyan-light/40 px-4 py-2 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          <button onClick={() => setBulk("assign")} className="btn-ghost text-xs inline-flex items-center gap-1">
            <UserCog className="size-3.5" /> Reassign RM
          </button>
          <button onClick={() => setBulk("contacted")} className="btn-ghost text-xs inline-flex items-center gap-1">
            <PhoneCall className="size-3.5" /> Mark Contacted
          </button>
          <button onClick={() => setBulk("follow_up")} className="btn-ghost text-xs inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" /> Set Follow-Up
          </button>
          <button onClick={() => setBulk("close")} className="btn-ghost text-xs inline-flex items-center gap-1 text-rose-700">
            <Ban className="size-3.5" /> Close (Lost)
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Bulk value popover */}
      {bulk && (
        <div className="border-b bg-secondary/40 px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
          {bulk === "assign" && (
            <div className="min-w-[240px]">
              <RmSelector value={assignRm} onChange={setAssignRm} placeholder="— Choose RM (or unassign) —" />
            </div>
          )}
          {bulk === "follow_up" && (
            <input type="date" value={followDate} onChange={(e) => setFollowDate(e.target.value)} className="input-base text-sm" />
          )}
          <button onClick={runBulk} disabled={busy} className="btn-primary text-xs">
            {busy && <Loader2 className="size-3.5 animate-spin" />} Apply to {selected.size}
          </button>
          <button
            onClick={() => {
              setBulk(null);
              setErr(null);
            }}
            className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-0.5"
          >
            <X className="size-3" /> Cancel
          </button>
          {err && <span className="text-xs text-rose-600">{err}</span>}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <p className="text-sm font-medium">No SIP rejections found.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-sm" data-table="sip_rejections">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="size-3.5 rounded"
                    aria-label="Select all"
                  />
                </th>
                <th data-col="rejected_on" className="px-1 py-2.5 font-medium">Rejected On</th>
                <th data-col="investor" className="py-2.5 font-medium">Client</th>
                <th data-col="sip" className="py-2.5 font-medium">SIP Scheme</th>
                <th data-col="amount" className="py-2.5 font-medium text-right">Amount</th>
                <th data-col="reason" className="py-2.5 font-medium">Reason</th>
                <th data-col="rm" className="py-2.5 font-medium">RM</th>
                <th data-col="follow_up" className="py-2.5 font-medium">Follow-Up</th>
                <th data-col="recovery_status" className="py-2.5 font-medium">Status</th>
                <th data-col="auto_recover" className="py-2.5 font-medium text-center">Auto-Action</th>
                <th data-col="remarks" className="py-2.5 pr-4 font-medium">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSel = selected.has(r.id);
                const isRecovering = recoveringId === r.id;
                const isSuccess = recoverySuccess === r.id;
                return (
                  <tr
                    key={r.id}
                    className={`border-b last:border-0 hover:bg-accent/40 ${isSel ? "bg-brand-cyan-light/30" : ""}`}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(r.id)}
                        className="size-3.5 rounded"
                        aria-label={`Select ${r.investor_name ?? "rejection"}`}
                      />
                    </td>
                    <td data-col="rejected_on" className="px-1 py-3 text-xs whitespace-nowrap">
                      <div className="font-medium tabular-nums">{formatDate(r.rejection_date)}</div>
                      <div className="text-muted-foreground">{formatRelative(r.created_at)}</div>
                    </td>
                    <td data-col="investor" className="py-3 whitespace-nowrap">
                      <Link href={`/dashboard/investors/${r.investor_id}`} className="hover:underline font-medium">
                        {r.investor_name ?? "—"}
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono">{r.investor_pan}</div>
                    </td>
                    <td data-col="sip" className="py-3 max-w-[200px]">
                      <div className="text-sm truncate font-medium">{r.scheme_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.amc_name ?? "—"}
                        {r.folio_number ? <> · <span className="font-mono">{r.folio_number}</span></> : null}
                      </div>
                    </td>
                    <td data-col="amount" className="py-3 text-right tabular-nums font-semibold text-rose-600">
                      {formatINR(Number(r.rejection_amount))}
                    </td>
                    <td data-col="reason" className="py-3 text-xs max-w-[200px]">
                      {r.reason_category && (
                        <span
                          className={`inline-block mb-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                            CAT_TONE[r.reason_category] ?? ""
                          }`}
                        >
                          {CAT_LABEL[r.reason_category] ?? r.reason_category}
                        </span>
                      )}
                      <div className="font-mono text-[11px] text-muted-foreground truncate">
                        {r.rejection_reason ?? "—"}
                      </div>
                    </td>
                    <td data-col="rm" className="py-3 text-xs whitespace-nowrap">
                      {r.rm_name ?? <span className="text-amber-600">Unassigned</span>}
                    </td>
                    <td data-col="follow_up" className="py-3 text-xs whitespace-nowrap">
                      {r.follow_up_date ? formatDate(r.follow_up_date) : "—"}
                      {r.escalation_overdue && (
                        <div className="text-[10px] text-rose-600 font-semibold">SLA breached</div>
                      )}
                    </td>
                    <td data-col="recovery_status" className="py-3 whitespace-nowrap">
                      <RecoveryStatusUpdater rejectionId={r.id} currentStatus={r.recovery_status} />
                    </td>
                    <td data-col="auto_recover" className="py-3 whitespace-nowrap text-center">
                      <button
                        type="button"
                        onClick={() => handleAutoRecover(r.id)}
                        disabled={isRecovering || r.recovery_status === "recovered"}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg shadow-xs transition-all ${
                          isSuccess
                            ? "bg-emerald-600 text-white"
                            : r.recovery_status === "recovered"
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-brand-navy hover:bg-brand-navy-deep text-white"
                        }`}
                        title="Trigger automated WhatsApp alert to client & create RM retry task"
                      >
                        {isRecovering ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : isSuccess ? (
                          <CheckCircle2 className="size-3" />
                        ) : (
                          <Zap className="size-3 text-amber-300" />
                        )}
                        <span>{isSuccess ? "Triggered" : "Auto-Recover"}</span>
                      </button>
                    </td>
                    <td data-col="remarks" className="py-3 pr-4">
                      <RemarkEditor rejectionId={r.id} initial={r.remarks ?? null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
