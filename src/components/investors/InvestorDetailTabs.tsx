"use client";

/**
 * InvestorDetailTabs — groups the client-detail page's sections into category
 * tabs so the page shows one clean group at a time instead of a dense wall.
 *
 * It works the SAME way as RelatedListsManager: it leaves the server-rendered
 * section JSX untouched and injects scoped CSS keyed on `[data-rl-section]` to
 * hide the sections that don't belong to the active tab (and fade-in the ones
 * that do). Because it only adds `display:none` / an animation, it composes
 * cleanly with the existing show/hide/reorder customization — all logic,
 * components and field-gating are preserved.
 *
 * Sections NOT listed in any tab (e.g. the header) are never touched → they
 * stay pinned above the tab content as persistent context.
 */

import { useEffect, useState } from "react";
import {
  LayoutGrid,
  Wallet,
  ShieldCheck,
  MessagesSquare,
  FileText,
  Activity,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

export type DetailTab = { key: string; label: string; icon?: LucideIcon; sections: string[] };

const ICONS: Record<string, LucideIcon> = {
  overview: LayoutGrid,
  portfolio: Wallet,
  profile: ShieldCheck,
  engagement: MessagesSquare,
  details: FileText,
  activity: Activity,
  more: MoreHorizontal,
};

export function InvestorDetailTabs({ moduleKey, tabs }: { moduleKey: string; tabs: DetailTab[] }) {
  const storageKey = `nd-tab:${moduleKey}`;
  const [active, setActive] = useState<string>(tabs[0]?.key ?? "");

  // Restore the last-used tab (per browser) after hydration.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && tabs.some((t) => t.key === saved)) setActive(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, active);
    } catch {}
  }, [active, storageKey]);

  const managed = new Set(tabs.flatMap((t) => t.sections));
  const activeSet = new Set(tabs.find((t) => t.key === active)?.sections ?? []);

  // Hide every tab-managed section that isn't in the active tab; fade-in the
  // ones that are. Rendered server-side too (with the default tab), so the page
  // loads already focused on one tab — no flash of every section.
  const css =
    [...managed]
      .filter((k) => !activeSet.has(k))
      .map((k) => `[data-rl-module="${moduleKey}"][data-rl-section="${k}"]{display:none!important;}`)
      .join("\n") +
    "\n" +
    [...activeSet]
      .map((k) => `[data-rl-module="${moduleKey}"][data-rl-section="${k}"]{animation:nd-tab-in .28s ease both;}`)
      .join("\n") +
    "\n@keyframes nd-tab-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}";

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="flex gap-1 overflow-x-auto scrollbar-none border-b border-border">
        {tabs.map((t) => {
          const Icon = t.icon ?? ICONS[t.key];
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`relative inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                on ? "text-brand-cyan-deep" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {Icon && <Icon className="size-4" />}
              {t.label}
              {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-cyan-deep" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
