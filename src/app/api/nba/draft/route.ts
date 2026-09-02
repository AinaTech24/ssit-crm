import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/nba/draft
 * Body: { name, channel?, label, reason }
 *
 * AI-drafts a short, compliance-safe outreach message for a Next-Best-Action
 * row (the deterministic `messageFor` template is the fallback shown by default;
 * this is the "make it better with AI" option). Returns { text }.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { tenants } from "@/db/schema";
import { draftMessage } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(120),
  channel: z.enum(["whatsapp", "email", "sms"]).default("whatsapp"),
  label: z.string().max(80).default("outreach"),
  reason: z.string().max(400).default(""),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { name, channel, label, reason } = parsed.data;

    const tenant = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0]
    );
    const firmName = (tenant as any)?.displayName ?? (tenant as any)?.legalName ?? "our firm";
    const arn = (tenant as any)?.arn ?? "";

    const intent = `Write a short, warm, personal ${channel} message to ${name} for this advisor action: "${label}". Context: ${reason}. One or two sentences, no jargon.`;
    const res = await draftMessage({
      channel,
      intent,
      audienceContext: `Recipient: ${name}. Firm: ${firmName}.`,
      variables: ["name", "arn_no"],
    });
    if ("error" in res) return NextResponse.json({ error: res.error }, { status: 502 });

    // Fill the placeholders so the message is ready to send from the RM's phone.
    const text = res.text
      .replace(/\{\{\s*name\s*\}\}/gi, name.split(" ")[0])
      .replace(/\{\{\s*arn_no\s*\}\}/gi, arn)
      .replace(/\{\{\s*firm[^}]*\}\}/gi, firmName)
      .trim();

    return NextResponse.json({ text });
  } catch (err: any) {
    return handleApiError(err);
  }
}
