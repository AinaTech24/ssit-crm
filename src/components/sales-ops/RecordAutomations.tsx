"use client";

/**
 * RecordAutomations — per-record "Run macro" + "Enroll in cadence" actions
 * (Zoho parity) for a lead/client detail. Fetches the active macros/cadences
 * for the subject type and fires them in one click.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Repeat, Loader2, ChevronDown } from "lucide-react";

type Subject = { type: "lead" | "investor"; id: string };

export function RecordAutomations({ subject }: { subject: Subject }) {
  return (
    <>
      <Menu subject={subject} kind="macro" />
      <Menu subject={subject} kind="cadence" />
    </>
  );
}

function Menu({ subject, kind }: { subject: Subject; kind: "macro" | "cadence" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setOpen((o) => !o);
    if (items) return;
    const url = kind === "macro" ? `/api/macros?subjectType=${subject.type}` : `/api/cadences?subjectType=${subject.type}`;
    const res = await fetch(url);
    const j = await res.json().catch(() => ({}));
    setItems(((kind === "macro" ? j.macros : j.cadences) ?? []).filter((x: any) => x.is_active));
  }

  async function fire(id: string, name: string) {
    setBusy(id); setMsg(null);
    try {
      const url = kind === "macro" ? `/api/macros/${id}/run` : `/api/cadences/${id}/enroll`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subjectType: subject.type, subjectId: subject.id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(j.error ?? "Failed"); return; }
      setMsg(kind === "macro" ? `Ran "${name}" (${j.ran} steps)` : `Enrolled in "${name}"`);
      setOpen(false); router.refresh();
      setTimeout(() => setMsg(null), 3000);
    } finally { setBusy(null); }
  }

  const Icon = kind === "macro" ? Zap : Repeat;
  return (
    <span className="relative inline-block">
      <button onClick={load} className="btn-secondary text-xs inline-flex items-center gap-1">
        <Icon className="size-3.5" /> {kind === "macro" ? "Macros" : "Enroll"} <ChevronDown className="size-3" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-56 rounded-lg border bg-card shadow-lg p-1" onMouseLeave={() => setOpen(false)}>
          {items == null ? <div className="p-3 text-center"><Loader2 className="size-4 animate-spin inline" /></div>
            : items.length === 0 ? <div className="p-3 text-xs text-muted-foreground text-center">No {kind === "macro" ? "macros" : "cadences"} configured.</div>
            : items.map((it) => (
              <button key={it.id} onClick={() => fire(it.id, it.name)} disabled={!!busy} className="w-full text-left px-2.5 py-1.5 rounded hover:bg-secondary/60 text-sm flex items-center justify-between">
                <span className="truncate">{it.name}</span>{busy === it.id && <Loader2 className="size-3.5 animate-spin" />}
              </button>
            ))}
        </div>
      )}
      {msg && <span className="absolute left-0 top-full mt-1 text-[11px] text-emerald-700 whitespace-nowrap">{msg}</span>}
    </span>
  );
}
