import Link from "next/link";
import { eq } from "drizzle-orm";
import { ChevronLeft, Palette } from "lucide-react";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { AppearanceThemeForm } from "@/components/settings/AppearanceThemeForm";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  const session = await requireSession();

  const tenant = await withTenant(session.tenantId, async (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1).then((r) => r[0])
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <Link
        href="/dashboard/settings"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to settings
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Palette className="size-5" /> Appearance &amp; theme
        </h1>
        <p className="text-muted-foreground text-sm">
          Re-skin the CRM to your brand. Pick a preset or two custom colours — the change applies to your whole
          workspace and to the creatives you download.
        </p>
      </div>

      <AppearanceThemeForm tenant={JSON.parse(JSON.stringify(tenant))} />
    </div>
  );
}
