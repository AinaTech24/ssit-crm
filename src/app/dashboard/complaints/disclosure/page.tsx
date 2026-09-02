import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, FileText } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { computeDisclosure, normalizeMonth } from "@/lib/complaints/disclosure";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

export const dynamic = "force-dynamic";

export default async function ComplaintDisclosurePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = normalizeMonth(sp.month, current);

  const d = await withTenant(session.tenantId, (tx) => computeDisclosure(tx, session.tenantId, month));

  // Reconciliation identity: start + received − resolved should equal end.
  const reconExpected = d.pendingStart + d.received - d.resolved;
  const reconOk = reconExpected === d.pendingEnd;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/complaints" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
            <ChevronLeft className="size-4" /> Back to complaint register
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mt-1">
            <FileText className="size-6 text-brand-cyan" /> Monthly complaint disclosure
          </h1>
          <p className="text-muted-foreground text-sm">
            SEBI-format statement — pending, received &amp; resolved for the month, by category &amp; source.
          </p>
        </div>
        <DownloadButton url={`/api/complaints/disclosure/export?month=${d.month}`} className="btn-secondary text-xs">
          <Download className="size-3.5" /> Export CSV
        </DownloadButton>
      </div>

      {/* Month picker */}
      <div className="flex items-center justify-center gap-4">
        <Link href={`/dashboard/complaints/disclosure?month=${d.prevMonth}`} className="btn-ghost text-sm inline-flex items-center gap-1">
          <ChevronLeft className="size-4" /> {d.prevMonth}
        </Link>
        <span className="text-lg font-bold tabular-nums">{d.label}</span>
        <Link href={`/dashboard/complaints/disclosure?month=${d.nextMonth}`} className="btn-ghost text-sm inline-flex items-center gap-1">
          {d.nextMonth} <ChevronRight className="size-4" />
        </Link>
      </div>

      {/* Headline statement */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Cell label="Pending at start" value={d.pendingStart} />
        <Cell label="Received in month" value={d.received} tone="sky" />
        <Cell label="Resolved in month" value={d.resolved} tone="emerald" />
        <Cell label="Pending at end" value={d.pendingEnd} tone={d.pendingEnd > 0 ? "amber" : "muted"} />
      </div>

      <div className={`text-xs rounded-md px-3 py-2 border ${reconOk ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
        Reconciliation: {d.pendingStart} (start) + {d.received} (received) − {d.resolved} (resolved) = {reconExpected}
        {reconOk ? " ✓ matches pending at end" : ` · pending-at-end is ${d.pendingEnd} (differs — re-opened/cross-month items)`}
      </div>

      {/* Breakdowns */}
      <div className="grid gap-3 md:grid-cols-2">
        <Breakdown title="Received by SEBI category" rows={d.byCategory} total={d.received} />
        <Breakdown title="Received by source" rows={d.bySource} total={d.received} />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Complaints carry a 21-day resolution SLA. This statement is the standard monthly disclosure to retain for
        SEBI/AMFI inspection; export the CSV for your records each month.
      </p>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: number; tone?: "sky" | "emerald" | "amber" | "muted" }) {
  const color = tone === "sky" ? "text-sky-600" : tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-3xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: Array<{ key: string; label: string; count: number }>; total: number }) {
  return (
    <div className="card-surface p-5">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None received this month.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
            return (
              <li key={r.key}>
                <div className="flex items-center justify-between text-sm mb-0.5">
                  <span>{r.label}</span>
                  <span className="font-bold tabular-nums">{r.count} <span className="text-xs text-muted-foreground font-normal">· {pct}%</span></span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-brand-cyan" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
