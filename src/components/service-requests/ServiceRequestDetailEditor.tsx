"use client";

/**
 * Ticket workspace — the "work a service request" pane.
 *
 * Turns the SR module from create→list→close into something you can actually
 * operate: change status, reassign (RmSelector), capture the first response,
 * add timeline notes, write resolution notes, and record post-resolution CSAT.
 * Every save goes through PATCH /api/service-requests/[id], which appends the
 * activity timeline + stamps respondedAt/resolvedAt/csatAt server-side.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Save, CheckCircle2, PhoneCall, Plus, Clock, AlertTriangle, Star, MessageSquare, UserCog,
} from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { formatRelative } from "@/lib/utils";

const STATUSES = [
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["waiting_customer", "Waiting customer"],
  ["resolved", "Resolved"],
  ["closed", "Closed"],
  ["escalated", "Escalated"],
] as const;

const PRIORITIES = [
  ["low", "Low"],
  ["normal", "Normal"],
  ["high", "High"],
  ["urgent", "Urgent"],
] as const;

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  status: "Status changed",
  first_response: "First response",
  note: "Note",
  resolution: "Resolution",
  assigned: "Reassigned",
  csat: "CSAT",
  escalated: "Escalated",
};

// Mirrors SEBI_COMPLAINT_CATEGORIES / COMPLAINT_SOURCES in db/schema.
const SEBI_CATEGORIES = [
  ["service", "Service / TAT"], ["mis_selling", "Mis-selling"], ["transaction", "Transaction / order"],
  ["fee", "Fee / commission"], ["kyc", "KYC / documents"], ["communication", "Communication / statements"], ["other", "Other"],
] as const;
const COMPLAINT_SOURCES = [
  ["direct", "Direct (client)"], ["scores", "SCORES (SEBI)"], ["amfi", "AMFI"], ["amc", "AMC"],
  ["email", "Email"], ["phone", "Phone"], ["walk_in", "Walk-in"], ["other", "Other"],
] as const;

type TimelineEntry = { at: string; by: string; event: string; note?: string };

export function ServiceRequestDetailEditor({
  sr,
  userMap,
}: {
  sr: any;
  userMap: Record<string, string>;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(sr.status);
  const [priority, setPriority] = useState<string>(sr.priority);
  const [assignee, setAssignee] = useState<string | null>(sr.assignedToUserId ?? null);
  const [remarks, setRemarks] = useState<string>(sr.remarks ?? "");
  const [resolutionNotes, setResolutionNotes] = useState<string>(sr.resolutionNotes ?? "");
  const [newNote, setNewNote] = useState("");
  const [csat, setCsat] = useState<number>(sr.csatRating ?? 0);
  const [csatComment, setCsatComment] = useState<string>(sr.csatComment ?? "");
  const isComplaint = sr.type === "complaint";
  const [sebiCategory, setSebiCategory] = useState<string>(sr.sebiCategory ?? "service");
  const [sebiSubCategory, setSebiSubCategory] = useState<string>(sr.sebiSubCategory ?? "");
  const [complaintSource, setComplaintSource] = useState<string>(sr.complaintSource ?? "direct");
  const [scoresRefNo, setScoresRefNo] = useState<string>(sr.scoresRefNo ?? "");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const responded = !!sr.respondedAt;
  const closed = status === "resolved" || status === "closed";
  const timeline: TimelineEntry[] = ((sr.timeline as TimelineEntry[]) ?? [])
    .slice()
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const attachments: Array<{ name: string; key?: string; size?: number }> = sr.attachments ?? [];

  async function patch(body: any, okMsg: string) {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch(`/api/service-requests/${sr.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Save failed (${res.status})`); return; }
      setOk(okMsg);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function save(overrideStatus?: string) {
    const body: any = {
      status: overrideStatus ?? status,
      priority,
      assignedToUserId: assignee || undefined,
      remarks: remarks || undefined,
      resolutionNotes: resolutionNotes || undefined,
    };
    if (csat > 0 && csat !== sr.csatRating) body.csatRating = csat;
    if (csatComment && csatComment !== sr.csatComment) body.csatComment = csatComment;
    if (isComplaint) {
      body.sebiCategory = sebiCategory;
      body.sebiSubCategory = sebiSubCategory || undefined;
      body.complaintSource = complaintSource;
      body.scoresRefNo = complaintSource === "scores" ? (scoresRefNo || undefined) : undefined;
    }
    if (overrideStatus) setStatus(overrideStatus);
    patch(body, overrideStatus === "resolved" ? "Resolved — TAT clock stopped." : "Saved.");
  }

  return (
    <div className="space-y-4">
      {/* Status / actions bar */}
      <div className="card-surface p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs font-semibold text-muted-foreground">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-base text-sm w-40">
            {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label className="text-xs font-semibold text-muted-foreground ml-2">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input-base text-sm w-32">
            {PRIORITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {!responded && (
            <button onClick={() => patch({ markResponded: true }, "First response recorded.")} disabled={busy} className="btn-ghost text-xs">
              <PhoneCall className="size-3.5" /> Mark first response
            </button>
          )}
          {!closed && (
            <button onClick={() => save("resolved")} disabled={busy} className="btn-accent text-xs">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Resolve
            </button>
          )}
          <button onClick={() => save()} disabled={busy} className="btn-primary text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
          </button>
        </div>
      </div>

      {ok && <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2 text-sm">{ok}</div>}
      {err && <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">{err}</div>}

      {/* SLA clocks */}
      <div className="grid grid-cols-2 gap-3">
        <SlaCard label="First response" due={sr.slaResponseAt} done={sr.respondedAt} />
        <SlaCard label="Resolution (TAT)" due={sr.slaResolutionAt} done={sr.resolvedAt} />
      </div>

      {/* Complaint register fields (SEBI) */}
      {isComplaint && (
        <div className="card-surface p-5 space-y-3 border-amber-200">
          <h3 className="font-semibold text-amber-800">SEBI complaint register</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <div className="text-[11px] text-muted-foreground mb-0.5">Category</div>
              <select value={sebiCategory} onChange={(e) => setSebiCategory(e.target.value)} className="input-base">
                {SEBI_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-[11px] text-muted-foreground mb-0.5">Sub-category</div>
              <input value={sebiSubCategory} onChange={(e) => setSebiSubCategory(e.target.value)} placeholder="e.g. Scheme switch" className="input-base" />
            </label>
            <label className="block">
              <div className="text-[11px] text-muted-foreground mb-0.5">Source</div>
              <select value={complaintSource} onChange={(e) => setComplaintSource(e.target.value)} className="input-base">
                {COMPLAINT_SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            {complaintSource === "scores" && (
              <label className="block">
                <div className="text-[11px] text-muted-foreground mb-0.5">SCORES ref no</div>
                <input value={scoresRefNo} onChange={(e) => setScoresRefNo(e.target.value)} placeholder="2026/0001234" className="input-base" />
              </label>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Saved with the ticket — feeds the register filter + the monthly disclosure statement.</p>
        </div>
      )}

      {/* Reassign */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold flex items-center gap-2"><UserCog className="size-4 text-brand-cyan" /> Assigned to</h3>
        <div className="max-w-sm"><RmSelector value={assignee} onChange={setAssignee} placeholder="— Unassigned —" /></div>
      </div>

      {/* Remarks */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold">Internal remarks</h3>
        <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="Working notes for the team…" className="input-base" />
      </div>

      {/* Resolution notes */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold">Resolution notes <span className="text-xs font-normal text-muted-foreground">(SEBI register)</span></h3>
        <textarea value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} rows={3} placeholder="How was this resolved? Captured on the complaint register." className="input-base" />
      </div>

      {/* CSAT — once resolved/closed */}
      {closed && (
        <div className="card-surface p-5 space-y-2">
          <h3 className="font-semibold flex items-center gap-2"><Star className="size-4 text-amber-500" /> Client satisfaction (CSAT)</h3>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setCsat(n)} className="p-0.5" aria-label={`${n} star`}>
                <Star className={`size-6 ${n <= csat ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
              </button>
            ))}
            {csat > 0 && <span className="text-sm text-muted-foreground ml-2">{csat}/5</span>}
          </div>
          <input value={csatComment} onChange={(e) => setCsatComment(e.target.value)} placeholder="Optional client comment" className="input-base" />
          <p className="text-[11px] text-muted-foreground">Saved with the ticket — feeds the firm-wide CSAT average.</p>
        </div>
      )}

      {/* Add timeline note */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold flex items-center gap-2"><MessageSquare className="size-4 text-brand-cyan" /> Add note</h3>
        <div className="flex items-center gap-2">
          <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Log a call, an update, a customer reply…" className="input-base flex-1" />
          <button
            onClick={() => { if (newNote.trim()) patch({ timelineNote: newNote.trim() }, "Note added.").then(() => setNewNote("")); }}
            disabled={busy || !newNote.trim()}
            className="btn-ghost text-xs"
          >
            <Plus className="size-3.5" /> Add
          </button>
        </div>
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="card-surface p-5 space-y-2">
          <h3 className="font-semibold">Attachments ({attachments.length})</h3>
          <ul className="text-sm space-y-1">
            {attachments.map((a, i) => <li key={i} className="text-muted-foreground">📎 {a.name}{a.size ? ` · ${Math.round(a.size / 1024)} KB` : ""}</li>)}
          </ul>
        </div>
      )}

      {/* Activity timeline */}
      <div className="card-surface p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Clock className="size-4 text-brand-cyan" /> Activity ({timeline.length})</h3>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="space-y-3">
            {timeline.map((t, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <div className="mt-1 size-2 rounded-full bg-brand-cyan shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{EVENT_LABEL[t.event] ?? t.event}</span>
                    <span className="text-[11px] text-muted-foreground">{userMap[t.by] ?? "system"} · {formatRelative(t.at)}</span>
                  </div>
                  {t.note && <div className="text-muted-foreground text-[13px]">{t.note}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SlaCard({ label, due, done }: { label: string; due: string | null; done: string | null }) {
  if (!due) {
    return (
      <div className="card-surface p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium mt-1 text-muted-foreground">No SLA</div>
      </div>
    );
  }
  const dueAt = new Date(due);
  if (done) {
    const met = new Date(done) <= dueAt;
    return (
      <div className={`card-surface p-4 border ${met ? "border-emerald-200" : "border-rose-200"}`}>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-sm font-semibold mt-1 ${met ? "text-emerald-600" : "text-rose-600"}`}>
          {met ? "Met" : "Missed"} · {formatRelative(done)}
        </div>
      </div>
    );
  }
  const overdue = dueAt < new Date();
  const soon = !overdue && dueAt.getTime() - Date.now() < 24 * 3600 * 1000;
  return (
    <div className={`card-surface p-4 border ${overdue ? "border-rose-200 bg-rose-50/40" : soon ? "border-amber-200 bg-amber-50/40" : "border-border"}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {(overdue || soon) && <AlertTriangle className="size-3" />} {label}
      </div>
      <div className={`text-sm font-semibold mt-1 ${overdue ? "text-rose-600" : soon ? "text-amber-600" : "text-foreground"}`}>
        {overdue ? "Breached" : "Due"} {formatRelative(due)}
      </div>
    </div>
  );
}
