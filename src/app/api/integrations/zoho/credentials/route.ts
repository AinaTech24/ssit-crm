/**
 * POST /api/integrations/zoho/credentials
 *
 * The MFD owner saves their OWN Zoho OAuth app's Client ID + Secret + data
 * center. Stored encrypted. After this, they click "Authenticate" to run OAuth.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { saveZohoAppCredentials } from "@/lib/integrations/zoho/credentials";
import { isZohoDataCenter } from "@/lib/integrations/zoho/datacenters";

export const dynamic = "force-dynamic";

const Body = z.object({
  clientId: z.string().trim().min(5).max(200),
  clientSecret: z.string().trim().min(5).max(200),
  dataCenter: z.string().trim().min(2).max(4),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session.roles.includes("owner")) {
    return NextResponse.json({ error: "Only the firm owner can configure integrations." }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid Client ID, Client Secret and data center." }, { status: 400 });
  }
  const dc = parsed.data.dataCenter.toLowerCase();
  if (!isZohoDataCenter(dc)) {
    return NextResponse.json({ error: "Unknown Zoho data center." }, { status: 400 });
  }
  await withTenant(session.tenantId, async (tx) => {
    await saveZohoAppCredentials(tx, session.tenantId, {
      clientId: parsed.data.clientId,
      clientSecret: parsed.data.clientSecret,
      dataCenter: dc,
    });
  });
  return NextResponse.json({ ok: true });
}
