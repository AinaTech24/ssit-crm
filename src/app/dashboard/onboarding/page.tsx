/**
 * /dashboard/onboarding — retired.
 *
 * The old Client Onboarding pipeline was an 11-stage tracker that
 * duplicated what the unified 30-stage blueprint engine now handles
 * end-to-end (Leads owns stages 1-10, Clients owns 11-30). Tenants
 * customize the flow under Settings → Blueprints.
 *
 * This file used to be the kanban entry point; now it redirects any
 * lingering bookmark / direct URL to the Leads pipeline, which is the
 * canonical home for stage tracking.
 *
 * The old API + schema rows are intentionally not removed — tenants
 * who have history there can still read it through reports. Only the
 * UI is hidden.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RetiredOnboardingPage() {
  redirect("/dashboard/leads");
}
