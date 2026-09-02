"use client";

/**
 * Active-state-aware sidebar link. Highlights when the current pathname
 * starts with the link's href. Used by /dashboard/layout.tsx.
 *
 * NOTE: the parent layout is a Server Component. Component *functions*
 * (like lucide-react icons) cannot cross the RSC boundary as props, so the
 * caller passes a pre-rendered JSX element (`iconElement`) instead.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SidebarNavLink({
  href,
  label,
  iconElement,
}: {
  href: string;
  label: string;
  iconElement: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  // Exact match for "/dashboard" so it doesn't light up on every sub-route;
  // prefix match for everything deeper.
  const isActive =
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={`group nav-link ${isActive ? "nav-link-active" : ""}`}
      aria-current={isActive ? "page" : undefined}
    >
      {iconElement}
      <span className="truncate">{label}</span>
    </Link>
  );
}
