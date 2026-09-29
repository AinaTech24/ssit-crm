import { ImportWizard } from "@/components/imports/ImportWizard";

export default function ImportLeadsPage() {
  return (
    <ImportWizard
      entityLabel="leads"
      backHref="/dashboard/leads"
      parseUrl="/api/leads/import/parse"
      commitUrl="/api/leads/import/commit"
      requiredOurFields={["name"]}
      welcomePrompt={{
        label: "Send the welcome WhatsApp + email to these leads",
        hint: "Runs the same automation a lead entered by hand triggers — use it for an event attendee list. Leave it off to import quietly.",
      }}
    />
  );
}
