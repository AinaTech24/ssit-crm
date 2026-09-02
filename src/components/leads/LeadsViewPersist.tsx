"use client";

/**
 * Remembers the Leads view (kanban / list) across navigation.
 *
 * The board defaults to kanban when the URL carries no `view` param — but the
 * sidebar "Leads" link is exactly that param-less URL, so leaving on List and
 * coming back used to snap to Kanban. This persists the last EXPLICIT choice in
 * localStorage and, when the URL has no `view`, restores it. The toggle links
 * always carry an explicit `?view=` so a deliberate switch is never overridden.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const KEY = "leads:view";

export function LeadsViewPersist({ explicitView }: { explicitView: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (explicitView === "table" || explicitView === "kanban") {
      try { localStorage.setItem(KEY, explicitView); } catch {}
      return;
    }
    // No explicit view in the URL — restore the saved preference if it differs
    // from the kanban default.
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    if (saved === "table") {
      router.replace("/dashboard/leads?view=table");
    }
  }, [explicitView, router]);
  return null;
}
