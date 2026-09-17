"use client";

/**
 * "My clients / My branch" switch for the Clients list.
 *
 * Only rendered for someone whose data wall covers a branch — a branch head, or
 * anyone granted branches on their employee record. The common case is an RM
 * promoted to run a branch: they work their own book day to day, and need the
 * whole branch on demand. One default can't serve both, so this is the switch.
 *
 * Writes `?book=` and drops `page` so switching sides doesn't land you on page
 * 7 of a list that no longer has one.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Users, Building2 } from "lucide-react";

export function BookScopeSwitch({ view }: { view: "mine" | "branch" }) {
  const router = useRouter();
  const sp = useSearchParams();

  function go(next: "mine" | "branch") {
    if (next === view) return;
    const params = new URLSearchParams(sp?.toString() ?? "");
    params.set("book", next);
    params.delete("page");
    router.push(`/dashboard/investors?${params.toString()}`);
  }

  const base =
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors";
  const on = "bg-primary/10 text-primary";
  const off = "text-muted-foreground hover:bg-accent/50";

  return (
    <div
      className="inline-flex rounded-lg border overflow-hidden bg-card"
      role="group"
      aria-label="Which clients to show"
    >
      <button
        type="button"
        onClick={() => go("mine")}
        aria-pressed={view === "mine"}
        className={`${base} ${view === "mine" ? on : off}`}
      >
        <Users className="size-3.5" /> My clients
      </button>
      <button
        type="button"
        onClick={() => go("branch")}
        aria-pressed={view === "branch"}
        className={`${base} border-l ${view === "branch" ? on : off}`}
      >
        <Building2 className="size-3.5" /> My branch
      </button>
    </div>
  );
}
