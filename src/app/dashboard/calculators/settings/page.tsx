import Link from "next/link";
import { ArrowLeft, Settings2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadCalcAssumptions } from "@/lib/calculators/assumptions";
import { CalcAssumptionsForm } from "@/components/calculators/CalcAssumptionsForm";

export const dynamic = "force-dynamic";

export default async function CalculatorSettingsPage() {
  const session = await requireSession();
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const settings = await withTenant(session.tenantId, async (tx) => {
    return loadCalcAssumptions(tx, session.tenantId);
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/dashboard/calculators"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to calculators
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mt-2">
          <Settings2 className="size-6 text-brand-cyan" /> Calculator assumptions
        </h1>
      </div>

      <CalcAssumptionsForm initial={settings} canManage={canManage} />
    </div>
  );
}
