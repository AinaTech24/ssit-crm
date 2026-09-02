/**
 * POST /api/integrations/zoho/disconnect — soft-disconnect the firm's Zoho
 * connection (keeps the row + sync history; stops pushing).
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { withTenant } from "@/db/client";
import { disconnectZoho } from "@/lib/integrations/zoho/credentials";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    // Firm-wide integration config — not something any logged-in RM should be able
    // to tear down. Gate on the same capability that governs firm masters/settings.
    requireCap(session.roles, "settings.masters", session.permissions);
    await withTenant(session.tenantId, async (tx) => {
      await disconnectZoho(tx, session.tenantId);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
