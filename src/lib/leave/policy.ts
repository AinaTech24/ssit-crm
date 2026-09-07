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

/**
 * ── The paid-leave pool ────────────────────────────────────────────────────
 *
 * Firm policy: 18 days a financial year, EARNED at 1.5 a month rather than
 * granted up front. casual / sick / earned all draw on the one pool, so the
 * balance a person sees is a single number, not three that silently add up to
 * 33. Comp-off is granted individually, unpaid is uncapped, "other" is
 * uncapped — none of them touch the pool.
 *
 * Both numbers are per-tenant (leave_settings, migration 0204); these are the
 * defaults and the fallback when a firm has no settings row.
 */
export const LEAVE_ANNUAL_TOTAL = 18;
export const LEAVE_MONTHLY_ACCRUAL = 1.5;

/** Leave types that draw down the shared pool. */
export const POOLED_LEAVE_TYPES = ["casual", "sick", "earned"] as const;

export function isPooledLeaveType(leaveType: string): boolean {
  return (POOLED_LEAVE_TYPES as readonly string[]).includes(leaveType);
}

/** 0-based month index within the Indian FY: Apr=0 … Mar=11. */
function fyMonthIndex(d: Date): number {
  return d.getMonth() >= 3 ? d.getMonth() - 3 : d.getMonth() + 9;
}

/**
 * Months of the current FY this person has accrued for, 1..12.
 *
 * Counts the CURRENT month (you accrue on entering a month, not on leaving it —
 * otherwise a new joiner has a zero balance for their whole first month), and
 * starts from the joining month for anyone who joined mid-year. A joining date
 * in an earlier FY, or absent, means the full year from April.
 */
export function fyMonthsAccrued(today = new Date(), joiningDate?: string | null): number {
  const fyStart = new Date(currentFyStart(today) + "T00:00:00");
  let startIdx = 0;
  if (joiningDate) {
    const j = new Date(String(joiningDate).slice(0, 10) + "T00:00:00");
    if (!isNaN(j.getTime()) && j >= fyStart) startIdx = fyMonthIndex(j);
  }
  const months = fyMonthIndex(today) - startIdx + 1;
  // Clamp low as well as high: a joining date in the FUTURE accrues nothing.
  return Math.max(0, Math.min(12, months));
}

/**
 * Pool days accrued so far this FY. Rounded to 2dp because 1.5/month lands on
 * clean halves but a firm may configure e.g. 1.25.
 */
export function accruedPoolDays(opts?: {
  today?: Date;
  joiningDate?: string | null;
  annualTotal?: number | null;
  monthlyAccrual?: number | null;
}): number {
  const total = opts?.annualTotal ?? LEAVE_ANNUAL_TOTAL;
  const monthly = opts?.monthlyAccrual ?? LEAVE_MONTHLY_ACCRUAL;
  const raw = monthly * fyMonthsAccrued(opts?.today ?? new Date(), opts?.joiningDate);
  return Math.min(total, Math.round(raw * 100) / 100);
}

/**
 * The entitlement to show for one leave type under the pool model.
 * Pooled types report the accrued pool; everything else keeps the per-type
 * entitlement (comp-off = granted, unpaid/other = null = uncapped).
 */
export function poolAwareEntitlement(
  leaveType: string,
  opts: {
    customEntitlements?: Record<string, number> | null;
    tenantEntitlements?: Record<string, number | null> | null;
    joiningDate?: string | null;
    annualTotal?: number | null;
    monthlyAccrual?: number | null;
    today?: Date;
  },
): number | null {
  if (isPooledLeaveType(leaveType)) {
    // A per-EMPLOYEE override still wins — that is how a firm grants someone a
    // larger allowance without moving the firm-wide policy.
    const custom = opts.customEntitlements?.[leaveType];
    if (custom !== undefined && custom !== null) return Number(custom);
    return accruedPoolDays(opts);
  }
  return getEntitlement(leaveType, opts.customEntitlements, opts.tenantEntitlements);
}

/** Days already drawn from the pool = approved days across the pooled types. */
export function pooledUsed(usedByType: Record<string, number> | undefined | null): number {
  if (!usedByType) return 0;
  return POOLED_LEAVE_TYPES.reduce((sum, t) => sum + (Number(usedByType[t]) || 0), 0);
}

export type LeaveBalanceRow = {
  /** "pool" for the shared row, otherwise the leave type key. */
  type: string;
  label: string;
  entitlement: number | null;
  used: number;
  remaining: number | null;
};

/**
 * The balance rows to show a person: ONE row for the shared pool, then each
 * non-pooled type. Every balance view uses this so profile, employee record and
 * the API can never drift into showing three different numbers for one policy.
 */
export function buildLeaveBalanceRows(opts: {
  usedByType: Record<string, number>;
  customEntitlements?: Record<string, number> | null;
  tenantEntitlements?: Record<string, number | null> | null;
  joiningDate?: string | null;
  annualTotal?: number | null;
  monthlyAccrual?: number | null;
  today?: Date;
  /** Non-pooled types to list after the pool row. */
  extraTypes?: string[];
}): LeaveBalanceRow[] {
  const total = opts.annualTotal ?? LEAVE_ANNUAL_TOTAL;
  const accrued = accruedPoolDays(opts);
  const poolUsed = pooledUsed(opts.usedByType);
  const rows: LeaveBalanceRow[] = [
    {
      type: "pool",
      label: `Paid leave (of ${total}/yr)`,
      entitlement: accrued,
      used: poolUsed,
      remaining: Math.max(0, accrued - poolUsed),
    },
  ];
  for (const t of opts.extraTypes ?? ["comp_off", "unpaid"]) {
    if (isPooledLeaveType(t)) continue;
    const ent = getEntitlement(t, opts.customEntitlements, opts.tenantEntitlements);
    const used = Number(opts.usedByType[t]) || 0;
    rows.push({
      type: t,
      label: LEAVE_TYPE_LABELS[t] ?? t,
      entitlement: ent,
      used,
      remaining: ent == null ? null : Math.max(0, ent - used),
    });
  }
  return rows;
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
