import React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { DashboardEmptyState } from "./DashboardEmptyState";

/**
 * The shell the per-RM boards share — same shape as RM Leaderboard, so Tasks,
 * Meetings and Service Requests read as one row of comparable cards rather
 * than three designs that drifted apart.
 *
 * Presentational only. Each board owns its own query and decides what its two
 * numbers mean; this decides how they look, when the card is empty, and where
 * "see all" goes.
 */

export type LeaderboardRow = {
  id: string;
  /** Shown as-is. Callers shorten to a first name to match the RM board. */
  name: string;
  primary: number;
  secondary: number;
  /** Drill-down for this person's rows. */
  href?: string;
};

export function LeaderboardCard({
  title,
  icon: Icon,
  tone,
  rows,
  primaryLabel,
  secondaryLabel,
  allHref,
  allLabel = "See all →",
  emptyTitle,
  emptyHint,
  emptyCta,
  /** Highlight the second column when it means trouble (overdue, breached). */
  secondaryIsAlert = false,
  limit = 5,
}: {
  title: string;
  icon: LucideIcon;
  /** Tailwind colour stem, e.g. "amber" — drives the icon chip and link. */
  tone: string;
  rows: LeaderboardRow[];
  primaryLabel: string;
  secondaryLabel: string;
  allHref: string;
  allLabel?: string;
  emptyTitle: string;
  emptyHint: string;
  emptyCta?: { href: string; label: string };
  secondaryIsAlert?: boolean;
  limit?: number;
}) {
  // A board where every person is on zero is as empty as no rows at all —
  // a column of dashes tells you nothing you did not already know.
  const hasSignal = rows.some((r) => r.primary > 0 || r.secondary > 0);

  return (
    <div className="card-surface glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className={`size-7 rounded-lg bg-${tone}-50 grid place-items-center`}>
            <Icon className={`size-3.5 text-${tone}-600`} />
          </div>
          {title}
        </h2>
        <Link href={allHref} className={`text-xs text-${tone}-700 hover:underline font-medium`}>
          {allLabel}
        </Link>
      </div>

      {rows.length === 0 || !hasSignal ? (
        <DashboardEmptyState
          icon={Icon}
          title={emptyTitle}
          hint={emptyHint}
          cta={emptyCta}
          compact
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs table-modern">
            <thead>
              <tr>
                <th className="text-left py-1.5 px-2">RM</th>
                <th className="text-right py-1.5 px-2">{primaryLabel}</th>
                <th className="text-right py-1.5 px-2">{secondaryLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <tr key={r.id}>
                  <td className="py-2 px-2 font-medium">
                    {r.href ? (
                      <Link href={r.href} className="hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">{r.primary}</td>
                  <td
                    className={`py-2 px-2 text-right tabular-nums ${
                      secondaryIsAlert && r.secondary > 0 ? "text-rose-600 font-semibold" : ""
                    }`}
                  >
                    {r.secondary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
