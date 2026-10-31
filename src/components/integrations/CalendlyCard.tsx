"use client";

/**
 * "My Calendly" card on My profile. Each user connects their own Calendly with a
 * personal access token + booking link; meetings they schedule in the CRM are
 * then booked onto that Calendly (see src/lib/integrations/calendly.ts).
 */

import { useEffect, useState } from "react";
import { CalendarCheck, Loader2, Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Status = {
  connected: boolean;
  schedulingUrl?: string | null;
  eventTypeName?: string | null;
  durationMinutes?: number | null;
  hostEmail?: string | null;
};

export function CalendlyCard() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/integrations/calendly")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
  }, []);

  async function connect() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/integrations/calendly", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, schedulingUrl: link }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Could not connect (${res.status})`);
        return;
      }
      setStatus(j);
      setToken("");
      toast.success(
        `Your Calendly link is set up (${j.schedulingUrl}). Meetings you schedule from now on are booked on it.`,
        "Calendly link set up"
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/calendly", { method: "DELETE" });
      if (res.ok) {
        setStatus({ connected: false });
        toast.info("Meetings you schedule will no longer be added to Calendly.", "Calendly disconnected");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarCheck className="size-4 text-brand-cyan" />
        <h3 className="font-semibold text-sm">My Calendly</h3>
        {status?.connected && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-700">
            <Check className="size-3.5" /> Connected
          </span>
        )}
      </div>

      {status === null ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : status.connected ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Meetings you schedule in the CRM are booked on{" "}
            <span className="font-medium text-foreground">{status.schedulingUrl}</span>
            {status.eventTypeName ? ` (${status.eventTypeName}${status.durationMinutes ? `, ${status.durationMinutes} min` : ""})` : ""}.
          </p>
          <button
            onClick={disconnect}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Connect your Calendly and every meeting you schedule here is booked on it too. In Calendly open
            Integrations → API &amp; Webhooks → Personal access tokens, create a token and paste it below with
            your booking link. Booking through the API needs a paid Calendly plan.
          </p>
          <label className="block">
            <div className="text-xs font-medium mb-1">Booking link</div>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://calendly.com/your-name/30min"
              className="input-base"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Personal access token</div>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              className="input-base"
            />
          </label>
          {err && <div className="border border-rose-300 bg-rose-50 text-rose-900 rounded-md p-2 text-xs">{err}</div>}
          <button
            onClick={connect}
            disabled={busy || !token.trim() || !link.trim()}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? "Checking with Calendly…" : "Connect Calendly"}
          </button>
        </div>
      )}
    </div>
  );
}
