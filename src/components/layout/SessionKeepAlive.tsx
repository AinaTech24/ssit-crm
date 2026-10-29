"use client";

import { useEffect, useState } from "react";

const PING_EVERY_MS = 20 * 60 * 1000;

/**
 * Keeps the login alive while the CRM is in use, and says so plainly when it
 * has ended.
 *
 *  - Slides the 8h window (a tab left open all day otherwise fails the next
 *    save with "not authenticated").
 *  - A session can also be ended on purpose — an admin changing someone's
 *    access, a forced sign-out. Open tabs then fail every save with a bare
 *    "not authenticated"; any 401 from the app's own API now raises a banner
 *    asking them to sign in again instead.
 */
export function SessionKeepAlive() {
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    let last = Date.now();
    const ping = () => {
      last = Date.now();
      fetch("/api/session/keepalive", { method: "POST", credentials: "same-origin" }).catch(() => {});
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") ping();
    }, PING_EVERY_MS);
    // Coming back to a tab that sat in the background: refresh straight away.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > PING_EVERY_MS / 2) ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      if (res.status === 401) {
        const input = args[0];
        const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
        const path = url.replace(/^https?:\/\/[^/]+/, "");
        // Login / reset / signup calls answer 401 for a wrong password — not a lapsed session.
        if (path.startsWith("/api/") && !path.startsWith("/api/auth/") && !path.startsWith("/api/public/")) setEnded(true);
      }
      return res;
    };

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.fetch = original;
    };
  }, []);

  if (!ended) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow"
    >
      <span>Your login has ended (timed out, or your access was updated). Sign in again to keep saving.</span>
      <button
        type="button"
        onClick={() => {
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        }}
        className="rounded bg-primary-foreground/20 px-3 py-1 hover:bg-primary-foreground/30"
      >
        Sign in
      </button>
    </div>
  );
}
