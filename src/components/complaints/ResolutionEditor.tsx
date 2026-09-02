"use client";

/**
 * Inline resolution editor for the complaint register row.
 *
 * Opens a small popover with:
 *   - Resolution notes textarea
 *   - "Mark resolved" button (sets status='resolved' + resolvedAt=now)
 *   - "Save notes only" button (just patches resolutionNotes)
 *
 * PATCHes /api/service-requests/[id].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Check, Loader2 } from "lucide-react";

export function ResolutionEditor({
  ticketId,
  initialNotes,
  isResolved,
}: {
  ticketId: string;
  initialNotes: string | null;
  isResolved: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(markResolved: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const body: any = { resolutionNotes: notes };
      if (markResolved) body.status = "resolved";
      const res = await fetch(`/api/service-requests/${ticketId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 max-w-[200px] truncate text-left"
        title="Click to edit resolution"
      >
        {initialNotes ? (
          <span className="truncate">{initialNotes}</span>
        ) : (
          <span className="italic">{isResolved ? "No notes" : "Add resolution"}</span>
        )}
        <Pencil className="size-3 flex-shrink-0 opacity-60" />
      </button>
    );
  }

  return (
    <div className="absolute right-2 z-20 mt-1 rounded-lg border border-border bg-popover shadow-xl p-3 w-80 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Resolution notes</span>
        <button
          onClick={() => setOpen(false)}
          className="p-0.5 hover:bg-secondary rounded text-muted-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder="Steps taken to resolve, root cause, communication sent to client…"
        className="input-base text-xs"
      />
      {err && (
        <div className="text-xs text-destructive">{err}</div>
      )}
      <div className="flex justify-end gap-2 pt-1 border-t border-border">
        <button
          onClick={() => save(false)}
          disabled={busy}
          className="btn-secondary text-xs"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null} Save notes
        </button>
        {!isResolved && (
          <button
            onClick={() => save(true)}
            disabled={busy || !notes.trim()}
            className="btn-primary text-xs"
          >
            <Check className="size-3" /> Mark resolved
          </button>
        )}
      </div>
    </div>
  );
}
