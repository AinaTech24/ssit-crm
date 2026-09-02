/**
 * Lead-capture forms admin page.
 *
 * Owner / marketing create + manage public web forms. Each form gets
 * a permanent public URL (/lf/<slug>) the MFD can drop into their
 * own website or share directly.
 *
 * MVP scope: list + new. Edit/preview/embed-code/analytics come in a
 * follow-up — the working URL is enough to start capturing leads.
 */

import Link from "next/link";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { leadCaptureForms } from "@/db/schema";
import { LeadFormsAdmin } from "@/components/lead-forms/LeadFormsAdmin";

export const dynamic = "force-dynamic";

export default async function LeadFormsPage() {
  const session = await requireSession();
  requireCap(session.roles, "settings.users", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);

  const forms = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select()
      .from(leadCaptureForms)
      .where(eq(leadCaptureForms.tenantId, session.tenantId));
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Link href="/dashboard/settings" className="hover:underline">
            Settings
          </Link>
          <span>·</span>
          <span>Public lead forms</span>
        </div>
        <h1 className="text-2xl font-semibold">Public lead capture forms</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Build branded forms you can embed on your website or share as a link.
          Every submission lands as a new lead in the pipeline, auto-assigned to
          an RM.
        </p>
      </div>

      <LeadFormsAdmin
        existingForms={forms.map((f) => ({
          id: f.id,
          name: f.name,
          slug: f.slug,
          enabled: f.enabled,
          createdAt: f.createdAt ? f.createdAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
