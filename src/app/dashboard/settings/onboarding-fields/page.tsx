/**
 * Admin "Onboarding form fields" settings screen.
 *
 * Lets a firm admin choose which client account-opening / KYC fields are
 * MANDATORY vs optional. The override map is keyed on the field key, so it
 * applies wherever that field appears across client types, and the onboarding
 * form's GET endpoint honours it automatically via applyRequiredOverrides().
 *
 * Gated by `settings.users` (firm-admin cap). The override row lives in
 * onboarding_field_settings (migration 0160) — queried with RAW SQL, no Drizzle
 * schema. See ./route.ts for the matching API.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { getAllUniqueFields } from "@/lib/onboarding/kyc-fields";
import { OnboardingFieldsEditor } from "@/components/settings/OnboardingFieldsEditor";

export const dynamic = "force-dynamic";

export default async function OnboardingFieldsPage() {
  const session = await requireSession();
  requireCap(session.roles, "settings.users", session.permissions);

  const overrides = await withTenant(session.tenantId, async (tx) => {
    const res = await tx.execute(sql`
      SELECT required_overrides
      FROM onboarding_field_settings
      WHERE tenant_id = ${session.tenantId}::uuid
      LIMIT 1
    `);
    const row = res.rows[0] as { required_overrides?: Record<string, boolean> } | undefined;
    return (row?.required_overrides ?? {}) as Record<string, boolean>;
  });

  // Pass only serialisable data the editor needs.
  const fields = getAllUniqueFields().map((f) => ({
    key: f.key,
    label: f.label,
    section: f.section,
    required: !!f.required,
    backOffice: !!f.backOffice,
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Settings
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Onboarding form fields</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose which fields your team must fill on the client account-opening /
          &ldquo;Confirm documents received&rdquo; form. Changes apply firm-wide.
        </p>
      </div>

      <OnboardingFieldsEditor fields={fields} overrides={overrides} />
    </div>
  );
}
