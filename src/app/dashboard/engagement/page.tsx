import Link from "next/link";
import { Gift, FileUp } from "lucide-react";
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
  // An RM opens this for their OWN clients — the board's queries are walled by
  // the client data scope, so "can see the module" no longer means "can see the
  // firm's whole gift log".
  requireAny(
    session.roles,
    ["investor.view.all", "investor.view.assigned", "gifting.manage"],
    session.permissions
  );
  const canLog =
    can(session.roles, "investor.edit.all", session.permissions) ||
    can(session.roles, "investor.edit.assigned", session.permissions) ||
    // The gifting desk logs gifts without holding client-edit rights.
    can(session.roles, "gifting.manage", session.permissions);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Gift className="size-5" /> Client engagement
          </h1>
          <p className="text-muted-foreground text-sm">
            Gifts sent to clients — what went out, from whose desk, and when.
          </p>
        </div>
        {/* Gifting runs in batches — a festival list, a birthday month — so the
            upload sits beside the board rather than behind the single-gift
            form. */}
        {canLog && (
          <Link href="/dashboard/engagement/import" className="btn-secondary text-sm">
            <FileUp className="size-4" /> Bulk upload gifts
          </Link>
        )}
      </div>
      <EngagementBoard canLog={canLog} />
    </div>
  );
}
