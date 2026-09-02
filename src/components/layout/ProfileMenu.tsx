"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings, ShieldCheck, Building2, UserCircle, LogOut, ChevronDown, Loader2, CreditCard } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * Header profile control. Opens on CLICK (toggle) and exposes account links +
 * Log out. Closes on outside-click or Escape.
 */
export function ProfileMenu({
  name,
  email,
  roleLabel,
  initials,
  avatarUrl,
  packageKey,
  licenseStatus,
  trialEndsLabel,
}: {
  name: string;
  email?: string;
  roleLabel: string;
  initials: string;
  /** Profile photo (uploaded in Settings → My profile). Falls back to initials. */
  avatarUrl?: string | null;
  /** License plan key, e.g. "premium" — shown as the "premium" chip. */
  packageKey?: string | null;
  /** License status, e.g. "trial" / "active". */
  licenseStatus?: string | null;
  /** e.g. "19 Jun" — shown as a "Trial ends" chip inside the menu. */
  trialEndsLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Anchor the (portalled) menu to the trigger. Fixed-positioned so no
  // overflow:auto/hidden ancestor — like the scrolling <main> — can clip it.
  const [coords, setCoords] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  /** Recompute the menu's viewport-fixed position from the trigger's rect. */
  function place() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setCoords({ top: Math.round(r.bottom + 8), right: Math.round(Math.max(8, window.innerWidth - r.right)) });
  }

  useEffect(() => {
    if (!open) return;
    place();
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    const reposition = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    // capture-phase so a scroll inside <main> repositions too
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  function requestLogout() {
    setOpen(false);
    setConfirmOpen(true);
  }

  async function doLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout?scope=mfd", { method: "POST" });
    } catch {
      /* clear-cookie is best-effort; still navigate away */
    }
    router.push("/login");
    router.refresh();
  }

  const Avatar = ({ size }: { size: string }) =>
    avatarUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className={`${size} rounded-full object-cover shadow-md ring-2 ring-white`}
      />
    ) : (
      <span className={`${size} rounded-full brand-gradient text-white grid place-items-center text-xs font-bold shadow-md ring-2 ring-white`}>
        {initials}
      </span>
    );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { if (!open) place(); setOpen((o) => !o); }}
        className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 hover:bg-secondary/70 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <Avatar size="size-9" />
        <ChevronDown
          className={`size-3.5 text-muted-foreground transition-transform duration-200 hidden sm:block ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: coords.top, right: coords.right }}
          className="w-64 z-[100] origin-top-right animate-scale-in"
        >
          {/* Solid theme surface (not card-elevated, which is backdrop-blur-
              translucent and lets busy page content bleed through). bg-card so
              it follows light/dark mode instead of forcing white. */}
          <div className="rounded-2xl bg-card text-card-foreground overflow-hidden shadow-xl border border-border/60">
            {/* Identity header — brand background */}
            <div className="px-4 py-4 brand-gradient text-white">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar size="size-11" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{name}</div>
                  {email && <div className="text-[11px] text-white/75 truncate">{email}</div>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <span className="inline-flex items-center rounded-full bg-white/15 border border-white/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  {roleLabel}
                </span>
                {packageKey && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 border border-white/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    {packageKey}
                    {licenseStatus && <span className="text-white/70 normal-case font-medium">· {licenseStatus}</span>}
                  </span>
                )}
                {trialEndsLabel && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/25 border border-amber-200/40 px-2 py-0.5 text-[10px] font-semibold tracking-wide">
                    Trial ends {trialEndsLabel}
                  </span>
                )}
              </div>
            </div>

            <div className="p-1.5">
              <MenuLink href="/dashboard/settings/profile" icon={UserCircle} label="My profile" onClick={() => setOpen(false)} />
              <MenuLink href="/dashboard/settings/security" icon={ShieldCheck} label="Account & security" onClick={() => setOpen(false)} />
              <MenuLink href="/dashboard/settings" icon={Settings} label="Settings" onClick={() => setOpen(false)} />
              <MenuLink href="/dashboard/settings/firm-profile" icon={Building2} label="Firm profile" onClick={() => setOpen(false)} />
            </div>
            <div className="border-t border-border p-1.5">
              <button
                type="button"
                onClick={requestLogout}
                disabled={loggingOut}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-rose-600 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
              >
                {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Log out?"
        message="You'll be signed out of this device and returned to the login screen."
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        tone="danger"
        busy={loggingOut}
        onConfirm={doLogout}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: any;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground/80 hover:bg-secondary hover:text-foreground transition-colors"
    >
      <Icon className="size-4 text-muted-foreground" /> {label}
    </Link>
  );
}
