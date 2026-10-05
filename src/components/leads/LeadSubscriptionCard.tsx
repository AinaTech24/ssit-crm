"use client";

/**
 * Research-subscription category on a lead, changeable in place.
 *
 * Moving a lead to SUBSCRIBED converts it to a client straight away (the server
 * does it, through the normal convert route); the frequency picked here is what
 * the renewal date is worked out from.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Repeat } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { SUBSCRIPTION_CATEGORIES, SUBSCRIPTION_FREQUENCIES } from "@/lib/subscriptions";

export function LeadSubscriptionCard({
  leadId,
  category,
  frequency,
  renewalAt,
}: {
  leadId: string;
  category: string | null;
  frequency: string | null;
  renewalAt: string | null;
}) {
  const router = useRouter();
  const [cat, setCat] = useState(category ?? "non_subscribed");
  const [freq, setFreq] = useState(frequency ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = cat !== (category ?? "non_subscribed") || freq !== (frequency ?? "");

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscriptionCategory: cat,
          ...(cat === "subscribed" ? { subscriptionFrequency: freq } : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      if (j.converted && j.investorId) {
        router.push(`/dashboard/investors/${j.investorId}`);
        return;
      }
      if (j.convertError) setErr(`Saved, but could not convert to a client: ${j.convertError}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Repeat className="size-4 text-brand-cyan" /> Subscription
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <label className="block">
          <div className="text-xs font-medium mb-1">Category</div>
          <SelectField
            value={cat}
            onChange={(e) => {
              setCat(e.target.value);
              if (e.target.value !== "subscribed") setFreq("");
            }}
          >
            {SUBSCRIPTION_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </SelectField>
        </label>
        {cat === "subscribed" && (
          <label className="block">
            <div className="text-xs font-medium mb-1">Subscription</div>
            <SelectField value={freq} onChange={(e) => setFreq(e.target.value)}>
              <option value="">Select…</option>
              {SUBSCRIPTION_FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </SelectField>
          </label>
        )}
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty || (cat === "subscribed" && !freq)}
          className="btn-primary text-xs justify-self-start disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {cat === "subscribed" ? "Subscribe & convert to client" : "Save"}
        </button>
      </div>
      {renewalAt && <div className="text-xs text-muted-foreground">Renews on {renewalAt.slice(0, 10)}</div>}
      {err && <div className="text-xs text-rose-600">{err}</div>}
    </div>
  );
}
