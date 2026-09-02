import { ImportWizard } from "@/components/imports/ImportWizard";

export default function ImportTransactionsPage() {
  return (
    <ImportWizard
      entityLabel="transactions"
      backHref="/dashboard/transactions"
      parseUrl="/api/transactions/import/parse"
      commitUrl="/api/transactions/import/commit"
      requiredOurFields={["pan", "type", "amount"]}
    />
  );
}
