import Link from "next/link";
import { and, asc, eq, ne } from "drizzle-orm";
import { ChevronLeft, Target } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { getMonthAchievements, currentMonthBounds } from "@/lib/targets/achievement";
import { TargetsManager, type MemberTarget } from "./TargetsManager";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

export default async function TargetsSettingsPage() {
  const session = await requireSession();
  const manager = isManager(session.roles);
  const { startISO, endISO, label } = currentMonthBounds();

  const members = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        name: users.name,
        annualTarget: users.annualTarget,
        sipMonthlyTarget: users.sipMonthlyTarget,
        newMeetingsMonthlyTarget: users.newMeetingsMonthlyTarget,
        renewalMeetingsMonthlyTarget: users.renewalMeetingsMonthlyTarget,
      })
      .from(users)
      .where(
        and(
          eq(users.tenantId, session.tenantId),
          ne(users.status, "suspended"),
          manager ? undefined : eq(users.id, session.userId)
        )
      )
      .orderBy(asc(users.name));

    const ach = await getMonthAchievements(tx, session.tenantId, startISO, endISO);
    return rows.map<MemberTarget>((r) => ({
      id: r.id,
      name: r.name ?? "—",
      annualTarget: r.annualTarget != null ? Number(r.annualTarget) : null,
      sipMonthlyTarget: r.sipMonthlyTarget != null ? Number(r.sipMonthlyTarget) : null,
      newMeetingsMonthlyTarget: r.newMeetingsMonthlyTarget ?? null,
      renewalMeetingsMonthlyTarget: r.renewalMeetingsMonthlyTarget ?? null,
      achievedBusiness: ach.businessByRm[r.id] ?? 0,
      achievedNewMeetings: ach.newMeetingsByRm[r.id] ?? 0,
      achievedRenewalMeetings: ach.renewalMeetingsByRm[r.id] ?? 0,
    }));
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Target className="size-5 text-brand-cyan" /> Targets &amp; quota
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set monthly business, new-meeting and renewal-meeting targets{" "}
          {manager ? "for your team" : "for yourself"}. Achievement is for{" "}
          <span className="font-medium text-foreground">{label}</span> (month-to-date).
        </p>
      </div>

      <TargetsManager members={members} canEditAll={manager} selfId={session.userId} monthLabel={label} />
    </div>
  );
}
