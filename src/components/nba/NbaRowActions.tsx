"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Clock, Check, X, Loader2 } from "lucide-react";

/**
 * Per-row actions for a Next-Best-Action: AI-draft outreach, snooze, done,
 * dismiss. Snooze/done/dismiss reuse the command-center snooze store (keyed
 * "nba:<type>:<id>") so the action drops off the list. "Done" snoozes a week
 * (the signal resurfaces if it's still open later); "Dismiss" is permanent.
 */
export function NbaRowActions({
  snoozeKey,
  name,
  label,
  reason,
  phone,
  email,
  channel = "whatsapp",
}: {
  snoozeKey: string;
  name: string;
  label: string;
  reason: string;
  phone?: string | null;
  email?: string | null;
  channel?: "whatsapp" | "email" | "sms";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function snooze(action: "1d" | "7d" | "dismiss") {
    setBusy(action);
    try {
      await fetch("/api/command-center/snooze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemKey: snoozeKey, action }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function aiDraft() {
    setBusy("ai");
    try {
      const r = await fetch("/api/nba/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, label, reason, channel: phone ? "whatsapp" : "email" }),
      });
      const d = await r.json().catch(() => ({}));
      const text: string = d?.text ?? "";
      if (!r.ok || !text) {
        alert(d?.error ?? "Couldn't draft a message right now.");
        return;
      }
      if (phone) {
        const num = phone.replace(/[^\d]/g, "");
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      } else if (email) {
        window.open(`mailto:${email}?body=${encodeURIComponent(text)}`, "_blank");
      } else {
        await navigator.clipboard.writeText(text).catch(() => {});
        alert("Drafted message copied to clipboard.");
      }
    } finally {
      setBusy(null);
    }
  }

  const Btn = ({ onClick, title, children, tone }: { onClick: () => void; title: string; children: React.ReactNode; tone?: string }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      disabled={!!busy}
      className={`rounded p-1.5 hover:bg-secondary transition-colors disabled:opacity-50 ${tone ?? "text-muted-foreground"}`}
    >
      {children}
    </button>
  );

  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      <Btn onClick={aiDraft} title="Draft with AI & open" tone="text-brand-cyan">
        <Sparkles className="size-3.5" />
      </Btn>
      <Btn onClick={() => snooze("1d")} title="Snooze 1 day">
        <Clock className="size-3.5" />
      </Btn>
      <Btn onClick={() => snooze("7d")} title="Mark done (hide for a week)" tone="text-emerald-600">
        <Check className="size-3.5" />
      </Btn>
      <Btn onClick={() => snooze("dismiss")} title="Dismiss">
        <X className="size-3.5" />
      </Btn>
    </span>
  );
}
