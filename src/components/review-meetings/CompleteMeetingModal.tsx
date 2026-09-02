"use client";

/**
 * Complete-meeting popup — opened from a lead's blueprint when "Meeting Done"
 * needs a meeting marked completed. Loads ONLY this lead's meetings, lets the RM
 * capture notes and mark the scheduled meeting completed inline (PATCH
 * status=completed), without leaving the lead page. Completing a meeting
 * auto-advances the blueprint to "Meeting Done".
 */

import { useEffect, useState } from "react";
import { Calendar, X, Loader2, CheckCircle2, ExternalLink } from "lucide-react";

type Meeting = {
  id: string;
  subject?: string | null;
  meeting_date?: string | null;
  status?: string | null;
  meeting_mode?: string | null;
  investor_name?: string | null;
};

export function CompleteMeetingModal({
  open,
  leadId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  leadId: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setMeetings(null); setErr(null); setNotes({}); setBusyId(null); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/review-meetings?leadId=${leadId}`);
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) { setErr(j.error ?? "Could not load meetings."); return; }
        setMeetings((j.meetings ?? []) as Meeting[]);
      } catch {
        if (alive) setErr("Could not load meetings.");
      }
    })();
    return () => { alive = false; };
  }, [open, leadId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Open meetings (not yet completed/cancelled) sit on top — those are the ones
  // the RM completes from here.
  const openMeetings = (meetings ?? []).filter((m) => m.status === "scheduled" || m.status === "confirmed");

  async function markCompleted(m: Meeting) {
    setBusyId(m.id);
    setErr(null);
    try {
      const res = await fetch(`/api/review-meetings/${m.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed", meetingNotes: notes[m.id]?.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? "Could not mark completed."); return; }
      // Completing auto-advances the blueprint to Meeting Done — refresh the host.
      onSuccess?.();
    } catch (e: any) {
      setErr(e?.message ?? "Could not mark completed.");
    } finally {
      setBusyId(null);
    }
  }

  const fmt = (d?: string | null) =>
    d ? new Date(d).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-6" onClick={onClose}>
      <div className="card-surface w-full max-w-xl my-4 sm:my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-brand-cyan-light grid place-items-center">
              <Calendar className="size-5 text-brand-cyan" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Mark meeting completed</h2>
              <p className="text-xs text-muted-foreground">Capture the outcome and complete it here — no need to open the meetings page.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}

          {!meetings ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading meetings…
            </div>
          ) : openMeetings.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <div className="text-sm text-muted-foreground">No scheduled meeting found for this lead to complete.</div>
              <a href={`/dashboard/review-meetings?leadId=${leadId}`} className="btn-secondary text-xs inline-flex items-center gap-1">
                Open meetings page <ExternalLink className="size-3" />
              </a>
            </div>
          ) : (
            openMeetings.map((m) => (
              <div key={m.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{m.subject || "Meeting"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmt(m.meeting_date)}{m.meeting_mode ? ` · ${m.meeting_mode}` : ""} · <span className="capitalize">{m.status}</span>
                    </div>
                  </div>
                  <a href={`/dashboard/review-meetings/${m.id}`} className="text-[11px] text-brand-cyan-deep hover:underline inline-flex items-center gap-0.5 shrink-0" title="Open full editor">
                    Full editor <ExternalLink className="size-3" />
                  </a>
                </div>
                <textarea
                  value={notes[m.id] ?? ""}
                  onChange={(e) => setNotes((p) => ({ ...p, [m.id]: e.target.value }))}
                  rows={2}
                  placeholder="Meeting notes / outcome (optional)…"
                  className="input-base text-xs w-full"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => markCompleted(m)}
                    disabled={busyId === m.id}
                    className="btn-primary text-xs !bg-emerald-600 hover:!bg-emerald-700 text-white font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {busyId === m.id ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                    Mark completed
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
