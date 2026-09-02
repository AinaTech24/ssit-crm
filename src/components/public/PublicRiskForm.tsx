"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Download } from "lucide-react";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

type Option = { value: string; label: string; score: number };
type Question = { key: string; label: string; helperText?: string; type: "single"; options: Option[] };
type Band = { id: string; label: string; minScore: number; maxScore: number; color?: string; description?: string };

export function PublicRiskForm({
  tokenId,
  recipientName,
  template,
  requireOtp = false,
  maskedEmailOnFile = null,
}: {
  tokenId: string;
  recipientName: string;
  template: { name: string; description?: string; questions: Question[]; bands: Band[]; reviewIntervalDays: number };
  /** Template-level flag: this submission must be confirmed with an email OTP. */
  requireOtp?: boolean;
  /** Masked form of the email the firm has on file (e.g. "pr•••@gmail.com"), or null if none. */
  maskedEmailOnFile?: string | null;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { bandLabel: string; total: number; color?: string; description?: string }>(null);

  // ── Email-OTP verification state ──
  // otpForced covers the edge where the server answers 422 otp_required even
  // though the page rendered with requireOtp=false (flag flipped mid-session).
  const [otpForced, setOtpForced] = useState(false);
  const [otpEmail, setOtpEmail] = useState(""); // only used when no email on file
  const [otpSent, setOtpSent] = useState(false); // a code has been requested at least once
  const [otpMaskedTo, setOtpMaskedTo] = useState<string | null>(null); // where the server said it sent the code
  const [otpCode, setOtpCode] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null); // send-step + verify-step errors
  const [resendIn, setResendIn] = useState(0); // seconds until "Send code" re-enables

  const otpRequired = requireOtp || otpForced;

  // Tick the resend countdown once per second while it's running.
  const counting = resendIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  async function sendOtp() {
    setOtpError(null);
    const typedEmail = otpEmail.trim();
    if (!maskedEmailOnFile) {
      if (!typedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail)) {
        setOtpError("Please enter a valid email address.");
        return;
      }
    }
    setOtpSending(true);
    try {
      const r = await fetch("/api/public/risk-profile/otp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: tokenId,
          ...(maskedEmailOnFile ? {} : { email: typedEmail }),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 429) {
        setOtpError(data?.error ?? "Too many codes requested — please wait a moment.");
        setResendIn(Math.max(1, Number(data?.retryInSeconds) || 60));
        return;
      }
      if (!r.ok) {
        setOtpError(data?.error ?? "Could not send the code. Please try again.");
        return;
      }
      setOtpSent(true);
      setOtpMaskedTo(data?.maskedEmail ?? maskedEmailOnFile ?? typedEmail);
      setResendIn(Math.max(1, Number(data?.resendInSeconds) || 60));
      setOtpCode("");
    } catch {
      setOtpError("Network error — please check your connection and try again.");
    } finally {
      setOtpSending(false);
    }
  }

  // Canvas drawing state
  const [drawing, setDrawing] = useState(false);
  const [canvasRef, setCanvasRef] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef) {
      canvasRef.width = canvasRef.offsetWidth;
      canvasRef.height = canvasRef.offsetHeight;
      const ctx = canvasRef.getContext("2d");
      if (ctx) {
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#0f172a";
      }
    }
  }, [canvasRef, step]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    const rect = canvasRef.getBoundingClientRect();
    let clientX, clientY;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    setDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawing || !canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    const rect = canvasRef.getBoundingClientRect();
    let clientX, clientY;
    if ("touches" in e) {
      if (e.cancelable) e.preventDefault();
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setDrawing(false);
  };

  const clearCanvas = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);
  };

  const isCanvasBlank = () => {
    if (!canvasRef) return true;
    const blank = document.createElement("canvas");
    blank.width = canvasRef.width;
    blank.height = canvasRef.height;
    return canvasRef.toDataURL() === blank.toDataURL();
  };

  const N = template.questions.length;
  const onReview = step === N;
  const q = onReview ? null : template.questions[step];

  const live = useMemo(() => {
    let total = 0;
    for (const q of template.questions) {
      const v = answers[q.key];
      if (!v) continue;
      const opt = q.options.find((o) => o.value === v);
      if (opt) total += opt.score;
    }
    const band = template.bands.find((b) => total >= b.minScore && total <= b.maxScore) ?? template.bands[template.bands.length - 1];
    return { total, band };
  }, [answers, template]);

  const canAdvance = q ? !!answers[q.key] : Object.keys(answers).length === N;
  const progress = onReview ? 100 : Math.round((step / N) * 100);

  function pick(value: string) {
    if (!q) return;
    setAnswers((s) => ({ ...s, [q.key]: value }));
  }

  async function submit() {
    if (!signature.trim()) {
      setError("Please type your full name to submit.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/public/risk-profile/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenId,
          answers,
          signatureName: signature.trim(),
          ...(otpRequired
            ? {
                otp: otpCode.trim(),
                // Only sent when the client typed an email (no email on file
                // with the firm) — the server ignores it otherwise.
                ...(otpEmail.trim() ? { otpEmail: otpEmail.trim() } : {}),
              }
            : {}),
        }),
      });
      const data = await r.json().catch(() => ({}));

      // OTP-specific rejections — keep the form and every answer intact.
      if (r.status === 422 && typeof data?.error === "string") {
        if (data.error === "otp_required") {
          setOtpForced(true);
          setOtpError("This form requires email verification — please request a code below.");
          return;
        }
        if (data.error === "otp_invalid") {
          const left = Number(data?.attemptsLeft);
          setOtpError(
            Number.isFinite(left)
              ? `That code isn't right — ${left} attempt${left === 1 ? "" : "s"} left.`
              : "That code isn't right — please check and try again."
          );
          return;
        }
        if (data.error === "otp_expired") {
          setOtpError("That code has expired — please send a new one.");
          setResendIn(0); // re-enable "Send code" immediately
          setOtpCode("");
          return;
        }
      }

      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setDone({
        bandLabel: data.bandLabel,
        total: data.totalScore,
        color: data.bandColor,
        description: data.bandDescription,
      });
    } catch (e: any) {
      setError(e?.message ?? "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  // ── Submission success screen ──
  if (done) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold mt-3">Thank you, {recipientName.split(" ")[0] || "investor"}!</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Your risk profile has been recorded. Your relationship manager will be in touch shortly.
        </p>
        <div
          className="mt-6 rounded-lg border-2 p-5"
          style={{ borderColor: done.color ?? "#0ea5e9", background: `${done.color ?? "#0ea5e9"}15` }}
        >
          <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Your category</div>
          <div className="text-2xl font-bold mt-1" style={{ color: done.color ?? "#0e2557" }}>{done.bandLabel}</div>
          <div className="text-sm tabular-nums mt-1 text-muted-foreground">Score: {done.total}</div>
          {done.description && <div className="text-xs text-muted-foreground mt-2">{done.description}</div>}
        </div>
        <DownloadButton
          url={`/api/public/risk-profile/pdf?token=${encodeURIComponent(tokenId)}&download=1`}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-cyan px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
        >
          <Download className="size-4" /> Download your Risk Profile (PDF)
        </DownloadButton>
        <p className="text-[11px] text-muted-foreground mt-2">
          Your answers and risk category, as a PDF you can keep.
        </p>
      </div>
    );
  }

  // ── Header ──
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">{template.name}</h1>
            {recipientName && (
              <p className="text-sm text-muted-foreground mt-1">
                Hi <span className="font-medium text-foreground">{recipientName}</span> — please take a moment to answer
                these questions so we can recommend the right investments for you.
              </p>
            )}
            {template.description && (
              <p className="text-[11px] text-muted-foreground mt-1 italic">{template.description}</p>
            )}
          </div>
          {!onReview && (
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Question {Math.min(step + 1, N)} of {N}</div>
              <div className="font-bold tabular-nums mt-0.5">{progress}%</div>
            </div>
          )}
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-brand-cyan transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Body */}
      <div className="bg-white rounded-xl shadow p-6">
        {q && (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">{q.label}</h2>
              {q.helperText && <p className="text-sm text-muted-foreground mt-1">{q.helperText}</p>}
            </div>
            <div className="space-y-2">
              {q.options.map((opt) => {
                const selected = answers[q.key] === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => pick(opt.value)}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all flex items-center justify-between ${
                      selected
                        ? "border-brand-cyan bg-brand-cyan-light/40"
                        : "border-border bg-card hover:border-brand-cyan/40"
                    }`}
                  >
                    <span className="font-medium text-sm">{opt.label}</span>
                    {selected && <CheckCircle2 className="size-5 text-brand-cyan" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {onReview && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Review & submit</h2>
              <p className="text-sm text-muted-foreground mt-1">Please confirm your answers and sign below.</p>
            </div>

            <div
              className="rounded-lg border-2 p-4"
              style={{ borderColor: live.band.color ?? "#0ea5e9", background: `${live.band.color ?? "#0ea5e9"}15` }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Your category</div>
                  <div className="text-2xl font-bold mt-1" style={{ color: live.band.color }}>{live.band.label}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Score</div>
                  <div className="text-2xl font-bold tabular-nums mt-1">{live.total}</div>
                </div>
              </div>
            </div>

            {/* Email-OTP verification — only when the template requires it */}
            {otpRequired && (
              <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-4 space-y-3">
                <div className="text-sm font-semibold text-slate-800">Verify it&apos;s you</div>
                <p className="text-xs text-muted-foreground">
                  We&apos;ll email you a 6-digit code to confirm this submission.
                </p>

                {maskedEmailOnFile ? (
                  <p className="text-xs">
                    Code will be sent to <span className="font-medium text-foreground">{maskedEmailOnFile}</span>
                  </p>
                ) : (
                  <label className="block">
                    <div className="text-xs font-semibold mb-1">Your email address</div>
                    <input
                      type="email"
                      required
                      value={otpEmail}
                      onChange={(e) => setOtpEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="w-full sm:w-72 border rounded-md px-3 py-2 text-sm"
                    />
                  </label>
                )}

                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={sendOtp}
                    disabled={otpSending || resendIn > 0}
                    className="rounded-md bg-brand-cyan text-white px-3.5 py-1.5 text-xs font-semibold hover:bg-brand-cyan/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {otpSending ? <Loader2 className="size-3 animate-spin" /> : null}
                    {otpSending
                      ? "Sending…"
                      : resendIn > 0
                        ? `Resend in ${resendIn}s…`
                        : otpSent
                          ? "Resend code"
                          : "Send code"}
                  </button>
                  {otpSent && otpMaskedTo && (
                    <span className="text-xs text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                      Code sent to <span className="font-medium">{otpMaskedTo}</span>
                    </span>
                  )}
                </div>

                {otpSent && (
                  <div>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6-digit code"
                      className="border rounded-md px-3 py-2 text-sm w-36 font-mono tracking-widest text-center"
                    />
                    <div className="text-[10px] text-muted-foreground mt-1">The code is valid for 10 minutes.</div>
                  </div>
                )}

                {otpError && (
                  <div className="text-xs text-rose-700 bg-rose-50 px-3 py-1.5 rounded-md">{otpError}</div>
                )}
              </div>
            )}

            <label className="block">
              <div className="text-xs font-semibold mb-1">Signature (type your full name)</div>
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="e.g. Rajesh Sharma"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                By signing, you confirm that the answers above reflect your true financial situation and risk
                appetite. Mutual fund investments are subject to market risks.
              </div>
            </label>

            {error && <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-2">{error}</div>}
          </div>
        )}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || busy}
          className="rounded-md border bg-white px-3 py-2 text-sm flex items-center gap-1 disabled:opacity-40"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        {onReview ? (
          <button
            onClick={submit}
            disabled={busy || !canAdvance || !signature.trim() || (otpRequired && !(otpSent && otpCode.trim().length === 6))}
            className="rounded-md bg-brand-cyan text-white px-4 py-2 text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {busy ? "Submitting…" : "Submit"}
          </button>
        ) : (
          <button
            onClick={() => setStep((s) => Math.min(N, s + 1))}
            disabled={!canAdvance}
            className="rounded-md bg-brand-cyan text-white px-3 py-2 text-sm font-semibold flex items-center gap-1 disabled:opacity-40"
          >
            {step === N - 1 ? "Review" : "Next"} <ChevronRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
