import { desc, eq } from "drizzle-orm";
import { Building2, CalendarClock, CheckCircle2, CircleDollarSign, Flag, ShieldCheck, WalletCards } from "lucide-react";
import { withTenant } from "@/db/client";
import { folios, goals, investors, serviceRequests, tenants } from "@/db/schema";
import { resolvePortalAccess } from "@/lib/portal/access";
import { formatDate, formatINR } from "@/lib/utils";
import { PortalServiceRequestForm } from "@/components/portal/PortalServiceRequestForm";

export const dynamic = "force-dynamic";

export default async function InvestorPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await resolvePortalAccess(token);
  if (!access) return <PortalUnavailable />;

  const data = await withTenant(access.tenantId, async (tx) => {
    const [firm] = await tx.select({ name: tenants.displayName, legalName: tenants.legalName, logoUrl: tenants.logoUrl }).from(tenants).where(eq(tenants.id, access.tenantId)).limit(1);
    const [investor] = await tx.select({
      id: investors.id,
      name: investors.name,
      aum: investors.aum,
      activeSipAmount: investors.activeSipAmount,
      kycStatus: investors.kycStatus,
      riskProfile: investors.riskProfile,
      nomineeName: investors.nomineeName,
    }).from(investors).where(eq(investors.id, access.investorId)).limit(1);
    const clientGoals = access.scopes.includes("goals")
      ? await tx.select({ id: goals.id, name: goals.name, targetAmount: goals.targetAmount, currentValue: goals.currentValue, progressPct: goals.progressPct, targetDate: goals.targetDate, status: goals.status }).from(goals).where(eq(goals.investorId, access.investorId)).orderBy(goals.targetDate)
      : [];
    const clientFolios = access.scopes.includes("portfolio")
      ? await tx.select({ id: folios.id, amcName: folios.amcName, aum: folios.aum, schemes: folios.schemes }).from(folios).where(eq(folios.investorId, access.investorId))
      : [];
    const requests = access.scopes.includes("service_requests")
      ? await tx.select({ id: serviceRequests.id, ticketNo: serviceRequests.ticketNo, subject: serviceRequests.subject, status: serviceRequests.status, createdAt: serviceRequests.createdAt }).from(serviceRequests).where(eq(serviceRequests.investorId, access.investorId)).orderBy(desc(serviceRequests.createdAt)).limit(8)
      : [];
    return { firm, investor, clientGoals, clientFolios, requests };
  });

  if (!data.investor) return <PortalUnavailable />;
  const holdings = data.clientFolios.flatMap((folio) =>
    (folio.schemes ?? []).map((scheme) => ({
      key: `${folio.id}:${scheme.schemeCode}`,
      name: scheme.schemeName,
      amc: folio.amcName,
      value: Number(scheme.value ?? 0),
    }))
  ).filter((holding) => holding.value > 0).sort((a, b) => b.value - a.value);
  const portfolioValue = holdings.length
    ? holdings.reduce((sum, holding) => sum + holding.value, 0)
    : data.clientFolios.reduce((sum, folio) => sum + Number(folio.aum ?? 0), 0);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground"><Building2 className="size-5" /></div>
            <div><div className="font-semibold">{data.firm?.name ?? data.firm?.legalName ?? "Investor portal"}</div><div className="text-xs text-muted-foreground">Secure portfolio access</div></div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" /> Link expires {formatDate(access.expiresAt)}</div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-7 sm:px-6">
        <section>
          <p className="text-sm text-muted-foreground">Welcome back</p>
          <h1 className="text-2xl font-bold">{data.investor.name}</h1>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={CircleDollarSign} label="Portfolio value" value={formatINR(portfolioValue)} />
            <Metric icon={WalletCards} label="Active monthly SIP" value={`${formatINR(Number(data.investor.activeSipAmount ?? 0))}/mo`} />
            <Metric icon={ShieldCheck} label="KYC" value={(data.investor.kycStatus ?? "pending").replaceAll("_", " ")} />
            <Metric icon={Flag} label="Goals" value={String(data.clientGoals.length)} />
          </div>
        </section>

        {access.scopes.includes("portfolio") && (
          <section>
            <h2 className="text-lg font-semibold">Portfolio</h2>
            <p className="text-sm text-muted-foreground">Values reflect the latest successfully imported registrar data.</p>
            <div className="table-scroll mt-3 rounded-lg border bg-card" style={{ "--table-scroll-h": "24rem" } as React.CSSProperties}>
              <table className="w-full text-sm"><thead><tr><th className="text-left">Scheme</th><th className="text-left">AMC</th><th className="text-right">Current value</th></tr></thead><tbody>
                {holdings.length ? holdings.map((holding) => <tr key={holding.key}><td className="font-medium">{holding.name}</td><td className="text-muted-foreground">{holding.amc}</td><td className="text-right tabular-nums">{formatINR(holding.value)}</td></tr>) : <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">Portfolio details will appear after the next registrar import.</td></tr>}
              </tbody></table>
            </div>
          </section>
        )}

        {access.scopes.includes("goals") && (
          <section>
            <h2 className="text-lg font-semibold">Goals</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data.clientGoals.length ? data.clientGoals.map((goal) => {
                const pct = Math.max(0, Math.min(100, Number(goal.progressPct ?? 0)));
                return <article key={goal.id} className="rounded-lg border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{goal.name}</h3><p className="text-xs text-muted-foreground">Target {formatDate(goal.targetDate)}</p></div><span className="text-sm font-semibold">{pct.toFixed(0)}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{formatINR(Number(goal.currentValue ?? 0))}</span><span>{formatINR(Number(goal.targetAmount))}</span></div></article>;
              }) : <p className="text-sm text-muted-foreground">No goals have been linked yet.</p>}
            </div>
          </section>
        )}

        {access.scopes.includes("service_requests") && (
          <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div><h2 className="text-lg font-semibold">Request help</h2><p className="mb-3 text-sm text-muted-foreground">Submit a servicing request directly to your relationship team.</p><PortalServiceRequestForm token={token} /></div>
            <div><h2 className="text-lg font-semibold">Recent requests</h2><div className="mt-3 divide-y rounded-lg border bg-card">{data.requests.length ? data.requests.map((request) => <div key={request.id} className="p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{request.subject}</span><span className="text-xs capitalize text-muted-foreground">{request.status.replaceAll("_", " ")}</span></div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span>{request.ticketNo}</span><span>·</span><CalendarClock className="size-3" /><span>{formatDate(request.createdAt)}</span></div></div>) : <p className="p-5 text-sm text-muted-foreground">No service requests yet.</p>}</div></div>
          </section>
        )}

        <p className="border-t pt-5 text-xs leading-relaxed text-muted-foreground">Portfolio values are based on the latest registrar data available to your distributor and may differ from real-time market values. Mutual fund investments are subject to market risks. Read all scheme-related documents carefully.</p>
      </div>
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof CheckCircle2; label: string; value: string }) {
  return <div className="rounded-lg border bg-card p-4"><Icon className="size-4 text-primary" /><div className="mt-3 text-xs text-muted-foreground">{label}</div><div className="mt-0.5 font-semibold capitalize">{value}</div></div>;
}

function PortalUnavailable() {
  return <main className="grid min-h-screen place-items-center bg-background px-4"><div className="max-w-md text-center"><ShieldCheck className="mx-auto size-10 text-muted-foreground" /><h1 className="mt-4 text-xl font-semibold">This secure link is unavailable</h1><p className="mt-2 text-sm text-muted-foreground">It may have expired or been revoked. Ask your relationship manager for a fresh portal link.</p></div></main>;
}

