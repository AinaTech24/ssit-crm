/**
 * MFD Tech Stack register (Network FP "MFD Tech Stack" + Login/Access +
 * Renewal trackers). Records the firm's tools — satisfies AMFI DDQ III.1
 * (platform used) and VI.4 (software/apps list). Gated by reports.commission.
 */

import { asc, eq } from "drizzle-orm";
import { Server } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { techStackTools } from "@/db/schema";
import { TechStackRegister } from "@/components/tech-stack/TechStackRegister";

export const dynamic = "force-dynamic";

export default async function TechStackPage() {
  const session = await requireSession();
  requireCap(session.roles, "reports.commission", session.permissions);

  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select()
      .from(techStackTools)
      .where(eq(techStackTools.tenantId, session.tenantId))
      .orderBy(asc(techStackTools.category), asc(techStackTools.toolName));
  });

  const serialised = rows.map((r) => ({
    id: r.id,
    category: r.category,
    toolName: r.toolName,
    purpose: r.purpose ?? null,
    vendorUrl: r.vendorUrl ?? null,
    accessNote: r.accessNote ?? null,
    status: r.status,
    annualCost: r.annualCost != null ? String(r.annualCost) : null,
    renewalDate: r.renewalDate ? String(r.renewalDate) : null,
    notes: r.notes ?? null,
  }));

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Server className="size-6 text-brand-cyan" /> MFD Tech Stack
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          A single register of the platforms and software your firm uses — purpose, access, cost and
          renewals. Doubles as your AMFI DDQ evidence for "platform used" and "software/apps list".
        </p>
      </div>

      <TechStackRegister initial={serialised} />
    </div>
  );
}
