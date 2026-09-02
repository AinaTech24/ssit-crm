"use client";

/**
 * Top navigation progress bar. App Router shows no feedback between a link click
 * and the next route painting — and in dev, the first visit to a route compiles
 * on-demand (can take several seconds), so clicks feel dead ("nothing happens").
 *
 * This thin bar starts the instant an internal link is clicked and completes
 * when the new pathname renders. Dependency-free: it listens for same-origin
 * anchor clicks to start and the pathname change to finish. Works in dev and
 * production (in prod the compile lag is gone, so it just flashes).
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function NavProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);

  // New route rendered → snap to 100% then fade out.
  useEffect(() => {
    if (!visible) return;
    setWidth(100);
    const t = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Start on any same-origin link click that changes the route.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      const target = a.getAttribute("target");
      if (!href || !href.startsWith("/") || target === "_blank") return;
      if (href === pathname) return; // same page
      setVisible(true);
      // Creep toward 90% with a long ease so it keeps moving during a slow compile.
      requestAnimationFrame(() => setWidth(90));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] h-0.5 pointer-events-none">
      <div
        className="h-full bg-gradient-to-r from-brand-navy via-brand-cyan to-brand-cyan-light shadow-[0_0_8px_rgba(14,165,233,0.6)]"
        style={{
          width: `${width}%`,
          transition: width === 100 ? "width 0.2s ease-out, opacity 0.3s" : "width 8s cubic-bezier(0.05, 0.7, 0.1, 1)",
          opacity: width === 100 ? 0 : 1,
        }}
      />
    </div>
  );
}
