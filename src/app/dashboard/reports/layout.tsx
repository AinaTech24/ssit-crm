import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

/**
 * Coarse gate for the entire Reports & MIS area. The /reports tree is MIXED:
 *   - manager-grade MIS (catalog, business-mis, net-sales, efforts, …) — firm
 *     financials + per-RM performance, restricted to the report audience.
 *   - RM-facing insight tools (churn-risk, tax-harvesting, cross-sell) that a
 *     plain RM legitimately uses on their own book.
 * So this layout only keeps OUT roles with no business reason to be here
 * (marketing, investor-portal, etc.); it admits anyone holding a reports OR
 * investor-view capability. Fine-grained control is enforced per-surface:
 *   - manager-only DATA APIs each require reports.business/reports.manage;
 *   - manager-only INLINE pages (e.g. business-mis) gate themselves;
 *   - RM tools scope their own queries to the caller's book.
 */
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const allowed =
    can(session.roles, "reports.business", session.permissions) ||
    can(session.roles, "reports.manage", session.permissions) ||
    can(session.roles, "reports.team", session.permissions) ||
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "investor.view.assigned", session.permissions);
  if (!allowed) redirect("/dashboard");
  return <>{children}</>;
}
