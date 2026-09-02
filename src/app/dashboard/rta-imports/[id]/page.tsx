/**
 * /dashboard/rta-imports/[id] — single RTA import detail.
 *
 * Drill-down from the recent-uploads table: the rich reconciliation summary
 * (investors/folios created vs updated, schemes, AUM, per-AMC breakdown) for
 * master/holdings imports, plus a row-level error list with a CSV download.
 * Feed imports (no summary) fall back to the raw row counters.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowLeft, FileText } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatINR, formatRelative } from "@/lib/utils";
import { RTA_FILE_TYPE_BY_KIND } from "@/lib/rta/file-types";
import { DownloadErrorsButton } from "@/components/rta/DownloadErrorsButton";

export const dynamic = "force-dynamic";

type ImportRow = {
  id: string;
  source: string;
  kind: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  rows_total: number | null;
  rows_imported: number | null;
  rows_skipped: number | null;
  rows_failed: number | null;
  errors: { row: number; reason: string }[] | null;
  summary: Record<string, any> | null;
  remarks: string | null;
  file_name: string;
  parsed_at: string | null;
  created_at: string;
  uploaded_by_name: string | null;
};

export default async function RtaImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();

  const row = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        rfi.id, rfi.source, rfi.kind, rfi.status,
        rfi.period_start, rfi.period_end,
        rfi.rows_total, rfi.rows_imported, rfi.rows_skipped, rfi.rows_failed,
        rfi.errors, rfi.summary, rfi.remarks, rfi.file_name,
        rfi.parsed_at, rfi.created_at,
        u.name AS uploaded_by_name
      FROM rta_file_imports rfi
      LEFT JOIN users u ON u.id = rfi.uploaded_by
      WHERE rfi.id = ${id}::uuid
      LIMIT 1
    `);
    return (r.rows[0] as ImportRow | undefined) ?? null;
  });

  if (!row) notFound();

  const kindLabel =
    RTA_FILE_TYPE_BY_KIND[row.kind as keyof typeof RTA_FILE_TYPE_BY_KIND]
      ?.label ?? row.kind;

  const summary = row.summary;
  const errors = row.errors ?? [];

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <Link
          href="/dashboard/rta-imports"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to RTA imports
        </Link>
      </div>

      {/* Header */}
      <div className="card-surface p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="size-10 rounded-lg bg-brand-cyan-light text-brand-cyan-deep grid place-items-center flex-shrink-0">
              <FileText className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold truncate" title={row.file_name}>
                {row.file_name}
              </h1>
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="uppercase tracking-wide">{row.source}</span>
                <span>·</span>
                <span>{kindLabel}</span>
                <span>·</span>
                <span className="tabular-nums">
                  {formatDate(row.period_start)} → {formatDate(row.period_end)}
                </span>
              </div>
            </div>
          </div>
          <StatusChip status={row.status} />
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <Meta label="Uploaded" value={formatRelative(row.created_at)} />
          <Meta
            label="Parsed"
            value={row.parsed_at ? formatRelative(row.parsed_at) : "—"}
          />
          <Meta label="By" value={row.uploaded_by_name ?? "—"} />
        </div>

        {row.remarks && (
          <div className="mt-4 rounded-lg bg-secondary/40 border border-border px-3 py-2 text-xs text-muted-foreground">
            {row.remarks}
          </div>
        )}
      </div>

      {/* Reconciliation */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Reconciliation
        </h2>
        {summary ? (
          <Reconciliation summary={summary} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile label="Rows total" value={fmtNum(row.rows_total)} tone="muted" />
            <KpiTile label="Imported" value={fmtNum(row.rows_imported)} tone="emerald" />
            <KpiTile label="Skipped" value={fmtNum(row.rows_skipped)} tone="amber" />
            <KpiTile label="Failed" value={fmtNum(row.rows_failed)} tone="rose" />
          </div>
        )}
      </section>

      {/* Errors */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Errors {errors.length > 0 && <span>({errors.length})</span>}
          </h2>
          {errors.length > 0 && (
            <DownloadErrorsButton fileName={row.file_name} errors={errors} />
          )}
        </div>
        {errors.length === 0 ? (
          // An empty error list does NOT mean success. A file that was never
          // opened (wrong ZIP password → 'rejected') or that the parser could
          // not read ('failed') records no per-row errors, and this panel used
          // to greet both with "All rows imported cleanly ✓" — directly
          // contradicting the red status badge at the top of the same page.
          row.status === "rejected" || row.status === "failed" ? (
            <div className="card-surface p-8 text-center text-sm text-muted-foreground">
              No rows were processed — the file was never read, so there is
              nothing to report here. See the status note above for the reason.
            </div>
          ) : (
            <div className="card-surface p-8 text-center text-sm text-emerald-700">
              All rows imported cleanly ✓
            </div>
          )
        ) : (
          <div className="card-surface overflow-hidden">
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium w-24">Row #</th>
                    <th className="text-left py-2 font-medium pr-4">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e, i) => (
                    <tr
                      key={`${e.row}-${i}`}
                      className="border-b last:border-0 hover:bg-accent/40"
                    >
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {e.row}
                      </td>
                      <td className="py-2.5 pr-4">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Reconciliation({ summary }: { summary: Record<string, any> }) {
  const inv = summary.investors ?? {};
  const fol = summary.folios ?? {};
  const amcs: Array<{ code?: string; name?: string; folios?: number }> =
    Array.isArray(summary.amcs) ? summary.amcs : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiTile label="Investors created" value={fmtNum(inv.created)} tone="emerald" />
        <KpiTile label="Investors updated" value={fmtNum(inv.updated)} tone="muted" />
        <KpiTile label="Minors" value={fmtNum(inv.minors)} tone="muted" />
        <KpiTile label="Folios created" value={fmtNum(fol.created)} tone="emerald" />
        <KpiTile label="Folios updated" value={fmtNum(fol.updated)} tone="muted" />
        <KpiTile label="Folios skipped (no PAN)" value={fmtNum(fol.skippedNoPan)} tone="amber" />
        <KpiTile label="Schemes" value={fmtNum(summary.schemes)} tone="muted" />
        {summary.aum != null && (
          <KpiTile label="AUM" value={formatINR(summary.aum)} tone="cyan" />
        )}
      </div>

      {amcs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            AMC breakdown
          </h3>
          <div className="card-surface overflow-hidden">
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium w-28">Code</th>
                    <th className="text-left py-2 font-medium">AMC</th>
                    <th className="text-right py-2 font-medium pr-4">Folios</th>
                  </tr>
                </thead>
                <tbody>
                  {amcs.map((a, i) => (
                    <tr
                      key={`${a.code ?? a.name ?? i}`}
                      className="border-b last:border-0 hover:bg-accent/40"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {a.code ?? "—"}
                      </td>
                      <td className="py-2.5">{a.name ?? "—"}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {fmtNum(a.folios)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtNum(n: number | null | undefined): string {
  return n == null ? "—" : new Intl.NumberFormat("en-IN").format(n);
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-medium mt-0.5">{value}</div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "muted" | "emerald" | "amber" | "rose" | "cyan";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "amber"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : tone === "rose"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : tone === "cyan"
      ? "bg-brand-cyan-light text-brand-cyan-deep border-border"
      : "bg-secondary/40 text-muted-foreground border-border";
  return (
    <div className={`card-elevated p-4 border ${cls}`}>
      <div className="text-[11px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-50 text-emerald-700",
    partial: "bg-amber-50 text-amber-700",
    failed: "bg-rose-50 text-rose-700",
    parsing: "bg-blue-50 text-blue-700",
    uploaded: "bg-blue-50 text-blue-700",
    rejected: "bg-rose-50 text-rose-700",
  };
  return (
    <span
      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
        map[status] ?? "bg-secondary text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}
