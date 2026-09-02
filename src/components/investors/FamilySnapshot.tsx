import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Family Snapshot — shows other members of the same family, combined AUM
 * and SIP book. Wealth practices are family-centric and the platform was
 * already linking familyId, but nothing showed it on the client detail
 * page until now.
 *
 * Auto-hides when familyId is null.
 */
export async function FamilySnapshot({
  session,
  familyId,
  familyName,
  currentInvestorId,
}: {
  session: SessionUser;
  familyId: string | null;
  familyName: string | null;
  currentInvestorId: string;
}) {
  if (!familyId) return null;

  const members = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        SELECT
          id, name, family_role, segment_tag, service_tier, status,
          COALESCE(aum::numeric, 0) AS aum,
          COALESCE(active_sip_amount::numeric, 0) AS active_sip,
          dob,
          kyc_status,
          nominee_name,
          ckyc_expiry_at
        FROM investors
        WHERE family_id = ${familyId} AND deleted_at IS NULL
        ORDER BY
          CASE family_role WHEN 'primary' THEN 0 WHEN 'spouse' THEN 1 ELSE 2 END,
          aum::numeric DESC NULLS LAST
      `);
      return r.rows as any[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  if (members.length === 0) return null;

  const totalAum = members.reduce((s, m) => s + Number(m.aum ?? 0), 0);
  const totalSip = members.reduce((s, m) => s + Number(m.active_sip ?? 0), 0);
  const activeCount = members.filter((m) => m.status === "active").length;

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-brand-cyan-light grid place-items-center">
            <Users2 className="size-3.5 text-brand-cyan-deep" />
          </div>
          Family snapshot
          {familyName && (
            <span className="text-xs font-normal text-muted-foreground">
              · {familyName}
            </span>
          )}
        </h2>
        <Link
          href="/dashboard/families"
          className="text-xs text-brand-cyan-deep hover:underline font-semibold"
        >
          Families →
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-secondary/40 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Members
          </div>
          <div className="text-xl font-bold mt-1 tabular-nums">
            {members.length}{" "}
            <span className="text-[10px] text-muted-foreground font-normal">
              ({activeCount} active)
            </span>
          </div>
        </div>
        <div className="bg-emerald-50/50 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
            Combined AUM
          </div>
          <div className="text-xl font-bold text-emerald-700 mt-1 tabular-nums">
            {formatINR(totalAum)}
          </div>
        </div>
        <div className="bg-violet-50/50 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-violet-700 font-semibold">
            Combined monthly SIP
          </div>
          <div className="text-xl font-bold text-violet-700 mt-1 tabular-nums">
            {formatINR(totalSip)}
          </div>
        </div>
      </div>

      <ul className="divide-y">
        {members.map((m) => {
          const isSelf = m.id === currentInvestorId;
          const hasKycGaps = m.kyc_status !== "verified" || (m.ckyc_expiry_at && new Date(m.ckyc_expiry_at).getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000);
          const hasNomineeGaps = !m.nominee_name;
          return (
            <li
              key={m.id}
              className={`py-2 flex items-center justify-between text-sm ${
                isSelf ? "bg-brand-cyan-light/30 -mx-2 px-2 rounded" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                {isSelf ? (
                  <span className="font-semibold">{m.name}</span>
                ) : (
                  <Link
                    href={`/dashboard/investors/${m.id}`}
                    className="font-semibold hover:underline"
                  >
                    {m.name}
                  </Link>
                )}
                <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1.5 mt-0.5">
                  {m.family_role && (
                    <span className="chip bg-secondary text-[10px] py-0.5 px-1.5 capitalize">
                      {m.family_role}
                    </span>
                  )}
                  {m.segment_tag && (
                    <span className="chip bg-violet-50 text-violet-700 text-[10px] py-0.5 px-1.5">
                      {m.segment_tag}
                    </span>
                  )}
                  {m.service_tier && (
                    <span className="chip bg-emerald-50 text-emerald-700 text-[10px] py-0.5 px-1.5">
                      Tier {m.service_tier}
                    </span>
                  )}
                  {m.status && m.status !== "active" && (
                    <span className="chip bg-rose-50 text-rose-700 text-[10px] py-0.5 px-1.5 capitalize">
                      {m.status}
                    </span>
                  )}
                  {hasKycGaps && (
                    <span className="chip bg-rose-50 text-rose-700 border border-rose-200 text-[10px] py-0.5 px-1.5 rounded-full font-medium">
                      ⚠️ KYC Gaps
                    </span>
                  )}
                  {hasNomineeGaps && (
                    <span className="chip bg-rose-50 text-rose-700 border border-rose-200 text-[10px] py-0.5 px-1.5 rounded-full font-medium">
                      ⚠️ Missing Nominee
                    </span>
                  )}
                  {isSelf && (
                    <span className="chip bg-brand-cyan text-white text-[10px] py-0.5 px-1.5 font-semibold">
                      You
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold tabular-nums">
                  {formatINR(Number(m.aum))}
                </div>
                {Number(m.active_sip) > 0 && (
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    SIP {formatINR(Number(m.active_sip))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {members.length === 1 && (
        <p className="text-[11px] text-muted-foreground mt-3 italic">
          Only one member captured — onboarding spouse/children is one of the
          fastest wallet-share wins.
        </p>
      )}
    </div>
  );
}
