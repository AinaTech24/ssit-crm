"use client";

/**
 * VerifyContact — inline email/phone verification pills for the Client 360
 * header (Sanchay "Verified At" parity). Shows a green ✓ when verified, else a
 * one-tap "Verify" that stamps it via POST /api/investors/[id]/verify-contact.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, BadgeCheck, ShieldQuestion } from "lucide-react";

export function VerifyContact({
  investorId, hasEmail, hasPhone, emailVerified, phoneVerified,
}: {
  investorId: string; hasEmail: boolean; hasPhone: boolean; emailVerified: boolean; phoneVerified: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(channel: "email" | "phone", verified: boolean) {
    setBusy(channel);
    try {
      await fetch(`/api/investors/${investorId}/verify-contact`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, verified }),
      });
      router.refresh();
    } finally { setBusy(null); }
  }

  function Pill({ channel, label, has, verified }: { channel: "email" | "phone"; label: string; has: boolean; verified: boolean }) {
    if (!has) return null;
    return verified ? (
      <button onClick={() => toggle(channel, false)} disabled={busy === channel}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        title={`${label} verified — click to clear`}>
        {busy === channel ? <Loader2 className="size-3 animate-spin" /> : <BadgeCheck className="size-3" />} {label} verified
      </button>
    ) : (
      <button onClick={() => toggle(channel, true)} disabled={busy === channel}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100"
        title={`Mark ${label.toLowerCase()} as verified`}>
        {busy === channel ? <Loader2 className="size-3 animate-spin" /> : <ShieldQuestion className="size-3" />} Verify {label.toLowerCase()}
      </button>
    );
  }

  if (!hasEmail && !hasPhone) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Pill channel="email" label="Email" has={hasEmail} verified={emailVerified} />
      <Pill channel="phone" label="Phone" has={hasPhone} verified={phoneVerified} />
    </span>
  );
}
