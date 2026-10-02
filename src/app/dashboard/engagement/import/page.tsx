import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ImportWizard } from "@/components/imports/ImportWizard";

export const dynamic = "force-dynamic";

/**
 * Bulk client-gift upload.
 *
 * Gifting runs in batches — a festival list, a birthday month, a hamper order
 * for forty clients — and logging those one at a time is the job nobody does,
 * which is how the gift log stops reflecting reality.
 *
 * Same gate as logging one by hand, so an RM can upload for their own book and
 * the gifting desk for the firm's.
 */
export default async function ImportGiftsPage() {
  const session = await requireSession();
  const allowed =
    can(session.roles, "investor.edit.all", session.permissions) ||
    can(session.roles, "investor.edit.assigned", session.permissions) ||
    can(session.roles, "gifting.manage", session.permissions);
  if (!allowed) redirect("/dashboard/engagement");

  return (
    <ImportWizard
      entityLabel="client gifts"
      backHref="/dashboard/engagement"
      parseUrl="/api/engagement/gifts/import/parse"
      commitUrl="/api/engagement/gifts/import/commit"
      requiredOurFields={["client", "givenOn"]}
    />
  );
}
