"use client";

/**
 * Service-request list table — row selection + bulk actions + inline status,
 * with each ticket linking to its workspace (/[id]).
 *
 * Bulk (POST /api/service-requests/bulk): assign · set status · close.
 * Inline: a per-row status chip PATCHes status immediately.
 * Preserves data-table / data-col attributes for the ColumnManager.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, X, UserCog, RefreshCw, Ban } from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { RmSelector } from "@/components/common/RmSelector";
import { Avatar } from "@/components/ui/Avatar";
import { formatDate } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  nominee_update: "Nominee Update", bank_update: "Bank Update", mobile_update: "Mobile Update",
  email_update: "Email Update", kyc_update: "KYC Update", minor_to_major: "Minor to Major",
  capital_gain_report: "Capital Gain Report", statement_request: "Statement Request",
  redemption_request: "Redemption Request", switch_request: "Switch Request",
  transmission_case: "Transmission Case", folio_correction: "Folio Correction", other: "Other",
  complaint: "Complaint", redemption_help: "Redemption Request", switch_help: "Switch Request",
  transaction_query: "Other",
};

const STATUSES = [
  ["open", "Open"], ["in_progress", "In progress"], ["waiting_customer", "Waiting customer"],
  ["resolved", "Resolved"], ["closed", "Closed"], ["escalated", "Escalated"],
] as const;

const STATUS_TONE: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  waiting_customer: "bg-slate-50 text-slate-700 border-slate-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-gray-50 text-gray-700 border-gray-200",
  escalated: "bg-rose-50 text-rose-700 border-rose-200",
};

const PRIORITY_TONE: Record<string, string> = {
  urgent: "text-rose-600", high: "text-amber-600", normal: "text-foreground", low: "text-muted-foreground",
};

export function ServiceRequestsTable({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | "assign" | "status" | "close">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [assignRm, setAssignRm] = useState<string | null>(null);
  const [statusVal, setStatusVal] = useState("in_progress");
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id))); }

  async function inlineStatus(id: string, status: string) {
    setRowBusy(id);
    try {
      const res = await fetch(`/api/service-requests/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Update failed"); return; }
      router.refresh();
    } finally { setRowBusy(null); }
  }

  async function runBulk() {
    if (!bulk) return;
    let value: string | null = null;
    if (bulk === "assign") value = assignRm;
    if (bulk === "status") value = statusVal;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/service-requests/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action: bulk, value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Failed (${res.status})`); return; }
      setBulk(null); setSelected(new Set()); router.refresh();
    } finally { setBusy(false); }
  }

  if (rows.length === 0) {
    return (
      <div className="card-surface p-12 text-center text-sm text-muted-foreground">
        <div className="font-medium">No service requests match these filters.</div>
        <p className="mt-2 text-xs max-w-md mx-auto">
          Click <strong>New ticket</strong> to raise a request. Tickets auto-track TAT and escalate to the owner if the SLA breaches.
        </p>
      </div>
    );
  }

  return (
    <div className="card-surface">
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap border-b bg-brand-cyan-light/40 px-4 py-2 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          <button onClick={() => setBulk("assign")} className="btn-ghost text-xs inline-flex items-center gap-1"><UserCog className="size-3.5" /> Assign</button>
          <button onClick={() => setBulk("status")} className="btn-ghost text-xs inline-flex items-center gap-1"><RefreshCw className="size-3.5" /> Set status</button>
          <button onClick={() => setBulk("close")} className="btn-ghost text-xs inline-flex items-center gap-1 text-rose-600"><Ban className="size-3.5" /> Close</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline ml-auto">Clear</button>
        </div>
      )}
      {bulk && (
        <div className="border-b bg-secondary/40 px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
          {bulk === "assign" && <div className="min-w-[240px]"><RmSelector value={assignRm} onChange={setAssignRm} placeholder="— Choose assignee (or unassign) —" /></div>}
          {bulk === "status" && (
            <select value={statusVal} onChange={(e) => setStatusVal(e.target.value)} className="input-base text-sm">
              {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          {bulk === "close" && <span className="text-rose-600">Close {selected.size} ticket(s).</span>}
          <button onClick={runBulk} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">
            {busy && <Loader2 className="size-3.5 animate-spin" />} Apply to {selected.size}
          </button>
          <button onClick={() => { setBulk(null); setErr(null); }} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-0.5"><X className="size-3" /> Cancel</button>
          {err && <span className="text-xs text-rose-600">{err}</span>}
        </div>
      )}

      <div className="table-scroll group/tbl">
        <table className="w-full text-sm" data-table="service-requests">
          <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
            <tr>
              <th className="px-3 py-2 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} className={`size-3.5 rounded transition-opacity ${selected.size > 0 ? "opacity-100" : "opacity-0 group-hover/tbl:opacity-100 focus:opacity-100"}`} aria-label="Select all" /></th>
              <th data-col="ticket" className="text-left px-1 py-2 font-medium">Ticket</th>
              <th data-col="client" className="text-left py-2 font-medium">Client</th>
              <th data-col="type" className="text-left py-2 font-medium">Service Type</th>
              <th data-col="raised" className="text-left py-2 font-medium">Raised</th>
              <th data-col="assignee" className="text-left py-2 font-medium">Assigned to</th>
              <th data-col="priority" className="text-left py-2 font-medium">Priority</th>
              <th data-col="status" className="text-left py-2 font-medium">Status</th>
              <th data-col="expected" className="text-left py-2 font-medium">Expected</th>
              <th data-col="tat" className="text-right py-2 font-medium" title="Days since the ticket was raised">Age (days)</th>
              <th data-col="attachments" className="text-right py-2 font-medium pr-4">Att.</th>
              <th data-col="actions" className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((sr) => {
              const isSel = selected.has(sr.id);
              return (
                <tr key={sr.id} className={`group/row border-b last:border-0 hover:bg-secondary/40 ${isSel ? "bg-brand-cyan-light/30" : ""}`}>
                  <td className="px-3 py-3"><input type="checkbox" checked={isSel} onChange={() => toggle(sr.id)} className={`size-3.5 rounded transition-opacity ${isSel ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus:opacity-100"}`} aria-label={`Select ${sr.ticket_no}`} /></td>
                  <td data-col="ticket" className="px-1 py-3 font-mono text-xs whitespace-nowrap">
                    <Link href={`/dashboard/service-requests/${sr.id}`} className="hover:underline text-brand-cyan-deep">{sr.ticket_no}</Link>
                  </td>
                  <td data-col="client" className="py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Avatar src={sr.investor_id && sr.investor_avatar_url ? `/api/investors/${sr.investor_id}/avatar` : null} name={sr.investor_name} size={26} />
                      {sr.investor_id ? (
                        <Link href={`/dashboard/investors/${sr.investor_id}`} className="hover:underline">{sr.investor_name}</Link>
                      ) : (<span>{sr.investor_name ?? "—"}</span>)}
                    </div>
                  </td>
                  <td data-col="type" className="py-3 text-xs">
                    <Link href={`/dashboard/service-requests/${sr.id}`} className="font-medium hover:underline">{TYPE_LABEL[sr.type] ?? sr.type}</Link>
                    {sr.subject && <div className="text-[11px] text-muted-foreground max-w-[180px] truncate">{sr.subject}</div>}
                  </td>
                  <td data-col="raised" className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(sr.created_at)}</td>
                  <td data-col="assignee" className="py-3 text-xs whitespace-nowrap">{sr.assignee_name ?? "—"}</td>
                  <td data-col="priority" className={`py-3 text-xs capitalize ${PRIORITY_TONE[sr.priority]}`}>{sr.priority}</td>
                  <td data-col="status" className="py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[sr.status] ?? ""}`}>
                      {rowBusy === sr.id && <Loader2 className="size-3 animate-spin" />}
                      <select value={sr.status} disabled={rowBusy === sr.id} onChange={(e) => inlineStatus(sr.id, e.target.value)} className="bg-transparent border-0 outline-none cursor-pointer text-xs font-medium appearance-none pr-1">
                        {STATUSES.map(([k, l]) => <option key={k} value={k} className="bg-white text-foreground">{l}</option>)}
                      </select>
                    </span>
                    {sr.escalated_at && <div className="text-[10px] text-rose-600 font-semibold mt-0.5">escalated</div>}
                  </td>
                  <td data-col="expected" className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{sr.sla_resolution_at ? formatDate(sr.sla_resolution_at) : "—"}</td>
                  <td data-col="tat" className="py-3 text-right tabular-nums">
                    {sr.breached ? <span className="text-rose-600 font-semibold" title="Past the promised resolution date">{sr.tat_days}</span> : <span className="text-muted-foreground">{sr.tat_days}</span>}
                  </td>
                  <td data-col="attachments" className="py-3 text-right tabular-nums text-muted-foreground">{sr.attach_count > 0 ? sr.attach_count : "—"}</td>
                  <td data-col="actions" className="px-4 py-3 text-right">
                    <RowActions editHref={`/dashboard/service-requests/${sr.id}`} deleteUrl={`/api/service-requests/${sr.id}`} itemLabel="ticket" itemName={sr.ticket_no} verb="Close" deleteIcon={Ban} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
