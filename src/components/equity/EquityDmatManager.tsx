"use client";

/** DMAT account registry — add / close / delete. Drives New-DMAT + Active-Client
 *  counts in the Equity Team MIS. */

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";

type Account = {
  id: string;
  clientName: string;
  dmatNumber: string | null;
  broker: string | null;
  openedDate: string;
  closedDate: string | null;
  status: string;
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function EquityDmatManager() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ clientName: "", dmatNumber: "", broker: "", openedDate: todayStr() });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/equity/dmat", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setAccounts(d.accounts ?? []);
    } catch {
      toast.error("Could not load DMAT accounts.", "Load failed");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!form.clientName.trim() || !form.openedDate) return;
    setBusy(true);
    try {
      const res = await fetch("/api/equity/dmat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName: form.clientName.trim(),
          dmatNumber: form.dmatNumber.trim() || null,
          broker: form.broker.trim() || null,
          openedDate: form.openedDate,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("DMAT account added.", "Saved");
      setForm({ clientName: "", dmatNumber: "", broker: "", openedDate: todayStr() });
      await load();
    } catch {
      toast.error("Could not add account.", "Failed");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    setAccounts((a) => a.map((x) => (x.id === id ? { ...x, status, closedDate: status === "closed" ? todayStr() : x.closedDate } : x)));
    try {
      await fetch(`/api/equity/dmat/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, ...(status === "closed" ? { closedDate: todayStr() } : {}) }),
      });
      load();
    } catch {
      toast.error("Could not update.", "Failed");
      load();
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/equity/dmat/${id}`, { method: "DELETE" });
      toast.success("Account removed.", "Deleted");
      await load();
    } catch {
      toast.error("Could not delete.", "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add */}
      <div className="rounded-xl border border-border p-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
        <label className="text-sm sm:col-span-2">
          <span className="block text-muted-foreground mb-1 text-xs">Client name *</span>
          <input value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none focus:border-brand-cyan" />
        </label>
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1 text-xs">DMAT no.</span>
          <input value={form.dmatNumber} onChange={(e) => setForm((f) => ({ ...f, dmatNumber: e.target.value }))} className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none focus:border-brand-cyan" />
        </label>
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1 text-xs">Opened date *</span>
          <input type="date" value={form.openedDate} onChange={(e) => setForm((f) => ({ ...f, openedDate: e.target.value }))} className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none focus:border-brand-cyan" />
        </label>
        <button type="button" onClick={add} disabled={busy || !form.clientName.trim()} className="btn-primary justify-center">
          <Plus className="size-4" /> Add
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No DMAT accounts yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/40 text-left">
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Client</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">DMAT no.</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Opened</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Status</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-1.5 font-medium">{a.clientName}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{a.dmatNumber ?? "—"}</td>
                  <td className="px-3 py-1.5 tabular-nums">{a.openedDate}</td>
                  <td className="px-3 py-1.5">
                    <SelectField className="w-32" value={a.status} onChange={(e) => setStatus(a.id, e.target.value)}>
                      <option value="active">Active</option>
                      <option value="dormant">Dormant</option>
                      <option value="closed">Closed</option>
                    </SelectField>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button type="button" onClick={() => remove(a.id)} className="text-muted-foreground hover:text-rose-600" aria-label="Delete">
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
