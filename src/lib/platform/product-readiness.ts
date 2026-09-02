import { commercialLegalReadiness } from "@/lib/legal/company";
import { providerMode } from "@/lib/platform/runtime-safety";

export type ReadinessStatus = "live" | "configured" | "demo" | "blocked" | "unavailable";

export type ProductReadinessItem = {
  key: string;
  category: "Core" | "Communication" | "Data" | "Execution" | "Governance";
  label: string;
  status: ReadinessStatus;
  detail: string;
  href?: string;
  critical?: boolean;
};

function has(...names: string[]): boolean {
  return names.every((name) => !!process.env[name]?.trim());
}

export function buildProductReadiness(input: {
  tenantProviders: Set<string>;
  workerHealthy: boolean | null;
  lastRtaImportAt: Date | null;
}): ProductReadinessItem[] {
  const legal = commercialLegalReadiness();
  const kycLive = (process.env.KYC_PROVIDER ?? "stub") !== "stub" && has("KYC_API_URL", "KYC_API_KEY");
  const marketLive = has("MARKET_INDEX_URL");
  const bseLive = process.env.BSE_STAR_MODE === "live" && has("BSE_STAR_MEMBER_CODE");
  const aiLive = has("GEMINI_API_KEY") || has("ANTHROPIC_API_KEY");
  const whatsappLive = input.tenantProviders.has("vartify") || has("VARTIFY_API_TOKEN");
  const rtaLive = input.tenantProviders.has("rta_mailback") || input.lastRtaImportAt != null;

  return [
    { key: "database", category: "Core", label: "Database and tenant isolation", status: "live", detail: "This readiness page was loaded through a tenant-scoped database transaction.", critical: true },
    { key: "redis", category: "Core", label: "Redis queues", status: has("REDIS_URL") ? "configured" : "blocked", detail: has("REDIS_URL") ? "Queue endpoint is configured. Validate connectivity in deployment health checks." : "REDIS_URL is missing; workflows and background jobs cannot run.", critical: true },
    { key: "workers", category: "Core", label: "Background workers", status: input.workerHealthy === true ? "live" : input.workerHealthy === false ? "blocked" : "configured", detail: input.workerHealthy === true ? "Scheduler heartbeats are current." : input.workerHealthy === false ? "One or more scheduler heartbeats are stale or failed." : "No scheduler heartbeat could be verified from this web process.", critical: true },
    { key: "storage", category: "Core", label: "Encrypted file storage", status: has("S3_BUCKET", "S3_REGION") ? "configured" : "blocked", detail: has("S3_BUCKET", "S3_REGION") ? "S3 storage is configured." : "S3_BUCKET or S3_REGION is missing; document workflows are incomplete.", critical: true },
    { key: "auth", category: "Governance", label: "Authentication and encryption", status: has("NEXTAUTH_SECRET", "ENCRYPTION_KEY") ? "configured" : "blocked", detail: has("NEXTAUTH_SECRET", "ENCRYPTION_KEY") ? "Session signing and field encryption secrets are configured." : "Required session or encryption secret is missing.", critical: true },
    { key: "legal", category: "Governance", label: "Commercial legal identity", status: legal.ready ? "live" : "blocked", detail: legal.ready ? "Registered identity and grievance details are complete." : `${legal.checks.filter((check) => !check.ok).length} required legal details remain incomplete.`, href: "/dashboard/settings/readiness#legal", critical: true },
    { key: "observability", category: "Governance", label: "Operational alerting", status: has("OBSERVABILITY_WEBHOOK_URL") || has("ERROR_WEBHOOK_URL") ? "configured" : "blocked", detail: has("OBSERVABILITY_WEBHOOK_URL") || has("ERROR_WEBHOOK_URL") ? "Structured errors are forwarded to the configured operator endpoint." : "Set OBSERVABILITY_WEBHOOK_URL so production failures alert the team.", critical: true },
    { key: "email", category: "Communication", label: "Transactional email", status: has("RESEND_API_KEY", "EMAIL_FROM_TRANSACTIONAL") ? "configured" : "blocked", detail: has("RESEND_API_KEY", "EMAIL_FROM_TRANSACTIONAL") ? "Email delivery credentials and sender are configured." : "Invites, resets and transactional messages cannot be delivered.", href: "/dashboard/settings/email", critical: true },
    { key: "whatsapp", category: "Communication", label: "WhatsApp Business", status: whatsappLive ? "configured" : "blocked", detail: whatsappLive ? "A tenant or platform Vartify connection is active." : "Connect the firm's WhatsApp Business account.", href: "/dashboard/settings/integrations" },
    { key: "sms", category: "Communication", label: "DLT SMS", status: has("MSG91_AUTH_KEY", "MSG91_SENDER_ID") ? "configured" : "blocked", detail: has("MSG91_AUTH_KEY", "MSG91_SENDER_ID") ? "MSG91 credentials and sender ID are configured." : "SMS is unavailable until MSG91 and DLT details are configured.", href: "/dashboard/settings/integrations" },
    { key: "rta", category: "Data", label: "CAMS / KFintech data", status: rtaLive ? "live" : "blocked", detail: input.lastRtaImportAt ? `Latest successful import: ${input.lastRtaImportAt.toLocaleDateString("en-IN")}.` : rtaLive ? "RTA mailback ingestion is connected; no completed import was found yet." : "Connect RTA mailback or upload the first registrar file.", href: "/dashboard/rta-imports", critical: true },
    { key: "kyc", category: "Data", label: "KYC verification", status: providerMode(kycLive), detail: kycLive ? `${process.env.KYC_PROVIDER} live endpoint is configured.` : "Demo verification is development-only and is blocked in production.", href: "/dashboard/settings/integrations" },
    { key: "market", category: "Data", label: "Licensed market index feed", status: providerMode(marketLive), detail: marketLive ? "Live market endpoint is configured." : "Stub market movement is development-only and never runs in production.", href: "/dashboard/settings/integrations" },
    { key: "bse", category: "Execution", label: "BSE Star MF order routing", status: providerMode(bseLive), detail: bseLive ? "Live BSE mode and member code are configured." : "Stub orders are blocked in production. Configure BSE_STAR_MODE=live and tenant credentials.", href: "/dashboard/settings/integrations", critical: true },
    { key: "nse", category: "Execution", label: "NSE NMF II", status: "unavailable", detail: "Adapter not implemented. Do not promise NSE order execution in proposals." },
    { key: "ai", category: "Execution", label: "AI copilot", status: aiLive ? "configured" : "blocked", detail: aiLive ? "At least one supported model provider is configured." : "Configure Gemini or Anthropic before enabling AI features.", href: "/dashboard/ai-assistant" },
  ];
}

