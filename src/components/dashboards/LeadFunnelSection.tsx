import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Sparkles } from "lucide-react";
import { withTenant } from "@/db/client";
import { LeadFunnelChart } from "./LeadFunnelChart";
import { resolvePeriodDates, type Period } from "@/lib/dashboard/period";
import type { SessionUser } from "@/lib/auth/session";

export async function LeadFunnelSection({
  session,
  period = "mtd",
}: {
  session: SessionUser;
  period?: Period;
}) {
  const now = new Date();
  const { startISO: startOfPeriodISO } = resolvePeriodDates(period, now);

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE stage IN ('call_done', 'contacted', 'meeting_scheduled', 'meeting_pending', 'meeting_done', 'won_lead', 'converted', 'post_meeting_qualified'))::int AS contacted,
          COUNT(*) FILTER (WHERE stage IN ('meeting_scheduled', 'meeting_pending', 'meeting_done', 'won_lead', 'converted', 'post_meeting_qualified'))::int AS meetings,
          COUNT(*) FILTER (WHERE stage IN ('won_lead', 'converted'))::int AS converted
        FROM leads
        WHERE created_at >= ${startOfPeriodISO} AND converted_investor_id IS NULL
      `);
      return res.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const total = Number(data?.total ?? 0);
  const contacted = Number(data?.contacted ?? 0);
  const meetings = Number(data?.meetings ?? 0);
  const converted = Number(data?.converted ?? 0);

  const funnelSteps = [
    { name: "Total Leads", value: total, percentage: 100 },
    {
      name: "Contacted",
      value: contacted,
      percentage: total > 0 ? (contacted / total) * 100 : 0,
    },
    {
      name: "Meetings",
      value: meetings,
      percentage: total > 0 ? (meetings / total) * 100 : 0,
    },
    {
      name: "Converted",
      value: converted,
      percentage: total > 0 ? (converted / total) * 100 : 0,
    },
  ];

  return (
    <div className="card-surface glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
            <Sparkles className="size-3.5 text-brand-cyan-deep" />
          </div>
          Lead Funnel ({period.toUpperCase()})
        </h2>
        <Link href="/dashboard/leads" className="text-xs text-brand-cyan-deep hover:underline font-medium">
          Pipeline →
        </Link>
      </div>
      <LeadFunnelChart data={funnelSteps} />
    </div>
  );
}
