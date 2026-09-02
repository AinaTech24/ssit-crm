import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ChevronLeft, HeartHandshake, Target, Users, ShieldCheck, Sparkles } from "lucide-react";
import { withTenant } from "@/db/client";
import { families, investors, users, goals } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate, formatRelative } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { AddMemberDialog } from "@/components/families/AddMemberDialog";
import { RemoveMemberButton } from "@/components/families/RemoveMemberButton";
import { FamilyEditPanel } from "@/components/families/FamilyEditPanel";
import { FamilyHealthCard } from "@/components/families/FamilyHealthCard";
import { FamilyPortfolioAllocation } from "@/components/families/FamilyPortfolioAllocation";
import { FamilyTouchpoints } from "@/components/families/FamilyTouchpoints";
import { EngageNextGenButton } from "@/components/families/EngageNextGenButton";
import { FamilyTreeVisualizer } from "@/components/families/FamilyTreeVisualizer";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { CalendarPlus } from "lucide-react";
import { SuccessionReadiness } from "@/components/families/SuccessionReadiness";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  self: "Self / Head",
  spouse: "Spouse",
  father: "Father",
  mother: "Mother",
  son: "Son",
  daughter: "Daughter",
  sibling: "Sibling",
  huf_karta: "HUF Karta",
  huf_coparcener: "HUF Co-parcener",
  huf: "HUF Member",
  other: "Other",
};

export default async function FamilyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const fam = (await tx.select().from(families).where(eq(families.id, id)).limit(1))[0];
    if (!fam) return null;

    // Members
    const members = await tx.select().from(investors).where(and(eq(investors.familyId, id), isNull(investors.deletedAt)));

    // RM options for the edit panel — active users with 'rm' role in this tenant
    const rmOpts = await tx.execute(sql`
      SELECT id, name FROM users
      WHERE tenant_id = ${session.tenantId} AND status = 'active'
        AND (roles && ARRAY['rm','owner','branch_head']::text[])
      ORDER BY name
    `);

    // Family RM display
    const rm = fam.rmId
      ? (await tx.select({ id: users.id, name: users.name, email: users.email })
          .from(users).where(eq(users.id, fam.rmId)).limit(1))[0] ?? null
      : null;

    // Primary client (resolves NULL → first member with familyRole='self'/'head')
    let primary = null as any;
    if (fam.primaryInvestorId) {
      primary = members.find((m) => m.id === fam.primaryInvestorId) ?? null;
    }
    if (!primary) {
      primary = members.find((m) => m.familyRole === "self" || m.familyRole === "head") ?? members[0] ?? null;
    }

    // Aggregated family goals
    const memberIds = members.map((m) => m.id);
    const familyGoals =
      memberIds.length === 0
        ? []
        : (await tx.execute(sql`
            SELECT g.id, g.name, g.category, g.target_amount, g.current_value,
                   g.target_date, g.progress_pct, g.monthly_contribution, i.name AS member_name
            FROM goals g
            JOIN investors i ON i.id = g.investor_id
            WHERE g.investor_id IN (${sql.join(memberIds.map((mid) => sql`${mid}::uuid`), sql`, `)})
            ORDER BY g.target_date ASC NULLS LAST
            LIMIT 20
          `)).rows;

    return { family: fam, members, rm, primary, familyGoals, rmOpts: rmOpts.rows as Array<{ id: string; name: string }> };
  });
  if (!data) notFound();

  const totalAum = data.members.reduce((sum, m) => sum + Number(m.aum ?? 0), 0);
  const totalSip = data.members.reduce((sum, m) => sum + Number(m.activeSipAmount ?? 0), 0);

  // Computed status fields
  const membersWithNominee = data.members.filter((m) => m.nomineeName).length;
  const nomineePct =
    data.members.length > 0 ? Math.round((membersWithNominee / data.members.length) * 100) : 0;

  // Next-generation prospects: minors + members aged 18–30 not yet active investors.
  // Aged via DOB; "active" = has folios / SIPs / AUM > 0.
  const today = new Date();
  const nextGen = data.members.filter((m) => {
    if (!m.dob) return false;
    const dob = new Date(m.dob);
    const age = (today.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const inactive = Number(m.aum ?? 0) === 0;
    return (m.isMinor || (age >= 18 && age <= 30)) && inactive;
  });

  const familyName = data.family.familyName ?? data.family.headName;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/families" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
          <ChevronLeft className="size-4" /> Back to families
        </Link>
        {/* Schedule family review — deep-link into the meetings module
            pre-filled with this family. Family-level review meetings are
            already supported via review_meetings.familyId. */}
        <Link
          href={`/dashboard/review-meetings/new?familyId=${id}&meetingType=family_review`}
          className="rounded-md bg-brand-cyan text-white px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:opacity-90"
        >
          <CalendarPlus className="size-4" /> Schedule family review
        </Link>
      </div>

      {/* Header */}
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-lg bg-primary/10 grid place-items-center">
            <HeartHandshake className="size-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{familyName}</h1>
            <div className="text-xs text-muted-foreground mt-1 font-mono">
              Family ID {data.family.id.slice(0, 8)}…
            </div>
            <DownloadButton
              url={`/api/families/${data.family.id}/statement/pdf?download=1`}
              className="btn-secondary text-xs mt-2 inline-flex"
            >
              Download household statement (PDF)
            </DownloadButton>
            {data.family.notes && <p className="text-sm text-muted-foreground mt-2">{data.family.notes}</p>}
            <RecordProvenance
              entityType="family"
              entityId={data.family.id}
              createdAt={data.family.createdAt}
              updatedAt={data.family.updatedAt}
              className="mt-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-6 text-right">
            <div>
              <div className="text-xs text-muted-foreground">Combined AUM</div>
              <div className="text-xl font-bold">{formatINR(totalAum)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Combined SIP</div>
              <div className="text-xl font-bold">{formatINR(totalSip)}/mo</div>
            </div>
          </div>
        </div>
      </div>

      {/* Family Tree Visualizer */}
      <FamilyTreeVisualizer
        members={data.members as any}
        primaryInvestorId={data.family.primaryInvestorId}
      />

      {/* Composite family health — derived from already-loaded data */}
      <FamilyHealthCard
        family={data.family as any}
        members={data.members as any}
        familyId={id}
      />

      {/* Inline edit panel for the family-level fields */}
      <FamilyEditPanel
        family={JSON.parse(JSON.stringify(data.family))}
        members={data.members.map((m) => ({ id: m.id, name: m.name, pan: m.pan }))}
        rms={data.rmOpts}
      />

      {/* Top status row — primary, RM, review, nominee */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InfoCard
          icon={Users}
          label="Primary client"
          value={data.primary?.name ?? "Not set"}
          sub={data.primary ? (data.primary.pan ? `PAN ${data.primary.pan}` : "PAN not set") : "Link a head investor"}
          tone={!data.primary ? "warn" : undefined}
        />
        <InfoCard
          label="Family RM"
          value={data.rm?.name ?? "Not assigned"}
          sub={data.rm?.email ?? undefined}
          tone={!data.rm ? "warn" : undefined}
        />
        <InfoCard
          label="Family review"
          value={data.family.nextReviewAt ? formatDate(data.family.nextReviewAt) : "—"}
          sub={data.family.lastReviewAt ? `Last ${formatRelative(data.family.lastReviewAt)}` : "Never reviewed"}
          tone={
            data.family.nextReviewAt && new Date(data.family.nextReviewAt) < new Date()
              ? "warn"
              : undefined
          }
        />
        <InfoCard
          icon={ShieldCheck}
          label="Nominee coverage"
          value={`${nomineePct}%`}
          sub={`${membersWithNominee} of ${data.members.length} members`}
          tone={nomineePct < 100 ? "warn" : undefined}
        />
      </div>

      <SuccessionReadiness members={data.members} primaryInvestorId={data.family.primaryInvestorId} />

      {/* Members */}
      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 flex items-center justify-between">
          <div className="font-medium">Family members ({data.members.length})</div>
          <AddMemberDialog familyId={id} familyName={familyName} />
        </div>
        {data.members.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <HeartHandshake className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No members linked yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>Add member</strong> above to link an existing investor or create a new one
              under this family.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">Relation</th>
                <th className="text-left py-2 font-medium">PAN</th>
                <th className="text-left py-2 font-medium">Segment</th>
                <th className="text-right py-2 font-medium">AUM</th>
                <th className="text-right py-2 font-medium">SIP</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const isPrimary = m.id === data.family.primaryInvestorId || m.id === data.primary?.id;
                return (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar src={(m as any).avatarUrl ? `/api/investors/${m.id}/avatar` : null} name={m.name} size={26} />
                        <div>
                          <Link href={`/dashboard/investors/${m.id}`} className="font-medium hover:underline">
                            {m.name}
                          </Link>
                          {isPrimary && (
                            <span className="ml-2 text-[10px] uppercase font-semibold text-primary">
                              primary
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-xs">
                      {m.familyRole ? ROLE_LABELS[m.familyRole] ?? m.familyRole : "—"}
                    </td>
                    <td className="py-3 text-xs font-mono text-muted-foreground">{m.pan ?? "—"}</td>
                    <td className="py-3 text-xs">{m.segmentTag ?? "—"}</td>
                    <td className="py-3 text-right tabular-nums">{formatINR(Number(m.aum ?? 0))}</td>
                    <td className="py-3 text-right tabular-nums text-muted-foreground">
                      {Number(m.activeSipAmount ?? 0) > 0
                        ? formatINR(Number(m.activeSipAmount)) + "/mo"
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RemoveMemberButton familyId={id} investorId={m.id} investorName={m.name} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Combined family portfolio allocation — server-fetched roll-up of
          asset class + AMC concentration across all members */}
      <FamilyPortfolioAllocation
        session={session}
        memberIds={data.members.map((m) => m.id)}
      />

      {/* Touchpoint horizon — birthdays + anniversaries next 90 days */}
      <FamilyTouchpoints members={data.members as any} />

      {/* Family goals + Next-gen */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Target className="size-4" /> Family goals ({data.familyGoals.length})
          </h2>
          {data.familyGoals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No goals set across family members.
            </p>
          ) : (
            <ul className="space-y-4">
              {data.familyGoals.map((g: any) => {
                const pct = Number(g.progress_pct ?? 0);
                
                // Compounding calculations
                const targetDate = g.target_date ? new Date(g.target_date) : null;
                let N = 0;
                if (targetDate) {
                  const now = new Date();
                  const diffYears = targetDate.getFullYear() - now.getFullYear();
                  const diffMonths = targetDate.getMonth() - now.getMonth();
                  N = diffYears * 12 + diffMonths;
                }

                const currentVal = Number(g.current_value ?? 0);
                const sip = Number(g.monthly_contribution ?? 0);
                const targetAmount = Number(g.target_amount);

                let projectedValue = currentVal;
                let shortfall = 0;
                let neededIncrease = 0;

                if (targetDate && N > 0) {
                  const r = 0.10 / 12; // 10% expected return rate per annum
                  projectedValue = currentVal * Math.pow(1 + r, N) + sip * ((Math.pow(1 + r, N) - 1) / r);
                  if (projectedValue < targetAmount) {
                    shortfall = targetAmount - projectedValue;
                    neededIncrease = (shortfall * r) / (Math.pow(1 + r, N) - 1);
                  }
                }

                return (
                  <li key={g.id} className="border-b last:border-0 pb-3 last:pb-0">
                    <div className="flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium">{g.name}</span>{" "}
                        <span className="text-xs text-muted-foreground">· {g.member_name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatINR(Number(g.current_value ?? 0))} / {formatINR(Number(g.target_amount))}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                      <span>
                        {pct.toFixed(0)}% · target {g.target_date ? formatDate(g.target_date) : "—"} · {g.category.replace(/_/g, " ")}
                      </span>
                      {sip > 0 && <span className="tabular-nums font-mono text-[10px]">SIP: {formatINR(sip)}/mo</span>}
                    </div>
                    {shortfall > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                          ⚠️ Shortfall Projected: {formatINR(shortfall)}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                          Suggested step-up: +{formatINR(neededIncrease)}/mo
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Sparkles className="size-4" /> Next-generation prospects ({nextGen.length})
          </h2>
          {nextGen.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No next-gen opportunities. Every member is already active or out of the 18–30 window.
            </p>
          ) : (
            <ul className="divide-y">
              {nextGen.map((m) => (
                <li key={m.id} className="py-2 flex items-center justify-between text-sm">
                  <Link href={`/dashboard/investors/${m.id}`} className="hover:underline">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.familyRole ? ROLE_LABELS[m.familyRole] ?? m.familyRole : "—"} ·{" "}
                      {m.dob ? formatDate(m.dob) : "DOB unknown"}
                    </div>
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                      {m.isMinor ? "minor" : "next-gen"}
                    </span>
                    <EngageNextGenButton investorId={m.id} investorName={m.name} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "warn";
}) {
  return (
    <div className={`border rounded-lg bg-card p-4 ${tone === "warn" ? "border-amber-300" : ""}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className="font-medium mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
