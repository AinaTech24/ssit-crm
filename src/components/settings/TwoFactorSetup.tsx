"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2, Copy, Check } from "lucide-react";

type Mode = "idle" | "enrolling" | "showBackup";

export function TwoFactorSetup({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Enrollment state
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // Disable state
  const [password, setPassword] = useState("");

  async function startSetup() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not start setup");
        return;
      }
      setQr(j.qrDataUrl);
      setSecret(j.secret);
      setMode("enrolling");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Invalid code");
        return;
      }
      setBackupCodes(j.backupCodes ?? []);
      setEnabled(true);
      setMode("showBackup");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not disable");
        return;
      }
      setEnabled(false);
      setMode("idle");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-6 max-w-xl">
      <div className="flex items-center gap-3 mb-1">
        {enabled ? (
          <ShieldCheck className="size-5 text-emerald-600" />
        ) : (
          <ShieldAlert className="size-5 text-amber-500" />
        )}
        <h2 className="text-lg font-semibold">Two-factor authentication</h2>
        <span
          className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
            enabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {enabled ? "Enabled" : "Not enabled"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Add a one-time code from an authenticator app (Google Authenticator, Authy,
        1Password) on top of your password. Strongly recommended for an account with
        access to client PII.
      </p>

      {err && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive mb-4">
          {err}
        </div>
      )}

      {/* IDLE — not enrolling */}
      {mode === "idle" && !enabled && (
        <button onClick={startSetup} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          Set up 2FA
        </button>
      )}

      {/* IDLE — already enabled → offer disable */}
      {mode === "idle" && enabled && (
        <form onSubmit={disable} className="space-y-3">
          <p className="text-sm">To turn off 2FA, confirm your password.</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
            className="input-base max-w-xs"
            required
          />
          <button disabled={busy} className="btn-secondary text-destructive border-destructive/40">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
            Disable 2FA
          </button>
        </form>
      )}

      {/* ENROLLING — show QR + secret + verify */}
      {mode === "enrolling" && (
        <div className="space-y-4">
          <ol className="text-sm space-y-3 list-decimal pl-5">
            <li>Scan this QR in your authenticator app:</li>
          </ol>
          {qr && (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="2FA QR code" className="size-48 rounded-lg border bg-white p-1" />
              <div className="text-center">
                <div className="text-xs text-muted-foreground">Or enter this key manually</div>
                <button
                  type="button"
                  onClick={() => {
                    if (secret) {
                      navigator.clipboard.writeText(secret);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }
                  }}
                  className="font-mono text-sm tracking-wider inline-flex items-center gap-1.5 hover:underline"
                >
                  {secret}
                  {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                </button>
              </div>
            </div>
          )}
          <form onSubmit={confirmEnable} className="space-y-3">
            <label className="text-sm font-medium block">Enter the 6-digit code to confirm</label>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="input-base max-w-[160px] text-center text-lg tracking-[0.4em] font-mono"
              required
            />
            <div className="flex gap-2">
              <button disabled={busy || code.length !== 6} className="btn-primary">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Verify & enable
              </button>
              <button type="button" onClick={() => setMode("idle")} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* BACKUP CODES — one-time display */}
      {mode === "showBackup" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <strong>2FA is on.</strong> Save these backup codes somewhere safe — each works
            once if you lose your authenticator. They won&apos;t be shown again.
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm">
            {backupCodes.map((c) => (
              <div key={c} className="rounded border bg-muted/40 px-3 py-1.5 text-center tracking-wider">
                {c}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(backupCodes.join("\n"))}
            className="btn-secondary"
          >
            <Copy className="size-4" /> Copy all
          </button>
          <button type="button" onClick={() => setMode("idle")} className="btn-primary ml-2">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
