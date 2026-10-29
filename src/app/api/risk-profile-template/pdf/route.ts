import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/risk-profile-template/pdf
 *   The firm's PUBLISHED risk questionnaire as a printable blank form (PDF).
 *   Open to every signed-in user — it holds the questions only, no client data
 *   and no scoring — so any department can hand a client the current form.
 *   ?download=1 forces a save dialog.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadActiveTemplate } from "@/lib/risk-profile/template";
import { renderQuestionnairePdf } from "@/lib/risk-profile/questionnaire-pdf";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      const tpl = await loadActiveTemplate(tx, session.tenantId);
      const t = (
        await tx.execute(sql`
          SELECT display_name, legal_name, arn, principal_euin, gst_number,
                 primary_color, secondary_color, logo_url, phone, email, website
          FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1
        `)
      ).rows[0] as Record<string, string | null | undefined> | undefined;
      return renderQuestionnairePdf({
        form: {
          name: tpl.name,
          description: tpl.description ?? null,
          versionNumber: (tpl as { versionNumber?: number }).versionNumber ?? null,
          questions: tpl.questions.map((q) => ({
            label: q.label,
            helperText: q.helperText ?? null,
            options: q.options.map((o) => ({ label: o.label })),
          })),
        },
        brand: {
          displayName: t?.display_name,
          legalName: t?.legal_name,
          arn: t?.arn,
          euin: t?.principal_euin,
          gstNumber: t?.gst_number,
          primaryColor: t?.primary_color,
          secondaryColor: t?.secondary_color,
          logoUrl: t?.logo_url,
          phone: t?.phone,
          email: t?.email,
          website: t?.website,
        },
        generatedAt: new Date().toISOString(),
      });
    });

    return new NextResponse(new Uint8Array(built), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="Risk_Profile_Questionnaire_${new Date().toISOString().slice(0, 10)}.pdf"`,
        // The questions change when the firm publishes a new version — never serve a stale copy.
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
