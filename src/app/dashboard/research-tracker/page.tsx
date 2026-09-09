import { FlaskConical } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { ActivityTracker } from "@/components/activity/ActivityTracker";
import { SendReportButton } from "@/components/activity/SendReportButton";

export const dynamic = "force-dynamic";

/** Daily research activity tracker — what was studied, on what topic. */
export default async function ResearchTrackerPage() {
  const session = await requireSession();
  requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FlaskConical className="size-6 text-brand-cyan" /> Daily activity tracker
        </h1>
        <SendReportButton defaultSubject="Research report" />
      </div>
      <ActivityTracker kind="research" />
    </div>
  );
}
