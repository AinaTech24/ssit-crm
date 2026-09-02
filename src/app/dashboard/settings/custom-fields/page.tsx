import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { CustomFieldsManager } from "@/components/settings/CustomFieldsManager";

export const dynamic = "force-dynamic";

export default async function CustomFieldsPage() {
  const session = await requireSession();
  requireCap(session.roles, "settings.users", session.permissions);
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Custom fields</h1>
        <p className="text-sm text-muted-foreground mt-1">Define your own fields on leads &amp; clients — they appear on each record's detail page.</p>
      </div>
      <CustomFieldsManager />
    </div>
  );
}
