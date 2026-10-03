"use client";

/**
 * "Sub-branch view ⇄ Admin view" for a sub-branch head an admin has given the
 * switch to. Lives at the top of the dashboard so it is one click away rather
 * than inside the profile menu. A full page load afterwards: the sidebar, the
 * data wall and every open page were computed for the other view.
 */

import { useState } from "react";
import { Building2, Loader2, ShieldCheck } from "lucide-react";

export function AdminViewToggle({ adminMode }: { adminMode: boolean }) {
  const [busy, setBusy] = useState(false);

  async function go(next: "admin" | "default") {
    if (busy || (next === "admin") === adminMode) return;
    setBusy(true);
    try {
      await fetch("/api/auth/view-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
    } catch {
      /* the reload shows whichever view actually applies */
    }
    window.location.href = "/dashboard";
  }

  const base = "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors";
  const on = "bg-brand-cyan text-white";
  const off = "text-muted-foreground hover:bg-accent";
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1">
      <button type="button" onClick={() => go("default")} disabled={busy} className={`${base} ${adminMode ? off : on}`}>
        <Building2 className="size-3.5" /> My sub-branch
      </button>
      <button type="button" onClick={() => go("admin")} disabled={busy} className={`${base} ${adminMode ? on : off}`}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Admin view
      </button>
    </div>
  );
}
