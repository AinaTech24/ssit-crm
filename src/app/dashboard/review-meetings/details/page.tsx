import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { AdminRmReviewSection } from "@/components/dashboards/AdminRmReviewSection";

export const dynamic = "force-dynamic";

/**
 * Meeting details — the RM-by-RM table of meetings held, upcoming and reviews
 * overdue. The admin sees the whole firm; a branch head sees their own branch or
 * desk (the section applies the same data wall as the meetings list).
 */
export default async function MeetingDetailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const allowed =
    session.roles.includes("owner") ||
    session.roles.includes("branch_head") ||
    can(session.roles, "dashboard.view.owner", session.permissions);
  if (!allowed) redirect("/dashboard/review-meetings");
  const sp = await searchParams;

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">
          <BarChart3 className="size-6 text-brand-cyan" /> Meeting details
        </h1>
        <Link
          href="/dashboard/review-meetings"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to meetings
        </Link>
      </div>
      {await AdminRmReviewSection({ session, rmId: sp.rm || undefined })}
    </div>
  );
}
