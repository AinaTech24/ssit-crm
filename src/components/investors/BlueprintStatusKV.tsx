"use client";

/**
 * Compact "Blueprint status" cell for the client-details grid — shows the
 * client's current onboarding-blueprint stage (fetched from
 * /api/investors/[id]/blueprint). Read-only; the full stage bar lives on the
 * Engagement tab. Styled to line up with the other <Status>/<KV> cells.
 */

import { useEffect, useState } from "react";

export function BlueprintStatusKV({ investorId }: { investorId: string }) {
  const [stage, setStage] = useState<string | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    let alive = true;
    fetch(`/api/investors/${investorId}/blueprint`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        const stages: any[] = j?.stages ?? [];
        const current = stages.find((s) => s.status === "current");
        const lastDone = [...stages].reverse().find((s) => s.status === "done");
        setStage(current?.name ?? lastDone?.name ?? null);
      })
      .catch(() => { if (alive) setStage(null); });
    return () => { alive = false; };
  }, [investorId]);

  return (
    <div>
      <div className="text-xs text-muted-foreground">Blueprint status</div>
      <span className="text-xs px-2 py-0.5 rounded-full mt-1 inline-block bg-brand-cyan-light/60 text-brand-cyan-deep">
        {stage === undefined ? "…" : stage || "Not started"}
      </span>
    </div>
  );
}
