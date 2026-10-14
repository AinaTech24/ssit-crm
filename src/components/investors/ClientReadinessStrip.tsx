import Link from "next/link";
import { ShieldCheck, CheckCircle2, AlertTriangle, IdCard, ShieldAlert, Users, Landmark, Mail, Phone } from "lucide-react";

/**
 * ClientReadinessStrip — one consolidated view of a client's onboarding &
 * compliance gaps (KYC, risk profile, nominee, bank, contact verification),
 * replacing the scattered signals (standalone risk banner + KYC chip + repeated
 * "do the risk assessment" prompts). For a new client this is the single most
 * useful thing on the page: what's left to make them transaction-ready.
 *
 * Pure render (server component). Renders nothing once every tracked item is
 * complete, so established clients don't see clutter. A tracked item passed as
 * `null` is hidden (license/field not visible for this firm).
 */

type RiskState = "ok" | "missing" | "expired";

type Item = { key: string; label: string; ok: boolean; icon: any; urgent?: boolean };

export function ClientReadinessStrip({
  investorId,
  kyc,
  risk,
  nominee,
  bank,
  emailVerified,
  phoneVerified,
}: {
  investorId: string;
  kyc: boolean | null;
  risk: RiskState | null;
  nominee: boolean | null;
  bank: boolean | null;
  emailVerified: boolean | null;
  phoneVerified: boolean | null;
}) {
  const items: Item[] = [];
  if (kyc !== null) items.push({ key: "kyc", label: "KYC", ok: kyc, icon: IdCard });
  if (risk !== null) items.push({ key: "risk", label: risk === "expired" ? "Risk (expired)" : "Risk profile", ok: risk === "ok", icon: ShieldAlert, urgent: true });
  if (nominee !== null) items.push({ key: "nominee", label: "Nominee", ok: nominee, icon: Users });
  if (bank !== null) items.push({ key: "bank", label: "Bank", ok: bank, icon: Landmark });
  if (emailVerified !== null) items.push({ key: "email", label: "Email verified", ok: emailVerified, icon: Mail });
  if (phoneVerified !== null) items.push({ key: "phone", label: "Phone verified", ok: phoneVerified, icon: Phone });

  const done = items.filter((i) => i.ok).length;
  const gaps = items.length - done;

  // Nothing tracked, or everything complete → no strip (keeps active clients clean).
  if (items.length === 0 || gaps === 0) return null;

  const riskNeedsAction = risk === "missing" || risk === "expired";
  const pct = Math.round((done / items.length) * 100);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-900">Onboarding &amp; compliance readiness</h3>
            <span className="text-[11px] font-medium text-amber-700 tabular-nums">{done}/{items.length} complete</span>
          </div>
          <p className="text-[11px] text-amber-700/90 mt-0.5">
            {gaps} item{gaps === 1 ? "" : "s"} left before this client is fully transaction-ready (SEBI).
          </p>
        </div>
      </div>

      {/* thin progress bar */}
      <div className="mt-3 h-1.5 rounded-full bg-amber-100 overflow-hidden">
        <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* per-item status pills */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.map((it) => {
          const Icon = it.ok ? CheckCircle2 : it.urgent ? AlertTriangle : it.icon;
          return (
            <span
              key={it.key}
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border ${
                it.ok
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : it.urgent
                    ? "bg-rose-50 text-rose-700 border-rose-200"
                    : "bg-white text-amber-800 border-amber-200"
              }`}
            >
              <Icon className="size-3" />
              {it.label}
              {!it.ok && <span className="opacity-60">· pending</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
