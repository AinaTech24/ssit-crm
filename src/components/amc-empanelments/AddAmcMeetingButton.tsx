"use client";

/**
 * "Add meeting notes" on the AMC meetings list — pick the AMC, then record the
 * meeting without first opening that AMC's own page. Posts to the same records
 * endpoint the per-AMC tab uses, so the permission check is identical.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";

const today = () => new Date().toISOString().slice(0, 10);

export function AddAmcMeetingButton({ amcs }: { amcs: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amcId, setAmcId] = useState("");
  const [date, setDate] = useState(today);
  const [subject, setSubject] = useState("");
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");

  async function save() {
    if (!amcId || !subject.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/amc-empanelments/${amcId}/records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "meeting",
          meetingDate: date,
          subject: subject.trim(),
          attendees: attendees.trim() || null,
          notes: notes.trim() || null,
          followUp: followUp.trim() || null,
        }),
      });
      if (!r.ok) {
        toast.error((await readApiError(r, "save")).message);
        return;
      }
      toast.success("AMC meeting created");
      setSubject("");
      setAttendees("");
      setNotes("");
      setFollowUp("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(readThrownError(e, "save").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary text-xs inline-flex items-center gap-1">
        <Plus className="size-3.5" /> Create meeting
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={() => !busy && setOpen(false)}>
          <div
            className="w-full max-w-lg rounded-lg border bg-card p-4 shadow-xl space-y-3"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Create AMC meeting</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">AMC</span>
              <select value={amcId} onChange={(e) => setAmcId(e.target.value)} className="input-base w-full">
                <option value="">{amcs.length ? "Select an AMC…" : "No AMC empanelments yet — add one first"}</option>
                {amcs.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Meeting date</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base w-full" />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Subject</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={300}
                  placeholder="e.g. Quarterly review"
                  className="input-base w-full"
                />
              </label>
            </div>
            <input
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              maxLength={1000}
              placeholder="Attendees"
              className="input-base w-full"
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Discussion points / agenda"
              className="input-base w-full resize-y"
            />
            <input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              maxLength={2000}
              placeholder="Follow-up, if anything is owed"
              className="input-base w-full"
            />
            <div className="flex items-center gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:underline">
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || !amcId || !subject.trim()}
                className="btn-primary text-xs inline-flex items-center gap-1"
              >
                {busy && <Loader2 className="size-3 animate-spin" />} Create meeting
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
