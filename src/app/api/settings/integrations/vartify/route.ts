/**
 * Vartify WhatsApp integration — per-tenant credential setup (one-time).
 *
 * The MFD saves their Vartify webhook (api) key ONCE here; after that every
 * WhatsApp send just references a template name and the pipeline uses these
 * stored, encrypted credentials. Only an owner can manage firm-level keys.
 *
 *   GET    → connection status (masked key, never the secret)
 *   POST   → save / update { apiKey, webhookUrl?, defaultLanguage? }
 *   DELETE → disconnect (soft-disable)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import {
  getTenantIntegrationStatus,
  upsertTenantIntegration,
  disableTenantIntegration,
} from "@/lib/comms/integrations";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

function requireOwner(roles: string[] | undefined) {
  if (!roles?.includes("owner")) {
    return NextResponse.json(
      { error: "forbidden: only the firm owner can manage integration keys" },
      { status: 403 }
    );
  }
  return null;
}

export async function GET() {
  try {
    const session = await requireSession();
    const status = await withTenant(session.tenantId, async (tx) =>
      getTenantIntegrationStatus(tx, session.tenantId, "vartify")
    );
    return NextResponse.json(status);
  } catch (err) {
    return handleApiError(err);
  }
}

const SaveSchema = z.object({
  apiKey: z.string().trim().min(1, "API key is required").max(500),
  webhookUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  defaultLanguage: z.string().trim().max(20).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;

    const parsed = SaveSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { apiKey, webhookUrl, defaultLanguage } = parsed.data;

    const config: Record<string, any> = { apiKey };
    if (webhookUrl) config.webhookUrl = webhookUrl;
    if (defaultLanguage) config.defaultLanguage = defaultLanguage;

    await withTenant(session.tenantId, async (tx) => {
      await upsertTenantIntegration(tx, session.tenantId, "vartify", config);
    });

    const status = await withTenant(session.tenantId, async (tx) =>
      getTenantIntegrationStatus(tx, session.tenantId, "vartify")
    );
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    const forbidden = requireOwner(session.roles);
    if (forbidden) return forbidden;

    await withTenant(session.tenantId, async (tx) => {
      await disableTenantIntegration(tx, session.tenantId, "vartify");
    });
    return NextResponse.json({ ok: true, connected: false });
  } catch (err) {
    return handleApiError(err);
  }
}
