import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, ExternalLink, FlaskConical, ShieldCheck, Wrench } from "lucide-react";
import { withSystem, withTenant } from "@/db/client";
import { tenantIntegrations } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { buildProductReadiness, type ReadinessStatus } from "@/lib/platform/product-readiness";
import { commercialLegalReadiness } from "@/lib/legal/company";

export const dynamic = "force-dynamic";

const STATUS: Record<ReadinessStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  live: { label: "Live", icon: CheckCircle2, className: "bg-primary/10 text-primary border-primary/20" },
  configured: { label: "Configured", icon: Wrench, className: "bg-secondary text-secondary-foreground border-border" },
  demo: { label: "Demo only", icon: FlaskConical, className: "bg-accent text-accent-foreground border-border" },
  blocked: { label: "Blocked", icon: AlertTriangle, className: "bg-destructive/10 text-destructive border-destructive/20" },
  unavailable: { label: "Unavailable", icon: CircleDashed, className: "bg-muted text-muted-foreground border-border" },
};

export default async function ProductReadinessPage() {
  const session = await requireSession();
  requireCap(session.roles, "settings.masters", session.permissions);

  const tenantState = await withTenant(session.tenantId, async (tx) => {
    const integrations = await tx.select({ provider: tenantIntegrations.provider }).from(tenantIntegrations).where(eq(tenantIntegrations.isActive, true));
    let lastRtaImportAt: Date | null = null;
    try {
      const result = await tx.execute(sql`SELECT max(created_at) AS at FROM rta_file_imports WHERE status IN ('completed','partial') AND deleted_at IS NULL`);
      const value = (result.rows[0] as { at?: string | Date | null } | undefined)?.at;
      lastRtaImportAt = value ? new Date(value) : null;
    } catch {
      // A new tenant may not have completed the optional RTA migration yet.
    }
    return { providers: new Set(integrations.map((row) => row.provider)), lastRtaImportAt };
  });

  let workerHealthy: boolean | null = null;
  try {
    workerHealthy = await withSystem(async (tx) => {
      const result = await tx.execute(sql`SELECT last_run_status, last_heartbeat_at FROM scheduler_state`);
      if (!result.rows.length) return null;
      return (result.rows as Array<{ last_run_status: string | null; last_heartbeat_at: string | null }>).every((row) => {
        const age = row.last_heartbeat_at ? Date.now() - new Date(row.last_heartbeat_at).getTime() : Number.POSITIVE_INFINITY;
        return row.last_run_status !== "failed" && age < 30 * 3_600_000;
      });
    });
  } catch {
    workerHealthy = null;
  }

  const items = buildProductReadiness({ tenantProviders: tenantState.providers, workerHealthy, lastRtaImportAt: tenantState.lastRtaImportAt });
  const legal = commercialLegalReadiness();
  const criticalBlocked = items.filter((item) => item.critical && item.status === "blocked").length;
  const liveOrConfigured = items.filter((item) => item.status === "live" || item.status === "configured").length;
  const categories = ["Core", "Communication", "Data", "Execution", "Governance"] as const;

  return (
    <div className="max-w-6xl space-y-6">
      <div><Link href="/dashboard/settings" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Settings</Link><h1 className="page-title"><Activity className="size-6 text-brand-cyan" /> Product readiness</h1><p className="mt-1 text-sm text-muted-foreground">One honest view of what is live, configured, demo-only, blocked or not available.</p></div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="Ready services" value={`${liveOrConfigured} / ${items.length}`} hint="live or configured" />
        <Summary label="Critical blockers" value={String(criticalBlocked)} hint={criticalBlocked ? "resolve before commercial launch" : "commercial path clear"} danger={criticalBlocked > 0} />
        <Summary label="Runtime mode" value={process.env.NODE_ENV === "production" ? "Production" : "Development"} hint={process.env.ALLOW_DEMO_PROVIDERS === "1" ? "demo providers allowed" : "demo providers fail closed"} />
      </div>

      {categories.map((category) => <section key={category}><h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{category}</h2><div className="divide-y rounded-lg border bg-card">{items.filter((item) => item.category === category).map((item) => { const style = STATUS[item.status]; const Icon = style.icon; return <div key={item.key} className="flex flex-wrap items-start gap-3 p-4 sm:flex-nowrap"><span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${style.className}`}><Icon className="size-3.5" />{style.label}</span><div className="min-w-0 flex-1"><div className="font-medium">{item.label}{item.critical && <span className="ml-1.5 text-xs text-muted-foreground">critical</span>}</div><p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p></div>{item.href && <Link href={item.href} className="btn-ghost shrink-0 px-2 text-xs">Open <ExternalLink className="size-3" /></Link>}</div>; })}</div></section>)}

      <section id="legal"><h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Commercial legal checklist</h2><div className="grid gap-2 sm:grid-cols-2">{legal.checks.map((check) => <div key={check.key} className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm">{check.ok ? <CheckCircle2 className="size-4 text-primary" /> : <AlertTriangle className="size-4 text-destructive" />}<span>{check.label}</span></div>)}</div><p className="mt-2 text-xs text-muted-foreground">Configure these through the LEGAL_* deployment variables and have the rendered legal documents reviewed before launch.</p></section>
    </div>
  );
}

function Summary({ label, value, hint, danger = false }: { label: string; value: string; hint: string; danger?: boolean }) {
  return <div className={`rounded-lg border bg-card p-4 ${danger ? "border-destructive/30" : ""}`}><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-xl font-bold ${danger ? "text-destructive" : ""}`}>{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{hint}</div></div>;
}
