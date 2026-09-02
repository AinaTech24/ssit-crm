"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Loader2, X, User, UserPlus } from "lucide-react";

type Hit = { id: string; name: string; pan?: string; phone?: string; email?: string };

/** Start a new discovery — search a lead or client and create the fact-find. */
export function NewDiscoveryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [investors, setInvestors] = useState<Hit[]>([]);
  const [leads, setLeads] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  async function search(term: string) {
    setQ(term);
    if (term.trim().length < 2) { setInvestors([]); setLeads([]); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
      if (res.ok) {
        const j = await res.json();
        setInvestors((j.investors ?? []).slice(0, 6));
        setLeads((j.leads ?? []).slice(0, 6));
      }
    } finally {
      setBusy(false);
    }
  }

  async function create(subjectType: "lead" | "investor", subjectId: string) {
    setCreating(subjectId);
    try {
      const res = await fetch("/api/discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId }),
      });
      if (res.ok) {
        const { id } = await res.json();
        router.push(`/dashboard/discovery/${id}`);
      }
    } finally {
      setCreating(null);
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary text-sm">
        <Plus className="size-4" /> New discovery
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/40 p-4 pt-24" onClick={() => setOpen(false)}>
          <div className="card-surface w-full max-w-lg p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Start a financial discovery</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
            </div>
            <div className="relative">
              <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input autoFocus value={q} onChange={(e) => search(e.target.value)} placeholder="Search a client or lead by name, PAN, phone…" className="input-base text-sm w-full pl-8" />
              {busy && <Loader2 className="size-4 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />}
            </div>

            <div className="max-h-72 overflow-y-auto space-y-3">
              {leads.length > 0 && (
                <Group label="Leads" icon={UserPlus} hits={leads} type="lead" create={create} creating={creating} />
              )}
              {investors.length > 0 && (
                <Group label="Clients" icon={User} hits={investors} type="investor" create={create} creating={creating} />
              )}
              {q.trim().length >= 2 && !busy && leads.length === 0 && investors.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No matching client or lead.</p>
              )}
              {q.trim().length < 2 && <p className="text-xs text-muted-foreground text-center py-6">Type to search.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Group({ label, icon: Icon, hits, type, create, creating }: { label: string; icon: any; hits: Hit[]; type: "lead" | "investor"; create: (t: "lead" | "investor", id: string) => void; creating: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</div>
      <div className="space-y-1">
        {hits.map((h) => (
          <button key={h.id} onClick={() => create(type, h.id)} disabled={!!creating} className="w-full text-left rounded-md border border-border hover:border-brand-cyan/40 hover:bg-accent/40 px-3 py-2 flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{h.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">{[h.pan, h.phone, h.email].filter(Boolean).join(" · ")}</div>
            </div>
            {creating === h.id && <Loader2 className="size-4 animate-spin" />}
          </button>
        ))}
      </div>
    </div>
  );
}
