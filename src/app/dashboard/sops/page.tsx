import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Plus, ScrollText } from "lucide-react";
import { withTenant } from "@/db/client";
import { sops, sopVersions, sopAcknowledgements } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { sql } from "drizzle-orm";
import { formatRelative } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";

export const dynamic = "force-dynamic";

export default async function SopsPage() {
  const session = await requireSession();
  // Authoring/deletion is sop.manage-only; viewers see the library read-only.
  const canManage = can(session.roles, "sop.manage", session.permissions);
  const result = await withTenant(session.tenantId, async (tx) => {
    const sopRows = await tx
      .select({
        sop: sops,
        version: sopVersions,
        ackCount: sql<number>`(
          SELECT COUNT(*)::int FROM sop_acknowledgements ack
          WHERE ack.sop_version_id = ${sopVersions.id}
        )`,
      })
      .from(sops)
      .leftJoin(sopVersions, eq(sopVersions.id, sops.currentVersionId))
      // Tenant predicate — without it the list shows every tenant's SOPs.
      // Soft-deleted SOPs (deleted_at set) are hidden from the library.
      .where(and(eq(sops.tenantId, session.tenantId), isNull(sops.deletedAt)))
      .orderBy(desc(sops.updatedAt));
    return sopRows;
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SOP library</h1>
        </div>
        {canManage && (
          <Link
            href="/dashboard/sops/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> New SOP
          </Link>
        )}
      </div>

      <div className="border rounded-lg bg-card">
        {result.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <ScrollText className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No SOPs yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Recommended starter set: lead follow-up · client onboarding · SIP rejection handling ·
              service request · complaint handling · WhatsApp communication · email communication ·
              DDQ documentation.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {result.map((r) => (
              <li key={r.sop.id} className="p-4 hover:bg-accent/40">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Link
                      href={`/dashboard/sops/${r.sop.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.sop.title}
                    </Link>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{r.sop.key}</div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    {r.version && <span className="text-muted-foreground">v{r.version.versionNumber}</span>}
                    <span className="text-muted-foreground">{r.ackCount} signed</span>
                    {r.sop.requiredRoles && r.sop.requiredRoles.length > 0 && (
                      <span className="text-muted-foreground">for {r.sop.requiredRoles.join(", ")}</span>
                    )}
                    {r.version && <span className="text-muted-foreground">{formatRelative(r.version.publishedAt ?? r.version.createdAt)}</span>}
                    {canManage && (
                      <RowActions
                        editHref={`/dashboard/sops/${r.sop.id}`}
                        deleteUrl={`/api/sops/${r.sop.id}`}
                        itemLabel="SOP"
                        itemName={r.sop.title}
                      />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
