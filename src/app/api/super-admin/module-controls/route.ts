/**
 * Equitywala Admin → Module Controls. Read/update the GLOBAL state of each module
 * (enabled / beta / disabled). Platform-admin only. Applies to every tenant
 * within ~30s (cache TTL), no redeploy.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { loadModuleControls, saveModuleControls, moduleControlsForAdmin } from "@/lib/platform/module-controls";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const map = await loadModuleControls(true);
    return NextResponse.json({ modules: moduleControlsForAdmin(map) });
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  controls: z.record(z.string(), z.enum(["enabled", "beta", "disabled"])),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    await saveModuleControls(parsed.data.controls, session.userId);
    const map = await loadModuleControls(true);
    return NextResponse.json({ ok: true, modules: moduleControlsForAdmin(map) });
  } catch (err) {
    return handleApiError(err);
  }
}
