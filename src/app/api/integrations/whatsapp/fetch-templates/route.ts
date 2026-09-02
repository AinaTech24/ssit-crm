/**
 * POST /api/integrations/whatsapp/fetch-templates
 *
 * Pulls the firm's existing WhatsApp templates from their connected Vartify
 * workspace into the CRM (visible in Message Templates + sendable). Uses the
 * TENANT's connected key, not the platform env key.
 */

import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { importWhatsappTemplatesForTenant } from "@/lib/comms/whatsapp-template-import";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "template.edit", session.permissions);
    const result = await withTenant(session.tenantId, async (tx) =>
      importWhatsappTemplatesForTenant(tx, session.tenantId, session.userId)
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return handleApiError(err);
  }
}
