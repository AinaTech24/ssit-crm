/**
 * Indian fiscal-year helpers (April–March). Shared across the firm-finance
 * features (expense ledger, P&L, monthly progress). Pure, no DB.
 */

/** Current FY label for a date, e.g. a date in May 2025 → "2025-26". */
export function currentFyLabel(now = new Date()): string {
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 3 ? y : y - 1; // April = month 3
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Parse "YYYY-YY" → the starting calendar year (number). */
export function fyStartYear(fy: string): number {
  const m = fy.match(/^(\d{4})-\d{2}$/);
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

/** ISO date bounds [Apr 1 startYear .. Mar 31 startYear+1] for an FY label. */
export function fyBounds(fy: string): { startISO: string; endISO: string } {
  const sy = fyStartYear(fy);
  return {
    startISO: `${sy}-04-01`,
    endISO: `${sy + 1}-03-31`,
  };
}

/** The 12 FY months in order, with calendar year — April … March. */
export const FY_MONTHS: Array<{ key: number; label: string }> = [
  { key: 3, label: "Apr" },
  { key: 4, label: "May" },
  { key: 5, label: "Jun" },
  { key: 6, label: "Jul" },
  { key: 7, label: "Aug" },
  { key: 8, label: "Sep" },
  { key: 9, label: "Oct" },
  { key: 10, label: "Nov" },
  { key: 11, label: "Dec" },
  { key: 0, label: "Jan" },
  { key: 1, label: "Feb" },
  { key: 2, label: "Mar" },
];

/** A short list of recent FY labels for selectors (this FY + N prior). */
export function recentFyLabels(count = 4, now = new Date()): string[] {
  const cur = fyStartYear(currentFyLabel(now));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const sy = cur - i;
    out.push(`${sy}-${String((sy + 1) % 100).padStart(2, "0")}`);
  }
  return out;
}
