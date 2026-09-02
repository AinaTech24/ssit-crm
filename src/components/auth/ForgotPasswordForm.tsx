"use client";

/**
 * Forgot-password form.
 *
 * The previous version had no error handling at all: it awaited res.json()
 * without a catch and showed the success card unconditionally, so a 500, a rate
 * limit or a dropped connection all rendered as "a reset link is on the way".
 * People then waited for an email that was never sent.
 *
 * The response stays deliberately non-committal about whether the address
 * exists — that's an account-enumeration defence, not an oversight — but a
 * genuine FAILURE is now reported as one.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2, MailCheck, TriangleAlert } from "lucide-react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await res.json().catch(() => ({}) as Record<string, unknown>);

      if (!res.ok) {
        setErr(
          res.status === 429
            ? "Too many requests. Wait a minute and try again."
            : ((j as { error?: string }).error ??
              `Something went wrong (HTTP ${res.status}). Please try again.`)
        );
        return;
      }

      setDone(true);
      if ((j as { devResetUrl?: string }).devResetUrl) {
        setDevLink((j as { devResetUrl?: string }).devResetUrl!);
      }
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <div className="size-12 rounded-2xl bg-emerald-50 border border-emerald-200 grid place-items-center">
          <MailCheck className="size-6 text-emerald-600" />
        </div>
        <h1 className="mt-5 text-[1.9rem] font-extrabold tracking-tight text-foreground leading-tight">
          Check your inbox
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          If an account exists for{" "}
          <span className="font-semibold text-foreground break-all">{email}</span>, a reset link is on
          its way. It expires in 1 hour.
        </p>

        <div className="mt-6 rounded-lg border bg-card p-4 text-xs text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground text-[13px]">Not arrived?</p>
          <p>· Check spam and any promotions folder.</p>
          <p>· Confirm you used your work address.</p>
          <p>· Links are one-time — always open the newest email.</p>
        </div>

        {devLink && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Dev mode</p>
            <Link href={devLink} className="mt-1 block text-xs font-mono break-all text-amber-900 underline">
              {devLink}
            </Link>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setDone(false);
            setDevLink(null);
          }}
          className="btn-ghost w-full mt-5"
        >
          Use a different email
        </button>

        <p className="mt-4 text-center">
          <Link
            href="/login"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Back to sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[1.9rem] font-extrabold tracking-tight text-foreground leading-tight">
        Forgot password?
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Enter your work email and we&apos;ll send a reset link. It stays valid for 1 hour.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4" noValidate={false}>
        <div>
          <label htmlFor="fp-email" className="text-xs font-semibold text-foreground/80 block mb-1.5">
            Work email
          </label>
          <input
            id="fp-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (err) setErr(null);
            }}
            required
            autoFocus
            autoComplete="email"
            placeholder="you@yourfirm.com"
            aria-invalid={!!err}
            aria-describedby={err ? "fp-error" : undefined}
            className="input-base"
          />
        </div>

        {err && (
          <div
            id="fp-error"
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
          >
            <TriangleAlert className="size-4 shrink-0 mt-px" />
            <span>{err}</span>
          </div>
        )}

        <button disabled={busy || !email.trim()} className="btn-primary w-full mt-2">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Sending…
            </>
          ) : (
            <>
              Send reset link <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </form>

      <p className="mt-6 text-center">
        <Link
          href="/login"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Back to sign in
        </Link>
      </p>
    </>
  );
}
