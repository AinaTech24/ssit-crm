"use client";

import { useState } from "react";
import { Inbox, KeyRound, Loader2, CheckCircle2, XCircle, Save, PlugZap, Eye, EyeOff } from "lucide-react";

type Status = {
  mode: "imap" | "ses";
  sesRegion: string;
  sesBucket: string;
  sesPrefix: string;
  configured: boolean;
  source: string;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  domain: string;
  hasPassword: boolean;
  deleteAfterImport: boolean;
  retentionDays: number;
};

export function RtaInboxSettingsForm({ initial }: { initial: Status }) {
  const [mode, setMode] = useState<"imap" | "ses">(initial.mode ?? "imap");
  const [sesRegion, setSesRegion] = useState(initial.sesRegion || "ap-south-1");
  const [sesBucket, setSesBucket] = useState(initial.sesBucket || "");
  const [sesPrefix, setSesPrefix] = useState(initial.sesPrefix ?? "rta-inbound/");
  const [host, setHost] = useState(initial.host ?? "");
  const [port, setPort] = useState(String(initial.port || 993));
  const [secure, setSecure] = useState(initial.secure);
  const [user, setUser] = useState(initial.user ?? "");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [domain, setDomain] = useState(initial.domain);
  const [deleteAfterImport, setDeleteAfterImport] = useState(initial.deleteAfterImport);
  const [retentionDays, setRetentionDays] = useState(String(initial.retentionDays ?? 7));
  const [status, setStatus] = useState(initial);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const needsPass = !status.hasPassword && !pass.trim();

  async function save() {
    if (mode === "ses") {
      if (!sesBucket.trim() || !sesRegion.trim()) {
        setMsg({ kind: "err", text: "Enter the AWS region and the S3 bucket name." });
        return;
      }
    } else {
      if (!host.trim() || !user.trim()) {
        setMsg({ kind: "err", text: "Host and username are required." });
        return;
      }
      if (needsPass) {
        setMsg({ kind: "err", text: "Enter the mailbox password." });
        return;
      }
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/rta-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          sesRegion,
          sesBucket,
          sesPrefix,
          // The mailbox fields are kept as they were when SES is chosen, so
          // switching back needs no re-typing.
          host: host || undefined,
          port: Number(port) || 993,
          secure,
          user: user || undefined,
          pass: pass || undefined,
          domain,
          deleteAfterImport,
          retentionDays: Number(retentionDays) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) setMsg({ kind: "err", text: data.error || "Save failed." });
      else {
        setStatus(data.status);
        setPass("");
        setMsg({ kind: "ok", text: "Saved. The poller picks this up within ~2 minutes — use “Test connection” to confirm now." });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setSaving(false);
    }
  }

  async function revealSaved() {
    setRevealing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/rta-inbox?reveal=1", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error || "Could not reveal the password." });
      } else if (!data.password) {
        setMsg({ kind: "err", text: "No saved password to show (or it could not be decrypted)." });
      } else {
        setPass(data.password);
        setShowPass(true);
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setRevealing(false);
    }
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/rta-inbox/test", { method: "POST" });
      const data = await res.json();
      if (data.ok)
        setMsg({
          kind: "ok",
          text:
            mode === "ses"
              ? `Connected — the bucket is readable. ${data.waiting ?? 0} email(s) waiting to be imported.`
              : "Connected — the mailbox is reachable and the INBOX is readable. 🎉",
        });
      else setMsg({ kind: "err", text: data.error || "Connection failed — check host/port/credentials." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setTesting(false);
    }
  }

  const busy = saving || testing || revealing;
  const inputCls = "w-full rounded-md border px-3 py-2 text-sm";

  return (
    <div className="border rounded-lg bg-card p-4 sm:p-5 space-y-5 w-full max-w-2xl">
      <div className="flex items-center gap-2">
        <Inbox className="size-5 text-muted-foreground" />
        <div>
          <h2 className="font-semibold">RTA mailback inbox</h2>
          <p className="text-xs text-muted-foreground">
            Where every MFD&apos;s forwarded CAMS/KFintech mailback email arrives. Choose a mailbox (IMAP) or Amazon SES.
          </p>
        </div>
      </div>

      {/* Status */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`px-2 py-1 rounded-full ${status.configured ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {status.configured ? "Configured" : "Not configured"}
        </span>
        <span className="px-2 py-1 rounded-full bg-muted">Source: {status.source === "db" ? "Equitywala Admin" : status.source === "env" ? "env var" : "none"}</span>
        <span className="px-2 py-1 rounded-full bg-muted">Reading from: {status.mode === "ses" ? "Amazon SES" : "IMAP mailbox"}</span>
        {status.mode === "ses" && status.sesBucket && (
          <span className="px-2 py-1 rounded-full bg-muted">s3://{status.sesBucket}/{status.sesPrefix}</span>
        )}
        {status.mode !== "ses" && status.host && <span className="px-2 py-1 rounded-full bg-muted">{status.host}:{status.port}</span>}
        <span className="px-2 py-1 rounded-full bg-muted">Addresses: rta-…@{status.domain}</span>
      </div>

      {/* Source */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Inbound source</label>
        <div className="inline-flex rounded-lg border bg-secondary/40 p-1 gap-1">
          {([
            ["ses", "Amazon SES (recommended)"],
            ["imap", "IMAP mailbox"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${mode === k ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "ses" && (
        <div className="space-y-4 rounded-md border bg-muted/20 p-4">
          <p className="text-xs text-muted-foreground">
            Amazon SES saves every email sent to <code className="bg-background px-1 rounded">*@{domain || "crm.equitywala.com"}</code> as a
            file in an S3 bucket. The worker reads those files, imports them, and deletes each one once handled.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium">S3 bucket name</label>
              <input value={sesBucket} onChange={(e) => setSesBucket(e.target.value.trim())} placeholder="equitywala-rta-inbound" className={inputCls} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">AWS region</label>
              <input value={sesRegion} onChange={(e) => setSesRegion(e.target.value.trim())} placeholder="ap-south-1" className={inputCls} autoComplete="off" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Folder (object key prefix)</label>
            <input value={sesPrefix} onChange={(e) => setSesPrefix(e.target.value.trim())} placeholder="rta-inbound/" className={inputCls} autoComplete="off" />
            <p className="text-[11px] text-muted-foreground">Must match the prefix in the SES receipt rule&apos;s S3 action.</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The server reads the bucket with its own AWS role — no keys are entered here. It needs <code>s3:ListBucket</code> on the
            bucket and <code>s3:GetObject</code> + <code>s3:DeleteObject</code> on the folder.
          </p>
        </div>
      )}

      {mode === "imap" && (<>
      {/* Server */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-medium">IMAP host</label>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.hostinger.com" className={inputCls} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Port</label>
          <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} placeholder="993" className={inputCls} inputMode="numeric" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} className="size-4" />
        Use SSL/TLS (port 993). Recommended.
      </label>

      {/* Auth */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Mailbox (username)</label>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="rta@crm.equitywala.com" className={inputCls} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5"><KeyRound className="size-3.5" /> Password</label>
          <div className="relative">
            <input
              type={showPass ? "text" : "password"}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={status.hasPassword ? "•••• saved (leave blank to keep)" : "mailbox password"}
              className={`${inputCls} pr-10 font-mono ${needsPass ? "border-rose-300" : ""}`}
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1" aria-label="Toggle password">
              {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {status.hasPassword && !pass && (
            <button
              type="button"
              onClick={revealSaved}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              {revealing ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}
              Reveal saved password
            </button>
          )}
        </div>
      </div>

      </>)}

      {/* Domain */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Forwarding domain</label>
        <input value={domain} onChange={(e) => setDomain(e.target.value.trim())} placeholder="crm.equitywala.com" className={inputCls} />
        <p className="text-[11px] text-muted-foreground">
          Each firm gets <code className="bg-background px-1 rounded">rta-&lt;token&gt;@{domain || "crm.equitywala.com"}</code>. A catch-all on this domain must deliver into the mailbox above.
        </p>
      </div>

      {/* Mailbox cleanup (IMAP only — SES mail is removed from the bucket as it is handled) */}
      {mode === "imap" && (
      <div className="space-y-2 border-t pt-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={deleteAfterImport}
            onChange={(e) => setDeleteAfterImport(e.target.checked)}
            className="size-4 mt-0.5"
          />
          <span>
            <span className="font-medium">Delete forwarded mail once it has been imported</span>
            <span className="block text-[11px] text-muted-foreground mt-0.5">
              Keeps the mailbox from filling up with daily RTA ZIPs. Safe because the attachment is already copied to S3
              before the import runs, and the Inbound Mail log keeps the audit trail. Mail is only deleted when every
              import it created actually <strong>finished</strong> — a failed import (wrong ZIP password) keeps its mail
              so it can be re-run. Unroutable and errored mail is never deleted.
            </span>
          </span>
        </label>
        {deleteAfterImport && (
          <div className="flex items-center gap-2 pl-6">
            <label className="text-sm">Keep for</label>
            <input
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value.replace(/\D/g, ""))}
              className="w-20 rounded-md border px-2 py-1 text-sm"
              inputMode="numeric"
            />
            <span className="text-sm">days after import</span>
            {retentionDays === "0" && (
              <span className="text-[11px] text-amber-700">0 = delete at the next hourly sweep — no grace period.</span>
            )}
          </div>
        )}
      </div>
      )}

      {msg && (
        <div className={`flex items-start gap-2 text-sm rounded-md px-3 py-2 ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {msg.kind === "ok" ? <CheckCircle2 className="size-4 mt-0.5" /> : <XCircle className="size-4 mt-0.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium disabled:opacity-60">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save changes
        </button>
        <button type="button" onClick={test} disabled={busy || !status.configured} title={!status.configured ? "Save the settings first" : undefined} className="inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60">
          {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />} Test connection
        </button>
      </div>
    </div>
  );
}
