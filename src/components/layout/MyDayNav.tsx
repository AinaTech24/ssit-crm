"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ClipboardCheck, Inbox, Sparkles } from "lucide-react";
import { useNavAllowed } from "./NavAccess";

const ITEMS = [
  { href: "/dashboard/command-center", label: "Overview", icon: Inbox },
  { href: "/dashboard/next-best-action", label: "Prioritized", icon: Sparkles },
  { href: "/dashboard/tasks/daily", label: "Reflection", icon: ClipboardCheck },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
];

export function MyDayNav() {
  const pathname = usePathname();
  const allowed = useNavAllowed();
  return (
    <nav aria-label="My Day views" className="flex w-full gap-1 overflow-x-auto rounded-lg border bg-secondary/40 p-1 sm:w-fit">
      {ITEMS.filter((item) => pathname.startsWith(item.href) || allowed(item.href)).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><item.icon className="size-3.5" />{item.label}</Link>;
      })}
    </nav>
  );
}

