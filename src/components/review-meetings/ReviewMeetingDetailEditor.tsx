"use client";

/**
 * Detail / edit pane for a single review meeting.
 *
 * Sections:
 *   - Status updater (7 states)
 *   - Discussion points / agenda
 *   - Meeting notes
 *   - Action items (add / remove rows; on save → server fans out to tasks)
 *   - Attachments (URL-pasted; in a future turn we add a real S3 upload)
 *   - Next review date
 *
 * "Mark completed" runs the full automation chain server-side:
 *   - sets investor.lastReviewAt + nextReviewAt
 *   - creates one task per action item
 *   - creates a "write up your notes" task if notes are empty
 */

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Plus, Trash2, CheckCircle2, X, Sparkles, ListChecks, CalendarPlus, Target, CalendarClock, ChevronDown, Download } from "lucide-react";
import { renderReviewAgendaTemplate } from "@/lib/review-meetings/agenda";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

/** 15-minute time slots across the day, labelled in 12-hour form. */
const TIME_SLOTS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const ampm = h < 12 ? "AM" : "PM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      out.push({ value: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` });
    }
  }
  return out;
})();

const STATUSES = [
  ["scheduled", "Scheduled"],
  ["confirmed", "Confirmed"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["rescheduled", "Rescheduled"],
  ["cancelled", "Cancelled"],
  ["no_show", "No-show"],
] as const;

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700",
  confirmed: "bg-cyan-50 text-cyan-700",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  rescheduled: "bg-slate-50 text-slate-700",
  cancelled: "bg-gray-50 text-gray-700",
  no_show: "bg-rose-50 text-rose-700",
};

const OUTCOMES = [
  ["", "— Not captured —"],
  ["ready", "Ready to proceed"],
  ["more_info", "Wants more info"],
  ["not_ready", "Not ready right now"],
  ["not_interested", "Not interested"],
  ["no_show", "No-show"],
] as const;

const MODES = [
  ["office", "Office"],
  ["client_place", "Client place"],
  ["online", "Online"],
  ["phone", "Phone"],
] as const;

type ActionItem = { title: string; dueAt?: string; taskId?: string };
type Attachment = { name: string; url: string };
type Attendee = {
  name: string;
  role:
    | "rm"
    | "investor"
    | "spouse"
    | "family"
    | "ca"
    | "amc_rm"
    | "sub_distributor"
    | "back_office"
    | "compliance"
    | "other";
  isExternal: boolean;
  notes?: string;
};

const ATTENDEE_ROLE_LABELS: Record<string, string> = {
  rm: "RM (firm)",
  investor: "Investor",
  spouse: "Spouse",
  family: "Family member",
  ca: "CA / Tax advisor",
  amc_rm: "AMC RM",
  sub_distributor: "Sub-distributor",
  back_office: "Back office",
  compliance: "Compliance",
  other: "Other",
};

export function ReviewMeetingDetailEditor({
  meeting,
  investorName,
}: {
  meeting: any;
  investorName: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(meeting.status);
  const [subject, setSubject] = useState<string>(meeting.subject ?? "");
  const [outcome, setOutcome] = useState<string>(meeting.outcome ?? "");
  const [outcomeNotes, setOutcomeNotes] = useState<string>(meeting.outcomeNotes ?? "");
  // Reschedule fields — moving the date/time/mode/location after creation.
  const initDT = splitLocal(meeting.meetingDate);
  const [meetingDay, setMeetingDay] = useState<string>(initDT.day);
  const [meetingTime, setMeetingTime] = useState<string>(initDT.time);
  const [meetingMode, setMeetingMode] = useState<string>(meeting.meetingMode ?? "office");
  const [location, setLocation] = useState<string>(meeting.locationOrLink ?? "");
  const [rescheduleReason, setRescheduleReason] = useState<string>("");
  const originalDay = initDT.day;
  const originalTime = initDT.time;
  const dateMoved = !!meetingDay && (meetingDay !== originalDay || meetingTime !== originalTime);
  // "Add to calendar" menu (Google / Outlook / .ics).
  const [calOpen, setCalOpen] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);
  const [discussion, setDiscussion] = useState(meeting.discussionPoints ?? "");
  const [notes, setNotes] = useState(meeting.meetingNotes ?? "");
  const [items, setItems] = useState<ActionItem[]>(
    (meeting.actionItems as ActionItem[] | null) ?? []
  );
  const [atts, setAtts] = useState<Attachment[]>(
    (meeting.attachments as Attachment[] | null) ?? []
  );
  const [attendees, setAttendees] = useState<Attendee[]>(
    (meeting.attendees as Attendee[] | null) ?? []
  );
  const [newAttendee, setNewAttendee] = useState<Attendee>({
    name: "",
    role: "investor",
    isExternal: true,
  });
  const [nextReview, setNextReview] = useState(
    meeting.nextReviewDate ? String(meeting.nextReviewDate).slice(0, 10) : defaultNextReview()
  );
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Close the "Add to calendar" menu on outside click / Escape.
  useEffect(() => {
    if (!calOpen) return;
    function onDown(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCalOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [calOpen]);

  // Build "add to calendar" deep links from the current meeting data.
  const calLinks = (() => {
    const start = new Date(meeting.meetingDate);
    const dur = Number(meeting.durationMinutes) || 30;
    const end = new Date(start.getTime() + dur * 60_000);
    const title = (subject || `Meeting with ${investorName}`).trim();
    const details = (discussion || meeting.discussionPoints || "").trim();
    const loc = (location || meeting.locationOrLink || "").trim();
    const valid = !isNaN(start.getTime());
    const gfmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const google =
      `https://calendar.google.com/calendar/render?action=TEMPLATE` +
      `&text=${encodeURIComponent(title)}` +
      `&dates=${gfmt(start)}/${gfmt(end)}` +
      `&details=${encodeURIComponent(details)}` +
      `&location=${encodeURIComponent(loc)}`;
    const outlook =
      `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent` +
      `&subject=${encodeURIComponent(title)}` +
      `&startdt=${encodeURIComponent(start.toISOString())}` +
      `&enddt=${encodeURIComponent(end.toISOString())}` +
      `&body=${encodeURIComponent(details)}` +
      `&location=${encodeURIComponent(loc)}`;
    return { valid, google, outlook, ics: `/api/review-meetings/${meeting.id}/calendar.ics` };
  })();

  // AI summary state
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState<null | {
    summary: string;
    keyPoints: string[];
    decisions: string[];
    actionItems: Array<{ title: string; owner?: string; dueHint?: string }>;
    nextSteps: string[];
  }>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);

  async function runAiSummary() {
    setAiBusy(true);
    setAiErr(null);
    setAiPreview(null);
    try {
      const res = await fetch("/api/ai/meeting-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notes,
          agenda: discussion || undefined,
          meetingType: meeting.meetingType,
          durationMinutes: meeting.durationMinutes
            ? Number(meeting.durationMinutes)
            : undefined,
          clientName: investorName,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setAiErr(j.error ?? `AI failed (${res.status})`);
        return;
      }
      setAiPreview(j);
    } catch (e: any) {
      setAiErr(e?.message ?? "AI request failed");
    } finally {
      setAiBusy(false);
    }
  }

  function acceptAiSummary() {
    if (!aiPreview) return;
    // Replace notes with the AI-formatted summary block.
    const formatted = [
      aiPreview.summary,
      aiPreview.keyPoints.length
        ? "\n\nKey points:\n" + aiPreview.keyPoints.map((p) => `  • ${p}`).join("\n")
        : "",
      aiPreview.decisions.length
        ? "\n\nDecisions:\n" + aiPreview.decisions.map((p) => `  • ${p}`).join("\n")
        : "",
      aiPreview.nextSteps.length
        ? "\n\nNext steps:\n" + aiPreview.nextSteps.map((p) => `  • ${p}`).join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("");
    // Append the AI summary BELOW the RM's own notes — never overwrite what they
    // typed (the summary is derived from it; the verbatim notes still matter).
    setNotes((prev: string) => {
      const block = formatted.trim();
      return prev.trim() ? `${prev.trim()}\n\n— AI summary —\n${block}` : block;
    });
    // Append action items to the existing list (don't replace — preserves
    // anything the RM already typed).
    if (aiPreview.actionItems.length) {
      setItems((prev) => [
        ...prev,
        ...aiPreview.actionItems.map((a) => ({ title: a.title })),
      ]);
    }
    setAiPreview(null);
    setOk("AI summary applied — review + save when ready.");
  }

  function addItem() {
    setItems((s) => [...s, { title: "" }]);
  }
  function patchItem(i: number, k: keyof ActionItem, v: string) {
    setItems((s) => s.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  }
  function removeItem(i: number) {
    setItems((s) => s.filter((_, idx) => idx !== i));
  }

  function addAttachment() {
    setAtts((s) => [...s, { name: "", url: "" }]);
  }
  function patchAttachment(i: number, k: keyof Attachment, v: string) {
    setAtts((s) => s.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  }
  function removeAttachment(i: number) {
    setAtts((s) => s.filter((_, idx) => idx !== i));
  }

  async function save(overrideStatus?: string) {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const payload: any = {
        status: overrideStatus ?? status,
        subject: subject || undefined,
        discussionPoints: discussion || undefined,
        meetingNotes: notes || undefined,
        actionItems: items.filter((i) => i.title.trim().length > 0),
        attachments: atts.filter((a) => a.url.trim().length > 0),
        attendees: attendees.filter((a) => a.name.trim().length > 0),
        nextReviewDate: nextReview || undefined,
        outcome: outcome || undefined,
        outcomeNotes: outcomeNotes || undefined,
        meetingMode: meetingMode || undefined,
        locationOrLink: location || undefined,
        // Only send a (reschedule) date + reason when the date actually changed.
        ...(dateMoved
          ? {
              meetingDate: new Date(`${meetingDay}T${meetingTime || "11:00"}:00`).toISOString(),
              rescheduleReason: rescheduleReason || undefined,
            }
          : {}),
      };
      const res = await fetch(`/api/review-meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      if (overrideStatus === "completed" || j.completed) {
        setStatus("completed");
        setOk(
          `Marked completed · action items became tasks · ${investorName}'s next review set to ${nextReview}.`
        );
      } else {
        setOk("Saved.");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="card-surface p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-muted-foreground">Status</label>
          <SelectField value={status} onChange={(e) => setStatus(e.target.value)} size="sm" className="w-40">
            {STATUSES.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </SelectField>
        </div>
        <div className="flex items-center gap-2">
          {/* Add to calendar — adds the event directly to Google/Outlook (opens
              the prefilled event), or downloads an .ics for Apple/other apps. */}
          <div ref={calRef} className="relative">
            <button
              type="button"
              onClick={() => setCalOpen((o) => !o)}
              className="btn-ghost text-xs"
              title="Add this meeting to your calendar"
            >
              <CalendarPlus className="size-3.5" /> Add to calendar
              <ChevronDown className={`size-3 transition-transform ${calOpen ? "rotate-180" : ""}`} />
            </button>
            {calOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-lg border border-border bg-white shadow-xl p-1 text-left">
                <a
                  href={calLinks.valid ? calLinks.google : undefined}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setCalOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-foreground/80 hover:bg-secondary"
                >
                  <CalendarPlus className="size-3.5 text-emerald-600" /> Google Calendar
                </a>
                <a
                  href={calLinks.valid ? calLinks.outlook : undefined}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setCalOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-foreground/80 hover:bg-secondary"
                >
                  <CalendarPlus className="size-3.5 text-blue-600" /> Outlook Calendar
                </a>
                <a
                  href={calLinks.ics}
                  onClick={() => setCalOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-foreground/80 hover:bg-secondary border-t border-border mt-1 pt-2"
                >
                  <Download className="size-3.5 text-muted-foreground" /> Download .ics (Apple/other)
                </a>
              </div>
            )}
          </div>
          <a
            href={`/dashboard/review-meetings/${meeting.id}/portfolio`}
            className="btn-ghost text-xs"
            title="Open the per-folio review worksheet"
          >
            Portfolio review →
          </a>
          {status !== "completed" && (
            <button
              onClick={() => save("completed")}
              disabled={busy}
              className="btn-accent text-xs"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Mark completed
            </button>
          )}
          <button onClick={() => save()} disabled={busy} className="btn-primary text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </button>
        </div>
      </div>

      {ok && (
        <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2 text-sm">
          {ok}
        </div>
      )}
      {err && (
        <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
          {err}
        </div>
      )}

      {/* Subject */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold">Subject</h3>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Q1 portfolio review + tax-saving + nominee update"
          className="input-base"
        />
      </div>

      {/* Schedule / reschedule */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-brand-cyan" />
          <h3 className="font-semibold">Schedule</h3>
          {Number(meeting.rescheduleCount ?? 0) > 0 && (
            <span className="chip bg-amber-50 text-amber-700 text-[10px]">
              rescheduled {meeting.rescheduleCount}×
            </span>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-0.5">Date</div>
            <DateField value={meetingDay} onChange={(e) => setMeetingDay(e.target.value)} size="sm" className="w-full" />
          </label>
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-0.5">Time</div>
            <SelectField value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} options={TIME_SLOTS} size="sm" className="w-full" />
          </label>
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-0.5">Mode</div>
            <SelectField value={meetingMode} onChange={(e) => setMeetingMode(e.target.value)} size="sm" className="w-full">
              {MODES.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-0.5">Location / link</div>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Office / address / video link"
              className="input-base"
            />
          </label>
        </div>
        {dateMoved && (
          <label className="block">
            <div className="text-[11px] text-amber-700 mb-0.5 font-medium">Reschedule reason</div>
            <input
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
              placeholder="Why is this being moved? (optional)"
              className="input-base"
            />
            <p className="text-[11px] text-amber-600 mt-1">
              Saving moves the T-1 reminder task to the new date and logs a reschedule.
            </p>
          </label>
        )}
      </div>

      {/* Attendees */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Attendees ({attendees.length})</h3>
        </div>
        {attendees.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">
            Add who was actually in the room — spouse, family CA, AMC RM, etc.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {attendees.map((a, i) => (
              <li
                key={i}
                className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md px-3 py-2"
              >
                <div className="min-w-0 flex items-center gap-3">
                  <span
                    className={`chip text-[10px] ${
                      a.isExternal
                        ? "bg-violet-50 text-violet-700"
                        : "bg-cyan-50 text-cyan-700"
                    }`}
                  >
                    {ATTENDEE_ROLE_LABELS[a.role] ?? a.role}
                  </span>
                  <span className="text-sm font-medium">{a.name}</span>
                  {a.notes && (
                    <span className="text-[11px] text-muted-foreground truncate">
                      · {a.notes}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setAttendees((p) => p.filter((_, idx) => idx !== i))
                  }
                  className="p-1.5 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-12 gap-2 mt-2">
          <input
            value={newAttendee.name}
            onChange={(e) =>
              setNewAttendee((p) => ({ ...p, name: e.target.value }))
            }
            placeholder="Name"
            className="input-base text-sm col-span-4"
          />
          <SelectField
            value={newAttendee.role}
            onChange={(e) =>
              setNewAttendee((p) => ({
                ...p,
                role: e.target.value as Attendee["role"],
                isExternal: !["rm", "back_office", "compliance"].includes(e.target.value),
              }))
            }
            size="sm"
            className="text-sm col-span-3"
          >
            {Object.entries(ATTENDEE_ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectField>
          <input
            value={newAttendee.notes ?? ""}
            onChange={(e) =>
              setNewAttendee((p) => ({ ...p, notes: e.target.value || undefined }))
            }
            placeholder="Notes (optional)"
            className="input-base text-sm col-span-4"
          />
          <button
            type="button"
            onClick={() => {
              if (!newAttendee.name.trim()) return;
              setAttendees((p) => [...p, { ...newAttendee }]);
              setNewAttendee({ name: "", role: "investor", isExternal: true });
            }}
            disabled={!newAttendee.name.trim()}
            className="btn-ghost text-xs col-span-1"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Discussion points */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Discussion points (agenda)</h3>
          {/* Insert the standard Network-FP review agenda (5.1). Appends when
              the field already has content so we never clobber the RM's notes. */}
          <button
            type="button"
            onClick={() => {
              const template = renderReviewAgendaTemplate();
              setDiscussion((cur: string) =>
                cur && cur.trim().length > 0 ? `${cur.trim()}\n\n${template}` : template
              );
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border border-brand-cyan/40 bg-brand-cyan-light/50 text-brand-cyan-deep px-2.5 py-1 hover:bg-brand-cyan-light"
            title="Insert the 7-question standard review agenda"
          >
            <ListChecks className="size-3.5" /> Insert standard review agenda
          </button>
        </div>
        <textarea
          value={discussion}
          onChange={(e) => setDiscussion(e.target.value)}
          rows={3}
          placeholder="What you plan to cover with the client… or click 'Insert standard review agenda' to start from the proven 7-question script."
          className="input-base"
        />
      </div>

      {/* Meeting notes */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Meeting notes</h3>
          <button
            onClick={runAiSummary}
            disabled={aiBusy || notes.trim().length < 20}
            title={
              notes.trim().length < 20
                ? "Write at least 20 chars of notes first"
                : "Claude summarises your notes into key points + action items"
            }
            className="btn-ghost text-xs"
          >
            {aiBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            AI summarise
          </button>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          placeholder="What was actually discussed, decisions made, mood of the client, follow-up needed…"
          className="input-base"
        />
        <p className="text-[11px] text-muted-foreground">
          When you mark this meeting completed without notes, a 24-hour high-priority "write up your notes"
          task is auto-created.
        </p>

        {aiErr && (
          <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
            {aiErr}
          </div>
        )}

        {aiPreview && (
          <div className="mt-3 border border-violet-200 bg-violet-50/60 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-violet-900">
                <Sparkles className="size-3.5" /> AI draft (review before applying)
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAiPreview(null)}
                  className="btn-ghost text-xs"
                >
                  <X className="size-3.5" /> Discard
                </button>
                <button onClick={acceptAiSummary} className="btn-primary text-xs">
                  <CheckCircle2 className="size-3.5" /> Apply
                </button>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-foreground">{aiPreview.summary}</p>
              {aiPreview.keyPoints.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-violet-700 font-medium mt-2">
                    Key points
                  </div>
                  <ul className="list-disc ml-5 text-foreground">
                    {aiPreview.keyPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiPreview.decisions.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-violet-700 font-medium mt-2">
                    Decisions
                  </div>
                  <ul className="list-disc ml-5 text-foreground">
                    {aiPreview.decisions.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiPreview.actionItems.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-violet-700 font-medium mt-2">
                    Action items — will be appended below
                  </div>
                  <ul className="list-disc ml-5 text-foreground">
                    {aiPreview.actionItems.map((a, i) => (
                      <li key={i}>
                        {a.title}
                        {a.owner && (
                          <span className="text-muted-foreground"> · {a.owner}</span>
                        )}
                        {a.dueHint && (
                          <span className="text-muted-foreground"> · {a.dueHint}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {aiPreview.nextSteps.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-violet-700 font-medium mt-2">
                    Next steps
                  </div>
                  <ul className="list-disc ml-5 text-foreground">
                    {aiPreview.nextSteps.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <p className="text-[11px] text-violet-700">
              AI is advisory. Edit the draft after applying — nothing saves until you hit Save above.
            </p>
          </div>
        )}
      </div>

      {/* Outcome */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-brand-cyan" />
          <h3 className="font-semibold">Outcome</h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-0.5">Result</div>
            <SelectField value={outcome} onChange={(e) => setOutcome(e.target.value)} size="sm" className="w-full">
              {OUTCOMES.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-[11px] text-muted-foreground mb-0.5">Outcome notes</div>
            <input
              value={outcomeNotes}
              onChange={(e) => setOutcomeNotes(e.target.value)}
              placeholder="Optional context"
              className="input-base"
            />
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          For lead meetings the outcome moves the journey forward — <b>Ready</b> → won, <b>Not interested</b> →
          closed, <b>Wants more info / Not ready</b> → re-nurture in 7 days.
        </p>
      </div>

      {/* Action items */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">
            Action items ({items.length}){" "}
            {meeting.follow_up_task_created === "true" && (
              <span className="text-xs text-emerald-600 ml-1">· tasks created ✓</span>
            )}
          </h3>
          <button onClick={addItem} className="btn-ghost text-xs">
            <Plus className="size-3.5" /> Add item
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">
            None yet. Each action item you add becomes a task for the RM when this meeting is marked completed.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  value={it.title}
                  onChange={(e) => patchItem(i, "title", e.target.value)}
                  placeholder="e.g. Send tax-saving fund recommendation by next Tuesday"
                  className="input-base flex-1"
                />
                <DateField
                  value={it.dueAt ?? ""}
                  onChange={(e) => patchItem(i, "dueAt", e.target.value)}
                  size="sm"
                  className="w-40"
                />
                {it.taskId ? (
                  <span className="chip bg-emerald-50 text-emerald-700 text-[10px]">task ✓</span>
                ) : (
                  <button
                    onClick={() => removeItem(i)}
                    className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Attachments */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Attachments ({atts.length})</h3>
          <button onClick={addAttachment} className="btn-ghost text-xs">
            <Plus className="size-3.5" /> Add link
          </button>
        </div>
        {atts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">
            Paste a link to a presentation, report, or signed document.
          </p>
        ) : (
          <ul className="space-y-2">
            {atts.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  value={a.name}
                  onChange={(e) => patchAttachment(i, "name", e.target.value)}
                  placeholder="Display name"
                  className="input-base w-1/3"
                />
                <input
                  value={a.url}
                  onChange={(e) => patchAttachment(i, "url", e.target.value)}
                  placeholder="https://…"
                  className="input-base flex-1"
                />
                <button
                  onClick={() => removeAttachment(i)}
                  className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Next review */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold">Next review date</h3>
        <DateField
          value={nextReview}
          onChange={(e) => setNextReview(e.target.value)}
          size="sm"
          className="w-60"
        />
        <p className="text-[11px] text-muted-foreground">
          On completion, the client's <code>nextReviewAt</code> is set to this date and the
          per-tier auto-cadence recipe takes over.
        </p>
      </div>
    </div>
  );
}

function defaultNextReview(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 6); // 6-month default cadence
  return d.toISOString().slice(0, 10);
}

/** ISO/Date → { day: "yyyy-mm-dd", time: "HH:mm" } in local time. */
function splitLocal(v: any): { day: string; time: string } {
  if (!v) return { day: "", time: "11:00" };
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return { day: "", time: "11:00" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
