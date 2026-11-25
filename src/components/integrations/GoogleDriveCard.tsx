"use client";

/**
 * Settings -> Google Drive (owner / admin).
 *
 * Step 1: paste the OAuth client ID + secret from Google Cloud (stored encrypted), and confirm the CRM's public
 * address. The saved client ID shows in full; the secret never comes back, but the eye icon shows what you
 * are typing. Step 2: "Connect Google Drive" - sign in to the Google account that should own the videos and
 * approve. After that, videos uploaded in the CRM are copied to Drive month by month.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Copy, Eye, EyeOff, Loader2, Unplug } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Status = {
  hasCredentials: boolean;
  clientId: string | null;
  hasSecret: boolean;
  redirectBase: string | null;
  connected: boolean;
  email: string | null;
  redirectUri: string;
};

export function GoogleDriveCard() {
  const toast = useToast();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectBase, setRedirectBase] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(params.get("drive_error"));

  const load = useCallback(async () => {
    const r = await fetch("/api/settings/integrations/google-drive", { cache: "no-store" });
    if (!r.ok) {
      setErr((await r.json().catch(() => ({}))).error ?? "Could not load the Google Drive settings.");
      return;
    }
    const s: Status = await r.json();
    setStatus(s);
    setClientId(s.clientId ?? "");
    // Show the typed address, or the one the CRM detected - unless that is the server's own "localhost", which
    // is exactly what must be replaced by the real domain.
    const detected = s.redirectUri.replace(/\/api\/settings\/.*$/, "");
    setRedirectBase(s.redirectBase ?? (/\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(detected) ? "" : detected));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (params.get("drive_connected")) toast.success("Google Drive is connected.");
  }, [params, toast]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/settings/integrations/google-drive", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined, redirectBase: redirectBase.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? "Could not save.");
        return;
      }
      setClientSecret("");
      setShowSecret(false);
      toast.success("Saved.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Google Drive? Videos already in Drive stay there. New uploads will stop copying until you connect again.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/settings/integrations/google-drive", { method: "DELETE" });
      if (!r.ok) {
        setErr("Could not disconnect.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  const canSave = !!clientId.trim() && (!!clientSecret.trim() || status.hasSecret);

  return (
    <div className="space-y-4">
      {err && <div className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive text-sm p-3">{err}</div>}

      <div className="border rounded-lg bg-card p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          Status
          {status.connected ? (
            <span className="chip text-[10px] bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Connected
            </span>
          ) : (
            <span className="chip text-[10px] bg-slate-100 text-slate-600">Not connected</span>
          )}
        </h2>
        {status.connected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Videos uploaded in the CRM are copied to <strong>{status.email ?? "the connected Google account"}</strong>, into{" "}
              <code className="text-xs">Equitywala Content / year / month</code> folders. The CRM only sees files it created itself.
            </p>
            <div className="flex gap-2 flex-wrap">
              <a href="/api/settings/integrations/google-drive/oauth/start" className="btn-secondary text-sm">
                Reconnect
              </a>
              <button type="button" onClick={disconnect} disabled={busy} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                <Unplug className="size-3.5" /> Disconnect
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {status.hasCredentials ? "Credentials are saved. Sign in to the Google account that should own the videos." : "First save the client ID and secret below."}
          </p>
        )}
        {!status.connected && status.hasCredentials && (
          <a href="/api/settings/integrations/google-drive/oauth/start" className="btn-primary text-sm inline-flex">
            Connect Google Drive
          </a>
        )}
      </div>

      <div className="border rounded-lg bg-card p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          Google client ID and secret
          {status.hasSecret && <span className="chip text-[10px] bg-emerald-50 text-emerald-700">Saved</span>}
        </h2>
        <p className="text-xs text-muted-foreground">
          From Google Cloud -&gt; APIs &amp; Services -&gt; Credentials -&gt; your OAuth client (Web application). The client ID stays visible after saving; the secret is kept
          encrypted and never shown again - leave it empty to keep the saved one.
        </p>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Client ID</span>
          <input className="input-base w-full" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" autoComplete="off" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Client secret</span>
          <div className="relative">
            <input
              className="input-base w-full pr-10"
              type={showSecret ? "text" : "password"}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={status.hasSecret ? "•••••••• saved - type a new one to replace it" : "GOCSPX-…"}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title={showSecret ? "Hide" : "Show what I typed"}
              aria-label={showSecret ? "Hide the secret" : "Show the secret"}
            >
              {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">This CRM&apos;s public address</span>
          <input
            className="input-base w-full"
            value={redirectBase}
            onChange={(e) => setRedirectBase(e.target.value)}
            placeholder="https://crm.equitywala.com"
            autoComplete="off"
          />
          <span className="block text-[11px] text-muted-foreground">
            The address people open the CRM on. The redirect address below is built from it, so it must be your real domain (not localhost).
          </span>
        </label>
        <button type="button" onClick={save} disabled={busy || !canSave} className="btn-primary text-sm inline-flex items-center gap-1.5">
          {busy && <Loader2 className="size-4 animate-spin" />} Save
        </button>
      </div>

      <div className="border rounded-lg bg-card p-5 space-y-2">
        <h2 className="font-semibold">Redirect address to register in Google Cloud</h2>
        <p className="text-xs text-muted-foreground">
          Add this exactly under the OAuth client&apos;s Authorized redirect URIs. After changing the public address above, press Save and this updates:
        </p>
        <div className="flex items-center gap-2">
          <code className="text-xs bg-secondary rounded px-2 py-1 break-all flex-1">{status.redirectUri}</code>
          <button
            type="button"
            className="btn-icon h-8 w-8"
            title="Copy"
            onClick={() => {
              void navigator.clipboard?.writeText(status.redirectUri);
              toast.success("Copied");
            }}
          >
            <Copy className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
