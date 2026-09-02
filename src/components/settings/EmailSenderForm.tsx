"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, Check, ChevronDown, ChevronUp, RotateCcw, Info } from "lucide-react";

/**
 * Lets an MFD owner map the "From" identity for client emails. The default path
 * (firm name + reply-to on the platform's verified domain) works with zero DNS
 * setup; advanced fields allow a fully custom from-address or the firm's own
 * Resend key once their domain is verified.
 */
export function EmailSenderForm({
  initial,
}: {
  initial: {
    fromName: string;
    fromEmail: string;
    replyTo: string;
    ownKeyHint: string | null;
    platformFrom: string | null;
    firmName: string;
    firmEmail: string;
  };
}) {
  const router = useRouter();
  const [fromName, setFromName] = useState(initial.fromName || initial.firmName || "");
  const [replyTo, setReplyTo] = useState(initial.replyTo || initial.firmEmail || "");
  const [fromEmail, setFromEmail] = useState(initial.fromEmail || "");
  const [apiKey, setApiKey] = useState("");
  const [advanced, setAdvanced] = useState(!!(initial.fromEmail || initial.ownKeyHint));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const previewAddr = fromEmail || initial.platformFrom || "no-reply@your-platform.com";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/settings/email-sender", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromName, fromEmail, replyTo, apiKey }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Save failed");
        return;
      }
      setSaved(true);
      setApiKey("");
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (e: any) {
      setErr(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function resetDefault() {
    if (!window.confirm("Reset to the platform default sender? Client emails will go from the shared address again.")) return;
    setBusy(true);
    try {
      await fetch("/api/settings/email-sender", { method: "DELETE" });
      setFromEmail("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="border rounded-lg bg-card p-5 space-y-4">
      <div>
        <div className="font-semibold">Your email identity</div>
        <p className="text-xs text-muted-foreground mt-0.5">
          How client emails (statements, proposals, automations) appear in your clients&apos; inbox.
        </p>
      </div>

      {/* Live From preview */}
      <div className="rounded-md border bg-secondary/30 px-3 py-2 text-sm">
        <span className="text-muted-foreground text-xs">Clients will see: </span>
        <span className="font-medium">{fromName || "Your Firm"}</span>{" "}
        <span className="text-muted-foreground">&lt;{previewAddr}&gt;</span>
        {replyTo && <div className="text-[11px] text-muted-foreground mt-0.5">Replies go to {replyTo}</div>}
      </div>

      <Field label="Sender name" hint="Your firm/advisor name as shown in the inbox.">
        <input
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
          required
          placeholder="e.g. Rajesh — We Care Wealth"
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
        />
      </Field>

      <Field label="Reply-to email" hint="Where client replies land — your own inbox.">
        <input
          value={replyTo}
          onChange={(e) => setReplyTo(e.target.value)}
          type="email"
          placeholder="you@yourfirm.com"
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
        />
      </Field>

      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-900">
        <Info className="size-3.5 mt-0.5 shrink-0" />
        <span>
          By default, emails send from the platform&apos;s verified address but show <strong>your name</strong>, and
          replies go to your <strong>reply-to</strong> — no setup needed. To send from your own address
          (<em>advisor@yourfirm.com</em>), use the advanced options and verify your domain.
        </span>
      </div>

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setAdvanced((s) => !s)}
        className="text-xs font-medium text-brand-cyan-deep inline-flex items-center gap-1"
      >
        {advanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        Advanced — custom domain & own Resend key
      </button>

      {advanced && (
        <div className="space-y-4 border-l-2 border-border pl-4">
          <Field
            label="Custom from-address (optional)"
            hint="e.g. advisor@yourfirm.com. Requires verifying this domain in Resend (SPF/DKIM) — otherwise emails may bounce or be flagged as spam. Leave blank to use the default."
          >
            <input
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              type="email"
              placeholder="advisor@yourfirm.com"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </Field>

          <Field
            label="Your own Resend API key (optional)"
            hint={
              initial.ownKeyHint
                ? `A key is already saved (${initial.ownKeyHint}). Leave blank to keep it, or paste a new one to replace.`
                : "Use your own Resend account for full control of sending + deliverability. Leave blank to use the platform's."
            }
          >
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder={initial.ownKeyHint ? "•••• (unchanged)" : "re_…"}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono"
            />
          </Field>
        </div>
      )}

      {err && <div className="text-sm text-rose-600">{err}</div>}

      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : <Save className="size-4" />}
          {saved ? "Saved" : "Save sender"}
        </button>
        <button
          type="button"
          onClick={resetDefault}
          disabled={busy}
          className="btn-ghost text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" /> Reset to default
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
