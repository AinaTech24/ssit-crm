"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Loader2, Save, Users, Sparkles, Home, ChevronsUpDown, Video, AlertTriangle } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { MeetingAttachmentPicker, uploadMeetingAttachments } from "./MeetingAttachments";

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

// User-facing meeting type = the three categories the firm cares about.
const CATEGORY_OPTIONS = [
  ["new", "New Meeting"],
  ["review", "Review Meeting"],
  ["follow_up", "Follow-up Meeting"],
] as const;

// The API still stores a granular `meetingType` (enum) alongside `category`;
// map each user-facing category to one representative type so the UI stays to
// the three options the user asked for.
const TYPE_FOR_CATEGORY: Record<string, string> = {
  new: "new_investment_discussion",
  review: "portfolio_review",
  follow_up: "follow_up_call",
};

const MODES = [
  ["office", "Office"],
  ["client_place", "Client Place"],
  ["online", "Online"],
  ["phone", "Phone"],
] as const;

/** "portfolio_review" → "Portfolio Review" for conflict-list display. */
function labelType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type InvestorOpt = { id: string; name: string; pan: string; segment_tag: string | null };
type LeadOpt = { id: string; name: string; phone: string | null; stage: string };
type FamilyOpt = { id: string; family_name: string; primary_investor_id: string; primary_name: string };
type Kind = "client" | "lead" | "family";
type MeetingConflict = {
  id: string;
  subject: string | null;
  meeting_type: string;
  meeting_date: string;
  duration_minutes: string | null;
  name: string | null;
};

/**
 * Schedule-meeting form. MFDs meet clients, pre-conversion leads, and whole
 * families — a Client | Lead | Family toggle swaps the (searchable) subject
 * picker. A family meeting attaches to the family's primary investor + familyId
 * and defaults to the Family Review type.
 */
export function ScheduleMeetingForm({
  investors,
  leads,
  families,
  preselectedInvestorId,
  preselectedLeadId,
  preselectedCategory,
  onSuccess,
  defaultSubject,
}: {
  investors: InvestorOpt[];
  leads: LeadOpt[];
  families: FamilyOpt[];
  preselectedInvestorId?: string;
  preselectedLeadId?: string;
  /** When provided (e.g. in a modal), called on save instead of navigating to
   *  the review-meetings list — lets the host close the modal & refresh. The
   *  saved meeting's key details are passed back for a confirmation / invite. */
  onSuccess?: (meeting?: { id?: string; day?: string; time?: string; subject?: string }) => void;
  /** Pre-fills the subject line (e.g. "Intro meeting — {lead name}"). */
  defaultSubject?: string;
  /** "new" | "review" | "follow_up" — defaults the Meeting type dropdown. */
  preselectedCategory?: string;
}) {
  const router = useRouter();
  const [subjectKind, setSubjectKind] = useState<Kind>(preselectedLeadId ? "lead" : "client");
  const def = defaultDateTimeParts();
  const [form, setForm] = useState({
    investorId: preselectedInvestorId ?? "",
    leadId: preselectedLeadId ?? "",
    familyId: "",
    subject: defaultSubject ?? "",
    category: (["new", "review", "follow_up"].includes(preselectedCategory ?? "") ? preselectedCategory! : "review"),
    meetingDay: def.day,
    meetingTime: def.time,
    durationMinutes: "30",
    meetingMode: "online",
    locationOrLink: "",
    discussionPoints: "",
    rmId: "" as string,
    status: "scheduled",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Documents picked before the meeting exists. They are POSTed to
  // /api/review-meetings/<id>/attachments as soon as the meeting is created.
  const [docs, setDocs] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  // RM double-booking: when the API returns 409, hold the clashing meetings so
  // the user can confirm "Schedule anyway".
  const [conflicts, setConflicts] = useState<MeetingConflict[] | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function pickKind(k: Kind) {
    setSubjectKind(k);
    // Family meetings are reviews.
    if (k === "family" && form.category !== "review") set("category", "review");
  }

  /** Generate a ready-to-use video room (Jitsi — no account/setup needed). */
  function generateVideoLink() {
    const rand =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    set("locationOrLink", `https://meet.jit.si/mfd-${rand}`);
    if (form.meetingMode !== "online") set("meetingMode", "online");
  }

  async function save(force = false) {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, any> = {
        subject: form.subject || undefined,
        category: form.category,
        meetingType: TYPE_FOR_CATEGORY[form.category] ?? "portfolio_review",
        meetingDate: new Date(`${form.meetingDay}T${form.meetingTime || "11:00"}:00`).toISOString(),
        durationMinutes: parseInt(form.durationMinutes, 10) || 30,
        meetingMode: form.meetingMode,
        locationOrLink: form.locationOrLink || undefined,
        discussionPoints: form.discussionPoints || undefined,
        rmId: form.rmId || undefined,
        status: form.status,
        force,
      };
      if (subjectKind === "client") body.investorId = form.investorId;
      else if (subjectKind === "lead") body.leadId = form.leadId;
      else {
        // Family → attach to the primary investor + the familyId.
        const fam = families.find((f) => f.id === form.familyId);
        body.investorId = fam?.primary_investor_id;
        body.familyId = form.familyId;
        body.category = "review";
      }

      const res = await fetch("/api/review-meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (res.status === 409 && j.error === "rm_conflict") {
        setConflicts(j.conflicts ?? []);
        return;
      }
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      if (docs.length && j?.id) {
        setUploading(true);
        try {
          await uploadMeetingAttachments(j.id, docs);
        } catch (e: any) {
          // The meeting IS saved; only the documents failed. Say so plainly
          // and stay on the form so the user can retry the upload.
          setErr(
            (e?.message ?? "Attachment upload failed") +
              " — the meeting was scheduled, but its documents were not attached. Open the meeting to add them."
          );
          return;
        } finally {
          setUploading(false);
        }
      }

      if (onSuccess) onSuccess({ id: j?.id, day: form.meetingDay, time: form.meetingTime, subject: form.subject });
      else router.push("/dashboard/review-meetings");
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    !!form.meetingDay && !!form.meetingTime &&
    (subjectKind === "client" ? !!form.investorId : subjectKind === "lead" ? !!form.leadId : !!form.familyId);
  const subjectLocked = !!(preselectedInvestorId || preselectedLeadId);

  const TABS: Array<{ k: Kind; label: string; Icon: any }> = [
    { k: "client", label: "Client", Icon: Users },
    { k: "lead", label: "Lead", Icon: Sparkles },
    { k: "family", label: "Family", Icon: Home },
  ];

  return (
    <div className="card-surface p-5 space-y-3">
      <h2 className="font-semibold">Meeting details</h2>

      {/* Subject (free-text title) */}
      <Field label="Subject">
        <input
          value={form.subject}
          onChange={(e) => set("subject", e.target.value)}
          // placeholder="e.g. Q1 portfolio review + tax-saving + nominee update"
          className="input-base"
        />
      </Field>

      {/* Subject toggle — Client | Lead | Family */}
      <div>
        <div className="text-xs font-semibold text-foreground/80 mb-1.5">Who is the meeting with?</div>
        <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-1 gap-1">
          {TABS.map(({ k, label, Icon }) => {
            const disabled = subjectLocked && subjectKind !== k;
            return (
              <button
                key={k}
                type="button"
                disabled={disabled}
                onClick={() => pickKind(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${subjectKind === k ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            );
          })}
        </div>
      </div>

      {subjectKind === "client" && (
        <Field label="Client">
          <SearchSelect
            options={investors.map((i) => ({ value: i.id, label: i.name, sub: `${i.pan}${i.segment_tag ? " · " + i.segment_tag : ""}` }))}
            value={form.investorId}
            onChange={(v) => set("investorId", v)}
            placeholder="Search a client by name or PAN…"
          />
        </Field>
      )}
      {subjectKind === "lead" && (
        <Field label="Lead">
          <SearchSelect
            options={leads.map((l) => ({ value: l.id, label: l.name, sub: `${l.phone ? l.phone + " · " : ""}${l.stage.replace(/_/g, " ")}` }))}
            value={form.leadId}
            onChange={(v) => set("leadId", v)}
            placeholder="Search a lead by name or phone…"
          />
          {leads.length === 0 && (
            <div className="text-[11px] text-muted-foreground mt-1.5">
              No open leads. Add one from{" "}
              <a href="/dashboard/leads/new" className="text-brand-cyan hover:underline">Leads → New</a>.
            </div>
          )}
        </Field>
      )}
      {subjectKind === "family" && (
        <Field label="Family">
          <SearchSelect
            options={families.map((f) => ({ value: f.id, label: f.family_name, sub: `Head: ${f.primary_name}` }))}
            value={form.familyId}
            onChange={(v) => set("familyId", v)}
            placeholder="Search a family group…"
          />
          {families.length === 0 && (
            <div className="text-[11px] text-muted-foreground mt-1.5">
              No families with a primary client set. Link one from{" "}
              <a href="/dashboard/families" className="text-brand-cyan hover:underline">Families</a>.
            </div>
          )}
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Meeting type">
          <SelectField value={form.category} onChange={(e) => set("category", e.target.value)} className="w-full">
            {CATEGORY_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </SelectField>
        </Field>
        <Field label="Mode">
          <SelectField value={form.meetingMode} onChange={(e) => set("meetingMode", e.target.value)} className="w-full">
            {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </SelectField>
        </Field>

        <Field label="Date">
          <DateField value={form.meetingDay} onChange={(e) => set("meetingDay", e.target.value)} className="w-full" />
        </Field>
        <Field label="Time">
          <SelectField value={form.meetingTime} onChange={(e) => set("meetingTime", e.target.value)} options={TIME_SLOTS} className="w-full" />
        </Field>

        <Field label="Duration (minutes)">
          <input type="number" value={form.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value)} min={5} max={480} className="input-base tabular-nums" />
        </Field>
        <Field label="Initial status">
          <SelectField value={form.status} onChange={(e) => set("status", e.target.value)} className="w-full">
            <option value="scheduled">Scheduled</option>
            <option value="confirmed">Confirmed</option>
          </SelectField>
        </Field>

        <Field label="Assigned RM">
          <RmSelector
            value={form.rmId || null}
            onChange={(id) => set("rmId", id ?? "")}
            placeholder={subjectKind === "lead" ? "Use the lead's owner" : "Use the client's RM"}
          />
        </Field>
      </div>

      <Field label="Location / link">
        <div className="flex gap-2">
          <input
            value={form.locationOrLink}
            onChange={(e) => set("locationOrLink", e.target.value)}
            placeholder={form.meetingMode === "online" ? "Zoom / Meet / Teams URL" : form.meetingMode === "phone" ? "Phone number to call" : "Address"}
            className="input-base flex-1"
          />
          {form.meetingMode === "online" && (
            <button
              type="button"
              onClick={generateVideoLink}
              title="Create an instant video room (no account needed)"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary/60 transition-colors"
            >
              <Video className="size-4" /> Generate link
            </button>
          )}
        </div>
        {form.meetingMode === "online" && form.locationOrLink && /^https?:\/\//.test(form.locationOrLink) && (
          <a
            href={form.locationOrLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-brand-cyan hover:underline mt-1 inline-block break-all"
          >
            {form.locationOrLink}
          </a>
        )}
      </Field>

      <Field label="Discussion points (agenda)">
        <textarea
          value={form.discussionPoints}
          onChange={(e) => set("discussionPoints", e.target.value)}
          rows={3}
          // placeholder={subjectKind === "lead" ? "Introductory call agenda, risk appetite, family + goal context…" : "Portfolio rebalancing, new SIPs, tax planning, nominee update…"}
          className="input-base"
        />
      </Field>

      <MeetingAttachmentPicker files={docs} onChange={setDocs} disabled={busy || uploading} />

      {err && (
        <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">{err}</div>
      )}

      {conflicts && conflicts.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 rounded-lg px-3 py-2.5 text-sm">
          <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-4" /> This RM is already booked at that time
          </div>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-800 dark:text-amber-200/90">
            {conflicts.map((c) => (
              <li key={c.id}>
                • {c.subject || labelType(c.meeting_type)}
                {c.name ? ` with ${c.name}` : ""} —{" "}
                {new Date(c.meeting_date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                {" "}({c.duration_minutes || "30"} min)
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mt-2.5">
            <button
              onClick={() => { setConflicts(null); save(true); }}
              disabled={busy}
              className="rounded-md bg-amber-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              Schedule anyway
            </button>
            <button
              onClick={() => setConflicts(null)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary/60"
            >
              Pick another time
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-border">
        <button onClick={() => save()} disabled={!canSave || busy || uploading} className="btn-primary">
          {busy || uploading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {uploading
            ? `Uploading ${docs.length} document${docs.length === 1 ? "" : "s"}…`
            : busy
              ? "Scheduling…"
              : docs.length
                ? `Schedule meeting + ${docs.length} document${docs.length === 1 ? "" : "s"}`
                : "Schedule meeting"}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed pt-2 border-t border-border flex items-start gap-1.5">
        <Calendar className="size-3.5 mt-0.5 flex-shrink-0" />
        A reminder task auto-fires the day before. After completion, action items become tasks and the{" "}
        {subjectKind === "lead" ? "lead's last-contact date" : "client's next review date"} gets updated.
      </p>
    </div>
  );
}

/** Lightweight searchable single-select (typeahead) over an in-memory list. */
function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: Array<{ value: string; label: string; sub?: string }>;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  const filtered = (needle ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(needle)) : options).slice(0, 50);

  // Close on outside click / Escape. (The old version used a full-screen
  // overlay div, but because this control sits inside a <label>, clicking the
  // overlay re-fired the label's click onto the trigger button and re-opened
  // it — so it never closed. A ref + document listener avoids that entirely.)
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); setQ(""); }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="input-base flex items-center justify-between text-left w-full">
        <span className={selected ? "truncate" : "text-muted-foreground truncate"}>
          {selected ? selected.label : placeholder}
          {selected?.sub && <span className="text-muted-foreground text-xs"> · {selected.sub}</span>}
        </span>
        <ChevronsUpDown className="size-3.5 opacity-50 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-popover shadow-xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type to search…"
            className="w-full px-3 py-2 text-sm border-b border-border bg-transparent outline-none"
          />
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No matches</li>}
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${o.value === value ? "bg-accent/50 font-medium" : ""}`}
                >
                  {o.label}
                  {o.sub && <span className="text-muted-foreground text-xs"> · {o.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
          {options.length > 50 && (
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border">Showing 50 — refine your search.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-foreground/80 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

/** Tomorrow at 11:00 → { day: "yyyy-mm-dd", time: "HH:mm" }. */
function defaultDateTimeParts(): { day: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  // Skip to the next weekday — don't default a meeting onto Sat/Sun.
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Sat → Mon
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: "11:00",
  };
}
