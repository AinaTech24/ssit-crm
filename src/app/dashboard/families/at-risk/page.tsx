import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronLeft, AlertTriangle, Users, Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";

/**
 * Next-gen pulse / inter-generational transfer risk page.
 *
 * Per research: ₹45 lakh crore of HNI wealth transferring to Gen X/millennials
 * over the next two decades. Natixis data: retention drops to ~45% at
 * generational handoff when relationship is single-threaded.
 *
 * This page surfaces families where:
 *   - head is over 60 (DOB-based)
 *   - OR family has no member under 35
 *   - AND combined AUM > ₹50L
 *
 * For each, shows whether the kids/spouse are already onboarded as separate
 * investors with their own SIPs — the single best predictor of post-transfer
 * retention.
 */
export const dynamic = "force-dynamic";

export default async function FamiliesAtRiskPage() {
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      WITH fam_stats AS (
        SELECT
          f.id, f.head_name, f.notes,
          COUNT(i.id) FILTER (WHERE i.status = 'active') AS member_count,
          COUNT(i.id) FILTER (WHERE i.dob IS NOT NULL
            AND date_part('year', age(i.dob)) >= 60) AS members_60_plus,
          COUNT(i.id) FILTER (WHERE i.dob IS NOT NULL
            AND date_part('year', age(i.dob)) < 35) AS members_under_35,
          COUNT(i.id) FILTER (WHERE i.active_sip_amount::numeric > 0
            AND i.dob IS NOT NULL AND date_part('year', age(i.dob)) < 40) AS young_with_sip,
          COALESCE(SUM(i.aum::numeric), 0) AS family_aum,
          MAX(date_part('year', age(i.dob))) FILTER (WHERE i.dob IS NOT NULL) AS eldest_age,
          MIN(date_part('year', age(i.dob))) FILTER (WHERE i.dob IS NOT NULL) AS youngest_age
        FROM families f
        LEFT JOIN investors i ON i.family_id = f.id
        GROUP BY f.id
      )
      SELECT * FROM fam_stats
      WHERE family_aum >= 5000000
        AND (members_60_plus > 0 OR members_under_35 = 0)
      ORDER BY family_aum DESC
    `);
    return rows.rows as any[];
  });

  function riskLevel(row: any): { label: string; color: string; advice: string } {
    const aum = Number(row.family_aum);
    const has60Plus = Number(row.members_60_plus) > 0;
    const youngOnboarded = Number(row.young_with_sip) > 0;

    if (has60Plus && !youngOnboarded && aum > 20000000) {
      return {
        label: "HIGH RISK",
        color: "bg-rose-50 text-rose-700 border-rose-300",
        advice: "Eldest is 60+, no next-gen onboarded, ₹2Cr+ AUM. Schedule family review.",
      };
    }
    if (has60Plus && !youngOnboarded) {
      return {
        label: "MEDIUM",
        color: "bg-amber-50 text-amber-700 border-amber-300",
        advice: "Onboard children/heirs with their own SIPs before transfer.",
      };
    }
    if (has60Plus && youngOnboarded) {
      return {
        label: "PROTECTED",
        color: "bg-emerald-50 text-emerald-700 border-emerald-300",
        advice: "Next-gen already onboarded — keep them engaged.",
      };
    }
    return {
      label: "WATCH",
      color: "bg-blue-50 text-blue-700 border-blue-300",
      advice: "No younger family member yet — opportunity to introduce next-gen.",
    };
  }

  const high = data.filter((r) => riskLevel(r).label === "HIGH RISK").length;
  const medium = data.filter((r) => riskLevel(r).label === "MEDIUM").length;

  return (
    <div className="space-y-6 max-w-7xl">
      <Link href="/dashboard/families" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to families
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <AlertTriangle className="size-6 text-amber-600" /> Next-gen pulse
        </h1>
        <p className="text-muted-foreground text-sm">
          Industry research: ~₹45 lakh crore in HNI wealth will transfer to the next generation
          over the next 20 years. <strong>Retention drops to ~45%</strong> when the relationship is
          single-threaded. Onboarding heirs as their own investors with their own SIPs is the single
          best predictor of post-transfer retention.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Families at risk (AUM ≥ ₹50L)" value={data.length} />
        <Stat label="HIGH risk (action needed)" value={high} tone="rose" />
        <Stat label="MEDIUM risk" value={medium} tone="amber" />
      </div>

      <div className="border rounded-lg bg-card">
        {data.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Users className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No families flagged. ✓</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              You're either well-protected or your firm is too new for this signal. Map your top
              clients into families to surface intergenerational risk.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Family</th>
                <th className="text-left py-2 font-medium">Risk</th>
                <th className="text-right py-2 font-medium">Combined AUM</th>
                <th className="text-right py-2 font-medium">Members</th>
                <th className="text-right py-2 font-medium">Age span</th>
                <th className="text-left py-2 font-medium pl-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const risk = riskLevel(r);
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/families/${r.id}`} className="font-medium hover:underline">
                        {r.head_name}
                      </Link>
                    </td>
                    <td className="py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${risk.color}`}>{risk.label}</span>
                    </td>
                    <td className="py-3 text-right tabular-nums">{formatINR(Number(r.family_aum))}</td>
                    <td className="py-3 text-right tabular-nums">{r.member_count}</td>
                    <td className="py-3 text-right text-xs text-muted-foreground">
                      {r.youngest_age != null && r.eldest_age != null
                        ? `${Math.round(Number(r.youngest_age))}–${Math.round(Number(r.eldest_age))} yrs`
                        : "—"}
                    </td>
                    <td className="py-3 pl-3 text-xs text-muted-foreground max-w-md">{risk.advice}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border rounded-lg bg-blue-50 border-blue-200 p-4 text-sm">
        <div className="font-medium flex items-center gap-2 text-blue-900">
          <Calendar className="size-4" /> Recommended workflow
        </div>
        <ol className="mt-2 list-decimal list-inside space-y-1 text-blue-900/80">
          <li>For each HIGH/MEDIUM risk family, schedule a family review meeting.</li>
          <li>Onboard heirs as separate investors with their own first SIP (₹500–5,000/mo).</li>
          <li>Run an annual joint family review covering wills, nominees, and goals.</li>
          <li>Send the next-gen drip — quarterly tax tips + market commentary in their voice.</li>
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "rose" | "amber" }) {
  const color = tone === "rose" && value > 0 ? "text-rose-600" : tone === "amber" && value > 0 ? "text-amber-600" : "text-foreground";
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
