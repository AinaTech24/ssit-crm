/**
 * StatusChip — a single themed status pill that works in both light AND dark mode.
 *
 * Many pages historically hardcoded light-only chips like
 * `bg-emerald-50 text-emerald-700` with no `dark:` variant, which are
 * near-invisible on the app's dark theme. This is the one reusable chip to
 * replace them.
 *
 *   <StatusChip tone="success">Active</StatusChip>
 *   <StatusChip tone={statusTone(row.status)}>{row.status}</StatusChip>
 */

import type React from "react";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const TONE_CLS: Record<Tone, string> = {
  neutral: "bg-secondary text-muted-foreground border-border",
  success: "bg-success/10 text-success-foreground border-success/25",
  warning: "bg-warning/10 text-warning-foreground border-warning/25",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
  info: "bg-info/10 text-info-foreground border-info/25",
  brand:
    "bg-brand-cyan-light text-brand-cyan-deep border-brand-cyan/20 dark:bg-brand-cyan/15 dark:text-brand-cyan",
};

export function StatusChip({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * statusTone — best-effort, case-insensitive mapping of a common CRM status
 * string to a Tone. Falls back to "neutral" for anything unrecognised.
 */
export function statusTone(status: string): Tone {
  const s = (status ?? "").toLowerCase().trim();
  if (/(^|_|\b)(active|confirmed|completed|complete|paid|won|success|succeeded|approved|delivered|resolved|closed_won)(\b|_|$)/.test(s))
    return "success";
  if (/(^|_|\b)(cancelled|canceled|lost|failed|rejected|overdue|error|expired|blocked|closed_lost)(\b|_|$)/.test(s))
    return "danger";
  if (/(^|_|\b)(pending|draft|in_progress|in progress|scheduled|processing|awaiting|on_hold|on hold|queued)(\b|_|$)/.test(s))
    return "warning";
  if (/(^|_|\b)(new|open|sent|info|running)(\b|_|$)/.test(s)) return "info";
  return "neutral";
}
