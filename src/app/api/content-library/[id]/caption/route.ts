import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/content-library/[id]/caption
 *
 * Draft a channel-appropriate share message/caption for a content asset using
 * the configured AI provider. SEBI-safe (never promises returns). Falls back to
 * a sensible template when AI isn't configured. Prefills the send "custom note".
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assetVisibleTo } from "@/lib/content/asset-url";
import { aiMessagesClient, isAiConfigured } from "@/lib/ai/provider";
import { contentLibraryAssets, tenants } from "@/db/schema";

export const dynamic = "force-dynamic";

const CATEGORY_TONE: Record<string, string> = {
  festive: "warm and festive",
  market_update: "calm, factual market commentary",
  investor_education: "educational and simple",
  scheme_recommendation: "informative (no guarantees)",
  tax_planning: "practical tax-planning",
  retirement: "reassuring, long-term",
  child_education: "caring, goal-oriented",
  wealth_creation: "motivating, disciplined",
  sebi_compliance: "neutral and compliant",
  general: "friendly and professional",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: assetId } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send", session.permissions);
    const body = await req.json().catch(() => ({}));
    const channel = body?.channel === "email" ? "email" : "whatsapp";
    const recipientName: string | undefined = body?.recipientName;

    const ctx = await withTenant(session.tenantId, async (tx) => {
      const [asset] = await tx
        .select()
        .from(contentLibraryAssets)
        .where(and(eq(contentLibraryAssets.id, assetId), assetVisibleTo(session.tenantId)))
        .limit(1);
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      return { asset, tenant };
    });
    if (!ctx.asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

    const firm = ctx.tenant?.displayName ?? ctx.tenant?.legalName ?? "your advisor";
    const tone = CATEGORY_TONE[String(ctx.asset.category ?? "general")] ?? CATEGORY_TONE.general;

    // No AI configured → deterministic, compliant fallback.
    if (!(await isAiConfigured())) {
      const greet = recipientName ? `Hi ${recipientName},` : "Hi,";
      const fallback =
        channel === "whatsapp"
          ? `${greet} sharing this — *${ctx.asset.title}*. Happy to discuss. — ${firm}`
          : `${greet}\n\nSharing this update — "${ctx.asset.title}". Do reach out if you'd like to discuss what it means for your plan.\n\nWarm regards,\n${firm}`;
      return NextResponse.json({ caption: fallback, source: "fallback" });
    }

    const sys =
      "You are a marketing copywriter for an Indian mutual-fund distributor (MFD). Write a short client-facing message to accompany a shared piece of content. " +
      "Rules: never promise or imply guaranteed/assured returns; do not give specific buy/sell advice; keep it compliant with SEBI/AMFI norms; be concise. " +
      "Do NOT include a disclaimer (the system adds it). Output ONLY the message text, no preamble.";
    const usr =
      `Content title: "${ctx.asset.title}"` +
      (ctx.asset.description ? `\nDescription: ${ctx.asset.description}` : "") +
      `\nTheme/tone: ${tone}\nChannel: ${channel === "whatsapp" ? "WhatsApp (short, 1-3 lines, may use a single emoji)" : "Email (2-4 short lines, sign off as the firm)"}` +
      (recipientName ? `\nAddress the client by name: ${recipientName}` : "") +
      `\nFirm name: ${firm}`;

    try {
      const res: any = await aiMessagesClient().messages.create({
        model: "fast",
        max_tokens: 300,
        system: sys,
        messages: [{ role: "user", content: usr }],
      } as any);
      const text = Array.isArray(res?.content)
        ? res.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("").trim()
        : String(res?.content ?? "").trim();
      if (!text) return NextResponse.json({ error: "empty AI response" }, { status: 502 });
      return NextResponse.json({ caption: text, source: "ai" });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "AI generation failed" }, { status: 502 });
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}
