"use client";

/**
 * CommandPalette 2.0 — Global Ctrl+K / ⌘K launcher with Omni-actions,
 * Recent records history, deep nav, and live record search.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  Circle,
  Zap,
  Sparkles,
  Users,
  ListChecks,
  Calendar,
  FileSignature,
  Phone,
  FileText,
  Repeat,
  LifeBuoy,
  FolderArchive,
  History,
  TrendingUp,
  Calculator,
  ShieldCheck,
  Building2,
  FolderSync,
  AlertTriangle,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { ICONS } from "./CustomizableNav";

type PaletteNavItem = {
  href: string;
  label: string;
  iconName: string;
  defaultGroup: string;
};

const RECENT_STORAGE_KEY = "ssit_recent_records";

type RecentRecord = {
  id: string;
  href: string;
  title: string;
  sub?: string;
  chip?: string;
};

/** Quick create actions + common power actions. */
const QUICK_ACTIONS: Array<{ href: string; label: string; sub: string; icon: LucideIcon }> = [
  { href: "/dashboard/leads/new", label: "Add Lead", sub: "New prospect (stages 1–10)", icon: Sparkles },
  { href: "/dashboard/investors/new", label: "Add Client", sub: "New investor (after KYC)", icon: Users },
  { href: "/dashboard/sips/new", label: "Register SIP", sub: "Setup new SIP installment", icon: TrendingUp },
  { href: "/dashboard/tasks/new", label: "Add Task", sub: "Reminder for yourself or team", icon: ListChecks },
  { href: "/dashboard/review-meetings/new", label: "Schedule Review", sub: "Client portfolio review meeting", icon: Calendar },
  { href: "/dashboard/proposals/new", label: "Create Proposal", sub: "Branded scheme proposal PDF", icon: FileSignature },
  { href: "/dashboard/service-requests/new", label: "Log Service Request", sub: "Track investor query / issue", icon: Phone },
  { href: "/dashboard/calculators", label: "Practice Calculators", sub: "SIP, SWP, Lumpsum, Delay cost", icon: Calculator },
  { href: "/dashboard/rta-imports", label: "RTA File Imports", sub: "CAMS / KFintech file ingestion", icon: FolderSync },
  { href: "/dashboard/sips?tab=rejections", label: "View Rejected SIPs", sub: "Bounced / failed SIP recovery", icon: AlertTriangle },
  { href: "/dashboard/compliance", label: "Compliance & DDQ", sub: "Audit readiness score & register", icon: ShieldCheck },
];

/** Response shape of GET /api/search */
type SearchResults = {
  investors?: any[];
  leads?: any[];
  folios?: any[];
  sips?: any[];
  serviceRequests?: any[];
  documents?: any[];
};

type Row = {
  key: string;
  href: string;
  title: string;
  suffix?: string;
  sub?: string;
  chip?: string;
  icon: LucideIcon;
};

type Section = { id: string; label: string; icon: LucideIcon; rows: Row[] };

export function CommandPalette({ navItems }: { navItems: PaletteNavItem[] }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchResults>({});
  const [busy, setBusy] = useState(false);
  const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(RECENT_STORAGE_KEY);
      if (saved) setRecentRecords(JSON.parse(saved).slice(0, 5));
    } catch {
      // ignore storage error
    }
  }, []);

  // Global Ctrl/⌘-K opens; Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset + focus on open; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults({});
    setActive(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults({});
      setBusy(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await res.json();
        if (!cancelled) setResults(j);
      } catch {
        if (!cancelled) setResults({});
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const saveRecent = (row: Row) => {
    if (row.key.startsWith("act:") || row.key.startsWith("nav:")) return;
    try {
      const rec: RecentRecord = {
        id: row.key,
        href: row.href,
        title: row.title,
        sub: row.sub,
        chip: row.chip,
      };
      const updated = [rec, ...recentRecords.filter((r) => r.href !== row.href)].slice(0, 5);
      setRecentRecords(updated);
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const sections = useMemo<Section[]>(() => {
    const needle = q.trim().toLowerCase();
    const isActionOnly = needle.startsWith(">");
    const cleanNeedle = isActionOnly ? needle.slice(1).trim() : needle;

    const actionRows: Row[] = QUICK_ACTIONS.filter(
      (a) => cleanNeedle === "" || a.label.toLowerCase().includes(cleanNeedle) || a.sub.toLowerCase().includes(cleanNeedle)
    ).map((a) => ({ key: `act:${a.href}`, href: a.href, title: a.label, sub: a.sub, icon: a.icon }));

    if (isActionOnly) {
      return [{ id: "actions", label: "Quick Actions", icon: Zap, rows: actionRows }];
    }

    const recentRows: Row[] = (needle === "" && recentRecords.length > 0)
      ? recentRecords.map((r) => ({
          key: r.id,
          href: r.href,
          title: r.title,
          sub: r.sub,
          chip: r.chip,
          icon: History,
        }))
      : [];

    const navRows: Row[] = navItems
      .filter(
        (n) =>
          cleanNeedle === "" ||
          n.label.toLowerCase().includes(cleanNeedle) ||
          n.defaultGroup.toLowerCase().includes(cleanNeedle)
      )
      .slice(0, 6)
      .map((n) => ({
        key: `nav:${n.href}`,
        href: n.href,
        title: n.label,
        suffix: n.defaultGroup || undefined,
        icon: ICONS[n.iconName] ?? Circle,
      }));

    const recordRows: Row[] = [
      ...(results.investors ?? []).map((r): Row => ({
        key: `inv:${r.id}`,
        href: `/dashboard/investors/${r.id}`,
        title: r.name,
        sub: `${r.pan ?? "—"} · ${r.segment_tag ?? "—"} · AUM: ₹${r.aum ? (r.aum / 100000).toFixed(1) + "L" : "0"}`,
        chip: "Client",
        icon: Users,
      })),
      ...(results.leads ?? []).map((r): Row => ({
        key: `lead:${r.id}`,
        href: `/dashboard/leads/${r.id}`,
        title: r.name,
        sub: `${r.stage} · ${r.source}`,
        chip: "Lead",
        icon: Sparkles,
      })),
      ...(results.folios ?? []).map((r): Row => ({
        key: `folio:${r.id}`,
        href: r.investor_id ? `/dashboard/investors/${r.investor_id}` : "/dashboard/investors",
        title: `Folio: ${r.folio_number}`,
        sub: `${r.amc_name} · ${r.investor_name ?? "—"}`,
        chip: "Folio",
        icon: FileText,
      })),
      ...(results.sips ?? []).map((r): Row => ({
        key: `sip:${r.id}`,
        href: "/dashboard/sips",
        title: r.scheme_name,
        sub: `₹${r.amount}/mo · ${r.investor_name ?? "—"}`,
        chip: "SIP",
        icon: Repeat,
      })),
      ...(results.serviceRequests ?? []).map((r): Row => ({
        key: `sr:${r.id}`,
        href: "/dashboard/service-requests",
        title: r.subject,
        sub: `${r.ticket_no} · ${r.investor_name ?? "—"}`,
        chip: "SR",
        icon: LifeBuoy,
      })),
    ];

    const out: Section[] = [];
    if (recentRows.length > 0) {
      out.push({ id: "recent", label: "Recently Visited", icon: History, rows: recentRows });
    }
    if (actionRows.length > 0) {
      out.push({ id: "actions", label: "Quick Actions", icon: Zap, rows: actionRows.slice(0, 6) });
    }
    if (recordRows.length > 0) {
      out.push({ id: "records", label: "Matching Records", icon: Search, rows: recordRows });
    }
    if (navRows.length > 0) {
      out.push({ id: "nav", label: "Navigation", icon: ArrowRight, rows: navRows });
    }
    return out;
  }, [q, navItems, results, recentRecords]);

  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  // Keep active index in bounds
  useEffect(() => {
    if (active >= flatRows.length) setActive(Math.max(0, flatRows.length - 1));
  }, [flatRows.length, active]);

  function pick(row: Row) {
    saveRecent(row);
    setOpen(false);
    router.push(row.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(1, flatRows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + flatRows.length) % Math.max(1, flatRows.length));
    } else if (e.key === "Enter" && flatRows[active]) {
      e.preventDefault();
      pick(flatRows[active]);
    }
  }

  if (!mounted || !open) return null;

  let flatIndex = -1;

  const content = (
    <div className="fixed inset-0 z-[140] flex items-start justify-center p-4 sm:p-6 md:p-20 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={() => setOpen(false)}
      />

      {/* Palette Container */}
      <div className="relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scale-in text-foreground">
        {/* Search bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-card">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command, client name, PAN, or folio (use '>' for actions)…"
            className="w-full bg-transparent border-0 outline-hidden text-sm placeholder:text-muted-foreground focus:ring-0"
          />
          {busy ? (
            <Loader2 className="size-4 animate-spin text-brand-cyan shrink-0" />
          ) : (
            <span className="text-[10px] uppercase font-bold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
              ESC
            </span>
          )}
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2 space-y-3 text-xs">
          {flatRows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm font-medium">No results found for “{q}”</p>
              <p className="text-xs text-muted-foreground mt-1">Try searching by PAN, Client Name, Folio, or Scheme.</p>
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.id} className="space-y-1">
                <div className="px-3 py-1 text-[11px] font-bold tracking-wider uppercase text-muted-foreground flex items-center gap-1.5">
                  <section.icon className="size-3 text-brand-navy" />
                  <span>{section.label}</span>
                </div>
                {section.rows.map((row) => {
                  flatIndex++;
                  const isCurrent = flatIndex === active;
                  const Icon = row.icon;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => pick(row)}
                      onMouseEnter={() => setActive(flatIndex)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                        isCurrent
                          ? "bg-brand-navy text-white font-medium shadow-sm"
                          : "text-foreground hover:bg-secondary/70"
                      }`}
                    >
                      <span
                        className={`size-7 rounded-lg grid place-items-center shrink-0 ${
                          isCurrent ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{row.title}</span>
                          {row.suffix && (
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded font-normal ${
                                isCurrent ? "bg-white/20 text-white" : "text-muted-foreground bg-muted"
                              }`}
                            >
                              {row.suffix}
                            </span>
                          )}
                          {row.chip && (
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ml-auto shrink-0 ${
                                isCurrent ? "bg-white/20 text-white" : "bg-brand-cyan-light text-brand-cyan-deep"
                              }`}
                            >
                              {row.chip}
                            </span>
                          )}
                        </div>
                        {row.sub && (
                          <div
                            className={`text-[11px] truncate mt-0.5 ${
                              isCurrent ? "text-white/80" : "text-muted-foreground"
                            }`}
                          >
                            {row.sub}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-t border-border text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-card border font-mono">↑</kbd> <kbd className="px-1 py-0.5 rounded bg-card border font-mono">↓</kbd> Navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-card border font-mono">↵</kbd> Select
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-card border font-mono">&gt;</kbd> Actions
            </span>
          </div>
          <span>Equitywala Growth OS</span>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
