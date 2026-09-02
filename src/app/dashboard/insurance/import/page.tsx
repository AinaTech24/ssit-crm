import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { ImportWizard } from "@/components/imports/ImportWizard";

export const dynamic = "force-dynamic";

export default async function InsuranceImportPage() {
  const session = await requireSession();
  requireCap(session.roles, "insurance.write", session.permissions);
  return (
    <ImportWizard
      entityLabel="policies"
      backHref="/dashboard/insurance"
      parseUrl="/api/insurance/import/parse"
      commitUrl="/api/insurance/import/commit"
      requiredOurFields={["clientPan", "insurer", "planName"]}
    />
  );
}
