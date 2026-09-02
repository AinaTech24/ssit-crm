"use client";

/**
 * Read-only render of a custom dashboard's layout. Used by the board view page
 * and by the home screen when a user has set a default board. Includes a
 * board-level RM filter that re-scopes every widget that supports it.
 */

import { useState } from "react";
import { Play, X } from "lucide-react";
import { WidgetView } from "./WidgetView";
import type { PlacedWidget } from "@/lib/dashboards/widgets";

type Member = { id: string; name: string };

export function DashboardView({
  layout,
  members = [],
  initialRm = "",
}: {
  layout: PlacedWidget[];
  members?: Member[];
  initialRm?: string;
}) {
  const [rm, setRm] = useState(initialRm);
  const [present, setPresent] = useState(false);

  if (!layout.length) {
    return <div className="border-2 border-dashed rounded-xl p-12 text-center text-sm text-muted-foreground">This dashboard has no widgets yet.</div>;
  }

  const grid = (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 [grid-auto-rows:minmax(140px,auto)]">
      {layout.map((w) => (
        <div
          key={w.id}
          className="border rounded-lg bg-card p-2 flex flex-col overflow-hidden"
          style={{
            gridColumn: `span ${Math.min(w.colSpan, 4)} / span ${Math.min(w.colSpan, 4)}`,
            gridRow: `span ${w.rowSpan} / span ${w.rowSpan}`,
          }}
        >
          <div className="flex-1 min-h-0">
            {/* per-widget RM override beats the board-level filter */}
            <WidgetView widgetKey={w.widgetKey} config={w.config} rm={(w.config?.rm as string) || rm || undefined} titleOverride={w.title} />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {members.length > 0 && (
          <>
            <span className="text-xs text-muted-foreground">Viewing</span>
            <select value={rm} onChange={(e) => setRm(e.target.value)} className="border rounded-md px-2 py-1 text-sm bg-background">
              <option value="">Whole firm</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </>
        )}
        <div className="flex-1" />
        <button onClick={() => setPresent(true)} className="btn-ghost text-xs inline-flex items-center gap-1" title="Present (fullscreen)">
          <Play className="size-3.5" /> Present
        </button>
      </div>

      {grid}

      {present && (
        <div className="fixed inset-0 z-50 bg-background overflow-auto p-6">
          <div className="flex items-center justify-end mb-3">
            <button onClick={() => setPresent(false)} className="btn-ghost text-sm inline-flex items-center gap-1">
              <X className="size-4" /> Exit
            </button>
          </div>
          {grid}
        </div>
      )}
    </div>
  );
}
