/**
 * Start a new risk profile for an investor.
 *
 *   /dashboard/risk-profiles/new?investorId=<uuid>   — go straight to wizard
 *   /dashboard/risk-profiles/new                     — pick an investor first
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ChevronLeft, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { RiskProfileWizard } from "@/components/risk-profile/RiskProfileWizard";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { loadActiveTemplate } from "@/lib/risk-profile/template";

export const dynamic = "force-dynamic";

export default async function NewRiskProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ investorId?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();

  // No investor selected → show a picker
  if (!sp.investorId) {
    // Search runs in SQL, not on the rendered list: the picker is capped at 200
    // rows and sorted "never profiled first", so a client-side filter could
    // never reach a client outside that window.
    const q = (sp.q ?? "").trim();
    const searchCond = q
      ? sql`AND (i.name ILIKE ${`%${q}%`} OR i.pan ILIKE ${`%${q}%`})`
      : sql``;

    const list = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT i.id, i.name, i.pan, i.segment_tag, i.risk_profile, i.risk_profile_signed_at
        FROM investors i
        WHERE i.status = 'active' AND i.deleted_at IS NULL
        ${searchCond}
        ORDER BY (i.risk_profile_signed_at IS NULL) DESC, i.risk_profile_signed_at ASC NULLS FIRST, i.name
        LIMIT 200
      `);
      return r.rows as any[];
    });

    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link
          href="/dashboard/risk-profiles"
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Back to risk profiles
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Start a new risk profile</h1>
        </div>
        <CompactFilterBar
          searchPlaceholder="Search clients by name or PAN…"
          filters={[]}
          totalCount={list.length}
        />
        <div className="card-surface overflow-hidden">
          {list.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Users className="size-8 mx-auto text-muted-foreground/50" />
              <div className="mt-2">
                {q ? `No active client matches “${q}”.` : "No active investors yet."}
              </div>
            </div>
          ) : (
            <ul className="divide-y">
              {list.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/dashboard/risk-profiles/new?investorId=${i.id}`}
                    className="block px-4 py-3 hover:bg-secondary/60 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">{i.pan}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs">
                        {i.risk_profile ? (
                          <span className="capitalize">{i.risk_profile}</span>
                        ) : (
                          <span className="text-amber-600 font-medium">Not profiled</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {i.risk_profile_signed_at
                          ? `Last ${new Date(i.risk_profile_signed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                          : "Never"}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // Load the investor + the active tenant template + launch wizard
  const { investor, template } = await withTenant(session.tenantId, async (tx) => {
    const inv = (await tx.select().from(investors).where(eq(investors.id, sp.investorId!)).limit(1))[0] ?? null;
    const tpl = await loadActiveTemplate(tx, session.tenantId);
    return { investor: inv, template: tpl };
  });
  if (!investor) notFound();

  return (
    <RiskProfileWizard
      investor={{
        id: investor.id,
        name: investor.name,
        pan: investor.pan,
        dob: investor.dob ? new Date(investor.dob).toISOString() : null,
      }}
      template={{
        name: template.name,
        description: template.description,
        questions: template.questions,
        bands: template.bands,
        reviewIntervalDays: template.reviewIntervalDays,
      }}
    />
  );
}
