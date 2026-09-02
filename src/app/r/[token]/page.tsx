/**
 * Public risk-profile questionnaire — accessed via /r/<token>.
 *
 * The MFD's RM creates a share_token for the lead/investor and shares the URL
 * via WhatsApp / email. The client lands here without logging in, fills the
 * questionnaire scored against the MFD's published template, and submits.
 *
 * No-auth route — uses `resolveShareToken` (withSystem) to look up the token,
 * then loads the tenant's template through the same withSystem context.
 */

import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { withSystem } from "@/db/client";
import { tenants, leads, investors, riskProfileTemplates } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { defaultTemplate, RiskTemplateSchema } from "@/lib/risk-profile/template";
import { PublicRiskForm } from "@/components/public/PublicRiskForm";

export const dynamic = "force-dynamic";

export default async function PublicRiskFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let info: Awaited<ReturnType<typeof resolveShareToken>>;
  try {
    info = await resolveShareToken(token);
  } catch (e: any) {
    return <ErrorScreen message={e?.message ?? "This link is no longer valid"} />;
  }
  if (info.kind !== "risk_profile") {
    return <ErrorScreen message="This link is not a risk-profile form." />;
  }

  // Load tenant branding + the recipient name + active template
  const data = await withSystem(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, info.tenantId));
    let recipientName = "";
    let subjectEmail: string | null = null;
    if (info.subjectType === "lead") {
      const [l] = await tx.select().from(leads).where(eq(leads.id, info.subjectId));
      recipientName = l?.name ?? "";
      subjectEmail = l?.email ?? null;
    } else if (info.subjectType === "investor") {
      const [i] = await tx.select().from(investors).where(eq(investors.id, info.subjectId));
      recipientName = i?.name ?? "";
      subjectEmail = i?.email ?? null;
    }
    const [activeTpl] = await tx
      .select()
      .from(riskProfileTemplates)
      .where(eq(riskProfileTemplates.tenantId, info.tenantId))
      .orderBy(riskProfileTemplates.versionNumber);
    let tpl;
    if (activeTpl) {
      const parsed = RiskTemplateSchema.safeParse({
        name: activeTpl.name,
        description: activeTpl.description ?? undefined,
        questions: activeTpl.questions,
        bands: activeTpl.bands,
        reviewIntervalDays: activeTpl.reviewIntervalDays,
      });
      tpl = parsed.success ? parsed.data : defaultTemplate();
    } else {
      tpl = defaultTemplate();
    }

    // Email-OTP flag on the active template. Raw select for just this column —
    // the Drizzle schema field may lag the migration (0xxx adds
    // risk_profile_templates.require_email_otp), and we only need the boolean.
    // Reads the LATEST version (same row the submit endpoint enforces against).
    let requireOtp = false;
    try {
      const flagRes = await tx.execute(sql`
        select require_email_otp as flag
        from risk_profile_templates
        where tenant_id = ${info.tenantId}
        order by version_number desc
        limit 1
      `);
      const rows: any[] = (flagRes as any)?.rows ?? (flagRes as any) ?? [];
      requireOtp = rows[0]?.flag === true;
    } catch {
      requireOtp = false; // column not migrated yet — behave as before
    }

    return { tenant, recipientName, tpl, requireOtp, maskedEmailOnFile: maskEmail(subjectEmail) };
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Brand header */}
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-brand-cyan" />
            <span className="font-semibold">{data.tenant?.displayName ?? data.tenant?.legalName ?? "Risk profile"}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {data.tenant?.arn ? `ARN-${data.tenant.arn}` : ""}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <PublicRiskForm
          tokenId={info.id}
          recipientName={data.recipientName}
          template={data.tpl}
          requireOtp={data.requireOtp}
          maskedEmailOnFile={data.maskedEmailOnFile}
        />
      </main>

      <footer className="max-w-3xl mx-auto px-4 py-6 text-[11px] text-muted-foreground text-center">
        Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
        {data.tenant?.arn ? <> · {data.tenant.displayName ?? data.tenant.legalName} · ARN-{data.tenant.arn}</> : null}
      </footer>
    </div>
  );
}

/**
 * Mask an email for display on the public page: "pritesh@gmail.com" →
 * "pr•••@gmail.com". The raw email is NEVER sent to the client — only this
 * masked form crosses the server/client boundary.
 */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at); // includes "@"
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}•••${domain}`;
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-50 grid place-items-center p-6">
      <div className="max-w-md bg-white rounded-lg shadow p-6 text-center">
        <ShieldCheck className="size-10 text-rose-600 mx-auto" />
        <h1 className="text-lg font-semibold mt-3">Link unavailable</h1>
        <p className="text-sm text-muted-foreground mt-2">{message}</p>
        <p className="text-xs text-muted-foreground mt-4">
          Please reach out to your relationship manager for a new link.
        </p>
      </div>
    </div>
  );
}
