/**
 * AMFI DDQ Audit Checklist — the ~40-item due-diligence audit master, with
 * persisted per-item status and a live readiness %. Gated by compliance.edit.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { ddqChecklistStatus } from "@/db/schema";
import { DdqAuditChecklist } from "@/components/compliance/DdqAuditChecklist";
import type { DdqStatus } from "@/lib/compliance/amfi-ddq-checklist";

export const dynamic = "force-dynamic";

export default async function AuditChecklistPage() {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);

  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select({
        itemKey: ddqChecklistStatus.itemKey,
        status: ddqChecklistStatus.status,
        note: ddqChecklistStatus.note,
        documentId: ddqChecklistStatus.documentId,
      })
      .from(ddqChecklistStatus)
      .where(eq(ddqChecklistStatus.tenantId, session.tenantId));
  });

  const initialRecords = rows.map((r) => ({
    itemKey: r.itemKey,
    status: r.status as DdqStatus,
    note: r.note,
    documentId: r.documentId,
  }));

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Link href="/dashboard/compliance" className="hover:underline inline-flex items-center gap-1">
            <ChevronLeft className="size-3" /> Compliance
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">AMFI DDQ audit checklist</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          The full AMFI due-diligence audit master — every item mapped to its DDQ reference and the
          place in the platform where the evidence lives. Mark each as you prepare; readiness updates live.
        </p>
      </div>

      <DdqAuditChecklist initialRecords={initialRecords} />
    </div>
  );
}
