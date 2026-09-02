"use client";

/**
 * MeetingsBulkTable — the review-meetings "Upcoming" and "Past" lists rendered
 * through the generic BulkTable so rows can be selected and bulk-acted (set
 * status / reassign RM). Per-row cancel is a dedicated icon; the "Upcoming"
 * block is collapsed by default and only appears when there ARE upcoming
 * meetings. The filter/search/columns/view toolbar is injected into the Past
 * table header.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown, CalendarX } from "lucide-react";
import { formatDate, formatRelative } from "@/lib/utils";
import { REVIEW_MEETING_STATUSES } from "@/db/schema/review_meetings";
import { BulkTable, type BulkColumn, type BulkAction } from "@/components/common/BulkTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

const TYPE_LABEL: Record<string, string> = {
  portfolio_review: "Portfolio Review", goal_review: "Goal Review", new_investment_discussion: "New Investment",
  service_discussion: "Service Discussion", family_review: "Family Review", complaint_discussion: "Complaint Discussion",
  discovery_call: "Discovery Call", new_client_kickoff: "Client Kickoff", product_demo: "Product Demo",
  sales_pitch: "Sales Pitch", follow_up_call: "Follow-up Call", follow_up_visit: "Follow-up Visit", other: "Other",
};
const CATEGORY_LABEL: Record<string, string> = { review: "Review", new: "New", follow_up: "Follow-up" };
const CATEGORY_TONE: Record<string, string> = {
  review: "bg-brand-cyan-light text-brand-cyan-deep", new: "bg-violet-50 text-violet-700", follow_up: "bg-amber-50 text-amber-700",
};
const MODE_LABEL: Record<string, string> = { office: "Office", client_place: "Client Place", online: "Online", phone: "Phone" };
const MODE_TONE: Record<string, string> = {
  office: "bg-blue-50 text-blue-700", client_place: "bg-purple-50 text-purple-700", online: "bg-cyan-50 text-cyan-700", phone: "bg-amber-50 text-amber-700",
};
const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700", confirmed: "bg-cyan-50 text-cyan-700", in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700", rescheduled: "bg-slate-50 text-slate-700", cancelled: "bg-gray-50 text-gray-700", no_show: "bg-rose-50 text-rose-700",
};

type Row = Record<string, any> & { id: string };

const RELATION: Record<"lead" | "investor", { label: string; cls: string }> = {
  lead: { label: "Lead", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  investor: { label: "Client", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

// Client column — name + relation badge (no avatar).
const clientCell = (m: Row) => {
  const isLead = m.party_kind === "lead";
  const pk = m.party_kind as "lead" | "investor" | null | undefined;
  const rel = pk === "lead" || pk === "investor" ? RELATION[pk] : null;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {m.party_name ? (
          <Link href={isLead ? `/dashboard/leads/${m.lead_id}` : `/dashboard/investors/${m.investor_id}`} className="hover:underline font-medium truncate">
            {m.party_name}
          </Link>
        ) : null}
        {rel ? (
          <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${rel.cls}`}>{rel.label}</span>
        ) : (
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-slate-50 text-slate-500 border-slate-200">Unlinked</span>
        )}
      </div>
      {m.party_kind === "investor" && m.segment_tag ? (
        <div className="text-[11px] text-muted-foreground truncate">{m.segment_tag}</div>
      ) : null}
    </div>
  );
};

const CANCELLABLE = new Set(["scheduled", "confirmed", "in_progress", "rescheduled"]);

/** Per-row cancel — marks a single meeting cancelled via the bulk endpoint. */
function CancelMeetingButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (disabled) return <span className="inline-block w-7" aria-hidden />;
  async function doCancel() {
    setBusy(true);
    try {
      const res = await fetch("/api/review-meetings/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [id], action: "status", value: "cancelled" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Meeting cancelled");
      setConfirm(false);
      router.refresh();
    } catch {
      toast.error("Couldn't cancel the meeting");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setConfirm(true); }}
        className="rounded-md p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
        title="Cancel meeting"
        aria-label="Cancel meeting"
        data-no-row-nav
      >
        <CalendarX className="size-4" />
      </button>
      <ConfirmDialog
        open={confirm}
        title="Cancel this meeting?"
        message="The meeting will be marked cancelled."
        confirmLabel="Cancel meeting"
        cancelLabel="Keep"
        tone="danger"
        busy={busy}
        onConfirm={doCancel}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}

function actionsFor(rmOptions: { value: string; label: string }[]): BulkAction[] {
  return [
    { kind: "status", label: "Set status", options: REVIEW_MEETING_STATUSES.map((s) => [s, s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())] as [string, string]) },
    ...(rmOptions.length ? [{ kind: "assign", label: "Reassign RM", options: rmOptions } as BulkAction] : []),
  ];
}

const cancelColumn: BulkColumn<Row> = {
  key: "cancel", header: "", thClass: "text-right py-2 w-10", tdClass: "py-2.5 pr-3 text-right",
  render: (m) => <CancelMeetingButton id={m.id} disabled={!CANCELLABLE.has(m.status)} />,
};

export function MeetingsBulkTable({
  upcoming,
  past,
  rmOptions,
  toolbar,
}: {
  upcoming: Row[];
  past: Row[];
  rmOptions: { value: string; label: string }[];
  /** Search + filter + columns + view controls, rendered in the Past table header. */
  toolbar?: ReactNode;
}) {
  const actions = actionsFor(rmOptions);
  const [upcomingOpen, setUpcomingOpen] = useState(false); // collapsed by default

  const upcomingCols: BulkColumn<Row>[] = [
    {
      key: "date", header: "Date", tdClass: "px-4 py-3 whitespace-nowrap",
      render: (m) => (
        <>
          <Link href={`/dashboard/review-meetings/${m.id}`} className="font-medium tabular-nums hover:underline">
            {new Date(m.meeting_date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </Link>
          <div className="text-[11px] text-muted-foreground">
            in {Math.ceil((new Date(m.meeting_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000))} day(s)
          </div>
        </>
      ),
    },
    { key: "client", header: "Client", tdClass: "py-3", render: clientCell },
    {
      key: "category", header: "Category", tdClass: "py-3",
      render: (m) => (
        <>
          <span className={`chip text-[10px] ${CATEGORY_TONE[m.category ?? "review"] ?? ""}`}>{CATEGORY_LABEL[m.category ?? "review"] ?? m.category}</span>
          {m.parent_meeting_id && <div className="text-[10px] text-muted-foreground mt-0.5">↳ follow-up</div>}
        </>
      ),
    },
    {
      key: "agenda", header: "Agenda", tdClass: "py-3 text-xs",
      render: (m) =>
        m.subject ? (
          <>
            <div className="font-medium max-w-[220px] truncate">{m.subject}</div>
            <div className="text-[11px] text-muted-foreground">{TYPE_LABEL[m.meeting_type] ?? m.meeting_type}</div>
          </>
        ) : (
          TYPE_LABEL[m.meeting_type] ?? m.meeting_type
        ),
    },
    { key: "mode", header: "Mode", tdClass: "py-3", render: (m) => <span className={`chip ${MODE_TONE[m.meeting_mode] ?? ""}`}>{MODE_LABEL[m.meeting_mode] ?? m.meeting_mode}</span> },
    { key: "rm", header: "RM", tdClass: "py-3 text-xs", render: (m) => m.rm_name ?? "" },
    { key: "status", header: "Status", thClass: "text-left py-2 font-medium", tdClass: "py-3", render: (m) => <span className={`chip capitalize ${STATUS_TONE[m.status] ?? ""}`}>{String(m.status).replace(/_/g, " ")}</span> },
    cancelColumn,
  ];

  const pastCols: BulkColumn<Row>[] = [
    {
      key: "date", header: "Date", tdClass: "px-4 py-3 text-xs tabular-nums whitespace-nowrap",
      render: (m) => (
        <>
          <Link href={`/dashboard/review-meetings/${m.id}`} className="font-medium hover:underline">{formatDate(m.meeting_date)}</Link>
          <div className="text-[11px] text-muted-foreground">{formatRelative(m.meeting_date)}</div>
        </>
      ),
    },
    { key: "client", header: "Client", tdClass: "py-3", render: clientCell },
    {
      key: "type", header: "Type", tdClass: "py-3 text-xs",
      render: (m) =>
        m.subject ? (
          <>
            <div className="font-medium max-w-[220px] truncate">{m.subject}</div>
            <div className="text-[11px] text-muted-foreground">{TYPE_LABEL[m.meeting_type] ?? m.meeting_type}</div>
          </>
        ) : (
          TYPE_LABEL[m.meeting_type] ?? m.meeting_type
        ),
    },
    { key: "status", header: "Status", tdClass: "py-3", render: (m) => <span className={`chip capitalize ${STATUS_TONE[m.status] ?? ""}`}>{String(m.status).replace(/_/g, " ")}</span> },
    {
      key: "actions", header: "Action items", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums",
      render: (m) => (m.action_count > 0 ? <span className={m.follow_up_task_created === "true" ? "text-emerald-600" : "text-amber-600"}>{m.action_count}</span> : ""),
    },
    { key: "attach", header: "Attachments", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums text-muted-foreground", render: (m) => (m.attach_count > 0 ? m.attach_count : "") },
    {
      key: "notes", header: "Notes", thClass: "text-left py-2 font-medium", tdClass: "py-3 text-xs text-muted-foreground max-w-[260px] truncate",
      render: (m) =>
        m.meeting_notes
          ? m.meeting_notes
          : m.status === "completed"
            ? <Link href={`/dashboard/review-meetings/${m.id}`} className="italic text-amber-600 hover:underline">Add outcome →</Link>
            : <span className="italic">No notes yet</span>,
    },
    cancelColumn,
  ];

  return (
    <div className="space-y-6">
      {/* Upcoming — only shown when there ARE upcoming meetings; collapsed by default. */}
      {upcoming.length > 0 && (
        <div className="card-surface overflow-hidden">
          <button
            type="button"
            onClick={() => setUpcomingOpen((o) => !o)}
            aria-expanded={upcomingOpen}
            className={`w-full px-4 py-2.5 font-semibold flex items-center justify-between hover:bg-secondary/30 transition-colors ${upcomingOpen ? "border-b border-border" : ""}`}
          >
            <span className="flex items-center gap-2">
              <Calendar className="size-4 text-brand-cyan" /> Upcoming meetings
              <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-[10px]">{upcoming.length}</span>
            </span>
            <ChevronDown className={`size-4 text-muted-foreground transition-transform duration-300 ${upcomingOpen ? "" : "-rotate-90"}`} />
          </button>
          <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${upcomingOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden">
              <BulkTable rows={upcoming} columns={upcomingCols} endpoint="/api/review-meetings/bulk" actions={actions} itemLabel="meeting" />
            </div>
          </div>
        </div>
      )}

      {/* Past — the toolbar (search + filters + columns + view) lives in its header. */}
      <div className="card-surface">
        <div className="border-b border-border px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <span className="font-semibold whitespace-nowrap">Past meetings ({past.length})</span>
          {toolbar && <div className="flex-1 min-w-[260px] flex justify-end">{toolbar}</div>}
        </div>
        {past.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Calendar className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No past meetings match.</div>
          </div>
        ) : (
          <BulkTable rows={past.slice(0, 50)} columns={pastCols} endpoint="/api/review-meetings/bulk" actions={actions} itemLabel="meeting" scrollBody />
        )}
      </div>
    </div>
  );
}
