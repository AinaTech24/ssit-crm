"use client";

/**
 * MeetingPrepButton — one-click Meeting Prep Pack on the review-meeting detail
 * page. POSTs /api/review-meetings/[id]/prep and shows the generated brief
 * (client snapshot, what changed since the last meeting, open items, goals,
 * AI talking points) in a modal the RM can copy or print before walking in.
 */

import { useCallback, useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  X,
  Loader2,
  Copy,
  Check,
  Printer,
  Wallet,
  History,
  ListChecks,
  Target,
  Lightbulb,
} from "lucide-react";
import { formatINR } from "@/lib/utils";

type PrepPack = {
  meeting: { id: string; scheduledAt: string };
  client: {
    id: string;
    kind: "investor" | "lead";
    name: string;
    aum?: number;
    riskProfile?: string | null;
    serviceTier?: string | null;
    activeSipCount?: number;
    sipMonthlyTotal?: number;
    folioCount?: number;
    topHoldings?: Array<{ name: string; category?: string | null; value: number }>;
    stage?: string | null;
    source?: string | null;
    expectedBusinessAmount?: number | null;
    lastContactAt?: string | null;
  };
  sinceLast: {
    lastMeetingAt: string | null;
    firstReview: boolean;
    transactionCount?: number;
    netInvested?: number;
    communicationsCount?: number;
  };
  openItems: Array<{ title: string; dueAt: string | null }>;
  goals: Array<{ name: string; targetAmount: number; progressPct: number | null }>;
  talkingPoints: string[];
  aiUnavailable?: boolean;
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Plain-text rendition for the clipboard. */
function toPlainText(p: PrepPack): string {
  const lines: string[] = [];
  lines.push(`MEETING PREP PACK — ${p.client.name}`);
  lines.push(`Meeting: ${new Date(p.meeting.scheduledAt).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}`);
  lines.push("");
  lines.push("CLIENT SNAPSHOT");
  if (p.client.kind === "investor") {
    lines.push(`- AUM: ${formatINR(p.client.aum ?? 0)}`);
    if (p.client.riskProfile) lines.push(`- Risk profile: ${titleCase(p.client.riskProfile)}`);
    if (p.client.serviceTier) lines.push(`- Service tier: ${p.client.serviceTier}`);
    lines.push(`- Active SIPs: ${p.client.activeSipCount ?? 0} (${formatINR(p.client.sipMonthlyTotal ?? 0)}/month)`);
    lines.push(`- Folios: ${p.client.folioCount ?? 0}`);
    for (const h of p.client.topHoldings ?? []) {
      lines.push(`- Holding: ${h.name}${h.category ? ` (${h.category})` : ""} — ${formatINR(h.value)}`);
    }
  } else {
    if (p.client.stage) lines.push(`- Lead stage: ${titleCase(p.client.stage)}`);
    if (p.client.source) lines.push(`- Source: ${titleCase(p.client.source)}`);
    if (p.client.expectedBusinessAmount != null) lines.push(`- Expected business: ${formatINR(p.client.expectedBusinessAmount)}`);
    if (p.client.lastContactAt) lines.push(`- Last contact: ${fmtDate(p.client.lastContactAt)}`);
  }
  lines.push("");
  lines.push("SINCE LAST MEETING");
  if (p.sinceLast.firstReview) {
    lines.push("- First review — no previous completed meeting on record.");
  } else {
    lines.push(`- Last meeting: ${fmtDate(p.sinceLast.lastMeetingAt)}`);
    if (p.sinceLast.transactionCount != null) lines.push(`- Transactions: ${p.sinceLast.transactionCount}`);
    if (p.sinceLast.netInvested != null) lines.push(`- Net invested: ${formatINR(p.sinceLast.netInvested)}`);
    if (p.sinceLast.communicationsCount != null) lines.push(`- Communications: ${p.sinceLast.communicationsCount}`);
  }
  if (p.openItems.length) {
    lines.push("");
    lines.push("OPEN ITEMS");
    for (const t of p.openItems) lines.push(`- ${t.title}${t.dueAt ? ` (due ${fmtDate(t.dueAt)})` : ""}`);
  }
  if (p.goals.length) {
    lines.push("");
    lines.push("GOALS");
    for (const g of p.goals) {
      lines.push(`- ${g.name}: target ${formatINR(g.targetAmount)}${g.progressPct != null ? ` · ${Math.round(g.progressPct)}% funded` : ""}`);
    }
  }
  if (p.talkingPoints.length) {
    lines.push("");
    lines.push("TALKING POINTS");
    for (const tp of p.talkingPoints) lines.push(`- ${tp}`);
  }
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Printable HTML rendition — plain-text sections wrapped in minimal print CSS. */
function printPack(p: PrepPack) {
  const text = toPlainText(p);
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Meeting Prep — ${escapeHtml(p.client.name)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; padding: 32px; color: #111; }
  pre { white-space: pre-wrap; font: 13px/1.6 ui-sans-serif, system-ui, sans-serif; }
</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

export function MeetingPrepButton({ meetingId, className }: { meetingId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pack, setPack] = useState<PrepPack | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setOpen(true);
    if (pack || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/review-meetings/${meetingId}/prep`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Prep pack failed (${res.status})`);
        return;
      }
      setPack(j as PrepPack);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to build prep pack");
    } finally {
      setLoading(false);
    }
  }, [meetingId, pack, loading]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function copyPack() {
    if (!pack) return;
    try {
      await navigator.clipboard?.writeText(toPlainText(pack));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <>
      <button
        onClick={load}
        className={`btn-secondary text-xs inline-flex items-center gap-1 ${className ?? ""}`}
        title="Generate a one-page brief for this meeting"
      >
        <Sparkles className="size-3.5 text-brand-cyan" /> Prep pack
      </button>

      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
                <div className="font-semibold flex items-center gap-2">
                  <Sparkles className="size-4 text-brand-cyan" />
                  Meeting Prep Pack{pack ? ` — ${pack.client.name}` : ""}
                </div>
                <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                    <Loader2 className="size-6 animate-spin" />
                    <span className="text-sm">Assembling the pack…</span>
                  </div>
                ) : err ? (
                  <div className="text-sm text-rose-600 bg-rose-50 rounded-lg p-3">{err}</div>
                ) : pack ? (
                  <>
                    {/* ── Client snapshot ── */}
                    <section>
                      <SectionTitle icon={Wallet} title="Client snapshot" />
                      <div className="flex flex-wrap gap-1.5">
                        {pack.client.kind === "investor" ? (
                          <>
                            <span className="chip bg-secondary text-foreground">AUM {formatINR(pack.client.aum ?? 0)}</span>
                            {pack.client.riskProfile && (
                              <span className="chip bg-secondary text-foreground">Risk: {titleCase(pack.client.riskProfile)}</span>
                            )}
                            {pack.client.serviceTier && (
                              <span className="chip bg-secondary text-foreground">Tier {pack.client.serviceTier}</span>
                            )}
                            <span className="chip bg-secondary text-foreground">
                              {pack.client.activeSipCount ?? 0} SIPs · {formatINR(pack.client.sipMonthlyTotal ?? 0)}/mo
                            </span>
                            <span className="chip bg-secondary text-foreground">{pack.client.folioCount ?? 0} folios</span>
                          </>
                        ) : (
                          <>
                            {pack.client.stage && (
                              <span className="chip bg-secondary text-foreground">Stage: {titleCase(pack.client.stage)}</span>
                            )}
                            {pack.client.source && (
                              <span className="chip bg-secondary text-foreground">Source: {titleCase(pack.client.source)}</span>
                            )}
                            {pack.client.expectedBusinessAmount != null && (
                              <span className="chip bg-secondary text-foreground">
                                Expected {formatINR(pack.client.expectedBusinessAmount)}
                              </span>
                            )}
                            {pack.client.lastContactAt && (
                              <span className="chip bg-secondary text-foreground">
                                Last contact {fmtDate(pack.client.lastContactAt)}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {(pack.client.topHoldings?.length ?? 0) > 0 && (
                        <ul className="mt-2 space-y-1">
                          {pack.client.topHoldings!.map((h, i) => (
                            <li key={i} className="text-sm flex items-center justify-between gap-3">
                              <span className="truncate">
                                {h.name}
                                {h.category && <span className="text-muted-foreground"> · {h.category}</span>}
                              </span>
                              <span className="font-medium tabular-nums shrink-0">{formatINR(h.value)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    {/* ── Since last meeting ── */}
                    <section>
                      <SectionTitle icon={History} title="Since last meeting" />
                      {pack.sinceLast.firstReview ? (
                        <p className="text-sm text-muted-foreground">
                          First review — no previous completed meeting on record.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <span className="chip bg-secondary text-foreground">
                            Last met {fmtDate(pack.sinceLast.lastMeetingAt)}
                          </span>
                          {pack.sinceLast.transactionCount != null && (
                            <span className="chip bg-secondary text-foreground">
                              {pack.sinceLast.transactionCount} transactions
                            </span>
                          )}
                          {pack.sinceLast.netInvested != null && (
                            <span
                              className={`chip ${Number(pack.sinceLast.netInvested) < 0 ? "bg-rose-50 text-rose-700" : "bg-secondary text-foreground"}`}
                            >
                              Net invested {formatINR(pack.sinceLast.netInvested)}
                            </span>
                          )}
                          {pack.sinceLast.communicationsCount != null && (
                            <span className="chip bg-secondary text-foreground">
                              {pack.sinceLast.communicationsCount} communications
                            </span>
                          )}
                        </div>
                      )}
                    </section>

                    {/* ── Open items ── */}
                    <section>
                      <SectionTitle icon={ListChecks} title="Open items" />
                      {pack.openItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nothing pending — clean slate.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {pack.openItems.map((t, i) => (
                            <li key={i} className="text-sm flex gap-2">
                              <span className="text-brand-cyan mt-0.5">•</span>
                              <span>
                                {t.title}
                                {t.dueAt && <span className="text-muted-foreground"> — due {fmtDate(t.dueAt)}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    {/* ── Goals ── */}
                    {pack.goals.length > 0 && (
                      <section>
                        <SectionTitle icon={Target} title="Goals" />
                        <ul className="space-y-1.5">
                          {pack.goals.map((g, i) => (
                            <li key={i} className="text-sm flex items-center justify-between gap-3">
                              <span className="truncate">{g.name}</span>
                              <span className="text-muted-foreground shrink-0 tabular-nums">
                                {formatINR(g.targetAmount)}
                                {g.progressPct != null && ` · ${Math.round(g.progressPct)}%`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {/* ── Talking points ── */}
                    <section className="rounded-lg border border-border bg-brand-cyan-light p-4">
                      <SectionTitle icon={Lightbulb} title="Talking points" />
                      {pack.aiUnavailable ? (
                        <p className="text-sm text-muted-foreground">
                          AI isn&apos;t set up yet — ask your admin to configure the AI provider under Settings → AI &amp;
                          Models. The sections above are still meeting-ready.
                        </p>
                      ) : pack.talkingPoints.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No talking points generated.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {pack.talkingPoints.map((tp, i) => (
                            <li key={i} className="text-sm flex gap-2">
                              <span className="text-brand-cyan mt-0.5">•</span>
                              <span>{tp}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-[10px] text-muted-foreground italic mt-3">
                        Generated from this client&apos;s data. Review before the meeting — not investment advice.
                      </p>
                    </section>
                  </>
                ) : null}
              </div>

              <div className="px-5 py-3 border-t flex items-center justify-end gap-2 shrink-0">
                <button
                  onClick={copyPack}
                  disabled={!pack}
                  className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={() => pack && printPack(pack)}
                  disabled={!pack}
                  className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <Printer className="size-3.5" /> Print
                </button>
                <button onClick={() => setOpen(false)} className="btn-primary text-xs">
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="text-xs font-semibold flex items-center gap-1.5 mb-2">
      <Icon className="size-3.5 text-brand-cyan" /> {title}
    </div>
  );
}
