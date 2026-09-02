import Link from "next/link";
import { sql } from "drizzle-orm";
import { ShieldCheck, MessageCircle, Mail, MessageSquare, FileCheck2, ScrollText, Download, ShieldX, BadgeCheck } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export default async function ComplianceCommandCenterPage() {
  const session = await requireSession();
  if (!session.roles.some((r: string) => ["owner", "compliance", "branch_head"].includes(r))) {
    return <div className="max-w-2xl card-surface p-8 text-center text-sm text-muted-foreground">The Compliance Command Center is for owners and compliance.</div>;
  }

  const d = await withTenant(session.tenantId, async (tx) => {
    const t = session.tenantId;
    const active = Number((await tx.execute(sql`SELECT COUNT(*)::int AS c FROM investors WHERE tenant_id=${t}::uuid AND status='active'`)).rows[0]?.c ?? 0);

    const consent = (await tx.execute(sql`
      SELECT channel, COUNT(DISTINCT investor_id) FILTER (WHERE status='granted')::int AS granted,
             COUNT(DISTINCT investor_id) FILTER (WHERE status='revoked')::int AS revoked
      FROM consents WHERE tenant_id=${t}::uuid GROUP BY channel
    `)).rows as any[];

    const gate = (await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('sent','delivered','read'))::int AS delivered,
        COUNT(*) FILTER (WHERE status='skipped_compliance')::int AS blocked_compliance,
        COUNT(*) FILTER (WHERE status='skipped_consent')::int AS blocked_consent,
        COUNT(*) FILTER (WHERE status='skipped_session')::int AS blocked_session,
        COUNT(*) FILTER (WHERE status='skipped_rate_limit')::int AS rate_limited,
        COUNT(*) FILTER (WHERE status IN ('failed','bounced'))::int AS failed,
        ROUND(AVG(compliance_score) FILTER (WHERE compliance_score IS NOT NULL), 1) AS avg_score
      FROM communications WHERE tenant_id=${t}::uuid AND created_at >= now() - interval '90 days'
    `)).rows[0] as any;

    const dlt = (await tx.execute(sql`
      SELECT template_type, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active
      FROM dlt_templates WHERE tenant_id=${t}::uuid GROUP BY template_type
    `)).rows as any[];

    const audit30 = Number((await tx.execute(sql`SELECT COUNT(*)::int AS c FROM audit_log WHERE tenant_id=${t}::uuid AND at >= now() - interval '30 days'`)).rows[0]?.c ?? 0);

    return { active, consent, gate, dlt, audit30 };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  const consentByCh = (ch: string) => d.consent.find((c) => c.channel === ch) ?? { granted: 0, revoked: 0 };
  const g = d.gate ?? {};
  const totalBlocked = Number(g.blocked_compliance ?? 0) + Number(g.blocked_consent ?? 0) + Number(g.blocked_session ?? 0) + Number(g.rate_limited ?? 0);
  const passRate = pct(Number(g.delivered ?? 0), Number(g.total ?? 0));
  const dltActive = d.dlt.reduce((a, x) => a + Number(x.active), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ShieldCheck className="size-6 text-brand-cyan" /> Compliance Command Center</h1>
        </div>
        <DownloadButton url="/api/compliance/inspection-pack" className="btn-primary text-sm inline-flex items-center gap-1"><Download className="size-4" /> SEBI inspection pack</DownloadButton>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={BadgeCheck} label="Gate pass rate (90d)" value={`${passRate}%`} tone="emerald" />
        <Kpi icon={ShieldX} label="Blocked / skipped (90d)" value={String(totalBlocked)} tone={totalBlocked > 0 ? "amber" : undefined} />
        <Kpi icon={FileCheck2} label="DLT templates active" value={String(dltActive)} />
        <Kpi icon={ScrollText} label="Audit events (30d)" value={String(d.audit30)} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Consent coverage */}
        <div className="card-surface p-5">
          <div className="font-semibold text-sm flex items-center gap-2 mb-3"><ShieldCheck className="size-4 text-brand-cyan" /> Consent coverage</div>
          <p className="text-[11px] text-muted-foreground mb-3">Share of {d.active.toLocaleString("en-IN")} active clients with a recorded <strong>granted</strong> consent, per channel.</p>
          <div className="space-y-3">
            {[{ ch: "whatsapp", label: "WhatsApp", icon: MessageCircle }, { ch: "email", label: "Email", icon: Mail }, { ch: "sms", label: "SMS", icon: MessageSquare }].map(({ ch, label, icon: Icon }) => {
              const c = consentByCh(ch); const p = pct(Number(c.granted), d.active);
              return (
                <div key={ch}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-medium flex items-center gap-1.5"><Icon className="size-3.5 text-muted-foreground" /> {label}</span>
                    <span className="tabular-nums text-muted-foreground">{Number(c.granted).toLocaleString("en-IN")} granted · {p}%{Number(c.revoked) > 0 ? ` · ${c.revoked} revoked` : ""}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className={`h-full ${p >= 60 ? "bg-emerald-500" : p >= 30 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.min(100, p)}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Compliance gate */}
        <div className="card-surface p-5">
          <div className="font-semibold text-sm flex items-center gap-2 mb-3"><BadgeCheck className="size-4 text-brand-cyan" /> Compliance gate (90 days)</div>
          <p className="text-[11px] text-muted-foreground mb-3">Every send passes consent → 11 deterministic rules → DLT. Avg compliance score {g.avg_score ?? "—"}/100.</p>
          <div className="space-y-1.5 text-sm">
            <GateRow label="Delivered" value={Number(g.delivered ?? 0)} total={Number(g.total ?? 0)} tone="emerald" />
            <GateRow label="Blocked — compliance rule" value={Number(g.blocked_compliance ?? 0)} total={Number(g.total ?? 0)} tone="rose" />
            <GateRow label="Skipped — no consent" value={Number(g.blocked_consent ?? 0)} total={Number(g.total ?? 0)} tone="amber" />
            <GateRow label="Skipped — WA session closed" value={Number(g.blocked_session ?? 0)} total={Number(g.total ?? 0)} tone="amber" />
            <GateRow label="Rate-limited" value={Number(g.rate_limited ?? 0)} total={Number(g.total ?? 0)} tone="sky" />
            <GateRow label="Failed / bounced" value={Number(g.failed ?? 0)} total={Number(g.total ?? 0)} tone="rose" />
          </div>
        </div>
      </div>

      {/* DLT registry */}
      <div className="card-surface p-5">
        <div className="font-semibold text-sm flex items-center gap-2 mb-3"><FileCheck2 className="size-4 text-brand-cyan" /> DLT (TRAI) template registry</div>
        {d.dlt.length === 0 ? (
          <p className="text-xs text-muted-foreground">No DLT templates registered yet. SMS sends require pre-approved DLT templates.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {d.dlt.map((x) => (
              <div key={x.template_type} className="rounded-lg border px-3 py-2 text-sm">
                <div className="text-[11px] text-muted-foreground capitalize">{x.template_type}</div>
                <div className="font-bold tabular-nums">{x.active}<span className="text-xs text-muted-foreground font-normal"> / {x.total} active</span></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <Link href="/dashboard/compliance" className="text-brand-cyan hover:underline">DDQ readiness →</Link>
        <Link href="/dashboard/communications" className="text-brand-cyan hover:underline">Communications log →</Link>
        <Link href="/dashboard/compliance/audit-checklist" className="text-brand-cyan hover:underline">Audit checklist →</Link>
      </div>
    </div>
  );
}

function GateRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: "emerald" | "rose" | "amber" | "sky" }) {
  const p = pct(value, total);
  const dot = tone === "emerald" ? "bg-emerald-500" : tone === "rose" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : "bg-sky-500";
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${dot}`} /> {label}</span>
      <span className="tabular-nums text-muted-foreground">{value.toLocaleString("en-IN")} <span className="text-[11px]">({p}%)</span></span>
    </div>
  );
}
function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "emerald" | "amber" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
