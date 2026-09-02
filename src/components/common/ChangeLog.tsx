"use client";

/**
 * ChangeLog — a per-record edit-history drawer (Sanchay "Change Log" parity).
 * Reads GET /api/audit for one entity and renders a timeline of who changed
 * what, when. Drop a <ChangeLogButton entityType entityId /> onto any detail
 * page header.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { History, X, Loader2, User, Cpu, Workflow, Webhook } from "lucide-react";

type Entry = {
  id: string; action: string; actor_type: string; at: string;
  before: Record<string, any> | null; after: Record<string, any> | null;
  reason: string | null; actor_name: string | null;
};

const ACTOR_ICON: Record<string, any> = { user: User, system: Cpu, workflow: Workflow, webhook: Webhook };

function humanize(action: string): string {
  const [, verb] = action.split(".");
  const map: Record<string, string> = {
    create: "Created", update: "Updated", delete: "Deleted", merge: "Merged duplicate",
    shortlist_add: "Shortlisted", shortlist_remove: "Removed from shortlist", evaluation_update: "Evaluation updated",
    publish: "Published", verify: "Verified",
  };
  return map[verb] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// Meta / derived columns that change on every save but aren't meaningful edits.
const NOISE_FIELDS = new Set([
  "id", "tenantId", "updatedAt", "createdAt", "updatedById", "searchVector",
  "healthScore", "healthBand", "healthReasons", "healthComputedAt",
  "emailNormalized", "phoneNormalized", "leadScore", "scoreBand", "scoredAt",
]);

/** Every field that ACTUALLY changed in this entry — no arbitrary cap, and
 *  unchanged fields are dropped so the log reflects real edits only. On a
 *  create (no `before`) we show the populated fields as the initial snapshot. */
function changedFields(e: Entry): Array<{ k: string; from?: any; to?: any }> {
  const after = e.after ?? {};
  const before = e.before ?? {};
  const isCreate = !e.before;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !NOISE_FIELDS.has(k));
  return keys
    .filter((k) =>
      isCreate
        ? (after as any)[k] != null && (after as any)[k] !== ""
        : JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k])
    )
    .map((k) => ({ k, from: (before as any)[k], to: after[k] }));
}

const fmt = (v: any) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function ChangeLogButton({ entityType, entityId, variant = "secondary" }: { entityType: string; entityId: string; variant?: "secondary" | "ghost" }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setOpen(true);
    if (entries) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
      const j = await res.json().catch(() => ({}));
      setEntries((j.entries ?? []) as Entry[]);
    } finally { setLoading(false); }
  }

  return (
    <>
      <button onClick={load} className={`${variant === "ghost" ? "btn-ghost" : "btn-secondary"} text-xs inline-flex items-center gap-1`} title="View change history">
        <History className="size-3.5" /> History
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md h-full bg-card border-l shadow-2xl flex flex-col">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2"><History className="size-4 text-brand-cyan" /> Change Log</div>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent"><X className="size-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
              ) : !entries || entries.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-12">No recorded changes for this record yet.</div>
              ) : (
                <ol className="relative border-l border-border ml-2 space-y-4">
                  {entries.map((e) => {
                    const Icon = ACTOR_ICON[e.actor_type] ?? User;
                    const fields = changedFields(e);
                    return (
                      <li key={e.id} className="ml-4">
                        <span className="absolute -left-[9px] mt-1 size-4 rounded-full bg-card border-2 border-brand-cyan grid place-items-center">
                          <Icon className="size-2 text-brand-cyan" />
                        </span>
                        <div className="text-sm font-medium">{humanize(e.action)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {e.actor_name ?? (e.actor_type === "user" ? "A user" : e.actor_type)} · {new Date(e.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                        </div>
                        {fields.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5">
                            {fields.map((f) => (
                              <li key={f.k} className="text-[11px] text-muted-foreground">
                                <span className="font-medium text-foreground">{f.k.replace(/_/g, " ")}</span>{" "}
                                {e.before ? <><span className="line-through opacity-60">{fmt(f.from)}</span> → <span className="text-foreground">{fmt(f.to)}</span></> : <span className="text-foreground">{fmt(f.to)}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                        {e.reason && <div className="text-[11px] italic text-muted-foreground mt-0.5">{e.reason}</div>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
