/**
 * /dashboard/onboarding/[id] — retired.
 *
 * Used to be the detail / stage-edit screen for a single onboarding
 * pipeline. Now that lead-to-client journeys live in the unified
 * blueprint engine, the equivalent view is the lead detail page
 * (pre-conversion) or the client detail page (post-conversion).
 *
 * Redirects the converted client's lead, or to /dashboard/leads if we
 * can't resolve it.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RetiredOnboardingDetailPage() {
  redirect("/dashboard/leads");
}
