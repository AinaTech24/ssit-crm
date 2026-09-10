"use client";

/**
 * Activity tracker — the shared client for both flavours.
 *
 * Marketing logs items produced (post / flyer / video) for an event; Research
 * logs what was studied and on what topic. The columns differ by a field or
 * two, so this is one component parameterised by `kind` rather than two that
 * drift apart.
 *
 * Attachments live on the saved row, so the form creates the entry first and
 * the row's expander is where files are added — the same EntityAttachments the
 * meetings and tasks modules use.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Paperclip, Check, RefreshCw, Trash2, ChevronRight } from "lucide-react";
import { DateField } from "@/components/ui/DateField";
import { RmSelector } from "@/components/common/RmSelector";
import { EntityAttachments } from "@/components/common/EntityAttachments";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";
import {
  TRACKER_ITEM_TYPES,
  formatTrackerItems,
  type TrackerItem,
  type TrackerKind,
} from "@/db/schema/activity_entries";

type Row = {
  id: string;
  kind: string;
  title: string;
  itemType: string | null;
  items: TrackerItem[] | null;
  eventName: string | null;
  topic: string | null;
  createdFor: string | null;
  notes: string | null;
  assignedByUserId: string | null;
  assignerName: string | null;
  ownerName: string | null;
  assignedDate: string | null;
  completedDate: string | null;
  status: string;
  attachments: number;
};

const STATUS_TONE: Record<string, string> = {
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-600",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  const x = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return isNaN(x.getTime()) ? "—" : x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function ActivityTracker({ kind }: { kind: TrackerKind }) {
  const toast = useToast();
  const isResearch = kind === "research";
  const itemTypes = TRACKER_ITEM_TYPES[kind];

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const blank = useMemo(
    () => ({
      title: "",
      // Nothing pre-ticked: the old dropdown defaulted to "Post", which quietly
      // tagged every entry as a post unless the user noticed and changed it.
      picked: {} as Record<string, { on: boolean; qty: string }>,
      otherLabel: "",
      eventName: "",
      topic: "",
      createdFor: "",
      notes: "",
      assignedByUserId: null as string | null,
      assignedDate: todayISO(),
      completedDate: "",
    }),
    [itemTypes]
  );
  const [form, setForm] = useState(blank);

  /** Ticked rows, in catalogue order, as the API's item shape. */
  function selectedItems(f: typeof blank): TrackerItem[] {
    return itemTypes
      .filter((t) => f.picked[t.value]?.on)
      .map((t) => ({
        type: t.value,
        // "Other" carries the user's own name for the thing; everything else
        // takes its label from the catalogue at render time.
        label: t.value === "other" ? f.otherLabel.trim() || undefined : undefined,
        qty: Math.max(1, Math.min(9999, Number(f.picked[t.value]?.qty || "1") || 1)),
      }));
  }

  function toggleItem(value: string, on: boolean) {
    setForm((s0) => ({
      ...s0,
      picked: { ...s0.picked, [value]: { on, qty: s0.picked[value]?.qty ?? "1" } },
    }));
  }

  function setQty(value: string, qty: string) {
    // Digits only — a spinner that accepts "e" or "-" is a bug waiting to be filed.
    const clean = qty.replace(/[^0-9]/g, "").slice(0, 4);
    setForm((s0) => ({
      ...s0,
      picked: { ...s0.picked, [value]: { on: s0.picked[value]?.on ?? true, qty: clean } },
    }));
  }

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      setError(null);
      try {
        const res = await fetch(`/api/activity-entries?kind=${kind}`, { cache: "no-store" });
        if (!res.ok) {
          const f = await readApiError(res, "load the activity tracker");
          setError(f.message);
          if (!opts?.silent) toast.error(f.message);
          return;
        }
        const j = await res.json();
        setRows(Array.isArray(j.rows) ? j.rows : []);
      } catch (e) {
        const f = readThrownError(e, "load the activity tracker");
        setError(f.message);
        if (!opts?.silent) toast.error(f.message);
      }
    },
    [kind, toast]
  );

  useEffect(() => {
    void load({ silent: true });
  }, [load]);

  async function save() {
    if (!form.title.trim()) {
      toast.error("Give the entry a title.");
      return;
    }
    const items = selectedItems(form);
    if (items.length === 0) {
      toast.error(isResearch ? "Tick at least one output." : "Tick at least one item.");
      return;
    }
    if (items.some((i) => i.type === "other" && !i.label)) {
      toast.error("Name the item you ticked under Other.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/activity-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          title: form.title.trim(),
          items,
          eventName: form.eventName || null,
          topic: isResearch ? form.topic || null : null,
          createdFor: form.createdFor || null,
          notes: form.notes || null,
          assignedByUserId: form.assignedByUserId,
          assignedDate: form.assignedDate || null,
          completedDate: form.completedDate || null,
        }),
      });
      if (!res.ok) {
        const f = await readApiError(res, "save the entry");
        toast.error(f.message);
        return;
      }
      const created = await res.json();
      setForm(blank);
      setShowForm(false);
      await load({ silent: true });
      // Open it straight away — attaching the file is the next thing you do.
      setOpen((o) => ({ ...o, [created.id]: true }));
      toast.success("Entry logged — add the files below.");
    } catch (e) {
      toast.error(readThrownError(e, "save the entry").message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, what: string) {
    try {
      const res = await fetch(`/api/activity-entries/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error((await readApiError(res, what)).message);
        return;
      }
      await load({ silent: true });
    } catch (e) {
      toast.error(readThrownError(e, what).message);
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/activity-entries/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error((await readApiError(res, "delete the entry")).message);
        return;
      }
      await load({ silent: true });
      toast.success("Entry removed");
    } catch (e) {
      toast.error(readThrownError(e, "delete the entry").message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {isResearch
            ? "What you researched, on what topic, and what came out of it."
            : "What you produced, who asked for it, and which event it was for."}
        </p>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary text-sm inline-flex items-center gap-1.5">
          <Plus className="size-4" /> Log {isResearch ? "research" : "item"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 text-destructive px-3 py-2 text-xs flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => void load()} className="shrink-0 inline-flex items-center gap-1 font-medium underline hover:no-underline">
            <RefreshCw className="size-3" /> Retry
          </button>
        </div>
      )}

      {showForm && (
        <div className="card-surface p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <div className="text-xs font-medium mb-1">Title *</div>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={isResearch ? "e.g. Small-cap valuation review" : "e.g. Diwali campaign flyer"}
                className="input-base w-full"
              />
            </label>
            {/* One entry usually covers several artefacts — three posts AND two
                flyers — so this is a multi-select with a count per line rather
                than a dropdown that forces one row per thing. */}
            <div className="block">
              <div className="text-xs font-medium mb-1">
                {isResearch ? "Outputs" : "Items"}
                <span className="ml-1 text-[10px] text-muted-foreground font-normal">· tick what you produced, and how many</span>
              </div>
              <div className="rounded-md border divide-y">
                {itemTypes.map((t) => {
                  const st = form.picked[t.value];
                  const on = !!st?.on;
                  return (
                    <div key={t.value} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input
                          id={`item-${kind}-${t.value}`}
                          type="checkbox"
                          checked={on}
                          onChange={(e) => toggleItem(t.value, e.target.checked)}
                          className="size-4 accent-brand-cyan-deep"
                        />
                        <label htmlFor={`item-${kind}-${t.value}`} className="text-sm flex-1 cursor-pointer select-none">
                          {t.label}
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={st?.qty ?? ""}
                          onChange={(e) => setQty(t.value, e.target.value)}
                          onFocus={() => { if (!on) toggleItem(t.value, true); }}
                          disabled={!on}
                          placeholder="1"
                          aria-label={`How many ${t.label}`}
                          className="input-base w-16 text-center py-1 disabled:opacity-40"
                        />
                      </div>
                      {/* Naming the thing is what makes "Other" countable later. */}
                      {t.value === "other" && on && (
                        <input
                          value={form.otherLabel}
                          onChange={(e) => setForm({ ...form, otherLabel: e.target.value })}
                          placeholder="Name the item — e.g. Standee, Hoarding"
                          aria-label="Name of the other item"
                          className="input-base w-full mt-2 py-1"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {isResearch ? (
              <label className="block">
                <div className="text-xs font-medium mb-1">Topic</div>
                <input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="e.g. Banking sector" className="input-base w-full" />
              </label>
            ) : (
              <label className="block">
                <div className="text-xs font-medium mb-1">Event name</div>
                <input value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} placeholder="e.g. Diwali 2026" className="input-base w-full" />
              </label>
            )}
            <div>
              <div className="text-xs font-medium mb-1">Assigned by (RM)</div>
              <RmSelector
                value={form.assignedByUserId}
                onChange={(id) => setForm({ ...form, assignedByUserId: id })}
                placeholder="— Self-initiated —"
              />
            </div>
            <label className="block">
              <div className="text-xs font-medium mb-1">Created for</div>
              <input value={form.createdFor} onChange={(e) => setForm({ ...form, createdFor: e.target.value })} placeholder="client, branch or campaign" className="input-base w-full" />
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Assigned date</div>
              <DateField value={form.assignedDate} onChange={(e) => setForm({ ...form, assignedDate: e.target.value })} className="w-full" />
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Completed date</div>
              <DateField value={form.completedDate} onChange={(e) => setForm({ ...form, completedDate: e.target.value })} className="w-full" />
            </label>
            <label className="block sm:col-span-2">
              <div className="text-xs font-medium mb-1">Notes</div>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="input-base w-full text-xs" />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <button onClick={() => { setShowForm(false); setForm(blank); }} className="btn-secondary text-xs">Cancel</button>
            <button onClick={save} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Save entry
            </button>
          </div>
        </div>
      )}

      <div className="card-surface overflow-hidden">
        {rows == null ? (
          <div className="p-8 text-center text-sm text-muted-foreground inline-flex items-center gap-2 justify-center w-full">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Nothing logged yet. Use <b>Log {isResearch ? "research" : "item"}</b> to add the first entry.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 pl-3 font-medium">{isResearch ? "Research" : "Item"}</th>
                  <th className="text-left py-2 font-medium">{isResearch ? "Topic" : "Event"}</th>
                  <th className="text-left py-2 font-medium">Assigned by</th>
                  <th className="text-left py-2 font-medium">Created for</th>
                  <th className="text-left py-2 font-medium">Assigned</th>
                  <th className="text-left py-2 font-medium">Completed</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 align-top">
                    <td className="py-2 pl-3" colSpan={8}>
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}
                          className="mt-0.5 shrink-0 rounded p-0.5 hover:bg-accent"
                          aria-expanded={!!open[r.id]}
                          title="Files and notes"
                        >
                          <ChevronRight className={`size-4 transition-transform ${open[r.id] ? "rotate-90" : ""}`} />
                        </button>
                        <div className="min-w-0 flex-1 grid grid-cols-2 md:grid-cols-7 gap-x-3 gap-y-1 items-center">
                          <div className="md:col-span-1 min-w-0">
                            <div className="font-medium truncate">{r.title}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {formatTrackerItems(r.items, r.itemType)}
                              {r.attachments > 0 && (
                                <span className="ml-1 inline-flex items-center gap-0.5">
                                  <Paperclip className="size-3" />{r.attachments}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-xs truncate">{(isResearch ? r.topic : r.eventName) ?? "—"}</div>
                          <div className="text-xs truncate">{r.assignerName ?? "—"}</div>
                          <div className="text-xs truncate">{r.createdFor ?? "—"}</div>
                          <div className="text-xs">{fmt(r.assignedDate)}</div>
                          <div className="text-xs">{fmt(r.completedDate)}</div>
                          <div className="flex items-center gap-1.5">
                            <span className={`chip text-[10px] ${STATUS_TONE[r.status] ?? ""}`}>
                              {r.status.replace("_", " ")}
                            </span>
                            {r.status !== "completed" && (
                              <button
                                type="button"
                                onClick={() => patch(r.id, { status: "completed" }, "mark it complete")}
                                title="Mark complete (fills today's date)"
                                className="text-muted-foreground hover:text-emerald-600"
                              >
                                <Check className="size-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => remove(r.id)}
                              title="Delete entry"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {open[r.id] && (
                        <div className="mt-2 ml-7 mb-1 rounded-md border border-border bg-secondary/30 p-3 space-y-3">
                          {r.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{r.notes}</p>}
                          <EntityAttachments
                            basePath={`/api/activity-entries/${r.id}/attachments`}
                            label={isResearch ? "Research files" : "Creatives"}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
