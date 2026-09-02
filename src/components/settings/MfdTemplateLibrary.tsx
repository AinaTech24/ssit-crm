"use client";

/**
 * MFD starter library — a browsable catalog of researched SOP task templates
 * (SIP, lumpsum, redemption, onboarding, KYC, mandate, review…). One click adds
 * a template (with its full sub-task checklist) into the firm's task templates,
 * where the team applies it from New Task and delegates sub-tasks to teammates.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { BookOpen, Check, ChevronDown, Loader2, Plus, X } from "lucide-react";

type CatalogItem = {
  key: string;
  name: string;
  description: string;
  group: string;
  department: string;
  priority: string;
  dueOffsetDays: number;
  subtasks: string[];
  installed: boolean;
};

export function MfdTemplateLibrary() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/task-templates/library");
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Couldn't load the library");
      setItems(Array.isArray(j.catalog) ? j.catalog : []);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load the library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function install(keys: string[], busyTag: string) {
    setBusyKey(busyTag);
    setError(null);
    try {
      const res = await fetch("/api/task-templates/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Couldn't add the template(s)");
      await load(); // refresh installed flags
      router.refresh(); // refresh the parent template list
    } catch (e: any) {
      setError(e?.message ?? "Couldn't add the template(s)");
    } finally {
      setBusyKey(null);
    }
  }

  const groups = Array.from(new Set(items.map((i) => i.group)));
  const missing = items.filter((i) => !i.installed);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary inline-flex items-center gap-1.5">
        <BookOpen className="size-4" /> MFD starter library
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl max-h-[85vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b flex items-center justify-between">
              <div>
                <div className="font-semibold flex items-center gap-2"><BookOpen className="size-4 text-brand-cyan" /> MFD starter library</div>
                <div className="text-xs text-muted-foreground mt-0.5">Ready-made SOPs for MFD work — add one and your team applies it from New Task, then delegates sub-tasks.</div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent" aria-label="Close"><X className="size-4" /></button>
            </div>

            {error && <div className="mx-5 mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{error}</div>}

            <div className="flex-1 overflow-y-auto scrollbar-none p-4 space-y-4">
              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading library…</div>
              ) : (
                groups.map((g) => (
                  <div key={g}>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">{g}</div>
                    <div className="space-y-2">
                      {items.filter((i) => i.group === g).map((it) => {
                        const isOpen = expanded === it.key;
                        return (
                          <div key={it.key} className="rounded-lg border border-border bg-background/40">
                            <div className="flex items-start gap-3 p-3">
                              <div className="flex-1 min-w-0">
                                <button type="button" onClick={() => setExpanded(isOpen ? null : it.key)} className="flex items-center gap-1.5 text-left">
                                  <ChevronDown className={`size-3.5 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                                  <span className="font-medium text-sm">{it.name}</span>
                                  <span className="text-[10px] text-muted-foreground shrink-0">· {it.subtasks.length} steps</span>
                                </button>
                                <p className="text-xs text-muted-foreground mt-1 ml-5">{it.description}</p>
                                <div className="flex flex-wrap gap-1.5 mt-1.5 ml-5">
                                  <span className="chip text-[10px] bg-secondary capitalize">{it.department.replace(/_/g, " ")}</span>
                                  <span className="chip text-[10px] bg-secondary capitalize">{it.priority}</span>
                                  <span className="chip text-[10px] bg-secondary">due +{it.dueOffsetDays}d</span>
                                </div>
                                {isOpen && (
                                  <ol className="mt-2 ml-5 space-y-1 list-decimal list-inside text-[11px] text-muted-foreground marker:text-brand-cyan">
                                    {it.subtasks.map((s, i) => <li key={i} className="leading-relaxed">{s}</li>)}
                                  </ol>
                                )}
                              </div>
                              {it.installed ? (
                                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><Check className="size-3.5" /> Added</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => install([it.key], it.key)}
                                  disabled={busyKey === it.key}
                                  className="shrink-0 btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50"
                                >
                                  {busyKey === it.key ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Add
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 border-t flex items-center justify-between bg-muted/30">
              <span className="text-xs text-muted-foreground">{missing.length} not yet added</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setOpen(false)} className="btn-ghost text-xs">Close</button>
                <button
                  type="button"
                  onClick={() => install(missing.map((m) => m.key), "__all__")}
                  disabled={busyKey === "__all__" || missing.length === 0}
                  className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {busyKey === "__all__" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add all missing
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
