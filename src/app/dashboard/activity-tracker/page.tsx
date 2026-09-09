import { Megaphone } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { ActivityTracker } from "@/components/activity/ActivityTracker";

export const dynamic = "force-dynamic";

/**
 * Marketing activity tracker — what was produced, for whom, for which event.
 *
 * Gated on the task capabilities rather than a new one: everyone who logs or
 * reviews this work already holds them, and inventing a capability nobody is
 * granted would just make the page unreachable.
 */
export default async function ActivityTrackerPage() {
  const session = await requireSession();
  requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Megaphone className="size-6 text-brand-cyan" /> Activity tracker
        </h1>
      </div>
      <ActivityTracker kind="marketing" />
    </div>
  );
}
