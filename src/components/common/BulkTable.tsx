"use client";

/**
 * BulkTable — a generic selectable table with a bulk-action toolbar.
 *
 * A client island used by list views that need row selection + bulk operations
 * (delete / set status / reassign). The owning module supplies the column
 * renderers, the POST endpoint, and which bulk actions to expose; this component
 * owns selection state, the toolbar, the confirm dialog and the fetch.
 *
 * The bulk endpoint contract matches the other /bulk routes:
 *   POST <endpoint>  body { ids: string[], action: string, value?: string|null }
 */

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export type BulkColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  thClass?: string;
  tdClass?: string;
  /** Emitted as `data-col` on the <th>/<td> so a <ColumnManager> can show/hide it. */
  colKey?: string;
};

export type BulkAction =
  | { kind: "delete"; label?: string }
  | { kind: "status"; label: string; options: [value: string, label: string][] }
  | { kind: "assign"; label: string; options: { value: string; label: string }[] };

export function BulkTable<T extends { id: string }>({
  rows,
  columns,
  endpoint,
  actions,
  itemLabel = "item",
  tableKey,
  scrollBody = false,
  onRowClick,
  rowHref,
}: {
  rows: T[];
  columns: BulkColumn<T>[];
  endpoint: string;
  actions: BulkAction[];
  itemLabel?: string;
  /** Emitted as `data-table` on the <table> so a <ColumnManager> can target it. */
  tableKey?: string;
  /** Fixed-height scroll body (hidden scrollbar + sticky header) for long tables. */
  scrollBody?: boolean;
  /** Make rows clickable — runs this callback (e.g. open a preview modal). */
  onRowClick?: (row: T) => void;
  /** Make rows clickable — navigates to this href (e.g. a detail page). */
  rowHref?: (row: T) => string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picker, setPicker] = useState<null | "status" | "assign">(null);
  const [pickVal, setPickVal] = useState("");

  const statusAction = actions.find((a) => a.kind === "status") as Extract<BulkAction, { kind: "status" }> | undefined;
  const assignAction = actions.find((a) => a.kind === "assign") as Extract<BulkAction, { kind: "assign" }> | undefined;
  const deleteAction = actions.find((a) => a.kind === "delete") as Extract<BulkAction, { kind: "delete" }> | undefined;

  const allSel = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  async function apply(action: string, value?: string | null) {
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action, value: value ?? null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Request failed (HTTP ${res.status})`, "Bulk action failed");
        return;
      }
      toast.success(`Updated ${selected.size} ${itemLabel}${selected.size === 1 ? "" : "s"}`);
      setSelected(new Set());
      setPicker(null);
      setPickVal("");
      setConfirmDelete(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Bulk action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-4 py-2 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          {statusAction && (
            <button
              type="button"
              onClick={() => { setPicker((p) => (p === "status" ? null : "status")); setPickVal(""); }}
              className="btn-ghost text-xs"
            >
              {statusAction.label}
            </button>
          )}
          {assignAction && (
            <button
              type="button"
              onClick={() => { setPicker((p) => (p === "assign" ? null : "assign")); setPickVal(""); }}
              className="btn-ghost text-xs"
            >
              {assignAction.label}
            </button>
          )}
          {deleteAction && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="btn-ghost text-xs text-destructive inline-flex items-center gap-1"
            >
              <Trash2 className="size-3.5" /> {deleteAction.label ?? "Delete"}
            </button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Clear selection">
            <X className="size-4" />
          </button>
        </div>
      )}

      {picker && selected.size > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-secondary/20 px-4 py-2">
          <select value={pickVal} onChange={(e) => setPickVal(e.target.value)} className="input-base text-xs">
            <option value="">— choose —</option>
            {picker === "status" && statusAction!.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {picker === "assign" && assignAction!.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            type="button"
            disabled={!pickVal || busy}
            onClick={() => apply(picker, pickVal)}
            className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-3 animate-spin" />} Apply to {selected.size}
          </button>
        </div>
      )}

      <div className="table-scroll">
        <table className="w-full text-sm" data-table={tableKey}>
          <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
            <tr>
              <th className="w-8 px-4 py-2">
                <input type="checkbox" checked={allSel} onChange={toggleAll} className="size-3.5 rounded" aria-label="Select all" />
              </th>
              {columns.map((c) => (
                <th key={c.key} data-col={c.colKey} className={c.thClass ?? "text-left py-2 font-medium"}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const sel = selected.has(row.id);
              const clickable = !!(onRowClick || rowHref);
              // Ignore clicks that land on an interactive element (checkbox, the
              // row's own links/buttons/menus) so row-navigation never hijacks them.
              const handleRowClick = (e: React.MouseEvent) => {
                if (!clickable) return;
                if ((e.target as HTMLElement).closest("a, button, input, select, [role='menu'], [data-no-row-nav]")) return;
                if (onRowClick) onRowClick(row);
                else if (rowHref) router.push(rowHref(row));
              };
              return (
                <tr
                  key={row.id}
                  onClick={handleRowClick}
                  className={`border-b last:border-0 transition-colors ${sel ? "bg-brand-cyan-light/30" : "hover:bg-brand-cyan-light/20"} ${clickable ? "cursor-pointer" : ""}`}
                >
                  <td className="px-4 py-2.5">
                    <input type="checkbox" checked={sel} onChange={() => toggle(row.id)} className="size-3.5 rounded" aria-label="Select row" />
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} data-col={c.colKey} className={c.tdClass ?? "py-2.5"}>{c.render(row)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${selected.size} ${itemLabel}${selected.size === 1 ? "" : "s"}?`}
        message="This removes the selected records. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={() => apply("delete")}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
