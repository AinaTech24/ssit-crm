"use client";

/**
 * Attendance regularization table — list of correction requests with
 * Approve / Reject / Cancel actions gated by canManage / own-row (mirrors
 * LeaveTable). Reject and Cancel route through a branded ConfirmDialog.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, X, Ban } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_TONE } from "@/lib/attendance/policy";

const STATUS_TONE: Record<string, string> = {
  requested: "bg-blue-50 text-blue-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  cancelled: "bg-gray-50 text-gray-700",
};

export type RegularizationRow = {
  id: string;
  employee_user_id: string;
  employee_name: string | null;
  attendance_date: string;
  requested_status: string;
  requested_clock_in_at: string | null;
  requested_clock_out_at: string | null;
  reason: string | null;
  status: string;
  reviewer_name: string | null;
};

function fmtTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

export function RegularizationTable({
  rows,
  canManage,
  currentUserId,
}: {
  rows: RegularizationRow[];
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "reject" | "cancel" } | null>(null);

  async function act(id: string, action: "approve" | "reject" | "cancel") {
    setBusy(id);
    try {
      const res = await fetch(`/api/attendance/regularizations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Action failed");
        return;
      }
      toast.success(`Request ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "cancelled"}.`);
      router.refresh();
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card-surface p-12 text-center text-sm text-muted-foreground">
        <div className="font-medium">No correction requests.</div>
        <p className="mt-2 text-xs">File one with “New correction request”.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Employee</th>
              <th className="text-left py-2 font-medium">Date</th>
              <th className="text-left py-2 font-medium">Requested status</th>
              <th className="text-left py-2 font-medium">Times</th>
              <th className="text-left py-2 font-medium">Reason</th>
              <th className="text-left py-2 font-medium">Status</th>
              <th className="text-left py-2 font-medium">Reviewer</th>
              <th className="text-right py-2 font-medium pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOwnRow = r.employee_user_id === currentUserId;
              const pending = r.status === "requested";
              const inT = fmtTime(r.requested_clock_in_at);
              const outT = fmtTime(r.requested_clock_out_at);
              return (
                <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{r.employee_name ?? "—"}</td>
                  <td className="py-3 text-xs whitespace-nowrap tabular-nums">{formatDate(r.attendance_date)}</td>
                  <td className="py-3">
                    <span className={`chip capitalize ${ATTENDANCE_STATUS_TONE[r.requested_status] ?? ""}`}>
                      {ATTENDANCE_STATUS_LABELS[r.requested_status] ?? r.requested_status}
                    </span>
                  </td>
                  <td className="py-3 text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                    {inT || outT ? `${inT || "—"} → ${outT || "—"}` : "—"}
                  </td>
                  <td className="py-3 text-xs text-muted-foreground max-w-[220px] truncate">{r.reason ?? "—"}</td>
                  <td className="py-3">
                    <span className={`chip capitalize ${STATUS_TONE[r.status] ?? ""}`}>{r.status}</span>
                  </td>
                  <td className="py-3 text-xs whitespace-nowrap">{r.reviewer_name ?? "—"}</td>
                  <td className="py-3 pr-4 text-right whitespace-nowrap">
                    {busy === r.id ? (
                      <Loader2 className="size-4 animate-spin inline" />
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        {pending && canManage && (
                          <>
                            <button onClick={() => act(r.id, "approve")} className="btn-ghost text-xs text-emerald-700 inline-flex items-center gap-1">
                              <Check className="size-3.5" /> Approve
                            </button>
                            <button onClick={() => setConfirm({ id: r.id, action: "reject" })} className="btn-ghost text-xs text-rose-600 inline-flex items-center gap-1">
                              <X className="size-3.5" /> Reject
                            </button>
                          </>
                        )}
                        {pending && (isOwnRow || canManage) && (
                          <button onClick={() => setConfirm({ id: r.id, action: "cancel" })} className="btn-ghost text-xs text-muted-foreground inline-flex items-center gap-1">
                            <Ban className="size-3.5" /> Cancel
                          </button>
                        )}
                        {!pending && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === "reject" ? "Reject correction request?" : "Cancel correction request?"}
        message={
          confirm?.action === "reject"
            ? "The employee will be notified that their attendance correction was rejected."
            : "This withdraws the correction request. It cannot be undone."
        }
        confirmLabel={confirm?.action === "reject" ? "Reject" : "Cancel request"}
        cancelLabel="Back"
        tone="danger"
        busy={!!busy}
        onConfirm={() => confirm && act(confirm.id, confirm.action)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
