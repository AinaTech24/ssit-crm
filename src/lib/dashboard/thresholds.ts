/**
 * Dashboard business-logic thresholds — single source of truth.
 *
 * These used to be scattered magic numbers across the cockpits (180-day
 * dormancy in OwnerCockpit, 120-day HNI review, 7-day SIP-rejection window in
 * BackOffice, 90-day minor→major, …). Centralised here so they're consistent
 * and changeable in one place. `getDashboardThresholds()` is the read path —
 * today it returns the defaults; a per-tenant override (firm settings) can be
 * layered in later without touching call sites.
 */

export const DEFAULT_DASHBOARD_THRESHOLDS = {
  /** Days since last transaction before a client is flagged "dormant". */
  dormancyDays: 180,
  /** Days since last review before an HNI/top-tier client is "overdue". */
  hniReviewDays: 120,
  /** Look-back window for "recent SIP rejections to follow up". */
  sipRejectionWindowDays: 14,
  /** Short window for "rejections in the last N days" operational counts. */
  rejectionRecentDays: 7,
  /** Window before a minor turns major (guardian → self) to surface early. */
  minorToMajorDays: 90,
};

export type DashboardThresholds = typeof DEFAULT_DASHBOARD_THRESHOLDS;

/**
 * Resolve the thresholds for a tenant. Currently returns the defaults; the
 * signature takes a tenantId so a future per-firm override (read from tenant
 * settings) is a drop-in change with no call-site churn.
 */
export function getDashboardThresholds(_tenantId?: string): DashboardThresholds {
  return DEFAULT_DASHBOARD_THRESHOLDS;
}
