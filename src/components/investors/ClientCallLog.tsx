"use client";

/**
 * Call log on a client — who rang whom, how it went, and what happens next.
 *
 * Each call is its own row with an author and a time, so the client's history
 * reads as a sequence. Calls are shared across everyone who can open the client
 * (a servicing RM reads the relationship RM's calls) and also appear in the
 * Activity Log.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Phone, PhoneIncoming, PhoneOutgoing, Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";

type Call = {
  id: string;
  direction: "outbound" | "inbound" | null;
  status: string | null;
  subject: string | null;
  notes: string | null;
  occurred_at: string;
  duration_sec: number | null;
  next_followup_at: string | null;
  author_name: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  answered: "Answered",
  completed: "Completed",
  no_answer: "No answer",
  busy: "Busy",
  failed: "Failed",
  left_voicemail: "Left voicemail",
};
const STATUS_OPTIONS = ["answered", "no_answer", "busy", "left_voicemail", "failed"] as const;

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
/** "now" as a value a datetime-local input accepts (local time, minute precision). */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

export function ClientCallLog({ investorId, readOnly = false }: { investorId: string; readOnly?: boolean }) {
  const toast = useToast();
  const base = `/api/investors/${investorId}/calls`;
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("answered");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocal());
  const [minutes, setMinutes] = useState("");
  const [followup, setFollowup] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(base);
      if (!r.ok) {
        toast.error((await readApiError(r, "load calls")).message);
        setCalls([]);
        return;
      }
      setCalls((await r.json()).calls ?? []);
    } catch (e) {
      toast.error(readThrownError(e, "load calls").message);
      setCalls([]);
    }
  }, [base, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          direction,
          status,
          subject: subject.trim() || undefined,
          notes: notes.trim() || undefined,
          occurredAt: toIso(occurredAt),
          durationMin: minutes ? Number(minutes) : undefined,
          nextFollowupAt: toIso(followup),
        }),
      });
      if (!r.ok) {
        toast.error((await readApiError(r, "log call")).message);
        return;
      }
      // Cleared only on success, so a failed save never loses what was typed.
      setSubject("");
      setNotes("");
      setMinutes("");
      setFollowup("");
      setOccurredAt(nowLocal());
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(readThrownError(e, "log call").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {!open ? (
        readOnly ? null : <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
          <Plus className="size-4" /> Log a call
        </button>
      ) : (
        <div className="rounded-lg border bg-card p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <div className="text-xs font-medium mb-1">Direction</div>
              <select value={direction} onChange={(e) => setDirection(e.target.value as "outbound" | "inbound")} className="input-base text-sm w-full">
                <option value="outbound">I called the client</option>
                <option value="inbound">The client called me</option>
              </select>
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Outcome</div>
              <select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])} className="input-base text-sm w-full">
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">When</div>
              <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="input-base text-sm w-full" />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block sm:col-span-2">
              <div className="text-xs font-medium mb-1">What was it about</div>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="e.g. SIP top-up, KYC documents" className="input-base text-sm w-full" />
            </label>
            <label className="block">
              <div className="text-xs font-medium mb-1">Duration (minutes)</div>
              <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="input-base text-sm w-full" />
            </label>
          </div>
          <label className="block">
            <div className="text-xs font-medium mb-1">Notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} placeholder="What was said, what was agreed…" className="input-base text-sm w-full resize-y" />
          </label>
          <label className="block sm:w-1/2">
            <div className="text-xs font-medium mb-1">Follow up on (optional)</div>
            <input type="datetime-local" value={followup} onChange={(e) => setFollowup(e.target.value)} className="input-base text-sm w-full" />
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />} Save call
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {calls === null ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading calls…
        </div>
      ) : calls.length === 0 ? (
        <div className="text-sm text-muted-foreground">No calls logged for this client yet.</div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {calls.map((c) => (
            <li key={c.id} className="p-3 text-sm space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 font-medium">
                  {c.direction === "inbound" ? (
                    <PhoneIncoming className="size-4 text-emerald-600" />
                  ) : (
                    <PhoneOutgoing className="size-4 text-sky-600" />
                  )}
                  {c.subject || (c.direction === "inbound" ? "Incoming call" : "Outgoing call")}
                  {c.status && <span className="chip bg-secondary text-[10px] px-2 py-0.5">{STATUS_LABEL[c.status] ?? c.status}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {when(c.occurred_at)}
                  {c.duration_sec ? ` · ${Math.max(1, Math.round(c.duration_sec / 60))} min` : ""}
                  {c.author_name ? ` · ${c.author_name}` : ""}
                </div>
              </div>
              {c.notes && <div className="text-muted-foreground whitespace-pre-wrap">{c.notes}</div>}
              {c.next_followup_at && <div className="text-xs text-amber-700">Follow up: {when(c.next_followup_at)}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
