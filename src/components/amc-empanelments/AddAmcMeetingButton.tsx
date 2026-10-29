"use client";

/**
 * "Create meeting" on the AMC meetings list — pick the AMC, say how the meeting
 * was held, tag the colleagues (or a whole branch) who should know about it, and
 * record it, without first opening that AMC's own page.
 *
 * The AMC picker is the same searchable list the empanelment form uses (the
 * standard houses plus anything the firm added), so it is never empty on a firm
 * that has no empanelments yet. Tagged people get an announcement of their own;
 * nobody else sees it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";
import { AmcPicker } from "./AmcPicker";
import { CollaboratorSelect } from "@/components/common/CollaboratorSelect";

const today = () => new Date().toISOString().slice(0, 10);

const MODES = [
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "office", label: "Office" },
] as const;
type Mode = (typeof MODES)[number]["value"];

export function AddAmcMeetingButton({
  catalog,
  branches,
  currentUserId,
}: {
  catalog: Array<{ code: string; name: string; inactive?: boolean }>;
  branches: Array<{ id: string; name: string }>;
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amc, setAmc] = useState<{ code: string; name: string } | null>(null);
  const [date, setDate] = useState(today);
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState<Mode | "">("");
  const [attendees, setAttendees] = useState("");
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [branchId, setBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");

  const ready = !!amc && !!subject.trim() && !!mode;

  async function save() {
    if (!amc || !mode || !subject.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/amc-empanelments/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amcCode: amc.code,
          amcName: amc.name,
          meetingDate: date,
          subject: subject.trim(),
          mode,
          attendees: attendees.trim() || null,
          notes: notes.trim() || null,
          followUp: followUp.trim() || null,
          collaboratorUserIds: collaborators,
          branchId: branchId || null,
        }),
      });
      if (!r.ok) {
        toast.error((await readApiError(r, "save")).message);
        return;
      }
      const j = await r.json().catch(() => ({}));
      toast.success(j.told ? `AMC meeting created · ${j.told} colleague${j.told === 1 ? "" : "s"} notified` : "AMC meeting created");
      setSubject("");
      setMode("");
      setAttendees("");
      setCollaborators([]);
      setBranchId("");
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
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"
          onMouseDown={() => !busy && setOpen(false)}
        >
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

            <div>
              <span className="text-[11px] text-muted-foreground">AMC</span>
              <AmcPicker catalog={catalog} value={amc?.code ?? ""} onPick={(a) => setAmc({ code: a.code, name: a.name })} />
            </div>

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

            <div>
              <span className="text-[11px] text-muted-foreground">Mode</span>
              <div className="mt-1 flex gap-2" role="radiogroup" aria-label="Meeting mode">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.value}
                    onClick={() => setMode(m.value)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition ${
                      mode === m.value
                        ? "border-brand-cyan-deep bg-brand-cyan-light/50 font-semibold text-brand-cyan-deep"
                        : "border-border hover:bg-secondary/60"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <input
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              maxLength={1000}
              placeholder="Attendees (from the AMC and from your side)"
              className="input-base w-full"
            />

            <div>
              <span className="text-[11px] text-muted-foreground">Collaborators — told about this meeting</span>
              <CollaboratorSelect byDepartment values={collaborators} onChange={setCollaborators} excludeUserId={currentUserId} max={50} />
            </div>

            {branches.length > 1 && (
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Or tag a whole branch (optional)</span>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input-base w-full">
                  <option value="">No branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

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
            {(collaborators.length > 0 || branchId) && (
              <p className="text-[11px] text-muted-foreground">
                Only the people you tag{branchId ? " and that branch" : ""} will see this meeting in Announcements.
              </p>
            )}
            <div className="flex items-center gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:underline">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={busy || !ready} className="btn-primary text-xs inline-flex items-center gap-1">
                {busy && <Loader2 className="size-3 animate-spin" />} Create meeting
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
