"use client";

/**
 * Settings -> Google Drive (owner / admin).
 *
 * Step 1: paste the OAuth client ID + secret from Google Cloud (stored encrypted; the secret is never
 * shown again). Step 2: "Connect Google Drive" - sign in to the Google account that should own the
 * videos and approve. After that, videos uploaded in the CRM are copied to Drive month by month.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Copy, Loader2, Unplug } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Status = {
  hasCredentials: boolean;
  clientIdHint: string | null;
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(params.get("drive_error"));

  const load = useCallback(async () => {
    const r = await fetch("/api/settings/integrations/google-drive", { cache: "no-store" });
    if (r.ok) setStatus(await r.json());
    else setErr((await r.json().catch(() => ({}))).error ?? "Could not load the Google Drive settings.");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (params.get("drive_connected")) toast.success("Google Drive is connected.");
  }, [params, toast]);

  async function saveCreds() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/settings/integrations/google-drive", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? "Could not save.");
        return;
      }
      setClientId("");
      setClientSecret("");
      toast.success("Saved. Now click Connect Google Drive.");
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
        <h2 className="font-semibold">Google client ID and secret</h2>
        <p className="text-xs text-muted-foreground">
          From Google Cloud -&gt; APIs &amp; Services -&gt; Credentials -&gt; your OAuth client (Web application).
          {status.clientIdHint && (
            <>
              {" "}
              Saved client ID: <code>{status.clientIdHint}</code>. Saving new ones replaces it and asks you to connect again.
            </>
          )}
        </p>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Client ID</span>
          <input className="input-base w-full" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" autoComplete="off" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Client secret</span>
          <input className="input-base w-full" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-…" autoComplete="new-password" />
        </label>
        <button type="button" onClick={saveCreds} disabled={busy || !clientId.trim() || !clientSecret.trim()} className="btn-primary text-sm inline-flex items-center gap-1.5">
          {busy && <Loader2 className="size-4 animate-spin" />} Save
        </button>
      </div>

      <div className="border rounded-lg bg-card p-5 space-y-2">
        <h2 className="font-semibold">Redirect address to register in Google Cloud</h2>
        <p className="text-xs text-muted-foreground">Add this exactly under the OAuth client&apos;s Authorized redirect URIs:</p>
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
