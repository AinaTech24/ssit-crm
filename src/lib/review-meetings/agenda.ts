/**
 * Standard client review-meeting agenda — adopted from Network FP
 * "5.1 Review Meeting Checklist".
 *
 * The 7 open-ended discussion questions a good review meeting should walk
 * through. The point of the checklist (per the source template) is to get
 * the client talking about goals, emotions and life changes — "the
 * portfolio is about them, not just the numbers" — rather than reciting
 * returns.
 *
 * Pure data + a small renderer. Consumed by the review-meeting detail
 * editor ("Insert standard review agenda") so every RM walks into a review
 * with the same proven, relationship-first script.
 */

export const REVIEW_AGENDA_QUESTIONS: string[] = [
  "How have things been going on the personal and professional front since we last spoke? Any significant changes or milestones?",
  "What new goals or priorities have emerged for you recently, either personally or financially?",
  "Is there any major expenditure coming up in the next 12–24 months apart from what we've already accounted for?",
  "How comfortable do you feel with current market conditions and fluctuations? Should we adjust your asset allocation?",
  "How do you feel about your progress towards your goals? Is there scope to step up any of your SIPs to better align with where we're headed?",
  "Do you foresee any need for withdrawals in the near future — planned expenses or unexpected life events we should plan for?",
  "Is there anything you'd like to adjust or improve about how we manage your investments, or the way we communicate with you?",
];

export const REVIEW_AGENDA_COACHING_NOTE =
  "Ask open-ended questions — get the client talking about goals, emotions and life changes. The portfolio is about them, not just the numbers.";

/**
 * Render the standard agenda as a discussion-points template the RM can
 * drop into the meeting's free-text field and then annotate inline.
 */
export function renderReviewAgendaTemplate(): string {
  const lines: string[] = ["Key areas for this review:", ""];
  REVIEW_AGENDA_QUESTIONS.forEach((q, i) => {
    lines.push(`${i + 1}. ${q}`);
  });
  lines.push("");
  lines.push(`Note: ${REVIEW_AGENDA_COACHING_NOTE}`);
  return lines.join("\n");
}
