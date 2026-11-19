"use client";

/**
 * The notes of one Dhandho session: what was shared that day. Everyone who can open
 * Dhandho reads them; whoever may write them (dhandho.notes, or the day's speaker)
 * gets an Add / Edit button. Saving can notify the whole team - on by default the
 * first time, off for later edits so a typo fix does not ring every bell again.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, NotebookPen } from "lucide-react";

export function DhandhoNotes({
  sessionId,
  initialNotes,
  canEdit,
  writtenBy,
  writtenAt,
  compact = false,
}: {
  sessionId: string;
  initialNotes: string | null;
  canEdit: boolean;
  writtenBy?: string | null;
  writtenAt?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialNotes ?? "");
  const [notify, setNotify] = useState(!initialNotes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/dhandho/${sessionId}/notes`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: text, notify }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Could not save (${r.status})`);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          className="input-base w-full min-h-[120px] text-sm"
          value={text}
          maxLength={5000}
          autoFocus
          placeholder="What was shared today - key points, learnings, things to try…"
          onChange={(e) => setText(e.target.value)}
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Notify everyone with the topic and these notes
        </label>
        {err && <div className="text-xs text-destructive">{err}</div>}
        <div className="flex gap-2">
          <button type="button" className="btn-primary text-xs" disabled={busy} onClick={save}>
            {busy && <Loader2 className="size-3.5 animate-spin" />} Save notes
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setText(initialNotes ?? "");
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? "" : "mt-3 pt-3 border-t"}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <NotebookPen className="size-3.5" /> Session notes
        </div>
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-brand-cyan hover:underline">
            {initialNotes ? "Edit notes" : "Add notes"}
          </button>
        )}
      </div>
      {initialNotes ? (
        <>
          <p className="mt-1.5 text-sm whitespace-pre-wrap">{initialNotes}</p>
          {(writtenBy || writtenAt) && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {writtenBy ? `Added by ${writtenBy}` : "Added"}
              {writtenAt ? ` · ${writtenAt}` : ""}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">No notes added for this session yet.</p>
      )}
    </div>
  );
}
