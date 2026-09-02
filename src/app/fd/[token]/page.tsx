/**
 * Public "Financial Health Check" — accessed via /fd/<token>. The lead/client
 * fills their own sections (no advisor assessment) before the meeting; on
 * submit it flows into the CRM discovery record. No-auth route.
 */

import { eq } from "drizzle-orm";
import { ClipboardList } from "lucide-react";
import { withSystem } from "@/db/client";
import { tenants, financialDiscoveries } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { PublicDiscoveryForm } from "@/components/public/PublicDiscoveryForm";
import type { DiscoveryData } from "@/lib/discovery/calc";

export const dynamic = "force-dynamic";

export default async function PublicDiscoveryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let info: Awaited<ReturnType<typeof resolveShareToken>>;
  try {
    info = await resolveShareToken(token);
  } catch (e: any) {
    return <ErrorScreen message={e?.message ?? "This link is no longer valid"} />;
  }
  if (info.kind !== "financial_discovery") return <ErrorScreen message="This link is not a financial health check." />;

  const discoveryId = (info.payload as any)?.discoveryId as string | undefined;
  if (!discoveryId) return <ErrorScreen message="This link is invalid." />;

  const data = await withSystem(async (tx) => {
    const [tenant] = await tx.select({ name: tenants.displayName, logo: tenants.logoUrl }).from(tenants).where(eq(tenants.id, info.tenantId));
    const [disc] = await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, discoveryId));
    return { tenant, disc };
  });
  if (!data.disc) return <ErrorScreen message="This form could not be found." />;

  const already = data.disc.status === "submitted" || data.disc.status === "reviewed";
  const initial = { ...(data.disc.data as any) };
  delete initial.assessment;
  delete initial.recommendations;

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex items-center gap-3 mb-5">
          {data.tenant?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.tenant.logo} alt={data.tenant.name ?? ""} className="h-9 w-auto" />
          ) : (
            <ClipboardList className="size-8 text-brand-cyan" />
          )}
          <div>
            <h1 className="text-lg font-bold">Financial Health Check</h1>
            <p className="text-xs text-muted-foreground">for {data.tenant?.name ?? "your advisor"}</p>
          </div>
        </div>

        {already ? (
          <div className="card-surface p-8 text-center">
            <h2 className="font-semibold">Thank you — your details are already submitted.</h2>
            <p className="text-sm text-muted-foreground mt-2">Your advisor will review them before your meeting. You can close this page.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
              This helps {data.tenant?.name ?? "your advisor"} understand your finances before you meet. It takes about
              10 minutes. Nothing is shared with anyone else — and your live financial health score updates as you fill it.
            </p>
            <PublicDiscoveryForm token={token} initialData={initial as DiscoveryData} firmName={data.tenant?.name ?? "your advisor"} />
          </>
        )}
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen grid place-items-center bg-secondary/30 p-6">
      <div className="card-surface p-8 max-w-md text-center">
        <h1 className="font-semibold text-lg">Link unavailable</h1>
        <p className="text-sm text-muted-foreground mt-2">{message}</p>
      </div>
    </div>
  );
}
