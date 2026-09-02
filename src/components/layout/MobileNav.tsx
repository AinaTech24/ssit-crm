"use client";

/**
 * Mobile navigation drawer. On screens below `lg` the fixed 16rem sidebar would
 * swallow half a phone, so we hide it there and show a hamburger that slides the
 * SAME nav in as an overlay. The sidebar content is passed as `children` from
 * the (server) layout, so there's zero duplication — desktop renders it in the
 * aside, mobile renders it in this drawer.
 *
 * Closes automatically on navigation (pathname change), on backdrop click, and
 * on Escape. Locks body scroll while open.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape to close + lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lg:hidden size-9 rounded-lg bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
        aria-label="Open navigation menu"
        aria-expanded={open}
      >
        <Menu className="size-5" />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        // Portalled to <body>: the topbar uses backdrop-blur, which makes it a
        // containing block for fixed descendants — rendering the overlay there
        // would trap `inset-0` inside the 64px header. The portal escapes it so
        // the drawer covers the whole viewport on phones + tablets.
        <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40 animate-fade-in"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-card border-r border-border/70 shadow-2xl flex flex-col animate-fade-in">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 z-10 size-11 rounded-lg bg-foreground/10 hover:bg-foreground/20 text-foreground grid place-items-center"
              aria-label="Close menu"
            >
              <X className="size-4" />
            </button>
            {children}
          </aside>
        </div>,
        document.body
      )}
    </>
  );
}
