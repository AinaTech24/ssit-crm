import { Gift } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { EngagementBoard } from "@/components/engagement/EngagementBoard";

export const dynamic = "force-dynamic";

/**
 * Client engagement — the firm's gifting programme in one place.
 *
 * Reads are firm-wide (per-RM league table, firm-wide counters), so this needs
 * the firm-wide client capability rather than the assigned-only one an RM has —
 * the same bar the Referrals module uses. Logging a gift is gated separately:
 * anyone who can edit clients can log one, and the server attributes it from
 * the client record.
 */
export default async function EngagementPage() {
  const session = await requireSession();
  requireAny(session.roles, ["investor.view.all"], session.permissions);
  const canLog =
    can(session.roles, "investor.edit.all", session.permissions) ||
    can(session.roles, "investor.edit.assigned", session.permissions);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Gift className="size-5" /> Client engagement
        </h1>
        <p className="text-muted-foreground text-sm">
          Gifts sent to clients — what went out, from whose desk, and when.
        </p>
      </div>
      <EngagementBoard canLog={canLog} />
    </div>
  );
}
