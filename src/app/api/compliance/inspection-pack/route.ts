import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/compliance/inspection-pack — a one-click "SEBI inspection pack":
 * a CSV summary of the firm's compliance posture (consent coverage, the
 * compliance gate over 90 days, the DLT registry, audit volume). The sales
 * weapon a generic CRM can't produce — it has no consent/gate/DLT layer.
 * Owners / compliance only.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const esc = (v: any) => {
  let s = String(v ?? "");
  // Neutralize CSV formula injection: a cell starting with = + - @ (or a
  // leading tab/CR) is evaluated as a formula by Excel/Sheets. Prefix with a
  // single quote so the spreadsheet treats it as literal text.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  try {
    const session = await requireSession();
    if (!session.roles.some((r: string) => ["owner", "compliance", "branch_head"].includes(r))) {
      return NextResponse.json({ error: "owners / compliance only" }, { status: 403 });
    }

    const d = await withTenant(session.tenantId, async (tx) => {
      const t = session.tenantId;
      const active = Number((await tx.execute(sql`SELECT COUNT(*)::int AS c FROM investors WHERE tenant_id=${t}::uuid AND status='active'`)).rows[0]?.c ?? 0);
      const consent = (await tx.execute(sql`SELECT channel, COUNT(DISTINCT investor_id) FILTER (WHERE status='granted')::int AS granted, COUNT(DISTINCT investor_id) FILTER (WHERE status='revoked')::int AS revoked FROM consents WHERE tenant_id=${t}::uuid GROUP BY channel`)).rows as any[];
      const gate = (await tx.execute(sql`
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status IN ('sent','delivered','read'))::int AS delivered,
          COUNT(*) FILTER (WHERE status='skipped_compliance')::int AS blocked_compliance,
          COUNT(*) FILTER (WHERE status='skipped_consent')::int AS blocked_consent,
          COUNT(*) FILTER (WHERE status='skipped_session')::int AS blocked_session,
          COUNT(*) FILTER (WHERE status='skipped_rate_limit')::int AS rate_limited,
          COUNT(*) FILTER (WHERE status IN ('failed','bounced'))::int AS failed,
          ROUND(AVG(compliance_score) FILTER (WHERE compliance_score IS NOT NULL), 1) AS avg_score
        FROM communications WHERE tenant_id=${t}::uuid AND created_at >= now() - interval '90 days'`)).rows[0] as any;
      const dlt = (await tx.execute(sql`SELECT template_type, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM dlt_templates WHERE tenant_id=${t}::uuid GROUP BY template_type`)).rows as any[];
      const audit30 = Number((await tx.execute(sql`SELECT COUNT(*)::int AS c FROM audit_log WHERE tenant_id=${t}::uuid AND at >= now() - interval '30 days'`)).rows[0]?.c ?? 0);
      const auditTotal = Number((await tx.execute(sql`SELECT COUNT(*)::int AS c FROM audit_log WHERE tenant_id=${t}::uuid`)).rows[0]?.c ?? 0);
      return { active, consent, gate, dlt, audit30, auditTotal };
    }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

    const g = d.gate ?? {};
    const p = (n: number, den: number) => (den > 0 ? `${Math.round((n / den) * 1000) / 10}%` : "0%");
    const rows: Array<[string, string, string | number]> = [
      ["Firm", "Active clients", d.active],
      ["Compliance gate (90d)", "Total outbound attempts", Number(g.total ?? 0)],
      ["Compliance gate (90d)", "Delivered", `${Number(g.delivered ?? 0)} (${p(Number(g.delivered ?? 0), Number(g.total ?? 0))})`],
      ["Compliance gate (90d)", "Blocked — compliance rule", Number(g.blocked_compliance ?? 0)],
      ["Compliance gate (90d)", "Skipped — no consent", Number(g.blocked_consent ?? 0)],
      ["Compliance gate (90d)", "Skipped — WA session closed", Number(g.blocked_session ?? 0)],
      ["Compliance gate (90d)", "Rate-limited", Number(g.rate_limited ?? 0)],
      ["Compliance gate (90d)", "Failed / bounced", Number(g.failed ?? 0)],
      ["Compliance gate (90d)", "Avg compliance score", g.avg_score ?? "—"],
      ["Audit trail", "Events (last 30d)", d.audit30],
      ["Audit trail", "Events (all-time)", d.auditTotal],
    ];
    for (const ch of ["whatsapp", "email", "sms", "call"]) {
      const c = d.consent.find((x) => x.channel === ch) ?? { granted: 0, revoked: 0 };
      rows.push(["Consent coverage", `${ch} granted`, `${Number(c.granted)} (${p(Number(c.granted), d.active)})`]);
      if (Number(c.revoked) > 0) rows.push(["Consent coverage", `${ch} revoked`, Number(c.revoked)]);
    }
    for (const x of d.dlt) rows.push(["DLT registry", `${x.template_type} templates active`, `${x.active} / ${x.total}`]);

    const csv = ["Section,Metric,Value", ...rows.map((r) => r.map(esc).join(","))].join("\n");
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="compliance-inspection-pack.csv"`,
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
