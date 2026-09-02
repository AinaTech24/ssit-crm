import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeft, Settings2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { attendanceSettings } from "@/db/schema";
import { loadAttendancePolicy } from "@/lib/attendance/settings";
import { AttendanceSettingsForm } from "@/components/attendance/AttendanceSettingsForm";

export const dynamic = "force-dynamic";

export default async function AttendanceSettingsPage() {
  const session = await requireSession();
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const settings = await withTenant(session.tenantId, async (tx) => {
    const policy = await loadAttendancePolicy(tx, session.tenantId);
    const row = (
      await tx
        .select({ requireGeo: attendanceSettings.requireGeo })
        .from(attendanceSettings)
        .where(eq(attendanceSettings.tenantId, session.tenantId))
        .limit(1)
    )[0];
    return { ...policy, requireGeo: row?.requireGeo ?? false };
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/dashboard/attendance"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to attendance
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mt-2">
          <Settings2 className="size-6 text-brand-cyan" /> Attendance settings
        </h1>
        <p className="text-muted-foreground text-sm">
          Work hours, grace period, half/full-day thresholds, and weekly offs. Drives late /
          early-out flags across the firm.
        </p>
      </div>

      <AttendanceSettingsForm initial={settings} canManage={canManage} />
    </div>
  );
}
