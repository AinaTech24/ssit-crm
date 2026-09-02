/**
 * Public Onboarding Progress Visualizer — accessed via /onboarding/<token>.
 *
 * The client tracks their end-to-end onboarding status across the 30 stages
 * of the Lead → Client SOP in real-time. Bypasses standard authentication by
 * resolving a secure SHA-256 hashed share token from the URL.
 */

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ShieldCheck, AlertCircle } from "lucide-react";
import { withSystem } from "@/db/client";
import { tenants, leads, users } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { getStage } from "@/lib/blueprints/engine";
import { PublicOnboardingVisualizer } from "@/components/public/PublicOnboardingVisualizer";

export const dynamic = "force-dynamic";

export default async function PublicOnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let info: Awaited<ReturnType<typeof resolveShareToken>>;

  try {
    info = await resolveShareToken(token);
  } catch (e: any) {
    return <ErrorScreen message={e?.message ?? "This link is no longer valid"} />;
  }

  if (info.kind !== "onboarding_progress") {
    return <ErrorScreen message="This link is not an onboarding tracker." />;
  }

  // Load tenant branding, lead name, relationship manager and live stage details
  const data = await withSystem(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, info.tenantId));
    if (!tenant) return null;

    const [lead] = await tx.select().from(leads).where(eq(leads.id, info.subjectId));
    if (!lead) return null;

    // Fetch Relationship Manager details
    let rm = null;
    if (lead.ownerId) {
      const [u] = await tx
        .select({
          name: users.name,
          email: users.email,
          phone: users.phone,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, lead.ownerId))
        .limit(1);
      if (u) rm = u;
    }

    // Retrieve active stage information + transition history from the blueprint engine
    const stageDetails = await getStage(tx, info.tenantId, info.subjectId);

    return { tenant, lead, stageDetails, rm };
  });

  if (!data) {
    return <ErrorScreen message="Associated records could not be resolved." />;
  }

  // ARN is already stored with the "ARN-" prefix on some tenants — normalise so
  // we never render "ARN-ARN-…".
  const arnLabel = data.tenant.arn
    ? `ARN-${String(data.tenant.arn).replace(/^arn[\s-]*/i, "")}`
    : null;

  return (
    <div className="min-h-screen bg-slate-50 bg-gradient-to-br from-slate-50 via-white to-cyan-50/50 text-slate-800 relative overflow-hidden flex flex-col font-sans">
      {/* Soft brand wash */}
      <div className="absolute -top-20 left-1/4 size-[36rem] bg-cyan-300/20 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/5 size-[34rem] bg-indigo-300/15 rounded-full blur-[130px] pointer-events-none" />

      {/* Brand Header */}
      <header className="bg-white/75 border-b border-slate-200 backdrop-blur-md relative z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-brand-cyan" />
            <span className="font-semibold text-slate-900 tracking-tight">
              {data.tenant.displayName ?? data.tenant.legalName ?? "Onboarding Progress"}
            </span>
          </div>
          {arnLabel && (
            <div className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
              {arnLabel}
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-grow max-w-3xl w-full mx-auto px-4 py-8 relative z-10">
        <PublicOnboardingVisualizer
          recipientName={data.lead.name}
          tenant={data.tenant}
          stageDetails={data.stageDetails}
          rm={data.rm}
        />
      </main>

      {/* Footer */}
      <footer className="max-w-3xl mx-auto w-full px-4 py-6 text-[10px] text-slate-500 text-center relative z-10 border-t border-slate-200">
        Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
        {arnLabel ? (
          <>
            {" "}
            · {data.tenant.displayName ?? data.tenant.legalName} · {arnLabel}
          </>
        ) : null}
      </footer>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-50 bg-gradient-to-br from-slate-50 via-white to-cyan-50/50 grid place-items-center p-6 text-slate-800 relative font-sans">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-96 bg-rose-300/15 rounded-full blur-[80px] pointer-events-none" />
      <div className="max-w-md w-full bg-white/90 backdrop-blur-md rounded-2xl border border-slate-200 p-8 text-center shadow-lg relative z-10">
        <AlertCircle className="size-12 text-rose-500 mx-auto animate-pulse" />
        <h1 className="text-xl font-bold mt-4 text-slate-900">Link Unavailable</h1>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">{message}</p>
        <p className="text-xs text-slate-400 mt-6 leading-relaxed">
          Please reach out to your relationship manager or representative for assistance or a new link.
        </p>
      </div>
    </div>
  );
}
