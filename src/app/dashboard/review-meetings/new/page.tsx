import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronLeft, Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import { dataScopeSqlFor } from "@/lib/auth/data-scope";
import { ScheduleMeetingForm } from "@/components/review-meetings/ScheduleMeetingForm";

export const dynamic = "force-dynamic";

export default async function NewReviewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ investorId?: string; leadId?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();

  // Load both subject lists in parallel — the form decides which to show
  // based on the Lead | Client toggle.
  const { investors, leads, families } = await withTenant(session.tenantId, async (tx) => {
      // The same data wall the Clients and Leads lists use. Without it the
      // meeting scheduler's Client / Lead / Family pickers listed the WHOLE
      // firm — an RM could see (and book a meeting against) another RM's or
      // another desk's clients. A role with no client/lead visibility gets an
      // empty list rather than a 500.
      const invScope = await investorScopeSql(tx, session, "investors").catch(() => sql`FALSE`);
      const invScopeI = await investorScopeSql(tx, session, "i").catch(() => sql`FALSE`);
      const leadScope = await leadScopeSql(tx, session, "leads").catch(() => sql`FALSE`);
      const famScope = await dataScopeSqlFor(tx, session, {
        branch: "f.branch_id",
        owner: "f.rm_id",
      }).catch(() => sql`FALSE`);
    const [invRes, leadRes, famRes] = await Promise.all([
      tx.execute(sql`
        SELECT id, name, pan, segment_tag, last_review_at, next_review_at
        FROM investors
        WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND deleted_at IS NULL
          AND ${invScope}
        ORDER BY (next_review_at IS NULL) DESC, next_review_at ASC NULLS FIRST, name
        LIMIT 300
      `),
      tx.execute(sql`
        SELECT id, name, phone, stage
        FROM leads
        WHERE tenant_id = ${session.tenantId}::uuid AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold', 'not_interested')
            AND ${leadScope}
        ORDER BY updated_at DESC
        LIMIT 300
      `),
      // Families that have a primary investor — a family meeting attaches to the
      // primary investor + the familyId (family_review path).
      tx.execute(sql`
        SELECT f.id, f.family_name, f.primary_investor_id, i.name AS primary_name
        FROM families f
        JOIN investors i ON i.id = f.primary_investor_id
        WHERE f.tenant_id = ${session.tenantId}::uuid AND f.primary_investor_id IS NOT NULL
            AND (${famScope} OR ${invScopeI})
        ORDER BY f.family_name
        LIMIT 300
      `),
    ]);
    return { investors: invRes.rows as any[], leads: leadRes.rows as any[], families: famRes.rows as any[] };
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link
        href="/dashboard/review-meetings"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to review meetings
      </Link>

      <div className="card-surface p-6 flex items-start gap-4">
        <div className="size-12 rounded-lg bg-brand-cyan-light grid place-items-center">
          <Calendar className="size-6 text-brand-cyan" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Schedule review meeting</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A reminder task auto-fires the day before. After completion, action items become tasks.
          </p>
        </div>
      </div>

      <ScheduleMeetingForm
        investors={investors}
        leads={leads}
        families={families}
        preselectedInvestorId={sp.investorId}
        preselectedLeadId={sp.leadId}
        preselectedCategory={sp.category}
      />
    </div>
  );
}
