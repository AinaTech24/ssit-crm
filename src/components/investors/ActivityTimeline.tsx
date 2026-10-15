"use client";

import { useMemo, useState } from "react";
import {
  MessageSquare,
  Mail,
  Send,
  CheckCircle2,
  Calendar,
  Ticket,
  Clock,
  AlertCircle,
  FileText,
} from "lucide-react";
import { formatRelative } from "@/lib/utils";

type ActivityItem = {
  id: string;
  type: "communication" | "task" | "service_request" | "meeting";
  timestamp: Date;
  title: string;
  description: string;
  status: string;
  badgeTone: "success" | "warning" | "info" | "danger" | "neutral";
  channel?: string;
  meta?: string;
};

/** Long notes collapse to a few lines with a toggle, so a timeline of many
 *  entries stays scannable and the full text is one click away. */
function ExpandableText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220 || text.split(String.fromCharCode(10)).length > 4;
  return (
    <div className="mt-2">
      <p className={`text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed ${!open && long ? "line-clamp-3" : ""}`}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-[11px] font-semibold text-brand-cyan hover:underline"
        >
          {open ? "Show less" : "Show full note"}
        </button>
      )}
    </div>
  );
}

export function ActivityTimeline({
  communications = [],
  tasks = [],
  serviceRequests = [],
  reviewMeetings = [],
}: {
  communications?: any[];
  tasks?: any[];
  serviceRequests?: any[];
  reviewMeetings?: any[];
}) {
  const mergedItems = useMemo(() => {
    const items: ActivityItem[] = [];

    // 1. Process communications
    communications.forEach((c) => {
      const isOutbound = c.direction === "outbound";
      let tone: ActivityItem["badgeTone"] = "info";
      if (c.status === "failed") tone = "danger";
      else if (c.status === "skipped" || c.status === "skipped_consent") tone = "warning";
      else if (c.status === "sent" || c.status === "delivered") tone = "success";

      items.push({
        id: c.id,
        type: "communication",
        timestamp: new Date(c.createdAt),
        title: `${isOutbound ? "Outbound" : "Inbound"} ${c.channel}`,
        description: c.templateKey ? `Template: ${c.key ?? c.templateKey}` : c.payload?.rendered?.text || "No preview content available.",
        status: c.status,
        badgeTone: tone,
        channel: c.channel,
        meta: c.statusReason ? `Reason: ${c.statusReason}` : undefined,
      });
    });

    // 2. Process tasks
    tasks.forEach((t) => {
      const isCompleted = t.status === "completed";
      const isOverdue = !isCompleted && t.dueAt && new Date(t.dueAt).getTime() < Date.now();
      
      items.push({
        id: t.id,
        type: "task",
        timestamp: new Date(t.updatedAt || t.createdAt),
        title: `Task: ${t.title}`,
        description: t.description || "No task notes captured.",
        status: isCompleted ? "Completed" : isOverdue ? "Overdue" : "Open",
        badgeTone: isCompleted ? "success" : isOverdue ? "danger" : "warning",
        meta: t.dueAt ? `Due: ${new Date(t.dueAt).toLocaleDateString()}` : "No due date",
      });
    });

    // 3. Process service requests
    serviceRequests.forEach((sr) => {
      let tone: ActivityItem["badgeTone"] = "info";
      if (sr.status === "open") tone = "warning";
      else if (sr.status === "in_progress") tone = "info";
      else if (sr.status === "resolved" || sr.status === "closed") tone = "success";

      items.push({
        id: sr.id,
        type: "service_request",
        timestamp: new Date(sr.createdAt),
        title: `Ticket #${sr.ticketNo}: ${sr.subject}`,
        description: sr.description || "No ticket description.",
        status: sr.status,
        badgeTone: tone,
        meta: `Category: ${sr.category || "General"}`,
      });
    });

    // 4. Process review meetings
    reviewMeetings.forEach((rm) => {
      items.push({
        id: rm.id,
        type: "meeting",
        timestamp: new Date(rm.meetingDate),
        title: `Meeting: ${rm.meetingType?.replace(/_/g, " ") || "Review"}`,
        // Agenda AND the notes written up afterwards — the notes were never shown.
        description:
          [rm.discussionPoints, rm.meetingNotes ? `Notes: ${rm.meetingNotes}` : ""]
            .filter(Boolean)
            .join(String.fromCharCode(10, 10)) || `Mode: ${rm.meetingMode}`,
        status: new Date(rm.meetingDate).getTime() < Date.now() ? "Completed" : "Scheduled",
        badgeTone: new Date(rm.meetingDate).getTime() < Date.now() ? "success" : "info",
        meta: `${rm.meetingMode} · ${rm.durationMinutes} mins`,
      });
    });

    // Sort items chronologically (newest first)
    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [communications, tasks, serviceRequests, reviewMeetings]);

  const toneClasses = {
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
    danger: "bg-rose-50 text-rose-700 border-rose-200",
    neutral: "bg-slate-50 text-slate-700 border-slate-200",
  };

  const getIcon = (item: ActivityItem) => {
    switch (item.type) {
      case "communication":
        if (item.channel === "whatsapp") return <MessageSquare className="size-4" />;
        if (item.channel === "email") return <Mail className="size-4" />;
        return <Send className="size-4" />;
      case "task":
        return <CheckCircle2 className="size-4" />;
      case "meeting":
        return <Calendar className="size-4" />;
      case "service_request":
        return <Ticket className="size-4" />;
      default:
        return <FileText className="size-4" />;
    }
  };

  const getIconBg = (item: ActivityItem) => {
    switch (item.type) {
      case "communication":
        return "bg-indigo-50 text-indigo-700 border-indigo-200";
      case "task":
        return item.status === "Completed"
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-amber-50 text-amber-700 border-amber-200";
      case "meeting":
        return "bg-violet-50 text-violet-700 border-violet-200";
      case "service_request":
        return "bg-sky-50 text-sky-700 border-sky-200";
    }
  };

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-indigo-50 grid place-items-center">
            <Clock className="size-3.5 text-indigo-700" />
          </div>
          Unified Activity Timeline
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {mergedItems.length} total events
        </span>
      </div>

      {mergedItems.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 italic">
          No recorded activity or communications found for this client.
        </div>
      ) : (
        <div className="relative pl-10 pr-1 space-y-5 max-h-96 overflow-y-auto scrollbar-none before:absolute before:left-[18px] before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60">
          {mergedItems.map((item) => (
            <div key={item.id} className="relative group">
              {/* Timeline dot — sits fully inside the left rail so the icon never clips */}
              <div
                className={`absolute -left-9 top-1.5 size-7 rounded-full border grid place-items-center z-10 transition-shadow ${getIconBg(
                  item
                )} group-hover:shadow-sm`}
              >
                {getIcon(item)}
              </div>

              {/* Card content */}
              <div className="bg-secondary/20 hover:bg-secondary/40 border border-border/40 rounded-lg p-3 transition-colors duration-150">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-sm text-foreground/90 block">
                      {item.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground block mt-0.5">
                      {formatRelative(item.timestamp)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {item.meta && (
                      <span className="text-[10px] bg-secondary text-muted-foreground border px-2 py-0.5 rounded font-mono">
                        {item.meta}
                      </span>
                    )}
                    <span
                      className={`chip text-[10px] font-bold border capitalize ${
                        toneClasses[item.badgeTone]
                      }`}
                    >
                      {item.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>

                <ExpandableText text={item.description} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
