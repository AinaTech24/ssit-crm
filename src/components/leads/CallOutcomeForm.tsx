"use client";

/**
 * Inline call-outcome capture form on the lead detail.
 *
 * The RM logs the outcome of their call to the lead. Based on the outcome:
 *   - connected           → ask "did they agree to a meeting?"
 *   - not_reachable       → simple log + retry-in-N-days follow-up task
 *   - call_later          → next follow-up date + notes
 *   - not_interested      → lost reason + closes blueprint as 'lost'
 *   - wrong_number        → flags + closes
 *   - appointment_booked  → meeting date/time/mode/location/agenda
 *
 * On submit, posts to /api/leads/[id]/call-outcome which:
 *   1. Inserts a 'call' task as completed with the outcome stored in remarks
 *   2. Stamps lead.lastContactAt
 *   3. Creates the review_meeting if appointment booked
 *   4. Creates the follow-up task if call_later
 *   5. Advances the blueprint stage accordingly
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Outcome =
  | "connected"
  | "not_reachable"
  | "call_later"
  | "not_interested"
  | "wrong_number"
  | "appointment_booked";

const OUTCOMES: Array<{ value: Outcome; label: string; nextStage?: string }> = [
  { value: "connected", label: "Connected (had a chat)", nextStage: "post_meeting_qualified" },
  { value: "appointment_booked", label: "Appointment booked", nextStage: "appointment_scheduled" },
  { value: "call_later", label: "Asked to call later" },
  { value: "not_reachable", label: "Not reachable" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_number", label: "Wrong number" },
];

export function CallOutcomeForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("connected");
  const [notes, setNotes] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("10:00");
  const [meetingMode, setMeetingMode] = useState("online");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [meetingAgenda, setMeetingAgenda] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setOpen(false);
    setOutcome("connected");
    setNotes("");
    setMeetingDate("");
    setMeetingTime("10:00");
    setMeetingMode("online");
    setMeetingLocation("");
    setMeetingAgenda("");
    setFollowUpDate("");
    setLostReason("");
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const r = await fetch(`/api/leads/${leadId}/call-outcome`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome,
          notes,
          meeting:
            outcome === "appointment_booked"
              ? { date: meetingDate, time: meetingTime, mode: meetingMode, location: meetingLocation, agenda: meetingAgenda }
              : undefined,
          followUpDate: outcome === "call_later" ? followUpDate : undefined,
          lostReason: outcome === "not_interested" || outcome === "wrong_number" ? lostReason : undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? "Failed");
      setSuccess(true);
      router.refresh();
      setTimeout(() => reset(), 1500);
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary text-xs">
        <Phone className="size-3.5" /> Log call outcome
      </button>
    );
  }

  return (
    <div className="card-surface p-4 space-y-3 border-2 border-brand-cyan/40">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <Phone className="size-4 text-brand-cyan" /> Log call outcome
        </h4>
        <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Outcome *</label>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOutcome(o.value)}
              className={`text-left px-2.5 py-2 rounded-md border text-xs transition-colors ${
                outcome === o.value
                  ? "border-brand-cyan bg-brand-cyan-light/40"
                  : "border-border hover:bg-secondary/40"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Notes</label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did the lead say?"
          className="input-base text-xs w-full mt-1"
        />
      </div>

      {outcome === "appointment_booked" && (
        <div className="grid grid-cols-2 gap-2 p-3 rounded-md border border-brand-cyan/30 bg-brand-cyan-light/20">
          <Field label="Date *">
            <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className="input-base text-xs w-full" />
          </Field>
          <Field label="Time *">
            <input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} className="input-base text-xs w-full" />
          </Field>
          <Field label="Mode">
            <select value={meetingMode} onChange={(e) => setMeetingMode(e.target.value)} className="input-base text-xs w-full">
              <option value="online">Online</option>
              <option value="office">Office</option>
              <option value="client_place">Client place</option>
              <option value="phone">Phone</option>
            </select>
          </Field>
          <Field label="Location / link">
            <input value={meetingLocation} onChange={(e) => setMeetingLocation(e.target.value)} className="input-base text-xs w-full" placeholder="Office addr or meet.google.com/..." />
          </Field>
          <div className="col-span-2">
            <Field label="Agenda">
              <input value={meetingAgenda} onChange={(e) => setMeetingAgenda(e.target.value)} className="input-base text-xs w-full" placeholder="Discovery call: goals + risk discussion" />
            </Field>
          </div>
        </div>
      )}

      {outcome === "call_later" && (
        <Field label="Next follow-up date *">
          <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="input-base text-xs w-full" />
        </Field>
      )}

      {(outcome === "not_interested" || outcome === "wrong_number") && (
        <Field label="Reason *">
          <input value={lostReason} onChange={(e) => setLostReason(e.target.value)} className="input-base text-xs w-full" placeholder="e.g. Already has an advisor" />
        </Field>
      )}

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50/40 rounded p-1.5 flex items-start gap-1.5">
          <AlertCircle className="size-3 mt-0.5" /> {error}
        </div>
      )}
      {success && (
        <div className="text-xs text-emerald-700 bg-emerald-50 rounded p-1.5 flex items-center gap-1.5">
          <CheckCircle2 className="size-3" /> Saved
        </div>
      )}

      <button
        onClick={submit}
        disabled={
          busy ||
          (outcome === "appointment_booked" && (!meetingDate || !meetingTime)) ||
          (outcome === "call_later" && !followUpDate) ||
          ((outcome === "not_interested" || outcome === "wrong_number") && !lostReason)
        }
        className="btn-primary text-sm w-full disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        {busy ? "Saving…" : "Save outcome"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
