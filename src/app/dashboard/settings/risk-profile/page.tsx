import { ChevronLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadActiveTemplate } from "@/lib/risk-profile/template";
import { RiskTemplateEditor } from "@/components/risk-profile/RiskTemplateEditor";

export const dynamic = "force-dynamic";

export default async function RiskProfileSettingsPage() {
  const session = await requireSession();
  const template = await withTenant(session.tenantId, async (tx) => loadActiveTemplate(tx, session.tenantId));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link
          href="/dashboard/settings"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> Back to settings
        </Link>
        <h1 className="page-title mt-2">
          <ShieldCheck className="size-6 text-brand-cyan" /> Risk Profile Questionnaire
        </h1>
        <p className="page-subtitle">
          Customise the questions, scoring, and risk categories for your firm. The published version
          is used for every new risk profile capture. Historical profiles keep the version they were
          captured with — they're not retroactively re-scored.
        </p>
      </div>

      <RiskTemplateEditor
        initial={{
          name: template.name,
          description: template.description ?? "",
          questions: template.questions,
          bands: template.bands,
          reviewIntervalDays: template.reviewIntervalDays,
          requireEmailOtp: template.requireEmailOtp ?? true,
        }}
        versionNumber={(template as any).versionNumber ?? null}
      />
    </div>
  );
}
