"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CalendarPlus,
  ListPlus,
  MessageSquarePlus,
  ChevronDown,
  X,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { ProductInterestDialog } from "@/components/leads/ProductInterestDialog";

type Props = {
  leadId: string;
  leadName: string;
  leadEmail?: string | null;
  leadPhone?: string | null;
  currentStage: string;
  alreadyConvertedInvestorId?: string | null;
};

/**
 * Lead-phase blueprint stages — exact mirror of LEAD_TO_CLIENT_STAGES 1-12
 * (up to Documents Received, before the convert-to-client boundary).
 * Used by both the header Stage: ▼ dropdown and the Kanban columns so the
 * platform speaks one language: stage === blueprint.
 *
 * Post-conversion stages (13-15) live in the Clients module and aren't
 * selectable here.
 */
/**
 * Lead-phase stages — 10 stages from "New Lead Created" through "Not
 * Qualified", with branches for call-back loops. See LEAD_TO_CLIENT_STAGES.
 * Post-conversion stages (11-30) live in the Clients module.
 */
const STAGES = [
  { key: "new", label: "New Lead Created" },
  { key: "call_done", label: "Call Done" },
  { key: "call_back_later", label: "Call Back Later" },
  { key: "call_not_connected", label: "Call Not Connected" },
  { key: "contact_in_future", label: "Contact in Future" },
  { key: "meeting_scheduled", label: "Meeting Scheduled" },
  { key: "meeting_pending", label: "Meeting Pending" },
  { key: "meeting_done", label: "Meeting Done" },
  { key: "won_lead", label: "Won Lead" },
  { key: "not_qualified", label: "Not Qualified" },
];

const ACTIVITY_TYPES = [
  { key: "call", label: "Phone call" },
  { key: "meeting", label: "Meeting" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "note", label: "Note" },
  { key: "other", label: "Other" },
];

export function LeadActions(props: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    "stage" | "convert" | "task" | "meeting" | "schedule_meeting" | "activity" | "won_product" | null
  >(null);

  // Listen for "open this dialog please" events emitted by the
  // GuidedStageActions component on the blueprint bar. Lets the
  // stage-action buttons ("Call Done", "Meeting Done", …) drive the
  // same dialogs the header buttons use, without prop-drilling.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { kind: string; leadId: string };
      if (detail.leadId !== props.leadId) return;
      switch (detail.kind) {
        case "log_call":
        case "log_past_meeting":
          setDialog("activity");
          break;
        case "schedule_meeting":
          // Open the in-place meeting modal — creates a real review_meeting
          // row, not just a task. Same record the Meetings module reads from.
          setDialog("schedule_meeting");
          break;
        case "won_lead_product":
          // "Qualified — Won Lead" → ask which product the client wants. The
          // dialog records it, sets the pipeline, and advances to Won Lead.
          setDialog("won_product");
          break;
        case "send_risk_profile":
        case "capture_risk_profile_manually":
        case "send_doc_checklist":
        case "capture_approval":
          // These open the OnboardingActions panel below — scroll there
          // and highlight. The existing panel handles the actual UI.
          document
            .querySelector("[data-onboarding-actions]")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
          break;
        case "convert":
          // Green "Convert to Client →" CTA on the blueprint bar opens the
          // same convert dialog as the header button.
          setDialog("convert");
          break;
        case "mark_lost":
          setDialog("stage"); // stage dropdown lets user pick Lost
          break;
      }
    }
    window.addEventListener("blueprint:open-dialog", onOpen);
    return () => window.removeEventListener("blueprint:open-dialog", onOpen);
  }, [props.leadId]);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {props.alreadyConvertedInvestorId ? (
          <button
            onClick={() => router.push(`/dashboard/investors/${props.alreadyConvertedInvestorId}`)}
            className="rounded-md bg-emerald-600 text-white px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-emerald-700"
          >
            <CheckCircle2 className="size-4" /> Already converted · View client
          </button>
        ) : (
          <>
            <StageDropdown
              leadId={props.leadId}
              fallbackStage={props.currentStage}
              onChange={async (s) => {
                // Single source of truth — advance the blueprint. The
                // legacy /api/leads/[id]/stage still exists for back-compat
                // but the user-facing stage = the blueprint stage now.
                await fetch(`/api/leads/${props.leadId}/blueprint/advance`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ toStageKey: s, remarks: "Manual stage change from header dropdown." }),
                });
                router.refresh();
              }}
            />

            <button
              onClick={() => setDialog("activity")}
              className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
            >
              <MessageSquarePlus className="size-4" /> Log activity
            </button>
            <button
              onClick={() => setDialog("task")}
              className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
            >
              <ListPlus className="size-4" /> Add task
            </button>
            <button
              onClick={() => setDialog("schedule_meeting")}
              className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
            >
              <CalendarPlus className="size-4" /> Schedule meeting
            </button>
            <button
              onClick={() => setDialog("convert")}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
            >
              <ArrowRight className="size-4" /> Convert to client
            </button>
          </>
        )}
      </div>

      {dialog === "activity" && (
        <LogActivityDialog
          leadId={props.leadId}
          leadName={props.leadName}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
            // Tell the BlueprintStageBar (client component) to re-fetch
            // its /blueprint endpoint — router.refresh() alone doesn't
            // re-run its useEffect.
            window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          }}
        />
      )}
      {dialog === "won_product" && (
        <ProductInterestDialog
          leadId={props.leadId}
          leadName={props.leadName}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
            window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          }}
        />
      )}
      {dialog === "task" && (
        <TaskDialog
          leadId={props.leadId}
          leadName={props.leadName}
          kind="task"
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
            // Tell the BlueprintStageBar (client component) to re-fetch
            // its /blueprint endpoint — router.refresh() alone doesn't
            // re-run its useEffect.
            window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          }}
        />
      )}
      {dialog === "meeting" && (
        <TaskDialog
          leadId={props.leadId}
          leadName={props.leadName}
          kind="meeting"
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
            // Tell the BlueprintStageBar (client component) to re-fetch
            // its /blueprint endpoint — router.refresh() alone doesn't
            // re-run its useEffect.
            window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          }}
        />
      )}
      {dialog === "schedule_meeting" && (
        <ScheduleMeetingDialog
          leadId={props.leadId}
          leadName={props.leadName}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
            // Smart auto-advance: the /api/review-meetings POST emits a
            // meeting.scheduled.lead event → blueprint moves to
            // meeting_scheduled. Re-fetch the stage bar.
            window.dispatchEvent(new CustomEvent("blueprint:refresh"));
          }}
        />
      )}
      {dialog === "convert" && (
        <ConvertDialog
          leadId={props.leadId}
          leadName={props.leadName}
          onClose={() => setDialog(null)}
          onDone={(investorId) => router.push(`/dashboard/investors/${investorId}`)}
        />
      )}
    </>
  );
}

/* -------------------- Stage dropdown -------------------- */

/**
 * Stage dropdown — driven by the blueprint, not by the legacy
 * `leads.stage` column. Self-fetches the current blueprint stage on mount
 * so the label is always accurate regardless of the legacy column.
 *
 * Falls back to the prop-supplied stage during the brief loading window
 * so the button label never flickers to blank.
 */
function StageDropdown({
  leadId,
  fallbackStage,
  onChange,
}: {
  leadId: string;
  fallbackStage: string;
  onChange: (s: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>(fallbackStage);

  // Pull the live blueprint stage so the dropdown reflects the actual
  // journey position (smart auto-advance + manual moves both land here).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/leads/${leadId}/blueprint`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.current?.key) setCurrentStage(d.current.key);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const label = STAGES.find((s) => s.key === currentStage)?.label ?? currentStage;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
      >
        Stage: <span className="font-medium">{label}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div
          className="absolute z-10 mt-1 right-0 border bg-card rounded-md shadow-lg min-w-[240px] max-h-[60vh] overflow-y-auto"
          onMouseLeave={() => setOpen(false)}
        >
          {STAGES.map((s, i) => (
            <button
              key={s.key}
              onClick={async () => {
                setOpen(false);
                setCurrentStage(s.key);
                await onChange(s.key);
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 ${
                s.key === currentStage ? "bg-accent font-medium" : ""
              }`}
            >
              <span className="text-[10px] tabular-nums text-muted-foreground w-5">{i + 1}.</span>
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------- Log activity dialog -------------------- */

function LogActivityDialog({
  leadId,
  leadName,
  onClose,
  onDone,
}: {
  leadId: string;
  leadName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [activityType, setActivityType] = useState("call");
  const [note, setNote] = useState("");
  const [nextFollowUp, setNextFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!note.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          note,
          activityType,
          nextFollowUpAt: nextFollowUp ? new Date(nextFollowUp).toISOString() : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Failed");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Log activity · ${leadName}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <div className="text-xs font-medium mb-1">Activity type</div>
          <select
            value={activityType}
            onChange={(e) => setActivityType(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Notes<span className="text-rose-600">*</span></div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={5}
            placeholder="What was discussed?"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Next follow-up (optional)</div>
          <input
            type="datetime-local"
            value={nextFollowUp}
            onChange={(e) => setNextFollowUp(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        {err && <div className="text-sm text-rose-600">{err}</div>}
      </div>
      <ModalFooter
        onClose={onClose}
        submit={
          <button
            onClick={submit}
            disabled={busy || !note.trim()}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Log activity
          </button>
        }
      />
    </Modal>
  );
}

/* -------------------- Task / Meeting dialog -------------------- */

function TaskDialog({
  leadId,
  leadName,
  kind,
  onClose,
  onDone,
}: {
  leadId: string;
  leadName: string;
  kind: "task" | "meeting";
  onClose: () => void;
  onDone: () => void;
}) {
  const isMeeting = kind === "meeting";
  const [title, setTitle] = useState(
    isMeeting ? `Introduction meeting with ${leadName}` : `Follow up with ${leadName}`
  );
  const [description, setDescription] = useState("");
  const [type, setType] = useState(isMeeting ? "introduction_meeting" : "follow_up");
  const [priority, setPriority] = useState(isMeeting ? "high" : "normal");
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date(Date.now() + (isMeeting ? 2 : 1) * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectType: "lead",
          subjectId: leadId,
          type,
          title,
          description,
          priority,
          dueAt: new Date(dueAt).toISOString(),
          assigneeId: assigneeId || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Failed");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isMeeting ? `Schedule meeting · ${leadName}` : `Add task · ${leadName}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <div className="text-xs font-medium mb-1">Title<span className="text-rose-600">*</span></div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">{isMeeting ? "Meeting type" : "Task type"}</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              {isMeeting ? (
                <>
                  <option value="introduction_meeting">Introduction</option>
                  <option value="portfolio_review">Portfolio review</option>
                  <option value="goal_discussion">Goal discussion</option>
                  <option value="proposal_discussion">Proposal discussion</option>
                  <option value="other_meeting">Other</option>
                </>
              ) : (
                <>
                  <option value="follow_up">Follow-up</option>
                  <option value="call_back">Call back</option>
                  <option value="send_proposal">Send proposal</option>
                  <option value="collect_document">Collect document</option>
                  <option value="custom">Custom</option>
                </>
              )}
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Priority</div>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">{isMeeting ? "When" : "Due"}</div>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">
            Assign to
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">
              · defaults to you
            </span>
          </div>
          <RmSelector
            value={assigneeId}
            onChange={setAssigneeId}
            placeholder="— Assign to myself —"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Notes</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        {err && <div className="text-sm text-rose-600">{err}</div>}
      </div>
      <ModalFooter
        onClose={onClose}
        submit={
          <button
            onClick={submit}
            disabled={busy || !title}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {isMeeting ? "Schedule" : "Create task"}
          </button>
        }
      />
    </Modal>
  );
}

/* -------------------- Schedule meeting dialog -------------------- */

/**
 * Creates a real review_meetings record (not a task), so the meeting
 * shows up in the Meetings module and the calendar. Hits POST
 * /api/review-meetings which emits a meeting.scheduled.lead event,
 * auto-advancing the blueprint to meeting_scheduled.
 */
export function ScheduleMeetingDialog({
  leadId,
  leadName,
  onClose,
  onDone,
}: {
  leadId: string;
  leadName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [meetingType, setMeetingType] = useState("new_investment_discussion");
  const [meetingMode, setMeetingMode] = useState("online");
  const [meetingDate, setMeetingDate] = useState(() => {
    // Default to tomorrow 11 am
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(11, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [locationOrLink, setLocationOrLink] = useState("");
  const [discussionPoints, setDiscussionPoints] = useState("");
  const [rmId, setRmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/review-meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId,
          meetingType,
          meetingDate: new Date(meetingDate).toISOString(),
          durationMinutes: parseInt(durationMinutes, 10) || 30,
          meetingMode,
          locationOrLink: locationOrLink || undefined,
          discussionPoints: discussionPoints || undefined,
          rmId: rmId || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Schedule meeting · ${leadName}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground -mt-1">
          Creates a meeting record in the Meetings module and moves the
          blueprint to <span className="font-medium">Meeting Scheduled</span>.
          A reminder task auto-fires the day before.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Meeting type</div>
            <select
              value={meetingType}
              onChange={(e) => setMeetingType(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="new_investment_discussion">New Investment Discussion</option>
              <option value="portfolio_review">Portfolio Review</option>
              <option value="goal_review">Goal Review</option>
              <option value="service_discussion">Service Discussion</option>
              <option value="family_review">Family Review</option>
              <option value="complaint_discussion">Complaint Discussion</option>
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Mode</div>
            <select
              value={meetingMode}
              onChange={(e) => setMeetingMode(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="online">Online</option>
              <option value="office">Office</option>
              <option value="client_place">Client Place</option>
              <option value="phone">Phone</option>
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">When<span className="text-rose-600">*</span></div>
            <input
              type="datetime-local"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Duration (min)</div>
            <input
              type="number"
              min={5}
              max={480}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background tabular-nums"
            />
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Location / link</div>
          <input
            value={locationOrLink}
            onChange={(e) => setLocationOrLink(e.target.value)}
            placeholder={
              meetingMode === "online"
                ? "Zoom / Meet / Teams URL"
                : meetingMode === "phone"
                ? "Phone number to call"
                : "Address"
            }
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">
            Assign RM
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">
              · defaults to the lead's owner
            </span>
          </div>
          <RmSelector
            value={rmId}
            onChange={setRmId}
            placeholder="— Use lead's RM —"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Agenda / discussion points</div>
          <textarea
            value={discussionPoints}
            onChange={(e) => setDiscussionPoints(e.target.value)}
            rows={3}
            placeholder="Risk appetite, goals, family context, proposal discussion…"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        {err && <div className="text-sm text-rose-600">{err}</div>}
      </div>
      <ModalFooter
        onClose={onClose}
        submit={
          <button
            onClick={submit}
            disabled={busy || !meetingDate}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            <CalendarPlus className="size-4" /> Schedule meeting
          </button>
        }
      />
    </Modal>
  );
}

/* -------------------- Convert dialog -------------------- */

function ConvertDialog({
  leadId,
  leadName,
  onClose,
  onDone,
}: {
  leadId: string;
  leadName: string;
  onClose: () => void;
  onDone: (investorId: string) => void;
}) {
  const [pan, setPan] = useState("");
  const [segmentTag, setSegmentTag] = useState("Retail");
  const [investorCategory, setInvestorCategory] = useState("individual");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pan: pan.toUpperCase().trim(), segmentTag, investorCategory, notes }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Conversion failed");
        return;
      }
      onDone(j.investorId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Convert ${leadName} to client`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          We'll create a new client record using this lead's contact info. Workflows subscribed
          to <code className="text-xs bg-muted px-1 rounded">investor.created</code> will run
          automatically (welcome message, onboarding tasks, etc).
        </p>
        <label className="block">
          <div className="text-xs font-medium mb-1">
            PAN
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">· optional — add it later after KYC docs</span>
          </div>
          <input
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase())}
            placeholder="ABCDE1234F (optional)"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono"
          />
          <div className="text-[10px] text-muted-foreground mt-1">
            Leave blank to convert now and capture the PAN from the client's KYC documents later.
          </div>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Segment</div>
            <select
              value={segmentTag}
              onChange={(e) => setSegmentTag(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="HNI">HNI</option>
              <option value="Affluent">Affluent</option>
              <option value="Retail">Retail</option>
              <option value="NRI">NRI</option>
              <option value="Corporate">Corporate</option>
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Category</div>
            <select
              value={investorCategory}
              onChange={(e) => setInvestorCategory(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="individual">Individual</option>
              <option value="huf">HUF</option>
              <option value="corporate">Corporate</option>
              <option value="trust">Trust</option>
              <option value="nri">NRI</option>
              <option value="minor">Minor</option>
            </select>
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Conversion notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="What did they sign up for?"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        {err && <div className="text-sm text-rose-600">{err}</div>}
      </div>
      <ModalFooter
        onClose={onClose}
        submit={
          <button
            onClick={submit}
            // PAN is optional — allow convert with no PAN. Only block if a PAN
            // was typed but is malformed.
            disabled={busy || (pan.trim() !== "" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase()))}
            className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            <CheckCircle2 className="size-4" /> Convert & open client
          </button>
        }
      />
    </Modal>
  );
}

/* -------------------- Modal shell -------------------- */

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Portal to <body> so the overlay escapes any sticky/blurred ancestor
  // stacking context (e.g. the SectionNav's `backdrop-blur` bar at the top of
  // the page). Rendered inline, a `fixed` overlay can get trapped beneath that
  // bar — leaving an un-dimmed white strip across the top of the modal. The
  // portal + z-[120] guarantees the backdrop covers the whole viewport.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const overlay = (
    <div className="fixed inset-0 z-[120] bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-lg shadow-lg max-w-lg w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(overlay, document.body);
}

function ModalFooter({ onClose, submit }: { onClose: () => void; submit: React.ReactNode }) {
  return (
    <div className="border-t -mx-5 -mb-5 mt-5 px-5 py-3 flex justify-end gap-2">
      <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
        Cancel
      </button>
      {submit}
    </div>
  );
}
