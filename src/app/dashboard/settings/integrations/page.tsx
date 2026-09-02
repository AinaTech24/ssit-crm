import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, Webhook, Check, AlertCircle, ExternalLink } from "lucide-react";
import VartifyConnectCard from "./VartifyConnectCard";
import { ZohoIntegrationCard } from "@/components/integrations/ZohoIntegrationCard";
import { RtaMailbackCard } from "@/components/integrations/RtaMailbackCard";
import { StatusChip } from "@/components/common/StatusChip";

const INTEGRATIONS = [
  {
    name: "BSE Star MF",
    desc: "Place SIPs, lumpsum, redemption orders. Requires your BSE member code + user id.",
    envCheck: () => !!process.env.BSE_STAR_MEMBER_CODE,
    setupSteps: ["Get BSE membership (₹50K one-time setup)", "Add credentials in your tenant config", "We orchestrate orders on your behalf"],
  },
  {
    name: "NSE NMF II",
    desc: "Alternative to BSE for transaction execution.",
    envCheck: () => false,
    setupSteps: ["NSE registration required", "Per-tenant credentials"],
  },
  {
    name: "Razorpay",
    desc: "Subscription billing (your SSIT subscription).",
    envCheck: () => !!process.env.RAZORPAY_KEY_ID,
    setupSteps: ["SSIT configures this — you don't need to do anything"],
  },
  {
    name: "KYC providers (Karza / Hyperverge / IDfy)",
    desc: "CKYC fetch, eKYC, video KYC, Aadhaar XML, DigiLocker, eSign.",
    envCheck: () => false,
    setupSteps: ["Pick a partner", "SSIT wires the integration"],
  },
  {
    name: "Account Aggregator",
    desc: "Pull investor's portfolio across other distributors with consent.",
    envCheck: () => false,
    setupSteps: ["Roadmap — Phase 4"],
  },
];

export const dynamic = "force-dynamic";

export default function IntegrationsPage() {
  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <Webhook className="size-5" /> Integrations
      </h1>
      <p className="text-sm text-muted-foreground">
        Connect external services. Most integrations are configured by SSIT on your behalf during onboarding.
      </p>

      {/* Self-serve: the firm connects its own WhatsApp sender once. */}
      <VartifyConnectCard />

      {/* Self-serve: connect the firm's Zoho CRM (one-way record sync). */}
      <Suspense fallback={null}>
        <ZohoIntegrationCard />
      </Suspense>

      {/* Self-serve: direct RTA mailback auto-import via email forwarding. */}
      <RtaMailbackCard />

      <div className="grid grid-cols-1 gap-3">
        {INTEGRATIONS.map((i) => {
          const ok = i.envCheck();
          return (
            <div key={i.name} className="border rounded-lg bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{i.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{i.desc}</p>
                </div>
                <StatusChip tone={ok ? "success" : "neutral"} className="whitespace-nowrap">
                  {ok ? <><Check className="size-3" /> Connected</> : <><AlertCircle className="size-3" /> Not connected</>}
                </StatusChip>
              </div>
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs font-medium text-muted-foreground">Setup</div>
                <ol className="mt-1.5 space-y-1 text-sm">
                  {i.setupSteps.map((s, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-muted-foreground tabular-nums">{idx + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border rounded-lg bg-card p-5 text-sm text-muted-foreground">
        Need a custom integration? <Link href="/dashboard/support" className="text-primary hover:underline">Open a support ticket</Link>.
      </div>
    </div>
  );
}
