"use client";

/**
 * Risk Profile Questioner — multi-step wizard.
 *
 * Reads the tenant's published template (questions + bands) — the parent
 * fetches it server-side via loadActiveTemplate() and passes it in. Falls
 * back to the seed default when no tenant template exists.
 */

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CheckCircle2, Loader2, ShieldCheck, Download, Mail, KeyRound, Upload } from "lucide-react";
import { DownloadButton, OpenDocButton } from "@/components/common/SecureLinkButtons";

type Option = { value: string; label: string; score: number };
type Question = { key: string; label: string; helperText?: string; type: "single"; options: Option[] };
type Band = { id: string; label: string; minScore: number; maxScore: number; color?: string; description?: string };
type Template = { name: string; description?: string; questions: Question[]; bands: Band[]; reviewIntervalDays: number };

export function RiskProfileWizard({
  investor,
  template,
}: {
  investor: { id: string; name: string; pan: string; dob: string | null };
  template: Template;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [age, setAge] = useState<string>(deriveAge(investor.dob) ?? "");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);

  // ── Client sign-off. Two routes, and the one chosen is recorded verbatim on
  //    the profile (client_otp vs client_physical) — they are not equivalent
  //    evidence, so the stored method must match what actually happened. ──
  const [signMode, setSignMode] = useState<"otp" | "signature">("otp");
  const [signatureKey, setSignatureKey] = useState<string | null>(null);
  const [signatureName, setSignatureName] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  async function uploadSignature(file: File) {
    setUploadBusy(true);
    setUploadErr(null);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("File must be under 10 MB");
      const presign = await fetch("/api/compliance/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          kind: "kyc",
          clientName: investor.name ?? undefined,
          docType: "risk-profile-signed",
        }),
      });
      const pj = await presign.json();
      if (!presign.ok) throw new Error(pj?.error ?? "Could not start the upload");

      const put = await fetch(pj.url, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);

      setSignatureKey(pj.key);
      setSignatureName(file.name);
    } catch (e: any) {
      setSignatureKey(null);
      setSignatureName(null);
      setUploadErr(e?.message ?? "Upload failed");
    } finally {
      setUploadBusy(false);
    }
  }

  const [otpVerified, setOtpVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpErr, setOtpErr] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendOtp() {
    setOtpBusy(true);
    setOtpErr(null);
    try {
      const res = await fetch("/api/risk-profiles/otp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId: investor.id, email: needEmail ? otpEmail.trim() : undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.needEmail) setNeedEmail(true);
        if (j.retryInSeconds) setResendIn(Number(j.retryInSeconds));
        setOtpErr(j.error ?? "Couldn't send the code.");
        return;
      }
      setOtpSent(true);
      setMaskedEmail(j.maskedEmail ?? null);
      setResendIn(Number(j.resendInSeconds ?? 60));
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyOtp() {
    setOtpBusy(true);
    setOtpErr(null);
    try {
      const res = await fetch("/api/risk-profiles/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId: investor.id, code: otpCode.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOtpErr((j.error ?? "Verification failed.") + (typeof j.remaining === "number" ? ` (${j.remaining} attempt${j.remaining === 1 ? "" : "s"} left)` : ""));
        return;
      }
      setOtpVerified(true);
    } finally {
      setOtpBusy(false);
    }
  }

  // Auto-sync exact age value with the template's age category options
  useEffect(() => {
    if (age) {
      const numAge = Number(age);
      let choice = "";
      if (numAge < 30) choice = "under_30";
      else if (numAge <= 45) choice = "30_to_45";
      else if (numAge <= 55) choice = "45_to_55";
      else if (numAge <= 65) choice = "55_to_65";
      else choice = "over_65";

      if (template.questions.some((q) => q.key === "age") && answers.age !== choice) {
        setAnswers((prev) => ({ ...prev, age: choice }));
      }
    }
  }, [age, template.questions, answers.age]);

  const questions = template.questions;
  const N = questions.length;
  const onReview = step === N;
  const q = onReview ? null : questions[step];

  // Live scoring preview against the supplied template.
  const live = useMemo(() => {
    let total = 0;
    const breakdown: Array<{ key: string; question: string; answer: string; score: number }> = [];
    for (const q of questions) {
      const val = answers[q.key];
      if (!val) continue;
      const opt = q.options.find((o) => o.value === val);
      if (!opt) continue;
      total += opt.score;
      breakdown.push({ key: q.key, question: q.label, answer: opt.label, score: opt.score });
    }
    const band = template.bands.find((b) => total >= b.minScore && total <= b.maxScore) ?? template.bands[template.bands.length - 1];
    return { total, band, breakdown };
  }, [answers, questions, template.bands]);

  const range = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const q of questions) {
      const s = q.options.map((o) => o.score);
      min += Math.min(...s);
      max += Math.max(...s);
    }
    return { min, max };
  }, [questions]);

  const progress = onReview ? 100 : Math.round((step / N) * 100);
  const canAdvance = q ? !!answers[q.key] : Object.keys(answers).length === N;
  // Whichever sign-off route is selected must be satisfied before submit. The
  // server re-checks this — the button state is convenience, not the gate.
  const signOffReady = signMode === "signature" ? Boolean(signatureKey) : otpVerified;

  function pick(value: string) {
    if (!q) return;
    setAnswers((s) => ({ ...s, [q.key]: value }));
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      // Only send a valid whole age in range — otherwise omit it. A bad/blank dob
      // used to yield NaN, which JSON-serializes to null and failed validation.
      const numAge = Number(age);
      const ageValue =
        age !== "" && Number.isFinite(numAge) && numAge >= 1 && numAge <= 120 ? Math.round(numAge) : undefined;
      const res = await fetch("/api/risk-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investorId: investor.id,
          age: ageValue,
          answers,
          rmRemarks: remarks || undefined,
          signedByName: investor.name || undefined,
          signOffMethod: signMode,
          documentUrl: signMode === "signature" ? signatureKey ?? undefined : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        const fields = Array.isArray(j.issues)
          ? j.issues.map((i: any) => (Array.isArray(i.path) ? i.path.join(".") : "")).filter(Boolean).join(", ")
          : "";
        setErr((j.error ?? `Submit failed (${res.status})`) + (fields ? ` — check: ${fields}` : ""));
        return;
      }
      // Show a completion screen with the PDF download instead of jumping
      // straight to the client page.
      if (j?.id) setDoneId(String(j.id));
      else router.push(`/dashboard/investors/${investor.id}`);
    } finally {
      setBusy(false);
    }
  }

  // Completion screen — shown right after a successful submit so the RM can
  // download the freshly-generated Risk Profile PDF in one click.
  if (doneId) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="card-surface p-8 text-center space-y-5">
          <div className="size-14 mx-auto rounded-full bg-emerald-50 grid place-items-center">
            <CheckCircle2 className="size-7 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Risk profile saved</h1>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-medium text-foreground">{investor.name}</span> is now profiled as{" "}
              <span className="font-semibold" style={{ color: live.band.color ?? undefined }}>{live.band.label}</span>{" "}
              ({live.total}/{range.max}).
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <DownloadButton url={`/api/risk-profiles/${doneId}/pdf?download=1`} className="btn-primary">
              <Download className="size-4" /> Download PDF
            </DownloadButton>
            <OpenDocButton url={`/api/risk-profiles/${doneId}/pdf`} className="btn-secondary">
              View PDF
            </OpenDocButton>
            <button
              type="button"
              onClick={() => router.push(`/dashboard/investors/${investor.id}`)}
              className="btn-secondary"
            >
              Go to client
            </button>
            <Link href="/dashboard/risk-profiles" className="btn-ghost text-sm">
              Back to list
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const firstName = investor.name.split(" ")[0] || "the client";

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/dashboard/risk-profiles"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1 mb-4"
      >
        <ChevronLeft className="size-4" /> Back to risk profiles
      </Link>

      {/* Header */}
      <div className="card-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="size-5 text-brand-cyan" /> {template.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              For <span className="font-medium text-foreground">{investor.name}</span> · PAN{" "}
              <span className="font-mono">{investor.pan}</span>
            </p>
            {template.description && (
              <p className="text-[11px] text-muted-foreground mt-1 italic">{template.description}</p>
            )}
          </div>
          {!onReview && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Question {Math.min(step + 1, N)} of {N}</div>
              <div className="text-2xl font-bold tabular-nums mt-0.5">{progress}%</div>
            </div>
          )}
        </div>

        <div className="mt-4 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full brand-gradient transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Body */}
      <div className="card-surface p-6 mt-4">
        {q && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <div className="text-xs uppercase tracking-wide text-brand-cyan font-semibold mb-1">
                Question {step + 1}
              </div>
              <h2 className="text-xl font-semibold">{q.label}</h2>
              {q.helperText && <p className="text-sm text-muted-foreground mt-1.5">{q.helperText}</p>}
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
                        ? "border-brand-cyan bg-brand-cyan-light/40 shadow-sm"
                        : "border-border bg-card hover:border-brand-cyan/40 hover:bg-secondary/40"
                    }`}
                  >
                    <span className="font-medium text-sm">{opt.label}</span>
                    {selected && <CheckCircle2 className="size-5 text-brand-cyan" />}
                  </button>
                );
              })}
            </div>

            {q.key === "age" && (
              <div className="pt-3 border-t">
                <label className="block">
                  <div className="text-xs font-medium mb-1">Exact age (optional)</div>
                  <input
                    type="number"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="e.g. 42"
                    className="input-base max-w-xs"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {onReview && (
          <div className="space-y-5 animate-fade-in">
            <div>
              <div className="text-xs uppercase tracking-wide text-brand-cyan font-semibold mb-1">Review & submit</div>
              <h2 className="text-xl font-semibold">Final risk profile</h2>
            </div>

            <div
              className="border-2 rounded-lg p-5"
              style={{
                borderColor: live.band.color ?? "#d22e32",
                background: `${live.band.color ?? "#d22e32"}15`,
                color: live.band.color ?? "#841f21",
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Final category</div>
                  <div className="text-3xl font-bold mt-1">{live.band.label}</div>
                  {live.band.description && (
                    <div className="text-xs opacity-80 mt-1">{live.band.description}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide font-semibold opacity-70">Total score</div>
                  <div className="text-3xl font-bold tabular-nums mt-1">
                    {live.total}/{range.max}
                  </div>
                </div>
              </div>
            </div>

            <div className="card-surface p-4">
              <h3 className="font-semibold mb-3">Answer breakdown</h3>
              <ul className="divide-y">
                {live.breakdown.map((b) => (
                  <li key={b.key} className="py-2 flex items-start justify-between gap-3 text-sm">
                    <div className="flex-1">
                      <div className="font-medium">{b.question}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{b.answer}</div>
                    </div>
                    <span className="chip bg-secondary">+{b.score}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card-surface p-4 space-y-3">
              <label className="block">
                <div className="text-xs font-semibold mb-1">RM remarks</div>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  placeholder="Observations, special factors, follow-up needed…"
                  className="input-base"
                />
              </label>
            </div>

            {/* Client sign-off — one of two routes must be completed before submit. */}
            <div className="card-surface p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-brand-cyan" />
                <h3 className="font-semibold">Client sign-off</h3>
                {(otpVerified || (signMode === "signature" && signatureKey)) && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 className="size-4" /> Ready
                  </span>
                )}
              </div>

              {/* Method chooser */}
              <div className="grid sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSignMode("otp")}
                  className={`text-left rounded-lg border p-3 transition ${
                    signMode === "otp"
                      ? "border-brand-cyan bg-brand-cyan-light/30"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <KeyRound className="size-3.5" /> Verify with OTP
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    One-time code to the client&apos;s email, checked on the server.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSignMode("signature")}
                  className={`text-left rounded-lg border p-3 transition ${
                    signMode === "signature"
                      ? "border-brand-cyan bg-brand-cyan-light/30"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <Upload className="size-3.5" /> Upload signature
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Attach the physically signed form (PDF or image).
                  </div>
                </button>
              </div>

              {signMode === "signature" ? (
                <div className="space-y-2">
                  <label className="block">
                    <div className="text-xs font-medium mb-1">Signed risk-profile form</div>
                    <input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      disabled={uploadBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadSignature(f);
                      }}
                      className="block w-full text-xs file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-xs"
                    />
                  </label>
                  {uploadBusy && (
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" /> Uploading…
                    </div>
                  )}
                  {signatureKey && (
                    <div className="text-xs text-emerald-600 inline-flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5" /> {signatureName} attached
                    </div>
                  )}
                  {uploadErr && <div className="text-sm text-rose-600">{uploadErr}</div>}
                  <p className="text-[11px] text-muted-foreground">
                    Recorded as a physically-signed form. Keep the original — this is the audit
                    evidence, and it is not the same as an OTP-verified confirmation.
                  </p>
                </div>
              ) : otpVerified ? (
                <p className="text-sm text-muted-foreground">
                  {firstName}&apos;s email is verified — you can now submit the profile.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    For compliance, {firstName} confirms this risk profile with a one-time code sent to their
                    email. Verify to enable submit.
                  </p>

                  {!otpSent ? (
                    <>
                      {needEmail && (
                        <label className="block">
                          <div className="text-xs font-medium mb-1">Client email</div>
                          <input type="email" value={otpEmail} onChange={(e) => setOtpEmail(e.target.value)} placeholder="client@example.com" className="input-base" />
                        </label>
                      )}
                      {otpErr && <div className="text-sm text-rose-600">{otpErr}</div>}
                      <button onClick={sendOtp} disabled={otpBusy || (needEmail && !otpEmail.trim())} className="btn-secondary gap-2">
                        {otpBusy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} Send code
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="text-sm text-muted-foreground">
                        Code sent to <span className="font-medium text-foreground">{maskedEmail}</span> — ask the client for it (valid 10 minutes).
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block">
                          <div className="text-xs font-medium mb-1">6-digit code</div>
                          <input inputMode="numeric" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))} placeholder="------" className="input-base tracking-[0.4em] text-center font-mono max-w-[10rem]" />
                        </label>
                        <button onClick={verifyOtp} disabled={otpBusy || otpCode.length < 4} className="btn-secondary gap-2">
                          {otpBusy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Verify
                        </button>
                        <button onClick={sendOtp} disabled={otpBusy || resendIn > 0} className="btn-ghost text-xs disabled:opacity-60">
                          {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend"}
                        </button>
                      </div>
                      {otpErr && <div className="text-sm text-rose-600">{otpErr}</div>}
                    </>
                  )}
                </>
              )}
            </div>

            {err && (
              <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
                {err}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || busy}
          className="btn-secondary"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        <div className="text-xs text-muted-foreground tabular-nums">
          Live score: <span className="font-semibold">{live.total}</span> ·{" "}
          <span style={{ color: live.band.color ?? undefined }}>{live.band.label}</span>
        </div>
        {onReview ? (
          <button
            onClick={submit}
            disabled={busy || !canAdvance || !signOffReady}
            title={!signOffReady ? (signMode === "signature" ? "Upload the signed form above to submit" : "Verify the client's email above to submit") : undefined}
            className="btn-primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {busy ? "Saving…" : signOffReady ? "Submit profile" : signMode === "signature" ? "Upload signature to submit" : "Verify email to submit"}
          </button>
        ) : (
          <button
            onClick={() => setStep((s) => Math.min(N, s + 1))}
            disabled={!canAdvance}
            className="btn-primary"
          >
            {step === N - 1 ? "Review" : "Next"} <ChevronRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function deriveAge(dob: string | null): string | null {
  if (!dob) return null;
  try {
    const d = new Date(dob);
    if (isNaN(d.getTime())) return null; // malformed dob → no derived age (never "NaN")
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
    return age >= 1 && age <= 120 ? String(age) : null;
  } catch {
    return null;
  }
}
