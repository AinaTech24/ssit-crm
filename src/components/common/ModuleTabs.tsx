"use client";

/**
 * Module tab bar — the in-page switcher for a module whose views used to be
 * separate sidebar entries (SIP Book, Insurance, …). Consolidating them here
 * keeps one nav item per domain instead of five, while every view stays one
 * click away.
 *
 * Active tab = exact path match, or a prefix match for the module root when
 * `exact` is false (so /insurance/[id] still highlights "Policies").
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNavAllowed } from "@/components/layout/NavAccess";

export type ModuleTab = {
  href: string;
  label: string;
  /** Match this href exactly (default). Set false to also match child routes. */
  exact?: boolean;
};

export function ModuleTabs({ tabs: allTabs }: { tabs: ModuleTab[] }) {
  const pathname = usePathname() ?? "";
  const allowed = useNavAllowed();
  // A tab for a view this person has not been granted would open the "no access"
  // screen, so it is not offered. The tab they are on always stays.
  const tabs = allTabs.filter((t) => pathname === t.href || pathname.startsWith(t.href + "/") || allowed(t.href));

  const isActive = (t: ModuleTab) => {
    if (t.exact === false) return pathname === t.href || pathname.startsWith(t.href + "/");
    return pathname === t.href;
  };
  // If no tab matched exactly, fall back to the longest href that prefixes the
  // current path — keeps a detail page (…/insurance/abc) on its parent tab.
  const anyActive = tabs.some(isActive);
  const fallback = anyActive
    ? null
    : tabs
        .filter((t) => pathname.startsWith(t.href))
        .sort((a, b) => b.href.length - a.href.length)[0] ?? null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-border -mb-px">
      {tabs.map((t) => {
        const active = isActive(t) || t === fallback;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active
                ? "border-brand-navy text-brand-navy"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

/** The SIP module's views (was: SIP Tracker + SIP Rejections + SIP At-Risk). */
export const SIP_TABS: ModuleTab[] = [
  { href: "/dashboard/sips", label: "SIP Book" },
  { href: "/dashboard/sips/at-risk", label: "At-risk" },
  { href: "/dashboard/sip-rejections", label: "Rejections" },
];

/** The Insurance module's views (was: 5 separate sidebar entries). */
export const INSURANCE_TABS: ModuleTab[] = [
  { href: "/dashboard/insurance", label: "Policies", exact: true },
  { href: "/dashboard/insurance/renewals", label: "Renewals" },
  { href: "/dashboard/insurance-claims", label: "Claims", exact: false },
  { href: "/dashboard/insurance/protection-gap", label: "Protection gap" },
  { href: "/dashboard/insurance/commission", label: "Commission" },
];
