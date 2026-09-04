"use client";

/**
 * Platform-admin app shell — fixed sidebar + scrollable content (hidden
 * scrollbars), sticky top navbar, and a sticky profile control pinned to the
 * sidebar bottom that opens an (upward) menu on hover/click with Settings, a
 * light/dark theme toggle, and Sign out (with a confirmation dialog).
 *
 * Pure presentation around the existing super-admin pages — all routes,
 * data, and the logout endpoint are unchanged.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3, Building2, Package, LifeBuoy, Settings, Users as UsersIcon,
  Activity, Image as ImageIcon, Bot, PieChart, ChevronUp, LogOut,
  Loader2, ShieldCheck, RefreshCw, Mail, SlidersHorizontal, ServerCog,
  LayoutTemplate, Inbox, BookOpen, MailSearch,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type NavItem = { href: string; label: string; icon: any };

const NAV: NavItem[] = [
  { href: "/super-admin", label: "Overview", icon: BarChart3 },
  { href: "/super-admin/analytics", label: "Analytics", icon: PieChart },
  { href: "/super-admin/tenants", label: "MFD tenants", icon: Building2 },
  { href: "/super-admin/kb-articles", label: "Knowledge Base", icon: BookOpen },
  { href: "/super-admin/content-library", label: "Content Library", icon: ImageIcon },
  { href: "/super-admin/support", label: "Support tickets", icon: LifeBuoy },
  { href: "/super-admin/users", label: "Admins", icon: UsersIcon },
  { href: "/super-admin/ai", label: "AI & Models", icon: Bot },
  { href: "/super-admin/email", label: "Email", icon: Mail },
  { href: "/super-admin/rta-inbox", label: "RTA Mailbox", icon: Inbox },
  { href: "/super-admin/module-controls", label: "Module Controls", icon: SlidersHorizontal },
  { href: "/super-admin/aws-monitoring", label: "AWS Monitoring", icon: ServerCog },
  { href: "/super-admin/settings", label: "Platform settings", icon: Settings },
];

function initialsOf(name?: string | null) {
  const p = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "S") + (p[1]?.[0] ?? "")).toUpperCase();
}

export function AdminShell({
  name,
  email,
  children,
}: {
  name: string;
  email?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function doSignOut() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout?scope=admin", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setLoggingOut(false);
    }
  }

  function openMenu() { if (closeTimer.current) clearTimeout(closeTimer.current); setMenuOpen(true); }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenuOpen(false), 180);
  }

  const isActive = (href: string) =>
    href === "/super-admin" ? pathname === "/super-admin" : pathname === href || pathname.startsWith(href + "/");

  const title = NAV.find((n) => isActive(n.href))?.label ?? "Platform Admin";

  return (
    <div className="h-screen flex overflow-hidden bg-muted/30">
      {/* ---------------------------------------------------------------- Sidebar */}
      <aside className="w-64 shrink-0 h-full flex flex-col text-white relative overflow-hidden"
        style={{ background: "linear-gradient(180deg, hsl(221 70% 18%) 0%, hsl(221 76% 12%) 55%, hsl(221 80% 9%) 100%)" }}>
        {/* subtle brand glow */}
        <div className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full opacity-30 blur-3xl"
          style={{ background: "hsl(199 89% 48%)" }} />

        <div className="relative px-4 py-4 flex items-center gap-2.5 border-b border-white/10">
          <div className="size-9 rounded-xl grid place-items-center font-black shadow-lg shadow-black/30"
            style={{ background: "linear-gradient(135deg,#fff, #dbe6ff)", color: "#0E2557" }}>S</div>
          <div className="leading-tight">
            <div className="font-bold tracking-tight">Equitywala</div>
            <div className="text-[10px] text-white/55 font-medium uppercase tracking-wider">Platform Admin</div>
          </div>
        </div>

        <nav className="relative flex-1 overflow-y-auto scrollbar-none px-2.5 py-3 space-y-1">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <button
                key={n.href}
                type="button"
                onClick={() => router.push(n.href)}
                className={`group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-white text-[#0E2557] shadow-md shadow-black/20"
                    : "text-white/75 hover:text-white hover:bg-white/10"
                }`}
              >
                <n.icon className={`size-4 shrink-0 ${active ? "text-[#0E2557]" : "text-white/60 group-hover:text-white"}`} />
                <span className="truncate">{n.label}</span>
              </button>
            );
          })}
        </nav>

        {/* ----------------------------------------- sticky profile + popup menu */}
        <div
          className="relative px-3 py-3 border-t border-white/10"
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
        >
          {menuOpen && (
            <div
              className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-white/10 bg-[hsl(221_30%_14%)] shadow-2xl shadow-black/50 overflow-hidden animate-scale-in origin-bottom"
              onMouseEnter={openMenu}
              onMouseLeave={scheduleClose}
            >
              <button onClick={() => router.push("/super-admin/settings")}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-white/85 hover:bg-white/10 transition-colors">
                <Settings className="size-4 text-white/60" /> Platform settings
              </button>
              <button onClick={() => router.push("/super-admin/users")}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-white/85 hover:bg-white/10 transition-colors">
                <ShieldCheck className="size-4 text-white/60" /> Admins
              </button>
              <div className="h-px bg-white/10" />
              <button onClick={() => { setMenuOpen(false); setConfirmOut(true); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-rose-300 hover:bg-rose-500/15 transition-colors">
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-white/10 transition-colors text-left"
          >
            <div className="size-8 rounded-full grid place-items-center text-xs font-bold shrink-0"
              style={{ background: "linear-gradient(135deg,#fff,#dbe6ff)", color: "#0E2557" }}>
              {initialsOf(name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate text-white">{name}</div>
              <div className="text-[10px] text-white/55 truncate">{email}</div>
            </div>
            <ChevronUp className={`size-4 text-white/50 transition-transform ${menuOpen ? "" : "rotate-180"}`} />
          </button>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- Content */}
      <main className="flex-1 min-w-0 h-full flex flex-col">
        <header className="sticky top-0 z-20 shrink-0 h-14 px-6 flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <h1 className="text-sm font-semibold text-foreground">{title}</h1>
            <span className="hidden sm:inline text-[11px] text-muted-foreground">· Cross-tenant platform view</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setRefreshing(true);
                router.refresh();
                setTimeout(() => setRefreshing(false), 800);
              }}
              aria-label="Refresh"
              title="Refresh data"
              className="size-9 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto scrollbar-none">
          <div className="p-6">{children}</div>
        </div>
      </main>

      <ConfirmDialog
        open={confirmOut}
        title="Sign out of Platform Admin?"
        message="You'll be returned to the login screen and will need to sign in again to access the platform admin console."
        confirmLabel={loggingOut ? "Signing out…" : "Sign out"}
        cancelLabel="Stay signed in"
        tone="danger"
        busy={loggingOut}
        onConfirm={doSignOut}
        onCancel={() => setConfirmOut(false)}
      />
    </div>
  );
}
