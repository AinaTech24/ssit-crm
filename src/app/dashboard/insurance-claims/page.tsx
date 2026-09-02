import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { FileText, Plus, IndianRupee, CheckCircle2, XCircle, Clock } from "lucide-react";
import { withTenant } from "@/db/client";
import { insuranceClaims, investors, insurancePolicies, users, CLAIM_STATUSES, CLAIM_MODES } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { claimTatDays, claimAgeDays, OPEN_CLAIM_STATUSES } from "@/lib/insurance/claim-status";
import { Pager } from "@/components/common/Pager";
import { Avatar } from "@/components/ui/Avatar";
import { ModuleTabs, INSURANCE_TABS } from "@/components/common/ModuleTabs";

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; tone: string }> = {
  empty: { label: "Empty", tone: "bg-slate-100 text-slate-600" },
  claim_intimated: { label: "Claim Intimated", tone: "bg-amber-50 text-amber-700" },
  file_awaited: { label: "File Awaited", tone: "bg-brand-cyan-light/50 text-brand-cyan-deep" },
  file_received: { label: "File Received", tone: "bg-cyan-50 text-cyan-700" },
  add_info_awaited: { label: "Add Info Awaited", tone: "bg-brand-cyan-light/50 text-brand-cyan-deep" },
  query: { label: "Query", tone: "bg-violet-50 text-violet-700" },
  query_replied: { label: "Query Replied", tone: "bg-indigo-50 text-indigo-700" },
  under_process: { label: "Under Process", tone: "bg-blue-50 text-blue-700" },
  settled_fully: { label: "Settled Fully", tone: "bg-emerald-50 text-emerald-700" },
  settled_partially: { label: "Settled Partially", tone: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", tone: "bg-rose-50 text-rose-700" },
  withdrawn: { label: "Withdrawn", tone: "bg-slate-100 text-slate-600" },
};
const OPEN_STATUSES = ["claim_intimated", "file_awaited", "file_received", "add_info_awaited", "query", "query_replied", "under_process"];
const TYPE_LABEL: Record<string, string> = { main_claim: "Main Claim", supplementary: "Supplementary", pre_authorization: "Pre-Auth", rider: "Rider", other: "Other" };
const PAGE_SIZE = 50;

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  requireCap(session.roles, "insurance.view", session.permissions);
  const sp = await searchParams;
  const status = sp.status && (CLAIM_STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";
  // Claim-MODE filter (cashless / reimbursement / grievance) — a separate axis
  // from the status pipeline. Only one of status/mode is active at a time.
  const mode = sp.mode && (CLAIM_MODES as readonly string[]).includes(sp.mode) ? sp.mode : "";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [];
    if (mode) conds.push(eq(insuranceClaims.claimMode, mode as any));
    else if (status) conds.push(eq(insuranceClaims.claimStatus, status as any));
    if (q) conds.push(or(ilike(insuranceClaims.proposerName, `%${q}%`), ilike(insuranceClaims.policyNumber, `%${q}%`), ilike(insuranceClaims.insurer, `%${q}%`))!);
    const where = conds.length ? and(...conds) : undefined;

    const rows = await tx
      .select({ c: insuranceClaims, investorName: investors.name, investorId: investors.id, investorAvatarUrl: investors.avatarUrl, planName: insurancePolicies.planName, rmName: users.name })
      .from(insuranceClaims)
      .leftJoin(investors, eq(investors.id, insuranceClaims.investorId))
      .leftJoin(insurancePolicies, eq(insurancePolicies.id, insuranceClaims.policyId))
      .leftJoin(users, eq(users.id, insuranceClaims.rmId))
      .where(where as any)
      .orderBy(desc(insuranceClaims.updatedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    const cnt = await tx.select({ c: sql<number>`count(*)::int` }).from(insuranceClaims).where(where as any);

    const byStatus = await tx.execute(sql`SELECT claim_status, count(*)::int AS c FROM insurance_claims GROUP BY claim_status`);
    const statusCounts: Record<string, number> = {};
    for (const r of byStatus.rows as any[]) statusCounts[r.claim_status] = Number(r.c);

    const byMode = await tx.execute(sql`SELECT claim_mode, count(*)::int AS c FROM insurance_claims WHERE claim_mode IS NOT NULL GROUP BY claim_mode`);
    const modeCounts: Record<string, number> = {};
    for (const r of byMode.rows as any[]) modeCounts[r.claim_mode] = Number(r.c);

    const stats = await tx.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE claim_status IN ('claim_intimated','file_awaited','file_received','add_info_awaited','query','query_replied','under_process'))::int AS open,
        count(*) FILTER (WHERE claim_status IN ('settled_fully','settled_partially'))::int AS settled,
        count(*) FILTER (WHERE claim_status = 'rejected')::int AS rejected,
        COALESCE(SUM(settled_amount::numeric),0) AS settled_amount
      FROM insurance_claims
    `);
    return { rows, filteredTotal: Number(cnt[0]?.c ?? 0), statusCounts, modeCounts, s: stats.rows[0] as any };
  });

  const statusTabs = [{ key: "", label: "All", count: Number(data.s.total ?? 0) }, ...CLAIM_STATUSES.map((k) => ({ key: k, label: STATUS_META[k].label, count: data.statusCounts[k] ?? 0 }))];
  const modeTabs = [
    { key: "reimbursement", label: "Reimbursement", count: data.modeCounts.reimbursement ?? 0 },
    { key: "grievance", label: "Grievance", count: data.modeCounts.grievance ?? 0 },
  ];
  const qp = (next: Record<string, string>) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    Object.entries(next).forEach(([k, v]) => (v ? u.set(k, v) : u.delete(k)));
    const s = u.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title"><FileText className="size-6 text-brand-cyan" /> Insurance Claims</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/insurance-claims/scorecard" className="btn-secondary"><Clock className="size-4" /> Settlement scorecard</Link>
          <Link href="/dashboard/insurance-claims/new" className="btn-primary"><Plus className="size-4" /> New claim</Link>
        </div>
      </div>

      <ModuleTabs tabs={INSURANCE_TABS} />

      {/* Status pipeline + claim-mode filters — one uniform set of chips on a
          single row that scrolls horizontally with a HIDDEN scrollbar. */}
      <div className="card-surface p-2 overflow-x-auto scrollbar-none">
        <div className="flex gap-1.5 min-w-max">
          {[
            ...statusTabs.map((t) => ({ ...t, href: qp({ status: t.key, mode: "", page: "" }), active: !mode && status === t.key })),
            ...modeTabs.map((t) => ({ ...t, href: qp({ mode: t.key, status: "", page: "" }), active: mode === t.key })),
          ].map((t) => (
            <Link key={`${t.key || "all"}-${t.label}`} href={`/dashboard/insurance-claims${t.href}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${t.active ? "bg-brand-navy text-white" : "text-muted-foreground hover:bg-secondary"}`}>
              {t.label} <span className={`ml-1 ${t.active ? "text-white/70" : "text-muted-foreground/60"}`}>{t.count}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Search */}
      <form className="max-w-sm">
        {status && <input type="hidden" name="status" value={status} />}
        {mode && <input type="hidden" name="mode" value={mode} />}
        <input name="q" defaultValue={q} placeholder="Search proposer, policy no., insurer…" className="input-base" />
      </form>

      <div className="card-surface overflow-hidden">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <FileText className="size-8 mx-auto text-muted-foreground/40" />
            <div className="mt-2 font-medium">No claims{mode ? ` — ${mode.charAt(0).toUpperCase() + mode.slice(1)}` : status ? ` in "${STATUS_META[status].label}"` : ""}.</div>
            <Link href="/dashboard/insurance-claims/new" className="text-brand-cyan-deep hover:underline text-xs mt-1 inline-block">+ Log a claim</Link>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Proposer</th>
                  <th className="text-left py-2 font-medium">Policy</th>
                  <th className="text-right py-2 font-medium">Claimed</th>
                  <th className="text-right py-2 font-medium">Settled</th>
                  <th className="text-left py-2 font-medium pl-4">Status</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">TAT</th>
                  <th className="text-left py-2 font-medium pr-4">RM</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ c, investorName, investorId, investorAvatarUrl, planName, rmName }) => {
                  const meta = STATUS_META[c.claimStatus] ?? STATUS_META.empty;
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-secondary/40 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar src={investorAvatarUrl && investorId ? `/api/investors/${investorId}/avatar` : null} name={investorName ?? c.proposerName} size={26} />
                          <div>
                            <Link href={`/dashboard/insurance-claims/${c.id}`} className="font-medium hover:underline">{c.proposerName}</Link>
                            {investorName && <div className="text-[11px] text-muted-foreground">{investorName}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5">
                        <div className="text-sm">{c.insurer ?? "—"}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{c.policyNumber ?? planName ?? "—"}</div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{formatINR(Number(c.claimedAmount ?? 0))}</td>
                      <td className="py-2.5 text-right tabular-nums">{formatINR(Number(c.settledAmount ?? 0))}</td>
                      <td className="py-2.5 pl-4"><span className={`chip ${meta.tone}`}>{meta.label}</span></td>
                      <td className="py-2.5 text-xs">{c.claimType ? TYPE_LABEL[c.claimType] ?? c.claimType : "—"}</td>
                      <td className="py-2.5 text-xs"><TatCell status={c.claimStatus} intimationDate={c.intimationDate} settlementDate={c.settlementDate} /></td>
                      <td className="py-2.5 text-xs pr-4">{rmName ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 pb-3 pt-1">
              <Pager page={page} totalPages={Math.ceil(data.filteredTotal / PAGE_SIZE)} total={data.filteredTotal} pageSize={PAGE_SIZE} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const OPEN_SET = OPEN_CLAIM_STATUSES as readonly string[];
function TatCell({ status, intimationDate, settlementDate }: { status: string; intimationDate: string | null; settlementDate: string | null }) {
  if (OPEN_SET.includes(status)) {
    const age = claimAgeDays(intimationDate);
    if (age == null) return <span className="text-muted-foreground">—</span>;
    const tone = age > 90 ? "text-rose-600" : age > 60 ? "text-amber-600" : "text-muted-foreground";
    return <span className={`tabular-nums font-medium ${tone}`}>{age}d open</span>;
  }
  const tat = claimTatDays(intimationDate, settlementDate);
  if (tat == null) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{tat} days</span>;
}

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone: "cyan" | "amber" | "emerald" }) {
  const c = tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-brand-cyan-deep";
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className={`size-4 ${c}`} />
      </div>
      <div className="text-2xl font-bold mt-1.5 tabular-nums">{value}</div>
    </div>
  );
}
