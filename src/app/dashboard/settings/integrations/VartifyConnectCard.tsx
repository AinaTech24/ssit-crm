"use client";

import { useEffect, useState } from "react";
import { Check, AlertCircle, Loader2, MessageCircle, RefreshCw } from "lucide-react";

type Status = {
  connected: boolean;
  keyHint?: string;
  webhookUrl?: string;
  defaultLanguage?: string;
};

type WsNumber = { display_phone_number?: string; id?: string };
type Verify = {
  connected: boolean;
  ok: boolean;
  workspaceName?: string | null;
  numbers?: WsNumber[];
  error?: string | null;
  httpStatus?: number | null;
};

export default function VartifyConnectCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [apiKey, setApiKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState("en_US");

  const [verify, setVerify] = useState<Verify | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function checkConnection() {
    setVerifying(true);
    try {
      const res = await fetch("/api/settings/integrations/vartify/verify", { cache: "no-store" });
      if (res.ok) setVerify((await res.json()) as Verify);
    } finally {
      setVerifying(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/integrations/vartify");
      if (res.ok) {
        const data = (await res.json()) as Status;
        setStatus(data);
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        if (data.defaultLanguage) setDefaultLanguage(data.defaultLanguage);
        setEditing(!data.connected);
        if (data.connected) void checkConnection();
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/integrations/vartify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          webhookUrl: webhookUrl.trim() || undefined,
          defaultLanguage: defaultLanguage.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data?.error ?? "Could not save the key" });
      } else {
        setStatus(data);
        setApiKey("");
        setEditing(false);
        setMsg({ kind: "ok", text: "Vartify connected. WhatsApp sends now use this key." });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error — please try again" });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Vartify? WhatsApp sends will stop until you add a key again.")) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/integrations/vartify", { method: "DELETE" });
      if (res.ok) {
        setStatus({ connected: false });
        setEditing(true);
        setMsg({ kind: "ok", text: "Disconnected." });
      } else {
        const data = await res.json();
        setMsg({ kind: "err", text: data?.error ?? "Could not disconnect" });
      }
    } finally {
      setSaving(false);
    }
  }

  const connected = status?.connected;

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <MessageCircle className="size-4 text-emerald-600" /> Vartify WhatsApp
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your Vartify account once. After that, every WhatsApp message just
            needs a template name — the CRM uses this key automatically.
          </p>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${
            connected ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-600"
          }`}
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : connected ? (
            <>
              <Check className="size-3" /> Connected
            </>
          ) : (
            <>
              <AlertCircle className="size-3" /> Not connected
            </>
          )}
        </span>
      </div>

      <div className="mt-4 pt-4 border-t space-y-3">
        {connected && !editing ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Webhook key:</span>{" "}
                <span className="font-mono">{status?.keyHint ?? "••••"}</span>
                <span className="text-muted-foreground ml-3">Language:</span>{" "}
                <span className="font-mono">{status?.defaultLanguage ?? "en_US"}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="text-sm px-3 py-1.5 rounded-md border hover:bg-accent"
                >
                  Update key
                </button>
                <button
                  onClick={disconnect}
                  disabled={saving}
                  className="text-sm px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            </div>

            {/* Live workspace identity — tells the firm WHICH Vartify workspace this
                key belongs to (= where they must create + approve templates). */}
            <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Connected workspace</span>
                <button
                  onClick={checkConnection}
                  disabled={verifying}
                  className="text-xs inline-flex items-center gap-1 text-brand-cyan-deep hover:underline disabled:opacity-50"
                >
                  {verifying ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Check
                </button>
              </div>
              {verifying && !verify ? (
                <div className="text-xs text-muted-foreground mt-1">Checking…</div>
              ) : verify?.ok ? (
                <div className="mt-1">
                  {verify.workspaceName ? (
                    <div className="font-semibold">{verify.workspaceName}</div>
                  ) : verify.numbers && verify.numbers.length > 0 ? (
                    <div className="font-semibold">
                      Workspace with number {verify.numbers.map((n) => n.display_phone_number).filter(Boolean).join(", ")}
                    </div>
                  ) : (
                    <div className="text-amber-700">
                      The key works (Vartify replied{verify.httpStatus ? ` HTTP ${verify.httpStatus}` : ""}), but no
                      workspace name or sender number came back — this usually means the WhatsApp number isn’t set
                      up in this Vartify workspace yet, or this is a <span className="font-medium">webhook</span> key
                      rather than an <span className="font-medium">API</span> key (generate one in Vartify → API
                      Keys). Finish setup in the Vartify console, then re-check.
                    </div>
                  )}
                  {verify.workspaceName && verify.numbers && verify.numbers.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Sender{verify.numbers.length > 1 ? "s" : ""}:{" "}
                      {verify.numbers.map((n) => n.display_phone_number).filter(Boolean).join(", ")}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1.5">
                    WhatsApp templates are created &amp; approved in the Vartify console — Vartify’s API has no
                    “create template” endpoint, so templates made in the CRM are <span className="font-medium">not</span>{" "}
                    sent to Meta. Author them in Vartify → wait for Meta approval → “Fetch from WhatsApp”.{" "}
                    <a href="https://wapi.ssit.com" target="_blank" rel="noopener noreferrer" className="text-brand-cyan-deep underline">
                      Open Vartify console ↗
                    </a>
                  </p>
                </div>
              ) : verify ? (
                <div className="text-xs text-rose-600 mt-1">
                  Couldn’t verify: {verify.error ?? "unknown error"}. Your key may be wrong — Update key.
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Vartify webhook key (api_key) <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="e.g. SSIT@001"
                autoComplete="off"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono bg-background"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Find this in Vartify → Developer / Webhooks. Stored encrypted; we never show it back.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Endpoint URL (optional — leave blank)
                </label>
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="Leave blank — defaults to beckend.ssit.com"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-background"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Only set this if SSIT gives you a custom host. The API path is added automatically.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Default language
                </label>
                <input
                  type="text"
                  value={defaultLanguage}
                  onChange={(e) => setDefaultLanguage(e.target.value)}
                  placeholder="en_US"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono bg-background"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving || apiKey.trim().length === 0}
                className="text-sm px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {connected ? "Update key" : "Connect Vartify"}
              </button>
              {connected && (
                <button
                  onClick={() => {
                    setEditing(false);
                    setApiKey("");
                  }}
                  className="text-sm px-3 py-2 rounded-md border hover:bg-accent"
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}

        {msg && (
          <p className={`text-sm ${msg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
