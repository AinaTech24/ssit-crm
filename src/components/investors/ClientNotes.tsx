"use client";

/**
 * Notes on a client — a running log rather than one box of text.
 *
 * Each note is its own row with an author and a timestamp, so a client's
 * history reads as a sequence of what happened and who recorded it. Everyone
 * who can open the client reads all of them; you can reword or remove only
 * your own.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, StickyNote, Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";

type Note = {
  id: string;
  notes: string | null;
  occurred_at: string;
  owner_user_id: string | null;
  author_name: string | null;
  updated_at: string | null;
  created_at: string | null;
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function ClientNotes({ investorId }: { investorId: string }) {
  const toast = useToast();
  const base = `/api/investors/${investorId}/notes`;
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(base);
      if (!r.ok) {
        const f = await readApiError(r, "load notes");
        toast.error(f.message);
        setNotes([]);
        return;
      }
      const j = await r.json();
      setNotes(j.notes ?? []);
      setMe(j.userId ?? null);
    } catch (e) {
      toast.error(readThrownError(e, "load notes").message);
      setNotes([]);
    }
  }, [base, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: text }),
      });
      if (!r.ok) {
        toast.error((await readApiError(r, "add note")).message);
        return;
      }
      // Cleared only on success, so a failed save never loses what was typed.
      setDraft("");
      await load();
    } catch (e) {
      toast.error(readThrownError(e, "add note").message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: text }),
      });
      if (!r.ok) {
        toast.error((await readApiError(r, "save note")).message);
        return;
      }
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(readThrownError(e, "save note").message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this note? This cannot be undone.")) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}/${id}`, { method: "DELETE" });
      if (!r.ok) {
        toast.error((await readApiError(r, "delete note")).message);
        return;
      }
      await load();
    } catch (e) {
      toast.error(readThrownError(e, "delete note").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Composer first: the common action here is adding, not re-reading. */}
      <div className="rounded-lg border bg-card p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="What happened, what was agreed, what to pick up next time..."
          className="input-base text-sm w-full resize-y"
          onKeyDown={(e) => {
            // Enter is a newline in a note; Ctrl/Cmd+Enter saves.
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void add();
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-muted-foreground">
            Visible to everyone who can open this client · Ctrl+Enter to save
          </span>
          <button
            type="button"
            onClick={add}
            disabled={busy || !draft.trim()}
            className="btn-primary text-xs inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add note
          </button>
        </div>
      </div>

      {notes === null ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-4">
          <Loader2 className="size-4 animate-spin" /> Loading notes...
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <StickyNote className="size-8 mx-auto opacity-40" />
          <div className="mt-2 text-sm font-medium">No notes yet.</div>
          <div className="text-xs">Add the first one above.</div>
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const mine = !!me && n.owner_user_id === me;
            const edited = n.updated_at && n.created_at && n.updated_at !== n.created_at;
            return (
              <li key={n.id} className="rounded-lg border bg-card p-3">
                {editingId === n.id ? (
                  <>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      maxLength={4000}
                      className="input-base text-sm w-full resize-y"
                    />
                    <div className="flex items-center gap-2 mt-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="btn-ghost text-xs inline-flex items-center gap-1"
                      >
                        <X className="size-3.5" /> Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(n.id)}
                        disabled={busy || !editText.trim()}
                        className="btn-primary text-xs inline-flex items-center gap-1"
                      >
                        <Check className="size-3.5" /> Save
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap">{n.notes}</p>
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <div className="text-[11px] text-muted-foreground">
                        {n.author_name ?? "Unknown"} · {when(n.occurred_at)}
                        {edited ? " · edited" : ""}
                      </div>
                      {mine ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            title="Edit"
                            onClick={() => {
                              setEditingId(n.id);
                              setEditText(n.notes ?? "");
                            }}
                            className="btn-ghost p-1.5"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={() => remove(n.id)}
                            className="btn-ghost p-1.5 text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
