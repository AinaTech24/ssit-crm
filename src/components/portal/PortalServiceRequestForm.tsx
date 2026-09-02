"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";

const TYPES = [
  ["statement_request", "Account statement"],
  ["capital_gain_report", "Capital-gain report"],
  ["nominee_update", "Nominee update"],
  ["bank_update", "Bank update"],
  ["kyc_update", "KYC update"],
  ["other", "Other request"],
] as const;

export function PortalServiceRequestForm({ token }: { token: string }) {
  const [type, setType] = useState<(typeof TYPES)[number][0]>("statement_request");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/portal/${encodeURIComponent(token)}/service-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, subject, description }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not submit the request");
      setTicket(body.ticketNo);
      setSubject("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the request");
    } finally {
      setBusy(false);
    }
  }

  if (ticket) {
    return (
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-5 text-center">
        <CheckCircle2 className="mx-auto size-8 text-primary" />
        <h3 className="mt-2 font-semibold">Request received</h3>
        <p className="mt-1 text-sm text-muted-foreground">Reference {ticket}. Your service team can now track it.</p>
        <button type="button" onClick={() => setTicket("")} className="btn-secondary mt-4 text-sm">Add another request</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Request type
          <select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="input-base mt-1 w-full">
            {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Subject
          <input value={subject} onChange={(event) => setSubject(event.target.value)} minLength={3} maxLength={160} required className="input-base mt-1 w-full" />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Details
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} className="input-base mt-1 w-full resize-y" />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-60">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Submit request
      </button>
    </form>
  );
}

