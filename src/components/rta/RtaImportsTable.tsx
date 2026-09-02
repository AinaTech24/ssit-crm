"use client";

/**
 * Recent RTA uploads table — Recent / Trash tabs, row selection + select-all,
 * and bulk Move-to-trash / Recover / Delete-permanently. Soft-deleted rows move
 * to Trash (recoverable); permanent delete removes the history row only (the
 * imported transactions/folios are untouched).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Trash2, RotateCcw, RefreshCw } from "lucide-react";
import { RTA_FILE_TYPE_BY_KIND } from "@/lib/rta/file-types";
import { formatRelative, formatDate } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Row = {
  id: string;
  source: string;
  kind: string;
  period_start: string;
  period_end: string;
  file_name: string;
  status: string;
  rows_total: number | null;
  rows_imported: number | null;
  rows_skipped: number | null;
  rows_failed: number | null;
  created_at: string;
  uploaded_by_name: string | null;
  remarks: string | null;
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-50 text-emerald-700",
    partial: "bg-amber-50 text-amber-700",
    failed: "bg-rose-50 text-rose-700",
    rejected: "bg-gray-100 text-gray-600",
    parsing: "bg-blue-50 text-blue-700",
    uploaded: "bg-blue-50 text-blue-700",
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full ${map[status] ?? "bg-secondary text-muted-foreground"}`}>
      {status}
    </span>
  );
}

/**
 * A row is worth re-importing when the file is still stored AND something was
 * left on the table: rows skipped (a transaction feed that outran its folio
 * master), a hard failure, or an archive that no saved password opened at the
 * time. A completed import purges its own file, so there is nothing to re-read.
 */
function canReimport(r: Row): boolean {
  if (r.status === "completed" || r.status === "uploaded" || r.status === "parsing") return false;
  return (
    (r.rows_skipped ?? 0) > 0 ||
    (r.rows_failed ?? 0) > 0 ||
    r.status === "failed" ||
    r.status === "rejected" ||
    r.status === "partial"
  );
}

function reimportHint(r: Row): string {
  if (r.status === "rejected") return "Re-import — retries with every password saved since";
  if ((r.rows_skipped ?? 0) > 0) return `Re-import — retries the ${r.rows_skipped} skipped row(s)`;
  return "Re-import this file";
}

export function RtaImportsTable({ recent, trashed }: { recent: Row[]; trashed: Row[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"recent" | "trash">("recent");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [purgeIds, setPurgeIds] = useState<string[] | null>(null); // non-null = confirm open
  const [reimporting, setReimporting] = useState<string | null>(null);
  const [reimportMsg, setReimportMsg] = useState<string | null>(null);

  async function reimport(id: string) {
    setReimporting(id);
    setReimportMsg(null);
    try {
      const res = await fetch(`/api/rta-imports/${id}/reimport`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setReimportMsg(j.error ?? "Could not re-import this file"); return; }
      // The worker picks it up within a second or two; the in-flight poller
      // above then refreshes until it reaches a terminal state.
      setReimportMsg("Re-import queued — this row will update shortly.");
      router.refresh();
    } finally {
      setReimporting(null);
    }
  }

  // Live-refresh while any recent import is still in flight (uploaded/parsing) —
  // an auto-imported file lands as 'uploaded', then the worker parses it a few
  // seconds later. Poll the server data until every row reaches a terminal state
  // so the table doesn't sit on a stale "uploaded · 0 rows".
  useEffect(() => {
    const inFlight = recent.some((r) => r.status === "uploaded" || r.status === "parsing");
    if (!inFlight) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [recent, router]);

  const rows = tab === "recent" ? recent : trashed;

  function switchTab(t: "recent" | "trash") {
    setTab(t);
    setSel(new Set());
  }
  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function bulk(action: "trash" | "restore" | "purge", idsArg?: string[]) {
    const ids = idsArg ?? [...sel];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/rta-imports/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      if (res.ok) {
        setSel(new Set());
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => switchTab("recent")}
            className={`px-3 py-1.5 ${tab === "recent" ? "bg-brand-cyan text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
          >
            Recent uploads
          </button>
          <button
            onClick={() => switchTab("trash")}
            className={`px-3 py-1.5 border-l border-border inline-flex items-center gap-1.5 ${tab === "trash" ? "bg-brand-cyan text-white" : "bg-card text-muted-foreground hover:bg-secondary"}`}
          >
            <Trash2 className="size-3.5" /> Trash{trashed.length ? ` (${trashed.length})` : ""}
          </button>
        </div>

        {reimportMsg && (
          <div className="text-[11px] text-muted-foreground border rounded-md px-2.5 py-1.5 bg-secondary/40">
            {reimportMsg}
          </div>
        )}

        {sel.size > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{sel.size} selected</span>
            {tab === "recent" ? (
              <button onClick={() => bulk("trash")} disabled={busy} className="btn-secondary text-xs">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Move to trash
              </button>
            ) : (
              <button onClick={() => bulk("restore")} disabled={busy} className="btn-secondary text-xs">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Recover
              </button>
            )}
            <button
              onClick={() => setPurgeIds([...sel])}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> Delete permanently
            </button>
          </div>
        )}
      </div>

      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {tab === "recent"
              ? "No files imported yet. Click Upload RTA file above to start."
              : "Trash is empty."}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="w-8 px-4 py-2">
                    <input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} aria-label="Select all" />
                  </th>
                  <th className="text-left py-2 font-medium">When</th>
                  <th className="text-left py-2 font-medium">File</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">Source</th>
                  <th className="text-left py-2 font-medium">Period</th>
                  <th className="text-right py-2 font-medium">Rows</th>
                  <th className="text-left py-2 font-medium pl-4">Status</th>
                  <th className="text-left py-2 font-medium">By</th>
                  <th className="text-right py-2 font-medium pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-b last:border-0 hover:bg-accent/40 ${sel.has(r.id) ? "bg-brand-cyan-light/10" : ""}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="Select row" />
                    </td>
                    <td className="py-2.5 text-muted-foreground tabular-nums">{formatRelative(r.created_at)}</td>
                    <td className="py-2.5 font-medium truncate max-w-[18rem]" title={r.file_name}>
                      <Link href={`/dashboard/rta-imports/${r.id}`} className="text-brand-cyan-deep hover:underline">
                        {r.file_name}
                      </Link>
                    </td>
                    <td className="py-2.5 text-xs">
                      {RTA_FILE_TYPE_BY_KIND[r.kind as keyof typeof RTA_FILE_TYPE_BY_KIND]?.label ?? r.kind}
                    </td>
                    <td className="py-2.5 text-xs uppercase tracking-wide">{r.source}</td>
                    <td className="py-2.5 text-xs text-muted-foreground tabular-nums">
                      {formatDate(r.period_start)} → {formatDate(r.period_end)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      <span className="text-emerald-700 font-medium">{r.rows_imported ?? 0}</span>
                      {(r.rows_skipped ?? 0) > 0 && <span className="text-amber-700"> · {r.rows_skipped} skip</span>}
                      {(r.rows_failed ?? 0) > 0 && <span className="text-rose-700"> · {r.rows_failed} fail</span>}
                    </td>
                    <td className="py-2.5 pl-4">
                      <StatusBadge status={r.status} />
                      {r.remarks && (r.status === "failed" || r.status === "partial" || r.status === "rejected") && (
                        <div className="text-[11px] text-rose-600 mt-0.5 max-w-[20rem] truncate" title={r.remarks}>{r.remarks}</div>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">{r.uploaded_by_name ?? "—"}</td>
                    <td className="py-2.5 pr-4 text-right">
                      {tab === "recent" ? (
                        <>
                          {canReimport(r) && (
                            <button
                              onClick={() => reimport(r.id)}
                              disabled={busy || reimporting === r.id}
                              className="text-muted-foreground hover:text-brand-cyan p-1 disabled:opacity-50"
                              title={reimportHint(r)}
                              aria-label="Re-import this file"
                            >
                              {reimporting === r.id
                                ? <Loader2 className="size-3.5 animate-spin" />
                                : <RefreshCw className="size-3.5" />}
                            </button>
                          )}
                          <button onClick={() => bulk("trash", [r.id])} disabled={busy} className="text-muted-foreground hover:text-rose-600 p-1" title="Move to trash" aria-label="Move to trash">
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => bulk("restore", [r.id])} disabled={busy} className="text-muted-foreground hover:text-emerald-600 p-1" title="Recover" aria-label="Recover">
                          <RotateCcw className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={purgeIds !== null}
        title="Delete import records?"
        message={
          purgeIds
            ? `Permanently delete ${purgeIds.length} import record${purgeIds.length === 1 ? "" : "s"}? This cannot be undone. Your imported transactions and folios are kept — only the upload history rows are removed.`
            : undefined
        }
        confirmLabel="Delete permanently"
        tone="danger"
        busy={busy}
        onConfirm={async () => {
          const ids = purgeIds ?? [];
          await bulk("purge", ids);
          setPurgeIds(null);
        }}
        onCancel={() => setPurgeIds(null)}
      />
    </section>
  );
}
