/**
 * Financial Discovery — in-meeting editor. Loads the fact-find and hands it to
 * the live-recalc editor. Gated to lead/client viewers.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { financialDiscoveries } from "@/db/schema";
import { DiscoveryEditor } from "@/components/discovery/DiscoveryEditor";
import type { DiscoveryData } from "@/lib/discovery/calc";

export const dynamic = "force-dynamic";

export default async function DiscoveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"], session.permissions);
  const { id } = await params;

  const disc = await withTenant(session.tenantId, async (tx) =>
    (await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, id)).limit(1))[0]
  );
  if (!disc) notFound();

  const subjectHref = disc.subjectType === "lead" ? `/dashboard/leads/${disc.subjectId}` : `/dashboard/investors/${disc.subjectId}`;

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Link href="/dashboard/discovery" className="hover:underline inline-flex items-center gap-1">
            <ChevronLeft className="size-3" /> Discovery &amp; Suitability
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">{disc.title || "Discovery & Suitability"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {disc.reviewType ? `${disc.reviewType} · ` : ""}
          <Link href={subjectHref} className="text-brand-cyan-deep hover:underline capitalize">{disc.subjectType} record →</Link>
        </p>
      </div>

      <DiscoveryEditor id={disc.id} initialData={(disc.data ?? {}) as DiscoveryData} status={disc.status} />
    </div>
  );
}
