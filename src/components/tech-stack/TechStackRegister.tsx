"use client";

/**
 * MFD Tech Stack register — add tools, see them grouped by category, watch
 * upcoming renewals, total annual spend. Talks to /api/tech-stack.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, ExternalLink, AlertTriangle } from "lucide-react";
import { formatINR, formatDate } from "@/lib/utils";

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "practice_setup", label: "Practice Setup" },
  { value: "transactions", label: "Transactions Platform" },
  { value: "practice_mgmt", label: "Practice Management Software" },
  { value: "client_management", label: "Client Management" },
  { value: "sales_marketing", label: "Sales & Marketing" },
  { value: "research", label: "Research & Analysis" },
  { value: "hr", label: "HR" },
  { value: "ai_tools", label: "AI Tools" },
  { value: "other", label: "Other" },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  evaluating: "bg-amber-50 text-amber-700",
  discontinued: "bg-slate-100 text-slate-500",
};

type Tool = {
  id: string;
  category: string;
  toolName: string;
  purpose: string | null;
  vendorUrl: string | null;
  accessNote: string | null;
  status: string;
  annualCost: string | null;
  renewalDate: string | null;
  notes: string | null;
};

export function TechStackRegister({ initial }: { initial: Tool[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Tool[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    category: "practice_setup",
    toolName: "",
    purpose: "",
    vendorUrl: "",
    accessNote: "",
    status: "active",
    annualCost: "",
    renewalDate: "",
  });

  const totalAnnual = useMemo(
    () => rows.reduce((s, r) => s + Number(r.annualCost ?? 0), 0),
    [rows]
  );

  const renewalsSoon = useMemo(() => {
    const now = Date.now();
    const horizon = now + 60 * 24 * 60 * 60 * 1000;
    return rows
      .filter((r) => r.renewalDate && new Date(r.renewalDate).getTime() <= horizon && r.status === "active")
      .sort((a, b) => (a.renewalDate! < b.renewalDate! ? -1 : 1));
  }, [rows]);

  const byCategory = useMemo(() => {
    const m = new Map<string, Tool[]>();
    for (const r of rows) {
      if (!m.has(r.category)) m.set(r.category, []);
      m.get(r.category)!.push(r);
    }
    return CATEGORIES.map((c) => [c.value, m.get(c.value) ?? []] as const).filter(([, v]) => v.length > 0);
  }, [rows]);

  async function add() {
    if (!form.toolName.trim()) {
      setErr("Enter a tool name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tech-stack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: form.category,
          toolName: form.toolName.trim(),
          purpose: form.purpose.trim() || undefined,
          vendorUrl: form.vendorUrl.trim() || undefined,
          accessNote: form.accessNote.trim() || undefined,
          status: form.status,
          annualCost: form.annualCost ? parseFloat(form.annualCost.replace(/[^0-9.]/g, "")) : undefined,
          renewalDate: form.renewalDate || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setRows((s) => [...s, j.tool]);
      setForm((s) => ({ ...s, toolName: "", purpose: "", vendorUrl: "", accessNote: "", annualCost: "", renewalDate: "" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setRows((s) => s.filter((r) => r.id !== id));
    try {
      await fetch(`/api/tech-stack/${id}`, { method: "DELETE" });
      router.refresh();
    } catch {
      /* optimistic */
    }
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card label="Tools tracked" value={String(rows.length)} />
        <Card label="Active" value={String(rows.filter((r) => r.status === "active").length)} />
        <Card label="Annual tech spend" value={formatINR(totalAnnual)} tone="emerald" />
      </div>

      {/* Renewal watch */}
      {renewalsSoon.length > 0 && (
        <div className="card-surface p-4 border-amber-200">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 mb-2">
            <AlertTriangle className="size-4" /> Renewals in the next 60 days
          </div>
          <ul className="space-y-1 text-xs">
            {renewalsSoon.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <span className="font-medium">{r.toolName}</span>
                <span className="text-amber-700 tabular-nums">
                  {formatDate(r.renewalDate!)}{r.annualCost ? ` · ${formatINR(Number(r.annualCost))}/yr` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Add form */}
      <div className="card-surface p-5">
        <h2 className="font-semibold text-sm mb-3">Add tool</h2>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <label className="block md:col-span-2">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Tool name</div>
            <input value={form.toolName} onChange={(e) => setForm((s) => ({ ...s, toolName: e.target.value }))}
              placeholder="e.g. BSE StAR MF, Google Workspace" className="input-base text-sm w-full" />
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Category</div>
            <select value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))} className="input-base text-sm w-full">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block md:col-span-2">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Purpose</div>
            <input value={form.purpose} onChange={(e) => setForm((s) => ({ ...s, purpose: e.target.value }))}
              placeholder="e.g. Executing MF transactions" className="input-base text-sm w-full" />
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Status</div>
            <select value={form.status} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))} className="input-base text-sm w-full">
              <option value="active">Active</option>
              <option value="evaluating">Evaluating</option>
              <option value="discontinued">Discontinued</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Vendor URL</div>
            <input value={form.vendorUrl} onChange={(e) => setForm((s) => ({ ...s, vendorUrl: e.target.value }))}
              placeholder="https://" className="input-base text-sm w-full" />
          </label>
          <label className="block md:col-span-2">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Who has access</div>
            <input value={form.accessNote} onChange={(e) => setForm((s) => ({ ...s, accessNote: e.target.value }))}
              placeholder="e.g. Owner + Ops" className="input-base text-sm w-full" />
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Annual cost (₹)</div>
            <input inputMode="decimal" value={form.annualCost} onChange={(e) => setForm((s) => ({ ...s, annualCost: e.target.value }))}
              placeholder="0" className="input-base text-sm w-full tabular-nums" />
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Renewal date</div>
            <input type="date" value={form.renewalDate} onChange={(e) => setForm((s) => ({ ...s, renewalDate: e.target.value }))} className="input-base text-sm w-full" />
          </label>
        </div>
        <div className="flex items-center justify-between mt-3">
          {err ? <span className="text-xs text-rose-600">{err}</span> : <span />}
          <button onClick={add} disabled={busy} className="btn-primary text-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add tool
          </button>
        </div>
      </div>

      {/* Register grouped by category */}
      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          No tools recorded yet. Add the platforms and software your firm uses — this doubles as your
          AMFI DDQ evidence for "platform used" and "software/apps list".
        </div>
      ) : (
        byCategory.map(([cat, items]) => (
          <div key={cat} className="card-surface overflow-hidden">
            <div className="border-b px-4 py-2.5 font-semibold text-sm bg-secondary/40">{CAT_LABEL[cat] ?? cat}</div>
            <table className="w-full text-sm">
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/30 group align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium flex items-center gap-1.5">
                        {r.toolName}
                        {r.vendorUrl && (
                          <a href={r.vendorUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                      </div>
                      {r.purpose && <div className="text-[11px] text-muted-foreground mt-0.5">{r.purpose}</div>}
                      {r.accessNote && <div className="text-[10px] text-muted-foreground mt-0.5">Access: {r.accessNote}</div>}
                    </td>
                    <td className="py-2.5 text-xs">
                      <span className={`chip text-[10px] ${STATUS_TONE[r.status] ?? ""}`}>{r.status}</span>
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground text-right tabular-nums whitespace-nowrap">
                      {r.renewalDate ? `renews ${formatDate(r.renewalDate)}` : "—"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-xs pr-2 whitespace-nowrap">
                      {Number(r.annualCost ?? 0) > 0 ? `${formatINR(Number(r.annualCost))}/yr` : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right w-10">
                      <button onClick={() => remove(r.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-600 transition-opacity" title="Delete">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="card-surface glass-card p-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${tone === "emerald" ? "text-emerald-700" : ""}`}>{value}</div>
    </div>
  );
}
