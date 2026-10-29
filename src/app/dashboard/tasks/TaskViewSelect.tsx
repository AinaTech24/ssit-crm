"use client";

/**
 * Tasks view controls.
 *
 * SCOPE (?view=) and LAYOUT (?layout=) are separate axes. They used to share
 * one param, which made "Kanban board" a fourth tab and therefore mutually
 * exclusive with the scope tabs — you could not see a kanban of just your own
 * tasks. Now every scope can be viewed as a list or a board.
 *
 * Both preserve the other query params (search, status, priority, sort…) so the
 * controls compose with the active filters instead of resetting the page.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { LayoutGrid, List } from "lucide-react";

const SCOPES = [
  { value: "", label: "All tasks" },
  { value: "to_me", label: "Assigned to me" },
  { value: "by_me", label: "Assigned by me" },
  { value: "other", label: "Other activity" },
];

export function TaskViewSelect({ current, layout }: { current: string; layout: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function push(params: URLSearchParams) {
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function goScope(v: string) {
    if (v === current) return;
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("view", v);
    else params.delete("view");
    // Re-scoping restarts from the first page of the new result set.
    params.delete("page");
    push(params);
  }

  function goLayout(v: "list" | "kanban") {
    if (v === layout) return;
    const params = new URLSearchParams(searchParams.toString());
    if (v === "kanban") {
      params.set("layout", "kanban");
      // The kanban's columns ARE the statuses, so a lingering status/due filter
      // would collapse the board to one column. Clear those when entering it.
      params.delete("status");
      params.delete("due");
    } else {
      params.delete("layout");
    }
    params.delete("page");
    push(params);
  }

  return (
    <div className="inline-flex items-center gap-2">
      {/* Scope */}
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
        {SCOPES.map((v) => {
          const active = current === v.value;
          return (
            <button
              key={v.value || "all"}
              type="button"
              onClick={() => goScope(v.value)}
              aria-pressed={active}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {/* Layout — available in every scope */}
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
        {([
          ["list", List, "List view"],
          ["kanban", LayoutGrid, "Kanban board"],
        ] as const).map(([key, Icon, label]) => {
          const active = layout === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => goLayout(key)}
              aria-pressed={active}
              title={label}
              aria-label={label}
              className={`rounded-md p-1.5 transition-colors ${
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
