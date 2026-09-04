"use client";

/**
 * Unified auth screen — one component, two modes (login / signup).
 *
 * Switching between sign-in and sign-up does NOT navigate to another page:
 * the left brand panel and the right form swap in place with a smooth keyed
 * animation. /login and /signup both render this with the matching
 * initialMode, and the URL is reflected via history.replaceState on toggle.
 *
 * Single logo (left panel on desktop, centered wordmark on mobile — never
 * both at once). Colours come straight from the Equitywala palette (red primary,
 * teal accent).
 */

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight, ShieldCheck, Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PasswordInput } from "@/components/ui/PasswordInput";

type Mode = "login" | "signup";

const YEAR = new Date().getFullYear();

/**
 * Sanitise a ?next= destination. Accepts ONLY a same-origin absolute path
 * ("/knowledge-base/x"). Rejects protocol-relative ("//host"), backslash
 * variants ("/\host" — some browsers treat these as protocol-relative) and any
 * absolute URL, all of which would be an open redirect.
 */
function safeNext(raw: string | null): string {
  const FALLBACK = "/dashboard";
  if (!raw) return FALLBACK;
  const v = raw.trim();
  if (!v.startsWith("/")) return FALLBACK;
  if (v.startsWith("//") || v.startsWith("/\\")) return FALLBACK;
  return v;
}

const PANEL = {
  login: {
    eyebrow: "Welcome back",
    title: "The practice operating system for India's top MFDs.",
    sub: "Compliance, client servicing, automation, reporting and growth — one structured platform your whole team runs on.",
    points: ["Compliance & DDQ readiness", "Clean client data & servicing", "Automation, reminders & MIS", "AI business assistant"],
  },
  signup: {
    eyebrow: "Start free",
    title: "Start building a system-driven MFD practice today.",
    sub: "Bring your clients, compliance, follow-ups and reports into one place. Live in an afternoon, your whole team included.",
    points: ["Free 14-day trial — no card required", "SEBI-aware automation from day one", "Live XIRR, churn AI & 40+ reports", "Cancel anytime · DPDP-ready"],
  },
} as const;

export function AuthScreen({
  initialMode,
  brandLogoUrl = null,
  brandName = null,
}: {
  initialMode: Mode;
  /** White-label branding for a firm's own login host — falls back to Equitywala. */
  brandLogoUrl?: string | null;
  brandName?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const params = useSearchParams();
  // Only ever redirect to a path on THIS origin. A bare "//evil.com" or
  // "https://evil.com" in ?next= would otherwise be an open redirect — and we
  // now link here from the public Knowledge Base gate, so it is reachable.
  const next = safeNext(params.get("next"));
  const router = useRouter();
  const toast = useToast();

  // ── shared / login state ─────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");

  // ── signup state ─────────────────────────────────────────────────────
  const [firmName, setFirmName] = useState("");
  const [arn, setArn] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");

  function destFor(roles: unknown): string {
    const r = Array.isArray(roles) ? roles.map(String) : [];
    const isAdmin = r.includes("platform_admin") || r.includes("platform_support");
    if (isAdmin) return next.startsWith("/super-admin") ? next : "/super-admin";
    return next.startsWith("/super-admin") ? "/dashboard" : next;
  }

  function switchMode(m: Mode) {
    if (m === mode) return;
    setMode(m);
    setChallenge(null);
    setBusy(false);
    try {
      window.history.replaceState(null, "", m === "login" ? "/login" : "/signup");
    } catch {
      /* ignore */
    }
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "Check your email and password and try again.", "Sign-in failed");
        setBusy(false);
        return;
      }
      if (j.require2fa) {
        setChallenge(j.challenge);
        setBusy(false);
        return;
      }
      toast.success("Signed in successfully — taking you in…", "Welcome back");
      setTimeout(() => window.location.assign(destFor(j.user?.roles)), 650);
    } catch {
      toast.error("Something went wrong. Please try again.", "Sign-in failed");
      setBusy(false);
    }
  }

  async function submit2fa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge, code: twoFaCode.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "That code didn't match. Try again.", "Verification failed");
        setBusy(false);
        return;
      }
      toast.success("Verified — taking you in…", "Welcome back");
      setTimeout(() => window.location.assign(destFor(j.user?.roles)), 650);
    } catch {
      toast.error("Something went wrong. Please try again.", "Verification failed");
      setBusy(false);
    }
  }

  async function submitSignup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firmName, arn, ownerName, ownerEmail, password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(
          j.detail ? `${j.error ?? "Signup failed"} — ${j.detail}` : j.error ?? "Please check your details and try again.",
          "Couldn't create workspace"
        );
        setBusy(false);
        return;
      }
      toast.success("Workspace created — choose your plan", "Almost there");
      // New tenants are `pending` until they pick a package (+ pay if Razorpay
      // is configured) — go to plan selection, not the dashboard.
      setTimeout(() => router.push("/dashboard"), 650);
    } catch {
      toast.error("Something went wrong. Please try again.", "Couldn't create workspace");
      setBusy(false);
    }
  }

  const panel = PANEL[mode];

  return (
    <main className="h-screen overflow-hidden grid grid-rows-1 grid-cols-1 lg:grid-cols-2 bg-background">
      {/* ── Left: brand panel (single logo, animated content) ── */}
      <div className="hidden lg:flex relative flex-col justify-between p-12 overflow-hidden text-white bg-gradient-to-br from-[#1B3A7A] via-[#14306A] to-[#0E2557]">
        <div className="absolute inset-0 opacity-[0.06] bg-[radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px]" />

        <Link href="/" className="relative z-10 inline-flex w-fit items-center" aria-label={`${brandName ?? "Equitywala"} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandLogoUrl || "/equitywala-logo.png"} alt={brandName ?? "Equitywala"} className="h-11 w-auto bg-white rounded-xl px-3 py-2 shadow-lg object-contain" />
        </Link>

        <div key={`panel-${mode}`} className="auth-swap relative z-10 max-w-md">
          <span className="inline-block text-[11px] font-bold uppercase tracking-[0.22em] text-white/80">
            {panel.eyebrow}
          </span>
          <h2 className="mt-4 text-[2.6rem] leading-[1.08] font-extrabold tracking-tight">
            {panel.title}
          </h2>
          <p className="mt-5 text-white/75 text-[15px] leading-relaxed">{panel.sub}</p>
          <ul className="mt-8 grid grid-cols-1 gap-3">
            {panel.points.map((t) => (
              <li key={t} className="flex items-center gap-3 text-[15px] text-white/90">
                <span className="size-5 rounded-full bg-white/15 grid place-items-center shrink-0">
                  <Check className="size-3 text-white" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 text-xs text-white/55">
          Designed and Developed by{" "}
          <a href="https://ainatech.in" target="_blank" rel="noopener noreferrer" className="font-semibold text-white/80 hover:text-white transition-colors">
            AinaTech Services LLP
          </a>{" "}
          · © {YEAR}
        </div>
      </div>

      {/* ── Right: form (single mobile wordmark, animated swap) ──
          Outer is the scroll container; the inner min-h-full centers the form
          when it fits and lets it scroll from the top when it doesn't — so a
          taller signup never adds a PAGE scrollbar (which would shift the
          column widths and make the swap look like it stutters). */}
      <div className="overflow-y-auto bg-secondary/20">
        <div className="min-h-full flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          {/* Mobile-only logo (desktop uses the left panel — never both) */}
          <div className="lg:hidden mb-8 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brandLogoUrl || "/equitywala-wordmark.png"} alt={brandName ?? "Equitywala"} className="h-9 w-auto object-contain" />
          </div>

          <div key={`form-${mode}-${challenge ? "2fa" : "x"}`} className="auth-swap">
            <h1 className="text-[1.9rem] font-extrabold tracking-tight text-foreground leading-tight">
              {mode === "signup"
                ? "Create your workspace"
                : challenge
                  ? "Two-factor verification"
                  : "Welcome back"}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {mode === "signup"
                ? "14-day free trial. No card required."
                : challenge
                  ? "Enter the 6-digit code from your authenticator app."
                  : "Sign in to your firm's workspace."}
            </p>

            {/* ── LOGIN ── */}
            {mode === "login" && !challenge && (
              <form onSubmit={submitLogin} className="mt-8 space-y-4">
                <FieldShell label="Work email">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    placeholder="you@yourfirm.com"
                    className="input-base"
                  />
                </FieldShell>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-foreground/80">Password</label>
                    <Link href="/forgot-password" className="text-xs text-primary hover:underline font-medium">
                      Forgot?
                    </Link>
                  </div>
                  <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required placeholder="••••••••" />
                </div>
                <button disabled={busy} className="btn-primary w-full mt-2">
                  {busy ? <><Loader2 className="size-4 animate-spin" /> Signing in…</> : <>Sign in <ArrowRight className="size-4" /></>}
                </button>
              </form>
            )}

            {/* ── LOGIN · 2FA ── */}
            {mode === "login" && challenge && (
              <form onSubmit={submit2fa} className="mt-8 space-y-4">
                <FieldShell label="Authentication code">
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    value={twoFaCode}
                    onChange={(e) => setTwoFaCode(e.target.value.replace(/[^\dA-Za-z-]/g, "").slice(0, 11))}
                    placeholder="123456"
                    className="input-base text-center text-lg tracking-[0.3em] font-mono"
                    required
                  />
                </FieldShell>
                <p className="text-[11px] text-muted-foreground -mt-1">Lost your device? Enter one of your backup codes instead.</p>
                <button disabled={busy} className="btn-primary w-full mt-2">
                  {busy ? <><Loader2 className="size-4 animate-spin" /> Verifying…</> : <><ShieldCheck className="size-4" /> Verify & sign in</>}
                </button>
                <button type="button" onClick={() => { setChallenge(null); setTwoFaCode(""); }} className="text-xs text-muted-foreground hover:underline w-full text-center">
                  ← Back to sign in
                </button>
              </form>
            )}

            {/* ── SIGNUP ── */}
            {mode === "signup" && (
              <form onSubmit={submitSignup} className="mt-6 space-y-3">
                <FieldShell label="Firm name">
                  <input value={firmName} onChange={(e) => setFirmName(e.target.value)} required placeholder="Acme Wealth Advisors" className="input-base" />
                </FieldShell>
                <FieldShell label="ARN">
                  <input value={arn} onChange={(e) => setArn(e.target.value)} required placeholder="ARN-123456" className="input-base" />
                </FieldShell>
                <FieldShell label="Your name">
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required placeholder="Your full name" className="input-base" />
                </FieldShell>
                <FieldShell label="Work email">
                  <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} autoComplete="email" required placeholder="you@yourfirm.com" className="input-base" />
                </FieldShell>
                <FieldShell label="Password">
                  <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required placeholder="8+ characters" />
                </FieldShell>
                <button disabled={busy} className="btn-primary w-full mt-2">
                  {busy ? <><Loader2 className="size-4 animate-spin" /> Creating…</> : <>Create workspace <ArrowRight className="size-4" /></>}
                </button>
              </form>
            )}

            {/* ── Toggle (in-place, no navigation) ── */}
            <div className="mt-6 pt-6 border-t border-border text-center text-sm text-muted-foreground">
              {mode === "login" ? (
                <>
                  Don&apos;t have a workspace yet?{" "}
                  <button type="button" onClick={() => switchMode("signup")} className="text-primary font-semibold hover:underline">
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={() => switchMode("login")} className="text-primary font-semibold hover:underline">
                    Sign in
                  </button>
                </>
              )}
            </div>

            {mode === "signup" && (
              <p className="mt-4 text-[11px] text-muted-foreground text-center leading-relaxed">
                By creating a workspace you agree that mutual fund investments are subject to market risks; read all
                scheme related documents carefully.
              </p>
            )}
          </div>
        </div>
        </div>
      </div>
    </main>
  );
}

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-foreground/80 block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
