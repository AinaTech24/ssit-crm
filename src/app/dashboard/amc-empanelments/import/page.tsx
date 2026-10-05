import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ImportWizard } from "@/components/imports/ImportWizard";

export const dynamic = "force-dynamic";

/**
 * Bulk upload of the AMC panel.
 *
 * A firm arriving on the platform already has its panel in a spreadsheet, and
 * re-typing thirty AMCs with their codes and contacts is the wrong first hour.
 * Re-uploading a corrected sheet updates the same rows rather than duplicating
 * them, so fixing a mistake is another upload and not a clean-up job.
 */
export default async function ImportAmcPage() {
  const session = await requireSession();
  if (!(can(session.roles, "compliance.edit", session.permissions) || can(session.roles, "amc_empanelment.view", session.permissions))) {
    redirect("/dashboard/amc-empanelments");
  }
  return (
    <ImportWizard
      entityLabel="AMC empanelments"
      backHref="/dashboard/amc-empanelments"
      parseUrl="/api/amc-empanelments/import/parse"
      commitUrl="/api/amc-empanelments/import/commit"
      requiredOurFields={["amcName"]}
    />
  );
}
