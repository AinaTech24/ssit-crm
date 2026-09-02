"use client";

import { useState } from "react";
import { Beaker, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * "Send a test" affordance — fires one copy of the campaign template to the
 * marketer (or a typed address/number) through the real pipeline, before
 * launching to the whole audience. Defaults the recipient to the logged-in user.
 */
export function CampaignTestSend({ campaignId, channel, hasVariantB }: { campaignId: string; channel: string; hasVariantB?: boolean }) {
  const [recipient, setRecipient] = useState("");
  const [variant, setVariant] = useState<"a" | "b">("a");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/test-send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipient: recipient.trim() || undefined, variant: hasVariantB ? variant : undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: j.error ?? `Failed (${res.status})` });
      } else if (j.ok) {
        setMsg({ ok: true, text: `Test sent to ${j.recipient}.` });
      } else {
        setMsg({ ok: false, text: j.error ?? "Test not sent." });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Network error" });
    } finally {
      setBusy(false);
    }
  }

  const placeholder = channel === "email" ? "you@firm.in (blank = your email)" : "+91… (blank = your number)";

  return (
    <div className="border rounded-lg bg-card p-5">
      <h2 className="font-semibold mb-1 flex items-center gap-2">
        <Beaker className="size-4 text-brand-cyan" /> Send a test
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Preview the real rendered message before launching. Goes through the full compliance gate; doesn&apos;t affect campaign stats.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder={placeholder}
          className="input-base flex-1 min-w-[200px]"
        />
        {hasVariantB && (
          <select value={variant} onChange={(e) => setVariant(e.target.value as "a" | "b")} className="input-base w-auto">
            <option value="a">Variant A</option>
            <option value="b">Variant B</option>
          </select>
        )}
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" disabled={busy} onClick={send}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Beaker className="size-3.5" />} Send test
        </button>
      </div>
      {msg && (
        <div className={`mt-2 text-xs inline-flex items-center gap-1 ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>
          {msg.ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />} {msg.text}
        </div>
      )}
    </div>
  );
}
