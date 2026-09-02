"use client";

/**
 * Wealth Story & Client Review Pack — celebratory 12-month recap and
 * portfolio review pack for a client.
 */

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  X,
  Loader2,
  FileDown,
  Mail,
  Check,
  Target,
  TrendingUp,
  PiggyBank,
  Trophy,
  CalendarClock,
  PieChart,
  Boxes,
} from "lucide-react";
import { downloadFile } from "@/lib/secure-download";

type Story = {
  client: { name: string; email: string | null; tenureYears: number; riskProfile: string | null };
  period: { from: string; to: string };
  invested: number;
  withdrawn: number;
  netInvested: number;
  currentValue: number;
  sipInstallments: number;
  sipTotal: number;
  activeMonths: number;
  topHolding: { name: string; value: number } | null;
  topHoldings?: { name: string; category?: string; value: number; sharePct: number }[];
  assetAllocation?: { category: string; value: number; pct: number }[];
  holdingsCount: number;
  amcCount: number;
  goals: { name: string; targetAmount: number; progressPct: number | null }[];
  funFacts: string[];
  hasData: boolean;
};

const inr = (n: number) => `₹${Math.round(n ?? 0).toLocaleString("en-IN")}`;
const mon = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export function WealthStoryButton({
  investorId,
  clientName,
  className,
}: {
  investorId: string;
  clientName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | "pdf" | "email">(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function openStory() {
    setOpen(true);
    setNotice(null);
    setEmailOpen(false);
    if (story) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/wealth-story`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? `Could not load the story (${res.status})`);
      } else {
        setStory(j);
        setEmailTo(j?.client?.email ?? "");
      }
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function onDownload() {
    setBusy("pdf");
    setNotice(null);
    try {
      await downloadFile(
        `/api/investors/${investorId}/wealth-story?pdf=1`,
        `PortfolioReview_${clientName.replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`
      );
      setNotice({ kind: "ok", text: "Portfolio Review Pack downloaded" });
    } catch {
      setNotice({ kind: "err", text: "Download failed" });
    } finally {
      setBusy(null);
    }
  }

  async function onEmail() {
    const to = emailTo.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      setNotice({ kind: "err", text: "Enter a valid email address." });
      return;
    }
    setBusy("email");
    setNotice(null);
    try {
      const res = await fetch(`/api/investors/${investorId}/wealth-story`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "email", to }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setNotice({ kind: "err", text: j.error ?? `Failed (${res.status})` });
      else {
        setNotice({ kind: "ok", text: `Review pack emailed to ${to}` });
        setEmailOpen(false);
      }
    } catch (e: any) {
      setNotice({ kind: "err", text: e?.message ?? "Network error" });
    } finally {
      setBusy(null);
    }
  }

  const s = story;
  const firstName = (clientName || "").split(/\s+/)[0] || "Client";

  return (
    <>
      <button
        type="button"
        onClick={openStory}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white shadow-sm " +
            "bg-gradient-to-r from-violet-600 via-fuchsia-600 to-amber-500 hover:opacity-90 transition-opacity"
        }
      >
        <Sparkles className="size-3.5" /> Client Review Pack
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="relative w-full max-w-2xl max-h-[90vh] card-elevated overflow-hidden flex flex-col">
              {/* ── Hero ── */}
              <div className="brand-mesh text-white px-6 py-6 relative shrink-0">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="absolute top-3 right-3 rounded-full p-1.5 text-white/80 hover:text-white hover:bg-white/10"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/70 font-semibold">Portfolio Review & Wealth Report</div>
                <h2 className="text-xl sm:text-2xl font-bold mt-1 flex items-center gap-2">
                  <span aria-hidden>✨</span> {clientName}&rsquo;s Review Pack
                </h2>
                {s && (
                  <div className="text-xs text-white/75 mt-1.5 inline-flex items-center gap-1.5">
                    <CalendarClock className="size-3.5" /> {mon(s.period.from)} – {mon(s.period.to)}
                    {s.client.tenureYears >= 1 && (
                      <span className="ml-2">· investing together for {s.client.tenureYears} yr{s.client.tenureYears >= 2 ? "s" : ""}</span>
                    )}
                  </div>
                )}
              </div>

              {/* ── Body ── */}
              <div className="overflow-y-auto p-6 space-y-5 bg-card text-xs">
                {loading && (
                  <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-3">
                    <Loader2 className="size-6 animate-spin text-brand-cyan" />
                    <span className="text-sm">Composing {firstName}&rsquo;s review pack…</span>
                  </div>
                )}

                {!loading && error && <div className="text-sm text-rose-600 py-8 text-center">{error}</div>}

                {!loading && s && !s.hasData && (
                  <div className="text-center py-12 space-y-2">
                    <div className="text-3xl" aria-hidden>📭</div>
                    <p className="text-sm font-medium">No portfolio data yet for {firstName}.</p>
                    <p className="text-xs text-muted-foreground">
                      Import their portfolio first via <span className="font-semibold">RTA File Imports</span>.
                    </p>
                  </div>
                )}

                {!loading && s && s.hasData && (
                  <>
                    {/* Big stat cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <StatCard icon={<TrendingUp className="size-4" />} label="Current Value" value={inr(s.currentValue)} accent="text-emerald-600" />
                      <StatCard icon={<PiggyBank className="size-4" />} label="Added This Year" value={inr(s.invested)} accent="text-brand-cyan" />
                      <StatCard
                        icon={<Sparkles className="size-4" />}
                        label="SIP Discipline"
                        value={`${s.sipInstallments} mos`}
                        sub={s.sipTotal > 0 ? `${inr(s.sipTotal)} total` : undefined}
                        accent="text-violet-600"
                      />
                      <StatCard
                        icon={<Trophy className="size-4" />}
                        label="Fund Houses"
                        value={String(s.amcCount)}
                        sub={`${s.holdingsCount} schemes`}
                        accent="text-amber-600"
                      />
                    </div>

                    {/* Asset Allocation Breakdown */}
                    {s.assetAllocation && s.assetAllocation.length > 0 && (
                      <div className="p-4 rounded-xl border border-border/80 bg-secondary/30 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                            <PieChart className="size-3.5 text-brand-navy" /> Asset Allocation Breakdown
                          </h3>
                          <span className="text-[11px] text-muted-foreground">100% Portfolio Coverage</span>
                        </div>
                        {/* Multi-segment progress bar */}
                        <div className="h-3 w-full rounded-full bg-muted overflow-hidden flex">
                          {s.assetAllocation.map((a, i) => {
                            const bgColors = ["bg-emerald-500", "bg-blue-500", "bg-amber-500", "bg-purple-500", "bg-teal-500"];
                            return (
                              <div
                                key={a.category}
                                className={`h-full ${bgColors[i % bgColors.length]} transition-all`}
                                style={{ width: `${a.pct}%` }}
                                title={`${a.category}: ${a.pct}%`}
                              />
                            );
                          })}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                          {s.assetAllocation.map((a, i) => {
                            const dotColors = ["bg-emerald-500", "bg-blue-500", "bg-amber-500", "bg-purple-500", "bg-teal-500"];
                            return (
                              <div key={a.category} className="flex items-center gap-1.5">
                                <span className={`size-2 rounded-full ${dotColors[i % dotColors.length]}`} />
                                <span className="text-muted-foreground truncate">{a.category}:</span>
                                <span className="font-semibold text-foreground">{a.pct}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Top Holdings */}
                    {s.topHoldings && s.topHoldings.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                          <Boxes className="size-3.5 text-brand-cyan" /> Top Portfolio Holdings
                        </h3>
                        <div className="space-y-1.5">
                          {s.topHoldings.map((h, i) => (
                            <div key={i} className="flex items-center justify-between rounded-lg border border-border/70 p-2.5 bg-card">
                              <div className="truncate mr-3">
                                <span className="font-medium text-foreground block truncate">{h.name}</span>
                                {h.category && <span className="text-[10px] text-muted-foreground">{h.category}</span>}
                              </div>
                              <div className="text-right shrink-0">
                                <span className="font-bold text-foreground block tabular-nums">{inr(h.value)}</span>
                                <span className="text-[10px] text-muted-foreground">{h.sharePct}% of portfolio</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Goals */}
                    {s.goals.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                          <Target className="size-3.5 text-brand-cyan" /> Goals in Motion
                        </h3>
                        <div className="space-y-1.5">
                          {s.goals.map((g, i) => (
                            <div key={i} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 bg-card">
                              <span className="truncate mr-3 font-medium">{g.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                target <span className="font-semibold text-foreground">{inr(g.targetAmount)}</span>
                                {g.progressPct != null && <> · {Math.round(g.progressPct)}% there</>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Highlights */}
                    {s.funFacts.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {s.funFacts.map((f, i) => (
                          <span key={i} className="chip bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300 text-xs">
                            <span aria-hidden>🎉</span> {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Footer ── */}
              <div className="border-t px-4 py-3 bg-card shrink-0 space-y-2">
                {notice && (
                  <div className={`text-xs inline-flex items-center gap-1 ${notice.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>
                    {notice.kind === "ok" && <Check className="size-3.5" />} {notice.text}
                  </div>
                )}
                {emailOpen && s?.hasData && (
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      placeholder="client@email.com"
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
                    />
                    <button type="button" onClick={onEmail} disabled={busy !== null} className="btn-primary text-xs">
                      {busy === "email" ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />} Send Review Pack
                    </button>
                    <button type="button" onClick={() => setEmailOpen(false)} className="btn-secondary text-xs">
                      Cancel
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" onClick={onDownload} disabled={busy !== null || !s?.hasData} className="btn-secondary text-xs inline-flex items-center gap-1">
                    {busy === "pdf" ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />} Download 4-Page PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEmailOpen((v) => !v); setNotice(null); }}
                    disabled={busy !== null || !s?.hasData}
                    className="btn-primary text-xs inline-flex items-center gap-1"
                  >
                    <Mail className="size-3.5" /> Email to Client
                  </button>
                  <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-xs">
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-3">
      <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
        <span className={accent}>{icon}</span> {label}
      </div>
      <div className={`mt-1 font-bold text-sm ${accent}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
