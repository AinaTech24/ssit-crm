import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/auth/view-mode  { mode: "admin" | "default" }
 *
 * Switches a sub-branch head between their own sub-branch view and the
 * firm-admin view. Only for users an admin has given the switch
 * (users.can_switch_admin); the cookie is meaningless to anyone else because
 * getSession re-checks the flag before elevating.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { VIEW_MODE_COOKIE, canSwitchAdmin } from "@/lib/auth/view-mode";

export const dynamic = "force-dynamic";

const Body = z.object({ mode: z.enum(["admin", "default"]) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid mode" }, { status: 400 });

    const res = NextResponse.json({ ok: true, mode: parse.data.mode });
    if (parse.data.mode === "default") {
      res.cookies.set(VIEW_MODE_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }
    // session.viewMode is already set when elevated; the flag is what matters.
    if (!(await canSwitchAdmin(session.tenantId, session.userId))) {
      return NextResponse.json({ error: "You do not have admin view enabled." }, { status: 403 });
    }
    res.cookies.set(VIEW_MODE_COOKIE, "admin", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // Same horizon as the session itself.
      maxAge: 8 * 60 * 60,
    });
    return res;
  } catch (err: any) {
    return handleApiError(err);
  }
}
