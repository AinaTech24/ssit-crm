import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ImportWizard } from "@/components/imports/ImportWizard";

export const dynamic = "force-dynamic";

/**
 * Bulk leave upload — for a firm moving its existing register in, or loading a
 * year of already-approved leave nobody is going to re-file by hand.
 *
 * Firm-wide leave administration only: filing leave for OTHER people in bulk is
 * an admin act. Gated here as well as in the API so the page does not render a
 * form that would 403 on submit.
 */
export default async function ImportLeavePage() {
  const session = await requireSession();
  if (!can(session.roles, "leave.manage.all", session.permissions)) {
    redirect("/dashboard/leave-applications");
  }
  return (
    <ImportWizard
      entityLabel="leave applications"
      backHref="/dashboard/leave-applications"
      parseUrl="/api/leave-applications/import/parse"
      commitUrl="/api/leave-applications/import/commit"
      requiredOurFields={["employee", "fromDate", "reason"]}
    />
  );
}
