"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, Check, X, Plug, ServerCog, Inbox, Mail } from "lucide-react";
import { NavButton } from "@/components/common/SecureLinkButtons";

type Server = { host: string; port: number; secure: boolean; user: string; pass: string };

const PRESETS: Record<string, { label: string; smtp: Partial<Server>; imap: Partial<Server>; note?: string; appPwUrl?: string }> = {
  custom: { label: "Custom / other", smtp: {}, imap: {} },
  gmail: {
    label: "Gmail / Google Workspace",
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    note: "Turn on 2-Step Verification, then create an App Password and paste it below — your normal Gmail password will NOT work.",
    appPwUrl: "https://myaccount.google.com/apppasswords",
  },
  microsoft: {
    label: "Outlook / Microsoft 365",
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    note: "If 2-factor auth is on, create an App Password and make sure authenticated SMTP/IMAP is enabled for this mailbox.",
    appPwUrl: "https://account.microsoft.com/security",
  },
  zoho_in: {
    label: "Zoho Mail (India · .in)",
    smtp: { host: "smtp.zoho.in", port: 465, secure: true },
    imap: { host: "imap.zoho.in", port: 993, secure: true },
    note: "1) Enable IMAP in Zoho Mail (Settings → Mail Accounts → IMAP Access). 2) Create an App Password and paste it below — your normal Zoho password will NOT work.",
    appPwUrl: "https://accounts.zoho.in/home#security/app_password",
  },
  zoho_com: {
    label: "Zoho Mail (Global · .com)",
    smtp: { host: "smtp.zoho.com", port: 465, secure: true },
    imap: { host: "imap.zoho.com", port: 993, secure: true },
    note: "1) Enable IMAP in Zoho Mail (Settings → Mail Accounts → IMAP Access). 2) Create an App Password and paste it below — your normal Zoho password will NOT work.",
    appPwUrl: "https://accounts.zoho.com/home#security/app_password",
  },
};

export function MailboxForm({
  initial,
  scope = "tenant",
  oauth = null,
  oauthAvailable = { google: false, microsoft: false },
}: {
  initial: {
    connected: boolean;
    smtp: { host: string; port: number; secure: boolean; user: string; hasPass: boolean } | null;
    imap: { host: string; port: number; secure: boolean; user: string; hasPass: boolean } | null;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    firmName: string;
    firmEmail: string;
  };
  /** "tenant" = firm-wide mailbox (owner). "user" = the RM's personal mailbox. */
  scope?: "tenant" | "user";
  /** Current OAuth binding, if the mailbox was connected via Google/Microsoft. */
  oauth?: { provider: string; email: string | null } | null;
  /** Which OAuth providers the server has credentials for (buttons enabled). */
  oauthAvailable?: { google: boolean; microsoft: boolean };
}) {
  const router = useRouter();
  const qs = scope === "user" ? "?scope=user" : "";
  const isUser = scope === "user";
  const [preset, setPreset] = useState("custom");
  const [smtp, setSmtp] = useState<Server>({
    host: initial.smtp?.host ?? "",
    port: initial.smtp?.port ?? 465,
    secure: initial.smtp?.secure ?? true,
    user: initial.smtp?.user ?? initial.firmEmail ?? "",
    pass: "",
  });
  const [imap, setImap] = useState<Server>({
    host: initial.imap?.host ?? "",
    port: initial.imap?.port ?? 993,
    secure: initial.imap?.secure ?? true,
    user: initial.imap?.user ?? initial.smtp?.user ?? initial.firmEmail ?? "",
    pass: "",
  });
  const [fromName, setFromName] = useState(initial.fromName || initial.firmName || "");
  const [fromEmail, setFromEmail] = useState(initial.fromEmail || "");
  const [replyTo, setReplyTo] = useState(initial.replyTo || initial.firmEmail || "");

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<{ smtp?: { ok: boolean; msg: string }; imap?: { ok: boolean; msg: string }; busy?: "smtp" | "imap" }>({});

  function applyPreset(key: string) {
    setPreset(key);
    const p = PRESETS[key];
    if (key === "custom") return;
    setSmtp((s) => ({ ...s, ...p.smtp } as Server));
    setImap((s) => ({ ...s, ...p.imap } as Server));
  }

  async function runTest(kind: "smtp" | "imap") {
    setTest((t) => ({ ...t, busy: kind, [kind]: undefined }));
    try {
      const config = kind === "smtp" ? smtp : imap;
      const res = await fetch("/api/settings/integrations/mailbox/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, config, scope }),
      });
      const j = await res.json().catch(() => ({}));
      setTest((t) => ({ ...t, busy: undefined, [kind]: { ok: !!j.ok, msg: j.ok ? "Connected" : j.error ?? "Failed" } }));
    } catch (e: any) {
      setTest((t) => ({ ...t, busy: undefined, [kind]: { ok: false, msg: e.message ?? "Failed" } }));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/settings/integrations/mailbox${qs}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ smtp, imap: imap.host ? imap : undefined, fromName, fromEmail, replyTo }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Save failed");
        return;
      }
      setSaved(true);
      setSmtp((s) => ({ ...s, pass: "" }));
      setImap((s) => ({ ...s, pass: "" }));
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (e: any) {
      setErr(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect this mailbox? Client emails will fall back to the firm mailbox / platform sender.")) return;
    setBusy(true);
    try {
      await fetch(`/api/settings/integrations/mailbox${qs}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="border rounded-lg bg-card p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold flex items-center gap-1.5">
            <Plug className="size-4 text-brand-cyan" />{" "}
            {isUser ? "Connect my mailbox (SMTP / IMAP)" : "Connect the firm mailbox (SMTP / IMAP)"}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isUser
              ? "Your client emails go out from your own address, and replies land back in your inbox."
              : "The firm-wide default — used when an RM hasn't connected their own mailbox. Goes out as your real address, no domain verification needed."}
          </p>
        </div>
        {(initial.connected || oauth) && (
          <span className="text-[11px] rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 font-semibold whitespace-nowrap">
            ● Connected
          </span>
        )}
      </div>

      {/* OAuth quick-connect (Gmail / Microsoft 365) */}
      {oauth ? (
        <div className="rounded-md border bg-emerald-50 border-emerald-200 p-3 text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-emerald-800">
            <Check className="size-4" />
            Connected via {oauth.provider === "google" ? "Google" : "Microsoft 365"}
            {oauth.email ? <span className="font-medium">· {oauth.email}</span> : null}
          </span>
          <button type="button" onClick={disconnect} disabled={busy} className="text-xs text-rose-600 hover:underline disabled:opacity-50">
            Disconnect
          </button>
        </div>
      ) : (
        (oauthAvailable.google || oauthAvailable.microsoft) && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Quick connect — no password, no app-password</div>
            <div className="flex flex-wrap gap-2">
              {oauthAvailable.google && (
                <NavButton
                  url={`/api/settings/integrations/mailbox/oauth/google/start${qs}`}
                  className="rounded-md border px-3 py-1.5 text-sm inline-flex items-center gap-1.5 hover:bg-accent"
                >
                  <Mail className="size-4 text-rose-500" /> Connect Gmail
                </NavButton>
              )}
              {oauthAvailable.microsoft && (
                <NavButton
                  url={`/api/settings/integrations/mailbox/oauth/microsoft/start${qs}`}
                  className="rounded-md border px-3 py-1.5 text-sm inline-flex items-center gap-1.5 hover:bg-accent"
                >
                  <Mail className="size-4 text-sky-600" /> Connect Outlook / Microsoft 365
                </NavButton>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">Or set up SMTP / IMAP manually below.</p>
          </div>
        )
      )}

      <div>
        <label className="text-xs font-medium text-muted-foreground">Provider preset</label>
        <select
          value={preset}
          onChange={(e) => applyPreset(e.target.value)}
          className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
        >
          {Object.entries(PRESETS).map(([k, p]) => (
            <option key={k} value={k}>{p.label}</option>
          ))}
        </select>
        {PRESETS[preset].note && (
          <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 leading-relaxed">
            {PRESETS[preset].note}
            {PRESETS[preset].appPwUrl && (
              <>
                {" "}
                <a href={PRESETS[preset].appPwUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                  Create app password →
                </a>
              </>
            )}
          </div>
        )}
      </div>

      {/* SMTP — sending */}
      <ServerBlock
        icon={ServerCog}
        title="Outgoing — SMTP (sending)"
        server={smtp}
        onChange={setSmtp}
        hasSavedPass={!!initial.smtp?.hasPass}
        onTest={() => runTest("smtp")}
        test={test.smtp}
        testing={test.busy === "smtp"}
      />

      {/* IMAP — receiving */}
      <ServerBlock
        icon={Inbox}
        title="Incoming — IMAP (receiving replies) · optional"
        server={imap}
        onChange={setImap}
        hasSavedPass={!!initial.imap?.hasPass}
        onTest={() => runTest("imap")}
        test={test.imap}
        testing={test.busy === "imap"}
      />

      {/* From identity */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="From name">
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background" placeholder="We Care Wealth" />
        </Field>
        <Field label="From email">
          <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} type="email" className="w-full border rounded-md px-3 py-2 text-sm bg-background" placeholder="defaults to SMTP user" />
        </Field>
        <Field label="Reply-to">
          <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} type="email" className="w-full border rounded-md px-3 py-2 text-sm bg-background" placeholder="you@yourfirm.com" />
        </Field>
      </div>

      {err && <div className="text-sm text-rose-600">{err}</div>}

      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : <Save className="size-4" />}
          {saved ? "Saved" : "Save & connect"}
        </button>
        {initial.connected && (
          <button type="button" onClick={disconnect} disabled={busy} className="btn-ghost text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50">
            Disconnect
          </button>
        )}
      </div>
    </form>
  );
}

function ServerBlock({
  icon: Icon,
  title,
  server,
  onChange,
  hasSavedPass,
  onTest,
  test,
  testing,
}: {
  icon: any;
  title: string;
  server: Server;
  onChange: (s: Server) => void;
  hasSavedPass: boolean;
  onTest: () => void;
  test?: { ok: boolean; msg: string };
  testing: boolean;
}) {
  const set = (k: keyof Server, v: any) => onChange({ ...server, [k]: v });
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="text-sm font-medium flex items-center gap-1.5">
        <Icon className="size-4 text-muted-foreground" /> {title}
      </div>
      <div className="grid sm:grid-cols-[1fr_90px_auto] gap-2">
        <Field label="Host">
          <input value={server.host} onChange={(e) => set("host", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background" placeholder="smtp.example.com" />
        </Field>
        <Field label="Port">
          <input value={server.port} onChange={(e) => set("port", Number(e.target.value) || 0)} type="number" className="w-full border rounded-md px-2 py-2 text-sm bg-background" />
        </Field>
        <Field label="SSL">
          <label className="flex items-center gap-1.5 h-[38px] text-xs">
            <input type="checkbox" checked={server.secure} onChange={(e) => set("secure", e.target.checked)} /> SSL/TLS
          </label>
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label="Username">
          <input value={server.user} onChange={(e) => set("user", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background" placeholder="you@yourfirm.com" autoComplete="off" />
        </Field>
        <Field label="Password / app password">
          <input value={server.pass} onChange={(e) => set("pass", e.target.value)} type="password" autoComplete="new-password" placeholder={hasSavedPass ? "•••• (unchanged)" : "••••••••"} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </Field>
      </div>
      <div className="flex items-start gap-2 flex-wrap">
        <button type="button" onClick={onTest} disabled={testing || !server.host} className="rounded-md border px-2.5 py-1 text-xs inline-flex items-center gap-1 hover:bg-accent disabled:opacity-50 shrink-0">
          {testing ? <Loader2 className="size-3 animate-spin" /> : <Plug className="size-3" />} Test connection
        </button>
        {test && (
          <span className={`text-xs inline-flex items-start gap-1 leading-snug max-w-prose ${test.ok ? "text-emerald-600" : "text-rose-600"}`}>
            {test.ok ? <Check className="size-3.5 shrink-0 mt-px" /> : <X className="size-3.5 shrink-0 mt-px" />}
            <span>{test.msg}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
