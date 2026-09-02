"use client";

/**
 * Client island for the communications list — renders rows with multi-select +
 * a bulk action bar (cancel scheduled / retry failed / flag / unflag). The
 * server page owns filtering + paging; this owns selection + the mutations.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  MessageCircle, Mail, MessageSquare, Phone, Bell,
  Check, CheckCheck, AlertCircle, Clock, Star, XCircle, RotateCw, Loader2,
} from "lucide-react";

export type CommRow = {
  id: string;
  channel: string;
  direction: string;
  status: string;
  recipient: string;
  subject: string;
  preview: string;
  createdAt: string;
  scheduledAt: string | null;
  templateKey: string | null;
  workflowRunId: string | null;
  flagged: boolean;
};

const channelIcons: Record<string, any> = {
  whatsapp: MessageCircle, email: Mail, sms: MessageSquare, call: Phone, inapp: Bell,
};
const statusTone: Record<string, string> = {
  scheduled: "bg-violet-50 text-violet-700",
  queued: "bg-amber-50 text-amber-700",
  sent: "bg-blue-50 text-blue-700",
  delivered: "bg-emerald-50 text-emerald-700",
  read: "bg-emerald-50 text-emerald-700",
  replied: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  bounced: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-600",
};
const statusIcons: Record<string, any> = {
  scheduled: Clock, queued: AlertCircle, sent: Check, delivered: Check,
  read: CheckCheck, replied: CheckCheck, failed: AlertCircle, cancelled: XCircle,
};

function rel(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60000);
  if (Math.abs(m) < 60) return m <= 0 ? "soon" : `${m}m ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return `${h}h ago`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function CommsList({ rows }: { rows: CommRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const selRows = rows.filter((r) => sel.has(r.id));
  const canCancel = selRows.some((r) => r.status === "scheduled");
  const canRetry = selRows.some((r) => r.status === "failed");

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function act(action: "cancel" | "retry" | "flag" | "unflag", ids: string[]) {
    if (!ids.length) return;
    setBusy(action);
    try {
      const res = await fetch("/api/communications/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      if (res.ok) {
        setSel(new Set());
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="mx-auto size-12 rounded-full bg-secondary flex items-center justify-center mb-3">
          <MessageSquare className="size-6 text-muted-foreground" />
        </div>
        <div className="text-sm font-semibold text-foreground">No messages yet</div>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
          Send your first WhatsApp or email — every message from Compose, workflows
          and campaigns lands here with its delivery status.
        </p>
        <div className="mt-4">
          <Link href="/dashboard/communications/compose" className="btn-primary text-sm inline-flex">
            Compose a message
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {sel.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-accent/60 px-4 py-2 text-xs backdrop-blur">
          <span className="font-medium">{sel.size} selected</span>
          <button
            disabled={!canCancel || busy !== null}
            onClick={() => act("cancel", selRows.filter((r) => r.status === "scheduled").map((r) => r.id))}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 font-medium hover:bg-accent disabled:opacity-40"
          >
            {busy === "cancel" ? <Loader2 className="size-3 animate-spin" /> : <XCircle className="size-3" />} Cancel scheduled
          </button>
          <button
            disabled={!canRetry || busy !== null}
            onClick={() => act("retry", selRows.filter((r) => r.status === "failed").map((r) => r.id))}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 font-medium hover:bg-accent disabled:opacity-40"
          >
            {busy === "retry" ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />} Retry failed
          </button>
          <button
            disabled={busy !== null}
            onClick={() => act("flag", [...sel])}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 font-medium hover:bg-accent disabled:opacity-40"
          >
            <Star className="size-3" /> Flag
          </button>
          <button
            disabled={busy !== null}
            onClick={() => act("unflag", [...sel])}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 font-medium hover:bg-accent disabled:opacity-40"
          >
            <Star className="size-3" /> Unflag
          </button>
          <button onClick={() => setSel(new Set())} className="ml-auto text-muted-foreground hover:text-foreground">
            Clear
          </button>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th className="w-9 px-3 py-2">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            </th>
            <th className="w-8 py-2"></th>
            <th className="text-left py-2 font-medium">Recipient</th>
            <th className="text-left py-2 font-medium">Subject</th>
            <th className="text-left py-2 font-medium">Status</th>
            <th className="text-left py-2 font-medium pr-4">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const Ch = channelIcons[r.channel] ?? MessageSquare;
            const St = statusIcons[r.status] ?? AlertCircle;
            const when = r.status === "scheduled" && r.scheduledAt ? `→ ${rel(r.scheduledAt)}` : rel(r.createdAt);
            return (
              <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-3 py-2.5 align-top">
                  <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label="Select row" />
                </td>
                <td className="py-2.5 align-top">
                  <button
                    onClick={() => act(r.flagged ? "unflag" : "flag", [r.id])}
                    aria-label={r.flagged ? "Unflag" : "Flag"}
                    className="text-muted-foreground hover:text-amber-500"
                  >
                    <Star className={`size-3.5 ${r.flagged ? "fill-amber-400 text-amber-400" : ""}`} />
                  </button>
                </td>
                <td className="py-2.5 align-top">
                  <div className="flex items-center gap-1.5">
                    <Ch className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate max-w-[180px]">{r.recipient}</span>
                    {r.direction === "inbound" && (
                      <span className="text-[10px] bg-blue-50 text-blue-700 px-1 rounded">in</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 align-top max-w-[320px]">
                  <div className="truncate">{r.subject || <span className="text-muted-foreground">—</span>}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.preview || (r.templateKey ?? "")}</div>
                </td>
                <td className="py-2.5 align-top">
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${statusTone[r.status] ?? "bg-muted text-muted-foreground"}`}>
                    <St className="size-3" /> {r.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="py-2.5 align-top pr-4 text-xs text-muted-foreground whitespace-nowrap">
                  {when}
                  {r.workflowRunId && (
                    <Link href={`/dashboard/workflows/runs/${r.workflowRunId}`} className="ml-1.5 hover:underline">
                      via wf
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
