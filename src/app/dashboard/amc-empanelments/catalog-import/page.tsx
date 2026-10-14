import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ImportWizard } from "@/components/imports/ImportWizard";

export const dynamic = "force-dynamic";

/**
 * Import the AMC LIST — the names offered in the AMC dropdown when an
 * empanelment is added. Separate from "Bulk upload", which loads empanelments
 * (contacts, status, dates) for AMCs the firm already distributes for.
 */
export default async function ImportAmcCatalogPage() {
  const session = await requireSession();
  if (!(can(session.roles, "compliance.edit", session.permissions) || can(session.roles, "amc_empanelment.view", session.permissions))) {
    redirect("/dashboard/amc-empanelments");
  }
  return (
    <ImportWizard
      entityLabel="AMC list"
      backHref="/dashboard/amc-empanelments"
      parseUrl="/api/amc-empanelments/catalog/import/parse"
      commitUrl="/api/amc-empanelments/catalog/import/commit"
      requiredOurFields={["amcName"]}
    />
  );
}
