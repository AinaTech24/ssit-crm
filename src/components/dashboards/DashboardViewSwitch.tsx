"use client";

/**
 * "Admin view" ⇄ "My RM view" for someone who is both.
 *
 * A firm admin's dashboard is the firm cockpit — totals, every branch, the
 * whole book. That is the right default and the wrong thing when the same
 * person also carries clients and wants their own day: their tasks, their
 * reviews, their SIPs.
 *
 * Picking a person from the scope dropdowns already shows that person's RM
 * dashboard; this is the shortcut to one's OWN, without hunting for yourself
 * in a roster. Switching clears any desk or person that was selected, because
 * "my view" and "that desk's view" are different questions.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Building2, UserRound } from "lucide-react";

export function DashboardViewSwitch({ current }: { current: "admin" | "rm" }) {
  const router = useRouter();
  const sp = useSearchParams();

  function go(next: "admin" | "rm") {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (next === "rm") params.set("as", "rm");
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
        onClick={() => go("rm")}
        className={`${base} ${current === "rm" ? "bg-brand-cyan text-white" : "text-muted-foreground hover:bg-accent"}`}
      >
        <UserRound className="size-3.5" /> My RM view
      </button>
    </div>
  );
}
