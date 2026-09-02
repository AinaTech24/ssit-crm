/**
 * Leave policy + helpers.
 *
 * Default annual entitlements per leave type (tenant-wide policy for v1 — no
 * per-employee overrides yet). Balances are computed: entitlement − approved
 * days in the current financial year. `null` entitlement = uncapped (unpaid).
 *
 * India FY runs Apr–Mar; usage is summed within the current FY.
 */

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: "Casual Leave",
  sick: "Sick Leave",
  earned: "Earned / Privilege Leave",
  unpaid: "Unpaid Leave",
  comp_off: "Comp-off",
  other: "Other",
};

export const LEAVE_DURATION_LABELS: Record<string, string> = {
  full_day: "Full day",
  half_day: "Half day",
};

export const LEAVE_STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Default annual entitlement (days) per type. null = uncapped. */
export const LEAVE_ENTITLEMENTS: Record<string, number | null> = {
  casual: 12,
  sick: 6,
  earned: 15,
  comp_off: 0, // default is 0, granted individually
  unpaid: null,
  other: null,
};

export function getEntitlement(
  leaveType: string,
  customEntitlements?: Record<string, number> | null,
  tenantEntitlements?: Record<string, number | null> | null,
): number | null {
  // Precedence: per-employee override → firm policy → built-in default.
  if (customEntitlements && customEntitlements[leaveType] !== undefined && customEntitlements[leaveType] !== null) {
    return Number(customEntitlements[leaveType]);
  }
  if (tenantEntitlements && tenantEntitlements[leaveType] !== undefined) {
    const v = tenantEntitlements[leaveType];
    return v == null ? null : Number(v);
  }
  if (leaveType === "comp_off") return 0;
  return LEAVE_ENTITLEMENTS[leaveType] ?? null;
}

/** Start of the current Indian financial year (Apr 1) as YYYY-MM-DD. */
export function currentFyStart(today = new Date()): string {
  const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${y}-04-01`;
}

/**
 * Inclusive working-day count between two YYYY-MM-DD dates. Half-day → 0.5.
 * Counts calendar days inclusive (Indian MFD offices commonly work Saturdays);
 * the form lets the user override.
 */
export function computeDays(fromDate: string, toDate: string, duration: "full_day" | "half_day"): number {
  if (duration === "half_day") return 0.5;
  const from = new Date(fromDate + "T00:00:00");
  const to = new Date(toDate + "T00:00:00");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) return 0;
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

/** Local YYYY-MM-DD (avoids the UTC drift of toISOString when iterating dates). */
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Working-day leave count: inclusive days from→to, EXCLUDING the firm's weekly
 * offs (`weekOffDays`, 0=Sun…6=Sat) and any holiday in `holidays`. So a
 * Fri→Mon leave with Sun off + no holiday = 2 days, not 4. Half-day → 0.5.
 */
export function workingDaysExcluding(
  fromDate: string,
  toDate: string,
  duration: "full_day" | "half_day",
  weekOffDays: number[],
  holidays: Set<string>,
): number {
  if (duration === "half_day") return 0.5;
  const from = new Date(fromDate + "T00:00:00");
  const to = new Date(toDate + "T00:00:00");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) return 0;
  const off = new Set(weekOffDays?.length ? weekOffDays : [0]);
  let count = 0;
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    if (off.has(d.getDay())) continue;
    if (holidays.has(ymdLocal(d))) continue;
    count++;
  }
  return count;
}
