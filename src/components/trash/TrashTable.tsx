"use client";

/**
 * Reusable Trash section+table for any soft-deleted entity (clients, tasks, …).
 *
 * Owns its collapsible card header (title · count on the left; Select-all and,
 * when rows are selected, bulk Restore / Delete on the RIGHT of the same title
 * bar) plus the table body (limited height, hidden scrollbar, sticky header).
 *
 * Data-only props (no functions) so a Server Component can render it: columns
 * are a declarative spec and the endpoints are `{id}` templates.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export type TrashColumn = {
  header: string;
  field: string;
  align?: "right";
  mono?: boolean;
  /** "primary" = bold with an optional muted sub-line (subField); "chip" = pill
   *  coloured by toneField ("rose" | "amber"); default = plain text. */
  kind?: "primary" | "chip";
  subField?: string;
  toneField?: string;
  truncate?: boolean;
};

export type TrashRow = { id: string; label: string } & Record<string, unknown>;

export function TrashTable({
  title,
  count,
  icon,
  defaultOpen = true,
  rows,
  columns,
  restoreTemplate,
  purgeTemplate,
  itemLabel,
  maxHeightClass = "max-h-[360px]",
  purgeButtonLabel = "Delete",
  purgeTitle,
  purgeMessage,
  purgeCta = "Delete forever",
}: {
  title: string;
  count: number;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  rows: TrashRow[];
  columns: TrashColumn[];
  /** e.g. "/api/investors/{id}/restore" */
  restoreTemplate: string;
  /** e.g. "/api/investors/{id}?purge=1" */
  purgeTemplate: string;
  itemLabel: string; // "client" / "task"
  maxHeightClass?: string;
  /** Copy overrides for the permanent-removal action (e.g. employees, where
   *  "purge" is really a safe offboard rather than an erase). */
  purgeButtonLabel?: string;
  purgeTitle?: string;
  purgeMessage?: string;
  purgeCta?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<null | "restore" | "purge">(null);
  const [confirmRowPurge, setConfirmRowPurge] = useState<TrashRow | null>(null);
  const [confirmBulkPurge, setConfirmBulkPurge] = useState(false);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const url = (tpl: string, id: string) => tpl.replace("{id}", id);

  async function restoreOne(r: TrashRow) {
    setBusyId(r.id);
    try {
      const res = await fetch(url(restoreTemplate, r.id), { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Failed (${res.status})`);
      toast.success(`${r.label} restored`);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't restore");
    } finally {
      setBusyId(null);
    }
  }

  async function purgeOne(r: TrashRow) {
    setBusyId(r.id);
    try {
      const res = await fetch(url(purgeTemplate, r.id), { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Failed (${res.status})`);
      toast.success(`${r.label} permanently deleted`);
      setConfirmRowPurge(null);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't delete");
    } finally {
      setBusyId(null);
    }
  }

  // Bulk — run the per-id endpoints sequentially so one failure doesn't abort
  // the rest; report a summary.
  async function runBulk(kind: "restore" | "purge") {
    const ids = rows.filter((r) => selected.has(r.id));
    if (ids.length === 0) return;
    setBulk(kind);
    let ok = 0;
    let fail = 0;
    for (const r of ids) {
      try {
        const res =
          kind === "restore"
            ? await fetch(url(restoreTemplate, r.id), { method: "POST" })
            : await fetch(url(purgeTemplate, r.id), { method: "DELETE" });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setBulk(null);
    setConfirmBulkPurge(false);
    setSelected(new Set());
    const verb = kind === "restore" ? "restored" : "permanently deleted";
    if (ok) toast.success(`${ok} ${itemLabel}${ok === 1 ? "" : "s"} ${verb}${fail ? ` · ${fail} failed` : ""}`);
    else toast.error(`Could not ${kind === "restore" ? "restore" : "delete"} — ${fail} failed`);
    router.refresh();
  }

  const cellText = (r: TrashRow, field: string) => {
    const v = r[field];
    return v == null || v === "" ? "—" : String(v);
  };

  return (
    <div className="card-surface overflow-hidden">
      {/* Title bar — title/count left, Select-all + bulk actions on the RIGHT */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 min-w-0 text-left hover:opacity-80"
        >
          {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
          {icon}
          <span className="font-semibold text-sm truncate">{title}</span>
          <span className="chip text-[11px] bg-secondary text-muted-foreground tabular-nums">{count}</span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          {someSelected && (
            <>
              <span className="text-xs text-muted-foreground hidden sm:inline">{selected.size} selected</span>
              <button
                onClick={() => runBulk("restore")}
                disabled={bulk !== null}
                className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50"
              >
                {bulk === "restore" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Restore
              </button>
              <button
                onClick={() => setConfirmBulkPurge(true)}
                disabled={bulk !== null}
                className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" /> {purgeButtonLabel}
              </button>
            </>
          )}
          <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-3.5 rounded" />
            Select all
          </label>
        </div>
      </div>

      {/* Limited-height, hidden-scrollbar body with a sticky header */}
      {open && (
        <div className={`${maxHeightClass} overflow-y-auto scrollbar-none`}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 w-8"></th>
                {columns.map((c) => (
                  <th key={c.field} className={`px-4 py-2.5 font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.header}</th>
                ))}
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b last:border-0 hover:bg-secondary/30 ${selected.has(r.id) ? "bg-brand-cyan-light/20" : ""}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} className="size-3.5 rounded" />
                  </td>
                  {columns.map((c) => (
                    <td key={c.field} className={`px-4 py-3 ${c.align === "right" ? "text-right tabular-nums" : ""} ${c.mono ? "font-mono text-xs" : ""}`}>
                      {c.kind === "primary" ? (
                        <div className={c.truncate ? "max-w-[26rem] truncate" : ""}>
                          <div className="font-medium">{cellText(r, c.field)}</div>
                          {c.subField && <div className="text-xs text-muted-foreground">{cellText(r, c.subField)}</div>}
                        </div>
                      ) : c.kind === "chip" ? (
                        <span
                          className={`chip text-[11px] font-medium border ${
                            r[c.toneField ?? ""] === "rose"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {cellText(r, c.field)}
                        </span>
                      ) : (
                        <span className={`${c.truncate ? "block max-w-[26rem] truncate" : ""} ${!c.mono ? "text-muted-foreground text-xs" : ""}`}>{cellText(r, c.field)}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => restoreOne(r)} disabled={busyId === r.id || bulk !== null} className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50">
                        {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Restore
                      </button>
                      <button
                        onClick={() => setConfirmRowPurge(r)}
                        disabled={busyId === r.id || bulk !== null}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        <Trash2 className="size-3.5" /> {purgeButtonLabel}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmRowPurge !== null}
        title={purgeTitle ?? "Delete permanently?"}
        message={purgeMessage ?? `This irreversibly erases ${confirmRowPurge?.label ?? `this ${itemLabel}`} and all of its data. This cannot be undone.`}
        confirmLabel={purgeCta}
        tone="danger"
        busy={busyId === confirmRowPurge?.id}
        onConfirm={() => confirmRowPurge && purgeOne(confirmRowPurge)}
        onCancel={() => setConfirmRowPurge(null)}
      />
      <ConfirmDialog
        open={confirmBulkPurge}
        title={purgeTitle ?? `Delete ${selected.size} ${itemLabel}${selected.size === 1 ? "" : "s"} permanently?`}
        message={purgeMessage ?? `This irreversibly erases the selected ${itemLabel}${selected.size === 1 ? "" : "s"} and all of their data. This cannot be undone.`}
        confirmLabel={purgeCta}
        tone="danger"
        busy={bulk === "purge"}
        onConfirm={() => runBulk("purge")}
        onCancel={() => setConfirmBulkPurge(false)}
      />
    </div>
  );
}
