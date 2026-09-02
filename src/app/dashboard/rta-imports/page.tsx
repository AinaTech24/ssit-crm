/**
 * /dashboard/rta-imports — registry feed control room.
 *
 * For each file kind we know about, show:
 *   - Last successful upload (date, who uploaded it)
 *   - Next expected upload (computed from cadence)
 *   - "Late by N days" warning if past grace window
 *
 * Plus a recent-uploads history table and a single + button that opens the
 * upload dialog.
 */
import Link from "next/link";
import { sql } from "drizzle-orm";
import { FileText, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";
import {
  RTA_FILE_TYPES,
  RTA_FILE_TYPE_BY_KIND,
  nextExpectedDate,
  daysLate,
  cadenceLabel,
} from "@/lib/rta/file-types";
import { RtaUploadButton, RtaMailboxSyncButton } from "./client";
import { RtaImportsTable } from "@/components/rta/RtaImportsTable";

export const dynamic = "force-dynamic";

export default async function RtaImportsPage() {
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    // Latest successful import per kind
    const latest = await tx.execute(sql`
      SELECT DISTINCT ON (kind)
        kind, source, period_end, status, parsed_at, rows_imported, rows_skipped, created_at, file_name
      FROM rta_file_imports
      WHERE status IN ('completed', 'partial') AND deleted_at IS NULL
      ORDER BY kind, period_end DESC, created_at DESC
    `);

    // Recent history (last 30 imports across all kinds)
    const recent = await tx.execute(sql`
      SELECT
        rfi.id, rfi.source, rfi.kind, rfi.period_start, rfi.period_end,
        rfi.file_name, rfi.status, rfi.rows_total, rfi.rows_imported,
        rfi.rows_skipped, rfi.rows_failed, rfi.created_at, rfi.parsed_at, rfi.remarks,
        u.name AS uploaded_by_name
      FROM rta_file_imports rfi
      LEFT JOIN users u ON u.id = rfi.uploaded_by
      WHERE rfi.deleted_at IS NULL
      ORDER BY rfi.created_at DESC
      LIMIT 30
    `);

    // Trash — soft-deleted import records, recoverable.
    const trashed = await tx.execute(sql`
      SELECT
        rfi.id, rfi.source, rfi.kind, rfi.period_start, rfi.period_end,
        rfi.file_name, rfi.status, rfi.rows_total, rfi.rows_imported,
        rfi.rows_skipped, rfi.rows_failed, rfi.created_at, rfi.parsed_at, rfi.remarks,
        rfi.deleted_at, u.name AS uploaded_by_name
      FROM rta_file_imports rfi
      LEFT JOIN users u ON u.id = rfi.uploaded_by
      WHERE rfi.deleted_at IS NOT NULL
      ORDER BY rfi.deleted_at DESC
      LIMIT 20
    `);

    return {
      latestByKind: new Map((latest.rows as any[]).map((r) => [r.kind, r])),
      recent: recent.rows as any[],
      trashed: trashed.rows as any[],
    };
  });

  const now = new Date();
  const tiles = RTA_FILE_TYPES.map((t) => {
    const last = data.latestByKind.get(t.kind);
    const lastDate = last?.period_end ? new Date(last.period_end) : null;
    const nextExpected = nextExpectedDate(t.cadence, lastDate, now);
    const late = daysLate(t.cadence, lastDate, t.graceDays, now);
    return {
      ...t,
      last,
      lastDate,
      nextExpected,
      late,
    };
  });

  // Summary counters.
  const totalConfigured = RTA_FILE_TYPES.length;
  const upToDateCount = tiles.filter((t) => t.last && t.late === 0).length;
  const lateCount = tiles.filter((t) => t.late > 0).length;
  const actionableRecent = data.recent.filter((row) => row.status !== "rejected");
  const failedImports = actionableRecent.filter((row) => row.status === "failed").length;
  const processedRows = actionableRecent.reduce((sum, row) => sum + Number(row.rows_total ?? 0), 0);
  const exceptionRows = actionableRecent.reduce((sum, row) => sum + Number(row.rows_failed ?? 0) + Number(row.rows_skipped ?? 0), 0);
  const exceptionRate = processedRows > 0 ? exceptionRows / processedRows : 0;
  const freshnessScore = totalConfigured > 0 ? upToDateCount / totalConfigured : 0;
  const reliabilityScore = actionableRecent.length > 0 ? 1 - failedImports / actionableRecent.length : 0;
  const qualityScore = Math.max(0, 1 - exceptionRate);
  const trustScore = Math.round((freshnessScore * 0.55 + reliabilityScore * 0.25 + qualityScore * 0.2) * 100);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <FileText className="size-6 text-brand-cyan" /> RTA file imports
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RtaMailboxSyncButton />
          <RtaUploadButton />
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryTile
          label="Data trust score"
          value={`${trustScore}%`}
          sub={trustScore >= 90 ? "healthy for client reporting" : trustScore >= 70 ? "review freshness or exceptions" : "do not rely on downstream totals yet"}
          tone={trustScore >= 90 ? "emerald" : trustScore >= 70 ? "muted" : "rose"}
        />
        <SummaryTile
          label="File types configured"
          value={String(totalConfigured)}
          sub="across all registrars"
          tone="muted"
        />
        <SummaryTile
          label="Up to date"
          value={`${upToDateCount} / ${totalConfigured}`}
          sub="received on schedule"
          tone="emerald"
        />
        <SummaryTile
          label="Late"
          value={String(lateCount)}
          sub={lateCount > 0 ? "needs your attention" : "all clear"}
          tone={lateCount > 0 ? "rose" : "emerald"}
        />
        <SummaryTile
          label="Row exceptions"
          value={exceptionRows.toLocaleString("en-IN")}
          sub={processedRows ? `${(exceptionRate * 100).toFixed(1)}% of ${processedRows.toLocaleString("en-IN")} rows` : "no rows processed yet"}
          tone={exceptionRate > 0.05 ? "rose" : exceptionRows > 0 ? "muted" : "emerald"}
        />
      </div>

      {/* Per-file-kind tiles */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
          File types and last upload
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {tiles.map((t) => (
            <FileKindTile key={t.kind} t={t} />
          ))}
        </div>
      </section>

      {/* Recent uploads + Trash (select / select-all / move-to-trash / recover /
          delete permanently) — client-side table. */}
      <RtaImportsTable recent={data.recent as any[]} trashed={data.trashed as any[]} />
    </div>
  );
}

function FileKindTile({ t }: { t: (typeof RTA_FILE_TYPES)[number] & { last: any; lastDate: Date | null; nextExpected: Date | null; late: number } }) {
  const status: "fresh" | "late" | "missing" =
    !t.last ? "missing" : t.late > 0 ? "late" : "fresh";
  const ringCls =
    status === "fresh"
      ? "border-emerald-200"
      : status === "late"
        ? "border-rose-300"
        : "border-amber-200";

  return (
    <div className={`card-elevated p-4 border ${ringCls}`}>
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-lg bg-brand-cyan-light text-brand-cyan-deep grid place-items-center flex-shrink-0">
          <FileText className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{t.label}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            {t.short}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <Field label="Cadence" value={cadenceLabel(t.cadence)} />
        <Field
          label="Last received"
          value={t.last ? formatRelative(t.last.created_at) : "Never"}
          tone={t.last ? "default" : "muted"}
        />
        <Field
          label="Period"
          value={t.last ? formatDate(t.last.period_end) : "—"}
        />
        <Field
          label="Next expected"
          value={t.nextExpected ? formatDate(t.nextExpected) : "Ad-hoc"}
          tone={status === "late" ? "rose" : "default"}
        />
      </div>

      {status === "late" && (
        <div className="mt-3 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800 flex items-center gap-2">
          <AlertTriangle className="size-3.5 flex-shrink-0" />
          <span>
            <strong>{t.late} day{t.late === 1 ? "" : "s"} late.</strong> Upload to keep dashboards accurate.
          </span>
        </div>
      )}
      {status === "missing" && t.cadence.every !== "adhoc" && (
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
          <Clock className="size-3.5 flex-shrink-0" />
          <span>Not yet received. Upload your first file to populate downstream data.</span>
        </div>
      )}
      {status === "fresh" && (
        <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="size-3.5 flex-shrink-0" />
          <span>
            Up to date · {t.last.rows_imported ?? 0} rows imported
            {(t.last.rows_skipped ?? 0) > 0 ? ` · ${t.last.rows_skipped} skipped` : ""}.
          </span>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "rose" | "muted";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`font-medium ${tone === "rose" ? "text-rose-700" : tone === "muted" ? "text-muted-foreground" : ""
          }`}
      >
        {value}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "muted" | "emerald" | "rose";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "rose"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-secondary/40 text-muted-foreground border-border";
  return (
    <div className={`card-elevated p-4 border ${cls}`}>
      <div className="text-xs uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
      <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-50 text-emerald-700",
    partial: "bg-amber-50 text-amber-700",
    failed: "bg-rose-50 text-rose-700",
    parsing: "bg-blue-50 text-blue-700",
    uploaded: "bg-blue-50 text-blue-700",
    // "rejected" is the not-ours case (an archive encrypted with another
    // platform's password). Routine and unactionable, so it reads neutral —
    // showing it in red buried the failures that DO need attention.
    rejected: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full ${map[status] ?? "bg-secondary text-muted-foreground"}`}>
      {status === "rejected" ? "not ours" : status}
    </span>
  );
}
