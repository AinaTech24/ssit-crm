import Link from "next/link";
import { sql } from "drizzle-orm";
import { ShieldAlert, HeartPulse, Umbrella, IndianRupee, Users, FileText } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";
import { ModuleTabs, INSURANCE_TABS } from "@/components/common/ModuleTabs";

export const dynamic = "force-dynamic";

export default async function ProtectionGapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const canFirm = can(session.roles, "dashboard.view.owner", (session as any).permissions);
  const sp = await searchParams;
  const mine = sp.mine === "1" || !canFirm;
  const gap = sp.gap === "life" || sp.gap === "health" ? sp.gap : "";

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const own = mine ? sql` AND i.rm_id = ${session.userId}::uuid` : sql``;
      // A "covered" policy = active OR mid-purchase (proposed / in_underwriting),
      // so a client buying a policy isn't flagged as a gap (and nagged).
      const COVERED = sql`('active','proposed','in_underwriting')`;
      // Household-aware: the client is covered if THEY or any family member holds
      // an active/in-flight policy of that line (insurance is bought per family —
      // a spouse's floater covers the household, so don't false-flag the client).
      const covers = (types: ReturnType<typeof sql>) => sql`EXISTS (
        SELECT 1 FROM insurance_policies p
        WHERE p.tenant_id = i.tenant_id AND p.status IN ${COVERED} AND p.policy_type IN ${types}
          AND (p.investor_id = i.id
               OR (i.family_id IS NOT NULL AND p.investor_id IN (SELECT fm.id FROM investors fm WHERE fm.family_id = i.family_id)))
      )`;
      const base = sql`
        SELECT i.id, i.name, i.phone, i.whatsapp_phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.segment_tag,
          NOT ${covers(sql`('term','ulip','endowment','money_back','life_other')`)} AS life_gap,
          NOT ${covers(sql`('health','critical_illness')`)} AS health_gap,
          CASE i.segment_tag WHEN 'HNI' THEN 4 WHEN 'Corporate' THEN 4 WHEN 'NRI' THEN 3 WHEN 'Affluent' THEN 3 ELSE 1 END AS seg_rank
        FROM investors i
        WHERE i.tenant_id = ${session.tenantId}::uuid AND i.status='active' AND i.deleted_at IS NULL AND i.merged_into_id IS NULL${own}`;
      // Indicative recommended cover (₹) — a transparent segment-based floor, not
      // a precise HLV. Life: HNI/Corp ₹2Cr, NRI/Affluent ₹1Cr, else ₹50L.
      // Health floater: HNI/NRI/Corp ₹10L, else ₹5L.
      const lifeFloor = sql`(CASE g.segment_tag WHEN 'HNI' THEN 20000000 WHEN 'Corporate' THEN 20000000 WHEN 'NRI' THEN 10000000 WHEN 'Affluent' THEN 10000000 ELSE 5000000 END)`;
      const healthFloor = sql`(CASE WHEN g.segment_tag IN ('HNI','NRI','Corporate') THEN 1000000 ELSE 500000 END)`;
      const coverNeeded = sql`((CASE WHEN g.life_gap THEN ${lifeFloor} ELSE 0 END) + (CASE WHEN g.health_gap THEN ${healthFloor} ELSE 0 END))`;
      const rows = (await tx.execute(sql`
        SELECT g.*, ${coverNeeded}::numeric AS cover_needed FROM (${base}) g
        WHERE (g.life_gap OR g.health_gap)
          ${gap === "life" ? sql`AND g.life_gap` : gap === "health" ? sql`AND g.health_gap` : sql``}
        ORDER BY g.seg_rank DESC, g.aum DESC NULLS LAST, ${coverNeeded} DESC LIMIT 300`)).rows as any[];
      const stats = (await tx.execute(sql`
        SELECT COUNT(*) FILTER (WHERE life_gap)::int AS life, COUNT(*) FILTER (WHERE health_gap)::int AS health,
               COUNT(*) FILTER (WHERE life_gap AND health_gap)::int AS both,
               COALESCE(SUM(${coverNeeded}) FILTER (WHERE g.life_gap OR g.health_gap), 0)::numeric AS cover_gap
        FROM (${base}) g`)).rows[0] as any;
      return { rows, stats };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  const s = data.stats ?? {};

  const tab = (v: string, label: string, count: number) => (
    <Link href={v ? `/dashboard/insurance/protection-gap?gap=${v}${mine ? "&mine=1" : ""}` : `/dashboard/insurance/protection-gap${mine ? "?mine=1" : ""}`}
      className={`chip ${gap === v ? "bg-brand-cyan text-white" : "bg-secondary"}`}>{label} <strong className="ml-1">{count}</strong></Link>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ShieldAlert className="size-6 text-brand-cyan" /> Protection-Gap Radar</h1>
        </div>
        {canFirm && (
          <div className="inline-flex rounded-lg border bg-secondary/40 p-0.5 gap-0.5 text-xs">
            <Link href="/dashboard/insurance/protection-gap" className={`px-2.5 py-1 rounded-md font-medium ${!mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Firm-wide</Link>
            <Link href="/dashboard/insurance/protection-gap?mine=1" className={`px-2.5 py-1 rounded-md font-medium ${mine ? "bg-card shadow-sm" : "text-muted-foreground"}`}>My book</Link>
          </div>
        )}
      </div>

      <ModuleTabs tabs={INSURANCE_TABS} />

      <div className="flex flex-wrap gap-1.5">{tab("", "All gaps", data.rows.length)}{tab("life", "Life gap", Number(s.life ?? 0))}{tab("health", "Health gap", Number(s.health ?? 0))}</div>

      <div className="card-surface table-scroll">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No protection gaps {mine ? "in your book" : ""}. Every client is covered. 🛡️</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card"><tr><th className="text-left px-4 py-2 font-medium">Client</th><th className="text-left py-2 font-medium">Gaps</th><th className="text-right py-2 font-medium">Cover needed</th><th className="text-right py-2 font-medium">AUM</th><th className="text-right py-2 font-medium pr-4">Act</th></tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const first = String(r.name ?? "").split(" ")[0];
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td className="px-4 py-2.5"><Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:underline">{r.name}</Link>{r.segment_tag && <span className="ml-2 chip text-[10px] bg-violet-50 text-violet-700">{r.segment_tag}</span>}</td>
                    <td className="py-2.5">
                      <div className="flex gap-1">
                        {r.life_gap && <span className="chip text-[10px] bg-rose-50 text-rose-700">No life</span>}
                        {r.health_gap && <span className="chip text-[10px] bg-amber-50 text-amber-700">No health</span>}
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-medium" title="Indicative recommended cover — segment-based estimate">{Number(r.cover_needed) > 0 ? `~${formatINR(Number(r.cover_needed))}` : "—"}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">{Number(r.aum) > 0 ? formatINR(Number(r.aum)) : "—"}</td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center justify-end gap-2">
                        <ContactQuickActions phone={r.whatsapp_phone || r.phone} email={r.email} message={`Dear ${first}, as your advisor I'd like to make sure your family's protection is adequate. Can we do a quick insurance review?`} subject="Insurance protection review" show={["whatsapp", "call"]} />
                        <Link
                          href={`/dashboard/proposals/new?investorId=${r.id}&type=insurance`}
                          title="Draft an insurance proposal for this client"
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
                        >
                          <FileText className="size-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground italic">A &ldquo;gap&rdquo; means no active or in-progress policy of that type for the client <em>or anyone in their family</em>. &ldquo;Cover needed&rdquo; is an indicative segment-based estimate, not a precise Human Life Value — confirm with a needs analysis. Update the register to clear a gap.</p>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "rose" | "amber" | "emerald" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
