"use client";

/**
 * "Dashboards" sidebar entry — a single flat nav link to the main dashboard.
 *
 * (Previously a collapsible dropdown holding Dashboard / My Dashboards / Team /
 * Scorecard. Those secondary views now live in the in-page "View" dropdown on
 * the dashboard hero, so the sidebar stays a single clean link.)
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";

export type DashboardSubItem = { href: string; label: string };

export function DashboardNavDropdown(_props: { items?: DashboardSubItem[] }) {
  const pathname = usePathname() ?? "";
  const active = pathname === "/dashboard";
  return (
    <Link href="/dashboard" className={`group nav-link w-full ${active ? "nav-link-active" : ""}`}>
      <LayoutDashboard className="size-4 shrink-0" />
      <span className="truncate flex-1 text-left sidebar-when-expanded">Dashboards</span>
    </Link>
  );
}
