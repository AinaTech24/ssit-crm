/**
 * GET /api/tls/allowed?domain=<host>
 *
 * Caddy's on-demand TLS "ask" endpoint. Before Caddy issues a certificate for
 * a hostname it hasn't seen, it calls this — we return 200 only for hosts we
 * actually serve (the base apex, a live vanity subdomain, or a registered
 * custom domain). Everything else gets 403, so an attacker can't point a random
 * domain at our IP and make us mint unlimited certificates.
 *
 * Public (no session) — added to the middleware whitelist.
 */

import { NextRequest, NextResponse } from "next/server";
import { isServableHost, normalizeHost } from "@/lib/tenant/host";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const domain = normalizeHost(req.nextUrl.searchParams.get("domain"));
  if (!domain) return new NextResponse("missing domain", { status: 400 });
  try {
    const ok = await isServableHost(domain);
    return ok ? new NextResponse("ok", { status: 200 }) : new NextResponse("unknown host", { status: 403 });
  } catch {
    // Fail closed — don't mint a cert if we can't verify the host.
    return new NextResponse("error", { status: 503 });
  }
}
