import { ImportWizard } from "@/components/imports/ImportWizard";

export default function ImportLeadsPage() {
  return (
    <ImportWizard
      entityLabel="leads"
      backHref="/dashboard/leads"
      parseUrl="/api/leads/import/parse"
      commitUrl="/api/leads/import/commit"
      requiredOurFields={["name"]}
    />
  );
}
