"use client";

/**
 * AutoRefresh — drop into any server-component page to make it self-update
 * without a manual reload. Calls router.refresh() on an interval (which re-runs
 * the server component and streams fresh data in), and also refreshes the
 * moment the tab regains focus. Polling pauses while the tab is hidden so we
 * don't hammer the DB for background tabs.
 *
 * Used for near-realtime "live" panels (e.g. the super-admin tenant list updates
 * as new workspaces are created). Keep the interval generous on heavy pages.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 12000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    };
    const id = setInterval(refresh, Math.max(4000, intervalMs));
    const onVisible = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
