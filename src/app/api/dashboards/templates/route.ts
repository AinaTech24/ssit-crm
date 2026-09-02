/**
 * POST /api/dashboards/templates  { template: <key>, name? }
 *   → creates a new board pre-populated with the template's layout.
 *
 * GET  /api/dashboards/templates
 *   → lists available starter templates (metadata only).
 *
 * Layout expansion lives in templates.ts; the normal createBoard path runs
 * sanitizeLayout server-side, so a stale/invalid widget key is dropped rather
 * than persisted.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { createBoard, type Actor } from "@/lib/dashboards/service";
import { sanitizeLayout } from "@/lib/dashboards/widgets";
import { BOARD_TEMPLATES, BOARD_TEMPLATE_BY_KEY, templateToLayout } from "@/lib/dashboards/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({
      templates: BOARD_TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        widgetCount: t.widgets.length,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  template: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const actor: Actor = { userId: session.userId, roles: session.roles ?? [] };
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });

    const tpl = BOARD_TEMPLATE_BY_KEY[parsed.data.template];
    if (!tpl) return NextResponse.json({ error: "unknown template" }, { status: 404 });

    const layout = sanitizeLayout(templateToLayout(tpl));

    const board = await withTenant(session.tenantId, async (tx) =>
      createBoard(tx, session.tenantId, actor, {
        name: parsed.data.name?.trim() || tpl.name,
        description: tpl.description,
        layout: layout as any,
      })
    );
    return NextResponse.json({ id: board.id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
