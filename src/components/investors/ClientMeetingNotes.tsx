"use client";

/**
 * Meeting notes on a client, in the Engagement tab.
 *
 * What was discussed and decided in each of this client's meetings, newest
 * first, beside the calls, emails and notes — instead of opening every meeting
 * to find out. Read-only here: notes are written on the meeting itself, where
 * the outcome and action items live, so each entry links straight to it.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";

type MeetingNote = {
  id: string;
  meeting_date: string;
  status: string;
  meeting_type: string | null;
  subject: string | null;
  discussion_points: string | null;
  meeting_notes: string | null;
  owner_name: string | null;
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
const pretty = (s: string | null) => (s ?? "").replace(/_/g, " ");

export function ClientMeetingNotes({ investorId }: { investorId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<MeetingNote[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investors/${investorId}/meeting-notes`);
      if (!r.ok) {
        toast.error((await readApiError(r, "load meeting notes")).message);
        setRows([]);
        return;
      }
      setRows((await r.json()).meetings ?? []);
    } catch (e) {
      toast.error(readThrownError(e, "load meeting notes").message);
      setRows([]);
    }
  }, [investorId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading meeting notes…
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground">No meeting notes recorded for this client yet.</div>;
  }
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {rows.map((m) => (
        <li key={m.id} className="p-3 text-sm space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="font-medium capitalize flex items-center gap-2">
              {m.subject || pretty(m.meeting_type) || "Meeting"}
              <span className="chip bg-secondary text-[10px] px-2 py-0.5">{pretty(m.status)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {when(m.meeting_date)}
              {m.owner_name ? ` · ${m.owner_name}` : ""}
            </div>
          </div>
          {m.discussion_points && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Discussed</div>
              <div className="whitespace-pre-wrap">{m.discussion_points}</div>
            </div>
          )}
          {m.meeting_notes && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Notes</div>
              <div className="whitespace-pre-wrap">{m.meeting_notes}</div>
            </div>
          )}
          <Link href={`/dashboard/review-meetings/${m.id}`} className="text-xs text-brand-cyan hover:underline inline-flex items-center gap-1">
            Open meeting <ExternalLink className="size-3" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
