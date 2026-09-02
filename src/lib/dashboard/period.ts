/**
 * Dashboard period helpers — server-safe (NO "use client").
 *
 * Lives in lib (not in the PeriodSelector client component) so the server
 * OwnerCockpit can call resolvePeriodDates() directly. A client component
 * can't export functions the server invokes, so the type + the pure
 * resolver belong here; the PeriodSelector component imports the type from
 * this module.
 *
 * India FY = April–March. QTD quarters:
 *   Q1: Apr–Jun · Q2: Jul–Sep · Q3: Oct–Dec · Q4: Jan–Mar
 */

export type Period = "mtd" | "qtd" | "fytd" | "lm" | "custom";

/**
 * Unified period RANGE resolver — returns both a start AND an end so every
 * dashboard (cockpits, charts, board widgets) can share one time window.
 *
 * - mtd/qtd/fytd: start-of-period → now ("to date")
 * - lm: full last calendar month
 * - custom: explicit `from`/`to` when given, else `customStart` → now
 *
 * `fromISO`/`toISO` are for SQL `BETWEEN`/`>=`/`<` clauses; `fromDate`/`toDate`
 * are the same as Date objects; `days` is the inclusive span (handy for charts).
 */
export function resolvePeriodRange(
  period: Period,
  now = new Date(),
  opts?: { customStart?: string; from?: string; to?: string }
): { fromISO: string; toISO: string; fromDate: Date; toDate: Date; label: string; period: Period; days: number } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  // Explicit custom range wins (used by RmDashboard / Team / Command Center).
  if (period === "custom" && opts?.from && iso.test(opts.from)) {
    const fromDate = new Date(opts.from + "T00:00:00");
    const toDate = opts.to && iso.test(opts.to) ? new Date(opts.to + "T23:59:59") : now;
    return pack(fromDate, toDate, rangeLabel(fromDate, toDate), "custom");
  }
  if (period === "lm") {
    const y = now.getFullYear();
    const m = now.getMonth();
    const fromDate = new Date(y, m - 1, 1);
    const toDate = new Date(y, m, 0, 23, 59, 59); // last day of previous month
    return pack(fromDate, toDate, fromDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" }), "lm");
  }
  // mtd / qtd / fytd / custom-since → start..now via the existing resolver.
  const { startISO, label } = resolvePeriodDates(period, now, opts?.customStart);
  return pack(new Date(startISO), now, label, period);
}

function pack(fromDate: Date, toDate: Date, label: string, period: Period) {
  const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000));
  return { fromISO: fromDate.toISOString(), toISO: toDate.toISOString(), fromDate, toDate, label, period, days };
}

function rangeLabel(from: Date, to: Date): string {
  const f = from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const t = to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  return `${f} – ${t}`;
}

export const PERIOD_LABELS: Record<"mtd" | "qtd" | "fytd" | "lm", string> = {
  mtd: "Month to date",
  qtd: "Quarter to date",
  fytd: "FY to date",
  lm: "Last month",
};

/**
 * Given a period key and the current date, return the period start (ISO)
 * for SQL WHERE clauses plus a human label.
 */
export function resolvePeriodDates(
  period: Period,
  now = new Date(),
  customStart?: string
): { startISO: string; label: string } {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based

  if (period === "custom" && customStart && /^\d{4}-\d{2}-\d{2}$/.test(customStart)) {
    const d = new Date(customStart);
    if (!isNaN(d.getTime())) {
      return { startISO: d.toISOString(), label: `Since ${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}` };
    }
  }

  // India FY: April (month=3) is Q1 start
  const fyStart = m >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);

  // QTD quarters (India FY-aligned)
  let qtdStart: Date;
  if (m >= 3 && m <= 5) {
    qtdStart = new Date(y, 3, 1); // Q1 Apr–Jun
  } else if (m >= 6 && m <= 8) {
    qtdStart = new Date(y, 6, 1); // Q2 Jul–Sep
  } else if (m >= 9 && m <= 11) {
    qtdStart = new Date(y, 9, 1); // Q3 Oct–Dec
  } else {
    qtdStart = new Date(y, 0, 1); // Q4 Jan–Mar
  }

  switch (period) {
    case "lm": {
      const lmStart = new Date(y, m - 1, 1);
      return {
        startISO: lmStart.toISOString(),
        label: lmStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      };
    }
    case "qtd":
      return {
        startISO: qtdStart.toISOString(),
        label: `Q${Math.floor(((m - 3 + 12) % 12) / 3) + 1} FY${String(fyStart.getFullYear()).slice(-2)}-${String(fyStart.getFullYear() + 1).slice(-2)}`,
      };
    case "fytd":
      return {
        startISO: fyStart.toISOString(),
        label: `FY${String(fyStart.getFullYear()).slice(-2)}-${String(fyStart.getFullYear() + 1).slice(-2)}`,
      };
    case "mtd":
    default:
      return {
        startISO: new Date(y, m, 1).toISOString(),
        label: now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      };
  }
}
