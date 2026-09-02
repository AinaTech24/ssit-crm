"use client";

/**
 * TaskComments — the real, threaded comment log for a task (replaces the old
 * single prepend-only remarks blob as the interactive surface). Author +
 * timestamp per entry, @mention autocomplete over the firm's team (each
 * mentioned teammate gets a notification), and delete-your-own.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Trash, AtSign } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Employee = { id: string; name: string; email: string; roles: string[]; department: string | null };
type Comment = {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  mentions: string[];
  createdAt: string;
};

function initials(name?: string | null): string {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
/** Render a comment body, lightly highlighting @mention tokens. */
function renderBody(body: string) {
  const parts = body.split(/(@[\p{L}][\p{L}.'-]*(?:\s[\p{L}][\p{L}.'-]*)?)/gu);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="font-semibold text-brand-cyan-deep">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export function TaskComments({ taskId, currentUserId }: { taskId: string; currentUserId: string }) {
  const toast = useToast();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [team, setTeam] = useState<Employee[]>([]);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Employee[]>([]); // mentioned teammates
  const [sending, setSending] = useState(false);
  const [mentionQ, setMentionQ] = useState<{ start: number; q: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tasks/${taskId}/comments`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setComments(Array.isArray(j.comments) ? j.comments : []); })
      .catch(() => { if (!cancelled) setComments([]); });
    fetch(`/api/employees`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setTeam((j.rows ?? []) as Employee[]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [taskId]);

  // Detect an active "@token" ending at the caret so we can offer the picker.
  function onType(value: string) {
    setText(value);
    const caret = taRef.current?.selectionStart ?? value.length;
    let i = caret - 1;
    while (i >= 0 && !/\s/.test(value[i]) && value[i] !== "@") i--;
    if (i >= 0 && value[i] === "@") setMentionQ({ start: i, q: value.slice(i + 1, caret) });
    else setMentionQ(null);
  }

  function pickMention(emp: Employee) {
    if (!mentionQ) return;
    const caret = taRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, mentionQ.start);
    const after = text.slice(caret);
    const next = `${before}@${emp.name} ${after}`;
    setText(next);
    setPicked((p) => (p.some((x) => x.id === emp.id) ? p : [...p, emp]));
    setMentionQ(null);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  const matches = mentionQ
    ? team.filter((e) => e.name.toLowerCase().includes(mentionQ.q.toLowerCase())).slice(0, 6)
    : [];

  async function submit() {
    const body = text.trim();
    if (!body || sending) return;
    // Only keep mentions whose "@Name" survived in the final text.
    const mentions = Array.from(
      new Set(picked.filter((e) => body.includes(`@${e.name}`)).map((e) => e.id))
    );
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, mentions }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Failed to add comment");
      setComments((c) => [...(c ?? []), j.comment]);
      setText("");
      setPicked([]);
      if (mentions.length) toast.success(`Comment added · ${mentions.length} teammate${mentions.length > 1 ? "s" : ""} notified`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add comment", "Comment failed");
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    const prev = comments;
    setComments((c) => (c ?? []).filter((x) => x.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setComments(prev ?? []);
      toast.error("Couldn't delete comment");
    }
  }

  return (
    <div className="space-y-3">
      {/* Composer */}
      <div className="relative">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (mentionQ && matches.length && e.key === "Enter") { e.preventDefault(); pickMention(matches[0]); }
            else if (mentionQ && e.key === "Escape") setMentionQ(null);
            else if (!mentionQ && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          }}
          placeholder="Write a comment…  Type @ to mention a teammate."
          rows={2}
          className="input-base text-xs bg-slate-50 border-slate-200 focus:bg-white transition-colors w-full pr-9"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || sending}
          className="absolute right-2 bottom-2 p-1.5 rounded-md bg-brand-cyan text-white disabled:opacity-40 hover:brightness-110"
          aria-label="Post comment"
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        </button>

        {/* @mention picker */}
        {mentionQ && matches.length > 0 && (
          <ul className="absolute left-0 right-0 top-full mt-1 z-50 max-h-52 overflow-y-auto scrollbar-thin card-elevated bg-card p-1 animate-scale-in">
            {matches.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => pickMention(e)}
                  className="w-full text-left rounded-md px-2 py-1.5 hover:bg-secondary flex items-center gap-2"
                >
                  <span className="size-6 rounded-full bg-brand-cyan-light/60 text-brand-cyan-deep text-[10px] font-bold flex items-center justify-center shrink-0">
                    {initials(e.name)}
                  </span>
                  <span className="text-xs font-medium truncate">{e.name}</span>
                  {e.department && <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{e.department}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <AtSign className="size-3 text-muted-foreground" />
          {picked.map((e) => (
            <span key={e.id} className="chip text-[10px] bg-brand-cyan-light/50 text-brand-cyan-deep border border-brand-cyan/20">
              {e.name}
            </span>
          ))}
        </div>
      )}

      {/* Thread */}
      {comments == null ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-2">
          <Loader2 className="size-3.5 animate-spin" /> Loading comments…
        </div>
      ) : comments.length === 0 ? (
        <div className="text-[11px] text-muted-foreground text-center py-2">No comments yet.</div>
      ) : (
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
          {comments.map((c) => (
            <div key={c.id} className="group flex gap-2.5 items-start">
              <div className="size-6 rounded-full bg-slate-100 border text-[10px] font-bold text-slate-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                {initials(c.authorName)}
              </div>
              <div className="flex-1 min-w-0 bg-slate-50 border border-slate-100 rounded-lg p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-slate-700 truncate">{c.authorName ?? "Someone"}</span>
                  <span className="text-[10px] text-slate-400">{whenLabel(c.createdAt)}</span>
                  {c.authorId === currentUserId && (
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      className="ml-auto text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Delete comment"
                    >
                      <Trash className="size-3" />
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed break-words">
                  {renderBody(c.body)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
