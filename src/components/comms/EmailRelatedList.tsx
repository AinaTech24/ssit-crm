"use client";

/**
 * EmailRelatedList — the "Emails" conversation for one Client (investor) or Lead.
 * Shows the full TWO-WAY thread (outbound sends + inbound client replies synced
 * by the IMAP poller) in one chronological timeline, and lets the RM:
 *   · Send a template email (compliance-gated)         → "Send email"
 *   · Write a free-form email / reply / forward        → "Write email" / per-row "Reply"
 * Every send routes through the comms pipeline (consent + compliance + audit).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, Send, Loader2, X, ChevronDown, RefreshCw, Inbox, ArrowDownLeft, ArrowUpRight, Reply, PenLine } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Select";

type EmailRow = {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  statusReason: string | null;
  subject: string;
  text: string;
  from: string | null;
  templateKey: string | null;
  externalId: string | null;
  threadId: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
};

type TemplateVar = { key: string; type?: string; required?: boolean };
type TemplateInfo = { key: string; name: string; description: string | null; category: string; variables: TemplateVar[] | null };

// Any NAMESPACED merge field (investor.* / tenant.* / transaction.* / folio.* /
// system.* …) is resolved automatically at send time — investor & firm fields
// from the client record, and transaction.* auto-fetched from the client's
// latest SIP-rejection / transaction / SIP by the comms pipeline. So we never
// ask the RM for those. Only a bare custom var (no namespace, e.g. {{promo_code}})
// has no data source — that's the only thing worth prompting for.
function needsInput(v: TemplateVar): boolean {
  return !v.key.includes(".");
}
/** "promo_code" → "promo code". */
function prettyVarLabel(key: string): string {
  const tail = key.includes(".") ? key.split(".").slice(1).join(" ") : key;
  return tail.replace(/_/g, " ");
}

/** A reply seed carries the parent thread + message so the send threads correctly. */
type ReplySeed = { subject: string; threadId: string | null; inReplyTo: string | null };

function fmtWhen(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusChip(status: string, direction: string): { label: string; cls: string } {
  const ok = "bg-emerald-50 text-emerald-700 border-emerald-200";
  const warn = "bg-amber-50 text-amber-700 border-amber-200";
  const bad = "bg-rose-50 text-rose-700 border-rose-200";
  const muted = "bg-slate-100 text-slate-600 border-slate-200";
  const sky = "bg-sky-50 text-sky-700 border-sky-200";
  if (direction === "inbound") return { label: "Received", cls: sky };
  const map: Record<string, { label: string; cls: string }> = {
    sent: { label: "Sent", cls: ok },
    delivered: { label: "Delivered", cls: ok },
    read: { label: "Read", cls: ok },
    replied: { label: "Replied", cls: ok },
    queued: { label: "Queued", cls: warn },
    scheduled: { label: "Scheduled", cls: warn },
    failed: { label: "Failed", cls: bad },
    bounced: { label: "Bounced", cls: bad },
  };
  if (map[status]) return map[status];
  if (status?.startsWith("skipped")) return { label: "Skipped", cls: muted };
  return { label: status || "—", cls: muted };
}

export function EmailRelatedList({
  entityType,
  entityId,
  entityName,
  entityEmail,
}: {
  entityType: "investor" | "lead";
  entityId: string;
  entityName?: string;
  entityEmail?: string | null;
}) {
  const toast = useToast();
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [freeCompose, setFreeCompose] = useState<ReplySeed | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/comms/email-thread?type=${entityType}&id=${entityId}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load emails");
      setEmails(j.emails ?? []);
      setTemplates(j.templates ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  const inboundCount = useMemo(() => emails.filter((e) => e.direction === "inbound").length, [emails]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mail className="size-4 text-brand-cyan" />
          <span className="font-medium text-foreground">Emails</span>
          <span className="text-xs">· {emails.length} message{emails.length === 1 ? "" : "s"}{inboundCount ? ` · ${inboundCount} received` : ""}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={load} className="btn-icon" title="Refresh" aria-label="Refresh emails">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button type="button" onClick={() => setFreeCompose({ subject: "", threadId: null, inReplyTo: null })} className="btn-secondary text-xs px-2.5 py-1.5">
            <PenLine className="size-3.5" /> Write email
          </button>
          <button type="button" onClick={() => setComposeOpen(true)} className="btn-primary text-xs px-2.5 py-1.5">
            <Send className="size-3.5" /> Send email
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2">{error}</div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading emails…
        </div>
      ) : emails.length === 0 ? (
        <div className="card-surface p-8 text-center text-sm text-muted-foreground">
          <Inbox className="size-6 mx-auto mb-2 opacity-50" />
          No emails yet. Use <span className="font-medium text-foreground">Send email</span> or <span className="font-medium text-foreground">Write email</span> to start the conversation.
        </div>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-border max-h-96 overflow-y-auto scrollbar-thin">
          {emails.map((e) => {
            const chip = statusChip(e.status, e.direction);
            const isOpen = expanded === e.id;
            const inbound = e.direction === "inbound";
            return (
              <div key={e.id} className={`bg-card ${inbound ? "bg-sky-50/30" : ""}`}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : e.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-secondary/40 transition-colors"
                >
                  {inbound ? <ArrowDownLeft className="size-4 shrink-0 text-sky-600" /> : <ArrowUpRight className="size-4 shrink-0 text-emerald-600" />}
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${chip.cls}`}>{chip.label}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{e.subject}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {inbound && e.from ? `from ${e.from} · ` : ""}
                      {fmtWhen(e.sentAt || e.createdAt)}
                      {e.templateKey ? ` · ${e.templateKey}` : ""}
                      {e.status?.startsWith("skipped") && e.statusReason ? ` · ${e.statusReason}` : ""}
                    </span>
                  </span>
                  <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-0">
                    <div className="rounded-lg bg-secondary/40 border border-border p-3 text-xs whitespace-pre-wrap break-words text-foreground/80 max-h-72 overflow-y-auto scrollbar-thin">
                      {e.text || <span className="text-muted-foreground italic">No content captured for this message.</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>Status: <span className="font-medium text-foreground">{e.status}</span></span>
                      {e.deliveredAt && <span>Delivered: {fmtWhen(e.deliveredAt)}</span>}
                      {e.failedAt && <span className="text-rose-600">Failed: {fmtWhen(e.failedAt)}</span>}
                      {e.externalId && <span className="font-mono">ref {e.externalId.slice(0, 18)}</span>}
                      <button
                        type="button"
                        onClick={() =>
                          setFreeCompose({
                            subject: e.subject.replace(/^(re|fwd):\s*/i, ""),
                            threadId: e.threadId,
                            inReplyTo: inbound ? e.externalId : null,
                          })
                        }
                        className="ml-auto inline-flex items-center gap-1 text-brand-cyan-deep hover:underline font-medium"
                      >
                        <Reply className="size-3" /> Reply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {composeOpen && (
        <ComposeModal
          entityType={entityType}
          entityId={entityId}
          entityName={entityName}
          entityEmail={entityEmail}
          templates={templates}
          onClose={() => setComposeOpen(false)}
          onSent={(msg) => { toast.success(msg); setComposeOpen(false); load(); }}
          onSkipped={(msg) => toast.error(msg)}
        />
      )}

      {freeCompose && (
        <FreeComposeModal
          entityType={entityType}
          entityId={entityId}
          entityName={entityName}
          entityEmail={entityEmail}
          seed={freeCompose}
          onClose={() => setFreeCompose(null)}
          onSent={(msg) => { toast.success(msg); setFreeCompose(null); load(); }}
          onSkipped={(msg) => toast.error(msg)}
        />
      )}
    </div>
  );
}

/* ───────────────────────── free-form compose / reply ───────────────────────── */

function FreeComposeModal({
  entityType,
  entityId,
  entityName,
  entityEmail,
  seed,
  onClose,
  onSent,
  onSkipped,
}: {
  entityType: "investor" | "lead";
  entityId: string;
  entityName?: string;
  entityEmail?: string | null;
  seed: ReplySeed;
  onClose: () => void;
  onSent: (msg: string) => void;
  onSkipped: (msg: string) => void;
}) {
  const isReply = !!seed.inReplyTo || !!seed.threadId;
  const [subject, setSubject] = useState(seed.subject ? (isReply ? `Re: ${seed.subject}` : seed.subject) : "");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!subject.trim() || !body.trim()) { setErr("Subject and message are required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/comms/email-thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "compose",
          type: entityType,
          id: entityId,
          subject,
          body,
          threadId: seed.threadId ?? undefined,
          inReplyTo: seed.inReplyTo ?? undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Failed to send"); return; }
      if (j.status === "skipped") { onSkipped(`Email blocked: ${j.reason ?? "compliance/consent check"}`); return; }
      onSent(j.status === "queued" ? "Email queued." : "Email sent.");
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  const node = (
    <div className="fixed inset-0 z-[100] bg-black/40 grid place-items-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl border border-border/60 max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <PenLine className="size-4 text-brand-cyan" /> {isReply ? "Reply" : "Write email"}{entityName ? ` · ${entityName}` : ""}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-secondary text-muted-foreground" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin">
          <div className="text-xs text-muted-foreground">
            To: <span className="font-medium text-foreground">{entityEmail || "— no email on file —"}</span>
          </div>
          <label className="block">
            <div className="text-xs font-medium mb-1">Subject</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input-base" placeholder="Subject" />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Message</div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="input-base resize-y" placeholder="Write your message…" />
          </label>
          <p className="text-[11px] text-muted-foreground">The mandatory MF risk disclaimer + your ARN signature are added automatically, and the message passes the compliance + consent gate before sending.</p>
          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2">{err}</div>}
        </div>
        <div className="border-t border-border px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={send} disabled={busy || !entityEmail} className="btn-primary text-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(node, document.body) : null;
}

/* ───────────────────────── template compose modal ───────────────────────── */

function ComposeModal({
  entityType,
  entityId,
  entityName,
  entityEmail,
  templates,
  onClose,
  onSent,
  onSkipped,
}: {
  entityType: "investor" | "lead";
  entityId: string;
  entityName?: string;
  entityEmail?: string | null;
  templates: TemplateInfo[];
  onClose: () => void;
  onSent: (msg: string) => void;
  onSkipped: (msg: string) => void;
}) {
  const [selectedKey, setSelectedKey] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = useMemo(() => templates.find((t) => t.key === selectedKey), [templates, selectedKey]);

  useEffect(() => {
    if (!selected) { setVars({}); return; }
    // investor.* / tenant.* / lead.* / system.* auto-resolve from the client
    // record + firm at send time. transaction.* / folio.* / goal.* / custom vars
    // are template-specific — prompt the RM for them (each template has its own
    // set). Blanks are auto-filled from the client's latest transaction/SIP.
    const init: Record<string, string> = {};
    (selected.variables ?? []).filter(needsInput).forEach((v) => { init[v.key] = ""; });
    setVars(init);
    setErr(null);
  }, [selected]);

  async function send() {
    if (!selectedKey) { setErr("Pick a template first."); return; }
    setBusy(true);
    setErr(null);
    try {
      // Only send fields the RM actually filled. An empty override would WIN over
      // the resolver + the pipeline's transaction auto-fill (override always wins)
      // and blank out a field that would otherwise resolve — so drop blanks and
      // let the resolver / auto-fill populate what the RM left empty.
      const filledVars = Object.fromEntries(
        Object.entries(vars).filter(([, val]) => String(val ?? "").trim() !== "")
      );
      const res = await fetch("/api/comms/email-thread", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "template", type: entityType, id: entityId, templateKey: selectedKey, variables: filledVars }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Failed to send"); return; }
      if (j.status === "skipped") { onSkipped(`Email blocked: ${j.skipped?.reason ?? "compliance/consent check"}`); return; }
      onSent(j.status === "queued" ? "Email queued for sending." : "Email sent.");
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <div className="fixed inset-0 z-[100] bg-black/40 grid place-items-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl border border-border/60 max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Send className="size-4 text-brand-cyan" /> Send email{entityName ? ` · ${entityName}` : ""}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-secondary text-muted-foreground" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          <div className="text-xs text-muted-foreground">To: <span className="font-medium text-foreground">{entityEmail || "— no email on file —"}</span></div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Choose a template</div>
            {templates.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2">No approved email templates yet. Create &amp; approve one under Templates first.</div>
            ) : (
              <Select value={selectedKey} onChange={setSelectedKey} placeholder="Select a template…" options={templates.map((t) => ({ value: t.key, label: t.name }))} />
            )}
            {selected?.description && <p className="text-[11px] text-muted-foreground mt-1.5">{selected.description}</p>}
          </div>
          {selected && (selected.variables ?? []).filter(needsInput).length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Custom fields</div>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Client, firm and transaction details fill in automatically from the record.
                Only these custom fields need a value.
              </p>
              {(selected.variables ?? []).filter(needsInput).map((v) => (
                <label key={v.key} className="block">
                  <div className="text-xs font-medium mb-1 capitalize">
                    {prettyVarLabel(v.key)}{v.required && <span className="text-rose-600"> *</span>}
                    {v.key.includes(".") && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground lowercase">· {v.key.split(".")[0]}</span>
                    )}
                  </div>
                  <input value={vars[v.key] ?? ""} onChange={(e) => setVars((s) => ({ ...s, [v.key]: e.target.value }))} placeholder={v.type ? `(${v.type})` : ""} className="input-base" />
                </label>
              ))}
            </div>
          )}
          {err && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2">{err}</div>}
        </div>
        <div className="border-t border-border px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={send} disabled={busy || !selectedKey || !entityEmail} className="btn-primary text-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {busy ? "Sending…" : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(body, document.body) : null;
}
