import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ChevronLeft, Workflow, Plus, ChevronRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { blueprintDefinitions, blueprintStages } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { ensureCatalogSeeded } from "@/lib/blueprints/poly-engine";

export const dynamic = "force-dynamic";

export default async function BlueprintsAdminPage() {
  const session = await requireSession();

  // Ensure all 5 default blueprints exist for this tenant
  await withTenant(session.tenantId, async (tx) => ensureCatalogSeeded(tx, session.tenantId));

  const blueprints = await withTenant(session.tenantId, async (tx) => {
    const defs = await tx
      .select()
      .from(blueprintDefinitions)
      .where(eq(blueprintDefinitions.isActive, true))
      .orderBy(asc(blueprintDefinitions.moduleName));

    // Stage counts per blueprint
    const withCounts = await Promise.all(
      defs.map(async (d) => {
        const stages = await tx
          .select()
          .from(blueprintStages)
          .where(eq(blueprintStages.blueprintId, d.id))
          .orderBy(asc(blueprintStages.stageOrder));
        return { def: d, stages };
      })
    );
    return withCounts;
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/dashboard/settings" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ChevronLeft className="size-3" /> Back to settings
        </Link>
        <h1 className="page-title mt-2">
          <Workflow className="size-6 text-brand-cyan" /> Blueprint Editor
        </h1>
        <p className="page-subtitle">
          Customise the stage machines that drive every journey in the CRM — leads, service requests, complaints,
          SIP rejections, client reviews. Each blueprint is a sequence of stages with required fields, SLAs, and
          automation hooks.
        </p>
      </div>

      <div className="space-y-3">
        {blueprints.map(({ def, stages }) => (
          <Link
            key={def.id}
            href={`/dashboard/settings/blueprints/${def.id}`}
            className="card-surface block hover:bg-secondary/40 transition-colors"
          >
            <div className="p-4 flex items-start gap-4">
              <div className="size-10 rounded-lg bg-brand-cyan-light grid place-items-center flex-shrink-0">
                <Workflow className="size-5 text-brand-cyan-deep" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm">{def.blueprintName}</h3>
                  <span className="chip text-[10px] bg-secondary capitalize">{def.moduleName.replace(/_/g, " ")}</span>
                  <span className="chip text-[10px] bg-brand-cyan-light text-brand-cyan-deep">v{def.versionNumber}</span>
                </div>
                {def.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{def.description}</p>
                )}
                <div className="flex items-center gap-1.5 mt-2 overflow-x-auto">
                  {stages.map((s, i) => (
                    <span
                      key={s.stageKey}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/60 whitespace-nowrap"
                    >
                      {i + 1}. {s.stageName}
                      {s.slaDays != null && <span className="ml-1 text-muted-foreground">({s.slaDays}d)</span>}
                    </span>
                  ))}
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground flex-shrink-0" />
            </div>
          </Link>
        ))}
      </div>

      {blueprints.length === 0 && (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          No blueprints yet — they'll auto-seed when you first use the relevant module.
        </div>
      )}
    </div>
  );
}
