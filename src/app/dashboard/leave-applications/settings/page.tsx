import Link from "next/link";
import { ChevronLeft, CalendarCog } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadLeavePolicy } from "@/lib/leave/settings";
import { LeaveSettingsForm } from "@/components/leave/LeaveSettingsForm";

export const dynamic = "force-dynamic";

export default async function LeavePolicyPage() {
  const session = await requireSession();
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const data = await withTenant(session.tenantId, async (tx) => loadLeavePolicy(tx, session.tenantId));

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
        The paid-leave pool every employee earns month by month, plus quotas for the types that sit
        outside it. Per-employee overrides still apply.
      </p>
      <LeaveSettingsForm initial={data} canManage={canManage} />
    </div>
  );
}
