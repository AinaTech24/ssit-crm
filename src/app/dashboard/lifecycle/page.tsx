import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Route, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { leads } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { LEAD_PHASE_LAST_ORDER, LEAD_TO_CLIENT_STAGES } from "@/lib/blueprints/lead_to_client";
import { formatDate, formatINR } from "@/lib/utils";
import { WorkSwitcher } from "@/components/layout/WorkSwitcher";
import { TableScroll } from "@/components/common/TableScroll";

export const dynamic = "force-dynamic";

const VIEWS = [
  { value: "/dashboard/leads", label: "Leads" },
  { value: "/dashboard/pipeline-board", label: "Pipeline Board" },
  { value: "/dashboard/lifecycle", label: "Lifecycle" },
];

const STAGE_BY_KEY = new Map(LEAD_TO_CLIENT_STAGES.map((stage) => [stage.key, stage]));

export default async function LifecyclePage({ searchParams }: { searchParams: Promise<{ phase?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const phase = ["lead", "onboarding", "active"].includes(sp.phase ?? "") ? sp.phase! : "all";
  const firmWide = can(session.roles, "lead.view.all", session.permissions);

  const rows = await withTenant(
    session.tenantId,
    async (tx) => tx.select({
      id: leads.id,
      name: leads.name,
      stage: leads.stage,
      stageChangedAt: leads.stageChangedAt,
      convertedInvestorId: leads.convertedInvestorId,
      ownerId: leads.ownerId,
      intendedAmount: leads.intendedAmount,
      nextFollowUpAt: leads.nextFollowUpAt,
      ownerName: sql<string | null>`(select name from users where id = ${leads.ownerId})`,
    }).from(leads)
      .where(and(...(firmWide ? [] : [eq(leads.ownerId, session.userId)])))
      .orderBy(desc(leads.updatedAt)).limit(500),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const model = rows.map((row) => {
    const stage = STAGE_BY_KEY.get(row.stage) ?? LEAD_TO_CLIENT_STAGES[0];
    const rowPhase = stage.order <= LEAD_PHASE_LAST_ORDER && !row.convertedInvestorId ? "lead" : stage.flavour === "terminal_success" && stage.order > LEAD_PHASE_LAST_ORDER ? "active" : "onboarding";
    const changed = row.stageChangedAt ? new Date(row.stageChangedAt) : null;
    const due = changed && stage.slaDays ? new Date(changed.getTime() + stage.slaDays * 86_400_000) : null;
    const overdue = !!due && due.getTime() < Date.now() && rowPhase !== "active";
    return { ...row, stage, phase: rowPhase, due, overdue };
  });
  const shown = phase === "all" ? model : model.filter((row) => row.phase === phase);
  const leadCount = model.filter((row) => row.phase === "lead").length;
  const onboardingCount = model.filter((row) => row.phase === "onboarding").length;
  const activeCount = model.filter((row) => row.phase === "active").length;
  const overdueCount = model.filter((row) => row.overdue).length;

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="page-title"><Route className="size-6 text-brand-cyan" /> Lead-to-client lifecycle</h1><p className="mt-1 text-sm text-muted-foreground">One view from first contact through onboarding and active-client handoff.</p></div><WorkSwitcher current="/dashboard/lifecycle" options={VIEWS} label="Module" /></div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><PhaseCard label="Lead phase" value={leadCount} href="lead" icon={Users} /><PhaseCard label="Onboarding" value={onboardingCount} href="onboarding" icon={Clock3} /><PhaseCard label="Active clients" value={activeCount} href="active" icon={CheckCircle2} /><PhaseCard label="SLA overdue" value={overdueCount} href="all" icon={AlertTriangle} danger={overdueCount > 0} /></div>

      <div className="flex flex-wrap gap-1 rounded-lg border bg-secondary/40 p-1 sm:w-fit">{[["all", "All"], ["lead", "Lead"], ["onboarding", "Onboarding"], ["active", "Active"]].map(([value, label]) => <Link key={value} href={`/dashboard/lifecycle?phase=${value}`} className={`rounded-md px-3 py-1.5 text-xs font-medium ${phase === value ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{label}</Link>)}</div>

      <TableScroll className="rounded-lg border bg-card"><table className="w-full min-w-[860px] text-sm"><thead><tr><th className="text-left">Client / lead</th><th className="text-left">Phase</th><th className="text-left">Current stage</th><th className="text-left">Owner</th><th className="text-left">SLA</th><th className="text-right">Opportunity</th><th className="text-left">Next action</th></tr></thead><tbody>{shown.length ? shown.map((row) => <tr key={row.id}><td><Link href={row.convertedInvestorId ? `/dashboard/investors/${row.convertedInvestorId}` : `/dashboard/leads/${row.id}`} className="font-medium hover:underline">{row.name}</Link></td><td className="capitalize text-muted-foreground">{row.phase}</td><td><div className="font-medium">{row.stage.name}</div><div className="text-xs text-muted-foreground">{row.stage.ownerRole.replaceAll("_", " ")}</div></td><td>{row.ownerName ?? "Unassigned"}</td><td>{row.overdue ? <span className="font-medium text-destructive">Overdue · {row.due ? formatDate(row.due) : ""}</span> : row.due ? formatDate(row.due) : "No stage SLA"}</td><td className="text-right tabular-nums">{Number(row.intendedAmount) ? formatINR(Number(row.intendedAmount)) : "—"}</td><td><Link href={row.convertedInvestorId ? `/dashboard/investors/${row.convertedInvestorId}` : `/dashboard/leads/${row.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary">{row.stage.allowedActions[0]?.replaceAll("_", " ") ?? "Review record"}<ArrowRight className="size-3" /></Link></td></tr>) : <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">No records in this lifecycle phase.</td></tr>}</tbody></table></TableScroll>
    </div>
  );
}

function PhaseCard({ label, value, href, icon: Icon, danger = false }: { label: string; value: number; href: string; icon: typeof Users; danger?: boolean }) {
  return <Link href={`/dashboard/lifecycle?phase=${href}`} className={`rounded-lg border bg-card p-4 hover:bg-accent/30 ${danger ? "border-destructive/30" : ""}`}><Icon className={`size-4 ${danger ? "text-destructive" : "text-primary"}`} /><div className="mt-3 text-xs text-muted-foreground">{label}</div><div className={`text-xl font-bold ${danger ? "text-destructive" : ""}`}>{value}</div></Link>;
}
