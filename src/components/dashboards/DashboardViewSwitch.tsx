"use client";

/**
 * "Admin view" ⇄ "Research view" for the firm admin.
 *
 * The firm cockpit is the default; the research view is the same dashboard the
 * research analysts see — meetings and portfolio reviews by RM — so an admin
 * can check it without logging in as one. Switching clears any desk or person
 * that was selected, because those are different questions.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Building2, FlaskConical } from "lucide-react";

export function DashboardViewSwitch({ current }: { current: "admin" | "ra" }) {
  const router = useRouter();
  const sp = useSearchParams();

  function go(next: "admin" | "ra") {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (next === "ra") params.set("as", "ra");
    else params.delete("as");
    // A scope chosen for the firm view means nothing in a personal one.
    params.delete("unit");
    params.delete("rm");
    const qs = params.toString();
    router.push(`/dashboard${qs ? `?${qs}` : ""}`);
  }

  const base =
    "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors";
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1">
      <button
        type="button"
        onClick={() => go("admin")}
        className={`${base} ${current === "admin" ? "bg-brand-cyan text-white" : "text-muted-foreground hover:bg-accent"}`}
      >
        <Building2 className="size-3.5" /> Admin view
      </button>
      <button
        type="button"
        onClick={() => go("ra")}
        className={`${base} ${current === "ra" ? "bg-brand-cyan text-white" : "text-muted-foreground hover:bg-accent"}`}
      >
        <FlaskConical className="size-3.5" /> Research view
      </button>
    </div>
  );
}
