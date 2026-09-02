"use client";

/**
 * AiClientBrief — the AI Relationship Copilot button on Client 360. Fetches a
 * Claude-generated pre-call brief (summary, talking points, recommended
 * actions, watch-outs, a compliant WhatsApp opener) and shows it in a drawer.
 * Advisory; the RM reviews + edits before acting. The opener gets a one-tap
 * WhatsApp send (RM's own WhatsApp — no BSP quota).
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, Loader2, MessageCircle, Copy, Lightbulb, ListChecks, AlertTriangle } from "lucide-react";

type Brief = { summary: string; talkingPoints: string[]; recommendedActions: string[]; suggestedOpener: string; watchouts: string[] };

function waNumber(phone?: string | null): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
}

export function AiClientBrief({ investorId, name, phone }: { investorId: string; name: string; phone?: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setOpen(true);
    if (brief || loading) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/ai/client-brief/${investorId}`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `AI brief failed (${res.status})`); return; }
      setBrief(j.brief as Brief);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load brief");
    } finally { setLoading(false); }
  }

  return (
    <>
      <button onClick={load} className="btn-secondary text-xs inline-flex items-center gap-1" title="AI pre-call brief">
        <Sparkles className="size-3.5 text-brand-cyan" /> AI Brief
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg h-full bg-card border-l shadow-2xl flex flex-col">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2"><Sparkles className="size-4 text-brand-cyan" /> AI Brief — {name}</div>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent"><X className="size-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Loader2 className="size-6 animate-spin" /><span className="text-sm">Reading the relationship…</span>
                </div>
              ) : err ? (
                <div className="text-sm text-rose-600 bg-rose-50 rounded-lg p-3">{err}</div>
              ) : brief ? (
                <>
                  <p className="text-sm leading-relaxed">{brief.summary}</p>

                  {brief.watchouts.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                      <div className="text-xs font-semibold text-amber-800 flex items-center gap-1 mb-1"><AlertTriangle className="size-3.5" /> Watch-outs</div>
                      <ul className="text-xs text-amber-900 space-y-0.5 list-disc pl-4">{brief.watchouts.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    </div>
                  )}

                  <Section icon={Lightbulb} title="Talking points" items={brief.talkingPoints} />
                  <Section icon={ListChecks} title="Recommended actions" items={brief.recommendedActions} />

                  {brief.suggestedOpener && (
                    <div className="rounded-lg border bg-secondary/30 p-3">
                      <div className="text-xs font-semibold mb-1">Suggested opener</div>
                      <p className="text-sm italic">&ldquo;{brief.suggestedOpener}&rdquo;</p>
                      <div className="flex gap-2 mt-2">
                        <a href={`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(brief.suggestedOpener)}`} target="_blank" rel="noopener noreferrer" className="btn-primary text-xs inline-flex items-center gap-1"><MessageCircle className="size-3.5" /> Send on WhatsApp</a>
                        <button onClick={() => navigator.clipboard?.writeText(brief.suggestedOpener)} className="btn-secondary text-xs inline-flex items-center gap-1"><Copy className="size-3.5" /> Copy</button>
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground italic">AI-generated from this client&apos;s data. Review before acting — not investment advice. Standard MF risk disclosure applies to any message sent.</p>
                </>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function Section({ icon: Icon, title, items }: { icon: any; title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold flex items-center gap-1 mb-1.5"><Icon className="size-3.5 text-brand-cyan" /> {title}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-sm flex gap-2"><span className="text-brand-cyan mt-0.5">•</span><span>{it}</span></li>
        ))}
      </ul>
    </div>
  );
}
