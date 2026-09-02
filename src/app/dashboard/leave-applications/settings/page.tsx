import Link from "next/link";
import { eq } from "drizzle-orm";
import { ChevronLeft, CalendarCog } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadLeaveEntitlements } from "@/lib/leave/settings";
import { leaveSettings } from "@/db/schema";
import { LeaveSettingsForm } from "@/components/leave/LeaveSettingsForm";

export const dynamic = "force-dynamic";

export default async function LeavePolicyPage() {
  const session = await requireSession();
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const data = await withTenant(session.tenantId, async (tx) => {
    const entitlements = await loadLeaveEntitlements(tx, session.tenantId);
    const row = (
      await tx.select({ c: leaveSettings.carryForwardEarned }).from(leaveSettings).where(eq(leaveSettings.tenantId, session.tenantId)).limit(1)
    )[0];
    return { entitlements, carryForwardEarned: row?.c ?? false };
  });

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/dashboard/leave-applications" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to leave applications
      </Link>
      <div className="flex items-center gap-2">
        <CalendarCog className="size-6 text-brand-cyan" />
        <h1 className="text-2xl font-bold tracking-tight">Leave policy</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Firm-wide annual entitlement (days) per leave type. Per-employee overrides still apply.
      </p>
      <LeaveSettingsForm initial={data} canManage={canManage} />
    </div>
  );
}
