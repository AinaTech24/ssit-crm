import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Droplets, Filter, X } from "lucide-react";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { getBusinessSummary } from "@/lib/business/report";
import { ASSET_CLASS_LABELS, type AssetClass } from "@/lib/business/asset-class";
import { PRODUCT_TYPES, BUSINESS_ENTRY_STATUSES } from "@/db/schema/business_entries";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const PRODUCT_LABEL: Record<string, string> = {
  mutual_fund: "Mutual Fund", direct_equity: "Direct Equity", pms: "PMS", aif: "AIF", sif: "SIF",
  bond: "Bond", ncd: "NCD", p2p: "P2P", las: "LAS", other: "Other",
};
const TXN_LABEL: Record<string, string> = { sip: "SIP", sip_topup: "SIP Top-Up", sip_stop: "SIP Stop", other: "Others", lumpsum: "Lumpsum", additional_purchase: "Add'l Purchase", switch: "Switch", stp: "STP", swp: "SWP", redemption: "Redemption" };
const STATUS_LABEL: Record<string, string> = { draft: "Draft", confirmed: "Confirmed", emailed: "Emailed", cancelled: "Cancelled" };

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function fyBounds(now = new Date()): { fromISO: string; toISO: string; label: string } {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { fromISO: `${y}-04-01`, toISO: iso(now), label: `FY ${y}–${String((y + 1) % 100).padStart(2, "0")}` };
}

const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function Bars({ rows, label }: { rows: Array<{ key: string; amount: number }>; label: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  if (rows.length === 0) return <div className="text-xs text-muted-foreground py-4">No data.</div>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex items-center justify-between text-xs mb-0.5">
            <span>{label(r.key)}</span>
            <span className="tabular-nums font-medium">{formatINR(r.amount)}</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-brand-cyan" style={{ width: `${Math.round((r.amount / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function BusinessDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) redirect("/dashboard");
  const sp = await searchParams;

  const fy = fyBounds();
  const fromISO = sp.from && ISO_RE.test(sp.from) ? sp.from : fy.fromISO;
  const toISO = sp.to && ISO_RE.test(sp.to) ? sp.to : fy.toISO;
  const product = sp.product && (PRODUCT_TYPES as readonly string[]).includes(sp.product) ? sp.product : null;
  const status = sp.status && (BUSINESS_ENTRY_STATUSES as readonly string[]).includes(sp.status) ? sp.status : null;
  const customRange = Boolean(sp.from || sp.to);

  // Whose business this dashboard opens on.
  //
  // It used to open on EVERYONE, which is the wrong default for the person
  // who books the business: an RM landed on the firm's numbers rather than
  // their own. It now opens on YOUR book, and anyone entitled to the firm-wide
  // view can still switch to All users or to a colleague — the difference is
  // that seeing the whole firm is now a choice rather than the landing state.
  //
  // Same entitlement the entries LIST uses, so the two screens agree.
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions);

  const { summary, rmUsers, rmId } = await withTenant(session.tenantId, async (tx) => {
    const rmUsers = (
      await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' ORDER BY name`)
    ).rows as Array<{ id: string; name: string }>;
    // Only honour an rm filter that matches a real tenant user (avoids a bad ::uuid cast).
    // "all" is the explicit firm-wide choice; anything else falls back to the
    // viewer themselves. Someone without the firm-wide entitlement is pinned to
    // their own book whatever the URL says.
    const picked = (sp.rm ?? "").trim();
    const rmId = !seesAll
      ? session.userId
      : picked === "all"
        ? null
        : rmUsers.some((u) => u.id === picked)
          ? picked
          : session.userId;
    const summary = await getBusinessSummary(tx, session.tenantId, { fromISO, toISO, rmId, productType: product, status });
    return { summary, rmUsers, rmId };
  });

  const anyFilter = customRange || Boolean(rmId || product || status);
  const rangeLabel = customRange ? `${fmtDate(fromISO)} – ${fmtDate(toISO)}` : `${fy.label} (to date)`;

  return (
    <div className="space-y-6 max-w-6xl">
      <Link href="/dashboard/business-entries" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to transactions
      </Link>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transactions Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Booked business for <span className="font-medium text-foreground">{rangeLabel}</span>.
          </p>
        </div>
        <Link href="/dashboard/business-entries/liquid" className="btn-secondary text-sm inline-flex items-center gap-1.5">
          <Droplets className="size-4" /> Liquid report
        </Link>
      </div>

      {/* Filters — server-rendered GET form (no client JS needed). */}
      <form method="get" className="card-surface p-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-3">
          <Filter className="size-3.5" /> Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <label className="block">
            <span className="text-xs text-muted-foreground">From date</span>
            <input type="date" name="from" defaultValue={fromISO} className="input-base mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">To date</span>
            <input type="date" name="to" defaultValue={toISO} className="input-base mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">User (RM)</span>
            <select
              name="rm"
              defaultValue={rmId ?? "all"}
              disabled={!seesAll}
              title={!seesAll ? "You see your own business" : undefined}
              className="input-base mt-1 disabled:opacity-60"
            >
              {/* Only offered to someone entitled to the firm-wide view — and
                  never the landing state, so the dashboard opens on your own
                  book rather than the firm's. */}
              {seesAll && <option value="all">All users</option>}
              {rmUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Product</span>
            <select name="product" defaultValue={product ?? ""} className="input-base mt-1">
              <option value="">All products</option>
              {PRODUCT_TYPES.map((p) => (
                <option key={p} value={p}>{PRODUCT_LABEL[p] ?? p}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Status</span>
            <select name="status" defaultValue={status ?? ""} className="input-base mt-1">
              <option value="">All active</option>
              {BUSINESS_ENTRY_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn-primary text-sm flex-1">Apply</button>
            {anyFilter && (
              <Link href="/dashboard/business-entries/dashboard" className="btn-secondary text-sm inline-flex items-center gap-1" title="Clear filters">
                <X className="size-4" />
              </Link>
            )}
          </div>
        </div>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total business" value={formatINR(summary.gross)} highlight />
        <Kpi label="SIP mobilised" value={formatINR(summary.sipAmount)} />
        <Kpi label="Entries" value={String(summary.entries)} />
        <Kpi label="Clients" value={String(summary.clients)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="By asset class">
          <Bars rows={summary.byAssetClass} label={(k) => ASSET_CLASS_LABELS[k as AssetClass] ?? k} />
        </Card>
        <Card title="By transaction type">
          <Bars rows={summary.byTxnType} label={(k) => TXN_LABEL[k] ?? k} />
        </Card>
        <Card title="By product">
          <Bars rows={summary.byProduct} label={(k) => PRODUCT_LABEL[k] ?? k} />
        </Card>
        <Card title="By month">
          <Bars rows={summary.byMonth.map((m) => ({ key: m.month, amount: m.amount }))} label={(k) => {
            const [y, mo] = k.split("-");
            return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
          }} />
        </Card>
      </div>

      {/* RM-wise and branch-wise splits of the same filtered set. Both carry
          entry and client counts, because gross alone hides an RM writing one
          large ticket versus many small ones. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="RM-wise business">
          <OrgTable rows={summary.byRm.map((r) => ({ key: r.rmId, name: r.name, amount: r.amount, entries: r.entries, clients: r.clients }))} />
        </Card>
        <Card title="Branch-wise business">
          <OrgTable rows={summary.byBranch.map((r) => ({ key: r.branchId, name: r.name, amount: r.amount, entries: r.entries, clients: r.clients }))} />
        </Card>
      </div>

      <Card title="Top clients">
        {summary.topClients.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">No data.</div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {summary.topClients.map((c, i) => (
                <tr key={c.investorId ?? i} className="border-b last:border-0">
                  <td className="py-2 text-muted-foreground w-6 tabular-nums">{i + 1}</td>
                  <td className="py-2 font-medium">
                    {c.investorId ? <Link href={`/dashboard/investors/${c.investorId}`} className="hover:underline">{c.name}</Link> : c.name}
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">{formatINR(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/** RM / branch split: name, gross, and the counts behind it. */
function OrgTable({
  rows,
}: {
  rows: Array<{ key: string | null; name: string; amount: number; entries: number; clients: number }>;
}) {
  if (rows.length === 0) return <div className="text-xs text-muted-foreground py-4">No data.</div>;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] text-muted-foreground border-b">
        <tr>
          <th className="text-left py-1.5 font-medium">Name</th>
          <th className="text-right py-1.5 font-medium">Entries</th>
          <th className="text-right py-1.5 font-medium">Clients</th>
          <th className="text-right py-1.5 font-medium">Gross</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key ?? `_${i}`} className="border-b last:border-0">
            <td className="py-2 pr-2">
              <div className="font-medium truncate max-w-[14rem]">{r.name}</div>
              <div className="mt-1 h-1 w-full rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-brand-cyan" style={{ width: `${Math.round((r.amount / max) * 100)}%` }} />
              </div>
            </td>
            <td className="py-2 text-right tabular-nums text-xs text-muted-foreground">{r.entries}</td>
            <td className="py-2 text-right tabular-nums text-xs text-muted-foreground">{r.clients}</td>
            <td className="py-2 text-right tabular-nums font-medium">{formatINR(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card-surface p-4 ${highlight ? "bg-brand-cyan-light/30" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-5">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      {children}
    </div>
  );
}
