"use client";

/**
 * Personalizable sidebar navigation.
 *
 * The server passes the full, role/module-filtered list of nav items (each with
 * a pre-rendered icon and its default group). This client component lets each
 * user:
 *   • search modules by name,
 *   • drag to reorder modules (within and across groups),
 *   • create / rename / delete their own groups,
 * and persists the personalized layout to localStorage (per user, per device).
 *
 * New modules the user gains access to are auto-appended to their default group;
 * modules they lose access to are dropped silently — so the saved layout never
 * goes stale.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DashboardNavDropdown, type DashboardSubItem } from "./DashboardNavDropdown";
import {
  Search, Pencil, Check, Plus, GripVertical, X, RotateCcw, Circle, ChevronDown, ChevronRight, ChevronUp, Star,
  // ── nav module icons (rendered here by name; see ICONS map) ──
  Activity, AlertTriangle, BarChart3, Bot, Boxes, Briefcase, Cake, Calculator,
  Calendar, CalendarCheck, CalendarOff, ClipboardCheck, Copy, CreditCard,
  FileSignature, FileText, FolderArchive, GitBranch, HeartHandshake, Image as ImageIcon,
  Inbox, LayoutDashboard, ListChecks, Megaphone, MessageSquare, PhoneCall, PieChart,
  Radio, Repeat, Scale, ScrollText, Shield, ShieldCheck, Sparkles, Target, TrendingUp,
  UserCog, Users, Users2, Wallet, Workflow, XOctagon,
  // ── unique-icon replacements for the de-duplicated sidebar ──
  UserPlus, Presentation, CalendarClock, ShieldAlert, LayoutTemplate, Library, Gauge,
  FileCheck, UserCheck, ClipboardList, Newspaper, Stamp, BellRing, Package, Folder, FolderOpen,
  LineChart, Scissors, Shuffle, Building2, TrendingDown, Network, IndianRupee,
  LifeBuoy, MessageSquareWarning, Zap, GraduationCap,
  type LucideIcon,
} from "lucide-react";

/**
 * Name → component map for every icon the sidebar nav uses. The server passes a
 * string name (the lucide displayName) rather than a pre-rendered element —
 * passing a lucide element across the RSC boundary makes React try to serialize
 * the icon as a client reference, which fails ("module not in client manifest").
 * Unknown names fall back to a neutral dot.
 */
const ICON_LIST: LucideIcon[] = [
  Activity, AlertTriangle, BarChart3, Bot, Boxes, Briefcase, Cake, Calculator,
  Calendar, CalendarCheck, CalendarOff, ClipboardCheck, Copy, CreditCard,
  FileSignature, FileText, FolderArchive, GitBranch, HeartHandshake, ImageIcon,
  Inbox, LayoutDashboard, ListChecks, Megaphone, MessageSquare, PhoneCall, PieChart,
  Radio, Repeat, Scale, ScrollText, Shield, ShieldCheck, Sparkles, Target, TrendingUp,
  UserCog, Users, Users2, Wallet, Workflow, XOctagon,
  UserPlus, Presentation, CalendarClock, ShieldAlert, LayoutTemplate, Library, Gauge,
  FileCheck, UserCheck, ClipboardList, Newspaper, Stamp, BellRing, Package, FolderOpen,
  LineChart, Scissors, Shuffle, Building2, TrendingDown, Network, IndianRupee,
  LifeBuoy, MessageSquareWarning, Zap, GraduationCap,
];

/* Keyed by each icon's lucide `displayName` (the canonical name) — which is
   exactly what layout.tsx derives `iconName` from. Lucide renamed many icons
   (FileSignature → FilePenLine, BarChart3 → ChartColumn, XOctagon → OctagonX,
   AlertTriangle → TriangleAlert, PieChart → ChartPie, LineChart → ChartLine, …).
   The old import-name keying missed those aliases and fell back to a generic
   circle; keying by displayName resolves the aliases and any future renames. */
export const ICONS: Record<string, LucideIcon> = Object.fromEntries(
  ICON_LIST.map((icon) => [
    (icon as { displayName?: string }).displayName ?? (icon as { name?: string }).name ?? "",
    icon,
  ])
);

export type NavItemData = {
  href: string;
  label: string;
  iconName: string; // lucide displayName, resolved client-side via ICONS
  defaultGroup: string; // default section title ("" = the top, header-less group)
  /** Optional count badge (e.g. active announcements). Survives reconcile
   *  because the layout stores only hrefs and resolves item data from itemMap. */
  badge?: number;
  /** Module is in BETA (platform Module Controls) — shows a "Beta" tag. */
  beta?: boolean;
};

type Group = { id: string; title: string; items: string[] /* hrefs */ };
type SavedLayout = { v: number; groups: Group[] };

const VERSION = 2;

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
}

function buildDefault(items: NavItemData[]): Group[] {
  const groups: Group[] = [];
  const byId = new Map<string, Group>();
  for (const it of items) {
    const title = it.defaultGroup ?? "";
    const id = title === "" ? "main" : slug(title);
    let g = byId.get(id);
    if (!g) {
      g = { id, title, items: [] };
      byId.set(id, g);
      groups.push(g);
    }
    g.items.push(it.href);
  }
  return groups;
}

/** Merge a saved layout with the currently-available items. */
function reconcile(saved: SavedLayout | null, items: NavItemData[]): Group[] {
  if (!saved || saved.v !== VERSION || !Array.isArray(saved.groups)) return buildDefault(items);
  const available = new Map(items.map((i) => [i.href, i]));
  const seen = new Set<string>();
  const groups: Group[] = saved.groups.map((g) => ({
    id: g.id,
    title: g.title ?? "",
    items: (g.items || []).filter((h) => {
      if (available.has(h) && !seen.has(h)) {
        seen.add(h);
        return true;
      }
      return false;
    }),
  }));
  // Append newly-available items to a group matching their default title.
  for (const it of items) {
    if (seen.has(it.href)) continue;
    const title = it.defaultGroup ?? "";
    let g = groups.find((x) => x.title === title);
    if (!g) {
      g = { id: title === "" ? "main" : slug(title), title, items: [] };
      groups.push(g);
    }
    g.items.push(it.href);
    seen.add(it.href);
  }
  return groups;
}

export function CustomizableNav({
  items,
  storageKey,
  dashboardSubItems,
  showDashboards = true,
}: {
  items: NavItemData[];
  storageKey: string;
  dashboardSubItems?: DashboardSubItem[];
  /** Platform "dashboards" module — hides the top Dashboards dropdown when off. */
  showDashboards?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const itemMap = useMemo(() => new Map(items.map((i) => [i.href, i])), [items]);

  const [layout, setLayout] = useState<Group[]>(() => buildDefault(items));
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [dragHref, setDragHref] = useState<string | null>(null);
  // Group drag-to-reorder + the inline "new group" composer (name + modules),
  // replacing the old window.prompt.
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupModules, setNewGroupModules] = useState<Set<string>>(new Set());
  // Per-group collapse state (groupId → collapsed). Defaults to expanded; the
  // user can collapse a section like the Dashboards dropdown. Persisted per user.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Favourites — hrefs the user pinned to a "Pinned" section at the very top, so
  // the 60+ item menu isn't a daily scroll. Persisted per user/device.
  const [pinned, setPinned] = useState<string[]>([]);
  const loadedRef = useRef(false);
  const collapseKey = `${storageKey}:collapsed`;
  const pinKey = `${storageKey}:pinned`;

  // Load saved layout once on mount, reconciled against current access.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setLayout(reconcile(raw ? (JSON.parse(raw) as SavedLayout) : null, items));
    } catch {
      setLayout(buildDefault(items));
    }
    loadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist on change (after the initial load).
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ v: VERSION, groups: layout }));
    } catch {
      /* ignore quota / disabled storage */
    }
  }, [layout, storageKey]);

  // Load + persist per-group collapse state.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(collapseKey);
      if (raw) setCollapsed(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(collapseKey, JSON.stringify(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed, collapseKey]);

  function toggleCollapse(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Load + persist pinned favourites.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(pinKey);
      if (raw) setPinned(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey]);
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(pinKey, JSON.stringify(pinned));
    } catch {
      /* ignore */
    }
  }, [pinned, pinKey]);
  function togglePin(href: string) {
    setPinned((prev) => (prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]));
  }
  const pinnedSet = new Set(pinned);
  // Only pinned items the user still has access to, in pin order.
  const pinnedItems = pinned.map((h) => itemMap.get(h)).filter((it): it is NavItemData => !!it);

  // Whether a pathname falls under an href (exact, or a "/"-bounded sub-route).
  const matchesPath = (h: string) =>
    h === "/dashboard" ? pathname === "/dashboard" : pathname === h || pathname.startsWith(h + "/");
  // Most-specific match wins: a link is active only if NO other nav item has a
  // longer href that also matches. Fixes "/dashboard/sips" (SIP Tracker) lighting
  // up on "/dashboard/sips/at-risk" (SIP At-Risk).
  const isActive = (href: string) => {
    if (!matchesPath(href)) return false;
    return !items.some((i) => i.href !== href && i.href.length > href.length && matchesPath(i.href));
  };

  /* ---------------- layout mutations ---------------- */

  function moveItem(href: string, toGroupId: string, beforeHref: string | null) {
    setLayout((prev) => {
      const next = prev.map((g) => ({ ...g, items: g.items.filter((h) => h !== href) }));
      const target = next.find((g) => g.id === toGroupId);
      if (!target) return prev;
      if (beforeHref && beforeHref !== href) {
        const idx = target.items.indexOf(beforeHref);
        target.items.splice(idx < 0 ? target.items.length : idx, 0, href);
      } else {
        target.items.push(href);
      }
      return next;
    });
  }

  function openAddGroup() {
    setShowAddGroup((s) => !s);
    setNewGroupName("");
    setNewGroupModules(new Set());
  }
  function toggleNewGroupModule(href: string) {
    setNewGroupModules((prev) => {
      const n = new Set(prev);
      if (n.has(href)) n.delete(href);
      else n.add(href);
      return n;
    });
  }
  function createGroup() {
    const title = newGroupName.trim();
    if (!title) return; // a group needs a name
    const chosen = newGroupModules;
    setLayout((prev) => {
      // A module lives in exactly one group — pull the chosen ones out of
      // wherever they are, then drop them into the new group at the TOP.
      const stripped = prev.map((g) => ({ ...g, items: g.items.filter((h) => !chosen.has(h)) }));
      const id = `g-${slug(title)}-${prev.length}-${Math.floor(Math.random() * 1e4)}`;
      return [{ id, title, items: [...chosen] }, ...stripped];
    });
    setShowAddGroup(false);
    setNewGroupName("");
    setNewGroupModules(new Set());
  }
  /** Reorder by dropping the dragged group onto another (insert before target). */
  function moveGroupBefore(dragId: string, targetId: string) {
    if (dragId === targetId) return;
    setLayout((prev) => {
      const from = prev.findIndex((g) => g.id === dragId);
      if (from < 0) return prev;
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      const to = arr.findIndex((g) => g.id === targetId);
      if (to < 0) return prev;
      arr.splice(to, 0, moved);
      return arr;
    });
  }
  function moveGroup(id: string, dir: -1 | 1) {
    setLayout((prev) => {
      const idx = prev.findIndex((g) => g.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  }
  function renameGroup(id: string, title: string) {
    setLayout((prev) => prev.map((g) => (g.id === id ? { ...g, title } : g)));
  }
  function deleteGroup(id: string) {
    setLayout((prev) => {
      const idx = prev.findIndex((g) => g.id === id);
      if (idx < 0) return prev;
      const victim = prev[idx];
      const fallback = prev[idx === 0 ? 1 : 0];
      if (!fallback) return prev; // never delete the only group
      const next = prev.filter((g) => g.id !== id).map((g) => (g.id === fallback.id ? { ...g, items: [...g.items, ...victim.items] } : g));
      return next;
    });
  }
  function resetLayout() {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Reset the sidebar to its default layout? Your custom groups and order will be removed.")
    )
      return;
    setLayout(buildDefault(items));
  }

  /* ---------------- search view ---------------- */
  const q = query.trim().toLowerCase();
  const searchResults = q
    ? layout.flatMap((g) => g.items).map((h) => itemMap.get(h)!).filter((it) => it && it.label.toLowerCase().includes(q))
    : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Search + edit toolbar — hidden when the rail is collapsed to icons */}
      <div className="sidebar-when-expanded px-3 pt-3 pb-1 space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules…"
              disabled={editing}
              className="w-full rounded-lg border border-border bg-secondary/40 pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 disabled:opacity-50"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {/* Customize toggle — icon only, sits next to the search box. */}
          <button
            type="button"
            onClick={() => { setEditing((e) => !e); setQuery(""); }}
            title={editing ? "Done customizing" : "Customize sidebar"}
            aria-label={editing ? "Done customizing" : "Customize sidebar"}
            className={`shrink-0 inline-grid place-items-center size-[34px] rounded-lg transition-colors ${editing ? "bg-brand-cyan-light text-brand-cyan-deep" : "text-muted-foreground hover:bg-secondary border border-border"}`}
          >
            {editing ? <Check className="size-4" /> : <Pencil className="size-4" />}
          </button>
        </div>
        {editing && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={openAddGroup} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-brand-cyan-deep hover:bg-brand-cyan-light/60" title="Add a group">
              <Plus className="size-3.5" /> Group
            </button>
            <button type="button" onClick={resetLayout} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-muted-foreground hover:bg-secondary" title="Reset to default">
              <RotateCcw className="size-3" /> Reset
            </button>
          </div>
        )}
      </div>

      <nav data-tour="sidebar" className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2 space-y-6 scrollbar-thin">
        {/* Combined Dashboards dropdown (Dashboard + My Dashboards + Team) — pinned top */}
        {!searchResults && showDashboards && <DashboardNavDropdown items={dashboardSubItems} />}
        {/* ⭐ Pinned favourites — the user's own shortcuts, above every group, so
            the long menu isn't a daily scroll. Hidden while editing/searching. */}
        {!searchResults && !editing && pinnedItems.length > 0 && (
          <div>
            <div className="sidebar-section-title px-2 mb-2.5 flex items-center gap-1.5">
              <Star className="size-3 fill-amber-400 text-amber-400 shrink-0" />
              <span className="flex-1 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">Pinned</span>
            </div>
            <div className="space-y-1">
              {pinnedItems.map((it) => (
                <NavRow
                  key={`pin-${it.href}`}
                  item={it}
                  active={isActive(it.href)}
                  onNavigate={() => setQuery("")}
                  pinned
                  onTogglePin={() => togglePin(it.href)}
                />
              ))}
            </div>
          </div>
        )}
        {/* Inline "new group" composer — name + pick modules; group lands at top. */}
        {editing && showAddGroup && !searchResults && (
          <AddGroupForm
            name={newGroupName}
            setName={setNewGroupName}
            items={items}
            selected={newGroupModules}
            toggle={toggleNewGroupModule}
            onCreate={createGroup}
            onCancel={() => setShowAddGroup(false)}
          />
        )}
        {/* ---- search results (flat) ---- */}
        {searchResults ? (
          <div className="space-y-0.5">
            {searchResults.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">No modules match “{query}”.</div>
            ) : (
              searchResults.map((it) => (
                <NavRow key={it.href} item={it} active={isActive(it.href)} onNavigate={() => setQuery("")} />
              ))
            )}
          </div>
        ) : (
          /* ---- grouped layout ---- */
          layout.map((g) => {
            // De-duplicate: a pinned item lives in the Pinned section only, not
            // again inside its group (while editing we show everything so the
            // full set stays draggable).
            const visibleItems = editing ? g.items : g.items.filter((h) => !pinnedSet.has(h));
            if (!editing && visibleItems.length === 0) return null;
            const titled = g.title !== "";
            // A titled section is a collapsible dropdown (like Dashboards). The
            // header-less top group + edit mode always show their items.
            const isCollapsed = !editing && titled && !!collapsed[g.id];
            const groupActive = visibleItems.some((h) => isActive(h));
            return (
              <div
                key={g.id}
                onDragOver={editing ? (e) => e.preventDefault() : undefined}
                onDrop={
                  editing
                    ? (e) => {
                        e.preventDefault();
                        // A group drag reorders; otherwise it's a module drop.
                        if (dragGroupId) {
                          moveGroupBefore(dragGroupId, g.id);
                          setDragGroupId(null);
                        } else if (dragHref) {
                          moveItem(dragHref, g.id, null);
                          setDragHref(null);
                        }
                      }
                    : undefined
                }
                className={`rounded-lg transition-[opacity] ${dragGroupId === g.id ? "opacity-50" : ""}`}
              >
                {editing ? (
                  <div className="sidebar-section-title px-2 mb-2 flex items-center gap-1">
                    <span
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); setDragGroupId(g.id); }}
                      onDragEnd={() => setDragGroupId(null)}
                      className="cursor-grab text-muted-foreground/50 hover:text-foreground shrink-0"
                      title="Drag to reorder this group"
                    >
                      <GripVertical className="size-3.5" />
                    </span>
                    <input
                      value={g.title}
                      onChange={(e) => renameGroup(g.id, e.target.value)}
                      placeholder="Group name"
                      className="flex-1 min-w-0 bg-transparent text-[10px] font-bold uppercase tracking-[0.1em] text-foreground/70 border-b border-dashed border-border focus:outline-none focus:ring-0 focus:border-brand-cyan"
                    />
                    {layout.length > 1 && (
                      <>
                        <button type="button" onClick={() => moveGroup(g.id, -1)} disabled={layout[0]?.id === g.id} className="text-muted-foreground hover:text-foreground disabled:opacity-25" title="Move group up">
                          <ChevronUp className="size-3" />
                        </button>
                        <button type="button" onClick={() => moveGroup(g.id, 1)} disabled={layout[layout.length - 1]?.id === g.id} className="text-muted-foreground hover:text-foreground disabled:opacity-25" title="Move group down">
                          <ChevronDown className="size-3" />
                        </button>
                        <button type="button" onClick={() => deleteGroup(g.id)} className="text-muted-foreground hover:text-rose-600" title="Delete group (items move to the first group)">
                          <X className="size-3" />
                        </button>
                      </>
                    )}
                  </div>
                ) : titled ? (
                  <button
                    type="button"
                    onClick={() => toggleCollapse(g.id)}
                    aria-expanded={!isCollapsed}
                    className="sidebar-section-title group/sec w-full px-2 py-1.5 mb-0.5 flex items-center gap-2 text-left rounded-md hover:bg-secondary/70 transition-colors"
                  >
                    {/* Folder icon — open when expanded, closed when collapsed. */}
                    {isCollapsed ? (
                      <Folder className="size-[18px] shrink-0 text-brand-cyan" />
                    ) : (
                      <FolderOpen className="size-[18px] shrink-0 text-brand-cyan" />
                    )}
                    <span className={`flex-1 truncate text-[11px] font-bold tracking-wide transition-colors ${groupActive ? "text-brand-navy" : "text-foreground"}`}>
                      {g.title}
                    </span>
                    {/* A small dot when a collapsed folder holds the current page. */}
                    {isCollapsed && groupActive && (
                      <span className="shrink-0 size-1.5 rounded-full bg-brand-navy" aria-hidden />
                    )}
                    {/* Chevron on the right — ▼ collapsed, ▲ when expanded. */}
                    <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover/sec:text-muted-foreground ${isCollapsed ? "" : "rotate-180"}`} />
                  </button>
                ) : null}

                {/* Items stay mounted; when the section is collapsed we hide them
                    via CSS so the icon-rail still shows every glyph. */}
                <div className={`nav-sec-body space-y-1 min-h-[8px] ${titled && !editing ? "ml-[17px] pl-2 border-l border-border/60" : ""} ${isCollapsed || dragGroupId === g.id ? "nav-sec-collapsed" : ""}`}>
                  {visibleItems.map((href) => {
                    const it = itemMap.get(href);
                    if (!it) return null;
                    return (
                      <NavRow
                        key={href}
                        item={it}
                        active={isActive(href)}
                        editing={editing}
                        dragging={dragHref === href}
                        onNavigate={() => setQuery("")}
                        onDragStart={() => setDragHref(href)}
                        onDragEnd={() => setDragHref(null)}
                        onDropBefore={() => { if (dragHref) moveItem(dragHref, g.id, href); setDragHref(null); }}
                        pinned={pinnedSet.has(href)}
                        onTogglePin={() => togglePin(href)}
                      />
                    );
                  })}
                  {editing && g.items.length === 0 && (
                    <div className="text-[10px] text-muted-foreground/60 italic px-2 py-2 border border-dashed border-border rounded-lg text-center">Drop modules here</div>
                  )}
                </div>
              </div>
            );
          })
        )}
        {editing && !searchResults && (
          <button
            type="button"
            onClick={openAddGroup}
            className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-[11px] font-semibold text-muted-foreground hover:text-brand-cyan-deep hover:border-brand-cyan/50 hover:bg-brand-cyan-light/30 py-2.5 transition-colors"
          >
            <Plus className="size-3.5" /> Add new group
          </button>
        )}
      </nav>
    </div>
  );
}

/* ---------------- single row ---------------- */

function NavRow({
  item,
  active,
  editing,
  dragging,
  onNavigate,
  onDragStart,
  onDragEnd,
  onDropBefore,
  pinned,
  onTogglePin,
}: {
  item: NavItemData;
  active: boolean;
  editing?: boolean;
  dragging?: boolean;
  onNavigate?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDropBefore?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const router = useRouter();
  const IconCmp = ICONS[item.iconName] ?? Circle;
  const content = (
    <>
      {editing && <GripVertical className="size-3.5 shrink-0 text-muted-foreground/60 cursor-grab" />}
      <IconCmp className="nav-link-icon" />
      <span className="truncate">{item.label}</span>
      {item.beta ? (
        <span className="nav-link-beta shrink-0 rounded bg-amber-100 text-amber-700 px-1 text-[9px] font-bold uppercase leading-[1.3] tracking-wide">
          Beta
        </span>
      ) : null}
      {!editing && item.badge ? (
        <span className="nav-link-badge ml-auto shrink-0 rounded-full bg-rose-500 px-1.5 min-w-[1.1rem] text-center text-[10px] font-semibold leading-[1.1rem] text-white">
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      ) : null}
      {/* Pin indicator — a subtle gold dot at rest for a pinned row; on row
          hover the dot yields to the star button (to unpin). An unpinned row
          shows nothing at rest and reveals the star on hover (to pin). Keeps the
          resting sidebar clean instead of studding every favourite with a star. */}
      {!editing && onTogglePin ? (
        <span className={`${item.badge ? "ml-1" : "ml-auto"} shrink-0 relative grid place-items-center size-3.5`}>
          {pinned && (
            <span className="size-[5px] rounded-full bg-amber-400 transition-opacity group-hover:opacity-0" aria-hidden />
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onTogglePin(); }}
            title={pinned ? "Unpin from top" : "Pin to top"}
            aria-label={pinned ? "Unpin from favourites" : "Pin to favourites"}
            className={`absolute inset-0 grid place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100 ${
              pinned ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground/60 hover:!text-amber-500"
            }`}
          >
            <Star className={`size-3.5 ${pinned ? "fill-amber-400" : ""}`} />
          </button>
        </span>
      ) : null}
    </>
  );

  if (editing) {
    return (
      <div
        data-href={item.href}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropBefore?.(); }}
        className={`group nav-link cursor-grab select-none ${dragging ? "opacity-40" : ""}`}
      >
        {content}
      </div>
    );
  }

  // Navigate programmatically (not via <a href>) so the browser never parks the
  // raw URL in its hover status-bar — keyboard-accessible via role="link".
  const go = () => { onNavigate?.(); router.push(item.href); };
  return (
    <div
      data-href={item.href}
      // Drives the collapsed icon-rail's pinned dot: there's no room for the
      // star glyph at rail width, so CSS marks the row with a dot above the icon.
      data-pinned={pinned ? "true" : undefined}
      role="link"
      tabIndex={0}
      aria-current={active ? "page" : undefined}
      onClick={go}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}
      className={`group nav-link cursor-pointer ${active ? "nav-link-active" : ""}`}
    >
      {content}
    </div>
  );
}

/* ---------------- inline "new group" composer ---------------- */

function AddGroupForm({
  name,
  setName,
  items,
  selected,
  toggle,
  onCreate,
  onCancel,
}: {
  name: string;
  setName: (v: string) => void;
  items: NavItemData[];
  selected: Set<string>;
  toggle: (href: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/20 p-2.5 space-y-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) onCreate();
          else if (e.key === "Escape") onCancel();
        }}
        placeholder="New group name"
        className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
      />
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
        Add modules{selected.size > 0 ? ` · ${selected.size} selected` : ""}
      </div>
      <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-0.5 rounded-md border border-border bg-card p-1">
        {items.map((it) => {
          const checked = selected.has(it.href);
          const Icon = ICONS[it.iconName] ?? Circle;
          return (
            <label
              key={it.href}
              className={`flex items-center gap-2 px-1.5 py-1 rounded text-xs cursor-pointer ${
                checked ? "bg-brand-cyan-light/50 text-brand-cyan-deep font-medium" : "hover:bg-secondary"
              }`}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(it.href)} className="size-3.5 rounded" />
              <Icon className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">{it.label}</span>
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCreate}
          disabled={!name.trim()}
          className="flex-1 rounded-md bg-primary text-primary-foreground text-xs font-medium py-1.5 disabled:opacity-50"
        >
          Create group
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border text-xs px-3 py-1.5 hover:bg-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
