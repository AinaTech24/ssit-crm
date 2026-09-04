"use client";

/**
 * Equitywala Assistant — a modern, ChatGPT-style chat over the firm's LIVE CRM data.
 * Left: conversation history (new / rename / archive / delete). Right: the chat
 * with Markdown+table answers, per-message Copy / Share / Regenerate, and a
 * model selector (the active provider's Fast vs Reasoning tiers).
 *
 * Read-only + CRM-scoped: the server grounds every reply in a live metric
 * snapshot and the assistant cannot modify any data.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Plus, Send, Loader2, Copy, Share2, RefreshCw, Check, Pencil, Archive,
  Trash2, MoreHorizontal, MessageSquare, ArchiveRestore, PanelLeftClose, PanelLeft, Bot, BarChart3,
} from "lucide-react";
import { Select } from "@/components/ui/Select";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Markdown } from "@/components/ai/Markdown";

type ChatRow = { id: string; title: string; model: string; archivedAt: string | null; lastMessageAt: string | null; createdAt: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; model?: string | null };
type ModelOpt = { tier: "fast" | "reasoning"; name: string; label: string };

const STARTERS = [
  "What's my total AUM?",
  "Top 10 clients by AUM",
  "AUM by RM",
  "How many clients are KYC-pending?",
  "How many open tasks are overdue?",
  "How many new clients this month?",
];

// Let the status phases actually play out — the copilot walks through its work
// (thinking → fetching → analysing → generating → delivering) and only reveals
// the answer once that sequence has run, never instantly.
const MIN_PHASE_MS = 2600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const minWait = async (started: number) => {
  const left = MIN_PHASE_MS - (Date.now() - started);
  if (left > 0) await sleep(left);
};

export function AssistantChat({ insightsHref }: { insightsHref?: string }) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [model, setModel] = useState<"fast" | "reasoning">("reasoning");
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [providerLabel, setProviderLabel] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load chats + models on mount.
  useEffect(() => {
    void loadChats(false);
    fetch("/api/ai/models")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.models)) setModels(j.models);
        if (j.providerLabel) setProviderLabel(j.providerLabel);
      })
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadChats(showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function loadChats(archived: boolean) {
    try {
      const r = await fetch(`/api/ai/chats${archived ? "?archived=1" : ""}`);
      const j = await r.json();
      if (Array.isArray(j.chats)) setChats(j.chats);
    } catch { }
  }

  async function openChat(id: string) {
    setActiveId(id);
    setMessages([]);
    setLoadingMsgs(true);
    try {
      const r = await fetch(`/api/ai/chats/${id}/messages`);
      const j = await r.json();
      if (Array.isArray(j.messages)) setMessages(j.messages);
      if (j.chat?.model) setModel(j.chat.model === "fast" ? "fast" : "reasoning");
    } finally {
      setLoadingMsgs(false);
    }
  }

  async function newChat(): Promise<string | null> {
    try {
      const r = await fetch("/api/ai/chats", { method: "POST" });
      const j = await r.json();
      if (j.chat?.id) {
        setChats((c) => [{ id: j.chat.id, title: "New chat", model, archivedAt: null, lastMessageAt: null, createdAt: new Date().toISOString() }, ...c]);
        setActiveId(j.chat.id);
        setMessages([]);
        return j.chat.id;
      }
    } catch { }
    return null;
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    let chatId = activeId;
    if (!chatId || showArchived) chatId = await newChat();
    if (!chatId) return;

    setInput("");
    setBusy(true);
    const started = Date.now();
    const optimistic: Msg = { id: `tmp-${Date.now()}`, role: "user", content };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await fetch(`/api/ai/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, model }),
      });
      const j = await r.json();
      await minWait(started);
      if (j.message) {
        setMessages((m) => [...m, j.message]);
        // Refresh titles/order in the sidebar.
        setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, title: j.title ?? c.title, lastMessageAt: new Date().toISOString() } : c)));
      } else {
        setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "assistant", content: `⚠ ${j.error ?? "Couldn't answer that."}` }]);
      }
    } catch {
      setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "assistant", content: "⚠ Network error." }]);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (!activeId || busy) return;
    setBusy(true);
    const started = Date.now();
    // Drop the last assistant message locally; the server re-answers the last user turn.
    setMessages((m) => {
      const copy = [...m];
      if (copy[copy.length - 1]?.role === "assistant") copy.pop();
      return copy;
    });
    try {
      const r = await fetch(`/api/ai/chats/${activeId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ regenerate: true, model }),
      });
      const j = await r.json();
      await minWait(started);
      if (j.message) setMessages((m) => [...m, j.message]);
    } finally {
      setBusy(false);
    }
  }

  async function renameChat(id: string, current: string) {
    const title = window.prompt("Rename chat", current)?.trim();
    if (!title || title === current) return;
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
    await fetch(`/api/ai/chats/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
  }

  async function archiveChat(id: string, archived: boolean) {
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (activeId === id) { setActiveId(null); setMessages([]); }
    await fetch(`/api/ai/chats/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived }) });
  }

  async function deleteChat(id: string) {
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (activeId === id) { setActiveId(null); setMessages([]); }
    setConfirmDelete(null);
    await fetch(`/api/ai/chats/${id}`, { method: "DELETE" });
  }

  const modelSelectOptions = models.length
    ? models.map((m) => ({ value: m.tier, label: m.label }))
    : [{ value: "reasoning", label: "Reasoning" }, { value: "fast", label: "Fast" }];

  return (
    <div className="flex h-[calc(100vh-7rem)] rounded-xl border border-border bg-card overflow-hidden">
      {/* ─────────────── Sidebar: chat history (smooth width animation) ─────────────── */}
      <aside
        className={`shrink-0 overflow-hidden bg-secondary/20 border-r border-border transition-[width] duration-300 ease-in-out ${sidebarOpen ? "w-64" : "w-12"}`}
      >
        {!sidebarOpen ? (
          // Collapsed rail — keep New chat + Chats/Archived reachable as icons.
          <div className="w-12 h-full flex flex-col items-center gap-1.5 py-3">
            <button onClick={newChat} title="New chat" className="size-9 grid place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition">
              <Plus className="size-4" />
            </button>
            <button
              onClick={() => { setShowArchived(false); setSidebarOpen(true); }}
              title="Chats"
              className={`size-9 grid place-items-center rounded-lg transition ${!showArchived ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/70"}`}
            >
              <MessageSquare className="size-4" />
            </button>
            <button
              onClick={() => { setShowArchived(true); setSidebarOpen(true); }}
              title="Archived"
              className={`size-9 grid place-items-center rounded-lg transition ${showArchived ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/70"}`}
            >
              <Archive className="size-4" />
            </button>
          </div>
        ) : (
        <div className="w-64 h-full flex flex-col">
          <div className="p-3">
            <button
              onClick={newChat}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-3 py-2 hover:opacity-90 transition"
            >
              <Plus className="size-4" /> New chat
            </button>
          </div>
          <div className="px-3 pb-2 flex items-center gap-1 text-[11px]">
            <button
              onClick={() => setShowArchived(false)}
              className={`px-2 py-1 rounded-md font-medium ${!showArchived ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <MessageSquare className="size-3 inline mr-1" /> Chats
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={`px-2 py-1 rounded-md font-medium ${showArchived ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Archive className="size-3 inline mr-1" /> Archived
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-none px-2 pb-3 space-y-0.5">
            {chats.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-6">{showArchived ? "No archived chats." : "No chats yet."}</div>
            )}
            {chats.map((c) => (
              <ChatItem
                key={c.id}
                chat={c}
                active={c.id === activeId}
                archivedView={showArchived}
                onOpen={() => openChat(c.id)}
                onRename={() => renameChat(c.id, c.title)}
                onArchive={() => archiveChat(c.id, !showArchived)}
                onDelete={() => setConfirmDelete(c.id)}
              />
            ))}
          </div>
        </div>
        )}
      </aside>

      {/* ─────────────── Main: conversation ─────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* header */}
        <div className="h-12 shrink-0 border-b border-border px-3 flex items-center gap-2">
          <button onClick={() => setSidebarOpen((o) => !o)} className="size-8 grid place-items-center rounded-md hover:bg-secondary text-muted-foreground" title="Toggle history">
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
          </button>
          <div className="flex items-center gap-1.5 font-semibold text-sm">
            <Bot className="size-4 text-brand-cyan ai-icon-animated" /> Equitywala Copilot
            <span className="text-[10px] font-normal text-muted-foreground bg-secondary rounded px-1.5 py-0.5">beta</span>
          </div>
          {insightsHref && (
            <Link
              href={insightsHref}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition"
              title="Copilot insights"
            >
              <BarChart3 className="size-3.5" /> Insights
            </Link>
          )}
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-none">
          {messages.length === 0 && !loadingMsgs ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="size-14 rounded-2xl bg-brand-cyan-light/40 grid place-items-center mb-3">
                <Bot className="size-7 text-brand-cyan" />
              </div>
              <div className="text-lg font-semibold">Ask about your firm</div>
              <div className="flex flex-wrap justify-center gap-1.5 mt-5 max-w-lg">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="text-xs rounded-full border border-border px-3 py-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-5 space-y-5">
              {loadingMsgs && <div className="text-center text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin inline" /> Loading…</div>}
              {messages.map((m, idx) => (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  isLast={idx === messages.length - 1}
                  onRegenerate={regenerate}
                  canRegenerate={!busy && m.role === "assistant" && idx === messages.length - 1}
                />
              ))}
              {busy && <PhaseIndicator />}
            </div>
          )}
        </div>

        {/* composer */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              placeholder="Ask about your clients, AUM, SIPs, tasks…"
              className="flex-1 resize-none max-h-32 rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 focus:border-brand-cyan/50"
            />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              className="size-10 shrink-0 grid place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
          <div className="max-w-3xl mx-auto text-[10px] text-muted-foreground text-center mt-1.5">
            Answers use your live data and can be imperfect · read-only, Equitywala only.
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this chat?"
        message="The conversation is permanently removed. This can't be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        tone="danger"
        onConfirm={() => confirmDelete && deleteChat(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function ChatItem({
  chat, active, archivedView, onOpen, onRename, onArchive, onDelete,
}: {
  chat: ChatRow; active: boolean; archivedView: boolean;
  onOpen: () => void; onRename: () => void; onArchive: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className={`group relative rounded-lg ${active ? "bg-secondary" : "hover:bg-secondary/60"}`}>
      <button onClick={onOpen} className="w-full text-left pl-3 pr-8 py-2 truncate text-sm">
        {chat.title || "New chat"}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}
        className="absolute right-1 top-1.5 size-6 grid place-items-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute right-1 top-8 z-20 w-36 rounded-lg border border-border bg-card shadow-lg py-1 text-sm">
            {!archivedView && (
              <button onClick={() => { setMenu(false); onRename(); }} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-secondary text-left">
                <Pencil className="size-3.5" /> Rename
              </button>
            )}
            <button onClick={() => { setMenu(false); onArchive(); }} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-secondary text-left">
              {archivedView ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />} {archivedView ? "Unarchive" : "Archive"}
            </button>
            <button onClick={() => { setMenu(false); onDelete(); }} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-rose-50 text-rose-600 text-left">
              <Trash2 className="size-3.5" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MessageBubble({
  msg, isLast, onRegenerate, canRegenerate,
}: {
  msg: Msg; isLast: boolean; onRegenerate: () => void; canRegenerate: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function share() {
    try {
      if (navigator.share) await navigator.share({ text: msg.content, title: "Equitywala Copilot" });
      else { await navigator.clipboard.writeText(msg.content); setShared(true); setTimeout(() => setShared(false), 1500); }
    } catch { }
  }

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="size-7 shrink-0 rounded-lg bg-brand-cyan-light/50 grid place-items-center mt-0.5">
        <Bot className="size-4 text-brand-cyan" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-sm bg-secondary/40 border border-border/60 px-4 py-2.5">
          <Markdown text={msg.content} />
        </div>
        <div className="flex items-center gap-1 mt-1.5 text-muted-foreground">
          <IconBtn onClick={copy} title="Copy">{copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}</IconBtn>
          <IconBtn onClick={share} title="Share">{shared ? <Check className="size-3.5 text-emerald-600" /> : <Share2 className="size-3.5" />}</IconBtn>
          {isLast && canRegenerate && <IconBtn onClick={onRegenerate} title="Regenerate"><RefreshCw className="size-3.5" /></IconBtn>}
        </div>
      </div>
    </div>
  );
}

/** Animated multi-phase status while the assistant works. Cycles smoothly
 *  through Thinking → Fetching → Analyzing → Generating so a longer,
 *  tool-using answer feels alive rather than a frozen spinner. */
const PHASES = ["Thinking", "Fetching your data", "Analysing", "Generating the answer", "Almost done", "Delivering"];
function PhaseIndicator() {
  const [i, setI] = useState(0);
  useEffect(() => {
    // Advance through the stages in order (don't loop) — reads as real progress.
    const t = setInterval(() => setI((v) => Math.min(v + 1, PHASES.length - 1)), 440);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex gap-3">
      <div className="size-7 shrink-0 rounded-lg bg-brand-cyan-light/50 grid place-items-center mt-0.5">
        <Bot className="size-4 text-brand-cyan ai-icon-animated" />
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-secondary/40 border border-border/60 px-4 py-2.5 inline-flex items-center gap-2">
        <span className="flex gap-1" aria-hidden>
          <span className="size-1.5 rounded-full bg-brand-cyan/70 animate-bounce [animation-delay:-0.2s]" />
          <span className="size-1.5 rounded-full bg-brand-cyan/70 animate-bounce [animation-delay:-0.1s]" />
          <span className="size-1.5 rounded-full bg-brand-cyan/70 animate-bounce" />
        </span>
        <span key={i} className="text-sm text-muted-foreground animate-fade-in">{PHASES[i]}…</span>
      </div>
    </div>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="size-7 grid place-items-center rounded-md hover:bg-secondary hover:text-foreground transition">
      {children}
    </button>
  );
}
