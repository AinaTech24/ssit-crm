/**
 * Pre-built recipe library. Each recipe is a complete WorkflowGraph + suggested
 * default templates that a tenant can install with one click.
 *
 * The seeder reads this list and writes one row per recipe into the `recipes`
 * table. New tenants get a curated subset auto-installed (with workflows
 * disabled by default; owner reviews and enables).
 *
 * To add a new recipe: create `<key>.recipe.ts` and re-export it from here.
 */

import { sipRejectionFollowupRecipe } from "./sip_rejection_followup";
import { mandateExpiryRecipe } from "./mandate_expiry";
import { nismExpiryRecipe } from "./nism_expiry";
import { arnExpiryRecipe } from "./arn_expiry";
import { marketVolatilityRecipe } from "./market_volatility";
import { hniQuarterlyReviewRecipe } from "./hni_quarterly_review";
import { retailHalfYearlyReviewRecipe } from "./retail_review";
import { redemptionRetentionRecipe } from "./redemption_retention";
import { birthdayRecipe } from "./birthday";
import { anniversaryRecipe } from "./anniversary";
import { kycExpiryRecipe } from "./kyc_expiry";
import { nomineeMissingRecipe } from "./nominee_missing";
import { bankUpdateRecipe } from "./bank_update";
import { documentChaseRecipe } from "./document_chase";
import { inactiveReactivationRecipe } from "./inactive_reactivation";
import { goalReviewRecipe } from "./goal_review";
import { leadNurtureRecipe } from "./lead_nurture";
import { employeeOnboardingRecipe } from "./employee_onboarding";
import { employeeExitRecipe } from "./employee_exit";
import { dailyMisDigestRecipe } from "./daily_mis_digest";
import { rmScorecardRecipe } from "./rm_scorecard";
import { complaintSlaRecipe } from "./complaint_sla";
import { minorToMajorRecipe } from "./minor_to_major";
import { mandateFailureRetryRecipe } from "./mandate_failure_retry";
import { goalDriftAlert } from "./goal_drift_alert";
import { riskProfileExpiryRecipe } from "./risk_profile_expiry";
import { serviceRequestEscalationRecipe } from "./service_request_escalation";
import { taskOverdueAlertRecipe } from "./task_overdue_alert";
import { taskDailySummaryRecipe } from "./task_daily_summary";
import { taskWeeklyOwnerReportRecipe } from "./task_weekly_owner_report";
import { leadWelcomeRecipe } from "./lead_welcome";
import { proposalApprovedRequestDocsRecipe } from "./proposal_approved_request_docs";
import { docsReceivedConvertRecipe } from "./docs_received_convert";
import { opsCompletePortalWelcomeRecipe } from "./ops_complete_portal_welcome";
import { insurancePremiumReminderRecipe } from "./insurance_premium_reminder";
import { insuranceLapseRecoveryRecipe } from "./insurance_lapse_recovery";
import { sipExpiryReminderRecipe } from "./sip_expiry_reminder";
import { meetingConfirmationRecipe } from "./meeting_confirmation";
import { aumMilestoneRecipe } from "./aum_milestone";
import { protectionGapNudgeRecipe } from "./protection_gap_nudge";
import { taxSavingsNudgeRecipe } from "./tax_savings_nudge";
import { inboundWhatsappAutoresponderRecipe } from "./inbound_whatsapp_autoresponder";
import { riskProfileCompletedRecipe } from "./risk_profile_completed";
import { leadConvertedOnboardingRecipe } from "./lead_converted_onboarding";
import { firstInvestmentCelebrationRecipe } from "./first_investment_celebration";
import { lowCsatRecoveryRecipe } from "./low_csat_recovery";
import { insuranceRenewedCrossSellRecipe } from "./insurance_renewed_crosssell";
import { familyLinkedReviewRecipe } from "./family_linked_review";
import { newBusinessThankYouRecipe } from "./new_business_thankyou";

export interface RecipeDef {
  key: string;
  name: string;
  description: string;
  category: string;
  /** A WorkflowGraph */
  graph: any;
  /** Suggested template seeds (key + channel + sample body) */
  defaultTemplates?: Array<{
    key: string;
    channel: "whatsapp" | "email" | "sms";
    name: string;
    category: "transactional" | "utility" | "marketing";
    body: any;
    variables: any[];
  }>;
  tags?: string[];
}

export const ALL_RECIPES: RecipeDef[] = [
  sipRejectionFollowupRecipe,
  mandateExpiryRecipe,
  nismExpiryRecipe,
  arnExpiryRecipe,
  marketVolatilityRecipe,
  aumMilestoneRecipe,
  protectionGapNudgeRecipe,
  taxSavingsNudgeRecipe,
  hniQuarterlyReviewRecipe,
  retailHalfYearlyReviewRecipe,
  redemptionRetentionRecipe,
  birthdayRecipe,
  anniversaryRecipe,
  kycExpiryRecipe,
  nomineeMissingRecipe,
  bankUpdateRecipe,
  documentChaseRecipe,
  inactiveReactivationRecipe,
  goalReviewRecipe,
  leadNurtureRecipe,
  employeeOnboardingRecipe,
  employeeExitRecipe,
  dailyMisDigestRecipe,
  rmScorecardRecipe,
  complaintSlaRecipe,
  minorToMajorRecipe,
  mandateFailureRetryRecipe,
  goalDriftAlert,
  riskProfileExpiryRecipe,
  serviceRequestEscalationRecipe,
  taskOverdueAlertRecipe,
  taskDailySummaryRecipe,
  taskWeeklyOwnerReportRecipe,
  leadWelcomeRecipe,
  proposalApprovedRequestDocsRecipe,
  docsReceivedConvertRecipe,
  opsCompletePortalWelcomeRecipe,
  insurancePremiumReminderRecipe,
  insuranceLapseRecoveryRecipe,
  sipExpiryReminderRecipe,
  meetingConfirmationRecipe,
  // ── New: event-backed rules that wire previously-unused domain events ──
  inboundWhatsappAutoresponderRecipe,
  riskProfileCompletedRecipe,
  leadConvertedOnboardingRecipe,
  firstInvestmentCelebrationRecipe,
  lowCsatRecoveryRecipe,
  insuranceRenewedCrossSellRecipe,
  familyLinkedReviewRecipe,
  newBusinessThankYouRecipe,
];
