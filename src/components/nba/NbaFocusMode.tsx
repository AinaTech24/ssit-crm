"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, SkipForward } from "lucide-react";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";
import { LogActivityButton } from "@/components/activities/ActivityLogger";
import { NbaRowActions } from "@/components/nba/NbaRowActions";

export type FocusAction = {
  key: string;
  type: string;
  label: string;
  toneChip: string;
  subjectType: "investor" | "lead";
  subjectId: string;
  subjectName: string;
  phone: string | null;
  email: string | null;
  reason: string;
  rmName: string | null;
  impactLabel: string | null;
  message: string;
  snoozeKey: string;
  href: string;
  othersCount: number;
};

/**
 * "Work the list" — step through actions one at a time (Prev / Skip / Next) so
 * an RM can grind the top of the queue without scanning a wall of rows.
 */
export function NbaFocusMode({ actions }: { actions: FocusAction[] }) {
  const [i, setI] = useState(0);
  if (actions.length === 0) return null;
  const idx = Math.min(i, actions.length - 1);
  const a = actions[idx];

  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-muted-foreground">
          Action <strong className="text-foreground">{idx + 1}</strong> of {actions.length}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setI(Math.max(0, idx - 1))} disabled={idx === 0} className="btn-ghost text-xs disabled:opacity-40" title="Previous">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => setI(Math.min(actions.length - 1, idx + 1))} disabled={idx >= actions.length - 1} className="btn-secondary text-xs" title="Skip to next">
            <SkipForward className="size-3.5" /> Skip
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className={`chip text-[10px] ${a.toneChip}`}>{a.label}</span>
        {a.subjectType === "lead" && <span className="chip text-[10px] bg-amber-50 text-amber-700">Lead</span>}
        {a.othersCount > 0 && <span className="chip text-[10px] bg-secondary text-muted-foreground">+{a.othersCount} more for this client</span>}
      </div>
      <Link href={a.href} className="text-xl font-bold hover:underline">{a.subjectName}</Link>
      <p className="text-sm text-muted-foreground mt-1">{a.reason}{a.rmName ? <span className="opacity-60"> · RM {a.rmName}</span> : ""}</p>
      {a.impactLabel && (
        <div className="mt-3 inline-flex items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Impact</span>
          <span className="text-lg font-bold tabular-nums text-emerald-700">{a.impactLabel}</span>
        </div>
      )}
      {a.message && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/30 p-3 text-sm text-foreground">
          “{a.message}”
        </div>
      )}

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border flex-wrap">
        <ContactQuickActions phone={a.phone} email={a.email} message={a.message} show={["whatsapp", "call", "email"]} size={16} />
        <LogActivityButton subject={{ type: a.subjectType, id: a.subjectId, name: a.subjectName, phone: a.phone }} label="Log" variant="secondary" />
        <NbaRowActions snoozeKey={a.snoozeKey} name={a.subjectName} label={a.label} reason={a.reason} phone={a.phone} email={a.email} />
        <button
          onClick={() => setI(Math.min(actions.length - 1, idx + 1))}
          disabled={idx >= actions.length - 1}
          className="btn-primary text-xs ml-auto disabled:opacity-40"
        >
          Next <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
