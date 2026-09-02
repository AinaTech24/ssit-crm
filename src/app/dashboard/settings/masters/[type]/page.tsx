import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { masterValues } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { MASTER_SEEDS } from "@/lib/masters/seeds";
import { MasterValuesEditor } from "@/components/masters/MasterValuesEditor";

const MASTER_TITLES: Record<string, string> = {
  lead_source: "Lead Sources",
  campaign_type: "Campaign Types",
  service_request_type: "Service Request Types",
  task_priority: "Task Priority Levels",
  client_category: "Client Categories",
  goal_type: "Goal Types",
  risk_profile_level: "Risk Profile Levels",
  ddq_checklist_item: "DDQ Checklist Items",
  document_type: "Document Types",
  user_role: "User Roles",
  interest_product: "Interest Products",
  occupation: "Occupations",
  income_range: "Income Ranges",
  meeting_type: "Meeting Types",
  relationship: "Family Relationships",
};

export const dynamic = "force-dynamic";

export default async function MasterTypePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const title = MASTER_TITLES[type];
  if (!title) notFound();

  const session = await requireSession();
  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select()
      .from(masterValues)
      .where(eq(masterValues.masterType, type as any))
      .orderBy(asc(masterValues.sortOrder), asc(masterValues.label));
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/settings/masters"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to masters
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} values · {rows.filter((r) => r.isSystemDefault).length} system defaults
        </p>
      </div>

      <MasterValuesEditor masterType={type} initialValues={JSON.parse(JSON.stringify(rows))} />
    </div>
  );
}
