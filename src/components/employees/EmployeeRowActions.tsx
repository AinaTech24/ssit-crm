"use client";

/**
 * Row actions for the Employees table: quick-info popup, edit, deactivate/
 * reactivate, offboard (formal HR exit — redistributes clients), and move to
 * Trash (soft-delete — recoverable from the Trash bin). All three removal paths
 * log the user out everywhere (the API revokes their sessions).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Power, UserMinus, Trash2, Loader2, X, Mail, Phone, Building2, ShieldCheck, Users } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export type EmployeeRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  department: string | null;
  managerName: string | null;
  roles: string[];
  assignedClients: number;
  aum: number;
  joiningDate: string | null;
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  invited: "bg-blue-50 text-blue-700 border-blue-200",
  suspended: "bg-amber-50 text-amber-700 border-amber-200",
  offboarding: "bg-amber-50 text-amber-700 border-amber-200",
  offboarded: "bg-gray-100 text-gray-600 border-gray-200",
};

function fmtINR(n: number): string {
  if (!n) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export function EmployeeRowActions({ employee }: { employee: EmployeeRow }) {
  const router = useRouter();
  const toast = useToast();
  const [info, setInfo] = useState(false);
  const [busy, setBusy] = useState<null | "deactivate" | "offboard" | "trash">(null);
  const [confirmOffboard, setConfirmOffboard] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);

  const isActive = employee.status === "active" || employee.status === "invited";
  const isGone = employee.status === "offboarded";
  const isSelf = false; // server enforces the self-removal guard; UI never hides its own row here

  async function patchStatus(status: string, kind: "deactivate" | "offboard") {
    setBusy(kind);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Failed (${res.status})`, "Action failed");
        return;
      }
      toast.success(
        status === "offboarded" ? `${employee.name} offboarded` : status === "suspended" ? `${employee.name} deactivated` : `${employee.name} reactivated`
      );
      setConfirmOffboard(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function trashEmployee() {
    setBusy("trash");
    try {
      const res = await fetch(`/api/employees/${employee.id}?trash=1`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Failed (${res.status})`, "Couldn't move to Trash");
        return;
      }
      toast.success(`${employee.name} moved to Trash`);
      setConfirmTrash(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't move to Trash");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button onClick={() => setInfo(true)} title="Quick info" aria-label="Quick info" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary">
        <Eye className="size-4" />
      </button>
      <Link href={`/dashboard/employees/${employee.id}`} title="Edit" aria-label="Edit" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary">
        <Pencil className="size-4" />
      </Link>
      {!isGone && (
        <button
          onClick={() => patchStatus(isActive ? "suspended" : "active", "deactivate")}
          disabled={busy !== null}
          title={isActive ? "Deactivate (logs them out)" : "Reactivate"}
          aria-label={isActive ? "Deactivate" : "Reactivate"}
          className={`p-1.5 rounded-md hover:bg-secondary disabled:opacity-50 ${isActive ? "text-amber-600" : "text-emerald-600"}`}
        >
          {busy === "deactivate" ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
        </button>
      )}
      {!isGone && (
        <button
          onClick={() => setConfirmOffboard(true)}
          disabled={busy !== null}
          title="Offboard (redistribute clients & revoke access)"
          aria-label="Offboard"
          className="p-1.5 rounded-md text-amber-700 hover:bg-amber-50 disabled:opacity-50"
        >
          {busy === "offboard" ? <Loader2 className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
        </button>
      )}
      {!isSelf && (
        <button
          onClick={() => setConfirmTrash(true)}
          disabled={busy !== null}
          title="Move to Trash (recoverable)"
          aria-label="Move to Trash"
          className="p-1.5 rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          {busy === "trash" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </button>
      )}

      {/* Quick-info popup */}
      {info && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => setInfo(false)}>
          <div className="card-surface w-full max-w-md my-8 text-left" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 p-5 border-b">
              <div>
                <h3 className="text-lg font-bold leading-tight">{employee.name}</h3>
                <span className={`inline-block mt-1 text-[11px] font-medium capitalize px-2 py-0.5 rounded border ${STATUS_TONE[employee.status] ?? "bg-secondary"}`}>
                  {employee.status}
                </span>
              </div>
              <button onClick={() => setInfo(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="size-5" /></button>
            </div>
            <div className="p-5 space-y-2.5 text-sm">
              <Row icon={Mail} label="Email" value={employee.email} />
              <Row icon={Phone} label="Phone" value={employee.phone} />
              <Row icon={Building2} label="Department" value={employee.department ? employee.department.replace(/_/g, " ") : null} />
              <Row icon={Users} label="Manager" value={employee.managerName} />
              <Row icon={ShieldCheck} label="Roles" value={employee.roles?.length ? employee.roles.join(", ") : null} />
              <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                <div><div className="text-[11px] text-muted-foreground">Clients</div><div className="font-semibold tabular-nums">{employee.assignedClients}</div></div>
                <div><div className="text-[11px] text-muted-foreground">AUM</div><div className="font-semibold tabular-nums">{fmtINR(employee.aum)}</div></div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <Link href={`/dashboard/employees/${employee.id}`} className="btn-secondary text-sm">Open full profile</Link>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOffboard}
        title={`Offboard ${employee.name}?`}
        message={`This runs the formal exit for ${employee.name} — they're logged out, lose all access, and their clients are redistributed. This can be undone by an admin.`}
        confirmLabel="Offboard employee"
        tone="danger"
        busy={busy === "offboard"}
        onConfirm={() => patchStatus("offboarded", "offboard")}
        onCancel={() => setConfirmOffboard(false)}
      />

      <ConfirmDialog
        open={confirmTrash}
        title={`Move ${employee.name} to Trash?`}
        message={`${employee.name} will be logged out and hidden from your team list. Their clients stay assigned. You can restore them from Trash, or remove them permanently there.`}
        confirmLabel="Move to Trash"
        tone="danger"
        busy={busy === "trash"}
        onConfirm={trashEmployee}
        onCancel={() => setConfirmTrash(false)}
      />
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-20 shrink-0 text-xs">{label}</span>
      <span className="truncate">{value || "—"}</span>
    </div>
  );
}
