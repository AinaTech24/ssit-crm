/**
 * Self-service Calendly connection — each user connects their OWN Calendly.
 *
 *   GET    → { connected, schedulingUrl?, eventTypeName?, durationMinutes?, hostEmail? }
 *   POST   → { token, schedulingUrl } — verifies both against Calendly, then stores
 *   DELETE → disconnects
 *
 * Hard-scoped to session.userId (a user can only ever touch their own row), so —
 * like me/profile — it carries no capability check. The token is stored encrypted
 * and is never sent back to the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import {
  disconnectCalendly,
  getCalendlyConfig,
  resolveCalendlyConfig,
  saveCalendlyConfig,
} from "@/lib/integrations/calendly";

export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().trim().min(10).max(2000),
  schedulingUrl: z.string().trim().url().max(500),
});

export async function GET() {
  try {
    const session = await requireSession();
    const cfg = await withTenant(session.tenantId, (tx) => getCalendlyConfig(tx, session.tenantId, session.userId));
    if (!cfg) return NextResponse.json({ connected: false });
    return NextResponse.json({
      connected: true,
      schedulingUrl: cfg.schedulingUrl,
      eventTypeName: cfg.eventTypeName ?? null,
      durationMinutes: cfg.durationMinutes ?? null,
      hostEmail: cfg.hostEmail ?? null,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter your Calendly access token and your booking link." }, { status: 400 });
    }
    const resolved = await resolveCalendlyConfig(parsed.data.token, parsed.data.schedulingUrl);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
    await withTenant(session.tenantId, (tx) => saveCalendlyConfig(tx, session.tenantId, session.userId, resolved.config));
    return NextResponse.json({
      connected: true,
      schedulingUrl: resolved.config.schedulingUrl,
      eventTypeName: resolved.config.eventTypeName ?? null,
      durationMinutes: resolved.config.durationMinutes ?? null,
      hostEmail: resolved.config.hostEmail ?? null,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    await withTenant(session.tenantId, (tx) => disconnectCalendly(tx, session.tenantId, session.userId));
    return NextResponse.json({ connected: false });
  } catch (err: any) {
    return handleApiError(err);
  }
}
