"use client";

/**
 * WhatsAppRelatedList — two-way WhatsApp conversation for one Client (investor)
 * or Lead. Shows inbound + outbound messages as a chat timeline, with delivery
 * status on outbound bubbles. Composer:
 *   - inside the 24h window  → free-form reply (+ quick replies) or a template
 *   - outside the window     → template-only (WhatsApp rule), with a note
 * Everything sends through the comms pipeline (consent + session + compliance).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, Loader2, RefreshCw, Inbox, Check, CheckCheck, AlertTriangle, Zap } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Select";

type WaMsg = {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  statusReason: string | null;
  text: string;
  templateKey: string | null;
  createdAt: string;
  readAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
};

type TemplateVar = { key: string; type?: string; required?: boolean };
type TemplateInfo = {
  key: string;
  name: string;
  description: string | null;
  category: string;
  status?: string;
  variables: TemplateVar[] | null;
  /** Stored media-header URL is an expiring Meta CDN URL → will 131053 on send. */
  mediaBroken?: boolean;
  /** Meta-approved (Vartify) template → deliverable anytime. CRM-authored → free-form
   *  text, delivers only inside the 24h session window. */
  isMetaTemplate?: boolean;
};

const QUICK_REPLIES = [
  "Thank you for reaching out! How can I help you today?",
  "Sure — I'll get back to you shortly with the details.",
  "Could you please share your folio number or PAN so I can check?",
  "Your request has been noted. We'll process it and update you.",
  "Thank you! Is there anything else I can help you with?",
];

function fmtWhen(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Tiny delivery indicator for an outbound bubble. */
function Ticks({ status }: { status: string }) {
  if (status === "read" || status === "replied") return <CheckCheck className="size-3 text-sky-500" />;
  if (status === "delivered") return <CheckCheck className="size-3 text-muted-foreground" />;
  if (status === "sent" || status === "queued") return <Check className="size-3 text-muted-foreground" />;
  if (status === "failed" || status === "bounced") return <AlertTriangle className="size-3 text-rose-500" />;
  if (status?.startsWith("skipped")) return <AlertTriangle className="size-3 text-amber-500" />;
  return null;
}

export function WhatsAppRelatedList({
  entityType,
  entityId,
  entityName,
  entityPhone,
}: {
  entityType: "investor" | "lead";
  entityId: string;
  entityName?: string;
  entityPhone?: string | null;
}) {
  const toast = useToast();
  const [messages, setMessages] = useState<WaMsg[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/comms/whatsapp-thread?type=${entityType}&id=${entityId}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load WhatsApp messages");
      setMessages(j.messages ?? []);
      setTemplates(j.templates ?? []);
      setSessionActive(!!j.sessionActive);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load WhatsApp messages");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Auto-scroll to the latest message after load.
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Composer state
  const [tab, setTab] = useState<"reply" | "template">("reply");
  const [text, setText] = useState("");
  const [tplKey, setTplKey] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  // Outside the window, free-form isn't allowed — default to the template tab.
  useEffect(() => {
    if (!sessionActive) setTab("template");
  }, [sessionActive]);

  const selectedTpl = useMemo(() => templates.find((t) => t.key === tplKey), [templates, tplKey]);
  useEffect(() => {
    if (!selectedTpl) {
      setVars({});
      return;
    }
    const init: Record<string, string> = {};
    (selectedTpl.variables ?? []).forEach((v) => {
      init[v.key] = /name/i.test(v.key) && entityName ? entityName : "";
    });
    setVars(init);
  }, [selectedTpl, entityName]);

  async function send(body: Record<string, unknown>, okMsg: string) {
    setSending(true);
    try {
      const res = await fetch("/api/comms/whatsapp-thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: entityType, id: entityId, ...body }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error ?? "Failed to send");
        return;
      }
      if (j.status === "skipped") {
        const reason = String(j.skipped?.reason ?? "compliance / consent / session");
        // If blocked purely on consent, offer a one-click "record consent & resend"
        // (only for clients — consent is keyed to an investor).
        if (/consent/i.test(reason) && entityType === "investor") {
          setBlockedSend({ body, okMsg });
        }
        toast.error(`Blocked: ${reason}`);
        return;
      }
      setBlockedSend(null);
      toast.success(okMsg);
      setText("");
      setTplKey("");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error");
    } finally {
      setSending(false);
    }
  }

  // A send blocked on consent — surfaced so the RM can record the client's opt-in
  // and immediately retry.
  const [blockedSend, setBlockedSend] = useState<{ body: Record<string, unknown>; okMsg: string } | null>(null);
  const [recording, setRecording] = useState(false);

  async function recordConsentAndResend() {
    if (!blockedSend) return;
    setRecording(true);
    try {
      const res = await fetch("/api/comms/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId: entityId, channel: "whatsapp", scope: "all", status: "granted" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Could not record consent");
        return;
      }
      toast.success("Consent recorded — resending…");
      const retry = blockedSend;
      setBlockedSend(null);
      await send(retry.body, retry.okMsg);
    } catch (e: any) {
      toast.error(e?.message ?? "Network error");
    } finally {
      setRecording(false);
    }
  }

  const canFreeform = sessionActive && !!entityPhone;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageCircle className="size-4 text-emerald-600" />
          <span className="font-medium text-foreground">WhatsApp</span>
          <span className="text-xs">· {messages.length}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${sessionActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
            {sessionActive ? "Window open" : "Window closed"}
          </span>
        </div>
        <button type="button" onClick={load} className="btn-icon" title="Refresh" aria-label="Refresh">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2">{error}</div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading conversation…
        </div>
      ) : (
        <div ref={scrollRef} className="rounded-xl border border-border bg-secondary/20 p-3 max-h-96 overflow-y-auto scrollbar-thin space-y-2">
          {messages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              <Inbox className="size-6 mx-auto mb-2 opacity-50" />
              No WhatsApp messages yet.
            </div>
          ) : (
            messages.map((m) => {
              const out = m.direction === "outbound";
              return (
                <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${out ? "bg-emerald-600 text-white rounded-br-sm" : "bg-card border border-border rounded-bl-sm"}`}>
                    <div className="whitespace-pre-wrap break-words">{m.text || <span className="italic opacity-70">(no content)</span>}</div>
                    <div className={`mt-0.5 flex items-center gap-1 text-[10px] ${out ? "text-emerald-50/80 justify-end" : "text-muted-foreground"}`}>
                      {m.templateKey && <span className="opacity-80">{m.templateKey}</span>}
                      <span>{fmtWhen(m.createdAt)}</span>
                      {out && <Ticks status={m.status} />}
                    </div>
                    {out && m.status?.startsWith("skipped") && m.statusReason && (
                      <div className="text-[10px] text-amber-100/90 mt-0.5">{m.statusReason}</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Composer */}
      <div className="rounded-xl border border-border bg-card p-3 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab("reply")}
            disabled={!canFreeform}
            className={`text-xs font-medium px-2.5 py-1 rounded-md transition ${tab === "reply" ? "bg-emerald-600 text-white" : "border border-border hover:bg-secondary"} disabled:opacity-40 disabled:cursor-not-allowed`}
            title={canFreeform ? "" : "Free-form replies are only allowed within 24h of the client's last message"}
          >
            Reply
          </button>
          <button
            type="button"
            onClick={() => setTab("template")}
            className={`text-xs font-medium px-2.5 py-1 rounded-md transition ${tab === "template" ? "bg-emerald-600 text-white" : "border border-border hover:bg-secondary"}`}
          >
            Template
          </button>
          <span className="text-[11px] text-muted-foreground ml-1 truncate">To: {entityPhone || "— no number —"}</span>
        </div>

        {tab === "reply" ? (
          canFreeform ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {QUICK_REPLIES.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setText(q)}
                    className="inline-flex items-center gap-1 text-[11px] rounded-full border border-border bg-secondary/40 px-2 py-0.5 hover:bg-secondary"
                  >
                    <Zap className="size-2.5 text-emerald-600" /> {q.length > 32 ? q.slice(0, 32) + "…" : q}
                  </button>
                ))}
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder="Type a reply…"
                className="input-base w-full resize-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => send({ text }, "Reply sent.")}
                  disabled={sending || !text.trim()}
                  className="btn-primary text-sm"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {sending ? "Sending…" : "Send reply"}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2">
              The 24-hour reply window is closed. Send an approved <b>template</b> to reopen the conversation.
            </div>
          )
        ) : (
          <div className="space-y-2">
            {templates.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2">
                No WhatsApp templates yet. Create one under Templates → New (channel: WhatsApp).
              </div>
            ) : (
              <Select
                value={tplKey}
                onChange={setTplKey}
                placeholder="Select a template…"
                searchable
                searchPlaceholder="Search templates…"
                options={templates.map((t) => ({
                  value: t.key,
                  label: `${t.isMetaTemplate ? "✅ " : "✏ "}${t.status && t.status !== "approved" ? `${t.name} (${t.status.replace(/_/g, " ")})` : t.name}${t.mediaBroken ? "  ⚠ media expired" : ""}`,
                }))}
              />
            )}
            {selectedTpl && (selectedTpl.variables ?? []).length > 0 && (
              <div className="space-y-2">
                {(selectedTpl.variables ?? []).map((v) => (
                  <label key={v.key} className="block">
                    <div className="text-[11px] font-medium mb-0.5">
                      {v.key.replace(/_/g, " ")}
                      {v.required && <span className="text-rose-600"> *</span>}
                    </div>
                    <input value={vars[v.key] ?? ""} onChange={(e) => setVars((s) => ({ ...s, [v.key]: e.target.value }))} className="input-base" />
                  </label>
                ))}
              </div>
            )}
            {selectedTpl?.mediaBroken && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                ⚠ This template's header image/video link has <span className="font-medium">expired</span> on Meta's
                side (error 131053). Re-upload the sample media for this template in the Vartify console, then{" "}
                <span className="font-medium">Fetch from WhatsApp</span> again — otherwise the send will fail.
              </div>
            )}
            {selectedTpl && selectedTpl.isMetaTemplate === false && !sessionActive && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                ⚠ <span className="font-medium">This is a CRM template, not a Meta-approved WhatsApp template.</span>{" "}
                It sends as free-form text, which WhatsApp <span className="font-medium">only delivers within 24h of
                the client messaging you</span>. This client has no open chat, so it will show “sent” but{" "}
                <span className="font-medium">won't be delivered</span>. Pick a ✅ Meta-approved template (fetched
                from WhatsApp) for proactive sends.
              </div>
            )}
            {blockedSend && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center justify-between gap-3">
                <span>
                  Blocked — this client hasn’t opted in to WhatsApp. If they’ve agreed to receive messages from
                  you, record their consent and resend.
                </span>
                <button
                  type="button"
                  onClick={recordConsentAndResend}
                  disabled={recording}
                  className="btn-primary text-xs whitespace-nowrap"
                >
                  {recording ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {recording ? "Recording…" : "Record consent & resend"}
                </button>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => send({ templateKey: tplKey, variables: vars }, "WhatsApp sent.")}
                disabled={sending || !tplKey || !entityPhone}
                className="btn-primary text-sm"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {sending ? "Sending…" : "Send template"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
