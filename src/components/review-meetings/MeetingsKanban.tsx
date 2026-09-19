"use client";

/**
 * Status-wise Kanban board for the Meetings module. One column per meeting
 * status; cards show the client, time and agenda. Drag a card to another column
 * to change its status (PATCH /api/review-meetings/[id] { status }) — the same
 * endpoint the detail page uses, so the completion/no-show automations still
 * fire. Clicking a card opens the meeting.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";

type Row = {
  id: string;
  investor_id: string | null;
  lead_id: string | null;
  meeting_type: string;
  subject: string | null;
  meeting_date: string;
  meeting_mode: string;
  status: string;
  party_name: string | null;
  party_avatar_url: string | null;
  party_kind: "investor" | "lead" | null;
  rm_name: string | null;
  /** Names of the users this meeting was assigned to (collaborators). */
  assigned_to?: string | null;
};

const COLUMNS: { key: string; label: string; tone: string }[] = [
  { key: "scheduled", label: "Scheduled", tone: "border-t-blue-400" },
  { key: "confirmed", label: "Confirmed", tone: "border-t-cyan-400" },
  { key: "in_progress", label: "In progress", tone: "border-t-amber-400" },
  { key: "completed", label: "Completed", tone: "border-t-emerald-400" },
  { key: "rescheduled", label: "Rescheduled", tone: "border-t-slate-400" },
  { key: "cancelled", label: "Cancelled", tone: "border-t-gray-400" },
  { key: "no_show", label: "No show", tone: "border-t-rose-400" },
];

const TYPE_LABEL: Record<string, string> = {
  portfolio_review: "Portfolio Review",
  goal_review: "Goal Review",
  new_investment_discussion: "New Investment",
  service_discussion: "Service Discussion",
  family_review: "Family Review",
  complaint_discussion: "Complaint Discussion",
  discovery_call: "Discovery Call",
  new_client_kickoff: "Client Kickoff",
  product_demo: "Product Demo",
  sales_pitch: "Sales Pitch",
  follow_up_call: "Follow-up Call",
  follow_up_visit: "Follow-up Visit",
  other: "Other",
};

const MODE_LABEL: Record<string, string> = {
  office: "Office",
  client_place: "Client Place",
  online: "Online",
  phone: "Phone",
};

export function MeetingsKanban({ meetings }: { meetings: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(meetings);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function move(id: string, to: string) {
    const m = rows.find((r) => r.id === id);
    if (!m || m.status === to) return;
    const prev = m.status;
    // Optimistic update.
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: to } : r)));
    setSaving(id);
    try {
      const res = await fetch(`/api/review-meetings/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: prev } : r))); // rollback
        toast.error(j.error ?? `Couldn't move meeting (${res.status})`, "Status");
        return;
      }
      toast.success(`Moved to ${COLUMNS.find((c) => c.key === to)?.label ?? to}`);
      router.refresh();
    } catch (e: any) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: prev } : r)));
      toast.error(e?.message ?? "Network error", "Status");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {COLUMNS.map((col) => {
        const items = rows.filter((r) => r.status === col.key);
        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              if (dragId) void move(dragId, col.key);
              setDragId(null);
            }}
            className={`w-72 shrink-0 rounded-xl border-t-2 ${col.tone} bg-secondary/30 p-2 transition-colors ${
              overCol === col.key ? "ring-2 ring-brand-cyan/40 bg-secondary/60" : ""
            }`}
          >
            <div className="flex items-center justify-between px-1.5 py-1.5">
              <span className="text-xs font-semibold">{col.label}</span>
              <span className="chip bg-card text-[10px] text-muted-foreground">{items.length}</span>
            </div>
            <div className="space-y-2 min-h-[60px]">
              {items.map((m) => (
                <div
                  key={m.id}
                  draggable
                  onDragStart={() => setDragId(m.id)}
                  onDragEnd={() => setDragId(null)}
                  className={`group rounded-lg border border-border bg-card p-2.5 shadow-sm cursor-grab active:cursor-grabbing hover:border-brand-cyan/50 transition-colors ${
                    saving === m.id ? "opacity-60" : ""
                  }`}
                >
                  <Link href={`/dashboard/review-meetings/${m.id}`} className="block">
                    <div className="flex items-center gap-2">
                      <Avatar
                        src={
                          m.party_avatar_url
                            ? `/api/${m.party_kind === "lead" ? "leads" : "investors"}/${
                                m.party_kind === "lead" ? m.lead_id : m.investor_id
                              }/avatar`
                            : null
                        }
                        name={m.party_name}
                        size={22}
                      />
                      <div className="text-sm font-medium truncate">{m.party_name ?? "—"}</div>
                      <span
                        className={`shrink-0 ml-auto text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                          m.party_kind === "lead"
                            ? "bg-violet-50 text-violet-700 border-violet-200"
                            : m.party_kind === "investor"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-50 text-slate-500 border-slate-200"
                        }`}
                      >
                        {m.party_kind === "lead" ? "Lead" : m.party_kind === "investor" ? "Client" : "Unlinked"}
                      </span>
                    </div>
                    <div className="mt-1.5 text-xs text-muted-foreground truncate">
                      {m.subject || TYPE_LABEL[m.meeting_type] || m.meeting_type}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="tabular-nums">
                        {new Date(m.meeting_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        {" · "}
                        {new Date(m.meeting_date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="chip bg-secondary text-[10px]">{MODE_LABEL[m.meeting_mode] ?? m.meeting_mode}</span>
                    </div>
                    {m.rm_name && <div className="mt-1 text-[10px] text-muted-foreground truncate">RM: {m.rm_name}{m.assigned_to ? ` → ${m.assigned_to}` : ""}</div>}
                  </Link>
                </div>
              ))}
              {items.length === 0 && (
                <div className="rounded-lg border border-dashed border-border/60 py-6 text-center text-[11px] text-muted-foreground">
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
