"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle, Plug, RefreshCw, Copy, KeyRound } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { SelectField } from "@/components/ui/SelectField";
import { NavButton } from "@/components/common/SecureLinkButtons";

const DATA_CENTERS = [
  { value: "in", label: "India (zoho.in)" },
  { value: "us", label: "United States (zoho.com)" },
  { value: "eu", label: "Europe (zoho.eu)" },
  { value: "au", label: "Australia (zoho.com.au)" },
  { value: "jp", label: "Japan (zoho.jp)" },
  { value: "ca", label: "Canada (zohocloud.ca)" },
  { value: "sa", label: "Saudi Arabia (zoho.sa)" },
  { value: "cn", label: "China (zoho.com.cn)" },
];

// Modules pushed to Zoho. NATIVE modules already exist in every Zoho org; the
// CUSTOM ones the MFD must create (Setup → Modules and Fields → New Module)
// with the matching API name before they sync. Every target also needs the
// Equitywala_Record_ID single-line field. Keep in sync with ZOHO_MAPPINGS.
const SYNCED_MODULES: { label: string; zoho: string; native?: boolean }[] = [
  { label: "Clients", zoho: "Contacts", native: true },
  { label: "Leads", zoho: "Leads", native: true },
  { label: "Tasks", zoho: "Tasks", native: true },
  { label: "Meetings", zoho: "Meetings" },
  { label: "Risk Profiles", zoho: "Risk_Profiles" },
  { label: "Families", zoho: "Families" },
  { label: "Insurance Policies", zoho: "Insurance_Policies" },
  { label: "Insurance Claims", zoho: "Insurance_Claims" },
  { label: "Transactions", zoho: "Business_Entries" },
  { label: "SIP Tracker", zoho: "SIPs" },
  { label: "SIP Rejections", zoho: "SIP_Rejections" },
  { label: "Scheme Master", zoho: "Schemes" },
];

type Status = {
  hasCredentials: boolean;
  connected: boolean;
  dataCenter: string | null;
  grantedBy: string | null;
  clientIdHint: string | null;
  counts: { synced: number; error: number; pending: number };
};

export function ZohoIntegrationCard() {
  const toast = useToast();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"view" | "edit">("edit");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [dc, setDc] = useState("in");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const redirectUri = useMemo(
    () => (typeof window !== "undefined" ? `${window.location.origin}/api/integrations/zoho/callback` : ""),
    []
  );

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/integrations/zoho/status");
      if (r.ok) {
        const s: Status = await r.json();
        setStatus(s);
        setMode(s.hasCredentials ? "view" : "edit");
        if (s.dataCenter) setDc(s.dataCenter);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const z = params.get("zoho");
    if (z === "connected") toast.success("Your records will start syncing to Zoho CRM.", "Zoho connected");
    else if (z === "error") toast.error("Check your Client ID/Secret and the redirect URL, then try again.", "Authentication failed");
    else if (z === "nocreds") toast.warning("Enter your Zoho Client ID and Secret first.", "Zoho");
  }, [params, toast]);

  async function saveCreds(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch("/api/integrations/zoho/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret, dataCenter: dc }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error || "Couldn't save the credentials.", "Zoho");
        return;
      }
      toast.success("Credentials saved — now authenticate with Zoho.", "Saved");
      setClientSecret("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Zoho? Syncing stops; your Zoho records and saved credentials are kept.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/integrations/zoho/disconnect", { method: "POST" });
      if (r.ok) {
        toast.success("Zoho disconnected.", "Done");
        await load();
      } else toast.error("Couldn't disconnect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function copyRedirect() {
    navigator.clipboard?.writeText(redirectUri).then(
      () => toast.success("Redirect URL copied.", "Copied"),
      () => {}
    );
  }

  const statusChip = loading ? (
    <Loader2 className="size-4 animate-spin text-muted-foreground" />
  ) : status?.connected ? (
    <span className="chip text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
      <CheckCircle2 className="size-3" /> Connected
    </span>
  ) : status?.hasCredentials ? (
    <span className="chip text-[11px] bg-amber-50 text-amber-700 border border-amber-200">Awaiting authentication</span>
  ) : (
    <span className="chip text-[11px] bg-secondary text-muted-foreground border border-border">Not connected</span>
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-brand-cyan-light grid place-items-center">
            <Plug className="size-5 text-brand-cyan-deep" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Zoho CRM</h3>
            <p className="text-xs text-muted-foreground">One-way sync — new &amp; updated records push to your Zoho CRM.</p>
          </div>
        </div>
        {statusChip}
      </div>

      {/* What syncs + Zoho-side setup */}
      <details className="text-xs border border-border rounded-lg bg-secondary/30">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-muted-foreground">
          Synced modules ({SYNCED_MODULES.length}) &amp; Zoho setup
        </summary>
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Each module below pushes to the named Zoho module. <strong>Native</strong> modules already exist; the
            others are <strong>custom modules you create</strong> in Zoho (Setup → Modules and Fields → New Module)
            using the exact API name shown. Add a single-line{" "}
            <code className="px-1 rounded bg-secondary">Equitywala_Record_ID</code> field to every one — that&rsquo;s what
            keeps the sync idempotent (no duplicate records). Create the other custom fields as single-line text,
            number or date (avoid picklists, so values are never rejected). Until a custom module exists, that
            module&rsquo;s rows are simply skipped.
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
            {SYNCED_MODULES.map((m) => (
              <li key={m.zoho} className="flex items-center justify-between gap-2">
                <span>{m.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {m.zoho}
                  {m.native ? "" : " · custom"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </details>

      {/* Connected — show counts + controls */}
      {!loading && status?.connected && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Synced" value={status.counts.synced} tone="emerald" />
            <Stat label="Failed" value={status.counts.error} tone={status.counts.error ? "rose" : "slate"} />
            <Stat label="Pending" value={status.counts.pending} tone="slate" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={disconnect} disabled={busy} className="btn-secondary text-xs disabled:opacity-60">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Disconnect
            </button>
            <NavButton url="/api/integrations/zoho/connect" className="btn-ghost text-xs" title="Re-run the Zoho consent flow">
              <RefreshCw className="size-3.5" /> Re-authenticate
            </NavButton>
            <button onClick={() => setMode("edit")} className="btn-ghost text-xs">
              <KeyRound className="size-3.5" /> Edit credentials
            </button>
            {status.dataCenter && <span className="text-[11px] text-muted-foreground ml-auto">DC: {status.dataCenter.toUpperCase()}</span>}
          </div>
        </>
      )}

      {/* Credentials saved, not yet authenticated */}
      {!loading && status?.hasCredentials && !status.connected && mode === "view" && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            App credentials saved{status.clientIdHint ? ` (Client ID ${status.clientIdHint})` : ""}. Finish by authenticating
            with Zoho.
          </div>
          <div className="flex items-center gap-2">
            <NavButton url="/api/integrations/zoho/connect" className="btn-primary text-xs">
              <Plug className="size-3.5" /> Authenticate with Zoho
            </NavButton>
            <button onClick={() => setMode("edit")} className="btn-ghost text-xs">
              <KeyRound className="size-3.5" /> Edit credentials
            </button>
          </div>
        </div>
      )}

      {/* Credentials form */}
      {!loading && mode === "edit" && (
        <form onSubmit={saveCreds} className="space-y-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Create a <strong>Server-based</strong> app in your{" "}
            <a href="https://api-console.zoho.in/" target="_blank" rel="noopener noreferrer" className="text-brand-cyan hover:underline">
              Zoho API Console
            </a>
            , add the redirect URL below, then paste its Client ID &amp; Secret here.
          </p>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Authorized redirect URL (paste this into your Zoho app)</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 text-[11px] bg-secondary rounded-md px-2.5 py-1.5 break-all">{redirectUri}</code>
              <button type="button" onClick={copyRedirect} className="btn-ghost text-xs shrink-0" title="Copy">
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Client ID</label>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                placeholder="1000.XXXXXXXX"
                className="input-base mt-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Data center</label>
              <SelectField value={dc} onChange={(e) => setDc(e.target.value)} className="mt-1 text-sm">
                {DATA_CENTERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Client Secret</label>
            <PasswordInput
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              required
              placeholder="Your Zoho app's client secret"
              className="input-base mt-1 text-sm"
            />
          </div>

          <div className="text-[11px] text-muted-foreground leading-relaxed rounded-lg border border-border bg-secondary/40 px-3 py-2 inline-flex items-start gap-2">
            <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
            In Zoho, add a single-line custom field named <code className="px-1 rounded bg-secondary">Equitywala_Record_ID</code> to
            every synced module — see the <strong>Synced modules</strong> list above. That&rsquo;s what stops the sync from
            creating duplicates.
          </div>

          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className="btn-primary text-xs disabled:opacity-60">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Save credentials
            </button>
            {status?.hasCredentials && (
              <button type="button" onClick={() => setMode("view")} className="btn-ghost text-xs">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "emerald" | "rose" | "slate" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card py-2">
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
