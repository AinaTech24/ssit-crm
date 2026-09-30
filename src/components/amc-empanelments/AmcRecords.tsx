"use client";

/**
 * The relationship history for one AMC: meetings held, and notes worth keeping.
 *
 * The empanelment record above this says what the STATUS is — codes, contacts,
 * dates. This says what has actually happened, which is the part that used to
 * live in somebody's inbox and leave with them.
 *
 * Two tabs rather than one merged feed: when you are looking for "what did we
 * agree in the last review" you want meetings, and when you are looking for
 * "what do we know about this AMC" you want notes. Merging them makes both
 * searches worse.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, CalendarDays, StickyNote } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";

type Meeting = {
  id: string;
  meeting_date: string;
  subject: string;
  attendees: string | null;
  notes: string | null;
  follow_up: string | null;
  author_name: string | null;
};
type Note = {
  id: string;
  note: string;
  noted_on: string | null;
  created_at: string;
  author_name: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string | null) =>
  d ? new Date(d.length > 10 ? d : d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function AmcRecords({ amcId, amcName }: { amcId: string; amcName: string }) {
  const toast = useToast();
  const base = `/api/amc-empanelments/${amcId}/records`;
  const [tab, setTab] = useState<"meetings" | "notes">("meetings");
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Meeting form
  const [mDate, setMDate] = useState(today);
  const [mSubject, setMSubject] = useState("");
  const [mAttendees, setMAttendees] = useState("");
  const [mNotes, setMNotes] = useState("");
  const [mFollowUp, setMFollowUp] = useState("");
  // Note form
  const [nText, setNText] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(base);
      if (!r.ok) {
        toast.error((await readApiError(r, "load AMC history")).message);
        setMeetings([]);
        setNotes([]);
        return;
      }
      const j = await r.json();
      setMeetings(j.meetings ?? []);
      setNotes(j.notes ?? []);
    } catch (e) {
      toast.error(readThrownError(e, "load AMC history").message);
      setMeetings([]);
      setNotes([]);
    }
  }, [base, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const payload =
      tab === "meetings"
        ? {
            kind: "meeting" as const,
            meetingDate: mDate,
            subject: mSubject.trim(),
            attendees: mAttendees.trim() || null,
            notes: mNotes.trim() || null,
            followUp: mFollowUp.trim() || null,
          }
        : { kind: "note" as const, note: nText.trim(), notedOn: today() };

    if (tab === "meetings" ? !payload.subject : !nText.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        toast.error((await readApiError(r, "save")).message);
        return;
      }
      // Cleared only on success, so a failed save never loses the typing.
      if (tab === "meetings") {
        setMSubject("");
        setMAttendees("");
        setMNotes("");
        setMFollowUp("");
      } else {
        setNText("");
      }
      setShowForm(false);
      await load();
      toast.success(tab === "meetings" ? "Meeting recorded" : "Note added");
    } catch (e) {
      toast.error(readThrownError(e, "save").message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, kind: "meeting" | "note") {
    if (!confirm(`Delete this ${kind}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}/${id}?kind=${kind}`, { method: "DELETE" });
      if (!r.ok) {
        toast.error((await readApiError(r, "delete")).message);
        return;
      }
      await load();
    } catch (e) {
      toast.error(readThrownError(e, "delete").message);
    } finally {
      setBusy(false);
    }
  }

  const count = tab === "meetings" ? meetings?.length ?? 0 : notes?.length ?? 0;

  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 flex-wrap">
        <div className="inline-flex items-center gap-1 rounded-lg border bg-secondary/30 p-1">
          {(["meetings", "notes"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setShowForm(false);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md capitalize ${
                tab === t ? "bg-brand-cyan text-white" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {t === "meetings" ? <CalendarDays className="size-3.5" /> : <StickyNote className="size-3.5" />}
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="btn-secondary text-xs inline-flex items-center gap-1"
        >
          <Plus className="size-3.5" /> {tab === "meetings" ? "Record a meeting" : "Add a note"}
        </button>
      </div>

      {showForm && (
        <div className="border-b px-4 py-3 bg-secondary/20 space-y-2">
          {tab === "meetings" ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Meeting date</span>
                  <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} className="input-base w-full" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Subject</span>
                  <input
                    value={mSubject}
                    onChange={(e) => setMSubject(e.target.value)}
                    placeholder="e.g. Quarterly review"
                    maxLength={300}
                    className="input-base w-full"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-[11px] text-muted-foreground">Attendees</span>
                  <input
                    value={mAttendees}
                    onChange={(e) => setMAttendees(e.target.value)}
                    placeholder="Who was there, from both sides"
                    maxLength={1000}
                    className="input-base w-full"
                  />
                </label>
              </div>
              <textarea
                value={mNotes}
                onChange={(e) => setMNotes(e.target.value)}
                rows={3}
                placeholder="What was discussed and agreed"
                className="input-base w-full resize-y"
              />
              <input
                value={mFollowUp}
                onChange={(e) => setMFollowUp(e.target.value)}
                placeholder="Follow-up, if anything is owed"
                maxLength={2000}
                className="input-base w-full"
              />
            </>
          ) : (
            <textarea
              value={nText}
              onChange={(e) => setNText(e.target.value)}
              rows={3}
              placeholder={`Anything worth remembering about ${amcName}`}
              className="input-base w-full resize-y"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={add}
              disabled={busy || (tab === "meetings" ? !mSubject.trim() : !nText.trim())}
              className="btn-primary text-xs inline-flex items-center gap-1"
            >
              {busy && <Loader2 className="size-3 animate-spin" />} Save
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {(tab === "meetings" ? meetings : notes) === null ? (
        <div className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : count === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No {tab} recorded for {amcName} yet.
        </div>
      ) : tab === "meetings" ? (
        <ul className="divide-y">
          {meetings!.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{m.subject}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {fmt(m.meeting_date)}
                    {m.attendees ? ` · ${m.attendees}` : ""}
                    {m.author_name ? ` · recorded by ${m.author_name}` : ""}
                  </div>
                  {m.notes && <p className="text-sm mt-1.5 whitespace-pre-wrap">{m.notes}</p>}
                  {m.follow_up && (
                    <p className="text-xs mt-1.5 text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                      Follow-up: {m.follow_up}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(m.id, "meeting")}
                  title="Delete this meeting"
                  className="text-muted-foreground hover:text-rose-600 shrink-0"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y">
          {notes!.map((n) => (
            <li key={n.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm whitespace-pre-wrap">{n.note}</p>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {n.author_name ?? "Unknown"} · {fmt(n.noted_on ?? n.created_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(n.id, "note")}
                  title="Delete this note"
                  className="text-muted-foreground hover:text-rose-600 shrink-0"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
