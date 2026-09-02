"use client";

/**
 * Compose — ad-hoc 1:1 client email. Goes through the same consent + compliance
 * gate as every other send; nothing here bypasses the moat. Send now or schedule.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Mail, Loader2, Send, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { SelectField } from "@/components/ui/SelectField";

type Finding = { severity: string; message: string; rule?: string };

export default function ComposePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"client" | "email">("client");
  const [investor, setInvestor] = useState<{ id: string; name: string } | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<"transactional" | "marketing">("transactional");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function send() {
    setErr(null);
    setFindings(null);
    setOk(null);
    if (mode === "client" && !investor) return setErr("Pick a client.");
    if (mode === "email" && !toEmail.trim()) return setErr("Enter a recipient email.");
    if (!subject.trim() || !body.trim()) return setErr("Subject and message are required.");
    if (scheduleOn && !scheduledAt) return setErr("Pick a date/time to schedule.");

    setBusy(true);
    try {
      const payload: any = {
        subject,
        body,
        category,
        ...(mode === "client" ? { investorId: investor!.id } : { toEmail }),
        ...(scheduleOn && scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
      };
      const res = await fetch("/api/communications/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (res.status === 422 && j.findings) {
        setFindings(j.findings);
        setErr("Blocked by the compliance gate — fix the message and try again.");
        return;
      }
      if (!res.ok) {
        setErr(j.error ?? `Send failed (${res.status})`);
        return;
      }
      if (j.status === "skipped" && j.reason === "skipped_consent") {
        setErr("Not sent — this client hasn't granted email consent for this category. Logged for audit.");
        return;
      }
      if (j.status === "failed") {
        setErr(`Send failed: ${j.reason ?? "adapter error"}. The attempt is logged.`);
        return;
      }
      setOk(j.status === "scheduled" ? "Scheduled ✓" : "Sent ✓");
      setTimeout(() => router.push("/dashboard/communications"), 700);
    } catch (e: any) {
      setErr(e.message || "Send failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Link
        href="/dashboard/communications"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to communications
      </Link>

      <div>
        <h1 className="page-title">
          <Mail className="size-6 text-brand-cyan" /> Compose email
        </h1>
      </div>

      <div className="card-surface p-5 space-y-4">
        {/* Recipient */}
        <div>
          <div className="text-xs font-medium mb-1.5">Recipient</div>
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => setMode("client")}
              className={`text-xs rounded-md px-2.5 py-1 font-medium ${mode === "client" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              Client
            </button>
            <button
              type="button"
              onClick={() => setMode("email")}
              className={`text-xs rounded-md px-2.5 py-1 font-medium ${mode === "email" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              Email address
            </button>
          </div>
          {mode === "client" ? (
            <InvestorLookup
              value={investor?.id ?? null}
              displayName={investor?.name ?? null}
              onSelect={(id, name) => setInvestor({ id, name })}
              onClear={() => setInvestor(null)}
              placeholder="Search client by name, PAN, mobile…"
              required
            />
          ) : (
            <input
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="client@example.com"
              className="input-base"
            />
          )}
          {mode === "email" && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Raw addresses skip the consent check (no client record) — use a client where possible.
            </p>
          )}
        </div>

        <label className="block">
          <div className="text-xs font-medium mb-1">Subject</div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Your portfolio review is ready"
            className="input-base"
          />
        </label>

        <label className="block">
          <div className="text-xs font-medium mb-1">Message</div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={9}
            placeholder={"Hi {{name}},\n\n…\n\nThanks,"}
            className="input-base font-sans"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            <ShieldCheck className="size-3 inline mr-0.5" />
            The MF risk disclaimer and your ARN signature are appended automatically. Use{" "}
            <code className="font-mono">{"{{name}}"}</code> for the client's name.
          </p>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Category</div>
            <SelectField value={category} onChange={(e) => setCategory(e.target.value as any)}>
              <option value="transactional">Transactional (service)</option>
              <option value="marketing">Marketing</option>
            </SelectField>
          </label>
          <div>
            <label className="flex items-center gap-2 text-xs font-medium mb-1">
              <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
              <Clock className="size-3.5" /> Schedule for later
            </label>
            {scheduleOn && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="input-base"
              />
            )}
          </div>
        </div>

        {findings && findings.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs space-y-1">
            <div className="font-medium text-amber-800 flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" /> Compliance findings
            </div>
            {findings.map((f, i) => (
              <div key={i} className="text-amber-800">
                • [{f.severity}] {f.message}
              </div>
            ))}
          </div>
        )}
        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}
        {ok && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-sm px-3 py-2">
            {ok}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Link href="/dashboard/communications" className="btn-secondary">
            Cancel
          </Link>
          <button type="button" onClick={send} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : scheduleOn ? <Clock className="size-4" /> : <Send className="size-4" />}
            {busy ? "Sending…" : scheduleOn ? "Schedule" : "Send now"}
          </button>
        </div>
      </div>
    </div>
  );
}
