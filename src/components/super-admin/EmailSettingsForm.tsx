"use client";

import { useState } from "react";
import { Mail, KeyRound, Loader2, CheckCircle2, XCircle, Save, Send, Eye, EyeOff } from "lucide-react";

type Status = {
  configured: boolean;
  source: string;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string;
  hasPassword: boolean;
};

export function EmailSettingsForm({ initial }: { initial: Status }) {
  const [host, setHost] = useState(initial.host ?? "");
  const [port, setPort] = useState(String(initial.port || 587));
  const [secure, setSecure] = useState(initial.secure);
  const [user, setUser] = useState(initial.user ?? "");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [from, setFrom] = useState(initial.from);
  const [status, setStatus] = useState(initial);
  const [testTo, setTestTo] = useState("");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const needsPass = !status.hasPassword && !pass.trim();

  async function save() {
    if (!host.trim() || !user.trim()) {
      setMsg({ kind: "err", text: "Host and username are required." });
      return;
    }
    if (needsPass) {
      setMsg({ kind: "err", text: "Enter the SMTP password." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port: Number(port) || 587, secure, user, pass: pass || undefined, from }),
      });
      const data = await res.json();
      if (!res.ok) setMsg({ kind: "err", text: data.error || "Save failed." });
      else {
        setStatus(data.status);
        setPass("");
        setMsg({ kind: "ok", text: "Saved — reset links & invites now send via your SMTP server. Use “Send test” to confirm." });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!testTo.trim()) {
      setMsg({ kind: "err", text: "Enter an address to send the test to." });
      return;
    }
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/email-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim() }),
      });
      const data = await res.json();
      if (data.ok) setMsg({ kind: "ok", text: `Test email sent to ${testTo.trim()} — check the inbox (and spam).` });
      else setMsg({ kind: "err", text: data.error || "Send failed — check host/port/credentials." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setTesting(false);
    }
  }

  const busy = saving || testing;
  const inputCls = "w-full rounded-md border px-3 py-2 text-sm";

  return (
    <div className="border rounded-lg bg-card p-4 sm:p-5 space-y-5 w-full max-w-2xl">
      <div className="flex items-center gap-2">
        <Mail className="size-5 text-muted-foreground" />
        <div>
          <h2 className="font-semibold">Email sending (SMTP)</h2>
          <p className="text-xs text-muted-foreground">
            Use your own mail server. Powers password-reset links, team invites &amp; staff alerts. The password is encrypted at rest.
          </p>
        </div>
      </div>

      {/* Status */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`px-2 py-1 rounded-full ${status.configured ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {status.configured ? "Configured" : "Not configured"}
        </span>
        <span className="px-2 py-1 rounded-full bg-muted">Source: {status.source === "db" ? "SSIT Admin" : status.source === "env" ? "env var" : "none"}</span>
        {status.host && <span className="px-2 py-1 rounded-full bg-muted">{status.host}:{status.port}</span>}
      </div>

      {/* Server */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-medium">SMTP host</label>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.yourprovider.com" className={inputCls} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Port</label>
          <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} placeholder="587" className={inputCls} inputMode="numeric" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} className="size-4" />
        Use implicit TLS (port 465). Leave unchecked for STARTTLS (port 587).
      </label>

      {/* Auth */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Username</label>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="you@yourdomain.com" className={inputCls} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5"><KeyRound className="size-3.5" /> Password</label>
          <div className="relative">
            <input
              type={showPass ? "text" : "password"}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={status.hasPassword ? "•••• saved (leave blank to keep)" : "SMTP password / app password"}
              className={`${inputCls} pr-10 font-mono ${needsPass ? "border-rose-300" : ""}`}
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1" aria-label="Toggle password">
              {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* From */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">From address</label>
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="SSIT CRM <connect@ssit.com>" className={inputCls} />
        <p className="text-[11px] text-muted-foreground">Many providers require the From to match the authenticated mailbox/domain.</p>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 text-sm rounded-md px-3 py-2 ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {msg.kind === "ok" ? <CheckCircle2 className="size-4 mt-0.5" /> : <XCircle className="size-4 mt-0.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium disabled:opacity-60">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save changes
        </button>
      </div>

      {/* Test send */}
      <div className="border-t pt-4 space-y-2">
        <label className="text-sm font-medium">Send a test email</label>
        <div className="flex flex-wrap items-center gap-2">
          <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className="flex-1 w-full min-w-0 sm:min-w-[220px] rounded-md border px-3 py-2 text-sm" />
          <button type="button" onClick={test} disabled={busy || !status.configured} title={!status.configured ? "Save SMTP settings first" : undefined} className="inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60">
            {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send test
          </button>
        </div>
      </div>
    </div>
  );
}
