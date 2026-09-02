import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { SubDistributorForm } from "@/components/sub-distributors/SubDistributorForm";

export const dynamic = "force-dynamic";

export default async function NewSubDistributorPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link
          href="/dashboard/sub-distributors"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> Sub-distributors
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Register a sub-distributor</h1>
        <p className="text-sm text-muted-foreground mt-1">
          External channel partner who sources business under your ARN. ARN /
          EUIN / NISM details feed the daily expiry tracker.
        </p>
      </div>
      <SubDistributorForm mode="create" />
    </div>
  );
}
