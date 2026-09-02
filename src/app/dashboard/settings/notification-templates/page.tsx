import Link from "next/link";
import { eq } from "drizzle-orm";
import { ChevronLeft, Mail, MessageCircle, Plus, Edit3 } from "lucide-react";
import { withTenant } from "@/db/client";
import { templates } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * The 18 spec-mandated templates used across the lead-to-client journey.
 * The page lists every spec key and shows whether the tenant has installed
 * + approved a matching `templates` row for both Email + WhatsApp.
 */
const SPEC_TEMPLATES: Array<{
  key: string;
  label: string;
  channels: Array<"email" | "whatsapp" | "sms">;
  stage: string;
}> = [
  { key: "lead_welcome", label: "Lead welcome", channels: ["email", "whatsapp"], stage: "Stage 1" },
  { key: "referrer_thank_you", label: "Referrer thank-you", channels: ["email", "whatsapp"], stage: "Stage 1" },
  { key: "meeting_confirmation", label: "Meeting confirmation", channels: ["email", "whatsapp"], stage: "Stage 2" },
  { key: "meeting_reminder", label: "Meeting reminder (24h before)", channels: ["email", "whatsapp"], stage: "Stage 3" },
  { key: "risk_profile_request", label: "Risk profile questionnaire request", channels: ["email", "whatsapp"], stage: "Stage 5" },
  { key: "risk_profile_confirmation", label: "Risk profile completion confirmation", channels: ["email", "whatsapp"], stage: "Stage 5" },
  { key: "proposal_sent", label: "Proposal sent", channels: ["email", "whatsapp"], stage: "Stage 7" },
  { key: "proposal_reminder", label: "Proposal reminder (no response)", channels: ["email", "whatsapp"], stage: "Stage 7" },
  { key: "proposal_approved", label: "Proposal approved confirmation", channels: ["email", "whatsapp"], stage: "Stage 8" },
  { key: "docs_request", label: "Document checklist request", channels: ["email", "whatsapp"], stage: "Stage 9" },
  { key: "docs_missing_reminder", label: "Missing document reminder", channels: ["email", "whatsapp"], stage: "Stage 10" },
  { key: "operations_update", label: "Operations onboarding update", channels: ["email"], stage: "Stage 13" },
  { key: "client_portal_welcome", label: "Client welcome + portal login", channels: ["email", "whatsapp"], stage: "Stage 14" },
  { key: "review_scheduled", label: "Review cycle scheduled message", channels: ["email", "whatsapp"], stage: "Stage 15" },
];

export default async function NotificationTemplatesPage() {
  const session = await requireSession();

  const installed = await withTenant(session.tenantId, async (tx) => {
    return tx.select().from(templates).where(eq(templates.tenantId, session.tenantId));
  });

  // Build a lookup: { key: { email: {status}, whatsapp: {status} } }
  const lookup: Record<string, Partial<Record<"email" | "whatsapp" | "sms", { id: string; status: string }>>> = {};
  for (const t of installed) {
    // Templates may be suffixed with _email / _wa — strip
    const base = t.key.replace(/_(email|wa|whatsapp|sms)$/, "");
    if (!lookup[base]) lookup[base] = {};
    const ch = t.channel as "email" | "whatsapp" | "sms";
    if (ch === "email" || ch === "whatsapp" || ch === "sms") {
      lookup[base][ch] = { id: t.id, status: t.status };
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/dashboard/settings" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ChevronLeft className="size-3" /> Back to settings
        </Link>
        <h1 className="page-title mt-2">
          <Mail className="size-6 text-brand-cyan" /> Notification Templates
        </h1>
        <p className="page-subtitle">
          The 14 templates that drive every automated message in the lead-to-client journey. Each gets a
          fully-branded designer-mode email + a Meta-approved WhatsApp variant.
        </p>
      </div>

      <div className="card-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Template</th>
              <th className="text-left py-2 font-medium">Stage</th>
              <th className="text-center py-2 font-medium">Email</th>
              <th className="text-center py-2 font-medium">WhatsApp</th>
              <th className="text-right py-2 font-medium pr-4">Action</th>
            </tr>
          </thead>
          <tbody>
            {SPEC_TEMPLATES.map((t) => {
              const lkp = lookup[t.key] ?? {};
              return (
                <tr key={t.key} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{t.key}</div>
                  </td>
                  <td className="py-3 text-xs text-muted-foreground">{t.stage}</td>
                  <td className="py-3 text-center">
                    <StatusChip status={lkp.email?.status} channel="email" />
                  </td>
                  <td className="py-3 text-center">
                    {t.channels.includes("whatsapp") ? (
                      <StatusChip status={lkp.whatsapp?.status} channel="whatsapp" />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <Link
                      href={
                        lkp.email?.id
                          ? `/dashboard/templates/${lkp.email.id}`
                          : `/dashboard/templates/new?key=${t.key}&channel=email`
                      }
                      className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1"
                    >
                      <Edit3 className="size-3" /> {lkp.email?.id ? "Edit" : "Create"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        Templates use the Email Designer (block-based) for email and Meta-approved WhatsApp templates. Each one supports
        merge fields like <code className="bg-secondary px-1 rounded">{`{{lead_name}}`}</code>,{" "}
        <code className="bg-secondary px-1 rounded">{`{{rm_name}}`}</code>,{" "}
        <code className="bg-secondary px-1 rounded">{`{{proposal_link}}`}</code>,{" "}
        <code className="bg-secondary px-1 rounded">{`{{portal_login_link}}`}</code>, etc.
      </p>
    </div>
  );
}

function StatusChip({ status, channel }: { status: string | undefined; channel: "email" | "whatsapp" }) {
  if (!status) {
    return (
      <span className="chip text-[10px] bg-secondary text-muted-foreground inline-flex items-center gap-1">
        <Plus className="size-3" /> Not created
      </span>
    );
  }
  const tone =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : status === "draft"
        ? "bg-amber-50 text-amber-700"
        : "bg-rose-50 text-rose-700";
  return (
    <span className={`chip text-[10px] ${tone} inline-flex items-center gap-1`}>
      {channel === "email" ? <Mail className="size-3" /> : <MessageCircle className="size-3" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}
