import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);

    const docs = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select({
          id: complianceDocuments.id,
          // The column is `name` (there is no `title`); alias it so the
          // client contract ({ id, title, category }) stays unchanged.
          title: complianceDocuments.name,
          category: complianceDocuments.category,
        })
        .from(complianceDocuments)
        .where(eq(complianceDocuments.tenantId, session.tenantId));
    });

    return NextResponse.json({ success: true, documents: docs });
  } catch (err: any) {
    return handleApiError(err);
  }
}
