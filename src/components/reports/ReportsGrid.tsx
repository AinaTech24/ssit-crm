"use client";

/**
 * Reports list with search + per-user "hide report" support.
 *
 * The canned reports are built-in (defined in code, shared across tenants) — so
 * an MFD can't truly delete one, but they CAN hide the ones they don't use to
 * declutter their view. Hidden keys persist to localStorage per user/device.
 *
 * Search filters across every group by report name (or group name). Hover a row
 * → × to hide it; "Manage hidden" reveals hidden rows (dimmed) with a ↺ to
 * restore, plus "Restore all".
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3, TrendingUp, TrendingDown, Users, Filter, AlertTriangle, FileText,
  Calendar, Briefcase, Shield, ShieldCheck, Clock, CheckCircle2, ListChecks,
  Megaphone, X, RotateCcw, Search, ChevronRight, type LucideIcon,
  Star,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  BarChart3, TrendingUp, TrendingDown, Users, Filter, AlertTriangle, FileText,
  Calendar, Briefcase, Shield, ShieldCheck, Clock, CheckCircle2, ListChecks, Megaphone,
};

type Item = { key: string; label: string; iconName: string; href: string; desc?: string };
type Section = { group: string; items: Item[] };

const LS_KEY = "ssit:hidden-reports:v1";
const FAV_KEY = "ssit:favorite-reports:v1";
const RECENT_KEY = "ssit:recent-reports:v1";
const OPEN_KEY = "ssit:open-report-groups:v1";

export function ReportsGrid({ sections }: { sections: Section[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [manage, setManage] = useState(false);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<string[]>([]);
  // Groups start collapsed — the page reads as a hub, not an 80-row wall.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
      const fav = localStorage.getItem(FAV_KEY);
      if (fav) setFavorites(new Set(JSON.parse(fav) as string[]));
      const rec = localStorage.getItem(RECENT_KEY);
      if (rec) setRecent(JSON.parse(rec) as string[]);
      const og = localStorage.getItem(OPEN_KEY);
      if (og) setOpenGroups(new Set(JSON.parse(og) as string[]));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  function save(next: Set<string>) {
    setHidden(new Set(next));
    try {
      localStorage.setItem(LS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }
  const hide = (k: string) => { const n = new Set(hidden); n.add(k); save(n); };
  const restore = (k: string) => { const n = new Set(hidden); n.delete(k); save(n); };
  const hiddenCount = hidden.size;

  const allItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const itemByKey = useMemo(() => new Map(allItems.map((item) => [item.key, item])), [allItems]);

  function toggleFavorite(key: string) {
    const next = new Set(favorites);
    if (next.has(key)) next.delete(key); else next.add(key);
    setFavorites(next);
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }

  function toggleGroup(group: string) {
    const next = new Set(openGroups);
    if (next.has(group)) next.delete(group); else next.add(group);
    setOpenGroups(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }

  function rememberRecent(key: string) {
    const next = [key, ...recent.filter((value) => value !== key)].slice(0, 6);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // Build the visible sections: apply hide-state (unless managing) + the search.
  const ql = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const base = sections
      .map((section) => {
        const groupMatch = !!ql && section.group.toLowerCase().includes(ql);
        let items = !ready ? section.items : manage ? section.items : section.items.filter((it) => !hidden.has(it.key));
        if (ql) items = items.filter((it) => groupMatch || it.label.toLowerCase().includes(ql));
        return { group: section.group, items };
      })
      .filter((s) => s.items.length > 0);
    if (!ready || manage || ql) return base;
    const pinned = [...favorites].map((key) => itemByKey.get(key)).filter((item): item is Item => !!item && !hidden.has(item.key));
    const usedRecently = recent.map((key) => itemByKey.get(key)).filter((item): item is Item => !!item && !hidden.has(item.key) && !favorites.has(item.key));
    return [
      ...(pinned.length ? [{ group: "Favorites", items: pinned }] : []),
      ...(usedRecently.length ? [{ group: "Recent", items: usedRecently }] : []),
      ...base,
    ];
  }, [sections, ready, manage, hidden, ql, favorites, recent, itemByKey]);

  const totalMatches = visible.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="space-y-4">
      {/* Search + manage controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports…"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          {ready && manage && hiddenCount > 0 && (
            <button type="button" onClick={() => save(new Set())} className="text-brand-cyan-deep hover:underline font-medium">
              Restore all
            </button>
          )}
          {ready && (hiddenCount > 0 || manage) && (
            <button type="button" onClick={() => setManage((m) => !m)} className="btn-secondary text-xs px-2.5 py-1">
              {manage ? "Done" : `Manage hidden (${hiddenCount})`}
            </button>
          )}
        </div>
      </div>

      {totalMatches === 0 ? (
        <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No reports match “{query}”.{" "}
          <button type="button" onClick={() => setQuery("")} className="text-brand-cyan-deep hover:underline">Clear search</button>
        </div>
      ) : (
        visible.map((section) => {
          const pinnedGroup = section.group === "Favorites" || section.group === "Recent";
          const isOpen = pinnedGroup || !!ql || manage || openGroups.has(section.group);
          return (
          <section key={section.group}>
            {pinnedGroup ? (
              <h2 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{section.group}</h2>
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(section.group)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-2 mb-1.5 group/hdr"
              >
                <ChevronRight className={`size-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                <h2 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground group-hover/hdr:text-foreground transition-colors">{section.group}</h2>
                <span className="text-[10px] text-muted-foreground/70 tabular-nums">{section.items.length}</span>
              </button>
            )}
            {isOpen && (
            <div className="rounded-lg border border-border bg-card divide-y divide-border/60 overflow-hidden">
              {section.items.map((r) => {
                const Icon = ICONS[r.iconName] ?? BarChart3;
                const isHidden = ready && hidden.has(r.key);
                return (
                  <div key={r.key} className={`group flex items-center ${isHidden ? "opacity-50" : ""}`}>
                    <Link href={r.href} onClick={() => rememberRecent(r.key)} className="flex-1 flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40 transition-colors min-w-0">
                      <Icon className="size-4 text-muted-foreground shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{r.label}</span>
                        {r.desc && <span className="block text-[11px] text-muted-foreground truncate">{r.desc}</span>}
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground/40 ml-auto shrink-0" />
                    </Link>
                    {ready && (
                      isHidden ? (
                        <button
                          type="button"
                          onClick={() => restore(r.key)}
                          aria-label={`Restore ${r.label}`}
                          title="Restore report"
                          className="px-3 self-stretch grid place-items-center text-emerald-600 hover:bg-emerald-50"
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => hide(r.key)}
                          aria-label={`Hide ${r.label}`}
                          title="Hide this report"
                          className="px-3 self-stretch grid place-items-center text-muted-foreground hover:bg-rose-50 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <X className="size-3.5" />
                        </button>
                      )
                    )}
                    {ready && !isHidden && (
                      <button type="button" onClick={() => toggleFavorite(r.key)} aria-label={`${favorites.has(r.key) ? "Remove" : "Add"} ${r.label} ${favorites.has(r.key) ? "from" : "to"} favorites`} title={favorites.has(r.key) ? "Remove from favorites" : "Add to favorites"} className={`px-3 self-stretch grid place-items-center ${favorites.has(r.key) ? "text-primary" : "text-muted-foreground hover:text-primary"}`}><Star className="size-3.5" fill={favorites.has(r.key) ? "currentColor" : "none"} /></button>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </section>
          );
        })
      )}
    </div>
  );
}
