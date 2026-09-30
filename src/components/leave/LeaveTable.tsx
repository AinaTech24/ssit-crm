"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, X, Ban, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { LEAVE_DURATION_LABELS } from "@/lib/leave/policy";

const STATUS_TONE: Record<string, string> = {
  requested: "bg-blue-50 text-blue-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  cancelled: "bg-gray-50 text-gray-700",
};

export type LeaveRow = {
  id: string;
  employee_user_id: string;
  employee_name: string | null;
  leave_type: string;
  duration: string;
  from_date: string;
  to_date: string;
  no_of_days: string;
  status: string;
  approver_name: string | null;
  reason: string | null;
  created_at: string;
  /**
   * Whether THIS viewer may decide THIS request — computed server-side with
   * the same rule the API enforces (lib/leave/access.ts). Per row, because a
   * branch head may act on their desk's requests but not on another branch
   * head's. Absent = fall back to the blanket flag.
   */
  canDecide?: boolean;
};

export function LeaveTable({
  rows,
  canApprove,
  currentUserId,
}: {
  rows: LeaveRow[];
  canApprove: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject" | "cancel") {
    let decisionNotes: string | undefined;
    if (action === "reject") {
      decisionNotes = window.prompt("Reason for rejection (optional):") ?? undefined;
    }
    if (action === "cancel" && !window.confirm("Cancel this leave request?")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/leave-applications/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, decisionNotes }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Action failed"); return; }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  /**
   * Removes the request outright, unlike Cancel which keeps it with its
   * history. For a duplicate or a row filed against the wrong person.
   */
  async function remove(id: string) {
    if (!window.confirm("Delete this leave request? This cannot be undone — use Cancel to withdraw one instead.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/leave-applications/${id}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Delete failed"); return; }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card-surface p-12 text-center text-sm text-muted-foreground">
        <div className="font-medium">No leave applications match.</div>
        <p className="mt-2 text-xs">File one with “New request”.</p>
      </div>
    );
  }

  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Employee</th>
            <th className="text-left py-2 font-medium">Type</th>
            <th className="text-left py-2 font-medium">From → To</th>
            <th className="text-right py-2 font-medium">Days</th>
            <th className="text-left py-2 font-medium">Reason</th>
            <th className="text-left py-2 font-medium">Status</th>
            <th className="text-left py-2 font-medium">Approver</th>
            <th className="text-right py-2 font-medium pr-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOwnRow = r.employee_user_id === currentUserId;
            const pending = r.status === "requested";
            // Per-row right, falling back to the blanket flag for callers that
            // do not compute one.
            const mayDecide = r.canDecide ?? canApprove;
            return (
              <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                <td className="px-4 py-3 font-medium whitespace-nowrap">{r.employee_name ?? "—"}</td>
                <td className="py-3 text-xs whitespace-nowrap tabular-nums">
                  {formatDate(r.from_date)}
                  {r.to_date !== r.from_date ? ` → ${formatDate(r.to_date)}` : ""}
                  {r.duration === "half_day" && <span className="text-[10px] text-muted-foreground ml-1">({LEAVE_DURATION_LABELS.half_day})</span>}
                </td>
                <td className="py-3 text-right tabular-nums">{r.no_of_days}</td>
                <td className="py-3 text-xs text-muted-foreground max-w-[340px]" title={r.reason ?? ""}>{r.reason ?? "—"}</td>
                <td className="py-3"><span className={`chip capitalize ${STATUS_TONE[r.status] ?? ""}`}>{r.status}</span></td>
                <td className="py-3 text-xs whitespace-nowrap">{r.approver_name ?? "—"}</td>
                <td className="py-3 pr-4 text-right whitespace-nowrap">
                  {busy === r.id ? (
                    <Loader2 className="size-4 animate-spin inline" />
                  ) : (
                    <div className="inline-flex items-center gap-1">
                      {pending && mayDecide && (
                        <>
                          <button onClick={() => act(r.id, "approve")} className="btn-ghost text-xs text-emerald-700 inline-flex items-center gap-1"><Check className="size-3.5" /> Approve</button>
                          <button onClick={() => act(r.id, "reject")} className="btn-ghost text-xs text-rose-600 inline-flex items-center gap-1"><X className="size-3.5" /> Reject</button>
                        </>
                      )}
                      {pending && (isOwnRow || mayDecide) && (
                        <button onClick={() => act(r.id, "cancel")} className="btn-ghost text-xs text-muted-foreground inline-flex items-center gap-1"><Ban className="size-3.5" /> Cancel</button>
                      )}
                      {(isOwnRow || mayDecide) && (
                        <button
                          onClick={() => remove(r.id)}
                          title="Delete this request"
                          className="btn-ghost text-xs text-rose-600 inline-flex items-center gap-1"
                        >
                          <Trash2 className="size-3.5" /> Delete
                        </button>
                      )}
                      {!pending && !isOwnRow && !mayDecide && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
