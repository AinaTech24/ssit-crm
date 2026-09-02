"use client";

/**
 * Reset-password form — the screen the emailed link lands on.
 *
 * Redesigned alongside forgot-password so the flow doesn't drop from the
 * branded split-screen into a bare centred box halfway through. Also adds the
 * error handling it lacked: a mismatch was the only thing checked client-side,
 * a network failure threw unhandled, and an expired token surfaced as a raw
 * API string with no way forward.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Loader2, TriangleAlert } from "lucide-react";
import { PasswordInput } from "@/components/ui/PasswordInput";

/** Minimum the API enforces; mirrored here so the rule is visible while typing. */
const MIN_LEN = 8;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const longEnough = password.length >= MIN_LEN;
  const matches = confirm.length > 0 && password === confirm;
  const canSubmit = longEnough && matches && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!longEnough) {
      setErr(`Use at least ${MIN_LEN} characters.`);
      return;
    }
    if (!matches) {
      setErr("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        // A dead token is the common case and needs a route forward, not a
        // red string the user can do nothing with.
        if (res.status === 400 || res.status === 410) setExpired(true);
        setErr((j as { error?: string }).error ?? `Reset failed (HTTP ${res.status}).`);
        return;
      }
      router.push("/dashboard");
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (expired) {
    return (
      <>
        <div className="size-12 rounded-2xl bg-amber-50 border border-amber-200 grid place-items-center">
          <TriangleAlert className="size-6 text-amber-600" />
        </div>
        <h1 className="mt-5 text-[1.9rem] font-extrabold tracking-tight text-foreground leading-tight">
          This link has expired
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Reset links are valid for 1 hour and can only be used once. Request a fresh one and it will
          arrive in a moment.
        </p>
        <Link href="/forgot-password" className="btn-primary w-full mt-6">
          Send a new link <ArrowRight className="size-4" />
        </Link>
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
        Set a new password
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Choose a password you don&apos;t use anywhere else. You&apos;ll be signed in straight away.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="text-xs font-semibold text-foreground/80 block mb-1.5">New password</label>
          <PasswordInput
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (err) setErr(null);
            }}
            autoComplete="new-password"
            required
            autoFocus
            placeholder="••••••••"
          />
          <p
            className={`mt-1.5 text-[11px] inline-flex items-center gap-1 ${
              longEnough ? "text-emerald-600" : "text-muted-foreground"
            }`}
          >
            {longEnough && <Check className="size-3" />}
            At least {MIN_LEN} characters
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
            Confirm password
          </label>
          <PasswordInput
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (err) setErr(null);
            }}
            autoComplete="new-password"
            required
            placeholder="••••••••"
          />
          {confirm.length > 0 && (
            <p
              className={`mt-1.5 text-[11px] inline-flex items-center gap-1 ${
                matches ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {matches ? (
                <>
                  <Check className="size-3" /> Passwords match
                </>
              ) : (
                "Passwords don't match yet"
              )}
            </p>
          )}
        </div>

        {err && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
          >
            <TriangleAlert className="size-4 shrink-0 mt-px" />
            <span>{err}</span>
          </div>
        )}

        <button disabled={!canSubmit} className="btn-primary w-full mt-2">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              Set password &amp; sign in <ArrowRight className="size-4" />
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
